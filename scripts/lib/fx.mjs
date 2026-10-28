// USD->CAD rate, fetched once per build and baked into index.json.
// Why build time rather than in the browser: prices only change once a day,
// so a daily rate is as fresh as the data it converts; every viewer sees the
// same numbers the build validated; and the page makes no third-party calls.

export async function getUsdCad(fxCfg, previous, userAgent) {
  try {
    const res = await fetch(fxCfg.url, { headers: { 'User-Agent': userAgent } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    const obs = body.observations?.at(-1);
    const rate = Number(obs?.FXUSDCAD?.v);
    if (!(rate > 0.5 && rate < 3)) throw new Error(`implausible rate ${obs?.FXUSDCAD?.v}`);
    return { usdCad: rate, date: obs.d, source: 'Bank of Canada Valet FXUSDCAD' };
  } catch (err) {
    if (previous?.usdCad) return { ...previous, source: `${previous.source} (reused: fetch failed: ${err.message})` };
    return { usdCad: fxCfg.fallbackUsdCad, date: null, source: `config fallback (fetch failed: ${err.message})` };
  }
}
