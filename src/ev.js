// Expected-value math shared by the build (Node) and the UI (browser).
// Every function here is pure: inputs in, numbers out, no I/O.
//
// Model recap (see DATA_CONTRACT.md): a PackModel is a list of slots. Each
// slot draws one hit tier with that tier's per-pack odds, or else (with the
// remaining probability) a uniform card from its filler pool. Within a tier,
// cards are equally likely unless pullrates.json overrides a card's odds.
// So every model entry e has a rate r_e = expected copies per pack, and
//   EV_pack = sum_e r_e * value(price_e)
// The Monte Carlo samples the same model, so its mean converges to EV_pack.

import { mulberry32 } from './rng.js';

/** @typedef {import('./contract.js').PackModel} PackModel */
/** @typedef {import('./contract.js').CardRecord} CardRecord */
/** @typedef {import('./contract.js').PricingOptions} PricingOptions */

/**
 * Raw (ungraded NM) value of one card copy.
 * gross: price if price >= bulkThreshold, else the bulk rate.
 * net:   price*(1-sellFeePct) - perCardShipping above the threshold, bulk rate below.
 * An unknown price (null) is valued at the bulk rate.
 * @param {number|null|undefined} price
 * @param {string} groupId  tier name or pool id, used for bulkRateByGroup
 * @param {PricingOptions} o
 * @param {'gross'|'net'} basis
 */
export function cardValue(price, groupId, o, basis = 'gross') {
  const bulk = o.bulkRateByGroup?.[groupId] ?? o.bulkRatePerCard;
  if (price == null || !(price >= o.bulkThreshold)) return bulk;
  if (basis === 'gross') return price;
  const net = price * (1 - o.sellFeePct) - o.perCardShipping;
  return o.netFloorAtBulkRate ? Math.max(net, bulk) : net;
}

/** Key for value overrides (graded prices): "<productId>:<variant>". */
export const entryKey = (card, variant) => `${card.productId}:${variant}`;

function entryPrice(cards, e, overrides) {
  const c = cards[e.card];
  if (overrides) {
    const v = overrides.get(entryKey(c, e.variant));
    if (v != null) return v;
  }
  return c.prices[e.variant] ?? null;
}

/**
 * Analytical EV of one pack.
 * @param {PackModel} model
 * @param {CardRecord[]} cards
 * @param {PricingOptions} o
 * @param {Map<string, number>} [overrides]  entryKey -> replacement price (graded view)
 * @returns {{ gross: number, net: number, byGroup: Array<{ key: string, gross: number, net: number }>,
 *             entries: Array<{ card: number, variant: string, group: string, copiesPerPack: number, price: number|null, gross: number, net: number }> }}
 */
export function packEV(model, cards, o, overrides) {
  let gross = 0;
  let net = 0;
  const byGroup = [];
  const entries = [];
  for (const g of model.groups) {
    let gg = 0;
    let gn = 0;
    for (const e of g.entries) {
      const copies = g.rate * e.w;
      const price = entryPrice(cards, e, overrides);
      const vg = copies * cardValue(price, g.id, o, 'gross');
      const vn = copies * cardValue(price, g.id, o, 'net');
      gg += vg;
      gn += vn;
      entries.push({ card: e.card, variant: e.variant, group: g.key, copiesPerPack: copies, price, gross: vg, net: vn });
    }
    byGroup.push({ key: g.key, gross: gg, net: gn });
    gross += gg;
    net += gn;
  }
  return { gross, net, byGroup, entries };
}

/** EV of a sealed product: packs * pack EV + optional promo value (valued like any card). */
export function productEV(pack, packs, promoValue, o) {
  const promo = promoValue > 0 ? promoValue : 0;
  return {
    gross: packs * pack.gross + (promo ? cardValue(promo, 'promo', o, 'gross') : 0),
    net: packs * pack.net + (promo ? cardValue(promo, 'promo', o, 'net') : 0),
  };
}

/** ROI as a ratio (1 = break-even). null when either side is unknown. */
export function roi(ev, cost) {
  return ev != null && cost != null && cost > 0 ? ev / cost : null;
}

/**
 * Exact probability of opening at least one card from `chaseTiers` in `packs` packs.
 * @returns {{ tiers: string[], p: number } | null}  null if none of the tiers are rated in this model
 */
export function chaseOdds(model, chaseTiers, packs) {
  const wanted = new Set(chaseTiers);
  let missPerPack = 1;
  const used = [];
  for (const s of model.slots) {
    const p = s.hits.filter((h) => wanted.has(h.tier)).reduce((a, h) => a + h.p, 0);
    for (const h of s.hits) if (wanted.has(h.tier)) used.push(h.tier);
    missPerPack *= (1 - p) ** s.count;
  }
  if (used.length === 0) return null;
  return { tiers: used, p: 1 - missPerPack ** packs };
}

/**
 * Precomputes everything the Monte Carlo needs so the inner loop is just
 * table lookups.
 */
