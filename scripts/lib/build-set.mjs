// Turns one set's raw tcgcsv products + prices into its SetDetail file and
// index rows, and collects that set's build-report findings.

import { isCard, extField, classifySealed, mapTier, cardNumber, variantKey, parsePackCount } from '../../src/classify.js';
import { buildPackModel } from '../../src/pack.js';
import { packEV, productEV, roi, chaseOdds, createSampler, simulateProduct, topHitCards } from '../../src/ev.js';
import { hashSeed } from '../../src/rng.js';
import { CONTRACT_VERSION } from '../../src/contract.js';

const round = (x, d = 4) => (x == null || !Number.isFinite(x) ? x : Math.round(x * 10 ** d) / 10 ** d);
const sig = (x, s = 8) => (x == null || x === 0 || !Number.isFinite(x) ? x : Number(x.toPrecision(s)));

/**
 * @param {object} input
 * @param {{ group: any, era: string, releaseDate: string, presale: boolean, subsets: Array<{ group: any, role: string }> }} input.set
 * @param {Array<{ groupId: number, role: string|null, products: any[], prices: any[] }>} input.sources  parent first, then subsets
 * @param {object} ctx  { assumptions, productConfig, msrp, pullrates, setsCfg, tierRules, fx }
 */
export function buildSet({ set, sources }, ctx) {
  const { assumptions, productConfig, msrp, pullrates, setsCfg, tierRules, fx } = ctx;
  const { group, era } = set;
  const groupId = group.groupId;
  const pricing = assumptions.pricing;
  const findings = {
    unmapped: new Map(),
    unclassified: [],
    packCountMismatches: [],
    tierCountMismatches: [],
    modelIssues: [],
    unknownOddsTiers: [],
    excludedCards: 0,
    cardsTotal: 0,
    cardsPriced: 0,
    priceFallbacks: 0,
  };

  // ---- prices: productId -> variant -> price -------------------------------
  const priceRows = new Map();
  for (const src of sources) {
    for (const row of src.prices) {
      if (!priceRows.has(row.productId)) priceRows.set(row.productId, new Map());
      priceRows.get(row.productId).set(variantKey(row.subTypeName), row);
    }
  }
  const resolve = (row) => {
    if (row.marketPrice != null) return { price: row.marketPrice, fallback: false };
    const fb = pricing.priceFallback === 'low' ? row.lowPrice : pricing.priceFallback === 'mid' ? row.midPrice : null;
    return fb != null ? { price: fb, fallback: true } : { price: null, fallback: false };
  };

  // ---- pull-rate entry ----------------------------------------------------
  const entry = pullrates.sets[String(groupId)] ?? null;
  const tiers = entry?.tiers ?? null;
  const layoutId = entry?.layout ?? setsCfg.eras[era].layout;
  const layout = { id: layoutId, ...productConfig.layouts[layoutId] };

  // ---- cards ---------------------------------------------------------------
  const cards = [];
  const sealed = [];
  for (const src of sources) {
    for (const p of src.products) {
      if (!isCard(p)) {
        if (src.role) continue; // subset groups contribute cards only
        sealed.push(p);
        continue;
      }
      const rarity = extField(p, 'Rarity');
      const card = {
        productId: p.productId,
        name: p.name,
        number: extField(p, 'Number'),
        rarity,
        tier: null,
        subset: src.role,
        sourceGroupId: src.groupId,
        cardType: extField(p, 'Card Type'),
        prices: {},
      };
      card.tier = mapTier({ name: p.name, rarity, groupId: src.groupId, cardType: card.cardType, subset: src.role }, era, tierRules);
      if (card.tier && tierRules.excluded.has(card.tier)) {
        findings.excludedCards += 1;
        continue;
      }
      for (const a of entry?.tierAssignments ?? []) {
        const n = cardNumber(card.number);
        if (card.tier === a.fromTier && (a.subset ?? null) === card.subset && n >= a.numberFrom && n <= a.numberTo) card.tier = a.tier;
      }
      if (card.tier && entry?.tierAliases?.[card.tier]) card.tier = entry.tierAliases[card.tier];
      if (!card.tier) {
        const k = rarity;
        if (!findings.unmapped.has(k)) findings.unmapped.set(k, { rarity: k, count: 0, examples: [] });
        const u = findings.unmapped.get(k);
        u.count += 1;
        if (u.examples.length < 3) u.examples.push(`${p.name} (${card.number})`);
      }
      const fallbacks = [];
      for (const [variant, row] of priceRows.get(p.productId) ?? []) {
        const { price, fallback } = resolve(row);
        card.prices[variant] = price;
        if (fallback) fallbacks.push(variant);
      }
      if (fallbacks.length) {
        card.priceFallback = fallbacks;
        findings.priceFallbacks += 1;
      }
      findings.cardsTotal += 1;
      if (Object.values(card.prices).some((v) => v != null)) findings.cardsPriced += 1;
      cards.push(card);
    }
  }

  // ---- sealed products -----------------------------------------------------
  const ranked = new Set(productConfig.rankedTypes);
  const products = [];
  for (const p of sealed) {
    const c = classifySealed(p.name);
    if (!c) {
      findings.unclassified.push({ productId: p.productId, name: p.name });
      continue;
    }
    const rows = priceRows.get(p.productId);
    const row = rows?.get('normal') ?? (rows ? [...rows.values()][0] : null);
    const isRanked = ranked.has(c.type);
    products.push({
      productId: p.productId,
      name: p.name,
      type: c.type,
      variant: c.variant,
      kind: c.kind ?? null,
      canonical: false,
      marketPrice: row ? resolve(row).price : null,
      packs: isRanked ? packsFor(productConfig, groupId, era, c.type) : null,
      statedPacks: isRanked ? parsePackCount(extField(p, 'CardText')) : null,
    });
  }
  const variantRank = (v) => (v == null ? 0 : ['sleeved', 'lgs', 'retail', 'plus'].includes(v) ? 1 : 2);
  const canonical = new Map();
  for (const type of productConfig.rankedTypes) {
    const pick = products
      .filter((p) => p.type === type)
      .sort((a, b) => variantRank(a.variant) - variantRank(b.variant) || (a.marketPrice ?? Infinity) - (b.marketPrice ?? Infinity) || a.productId - b.productId)[0];
    if (!pick) continue;
    pick.canonical = true;
    canonical.set(type, pick);
  }
  for (const p of products) {
    if (ranked.has(p.type) && p.statedPacks != null && p.statedPacks !== p.packs) {
      findings.packCountMismatches.push({ productId: p.productId, name: p.name, configured: p.packs, stated: p.statedPacks, canonical: p.canonical });
    }
  }

  // ---- pack model + EV ------------------------------------------------------
  let model = null;
  let issues = [];
  let withheld = null;
  // A presale set may have sealed listings before TCGplayer lists its cards;
  // with no cards there is nothing to value, so EV stays null (not $0).
  const noCardList = tiers && cards.length === 0;
  if (noCardList) issues.push('TCGplayer lists no cards for this set yet (presale?); EV is unavailable until it does');
  if (tiers && !noCardList) {
    const built = buildPackModel({
      cards,
      tiers,
      layout,
      pools: productConfig.pools,
      hitVariants: productConfig.hitVariants,
      tierSlots: entry?.tierSlots ?? {},
      cardOverrides: entry?.cardOverrides ?? {},
    });
    model = built.model;
    issues = built.issues;
    for (const u of built.unrated) findings.unknownOddsTiers.push(u);
    for (const [tier, t] of Object.entries(tiers)) {
      if (t?.expectedCards == null) continue;
      const actual = cards.filter((c) => c.tier === tier).length;
      if (actual !== t.expectedCards) findings.tierCountMismatches.push({ tier, expected: t.expectedCards, actual });
    }

    // Trust gate: EV is published only if every tier with cards has measured
    // (not estimated) odds and every hit card has a TCGplayer market price.
    const estimated = Object.entries(tiers).filter(([, t]) => t?.estimated).map(([k]) => k);
    const unpriced = model.groups.filter((g) => g.kind === 'tier').flatMap((g) => g.entries.filter((e) => cards[e.card].prices[e.variant] == null).map(() => g.id));
    const reasons = [
      built.unrated.length ? `no measured odds for ${built.unrated.map((u) => `${u.tier} (${u.cards} cards)`).join(', ')}` : null,
      estimated.length ? `estimated odds for ${estimated.join(', ')}` : null,
      unpriced.length ? `${unpriced.length} hit card(s) without a TCGplayer market price (${[...new Set(unpriced)].join(', ')})` : null,
    ].filter(Boolean);
    if (reasons.length) {
      withheld = `EV withheld: ${reasons.join('; ')}.`;
      issues.push(withheld);
      model = null;
    }
  }
  findings.modelIssues = issues;

  const pullData = {
    status: model ? 'measured' : 'none',
    packsOpened: model ? entry.source?.packsOpened ?? null : null,
    source: model ? entry.source?.url ?? null : null,
    publisher: model ? entry.source?.publisher ?? null : null,
    date: model ? entry.source?.date ?? null : null,
    basis: noCardList
      ? 'No card list on TCGplayer yet.'
      : (withheld ?? (pullrates.excluded?.[String(groupId)] ? `No EV: ${pullrates.excluded[String(groupId)].reason}` : null)),
    estimatedTiers: [],
    unknownTiers: findings.unknownOddsTiers.map((u) => u.tier),
  };

  const pack = model ? packEV(model, cards, pricing) : null;
  const chaseTiers = assumptions.chase[layoutId] ?? [];
  const sampler = model ? createSampler(model, cards, pricing) : null;
  const top = model ? topHitCards(model, cards, 1)[0] : null;
  const topHit = top
    ? { name: cards[top.card].name, tier: top.tier, price: top.price, productId: cards[top.card].productId }
    : maxPricedCard(cards);

  const rows = [];
  const promoValue = {};
  for (const [type, prod] of canonical) {
    const promo = productConfig.promoValue.setOverrides?.[groupId]?.[type] ?? productConfig.promoValue.defaults[type] ?? 0;
    promoValue[type] = promo;
    const m = msrpFor(msrp, groupId, era, type);
    let ev = null;
    let sim = null;
    let chase = null;
    // A product's pack count must be stated on its TCGplayer listing (a single pack is one by definition).
    const packsVerified = type === 'pack' || prod.statedPacks === prod.packs;
    if (pack && !packsVerified) issues.push(`${prod.name}: EV withheld, the TCGplayer listing does not state how many packs it contains.`);
    if (pack && packsVerified) {
      ev = productEV(pack, prod.packs, promo, pricing);
      const costs = [prod.marketPrice, m.usd, m.cad != null ? m.cad / fx.usdCad : null];
      const r = simulateProduct(sampler, {
        packs: prod.packs,
        sims: assumptions.simulation.sims,
        seed: hashSeed(assumptions.simulation.seed, groupId, type),
        costs,
        promoValue: promo,
        pricing,
        chaseTiers,
      });
      const shape = (s) => ({
        mean: round(s.mean),
        median: round(s.median),
        p5: round(s.p5),
        p95: round(s.p95),
        pProfitMarket: round(s.pAtLeast[0], 5),
        pProfitMsrp: round(s.pAtLeast[1], 5),
        pProfitMsrpCad: round(s.pAtLeast[2], 5),
      });
      sim = { sims: r.sims, gross: shape(r.gross), net: shape(r.net) };
      const c = chaseOdds(model, chaseTiers, prod.packs);
      chase = c ? { tiers: c.tiers, p: round(c.p, 6) } : null;
    }
    rows.push({
      groupId,
      setName: group.name.trim(),
      setCode: group.abbreviation ?? '',
      era,
      releaseDate: set.releaseDate,
      presale: set.presale,
      productType: type,
      productId: prod.productId,
      productName: prod.name,
      packs: prod.packs,
      marketPrice: prod.marketPrice,
      msrp: m,
      ev: ev ? { gross: round(ev.gross), net: round(ev.net) } : null,
      evPerPack: pack ? { gross: round(pack.gross), net: round(pack.net) } : null,
      roi: ev
        ? {
            market: round(roi(ev.gross, prod.marketPrice), 5),
            msrp: round(roi(ev.gross, m.usd), 5),
            msrpCad: round(roi(ev.gross * fx.usdCad, m.cad), 5),
          }
        : null,
      sim,
      chase,
      topHit,
      pullData,
    });
  }

  const detail = {
    contractVersion: CONTRACT_VERSION,
    groupId,
    setName: group.name.trim(),
    setCode: group.abbreviation ?? '',
    era,
    releaseDate: set.releaseDate,
    presale: set.presale,
    subsetGroupIds: set.subsets.map((s) => s.group.groupId),
    pullData,
    pullRates: model ? slimTiers(tiers, model) : null,
    pack: model ? slimModel(model) : null,
    cards,
    products: products.sort((a, b) => Number(b.canonical) - Number(a.canonical) || a.type.localeCompare(b.type) || a.name.localeCompare(b.name)),
    rows,
    promoValue,
    chaseTiers,
    issues,
  };
  return { detail, rows, findings };
}

