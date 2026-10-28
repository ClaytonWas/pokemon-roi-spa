// JSDoc typedefs for the published JSON contract (public/data/**).
// This file has no runtime code besides CONTRACT_VERSION; it exists so
// editors and `// @ts-check` users get types, and so DATA_CONTRACT.md has a
// single source to mirror. Bump CONTRACT_VERSION on any breaking change.
// URLs are not stored: product page = https://www.tcgplayer.com/product/{productId},
// image = https://tcgplayer-cdn.tcgplayer.com/product/{productId}_200w.jpg

export const CONTRACT_VERSION = 1;

/** @typedef {'pack'|'box'|'etb'|'pc-etb'|'bundle'} ProductType  Ranked sealed product types. */
/** @typedef {'me'|'sv'|'swsh'} Era */

/**
 * @typedef {Object} PricingOptions  Raw-valuation assumptions (config/assumptions.json -> pricing).
 * @property {number} bulkThreshold       cards priced below this are valued at the bulk rate (USD)
 * @property {number} bulkRatePerCard     USD per bulk card
 * @property {Record<string, number>} [bulkRateByGroup]  per tier name / pool id override
 * @property {number} sellFeePct          marketplace fee fraction for net EV
 * @property {number} perCardShipping     USD subtracted per card above the threshold for net EV
 * @property {boolean} [netFloorAtBulkRate]
 */

/**
 * @typedef {Object} PullData  Where a set's odds came from.
 * @property {'measured'|'none'} status   'measured' = a TCGplayer study measured every tier with cards and every hit card has a market price; 'none' = no such study, EV withheld (see basis), or no card list (EV fields are null)
 * @property {number|null} packsOpened   sample size (lower bound, sources say "more than N"); null unless measured
 * @property {string|null} source        source URL
 * @property {string|null} publisher
 * @property {string|null} date          YYYY-MM-DD of the study
 * @property {string|null} basis         why EV is missing, when the build withheld it
 * @property {string[]} estimatedTiers   always empty: estimates are never published (kept for compatibility)
 * @property {string[]} unknownTiers     tiers with cards but no measured odds; non-empty means EV was withheld
 */

/**
 * @typedef {Object} McSummary  Monte Carlo of opening one product.
 * @property {number} mean
 * @property {number} median
 * @property {number} p5
 * @property {number} p95
 * @property {number|null} pProfitMarket   P(opened value >= sealed market price)
 * @property {number|null} pProfitMsrp     P(opened value >= USD MSRP)
 * @property {number|null} pProfitMsrpCad  P(opened value in CAD >= CAD MSRP)
 */

/**
 * @typedef {Object} IndexRow  One set x product row of public/data/index.json.
 * @property {number} groupId
 * @property {string} setName
 * @property {string} setCode
 * @property {Era} era
 * @property {string} releaseDate   YYYY-MM-DD
 * @property {boolean} presale      release date is in the future
 * @property {ProductType} productType
 * @property {number} productId     TCGplayer productId of the chosen product
 * @property {string} productName
 * @property {number} packs
 * @property {number|null} marketPrice  TCGplayer market price, USD
 * @property {{ usd: number|null, cad: number|null, usdConfidence: string|null, cadConfidence: string|null }} msrp  official list prices only ('list'); null when unverified
 * @property {{ gross: number, net: number }|null} ev         product EV, USD (raw NM). null without measured pull data or when the listing doesn't state the pack count
 * @property {{ gross: number, net: number }|null} evPerPack
 * @property {{ market: number|null, msrp: number|null, msrpCad: number|null }|null} roi  ratios on gross EV (1 = break-even)
 * @property {{ gross: McSummary, net: McSummary, sims: number }|null} sim
 * @property {{ tiers: string[], p: number }|null} chase   P(>=1 card of the chase tiers) in this product
 * @property {{ name: string, tier: string, price: number, productId: number }|null} topHit
 * @property {PullData} pullData
 */

/**
 * @typedef {Object} IndexFile  public/data/index.json
 * @property {number} contractVersion
 * @property {{ generatedAt: string, tcgcsvLastUpdated: string, fx: { usdCad: number, date: string|null, source: string },
 *              assumptions: object, eras: Record<string, { name: string }>, productTypes: ProductType[] }} meta
 * @property {IndexRow[]} rows
 */

/**
 * @typedef {Object} CardRecord  One card printing (TCGplayer product) in a set detail file.
 * @property {number} productId
 * @property {string} name
 * @property {string} number        collector number as printed, e.g. '166/203'
 * @property {string} rarity        TCGplayer rarity string
 * @property {string|null} tier     pull-rate tier (null = unmapped)
 * @property {string|null} subset   'Trainer Gallery' etc. when the card comes from a subset group
 * @property {number} sourceGroupId tcgcsv group the card is listed under
 * @property {string|null} cardType
 * @property {Record<string, number|null>} prices   variant -> USD TCGplayer market price (null when TCGplayer has none)
 * @property {string[]} [priceFallback]  only if config enables a low/mid fallback (it doesn't): variants whose price is not the market price
 */

/**
 * @typedef {Object} TierOdds
 * @property {number} odds    measured probability that a pack contains a card of this tier
 * @property {number} [ci95]
 * @property {number} [expectedCards]
 */

/**
 * @typedef {Object} PackGroup  A set of interchangeable model entries: one hit tier or one filler pool.
 * @property {string} key      'tier:<name>' | 'pool:<id>'
 * @property {'tier'|'pool'} kind
 * @property {string} id       tier name or pool id
 * @property {string|null} slot  slot id (tiers only)
 * @property {number} rate     expected cards from this group per pack (tier: its odds; pool: sum of filler slots)
 * @property {Array<{ card: number, variant: string, w: number }>} entries  card = index into SetDetail.cards; w = share within the group (sums to 1)
 */

/**
 * @typedef {Object} PackModel
 * @property {string} layoutId
 * @property {number} cardsPerPack
 * @property {Array<{ id: string, count: number, pool: string|null, fillerP: number, hits: Array<{ tier: string, p: number }> }>} slots
 * @property {PackGroup[]} groups
 */

/**
 * @typedef {Object} SetProduct  A sealed product in a set detail file.
 * @property {number} productId
 * @property {string} name
 * @property {ProductType|'case'|'other'} type
 * @property {string|null} variant
 * @property {string|null} kind
 * @property {boolean} canonical   true for the one product per ranked type used in index.json
 * @property {number|null} marketPrice
 * @property {number|null} packs   configured packs (ranked types only)
 * @property {number|null} statedPacks  pack count parsed from TCGplayer's product description
 */

/**
 * @typedef {Object} SetDetail  public/data/sets/{groupId}.json
 * @property {number} contractVersion
 * @property {number} groupId
 * @property {string} setName
 * @property {string} setCode
 * @property {Era} era
 * @property {string} releaseDate
 * @property {boolean} presale
 * @property {number[]} subsetGroupIds  merged subset groups (Trainer Gallery etc.)
 * @property {PullData} pullData
 * @property {Record<string, TierOdds>|null} pullRates   null = no pull data
 * @property {PackModel|null} pack
 * @property {CardRecord[]} cards
 * @property {SetProduct[]} products
 * @property {IndexRow[]} rows           same rows as index.json for this set
 * @property {Record<string, number>} promoValue  product type -> promo USD added to EV
 * @property {string[]} chaseTiers
 * @property {string[]} issues          model warnings for this set
 */

export {};
