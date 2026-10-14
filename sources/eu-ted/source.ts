// EU/EEA government contract prices from TED (Tenders Electronic Daily), contract award notices, via the TED Search API v3.
// API facts (checked 2026-10-14): POST https://api.ted.europa.eu/v3/notices/search, JSON body { query, fields, page, limit, scope, ... },
// anonymous (the API documentation says it "does not require authentication"), at most 250 notices a page, 700 requests a minute.
// Answers are built live: a few pages of award notices for one buyer country, one CPV group and the chosen window.
// Lot fields come back as parallel arrays: identifier-lot, main-classification-lot, result-lot-identifier, winner-selection-status and
// framework-agreement-lot have one entry per lot; tender-value, tender-value-cur and tender-lot-identifier have one entry per tender
// (several tenders can belong to one lot, in any order), so a tender is matched to its lot by lot identifier, never by position.
import { fetchJson, InputError, SourceError } from "../../lib/http";
import type { SourceInfo } from "../../lib/plugin";
import { fmtMoney, type PriceAnswer } from "../../lib/answer";
import { MIN_PUBLISH, summarise } from "../../lib/stats";
import { contractAnswer, unitPriceFrom } from "../../categories/contracts/answer";
import { cleanCpv, cpvInGroups, cpvStem, matchPurchase, monthsWindow } from "../../categories/contracts/purchases";

export const INFO: SourceInfo = {
  id: "eu-ted",
  country: "EU and EEA (by buyer country)",
  category: "government contracts (award notices)",
  name: "TED: Tenders Electronic Daily, contract award notices",
  publisher: "Publications Office of the European Union",
  what_is_recorded:
    "Contract award notices (form type 'result') published on TED by public buyers in EU and EEA states: per lot, the product code (CPV), whether a winner was chosen, the value of the winning tender and its currency, and for some lots a quantity and unit.",
  price_type: "contract_price",
  freshness: "Daily on working days: notices appear on TED within days of the buyer sending them",
  licence:
    "TED legal notice: the reuse policy is implemented by the Commission Decision of 12 December 2011 (2011/833/EU) on the reuse of Commission documents; " +
    "'Unless otherwise noted, the procurement notices published in the Supplement' to the Official Journal can be reused 'for commercial or non-commercial purposes', " +
    "'provided appropriate credit is given and any changes made are indicated'. The notice licenses the TED sites' editorial content under CC BY 4.0. The Search API needs no key.",
  licence_url: "https://ted.europa.eu/en/legal-notice",
  attribution:
    "Source: TED (Tenders Electronic Daily), Publications Office of the European Union, https://ted.europa.eu. Figures are ProofPrice aggregates of the published award notices; the Publications Office does not warrant the data.",
  homepage: "https://ted.europa.eu/",
  limits:
    "Award notices of public buyers above the EU procurement thresholds (smaller purchases are published on national portals, not TED). Aggregates only; suppliers are never named. " +
    "Each lot with a chosen winner and a stated value counts as one contract; lots without a winner, without a value (or with a placeholder such as 1 or -1) are left out, so the sample is smaller than the number of notices. " +
    "Values are totals per contract (lot) in the notice currency, not unit prices; the stated value of a framework agreement is usually a ceiling over several years rather than a price paid, " +
    "so when at least 5 single (non-framework) contracts match, the headline median and range use those only and the framework figure is given separately. " +
    "Only the newest 1,000 matching notices are read. Mostly eForms notices (compulsory from late 2023).",
};

