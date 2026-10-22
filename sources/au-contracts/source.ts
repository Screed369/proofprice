// Australian federal contract prices from AusTender (Department of Finance), OCDS 1.1 JSON.
// API facts (probe from GitHub Actions, 21 Oct 2026):
//   GET https://api.tenders.gov.au/ocds/findByDates/contractPublished/<ISO start>/<ISO end>  key-free, JSON, CC BY 3.0 AU in the "license" field.
//   One page holds 100 releases (about 180 KB); "links.next" is the URL of the next page. Each release has one contract:
//   contracts[0].id (CN number), dateSigned, description, items[].classification (UNSPSC), period, value.amount (STRING, AUD);
//   parties[] with roles supplier / procuringEntity (supplier and contact details are never read or kept).
import { fetchJson, InputError, SourceError } from "../../lib/http";
import type { SourceInfo } from "../../lib/plugin";
import type { PriceAnswer } from "../../lib/answer";
import { contractAnswer } from "../../categories/contracts/answer";
import { matchPurchase, normaliseText } from "../../categories/contracts/purchases";

export const INFO: SourceInfo = {
  id: "au-contracts",
  country: "AU (federal contracts)",
  category: "government contracts (federal contract notices)",
  name: "AusTender: Australian Government contract notices",
  publisher: "Australian Government, Department of Finance (AusTender)",
  what_is_recorded:
    "Contract notices that Australian Government agencies publish after signing a contract: description, UNSPSC product or service code, the agency, start and end dates and the agreed contract value in Australian dollars.",
  price_type: "contract_price",
  freshness: "Continuous: buyers publish award notices after a contract is awarded",
  licence: "Creative Commons Attribution 3.0 Australia (CC BY 3.0 AU)",
  licence_url: "https://creativecommons.org/licenses/by/3.0/au/",
  attribution: "Source: Australian Government, Department of Finance, AusTender (api.tenders.gov.au), CC BY 3.0 AU. Figures are ProofPrice aggregates of the published contract notices.",
  homepage: "https://www.tenders.gov.au/",
  limits:
    "Federal agencies only (not states, councils or most defence-in-confidence contracts). The value is the agreed amount over the whole contract period, often several years, and may include options; it is not a unit price and not an amount paid yet. " +
    "Only the newest 21 days of notices are read per request, up to 3 pages of 100 per day, so a busy day is a sample. Search is by UNSPSC code or words in the description. Aggregates only; suppliers and staff are never named.",
};

export const BASE = "https://api.tenders.gov.au/ocds/findByDates/contractPublished";
export const DAYS = 21;
export const PAGES_PER_DAY = 3;
/** Amounts below this are left out: zero-dollar and token entries are not contract prices. */
export const MIN_VALUE = 100;

export interface AuContract {
  id: string;
  /** Agreed contract value, AUD. */
  value: number;
  /** Signing date YYYY-MM-DD. */
  date: string;
  /** UNSPSC code (8 digits). */
  unspsc: string;
  text: string;
  agency: string;
  /** Length of the contract in days, or null. */
  days: number | null;
  /** Release timestamp, to keep the newest amendment of a contract. */
  released: string;
}

