// Singapore: monthly rents of HDB flats approved for renting out ("Renting Out of Flats from Jan 2021"), from data.gov.sg.
// One row per approved rental: month, town, block, street, flat type, monthly rent. We read only the rows for one town
// (newest first, a few pages at most) and give the median and 10th-90th percentile; never a block or street.
// Format checked live on 2026-10-14 from GitHub's servers (datastore_search on resource d_c9f57187485a850908655db0e8cfe651).

import { InputError, SourceError } from "../../lib/http";
import { collectPages, datastoreSearchUrl, parseDatastoreSearch, resolveFetcher } from "../../lib/adapters";
import type { Fetcher } from "../../lib/adapters";
import { summarise } from "../../lib/stats";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";

export const INFO: SourceInfo = {
  id: "sg-hdb-rents",
  country: "SG (Singapore)",
  category: "rent (approved HDB rentals)",
  name: "Renting Out of Flats from Jan 2021",
  publisher: "Housing & Development Board (HDB) via data.gov.sg",
  what_is_recorded: "Rents of public-housing (HDB) flats approved for renting out: approval month, town, block, street, flat type and monthly rent.",
  price_type: "transaction",
  freshness: "Monthly; the previous month's approvals appear in the first days of the next month",
  licence: "Singapore Open Data Licence v1.0",
  licence_url: "https://data.gov.sg/open-data-licence",
  attribution:
    "Contains information from Renting Out of Flats from Jan 2021 accessed from data.gov.sg, made available under the terms of the Singapore Open Data Licence version 1.0.",
  homepage: "https://data.gov.sg/datasets/d_c9f57187485a850908655db0e8cfe651/view",
  limits:
    "HDB public-housing flats only: private condominiums and landed homes are not included. The publisher says the rents are indicative only: owner-declared, and HDB does not verify their accuracy. Aggregates only: never a block or street.",
};

export const RESOURCE_ID = "d_c9f57187485a850908655db0e8cfe651";
export const SITE = "https://data.gov.sg/api/action";

export const SG_TOWNS = [
  "ANG MO KIO", "BEDOK", "BISHAN", "BUKIT BATOK", "BUKIT MERAH", "BUKIT PANJANG", "BUKIT TIMAH", "CENTRAL AREA", "CHOA CHU KANG",
  "CLEMENTI", "GEYLANG", "HOUGANG", "JURONG EAST", "JURONG WEST", "KALLANG/WHAMPOA", "MARINE PARADE", "PASIR RIS", "PUNGGOL",
  "QUEENSTOWN", "SEMBAWANG", "SENGKANG", "SERANGOON", "TAMPINES", "TOA PAYOH", "WOODLANDS", "YISHUN",
] as const;
const TOWN_ALIASES: Record<string, string> = {
  KALLANG: "KALLANG/WHAMPOA", WHAMPOA: "KALLANG/WHAMPOA", "KALLANG WHAMPOA": "KALLANG/WHAMPOA",
  CBD: "CENTRAL AREA", CENTRAL: "CENTRAL AREA", "CITY CENTRE": "CENTRAL AREA", "CITY CENTER": "CENTRAL AREA", DOWNTOWN: "CENTRAL AREA",
  AMK: "ANG MO KIO", CCK: "CHOA CHU KANG", "BT MERAH": "BUKIT MERAH", "BT BATOK": "BUKIT BATOK", "BT PANJANG": "BUKIT PANJANG", "BT TIMAH": "BUKIT TIMAH",
};

export const SG_FLAT_TYPES = ["1-ROOM", "2-ROOM", "3-ROOM", "4-ROOM", "5-ROOM", "EXECUTIVE"] as const;

export function normaliseTown(input: string): string {
  const t = input.trim().toUpperCase().replace(/\s+/g, " ");
  if ((SG_TOWNS as readonly string[]).includes(t)) return t;
  if (TOWN_ALIASES[t]) return TOWN_ALIASES[t];
  const starts = SG_TOWNS.filter((x) => x.startsWith(t));
  if (t.length >= 3 && starts.length === 1) return starts[0];
  throw new InputError(`'${input}' is not an HDB town. Use one of: ${SG_TOWNS.join(", ")}.`);
}

/** "4 room", "4-ROOM", "4room", "4 rm", "executive" -> "4-ROOM" / "EXECUTIVE". */
export function normaliseFlatType(input: string): string {
  const t = input.trim().toUpperCase().replace(/[\s_-]+/g, " ");
  const m = /^([1-5]) ?(ROOM|ROOMS|RM|BR)?$/.exec(t);
  if (m) return `${m[1]}-ROOM`;
  if (t === "EXECUTIVE" || t === "EXEC") return "EXECUTIVE";
  throw new InputError(`flat_type must be one of: ${SG_FLAT_TYPES.join(", ")} ("4 ROOM" is accepted).`);
}

export interface SgRent {
  month: string; // YYYY-MM
  flat_type: string;
  rent: number; // SGD per month
}

