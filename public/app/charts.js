// Charts page. Reads the same published JSON/CSV as the rankings (nothing new
// is stored), shapes it with chart-data.js, and draws with Observable Plot.
// One filter row scopes every chart; each chart has a table-view twin, so if
// the chart library can't load, the tables still carry every number.
// All values are gross EV (market value of the cards), like the rankings default.

import { packEV } from '../src/ev.js';
import { loadSettings, saveSettings } from './settings.js';
import { renderTable } from './table.js';
import { el, moneyIn, pct, TYPE_LABEL } from './format.js';
import { parseHistory, medianByDate, evComposition, FAMILIES, evPerPackSeries, breakGaps } from './chart-data.js';

let Plot = null;
try {
  Plot = await import('https://cdn.jsdelivr.net/npm/@observablehq/plot@0.6.17/+esm');
} catch {
  // Offline or CDN blocked: every figure falls back to its table view.
}

const $ = (id) => document.getElementById(id);
const okJson = (r) => {
  if (!r.ok) throw new Error(`${r.url}: HTTP ${r.status}`);
  return r.json();
};
const [index, historyCsv] = await Promise.all([fetch('data/index.json').then(okJson), fetch('data/history/sealed.csv').then((r) => (r.ok ? r.text() : ''))]);
const { fx, eras, productTypes, assumptions } = index.meta;
const setsById = new Map(index.rows.map((r) => [r.groupId, { setName: r.setName, era: r.era, releaseDate: r.releaseDate }]));
const history = parseHistory(historyCsv);
const buildDates = [...new Set(history.map((h) => h.date))].sort();
const evSeries = evPerPackSeries(history, setsById);
// Lines break across stretches with no builds.
const MAX_GAP_DAYS = 21;

// ---- filters (one row, scopes everything; saved separately from the rankings page) ----
const FILTERS = ['type', 'era', 'focus', 'currency'];
const stored = loadSettings();
let s = { type: 'pack', era: '', focus: '', currency: stored.currency ?? 'USD', ...(stored.charts ?? {}) };
for (const t of productTypes) $('type').append(el('option', { value: t }, TYPE_LABEL[t]));
for (const [id, e] of Object.entries(eras)) $('era').append(el('option', { value: id }, e.name));
for (const key of FILTERS) {
  $(key).onchange = (e) => {
    s = { ...s, [key]: e.target.value };
    saveSettings({ charts: s });
    renderAll();
  };
}

const inEra = (era) => !s.era || era === s.era;
const rowsNow = () => index.rows.filter((r) => r.productType === s.type && inEra(r.era));
const conv = (usd) => (usd == null ? null : s.currency === 'CAD' ? usd * fx.usdCad : usd);
const money = (v) => moneyIn(v, s.currency);
const roiMarket = (r) => (r.ev && r.marketPrice ? r.ev.gross / r.marketPrice : null);
const day = (iso) => new Date(`${iso}T00:00:00Z`);
const finite = (rows) => rows.filter((r) => Number.isFinite(r.value));
const isFocus = (groupId) => String(groupId) === s.focus;

function syncControls() {
  const sets = [...new Map(rowsNow().map((r) => [String(r.groupId), r])).values()].sort((a, b) => b.releaseDate.localeCompare(a.releaseDate));
  if (s.focus && !sets.some((r) => String(r.groupId) === s.focus)) s.focus = '';
  $('focus').replaceChildren(el('option', { value: '' }, 'None'), ...sets.map((r) => el('option', { value: String(r.groupId) }, r.setName)));
  for (const key of FILTERS) $(key).value = s[key];
}

// ---- theme tokens (re-read on every render so dark mode is a re-render) ----
function tokens() {
  const cs = getComputedStyle(document.body);
  const v = (n) => cs.getPropertyValue(n).trim();
  return { surface: v('--surface-1'), ink: v('--text-primary'), ink2: v('--text-secondary'), grid: v('--grid'), deemph: v('--deemph'), range: v('--range'), wash: v('--wash'), s: [1, 2, 3, 4, 5].map((i) => v(`--series-${i}`)) };
}

