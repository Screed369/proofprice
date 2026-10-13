// Singapore public-housing (HDB) resale prices from data.gov.sg.

import { fetchJson, SourceError } from "../http";
import { summarise } from "../stats";
import { buildAnswer, fmtMoney, PriceAnswer } from "../answer";

const RESOURCE_ID = "d_8b84c4ee58e3cfc0ece0d773c8ca6abc";
const ENDPOINT = "https://data.gov.sg/api/action/datastore_search";

export const SG_FLAT_TYPES = ["1 ROOM", "2 ROOM", "3 ROOM", "4 ROOM", "5 ROOM", "EXECUTIVE", "MULTI-GENERATION"] as const;

export function buildSgUrl(town: string, flatType?: string, limit = 1000): string {
  const filters: Record<string, string> = { town: town.trim().toUpperCase() };
  if (flatType) filters.flat_type = flatType.trim().toUpperCase();
  const params = new URLSearchParams({
    resource_id: RESOURCE_ID,
    filters: JSON.stringify(filters),
    sort: "month desc",
    limit: String(limit),
  });
  return `${ENDPOINT}?${params.toString()}`;
}

export function parseSgRecords(json: any): { month: string; price: number; area: number }[] {
  const recs = json?.result?.records;
  if (!json?.success || !Array.isArray(recs)) throw new SourceError("Unexpected response from data.gov.sg");
  return recs
    .map((r: any) => ({ month: String(r.month), price: Number(r.resale_price), area: Number(r.floor_area_sqm) }))
    .filter((r) => Number.isFinite(r.price) && r.price > 0);
}

export async function sgHomeSales(input: {
  town: string;
  flat_type?: string;
  months?: number;
  baseUrl?: string;
}): Promise<PriceAnswer> {
  const months = Math.max(1, Math.min(36, Math.round(input.months ?? 12)));
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  const cutoffMonth = cutoff.toISOString().slice(0, 7);
  const json = await fetchJson(buildSgUrl(input.town, input.flat_type), {}, 20000);
  const rows = parseSgRecords(json).filter((r) => r.month >= cutoffMonth);
  const months_ = rows.map((r) => r.month).sort();
  const s = summarise(rows.map((r) => r.price));
  const psm = summarise(rows.filter((r) => r.area > 0).map((r) => r.price / r.area));
  const label = `${input.flat_type ? input.flat_type.toUpperCase() + " " : ""}HDB resale flats in ${input.town.toUpperCase()}`;
  return buildAnswer({
    sourceId: "sg-hdb-resale",
    query: { country: "SG", town: input.town, flat_type: input.flat_type ?? null, months },
    summary: s,
    currency: "SGD",
    unit: "per flat",
    period: { from: months_[0] ?? null, to: months_[months_.length - 1] ?? null },
    method:
      "Median and 10th–90th percentile of registered HDB resale transactions in the selected town, flat type and period (by month of registration).",
    describe: (x) =>
      `${label} sold for a median of ${fmtMoney(x.median, "SGD")}; typical range ${fmtMoney(x.low, "SGD")}–${fmtMoney(x.high, "SGD")}.`,
    baseUrl: input.baseUrl,
    extra: psm ? { median_price_per_sqm: psm.median } : undefined,
  });
}
