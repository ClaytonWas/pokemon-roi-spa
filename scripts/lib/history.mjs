// public/data/history/sealed.csv: one row per date x set x product type.
// Re-running a build for the same date replaces that date's rows, so the
// file stays idempotent; rows older than maxDays are pruned.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export const HISTORY_HEADER = 'date,groupId,productType,marketPrice,evPerPack';

export function mergeHistory(existingCsv, date, rows, maxDays) {
  const keep = (existingCsv ?? '')
    .split(/\r?\n/)
    .slice(1)
    .filter((line) => line && !line.startsWith(`${date},`));
  const cutoff = new Date(Date.parse(date) - maxDays * 86400000).toISOString().slice(0, 10);
  const fresh = rows.map((r) => [date, r.groupId, r.productType, r.marketPrice ?? '', r.evPerPack?.gross ?? ''].join(','));
  const all = [...keep.filter((l) => l.slice(0, 10) >= cutoff), ...fresh].sort();
  return [HISTORY_HEADER, ...all].join('\n') + '\n';
}

export async function appendHistory(file, date, rows, maxDays) {
  let existing = null;
  try {
    existing = await readFile(file, 'utf8');
  } catch {}
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, mergeHistory(existing, date, rows, maxDays));
}
