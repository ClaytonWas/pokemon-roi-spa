// Classification of tcgcsv products: card vs sealed, sealed product type,
// card tier. Pure functions, no I/O.

/** @typedef {import('./contract.js').ProductType} ProductType */

/** A product is a card when its extendedData carries both Number and Rarity. */
export function extField(product, name) {
  const f = product.extendedData?.find((e) => e.name === name);
  return f ? f.value : null;
}

export function isCard(product) {
  return extField(product, 'Number') != null && extField(product, 'Rarity') != null;
}

// Ordered: the first matching rule wins. `type: null` marks known
// non-ranked sealed items ("other") with a descriptive kind.
const SEALED_RULES = [
  { re: /^code card\b/i, type: 'other', kind: 'code-card' },
  { re: /^(\w+ )?energy( \(.*\))?$|\btoken$/i, type: 'other', kind: 'unnumbered-card' },
  { re: /\bcase\b|master carton/i, type: 'case' },
  { re: /\[set of \d+\]/i, type: 'other', kind: 'multi-pack' },
  { re: /\bdisplay\b/i, type: 'other', kind: 'display' },
  { re: /half booster box/i, type: 'other', kind: 'half-box' },
  { re: /\+/, type: 'other', kind: 'retail-bundle' },
  { re: /pok[eé]mon center elite trainer box/i, type: 'pc-etb', variantRe: /\bplus\b/i, variant: 'plus' },
  { re: /elite trainer box/i, type: 'etb', variantRe: /exclusive\)/i, variant: 'retailer-exclusive' },
  { re: /enhanced booster box/i, type: 'box', variant: 'enhanced' },
  { re: /booster box/i, type: 'box' },
  { re: /booster bundle\s*(\((lgs|retail)\))?\s*$/i, type: 'bundle', variantFrom: 2 },
  { re: /sleeved booster pack$/i, type: 'pack', variant: 'sleeved' },
  { re: /booster pack$/i, type: 'pack' },
  {
    re: /blister|build (&|and) battle|collection|\btins?\b|\bdeck\b|binder|portfolio|bundle|stadium|\bkit\b|figure|\bpin\b|poster|sticker|premium|fun pack|toolkit|calendar|sleeves|playmat|\bcoin\b|\bdice\b|\bbox\b|\bpack\b|lunch|backpack|surprise|chest/i,
    type: 'other',
    kind: 'merch',
  },
];

/**
 * Classifies a sealed product by name.
 * @param {string} name
 * @returns {{ type: ProductType|'case'|'other', variant: string|null, kind?: string } | null}  null = unclassified
 */
export function classifySealed(name) {
  for (const r of SEALED_RULES) {
    const m = name.match(r.re);
    if (!m) continue;
    let variant = r.variant && !r.variantRe ? r.variant : null;
    if (r.variantRe && r.variantRe.test(name)) variant = r.variant;
    if (r.variantFrom && m[r.variantFrom]) variant = m[r.variantFrom].toLowerCase();
    const out = { type: r.type, variant };
    if (r.kind) out.kind = r.kind;
    return out;
  }
  return null;
}

/** 'Trainer'/'Energy'/'Pokémon' from extendedData 'Card Type' (null when absent). */
export function cardKind(cardType) {
  if (!cardType) return null;
  if (/energy/i.test(cardType)) return 'energy';
  if (/supporter|item|tool|stadium|trainer/i.test(cardType)) return 'trainer';
  return 'pokemon';
}

/** Compiles rarity-map.json rules once. */
export function compileTierRules(map) {
  return {
    excluded: new Set(map.excludedTiers ?? []),
    rules: map.rules.map((r) => ({
      ...r,
      era: r.era ? new Set(r.era) : null,
      groupIds: r.groupIds ? new Set(r.groupIds.map(Number)) : null,
      nameRe: r.name ? new RegExp(r.name, 'i') : null,
      notNameRe: r.notName ? new RegExp(r.notName, 'i') : null,
      cardTypeRe: r.cardType ? new RegExp(r.cardType, 'i') : null,
    })),
  };
}

/**
 * Maps one card to its pull-rate tier.
 * @param {{ name: string, rarity: string, cardType?: string|null, subset?: string|null, groupId: number }} card
 * @param {string} era
 * @param {ReturnType<typeof compileTierRules>} compiled
 * @returns {string|null}  null = no rule matched (unmapped)
 */
export function mapTier(card, era, compiled) {
  const kind = cardKind(card.cardType);
  for (const r of compiled.rules) {
    if (r.era && !r.era.has(era)) continue;
    if (r.groupIds && !r.groupIds.has(Number(card.groupId))) continue;
    if (r.subset !== undefined) {
      if (r.subset === 'none' ? card.subset : card.subset !== r.subset) continue;
    }
    if (r.rarity !== undefined && r.rarity !== card.rarity) continue;
    if (r.nameRe && !r.nameRe.test(card.name)) continue;
    if (r.notNameRe && r.notNameRe.test(card.name)) continue;
    if (r.cardKind && r.cardKind !== kind) continue;
    if (r.cardTypeRe && !r.cardTypeRe.test(card.cardType ?? '')) continue;
    return r.tier;
  }
  return null;
}

/** Numeric part of a collector number: '166/203' -> 166, 'TG05/TG30' -> 5, 'GG70/GG70' -> 70. */
export function cardNumber(number) {
  const m = String(number ?? '').match(/^[A-Za-z]*0*(\d+)/);
  return m ? Number(m[1]) : null;
}

/** tcgcsv subTypeName -> contract variant key: 'Reverse Holofoil' -> 'reverseHolofoil'. */
export function variantKey(subTypeName) {
  const words = String(subTypeName).replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/);
  return words.map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())).join('');
}

const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13 };

/**
 * Pack count stated in a sealed product's CardText ("9 ... booster packs", "six booster packs").
 * The words between the count and "booster packs" may not contain digits or sentence breaks,
 * so "151 expansion! ... six booster packs" yields 6, not 151, except inside a
 * "Pokémon TCG: <set name>" phrase, so "9 Pokémon TCG: Scarlet & Violet—151 booster packs" yields 9.
 * @returns {number|null}
 */
export function parsePackCount(cardText) {
  if (!cardText) return null;
  const text = cardText.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ');
  const re = /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen)\s+(?:Pok[eé]mon TCG:[^.!?•]{0,80}?|[^.!?•\d]{0,80}?)booster packs\b/gi;
  const m = re.exec(text);
  if (!m) return null;
  const raw = m[1].toLowerCase();
  return NUMBER_WORDS[raw] ?? Number(raw);
}
