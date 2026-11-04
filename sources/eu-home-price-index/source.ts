// House price index for the EU countries that have no national home-sales source here, from Eurostat (dataset prc_hpi_q).
// Format checked live on 2026-10-20 through the GitHub probe. Uses the JSON-stat adapter: ONE request answers for every country.
//
// What Eurostat publishes: for each country and quarter, an index of the prices households paid for dwellings (2015 = 100),
// built by national statistics offices from purchase transactions. It is an INDEX, not a price in money and not a list of sales:
// the answer is an official statistic with value = index points, range and sample size null.

import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import { eurostatUrl, fetchEurostat, JsonStatTable, periodRange, previousPeriod, toEurostatGeo } from "../../lib/adapters";
import type { FetchOptions } from "../../lib/adapters";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { NO_COUNT } from "../../lib/stats";

export const INFO: SourceInfo = {
  id: "eu-home-price-index",
  country: "BG HR CY CZ EE DE HU IS IT LV LT LU MT PL RO SK SI ES",
  category: "home-sales (official house price index, not prices in money)",
  name: "House price index, quarterly data (prc_hpi_q), all dwellings purchased by households",
  publisher: "Eurostat (European Commission)",
  what_is_recorded:
    "For each country and quarter, the house price index (2015 = 100) of the prices households paid for dwellings (new and existing), " +
    "compiled by national statistics offices from purchase transactions and sent to Eurostat. One published figure per country and quarter; never individual sales.",
  price_type: "official_statistic",
  freshness: "Updated quarterly, about 3 months after the quarter ends; each answer states its quarter and the newest quarter Eurostat holds for the country",
  licence: "Creative Commons Attribution 4.0 International (CC BY 4.0); Eurostat authorises reuse for commercial and non-commercial purposes provided the source is acknowledged",
  licence_url: "https://ec.europa.eu/eurostat/help/copyright-notice",
  attribution:
    "Source: Eurostat, dataset prc_hpi_q (House price index, quarterly data, https://doi.org/10.2908/PRC_HPI_Q). Reused under the Eurostat copyright notice (CC BY 4.0). " +
    "Index values are passed on as published; the percentage changes are calculated by ProofPrice.",
  homepage: "https://ec.europa.eu/eurostat/databrowser/view/prc_hpi_q/default/table?lang=en",
  limits:
    "An index of price changes (2015 = 100), not a price in euros or any currency, so it cannot tell you what a particular home costs; " +
    "it shows how much dearer or cheaper homes in the country are than in 2015 and how that moved. National figure only (no town or postcode). " +
    "Eurostat does not say how many sales stand behind a figure; the newest quarters can be provisional and get revised.",
};

/** ISO alpha-2 -> name, for every country this source answers for. Countries with a national home-sales source here are left out on purpose. */
export const COUNTRIES: Record<string, string> = {
  BG: "Bulgaria", HR: "Croatia", CY: "Cyprus", CZ: "Czechia", DE: "Germany", EE: "Estonia", ES: "Spain", HU: "Hungary",
  IS: "Iceland", IT: "Italy", LV: "Latvia", LT: "Lithuania", LU: "Luxembourg", MT: "Malta", PL: "Poland", RO: "Romania", SK: "Slovakia", SI: "Slovenia",
};

/** Quarters asked for: the newest, the one before, and the same quarter a year earlier (plus one spare for a country a quarter behind). */
export const WINDOW_PERIODS = 6;

const FLAG_MEANING: Record<string, string> = {
  p: "provisional", e: "estimated", b: "a break in the time series", d: "defined differently from other figures (see Eurostat metadata)",
  u: "of low reliability", r: "revised", s: "a Eurostat estimate",
};

const roundTo = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

export interface HpiPoint {
  period: string;
  value: number;
  flag: string | null;
}

export interface HpiReading {
  country: string;
  countryName: string;
  latest: HpiPoint;
  previous: (HpiPoint & { change_percent: number }) | null;
  yearAgo: (HpiPoint & { change_percent: number }) | null;
  datasetLatest: string | null;
  datasetTitle: string | null;
  datasetUpdated: string | null;
}

/** "2026-Q2" -> "2025-Q2". Null if unrecognised. */
export function sameQuarterLastYear(code: string): string | null {
  const m = /^(\d{4})-Q([1-4])$/.exec(code);
  return m ? `${Number(m[1]) - 1}-Q${m[2]}` : null;
}

