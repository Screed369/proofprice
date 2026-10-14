// The price referee: "is this price typical?" An AI buyer proposes a price, ProofPrice runs the category's normal answer
// (same code path, cache and stale-if-error as the category tool) and compares the price with that evidence.
// Deterministic code only. No benchmark is ever invented, currencies are never converted, and a comparison that cannot be made
// honestly (different currency or unit, too few records, nothing matched) is "cannot_judge" with the reason said plainly.

import { z } from "zod";
import { NOTICE, fmtMoney } from "./answer";
import type { PriceAnswer } from "./answer";
import { normaliseCountry } from "./countries";
import { InputError } from "./http";
import type { CategoryPlugin, HandleContext, Params } from "./plugin";
import { exampleUrls, pickSource, toolShape, paramSchemas } from "./registry";
import { joinAnd } from "./text";

export type Verdict =
  | "within_typical_range"
  | "above_typical_range"
  | "below_typical_range"
  | "about_average"
  | "above_average"
  | "below_average"
  | "cannot_judge";

export interface CheckPosition {
  basis: "range" | "average";
  text: string;
  vs_median_percent: number | null;
  vs_typical_low_percent?: number | null;
  vs_typical_high_percent?: number | null;
  reference_value: number;
  typical_low?: number | null;
  typical_high?: number | null;
}

export interface CheckResult {
  verdict: Verdict;
  summary: string;
  position: CheckPosition | null;
  reasons: string[];
  missing: string[];
  input: { category: string; country: string; price: number; currency: string | null; unit: string | null; includes: string | null };
  answer: PriceAnswer;
  notice: string;
}

export const CHECK_TOOL = "pricepaid_check_price";
export const CHECK_REST = "/api/v1/check";
export const CHECK_NOTICE =
  "Information, not a valuation, offer or advice. A verdict only compares a price with past recorded evidence; it does not say whether the price is fair for one particular item.";

/** The within-average band: a price within this share of an official average or median counts as "about average". */
export const ABOUT_AVERAGE_PERCENT = 5;
/** Posted prices older than this many days, and every other kind older than OLD_DAYS, are flagged as an old period. */
export const OLD_POSTED_DAYS = 30;
export const OLD_DAYS = 366;

/** Words that are not parameters of the category: they belong to the check itself. */
export const CHECK_RESERVED = ["category", "price", "currency", "unit", "includes"];

// ---------- resolving the category ----------

export function resolveCategory(categories: CategoryPlugin[], raw: unknown): CategoryPlugin {
  const key = String(raw ?? "").trim().toLowerCase().replace(/^\/?(api\/v1\/)?/, "");
  const cat = key ? categories.find((c) => c.id.toLowerCase() === key || c.restPath.toLowerCase() === key || c.tool.toLowerCase() === key) : undefined;
  if (!cat) {
    throw new InputError(
      `category is required: one of ${categories.map((c) => c.id).join(", ")} (the REST path or the tool name also works). See /api/v1/coverage.`,
    );
  }
  return cat;
}

// ---------- small helpers ----------

const CURRENCY_SYMBOLS: Record<string, string> = { "€": "EUR", "£": "GBP", "$": "USD" };

export function normCurrency(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  return CURRENCY_SYMBOLS[s] ?? s.toUpperCase();
}

const UNIT_WORDS: Record<string, string> = {
  monthly: "month", weekly: "week", daily: "day", yearly: "year", annual: "year", annually: "year", pcm: "month", pw: "week", pa: "year",
  liter: "litre", liters: "litre", litres: "litre", l: "litre", sqm: "sqm", m2: "sqm", "m²": "sqm",
};
const UNIT_STOP = new Set(["per", "a", "an", "each", "the", "/"]);

/** A unit as a sorted set of plain words, so "per month", "a month", "/month" and "monthly" are the same unit. */
export function normUnit(raw: string): string {
  const s = raw
    .toLowerCase()
    .replace(/square\s+met(?:re|er)s?/g, "sqm")
    .replace(/sq\.?\s*m\b/g, "sqm")
    .replace(/[(),;]/g, " ")
    .replace(/\//g, " ");
  const words = s
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !UNIT_STOP.has(w))
    .map((w) => UNIT_WORDS[w] ?? w);
  return [...new Set(words)].sort().join(" ");
}

export function sameUnit(a: string, b: string): boolean {
  return normUnit(a) === normUnit(b);
}

function pct(price: number, ref: number): number {
  return ((price - ref) / ref) * 100;
}

