// Consumer price inflation (HICP) for the EU, Norway and Iceland, from Eurostat dataset prc_hicp_minr (monthly index, 2025 = 100,
// ECOICOP version 2). Format checked live on 2026-10-30 through the GitHub probe (see ie-multi.json).
// Served as measure=inflation of the price-levels tool. One request per answer, no bulk download (JSON-stat adapter).
//
// What Eurostat publishes: for each country, month and spending division, a price INDEX (2025 = 100) plus the monthly and the annual
// rate of change. It is an index of how consumer prices moved, not a price in money and not a record of what anyone paid, so
// the answer is an official statistic: value = the index, range fields null, sample_size null.

import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { InputError } from "../../lib/http";
import { eurostatUrl, fetchEurostat, JsonStatRow, JsonStatTable, periodRange, toEurostatGeo } from "../../lib/adapters";
import type { FetchOptions } from "../../lib/adapters";
import type { SourceInfo } from "../../lib/plugin";

export const DATASET = "prc_hicp_minr";

export const INFO: SourceInfo = {
  id: "eu-eurostat-hicp",
  country: "EU27 + NO + IS",
  category: "price-levels (consumer price inflation, HICP)",
  name: "Harmonised index of consumer prices (HICP), monthly data, ECOICOP version 2 (prc_hicp_minr)",
  publisher: "Eurostat (European Commission)",
  what_is_recorded:
    "For each country, month and spending division (food, housing, transport and more): the harmonised index of consumer prices (2025 = 100), " +
    "the change on the previous month and the change on the same month a year earlier (annual inflation). Compiled by the national statistics offices from shop and service price surveys.",
  price_type: "official_statistic",
  freshness: "Monthly, released about the middle of the following month; each answer states its month, and the newest month Eurostat holds for the country is returned",
  licence: "Eurostat authorises reuse for commercial and non-commercial purposes provided the source is acknowledged (Commission Decision 2011/833/EU)",
  licence_url: "https://ec.europa.eu/eurostat/help/copyright-notice",
  attribution:
    "Source: Eurostat, dataset prc_hicp_minr (HICP, monthly data, https://doi.org/10.2908/PRC_HICP_MINR), reused under the Eurostat copyright notice. " +
    "Index values and rates of change are passed on as published; Eurostat has no responsibility for how ProofPrice presents them.",
  homepage: "https://ec.europa.eu/eurostat/databrowser/view/prc_hicp_minr/default/table?lang=en",
  limits:
    "A price INDEX (how prices moved), not a price in money, not a receipt and not a range: there is no count of prices behind a figure. " +
    "It says how fast consumer prices change, not what a product costs. National coverage only (no city or region). Some recent figures are provisional.",
};

/** ISO 3166 alpha-2 -> name, for every country this source answers for (EU27 + Norway + Iceland; all qualify for commercial reuse). */
export const COUNTRIES: Record<string, string> = {
  AT: "Austria", BE: "Belgium", BG: "Bulgaria", HR: "Croatia", CY: "Cyprus", CZ: "Czechia", DK: "Denmark", EE: "Estonia",
  FI: "Finland", FR: "France", DE: "Germany", GR: "Greece", HU: "Hungary", IE: "Ireland", IT: "Italy", LV: "Latvia",
  LT: "Lithuania", LU: "Luxembourg", MT: "Malta", NL: "Netherlands", PL: "Poland", PT: "Portugal", RO: "Romania",
  SK: "Slovakia", SI: "Slovenia", ES: "Spain", SE: "Sweden", NO: "Norway", IS: "Iceland",
};

export interface Spend {
  code: string; // Eurostat coicop18 code
  label: string;
  words: string[];
}

