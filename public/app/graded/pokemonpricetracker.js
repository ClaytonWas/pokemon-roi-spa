// pokemonpricetracker.com API v2 (eBay sold listings for PSA/CGC/BGS/SGC).
// GET /api/v2/cards?tcgPlayerId=<productId>&includeEbay=true
// Authorization: Bearer <key>. Costs 2 credits per card (card + eBay data);
// the free tier has 100 credits/day.
//
// CORS: the API sends Access-Control-Allow-Origin: *, but answers the
// browser's OPTIONS preflight with 401 (verified 2026-10-27), so direct
// browser calls fail. Point baseUrl at the optional Worker in /worker.
//
// The docs publish only a partial response schema (ebay.salesByGrade.psa10
// .{count, medianPrice}); the parser below accepts the documented shape and
// the flat variants seen in their examples.

import { emptyQuote } from './quote.js';

const GRADE_KEYS = { psa10: 'psa10', psa9: 'psa9', cgc10: 'cgc10', bgs95: 'bgs95', sgc10: 'sgc10' };

export const pokemonPriceTracker = {
  id: 'pokemonpricetracker',
  label: 'PokemonPriceTracker (eBay sold)',
  defaultBaseUrl: 'https://www.pokemonpricetracker.com',
  keyHelp: 'https://www.pokemonpricetracker.com/pokemon-trading-card-api',

  async fetchQuote(card, { apiKey, baseUrl, signal }) {
    const url = `${baseUrl.replace(/\/$/, '')}/api/v2/cards?tcgPlayerId=${encodeURIComponent(card.productId)}&includeEbay=true`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` }, signal });
    if (res.status === 401 || res.status === 403) throw new Error('API key rejected (401/403)');
    if (res.status === 429) throw new Error('rate limit or daily credits exhausted (429)');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseQuote(await res.json(), this.id);
  },
};

/** Exported for tests and for reuse by a future provider with a similar shape. */
export function parseQuote(body, providerId = 'pokemonpricetracker') {
  const data = body?.data ?? body;
  const cardObj = Array.isArray(data) ? data[0] : data;
  if (!cardObj) return null;
  const ebay = cardObj.ebay ?? {};
  const grades = ebay.salesByGrade ?? ebay.gradedPrices ?? cardObj.gradedPrices ?? ebay;
  const q = emptyQuote(providerId);
  for (const [rawKey, value] of Object.entries(grades ?? {})) {
    const k = GRADE_KEYS[rawKey.toLowerCase().replace(/[^a-z0-9]/g, '')];
    if (!k) continue;
    q[k] = priceOf(value);
  }
  return q;
}

function priceOf(v) {
  if (typeof v === 'number') return v;
  if (!v || typeof v !== 'object') return null;
  for (const f of ['smartMarketPrice', 'medianPrice', 'marketPrice7Day', 'averagePrice', 'avg', 'price']) {
    const x = Number(v[f]);
    if (Number.isFinite(x) && x > 0) return x;
  }
  return null;
}