/** "27% above", "11% below", "less than 1% above", "at". */
function rel(p: number): string {
  const a = Math.abs(p);
  if (a === 0) return "at";
  const n = Math.round(a);
  const amount = n === 0 ? "less than 1%" : `${n}%`;
  return `${amount} ${p > 0 ? "above" : "below"}`;
}

const r1 = (x: number) => Math.round(x * 10) / 10;

/** End date of a reference period such as "2025-Q4", "2025-S2", "2025-10", "2025" or "2025-10-14". */
export function periodEnd(ref: string | null | undefined): Date | null {
  if (!ref) return null;
  const s = ref.trim();
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{4})[-\s]?Q([1-4])$/i))) return new Date(Date.UTC(+m[1], +m[2] * 3, 0));
  if ((m = s.match(/^(\d{4})[-\s]?S([12])$/i))) return new Date(Date.UTC(+m[1], +m[2] * 6, 0));
  if ((m = s.match(/^(\d{4})-(\d{2})$/))) return new Date(Date.UTC(+m[1], +m[2], 0));
  if ((m = s.match(/^(\d{4})$/))) return new Date(Date.UTC(+m[1], 11, 31));
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const t = Date.parse(s.slice(0, 10));
    return Number.isFinite(t) ? new Date(t) : null;
  }
  return null;
}

const ITEM_KEYS = ["property_type", "house_type", "fuel", "medicine", "product", "energy", "service", "land_type", "consumption_band"];
const PLACE_KEYS = ["town", "postcode_district", "postcode", "area", "region", "county", "department", "state", "province", "city", "commune"];

/** "2-bed apartment in Dublin": the item and the place named in the query, for the one-sentence summary. */
function scopeOf(answer: PriceAnswer, country: string): string {
  const q = answer.query ?? {};
  const val = (k: string) => {
    const v = q[k];
    return v === undefined || v === null || v === "" || v === "any" ? null : String(v);
  };
  const bed = q.bedrooms !== undefined && q.bedrooms !== null && q.bedrooms !== "" ? `${q.bedrooms}-bed` : null;
  const item = [bed, ...ITEM_KEYS.map(val)].filter(Boolean).join(" ");
  const place = PLACE_KEYS.map(val).filter(Boolean).slice(0, 2).join(", ") || country;
  return item ? `${item} in ${place}` : place;
}

function periodText(answer: PriceAnswer): string {
  const ref = answer.statistic?.reference_period;
  if (ref) return ref;
  const { from, to } = answer.period ?? { from: null, to: null };
  if (from && to) return from === to ? from : `${from} to ${to}`;
  return to ?? from ?? "an unstated period";
}

function kindWord(type: string | undefined, plural: boolean): string {
  const base =
    type === "transaction" ? "recorded sale" : type === "posted_pump_price" || type === "posted_price" ? "posted price" : type === "contract_price" ? "contract value" : type === "reimbursement_price" ? "reimbursement price" : "record";
  return plural ? `${base}s` : base;
}

function evidenceNote(type: string | undefined): string {
  switch (type) {
    case "transaction":
      return "The evidence is prices actually paid in recorded sales, not asking prices.";
    case "posted_pump_price":
    case "posted_price":
      return "The evidence is posted prices (what sellers display), not receipts of what customers paid, so this compares your price with what is displayed.";
    case "official_statistic":
      return "The evidence is one official average or median, not a distribution of individual prices: individual prices vary around it, so being above or below it does not by itself show a price is high or low for a particular item.";
    case "contract_price":
      return "The evidence is contract award values from public procurement: what buyers agreed to pay for those contracts, not a price list.";
    case "reimbursement_price":
      return "The evidence is a regulated reimbursement price: what a health scheme pays, not necessarily what a consumer pays in a shop.";
    default:
      return "";
  }
}

// ---------- the judgement (pure) ----------

export interface JudgeInput {
  category: string;
  country: string;
  price: number;
  currency?: string | null;
  unit?: string | null;
  includes?: string | null;
}

function cannot(answer: PriceAnswer, input: JudgeInput, summary: string, reasons: string[], missing: string[]): CheckResult {
  return {
    verdict: "cannot_judge",
    summary,
    position: null,
    reasons,
    missing,
    input: echo(input),
    answer,
    notice: CHECK_NOTICE,
  };
}

function echo(input: JudgeInput): CheckResult["input"] {
  return {
    category: input.category,
    country: input.country,
    price: input.price,
    currency: input.currency ?? null,
    unit: input.unit ?? null,
    includes: input.includes ?? null,
  };
}

