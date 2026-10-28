import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPackModel } from '../src/pack.js';
import { cardValue, packEV, productEV, roi, chaseOdds, gradedValue, gradedOverrides, topHitCards } from '../src/ev.js';
import * as mini from './fixtures/mini-set.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const build = (extra = {}) => buildPackModel({ cards: mini.cards, tiers: mini.tiers, layout: mini.layout, pools: mini.pools, hitVariants: mini.hitVariants, ...extra });

test('cardValue applies the bulk threshold, fees and shipping', () => {
  const o = mini.pricing;
  close(cardValue(0.99, 'x', o, 'gross'), 0.01);
  close(cardValue(1.0, 'x', o, 'gross'), 1.0);
  close(cardValue(10, 'x', o, 'net'), 10 * 0.9 - 0.5);
  close(cardValue(0.5, 'x', o, 'net'), 0.01, 1e-12); // below threshold: bulk, no fees
  close(cardValue(null, 'x', o, 'gross'), 0.01); // unpriced -> bulk
  close(cardValue(0.2, 'reverse', { ...o, bulkRateByGroup: { reverse: 0.05 } }), 0.05);
  close(cardValue(1.0, 'x', { ...o, netFloorAtBulkRate: true }, 'net'), 0.4); // 1*0.9-0.5 = 0.4 > 0.01
  close(cardValue(1.0, 'x', { ...o, perCardShipping: 2, netFloorAtBulkRate: true }, 'net'), 0.01);
});

test('pack model: rates, filler and pool membership', () => {
  const { model, issues, unrated } = build();
  assert.deepEqual(issues, []);
  assert.deepEqual(unrated, []);
  const g = Object.fromEntries(model.groups.map((x) => [x.key, x]));
  close(g['tier:Double Rare'].rate, 0.2);
  close(g['pool:common'].rate, 2); // 2 common slots, no hits
  close(g['pool:rare'].rate, 0.8); // 1 - DR odds
  close(g['pool:reverse'].rate, 0.88); // 1 - (IR + SIR)
  assert.equal(g['pool:reverse'].entries.length, 4); // C1, C2, U1, R1 reverse printings
  assert.ok(g['pool:reverse'].entries.every((e) => e.variant === 'reverseHolofoil'));
});

test('packEV matches the hand-computed fixture', () => {
  const { model } = build();
  const ev = packEV(model, mini.cards, mini.pricing);
  // gross: common 2*(0.01+2.00)/2 = 2.01; uncommon 0.01; rare filler 0.8*0.01 = 0.008;
  // DR 0.2*(5+1)/2 = 0.6; reverse filler 0.88*(0.01+3+1.5+0.01)/4 = 0.9944; IR 0.1*10 = 1; SIR 0.02*100 = 2
  close(ev.gross, 6.6224);
  // net (p*0.9-0.5 above $1): common 2*(0.01+1.3)/2 = 1.31; uncommon 0.01; rare 0.008;
  // DR 0.2*(4.0+0.4)/2 = 0.44; reverse 0.88*(0.01+2.2+0.85+0.01)/4 = 0.6754; IR 0.85; SIR 1.79
  close(ev.net, 5.0834);
  const sir = ev.entries.find((e) => mini.cards[e.card].name === 'SIR1');
  close(sir.copiesPerPack, 0.02);
  close(sir.gross, 2.0);
  const sumEntries = ev.entries.reduce((a, e) => a + e.gross, 0);
  close(sumEntries, ev.gross);
});

test('productEV, ROI and promo value', () => {
  const { model } = build();
  const pack = packEV(model, mini.cards, mini.pricing);
  const box = productEV(pack, 10, 0, mini.pricing);
  close(box.gross, 66.224);
  close(roi(box.gross, 50), 1.32448);
  assert.equal(roi(box.gross, null), null);
  assert.equal(roi(null, 50), null);
  const etb = productEV(pack, 9, 4, mini.pricing);
  close(etb.gross, 9 * 6.6224 + 4);
  close(etb.net, 9 * 5.0834 + (4 * 0.9 - 0.5));
});

test('per-card odds override redistributes the tier', () => {
  const { model } = build({ cardOverrides: { 5: 0.15 } });
  const ev = packEV(model, mini.cards, mini.pricing);
  // DR1 at 0.15, DR2 gets the remaining 0.05: 0.15*5 + 0.05*1 = 0.8 (was 0.6)
  close(ev.gross, 6.6224 - 0.6 + 0.8);
});

test('chase odds are exact', () => {
  const { model } = build();
  const c = chaseOdds(model, ['Special Illustration Rare', 'Hyper Rare'], 10);
  assert.deepEqual(c.tiers, ['Special Illustration Rare']);
  close(c.p, 1 - 0.98 ** 10);
  assert.equal(chaseOdds(model, ['Hyper Rare'], 10), null);
});

test('graded value replaces raw value for top-N hits only', () => {
  close(gradedValue({ psa10: 300, psa9: 120 }, { gemRate: 0.5, gradingCost: 30 }), 180);
  assert.equal(gradedValue({ psa10: 300 }, { gemRate: 0.5, gradingCost: 30 }), null);
  const { model } = build();
  const top = topHitCards(model, mini.cards, 2).map((t) => mini.cards[t.card].name);
  assert.deepEqual(top, ['SIR1', 'IR1']);
  const graded = { 7: { psa10: 300, psa9: 120 }, 5: { psa10: 50, psa9: 20 } };
  const ov = gradedOverrides(model, mini.cards, graded, { gemRate: 0.5, gradingCost: 30, topN: 1 });
  assert.equal(ov.size, 1); // DR1 is outside top-1
  const ev = packEV(model, mini.cards, mini.pricing, ov);
  close(ev.gross, 6.6224 - 2.0 + 0.02 * 180);
});

test('model issues: unknown odds, empty tiers, overfull slots', () => {
  const tiers = { ...mini.tiers, 'Hyper Rare': { odds: 0.01 }, 'Black White Rare': { odds: null } };
  const cards = [...mini.cards, { productId: 9, name: 'BWR', tier: 'Black White Rare', prices: { holofoil: 500 } }];
  const { model, issues, unrated } = buildPackModel({ cards, tiers, layout: mini.layout, pools: mini.pools, hitVariants: mini.hitVariants });
  assert.ok(issues.some((i) => i.includes('"Hyper Rare" has odds')));
  assert.deepEqual(unrated, [{ tier: 'Black White Rare', cards: 1 }]);
  assert.ok(!model.groups.some((g) => g.id === 'Black White Rare'));

  const over = buildPackModel({ cards: mini.cards, tiers: { 'Illustration Rare': { odds: 0.9 }, 'Special Illustration Rare': { odds: 0.6 } }, layout: mini.layout, pools: mini.pools, hitVariants: mini.hitVariants });
  assert.ok(over.issues.some((i) => i.includes('sum to 1.5000')));
  const rev = over.model.slots.find((s) => s.id === 'reverse');
  close(rev.hits.reduce((a, h) => a + h.p, 0), 1);
  close(rev.fillerP, 0);
});
