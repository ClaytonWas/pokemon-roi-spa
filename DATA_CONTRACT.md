# Data contract

Everything the UI shows comes from static JSON under `public/data/`, and it contains only primary-source values: TCGplayer market prices, TCGplayer pull-rate studies that measured every tier of a set, and verified list prices. Nothing estimated is published. The pipeline (`scripts/build-data.mjs`) writes it nightly, and a new UI can be dropped in without touching the pipeline. The JSDoc typedefs in [`src/contract.js`](src/contract.js) are the machine-readable version of this page; `contractVersion` (currently **1**) is bumped on any breaking change.

| File | What it is | Size |
|---|---|---|
| `data/index.json` | One row per set × ranked product, for the ranking table | ~190 KB |
| `data/sets/{groupId}.json` | Full detail for one set: cards, pack model, products | 5–170 KB each |
| `data/history/sealed.csv` | Daily `date,groupId,productType,marketPrice,evPerPack` | ~6 KB/day |
| `data/build-report.json` | Warnings and data-quality findings from the last build | ~10 KB |

## Conventions

- **Money is USD** (TCGplayer market prices) unless a field says `cad`. To show CAD, multiply USD by `index.meta.fx.usdCad`. MSRP is the exception: it has separate `usd` and `cad` list prices, because Canadian MSRPs are set independently rather than converted. Only official list prices with a source are published, and currently there are none, so every `msrp` value is `null`. A UI should hide MSRP columns when no row has one.
- **Ratios are fractions.** `roi.market = 0.2254` means 22.54% (100% = break-even). Probabilities run 0–1.
- **`null` means unknown, never zero.** It covers a missing price, no pull data, or an unknown MSRP.
- **EV is raw ungraded NM** with the build's default assumptions (`index.meta.assumptions`). It comes in two bases: `gross` (market value) and `net` (after the sell fee and per-card shipping, applied only to cards above the bulk threshold). Graded EV is never in the files; the UI computes it on request.
- **URLs are derived from `productId`.** The product page is `https://www.tcgplayer.com/product/{productId}` and the image is `https://tcgplayer-cdn.tcgplayer.com/product/{productId}_200w.jpg`.
- `groupId` is the tcgcsv/TCGplayer set id. Trainer Gallery, Galarian Gallery, Shiny Vault and Classic Collection groups are merged into their parent set, because their cards come out of the parent's packs. They are listed in `subsetGroupIds`.

## `index.json`

```jsonc
{
  "contractVersion": 1,
  "meta": {
    "generatedAt": "2026-10-28T00:59:56.611Z",
    "tcgcsvLastUpdated": "2026-10-27T20:05:13+0000",   // tcgcsv's last-updated.txt for this build
    "fx": { "usdCad": 1.4038, "date": "2026-10-27", "source": "Bank of Canada Valet FXUSDCAD" },
    "assumptions": { "pricing": {…}, "graded": {…}, "simulation": {…}, "chase": {…} },  // config/assumptions.json
    "eras": { "me": { "name": "Mega Evolution" }, "sv": {…}, "swsh": {…} },
    "productTypes": ["pack", "box", "etb", "pc-etb", "bundle"]
  },
  "rows": [ IndexRow, … ]    // sorted by roi.market desc, nulls last
}
```

### IndexRow

```jsonc
{
  "groupId": 23651, "setName": "SV08: Surging Sparks", "setCode": "SSP", "era": "sv",
  "releaseDate": "2024-11-08", "presale": false,
  "productType": "box",                 // pack | box | etb | pc-etb | bundle
  "productId": 565606, "productName": "Surging Sparks Booster Box",
  "packs": 36,                          // from data/product-config.json
  "marketPrice": 298.63,                // TCGplayer market, USD; null if unpriced
  "msrp": { "usd": null, "cad": null, "usdConfidence": null, "cadConfidence": null },  // verified list prices only
  "ev":        { "gross": 67.3111, "net": 53.5931 },   // product EV; null without trusted pull data or a listed pack count
  "evPerPack": { "gross": 1.8698,  "net": 1.4887 },
  "roi": { "market": 0.2254, "msrp": null, "msrpCad": null },  // gross EV / cost
  "sim": {                              // Monte Carlo of opening ONE product
    "sims": 20000,
    "gross": { "mean": 67.99, "median": 47.195, "p5": 16.04, "p95": 226.2,
               "pProfitMarket": 0.0223, "pProfitMsrp": null, "pProfitMsrpCad": null },
    "net":   { … same fields … }
  },
  "chase": { "tiers": ["Special Illustration Rare", "Hyper Rare"], "p": 0.4554 },  // P(>=1) in this product
  "topHit": { "name": "Pikachu ex - 238/191", "tier": "Special Illustration Rare", "price": 256.63, "productId": 590027 },
  "pullData": PullData
}
```

