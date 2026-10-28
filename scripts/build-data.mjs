#!/usr/bin/env node
// Nightly data build: tcgcsv -> public/data/{index.json, sets/*.json,
// history/sealed.csv, build-report.json}.
//
//   node scripts/build-data.mjs [--force] [--cache .cache/tcgcsv] [--only 23651,24380] [--out public/data]
//
// --force  build even if tcgcsv's last-updated marker matches the last build
// --cache  keep raw tcgcsv responses on disk (keyed by last-updated) for re-runs
// --only   restrict to these groupIds (skips the min-set-count check and stale-file cleanup)
//
// Exit code 1 (and nothing published) when validation fails. The build
// report is written either way. Writes `changed=true|false` to $GITHUB_OUTPUT.

import { readFile, writeFile, mkdir, readdir, rm, appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { createTcgcsvClient } from './lib/tcgcsv.mjs';
import { selectGroups } from './lib/select-groups.mjs';
import { buildSet } from './lib/build-set.mjs';
import { getUsdCad } from './lib/fx.mjs';
import { appendHistory } from './lib/history.mjs';
import { compileTierRules } from '../src/classify.js';
import { CONTRACT_VERSION } from '../src/contract.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));
const tryJson = async (p) => {
  try {
    return await readJson(p);
  } catch {
    return null;
  }
};
const strip = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith('_')).map(([k, v]) => [k, strip(v)])) : o);

function parseArgs(argv) {
  const a = { force: false, cache: null, only: null, out: join(ROOT, 'public', 'data') };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--force') a.force = true;
    else if (argv[i] === '--cache') a.cache = resolve(argv[++i]);
    else if (argv[i] === '--only') a.only = new Set(argv[++i].split(',').map(Number));
    else if (argv[i] === '--out') a.out = resolve(argv[++i]);
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  return a;
}

async function setOutput(key, value) {
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}

/** Every finite-number check the publish gate needs: walks the whole row. */
function findNonFinite(obj, path = '') {
  const bad = [];
  if (typeof obj === 'number' && !Number.isFinite(obj)) bad.push(path);
  else if (obj && typeof obj === 'object') for (const [k, v] of Object.entries(obj)) bad.push(...findNonFinite(v, `${path}.${k}`));
  return bad;
}

