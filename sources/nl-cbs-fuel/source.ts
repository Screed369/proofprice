// Netherlands: daily national average pump prices of Euro95 petrol, diesel and LPG, Statistics Netherlands (CBS) table 80416NED
// "Pompprijzen motorbrandstoffen; brandstofsoort, per dag", read through the key-free CBS StatLine OData API.
// Format checked live on 2026-10-21 by the Verifier (see fixtures.ts): GET .../ODataApi/odata/80416ned/TypedDataSet?$filter=Perioden gt '20261005'
// -> JSON {"value":[{"ID":7589,"Perioden":"20261012","BenzineEuro95_1":2.462,"Diesel_2":2.482,"Lpg_3":0.961}]}. One row per day since 2006-01-01,
// euro per litre, a weighted national average incl. VAT and excise built from almost all stations (Travelcard BV). CBS gives one
// figure per day: no distribution and no count of stations, so every answer is an official statistic (range fields null, sample_size null).
// $orderby is ignored by this endpoint, so the request filters on the period key instead. One small request per question; no bulk file.

import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError, fetchJson } from "../../lib/http";
import type { HarvestResult, SourceInfo } from "../../lib/plugin";
import { NO_COUNT } from "../../lib/stats";

export const TABLE = "80416ned";
export const API = `https://opendata.cbs.nl/ODataApi/odata/${TABLE}/TypedDataSet`;
export const TABLE_URL = "https://www.cbs.nl/nl-nl/cijfers/detail/80416ned";
const SOURCE_LINE = "Source: Statistics Netherlands (CBS), Pompprijzen motorbrandstoffen 80416ned";

export const INFO: SourceInfo = {
  id: "nl-cbs-fuel",
  country: "NL (Netherlands)",
  category: "fuel (daily national average pump prices)",
  name: "Pompprijzen motorbrandstoffen; brandstofsoort, per dag (CBS StatLine table 80416NED)",
  publisher: "Statistics Netherlands (Centraal Bureau voor de Statistiek, CBS)",
  what_is_recorded:
    "For every day since 2006, the national average pump price per litre of Euro95 petrol, diesel and LPG in the Netherlands, weighted over almost all filling stations (payment data from Travelcard BV), " +
    "with VAT and excise included. One published average per fuel and day; never a station or a driver.",
  price_type: "official_statistic",
  freshness: "Weekly publication of daily averages: new days appear each Thursday, up to the Monday of that week; every answer states the day it is for",
  licence:
    "Creative Commons Attribution 4.0 (CC BY 4.0). CBS states: \"Unless otherwise stated, the content of this website is subject to Creative Commons Attribution (CC BY 4.0) ... re-use ... is permitted, provided Statistics Netherlands is cited as the source.\" " +
    "Re-use must not suggest that CBS endorses ProofPrice.",
  licence_url: "https://www.cbs.nl/en-gb/about-us/website/copyright",
  attribution:
    `${SOURCE_LINE} (${TABLE_URL}), licensed CC BY 4.0. Changes made by ProofPrice: the newest daily averages are passed on with the change on the previous week and on a year earlier calculated from the same table. CBS does not endorse ProofPrice.`,
  homepage: TABLE_URL,
  limits:
    "A national daily average, not the price at a station, town or postcode: an area or postcode in a request is answered with the national figure and says so. " +
    "CBS gives no distribution and no count of stations. The newest day is normally the Monday of the previous week (a few days behind, not live). " +
    "Only Euro95 petrol (petrol95), diesel and LPG are published; premium petrol, E10, E85 and natural gas are not.",
};

export type NlFuel = "petrol95" | "diesel" | "lpg";
export const FUELS: Record<NlFuel, { column: string; label: string }> = {
  petrol95: { column: "BenzineEuro95_1", label: "Euro95 petrol" },
  diesel: { column: "Diesel_2", label: "diesel" },
  lpg: { column: "Lpg_3", label: "LPG" },
};
export const FUEL_ORDER: NlFuel[] = ["petrol95", "diesel", "lpg"];

export interface Day {
  date: string; // YYYY-MM-DD
  petrol95: number | null;
  diesel: number | null;
  lpg: number | null;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);

