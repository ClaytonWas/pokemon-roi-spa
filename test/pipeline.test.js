import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { selectGroups } from '../scripts/lib/select-groups.mjs';
import { mergeHistory, HISTORY_HEADER } from '../scripts/lib/history.mjs';

const setsCfg = JSON.parse(readFileSync(new URL('../data/sets.json', import.meta.url), 'utf8'));
const g = (groupId, name, publishedOn) => ({ groupId, name, publishedOn: `${publishedOn}T00:00:00` });
// Real tcgcsv group names and ids (2026-10-27).
const groups = [
  g(24831, 'ME06: Delta Reign', '2026-11-06'),
  g(24722, 'ME: 30th Celebration', '2026-09-16'),
  g(24837, 'ME: 30th Celebration Classic Collection', '2026-09-16'),
  g(24451, 'ME: Mega Evolution Promo', '2025-09-26'),
  g(24461, 'MEE: Mega Evolution Energies', '2025-09-26'),
  g(23651, 'SV08: Surging Sparks', '2024-11-08'),
  g(23561, 'Trick or Trade BOOster Bundle 2024', '2024-08-30'),
  g(24864, 'Southeast Asia Exclusives', '2023-08-05'),
  g(3170, 'SWSH12: Silver Tempest', '2022-11-11'),
  g(17674, 'SWSH12: Silver Tempest Trainer Gallery', '2022-11-11'),
  g(17688, 'SWSH: Crown Zenith', '2023-01-20'),
  g(17689, 'SWSH: Crown Zenith: Galarian Gallery', '2023-01-20'),
  g(2867, 'Celebrations', '2021-10-08'),
  g(2534, 'SM - Cosmic Eclipse', '2019-11-01'),
  g(1422, 'POP Series 1', '2026-10-27'),
  g(99999, 'Some Brand New Product Line', '2026-10-01'),
];

test('group selection: eras, subsets merged into parents, deny list, unknowns reported', () => {
  const { sets, excluded, unrecognized } = selectGroups(groups, setsCfg, '2026-10-27');
  const byId = Object.fromEntries(sets.map((s) => [s.group.groupId, s]));
  assert.deepEqual(Object.keys(byId).map(Number).sort((a, b) => a - b), [2867, 3170, 17688, 23651, 24722, 24831]);
  assert.equal(byId[24722].era, 'me');
  assert.equal(byId[23651].era, 'sv');
  assert.equal(byId[2867].era, 'swsh'); // explicit: no era prefix in the name
  assert.equal(byId[24831].presale, true);
  assert.deepEqual(byId[3170].subsets.map((s) => [s.group.groupId, s.role]), [[17674, 'Trainer Gallery']]);
  assert.deepEqual(byId[17688].subsets.map((s) => [s.group.groupId, s.role]), [[17689, 'Galarian Gallery']]);
  assert.deepEqual(byId[24722].subsets.map((s) => s.role), ['Classic Collection']);
  const excludedIds = excluded.map((e) => e.groupId);
  for (const id of [24451, 24461, 23561, 24864, 1422]) assert.ok(excludedIds.includes(id), String(id));
  assert.ok(!excludedIds.includes(2534)); // SM era is out of the date window entirely, not "excluded"
  assert.deepEqual(unrecognized.map((u) => u.groupId), [99999]);
});

test('history CSV: re-running a date replaces its rows, old rows are pruned', () => {
  const rows = [{ groupId: 1, productType: 'pack', marketPrice: 5, evPerPack: { gross: 2 } }];
  const day1 = mergeHistory(null, '2026-10-26', rows, 30);
  const day2 = mergeHistory(day1, '2026-10-27', rows, 30);
  const rerun = mergeHistory(day2, '2026-10-27', [{ ...rows[0], marketPrice: 6 }], 30);
  assert.equal(rerun, `${HISTORY_HEADER}\n2026-10-26,1,pack,5,2\n2026-10-27,1,pack,6,2\n`);
  const later = mergeHistory(rerun, '2026-12-31', [{ groupId: 1, productType: 'pack', marketPrice: null, evPerPack: null }], 30);
  assert.equal(later, `${HISTORY_HEADER}\n2026-12-31,1,pack,,\n`);
});
