// Singapore public-housing (HDB) resale prices from data.gov.sg.

import { SourceError } from "../../lib/http";
import { collectPages, resolveFetcher } from "../../lib/adapters";
import type { Fetcher } from "../../lib/adapters";
import { summarise } from "../../lib/stats";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import type { SourceInfo } from "../../lib/plugin";

export const INFO: SourceInfo = {
  id: "sg-hdb-resale",
  country: "SG",
  category: "home sales (public housing resale)",
  name: "Resale flat prices (from Jan 2017)",
  publisher: "Housing & Development Board via data.gov.sg",
  what_is_recorded: "HDB resale transactions: month, town, flat type, floor area, lease, resale price.",
  price_type: "transaction",
  freshness: "Daily updates of registered resales",
  licence: "Singapore Open Data Licence v1.0",
  licence_url: "https://data.gov.sg/open-data-licence",
  attribution:
    "Contains information from Resale flat prices accessed from data.gov.sg, made available under the terms of the Singapore Open Data Licence version 1.0.",
  homepage: "https://data.gov.sg/datasets/d_8b84c4ee58e3cfc0ece0d773c8ca6abc/view",
  limits:
    "Public housing (HDB) only; private condominium sales are a separate source (not yet included). Prices of leasehold flats with different remaining leases, floor areas and flat types are pooled unless a flat_type is given. " +
    "One answer reads at most 5,000 resales; a busy town over a long window then uses only the most recent whole months, and the period shows the months actually covered.",
};


const RESOURCE_ID = "d_8b84c4ee58e3cfc0ece0d773c8ca6abc";
const ENDPOINT = "https://data.gov.sg/api/action/datastore_search";

export const SG_FLAT_TYPES = ["1 ROOM", "2 ROOM", "3 ROOM", "4 ROOM", "5 ROOM", "EXECUTIVE", "MULTI-GENERATION"] as const;

export function buildSgUrl(town: string, flatType?: string, limit = 1000, offset = 0): string {
  const filters: Record<string, string> = { town: town.trim().toUpperCase() };
  if (flatType) filters.flat_type = flatType.trim().toUpperCase();
  const params = new URLSearchParams({
    resource_id: RESOURCE_ID,
    filters: JSON.stringify(filters),
    sort: "month desc,_id desc",
    limit: String(limit),
  });
  if (offset > 0) params.set("offset", String(offset));
  return `${ENDPOINT}?${params.toString()}`;
}

export function parseSgRecords(json: any): { month: string; price: number; area: number }[] {
  const recs = json?.result?.records;
  if (!json?.success || !Array.isArray(recs)) throw new SourceError("Unexpected response from data.gov.sg");
  return recs
    .map((r: any) => ({ month: String(r.month), price: Number(r.resale_price), area: Number(r.floor_area_sqm) }))
    .filter((r) => /^\d{4}-\d{2}$/.test(r.month) && Number.isFinite(r.price) && r.price > 0);
}

/** First month of the window, excluded: `months` calendar months ending with the current month. */
export function sgCutoffMonth(months: number, now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 7);
}

export const MAX_ROWS = 5000;
export const PAGE_SIZE = 1000;

export async function sgHomeSales(
  input: { town: string; flat_type?: string; months?: number; baseUrl?: string },
  fetcher?: Fetcher,
  now = new Date(),
): Promise<PriceAnswer> {
  const months = Math.max(1, Math.min(36, Math.round(input.months ?? 12)));
  const cutoffMonth = sgCutoffMonth(months, now);
  const fetch = fetcher ?? resolveFetcher({ timeoutMs: 20000 });
  // Newest first; keep paging while a full page still reaches into the window. At most MAX_ROWS resales.
  const got = await collectPages<{ month: string; price: number; area: number }>({
    maxRows: MAX_ROWS,
    pageSize: PAGE_SIZE,
    fetchPage: async (offset, limit) => {
      const json = await fetch(buildSgUrl(input.town, input.flat_type, limit, offset));
      const raw = (json as any)?.result?.records;
      const rows = parseSgRecords(json);
      const oldest = Array.isArray(raw) && raw.length ? String(raw[raw.length - 1].month ?? "") : "";
      return { rows, more: Array.isArray(raw) && raw.length >= limit && oldest > cutoffMonth };
    },
  });
  let rows = got.rows.filter((r) => r.month > cutoffMonth);
  // Stopped at the cap with older resales left: the oldest month read is partial, so drop it and keep whole months only.
  const capped = got.truncated && rows.length > 0;
  if (capped) {
    const oldest = rows.reduce((a, r) => (r.month < a ? r.month : a), "9999-99");
    rows = rows.filter((r) => r.month > oldest);
  }
  const months_ = rows.map((r) => r.month).sort();
  const s = summarise(rows.map((r) => r.price));
  const psm = summarise(rows.filter((r) => r.area > 0).map((r) => r.price / r.area));
  const town = input.town.trim().toUpperCase();
  const label = `${input.flat_type ? input.flat_type.toUpperCase() + " " : ""}HDB resale flats in ${town}${input.flat_type ? "" : " (all flat types)"}`;
  return buildAnswer({
    source: INFO,
    query: { country: "SG", town: input.town, flat_type: input.flat_type ?? null, months },
    summary: s,
    currency: "SGD",
    unit: "per flat",
    period: { from: months_[0] ?? null, to: months_[months_.length - 1] ?? null },
    method:
      "Median and 10th–90th percentile of registered HDB resale transactions in the selected town, flat type and period (by month of registration). " +
      `At most ${MAX_ROWS.toLocaleString("en-US")} resales are read; if the window holds more, only the most recent whole months are used and the period shows them.`,
    describe: (x) =>
      `${label} sold for a median of ${fmtMoney(x.median, "SGD")}; 10th–90th percentile range ${fmtMoney(x.low, "SGD")}–${fmtMoney(x.high, "SGD")}.` +
      (capped ? ` Only the most recent whole months (${months_[0]} to ${months_[months_.length - 1]}) are used: the town has more resales than one answer reads.` : ""),
    baseUrl: input.baseUrl,
    extra: {
      ...(psm ? { median_price_per_sqm: psm.median } : {}),
      ...(capped
        ? { capped: `The window holds more than ${MAX_ROWS.toLocaleString("en-US")} resales; this answer uses the most recent whole months only. Give a flat_type or a shorter period for the full window.` }
        : {}),
    },
  });
}
