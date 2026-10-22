// England & Wales home sales from HM Land Registry Price Paid Data, via its public SPARQL endpoint.
// We fetch recent standard-price sales for a town (optionally a postcode district and property type)
// and return aggregates only. Addresses are never returned.

import { fetchJson, SourceError } from "../../lib/http";
import { summarise } from "../../lib/stats";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import type { SourceInfo } from "../../lib/plugin";

export const INFO: SourceInfo = {
  id: "gb-hmlr-ppd",
  country: "GB (England & Wales)",
  category: "home sales",
  name: "Price Paid Data",
  publisher: "HM Land Registry",
  what_is_recorded: "Residential property sales: price paid, completion date, property type, address.",
  price_type: "transaction",
  freshness: "Monthly; sales appear only once registered, often weeks to months after completion, so the latest months are incomplete",
  licence: "Open Government Licence v3.0",
  licence_url: "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/",
  attribution:
    "Contains HM Land Registry data © Crown copyright and database right. This data is licensed under the Open Government Licence v3.0.",
  homepage: "https://www.gov.uk/government/statistical-data-sets/price-paid-data-downloads",
  limits:
    "We return aggregates only (median, range, count), never individual addresses. Standard-price sales only (category A): repossessions, buy-to-lets identified by a mortgage, transfers to companies and other non-standard sales (category B) are left out. " +
    "Prices are per home, as paid at completion. Sales reach the data only once registered, often weeks to months after completion, so the most recent months are incomplete. England and Wales only.",
};


const ENDPOINT = "https://landregistry.data.gov.uk/landregistry/query";

export const UK_PROPERTY_TYPES = ["detached", "semi-detached", "terraced", "flat-maisonette", "any"] as const;
export type UkPropertyType = (typeof UK_PROPERTY_TYPES)[number];

export function buildUkQuery(params: {
  town: string;
  postcodeDistrict?: string;
  propertyType: UkPropertyType;
  fromDate: string; // YYYY-MM-DD, inclusive
  toDate?: string; // YYYY-MM-DD, exclusive; omitted = no upper bound
  limit: number;
}): string {
  const town = params.town.trim().toUpperCase().replace(/"/g, "");
  const typeClause =
    params.propertyType === "any" ? "" : `?transx lrppi:propertyType lrcommon:${params.propertyType} .`;
  const district = params.postcodeDistrict?.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  const districtClause = district
    ? `?addr lrcommon:postcode ?postcode . FILTER(STRSTARTS(?postcode, "${district} "))`
    : "";
  return `
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
PREFIX lrppi: <http://landregistry.data.gov.uk/def/ppi/>
PREFIX lrcommon: <http://landregistry.data.gov.uk/def/common/>
SELECT ?amount ?date WHERE {
  VALUES ?town { "${town}"^^xsd:string }
  ?addr lrcommon:town ?town .
  ${districtClause}
  ?transx lrppi:propertyAddress ?addr ;
          lrppi:pricePaid ?amount ;
          lrppi:transactionDate ?date ;
          lrppi:transactionCategory <http://landregistry.data.gov.uk/def/ppi/standardPricePaidTransaction> .
  ${typeClause}
  FILTER (?date >= "${params.fromDate}"^^xsd:date${params.toDate ? ` && ?date < "${params.toDate}"^^xsd:date` : ""})
}
LIMIT ${params.limit}`;
}

export function parseUkBindings(json: any): { amount: number; date: string }[] {
  const rows = json?.results?.bindings;
  if (!Array.isArray(rows)) throw new SourceError("Unexpected response from HM Land Registry");
  return rows
    .map((r: any) => ({ amount: Number(r?.amount?.value), date: String(r?.date?.value ?? "").slice(0, 10) }))
    .filter((r) => Number.isFinite(r.amount) && r.amount > 0 && r.date);
}

// ---------- the time window ----------
// One query for a whole year returns at most `limit` rows, and the endpoint hands them back newest first, so a busy town's
// "12 months" used to be its newest 5,000 sales (Bristol: 7 months). Instead we ask month by month. A month that fills the
// row cap is split in halves until each piece fits (down to one day), so the window is covered completely or we say exactly
// which part is missing.

/** Rows one sub-query may return; a piece that reaches it is split in two. */
export const UK_ROW_CAP = 2500;
/** Most sub-queries one answer may use (12 months plus splits of the busiest months). */
export const UK_MAX_QUERIES = 48;
/** How many sub-queries run at once (be gentle with the public endpoint). */
export const UK_CONCURRENCY = 6;
/** Time allowed for all sub-queries together; ANSWER_DEADLINE_MS (40 s) is the outer limit. */
export const UK_BUDGET_MS = 30_000;
const UK_QUERY_TIMEOUT_MS = 18_000;

/** A date range: `from` inclusive, `to` exclusive, both YYYY-MM-DD. */
export interface DateWindow {
  from: string;
  to: string;
}

const dayMs = 86_400_000;
const addDays = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * dayMs).toISOString().slice(0, 10);