function packsFor(cfg, groupId, era, type) {
  return cfg.packs.setOverrides?.[groupId]?.[type] ?? cfg.packs.eraOverrides?.[era]?.[type] ?? cfg.packs.defaults[type];
}

function msrpFor(msrp, groupId, era, type) {
  const pickCur = (cur) => {
    for (const layer of [msrp.sets?.[groupId]?.[type], msrp.eras?.[era]?.[type], msrp.defaults?.[type]]) {
      if (layer && Object.hasOwn(layer, cur)) return layer[cur];
    }
    return null;
  };
  const usd = pickCur('USD');
  const cad = pickCur('CAD');
  return { usd: usd?.value ?? null, cad: cad?.value ?? null, usdConfidence: usd?.confidence ?? null, cadConfidence: cad?.confidence ?? null };
}

function maxPricedCard(cards) {
  let best = null;
  for (const c of cards) {
    for (const v of Object.values(c.prices)) {
      if (v != null && (!best || v > best.price)) best = { name: c.name, tier: c.tier, price: v, productId: c.productId };
    }
  }
  return best;
}

function slimTiers(tiers, model) {
  const slotOf = new Map();
  for (const s of model?.slots ?? []) for (const h of s.hits) slotOf.set(h.tier, s.id);
  const out = {};
  for (const [k, t] of Object.entries(tiers)) {
    out[k] = { odds: t.odds ?? null, slot: slotOf.get(k) ?? null };
    for (const f of ['ci95', 'estimated', 'expectedCards', 'basis', 'note']) if (t[f] != null) out[k][f] = t[f];
  }
  return out;
}

function slimModel(model) {
  return {
    layoutId: model.layoutId,
    cardsPerPack: model.cardsPerPack,
    slots: model.slots.map((s) => ({ id: s.id, count: s.count, pool: s.pool, fillerP: sig(s.fillerP), hits: s.hits.map((h) => ({ tier: h.tier, p: sig(h.p) })) })),
    groups: model.groups.map((g) => ({ ...g, rate: sig(g.rate), entries: g.entries.map((e) => ({ card: e.card, variant: e.variant, w: sig(e.w) })) })),
  };
}