- `msrp.*Confidence` is `list` (official list price) whenever a value is present.
- `roi.msrpCad = ev.gross × fx.usdCad / msrp.cad`.
- `pProfit*` is the share of simulations whose opened value is at least the cost. It uses the same basis as its parent (`gross` or `net`).
- A product type a set doesn't have (special sets often have no booster box) simply has no row.
- Rows for sets without trusted pull data still appear, with prices. `ev`, `evPerPack`, `roi`, `sim` and `chase` are `null`; `topHit` is the set's highest-priced card.

### PullData

```jsonc
{
  "status": "measured",       // measured | none
  "packsOpened": 8000,        // sample size (lower bound: sources say "more than N"); null unless measured
  "source": "https://www.tcgplayer.com/article/…",  "publisher": "TCGplayer Authentication Center", "date": "2024-11-08",
  "basis": null,              // why EV is missing, when the build withheld it
  "estimatedTiers": [],       // always empty: estimates are never published (kept for compatibility)
  "unknownTiers": []          // tiers with cards but no measured odds; any entry means EV was withheld
}
```

- `measured` means a TCGplayer study measured every tier with cards in the set, and every hit card has a market price.
- `none` means there is no such study, the build withheld EV (`basis` says why), or there is no card list yet (presale). In that case `ev` is `null`.

## `sets/{groupId}.json` (SetDetail)

| Field | Meaning |
|---|---|
| `groupId, setName, setCode, era, releaseDate, presale` | as in IndexRow |
| `subsetGroupIds` | merged subset groups |
| `pullData` | as above |
| `pullRates` | `{ [tier]: { odds, slot, ci95?, expectedCards?, note? } }`; `null` unless `pullData.status` is `measured`. `odds` = probability a pack contains a card of that tier |
| `pack` | the **PackModel** EV was computed from (below); `null` without pull data |
| `cards` | `CardRecord[]` |
| `products` | every sealed listing in the set, ranked or not (`SetProduct[]`) |
| `rows` | this set's IndexRows |
| `promoValue` | `{ [productType]: usd }` promo value added to EV (default 0) |
| `chaseTiers` | tiers counted for `chase` |
| `issues` | model warnings for this set (show them) |

### CardRecord

```jsonc
{ "productId": 589855, "name": "Alolan Diglett", "number": "122/191", "rarity": "Common",
  "tier": "Common",            // pull-rate tier; null = unmapped rarity (listed in build-report)
  "subset": null,              // "Trainer Gallery" | "Galarian Gallery" | … when from a subset group
  "sourceGroupId": 23651, "cardType": "Metal",
  "prices": { "normal": 0.11, "reverseHolofoil": 0.21 }   // printing -> USD TCGplayer market price; null when TCGplayer has none
}
```

Printing keys are camel-cased TCGplayer `subTypeName`s: `normal`, `holofoil`, `reverseHolofoil`, and so on. Pattern parallels such as "Poké Ball Pattern" are separate TCGplayer products, so they appear as their own CardRecords.

### SetProduct

```jsonc
{ "productId": 565606, "name": "Surging Sparks Booster Box", "type": "box", "variant": null, "kind": null,
  "canonical": true,      // the one product per ranked type used in rows
  "marketPrice": 298.63, "packs": 36,
  "statedPacks": 36 }     // pack count parsed from TCGplayer's description (cross-check)
```

