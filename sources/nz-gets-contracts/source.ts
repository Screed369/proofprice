// New Zealand government contract prices from the GETS award notices (Government Electronic Tenders Service), published by the
// Ministry of Business, Innovation and Employment (MBIE) as open data under CC BY 4.0.
// Format checked live on 2026-10-20 (Verifier probe from GitHub's servers; Notion row "NZ contracts (GETS ...)"):
//   GET https://www.mbie.govt.nz/assets/Data-Files/NZGPP-GETS-Open-Data/gets-award-notices.csv   (22.8 MB, UTF-8 with BOM, no key, quarterly)
//   header: Posting Agency,RFx ID,RFx Type,Competition Type,Title,Reference Number,Open Date,Close Date,Awarded Date (trailing space!),Department,
//           Tender Coverage,Prequalification Required?,Alternative Physical Tender Box Delivery Address,Overview,Award Type,Comments,Awarded Amount,Report Date
//   dates d/mm/yyyy, Report Date yyyymmdd, missing values are the text NULL, text fields can span several lines inside quotes.
//   "Not Awarded" rows carry Awarded Amount 0: only Award Type = Awarded with an amount > 0 is used.
// A bulk file is never downloaded per request: the daily collector (harvest) reads it into the price library as aggregates
// (median, 10th-90th percentile, count) per purchase type and per posting agency over the newest 24 months of awards, and answers come from the library.

import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { InputError, retryOnce, SourceError } from "../../lib/http";
import { aggregateDaily, NATIONAL } from "../../lib/library/aggregate";
import { readLatestDay } from "../../lib/library/store";
import type { DailyRow, HarvestResult, Params, SourceInfo } from "../../lib/plugin";
import { MIN_PUBLISH, PriceSummary } from "../../lib/stats";
import { VALUE_BASIS } from "../../categories/contracts/answer";
import { daysSince, matchPurchase, normaliseText, PURCHASES } from "../../categories/contracts/purchases";

export const FILE_URL = "https://www.mbie.govt.nz/assets/Data-Files/NZGPP-GETS-Open-Data/gets-award-notices.csv";
export const WINDOW_MONTHS = 24;
/** Amounts below this are placeholders (1, 10 ...); above the ceiling they are typing errors. NZD. */
export const MIN_VALUE = 100;
export const MAX_VALUE = 2_000_000_000;
export const ALL_ITEM = "all";

export const INFO: SourceInfo = {
  id: "nz-gets-contracts",
  country: "NZ (New Zealand)",
  category: "government contracts (awarded tenders)",
  name: "GETS contract award notices",
  publisher: "Ministry of Business, Innovation and Employment (MBIE), New Zealand Government Procurement",
  what_is_recorded:
    "Contract award notices posted by New Zealand public agencies on the Government Electronic Tenders Service (GETS): title, posting agency, award date and the awarded amount in New Zealand dollars.",
  price_type: "contract_price",
  freshness: "Quarterly; awards up to the end of the last quarter",
  licence: "Creative Commons Attribution 4.0 International (CC BY 4.0)",
  licence_url: "https://www.mbie.govt.nz/copyright",
  attribution:
    "Source: Ministry of Business, Innovation and Employment (MBIE), New Zealand Government Procurement, GETS open data, licensed under CC BY 4.0. Medians and ranges are own calculations by ProofPrice from the award notices.",
  homepage: "https://www.mbie.govt.nz/cross-government-functions/new-zealand-government-procurement-and-property/open-data",
  limits:
    "Award values as posted on GETS, not invoices: the total awarded for a contract, which can cover several years or extension options, and GST treatment is not stated. " +
    "Only agencies that post on GETS are included, and only contracts they chose to publish. Purchases are found by words in the notice title, so a notice titled in other words is missed. " +
    "Totals per contract, not unit prices. The file is updated quarterly, so the newest weeks are missing.",
};

// ---------- parsing (pure) ----------

