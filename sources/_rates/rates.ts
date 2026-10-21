// Shared parts of the interest-rate sources (ECB, Bank of England, Bank of Canada). A folder starting with "_" is not a source.
//
// What an interest-rate answer is: ONE figure that a central bank publishes, the average rate agreed on NEW business in a month
// (loans or deposits), passed on exactly as published. It uses the same answer format as every official statistic
// (buildStatisticAnswer): value, measure "average", price_type official_statistic, a reference period, sample_size null and no
// range. Its "currency" is the marker RATE_CURRENCY ("PERCENT") and its unit "% a year", the way an index uses "INDEX".
// Nothing about a person ever enters a request: country, product, term and a number of months, nothing else.
//
// Where answers come from: the daily collector (harvest) and the history loader (backfill) keep the monthly figures in the price
// library, 24 months deep. An answer is built from that stored copy while it is current, and from the publisher's API when the copy
// is missing or old. If the live call fails, the registry's stale-if-error path serves the stored figure (lib/stale.ts).

import { buildStatisticAnswer, RATE_CURRENCY, RATE_UNIT } from "../../lib/answer";
import type { PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import { readMonthly } from "../../lib/library/backfill";
import { readDaily } from "../../lib/library/store";
import type { BackfillPeriod, BackfillResult, DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { MIN_PUBLISH } from "../../lib/stats";

// ---------- vocabulary ----------

export type Kind = "loan" | "deposit";

export const PRODUCTS = {
  mortgage: { key: "mortgage", kind: "loan" as Kind, short: "a mortgage (a loan for house purchase)" },
  mortgage_insured: { key: "mort-ins", kind: "loan" as Kind, short: "an insured mortgage (Canada)" },
  mortgage_uninsured: { key: "mort-unins", kind: "loan" as Kind, short: "an uninsured mortgage (Canada)" },
  consumer_loan: { key: "consumer", kind: "loan" as Kind, short: "a consumer loan" },
  business_loan: { key: "biz", kind: "loan" as Kind, short: "a business loan of any size" },
  business_loan_small: { key: "biz-small", kind: "loan" as Kind, short: "a small business loan (up to EUR 1 million in the euro area, SMEs in the UK)" },
  business_loan_large: { key: "biz-large", kind: "loan" as Kind, short: "a large business loan (over EUR 1 million, euro area)" },
  deposit: { key: "dep-term", kind: "deposit" as Kind, short: "a household term deposit (agreed maturity)" },
  deposit_overnight: { key: "dep-night", kind: "deposit" as Kind, short: "a household overnight deposit" },
  deposit_notice: { key: "dep-notice", kind: "deposit" as Kind, short: "a household deposit redeemable at notice" },
} as const;
export type Product = keyof typeof PRODUCTS;
export const PRODUCT_IDS = Object.keys(PRODUCTS) as Product[];

/** The terms (rate-fixation periods for loans, agreed maturities or notice periods for deposits) any source may offer, with their meaning. */
export const TERM_WORDS: Record<string, string> = {
  total: "all terms taken together",
  composite: "the ECB's composite cost-of-borrowing indicator (all fixation periods, weighted by a moving average of volumes)",
  floating: "a floating rate (the ECB groups it with an initial fixation of up to 1 year)",
  fixed: "any fixed rate",
  "up-to-3m": "up to 3 months",
  "3m-1y": "over 3 months and up to 1 year",
  "up-to-1y": "up to 1 year",
  "1-2y": "over 1 and up to 2 years",
  "up-to-2y": "up to 2 years",
  "over-2y": "over 2 years",
  "1-3y": "over 1 and up to 3 years",
  "3-5y": "over 3 and up to 5 years",
  "1-5y": "over 1 and up to 5 years",
  "5y": "5 years",
  "5-10y": "over 5 and up to 10 years",
  "over-1y": "over 1 year",
  "over-3m": "over 3 months",
  "over-5y": "over 5 years",
  "over-10y": "over 10 years",
};
export const TERM_IDS = Object.keys(TERM_WORDS);

const TERM_ALIASES: Record<string, string> = {
  all: "total", any: "total", overall: "total", default: "total",
  variable: "floating", "variable-rate": "floating", "floating-rate": "floating", tracker: "floating",
  "fixed-rate": "fixed",
  "cost-of-borrowing": "composite", cob: "composite",
  "less-than-1y": "up-to-1y", "under-1y": "up-to-1y", "<1y": "up-to-1y", "1y": "up-to-1y", "up-to-1-year": "up-to-1y",
  "over-1-year": "over-1y", ">1y": "over-1y", "over-5-years": "over-5y", ">5y": "over-5y", "5y+": "over-5y", "5y-and-over": "over-5y", "10y+": "over-10y", ">10y": "over-10y",
  "5-years": "5y", "five-years": "5y", "1-to-5y": "1-5y", "1-to-3y": "1-3y", "3-to-5y": "3-5y", "5-to-10y": "5-10y", "1-to-2y": "1-2y",
  "up-to-3-months": "up-to-3m", "<3m": "up-to-3m", "over-3-months": "over-3m", ">3m": "over-3m",
};

/** A term as the caller wrote it, as one of our tokens ("Variable", "1 to 5y", "over 5 years" ...), or the cleaned text if it is not one. */
export function normaliseTerm(raw: unknown): string {
  const t = String(raw ?? "").trim().toLowerCase().replace(/[_\s]+/g, "-").replace(/-{2,}/g, "-").replace(/^-|-$/g, "");
  if (!t) return "total";
  return TERM_ALIASES[t] ?? t;
}

const PRODUCT_ALIASES: Record<string, Product> = {
  mortgages: "mortgage", "home-loan": "mortgage", "house-purchase": "mortgage", "home-loans": "mortgage", "housing-loan": "mortgage",
  "consumer-credit": "consumer_loan", consumer: "consumer_loan", "personal-loan": "consumer_loan", "consumer-loan": "consumer_loan",
  business: "business_loan", "business-loans": "business_loan", "corporate-loan": "business_loan", "company-loan": "business_loan", "sme-loan": "business_loan_small",
  "small-business-loan": "business_loan_small", "business-loan-small": "business_loan_small", "large-business-loan": "business_loan_large", "business-loan-large": "business_loan_large",
  deposits: "deposit", savings: "deposit", "term-deposit": "deposit", "term-deposits": "deposit", "fixed-term-deposit": "deposit",
  overnight: "deposit_overnight", "overnight-deposit": "deposit_overnight", "current-account": "deposit_overnight",
  notice: "deposit_notice", "notice-deposit": "deposit_notice", "savings-notice": "deposit_notice",
  "insured-mortgage": "mortgage_insured", "uninsured-mortgage": "mortgage_uninsured",
};

/** A product as the caller wrote it ("mortgage", "Mortgages", "consumer credit" ...), or undefined if it is not one of ours. */
export function normaliseProduct(raw: unknown): Product | undefined {
  const t = String(raw ?? "").trim().toLowerCase().replace(/[_\s]+/g, "-").replace(/-{2,}/g, "-");
  if (!t) return "mortgage";
  const direct = t.replace(/-/g, "_");
  if ((PRODUCT_IDS as string[]).includes(direct)) return direct as Product;
  return PRODUCT_ALIASES[t];
}

export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "2026-08" -> "August 2026". */
export function monthWords(period: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  return m ? `${MONTH_NAMES[Number(m[2]) - 1]} ${m[1]}` : period;
}
/** "2026-08" + n months -> "2026-08" shifted. */
export function addMonths(period: string, n: number): string {
  const y = Number(period.slice(0, 4));
  const m = Number(period.slice(5, 7)) - 1 + n;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${yy}-${String(mm + 1).padStart(2, "0")}`;
}
/** Last day of a month: "2026-08" -> "2026-08-31". */
export function monthEnd(period: string): string {
  const y = Number(period.slice(0, 4));
  const m = Number(period.slice(5, 7));
  return `${period}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}

// ---------- requests ----------

export interface RateRequest {
  country: string;
  product: Product;
  term: string;
  months: number;
}

export const DEFAULT_MONTHS = 12;
export const MAX_MONTHS = 24;

/** The request as the tool understands it: country, product, term and months of history, nothing else. Throws InputError. */
export function parseRateRequest(p: Record<string, unknown>): RateRequest {
  const product = normaliseProduct(p.product);
  if (!product) {
    throw new InputError(`product must be one of ${PRODUCT_IDS.join(", ")}. Not yet: ${String(p.product)}.`);
  }
  let months = DEFAULT_MONTHS;
  if (p.months !== undefined && p.months !== null && p.months !== "") {
    const n = Number(p.months);
    if (!Number.isInteger(n) || n < 1 || n > MAX_MONTHS) throw new InputError(`months must be a whole number from 1 to ${MAX_MONTHS} (how many months of history to include).`);
    months = n;
  }
  return { country: String(p.country ?? "").toUpperCase(), product, term: normaliseTerm(p.term), months };
}

// ---------- series ----------

/** One published series, with everything an answer says about it. */
export interface RateSeries {
  /** Library area and country code: "IE", "EA" (euro area), "GB", "CA". */
  area: string;
  areaName: string;
  product: Product;
  term: string;
  kind: Kind;
  /** Library item key, e.g. "mortgage/total". Short labels only (the library accepts nothing longer). */
  item: string;
  /** The publisher's own series code. */
  code: string;
  /** "loans to households for house purchase": goes after "new". */
  productLabel: string;
  /** Plain words for the term in this source: "all initial rate-fixation periods". */
  termLabel: string;
  /** The publisher's own title for the series. */
  seriesLabel: string;
  /** Set when the product asked for is answered by a more specific series (Canada: "mortgage" is answered with the uninsured series). */
  aliasNote?: string;
}

export const libraryItem = (product: Product, term: string) => `${PRODUCTS[product].key}/${term}`;

/** Every series a source publishes, as a list the resolver and the collector both read. */
export interface Catalog {
  /** All series for one area. */
  forArea(area: string): RateSeries[];
  areas: { code: string; name: string }[];
  /** A product the publisher does not publish as one figure, answered with a named series instead, and the sentence that says so. */
  aliases?: Partial<Record<Product, { to: Product; note: string }>>;
}

/** The series for a request, or an InputError that lists what the source offers for that product. */
export function pickSeries(catalog: Catalog, req: RateRequest, sourceName: string): RateSeries {
  const area = catalog.areas.find((a) => a.code === req.country);
  if (!area) throw new InputError(`${sourceName} covers ${catalog.areas.map((a) => a.code).join(", ")}. Not yet: ${req.country}.`);
  const all = catalog.forArea(area.code);
  const alias = catalog.aliases?.[req.product];
  const forProduct = all.filter((s) => s.product === (alias?.to ?? req.product));
  if (!forProduct.length) {
    const products = [...new Set(all.map((s) => s.product))];
    throw new InputError(`${area.name} has no ${req.product} series in ${sourceName}. Products offered: ${products.join(", ")}.`);
  }
  const hit = forProduct.find((s) => s.term === req.term);
  if (!hit) {
    throw new InputError(`term must be one of ${forProduct.map((s) => s.term).join(", ")} for ${req.product} in ${area.name}. Not yet: ${req.term}.`);
  }
  return alias ? { ...hit, aliasNote: alias.note } : hit;
}

// ---------- points ----------

export interface RatePoint {
  /** "YYYY-MM". */
  period: string;
  /** The rate, in % a year, exactly as published. */
  value: number;
}

/** Newest last, one point per month, missing and non-numeric values dropped. */
export function cleanPoints(points: RatePoint[]): RatePoint[] {
  const byMonth = new Map<string, number>();
  for (const p of points) if (/^\d{4}-\d{2}$/.test(p.period) && Number.isFinite(p.value) && p.value >= 0) byMonth.set(p.period, p.value);
  return [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([period, value]) => ({ period, value }));
}

/** The figures we hold for a series: recent months from the daily files (dated by month end), older ones from the monthly history files. */
export function readStored(sourceId: string, s: Pick<RateSeries, "area" | "item">, months: number, today: Date): RatePoint[] {
  const endMonth = today.toISOString().slice(0, 7);
  const startMonth = addMonths(endMonth, -(Math.max(months, 13) + 1));
  const daily = readDaily(sourceId, { area: s.area, item: s.item, from: `${startMonth}-01`, to: today.toISOString().slice(0, 10) });
  const monthly = readMonthly(sourceId, { area: s.area, item: s.item, from: startMonth, to: endMonth });
  const usable = (r: { n: number }) => r.n >= MIN_PUBLISH;
  // a monthly row is the whole month's figure; a daily row is a month-end snapshot of the same figure, which wins
  return cleanPoints([...monthly.filter(usable).map((r) => ({ period: r.date.slice(0, 7), value: r.median })), ...daily.filter(usable).map((r) => ({ period: r.date.slice(0, 7), value: r.median }))]);
}

/** Is the newest stored month recent enough to answer from? (Publishers lag: the ECB and the Bank of England about 5 weeks, the Bank of Canada about 11.) */
export function isCurrent(points: RatePoint[], maxAgeDays: number, today: Date): boolean {
  if (!points.length) return false;
  const newest = points[points.length - 1].period;
  const ageDays = (today.getTime() - new Date(monthEnd(newest) + "T00:00:00Z").getTime()) / 86400000;
  return ageDays <= maxAgeDays;
}

// ---------- the answer ----------

const diff = (a: number, b: number) => Math.round((a - b) * 10000) / 10000;
const signed = (v: number) => (v > 0 ? `+${v}` : String(v));

export function rateAnswer(o: {
  info: SourceInfo;
  series: RateSeries;
  req: RateRequest;
  points: RatePoint[]; // cleaned, newest last; may be longer than req.months
  method: string;
  viaCopy: boolean;
  note?: string;
  extra?: Record<string, unknown>;
  baseUrl?: string;
  availableTerms?: string[];
}): PriceAnswer {
  const { info, series: s, req } = o;
  const latest = o.points[o.points.length - 1];
  const query = { country: req.country, product: req.product, term: req.term, months: req.months };
  const base = { source: info, query, measure: "average" as const, currency: RATE_CURRENCY, unit: RATE_UNIT, method: o.method, baseUrl: o.baseUrl };

  if (!latest) {
    const none = buildStatisticAnswer({ ...base, value: null, period: { from: null, to: null }, reference_period: "", describe: () => "" });
    return {
      ...none,
      summary: `${info.name} (${info.publisher}) has no published rate for ${s.productLabel}, ${s.termLabel}, in ${s.areaName} in the last ${Math.max(req.months, 13)} months. Try another term or product.`,
      extra: { country_name: s.areaName, product: req.product, term: req.term, ...(o.availableTerms ? { available_terms: o.availableTerms } : {}) },
    };
  }

  const prev = o.points.find((p) => p.period === addMonths(latest.period, -1));
  const yearAgo = o.points.find((p) => p.period === addMonths(latest.period, -12));
  const history = o.points.filter((p) => p.period >= addMonths(latest.period, -(req.months - 1)));
  const month = monthWords(latest.period);
  const verb = s.kind === "loan" ? "agreed rate on new" : "rate paid on new";
  const sentence = `The official average ${verb} ${s.productLabel} in ${s.areaName} was ${latest.value} % a year in ${month} (${s.termLabel}).`;
  const change = yearAgo
    ? ` That is ${diff(latest.value, yearAgo.value) === 0 ? "unchanged" : `${signed(diff(latest.value, yearAgo.value))} percentage points`} on a year earlier (${yearAgo.value} % a year in ${monthWords(yearAgo.period)}; change calculated by ProofPrice).`
    : "";
  const notes = [
    `This is the average rate across lenders for contracts agreed in ${month}, not any one lender's rate, offer or quote.`,
    ...(s.aliasNote ? [s.aliasNote] : []),
    ...(o.note ? [o.note] : []),
  ];

  return buildStatisticAnswer({
    ...base,
    value: latest.value,
    period: { from: `${latest.period}-01`, to: monthEnd(latest.period) },
    reference_period: latest.period,
    note: notes.join(" "),
    describe: () => sentence + change,
    extra: {
      country_name: s.areaName,
      product: req.product,
      ...(s.product !== req.product ? { product_answered: s.product } : {}),
      product_label: s.productLabel,
      term: req.term,
      term_label: s.termLabel,
      reference_period_label: month,
      series: { publisher_code: s.code, title: s.seriesLabel },
      change_on_previous_month: prev ? { reference_period: prev.period, value: prev.value, change_points: diff(latest.value, prev.value) } : null,
      change_on_year_earlier: yearAgo ? { reference_period: yearAgo.period, value: yearAgo.value, change_points: diff(latest.value, yearAgo.value) } : null,
      changes_note: "Changes are differences between two published figures, calculated by ProofPrice; the published figures themselves are unchanged.",
      history_unit: RATE_UNIT,
      history: history.map((p) => ({ reference_period: p.period, value: p.value })),
      history_months_returned: history.length,
      history_months_asked: req.months,
      answered_from: o.viaCopy ? "ProofPrice's stored copy of the official monthly figures" : "the official source, live",
      ...(o.availableTerms ? { available_terms: o.availableTerms } : {}),
      ...(o.extra ?? {}),
    },
  });
}

// ---------- one source's behaviour ----------

export interface RateSource {
  info: SourceInfo;
  catalog: Catalog;
  /** Days after a month's end up to which a stored newest month still counts as current. */
  freshDays: number;
  method: string;
  /** The live figures of one series, newest last (at least `months` of them when the publisher has them). */
  fetchLive(series: RateSeries, months: number, today: Date): Promise<RatePoint[]>;
  /** The live figures of every series for a range of months (collector and history loader). Key: area + "\0" + item. */
  fetchAll(fromMonth: string, toMonth: string): Promise<Map<string, RatePoint[]>>;
}

const seriesKey = (s: Pick<RateSeries, "area" | "item">) => `${s.area}\u0000${s.item}`;

export function allSeries(catalog: Catalog): RateSeries[] {
  return catalog.areas.flatMap((a) => catalog.forArea(a.code));
}

/** The answer to a request. Stored copy first (it is the same official figure, kept 24 months deep), the live source if the copy is missing or old. */
export async function answerRate(src: RateSource, params: Record<string, unknown>, ctx: { baseUrl?: string }, today = new Date()): Promise<PriceAnswer> {
  const req = parseRateRequest(params);
  const series = pickSeries(src.catalog, req, src.info.name);
  const availableTerms = src.catalog.forArea(series.area).filter((x) => x.product === series.product).map((x) => x.term);
  let points = readStored(src.info.id, series, req.months, today);
  let viaCopy = true;
  if (!isCurrent(points, src.freshDays, today)) {
    points = cleanPoints(await src.fetchLive(series, Math.max(req.months, 13), today));
    viaCopy = false;
  }
  return rateAnswer({ info: src.info, series, req, points, method: src.method, viaCopy, baseUrl: ctx.baseUrl, availableTerms });
}

/** What the collector stores each day: the newest month for which any series has a figure, for every series that has it. */
export function harvestRows(src: Pick<RateSource, "catalog" | "info">, got: Map<string, RatePoint[]>): HarvestResult {
  const newest = [...got.values()].map((pts) => cleanPoints(pts).pop()?.period).filter((p): p is string => !!p).sort().pop();
  if (!newest) throw new SourceError(`${src.info.name} returned no usable rate`);
  const rows: DailyRow[] = [];
  for (const s of allSeries(src.catalog)) {
    const point = cleanPoints(got.get(seriesKey(s)) ?? []).find((p) => p.period === newest);
    if (point && point.value > 0) rows.push(rateRow(s, point.value));
  }
  return {
    date: monthEnd(newest),
    currency: RATE_CURRENCY,
    unit: RATE_UNIT,
    rows,
    note: `${src.info.name}: average rates on new business for ${monthWords(newest)}, as published. Each row is one published figure, not a count of records (n=5 is a placeholder).`,
  };
}

/** The history loader: one period per whole month, every series that has a figure. */
export function backfillPeriods(src: Pick<RateSource, "catalog" | "info">, got: Map<string, RatePoint[]>): BackfillResult {
  const byMonth = new Map<string, DailyRow[]>();
  for (const s of allSeries(src.catalog)) {
    for (const p of cleanPoints(got.get(seriesKey(s)) ?? [])) {
      if (!(p.value > 0)) continue;
      const list = byMonth.get(p.period) ?? [];
      list.push(rateRow(s, p.value));
      byMonth.set(p.period, list);
    }
  }
  const periods: BackfillPeriod[] = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([period, rows]) => ({ period, rows }));
  return { currency: RATE_CURRENCY, unit: RATE_UNIT, periods, note: `${src.info.name}: monthly average rates on new business, as published.` };
}

/** A published figure as a library row: the figure in every column, n = 5 as a placeholder (nominalCounts). */
export function rateRow(s: Pick<RateSeries, "area" | "item">, value: number): DailyRow {
  return { area: s.area, item: s.item, n: 5, median: value, low: value, high: value, min: value, max: value };
}

/** Where a request lives in the library (area + item), without asking the publisher. Null when the request names nothing we hold. */
export function rateHistoryKey(catalog: Catalog, sourceName: string, p: Record<string, unknown>): { area: string; item: string; label: string } | null {
  try {
    const s = pickSeries(catalog, parseRateRequest({ product: p.product, term: p.term, country: p.country }), sourceName);
    return { area: s.area, item: s.item, label: `${s.areaName}, ${s.productLabel}` };
  } catch {
    return null;
  }
}

/** The collector for a source: the newest published months, stored as one dated day. */
export async function harvestSource(src: RateSource, today = new Date()): Promise<HarvestResult> {
  const month = today.toISOString().slice(0, 7);
  return harvestRows(src, await src.fetchAll(addMonths(month, -3), month));
}

/** The history loader for a source: every whole month between two dates. */
export async function backfillSource(src: RateSource, from: string, to: string): Promise<BackfillResult> {
  return backfillPeriods(src, await src.fetchAll(from.slice(0, 7), to.slice(0, 7)));
}

/** Months from the first of the month `fromDate` falls in to the month `toDate` falls in, as YYYY-MM strings. */
export function monthRange(from: string, to: string): { from: string; to: string } {
  return { from: from.slice(0, 7), to: to.slice(0, 7) };
}

// ---------- text fetching ----------

export type TextFetcher = (url: string) => Promise<string>;

export async function fetchText(url: string, timeoutMs = 20000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "user-agent": "pricepaid-plug/0.1 (+price-paid data for AI agents)", accept: "text/csv,application/json;q=0.9,*/*;q=0.5" } });
    if (!res.ok) throw new SourceError(`Source returned HTTP ${res.status}`, "", res.status);
    return await res.text();
  } catch (err: any) {
    if (err?.name === "AbortError") throw new SourceError("Source timed out", url);
    if (err instanceof SourceError) throw err;
    throw new SourceError("Could not reach the official source", String(err?.cause?.code ?? err?.message ?? err));
  } finally {
    clearTimeout(timer);
  }
}

/** Split one CSV line (quotes and doubled quotes handled). */
export function csvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      out.push(field);
      field = "";
    } else field += c;
  }
  out.push(field);
  return out;
}
