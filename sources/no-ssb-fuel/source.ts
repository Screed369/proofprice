// Norway: monthly national average pump prices of 95-octane petrol and diesel, Statistics Norway (SSB) table 09654
// "Prices on engine fuel (NOK per litres), by petroleum products and month", read through the key-free PxWebApi v2.
// Format checked live on 2026-10-22 from GitHub's servers (see fixtures/t09654.json, a real JSON-stat2 reply):
//   GET https://data.ssb.no/api/pxwebapi/v2/tables/09654/data?lang=en&outputFormat=json-stat2&valueCodes[PetroleumProd]=031,035&valueCodes[ContentsCode]=Priser&valueCodes[Tid]=top(14)
// PxWebApi v2 refuses a call that leaves a mandatory variable out, so all three are passed. Dimensions: PetroleumProd (031 Motor gasoline,
// leadfree 95 octan; 035 Dutiable diesel), ContentsCode (Priser = NOK per litre, 2 decimals, measuringType Average), Tid ("2026M09").
// SSB gives one average per month and fuel: no distribution, no number of stations, no area split. Every answer is an official statistic.

import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError, fetchJson } from "../../lib/http";
import { parseJsonStat, rowsWhere, JsonStatTable } from "../../lib/adapters";
import type { HarvestResult, SourceInfo } from "../../lib/plugin";
import { NO_COUNT } from "../../lib/stats";

export const TABLE = "09654";
export const TABLE_URL = "https://www.ssb.no/en/statbank/table/09654";
const BASE = `https://data.ssb.no/api/pxwebapi/v2/tables/${TABLE}/data?lang=en&outputFormat=json-stat2`;
/** The last 14 months of both fuels: the newest month, the month before it and the same month a year earlier in one small reply. */
export const URL_RECENT = `${BASE}&valueCodes%5BPetroleumProd%5D=031,035&valueCodes%5BContentsCode%5D=Priser&valueCodes%5BTid%5D=top(14)`;
const SOURCE_LINE = "Source: Statistics Norway (SSB), table 09654 Prices on engine fuel";

export const INFO: SourceInfo = {
  id: "no-ssb-fuel",
  country: "NO (Norway)",
  category: "fuel (monthly national average pump prices)",
  name: "Prices on engine fuel, NOK per litre, by petroleum product and month (SSB table 09654)",
  publisher: "Statistics Norway (SSB)",
  what_is_recorded:
    "For every month since August 1986, the national average retail price per litre of 95-octane unleaded petrol and of (dutiable) diesel in Norway, taxes included, " +
    "as collected by SSB for the Consumer Price Index. One published average per fuel and month; never a station or a driver.",
  price_type: "official_statistic",
  freshness: "Monthly; the newest month is normally published in the first weeks of the next month (table updated 21 October 2026 with September 2026); every answer states the month it is for",
  licence:
    "Creative Commons Attribution 4.0 International (CC BY 4.0). SSB's licence page: \"You must give appropriate credit\" (Statistics Norway, SSB, with a link to www.ssb.no) and the material may be adapted and shared \"for any purpose, even commercially\". " +
    "Re-use must not suggest that SSB endorses ProofPrice.",
  licence_url: "https://www.ssb.no/en/diverse/lisens",
  attribution: `${SOURCE_LINE} (${TABLE_URL}), licensed CC BY 4.0. Changes made by ProofPrice: the newest monthly averages are passed on with the change on the previous month and a year earlier calculated from the same table. SSB does not endorse ProofPrice.`,
  homepage: TABLE_URL,
  limits:
    "A national monthly average, not the price at a station, town or postcode: an area or postcode in a request is answered with the national figure and says so. " +
    "SSB gives no distribution and no count of stations. The newest month is published some weeks after it ends, so this is not a live pump price. " +
    "Only 95-octane petrol (petrol95) and diesel are published; premium petrol, E10, E85, LPG and CNG are not.",
};

export type NoFuel = "petrol95" | "diesel";
export const FUELS: Record<NoFuel, { code: string; label: string }> = {
  petrol95: { code: "031", label: "95-octane unleaded petrol" },
  diesel: { code: "035", label: "diesel" },
};
export const FUEL_ORDER: NoFuel[] = ["petrol95", "diesel"];

const D_FUEL = "PetroleumProd";
const D_TIME = "Tid";
const D_CONTENTS = "ContentsCode";
export const CONTENTS_PRICE = "Priser";

export interface Month {
  month: string; // YYYY-MM
  petrol95: number | null;
  diesel: number | null;
}