/** Pure parser for one OCDS page: one entry per contract, no supplier or contact data. Returns the next page link too. */
export function parsePage(json: any): { contracts: AuContract[]; next: string | null } {
  if (!json || !Array.isArray(json.releases)) throw new SourceError("Unexpected response from AusTender");
  const contracts: AuContract[] = [];
  for (const r of json.releases) {
    const agency = String((r?.parties ?? []).find((p: any) => Array.isArray(p?.roles) && p.roles.includes("procuringEntity"))?.name ?? "");
    for (const c of r?.contracts ?? []) {
      const value = Number(c?.value?.amount);
      if (!Number.isFinite(value) || value < MIN_VALUE || (c?.value?.currency && c.value.currency !== "AUD")) continue;
      if (c?.status && c.status !== "active") continue;
      const start = Date.parse(c?.period?.startDate ?? "");
      const end = Date.parse(c?.period?.endDate ?? "");
      contracts.push({
        id: String(c?.id ?? ""),
        value,
        date: String(c?.dateSigned ?? r?.date ?? "").slice(0, 10),
        unspsc: String(c?.items?.[0]?.classification?.id ?? ""),
        text: normaliseText(`${c?.title ?? ""} ${c?.description ?? ""}`),
        agency,
        days: Number.isFinite(start) && Number.isFinite(end) && end > start ? Math.round((end - start) / 86400000) : null,
        released: String(r?.date ?? ""),
      });
    }
  }
  const next = typeof json?.links?.next === "string" && json.links.next.startsWith("https://api.tenders.gov.au/") ? json.links.next : null;
  return { contracts, next };
}

/** One contract per CN number: the newest release wins (amendments are new releases of the same contract). */
export function dedupe(list: AuContract[]): AuContract[] {
  const best = new Map<string, AuContract>();
  const loose: AuContract[] = [];
  for (const c of list) {
    if (!c.id) { loose.push(c); continue; }
    const old = best.get(c.id);
    if (!old || c.released > old.released) best.set(c.id, c);
  }
  return [...best.values(), ...loose];
}

/** UNSPSC code groups (prefixes) for the common purchases. Others are found by words in the description. */
export const UNSPSC_BY_PURCHASE: Record<string, string[]> = {
  laptops: ["43211503"],
  "desktop-computers": ["43211507"],
  catering: ["901016"],
  "road-resurfacing": ["721411"],
  "building-cleaning": ["761115"],
  "office-cleaning": ["761115"],
};

/** A UNSPSC code or prefix typed by a person: 2 to 8 digits. */
export function cleanUnspsc(raw: string | undefined): string | null {
  if (!raw) return null;
  const m = raw.trim().replace(/\s+/g, "").match(/^(\d{2,8})$/);
  return m ? m[1] : null;
}

export interface Matcher {
  prefixes: string[];
  words: string[];
}

/** Words that must all appear in the contract text (ignoring a trailing s). */
export function wordsOf(phrase: string): string[] {
  return normaliseText(phrase).split(" ").filter((w) => w.length >= 3).map((w) => (w.length > 4 ? w.replace(/s$/, "") : w));
}

export function isMatch(c: AuContract, m: Matcher): boolean {
  if (m.prefixes.some((p) => c.unspsc.startsWith(p))) return true;
  if (!m.words.length) return false;
  const tokens = c.text.split(" ");
  return m.words.every((w) => tokens.some((t) => t === w || t === `${w}s` || t.startsWith(w)));
}

export function dayWindows(days: number, now: Date = new Date()): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = [];
  const base = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (let i = 0; i < days; i++) {
    const a = new Date(base - i * 86400000);
    const b = new Date(base - (i - 1) * 86400000);
    out.push({ from: a.toISOString().slice(0, 10), to: b.toISOString().slice(0, 10) });
  }
  return out;
}

/** AusTender answers HTTP 400 "No Records found for Date Range" for a day with no notices (weekends, holidays). That is an empty day, not an outage. */
export function isEmptyDay(err: unknown): boolean {
  return err instanceof SourceError && err.status === 400 && /no records/i.test(err.detail ?? "");
}

async function dayContracts(day: { from: string; to: string }): Promise<{ contracts: AuContract[]; full: boolean }> {
  let url: string | null = `${BASE}/${day.from}T00:00:00Z/${day.to}T00:00:00Z`;
  const contracts: AuContract[] = [];
  let pages = 0;
  let more = false;
  while (url && pages < PAGES_PER_DAY) {
    let raw: any;
    try {
      raw = await fetchJson(url, { headers: { accept: "application/json" } }, 20000);
    } catch (err) {
      if (isEmptyDay(err)) break;
      throw err;
    }
    const page = parsePage(raw);
    contracts.push(...page.contracts);
    pages++;
    url = page.next;
    if (url && pages >= PAGES_PER_DAY) more = true;
  }
  return { contracts, full: more };
}

