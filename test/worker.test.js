import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/ppt-proxy.js';
import { parseQuote } from '../public/app/graded/pokemonpricetracker.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test('worker answers the CORS preflight itself (the API returns 401 to it)', async () => {
  const res = await worker.fetch(new Request('https://proxy.test/api/v2/cards?tcgPlayerId=1', { method: 'OPTIONS', headers: { Origin: 'https://me.github.io' } }));
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
  assert.match(res.headers.get('Access-Control-Allow-Headers'), /Authorization/);
});

test('worker forwards only the caller key and only /api/v2/ GETs', async () => {
  let seen;
  globalThis.fetch = async (url, init) => {
    seen = { url, auth: init.headers.Authorization };
    return new Response('{"data":[]}', { status: 200, headers: { 'Content-Type': 'application/json', 'X-RateLimit-Daily-Remaining': '98', 'Set-Cookie': 'x=1' } });
  };
  const res = await worker.fetch(new Request('https://proxy.test/api/v2/cards?tcgPlayerId=5&includeEbay=true', { headers: { Authorization: 'Bearer k', Origin: 'https://me.github.io', Cookie: 'c=1' } }), { ALLOWED_ORIGINS: 'https://me.github.io' });
  assert.equal(res.status, 200);
  assert.equal(seen.url, 'https://www.pokemonpricetracker.com/api/v2/cards?tcgPlayerId=5&includeEbay=true');
  assert.equal(seen.auth, 'Bearer k');
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://me.github.io');
  assert.equal(res.headers.get('X-RateLimit-Daily-Remaining'), '98');
  assert.equal(res.headers.get('Set-Cookie'), null);

  assert.equal((await worker.fetch(new Request('https://proxy.test/other', { headers: { Authorization: 'Bearer k' } }))).status, 404);
  assert.equal((await worker.fetch(new Request('https://proxy.test/api/v2/cards'))).status, 401);
  const blocked = await worker.fetch(new Request('https://proxy.test/api/v2/cards', { headers: { Origin: 'https://evil.test', Authorization: 'Bearer k' } }), { ALLOWED_ORIGINS: 'https://me.github.io' });
  assert.equal(blocked.status, 403);
});

test('graded quote parser accepts the documented and flat shapes', () => {
  const documented = { data: [{ ebay: { salesByGrade: { psa10: { count: 353, medianPrice: 1125 }, psa9: { medianPrice: 400, smartMarketPrice: 410 }, 'BGS 9.5': { averagePrice: 700 } } } }] };
  const q = parseQuote(documented);
  assert.equal(q.psa10, 1125);
  assert.equal(q.psa9, 410); // smartMarketPrice preferred
  assert.equal(q.bgs95, 700);
  assert.equal(q.cgc10, null);
  const flat = parseQuote({ data: { gradedPrices: { psa10: 300, psa9: 120 } } });
  assert.equal(flat.psa10, 300);
  assert.equal(flat.psa9, 120);
  assert.equal(parseQuote({ data: [] }), null);
});
