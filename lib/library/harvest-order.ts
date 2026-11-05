// The order the daily collector visits sources. The run stops starting sources at its time budget, so whoever is
// last in line is skipped; without care the SAME sources are last every day (1 Nov 2026: pt-home-prices, pt-ine-rents,
// it-fuel, au-bitre-airfares, uy-ancap-fuel, za-* were all skipped and sat 2+ days behind). Rule: healthy sources before
// known outages, and inside each group the source whose last harvest is OLDEST (never harvested = oldest) goes first,
// so a skipped source leads the queue on the next run.
export interface OrderMeta {
  last_error?: string | null;
  last_harvest_at?: string | null;
  last_ok_at?: string | null;
}

// A failing source whose last good copy is 2 to 7 days old is "at risk": its stale-if-error copy (7 days) is about to expire, and
// it is the group that the time budget starved (3 and 4 Nov 2026: the six tw-* sources failed once, were ranked as outages, came
// last, were SKIPped by the budget two days running, and their copies were headed for 502). They are tried FIRST. A source that has
// been down for more than 7 days has no copy left to save, so it goes back to the end of the queue (IT and ME fuel, blocked hosts).
export const AT_RISK_MIN_DAYS = 2;
export const AT_RISK_MAX_DAYS = 7;
export function isCopyAtRisk(prev: OrderMeta | null | undefined, now: number = Date.now()): boolean {
  if (!isKnownOutage(prev) || !prev?.last_ok_at) return false;
  const ok = Date.parse(prev.last_ok_at);
  if (!Number.isFinite(ok)) return false;
  const days = (now - ok) / 86400000;
  return days >= AT_RISK_MIN_DAYS && days < AT_RISK_MAX_DAYS;
}

export function isKnownOutage(prev: OrderMeta | null | undefined): boolean {
  return !!(prev?.last_error && prev.last_harvest_at && !prev.last_error.startsWith("Data check held back"));
}

export function harvestOrder<T extends { info: { id: string } }>(targets: T[], metaOf: (id: string) => OrderMeta | null | undefined, now: number = Date.now()): T[] {
  const keyed = targets.map((t, i) => {
    const m = metaOf(t.info.id);
    const at = m?.last_harvest_at ? Date.parse(m.last_harvest_at) : 0;
    return { t, i, outage: isCopyAtRisk(m, now) ? -1 : Number(isKnownOutage(m)), at: Number.isFinite(at) ? at : 0 };
  });
  keyed.sort((a, b) => a.outage - b.outage || a.at - b.at || a.i - b.i);
  return keyed.map((k) => k.t);
}
