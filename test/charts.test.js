import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHistory, median, medianByDate, medianBy, evComposition, familyOf, FAMILIES, evPerPackSeries, breakGaps } from '../public/app/chart-data.js';
import { packEV } from '../src/ev.js';

// Runs against the committed build output, checking invariants that hold for any build.
const read = (p) => readFileSync(new URL(`../public/data/${p}`, import.meta.url), 'utf8');
const index = JSON.parse(read('index.json'));
const history = parseHistory(read('history/sealed.csv'));
const detail = (id) => JSON.parse(read(`sets/${id}.json`));

test('history CSV parses, empty cells become null', () => {
  assert.ok(history.length >= index.rows.length);
  assert.ok(history.every((h) => /^\d{4}-\d{2}-\d{2}$/.test(h.date) && Number.isInteger(h.groupId)));
  const [row] = parseHistory('date,groupId,productType,marketPrice,evPerPack\n2026-10-27,1,pack,,\n');
  assert.deepEqual(row, { date: '2026-10-27', groupId: 1, productType: 'pack', marketPrice: null, evPerPack: null });
});

test('history CSV agrees with index.json for the same build date', () => {
  const buildDate = index.meta.tcgcsvLastUpdated.slice(0, 10);
  const byKey = new Map(index.rows.map((r) => [`${r.groupId}:${r.productType}`, r]));
  let checked = 0;
  for (const h of history.filter((x) => x.date === buildDate)) {
    const r = byKey.get(`${h.groupId}:${h.productType}`);
    if (r?.roi?.market == null) continue;
    const roi = (h.evPerPack * r.packs) / h.marketPrice;
    assert.ok(Math.abs(roi - r.roi.market) < 1e-3, `${r.setName} ${r.productType}: ${roi} vs ${r.roi.market}`);
    checked += 1;
  }
  assert.ok(checked > 50);
});

test('median and per-date median', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([null, NaN]), null);
  assert.deepEqual(medianByDate([{ date: 'b', roi: 1 }, { date: 'a', roi: 2 }, { date: 'a', roi: 4 }, { date: 'b', roi: null }], 'roi'), [{ date: 'a', roi: 3 }, { date: 'b', roi: 1 }]);
  assert.deepEqual(medianBy([{ w: 1, v: 2 }, { w: 1, v: 4 }, { w: 0, v: NaN }], 'w', 'v'), [{ w: 1, v: 3 }]);
});

test('EV composition: families sum to the pack EV', () => {
  const d = detail(23651);
  const pack = packEV(d.pack, d.cards, index.meta.assumptions.pricing);
  for (const basis of ['gross', 'net']) {
    const parts = evComposition(pack.byGroup, basis);
    assert.deepEqual(parts.map((p) => p.family), FAMILIES);
    const total = parts.reduce((a, p) => a + p.value, 0);
    assert.ok(Math.abs(total - pack[basis]) < 1e-9, `${basis}: ${total} vs ${pack[basis]}`);
  }
  assert.equal(familyOf('pool:reverse'), 'Bulk & filler');
  assert.equal(familyOf('tier:Alt Art VMAX'), 'SIR & alt art');
  assert.equal(familyOf('tier:Mega Hyper Rare'), 'Hyper, gold & secret');
  assert.equal(familyOf('tier:Some Future Rarity'), 'Specials & galleries');
});

test('EV series: one row per set and date, gaps break the line', () => {
  const sets = new Map([[1, { setName: 'A', era: 'sv', releaseDate: '2026-01-01' }]]);
  const nightly = [
    { date: '2026-01-01', groupId: 1, productType: 'pack', evPerPack: 4 },
    { date: '2026-01-01', groupId: 1, productType: 'box', evPerPack: 4 }, // same set and date: one row
    { date: '2026-01-08', groupId: 1, productType: 'pack', evPerPack: 3 },
    { date: '2026-03-01', groupId: 1, productType: 'pack', evPerPack: 2 },
    { date: '2026-03-01', groupId: 1, productType: 'etb', evPerPack: null }, // no EV: skipped
    { date: '2026-01-01', groupId: 2, productType: 'pack', evPerPack: 1 }, // unknown set: dropped
  ];
  const s = evPerPackSeries(nightly, sets);
  assert.deepEqual(s.map((r) => [r.date, r.evPerPack, r.setName]), [['2026-01-01', 4, 'A'], ['2026-01-08', 3, 'A'], ['2026-03-01', 2, 'A']]);
  const broken = breakGaps(s, 'evPerPack', 21);
  assert.equal(broken.length, 4);
  assert.ok(Number.isNaN(broken[2].evPerPack) && broken[2].date === '2026-01-09');
});
