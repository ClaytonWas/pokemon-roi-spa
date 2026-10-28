// Display helpers shared by both pages.

export const DASH = '—';

export function money(usd, currency, usdCad) {
  if (usd == null || !Number.isFinite(usd)) return DASH;
  const v = currency === 'CAD' ? usd * usdCad : usd;
  return `${currency === 'CAD' ? 'CA$' : '$'}${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** A value already in the target currency (e.g. a CAD MSRP). */
export function moneyIn(value, currency) {
  if (value == null || !Number.isFinite(value)) return DASH;
  return `${currency === 'CAD' ? 'CA$' : '$'}${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** ROI ratio -> percent like casecalculator (100% = break-even). */
export const pct = (ratio, digits = 1) => (ratio == null || !Number.isFinite(ratio) ? DASH : `${(ratio * 100).toFixed(digits)}%`);

export function odds(p) {
  if (p == null || !Number.isFinite(p) || p <= 0) return DASH;
  return p >= 0.5 ? `${(p * 100).toFixed(1)}%` : `1 in ${Math.round(1 / p).toLocaleString()}`;
}

export const productUrl = (productId) => `https://www.tcgplayer.com/product/${productId}`;
export const imageUrl = (productId) => `https://tcgplayer-cdn.tcgplayer.com/product/${productId}_200w.jpg`;

export const TYPE_LABEL = { pack: 'Booster Pack', box: 'Booster Box', etb: 'Elite Trainer Box', 'pc-etb': 'Pokémon Center ETB', bundle: 'Booster Bundle' };

export function pullLabel(pd) {
  if (!pd || pd.status === 'none') return 'no pull data';
  if (pd.status === 'estimated') return 'estimated';
  const n = pd.packsOpened ? `${pd.packsOpened.toLocaleString()}+ packs` : 'measured';
  return pd.estimatedTiers?.length ? `${n} (some tiers est.)` : n;
}

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null) node.append(c instanceof Node ? c : String(c));
  return node;
}
