// The order the daily collector visits sources. The run stops starting sources at its time budget, so whoever is
// last in line is skipped; without care the SAME sources are last every day (1 Nov 2026: pt-home-prices, pt-ine-rents,
// it-fuel, au-bitre-airfares, uy-ancap-fuel, za-* were all skipped and sat 2+ days behind). Rule: healthy sources before
// known outages, and inside each group the source whose last harvest is OLDEST (never harvested = oldest) goes first,
// so a skipped source leads the queue on the next run.
export interface OrderMeta {
  last_error?: string | null;
  last_harvest_at?: string | null;
}

export function isKnownOutage(prev: OrderMeta | null | undefined): boolean {
  return !!(prev?.last_error && prev.last_harvest_at && !prev.last_error.startsWith("Data check held back"));
}

export function harvestOrder<T extends { info: { id: string } }>(targets: T[], metaOf: (id: string) => OrderMeta | null | undefined): T[] {
  const keyed = targets.map((t, i) => {
    const m = metaOf(t.info.id);
    const at = m?.last_harvest_at ? Date.parse(m.last_harvest_at) : 0;
    return { t, i, outage: Number(isKnownOutage(m)), at: Number.isFinite(at) ? at : 0 };
  });
  keyed.sort((a, b) => a.outage - b.outage || a.at - b.at || a.i - b.i);
  return keyed.map((k) => k.t);
}