/** Calendar-month pieces covering [fromDate, today] (the last piece ends the day after `today`). */
export function monthWindows(fromDate: string, today: string): DateWindow[] {
  const end = addDays(today, 1);
  const out: DateWindow[] = [];
  let cur = fromDate;
  while (cur < end) {
    const y = Number(cur.slice(0, 4));
    const m = Number(cur.slice(5, 7));
    const next = new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1)).toISOString().slice(0, 10);
    out.push({ from: cur, to: next < end ? next : end });
    cur = next;
  }
  return out;
}

/** A window cut into two halves, or null when it is a single day. */
export function splitWindow(w: DateWindow): [DateWindow, DateWindow] | null {
  const days = Math.round((Date.parse(w.to + "T00:00:00Z") - Date.parse(w.from + "T00:00:00Z")) / dayMs);
  if (days < 2) return null;
  const mid = addDays(w.from, Math.floor(days / 2));
  return [{ from: w.from, to: mid }, { from: mid, to: w.to }];
}

export interface UkRow {
  amount: number;
  date: string;
}

export interface UkCollected {
  rows: UkRow[];
  /** Pieces that could not be fetched (time ran out, endpoint error): their sales are NOT in the figure. */
  missing: DateWindow[];
  /** Single days that still hit the row cap: only part of that day's sales are in the figure. */
  capped: DateWindow[];
  queries: number;
}

/** Fetch every piece of the window. `fetchWindow` is injected so tests need no network. Never throws for one bad piece:
 *  if NOTHING could be fetched the first error is rethrown (the caller's stale-if-error then applies). */
export async function collectUk(
  fetchWindow: (w: DateWindow) => Promise<UkRow[]>,
  windows: DateWindow[],
  opts: { cap?: number; maxQueries?: number; concurrency?: number; budgetMs?: number; now?: () => number } = {},
): Promise<UkCollected> {
  const cap = opts.cap ?? UK_ROW_CAP;
  const maxQueries = opts.maxQueries ?? UK_MAX_QUERIES;
  const concurrency = opts.concurrency ?? UK_CONCURRENCY;
  const budgetMs = opts.budgetMs ?? UK_BUDGET_MS;
  const now = opts.now ?? Date.now;
  const started = now();
  const queue: DateWindow[] = [...windows];
  const out: UkCollected = { rows: [], missing: [], capped: [], queries: 0 };
  let firstError: unknown = null;
  let succeeded = 0;

  const worker = async () => {
    for (;;) {
      const w = queue.shift();
      if (!w) return;
      if (out.queries >= maxQueries || now() - started > budgetMs) {
        out.missing.push(w);
        continue;
      }
      out.queries++;
      try {
        const rows = await fetchWindow(w);
        succeeded++;
        if (rows.length >= cap) {
          const halves = splitWindow(w);
          if (halves) {
            queue.push(...halves);
            continue;
          }
          out.capped.push(w);
        }
        out.rows.push(...rows);
      } catch (e) {
        firstError ??= e;
        out.missing.push(w);
      }
    }
  };
  // Workers share the queue; a worker that finds it empty while another may still push halves would stop early, so run
  // rounds until the queue stays empty.
  do {
    await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(queue.length, 1)) }, worker));
  } while (queue.length > 0);

  if (succeeded === 0 && firstError) throw firstError;
  out.missing.sort((a, b) => a.from.localeCompare(b.from));
  return out;
}

/** Neighbouring pieces joined: [Jan 1, Jan 16) + [Jan 16, Feb 1) = [Jan 1, Feb 1). */
export function mergeWindows(ws: DateWindow[]): DateWindow[] {
  const sorted = [...ws].sort((a, b) => a.from.localeCompare(b.from));
  const out: DateWindow[] = [];
  for (const w of sorted) {
    const last = out[out.length - 1];
    if (last && last.to >= w.from) last.to = last.to > w.to ? last.to : w.to;
    else out.push({ ...w });
  }
  return out;
}

const inclusiveEnd = (to: string) => addDays(to, -1);

