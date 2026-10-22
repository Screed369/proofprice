// Finland hotel room prices: Statistics Finland (Tilastokeskus) StatFin table 11ix "Accommodation establishment monthly capacity and
// capacity utilization by Region, Type of accommodation establishment, Information and Month".
// Measure matk-keskihinta = "Average room price": the average price per occupied hotel room, per region and month.
// Table list and metadata checked live on 2026-10-22 from GitHub's servers (probes fihot3, fihot4): GET https://pxdata.stat.fi/PxWeb/api/v1/en/StatFin/matk/11ix.px
// gives variables maakunta_26_20190101 (21 regions), majoitus_3_20181130 (01 all, 02 hotels), contentscode (matk-keskihinta ...), timeperiod_m (1995M01 ...).
// The data call is a POST of an item selection (PxWeb v1) answering JSON-stat 2.0; a POST cannot be probed, so the data fixture is built from the real
// metadata above with illustrative values (see fixtures/README in source.test.ts); the first live preview run is the proof.
import { InputError, SourceError, fetchJson, retryOnce } from "../../lib/http";
import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { parseJsonStat, JsonStatTable, rowsWhere } from "../../lib/adapters";
import type { SourceInfo } from "../../lib/plugin";

export const INFO: SourceInfo = {
  id: "fi-stat-hotels",
  country: "FI (Finland)",
  category: "hotels (average price per occupied room)",
  name: "Accommodation statistics, average hotel room price by region and month (Statistics Finland, StatFin table 11ix)",
  publisher: "Statistics Finland (Tilastokeskus)",
  what_is_recorded:
    "The average price in EUR of an occupied hotel room per night, reported by hotels to Statistics Finland, for the whole country and each of the 19 regions (maakunta) plus Aland, one figure per month.",
  price_type: "official_statistic",
  freshness: "Monthly, published about five weeks after the month ends; every answer states its month",
  licence: "Creative Commons Attribution 4.0 (CC BY 4.0), Statistics Finland",
  licence_url: "https://stat.fi/en/about-us/open-data",
  attribution: "Source: Statistics Finland, accommodation statistics (table 11ix). Licensed under CC BY 4.0.",
  homepage: "https://stat.fi/en/statistics/matk",
  limits:
    "A published monthly average over all hotels in the region, not a range of bookings and not a quote for given dates: no sample size and no range. Hotels only. Cities are answered with their region (Helsinki = Uusimaa).",
};

export const API = "https://pxdata.stat.fi/PxWeb/api/v1/en/StatFin/matk/11ix.px";
export const D_REGION = "maakunta_26_20190101";
export const D_TYPE = "majoitus_3_20181130";
export const D_CONTENTS = "contentscode";
export const D_TIME = "timeperiod_m";
export const MEASURE = "matk-keskihinta";
export const HOTELS = "02";
export const NATIONAL = "SSS";
export const MONTHS_ASKED = 14;

export interface PxQuery {
  query: { code: string; selection: { filter: "item" | "top" | "all"; values: string[] } }[];
  response: { format: "json-stat2" };
}

/** The POST body: every region, hotels only, the average room price, the newest 14 months. */
export function buildQuery(): PxQuery {
  return {
    query: [
      // Region has "elimination": true, so it is left out of the answer unless asked for: take every region.
      { code: D_REGION, selection: { filter: "all", values: ["*"] } },
      { code: D_TYPE, selection: { filter: "item", values: [HOTELS] } },
      { code: D_CONTENTS, selection: { filter: "item", values: [MEASURE] } },
      { code: D_TIME, selection: { filter: "top", values: [String(MONTHS_ASKED)] } },
    ],
    response: { format: "json-stat2" },
  };
}

/** Place words people use, mapped to Statistics Finland region codes. */
const ALIASES: Record<string, string> = {
  finland: NATIONAL, suomi: NATIONAL, "whole country": NATIONAL, "the whole country": NATIONAL, national: NATIONAL, nationwide: NATIONAL,
  "mainland finland": "MA1", mainland: "MA1",
  helsinki: "MK01", espoo: "MK01", vantaa: "MK01", uusimaa: "MK01", nyland: "MK01",
  turku: "MK02", "southwest finland": "MK02", "varsinais-suomi": "MK02",
  pori: "MK04", tampere: "MK06", pirkanmaa: "MK06", lahti: "MK07", lappeenranta: "MK09", kuopio: "MK11", "north savo": "MK11", joensuu: "MK12",
  jyvaskyla: "MK13", seinajoki: "MK14", vaasa: "MK15", oulu: "MK17", "north ostrobothnia": "MK17", kajaani: "MK18",
  rovaniemi: "MK19", levi: "MK19", kittila: "MK19", saariselka: "MK19", ylläs: "MK19", yllas: "MK19", ruka: "MK17", kuusamo: "MK17", lapland: "MK19",
  mariehamn: "MK21", aland: "MK21", "åland": "MK21",
};

