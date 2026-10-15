// Small text helpers shared by tool descriptions and summaries.
export function joinOr(items: string[]): string {
  const list = [...new Set(items)];
  if (list.length <= 1) return list[0] ?? "";
  return `${list.slice(0, -1).join(", ")} or ${list[list.length - 1]}`;
}

export function joinAnd(items: string[]): string {
  const list = [...new Set(items)];
  if (list.length <= 1) return list[0] ?? "";
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

export function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "How fresh" text for a tool description: one entry per distinct freshness note, labelled with the places it covers when
 *  the places differ (so 23 countries of one weekly bulletin read once, not 23 times). */
export function freshnessList(places: { place: string; freshness: string }[]): string {
  const groups = new Map<string, string[]>();
  for (const p of places) {
    // Lower-case the first letter after the label, but leave acronyms alone ("ANP publishes", not "aNP publishes").
    const keep = /^[A-Z]{2}/.test(p.freshness);
    const note = keep ? p.freshness : p.freshness.charAt(0).toLowerCase() + p.freshness.slice(1);
    const list = groups.get(note) ?? [];
    if (!list.includes(p.place)) list.push(p.place);
    groups.set(note, list);
  }
  if (groups.size <= 1) return [...groups.keys()][0] ?? "";
  return [...groups.entries()].map(([note, where]) => `${joinAnd(where)}: ${note}`).join("; ");
}