/** "2026-Q2" -> "the second quarter of 2026". */
export function quarterWords(code: string): string {
  const m = /^(\d{4})-Q([1-4])$/.exec(code);
  if (!m) return code;
  return `the ${["first", "second", "third", "fourth"][Number(m[2]) - 1]} quarter of ${m[1]}`;
}

/** From a parsed prc_hpi_q slice (all geos, purchase TOTAL, unit I15_Q) pick the newest quarter with an index for the country, and its context. Null if none. */
export function readHpi(table: JsonStatTable, country: string): HpiReading | null {
  const geo = toEurostatGeo(country);
  const mine = table.rows.filter((r) => r.geo === geo && r.unit === "I15_Q" && typeof r.value === "number" && Number.isFinite(r.value) && r.value > 0);
  if (!mine.length) return null;
  const point = (r: (typeof mine)[number]): HpiPoint => ({ period: String(r.time), value: r.value as number, flag: typeof r.status === "string" ? r.status : null });
  const byPeriod = new Map(mine.map((r) => [String(r.time), point(r)]));
  const latest = [...byPeriod.values()].reduce((a, p) => (p.period > a.period ? p : a));
  const compare = (code: string | null) => {
    const p = code ? byPeriod.get(code) : undefined;
    return p ? { ...p, change_percent: roundTo(((latest.value - p.value) / p.value) * 100, 1) } : null;
  };
  const times = table.codes.time ?? [];
  return {
    country,
    countryName: COUNTRIES[country] ?? country,
    latest,
    previous: compare(previousPeriod(latest.period)),
    yearAgo: compare(sameQuarterLastYear(latest.period)),
    datasetLatest: times.length ? times[times.length - 1] : null,
    datasetTitle: table.label,
    datasetUpdated: table.updated,
  };
}

function plainChange(pct: number, label: string): string {
  if (pct === 0) return ` Unchanged from ${label}.`;
  return ` ${Math.abs(pct)}% ${pct > 0 ? "higher" : "lower"} than ${label}.`;
}

export const HPI_FILTERS = { purchase: "TOTAL", unit: "I15_Q" };

/** The finished answer for a reading (or for none). Pure. */
export function hpiAnswer(reading: HpiReading | null, q: { country: string; baseUrl?: string; apiUrl?: string }): PriceAnswer {
  const method =
    "Eurostat publishes every quarter the house price index (2015 = 100) of the prices households paid for dwellings, built by each country's statistics office from purchase transactions (dataset prc_hpi_q). " +
    "ProofPrice returns the published index for the latest quarter Eurostat holds for the country, unchanged, with the change from the previous quarter and from the same quarter a year earlier. " +
    "It is an index, not a price in money: no range is calculated and Eurostat does not say how many sales are behind it.";
  const base = { source: INFO, query: { country: q.country }, measure: "average" as const, currency: "INDEX", unit: "index points (2015 = 100)", method, baseUrl: q.baseUrl };

  if (!reading) {
    const none = buildStatisticAnswer({ ...base, value: null, period: { from: null, to: null }, reference_period: "", describe: () => "" });
    return {
      ...none,
      summary: `Eurostat holds no house price index for ${COUNTRIES[q.country] ?? q.country} in the last ${WINDOW_PERIODS} quarters.`,
    };
  }

  const r = reading;
  const r0 = periodRange(r.latest.period);
  const notes: string[] = [
    "This is an official house price index (2015 = 100), not a price in money and not a list of sales.",
  ];
  if (r.latest.flag) notes.push(`Eurostat flags this figure as ${FLAG_MEANING[r.latest.flag] ?? `"${r.latest.flag}"`}.`);
  if (r.datasetLatest && r.latest.period < r.datasetLatest) {
    notes.push(`This is the latest figure Eurostat holds for ${r.countryName}; ${r.datasetLatest} has been published for other countries but not yet for it.`);
  }

  return buildStatisticAnswer({
    ...base,
    value: r.latest.value,
    period: r0 ?? { from: null, to: null },
    reference_period: r.latest.period,
    note: notes.join(" "),
    describe: (v) =>
      `The official house price index for ${r.countryName} was ${v.toFixed(1)} in ${quarterWords(r.latest.period)} (2015 = 100; an index of what households paid for homes, not a price in money).` +
      (r.yearAgo ? plainChange(r.yearAgo.change_percent, `a year earlier (${r.yearAgo.value.toFixed(1)})`) : "") +
      (r.previous ? ` Against ${quarterWords(r.previous.period)} (${r.previous.value.toFixed(1)}), the change is ${r.previous.change_percent > 0 ? "+" : ""}${r.previous.change_percent}%.` : ""),
    extra: {
      country_name: r.countryName,
      reference_period_label: quarterWords(r.latest.period),
      index_base: "2015 = 100",
      change_from_previous_quarter: r.previous ? { reference_period: r.previous.period, index: r.previous.value, change_percent: r.previous.change_percent } : null,
      change_from_year_earlier: r.yearAgo ? { reference_period: r.yearAgo.period, index: r.yearAgo.value, change_percent: r.yearAgo.change_percent } : null,
      ...(r.latest.flag ? { data_flag: { code: r.latest.flag, meaning: FLAG_MEANING[r.latest.flag] ?? r.latest.flag } } : {}),
      dataset: { code: "prc_hpi_q", title: r.datasetTitle, updated: r.datasetUpdated, doi: "https://doi.org/10.2908/PRC_HPI_Q", latest_period_in_dataset: r.datasetLatest },
      ...(q.apiUrl ? { eurostat_api_url: q.apiUrl } : {}),
    },
  });
}