export function parseSgRents(records: Record<string, any>[]): SgRent[] {
  const out: SgRent[] = [];
  for (const r of records) {
    const month = String(r.rent_approval_date ?? "");
    const rent = Number(r.monthly_rent);
    if (!/^\d{4}-\d{2}$/.test(month) || !Number.isFinite(rent) || rent < 100 || rent > 30000) continue;
    out.push({ month, flat_type: String(r.flat_type ?? ""), rent });
  }
  return out;
}

export function cutoffMonth(months: number, now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 7);
}

/** The last day of a YYYY-MM month, as YYYY-MM-DD. */
function monthEnd(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

export interface SgRentInput {
  town?: string;
  flat_type?: string;
  months?: number;
  baseUrl?: string;
}

export async function sgRents(input: SgRentInput, fetcher?: Fetcher, now = new Date()): Promise<PriceAnswer> {
  if (!input.town) throw new InputError("A town is required, e.g. 'Tampines'.");
  const town = normaliseTown(input.town);
  const flatType = input.flat_type ? normaliseFlatType(input.flat_type) : undefined;
  const months = Math.max(1, Math.min(36, Math.round(input.months ?? 12)));
  const from = cutoffMonth(months, now);
  const filters: Record<string, string> = { town };
  if (flatType) filters.flat_type = flatType;
  const o = { fetcher: fetcher ?? resolveFetcher({ timeoutMs: 20000 }) };

  // Newest first; stop paging as soon as a page reaches back before the window. At most 5 pages (5 000 rents).
  const got = await collectPages<Record<string, any>>({
    maxRows: 5000,
    pageSize: 1000,
    fetchPage: async (offset, limit) => {
      const url = datastoreSearchUrl(SITE, { resourceId: RESOURCE_ID, filters, sort: ["rent_approval_date desc", "_id desc"], limit, offset, includeTotal: false });
      const r = parseDatastoreSearch(await o.fetcher(url));
      const oldest = r.records.length ? String(r.records[r.records.length - 1].rent_approval_date ?? "") : "";
      return { rows: r.records, more: r.records.length >= limit && oldest >= from };
    },
  });

  let rows = parseSgRents(got.rows).filter((r) => r.month >= from);
  // Reading stopped at 5 000 rents with older ones left: keep only whole months, so the period is honest.
  const capped = got.truncated && rows.length > 0;
  if (capped) {
    const oldest = rows.reduce((a, r) => (r.month < a ? r.month : a), "9999-99");
    rows = rows.filter((r) => r.month > oldest);
  }
  const monthsSeen = rows.map((r) => r.month).sort();
  const s = summarise(rows.map((r) => r.rent));
  const label = `${flatType ? flatType + " " : ""}HDB flats in ${town}`;

  let byFlatType: Record<string, { median: number; records: number }> | undefined;
  if (!flatType) {
    byFlatType = {};
    for (const ft of SG_FLAT_TYPES) {
      const x = summarise(rows.filter((r) => r.flat_type === ft).map((r) => r.rent));
      if (x && x.count >= 5) byFlatType[ft] = { median: x.median, records: x.count };
    }
  }
  const last = monthsSeen[monthsSeen.length - 1] ?? null;
  const ageMonths = last ? (now.getUTCFullYear() - Number(last.slice(0, 4))) * 12 + (now.getUTCMonth() + 1 - Number(last.slice(5, 7))) : 0;

  return buildAnswer({
    source: INFO,
    query: { country: "SG", town, flat_type: flatType ?? null, months },
    summary: s,
    currency: "SGD",
    unit: "per month",
    period: { from: monthsSeen[0] ?? null, to: last },
    method:
      "Median and 10th–90th percentile of the monthly rents of HDB flats approved for renting out in the selected town, flat type and window (by month of approval). " +
      "The publisher describes the rents as indicative only: declared by the owner and not verified by HDB.",
    describe: (x) =>
      `${label} were approved for rent at a median of ${fmtMoney(x.median, "SGD")} a month; 10th–90th percentile range ${fmtMoney(x.low, "SGD")}–${fmtMoney(x.high, "SGD")}. ` +
      "These are the monthly rents owners declared when HDB approved the rental, not verified by HDB; HDB public-housing flats only, no private condominiums.",
    baseUrl: input.baseUrl,
    extra: {
      ...(byFlatType && Object.keys(byFlatType).length ? { by_flat_type: byFlatType } : {}),
      latest_month_end: last ? monthEnd(last) : null,
      ...(capped ? { capped: "The window holds more than 5 000 approved rents; this answer uses the most recent whole months only. Give a flat_type or a shorter period for the full window." } : {}),
      caveat: "Owner-declared rents of HDB (public housing) flats, not verified by HDB. Private condominiums are not included.",
      ...(ageMonths > 2 ? { data_age_note: `The newest approval month in this window is ${last}, ${ageMonths} months ago.` } : {}),
    },
  });
}


// ---------- daily collector (stale-if-error copy and /history) ----------
// data.gov.sg is slow from Vercel and sometimes answers 429. Once a day the collector (GitHub Actions) reads, town by town
// (26 small requests, newest first, stopping at the window start), the last 12 months of approved HDB rentals and stores
// per town the median and 10th-90th percentile of all flats and of each flat type (5+ rentals only). Aggregates only: no
// block or street is kept. The library copy stands in for a live answer for 7 days (lib/stale.ts) and /history shows it moving.

export const HARVEST_MONTHS = 12;
export const sgRentItem = (flat?: string) => `${flat ? flat.toLowerCase() : "any"}:${HARVEST_MONTHS}m`;

/** Library key for a request, or null when the copy cannot answer it (not an HDB town, unknown flat type, other window). */
export function sgRentHistoryKey(p: { town?: string; flat_type?: string; months?: number }, opts?: { monthly?: boolean }): { area: string; item: string; label: string } | null {
  if (opts?.monthly) return null; // no long monthly history is loaded for this source
  if (p.months !== undefined && p.months !== null && Number(p.months) !== HARVEST_MONTHS) return null;
  if (!p.town) return null;
  let town: string;
  let flat: string | undefined;
  try {
    town = normaliseTown(p.town);
    flat = p.flat_type ? normaliseFlatType(p.flat_type) : undefined;
  } catch {
    return null;
  }
  return { area: town, item: sgRentItem(flat), label: `${town}${flat ? ` ${flat}` : ""}` };
}

/** Pure: one library row per town and flat type (and per town for all flats) with at least 5 rentals. */
export function sgRentDailyRows(byTown: Record<string, SgRent[]>): DailyRow[] {
  const rows: DailyRow[] = [];
  const add = (area: string, item: string, rents: number[]) => {
    const s = summarise(rents);
    if (!s || s.count < 5) return;
    rows.push({ area, item, n: s.count, median: s.median, low: s.low, high: s.high, min: s.min, max: s.max });
  };
  for (const [town, list] of Object.entries(byTown)) {
    add(town, sgRentItem(), list.map((r) => r.rent));
    for (const ft of SG_FLAT_TYPES) add(town, sgRentItem(ft), list.filter((r) => r.flat_type === ft).map((r) => r.rent));
  }
  return rows.sort((a, b) => (a.area + a.item).localeCompare(b.area + b.item));
}

/** Politeness towards data.gov.sg, which answers HTTP 429 to a fast burst (first live run 2026-10-29): a pause before every call and a longer one before each retry. */
export const HARVEST_PAUSE_MS = 1500;
export const HARVEST_RETRY_MS = [6000, 20000];
const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function sgRentHarvest(fetcher?: Fetcher, now = new Date(), sleep: (ms: number) => Promise<void> = realSleep): Promise<HarvestResult> {
  const fetch = fetcher ?? resolveFetcher({ timeoutMs: 30000 });
  const from = cutoffMonth(HARVEST_MONTHS, now);
  const byTown: Record<string, SgRent[]> = {};
  let read = 0;
  for (const town of SG_TOWNS) {
    const got = await collectPages<Record<string, any>>({
      maxRows: 10000,
      pageSize: 1000,
      fetchPage: async (offset, limit) => {
        const url = datastoreSearchUrl(SITE, { resourceId: RESOURCE_ID, filters: { town }, sort: ["rent_approval_date desc", "_id desc"], limit, offset, includeTotal: false });
        await sleep(HARVEST_PAUSE_MS);
        let json: unknown;
        for (let attempt = 0; ; attempt++) {
          try {
            json = await fetch(url);
            break;
          } catch (e) {
            if (attempt >= HARVEST_RETRY_MS.length) throw e; // the portal sometimes answers 429 or times out: wait, then try again
            await sleep(HARVEST_RETRY_MS[attempt]);
          }
        }
        const r = parseDatastoreSearch(json);
        const oldest = r.records.length ? String(r.records[r.records.length - 1].rent_approval_date ?? "") : "";
        return { rows: r.records, more: r.records.length >= limit && oldest >= from };
      },
    });
    if (got.truncated) throw new SourceError(`HDB rentals in ${town} exceed the collector's cap of 10 000 rows.`);
    byTown[town] = parseSgRents(got.rows).filter((r) => r.month >= from);
    read += byTown[town].length;
  }
  const rows = sgRentDailyRows(byTown);
  const towns = new Set(rows.filter((r) => r.item === sgRentItem()).map((r) => r.area));
  // A real year has 5+ approved rentals in nearly every town; far fewer means a partial read or a changed layout.
  if (towns.size < 20) throw new SourceError(`Only ${towns.size} HDB towns had 5+ rentals in the window; the portal answer looks incomplete.`);
  return {
    date: now.toISOString().slice(0, 10),
    currency: "SGD",
    unit: "per month",
    rows,
    note: `HDB approved rentals, median of approvals from ${from} to the newest month, ${rows.length} town/flat-type rows over ${towns.size} towns, ${read} rentals read. Aggregates of 5+ rentals only.`,
  };
}