- `type` is a ranked type, `case`, or `other`.
- `variant` is one of: `sleeved`, `lgs`, `retail`, `plus`, `enhanced`, `retailer-exclusive`.
- `kind` describes `other` items: `code-card`, `display`, `multi-pack`, `merch`, and so on.

### PackModel (how EV is computed)

```jsonc
{
  "layoutId": "sv", "cardsPerPack": 10,
  "slots": [ { "id": "rare", "count": 1, "pool": "rare", "fillerP": 0.7579,
               "hits": [ { "tier": "Double Rare", "p": 0.1694 }, { "tier": "Ultra Rare", "p": 0.0674 }, { "tier": "Hyper Rare", "p": 0.0053 } ] }, … ],
  "groups": [ { "key": "tier:Double Rare", "kind": "tier", "id": "Double Rare", "slot": "rare", "rate": 0.1694,
                "entries": [ { "card": 3, "variant": "holofoil", "w": 0.0555 }, … ] },
              { "key": "pool:reverse", "kind": "pool", "id": "reverse", "slot": null, "rate": 1.8615, "entries": [ … ] } ]
}
```

Each slot draws one hit tier with its per-pack odds `p`. With probability `fillerP` it instead draws a uniform card from its filler `pool`; a slot with `count: 4` is four independent filler draws. A group is a hit tier or a filler pool: `rate` is the expected number of cards from that group per pack. An entry is one printing of `cards[card]`, and `w` is its share of the group (uniform unless overridden). So:

```
copiesPerPack(entry) = group.rate × entry.w           // = p_card for hit cards
EV_pack              = Σ copiesPerPack × value(price)
value(price)         = price ≥ bulkThreshold ? price : bulkRatePerCard          (gross)
                       price ≥ bulkThreshold ? price·(1−sellFee) − shipping : bulkRatePerCard   (net)
EV_product           = packs × EV_pack + promoValue
```

Recompute in the browser with the same code the build uses:

```js
import { packEV, productEV, roi, createSampler, simulateProduct, chaseOdds, gradedOverrides } from './src/ev.js';
const pack = packEV(detail.pack, detail.cards, pricing);           // { gross, net, byGroup, entries }
const box = productEV(pack, 36, 0, pricing);                         // { gross, net }
const sim = simulateProduct(createSampler(detail.pack, detail.cards, pricing), { packs: 36, sims: 20000, seed, costs: [marketPrice] });
```

Graded view: `gradedOverrides(pack, cards, { [productId]: { psa10, psa9 } }, { gemRate, gradingCost, topN })` returns a `Map` of replacement prices. Pass it as the 4th argument to `packEV` and `createSampler`.

## `history/sealed.csv`

```
date,groupId,productType,marketPrice,evPerPack
2026-10-27,23651,box,298.63,1.8698
```

There is one row per build date × set × ranked product. `date` is tcgcsv's update date, `evPerPack` is gross, and an empty cell means unknown. Re-running a date replaces its rows. Rows older than `history.maxDays` (730) are pruned.

## `build-report.json`

The build report records the pipeline's findings. A UI can link to it, but it isn't needed for rendering.

**Status and summary**
- `status`: `ok` or `failed`.
- `summary`: sets processed, sets with and without measured pull data, priced-card share, FX, request count, duration.
- `errors`: failures that block publishing (fewer than `minSets` sets, prices missing, non-finite numbers).
- `warnings`

**Data-quality findings**
- `unmappedRarities`: rarities with no rule in `data/rarity-map.json`.
- `unclassifiedProducts`: sealed names no classifier rule matched.
- `unknownOddsTiers`: tiers with cards but no odds.
- `tierCountMismatches`: mapped card count differs from the source's.
- `packCountMismatches`: configured packs differ from TCGplayer's description.
- `modelIssues`: includes every EV the build withheld, with the reason.
- `setsMissingPullData`: sets published with prices only.
- `excludedGroups`, `unrecognizedGroups`

**Price changes**
- `evSwings`: EV/pack moved more than 25% since the last build. This is a warning only.
