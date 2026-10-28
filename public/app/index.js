// Ranking table, rendered entirely from data/index.json.

import { loadSettings, saveSettings } from './settings.js';
import { renderTable } from './table.js';
import { el, money, moneyIn, pct, pullLabel, TYPE_LABEL, DASH } from './format.js';

const $ = (id) => document.getElementById(id);
const res = await fetch('data/index.json');
const index = await res.json();
const { fx, eras, productTypes } = index.meta;

let s = { currency: 'USD', basis: 'gross', era: '', types: productTypes, hideNoData: false, sortKey: 'roiMarket', sortDir: 'desc', ...loadSettings() };

for (const t of productTypes) {
  $('types').append(el('label', {}, el('input', { type: 'checkbox', value: t, checked: s.types.includes(t), onchange: onTypes }), ` ${TYPE_LABEL[t]}`));
}
for (const [id, e] of Object.entries(eras)) $('era').append(el('option', { value: id }, e.name));
$('era').value = s.era;
$('currency').value = s.currency;
$('basis').value = s.basis;
$('hideNoData').checked = s.hideNoData;
$('era').onchange = (e) => update({ era: e.target.value });
$('currency').onchange = (e) => update({ currency: e.target.value });
$('basis').onchange = (e) => update({ basis: e.target.value });
$('hideNoData').onchange = (e) => update({ hideNoData: e.target.checked });

function onTypes() {
  update({ types: [...$('types').querySelectorAll('input:checked')].map((i) => i.value) });
}

function update(patch) {
  s = saveSettings({ ...s, ...patch });
  render();
}

const cad = () => s.currency === 'CAD';
const evOf = (r) => r.ev?.[s.basis] ?? null;
// ROI columns follow the EV basis; the build stores gross ROI, net is recomputed from EV.
const roiMarket = (r) => (r.ev && r.marketPrice ? evOf(r) / r.marketPrice : null);
const roiMsrp = (r) => {
  if (!r.ev) return null;
  if (cad()) return r.msrp.cad ? (evOf(r) * fx.usdCad) / r.msrp.cad : null;
  return r.msrp.usd ? evOf(r) / r.msrp.usd : null;
};
const sim = (r) => r.sim?.[s.basis] ?? null;

const columns = [
  { key: 'set', label: 'Set', value: (r) => r.setName, render: (r) => el('a', { href: `set.html?id=${r.groupId}` }, r.setName, r.presale ? ' (presale)' : '') },
  { key: 'product', label: 'Product', value: (r) => TYPE_LABEL[r.productType], render: (r) => `${TYPE_LABEL[r.productType]} (${r.packs})` },
  { key: 'price', label: 'Price', numeric: true, value: (r) => r.marketPrice, render: (r) => money(r.marketPrice, s.currency, fx.usdCad) },
  {
    key: 'msrp',
    label: 'MSRP',
    numeric: true,
    value: (r) => (cad() ? r.msrp.cad : r.msrp.usd),
    render: (r) => {
      const v = cad() ? r.msrp.cad : r.msrp.usd;
      const conf = cad() ? r.msrp.cadConfidence : r.msrp.usdConfidence;
      return el('span', { title: conf ? `confidence: ${conf}` : null }, moneyIn(v, s.currency), conf === 'estimated' || conf === 'derived' ? '*' : '');
    },
  },
  { key: 'ev', label: 'EV', numeric: true, value: evOf, render: (r) => money(evOf(r), s.currency, fx.usdCad) },
  { key: 'roiMarket', label: 'ROI@market', numeric: true, value: roiMarket, render: (r) => pct(roiMarket(r)) },
  { key: 'roiMsrp', label: 'ROI@MSRP', numeric: true, value: roiMsrp, render: (r) => pct(roiMsrp(r)) },
  {
    key: 'profit',
    label: 'Profit chance',
    numeric: true,
    title: 'P(opened value ≥ market price), Monte Carlo',
    value: (r) => sim(r)?.pProfitMarket ?? null,
    render: (r) => pct(sim(r)?.pProfitMarket ?? null),
  },
  {
    key: 'top',
    label: 'Top hit',
    value: (r) => r.topHit?.price ?? null,
    render: (r) => (r.topHit ? `${r.topHit.name} (${money(r.topHit.price, s.currency, fx.usdCad)})` : DASH),
  },
  {
    key: 'sample',
    label: 'Pull data',
    numeric: true,
    value: (r) => r.pullData.packsOpened ?? (r.pullData.status === 'estimated' ? 0 : null),
    render: (r) => el('span', { class: r.pullData.status !== 'measured' || r.pullData.estimatedTiers.length ? 'warn' : null, title: r.pullData.basis ?? r.pullData.source ?? '' }, pullLabel(r.pullData)),
  },
];

// MSRP columns appear only when the data has an MSRP for the chosen currency
// (data/msrp.json holds verified list prices only, and may hold none).
const MSRP_KEYS = new Set(['msrp', 'roiMsrp']);
const hasMsrp = () => index.rows.some((r) => (cad() ? r.msrp.cad : r.msrp.usd) != null);

function render() {
  const rows = index.rows.filter((r) => s.types.includes(r.productType) && (!s.era || r.era === s.era) && (!s.hideNoData || r.ev));
  const shown = hasMsrp() ? columns : columns.filter((c) => !MSRP_KEYS.has(c.key));
  renderTable($('table'), shown, rows, s, (sort) => update(sort));
  $('meta').textContent =
    `${rows.length} products · prices from TCGplayer via tcgcsv (${index.meta.tcgcsvLastUpdated}) · ` +
    `CAD converts USD market prices at ${fx.usdCad} (${fx.source}${fx.date ? `, ${fx.date}` : ''})` +
    (hasMsrp() ? ' · * MSRP estimated or derived' : '') +
    '.';
}

render();