/** TOTAL and the 13 ECOICOP-2 divisions. TOTAL, CP01..CP13 were seen in the live dimension lists on 2026-10-30 ("CP00" is silently ignored by Eurostat). */
export const SPENDS: Spend[] = [
  { code: "TOTAL", label: "all items (overall consumer prices)", words: ["total", "all", "all items", "overall", "everything", "general", "headline", "inflation", "cpi", "hicp"] },
  { code: "CP01", label: "food and non-alcoholic beverages", words: ["food", "groceries", "food and drink", "food and non-alcoholic beverages", "cp01"] },
  { code: "CP02", label: "alcoholic beverages, tobacco and narcotics", words: ["alcohol", "tobacco", "alcoholic beverages", "drink", "cp02"] },
  { code: "CP03", label: "clothing and footwear", words: ["clothing", "clothes", "footwear", "shoes", "cp03"] },
  { code: "CP04", label: "housing, water, electricity, gas and other fuels", words: ["housing", "rent", "energy", "electricity", "gas", "utilities", "water", "heating", "cp04"] },
  { code: "CP05", label: "furnishings, household equipment and routine household maintenance", words: ["furnishings", "furniture", "household", "household equipment", "appliances", "cp05"] },
  { code: "CP06", label: "health", words: ["health", "medical", "healthcare", "medicines", "cp06"] },
  { code: "CP07", label: "transport", words: ["transport", "transportation", "fuel", "petrol", "cars", "travel", "cp07"] },
  { code: "CP08", label: "information and communication", words: ["communication", "communications", "information and communication", "phone", "telecom", "internet", "cp08"] },
  { code: "CP09", label: "recreation, sport and culture", words: ["recreation", "leisure", "culture", "sport", "cp09"] },
  { code: "CP10", label: "education services", words: ["education", "schools", "tuition", "cp10"] },
  { code: "CP11", label: "restaurants and accommodation services", words: ["restaurants", "restaurants and hotels", "restaurant", "hotels", "accommodation", "eating out", "cp11"] },
  { code: "CP12", label: "insurance and financial services", words: ["insurance", "financial", "financial services", "cp12"] },
  { code: "CP13", label: "personal care, social protection and miscellaneous goods and services", words: ["personal care", "miscellaneous", "social protection", "cp13"] },
];

export const SPEND_HELP =
  "leave out for overall consumer prices, or 'food', 'alcohol and tobacco', 'clothing', 'housing' (rent, water, energy), 'furnishings', 'health', 'transport', 'communication', 'recreation', 'education', 'restaurants and hotels', 'insurance' or 'personal care'";

export function normaliseSpend(raw?: string): Spend {
  const w = (raw ?? "").trim().toLowerCase().replace(/[\s_-]+/g, " ");
  if (!w) return SPENDS[0];
  const hit = SPENDS.find((s) => s.code.toLowerCase() === w || s.words.includes(w));
  if (!hit) throw new InputError(`spend must be one of: ${SPENDS.map((s) => s.words[0]).join(", ")}. Leave it out for overall consumer prices.`);
  return hit;
}

export interface HicpPoint {
  period: string;
  index: number;
  monthly_rate_percent: number | null;
  annual_rate_percent: number | null;
}

