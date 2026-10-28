// IndexedDB cache for graded quotes with a TTL (default 7 days), so
// re-viewing a set doesn't spend API credits. If IndexedDB is unavailable
// every call degrades to a cache miss.

const DB = 'pokeroi-graded';
const STORE = 'quotes';

function open() {
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch (err) {
      reject(err);
    }
  });
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(out?.result);
    t.onerror = () => reject(t.error);
  });
}

export async function getCached(provider, productId, ttlDays) {
  try {
    const hit = await tx('readonly', (s) => s.get(`${provider}:${productId}`));
    if (hit && Date.now() - Date.parse(hit.fetchedAt) < ttlDays * 86400000) return hit;
  } catch {}
  return null;
}

export async function putCached(provider, productId, quote) {
  try {
    await tx('readwrite', (s) => s.put(quote, `${provider}:${productId}`));
  } catch {}
}

export async function clearCache() {
  try {
    await tx('readwrite', (s) => s.clear());
  } catch {}
}
