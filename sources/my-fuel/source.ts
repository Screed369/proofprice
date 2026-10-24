// Malaysia fuel: weekly government-set retail prices of RON95, RON97 and diesel from data.gov.my (Ministry of Finance / KPDN price notices).
// Format checked live on 2026-10-16 from GitHub's servers: GET https://api.data.gov.my/data-catalogue?id=fuelprice&limit=120&sort=-date
// returns a JSON array, two rows per Thursday: series_type "level" (MYR per litre) and "change_weekly" (difference to the week before).
// limit=120 covers about 60 weeks, enough for the change on the week and on the year. Fixture rows were copied from that response.

import { InputError, SourceError, fetchJson } from "../../lib/http";
import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import type { HarvestResult, SourceInfo } from "../../lib/plugin";
import { NO_COUNT } from "../../lib/stats";

export const PAGE_URL = "https://data.gov.my/data-catalogue/fuelprice";
export const API_URL = "https://api.data.gov.my/data-catalogue?id=fuelprice&limit=120&sort=-date";
export const LICENCE_URL = "https://creativecommons.org/licenses/by/4.0/";

export const INFO: SourceInfo = {
  id: "my-fuel",
  country: "MY (Malaysia)",
  category: "fuel (weekly national set price)",
  name: "Weekly fuel prices (data.gov.my data catalogue, id fuelprice)",
  publisher: "Government of Malaysia, data.gov.my open data portal (Ministry of Finance weekly fuel price announcements)",
  what_is_recorded:
    "Each week (announced for Thursday) the nationwide retail price in ringgit (MYR) per litre of RON95, RON97 and diesel, plus the subsidised BUDI95 / SKPS / SKDS prices and the East Malaysia diesel price.",
  price_type: "official_statistic",
  freshness: "Weekly, on Thursdays",
  licence: "data.gov.my data catalogue: Creative Commons Attribution 4.0 International (CC BY 4.0)",
  licence_url: LICENCE_URL,
  attribution:
    "Source: data.gov.my, Weekly fuel prices (Government of Malaysia). Licensed under CC BY 4.0. Figures are passed on as published; the changes on the week and year are own calculations by ProofPrice.",
  homepage: PAGE_URL,
  limits:
    "Government-set national prices (what the pump price is announced to be), not records of individual sales and not a station survey: there is no town, region, range or sample size. " +
    "RON95, RON97 and diesel are the unsubsidised market-rate prices for Peninsular Malaysia; the subsidised BUDI95 price (for eligible Malaysians) and East Malaysia diesel are given in extra. " +
    "Malaysia sells RON97, not RON98, and has no E10, E85, LPG or CNG series here.",
};

export interface FuelRow {
  date: string; // YYYY-MM-DD (Thursday)
  series_type: string; // "level" | "change_weekly"
  ron95: number | null;
  ron97: number | null;
  diesel: number | null;
  ron95_budi95?: number | null;
  ron95_skps?: number | null;
  diesel_budi?: number | null;
  diesel_skds?: number | null;
  diesel_eastmsia?: number | null;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** The 'level' rows (MYR per litre), newest first. Throws SourceError when the layout is not the one we know. */
export function parseRows(json: unknown): FuelRow[] {
  if (!Array.isArray(json)) throw new SourceError("data.gov.my changed the layout of the fuel price feed (expected a JSON array); this source needs updating.");
  const out: FuelRow[] = [];
  for (const r of json as any[]) {
    if (!r || r.series_type !== "level" || !/^\d{4}-\d{2}-\d{2}$/.test(String(r.date))) continue;
    out.push({
      date: r.date, series_type: "level", ron95: num(r.ron95), ron97: num(r.ron97), diesel: num(r.diesel),
      ron95_budi95: num(r.ron95_budi95), ron95_skps: num(r.ron95_skps), diesel_budi: num(r.diesel_budi),
      diesel_skds: num(r.diesel_skds), diesel_eastmsia: num(r.diesel_eastmsia),
    });
  }
  if (json.length && !out.length) throw new SourceError("data.gov.my fuel feed had no 'level' rows; this source needs updating.");
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

type Key = "ron95" | "ron97" | "diesel";
export const SERIES: Record<string, { key: Key; label: string; note?: string }> = {
  diesel: { key: "diesel", label: "diesel (Peninsular Malaysia)" },
  petrol95: { key: "ron95", label: "RON95 petrol" },
  petrol98: { key: "ron97", label: "RON97 petrol", note: "Malaysia sells RON97, not RON98; this is RON97, the nearest premium grade." },
};

const myr = (d: number) => `RM${d.toFixed(2)}`;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(a + "T00:00:00Z") - Date.parse(b + "T00:00:00Z")) / 86400000);

export interface Change { from: string; value: number; absolute: number; percent: number }

export function changeFrom(rows: FuelRow[], key: Key, latest: FuelRow, days: number): Change | null {
  const cur = latest[key];
  if (cur === null) return null;
  let best: FuelRow | null = null;
  for (const r of rows) {
    if (r.date >= latest.date || r[key] === null) continue;
    const gap = Math.abs(daysBetween(latest.date, r.date) - days);
    if (gap <= 4 && (!best || gap < Math.abs(daysBetween(latest.date, best.date) - days))) best = r;
  }
  if (!best) return null;
  const prev = best[key] as number;
  return { from: best.date, value: prev, absolute: Math.round((cur - prev) * 100) / 100, percent: Math.round(((cur - prev) / prev) * 1000) / 10 };
}