/** Compare a price with an evidence answer. Pure: same inputs, same output (today only matters for the old-period flag). */
export function judge(answer: PriceAnswer, input: JudgeInput, today: Date = new Date()): CheckResult {
  const reasons: string[] = [];
  const missing: string[] = [];
  const type = answer.price_type;
  const inCurrency = normCurrency(input.currency);
  const inUnit = input.unit && input.unit.trim() ? input.unit.trim() : null;
  const clean: JudgeInput = { ...input, currency: inCurrency, unit: inUnit, includes: input.includes?.trim() || null };

  // 1. no usable evidence
  if (answer.status !== "ok" || !answer.price) {
    const n = answer.sample_size ?? 0;
    if (answer.status === "insufficient_data") {
      const why = `Only ${n} matching record${n === 1 ? "" : "s"} in ${answer.source.name}; ProofPrice publishes no range from fewer than 5 records.`;
      return cannot(answer, clean, `Cannot judge ${fmtMoney(input.price, inCurrency ?? "EUR")}: ${why}`, [why], ["Enough matching records (at least 5). Try a wider place, type or period."]);
    }
    const why = `No matching records were found in ${answer.source.name} (${answer.source.publisher}) for this request.`;
    return cannot(answer, clean, `Cannot judge ${input.price}: ${why}`, [why], ["Any matching records. Check the place and other parameters, or call pricepaid_coverage."]);
  }

  const p = answer.price;
  const money = (v: number) => fmtMoney(v, p.currency);

  // 2. currency: never convert silently
  if (inCurrency && inCurrency !== p.currency) {
    const why = `The price is in ${inCurrency} but the evidence is in ${p.currency}. ProofPrice never converts currencies silently.`;
    return cannot(
      answer,
      clean,
      `Cannot judge a price in ${inCurrency}: the evidence is in ${p.currency} (${money(p.value)} ${p.unit}) and ProofPrice does not convert currencies.`,
      [why, ...(input.currency && /^[$€£]$/.test(String(input.currency).trim()) ? ["A currency symbol was read as " + inCurrency + "; use the three-letter ISO code (for example AUD) when it is ambiguous."] : [])],
      [`The price in ${p.currency}, or the same price stated in ${p.currency}.`],
    );
  }
  if (!inCurrency) reasons.push(`No currency was given, so the price is taken to be in ${p.currency}, the evidence currency.`);

  // 3. unit
  if (inUnit && p.unit && !sameUnit(inUnit, p.unit)) {
    const why = `The price is stated "${inUnit}" but the evidence is ${p.unit}.`;
    return cannot(
      answer,
      clean,
      `Cannot judge a price stated "${inUnit}": the evidence is ${p.unit} (${money(p.value)}).`,
      [why, "ProofPrice does not convert between units."],
      [`The price stated ${p.unit}.`],
    );
  }
  if (!inUnit) reasons.push(`No unit was given, so the price is taken to be ${p.unit}, the evidence unit.`);

  // 4. position
  const priceText = `${money(input.price)} ${p.unit}`;
  const hasRange = p.typical_low !== null && p.typical_low !== undefined && p.typical_high !== null && p.typical_high !== undefined && p.median !== null && p.median !== undefined && type !== "official_statistic";
  let verdict: Verdict;
  let position: CheckPosition;
  let summary: string;
  const n = answer.sample_size;
  const period = periodText(answer);
  const scope = scopeOf(answer, input.country);

  if (hasRange) {
    const low = p.typical_low as number;
    const high = p.typical_high as number;
    const median = p.median as number;
    const vsMed = pct(input.price, median);
    const vsLow = pct(input.price, low);
    const vsHigh = pct(input.price, high);
    verdict = input.price > high ? "above_typical_range" : input.price < low ? "below_typical_range" : "within_typical_range";
    const where = verdict === "above_typical_range" ? "and above the 90th percentile" : verdict === "below_typical_range" ? "and below the 10th percentile" : "and within the typical range (10th to 90th percentile)";
    const sep = verdict === "within_typical_range" ? ", " : " ";
    const text = vsMed === 0 ? `at the median ${where}` : `${rel(vsMed)} the median${sep}${where}`;
    position = {
      basis: "range",
      text,
      vs_median_percent: r1(vsMed),
      vs_typical_low_percent: r1(vsLow),
      vs_typical_high_percent: r1(vsHigh),
      reference_value: median,
      typical_low: low,
      typical_high: high,
    };
    summary =
      `${priceText} is ${text}: for ${scope} the median is ${money(median)} and the typical range ${money(low)} to ${money(high)}, ` +
      `based on ${n ?? "several"} ${kindWord(type, true)} from ${answer.source.publisher} (${period}).`;
  } else {
    const ref = p.value;
    const measure = answer.statistic?.measure ?? p.measure ?? "average";
    const d = pct(input.price, ref);
    verdict = Math.abs(d) <= ABOUT_AVERAGE_PERCENT ? "about_average" : d > 0 ? "above_average" : "below_average";
    const near = verdict === "about_average";
    const refPhrase = `the official ${measure} of ${money(ref)} ${p.unit}`;
    const text = near
      ? `within ${ABOUT_AVERAGE_PERCENT}% of the official ${measure} (${d === 0 ? "equal to it" : rel(d) + " it"})`
      : `${rel(d)} the official ${measure}`;
    position = { basis: "average", text, vs_median_percent: r1(d), reference_value: ref };
    summary =
      `${priceText} is ${near ? `within ${ABOUT_AVERAGE_PERCENT}% of ${refPhrase} (${d === 0 ? "equal to it" : rel(d) + " it"})` : `${rel(d)} ${refPhrase}`} ` +
      `for ${scope} in ${period} (an official ${measure}, not a range).`;
    reasons.push(
      `This compares the price with one published ${measure}, not with a distribution of individual prices. Within ${ABOUT_AVERAGE_PERCENT}% of it counts as "about_average".`,
    );
  }

  // 5. cautions that do not stop the comparison
  const note = evidenceNote(type);
  if (note) reasons.push(note);
  if (answer.extra?.stale === true) {
    reasons.push(`The official source did not respond, so the evidence is ProofPrice's own copy from ${String(answer.extra.snapshot_date ?? answer.as_of)}.`);
  }
  const end = periodEnd(answer.statistic?.reference_period) ?? periodEnd(answer.period?.to) ?? null;
  if (end) {
    const days = Math.round((today.getTime() - end.getTime()) / 86400000);
    const limit = type === "posted_pump_price" || type === "posted_price" ? OLD_POSTED_DAYS : OLD_DAYS;
    if (days > limit) {
      const months = Math.round(days / 30.4);
      reasons.push(`Old period: the evidence ends ${end.toISOString().slice(0, 10)}, about ${months} months ago, so prices may have moved since.`);
    }
  }
  if (clean.includes) {
    reasons.push(
      `You said the price ${clean.includes}. ProofPrice cannot adjust for taxes, fees or delivery: check in the answer's method that the evidence covers the same things before relying on the comparison.`,
    );
  }
  if (answer.confidence === "low") reasons.push("Confidence is low: only a few records (5 to 14) stand behind the evidence.");

  return { verdict, summary, position, reasons, missing, input: echo(clean), answer, notice: CHECK_NOTICE };
}