/** Pure: the `value` array of a CBS OData reply -> days, newest first. Rows without a valid YYYYMMDD period are dropped. */
export function parseDays(body: unknown): Day[] {
  const rows = (body as { value?: unknown })?.value;
  if (!Array.isArray(rows)) throw new SourceError("CBS StatLine answered in an unexpected format (no value list); this source needs updating.");
  const days: Day[] = [];
  for (const r of rows as Record<string, unknown>[]) {
    const p = String(r?.Perioden ?? "");
    if (!/^\d{8}$/.test(p)) continue;
    days.push({
      date: `${p.slice(0, 4)}-${p.slice(4, 6)}-${p.slice(6, 8)}`,
      petrol95: num(r[FUELS.petrol95.column]),
      diesel: num(r[FUELS.diesel.column]),
      lpg: num(r[FUELS.lpg.column]),
    });
  }
  return days.sort((a, b) => (a.date < b.date ? 1 : -1));
}

const addDays = (iso: string, n: number): string => new Date(Date.parse(iso + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const compact = (iso: string) => iso.replace(/-/g, "");

/** The request: every day after `since` (YYYY-MM-DD), the proven filter form. */
export function url(since: string): string {
  return `${API}?$filter=${encodeURIComponent(`Perioden gt '${compact(since)}'`)}`;
}

export async function fetchDays(since: string): Promise<Day[]> {
  return parseDays(await fetchJson(url(since), { headers: { accept: "application/json" } }, 25000));
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;
const pct = (now: number, then: number) => Math.round(((now - then) / then) * 1000) / 10;
const longDate = (iso: string) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export interface NlFuelInput {
  fuel: string;
  area?: string;
  town?: string;
  postcode?: string;
  baseUrl?: string;
}

export function nlFuelMethod(): string {
  return (
    "Netherlands (fuel): Statistics Netherlands (CBS) publishes, for every day, the national average pump price per litre of Euro95 petrol, diesel and LPG, " +
    "weighted over almost all filling stations, with VAT and excise included (table 80416NED). We read the newest days from the CBS StatLine OData API and pass on the published average for the " +
    "newest day, with the change on the previous week and on the same weekday a year earlier. It is a national average with no count of stations, not a station price and not a live price."
  );
}

/** Pure: the answer from a list of days (newest first). `today` only decides the "old data" note. */
export function nlFuelAnswer(days: Day[], input: NlFuelInput, today = new Date()): PriceAnswer {
  const fuel = input.fuel as NlFuel;
  if (!FUEL_ORDER.includes(fuel)) {
    throw new InputError("Netherlands: CBS publishes Euro95 petrol (petrol95), diesel and lpg only. Premium petrol, E10, E85 and natural gas are not published.");
  }
  const def = FUELS[fuel];
  const head = days.find((d) => d[fuel] !== null);
  const asked = [input.postcode && `postcode ${input.postcode}`, input.town, input.area].filter(Boolean) as string[];
  const query = { country: "NL", fuel, ...(input.area ? { area: input.area } : {}), ...(input.town ? { town: input.town } : {}), ...(input.postcode ? { postcode: input.postcode } : {}) };
  const base = { source: INFO, query, measure: "average" as const, currency: "EUR", unit: "per litre", method: nlFuelMethod(), baseUrl: input.baseUrl };
  if (!head) {
    const none = buildStatisticAnswer({ ...base, value: null, period: { from: null, to: null }, reference_period: "", describe: () => "" });
    return { ...none, summary: `CBS publishes no recent national average price of ${def.label} for the Netherlands. Try another fuel (${FUEL_ORDER.join(", ")}).` };
  }
  const value = head[fuel] as number;
  const at = (iso: string) => {
    const d = days.find((x) => x.date === iso);
    return d && d[fuel] !== null ? { date: iso, value: d[fuel] as number } : null;
  };
  const prev = at(addDays(head.date, -7));
  const year = at(addDays(head.date, -364));
  const mk = (x: { date: string; value: number } | null) => (x ? { reference_date: x.date, value: x.value, change_percent: pct(value, x.value) } : null);
  const age = Math.floor((today.getTime() - Date.parse(head.date + "T00:00:00Z")) / 86400000);
  const notes = [
    `A national daily average for ${longDate(head.date)}, not the price at a station: CBS publishes days up to the Monday of the previous week, so the figure is a few days behind.`,
  ];
  if (asked.length) notes.push(`CBS publishes no figure by ${asked.join(", ")}: the national average for the Netherlands is given.`);
  if (age > 21) notes.push(`Old data: the newest day CBS holds for this fuel is ${age} days old.`);
  return buildStatisticAnswer({
    ...base,
    value: round3(value),
    period: { from: head.date, to: head.date },
    reference_period: head.date,
    note: notes.join(" "),
    describe: (v) =>
      `The national average pump price of ${def.label} in the Netherlands was ${fmtMoney(v, "EUR")} per litre on ${longDate(head.date)}. ` +
      (year ? (year.value === value ? "That is unchanged from a year earlier. " : `That is ${Math.abs(pct(value, year.value))}% ${value > year.value ? "higher" : "lower"} than a year earlier (${fmtMoney(year.value, "EUR")}). `) : "") +
      "This is a national daily average published a few days late, not a live pump price.",
    extra: {
      country_name: "Netherlands",
      fuel: { requested: fuel, label: def.label, cbs_column: def.column },
      reference_date: head.date,
      change_on_previous_week: mk(prev),
      change_on_year_earlier: mk(year),
      other_fuels_same_day: FUEL_ORDER.filter((f) => f !== fuel && head[f] !== null).map((f) => ({ fuel: f, label: FUELS[f].label, value: head[f] })),
      what_this_is: "Weighted national average pump price per litre for the day, published by Statistics Netherlands. Not a station price and not a live price.",
      dataset: { name: INFO.name, table: "80416NED", url: TABLE_URL },
      attribution_notice: SOURCE_LINE,
      ...(asked.length ? { place_note: `Not used: ${asked.join(", ")}. National average returned.` } : {}),
    },
  });
}

export async function nlFuelNow(input: NlFuelInput, today = new Date()): Promise<PriceAnswer> {
  if (!FUEL_ORDER.includes(input.fuel as NlFuel)) {
    throw new InputError("Netherlands: CBS publishes Euro95 petrol (petrol95), diesel and lpg only. Premium petrol, E10, E85 and natural gas are not published.");
  }
  // About 13 months of days (one small JSON request) so the year-earlier day is in the same reply.
  const days = await fetchDays(addDays(today.toISOString().slice(0, 10), -400));
  return nlFuelAnswer(days, input, today);
}

// ---------- daily collector (stale-if-error copy) ----------
// Once a day the collector stores the newest published day: three rows (one per fuel), n NO_COUNT because CBS gives one average and no
// count. Rows are dated by the day the figures are for (referenceDates), so a copy stays usable while CBS is down. History of the
// daily series is not offered here (the bulletin source answers /history for NL).

export function harvestRows(days: Day[]): HarvestResult {
  const head = days[0];
  if (!head) throw new SourceError("CBS table 80416NED returned no days");
  const rows = FUEL_ORDER.filter((f) => head[f] !== null).map((f) => {
    const v = round3(head[f] as number);
    return { area: "NL", item: f, n: NO_COUNT, median: v, low: v, high: v, min: v, max: v };
  });
  if (!rows.length) throw new SourceError("CBS table 80416NED holds no usable price for the newest day");
  return {
    date: head.date,
    currency: "EUR",
    unit: "per litre",
    rows,
    note: `Statistics Netherlands (CBS) table 80416NED: national average pump price per litre for ${head.date}, Euro95 petrol, diesel and LPG, VAT and excise included. Published averages, not counts of records (no record count is published).`,
  };
}

export async function nlFuelHarvest(today = new Date()): Promise<HarvestResult> {
  return harvestRows(await fetchDays(addDays(today.toISOString().slice(0, 10), -30)));
}

export function nlFuelHistoryKey(p: { fuel?: string }): { area: string; item: string; label: string } | null {
  return FUEL_ORDER.includes(p.fuel as NlFuel) ? { area: "NL", item: p.fuel as string, label: "Netherlands (national average)" } : null;
}
