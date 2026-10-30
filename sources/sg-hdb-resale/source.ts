// Singapore public-housing (HDB) resale prices from data.gov.sg.

import { SourceError } from "../../lib/http";
import { collectPages, resolveFetcher } from "../../lib/adapters";
import type { Fetcher } from "../../lib/adapters";
import { summarise } from "../../lib/stats";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";

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

/** The HDB towns exactly as the dataset spells them. */
export const SG_TOWNS = [
  "ANG MO KIO", "BEDOK", "BISHAN", "BUKIT BATOK", "BUKIT MERAH", "BUKIT PANJANG", "BUKIT TIMAH", "CENTRAL AREA",
  "CHOA CHU KANG", "CLEMENTI", "GEYLANG", "HOUGANG", "JURONG EAST", "JURONG WEST", "KALLANG/WHAMPOA", "MARINE PARADE",
  "PASIR RIS", "PUNGGOL", "QUEENSTOWN", "SEMBAWANG", "SENGKANG", "SERANGOON", "TAMPINES", "TOA PAYOH", "WOODLANDS", "YISHUN",
] as const;

const SG_ALIASES: Record<string, string> = {
  AMK: "ANG MO KIO", CCK: "CHOA CHU KANG", KALLANG: "KALLANG/WHAMPOA", WHAMPOA: "KALLANG/WHAMPOA", CENTRAL: "CENTRAL AREA",
  CBD: "CENTRAL AREA", DOWNTOWN: "CENTRAL AREA", CITY: "CENTRAL AREA", TOAPAYOH: "TOA PAYOH", PAYAH: "TOA PAYOH",
};

const squash = (x: string) =>
  x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase()
    .replace(/\b(SINGAPORE|HDB|TOWNS?|TOWNSHIP|ESTATES?|NEW|PLANNING|AREA|DISTRICT)\b/g, (m) => (m === "AREA" ? m : ""))
    .replace(/[^A-Z0-9]/g, "");