export function norm(s: string): string {
  return s
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/ä/gi, "a").replace(/ö/gi, "o").replace(/å/gi, "a")
    .toLowerCase().replace(/[.,']/g, "").replace(/\s+/g, " ").trim();
}

export function parseTable(json: unknown): JsonStatTable {
  const t = parseJsonStat(json);
  for (const d of [D_REGION, D_TIME]) {
    if (!t.codes[d]) throw new SourceError("Statistics Finland changed the layout of table 11ix; this source needs updating.");
  }
  return t;
}

export function regionLabel(t: JsonStatTable, code: string): string {
  const l = (t.labels[D_REGION][code] ?? code).trim();
  return code === NATIONAL ? "Finland (whole country)" : l;
}

function regionNames(t: JsonStatTable): string[] {
  return t.codes[D_REGION].filter((c) => c !== NATIONAL).map((c) => regionLabel(t, c));
}

export function matchRegion(t: JsonStatTable, input?: string): { code: string; label: string; viaCity: string | null } {
  if (!input || !input.trim()) return { code: NATIONAL, label: regionLabel(t, NATIONAL), viaCity: null };
  const q = norm(input);
  let code: string | undefined = ALIASES[q];
  let viaCity: string | null = null;
  if (code && t.codes[D_REGION].includes(code) && code !== NATIONAL && code !== "MA1" && !norm(regionLabel(t, code)).includes(q)) viaCity = input.trim();
  if (!code) {
    const names = t.codes[D_REGION].map((c) => ({ c, n: norm(regionLabel(t, c)) }));
    const exact = names.filter((x) => x.n === q);
    const part = q.length >= 4 ? names.filter((x) => x.n.includes(q)) : [];
    const hit = exact.length ? exact : part;
    if (hit.length === 1) code = hit[0].c;
  }
  if (!code || !t.codes[D_REGION].includes(code)) {
    throw new InputError(`'${input}' is not a region in the Finnish hotel statistics. Use one of: ${regionNames(t).join(", ")}, or a main city such as Helsinki, Tampere, Turku, Oulu or Rovaniemi. Leave area out for the whole country.`);
  }
  return { code, label: regionLabel(t, code), viaCity };
}

export interface Pick {
  month: string; // 2026M08
  value: number;
  previous: { month: string; value: number } | null;
}

/** Newest month with a figure for the region, plus the same month a year earlier when the table holds it. */
export function pickLatest(t: JsonStatTable, region: string): Pick | null {
  const match: Record<string, string> = { [D_REGION]: region };
  if (t.codes[D_TYPE]) match[D_TYPE] = HOTELS;
  if (t.codes[D_CONTENTS]) match[D_CONTENTS] = MEASURE;
  const cells = rowsWhere(t, match);
  const byMonth = new Map<string, number>();
  for (const r of cells) if (r.value !== null && r.value > 0) byMonth.set(String(r[D_TIME]), r.value);
  const months = [...byMonth.keys()].sort();
  if (!months.length) return null;
  const m = months[months.length - 1];
  const yearAgo = `${Number(m.slice(0, 4)) - 1}${m.slice(4)}`;
  return { month: m, value: byMonth.get(m)!, previous: byMonth.has(yearAgo) ? { month: yearAgo, value: byMonth.get(yearAgo)! } : null };
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const ymd = (m: string) => ({ y: Number(m.slice(0, 4)), mo: Number(m.slice(5, 7)) });
export const isoMonth = (m: string) => `${m.slice(0, 4)}-${m.slice(5, 7)}`;
export const monthLabel = (m: string) => `${MONTHS[ymd(m).mo - 1]} ${ymd(m).y}`;
const monthStart = (m: string) => `${isoMonth(m)}-01`;
const monthEnd = (m: string) => new Date(Date.UTC(ymd(m).y, ymd(m).mo, 0)).toISOString().slice(0, 10);
const eur = (v: number) => `EUR ${Math.round(v).toLocaleString("en-GB")}`;

export interface FiHotelInput {
  area?: string;
  baseUrl?: string;
}

export async function fiHotels(input: FiHotelInput, poster?: (url: string, body: PxQuery) => Promise<unknown>): Promise<PriceAnswer> {
  const post =
    poster ?? ((url: string, body: PxQuery) => retryOnce(() => fetchJson(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, 20000)));
  const t = parseTable(await post(API, buildQuery()));
  const region = matchRegion(t, input.area);
  const pick = pickLatest(t, region.code);
  const change = pick?.previous ? Math.round(((pick.value - pick.previous.value) / pick.previous.value) * 1000) / 10 : null;
  const where = region.viaCity ? `${region.label} (the region of ${region.viaCity})` : region.label;
  return buildStatisticAnswer({
    source: INFO,
    query: { country: "FI", ...(region.code !== NATIONAL ? { area: region.label } : {}) },
    value: pick ? pick.value : null,
    measure: "average",
    currency: "EUR",
    unit: "per occupied room per night",
    period: pick ? { from: monthStart(pick.month), to: monthEnd(pick.month) } : { from: null, to: null },
    reference_period: pick ? isoMonth(pick.month) : "",
    method:
      "Finland (Statistics Finland, table 11ix): the average price per occupied hotel room, as reported by hotels for the region and month. We pass on the latest published month with the same month a year earlier; it is an official average over all hotels in the region, not a range of bookings.",
    describe: (v) =>
      `In ${monthLabel(pick!.month)} hotels in ${where} charged an average of ${eur(v)} per occupied room (Statistics Finland).` +
      (change !== null ? (change === 0 ? " That is unchanged from a year earlier." : ` That is ${Math.abs(change)}% ${change > 0 ? "higher" : "lower"} than in ${monthLabel(pick!.previous!.month)}.`) : ""),
    note: "Average price per occupied hotel room per night as reported to Statistics Finland (not a quote for particular dates, not a booking price).",
    baseUrl: input.baseUrl,
    extra: pick
      ? {
          area: region.label,
          statfin_region_code: region.code,
          ...(region.viaCity ? { city_asked: region.viaCity, note_city: "Statistics Finland publishes regions; the city is answered with its region." } : {}),
          month: isoMonth(pick.month),
          same_month_year_earlier: pick.previous ? { month: isoMonth(pick.previous.month), value: pick.previous.value } : null,
          change_on_year_earlier_percent: change,
          price_basis: "average price per occupied room (official statistic)",
          table_updated: t.updated,
        }
      : undefined,
  });
}
