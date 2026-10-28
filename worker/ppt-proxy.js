// Optional Cloudflare Worker: CORS passthrough for pokemonpricetracker.com.
// Their API answers the browser's OPTIONS preflight with 401, so browsers
// cannot call it directly. This Worker answers the preflight itself and
// forwards GETs under /api/v2/ with the caller's own Authorization header.
// It stores nothing, logs nothing, and holds no key of its own.
// Set ALLOWED_ORIGINS (comma-separated) to your Pages origin; "*" allows any.

const UPSTREAM = 'https://www.pokemonpricetracker.com';
const PASS = ['Content-Type', 'X-RateLimit-Daily-Remaining', 'X-RateLimit-Minute-Remaining', 'X-API-Calls-Consumed'];

export default {
  async fetch(request, env = {}) {
    const origin = request.headers.get('Origin') ?? '';
    const allowed = (env.ALLOWED_ORIGINS ?? '*').split(',').map((s) => s.trim());
    const allowOrigin = allowed.includes('*') ? '*' : allowed.includes(origin) ? origin : null;
    const cors = { 'Access-Control-Allow-Origin': allowOrigin ?? 'null', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization', 'Access-Control-Expose-Headers': PASS.slice(1).join(', '), 'Access-Control-Max-Age': '86400', Vary: 'Origin' };
    if (!allowOrigin) return new Response('origin not allowed', { status: 403, headers: cors });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url);
    if (request.method !== 'GET' || !url.pathname.startsWith('/api/v2/')) return new Response('not found', { status: 404, headers: cors });
    const auth = request.headers.get('Authorization');
    if (!auth) return new Response('missing Authorization header', { status: 401, headers: cors });
    const upstream = await fetch(UPSTREAM + url.pathname + url.search, { headers: { Authorization: auth, Accept: 'application/json' } });
    const headers = new Headers({ ...cors, 'Cache-Control': 'no-store' });
    for (const h of PASS) if (upstream.headers.get(h)) headers.set(h, upstream.headers.get(h));
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};