// ---- figure scaffolding -----------------------------------------------------------
function mount(id) {
  const parts = { title: el('h3'), subtitle: el('p', { class: 'subtitle' }), legend: el('div', { class: 'legend' }), chart: el('div', { class: 'chart' }), table: el('div', { class: 'scroll' }), sort: {} };
  $(id).replaceChildren(el('figure', {}, parts.title, parts.subtitle, parts.legend, parts.chart, el('details', {}, el('summary', {}, 'Table view'), parts.table)));
  return parts;
}

/** legend: [label, color, 'dot'|'line'|'rect'|'tick'][]; plot: (width) => SVG; table: { columns, rows, sortKey } */
function draw(f, { title, subtitle, legend = [], empty, plot, table }) {
  f.title.textContent = title;
  f.subtitle.textContent = subtitle;
  f.legend.replaceChildren(...legend.map(([label, color, kind]) => el('span', {}, el('span', { class: `key ${kind}`, style: `background:${color}` }), label)));
  f.chart.classList.remove('stale');
  if (empty) f.chart.replaceChildren(el('p', { class: 'empty' }, empty));
  else if (!Plot) f.chart.replaceChildren(el('p', { class: 'empty' }, 'The chart library could not load (offline?). The table view below has every value.'));
  else f.chart.replaceChildren(plot(Math.max(320, f.chart.clientWidth || 800)));
  if (!f.sort.sortKey) f.sort = { sortKey: table.sortKey, sortDir: 'desc' };
  const render = () =>
    renderTable(f.table, table.columns, table.rows, f.sort, (st) => {
      Object.assign(f.sort, st);
      render();
    });
  render();
}

/** A per-mark computed color that must bypass the chart's color scale. */
const lit = (fn) => ({ value: fn, scale: null });