/** ISO 3166-1 alpha-2 -> TED's alpha-3 buyer-country code, and the country name for sentences. */
export const COUNTRIES: Record<string, { iso3: string; name: string }> = {
  AT: { iso3: "AUT", name: "Austria" }, BE: { iso3: "BEL", name: "Belgium" }, BG: { iso3: "BGR", name: "Bulgaria" },
  HR: { iso3: "HRV", name: "Croatia" }, CY: { iso3: "CYP", name: "Cyprus" }, CZ: { iso3: "CZE", name: "Czechia" },
  DK: { iso3: "DNK", name: "Denmark" }, EE: { iso3: "EST", name: "Estonia" }, FI: { iso3: "FIN", name: "Finland" },
  FR: { iso3: "FRA", name: "France" }, DE: { iso3: "DEU", name: "Germany" }, GR: { iso3: "GRC", name: "Greece" },
  HU: { iso3: "HUN", name: "Hungary" }, IE: { iso3: "IRL", name: "Ireland" }, IT: { iso3: "ITA", name: "Italy" },
  LV: { iso3: "LVA", name: "Latvia" }, LT: { iso3: "LTU", name: "Lithuania" }, LU: { iso3: "LUX", name: "Luxembourg" },
  MT: { iso3: "MLT", name: "Malta" }, NL: { iso3: "NLD", name: "the Netherlands" }, PL: { iso3: "POL", name: "Poland" },
  PT: { iso3: "PRT", name: "Portugal" }, RO: { iso3: "ROU", name: "Romania" }, SK: { iso3: "SVK", name: "Slovakia" },
  SI: { iso3: "SVN", name: "Slovenia" }, ES: { iso3: "ESP", name: "Spain" }, SE: { iso3: "SWE", name: "Sweden" },
  IS: { iso3: "ISL", name: "Iceland" }, LI: { iso3: "LIE", name: "Liechtenstein" }, NO: { iso3: "NOR", name: "Norway" },
};

export const TED_URL = "https://api.ted.europa.eu/v3/notices/search";
export const PAGE_SIZE = 250;
export const MAX_NOTICES = 1000;
/** Values below this are placeholders (1, 1.00, -1) that buyers type when the form insists on a number. */
export const MIN_VALUE = 100;

/** Fields every request asks for (all checked against the live API on 2026-10-14). */
export const CORE_FIELDS = [
  "publication-number", "publication-date", "identifier-lot", "main-classification-lot", "result-lot-identifier", "winner-selection-status",
  "framework-agreement-lot", "tender-lot-identifier", "tender-value", "tender-value-cur", "total-value", "total-value-cur",
];
/** Fields that only add detail; a request that TED refuses because of one of them is repeated without them. */
export const OPTIONAL_FIELDS = ["quantity-lot", "quantity-unit-lot"];

// ---------- query ----------

export function ymd(iso: string): string {
  return iso.replace(/-/g, "");
}

