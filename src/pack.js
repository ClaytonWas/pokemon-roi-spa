// Builds the PackModel: the resolved, self-contained description of one
// booster pack that both the analytical EV and the Monte Carlo consume.
// Pure and dependency-free so it runs unchanged in Node and the browser.

/** @typedef {import('./contract.js').CardRecord} CardRecord */
/** @typedef {import('./contract.js').PackModel} PackModel */
/** @typedef {import('./contract.js').PackGroup} PackGroup */
/** @typedef {import('./contract.js').TierOdds} TierOdds */

/**
 * @param {object} input
 * @param {CardRecord[]} input.cards
 * @param {Record<string, TierOdds>} input.tiers   tier -> per-pack odds (odds null = unknown rate)
 * @param {{ id: string, cardsPerPack: number, slots: Array<{ id: string, count: number, pool: string|null, hits?: string[] }> }} input.layout
 * @param {Record<string, { tiers: string[], variants: string[], anyVariantTiers?: string[] }>} input.pools
 * @param {string[]} input.hitVariants   price-variant preference for hit cards
 * @param {Record<string, string>} [input.tierSlots]   tier -> slot id override
 * @param {Record<string, number>} [input.cardOverrides]  productId -> per-pack odds
 * @returns {{ model: PackModel, issues: string[], unrated: Array<{ tier: string, cards: number }> }}
 */
export function buildPackModel({ cards, tiers, layout, pools, hitVariants, tierSlots = {}, cardOverrides = {} }) {
  const issues = [];
  const rated = Object.entries(tiers).filter(([, t]) => typeof t?.odds === 'number' && t.odds > 0);
  const ratedSet = new Set(rated.map(([name]) => name));

  // Resolve which slot each rated tier lives in.
  const slots = layout.slots.map((s) => ({ id: s.id, count: s.count, pool: s.pool ?? null, hits: [] }));
  const slotById = new Map(slots.map((s) => [s.id, s]));
  const layoutSlotOf = new Map();
  for (const s of layout.slots) for (const t of s.hits ?? []) layoutSlotOf.set(t, s.id);

  const cardsByTier = new Map();
  cards.forEach((c, i) => {
    if (!c.tier) return;
    if (!cardsByTier.has(c.tier)) cardsByTier.set(c.tier, []);
    cardsByTier.get(c.tier).push(i);
  });

  /** @type {PackGroup[]} */
  const groups = [];
  for (const [tier, t] of rated) {
    const members = cardsByTier.get(tier) ?? [];
    if (members.length === 0) {
      issues.push(`tier "${tier}" has odds ${t.odds} but no cards mapped to it; its share goes to the slot filler`);
      continue;
    }
    let slotId = tierSlots[tier] ?? layoutSlotOf.get(tier);
    let slot = slotId ? slotById.get(slotId) : undefined;
    if (!slot) {
      slotId = `extra:${tier}`;
      issues.push(`tier "${tier}" is not placed in any slot of layout "${layout.id}"; modeled as an independent extra slot`);
      slot = { id: slotId, count: 1, pool: null, hits: [] };
      slots.push(slot);
      slotById.set(slotId, slot);
    }
    if (slot.count !== 1) {
      issues.push(`tier "${tier}" is placed in slot "${slot.id}" with count ${slot.count}; per-pack odds need a count-1 slot`);
      continue;
    }

    const entries = [];
    let noRows = 0;
    for (const ci of members) {
      // A card with no price rows yet still occupies its share of the tier
      // (keeping p_card right); it is valued at the bulk rate until priced.
      let variant = hitVariants.find((v) => v in cards[ci].prices) ?? Object.keys(cards[ci].prices)[0];
      if (!variant) {
        noRows += 1;
        variant = hitVariants[0];
      }
      entries.push({ card: ci, variant, w: 0 });
    }
    if (noRows) issues.push(`${noRows} card(s) in tier "${tier}" have no TCGplayer price rows yet; valued at the bulk rate`);
    assignWeights(entries, cards, t.odds, cardOverrides, tier, issues);
    slot.hits.push({ tier, p: t.odds });
    groups.push({ key: `tier:${tier}`, kind: 'tier', id: tier, slot: slot.id, rate: t.odds, entries });
  }

  // Filler probability per slot, then the pools that fill them.
  for (const s of slots) {
    const sum = s.hits.reduce((a, h) => a + h.p, 0);
    if (sum > 1 + 1e-9) {
      issues.push(`slot "${s.id}" hit odds sum to ${sum.toFixed(4)} > 1; scaled down to 1`);
      for (const h of s.hits) {
        h.p /= sum;
        const g = groups.find((x) => x.key === `tier:${h.tier}`);
        if (g) g.rate = h.p;
      }
    }
    s.fillerP = Math.max(0, 1 - s.hits.reduce((a, h) => a + h.p, 0));
  }

  const poolRate = new Map();
  for (const s of slots) {
    if (!s.pool) continue;
    poolRate.set(s.pool, (poolRate.get(s.pool) ?? 0) + s.count * s.fillerP);
  }
  for (const [poolId, rate] of poolRate) {
    const def = pools[poolId];
    if (!def) {
      issues.push(`layout "${layout.id}" references unknown pool "${poolId}"`);
      continue;
    }
    const tierSet = new Set(def.tiers);
    const anyVariant = new Set(def.anyVariantTiers ?? []);
    const entries = [];
    cards.forEach((c, ci) => {
      if (!tierSet.has(c.tier) || ratedSet.has(c.tier)) return;
      const prefs = anyVariant.has(c.tier) ? [...def.variants, ...hitVariants] : def.variants;
      const variant = prefs.find((v) => v in c.prices);
      if (variant) entries.push({ card: ci, variant, w: 0 });
    });
    if (entries.length === 0) {
      if (rate > 0) issues.push(`pool "${poolId}" is empty; its slots contribute nothing`);
      continue;
    }
    for (const e of entries) e.w = 1 / entries.length;
    groups.push({ key: `pool:${poolId}`, kind: 'pool', id: poolId, slot: null, rate, entries });
  }

  // Cards that are neither in a rated tier nor in any pool: unknown odds.
  const inModel = new Set();
  for (const g of groups) for (const e of g.entries) inModel.add(e.card);
  const unratedCount = new Map();
  cards.forEach((c, ci) => {
    if (inModel.has(ci) || !c.tier) return;
    unratedCount.set(c.tier, (unratedCount.get(c.tier) ?? 0) + 1);
  });
  const unrated = [...unratedCount].map(([tier, n]) => ({ tier, cards: n }));

  return {
    model: { layoutId: layout.id, cardsPerPack: layout.cardsPerPack, slots, groups },
    issues,
    unrated,
  };
}

function assignWeights(entries, cards, tierOdds, cardOverrides, tier, issues) {
  let fixed = 0;
  let free = 0;
  for (const e of entries) {
    const o = cardOverrides[cards[e.card].productId];
    if (typeof o === 'number') {
      e.w = o / tierOdds;
      fixed += e.w;
    } else {
      free += 1;
    }
  }
  if (fixed > 1 + 1e-9) {
    issues.push(`per-card overrides in tier "${tier}" exceed the tier odds; scaled down`);
    for (const e of entries) if (e.w > 0) e.w /= fixed;
    fixed = 1;
  }
  const share = free > 0 ? (1 - fixed) / free : 0;
  for (const e of entries) {
    if (typeof cardOverrides[cards[e.card].productId] !== 'number') e.w = share;
  }
}