// ---------- running a check ----------

export interface CheckDeps {
  categories: CategoryPlugin[];
  runCategory: (cat: CategoryPlugin, params: Params, ctx?: HandleContext) => Promise<PriceAnswer>;
}

/** Split the raw arguments into the check's own fields and the category's parameters. */
export function splitCheckArgs(raw: Record<string, unknown>): { fixed: Record<string, unknown>; params: Params } {
  const fixed: Record<string, unknown> = {};
  const params: Params = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v === undefined || v === null || v === "") continue;
    if (CHECK_RESERVED.includes(k)) fixed[k] = v;
    else params[k] = v;
  }
  return { fixed, params };
}

export async function runCheck(raw: Record<string, unknown>, deps: CheckDeps, ctx: HandleContext = {}, today: Date = new Date()): Promise<CheckResult> {
  const { fixed, params } = splitCheckArgs(raw);
  const cat = resolveCategory(deps.categories, fixed.category);
  const price = typeof fixed.price === "number" ? fixed.price : Number(String(fixed.price ?? "").replace(/,/g, ""));
  if (fixed.price === undefined || !Number.isFinite(price) || price <= 0) {
    throw new InputError("price is required: the price to check, as a number above zero (for example 2400).");
  }
  const country = normaliseCountry(params.country);
  if (!country) throw new InputError("country is required: the ISO country code of the place, for example IE.");
  // the category's own validation: the same names and checks as its tool
  const { prepared } = pickSource(cat, { ...params, country });
  const parsed = z.object(toolShape(cat)).safeParse(prepared);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".") || "request"}: ${i.message}`).join("; ");
    throw new InputError(`Invalid parameters for ${cat.id}: ${msg}`);
  }
  const answer = await deps.runCategory(cat, { ...params, country }, ctx);
  return judge(
    answer,
    {
      category: cat.id,
      country,
      price,
      currency: fixed.currency !== undefined ? String(fixed.currency) : null,
      unit: fixed.unit !== undefined ? String(fixed.unit) : null,
      includes: fixed.includes !== undefined ? String(fixed.includes) : null,
    },
    today,
  );
}

/** A working example of GET /api/v1/check, built from the registry's first example (with a made-up price in the right order of magnitude). */
export function checkExamplePath(): string {
  const ex = exampleUrls().find((e) => e.category === "rent") ?? exampleUrls().find((e) => e.category === "fuel") ?? exampleUrls()[0];
  const illustrative: Record<string, number> = { rent: 1500, fuel: 1.8, "home-sales": 350000 };
  if (!ex) return `${CHECK_REST}?category=rent&country=IE&town=Dublin&price=2400`;
  return `${CHECK_REST}?category=${ex.category}&${new URLSearchParams(ex.path.split("?")[1] ?? "")}&price=${illustrative[ex.category] ?? 100}`;
}

// ---------- the MCP input shape ----------

/** One tool covers every category, so its input is the union of the categories' parameters (all optional here; the category's own
 *  validation runs inside runCheck). Descriptions say which category each parameter belongs to. Built from the registry. */
export function checkToolShape(categories: CategoryPlugin[]): Record<string, z.ZodTypeAny> {
  const byName = new Map<string, string[]>();
  for (const cat of categories) {
    for (const [name, schema] of Object.entries(paramSchemas(cat))) {
      const d = (schema.description ?? "").replace(/\s+/g, " ").slice(0, 200);
      byName.set(name, [...(byName.get(name) ?? []), `${cat.id}: ${d}`]);
    }
  }
  const shape: Record<string, z.ZodTypeAny> = {
    category: z.string().describe(`Which kind of price: ${joinAnd(categories.map((c) => c.id))} (the REST path or the tool name also works).`),
    country: z.string().describe("ISO country code of the place (for example IE, GB, FR). Which countries a category covers: see pricepaid_coverage."),
    price: z.number().positive().describe("The price to check, as a number above zero (for example 2400 or 1.95), in the unit and currency below."),
    currency: z.string().optional().describe("ISO 4217 currency code of the price (for example EUR). Defaults to the evidence currency. A different currency gives cannot_judge: ProofPrice never converts."),
    unit: z.string().optional().describe("What the price is per, for example 'per month', 'per litre', 'per home'. Defaults to the evidence unit. A different unit gives cannot_judge."),
    includes: z.string().optional().describe("What the price includes or excludes, as free text (for example 'VAT included, delivery excluded'). Echoed back as a caution; it is not used to adjust the figure."),
  };
  for (const [name, notes] of byName) {
    if (name in shape || name === "country") continue;
    shape[name] = z.union([z.string(), z.number()]).optional().describe(`Parameter of the category (same name and meaning as in its own tool). ${notes.join(" | ")}`);
  }
  return shape;
}

export function checkToolDescription(categories: CategoryPlugin[]): string {
  return (
    "Use this before paying: when a user or agent has a proposed price for something (a rent, a home, a litre of fuel, a medicine, a contract) and wants to know whether it is typical against recorded official evidence. " +
    `Give the category (${joinAnd(categories.map((c) => c.id))}), the country, the same parameters that category's own tool takes, and the price. ` +
    "It runs the category's normal answer and returns a verdict: within, above or below the typical range (10th–90th percentile of recorded prices) when the evidence is a set of records; " +
    "about, above or below the average when the evidence is one official average or median (within 5% counts as about average, and it says plainly this is an average, not a distribution); or cannot_judge, with the reason, " +
    "when the currency or unit differs (ProofPrice never converts), there are too few records or nothing matched. " +
    "It also returns where the price sits (for example '27% above the median and above the 90th percentile'), the reasons and cautions (posted prices are not paid prices, old periods), what is missing, one quotable sentence, and the full evidence answer with source, licence and audit-trail fields to keep with the reasoning. " +
    "Do not use it to value one specific item or address, as financial or legal advice, or to compare prices in different currencies or units."
  );
}