async function inBatches<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

export interface AuInput {
  what: string;
  cpv?: string;
  buyer_area?: string;
  months: number;
  baseUrl?: string;
}

export async function auContracts(input: AuInput, now: Date = new Date()): Promise<PriceAnswer> {
  const m: Matcher = { prefixes: [], words: [] };
  let label = input.what;
  let how: string;
  if (input.cpv) {
    const code = cleanUnspsc(input.cpv);
    if (!code) throw new InputError("For AU, cpv must be a UNSPSC code or prefix of 2 to 8 digits, such as 43211503 (notebook computers) or 4321.");
    m.prefixes = [code];
    how = `UNSPSC code ${code}`;
  } else {
    const p = matchPurchase(input.what);
    if (p) label = p.label;
    const prefixes = p ? UNSPSC_BY_PURCHASE[p.id] ?? [] : [];
    m.prefixes = prefixes;
    m.words = wordsOf(p ? p.keyword : input.what);
    if (!m.prefixes.length && !m.words.length) throw new InputError("what must contain a word of at least 3 letters, for example 'laptops' or 'catering'.");
    how = (prefixes.length ? `UNSPSC code ${prefixes.join(" or ")} or ` : "") + `the words "${m.words.join(" ")}" in the contract title or description`;
  }
  const agency = input.buyer_area ? normaliseText(input.buyer_area) : "";
  const days = dayWindows(DAYS, now);
  const perDay = await inBatches(days, 11, dayContracts);
  const all = dedupe(perDay.flatMap((d) => d.contracts));
  const capped = perDay.some((d) => d.full);
  const matched = all.filter((c) => isMatch(c, m) && (!agency || normaliseText(c.agency).includes(agency)));
  const dates = matched.map((c) => c.date).filter(Boolean).sort();
  const terms = matched.map((c) => c.days).filter((x): x is number => x != null).sort((a, b) => a - b);
  const medTermMonths = terms.length ? Math.round(terms[Math.floor(terms.length / 2)] / 30.4) : null;
  const period = { from: days[days.length - 1].from, to: days[0].from };
  const notes = [
    `Each value is the agreed amount over the whole contract${medTermMonths != null ? ` (median term ${medTermMonths} months)` : ""}, not a yearly or unit price; amounts under ${MIN_VALUE} dollars are left out.`,
  ];
  if (capped) notes.push(`Busy days were read only up to ${PAGES_PER_DAY * 100} notices, so this is a sample of the ${DAYS}-day window.`);
  if (input.months > 1) notes.push(`Only the newest ${DAYS} days of notices are read, whatever months says.`);
  return contractAnswer({
    source: INFO,
    query: { country: "AU", what: input.what, ...(input.cpv ? { cpv: input.cpv } : {}), ...(input.buyer_area ? { buyer_area: input.buyer_area } : {}), months: input.months },
    values: matched.map((c) => c.value),
    currency: "AUD",
    what: label,
    where: input.buyer_area ? `Australia (federal agencies matching "${input.buyer_area}")` : "Australia (federal agencies)",
    period,
    newest: dates.length ? dates[dates.length - 1] : null,
    method:
      `Australian Government contract notices published between ${period.from} and ${period.to} (the newest ${DAYS} days, up to ${PAGES_PER_DAY} pages of 100 per day), found by ${how}` +
      (input.buyer_area ? ` and an agency name containing "${input.buyer_area}"` : "") +
      `. One contract per CN number (the newest amendment). Median and 10th–90th percentile of the agreed contract values in AUD; never supplier or staff names. Totals per contract, not unit prices.`,
    notes,
    baseUrl: input.baseUrl,
    extra: { matched_filter: how, notices_read: all.length, contracts_matched: matched.length, days_read: days.length, ...(medTermMonths != null ? { median_term_months: medTermMonths } : {}) },
  });
}
