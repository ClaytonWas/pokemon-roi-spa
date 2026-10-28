// Seeded PRNG so Monte Carlo results are stable between builds and between
// Node and the browser. mulberry32 is small, fast and good enough for
// sampling (not for cryptography).

/** @param {number} seed 32-bit integer seed. @returns {() => number} uniform in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Derives a stable 32-bit seed from any mix of strings and numbers (FNV-1a). */
export function hashSeed(...parts) {
  let h = 0x811c9dc5;
  for (const ch of parts.join('|')) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
