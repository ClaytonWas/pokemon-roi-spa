// Graded-price provider interface. The app never depends on a specific
// provider: set.js asks the registry for one by id, and every provider
// returns the same GradedQuote shape. To add one (e.g. a PriceCharting
// token-based client), implement GradedProvider in a new module and add it
// to PROVIDERS. Providers run in the viewer's browser with the viewer's key.

/** @typedef {import('./quote.js').GradedQuote} GradedQuote */

/**
 * @typedef {Object} GradedProvider
 * @property {string} id
 * @property {string} label
 * @property {string} defaultBaseUrl
 * @property {string} keyHelp      where the user gets a key
 * @property {(card: { productId: number, name: string, number: string }, opts: { apiKey: string, baseUrl: string, signal?: AbortSignal }) => Promise<GradedQuote|null>} fetchQuote
 */

import { pokemonPriceTracker } from './pokemonpricetracker.js';

/** @type {Record<string, GradedProvider>} */
export const PROVIDERS = {
  [pokemonPriceTracker.id]: pokemonPriceTracker,
};
