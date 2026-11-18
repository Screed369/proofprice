// The pay-first door: GET /api/v1/paid/<category>. One call returns { answer, trend, check, notice }:
//   answer  the normal price answer of the category, unchanged (runCategory; lib/answer.ts is not touched)
//   trend   the daily history from our library for the same area and item (runHistory), or null when the source keeps none
//   check   the price check (runCheck) when `price` was given, or null
// Nothing here is new logic: it only calls the functions the free routes already use. The plain look-up at /api/v1/<category> is a
// different route and stays free; this file never changes it. Who pays and when is decided by lib/payments (key "lookup").
import { InputError } from "./http";
import { assertKnownParams, CATEGORIES, categoryByRestPath, exampleUrls, paramsFromQuery, paramSchemas, runCategory, runHistory } from "./registry";
import { CHECK_RESERVED, runCheck, type CheckResult } from "./check";
import type { HandleContext } from "./plugin";
import type { CategoryPlugin } from "./plugin";
import type { HistoryAnswer } from "./registry";
import type { PriceAnswer } from "./answer";
import { CLEARED_FOR_PAID } from "./payments/cleared";

export const PAID_REST_PREFIX = "/api/v1/paid/";

export interface LookupBundle {
  answer: PriceAnswer;
  trend: HistoryAnswer | null;
  check: CheckResult | null;
  notice: string;
}

/** The longest description Coinbase's Bazaar accepts (the CDP facilitator rejects a longer one on verify and settle). */
export const DESCRIPTION_MAX = 500;

export function lookupNotice(cat: CategoryPlugin): string {
  return (
    `Information, not a valuation, offer or advice. This paid look-up adds a daily trend and an optional price check to the normal answer. ` +
    `The basic look-up without trend is free at /api/v1/${cat.restPath}.`
  );
}

/** Words the paid door takes beside the category's own parameters: `days` (length of the trend) and the check's own words. */
export const LOOKUP_RESERVED = [...CHECK_RESERVED, "days"];

/** The category id and its REST path from a paid-door URL, or null. */
export function lookupCategoryPath(url: string): string | null {
  try {
    const p = new URL(url).pathname;
    return p.startsWith(PAID_REST_PREFIX) ? decodeURIComponent(p.slice(PAID_REST_PREFIX.length)).replace(/\/+$/, "") || null : null;
  } catch {
    return null;
  }
}

/** Build the bundle. Errors (bad parameters, unknown place) are thrown exactly as the free routes throw them. */
export async function buildLookup(
  cat: CategoryPlugin,
  q: URLSearchParams,
  ctx: HandleContext = {},
  today = new Date(),
  /** Tests pass stand-ins so nothing reaches an official source. The live route passes nothing. */
  deps: { runCategory?: typeof runCategory; runHistory?: typeof runHistory } = {},
): Promise<LookupBundle> {
  const ask = deps.runCategory ?? runCategory;
  const askHistory = deps.runHistory ?? runHistory;
  const rest = new URLSearchParams();
  for (const [k, v] of q.entries()) if (!LOOKUP_RESERVED.includes(k)) rest.append(k, v);
  const params = paramsFromQuery(cat, rest);
  assertKnownParams(cat, params);
  const answer = await ask(cat, params, ctx);

  let trend: HistoryAnswer | null = null;
  if (cat.history) {
    try {
      const days = q.get("days");
      trend = askHistory(cat, days ? { ...params, days: Number(days) } : params, ctx, today);
    } catch (e) {
      // This source keeps no history, or not for this place: the trend is simply absent. A real fault still shows in the answer.
      if (!(e instanceof InputError)) throw e;
    }
  }

  let check: CheckResult | null = null;
  if (q.get("price") !== null && q.get("price") !== "") {
    const args: Record<string, unknown> = { ...params, category: cat.id };
    for (const k of CHECK_RESERVED) {
      const v = q.get(k);
      if (v !== null && v !== "" && k !== "category") args[k] = v;
    }
    // The answer is already in hand: the check judges that same answer instead of asking the official source twice.
    check = await runCheck(args, { categories: CATEGORIES, runCategory: async () => answer }, ctx, today);
  }
  return { answer, trend, check, notice: lookupNotice(cat) };
}

