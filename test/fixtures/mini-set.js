// A tiny set whose EV is computed by hand in test/ev.test.js.
export const cards = [
  { productId: 1, name: 'C1', tier: 'Common', prices: { normal: 0.1, reverseHolofoil: 0.5 } },
  { productId: 2, name: 'C2', tier: 'Common', prices: { normal: 2.0, reverseHolofoil: 3.0 } },
  { productId: 3, name: 'U1', tier: 'Uncommon', prices: { normal: 0.2, reverseHolofoil: 1.5 } },
  { productId: 4, name: 'R1', tier: 'Rare', prices: { holofoil: 0.4, reverseHolofoil: 0.6 } },
  { productId: 5, name: 'DR1', tier: 'Double Rare', prices: { holofoil: 5.0 } },
  { productId: 6, name: 'DR2', tier: 'Double Rare', prices: { holofoil: 1.0 } },
  { productId: 7, name: 'SIR1', tier: 'Special Illustration Rare', prices: { holofoil: 100.0 } },
  { productId: 8, name: 'IR1', tier: 'Illustration Rare', prices: { holofoil: 10.0 } },
];

export const tiers = {
  'Double Rare': { odds: 0.2 },
  'Illustration Rare': { odds: 0.1 },
  'Special Illustration Rare': { odds: 0.02 },
};

export const layout = {
  id: 'mini',
  cardsPerPack: 6,
  slots: [
    { id: 'common', count: 2, pool: 'common' },
    { id: 'uncommon', count: 1, pool: 'uncommon' },
    { id: 'reverse', count: 1, pool: 'reverse', hits: ['Illustration Rare', 'Special Illustration Rare'] },
    { id: 'rare', count: 1, pool: 'rare', hits: ['Double Rare'] },
  ],
};

export const pools = {
  common: { tiers: ['Common'], variants: ['normal'] },
  uncommon: { tiers: ['Uncommon'], variants: ['normal'] },
  rare: { tiers: ['Rare'], variants: ['holofoil', 'normal'] },
  reverse: { tiers: ['Common', 'Uncommon', 'Rare'], variants: ['reverseHolofoil'] },
};

export const hitVariants = ['holofoil', 'normal', 'reverseHolofoil'];

export const pricing = {
  bulkThreshold: 1.0,
  bulkRatePerCard: 0.01,
  sellFeePct: 0.1,
  perCardShipping: 0.5,
  netFloorAtBulkRate: false,
};