export function createSampler(model, cards, o, overrides) {
  const groupIdx = new Map(model.groups.map((g, i) => [g.key, i]));
  const groups = model.groups.map((g) => {
    const n = g.entries.length;
    const gross = new Float64Array(n);
    const net = new Float64Array(n);
    const cum = new Float64Array(n);
    let acc = 0;
    let uniform = true;
    g.entries.forEach((e, i) => {
      const price = entryPrice(cards, e, overrides);
      gross[i] = cardValue(price, g.id, o, 'gross');
      net[i] = cardValue(price, g.id, o, 'net');
      acc += e.w;
      cum[i] = acc;
      if (Math.abs(e.w - 1 / n) > 1e-12) uniform = false;
    });
    return { n, gross, net, cum, total: acc, uniform, tier: g.kind === 'tier' ? g.id : null };
  });
  const slots = model.slots.map((s) => {
    const hitGroups = [];
    const hitCum = [];
    let acc = 0;
    for (const h of s.hits) {
      const gi = groupIdx.get(`tier:${h.tier}`);
      if (gi === undefined) continue;
      acc += h.p;
      hitGroups.push(gi);
      hitCum.push(acc);
    }
    const pool = s.pool ? groupIdx.get(`pool:${s.pool}`) : undefined;
    return { count: s.count, hitGroups, hitCum, pool: pool ?? -1 };
  });
  return { groups, slots };
}

function pick(g, rng) {
  if (g.uniform) return Math.min(g.n - 1, Math.floor(rng() * g.n));
  const u = rng() * g.total;
  let lo = 0;
  let hi = g.n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (g.cum[mid] < u) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function quantile(sorted, q) {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function summarize(values, costs) {
  const sorted = Float64Array.from(values).sort();
  let sum = 0;
  for (const v of sorted) sum += v;
  const mean = sum / sorted.length;
  let ss = 0;
  for (const v of sorted) ss += (v - mean) ** 2;
  return {
    mean,
    sd: Math.sqrt(ss / Math.max(1, sorted.length - 1)),
    median: quantile(sorted, 0.5),
    p5: quantile(sorted, 0.05),
    p95: quantile(sorted, 0.95),
    pAtLeast: costs.map((c) => {
      if (c == null || !(c > 0)) return null;
      let n = 0;
      for (const v of sorted) if (v >= c) n += 1;
      return n / sorted.length;
    }),
  };
}

/**
 * Monte Carlo of opening one sealed product.
 * @param {ReturnType<typeof createSampler>} sampler
 * @param {object} p
 * @param {number} p.packs
 * @param {number} p.sims
 * @param {number} p.seed
 * @param {Array<number|null>} [p.costs]  thresholds for P(value >= cost), e.g. [market, msrp]
 * @param {number} [p.promoValue]
 * @param {PricingOptions} [p.pricing]  needed only when promoValue > 0
 * @param {string[]} [p.chaseTiers]
 */
export function simulateProduct(sampler, { packs, sims, seed, costs = [], promoValue = 0, pricing, chaseTiers = [] }) {
  const rng = mulberry32(seed);
  const chase = new Set(chaseTiers);
  const chaseGroup = sampler.groups.map((g) => g.tier != null && chase.has(g.tier));
  const promoG = promoValue > 0 && pricing ? cardValue(promoValue, 'promo', pricing, 'gross') : 0;
  const promoN = promoValue > 0 && pricing ? cardValue(promoValue, 'promo', pricing, 'net') : 0;
  const gross = new Float64Array(sims);
  const net = new Float64Array(sims);
  let chaseHits = 0;
  for (let i = 0; i < sims; i++) {
    let tg = promoG;
    let tn = promoN;
    let hitChase = false;
    for (let k = 0; k < packs; k++) {
      for (const s of sampler.slots) {
        for (let c = 0; c < s.count; c++) {
          const u = rng();
          let gi = s.pool;
          for (let h = 0; h < s.hitCum.length; h++) {
            if (u < s.hitCum[h]) {
              gi = s.hitGroups[h];
              break;
            }
          }
          if (gi < 0) continue;
          const g = sampler.groups[gi];
          const idx = pick(g, rng);
          tg += g.gross[idx];
          tn += g.net[idx];
          if (chaseGroup[gi]) hitChase = true;
        }
      }
    }
    gross[i] = tg;
    net[i] = tn;
    if (hitChase) chaseHits += 1;
  }
  return {
    sims,
    gross: summarize(gross, costs),
    net: summarize(net, costs),
    chaseP: chaseTiers.length ? chaseHits / sims : null,
  };
}

/**
 * Graded value of one card: gemRate * PSA10 + (1 - gemRate) * PSA9 - gradingCost.
 * null when either grade price is missing.
 */
export function gradedValue(g, { gemRate, gradingCost }) {
  if (!g || g.psa10 == null || g.psa9 == null) return null;
  return gemRate * g.psa10 + (1 - gemRate) * g.psa9 - gradingCost;
}

/**
 * The N most valuable distinct hit cards (by raw price of their hit printing).
 * @returns {Array<{ card: number, variant: string, tier: string, price: number }>}
 */
export function topHitCards(model, cards, n) {
  const seen = new Set();
  const list = [];
  for (const g of model.groups) {
    if (g.kind !== 'tier') continue;
    for (const e of g.entries) {
      if (seen.has(e.card)) continue;
      const price = cards[e.card].prices[e.variant];
      if (price == null) continue;
      seen.add(e.card);
      list.push({ card: e.card, variant: e.variant, tier: g.id, price });
    }
  }
  return list.sort((a, b) => b.price - a.price).slice(0, n);
}

/**
 * Value overrides for the graded view: each of the top-N hit cards that has
 * PSA 10 and PSA 9 prices is valued at its graded value instead of raw NM.
 * @param {Record<string, { psa10?: number|null, psa9?: number|null }>} gradedByProductId
 * @returns {Map<string, number>}
 */
export function gradedOverrides(model, cards, gradedByProductId, { gemRate, gradingCost, topN }) {
  const out = new Map();
  for (const t of topHitCards(model, cards, topN)) {
    const c = cards[t.card];
    const v = gradedValue(gradedByProductId[c.productId], { gemRate, gradingCost });
    if (v != null) out.set(entryKey(c, t.variant), v);
  }
  return out;
}
