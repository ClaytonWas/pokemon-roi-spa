// The site publishes only values it can fully trust: measured pull rates from a
// primary study, TCGplayer market prices, and MSRPs verified from an official
// list price. These tests hold both the hand-maintained data and the committed
// build output to that rule, so an estimate can't creep back in unnoticed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const json = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const pullrates = json('data/pullrates.json');
const msrp = json('data/msrp.json');
const config = json('config/assumptions.json');
const index = json('public/data/index.json');

test('pull rates: every listed set is a TCGplayer study with measured odds for every tier', () => {
  assert.equal(pullrates.eraDefaults, undefined, 'no era-average estimates');
  for (const [id, set] of Object.entries(pullrates.sets)) {
    assert.equal(set.eraDefault, undefined, `${set.name}: era default`);
    assert.equal(set.source?.publisher, 'TCGplayer Authentication Center', `${set.name}: primary source`);
    assert.match(set.source?.url ?? '', /^https:\/\/www\.tcgplayer\.com\//, `${set.name}: source link`);
    assert.ok(set.source.packsOpened > 0, `${set.name}: sample size`);
    for (const [tier, t] of Object.entries(set.tiers)) {
      assert.ok(typeof t.odds === 'number' && t.odds > 0 && t.odds <= 1, `${set.name} ${tier}: measured odds`);
      assert.ok(!t.estimated, `${set.name} ${tier}: estimated`);
    }
    assert.ok(!pullrates.excluded?.[id], `${set.name} is both listed and excluded`);
  }
});

test('MSRP: any value present is an official list price with a source', () => {
  const entries = [msrp.defaults, ...Object.values(msrp.eras), ...Object.values(msrp.sets)].flatMap((byType) => Object.values(byType ?? {}).flatMap((byCur) => Object.values(byCur ?? {})));
  for (const v of entries.filter(Boolean)) {
    assert.equal(v.confidence, 'list', `MSRP ${v.value} is not a verified list price`);
    assert.match(v.source ?? '', /^https:\/\//, `MSRP ${v.value} has no source link`);
  }
});

test('pricing uses TCGplayer market prices only (no low/mid substitutes)', () => {
  assert.equal(config.pricing.priceFallback, 'none');
});

test('published output: EV only where pull data is measured and nothing is estimated', () => {
  let withEv = 0;
  for (const r of index.rows) {
    assert.deepEqual(r.pullData.estimatedTiers, [], `${r.setName}: estimated tiers`);
    if (!r.ev) continue;
    withEv += 1;
    assert.equal(r.pullData.status, 'measured', `${r.setName} ${r.productType}`);
    assert.deepEqual(r.pullData.unknownTiers, [], `${r.setName}: EV with unmeasured tiers`);
    assert.ok(r.pullData.source && r.pullData.packsOpened > 0, `${r.setName}: EV without a cited study`);
  }
  assert.ok(withEv > 0);
  for (const r of index.rows) {
    if (r.msrp.usd != null) assert.equal(r.msrp.usdConfidence, 'list', `${r.setName} ${r.productType}: unverified USD MSRP`);
    if (r.msrp.cad != null) assert.equal(r.msrp.cadConfidence, 'list', `${r.setName} ${r.productType}: unverified CAD MSRP`);
  }
});

test('published output: no backfilled or estimated history files', () => {
  assert.deepEqual(readdirSync(new URL('../public/data/history/', import.meta.url)), ['sealed.csv']);
});
