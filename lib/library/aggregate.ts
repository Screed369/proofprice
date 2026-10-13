// Turn many individual prices (one per station, per sale...) into library rows: one per area and item,
// plus an "ALL" row for the whole country. Pure function, unit-tested.

import type { DailyRow } from "../plugin";
import { summarise } from "../stats";

export const NATIONAL = "ALL";

export function aggregateDaily(records: { area: string; item: string; price: number }[], withNational = true): DailyRow[] {
  const groups = new Map<string, number[]>();
  const add = (area: string, item: string, price: number) => {
    const k = `${area}\u0000${item}`;
    const g = groups.get(k);
    if (g) g.push(price);
    else groups.set(k, [price]);
  };
  for (const r of records) {
    if (!Number.isFinite(r.price) || r.price <= 0 || !r.area || !r.item) continue;
    add(r.area, r.item, r.price);
    if (withNational) add(NATIONAL, r.item, r.price);
  }
  const rows: DailyRow[] = [];
  for (const [k, prices] of groups) {
    const [area, item] = k.split("\u0000");
    const s = summarise(prices);
    if (!s) continue;
    rows.push({ area, item, n: s.count, median: s.median, low: s.low, high: s.high, min: s.min, max: s.max });
  }
  return rows.sort((a, b) => a.area.localeCompare(b.area) || a.item.localeCompare(b.item));
}
