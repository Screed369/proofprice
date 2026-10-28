// Polish public contract prices from the e-Zamowienia Biuletyn Zamowien Publicznych (BZP) notice API, run by the Urzad Zamowien Publicznych (UZP).
// Licence read 2026-10-24 (Licence Checker): UZP's own dane.gov.pl record, dataset 916 "Ogloszenia publikowane w Biuletynie Zamowien Publicznych",
// license_name "CC0 1.0" (https://api.dane.gov.pl/1.4/datasets/916).
// Format checked 2026-10-28 from GitHub's servers (probes plbzp-b3, plbzp-b4, plbzp-p2, plbzp-p3), key-free plain GET:
//   https://ezamowienia.gov.pl/mo-board/api/v1/notice?NoticeType=TenderResultNotice&PageSize=8&PublicationDateFrom=2026-10-26T00:00:00.000Z&PublicationDateTo=2026-10-27T00:00:00.000Z
//   -> JSON array, oldest first, of {noticeNumber:"2026/BZP 00504442/01", orderType:"Delivery"|"Works"|"Services", cpvCode:"24111500-0 (Gazy medyczne),45...",
//   publicationDate:"2026-10-26T04:05:22.0395877Z", procedureResult:"zawarcieUmowy;...", organizationName..., htmlBody:"<html>..."} (about 20 KB per notice).
//   PublicationDateFrom/To are required; PageNumber is ignored, so we page by moving PublicationDateFrom past the newest notice already read.
//   There is no price field: the contract value is in htmlBody as "8.2.) Wartosc umowy/umowy ramowej: 262740,24 PLN" (one per part, "Czesc n"; comma decimal).
// Buyers and suppliers are never read into the library: only the value, the product code and the publication date are kept.
import { InputError, SourceError, fetchJson } from "../../lib/http";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { NO_COUNT, summarise } from "../../lib/stats";
import { readLatestDay } from "../../lib/library/store";
import { cleanCpv, cpvStem, matchPurchase, PURCHASES } from "../../categories/contracts/purchases";

export const INFO: SourceInfo = {
  id: "pl-bzp-contracts",
  country: "PL (state, regions, municipalities, hospitals and other public buyers)",
  category: "government contracts (award results)",
  name: "e-Zamowienia BZP: Polish public contract award notices (UZP)",
  publisher: "Urzad Zamowien Publicznych (UZP), Biuletyn Zamowien Publicznych on the e-Zamowienia platform",
  what_is_recorded:
    "Contract award result notices that Polish public buyers publish in the Biuletyn Zamowien Publicznych: what was bought (CPV product code), the date of the notice and the contract value in zloty, including contracts below the EU thresholds.",
  price_type: "contract_price",
  freshness: "Daily: notices are published every working day and our copy is collected once a day",
  licence: "CC0 1.0 (public domain dedication, UZP record on dane.gov.pl)",
  licence_url: "https://dane.gov.pl/en/dataset/916",
  attribution: "Source: Urzad Zamowien Publicznych, Biuletyn Zamowien Publicznych (e-Zamowienia), CC0. Figures are ProofPrice aggregates of the published notices.",
  homepage: "https://ezamowienia.gov.pl/mo-client-board/bzp",
  limits:
    "Contract values as the buyer states them in the result notice ('Wartosc umowy'), in zloty, per contract or per part of a split tender; they are not unit prices and not amounts already paid, and the notice form does not say here whether VAT is included. " +
    "Values under 1,000 zloty (placeholders) and over 5 billion zloty (entry errors) are left out, and a part is counted once. " +
    "Purchases are recognised from the notice's first CPV product code, so a split tender with parts of different kinds is filed under its first code. " +
    "The figure covers notices published in the newest weeks only (the answer gives the dates). Aggregates only; buyers and suppliers are never read or kept.",
  method_version: "1",
};

export const API_URL = "https://ezamowienia.gov.pl/mo-board/api/v1/notice";
export const WINDOW_DAYS = 21;
export const MIN_DAYS = 10; // fewer fully read days than this is a failed harvest, not a thin one
export const PAGE_SIZE = 50;
export const MIN_VALUE = 1000;
export const MAX_VALUE = 5_000_000_000;
export const UNIT = "per contract (or part), total contract value";
export const WINDOW_PREFIX = "window:";
export const TIME_BUDGET_MS = 8 * 60 * 1000;