const move = (c: Change | null, what: string) =>
  c ? `${c.percent > 0 ? "up" : c.percent < 0 ? "down" : "unchanged"}${c.percent === 0 ? "" : ` ${Math.abs(c.percent)}%`} on ${what} (${myr(c.value)} on ${c.from})` : `no figure for ${what}`;

export const METHOD =
  "Malaysia fuel: the government-set national retail price of RON95, RON97 or diesel (ringgit per litre, unsubsidised Peninsular Malaysia rate) for the newest weekly announcement on data.gov.my, " +
  "with the change on the week before and on the same week a year earlier. An official published price for the whole country, not a station survey; subsidised prices are in extra.";

export interface MyFuelInput { fuel?: string; town?: string; area?: string; postcode?: string; baseUrl?: string }

export function answerFromRows(rows: FuelRow[], input: MyFuelInput): PriceAnswer {
  const series = SERIES[input.fuel ?? ""];
  if (!series) throw new InputError("Malaysia: fuel must be diesel, petrol95 (RON95) or petrol98 (answered with RON97).");
  const place = input.town || input.area || input.postcode;
  const query = { country: "MY", fuel: input.fuel, ...(place ? { place } : {}) };
  const latest = rows.find((r) => r[series.key] !== null);
  if (!latest) {
    return buildStatisticAnswer({
      source: INFO, query, value: null, measure: "average", currency: "MYR", unit: "per litre",
      period: { from: null, to: null }, reference_period: "n/a", method: METHOD, describe: () => "", baseUrl: input.baseUrl,
    });
  }
  const value = latest[series.key] as number;
  const week = changeFrom(rows, series.key, latest, 7);
  const year = changeFrom(rows, series.key, latest, 364);
  const note =
    (series.note ? series.note + " " : "") +
    (place ? `data.gov.my publishes one national price only; '${place}' is answered with the Malaysia price. ` : "") +
    "Government-set price, not a station survey.";
  return buildStatisticAnswer({
    source: INFO, query, value, measure: "average", currency: "MYR", unit: "per litre",
    period: { from: latest.date, to: latest.date },
    reference_period: `week announced for ${latest.date}`,
    method: METHOD,
    note: note.trim(),
    describe: (v) =>
      `The set national retail price of ${series.label} in Malaysia was ${myr(v)} per litre in the week of ${latest.date}, ` +
      `${move(week, "the week before")} and ${move(year, "a year earlier")}.`,
    baseUrl: input.baseUrl,
    extra: {
      change_on_week: week,
      change_on_year: year,
      other_fuels_myr_per_litre: { ron95: latest.ron95, ron97: latest.ron97, diesel: latest.diesel },
      subsidised_myr_per_litre: { ron95_budi95: latest.ron95_budi95, ron95_skps: latest.ron95_skps, diesel_budi: latest.diesel_budi, diesel_skds: latest.diesel_skds, diesel_east_malaysia: latest.diesel_eastmsia },
      ...(place ? { place_note: "national figure only" } : {}),
    },
  });
}

export async function myFuel(input: MyFuelInput, fetcher: (url: string) => Promise<unknown> = (u) => fetchJson(u)): Promise<PriceAnswer> {
  return answerFromRows(parseRows(await fetcher(API_URL)), input);
}

// ---------- daily collector (stale-if-error copy and history) ----------
// Once a day the collector stores data.gov.my's newest weekly announcement: one row per fuel the tool can be asked for (diesel, petrol95,
// petrol98 = RON97), n NO_COUNT because the price is a government-set national figure, not a count of sales. Rows are dated by the
// Thursday the announcement is for (referenceDates), so the copy keeps standing in for a week when api.data.gov.my is down.

export function harvestRows(rows: FuelRow[]): HarvestResult {
  const out = [];
  let date = "";
  for (const item of ["diesel", "petrol95", "petrol98"] as const) {
    const key = SERIES[item].key;
    const latest = rows.find((r) => r[key] !== null);
    if (!latest) continue;
    const v = latest[key] as number;
    if (latest.date > date) date = latest.date;
    out.push({ area: "MY", item, n: NO_COUNT, median: v, low: v, high: v, min: v, max: v });
  }
  if (!out.length) throw new SourceError("data.gov.my fuel feed holds no RON95, RON97 or diesel price");
  return {
    date,
    currency: "MYR",
    unit: "per litre",
    rows: out,
    note: "data.gov.my weekly fuel prices: government-set national retail price per litre in ringgit (unsubsidised Peninsular Malaysia rate) of diesel, RON95 and RON97 for the newest weekly announcement. Published prices, not counts of sales.",
  };
}

export async function myFuelHarvest(fetcher: (url: string) => Promise<unknown> = (u) => fetchJson(u)): Promise<HarvestResult> {
  return harvestRows(parseRows(await fetcher(API_URL)));
}

export function myFuelHistoryKey(p: { fuel?: string }): { area: string; item: string; label: string } | null {
  return p.fuel && SERIES[p.fuel] ? { area: "MY", item: p.fuel, label: "Malaysia (national set price)" } : null;
}
