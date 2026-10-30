// Finland: monthly national average pump prices of 95 E10 petrol and diesel, Statistics Finland table 12ge
// "Consumer Prices of Liquid Fuels (includes VAT)" (StatFin/ehi), read through the key-free PxWeb v1 API at pxdata.stat.fi.
// Format checked live on 2026-10-30 from the build shell (fixtures/t12ge.json is the real json-stat2 reply to the POST in query()).
// Dimensions: timeperiod_m ("2026M06"), energia_22_20200205 (A = Motor Gasoline 95 E10, B = Diesel fuel; C light fuel oil, D light fuel oil eur/MWh,
// E renewable diesel are not used), contentscode (hinta = price in euro CENTS per litre, 1 decimal; vuosimuutos_hinta = yearly change, not used).
// One published average per fuel and month, VAT and all duties included, no record count: an official statistic (n NO_COUNT).
// Outside check (30 Oct 2026): the European Commission Weekly Oil Bulletin, FI diesel, monthly median of our library copy, against this table
// (Jan to Jun 2026, EUR/l): 1.81 vs 1.77, 1.85 vs 1.80, 2.14 vs 2.08, 2.29 vs 2.34, 2.30 vs 2.26, 2.22 vs 2.15: within -3.2% to +2.2%. The
// gap is expected: the Bulletin is a weekly price, Statistics Finland a monthly average from the Tankille.fi service, unweighted.

import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError, fetchJson } from "../../lib/http";
import { parseJsonStat, rowsWhere, JsonStatTable } from "../../lib/adapters";
import type { HarvestResult, SourceInfo } from "../../lib/plugin";
import { NO_COUNT } from "../../lib/stats";

export const API = "https://pxdata.stat.fi/PxWeb/api/v1/en/StatFin/ehi/12ge.px";
export const TABLE_URL = "https://stat.fi/en/statistics/ehi";
const SOURCE_LINE = "Source: Statistics Finland, table 12ge Consumer Prices of Liquid Fuels";

export const INFO: SourceInfo = {
  id: "fi-stat-fuel",
  country: "FI (Finland)",
  category: "fuel (monthly national average pump prices)",
  name: "Consumer Prices of Liquid Fuels (includes VAT), monthly, petrol 95 E10 and diesel (Statistics Finland table 12ge)",
  publisher: "Statistics Finland (Tilastokeskus)",
  what_is_recorded:
    "For every month since January 1988, the national average consumer price per litre of 95 E10 unleaded petrol and of diesel in Finland, VAT and duties included, in euro cents per litre. " +
    "One published average per fuel and month; never a station or a driver.",
  price_type: "official_statistic",
  freshness: "Monthly, about three months after the month ends (table updated 24 September 2026 with June 2026); every answer states the month it is for",
  licence:
    "CC BY 4.0. Statistics Finland: open data materials are \"covered by the Creative Commons Attribution 4.0 International licence\" and may be used for commercial purposes as well; " +
    "\"give at least Statistics Finland as the source (Source: Statistics Finland)\".",
  licence_url: "https://stat.fi/en/about-us/get-to-know-statistics-finland/legislation/terms-of-use",
  attribution:
    `${SOURCE_LINE} (${TABLE_URL}), licensed CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Prices are converted from cents to euro per litre; the changes on the previous month and a year earlier are calculated by ProofPrice from the same table. Statistics Finland does not endorse ProofPrice.`,
  homepage: TABLE_URL,
  limits:
    "A national monthly average, not the price at a station, town or postcode: a place in a request is answered with the national figure and says so. " +
    "Statistics Finland publishes the newest month about three months late, gives no distribution and no count of stations, and says its average is not weighted by sales volume. " +
    "Only 95 E10 petrol (petrol95) and diesel are served; heating oil and renewable diesel are in the table but not in this tool, and premium petrol, E85, LPG and CNG are not published.",
};

export type FiFuel = "petrol95" | "diesel";
export const FUELS: Record<FiFuel, { code: string; label: string }> = {
  petrol95: { code: "A", label: "95 E10 unleaded petrol" },
  diesel: { code: "B", label: "diesel" },
};
export const FUEL_ORDER: FiFuel[] = ["petrol95", "diesel"];

const D_TIME = "timeperiod_m";
const D_FUEL = "energia_22_20200205";
const D_CONTENTS = "contentscode";
const CONTENTS_PRICE = "hinta";
export const MONTHS = 14;

/** The POST body: the newest 14 months (newest, previous month and the same month a year earlier), both fuels, price only. */
export function query() {
  return {
    query: [
      { code: D_TIME, selection: { filter: "top", values: [String(MONTHS)] } },
      { code: D_FUEL, selection: { filter: "item", values: FUEL_ORDER.map((f) => FUELS[f].code) } },
      { code: D_CONTENTS, selection: { filter: "item", values: [CONTENTS_PRICE] } },
    ],
    response: { format: "json-stat2" },
  };
}

export interface Month {
  month: string; // YYYY-MM
  petrol95: number | null; // EUR per litre
  diesel: number | null;
}