/** RFC 4180 style CSV: quoted fields can contain commas, doubled quotes and line breaks. A leading byte order mark is dropped. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export interface NzAward {
  agency: string;
  title: string;
  date: string; // YYYY-MM-DD
  value: number; // NZD
}

/** "17/02/2020" or "5/3/2021" (day first) -> "2020-02-17"; anything else null. */
export function parseNzDate(s: string): string | null {
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const clean = (v: string | undefined) => {
  const t = (v ?? "").replace(/\s+/g, " ").trim();
  return t === "NULL" ? "" : t;
};

/** Awarded notices with a plausible amount and a real date. `skipped` counts rows that were awarded but unusable. Never throws on a bad row. */
export function parseAwards(text: string, now: Date = new Date()): { awards: NzAward[]; skipped: number; header: string[] } {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new SourceError("The GETS award notices file was empty or not a CSV.");
  const header = rows[0].map((h) => h.trim());
  const col = (name: string) => header.indexOf(name);
  const iAgency = col("Posting Agency");
  const iTitle = col("Title");
  const iDate = col("Awarded Date");
  const iType = col("Award Type");
  const iAmount = col("Awarded Amount");
  if ([iAgency, iTitle, iDate, iType, iAmount].some((i) => i < 0)) {
    throw new SourceError(`The GETS award notices file changed format (columns found: ${header.slice(0, 20).join(" | ")}).`);
  }
  const today = now.toISOString().slice(0, 10);
  const awards: NzAward[] = [];
  let skipped = 0;
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (clean(row[iType]).toLowerCase() !== "awarded") continue;
    const date = parseNzDate(clean(row[iDate]));
    const value = Number(clean(row[iAmount]).replace(/[$,\s]/g, ""));
    const agency = clean(row[iAgency]);
    if (!date || date > today || date < "2010-01-01" || !agency || !Number.isFinite(value) || value < MIN_VALUE || value > MAX_VALUE) {
      skipped++;
      continue;
    }
    awards.push({ agency, title: clean(row[iTitle]), date, value });
  }
  return { awards, skipped, header };
}

// ---------- purchase types ----------

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const TOPICS = PURCHASES.map((p) => ({
  id: p.id,
  label: p.label,
  re: new RegExp(`(^| )${escapeRe(normaliseText(p.keyword))}(s|es)?( |$)`),
}));

/** The purchase ids whose search words appear (as whole words, plural allowed) in a notice title. */
export function topicsOf(title: string): string[] {
  const t = normaliseText(title);
  if (!t) return [];
  return TOPICS.filter((x) => x.re.test(t)).map((x) => x.id);
}

export const itemLabel = (id: string) => (id === ALL_ITEM ? "all purchases" : (PURCHASES.find((p) => p.id === id)?.label ?? id));

// ---------- library rows (pure) ----------

export function windowFrom(to: string, months = WINDOW_MONTHS): string {
  const y = Number(to.slice(0, 4));
  const m = Number(to.slice(5, 7));
  const d = new Date(Date.UTC(y, m - 1 - months, Number(to.slice(8, 10))));
  return d.toISOString().slice(0, 10);
}

/** Aggregates over the newest 24 months of awards: one row per posting agency and purchase type, plus "ALL" for the whole country. */
export function buildRows(awards: NzAward[]): { date: string; rows: DailyRow[]; used: number } {
  if (!awards.length) throw new SourceError("The GETS award notices file held no usable awards.");
  const date = awards.reduce((a, r) => (r.date > a ? r.date : a), "");
  const from = windowFrom(date);
  const records: { area: string; item: string; price: number }[] = [];
  let used = 0;
  for (const a of awards) {
    if (a.date <= from || a.date > date) continue;
    used++;
    records.push({ area: a.agency, item: ALL_ITEM, price: a.value });
    for (const t of topicsOf(a.title)) records.push({ area: a.agency, item: t, price: a.value });
  }
  return { date, rows: aggregateDaily(records, true), used };
}

export async function downloadFile(url = FILE_URL): Promise<string> {
  return retryOnce(async () => {
    const res = await fetch(url, {
      headers: { "user-agent": "ProofPrice/1.0 (+https://proofprice.com; hello@proofprice.com)", accept: "text/csv,*/*" },
      signal: AbortSignal.timeout(150_000),
    }).catch((e) => {
      throw new SourceError(`Could not reach the GETS open data file: ${e?.cause?.code ?? e?.message ?? e}`);
    });
    if (!res.ok) throw new SourceError(`GETS open data file answered HTTP ${res.status}`, undefined, res.status);
    return new TextDecoder("utf-8").decode(await res.arrayBuffer());
  }, 2000);
}

export async function nzHarvest(): Promise<HarvestResult> {
  const { awards, skipped } = parseAwards(await downloadFile());
  const { date, rows, used } = buildRows(awards);
  return {
    date,
    currency: "NZD",
    unit: "per contract, total awarded value",
    rows,
    note: `GETS award notices: ${used} awarded contracts with an award date from ${windowFrom(date)} to ${date} (${skipped} awarded rows skipped for a missing date or an implausible amount). One row per posting agency and purchase type; n is the number of awards; min and max are the smallest and largest award. Never supplier names.`,
  };
}

// ---------- answering ----------

export interface NzInput {
  what: string;
  cpv?: string;
  buyer_area?: string;
  months?: number;
  baseUrl?: string;
}

const ALL_WORDS = new Set(["all", "any", "everything", "all contracts", "all purchases", "contracts", "all awards", "overall"]);

/** The library item for a request, or null when the words match no purchase type. */
export function itemFor(what: string): string | null {
  const t = normaliseText(what);
  if (ALL_WORDS.has(t)) return ALL_ITEM;
  return matchPurchase(what)?.id ?? null;
}

export function supportedList(): string {
  return PURCHASES.map((p) => p.label).join(", ");
}

