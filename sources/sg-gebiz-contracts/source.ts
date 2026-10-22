// Singapore government contract prices from GeBIZ awarded tenders (Ministry of Finance), published on data.gov.sg.
// Facts proven 2026-10-20 (probe on GitHub Actions): GET https://data.gov.sg/api/action/datastore_search?resource_id=d_acde1106003906a75c3fa052592f2fcb&q=<words>&limit=1000
// is key-free JSON { success, result: { records: [...], total } }. Every field is text except awarded_amt ("384336", "259134.86"). Dates are d/m/yyyy.
// q is a full-text search over the row (q=cleaning -> total 182). Dataset: FY2021 to FY2025 awards, updated about once a year.
import { fetchJson, InputError, SourceError } from "../../lib/http";
import type { SourceInfo } from "../../lib/plugin";
import type { PriceAnswer } from "../../lib/answer";
import { contractAnswer } from "../../categories/contracts/answer";
import { matchPurchase, monthsWindow, normaliseText } from "../../categories/contracts/purchases";

export const INFO: SourceInfo = {
  id: "sg-gebiz-contracts",
  country: "SG (Singapore)",
  category: "government contracts (awarded tenders)",
  name: "GeBIZ awarded government tenders",
  publisher: "Ministry of Finance, Singapore (GeBIZ) via data.gov.sg",
  what_is_recorded:
    "Tenders awarded by Singapore public agencies through GeBIZ: tender number, description, agency, award date and the total awarded amount.",
  price_type: "contract_price",
  freshness: "Yearly",
  licence: "Singapore Open Data Licence v1.0",
  licence_url: "https://data.gov.sg/open-data-licence",
  attribution:
    "Contains information from Government Procurement via GeBIZ (Ministry of Finance) accessed from data.gov.sg, made available under the Singapore Open Data Licence version 1.0.",
  homepage: "https://data.gov.sg/datasets/d_acde1106003906a75c3fa052592f2fcb/view",
  limits:
    "Awarded tender values, often covering several years and options, not unit prices. The dataset is refreshed about once a year, so the newest awards can be many months old. " +
    "Search is a free-text match on the tender description, so some matches are loosely related. Aggregates only; suppliers are never named.",
};

export const RESOURCE_ID = "d_acde1106003906a75c3fa052592f2fcb";
export const ENDPOINT = "https://data.gov.sg/api/action/datastore_search";
export const PAGE = 1000;
export const MAX_PAGES = 5;
/** Awarded amounts below this are placeholders, not contract prices. */
export const MIN_VALUE = 100;

export interface SgAward {
  id: string;
  value: number;
  date: string; // YYYY-MM-DD
  agency: string;
}

/** "6/7/2023" -> "2023-07-06" (day first). Null when it is not a date. */
export function parseSgDate(s: string): string | null {
  const m = String(s ?? "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function buildUrl(q: string, offset = 0): string {
  const p = new URLSearchParams({ resource_id: RESOURCE_ID, limit: String(PAGE), q });
  if (offset) p.set("offset", String(offset));
  return `${ENDPOINT}?${p.toString()}`;
}

/** Pure parser: awarded tenders with a real amount and a date. Other statuses, placeholders and repeated tender numbers are dropped. */
export function parseRecords(json: any): { awards: SgAward[]; total: number; skipped: number } {
  const recs = json?.result?.records;
  if (!json?.success || !Array.isArray(recs)) throw new SourceError("Unexpected response from data.gov.sg");
  const awards: SgAward[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const r of recs) {
    const status = String(r.tender_detail_status ?? "");
    const value = Number(r.awarded_amt);
    const date = parseSgDate(r.award_date);
    const id = String(r.tender_no ?? r._id ?? "");
    if (!/^awarded/i.test(status) || !Number.isFinite(value) || value < MIN_VALUE || !date) {
      skipped++;
      continue;
    }
    // one tender can be awarded to several suppliers (one row each): count its rows once per amount
    const key = `${id}|${r.awarded_amt}|${r.supplier_name ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    awards.push({ id, value, date, agency: String(r.agency ?? "") });
  }
  return { awards, total: Number(json?.result?.total ?? recs.length), skipped };
}

export interface SgInput {
  what: string;
  cpv?: string;
  buyer_area?: string;
  months: number;
  baseUrl?: string;
  now?: Date;
}

export async function sgContracts(input: SgInput): Promise<PriceAnswer> {
  if (input.cpv) throw new InputError("Singapore tenders carry no CPV codes: leave cpv out and say what was bought in words.");
  const p = matchPurchase(input.what);
  const q = (p ? p.keyword : input.what).replace(/\s+/g, " ").trim();
  const label = p ? p.label : input.what;
  const win = monthsWindow(input.months, input.now);
  let all: SgAward[] = [];
  let total = 0;
  let skipped = 0;
  let capped = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    const json = await fetchJson(buildUrl(q, page * PAGE), { headers: { accept: "application/json" } }, 25000);
    const r = parseRecords(json);
    total = r.total;
    skipped += r.skipped;
    all = all.concat(r.awards);
    if ((page + 1) * PAGE >= total) break;
    if (page === MAX_PAGES - 1) capped = true;
  }
  let where = "Singapore";
  if (input.buyer_area) {
    const needle = normaliseText(input.buyer_area);
    all = all.filter((a) => normaliseText(a.agency).includes(needle));
    where = `Singapore (agencies matching "${input.buyer_area}")`;
  }
  const inWindow = all.filter((a) => a.date >= win.from && a.date <= win.to);
  const dates = inWindow.map((a) => a.date).sort();
  const notes = [
    "Each value is the total awarded for a tender, often covering several years and extension options; amounts under 100 dollars are left out as placeholders.",
    "The dataset is published about once a year, so recent months may hold few or no awards.",
  ];
  if (capped) notes.push(`More than ${MAX_PAGES * PAGE} tenders match; only the first ${MAX_PAGES * PAGE} were read.`);
  return contractAnswer({
    source: INFO,
    query: { country: "SG", what: input.what, ...(input.buyer_area ? { buyer_area: input.buyer_area } : {}), months: input.months },
    values: inWindow.map((a) => a.value),
    currency: "SGD",
    what: label,
    where,
    period: { from: win.from, to: win.to },
    newest: dates.length ? dates[dates.length - 1] : null,
    method:
      `GeBIZ awarded tenders on data.gov.sg with an award date between ${win.from} and ${win.to}, found by the free-text search "${q}" in the tender description` +
      (input.buyer_area ? ` and an agency name containing "${input.buyer_area}"` : "") +
      ". Each awarded tender is one contract. Median and 10th–90th percentile in SGD; never supplier names. Totals per tender, not unit prices.",
    notes,
    baseUrl: input.baseUrl,
    extra: { matched_filter: q, tenders_matching: total, awards_used: inWindow.length, rows_skipped: skipped },
  });
}
