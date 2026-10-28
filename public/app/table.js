// Minimal sortable table. Columns: { key, label, value(row) -> sortable, render(row) -> Node|string, numeric? }.
// Nulls always sort last. Clicking a header sorts; clicking again reverses.

import { el } from './format.js';

export function renderTable(container, columns, rows, state, onSort) {
  const col = columns.find((c) => c.key === state.sortKey) ?? columns[0];
  const dir = state.sortDir === 'asc' ? 1 : -1;
  const sorted = [...rows].sort((a, b) => {
    const va = col.value(a);
    const vb = col.value(b);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    return (typeof va === 'string' ? va.localeCompare(vb) : va - vb) * dir;
  });
  const head = el(
    'tr',
    {},
    columns.map((c) =>
      el(
        'th',
        {
          class: c.numeric ? 'num' : null,
          'aria-sort': c.key === col.key ? (dir === 1 ? 'ascending' : 'descending') : null,
          onclick: () => onSort({ sortKey: c.key, sortDir: c.key === col.key && state.sortDir === 'desc' ? 'asc' : 'desc' }),
          title: c.title ?? null,
        },
        c.label,
        c.key === col.key ? (dir === 1 ? ' ▲' : ' ▼') : '',
      ),
    ),
  );
  const body = sorted.map((r) => el('tr', {}, columns.map((c) => el('td', { class: c.numeric ? 'num' : null }, c.render ? c.render(r) : String(c.value(r) ?? '—')))));
  container.replaceChildren(el('table', {}, el('thead', {}, head), el('tbody', {}, body)));
  return sorted;
}