export interface HicpReading {
  country: string;
  countryName: string;
  spend: Spend;
  latest: HicpPoint;
  /** Newest first, up to the window (13 months). */
  history: HicpPoint[];
  datasetLatest: string | null;
  datasetTitle: string | null;
  datasetUpdated: string | null;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * From a parsed prc_hicp_minr slice (one country, one coicop18 code, units I25 / RCH_M / RCH_A) pick the newest month that has an index,
 * and the months before it. Returns null when Eurostat holds no index for the country and division in the window.
 */
export function readHicp(table: JsonStatTable, q: { country: string; spend: Spend }): HicpReading | null {
  const geo = toEurostatGeo(q.country);
  const mine = table.rows.filter((r: JsonStatRow) => r.geo === geo && r.coicop18 === q.spend.code);
  const byTime = new Map<string, HicpPoint>();
  for (const r of mine) {
    if (r.unit === "I25" && num(r.value) !== null && (r.value as number) > 0) {
      const t = String(r.time);
      byTime.set(t, { period: t, index: r.value as number, monthly_rate_percent: null, annual_rate_percent: null });
    }
  }
  if (!byTime.size) return null;
  for (const r of mine) {
    const p = byTime.get(String(r.time));
    if (!p || num(r.value) === null) continue;
    if (r.unit === "RCH_M") p.monthly_rate_percent = r.value as number;
    if (r.unit === "RCH_A") p.annual_rate_percent = r.value as number;
  }
  const history = [...byTime.values()].sort((a, b) => (a.period < b.period ? 1 : -1));
  const times = table.codes.time ?? [];
  return {
    country: q.country,
    countryName: COUNTRIES[q.country] ?? q.country,
    spend: q.spend,
    latest: history[0],
    history,
    datasetLatest: times.length ? times[times.length - 1] : null,
    datasetTitle: table.label,
    datasetUpdated: table.updated,
  };
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2026-09" -> "September 2026". Anything else is returned as given. */
export function monthWords(code: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(code);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : code;
}

const METHOD =
  "Eurostat publishes every month the harmonised index of consumer prices (HICP, dataset prc_hicp_minr, 2025 = 100) for each country and spending division, " +
  "compiled by the national statistics offices, with the change on the previous month and on the same month a year earlier. ProofPrice returns the published index for the " +
  "newest month Eurostat holds for the country, unchanged, with the two rates of change and the months before. It is an index of price change, not a price in money, and no range is calculated.";

function rateWords(pct: number, ref: string): string {
  if (pct === 0) return `unchanged on ${ref}`;
  return `${Math.abs(pct)}% ${pct > 0 ? "higher" : "lower"} than ${ref}`;
}

/** The finished answer for a reading (or for no reading). Pure. */
export function hicpAnswer(reading: HicpReading | null, q: { country: string; spend: Spend; baseUrl?: string; apiUrl?: string }): PriceAnswer {
  const query = { country: q.country, measure: "inflation", spend: q.spend.code };
  const unit = "consumer price index (2025 = 100)";
  const base = { source: INFO, query, measure: "average" as const, currency: "INDEX", unit, method: METHOD, baseUrl: q.baseUrl };
  if (!reading) {
    const none = buildStatisticAnswer({ ...base, value: null, period: { from: null, to: null }, reference_period: "", describe: () => "" });
    const name = COUNTRIES[q.country] ?? q.country;
    return { ...none, summary: `Eurostat holds no consumer price index for ${q.spend.label} in ${name} in the last 13 months.` };
  }
  const r = reading;
  const l = r.latest;
  const range = periodRange(l.period);
  const notes: string[] = ["An index of how consumer prices moved, not a price in money and not a receipt."];
  if (r.datasetLatest && l.period < r.datasetLatest) {
    notes.push(`This is the latest month Eurostat holds for ${r.countryName}; ${r.datasetLatest} has been published for other countries but not yet for it.`);
  }
  return buildStatisticAnswer({
    ...base,
    value: l.index,
    period: range ?? { from: null, to: null },
    reference_period: l.period,
    note: notes.join(" "),
    describe: (v) =>
      `Consumer prices for ${r.spend.label} in ${r.countryName} stood at an index of ${v} in ${monthWords(l.period)} (2025 = 100)` +
      (l.annual_rate_percent !== null ? `, ${rateWords(l.annual_rate_percent, "a year earlier")}` : "") +
      (l.monthly_rate_percent !== null ? ` and ${rateWords(l.monthly_rate_percent, "the month before")}` : "") +
      ".",
    extra: {
      index: true,
      measure: "inflation",
      country_name: r.countryName,
      spending_group: r.spend.label,
      coicop18_code: r.spend.code,
      consumer_price_index: l.index,
      index_base: "2025 = 100",
      annual_rate_percent: l.annual_rate_percent,
      monthly_rate_percent: l.monthly_rate_percent,
      reference_period_label: monthWords(l.period),
      history: r.history.map((h) => ({ period: h.period, consumer_price_index: h.index, annual_rate_percent: h.annual_rate_percent, monthly_rate_percent: h.monthly_rate_percent })),
      dataset: { code: DATASET, title: r.datasetTitle, updated: r.datasetUpdated, doi: "https://doi.org/10.2908/PRC_HICP_MINR", latest_period_in_dataset: r.datasetLatest },
      ...(q.apiUrl ? { eurostat_api_url: q.apiUrl } : {}),
    },
  });
}

// ---------- the request ----------

export const WINDOW_MONTHS = 13;

export function hicpFilters(country: string, spend: Spend): Record<string, string | string[]> {
  return { geo: toEurostatGeo(country), coicop18: spend.code, unit: ["I25", "RCH_M", "RCH_A"] };
}

export async function euHicp(input: { country: string; spend?: string; baseUrl?: string }, o: FetchOptions = {}): Promise<PriceAnswer> {
  const country = input.country.trim().toUpperCase();
  if (!COUNTRIES[country]) throw new InputError(`Consumer price inflation (measure=inflation) is available for ${Object.keys(COUNTRIES).join(", ")}. Not yet: ${input.country}. For other countries leave measure out to get the price level.`);
  const spend = normaliseSpend(input.spend);
  const filters = hicpFilters(country, spend);
  const window = { lastTimePeriod: WINDOW_MONTHS };
  const table = await fetchEurostat(DATASET, filters, window, o);
  return hicpAnswer(readHicp(table, { country, spend }), { country, spend, baseUrl: input.baseUrl, apiUrl: eurostatUrl(DATASET, filters, window) });
}
