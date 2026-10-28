# 🃏 pokemon-roi-spa [![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-0A1929?logo=github&logoColor=4FC3F7)](#deployment)

**What's actually inside a sealed Pokémon product, versus what it costs**

[![License: MIT](https://img.shields.io/badge/License-MIT-0A1929?logoColor=4FC3F7)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-0A1929?logo=nodedotjs&logoColor=4FC3F7)](https://nodejs.org/)
[![Zero dependencies](https://img.shields.io/badge/npm%20dependencies-0-0A1929?logo=npm&logoColor=4FC3F7)](#development)
[![Observable Plot](https://img.shields.io/badge/Charts-Observable%20Plot-0A1929?logo=observable&logoColor=4FC3F7)](https://observablehq.com/plot/)

## About

A static site that ranks every English Pokémon TCG booster pack, booster box, Elite Trainer Box, Pokémon Center ETB and booster bundle by **expected value of opening it vs. its market price** (ROI, where 100% = break-even). Prices refresh nightly from TCGplayer via [tcgcsv](https://tcgcsv.com); pull rates come from [TCGplayer's published pull-rate studies](https://www.tcgplayer.com/content/article/Pok%C3%A9mon-TCG-Surging-Sparks-Pull-Rates/6ccfb6ab-f26a-4ce8-bab5-5f91c85ec70e/). No server, no database, no accounts.

## Features

- **Ranked table** -- EV, ROI@market, profit chance and top hit for every set × product, filterable by product type and era, in USD or CAD
- **Set pages** -- per-card EV contributions, every sealed listing, and an editable settings panel (bulk rate, fees, sim count) that recomputes in the browser
- **Monte Carlo** -- 20k seeded simulated openings per product: median, P5–P95, chance to beat the price, chase odds
- **Charts** -- EV per pack over time, cost vs. contents by release, outcome ranges, and where a pack's value comes from
- **Trusted data only** -- measured pull rates and market prices; anything estimated or unverifiable is withheld, with the reason shown
- **Optional graded view** -- PSA/CGC/BGS prices with your own [PokemonPriceTracker](https://www.pokemonpricetracker.com/pokemon-trading-card-api) key; off by default

## Quick Start

Requires [Node.js](https://nodejs.org/en/download) 20+. There is nothing to install.

```bash
git clone https://github.com/ClaytonWas/pokemon-roi-spa.git
cd pokemon-roi-spa
npm test                # node:test suite
npm run build           # fetch tcgcsv and rebuild public/data (skips if tcgcsv hasn't updated)
npm run serve           # http://localhost:8080
```

## Usage

**Rankings:** sort any column, filter by product and era, switch currency or gross/net EV. Click a set for its detail page.
**Set page:** adjust assumptions in **Settings**; every number on the page recomputes with the same code the build uses.
**Charts:** pick a product type and highlight a set; each chart has a table view underneath.

## What gets published

Only primary-source values. Nothing is estimated or borrowed from a third-party compilation.

| Data | Source | Rule |
|---|---|---|
| Prices | TCGplayer market price (via tcgcsv) | no low/mid substitutes |
| Pull rates | TCGplayer Authentication Center studies | EV only if every rarity tier in the set was measured |
| Pack counts | TCGplayer product listings | product EV only if the listing states the count |
| MSRP / ROI@MSRP | official list prices with a source | none verified yet, so the columns are hidden |
| USD→CAD | Bank of Canada daily rate | baked in at build time |

The build withholds EV for anything that fails these rules and records why (`data/pullrates.json → excluded`, `build-report.json → modelIssues`). `test/trust.test.js` checks both the hand-maintained data and the published output. EV is still a model: odds are uniform within a rarity tier, and bulk/fee settings live in `config/assumptions.json`.

## Deployment

```bash
git add -A && git commit -m "Initial site"
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

Then in the repo: **Settings → Pages → Source: GitHub Actions**, and **Settings → Actions → General → Workflow permissions: Read and write**. The site goes live at `https://<you>.github.io/<repo>/`.

[`.github/workflows/build.yml`](.github/workflows/build.yml) runs nightly at 21:30 UTC (tcgcsv updates ~20:00 UTC): test → build → commit `public/data` → deploy. Code pushes to `main` redeploy without rebuilding data.

## Development

```
scripts/build-data.mjs   nightly pipeline: tcgcsv → public/data/*.json (lib/ holds the steps)
src/                     shared pure modules (EV, Monte Carlo, pack model, classifier), used by Node and the browser
public/                  the site: index.html, set.html, charts.html, app/*.js
data/                    hand-maintained: pull rates, rarity rules, pack layouts, set selection, MSRP
config/assumptions.json  every assumption number (bulk rate, fees, sims, validation)
worker/                  optional Cloudflare Worker for the graded-price API
test/                    node:test suite
```

The JSON the site reads is documented in [DATA_CONTRACT.md](DATA_CONTRACT.md), so the UI can be replaced without touching the pipeline.

<details>
<summary><strong>Build commands</strong></summary>

- `npm run build` -- nightly build; exits early when tcgcsv's `last-updated.txt` is unchanged
- `npm run build:force` -- rebuild regardless
- `node scripts/build-data.mjs --cache .cache/tcgcsv` -- keep raw responses on disk for repeat runs
- `node scripts/build-data.mjs --only 23651,24380` -- rebuild just these groupIds

Validation failures (too few sets, missing prices, non-finite numbers) exit with code 1 and publish nothing; `public/data/build-report.json` is written either way.
</details>

<details>
<summary><strong>Adding a set's pull rates</strong></summary>

1. Find the set's `groupId` in `build-report.json → setsMissingPullData`.
2. Find TCGplayer's "Pull Rates" article for the set. The numbers are in the article text, with 95% confidence intervals.
3. Add an entry to `data/pullrates.json → sets`: per-pack `odds` for every tier, plus `source` (URL, date, packs opened). Use the tier names `data/rarity-map.json` produces; set `expectedCards` to the source's card count so the build can cross-check.
4. Only add the set if **every** rarity tier in its packs was measured. Otherwise list it under `excluded` with the reason.
5. Run `node scripts/build-data.mjs --only <groupId>` and check `tierCountMismatches`, `unknownOddsTiers` and `modelIssues` in the report.

New rarities appear in `unmappedRarities` (add a rule to `data/rarity-map.json`); new pack structures need a layout in `data/product-config.json`.
</details>

<details>
<summary><strong>Graded prices and the optional Worker</strong></summary>

PokemonPriceTracker's API answers the browser's CORS preflight with 401, so browsers can't call it directly. [`worker/ppt-proxy.js`](worker/ppt-proxy.js) is a ~30-line passthrough that forwards your own `Authorization` header and stores nothing:

```bash
cd worker   # set ALLOWED_ORIGINS in wrangler.toml to your Pages origin
npx wrangler deploy
```

Then on a set page: **Settings → Graded view**, paste your key and the Worker URL, and click **Fetch graded prices** (2 credits per card, cached 7 days). Graded EV replaces each top card's value with `gemRate × PSA10 + (1 − gemRate) × PSA9 − gradingCost`.
</details>

<details>
<summary><strong>Known limitations</strong></summary>

- Odds are uniform within a tier (TCGplayer's own assumption); god packs aren't modeled.
- Commons below the $1 bulk threshold count at $0.01 each; net EV (after fees and shipping) is the more realistic number.
- History starts with the first nightly build: tcgcsv withdrew its price archive and no primary source has older prices.
</details>

## Roadmap

Verified MSRPs (to bring back ROI@MSRP) and more sets as TCGplayer publishes pull-rate studies. See [issues](https://github.com/ClaytonWas/pokemon-roi-spa/issues).

## Contributing

Issues and pull requests welcome. Pull-rate additions need a primary source.

## Resources

[tcgcsv](https://tcgcsv.com) · [TCGplayer pull-rate articles](https://www.tcgplayer.com/content/article/Pok%C3%A9mon-TCG-Mega-Evolution-Pull-Rates/40cbeedc-21ce-473b-aef1-74e3969d9f91/) · [Observable Plot](https://observablehq.com/plot/) · [Bank of Canada Valet API](https://www.bankofcanada.ca/valet/docs)

<div align="center">

**Made with 💙 by [ClaytonWas](https://github.com/ClaytonWas)**

[Report Bug/Request Feature](https://github.com/ClaytonWas/pokemon-roi-spa/issues)

</div>
