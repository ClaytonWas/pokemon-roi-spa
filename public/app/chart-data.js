// Pure data shaping for the charts page. No DOM, no fetch, no imports:
// everything here takes already-loaded contract JSON/CSV and returns plain
// rows, so it is unit-tested in Node (test/charts.test.js) and the page only draws.

/** history/sealed.csv -> [{ date, groupId, productType, marketPrice, evPerPack }] (empty cells -> null). */
export function parseHistory(csv) {
  const num = (s) => (s === '' || s == null ? null : Number(s));
  return csv
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .filter(Boolean)
    .map((line) => {
      const [date, groupId, productType, marketPrice, evPerPack] = line.split(',');
      return { date, groupId: Number(groupId), productType, marketPrice: num(marketPrice), evPerPack: num(evPerPack) };
    });
}

/**
 * Gross EV per pack per set and date, from the nightly history (sealed.csv repeats it per
 * product type; one row per set and date is kept).
 * @param {Map<number, { setName: string, era: string, releaseDate: string }>} setsById
 * @returns {Array<{ date, groupId, setName, era, releaseDate, evPerPack }>}  sorted by set, then date
 */
export function evPerPackSeries(history, setsById) {
  const byKey = new Map();
  for (const h of history) if (h.evPerPack != null && setsById.has(h.groupId)) byKey.set(`${h.groupId}|${h.date}`, { date: h.date, groupId: h.groupId, evPerPack: h.evPerPack, ...setsById.get(h.groupId) });
  return [...byKey.values()].sort((a, b) => a.groupId - b.groupId || a.date.localeCompare(b.date));
}

const DAY_MS = 86400000;
const daysBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / DAY_MS;

/**
 * Inserts a break row (key = NaN) wherever consecutive points of one series are more than
 * maxGapDays apart, so a line chart doesn't draw a straight bridge across missing data.
 * Rows must be sorted by series, then date.
 */
export function breakGaps(rows, key, maxGapDays, seriesKey = 'groupId') {
  const out = [];
  for (let i = 0; i < rows.length; i += 1) {
    const prev = rows[i - 1];
    if (prev && prev[seriesKey] === rows[i][seriesKey] && daysBetween(prev.date, rows[i].date) > maxGapDays) {
      out.push({ ...prev, date: new Date(Date.parse(prev.date) + DAY_MS).toISOString().slice(0, 10), [key]: NaN, gap: true });
    }
    out.push(rows[i]);
  }
  return out;
}

/** Median of `valueKey` per distinct `xKey` (NaN/null ignored), sorted by x. */
export function medianBy(rows, xKey, valueKey) {
  const byX = new Map();
  for (const r of rows) {
    if (!byX.has(r[xKey])) byX.set(r[xKey], []);
    byX.get(r[xKey]).push(r[valueKey]);
  }
  return [...byX]
    .map(([x, v]) => ({ [xKey]: x, [valueKey]: median(v) }))
    .filter((r) => r[valueKey] != null)
    .sort((a, b) => (a[xKey] < b[xKey] ? -1 : a[xKey] > b[xKey] ? 1 : 0));
}

export function median(values) {
  const v = values.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** Per-date median of `key` across rows. */
export const medianByDate = (rows, key) => medianBy(rows, 'date', key);

// Tier families for "where the EV comes from". Fixed order = stack order =
// categorical slot order; folding ~30 era-specific tiers into five keeps the
// stack legible (<= 6 classes) and makes eras comparable.
export const FAMILIES = ['SIR & alt art', 'Illustration Rare', 'Hyper, gold & secret', 'Ultra & Double Rare', 'Specials & galleries', 'Bulk & filler'];
const FAMILY_OF = {
  'Special Illustration Rare': 0,
  'Alt Art V': 0,
  'Alt Art VMAX': 0,
  'Illustration Rare': 1,
  'Hyper Rare': 2,
  'Mega Hyper Rare': 2,
  'Gold Rare': 2,
  'Rainbow Rare': 2,
  'Secret Rare': 2,
  'GG Gold': 2,
  'TG Gold': 2,
  'Futuristic Rare': 2,
  'Black White Rare': 2,
  'RGB Rare': 2,
  'Double Rare': 3,
  'Ultra Rare': 3,
  V: 3,
  'VMAX/VSTAR': 3,
  'Full Art V': 3,
  'Full Art Trainer': 3,
  'Full Art': 3,
  'Mega Attack Rare': 3,
  'Texture Energy': 3,
};

/** 'tier:Double Rare' | 'pool:reverse' -> family name. Unknown tiers count as specials. */
export function familyOf(groupKey) {
  if (groupKey.startsWith('pool:')) return FAMILIES[5];
  return FAMILIES[FAMILY_OF[groupKey.slice(5)] ?? 4];
}

/**
 * Pack EV split by family.
 * @param {Array<{ key: string, gross: number, net: number }>} byGroup  from src/ev.js packEV()
 * @returns {Array<{ family: string, value: number }>}  USD per pack, one row per family in FAMILIES order
 */
export function evComposition(byGroup, basis = 'gross') {
  const sums = new Map(FAMILIES.map((f) => [f, 0]));
  for (const g of byGroup) sums.set(familyOf(g.key), sums.get(familyOf(g.key)) + g[basis]);
  return FAMILIES.map((family) => ({ family, value: sums.get(family) }));
}

