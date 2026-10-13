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
