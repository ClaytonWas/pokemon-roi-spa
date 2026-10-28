// Set detail page. Loads data/sets/{id}.json and recomputes everything with
// the viewer's settings using the same src/ev.js the build uses.

import { packEV, productEV, roi, chaseOdds, createSampler, simulateProduct, topHitCards, gradedOverrides, gradedValue } from '../src/ev.js';
import { hashSeed } from '../src/rng.js';
import { loadSettings, saveSettings } from './settings.js';
import { renderTable } from './table.js';
import { el, money, moneyIn, pct, odds, pullLabel, productUrl, TYPE_LABEL, DASH } from './format.js';
import { PROVIDERS } from './graded/provider.js';
import { getCached, putCached, clearCache } from './graded/cache.js';

const $ = (id) => document.getElementById(id);
const id = Number(new URLSearchParams(location.search).get('id'));
const [detail, index] = await Promise.all([fetch(`data/sets/${id}.json`).then(okJson), fetch('data/index.json').then(okJson)]).catch((err) => {
  $('head').replaceChildren(el('h1', {}, 'Set not found'), el('p', {}, String(err)));
  throw err;
});
const { fx, assumptions } = index.meta;
document.title = `${detail.setName} · Pokémon Sealed ROI`;

function okJson(r) {
  if (!r.ok) throw new Error(`${r.url}: HTTP ${r.status}`);
  return r.json();
}

// ---- settings --------------------------------------------------------------
const defaults = {
  currency: 'USD',
  basis: 'gross',
  ...assumptions.pricing,
  sims: assumptions.simulation.sims,
  gemRate: assumptions.graded.gemRate,
  gradingCost: assumptions.graded.gradingCost,
  topN: assumptions.graded.topN,
  useGraded: false,
  provider: Object.keys(PROVIDERS)[0],
  apiKey: '',
  baseUrl: '',
  promo: {},
};
const stored = loadSettings();
let s = { ...defaults, currency: stored.currency ?? defaults.currency, basis: stored.basis ?? defaults.basis, ...(stored.setPage ?? {}) };
const persist = () => {
  const { currency, basis, ...setPage } = s;
  saveSettings({ currency, basis, setPage });
};

const form = $('form');
for (const p of Object.values(PROVIDERS)) form.provider.append(el('option', { value: p.id }, p.label));
for (const r of detail.rows) {
  form.querySelector('#promos').append(el('label', {}, `${TYPE_LABEL[r.productType]} `, el('input', { type: 'number', step: '0.5', min: '0', name: `promo:${r.productType}` })));
}
function fillForm() {
  for (const input of form.elements) {
    if (!input.name) continue;
    const [key, sub] = input.name.split(':');
    const v = sub ? s.promo[sub] ?? detail.promoValue[sub] ?? 0 : s[key];
    if (input.type === 'checkbox') input.checked = Boolean(v);
    else input.value = input.dataset.scale ? +(v * Number(input.dataset.scale)).toFixed(4) : v;
  }
  $('gemRateOut').textContent = pct(s.gemRate, 0);
  $('gradingCostOut').textContent = `$${s.gradingCost}`;
}
let timer = null;
form.addEventListener('input', (e) => {
  const input = e.target;
  if (!input.name) return;
  const [key, sub] = input.name.split(':');
  let v = input.type === 'checkbox' ? input.checked : input.type === 'number' || input.type === 'range' ? Number(input.value) : input.value;
  if (input.dataset.scale) v /= Number(input.dataset.scale);
  if (sub) s.promo = { ...s.promo, [sub]: v };
  else s[key] = v;
  persist();
  $('gemRateOut').textContent = pct(s.gemRate, 0);
  $('gradingCostOut').textContent = `$${s.gradingCost}`;
  clearTimeout(timer);
  timer = setTimeout(computeAndRender, 250);
});
fillForm();

// ---- header ----------------------------------------------------------------
function renderHead() {
  const pd = detail.pullData;
  const lines = [
    el('h1', {}, detail.setName),
    el('p', {}, `${index.meta.eras[detail.era]?.name ?? detail.era} · released ${detail.releaseDate}${detail.presale ? ' (presale)' : ''} · ${detail.cards.length} cards`),
    el(
      'p',
      { class: pd.status === 'measured' && !pd.estimatedTiers.length ? null : 'warn' },
      `Pull data: ${pullLabel(pd)}`,
      pd.source ? [' · ', el('a', { href: pd.source }, `${pd.publisher ?? 'source'}, ${pd.date}`)] : '',
      pd.basis ? ` · ${pd.basis}` : '',
    ),
  ];
  if (pd.unknownTiers.length) lines.push(el('p', { class: 'warn' }, `Odds unknown (excluded from EV): ${pd.unknownTiers.join(', ')}`));
  for (const issue of detail.issues) lines.push(el('p', { class: 'warn' }, issue));
  if (detail.pullRates && detail.pack) {
    lines.push(
      el(
        'p',
        { class: 'muted' },
        'Per-pack odds: ',
        Object.entries(detail.pullRates)
          .map(([t, r]) => `${t} ${r.odds == null ? 'unknown' : odds(r.odds)}${r.estimated ? ' (est.)' : ''}`)
          .join(' · '),
      ),
    );
  }
  $('head').replaceChildren(...lines);
}

