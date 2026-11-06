// FEWS NET Data Warehouse, market prices: monthly prices of staple foods in markets of about 30 food-insecure countries
// (Kenya, Guatemala, Honduras, El Salvador, Angola, Madagascar, Colombia and others), collected from national statistics offices,
// ministries and WFP. The API holds millions of rows, so we never mirror it: each question asks for one country and one food over the
// last five months, keeps every market's newest price and reports the spread across markets. Posted market prices, not receipts.
// Free tier only: FEWS NET names no open licence, so the code never charges for this source.

import { InputError, SourceError, fetchJson } from "../../lib/http";
import { summarise } from "../../lib/stats";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import type { SourceInfo } from "../../lib/plugin";

export const INFO: SourceInfo = {
  id: "un-fews-market-prices",
  country: "About 12 countries (Africa, Central America, Colombia; see countries)",
  category: "groceries (market prices of staple foods)",
  name: "FEWS NET Data Warehouse: market prices",
  publisher: "Famine Early Warning Systems Network (FEWS NET)",
  what_is_recorded:
    "The monthly price of one staple food (maize, rice, beans, wheat flour, sugar, oil, vegetables, meat and more) in one market, as reported to FEWS NET by national statistics offices, ministries and WFP, in local currency and converted to US dollars per kilogram.",
  price_type: "posted_price",
  freshness: "Monthly; the newest month for a country is usually 1 to 3 months old and the answer says which month",
  licence: "FEWS NET data use and attribution policy (no open licence is named; each row is marked public; source organisations' own terms apply)",
  licence_url: "https://help.fews.net/fdp/data-and-information-use-and-attribution-policy",
  attribution:
    "Famine Early Warning Systems Network (FEWS NET) Data Warehouse, fdw.fews.net, with the underlying source organisations named in the answer. " +
    "Changed by ProofPrice: we take each market's newest price and report the median and 10th to 90th percentile across markets. FEWS NET does not endorse this use.",
  homepage: "https://fews.net/data",
  limits:
    "Prices recorded in markets, retail unless 'wholesale' is asked for, not receipts and not what one buyer paid. Figures are US dollars per kilogram at the conversion FEWS NET publishes. " +
    "A range needs the newest price from 5 or more markets inside two months of the country's latest month; markets are not weighted by population. " +
    "Rows without a value (status 'Not Collected') are ignored. Free tier only: no open licence is named, so this source is never charged for.",
};

/** Countries with usable recent data on 6 Nov 2026 and no other grocery source. Others answer 'no matches' only if added; keep this list honest. */
export const COUNTRIES: Record<string, string> = {
  AO: "Angola", BW: "Botswana", CO: "Colombia", GT: "Guatemala", HN: "Honduras", KE: "Kenya", MG: "Madagascar", NA: "Namibia",
  NI: "Nicaragua", SV: "El Salvador", SZ: "Eswatini", TJ: "Tajikistan", ZM: "Zambia",
};
export const LISTED: string[] = Object.keys(COUNTRIES);

export const API = "https://fdw.fews.net/api/marketpricefacts/";
export const WINDOW_DAYS = 62; // a market counts when its newest price is within this many days of the country's newest month
export const LOOKBACK_DAYS = 150; // we ask the API for this many days of history
export const PAGE_SIZE = 500; // the API refuses larger pages (403)
export const MAX_PAGES = 3;
const UA = { "user-agent": "ProofPrice/1.0 (+https://proofprice.com; hello@proofprice.com)", accept: "application/json" };

export interface FewsRow {
  country_code: string;
  country: string;
  fnid: string;
  market: string;
  product: string;
  source_organization: string | null;
  period_date: string;
  price_type: string;
  unit: string;
  currency: string;
  status: string;
  value: number | null;
  common_unit: string | null;
  common_currency: string | null;
  common_currency_price: number | null;
}