async function main() {
  const t0 = Date.now();
  const args = parseArgs(process.argv.slice(2));
  const assumptions = await readJson(join(ROOT, 'config', 'assumptions.json'));
  // Identify the deployment to tcgcsv: GitHub Actions sets GITHUB_REPOSITORY (owner/repo).
  if (process.env.GITHUB_REPOSITORY) assumptions.tcgcsv.userAgent += ` +https://github.com/${process.env.GITHUB_REPOSITORY}`;
  const [setsCfg, rarityMap, pullrates, msrp, productConfig] = await Promise.all(
    ['sets', 'rarity-map', 'pullrates', 'msrp', 'product-config'].map((f) => readJson(join(ROOT, 'data', `${f}.json`))),
  );
  const ctx = { assumptions, productConfig, msrp, pullrates, setsCfg, tierRules: compileTierRules(rarityMap) };

  const client = createTcgcsvClient(assumptions.tcgcsv, { cacheDir: args.cache });
  const stamp = await client.lastUpdated();
  const prevIndex = await tryJson(join(args.out, 'index.json'));
  if (!args.force && !args.only && prevIndex?.meta?.tcgcsvLastUpdated === stamp) {
    console.log(`tcgcsv last-updated ${stamp} unchanged since the last build; nothing to do (use --force to rebuild).`);
    await setOutput('changed', 'false');
    return;
  }
  console.log(`tcgcsv last-updated: ${stamp}`);

  const report = {
    contractVersion: CONTRACT_VERSION,
    generatedAt: new Date().toISOString(),
    tcgcsvLastUpdated: stamp,
    status: 'ok',
    summary: {},
    setsMissingPullData: [],
    unmappedRarities: [],
    unclassifiedProducts: [],
    unknownOddsTiers: [],
    tierCountMismatches: [],
    packCountMismatches: [],
    modelIssues: [],
    excludedGroups: [],
    unrecognizedGroups: [],
    evSwings: [],
    warnings: [],
    errors: [],
  };

  const groups = await client.groups();
  const selection = selectGroups(groups, setsCfg);
  report.excludedGroups = selection.excluded;
  report.unrecognizedGroups = selection.unrecognized;
  for (const u of selection.unrecognized) report.warnings.push(`unrecognized group ${u.groupId} "${u.name}" skipped: add it to data/sets.json deny or explicit`);
  const targets = args.only ? selection.sets.filter((s) => args.only.has(s.group.groupId)) : selection.sets;

  ctx.fx = await getUsdCad(assumptions.fx, prevIndex?.meta?.fx, assumptions.tcgcsv.userAgent);
  if (!ctx.fx.date) report.warnings.push(`FX: ${ctx.fx.source}`);

  const rows = [];
  const details = [];
  let cardsTotal = 0;
  let cardsPriced = 0;
  let priceFallbacks = 0;
  let excludedCards = 0;
  for (const set of targets) {
    const sources = [];
    for (const s of [{ group: set.group, role: null }, ...set.subsets]) {
      sources.push({ groupId: s.group.groupId, role: s.role, products: await client.products(s.group.groupId), prices: await client.prices(s.group.groupId) });
    }
    const { detail, rows: setRows, findings } = buildSet({ set, sources }, ctx);
    const tag = { groupId: detail.groupId, setName: detail.setName };
    for (const u of findings.unmapped.values()) report.unmappedRarities.push({ ...tag, ...u });
    for (const u of findings.unclassified) report.unclassifiedProducts.push({ ...tag, ...u });
    for (const u of findings.unknownOddsTiers) report.unknownOddsTiers.push({ ...tag, ...u });
    for (const u of findings.tierCountMismatches) report.tierCountMismatches.push({ ...tag, ...u });
    for (const u of findings.packCountMismatches) report.packCountMismatches.push({ ...tag, ...u });
    for (const issue of findings.modelIssues) report.modelIssues.push({ ...tag, issue });
    if (detail.pullData.status === 'none') report.setsMissingPullData.push(tag);
    cardsTotal += findings.cardsTotal;
    cardsPriced += findings.cardsPriced;
    priceFallbacks += findings.priceFallbacks;
    excludedCards += findings.excludedCards;
    rows.push(...setRows);
    details.push(detail);
    const ev = setRows.find((r) => r.productType === 'pack')?.evPerPack?.gross;
    console.log(`  ${String(detail.groupId).padEnd(6)} ${detail.setName.padEnd(42)} cards=${String(detail.cards.length).padStart(4)} products=${String(setRows.length)} pull=${detail.pullData.status}${ev != null ? ` ev/pack=$${ev.toFixed(2)}` : ''}`);
  }

  // ---- validation (publish gate) ---------------------------------------------
  if (!args.only && details.length < assumptions.validation.minSets) report.errors.push(`only ${details.length} sets processed (minimum ${assumptions.validation.minSets})`);
  const share = cardsTotal ? cardsPriced / cardsTotal : 0;
  if (cardsPriced === 0) report.errors.push('every card price is null');
  else if (share < assumptions.validation.minPricedCardShare) report.errors.push(`only ${(share * 100).toFixed(1)}% of cards have a price (minimum ${assumptions.validation.minPricedCardShare * 100}%)`);
  for (const r of rows) {
    const bad = findNonFinite(r);
    if (bad.length) report.errors.push(`non-finite value in ${r.setName} ${r.productType}: ${bad.join(', ')}`);
  }
  const prevByKey = new Map((prevIndex?.rows ?? []).map((r) => [`${r.groupId}:${r.productType}`, r]));
  for (const r of rows) {
    const before = prevByKey.get(`${r.groupId}:${r.productType}`)?.evPerPack?.gross;
    const now = r.evPerPack?.gross;
    if (before > 0 && now != null && Math.abs(now - before) / before > assumptions.validation.evSwingWarnPct) {
      report.evSwings.push({ groupId: r.groupId, setName: r.setName, productType: r.productType, before, now, change: Math.round(((now - before) / before) * 1000) / 1000 });
    }
  }
  if (report.evSwings.length) report.warnings.push(`${report.evSwings.length} EV/pack swings over ${assumptions.validation.evSwingWarnPct * 100}% since the last build (see evSwings)`);

  report.summary = {
    setsProcessed: details.length,
    setsWithMeasuredPullData: details.filter((d) => d.pullData.status === 'measured').length,
    setsWithoutPullData: report.setsMissingPullData.length,
    rows: rows.length,
    cards: cardsTotal,
    pricedCardShare: Math.round(share * 10000) / 10000,
    cardsUsingPriceFallback: priceFallbacks,
    excludedNonPackCards: excludedCards,
    fx: ctx.fx,
    requests: client.requests,
    durationMs: Date.now() - t0,
  };
  report.status = report.errors.length ? 'failed' : 'ok';

  await mkdir(args.out, { recursive: true });
  await writeFile(join(args.out, 'build-report.json'), JSON.stringify(report, null, 2) + '\n');
  if (report.errors.length) {
    console.error(`\nValidation failed; nothing published:\n  - ${report.errors.join('\n  - ')}`);
    process.exitCode = 1;
    return;
  }

  // ---- publish -----------------------------------------------------------------
  const index = {
    contractVersion: CONTRACT_VERSION,
    meta: {
      generatedAt: report.generatedAt,
      tcgcsvLastUpdated: stamp,
      fx: ctx.fx,
      assumptions: strip({ pricing: assumptions.pricing, graded: assumptions.graded, simulation: assumptions.simulation, chase: assumptions.chase }),
      eras: Object.fromEntries(Object.entries(setsCfg.eras).map(([k, v]) => [k, { name: v.name }])),
      productTypes: productConfig.rankedTypes,
    },
    rows: rows.sort((a, b) => (b.roi?.market ?? -1) - (a.roi?.market ?? -1)),
  };
  if (args.only && prevIndex) {
    // Partial build: keep the other sets' rows from the previous index.
    index.rows = [...prevIndex.rows.filter((r) => !args.only.has(r.groupId)), ...index.rows].sort((a, b) => (b.roi?.market ?? -1) - (a.roi?.market ?? -1));
  }
  await writeFile(join(args.out, 'index.json'), JSON.stringify(index) + '\n');

  const setsDir = join(args.out, 'sets');
  await mkdir(setsDir, { recursive: true });
  const written = new Set();
  for (const d of details) {
    await writeFile(join(setsDir, `${d.groupId}.json`), JSON.stringify(d) + '\n');
    written.add(`${d.groupId}.json`);
  }
  if (!args.only) {
    for (const f of await readdir(setsDir)) if (f.endsWith('.json') && !written.has(f)) await rm(join(setsDir, f));
  }
  await appendHistory(join(args.out, 'history', 'sealed.csv'), stamp.slice(0, 10), rows, assumptions.history.maxDays);

  console.log(`\n${details.length} sets, ${rows.length} rows, ${client.requests} tcgcsv requests, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`warnings: ${report.warnings.length}, unmapped rarities: ${report.unmappedRarities.length}, unclassified products: ${report.unclassifiedProducts.length}`);
  await setOutput('changed', 'true');
}

main().catch(async (err) => {
  console.error(err);
  process.exitCode = 1;
});