// ---- graded quotes -----------------------------------------------------------
const quotes = {};
async function loadCachedQuotes() {
  if (!detail.pack) return;
  for (const t of topHitCards(detail.pack, detail.cards, s.topN)) {
    const c = detail.cards[t.card];
    const hit = await getCached(s.provider, c.productId, assumptions.graded.cacheTtlDays);
    if (hit) quotes[c.productId] = hit;
  }
}

$('fetchGraded').onclick = async () => {
  const provider = PROVIDERS[s.provider];
  const status = $('gradedStatus');
  if (!detail.pack) return void (status.textContent = 'This set has no pull data, so there are no hit cards to grade.');
  if (!s.apiKey) return void (status.textContent = `Enter your ${provider.label} API key first (${provider.keyHelp}).`);
  const top = topHitCards(detail.pack, detail.cards, s.topN);
  const baseUrl = s.baseUrl || provider.defaultBaseUrl;
  let fetched = 0;
  for (const [i, t] of top.entries()) {
    const c = detail.cards[t.card];
    if (await getCached(provider.id, c.productId, assumptions.graded.cacheTtlDays)) continue;
    status.textContent = `Fetching ${i + 1}/${top.length}: ${c.name}…`;
    try {
      const q = await provider.fetchQuote(c, { apiKey: s.apiKey, baseUrl });
      if (q) {
        quotes[c.productId] = q;
        await putCached(provider.id, c.productId, q);
      }
      fetched += 1;
    } catch (err) {
      status.textContent =
        err instanceof TypeError
          ? `Request blocked (${err.message}). The API rejects browser CORS preflights; deploy the Worker in /worker and set its URL as API base URL.`
          : `Stopped at ${c.name}: ${err.message}`;
      computeAndRender();
      return;
    }
    await new Promise((r) => setTimeout(r, 1100)); // stay under 60 calls/minute
  }
  status.textContent = `Done: ${fetched} fetched, ${top.length - fetched} from cache (kept ${assumptions.graded.cacheTtlDays} days).`;
  computeAndRender();
};
$('clearGraded').onclick = async () => {
  await clearCache();
  for (const k of Object.keys(quotes)) delete quotes[k];
  $('gradedStatus').textContent = 'Graded cache cleared.';
  computeAndRender();
};

// ---- compute + render ----------------------------------------------------------
const tableState = { products: { sortKey: 'roiMarket', sortDir: 'desc' }, cards: { sortKey: 'ev', sortDir: 'desc' }, graded: { sortKey: 'raw', sortDir: 'desc' }, listings: { sortKey: 'type', sortDir: 'asc' } };
let lastPack = null;

function computeAndRender() {
  const pricing = { bulkThreshold: s.bulkThreshold, bulkRatePerCard: s.bulkRatePerCard, bulkRateByGroup: s.bulkRateByGroup, sellFeePct: s.sellFeePct, perCardShipping: s.perCardShipping, netFloorAtBulkRate: s.netFloorAtBulkRate };
  const overrides = detail.pack && s.useGraded ? gradedOverrides(detail.pack, detail.cards, quotes, s) : null;
  const pack = detail.pack ? packEV(detail.pack, detail.cards, pricing, overrides) : null;
  lastPack = pack;
  const sampler = detail.pack ? createSampler(detail.pack, detail.cards, pricing, overrides) : null;

  const productRows = detail.rows.map((r) => {
    const promo = s.promo[r.productType] ?? detail.promoValue[r.productType] ?? 0;
    // r.ev is null when the build withheld this product's EV (e.g. its pack count isn't on the listing).
    if (!pack || !r.ev) return { r, ev: null, sim: null, chase: null };
    const ev = productEV(pack, r.packs, promo, pricing);
    const sim = simulateProduct(sampler, {
      packs: r.packs,
      sims: Math.max(1000, Math.min(200000, s.sims || 20000)),
      seed: hashSeed(assumptions.simulation.seed, detail.groupId, r.productType),
      costs: [r.marketPrice, r.msrp.usd, r.msrp.cad != null ? r.msrp.cad / fx.usdCad : null],
      promoValue: promo,
      pricing,
      chaseTiers: detail.chaseTiers,
    });
    return { r, ev, sim, chase: chaseOdds(detail.pack, detail.chaseTiers, r.packs) };
  });
  renderProducts(productRows);
  renderCards(pack);
  renderGraded(overrides);
  $('productsNote').textContent =
    `EV basis: ${s.basis}${s.useGraded ? ' · GRADED EV ON for top hits with PSA 10 + PSA 9 prices (assumption-driven)' : ' · raw ungraded NM'}` +
    (detail.pack && detail.chaseTiers.length ? ` · chase = at least one of: ${detail.chaseTiers.join(', ')} (tiers with known odds only)` : '');
}

