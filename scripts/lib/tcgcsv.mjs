// Polite tcgcsv.com client: strictly sequential requests, a fixed delay
// between them, a descriptive User-Agent, and retry with backoff on 429/5xx.
// tcgcsv asks for ~100 ms between requests and one sync per day.
// Optional on-disk cache (keyed by tcgcsv's last-updated stamp) so local
// re-runs during development don't re-download anything.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createTcgcsvClient({ base, categoryId, userAgent, requestDelayMs, retries }, { cacheDir = null } = {}) {
  let lastRequestAt = 0;
  let requests = 0;
  let cacheKey = null;

  async function fetchOnce(path, asText) {
    const wait = lastRequestAt + requestDelayMs - Date.now();
    if (wait > 0) await sleep(wait);
    for (let attempt = 0; ; attempt += 1) {
      lastRequestAt = Date.now();
      requests += 1;
      try {
        const res = await fetch(base + path, { headers: { 'User-Agent': userAgent, Accept: asText ? 'text/plain' : 'application/json' } });
        if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status} for ${path}`);
        if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status} for ${path}`), { permanent: true });
        const body = asText ? (await res.text()).trim() : await res.json();
        if (!asText && body.success === false) throw Object.assign(new Error(`tcgcsv error for ${path}: ${JSON.stringify(body.errors)}`), { permanent: true });
        return body;
      } catch (err) {
        if (err.permanent || attempt >= retries) throw err;
        await sleep(2000 * 2 ** attempt);
      }
    }
  }

  async function cached(path) {
    if (!cacheDir || !cacheKey) return fetchOnce(path, false);
    const file = join(cacheDir, cacheKey, path.replace(/[^a-z0-9]+/gi, '_') + '.json');
    try {
      return JSON.parse(await readFile(file, 'utf8'));
    } catch {
      const body = await fetchOnce(path, false);
      await mkdir(join(cacheDir, cacheKey), { recursive: true });
      await writeFile(file, JSON.stringify(body));
      return body;
    }
  }

  return {
    get requests() {
      return requests;
    },
    /** tcgcsv's build marker, e.g. '2026-10-27T20:05:13+0000'. Always fetched live. */
    async lastUpdated() {
      const stamp = await fetchOnce('/last-updated.txt', true);
      cacheKey = stamp.replace(/[^0-9T]/g, '');
      return stamp;
    },
    groups: async () => (await cached(`/tcgplayer/${categoryId}/groups`)).results,
    products: async (groupId) => (await cached(`/tcgplayer/${categoryId}/${groupId}/products`)).results,
    prices: async (groupId) => (await cached(`/tcgplayer/${categoryId}/${groupId}/prices`)).results,
  };
}