/** What the answer says about the window it really covers. Pure. */
export function describeCoverage(c: UkCollected, requested: { months: number; from: string; to: string }) {
  const missing = mergeWindows(c.missing).map((w) => ({ from: w.from, to: inclusiveEnd(w.to) }));
  const dates = c.rows.map((r) => r.date).sort();
  const complete = missing.length === 0 && c.capped.length === 0;
  return {
    requested_months: requested.months,
    requested_from: requested.from,
    requested_to: requested.to,
    covered_from: dates[0] ?? null,
    covered_to: dates[dates.length - 1] ?? null,
    complete,
    ...(missing.length ? { missing_ranges: missing } : {}),
    ...(c.capped.length ? { capped_days: c.capped.map((w) => w.from) } : {}),
  };
}

export function coverageNotice(cov: ReturnType<typeof describeCoverage>): string {
  if (cov.complete) return "";
  const parts: string[] = [];
  if (cov.missing_ranges?.length) {
    const list = cov.missing_ranges.slice(0, 4).map((r) => (r.from === r.to ? r.from : `${r.from} to ${r.to}`)).join("; ");
    parts.push(`the official source did not return ${list}${cov.missing_ranges.length > 4 ? " and more" : ""}, so those dates are not in the figure`);
  }
  if (cov.capped_days?.length) parts.push(`${cov.capped_days.length} very busy day(s) returned only part of their sales`);
  return `Partial window: the ${cov.requested_months}-month period asked for (${cov.requested_from} to ${cov.requested_to}) is not fully covered; ${parts.join(" and ")}. The period field shows the dates the figure really covers (${cov.covered_from ?? "none"} to ${cov.covered_to ?? "none"}). Retry for a fuller window, or ask for fewer months.`;
}

export async function ukHomeSales(input: {
  town: string;
  postcode_district?: string;
  property_type?: UkPropertyType;
  months?: number;
  baseUrl?: string;
  today?: string;
  /** Tests inject a fake endpoint. Default: the Land Registry SPARQL endpoint. */
  fetchWindow?: (w: DateWindow) => Promise<UkRow[]>;
}): Promise<PriceAnswer> {
  const months = clamp(input.months ?? 12, 1, 36);
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  const from = new Date(today + "T00:00:00Z");
  from.setUTCMonth(from.getUTCMonth() - months);
  const fromDate = from.toISOString().slice(0, 10);
  const propertyType = input.property_type ?? "any";
  const fetchWindow =
    input.fetchWindow ??
    (async (w: DateWindow) => {
      const query = buildUkQuery({
        town: input.town,
        postcodeDistrict: input.postcode_district,
        propertyType,
        fromDate: w.from,
        toDate: w.to,
        limit: UK_ROW_CAP,
      });
      // GET with output=json: the form proven live against the endpoint on 2026-10-12.
      const json = await fetchJson(
        `${ENDPOINT}?${new URLSearchParams({ query, output: "json" }).toString()}`,
        { headers: { accept: "application/sparql-results+json" } },
        UK_QUERY_TIMEOUT_MS,
      );
      return parseUkBindings(json);
    });
  const got = await collectUk(fetchWindow, monthWindows(fromDate, today));
  const rows = got.rows;
  const cov = describeCoverage(got, { months, from: fromDate, to: today });
  const s = summarise(rows.map((r) => r.amount));
  const where = [input.postcode_district?.toUpperCase(), input.town.toUpperCase()].filter(Boolean).join(", ");
  const typeLabel = propertyType === "any" ? "homes" : propertyType.replace("-", " ") + " homes";
  const answer = buildAnswer({
    source: INFO,
    query: { country: "GB", town: input.town, postcode_district: input.postcode_district ?? null, property_type: propertyType, months },
    summary: s,
    currency: "GBP",
    unit: "per home",
    period: { from: cov.covered_from, to: cov.covered_to },
    method:
      "Median and 10th–90th percentile of standard-price residential sales (category A) recorded by HM Land Registry in the selected area and period. Repossessions, buy-to-let and transfers to companies (category B) are excluded. The period is fetched month by month so a busy town still gets the whole window.",
    describe: (x) =>
      `${capitalise(typeLabel)} in ${where} sold for a median of ${fmtMoney(x.median, "GBP")} (standard-price sales); typical range (10th–90th percentile) ${fmtMoney(x.low, "GBP")}–${fmtMoney(x.high, "GBP")}.`,
    baseUrl: input.baseUrl,
    extra: { coverage: cov, sub_queries: got.queries },
  });
  const note = coverageNotice(cov);
  return note ? { ...answer, notice: `${note} ${answer.notice}`, summary: `${answer.summary} ${note}` } : answer;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, Math.round(v)));
}
function capitalise(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