/** One contract (a whole tender, or one part of a split tender) with only the fields we use. */
export interface PlContract {
  key: string;
  date: string;
  value: number;
  cpv: string; // 8 digits, no check digit
}

/** Pure: "2026-10-28" minus n days. */
export function daysBefore(day: string, n: number): string {
  const d = new Date(day + "T00:00:00Z");
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - n)).toISOString().slice(0, 10);
}

/** Pure: the notice's HTML as plain text lines (tags to line breaks, entities and non-breaking spaces decoded, blank lines dropped). */
export function htmlText(html: string): string {
  return String(html ?? "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/ /g, " ")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/** Pure: "262740,24" or "1 262 740,24" to 262740.24, or NaN. */
export function plAmount(s: string): number {
  const t = String(s).replace(/[\s ]/g, "").replace(",", ".");
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
}

/** Pure: the contract values (PLN) in a result notice: every "8.2.) Wartosc umowy/umowy ramowej: <amount> PLN" line, one per part. */
export function contractValues(html: string): number[] {
  const text = htmlText(html);
  const out: number[] = [];
  const re = /8\.2\.\)\s*Warto[sś][cć] umowy\/umowy ramowej:?\s*([\d][\d\s]*(?:,\d+)?)\s*(PLN|z[lł])/gi;
  let m: RegExpExecArray | null;
  const flat = text.replace(/\n/g, " ");
  while ((m = re.exec(flat))) {
    const v = plAmount(m[1]);
    if (Number.isFinite(v)) out.push(v);
  }
  return out;
}

/** Pure: "24111500-0 (Gazy medyczne),45233120-6 (...)" to "24111500", the first product code, or "". */
export function firstCpv(cpvCode: unknown): string {
  const m = /(\d{8})(?:-\d)?/.exec(String(cpvCode ?? ""));
  return m ? m[1] : "";
}

/** Pure: one notice from the API to its usable contracts (empty when it is not a signed-contract result, has no PLN value, or is outside the window). */
export function contractsOf(n: any, from: string, to: string): PlContract[] {
  if (!n || typeof n !== "object") return [];
  const date = String(n.publicationDate ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < from || date > to) return [];
  const cpv = firstCpv(n.cpvCode);
  if (cpv.length !== 8) return [];
  const id = String(n.noticeNumber ?? "").trim();
  if (!id) return [];
  const out: PlContract[] = [];
  contractValues(String(n.htmlBody ?? "")).forEach((value, i) => {
    if (value >= MIN_VALUE && value <= MAX_VALUE) out.push({ key: `${id}#${i + 1}`, date, value, cpv });
  });
  return out;
}

/** The library items a contract belongs to: shared purchases by CPV group, plus its 2-digit division and 4-digit group. */
const PURCHASE_STEMS = PURCHASES.map((p) => ({ id: p.id, stems: p.cpv.map(cpvStem) }));
export function itemsOf(cpv: string): string[] {
  const items: string[] = [];
  for (const p of PURCHASE_STEMS) if (p.stems.some((s) => cpv.startsWith(s))) items.push(p.id);
  items.push(`cpv-${cpv.slice(0, 2)}`, `cpv-${cpv.slice(0, 4)}`);
  return items;
}

/** Pure: library rows for every item with at least 5 distinct contracts. */
export function aggregateAll(contracts: Iterable<PlContract>, from: string, to: string): DailyRow[] {
  const seen = new Set<string>();
  const groups = new Map<string, number[]>();
  for (const c of contracts) {
    if (c.date < from || c.date > to || seen.has(c.key)) continue;
    seen.add(c.key);
    for (const item of itemsOf(c.cpv)) {
      const g = groups.get(item);
      if (g) g.push(c.value);
      else groups.set(item, [c.value]);
    }
  }
  const rows: DailyRow[] = [];
  for (const [item, values] of groups) {
    const s = summarise(values);
    if (!s || s.count < 5) continue;
    rows.push({ area: "ALL", item, n: s.count, median: s.median, low: s.low, high: s.high, min: s.min, max: s.max });
  }
  return rows.sort((a, b) => a.item.localeCompare(b.item));
}

/** Marker row: the oldest fully read day, e.g. "window:2026-10-08". No price (NO_COUNT, zeros), so no answer can show it as a figure. */
export function windowMarker(oldest: string): DailyRow {
  return { area: "ALL", item: WINDOW_PREFIX + oldest, n: NO_COUNT, median: 0, low: 0, high: 0, min: 0, max: 0 };
}
export function windowOf(rows: { area: string; item: string }[]): string | null {
  const m = rows.find((r) => r.area === "ALL" && r.item.startsWith(WINDOW_PREFIX));
  return m ? m.item.slice(WINDOW_PREFIX.length) : null;
}

export type NoticeFetcher = (url: string) => Promise<any[]>;
const httpNotices: NoticeFetcher = async (url) => {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const body = await fetchJson(url, { headers: { accept: "application/json" } }, 60000);
      if (!Array.isArray(body)) throw new SourceError("The e-Zamowienia notice list is not a JSON array: the format may have changed");
      return body;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  throw lastErr;
};

export function noticeUrl(fromIso: string, toIso: string, pageSize = PAGE_SIZE): string {
  return `${API_URL}?NoticeType=TenderResultNotice&PageSize=${pageSize}&PublicationDateFrom=${encodeURIComponent(fromIso)}&PublicationDateTo=${encodeURIComponent(toIso)}`;
}

/** Reads every result notice published on one day, paging by moving the start of the window past the newest (or, if the list comes newest first, the end before the oldest) notice of the last page. */
export async function readDay(day: string, get: NoticeFetcher, on: (n: any) => void): Promise<number> {
  let from = new Date(`${day}T00:00:00.000Z`).getTime();
  let to = new Date(`${day}T23:59:59.999Z`).getTime();
  const seen = new Set<string>();
  let count = 0;
  for (let page = 0; page < 400; page++) {
    const list = await get(noticeUrl(new Date(from).toISOString(), new Date(to).toISOString()));
    const fresh = list.filter((n) => n && !seen.has(String(n.noticeNumber)));
    if (!list.length || !fresh.length) break;
    for (const n of fresh) {
      seen.add(String(n.noticeNumber));
      count++;
      on(n);
    }
    const times = list.map((n) => Date.parse(String(n.publicationDate))).filter(Number.isFinite);
    if (!times.length) break;
    const ascending = times[0] <= times[times.length - 1];
    if (ascending) {
      const next = Math.max(...times) + 1;
      if (next <= from) break;
      from = next;
    } else {
      const next = Math.min(...times) - 1;
      if (next >= to) break;
      to = next;
    }
    if (from > to) break;
  }
  return count;
}

export interface HarvestOptions {
  get?: NoticeFetcher; // for tests
  days?: number;
  budgetMs?: number;
}

export async function plContractsHarvest(now: Date = new Date(), o: HarvestOptions = {}): Promise<HarvestResult> {
  const started = Date.now();
  const to = now.toISOString().slice(0, 10);
  const days = o.days ?? WINDOW_DAYS;
  const from = daysBefore(to, days - 1);
  const get = o.get ?? httpNotices;
  const budget = o.budgetMs ?? TIME_BUDGET_MS;
  const contracts: PlContract[] = [];
  const read: string[] = [];
  const failed: string[] = [];
  let notices = 0;
  let lastError: unknown = null;
  // newest day first, so a time-out loses the oldest days, never the newest
  for (let i = 0; i < days; i++) {
    const day = daysBefore(to, i);
    if (Date.now() - started > budget) {
      failed.push(`${day} (time)`);
      continue;
    }
    const dayContracts: PlContract[] = [];
    try {
      notices += await readDay(day, get, (n) => dayContracts.push(...contractsOf(n, day, day)));
      contracts.push(...dayContracts);
      read.push(day);
    } catch (err) {
      failed.push(day);
      lastError = err;
    }
  }
  if (!read.length) throw new SourceError("Could not read the e-Zamowienia notices (ezamowienia.gov.pl)", String((lastError as any)?.message ?? lastError));
  // the window must be unbroken from today back to the oldest day we claim
  const unbroken: string[] = [];
  for (let i = 0; i < days && read.includes(daysBefore(to, i)); i++) unbroken.push(daysBefore(to, i));
  if (unbroken.length < MIN_DAYS) throw new SourceError(`Only ${unbroken.length} unbroken days of e-Zamowienia notices could be read (need ${MIN_DAYS})`, String((lastError as any)?.message ?? ""));
  const oldest = unbroken[unbroken.length - 1];
  const used = contracts.filter((c) => c.date >= oldest);
  if (!used.length) throw new SourceError("The e-Zamowienia notices held no usable contract values in the window: the notice layout may have changed");
  const rows = aggregateAll(used, oldest, to);
  rows.push(windowMarker(oldest));
  return {
    date: to,
    currency: "PLN",
    unit: UNIT,
    rows,
    note: `Notices published ${oldest} to ${to}; ${notices} result notices read, ${used.length} usable contract values.` + (failed.length ? ` Not read: ${failed.join(", ")}.` : ""),
  };
}

// ---------- the answer ----------

export interface PlInput {
  what: string;
  cpv?: string;
  buyer_area?: string;
  baseUrl?: string;
}

export const SUPPORTED_EXAMPLES = ["laptops", "school meals", "road resurfacing", "office cleaning", "catering", "ambulances"];

export async function plContracts(input: PlInput): Promise<PriceAnswer> {
  if (input.buyer_area) throw new InputError("Poland: buyer_area is not used; the figures are for all Polish public buyers together.");
  let item: string;
  let label: string;
  let matched: Record<string, string>;
  if (input.cpv) {
    const code = cleanCpv(input.cpv);
    if (!code || code.length === 3) {
      throw new InputError("Poland: cpv must be a CPV product code of 2 digits (a division such as 30) or 4 to 8 digits (30213100); 4 digits or more are read as the 4-digit group (3021).");
    }
    const group = code.length === 2 ? code : code.slice(0, 4);
    item = `cpv-${group}`;
    label = `contracts under CPV group ${group}`;
    matched = { cpv_group: group, cpv_requested: code };
  } else {
    const p = matchPurchase(input.what);
    if (!p) {
      throw new InputError(
        `Poland: "${input.what}" is not one of the purchases we summarise from the Polish notices. Try a common purchase such as ${SUPPORTED_EXAMPLES.join(", ")} (${PURCHASES.length} are recognised), or pass a CPV product code in cpv.`,
      );
    }
    item = p.id;
    label = `${p.label} contracts`;
    matched = { matched_purchase: p.id };
  }
  const day = readLatestDay(INFO.id);
  if (!day) throw new SourceError("Polish contract prices have not been collected yet; the daily collector fills them. Try again tomorrow.");
  const from = windowOf(day.rows) ?? daysBefore(day.date, WINDOW_DAYS - 1);
  const row = day.rows.find((r) => r.area === "ALL" && r.item === item);
  const summary = row ? { count: row.n, median: row.median, low: row.low, high: row.high, min: row.min, max: row.max } : null;
  return buildAnswer({
    source: INFO,
    query: { country: "PL", what: input.what, ...(input.cpv ? { cpv: input.cpv } : {}) },
    summary,
    currency: "PLN",
    unit: UNIT,
    period: { from, to: day.date },
    method:
      `e-Zamowienia result notices published ${from} to ${day.date}, recognised by their CPV product code (${label}). Median and 10th–90th percentile of the contract value in PLN. ` +
      "Totals per contract (or per part of a split tender), not unit prices; buyers and suppliers are never named.",
    describe: (s) =>
      `Polish public buyers signed ${label} with a median total value of ${fmtMoney(s.median, "PLN")} per contract ` +
      `(typical range ${fmtMoney(s.low, "PLN")} to ${fmtMoney(s.high, "PLN")}, 10th to 90th percentile). These are totals per contract, not unit prices.`,
    baseUrl: input.baseUrl,
    extra: { value_basis: "total contract value stated in the result notice (BZP), not a unit price", ...matched, newest_collection: day.date },
  });
}