/** "2026M06" -> "2026-06"; null for anything else. */
export const monthKey = (t: string): string | null => {
  const m = /^(\d{4})M(0[1-9]|1[0-2])$/.exec(t);
  return m ? `${m[1]}-${m[2]}` : null;
};
const monthEnd = (ym: string): string => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
const monthWords = (ym: string): string => new Date(ym + "-01T00:00:00Z").toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const prevMonth = (ym: string, back: number): string => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 - back, 1)).toISOString().slice(0, 7);
};
const round3 = (v: number) => Math.round(v * 1000) / 1000;
const pct = (now: number, then: number) => Math.round(((now - then) / then) * 1000) / 10;

/** Pure: the JSON-stat2 reply -> months (newest first), converting cents to euro. Checks that the layout is the one we proved. */
export function parseMonths(json: unknown): { months: Month[]; table: JsonStatTable } {
  const table = parseJsonStat(json);
  for (const d of [D_FUEL, D_TIME]) {
    if (!table.codes[d]) throw new SourceError("Statistics Finland changed the layout of table 12ge; this source needs updating.");
  }
  if (table.codes[D_CONTENTS] && !table.codes[D_CONTENTS].includes(CONTENTS_PRICE)) {
    throw new SourceError("Statistics Finland no longer publishes 'Price' in table 12ge; this source needs updating.");
  }
  for (const f of FUEL_ORDER) {
    if (!table.codes[D_FUEL].includes(FUELS[f].code)) throw new SourceError(`Statistics Finland no longer lists fuel ${FUELS[f].code} (${f}) in table 12ge; this source needs updating.`);
  }
  const byMonth = new Map<string, Month>();
  for (const r of rowsWhere(table, table.codes[D_CONTENTS] ? { [D_CONTENTS]: CONTENTS_PRICE } : {})) {
    const ym = monthKey(String(r[D_TIME]));
    if (!ym || r.value === null || !(r.value > 0)) continue;
    const m = byMonth.get(ym) ?? { month: ym, petrol95: null, diesel: null };
    const f = FUEL_ORDER.find((x) => FUELS[x].code === String(r[D_FUEL]));
    if (f) m[f] = round3(r.value / 100);
    byMonth.set(ym, m);
  }
  const months = [...byMonth.values()].sort((a, b) => (a.month < b.month ? 1 : -1));
  if (!months.length) throw new SourceError("Statistics Finland answered with no usable fuel prices; this source needs updating.");
  return { months, table };
}

export type Poster = (url: string, body: unknown) => Promise<unknown>;
const defaultPoster: Poster = (url, body) => fetchJson(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, 25000);
export async function fetchMonths(post: Poster = defaultPoster) {
  return parseMonths(await post(API, query()));
}

/** A move this big in one month is real news (a tax change, an oil shock), so the answer says so instead of staying silent. */
export const BIG_MOVE_PCT = 15;

export interface FiFuelInput {
  fuel: string;
  area?: string;
  town?: string;
  postcode?: string;
  baseUrl?: string;
}

export function fiFuelMethod(): string {
  return (
    "Finland (fuel): Statistics Finland publishes, for every month, the national average consumer price per litre of 95 E10 unleaded petrol and of diesel, VAT and duties included (table 12ge, energy prices). " +
    "We read the newest 14 months from the Statistics Finland open-data API (euro cents per litre) and pass on the published average for the newest month in euro per litre, with the change on the previous month and on the same month a year earlier. " +
    "It is an unweighted national monthly average with no count of stations, published about three months late; not a station price and not a live price."
  );
}

const fuelError = () => new InputError("Finland: Statistics Finland's table gives 95 E10 petrol (petrol95) and diesel only. Premium petrol, E85, LPG, CNG, heating oil and renewable diesel are not served here.");