/** "2026M09" -> "2026-09"; null for anything else. */
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
  const d = new Date(Date.UTC(y, m - 1 - back, 1));
  return d.toISOString().slice(0, 7);
};

/** Pure: the JSON-stat2 reply -> months, newest first. Checks that the layout is the one we proved. */
export function parseMonths(json: unknown): { months: Month[]; table: JsonStatTable } {
  const table = parseJsonStat(json);
  for (const d of [D_FUEL, D_TIME]) {
    if (!table.codes[d]) throw new SourceError("Statistics Norway changed the layout of table 09654; this source needs updating.");
  }
  if (table.codes[D_CONTENTS] && !table.codes[D_CONTENTS].includes(CONTENTS_PRICE)) {
    throw new SourceError("Statistics Norway no longer publishes 'Prices (NOK per litres)' in table 09654; this source needs updating.");
  }
  for (const f of FUEL_ORDER) {
    if (!table.codes[D_FUEL].includes(FUELS[f].code)) throw new SourceError(`Statistics Norway no longer lists product ${FUELS[f].code} (${f}) in table 09654; this source needs updating.`);
  }
  const byMonth = new Map<string, Month>();
  for (const r of rowsWhere(table, table.codes[D_CONTENTS] ? { [D_CONTENTS]: CONTENTS_PRICE } : {})) {
    const ym = monthKey(String(r[D_TIME]));
    if (!ym || r.value === null || !(r.value > 0)) continue;
    const m = byMonth.get(ym) ?? { month: ym, petrol95: null, diesel: null };
    const f = FUEL_ORDER.find((x) => FUELS[x].code === String(r[D_FUEL]));
    if (f) m[f] = r.value;
    byMonth.set(ym, m);
  }
  return { months: [...byMonth.values()].sort((a, b) => (a.month < b.month ? 1 : -1)), table };
}

export async function fetchMonths(get: (url: string) => Promise<unknown> = (u) => fetchJson(u, {}, 20000)) {
  return parseMonths(await get(URL_RECENT));
}

const round2 = (v: number) => Math.round(v * 100) / 100;
const pct = (now: number, then: number) => Math.round(((now - then) / then) * 1000) / 10;
/** A move this big in one month is real news (a tax change, an oil shock), so the answer says so instead of staying silent. */
export const BIG_MOVE_PCT = 15;

export interface NoFuelInput {
  fuel: string;
  area?: string;
  town?: string;
  postcode?: string;
  baseUrl?: string;
}

export function noFuelMethod(): string {
  return (
    "Norway (fuel): Statistics Norway (SSB) publishes, for every month, the national average retail price per litre of 95-octane unleaded petrol and of diesel, taxes included (table 09654, the prices collected for the Consumer Price Index). " +
    "We read the last 14 months from the SSB PxWebApi and pass on the published average for the newest month, with the change on the previous month and on the same month a year earlier. " +
    "It is a national monthly average with no count of stations, not a station price and not a live price."
  );
}

const fuelError = () => new InputError("Norway: SSB publishes 95-octane petrol (petrol95) and diesel only. Premium petrol, E10, E85, LPG and CNG are not published.");

