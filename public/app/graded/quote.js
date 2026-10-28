/**
 * @typedef {Object} GradedQuote  USD prices; any may be null.
 * @property {number|null} psa10
 * @property {number|null} psa9
 * @property {number|null} cgc10
 * @property {number|null} bgs95
 * @property {number|null} sgc10
 * @property {string} provider
 * @property {string} fetchedAt  ISO timestamp
 */

/** @returns {GradedQuote} */
export const emptyQuote = (provider) => ({ psa10: null, psa9: null, cgc10: null, bgs95: null, sgc10: null, provider, fetchedAt: new Date().toISOString() });
