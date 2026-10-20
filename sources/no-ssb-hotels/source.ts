// Norway hotel room prices: Statistics Norway (SSB) table 14168 "Revenue and utilisation of rooms at hotels, by region and month".
// Measure PrisRom = "Price per room (NOK)": the average price per occupied room, per county and month, as reported by hotels.
// PxWebApi v2, plain GET, no key, 40 requests per minute. Format checked live on 2026-10-20 from GitHub's servers
// (fixtures/t14168.json: all 17 regions x 13 months x PrisRom, complete response, 4.6 KB).
// A selection for one variable means all mandatory variables must be given, so we ask for Region=*, ContentsCode=PrisRom, Tid=top(13).
import { InputError, SourceError, fetchJson, retryOnce } from "../../lib/http";
import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { parseJsonStat, rowsWhere, JsonStatTable } from "../../lib/adapters";
import type { SourceInfo } from "../../lib/plugin";

export const INFO: SourceInfo = {
  id: "no-ssb-hotels",
  country: "NO (Norway)",
  category: "hotels (average price per occupied room)",
  name: "Hotel revenue and utilisation of rooms, price per room by county and month (Statistics Norway, table 14168)",
  publisher: "Statistics Norway (SSB)",
  what_is_recorded:
    "The average price in NOK per occupied hotel room per night, reported by hotels to SSB, for the whole country and each of the 16 counties (including Svalbard), one figure per month.",
  price_type: "official_statistic",
  freshness: "Monthly, published about five weeks after the month ends; every answer states its month",
  licence: "Creative Commons Attribution 4.0 (CC BY 4.0), Statistics Norway",
  licence_url: "https://www.ssb.no/en/diverse/lisens",
  attribution: "Source: Statistics Norway (SSB), table 14168. Licensed under CC BY 4.0.",
  homepage: "https://www.ssb.no/en/statbank/table/14168",
  limits:
    "A published monthly average over all hotels in the county, not a range of bookings and not a quote for given dates: no sample size and no range. Small cells can be suppressed. Hotels only (no holiday rentals or camping).",
};

export const TABLE = "14168";
export const URL_DATA =
  `https://data.ssb.no/api/pxwebapi/v2/tables/${TABLE}/data?lang=en&outputFormat=json-stat2` +
  "&valueCodes%5BTid%5D=top(13)&valueCodes%5BRegion%5D=*&valueCodes%5BContentsCode%5D=PrisRom";

const D_REGION = "Region";
const D_TIME = "Tid";
const D_CONTENTS = "ContentsCode";
export const MEASURE = "PrisRom";
export const NATIONAL = "0N";

/** Place words people use, mapped to SSB region codes. */
const ALIASES: Record<string, string> = {
  norway: NATIONAL, norge: NATIONAL, "the whole country": NATIONAL, "whole country": NATIONAL, national: NATIONAL, nationwide: NATIONAL,
  oslo: "03", akershus: "32", bergen: "46", hordaland: "46", stavanger: "11", trondheim: "50", "sor-trondelag": "50",
  tromso: "55", "troms og finnmark": "55", lillehammer: "34", hedmark: "34", oppland: "34", kristiansand: "42", "vest-agder": "42", "aust-agder": "42",
  alesund: "15", molde: "15", bodo: "18", "sogn og fjordane": "46", longyearbyen: "21", spitsbergen: "21",
};