export async function euHomePriceIndex(input: { country: string; baseUrl?: string }, o: FetchOptions = {}): Promise<PriceAnswer> {
  const country = input.country.trim().toUpperCase();
  if (!COUNTRIES[country]) throw new InputError(`The Eurostat house price index is served here for ${Object.keys(COUNTRIES).join(", ")}. Not yet: ${input.country}.`);
  const filters = { ...HPI_FILTERS, geo: toEurostatGeo(country) };
  const window = { lastTimePeriod: WINDOW_PERIODS };
  const table = await fetchEurostat("prc_hpi_q", filters, window, o);
  return hpiAnswer(readHpi(table, country), { country, baseUrl: input.baseUrl, apiUrl: eurostatUrl("prc_hpi_q", filters, window) });
}

// ---------- daily collector (stale-if-error copy) ----------
// Once a day: ONE Eurostat request for all 18 countries (last 2 quarters). Each country's newest index is stored dated by the END of its
// quarter (referenceDates), n = NO_COUNT (Eurostat publishes no record count), the index repeated in low/high/min/max. Only countries that
// have the newest quarter any country has are stored, so every row of a day describes the same quarter. Index points, never a price in money.
export const HARVEST_ITEM = "house-price-index";

export function hpiHarvestRows(table: JsonStatTable): HarvestResult {
  const readings = Object.keys(COUNTRIES).map((c) => readHpi(table, c)).filter((r): r is HpiReading => !!r);
  if (!readings.length) throw new SourceError("Eurostat returned no house price index to collect");
  const newest = readings.reduce((a, r) => (r.latest.period > a ? r.latest.period : a), "");
  const range = periodRange(newest);
  if (!range) throw new SourceError(`Eurostat returned an unrecognised period: ${newest}`);
  const rows: DailyRow[] = readings
    .filter((r) => r.latest.period === newest)
    .map((r) => {
      const v = roundTo(r.latest.value, 2);
      return { area: r.country, item: HARVEST_ITEM, n: NO_COUNT, median: v, low: v, high: v, min: v, max: v };
    });
  return {
    date: range.to,
    currency: "INDEX",
    unit: "index points (2015 = 100)",
    rows,
    note: `Eurostat prc_hpi_q, house price index (2015 = 100) for ${newest}, ${rows.length} of ${readings.length} countries with a figure (countries still on an older quarter are left out). Published index values, not counts of records.`,
  };
}

export async function hpiHarvest(o: FetchOptions = {}): Promise<HarvestResult> {
  const filters = { ...HPI_FILTERS, geo: Object.keys(COUNTRIES).map(toEurostatGeo) };
  return hpiHarvestRows(await fetchEurostat("prc_hpi_q", filters, { lastTimePeriod: 2 }, o));
}

/** Library key for a request: the country's national index. Null when a place smaller than the country is named. */
export function hpiHistoryKey(p: { country?: string; town?: string; postcode?: string }): { area: string; item: string; label: string } | null {
  if (p.town || p.postcode) return null;
  const c = (p.country ?? "").trim().toUpperCase();
  return COUNTRIES[c] ? { area: c, item: HARVEST_ITEM, label: COUNTRIES[c] } : null;
}