/** The rows of one API page, or a plain error when the answer is not the JSON page we expect (for example a bot challenge with an empty body). */
export function parsePage(json: unknown): { count: number; next: string | null; rows: FewsRow[] } {
  const j = json as { count?: unknown; next?: unknown; results?: unknown };
  if (!j || typeof j !== "object" || !Array.isArray(j.results) || typeof j.count !== "number") {
    throw new SourceError("FEWS NET answered in a layout we do not know (no results list)");
  }
  return { count: j.count, next: typeof j.next === "string" ? j.next : null, rows: j.results as FewsRow[] };
}

/** Rows that carry a real price: collected or aggregated, with a positive value in US dollars per kilogram (or the unit named). */
export function usable(rows: FewsRow[]): FewsRow[] {
  return rows.filter(
    (r) =>
      r && r.fnid && r.period_date && (r.status === "Collected" || r.status === "Aggregated") &&
      typeof r.value === "number" && typeof r.common_currency_price === "number" && r.common_currency_price > 0 &&
      r.common_currency === "USD" && !!r.common_unit,
  );
}

const STOP = new Set(["price", "prices", "of", "the", "a", "cost", "retail", "wholesale", "per", "kg", "in", "average"]);
/** The word FEWS NET's product filter should contain (it matches part of the product name). Longest useful words kept; plural 's' dropped. */
export function searchTerm(item: string): string {
  const words = item.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w && !STOP.has(w));
  const synonyms: Record<string, string> = { corn: "maize", potatoes: "potato", tomatoes: "tomato", onions: "onion", bananas: "banana", eggs: "egg", chicken: "chicken", bread: "bread" };
  const w = words.map((x) => synonyms[x] ?? (x.length > 3 && x.endsWith("s") && !x.endsWith("ss") ? x.slice(0, -1) : x));
  return w.join(" ");
}
export const wantsWholesale = (item: string): boolean => /\bwholesale\b/i.test(item);

const dayNumber = (iso: string): number => Math.floor(Date.parse(iso + "T00:00:00Z") / 86400000);
const isoOf = (n: number): string => new Date(n * 86400000).toISOString().slice(0, 10);

export interface Group { key: string; product: string; type: string; unit: string; markets: number; values: number[]; newest: string; sources: string[] }

/** One group per product, price type and unit: each market's newest price inside the window, USD per common unit. The group with most markets leads. */
export function groupRows(rows: FewsRow[], wholesale: boolean): Group[] {
  const by = new Map<string, FewsRow[]>();
  for (const r of usable(rows)) {
    const k = `${r.product}|${r.price_type}|${r.common_unit}`;
    (by.get(k) ?? by.set(k, []).get(k)!).push(r);
  }
  const out: Group[] = [];
  for (const [key, list] of by) {
    const newest = list.reduce((a, r) => (r.period_date > a ? r.period_date : a), "");
    const from = dayNumber(newest) - WINDOW_DAYS;
    const per = new Map<string, FewsRow>();
    for (const r of list) {
      if (dayNumber(r.period_date) < from) continue;
      const have = per.get(r.fnid);
      if (!have || r.period_date > have.period_date) per.set(r.fnid, r);
    }
    const picked = [...per.values()];
    const first = list[0];
    out.push({
      key, product: first.product, type: first.price_type, unit: first.common_unit ?? "kg", markets: picked.length,
      values: picked.map((r) => r.common_currency_price as number), newest,
      sources: [...new Set(picked.map((r) => r.source_organization).filter((s): s is string => !!s))].sort(),
    });
  }
  const pref = wholesale ? "wholesale" : "retail";
  return out.sort((a, b) => Number(b.type.toLowerCase() === pref) - Number(a.type.toLowerCase() === pref) || b.markets - a.markets || a.key.localeCompare(b.key));
}

function methodText(): string {
  return (
    "Median and 10th–90th percentile, across markets, of the newest monthly price each market reported to the FEWS NET Data Warehouse, converted to US dollars per kilogram by FEWS NET, " +
    "counting markets whose newest price is within two months of the country's latest month. Posted market prices, not receipts; n is the number of markets."
  );
}