/** Text that is safe inside a TED expert-search phrase. */
export function phrase(text: string): string {
  return text.replace(/["\\]/g, " ").replace(/\s+/g, " ").trim();
}

export interface TedQueryInput {
  iso3: string;
  from: string; // YYYY-MM-DD
  /** CPV stems (see cpvStem): each matches the code and everything below it. */
  stems?: string[];
  /** Free text, used when there are no codes. */
  text?: string;
  /** Buyer city, as text. */
  city?: string;
}

export function buildTedQuery(i: TedQueryInput): string {
  const parts = [`buyer-country = ${i.iso3}`, "form-type = result", `publication-date >= ${ymd(i.from)}`];
  if (i.stems && i.stems.length) {
    const terms = i.stems.map((s) => `classification-cpv = ${s}*`);
    parts.push(terms.length === 1 ? terms[0] : `(${terms.join(" OR ")})`);
  } else if (i.text) {
    parts.push(`FT ~ "${phrase(i.text)}"`);
  }
  if (i.city) parts.push(`buyer-city ~ "${phrase(i.city)}"`);
  return parts.join(" AND ") + " SORT BY publication-date DESC";
}

// ---------- parsing ----------

function arr(v: unknown): unknown[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

export function numArray(v: unknown): number[] {
  return arr(v).map((x) => (typeof x === "number" ? x : Number(x))).filter((x) => Number.isFinite(x));
}

export function strArray(v: unknown): string[] {
  return arr(v).map((x) => (typeof x === "string" ? x : x === undefined || x === null ? "" : String(x)));
}

/** UN/CEFACT unit codes that appear on notices, as words. Anything else is shown as its code. */
const UNITS: Record<string, string> = {
  H87: "piece", C62: "unit", NAR: "item", LTR: "litre", KWH: "kWh", MWH: "MWh", GWH: "GWh", KGM: "kg", TNE: "tonne", MTR: "metre",
  MTK: "square metre", MTQ: "cubic metre", HUR: "hour", DAY: "day", MON: "month", ANN: "year", LS: "lump sum",
};

export function unitName(code: string): string {
  return UNITS[code.toUpperCase()] ?? code;
}

export interface TedLot {
  id: string; // publication number + lot
  date: string; // YYYY-MM-DD
  value: number;
  currency: string;
  /** Where the value comes from: the winning tender, or (single-lot notices only) the notice total. */
  basis: "tender" | "notice_total";
  /** True for a framework agreement (its value is usually a ceiling), false for a single contract, null when the notice does not say. */
  framework: boolean | null;
  quantity?: number;
  unit?: string;
}

export type Skip = "no_winner" | "other_product" | "several_lots" | "no_value" | "several_values" | "placeholder_value" | "unknown_lots";

export const SKIP_KEYS: Skip[] = ["no_winner", "other_product", "several_lots", "no_value", "several_values", "placeholder_value", "unknown_lots"];

export function emptySkips(): Record<Skip, number> {
  return { no_winner: 0, other_product: 0, several_lots: 0, no_value: 0, several_values: 0, placeholder_value: 0, unknown_lots: 0 };
}

/**
 * One award notice -> the lots that count as contracts, and the reasons the others were left out. Pure: tested against fixtures copied from the live API.
 * `stems` are the CPV groups asked for; a lot counts only if its own main product code is in one of them. Without stems (free-text search) only
 * single-lot notices are used, because TED gives no per-lot text to check the other lots against.
 */
export function parseTedNotice(n: any, stems?: string[]): { lots: TedLot[]; skipped: Record<Skip, number> } {
  const skipped = emptySkips();
  const lots: TedLot[] = [];
  const lotIds = strArray(n?.["identifier-lot"]);
  if (!lotIds.length) {
    skipped.unknown_lots++;
    return { lots, skipped };
  }
  const pub = String(n?.["publication-number"] ?? "");
  const date = String(n?.["publication-date"] ?? "").slice(0, 10);
  const cpvs = strArray(n?.["main-classification-lot"]);
  const cpvAligned = cpvs.length === lotIds.length;
  const resultIds = strArray(n?.["result-lot-identifier"]);
  const statuses = strArray(n?.["winner-selection-status"]);
  const statusOf = new Map<string, string>();
  if (resultIds.length === statuses.length) resultIds.forEach((id, i) => statusOf.set(id, statuses[i]));
  const fa = strArray(n?.["framework-agreement-lot"]);
  const faAligned = fa.length === lotIds.length;
  const tenderLots = strArray(n?.["tender-lot-identifier"]);
  const tenderValues = strArray(n?.["tender-value"]).map(Number);
  const tenderCurs = strArray(n?.["tender-value-cur"]);
  const tendersAligned = tenderLots.length === tenderValues.length;
  const totals = numArray(n?.["total-value"]);
  const total = totals.length === 1 ? totals[0] : NaN;
  const totalCur = strArray(n?.["total-value-cur"])[0] ?? "";
  const qty = numArray(n?.["quantity-lot"]);
  const units = strArray(n?.["quantity-unit-lot"]);
  const qtyAligned = qty.length === lotIds.length && units.length === lotIds.length;

  for (let j = 0; j < lotIds.length; j++) {
    const lot = lotIds[j];
    // Which product is this lot?
    if (stems && stems.length) {
      if (cpvAligned) {
        if (!cpvInGroups(cpvs[j], stems)) {
          skipped.other_product++;
          continue;
        }
      } else if (lotIds.length > 1) {
        skipped.unknown_lots++;
        continue;
      }
    } else if (lotIds.length > 1) {
      skipped.several_lots++;
      continue;
    }
    // Was a winner chosen?
    if (statusOf.get(lot) !== "selec-w") {
      skipped.no_winner++;
      continue;
    }
    // The value: the winning tender(s) for this lot; for a single-lot notice without one, the notice total.
    let value = NaN;
    let currency = "";
    let basis: TedLot["basis"] = "tender";
    let placeholder = false;
    if (tendersAligned) {
      const mine: { v: number; cur: string }[] = [];
      tenderLots.forEach((tl, i) => {
        if (tl === lot && Number.isFinite(tenderValues[i])) mine.push({ v: tenderValues[i], cur: tenderCurs.length === tenderValues.length ? tenderCurs[i] : tenderCurs[0] ?? totalCur });
      });
      const good = mine.filter((m) => m.v >= MIN_VALUE && m.cur);
      if (mine.length && !good.length) placeholder = true;
      const distinct = new Map<string, { v: number; cur: string }>();
      for (const g of good) distinct.set(`${g.cur}${g.v.toFixed(2)}`, g);
      if (distinct.size > 1) {
        skipped.several_values++;
        continue;
      }
      if (distinct.size === 1) {
        const g = [...distinct.values()][0];
        value = g.v;
        currency = g.cur;
      }
    }
    if (!Number.isFinite(value) && lotIds.length === 1 && Number.isFinite(total) && totalCur) {
      if (total >= MIN_VALUE) {
        value = total;
        currency = totalCur;
        basis = "notice_total";
        placeholder = false;
      } else placeholder = true;
    }
    if (!Number.isFinite(value)) {
      if (placeholder) skipped.placeholder_value++;
      else skipped.no_value++;
      continue;
    }
    const framework = faAligned ? fa[j] !== "none" : null;
    const rec: TedLot = { id: `${pub}#${lot}`, date, value, currency, basis, framework };
    if (qtyAligned && framework === false && qty[j] > 0 && units[j]) {
      rec.quantity = qty[j];
      rec.unit = units[j];
    }
    lots.push(rec);
  }
  return { lots, skipped };
}

export interface Collected {
  lots: TedLot[];
  skipped: Record<Skip, number>;
}

export function collect(notices: any[], stems?: string[]): Collected {
  const lots: TedLot[] = [];
  const skipped = emptySkips();
  const seen = new Set<string>();
  for (const n of notices) {
    const r = parseTedNotice(n, stems);
    for (const k of SKIP_KEYS) skipped[k] += r.skipped[k];
    for (const lot of r.lots) {
      if (seen.has(lot.id)) continue;
      seen.add(lot.id);
      lots.push(lot);
    }
  }
  return { lots, skipped };
}

/** The currency with the most contracts (EUR first on a tie), and how many contracts are in each other currency. */
export function pickCurrency(records: { currency: string }[]): { currency: string; others: Record<string, number> } {
  const counts = new Map<string, number>();
  for (const r of records) if (r.currency) counts.set(r.currency, (counts.get(r.currency) ?? 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] === "EUR" ? -1 : b[0] === "EUR" ? 1 : a[0].localeCompare(b[0])));
  const currency = ranked[0]?.[0] ?? "EUR";
  return { currency, others: Object.fromEntries(ranked.slice(1)) };
}

/** Which lots the headline median and range are built from, and the lots kept out of it. */
export interface Headline {
  /** The lots the headline is built from. */
  lots: TedLot[];
  basis: "single_contracts" | "all_awards";
  /** Framework agreements (their stated value is usually a ceiling over several years, not a price paid). */
  frameworks: TedLot[];
  /** Single contracts: the notice says there is no framework agreement. */
  singles: TedLot[];
  /** Lots whose notice does not say either way. */
  unknown: number;
}

/**
 * Single contracts alone when at least MIN_PUBLISH of them match and framework agreements would otherwise be mixed in: a framework's stated
 * value is a ceiling over several years, so one big framework should not move the median of what buyers paid. Otherwise every award counts,
 * as before (a figure from fewer than 5 single contracts would not be published on its own).
 */
export function chooseHeadline(lots: TedLot[]): Headline {
  const frameworks = lots.filter((l) => l.framework === true);
  const singles = lots.filter((l) => l.framework === false);
  const unknown = lots.length - frameworks.length - singles.length;
  const singleOnly = frameworks.length > 0 && singles.length >= MIN_PUBLISH;
  return { lots: singleOnly ? singles : lots, basis: singleOnly ? "single_contracts" : "all_awards", frameworks, singles, unknown };
}

// ---------- fetching ----------

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Errors worth one more try: TED sits behind a rate limiter and a CDN that now and then answer 429 or 502/503/504. */
export function isRetryable(e: unknown): boolean {
  return e instanceof SourceError && !(e instanceof InputError) && /HTTP (429|502|503|504)\b/.test(e.message);
}

async function tedSearch(body: Record<string, unknown>): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    try {
      const json = await fetchJson(
        TED_URL,
        { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) },
        25000,
      );
      if (json?.timedOut === true) throw new SourceError("TED's search timed out", "timedOut=true");
      return json;
    } catch (e) {
      if (attempt < 3 && isRetryable(e)) {
        await sleep(500 * (attempt + 1) + Math.floor(Math.random() * 300));
        continue;
      }
      throw e;
    }
  }
}

