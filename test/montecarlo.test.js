import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPackModel } from '../src/pack.js';
import { packEV, createSampler, simulateProduct, chaseOdds } from '../src/ev.js';
import * as mini from './fixtures/mini-set.js';

const { model } = buildPackModel({ cards: mini.cards, tiers: mini.tiers, layout: mini.layout, pools: mini.pools, hitVariants: mini.hitVariants });
const sampler = createSampler(model, mini.cards, mini.pricing);
const PACKS = 10;
const SIMS = 20000;

test('Monte Carlo mean converges to the analytical EV', () => {
  const ev = packEV(model, mini.cards, mini.pricing);
  const r = simulateProduct(sampler, { packs: PACKS, sims: SIMS, seed: 42 });
  for (const basis of ['gross', 'net']) {
    const want = PACKS * ev[basis];
    const se = r[basis].sd / Math.sqrt(SIMS);
    const err = Math.abs(r[basis].mean - want);
    assert.ok(err < 4 * se, `${basis}: |${r[basis].mean.toFixed(3)} - ${want.toFixed(3)}| = ${err.toFixed(3)} >= 4 SE (${(4 * se).toFixed(3)})`);
  }
});

test('Monte Carlo chase frequency matches the exact chase odds', () => {
  const exact = chaseOdds(model, ['Special Illustration Rare'], PACKS).p;
  const r = simulateProduct(sampler, { packs: PACKS, sims: SIMS, seed: 7, chaseTiers: ['Special Illustration Rare'] });
  const se = Math.sqrt((exact * (1 - exact)) / SIMS);
  assert.ok(Math.abs(r.chaseP - exact) < 4 * se, `${r.chaseP} vs ${exact}`);
});

test('Monte Carlo is deterministic for a seed and ordered quantiles hold', () => {
  const a = simulateProduct(sampler, { packs: 3, sims: 2000, seed: 123, costs: [20, 40] });
  const b = simulateProduct(sampler, { packs: 3, sims: 2000, seed: 123, costs: [20, 40] });
  assert.deepEqual(a, b);
  const c = simulateProduct(sampler, { packs: 3, sims: 2000, seed: 124, costs: [20, 40] });
  assert.notDeepEqual(a.gross.mean, c.gross.mean);
  assert.ok(a.gross.p5 <= a.gross.median && a.gross.median <= a.gross.p95);
  assert.ok(a.gross.pAtLeast[0] >= a.gross.pAtLeast[1]); // higher cost, lower profit chance
});

test('profit chance equals the share of simulations at or above cost', () => {
  // 1 pack, cost just above the max possible non-SIR value: profit requires the SIR (p = 0.02)
  // Max non-SIR pack: 2 commons at 2.00 + uncommon 0.01 + reverse 10 (IR) + DR 5 = 19.01 < 50.
  const r = simulateProduct(sampler, { packs: 1, sims: SIMS, seed: 99, costs: [50] });
  const se = Math.sqrt((0.02 * 0.98) / SIMS);
  assert.ok(Math.abs(r.gross.pAtLeast[0] - 0.02) < 4 * se, String(r.gross.pAtLeast[0]));
});
