// Decides which tcgcsv groups become sets, which era each is in, and which
// groups are subsets merged into a parent (Trainer Gallery, Galarian
// Gallery, Shiny Vault, Classic Collection). Driven by data/sets.json.

export function selectGroups(groups, cfg, today = new Date().toISOString().slice(0, 10)) {
  const deny = cfg.deny.map((p) => new RegExp(p, 'i'));
  const eraRules = cfg.eraRules.map((r) => ({ era: r.era, re: new RegExp(r.pattern) }));
  const subsetRe = new RegExp(cfg.subsetPattern, 'i');
  const explicitSubsets = Object.fromEntries(Object.entries(cfg.subsets).filter(([k]) => !k.startsWith('_')).map(([k, v]) => [Number(k), Number(v)]));
  const byName = new Map(groups.map((g) => [g.name.toLowerCase(), g]));

  const sets = new Map();
  const subsetsOf = new Map();
  const excluded = [];
  const unrecognized = [];

  for (const g of groups) {
    const released = (g.publishedOn ?? '').slice(0, 10);
    if (released < cfg.minReleaseDate) continue;
    if (deny.some((re) => re.test(g.name))) {
      excluded.push({ groupId: g.groupId, name: g.name, reason: 'deny list' });
      continue;
    }
    let parentId = explicitSubsets[g.groupId];
    let subsetRole = null;
    const m = g.name.match(subsetRe);
    if (m) {
      subsetRole = normalizeRole(m[2]);
      if (parentId === undefined) parentId = byName.get(m[1].toLowerCase())?.groupId;
    }
    if (parentId !== undefined) {
      if (!subsetRole) subsetRole = normalizeRole(g.name);
      if (!subsetsOf.has(parentId)) subsetsOf.set(parentId, []);
      subsetsOf.get(parentId).push({ group: g, role: subsetRole });
      continue;
    }
    const era = cfg.explicit[String(g.groupId)] ?? eraRules.find((r) => r.re.test(g.name))?.era;
    if (!era) {
      unrecognized.push({ groupId: g.groupId, name: g.name, publishedOn: released });
      continue;
    }
    sets.set(g.groupId, { group: g, era, releaseDate: released, presale: released > today, subsets: [] });
  }

  for (const [parentId, children] of subsetsOf) {
    const parent = sets.get(parentId);
    if (parent) parent.subsets.push(...children);
    else for (const c of children) excluded.push({ groupId: c.group.groupId, name: c.group.name, reason: `subset of ${parentId}, which is not processed` });
  }

  return { sets: [...sets.values()].sort((a, b) => b.releaseDate.localeCompare(a.releaseDate) || a.group.groupId - b.group.groupId), excluded, unrecognized };
}

function normalizeRole(text) {
  for (const role of ['Trainer Gallery', 'Galarian Gallery', 'Shiny Vault', 'Classic Collection']) {
    if (text.toLowerCase().includes(role.toLowerCase())) return role;
  }
  return 'Subset';
}