/** Pure: the answer from months (newest first). `today` only decides the "old data" note. */
export function fiFuelAnswer(months: Month[], input: FiFuelInput, today = new Date(), updated: string | null = null): PriceAnswer {
  const fuel = input.fuel as FiFuel;
  if (!FUEL_ORDER.includes(fuel)) throw fuelError();
  const def = FUELS[fuel];
  const head = months.find((m) => m[fuel] !== null);
  const asked = [input.postcode && `postcode ${input.postcode}`, input.town, input.area].filter(Boolean) as string[];
  const query = { country: "FI", fuel, ...(input.area ? { area: input.area } : {}), ...(input.town ? { town: input.town } : {}), ...(input.postcode ? { postcode: input.postcode } : {}) };
  const base = { source: INFO, query, measure: "average" as const, currency: "EUR", unit: "per litre", method: fiFuelMethod(), baseUrl: input.baseUrl };
  if (!head) {
    const none = buildStatisticAnswer({ ...base, value: null, period: { from: null, to: null }, reference_period: "", describe: () => "" });
    return { ...none, summary: `Statistics Finland publishes no recent national average price of ${def.label} for Finland. Try another fuel (${FUEL_ORDER.join(", ")}).` };
  }
  const value = head[fuel] as number;
  const at = (ym: string) => {
    const m = months.find((x) => x.month === ym);
    return m && m[fuel] !== null ? { month: ym, value: m[fuel] as number } : null;
  };
  const prev = at(prevMonth(head.month, 1));
  const year = at(prevMonth(head.month, 12));
  const mk = (x: { month: string; value: number } | null) => (x ? { reference_month: x.month, value: x.value, change_percent: pct(value, x.value) } : null);
  const last = monthEnd(head.month);
  const ageDays = Math.floor((today.getTime() - Date.parse(last + "T00:00:00Z")) / 86400000);
  const move = prev ? pct(value, prev.value) : null;
  const notes = [`A national monthly average for ${monthWords(head.month)}, not the price at a station: Statistics Finland publishes each month about three months after it ends.`];
  if (move !== null && Math.abs(move) >= BIG_MOVE_PCT) {
    notes.push(`Large move: ${def.label} was ${Math.abs(move)}% ${move > 0 ? "higher" : "lower"} than in ${monthWords(prev!.month)} (${fmtMoney(prev!.value, "EUR")}). This is the figure Statistics Finland publishes; check it against the pump before relying on it.`);
  }
  if (asked.length) notes.push(`Statistics Finland publishes no figure by ${asked.join(", ")}: the national average for Finland is given.`);
  if (ageDays > 150) notes.push(`Old data: the newest month Statistics Finland holds for this fuel ended ${ageDays} days ago.`);
  return buildStatisticAnswer({
    ...base,
    value,
    period: { from: `${head.month}-01`, to: last },
    reference_period: head.month,
    note: notes.join(" "),
    describe: (v) =>
      `The national average pump price of ${def.label} in Finland was ${fmtMoney(v, "EUR")} per litre in ${monthWords(head.month)}. ` +
      (year ? (year.value === value ? "That is unchanged from a year earlier. " : `That is ${Math.abs(pct(value, year.value))}% ${value > year.value ? "higher" : "lower"} than a year earlier (${fmtMoney(year.value, "EUR")}). `) : "") +
      "This is a national monthly average published about three months late, not a live pump price.",
    extra: {
      country_name: "Finland",
      fuel: { requested: fuel, label: def.label, statfin_code: def.code },
      reference_month: head.month,
      change_on_previous_month: mk(prev),
      change_on_year_earlier: mk(year),
      other_fuels_same_month: FUEL_ORDER.filter((f) => f !== fuel && head[f] !== null).map((f) => ({ fuel: f, label: FUELS[f].label, value: head[f] })),
      what_this_is: "National average pump price per litre for the month, VAT and duties included, published by Statistics Finland (unweighted). Not a station price and not a live price.",
      dataset: { name: INFO.name, table: "12ge", url: TABLE_URL, table_updated: updated, unit_published: "c/l (euro cents per litre); ProofPrice divides by 100" },
      attribution_notice: SOURCE_LINE,
      ...(asked.length ? { place_note: `Not used: ${asked.join(", ")}. National average returned.` } : {}),
    },
  });
}

export async function fiFuelNow(input: FiFuelInput, today = new Date(), post?: Poster): Promise<PriceAnswer> {
  if (!FUEL_ORDER.includes(input.fuel as FiFuel)) throw fuelError();
  const { months, table } = await fetchMonths(post);
  return fiFuelAnswer(months, input, today, table.updated);
}

// ---------- daily collector (stale-if-error copy) ----------
// Once a day the collector stores the newest published month: one row per fuel, n NO_COUNT (Statistics Finland gives one average and no count).
// Rows are dated by the last day of the month the figures are for (referenceDates), so a copy stays usable while pxdata.stat.fi is down.
export function harvestRows(months: Month[]): HarvestResult {
  const head = months[0];
  if (!head) throw new SourceError("Statistics Finland table 12ge returned no months");
  const rows = FUEL_ORDER.filter((f) => head[f] !== null).map((f) => {
    const v = head[f] as number;
    return { area: "FI", item: f, n: NO_COUNT, median: v, low: v, high: v, min: v, max: v };
  });
  if (!rows.length) throw new SourceError("Statistics Finland table 12ge holds no usable price for the newest month");
  return {
    date: monthEnd(head.month),
    currency: "EUR",
    unit: "per litre",
    rows,
    note: `Statistics Finland table 12ge: national average pump price per litre for ${monthWords(head.month)}, 95 E10 petrol and diesel, VAT and duties included. Published averages, not counts of records (no record count is published).`,
  };
}
export async function fiFuelHarvest(post?: Poster): Promise<HarvestResult> {
  return harvestRows((await fetchMonths(post)).months);
}
export function fiFuelHistoryKey(p: { fuel?: string }): { area: string; item: string; label: string } | null {
  return FUEL_ORDER.includes(p.fuel as FiFuel) ? { area: "FI", item: p.fuel as string, label: "Finland (national average)" } : null;
}