/** Pure: the answer from months (newest first). `today` only decides the "old data" note. */
export function noFuelAnswer(months: Month[], input: NoFuelInput, today = new Date(), updated: string | null = null): PriceAnswer {
  const fuel = input.fuel as NoFuel;
  if (!FUEL_ORDER.includes(fuel)) throw fuelError();
  const def = FUELS[fuel];
  const head = months.find((m) => m[fuel] !== null);
  const asked = [input.postcode && `postcode ${input.postcode}`, input.town, input.area].filter(Boolean) as string[];
  const query = { country: "NO", fuel, ...(input.area ? { area: input.area } : {}), ...(input.town ? { town: input.town } : {}), ...(input.postcode ? { postcode: input.postcode } : {}) };
  const base = { source: INFO, query, measure: "average" as const, currency: "NOK", unit: "per litre", method: noFuelMethod(), baseUrl: input.baseUrl };
  if (!head) {
    const none = buildStatisticAnswer({ ...base, value: null, period: { from: null, to: null }, reference_period: "", describe: () => "" });
    return { ...none, summary: `SSB publishes no recent national average price of ${def.label} for Norway. Try another fuel (${FUEL_ORDER.join(", ")}).` };
  }
  const value = head[fuel] as number;
  const at = (ym: string) => {
    const m = months.find((x) => x.month === ym);
    return m && m[fuel] !== null ? { month: ym, value: m[fuel] as number } : null;
  };
  const prev = at(prevMonth(head.month, 1));
  const year = at(prevMonth(head.month, 12));
  const mk = (x: { month: string; value: number } | null) => (x ? { reference_month: x.month, value: x.value, change_percent: pct(value, x.value) } : null);
  const first = `${head.month}-01`;
  const last = monthEnd(head.month);
  const ageDays = Math.floor((today.getTime() - Date.parse(last + "T00:00:00Z")) / 86400000);
  const move = prev ? pct(value, prev.value) : null;
  const notes = [`A national monthly average for ${monthWords(head.month)}, not the price at a station: SSB publishes each month some weeks after it ends.`];
  if (move !== null && Math.abs(move) >= BIG_MOVE_PCT) {
    notes.push(`Large move: ${def.label} was ${Math.abs(move)}% ${move > 0 ? "higher" : "lower"} than in ${monthWords(prev!.month)} (${fmtMoney(prev!.value, "NOK")}). This is the figure SSB publishes; check it against the pump before relying on it.`);
  }
  if (asked.length) notes.push(`SSB publishes no figure by ${asked.join(", ")}: the national average for Norway is given.`);
  if (ageDays > 75) notes.push(`Old data: the newest month SSB holds for this fuel ended ${ageDays} days ago.`);
  return buildStatisticAnswer({
    ...base,
    value: round2(value),
    period: { from: first, to: last },
    reference_period: head.month,
    note: notes.join(" "),
    describe: (v) =>
      `The national average pump price of ${def.label} in Norway was ${fmtMoney(v, "NOK")} per litre in ${monthWords(head.month)}. ` +
      (year ? (year.value === value ? "That is unchanged from a year earlier. " : `That is ${Math.abs(pct(value, year.value))}% ${value > year.value ? "higher" : "lower"} than a year earlier (${fmtMoney(year.value, "NOK")}). `) : "") +
      "This is a national monthly average published some weeks late, not a live pump price.",
    extra: {
      country_name: "Norway",
      fuel: { requested: fuel, label: def.label, ssb_product_code: def.code },
      reference_month: head.month,
      change_on_previous_month: mk(prev),
      change_on_year_earlier: mk(year),
      other_fuels_same_month: FUEL_ORDER.filter((f) => f !== fuel && head[f] !== null).map((f) => ({ fuel: f, label: FUELS[f].label, value: head[f] })),
      what_this_is: "National average pump price per litre for the month, taxes included, published by Statistics Norway. Not a station price and not a live price.",
      dataset: { name: INFO.name, table: TABLE, url: TABLE_URL, table_updated: updated },
      attribution_notice: SOURCE_LINE,
      ...(asked.length ? { place_note: `Not used: ${asked.join(", ")}. National average returned.` } : {}),
    },
  });
}

export async function noFuelNow(input: NoFuelInput, today = new Date(), get?: (url: string) => Promise<unknown>): Promise<PriceAnswer> {
  if (!FUEL_ORDER.includes(input.fuel as NoFuel)) throw fuelError();
  const { months, table } = await fetchMonths(get);
  return noFuelAnswer(months, input, today, table.updated);
}

// ---------- daily collector (stale-if-error copy) ----------
// Once a day the collector stores the newest published month: two rows (one per fuel), n NO_COUNT because SSB gives one average and no
// count. Rows are dated by the last day of the month the figures are for (referenceDates), so a copy stays usable while SSB is down.
// There is no /history of these monthly averages (noHistory in the manifest).

export function harvestRows(months: Month[]): HarvestResult {
  const head = months[0];
  if (!head) throw new SourceError("SSB table 09654 returned no months");
  const rows = FUEL_ORDER.filter((f) => head[f] !== null).map((f) => {
    const v = round2(head[f] as number);
    return { area: "NO", item: f, n: NO_COUNT, median: v, low: v, high: v, min: v, max: v };
  });
  if (!rows.length) throw new SourceError("SSB table 09654 holds no usable price for the newest month");
  return {
    date: monthEnd(head.month),
    currency: "NOK",
    unit: "per litre",
    rows,
    note: `Statistics Norway (SSB) table 09654: national average pump price per litre for ${monthWords(head.month)}, 95-octane petrol and diesel, taxes included. Published averages, not counts of records (no record count is published).`,
  };
}

export async function noFuelHarvest(get?: (url: string) => Promise<unknown>): Promise<HarvestResult> {
  return harvestRows((await fetchMonths(get)).months);
}

export function noFuelHistoryKey(p: { fuel?: string }): { area: string; item: string; label: string } | null {
  return FUEL_ORDER.includes(p.fuel as NoFuel) ? { area: "NO", item: p.fuel as string, label: "Norway (national average)" } : null;
}