export function searchBody(query: string, fields: string[], page: number, limit: number): Record<string, unknown> {
  return { query, fields, page, limit, scope: "ALL", paginationMode: "PAGE_NUMBER", onlyLatestVersions: true, checkQuerySyntax: false };
}

/** Fetch the newest notices that match, up to MAX_NOTICES. Repeats without the optional fields if TED refuses one of them. */
export async function fetchNotices(query: string): Promise<{ notices: any[]; total: number; optional: boolean }> {
  let optional = true;
  const fields = () => (optional ? [...CORE_FIELDS, ...OPTIONAL_FIELDS] : CORE_FIELDS);
  let first: any;
  try {
    first = await tedSearch(searchBody(query, fields(), 1, PAGE_SIZE));
  } catch (e: any) {
    if (e instanceof SourceError && /HTTP 400/.test(e.message)) {
      optional = false;
      first = await tedSearch(searchBody(query, fields(), 1, PAGE_SIZE));
    } else throw e;
  }
  const total = Number(first?.totalNoticeCount ?? 0);
  const notices: any[] = Array.isArray(first?.notices) ? [...first.notices] : [];
  const pages = Math.min(Math.ceil(Math.min(total, MAX_NOTICES) / PAGE_SIZE), 4);
  // One page at a time, with a short pause: TED answers HTTP 429 to bursts.
  for (let page = 2; page <= pages; page++) {
    await sleep(150);
    const r = await tedSearch(searchBody(query, fields(), page, PAGE_SIZE));
    if (Array.isArray(r?.notices)) notices.push(...r.notices);
  }
  return { notices, total, optional };
}