function plotBase(t, width, options) {
  return Plot.plot({
    width,
    style: { background: 'transparent', color: t.ink2, fontSize: '12px', fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif', overflow: 'visible' },
    ...options,
  });
}

const axisMoney = (v) => {
  const sym = s.currency === 'CAD' ? 'CA$' : '$';
  if (v === 0) return `${sym}0`;
  return v >= 1000 ? `${sym}${+(v / 1000).toFixed(1)}K` : v >= 1 ? `${sym}${+v.toFixed(0)}` : `${sym}${v.toFixed(2)}`;
};

// Log axes are drawn as log10(value) on a linear scale with explicit 1-2-5
// ticks: Plot's own log scale routes tick labels through d3's log tickFormat,
// which blanks the "5" ticks. L() maps a value into that space.
const L = (v) => Math.log10(v);
const STEPS = Array.from({ length: 11 }, (_, i) => i - 4).flatMap((e) => [1, 2, 5].map((m) => +(m * 10 ** e).toPrecision(1)));
/**
 * Linear-scale options for a log axis covering [lo, hi], snapped outward to clean 1-2-5 ticks.
 * sparse keeps only powers of ten (for narrow horizontal axes).
 */
function logAxis(lo, hi, format, { sparse = false, ...extra } = {}) {
  const start = STEPS.findLast((v) => v <= lo) ?? lo;
  const end = STEPS.find((v) => v >= hi) ?? hi;
  const ticks = STEPS.filter((v) => v >= start && v <= end && (!sparse || Number.isInteger(+L(v).toFixed(9))));
  return { domain: [L(start), L(end)], ticks: ticks.map(L), tickFormat: (x) => format(+(10 ** x).toPrecision(6)), ...extra };
}

// Plots narrower than this (phones) get fewer ticks, shorter end labels and
// truncated set names; full names stay in the tooltips and table views.
const NARROW = 600;
const dateTicks = (width) => Math.max(2, Math.floor(width / 150));
const bandMargin = (names, width) => Math.min(width < NARROW ? Math.round(width * 0.38) : 230, 12 + Math.max(...names.map((n) => n.length), 4) * 6.4);
function fitNames(names, width) {
  const max = Math.floor((bandMargin(names, width) - 12) / 6.4);
  return (n) => (n.length > max ? `${n.slice(0, max - 1)}…` : n);
}

const F = Object.fromEntries(['fig-ev-time', 'fig-dumbbell', 'fig-outcomes', 'fig-composition'].map((id) => [id, mount(id)]));

// ---- 1. EV per pack over time -----------------------------------------------------------
function chartEvTime(t) {
  const all = evSeries.filter((r) => inEra(r.era));
  const shape = (rows) => breakGaps(rows, 'evPerPack', MAX_GAP_DAYS).map((r) => ({ ...r, d: day(r.date), value: conv(r.evPerPack) }));
  const data = shape(all);
  const focus = shape(s.focus ? all.filter((r) => isFocus(r.groupId)) : medianByDate(all, 'evPerPack').map((r) => ({ ...r, groupId: 0 })));
  const name = s.focus ? setsById.get(Number(s.focus))?.setName ?? 'Highlighted set' : 'Median';
  const end = finite(focus).slice(-1);
  draw(F['fig-ev-time'], {
    title: 'EV per pack over time',
    subtitle: `What one pack's cards were worth (${s.currency}) at each nightly build since ${buildDates[0] ?? '—'}.`,
    legend: [
      [s.focus ? name : 'Median of all sets', t.s[0], 'line'],
      ['Every other set', t.deemph, 'line'],
    ],
    empty:
      buildDates.length < 2
        ? `History starts ${buildDates[0] ?? 'with the first nightly build'}. Each nightly build adds a point, so this chart fills in from the second one.`
        : all.length
          ? null
          : 'No EV history for this selection.',
    plot: (width) =>
      plotBase(t, width, {
        height: 320,
        marginRight: width < NARROW ? 50 : 180,
        x: { type: 'utc', label: null, ticks: dateTicks(width) },
        y: { label: `EV per pack (${s.currency})`, tickFormat: axisMoney, zero: true, nice: true },
        marks: [
          Plot.gridY({ stroke: t.grid, strokeOpacity: 1 }),
          Plot.line(data, { x: 'd', y: 'value', z: 'groupId', stroke: t.deemph, strokeWidth: 1 }),
          Plot.line(focus, { x: 'd', y: 'value', stroke: t.s[0], strokeWidth: 2 }),
          Plot.dot(end, { x: 'd', y: 'value', r: 4.5, fill: t.s[0], stroke: t.surface, strokeWidth: 2 }),
          Plot.text(end, { x: 'd', y: 'value', text: (r) => (width < NARROW ? money(r.value) : `${name.length > 24 ? 'Highlighted' : name} ${money(r.value)}`), dx: 10, textAnchor: 'start', fill: t.ink }),
          Plot.tip(finite(data), Plot.pointer({ x: 'd', y: 'value', title: (r) => `${money(r.value)} per pack\n${r.setName}\n${r.date}`, maxRadius: 30 })),
        ],
      }),
    table: {
      sortKey: 'date',
      rows: finite(focus),
      columns: [
        { key: 'date', label: 'Date', value: (r) => r.date },
        { key: 'ev', label: `${s.focus ? '' : 'Median '}EV per pack`, numeric: true, value: (r) => r.value, render: (r) => money(r.value) },
      ],
    },
  });
}

// ---- 2. What a pack costs vs. what's in it ----------------------------------------------------
function chartDumbbell(t) {
  const data = rowsNow()
    .filter((r) => r.evPerPack && r.marketPrice)
    .map((r) => ({ r, setName: r.setName, d: day(r.releaseDate), ev: conv(r.evPerPack.gross), cost: conv(r.marketPrice / r.packs), focus: isFocus(r.groupId) }))
    .filter((p) => p.ev > 0 && p.cost > 0);
  const points = data.flatMap((p) => [
    { ...p, series: 'EV per pack', y: p.ev },
    { ...p, series: 'Cost per pack', y: p.cost },
  ]);
  const ys = points.map((p) => p.y);
  const yAxis = logAxis(Math.min(...ys), Math.max(...ys), axisMoney, { label: `${s.currency} per pack` });
  draw(F['fig-dumbbell'], {
    title: `What a pack costs vs. what's in it · ${TYPE_LABEL[s.type]}`,
    subtitle: `${s.type === 'pack' ? 'Cost per pack = booster pack market price' : `Cost per pack = ${TYPE_LABEL[s.type]} market price ÷ packs inside`}, by release date. The gap is the sealed premium; older sets carry more of it. Log scale.`,
    legend: [
      ['EV per pack', t.s[0], 'dot'],
      ['Cost per pack', t.s[1], 'dot'],
    ],
    empty: data.length ? null : 'No sets with pull data and a price for this product type.',
    plot: (width) =>
      plotBase(t, width, {
        height: 340,
        marginRight: 30,
        x: { type: 'utc', label: 'Release date', ticks: dateTicks(width) },
        y: yAxis,
        marks: [
          Plot.gridY(yAxis.ticks, { stroke: t.grid, strokeOpacity: 1 }),
          Plot.ruleX(data, { x: 'd', y1: (p) => L(p.ev), y2: (p) => L(p.cost), stroke: lit((p) => (p.focus ? t.ink2 : t.deemph)), strokeWidth: (p) => (p.focus ? 2 : 1.5) }),
          Plot.dot(data, { x: 'd', y: (p) => L(p.ev), r: 4.5, fill: t.s[0], stroke: t.surface, strokeWidth: 2 }),
          Plot.dot(data, { x: 'd', y: (p) => L(p.cost), r: 4.5, fill: t.s[1], stroke: t.surface, strokeWidth: 2 }),
          Plot.text(data.filter((p) => p.focus), { x: 'd', y: (p) => L(p.cost), text: 'setName', dy: -14, fill: t.ink, fontWeight: 600 }),
          Plot.tip(points, Plot.pointer({ x: 'd', y: (p) => L(p.y), title: (p) => `${money(p.y)} ${p.series.toLowerCase()}\n${p.setName}\n${p.r.releaseDate} · EV is ${pct(p.ev / p.cost)} of cost`, maxRadius: 30 })),
        ],
      }),
    table: {
      sortKey: 'release',
      rows: data,
      columns: [
        { key: 'set', label: 'Set', value: (p) => p.setName },
        { key: 'release', label: 'Released', value: (p) => p.r.releaseDate },
        { key: 'cost', label: 'Cost per pack', numeric: true, value: (p) => p.cost, render: (p) => money(p.cost) },
        { key: 'ev', label: 'EV per pack', numeric: true, value: (p) => p.ev, render: (p) => money(p.ev) },
        { key: 'ratio', label: 'EV ÷ cost', numeric: true, value: (p) => p.ev / p.cost, render: (p) => pct(p.ev / p.cost) },
      ],
    },
  });
}

// ---- 3. What opening one product actually gives you --------------------------------------------
function chartOutcomes(t) {
  const data = rowsNow()
    .filter((r) => r.sim && roiMarket(r) != null)
    .sort((a, b) => roiMarket(b) - roiMarket(a))
    .map((r) => {
      const m = r.sim.gross;
      return { r, setName: r.setName, p5: conv(m.p5), median: conv(m.median), p95: conv(m.p95), ev: conv(r.ev.gross), price: conv(r.marketPrice), pProfit: m.pProfitMarket };
    });
  const xs = data.flatMap((d) => [d.p5, d.p95, d.price, d.ev]).filter((v) => v > 0);
  const xAxisFor = (width) => logAxis(Math.min(...xs), Math.max(...xs), axisMoney, { label: null, axis: 'top', sparse: width < NARROW });
  const [lo, hi] = xs.length ? xAxisFor(Infinity).domain : [0, 1];
  const names = data.map((d) => d.setName);
  draw(F['fig-outcomes'], {
    title: `What opening one ${TYPE_LABEL[s.type]} actually gives you`,
    subtitle: `${s.currency}, from ${assumptions.simulation.sims.toLocaleString()} simulated openings per product, best ROI first. Most openings land near the median, well below the average (EV) that a few big pulls drag up.${s.type === 'pack' ? " Cards under the bulk threshold count at the bulk rate, so a single pack's median is often just bulk." : ''} Log scale.`,
    legend: [
      ['Middle 90% of openings', t.range, 'rect'],
      ['Median opening', t.ink, 'tick'],
      ['EV (average)', t.s[0], 'dot'],
      ['Market price', t.s[1], 'dot'],
    ],
    empty: data.length ? null : 'No sets with pull data for this product type.',
    plot: (width) =>
      plotBase(t, width, {
        height: 40 + data.length * 24,
        marginLeft: bandMargin(names, width),
        marginRight: 20,
        x: xAxisFor(width),
        y: { domain: names, label: null, padding: 0.55, tickFormat: fitNames(names, width) },
        marks: [
          Plot.barX(data.filter((d) => isFocus(d.r.groupId)), { x1: lo, x2: hi, y: 'setName', fill: t.wash, insetTop: -8, insetBottom: -8 }),
          Plot.gridX(xAxisFor(width).ticks, { stroke: t.grid, strokeOpacity: 1 }),
          Plot.barX(data, { x1: (d) => L(d.p5), x2: (d) => L(d.p95), y: 'setName', fill: t.range, r: 4 }),
          Plot.tickX(data, { x: (d) => L(d.median), y: 'setName', stroke: t.ink, strokeWidth: 2, insetTop: -3, insetBottom: -3 }),
          Plot.dot(data, { x: (d) => L(d.price), y: 'setName', r: 4.5, fill: t.s[1], stroke: t.surface, strokeWidth: 2 }),
          Plot.dot(data, { x: (d) => L(d.ev), y: 'setName', r: 4.5, fill: t.s[0], stroke: t.surface, strokeWidth: 2 }),
          Plot.tip(data, Plot.pointerY({ y: 'setName', x: (d) => L(d.ev), title: (d) => `${money(d.median)} median · ${money(d.ev)} EV · ${money(d.price)} price\n${money(d.p5)}–${money(d.p95)} middle 90%\n${pct(d.pProfit)} chance to beat the price\n${d.setName}` })),
        ],
      }),
    table: {
      sortKey: 'profit',
      rows: data,
      columns: [
        { key: 'set', label: 'Set', value: (d) => d.setName },
        { key: 'price', label: 'Price', numeric: true, value: (d) => d.price, render: (d) => money(d.price) },
        { key: 'p5', label: 'P5', numeric: true, value: (d) => d.p5, render: (d) => money(d.p5) },
        { key: 'median', label: 'Median', numeric: true, value: (d) => d.median, render: (d) => money(d.median) },
        { key: 'ev', label: 'EV', numeric: true, value: (d) => d.ev, render: (d) => money(d.ev) },
        { key: 'p95', label: 'P95', numeric: true, value: (d) => d.p95, render: (d) => money(d.p95) },
        { key: 'profit', label: 'P(≥ price)', numeric: true, value: (d) => d.pProfit, render: (d) => pct(d.pProfit) },
      ],
    },
  });
}

// ---- 4. Where a pack's EV comes from (per-set files load when this chart nears the viewport) ----
let packs = null;
let loading = false;

async function loadPacks() {
  if (packs || loading) return;
  loading = true;
  F['fig-composition'].chart.classList.add('stale');
  const ids = [...new Set(index.rows.filter((r) => r.pullData.status !== 'none').map((r) => r.groupId))];
  const out = [];
  const queue = [...ids];
  const worker = async () => {
    for (let id = queue.shift(); id != null; id = queue.shift()) {
      const d = await fetch(`data/sets/${id}.json`).then(okJson);
      // Keep only the per-group EV; the full card lists are dropped after this.
      if (d.pack) out.push({ groupId: d.groupId, setName: d.setName, era: d.era, ev: packEV(d.pack, d.cards, assumptions.pricing) });
    }
  };
  try {
    await Promise.all(Array.from({ length: 6 }, worker));
    packs = out;
  } catch (err) {
    F['fig-composition'].chart.replaceChildren(el('p', { class: 'empty' }, `Could not load set files: ${err.message}`));
  }
  loading = false;
  if (packs) chartComposition(tokens());
}

function chartComposition(t) {
  const stacked = [];
  const totals = [];
  for (const d of (packs ?? []).filter((p) => inEra(p.era))) {
    let x = 0;
    const parts = evComposition(d.ev.byGroup).map((p) => ({ ...p, value: conv(p.value) }));
    const lastNonZero = parts.findLastIndex((p) => p.value > 1e-9);
    parts.forEach((p, i) => {
      stacked.push({ setName: d.setName, family: p.family, value: p.value, x1: x, x2: x + p.value, end: i === lastNonZero, share: p.value / conv(d.ev.gross) });
      x += p.value;
    });
    totals.push({ setName: d.setName, total: x, groupId: d.groupId });
  }
  totals.sort((a, b) => b.total - a.total);
  const colors = [...t.s, t.deemph];
  const segs = stacked.filter((p) => p.value > 1e-9);
  const names = totals.map((d) => d.setName);
  draw(F['fig-composition'], {
    title: "Where a pack's EV comes from",
    subtitle: `EV per pack in ${s.currency}, split by rarity family. The rare chase tiers usually carry most of the value; commons and reverse holos ("bulk & filler") add little.`,
    legend: FAMILIES.map((f, i) => [f, colors[i], 'rect']),
    empty: !packs ? 'Loading set files…' : totals.length ? null : 'No sets with pull data in this era.',
    plot: (width) =>
      plotBase(t, width, {
        height: 40 + totals.length * 24,
        marginLeft: bandMargin(names, width),
        marginRight: 70,
        x: { label: null, tickFormat: axisMoney, axis: 'top', nice: true },
        y: { domain: names, label: null, padding: 0.3, tickFormat: fitNames(names, width) },
        color: { domain: FAMILIES, range: colors },
        marks: [
          Plot.barX(totals.filter((d) => isFocus(d.groupId)), { x1: 0, x2: (d) => d.total * 1.12, y: 'setName', fill: t.wash, insetTop: -3, insetBottom: -3 }),
          Plot.gridX({ stroke: t.grid, strokeOpacity: 1 }),
          Plot.barX(segs.filter((p) => !p.end), { x1: 'x1', x2: 'x2', y: 'setName', fill: 'family', insetRight: 2 }),
          Plot.barX(segs.filter((p) => p.end), { x1: 'x1', x2: 'x2', y: 'setName', fill: 'family', rx2: 4 }),
          Plot.text(totals, { x: 'total', y: 'setName', text: (d) => money(d.total), dx: 6, textAnchor: 'start', fill: t.ink }),
          Plot.tip(segs, Plot.pointer({ x: (p) => (p.x1 + p.x2) / 2, y: 'setName', title: (p) => `${money(p.value)} · ${pct(p.share)} of pack EV\n${p.family}\n${p.setName}` })),
        ],
      }),
    table: {
      sortKey: 'total',
      rows: totals.map((d) => ({ ...d, parts: Object.fromEntries(stacked.filter((p) => p.setName === d.setName).map((p) => [p.family, p.value])) })),
      columns: [
        { key: 'set', label: 'Set', value: (d) => d.setName },
        ...FAMILIES.map((f, i) => ({ key: `f${i}`, label: f, numeric: true, value: (d) => d.parts[f], render: (d) => money(d.parts[f]) })),
        { key: 'total', label: 'EV per pack', numeric: true, value: (d) => d.total, render: (d) => money(d.total) },
      ],
    },
  });
}

function renderAll() {
  syncControls();
  const t = tokens();
  chartEvTime(t);
  chartDumbbell(t);
  chartOutcomes(t);
  chartComposition(t);
}

renderAll();
new IntersectionObserver(
  (entries, obs) => {
    if (entries.some((e) => e.isIntersecting)) {
      obs.disconnect();
      loadPacks();
    }
  },
  { rootMargin: '600px' },
).observe($('fig-composition'));

// Re-render on theme or width change (charts are sized in pixels, colors read from tokens).
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', renderAll);
let lastWidth = document.body.clientWidth;
let resizeTimer = null;
new ResizeObserver(() => {
  if (document.body.clientWidth === lastWidth) return;
  lastWidth = document.body.clientWidth;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(renderAll, 150);
}).observe(document.body);