export function norm(s: string): string {
  return s
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/æ/gi, "ae").replace(/ø/gi, "o").replace(/å/gi, "a")
    .toLowerCase().replace(/[.,']/g, "").replace(/\s+/g, " ").trim();
}

export function parseTable(json: unknown): JsonStatTable {
  const t = parseJsonStat(json);
  for (const d of [D_REGION, D_TIME]) {
    if (!t.codes[d]) throw new SourceError("Statistics Norway changed the layout of table 14168; this source needs updating.");
  }
  if (t.codes[D_CONTENTS] && !t.codes[D_CONTENTS].includes(MEASURE)) {
    throw new SourceError("Statistics Norway no longer publishes 'Price per room' (PrisRom) in table 14168; this source needs updating.");
  }
  return t;
}

function regionNames(t: JsonStatTable): string[] {
  return t.codes[D_REGION].map((c) => regionLabel(t, c));
}

/** First name of a bilingual label: 'Oslo - Oslove' -> 'Oslo'. */
export function regionLabel(t: JsonStatTable, code: string): string {
  const l = t.labels[D_REGION][code] ?? code;
  return code === NATIONAL ? "Norway (whole country)" : l.split(" - ")[0];
}

export function matchRegion(t: JsonStatTable, input?: string): { code: string; label: string } {
  if (!input || !input.trim()) return { code: NATIONAL, label: regionLabel(t, NATIONAL) };
  const q = norm(input);
  let code: string | undefined = ALIASES[q];
  if (!code) {
    const names = t.codes[D_REGION].map((c) => ({ c, names: (t.labels[D_REGION][c] ?? c).split(" - ").map(norm) }));
    const exact = names.filter((n) => n.names.includes(q));
    const part = q.length >= 4 ? names.filter((n) => n.names.some((x) => x.includes(q))) : [];
    const hit = exact.length ? exact : part;
    if (hit.length === 1) code = hit[0].c;
  }
  if (!code || !t.codes[D_REGION].includes(code)) {
    throw new InputError(`'${input}' is not a county in the Norwegian hotel statistics. Use one of: ${regionNames(t).join(", ")}. Leave area out for the whole country.`);
  }
  return { code, label: regionLabel(t, code) };
}

export interface Pick {
  month: string; // 2026M08
  value: number;
  previous: { month: string; value: number } | null;
}

/** Newest month with a figure for the region, plus the same month a year earlier when the table holds it. */
export function pickLatest(t: JsonStatTable, region: string): Pick | null {
  const cells = rowsWhere(t, { [D_REGION]: region, ...(t.codes[D_CONTENTS] ? { [D_CONTENTS]: MEASURE } : {}) });
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
const nok = (v: number) => `${Math.round(v).toLocaleString("en-GB")} NOK`;

export interface NoHotelInput {
  area?: string;
  baseUrl?: string;
}

export async function noHotels(input: NoHotelInput, fetcher?: (url: string) => Promise<unknown>): Promise<PriceAnswer> {
  const get = fetcher ?? ((u: string) => retryOnce(() => fetchJson(u, {}, 20000)));
  const t = parseTable(await get(URL_DATA));
  const region = matchRegion(t, input.area);
  const pick = pickLatest(t, region.code);
  const change = pick?.previous ? Math.round(((pick.value - pick.previous.value) / pick.previous.value) * 1000) / 10 : null;
  return buildStatisticAnswer({
    source: INFO,
    query: { country: "NO", ...(region.code !== NATIONAL ? { area: region.label } : {}) },
    value: pick ? pick.value : null,
    measure: "average",
    currency: "NOK",
    unit: "per occupied room per night",
    period: pick ? { from: monthStart(pick.month), to: monthEnd(pick.month) } : { from: null, to: null },
    reference_period: pick ? isoMonth(pick.month) : "",
    method:
      "Norway (Statistics Norway, table 14168): the average price per occupied hotel room, as reported by hotels for the county and month. We pass on the latest published month with the same month a year earlier; it is an official average over all hotels in the county, not a range of bookings.",
    describe: (v) =>
      `In ${monthLabel(pick!.month)} hotels in ${region.label} charged an average of ${nok(v)} per occupied room (Statistics Norway).` +
      (change !== null ? (change === 0 ? " That is unchanged from a year earlier." : ` That is ${Math.abs(change)}% ${change > 0 ? "higher" : "lower"} than in ${monthLabel(pick!.previous!.month)}.`) : ""),
    note: "Average price per occupied hotel room per night as reported to Statistics Norway (not a quote for particular dates, not a booking price).",
    baseUrl: input.baseUrl,
    extra: pick
      ? {
          area: region.label,
          ssb_region_code: region.code,
          month: isoMonth(pick.month),
          same_month_year_earlier: pick.previous ? { month: isoMonth(pick.previous.month), value: pick.previous.value } : null,
          change_on_year_earlier_percent: change,
          price_basis: "average price per occupied room (official statistic)",
          table_updated: t.updated,
        }
      : undefined,
  });
}