function renderProducts(rows) {
  const cur = s.currency;
  const b = s.basis;
  const msrpOf = (r) => (cur === 'CAD' ? r.msrp.cad : r.msrp.usd);
  const roiMsrp = (x) => (x.ev ? (cur === 'CAD' ? roi(x.ev[b] * fx.usdCad, x.r.msrp.cad) : roi(x.ev[b], x.r.msrp.usd)) : null);
  const pProfitMsrp = (x) => (x.sim ? (cur === 'CAD' ? x.sim[b].pAtLeast[2] : x.sim[b].pAtLeast[1]) : null);
  // MSRP columns only when the data has an MSRP for this currency (verified list prices only).
  const hasMsrp = rows.some((x) => msrpOf(x.r) != null);
  const msrpKeys = new Set(['msrp', 'roiMsrp', 'pMsrp']);
  renderTable(
    $('products'),
    [
      { key: 'type', label: 'Product', value: (x) => x.r.productType, render: (x) => el('a', { href: productUrl(x.r.productId) }, `${TYPE_LABEL[x.r.productType]} (${x.r.packs} pack${x.r.packs === 1 ? '' : 's'})`) },
      { key: 'price', label: 'Price', numeric: true, value: (x) => x.r.marketPrice, render: (x) => money(x.r.marketPrice, cur, fx.usdCad) },
      { key: 'msrp', label: 'MSRP', numeric: true, value: (x) => msrpOf(x.r), render: (x) => moneyIn(msrpOf(x.r), cur) },
      { key: 'ev', label: 'EV', numeric: true, value: (x) => x.ev?.[b] ?? null, render: (x) => money(x.ev?.[b], cur, fx.usdCad) },
      { key: 'roiMarket', label: 'ROI@market', numeric: true, value: (x) => (x.ev ? roi(x.ev[b], x.r.marketPrice) : null), render: (x) => pct(x.ev ? roi(x.ev[b], x.r.marketPrice) : null) },
      { key: 'roiMsrp', label: 'ROI@MSRP', numeric: true, value: roiMsrp, render: (x) => pct(roiMsrp(x)) },
      { key: 'pMarket', label: 'P(profit) @market', numeric: true, value: (x) => x.sim?.[b].pAtLeast[0] ?? null, render: (x) => pct(x.sim?.[b].pAtLeast[0] ?? null) },
      { key: 'pMsrp', label: 'P(profit) @MSRP', numeric: true, value: pProfitMsrp, render: (x) => pct(pProfitMsrp(x)) },
      { key: 'median', label: 'Median opened', numeric: true, value: (x) => x.sim?.[b].median ?? null, render: (x) => money(x.sim?.[b].median, cur, fx.usdCad) },
      { key: 'p5', label: 'P5', numeric: true, value: (x) => x.sim?.[b].p5 ?? null, render: (x) => money(x.sim?.[b].p5, cur, fx.usdCad) },
      { key: 'p95', label: 'P95', numeric: true, value: (x) => x.sim?.[b].p95 ?? null, render: (x) => money(x.sim?.[b].p95, cur, fx.usdCad) },
      { key: 'chase', label: 'Chase odds', numeric: true, value: (x) => x.chase?.p ?? null, render: (x) => pct(x.chase?.p ?? null) },
    ].filter((c) => hasMsrp || !msrpKeys.has(c.key)),
    rows,
    tableState.products,
    (st) => {
      Object.assign(tableState.products, st);
      renderProducts(rows);
    },
  );
}