function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/** Map what an agent typed ("tampines", "Tampines, Singapore", "Ang-Mo-Kio", "Kallang", "AMK") to the dataset's town name; null if none. */
export function resolveSgTown(raw: string): string | null {
  const key = squash(raw.split(",")[0]) || squash(raw);
  if (!key) return null;
  const exact = SG_TOWNS.find((t) => squash(t) === key);
  if (exact) return exact;
  const alias = Object.entries(SG_ALIASES).find(([k]) => squash(k) === key);
  if (alias) return alias[1];
  if (key.length >= 6) {
    const near = SG_TOWNS.filter((t) => editDistance(squash(t), key) <= (key.length >= 9 ? 2 : 1));
    if (near.length === 1) return near[0];
  }
  return null;
}

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
  const resolved = resolveSgTown(input.town);
  if (!resolved) {
    // Not an HDB town: say so and list the real ones instead of asking the portal for nothing.
    const none = buildAnswer({
      source: INFO,
      query: { country: "SG", town: input.town, flat_type: input.flat_type ?? null, months },
      summary: summarise([]),
      currency: "SGD",
      unit: "per flat",
      period: { from: null, to: null },
      method: "HDB resale transactions are filed under 26 HDB towns; the town given is not one of them.",
      describe: () => `"${input.town.trim()}" is not an HDB town. Use one of: ${SG_TOWNS.join(", ")}.`,
      baseUrl: input.baseUrl,
      extra: { valid_towns: [...SG_TOWNS] },
    });
    return { ...none, summary: `"${input.town.trim()}" is not an HDB town, so there are no HDB resales to report. Use one of: ${SG_TOWNS.join(", ")}.` };
  }
  const cutoffMonth = sgCutoffMonth(months, now);
  const fetch = fetcher ?? resolveFetcher({ timeoutMs: 20000 });
  // Newest first; keep paging while a full page still reaches into the window. At most MAX_ROWS resales.
  const got = await collectPages<{ month: string; price: number; area: number }>({
    maxRows: MAX_ROWS,
    pageSize: PAGE_SIZE,
    fetchPage: async (offset, limit) => {
      const url = buildSgUrl(resolved, input.flat_type, limit, offset);
      let json: unknown;
      try {
        json = await fetch(url);
      } catch {
        json = await fetch(url); // one retry per page: data.gov.sg sometimes answers 429 or times out, and a stale copy is worse than a second try
      }
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
  const town = resolved;
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


// ---------- daily collector (stale-if-error copy and /history) ----------
// data.gov.sg answers one town at a time and is slow from Vercel. Once a day the collector (GitHub Actions) reads the newest
// 12 months of HDB resales in pages (all towns at once, newest first) and stores, per town, the rolling-12-month median of
// all flats and of each flat type (5+ resales only). Aggregates only: no block, street or unit is kept. The library copy
// stands in for a live answer for 7 days (lib/stale.ts) and /history shows the median moving day by day.

export const HARVEST_MONTHS = 12;
const HARVEST_MAX_ROWS = 45000; // about 30,000 resales a year; the platform's hard limit is 50,000
const HARVEST_PAGE = 1000;

const slug = (flat: string) => flat.trim().toLowerCase().replace(/\s+/g, "-");
export const sgItem = (flat?: string) => `${flat ? slug(flat) : "any"}:${HARVEST_MONTHS}m`;

/** Library key for a request, or null when the copy cannot answer it (not an HDB town, unknown flat type, other window). */
export function sgHistoryKey(p: { town?: string; flat_type?: string; months?: number }, opts?: { monthly?: boolean }): { area: string; item: string; label: string } | null {
  if (opts?.monthly) return null; // no long monthly history is loaded for this source
  if (p.months !== undefined && p.months !== null && Number(p.months) !== HARVEST_MONTHS) return null;
  const town = p.town ? resolveSgTown(p.town) : null;
  if (!town) return null;
  let flat: string | undefined;
  if (p.flat_type) {
    flat = p.flat_type.trim().toUpperCase();
    if (!(SG_FLAT_TYPES as readonly string[]).includes(flat)) return null;
  }
  return { area: town, item: sgItem(flat), label: `${town}${flat ? ` ${flat}` : ""}` };
}

export function buildSgBulkUrl(limit = HARVEST_PAGE, offset = 0): string {
  const params = new URLSearchParams({ resource_id: RESOURCE_ID, sort: "month desc,_id desc", limit: String(limit) });
  if (offset > 0) params.set("offset", String(offset));
  return `${ENDPOINT}?${params.toString()}`;
}

export interface SgSale {
  month: string;
  town: string;
  flat: string;
  price: number;
}

export function parseSgBulk(json: any): { sales: SgSale[]; rawCount: number; oldest: string } {
  const recs = json?.result?.records;
  if (!json?.success || !Array.isArray(recs)) throw new SourceError("Unexpected response from data.gov.sg");
  const sales = recs
    .map((r: any) => ({ month: String(r.month), town: String(r.town ?? "").toUpperCase(), flat: String(r.flat_type ?? "").toUpperCase(), price: Number(r.resale_price) }))
    .filter((r) => /^\d{4}-\d{2}$/.test(r.month) && r.town && Number.isFinite(r.price) && r.price > 0);
  return { sales, rawCount: recs.length, oldest: recs.length ? String(recs[recs.length - 1].month ?? "") : "" };
}

/** Pure: one library row per town and flat-type group (and per town for all flats) with at least 5 resales. */
export function sgDailyRows(sales: SgSale[]): DailyRow[] {
  const groups = new Map<string, number[]>();
  const put = (key: string, price: number) => {
    const g = groups.get(key);
    if (g) g.push(price);
    else groups.set(key, [price]);
  };
  for (const s of sales) {
    put(`${s.town}\t${sgItem()}`, s.price);
    if ((SG_FLAT_TYPES as readonly string[]).includes(s.flat)) put(`${s.town}\t${sgItem(s.flat)}`, s.price);
  }
  const rows: DailyRow[] = [];
  for (const [key, prices] of groups) {
    const sum = summarise(prices);
    if (!sum || sum.count < 5) continue;
    const [area, item] = key.split("\t");
    rows.push({ area, item, n: sum.count, median: sum.median, low: sum.low, high: sum.high, min: sum.min, max: sum.max });
  }
  return rows.sort((a, b) => (a.area + a.item).localeCompare(b.area + b.item));
}

export async function sgHarvest(fetcher?: Fetcher, now = new Date()): Promise<HarvestResult> {
  const fetch = fetcher ?? resolveFetcher({ timeoutMs: 30000 });
  const cutoff = sgCutoffMonth(HARVEST_MONTHS, now);
  const got = await collectPages<SgSale>({
    maxRows: HARVEST_MAX_ROWS,
    pageSize: HARVEST_PAGE,
    fetchPage: async (offset, limit) => {
      let json: unknown;
      try {
        json = await fetch(buildSgBulkUrl(limit, offset));
      } catch {
        json = await fetch(buildSgBulkUrl(limit, offset)); // one retry per page: the portal sometimes answers 429 or times out
      }
      const p = parseSgBulk(json);
      return { rows: p.sales, more: p.rawCount >= limit && p.oldest > cutoff };
    },
  });
  if (got.truncated) throw new SourceError(`HDB resale window holds more than ${HARVEST_MAX_ROWS} rows; the collector needs a higher cap.`);
  const inWindow = got.rows.filter((r) => r.month > cutoff);
  const rows = sgDailyRows(inWindow);
  const towns = new Set(rows.filter((r) => r.item === sgItem()).map((r) => r.area));
  // A real year has resales in all 26 towns; far fewer means a partial read or a changed layout.
  if (towns.size < 20) throw new SourceError(`Only ${towns.size} HDB towns had 5+ resales in the window; the portal answer looks incomplete.`);
  return {
    date: now.toISOString().slice(0, 10),
    currency: "SGD",
    unit: "per flat",
    rows,
    note: `HDB resale flats, median of the registered resales from ${cutoff} (excluded) to the newest month, ${rows.length} town/flat-type rows over ${towns.size} towns, ${inWindow.length} resales read. Aggregates of 5+ resales only.`,
  };
}