export function nzAnswer(lib: { date: string; rows: { area: string; item: string; n: number; median: number; low: number; high: number; min: number; max: number }[] }, input: NzInput): PriceAnswer {
  if (input.cpv) throw new InputError("New Zealand notices carry no CPV codes: leave cpv out and say what was bought in words.");
  const item = itemFor(input.what);
  if (!item) {
    throw new InputError(
      `New Zealand answers cover these purchases (named in plain words): ${supportedList()}; or what="all" for every award. "${input.what}" is not one of them, and the notice file is not searched live.`,
    );
  }
  let area = NATIONAL;
  let where = "New Zealand";
  let agencies: string[] = [];
  if (input.buyer_area?.trim()) {
    const needle = normaliseText(input.buyer_area);
    agencies = [...new Set(lib.rows.filter((r) => r.area !== NATIONAL && normaliseText(r.area).includes(needle)).map((r) => r.area))];
    const inItem = lib.rows.filter((r) => r.item === item && agencies.includes(r.area)).sort((a, b) => b.n - a.n);
    if (!agencies.length) {
      throw new InputError(`No agency name contains "${input.buyer_area}" with at least ${MIN_PUBLISH} awards in the newest ${WINDOW_MONTHS} months. Try a shorter part of the name, such as "Auckland", "Waka Kotahi" or "Health", or leave buyer_area out.`);
    }
    area = inItem.length ? inItem[0].area : agencies[0];
    where = `New Zealand (${area})`;
  }
  const row = lib.rows.find((r) => r.area === area && r.item === item);
  const summary: PriceSummary | null = row ? { count: row.n, median: row.median, low: row.low, high: row.high, min: row.min, max: row.max } : null;
  const label = itemLabel(item);
  const from = windowFrom(lib.date);
  const notes = [
    `Award values as posted on GETS (total awarded per contract, often over several years; GST treatment not stated), not invoices. Found by words in the notice title, so notices titled in other words are missed.`,
    `Newest award in the file: ${lib.date}; the file is updated quarterly.`,
  ];
  if (input.months !== undefined && input.months !== WINDOW_MONTHS) notes.push(`months was ignored: New Zealand figures always cover the newest ${WINDOW_MONTHS} months of awards.`);
  if (agencies.length > 1) notes.push(`${agencies.length} agencies matched "${input.buyer_area}"; the one with the most awards for this purchase is shown.`);
  if (!row) {
    notes.push(
      input.buyer_area
        ? `${area} has fewer than ${MIN_PUBLISH} awards for ${label} in this period, so no figure is published (try buyer_area left out for the whole country).`
        : `Fewer than ${MIN_PUBLISH} awards for ${label} in this period, so no figure is published.`,
    );
  }
  const answer = buildAnswer({
    source: INFO,
    query: { country: "NZ", what: input.what, ...(input.buyer_area ? { buyer_area: input.buyer_area } : {}) },
    summary,
    currency: "NZD",
    unit: "per contract (lot), total awarded value",
    period: { from, to: lib.date },
    method:
      `GETS contract award notices (MBIE open data), awards dated ${from} to ${lib.date} with Award Type "Awarded" and an amount of at least NZD ${MIN_VALUE}, ` +
      `${item === ALL_ITEM ? "all purchases" : `those whose title names ${label}`}${input.buyer_area ? `, posted by ${area}` : ""}. Median and 10th–90th percentile of the awarded amount in NZD; never supplier names. Totals per contract, not unit prices.`,
    describe: (s) =>
      `Public buyers in ${where} awarded ${label} contracts with a median total value of ${fmtMoney(s.median, "NZD")} per contract ` +
      `(typical range ${fmtMoney(s.low, "NZD")} to ${fmtMoney(s.high, "NZD")}, 10th to 90th percentile). These are totals per contract (lot), not unit prices.`,
    baseUrl: input.baseUrl,
    extra: {
      value_basis: VALUE_BASIS,
      newest_award_used: lib.date,
      award_window_months: WINDOW_MONTHS,
      purchase: item,
      posting_agency: area === NATIONAL ? null : area,
      data_age_days: daysSince(lib.date),
    },
  });
  answer.summary = `${answer.summary} ${notes.join(" ")}`;
  return answer;
}

export async function nzContracts(input: NzInput): Promise<PriceAnswer> {
  const lib = readLatestDay(INFO.id);
  if (!lib) throw new SourceError("Not yet available: the New Zealand contract figures appear after the next collection (the price library has no data for this source yet).");
  return nzAnswer(lib, input);
}

/** Maps a request to the library keys used by harvest, so /history can answer. */
export function nzHistoryKey(p: Params): { area: string; item: string; label: string } | null {
  if (p.buyer_area) return null;
  const item = itemFor(String(p.what ?? ""));
  return item ? { area: NATIONAL, item, label: `New Zealand, ${itemLabel(item)}` } : null;
}