export function answerFromRows(rows: FewsRow[], input: { country: string; item: string; baseUrl?: string }): PriceAnswer {
  const country = input.country.toUpperCase();
  const name = COUNTRIES[country];
  const wholesale = wantsWholesale(input.item);
  const groups = groupRows(rows, wholesale);
  const best = groups[0];
  const empty = (hint: string) =>
    buildAnswer({
      source: INFO, query: { country, item: input.item }, summary: null, currency: "USD", unit: "per kg", period: { from: null, to: null },
      method: methodText(), describe: () => "", baseUrl: input.baseUrl, extra: { hint },
    });
  if (!best) return empty(`FEWS NET has no recent market prices for '${input.item}' in ${name}. Try a staple food such as maize, rice, beans, wheat flour, sugar or cooking oil.`);
  const summary = summarise(best.values);
  const others = groups.slice(1, 9).map((g) => `${g.product}, ${g.type.toLowerCase()}, per ${g.unit} (${g.markets} markets)`);
  const label = `${best.product}, ${best.type.toLowerCase()}, per ${best.unit}`;
  return buildAnswer({
    source: INFO,
    query: { country, item: label },
    summary,
    currency: "USD",
    unit: `per ${best.unit}`,
    period: { from: isoOf(dayNumber(best.newest) - WINDOW_DAYS), to: best.newest },
    method: methodText(),
    describe: (x) =>
      `FEWS NET market prices in ${name} put ${best.product} (${best.type.toLowerCase()}, per ${best.unit}) at a median of ${fmtMoney(x.median, "USD")}; ` +
      `10th–90th percentile ${fmtMoney(x.low, "USD")}–${fmtMoney(x.high, "USD")} across the markets reporting, in US dollars at FEWS NET's conversion. ` +
      `These are posted market prices, not receipts, and the newest month for this food is ${best.newest.slice(0, 7)}.`,
    baseUrl: input.baseUrl,
    extra: {
      markets: best.markets,
      latest_month: best.newest.slice(0, 7),
      source_organizations: best.sources,
      currency_note: "US dollars at the conversion FEWS NET publishes, not local currency.",
      ...(others.length ? { other_definitions: others } : {}),
    },
  });
}

export function pageUrl(country: string, term: string, today: string, offset = 0): string {
  const from = isoOf(dayNumber(today) - LOOKBACK_DAYS);
  const q = new URLSearchParams({ format: "json", country_code: country, product: term, start_date: from, page_size: String(PAGE_SIZE) });
  if (offset) q.set("offset", String(offset));
  return `${API}?${q.toString()}`;
}

export async function fewsMarketPrices(input: { country: string; item?: string; region?: string; baseUrl?: string; today?: string; fetchPage?: (url: string) => Promise<unknown> }): Promise<PriceAnswer> {
  const country = (input.country ?? "").toUpperCase();
  if (!COUNTRIES[country]) throw new InputError(`country must be one of: ${LISTED.map((c) => `${c} = ${COUNTRIES[c]}`).join(", ")}`);
  const item = (input.item ?? "").trim();
  if (!item) throw new InputError("item is required: a staple food in plain words such as 'maize', 'rice', 'beans', 'wheat flour', 'sugar' or 'cooking oil'.");
  if (input.region) throw new InputError("region must be left out: FEWS NET figures are a spread across the country's markets.");
  const term = searchTerm(item);
  if (!term) throw new InputError("item is required: a staple food in plain words such as 'maize', 'rice', 'beans' or 'sugar'.");
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  const get = input.fetchPage ?? ((url: string) => fetchJson(url, { headers: UA }, 12000));
  const all: FewsRow[] = [];
  let offset = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const p = parsePage(await get(pageUrl(country, term, today, offset)));
    all.push(...p.rows);
    if (!p.next || !p.rows.length) break;
    offset += p.rows.length;
  }
  return answerFromRows(all, { country, item, baseUrl: input.baseUrl });
}