// ---------- the answer ----------

export interface TedInput {
  country: string;
  what: string;
  cpv?: string;
  buyer_area?: string;
  months: number;
  baseUrl?: string;
}

export async function euTedContracts(input: TedInput): Promise<PriceAnswer> {
  const c = COUNTRIES[input.country];
  if (!c) throw new InputError(`TED answers for EU and EEA buyers; ${input.country} is not one of them.`);
  const win = monthsWindow(input.months);
  let stems: string[] | undefined;
  let codes: string[] | undefined;
  let text: string | undefined;
  let matched: string | null = null;
  if (input.cpv) {
    const code = cleanCpv(input.cpv);
    if (!code) throw new InputError("cpv must be a CPV code: 8 digits such as 30213100 (or a shorter prefix such as 3021).");
    codes = [code];
    stems = [cpvStem(code)];
  } else {
    const p = matchPurchase(input.what);
    if (p) {
      codes = p.cpv;
      stems = [...new Set(p.cpv.map(cpvStem))];
      matched = p.label;
    } else text = input.what;
  }
  const city = input.buyer_area?.trim() || undefined;
  const query = buildTedQuery({ iso3: c.iso3, from: win.from, stems, text, city });
  let fetched: { notices: any[]; total: number; optional: boolean };
  try {
    fetched = await fetchNotices(query);
  } catch (e: any) {
    if (city && e instanceof SourceError && /HTTP 400/.test(e.message)) throw new InputError("TED did not accept that buyer_area; give a city name such as 'Lyon'.");
    throw e;
  }
  const { notices, total } = fetched;
  const { lots, skipped } = collect(notices, stems);

  const { currency, others } = pickCurrency(lots);
  const inCurrency = lots.filter((l) => l.currency === currency);
  const head = chooseHeadline(inCurrency);
  const dates = head.lots.map((l) => l.date).filter(Boolean).sort();
  const truncated = total > notices.length;
  const unit = unitPriceFrom(
    inCurrency.filter((l) => l.quantity && l.unit).map((l) => ({ value: l.value, quantity: l.quantity!, unit: unitName(l.unit!) })),
    currency,
  );
  const otherCount = Object.values(others).reduce((a, b) => a + b, 0);
  const fwSummary = head.frameworks.length >= MIN_PUBLISH ? summarise(head.frameworks.map((l) => l.value)) : null;
  const plural = head.frameworks.length === 1 ? "" : "s";
  const notes: string[] = [];
  if (otherCount) notes.push(`${otherCount} award(s) in other currencies were left out; figures are in ${currency}.`);
  if (head.frameworks.length && head.basis === "single_contracts") {
    // One sentence: what was kept out of the headline and why. The framework figure itself is in `extra`.
    notes.push(
      `${head.frameworks.length} framework agreement${plural} in the same notices ${head.frameworks.length === 1 ? "is" : "are"} left out of this figure, because the stated value of a framework is usually a ceiling over several years rather than a price paid` +
        (fwSummary ? `; they have a median of ${fmtMoney(fwSummary.median, currency)} (see extra.framework_agreements_figure).` : "."),
    );
  } else if (head.frameworks.length) {
    notes.push(
      `${head.frameworks.length} of the ${inCurrency.length} awards are framework agreements, whose stated value is usually a ceiling over several years rather than a price paid; ` +
        `fewer than ${MIN_PUBLISH} single contracts matched, so this figure includes them.`,
    );
  }
  if (truncated) notes.push(`TED holds ${total} matching award notices; the newest ${notices.length} were read.`);
  const leftOut: Record<string, number> = { ...skipped, other_currency: otherCount };
  return contractAnswer({
    source: INFO,
    query: { country: input.country, what: input.what, ...(input.cpv ? { cpv: input.cpv } : {}), ...(input.buyer_area ? { buyer_area: input.buyer_area } : {}), months: input.months },
    values: head.lots.map((l) => l.value),
    currency,
    what: matched ?? input.what,
    where: c.name + (city ? ` (buyers in ${city})` : ""),
    period: { from: truncated && dates.length ? dates[0] : win.from, to: dates.length ? dates[dates.length - 1] : win.to },
    newest: dates.length ? dates[dates.length - 1] : null,
    method:
      `Contract award notices (form type 'result') on TED whose buyer is in ${c.name}${city ? ` and in ${city}` : ""}, published since ${win.from}, ` +
      (codes ? `with CPV code(s) ${codes.join(", ")}` : `found by free-text search for "${text}"`) +
      (stems ? `. Each lot whose own main product code is in that group, with a chosen winner and a stated value, is one contract; its value is the winning tender's value` : `. Each single-lot notice with a chosen winner and a stated value is one contract; its value is the winning tender's value`) +
      ` (or the notice total when a single-lot notice gives no tender value). ` +
      (head.basis === "single_contracts"
        ? `Framework agreements are left out of the headline because their stated value is usually a ceiling over several years; the median and 10th–90th percentile are those of the single contracts in ${currency}.`
        : `Median and 10th–90th percentile of those values in ${currency}.`) +
      ` Never supplier names. Values are totals per contract (lot), not unit prices.`,
    unitPrice: unit,
    notes,
    baseUrl: input.baseUrl,
    extra: {
      matched_codes: codes ?? null,
      free_text: text ?? null,
      notices_found: total,
      notices_read: notices.length,
      awards_used: head.lots.length,
      awards_in_currency: inCurrency.length,
      headline_basis: head.basis,
      value_from: { winning_tender: head.lots.filter((l) => l.basis === "tender").length, notice_total: head.lots.filter((l) => l.basis === "notice_total").length },
      framework_agreements: head.frameworks.length,
      single_contracts: head.singles.length,
      ...(head.unknown ? { framework_unknown: head.unknown } : {}),
      // The framework figure, kept out of the headline. Only from 5 or more framework agreements.
      ...(fwSummary && head.basis === "single_contracts"
        ? { framework_agreements_figure: { currency, median: fwSummary.median, typical_low: fwSummary.low, typical_high: fwSummary.high, sample_size: fwSummary.count, value_basis: "stated value of a framework agreement, usually a ceiling over several years" } }
        : {}),
      left_out: leftOut,
      ...(otherCount ? { other_currencies: others } : {}),
    },
  });
}