// ---------- what the 402 tells a directory (Bazaar) ----------

/** What the paid door returns, in plain words, for the directory listing. At most DESCRIPTION_MAX characters. */
export function lookupDescription(cat: CategoryPlugin): string {
  const what = cat.noun.toLowerCase();
  const text =
    `Paid look-up of ${what} from official records: the normal answer (median, 10th to 90th percentile, sample size, period, source, licence) ` +
    `plus the daily trend from our library and, if you send a price, a check of that price. Returns { answer, trend, check, notice }. ` +
    `Not charged for errors or too few records. The basic look-up without trend stays free at /api/v1/${cat.restPath}.`;
  return text.length <= DESCRIPTION_MAX ? text : text.slice(0, DESCRIPTION_MAX - 1) + "…";
}

type JsonProp = { type: string; description?: string; enum?: string[] };

function jsonProp(schema: any, desc: string): JsonProp {
  let inner = schema;
  while (inner?.unwrap && inner.constructor?.name === "ZodOptional") inner = inner.unwrap();
  const name: string = inner?.constructor?.name ?? "";
  const type = name === "ZodNumber" ? "number" : "string";
  const options: string[] | undefined = name === "ZodEnum" ? [...(inner.options as string[])] : undefined;
  return { type, ...(desc ? { description: desc.slice(0, 200) } : {}), ...(options && options.length <= 30 ? { enum: options } : {}) };
}

/** JSON Schema for the paid door's query: country, the category's own parameters, price and the rest. Complete, so an agent can build a call. */
export function lookupQuerySchema(cat: CategoryPlugin) {
  const properties: Record<string, JsonProp> = { country: { type: "string", description: "ISO country code, e.g. IT (see /api/v1/coverage)." } };
  const required: string[] = ["country"];
  for (const [name, schema] of Object.entries(paramSchemas(cat))) {
    const desc = (schema as any).description ?? "";
    properties[name] = jsonProp(schema, desc);
    if (cat.required?.includes(name)) required.push(name);
  }
  properties.price = { type: "number", description: "Optional. A price to check against the evidence; adds the check result." };
  properties.currency = { type: "string", description: "Optional currency code for the price." };
  properties.unit = { type: "string", description: "Optional unit of the price, e.g. per litre." };
  properties.days = { type: "number", description: "Optional length of the trend in days (2 to 366, default 30)." };
  return { type: "object", properties, required };
}

/** The first registry example of a category whose source is cleared for paid use (so the call really answers 402), or null. */
export function clearedExample(categoryId: string, need: "answer" | "history" = "answer"): { source: string; query: Record<string, string> } | null {
  const cat = CATEGORIES.find((c) => c.id === categoryId);
  if (!cat) return null;
  for (const e of exampleUrls()) {
    if (e.category !== categoryId || !CLEARED_FOR_PAID.has(e.source)) continue;
    if (need === "history" && !cat.history) continue;
    return { source: e.source, query: Object.fromEntries(new URLSearchParams(e.path.split("?")[1] ?? "")) };
  }
  return null;
}

/** The example call for the paid door of one category. An illustrative price is added so the example shows the check. */
export function lookupExample(restPath: string): { source: string; query: Record<string, string> } | null {
  const cat = categoryByRestPath(restPath);
  if (!cat) return null;
  const ex = clearedExample(cat.id);
  return ex ? { source: ex.source, query: { ...ex.query, ...(ILLUSTRATIVE_PRICE[cat.id] ? { price: ILLUSTRATIVE_PRICE[cat.id] } : {}) } } : null;
}

/** Made-up prices in the right order of magnitude, only to make an example call complete. Never shown as a figure from the data. */
export const ILLUSTRATIVE_PRICE: Record<string, string> = { rent: "1500", fuel: "1.8", "home-sales": "350000" };