function renderCards(pack) {
  const b = s.basis;
  const total = pack ? pack[b] : 0;
  const rows = pack
    ? pack.entries.map((e) => ({ card: detail.cards[e.card], variant: e.variant, group: e.group, p: e.copiesPerPack, price: e.price, ev: e[b] }))
    : [];
  const inModel = new Set(rows.map((r) => r.card.productId));
  for (const c of detail.cards) {
    if (!inModel.has(c.productId)) rows.push({ card: c, variant: null, group: c.tier ? 'odds unknown' : 'unmapped rarity', p: null, price: Math.max(...Object.values(c.prices).filter((v) => v != null), -Infinity), ev: null });
  }
  const q = $('cardFilter').value.trim().toLowerCase();
  const shown = q ? rows.filter((r) => `${r.card.name} ${r.card.tier} ${r.card.rarity}`.toLowerCase().includes(q)) : rows;
  renderTable(
    $('cards'),
    [
      { key: 'name', label: 'Card', value: (r) => r.card.name, render: (r) => el('a', { href: productUrl(r.card.productId) }, r.card.name) },
      { key: 'number', label: 'No.', value: (r) => r.card.number },
      { key: 'rarity', label: 'Rarity', value: (r) => r.card.rarity },
      { key: 'tier', label: 'Tier / pool', value: (r) => r.group, render: (r) => r.group.replace(/^(tier|pool):/, '') },
      { key: 'variant', label: 'Printing', value: (r) => r.variant ?? '' },
      { key: 'price', label: 'Price', numeric: true, value: (r) => (Number.isFinite(r.price) ? r.price : null), render: (r) => money(Number.isFinite(r.price) ? r.price : null, s.currency, fx.usdCad) },
      { key: 'p', label: 'p_card (per pack)', numeric: true, title: 'Expected copies per pack; equals the probability for hit cards', value: (r) => r.p, render: (r) => odds(r.p) },
      { key: 'ev', label: 'EV contribution', numeric: true, value: (r) => r.ev, render: (r) => money(r.ev, s.currency, fx.usdCad) },
      { key: 'share', label: '% of pack EV', numeric: true, value: (r) => (r.ev != null && total ? r.ev / total : null), render: (r) => pct(r.ev != null && total ? r.ev / total : null, 2) },
    ],
    shown,
    tableState.cards,
    (st) => {
      Object.assign(tableState.cards, st);
      renderCards(pack);
    },
  );
}
$('cardFilter').addEventListener('input', () => renderCards(lastPack));

function renderGraded(overrides) {
  if (!detail.pack) return;
  const top = topHitCards(detail.pack, detail.cards, s.topN);
  if (!top.some((t) => quotes[detail.cards[t.card].productId])) return;
  const rows = top.map((t) => {
    const c = detail.cards[t.card];
    const qt = quotes[c.productId] ?? {};
    return { c, tier: t.tier, raw: t.price, ...qt, graded: gradedValue(qt, s), used: overrides?.has(`${c.productId}:${t.variant}`) };
  });
  const g = (k) => ({ key: k.key, label: k.label, numeric: true, value: (r) => r[k.key] ?? null, render: (r) => money(r[k.key] ?? null, s.currency, fx.usdCad) });
  renderTable(
    $('graded'),
    [
      { key: 'name', label: 'Card', value: (r) => r.c.name, render: (r) => el('a', { href: productUrl(r.c.productId) }, r.c.name) },
      { key: 'tier', label: 'Tier', value: (r) => r.tier },
      g({ key: 'raw', label: 'Raw NM' }),
      g({ key: 'psa10', label: 'PSA 10' }),
      g({ key: 'psa9', label: 'PSA 9' }),
      g({ key: 'cgc10', label: 'CGC 10' }),
      g({ key: 'bgs95', label: 'BGS 9.5' }),
      { key: 'graded', label: 'Graded value*', numeric: true, title: 'gemRate × PSA10 + (1 − gemRate) × PSA9 − gradingCost', value: (r) => r.graded, render: (r) => [money(r.graded, s.currency, fx.usdCad), r.used ? ' ✓' : ''] },
    ],
    rows,
    tableState.graded,
    (st) => {
      Object.assign(tableState.graded, st);
      renderGraded(overrides);
    },
  );
  $('graded').append(el('p', { class: 'muted' }, `* Uses your gem rate (${pct(s.gemRate, 0)}) and grading cost ($${s.gradingCost}) assumptions. ✓ = used in EV when "Use graded EV" is on.`));
}

function renderListings() {
  renderTable(
    $('listings'),
    [
      { key: 'name', label: 'Listing', value: (p) => p.name, render: (p) => el('a', { href: productUrl(p.productId) }, p.name) },
      { key: 'type', label: 'Type', value: (p) => `${p.type}${p.variant ? ` (${p.variant})` : ''}${p.kind ? ` · ${p.kind}` : ''}` },
      { key: 'canonical', label: 'Ranked', value: (p) => (p.canonical ? 'yes' : '') },
      { key: 'packs', label: 'Packs (config / listing)', numeric: true, value: (p) => p.packs, render: (p) => (p.packs == null ? DASH : `${p.packs} / ${p.statedPacks ?? '?'}`) },
      { key: 'price', label: 'Price', numeric: true, value: (p) => p.marketPrice, render: (p) => money(p.marketPrice, s.currency, fx.usdCad) },
    ],
    detail.products,
    tableState.listings,
    (st) => {
      Object.assign(tableState.listings, st);
      renderListings();
    },
  );
}

renderHead();
renderListings();
await loadCachedQuotes();
computeAndRender();
