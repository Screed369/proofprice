// Canada: monthly average retail prices for gasoline and diesel by city, Statistics Canada table 18-10-0001-01 ("Monthly average retail
// prices for gasoline and fuel oil, by geography"; CANSIM 326-0009), read through the key-free Web Data Service (WDS).
// Formats checked live on 2026-10-14 (see fixtures.ts). The table holds 18 cities (Charlottetown and Summerside count as one) plus Canada,
// monthly since January 1979, in cents per litre. Statistics Canada publishes ONE average per city, fuel and month: no distribution and no
// count of stations, so every answer is an official statistic (value + measure "average", range fields null, sample_size null).
// A request is two small WDS calls (table description, then the latest 13 months of three series), cached in memory; no bulk file.

import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import type { HarvestResult, SourceInfo } from "../../lib/plugin";
import type { Fuel } from "../../lib/fuels";
import {
  CubeMeta, DataSeries, Poster, changePercent, coordinate, dimension, latestPeriods, loadCubeMeta, memberByName, monthOf, monthRange,
  monthWords, monthsBehind, newestUsable, roundTo, shiftMonth, usable,
} from "../_ca-statcan/wds";
import { OPEN_LICENCE_TEXT, OPEN_LICENCE_URL, openLicenceAttribution, openLicenceNotice } from "../_ca-statcan/licence";
import { resolvePlace } from "../_ca-statcan/geo";
import { NO_COUNT } from "../../lib/stats";

export const PRODUCT_ID = 18100001;
export const TABLE_NAME = "Table 18-10-0001-01 Monthly average retail prices for gasoline and fuel oil, by geography";

export const INFO: SourceInfo = {
  id: "ca-statcan-fuel",
  country: "CA (Canada)",
  category: "fuel (monthly average retail prices)",
  name: "Monthly average retail prices for gasoline and fuel oil, by geography (Statistics Canada table 18-10-0001-01)",
  publisher: "Statistics Canada",
  what_is_recorded:
    "For 18 cities (Charlottetown and Summerside count as one) and a Canada average, the average retail price per litre of regular unleaded gasoline, premium unleaded gasoline and diesel at self-service filling stations, " +
    "each month, as published with the Consumer Price Index. One published average per city, fuel and month; never a station or a driver.",
  price_type: "official_statistic",
  freshness:
    "Monthly, not live: Statistics Canada publishes each month's averages about two weeks after the month ends (August 2026 was released on 14 September 2026), and every answer states its reference month",
  licence: OPEN_LICENCE_TEXT,
  licence_url: OPEN_LICENCE_URL,
  attribution: openLicenceAttribution(TABLE_NAME),
  homepage: "https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=1810000101",
  limits:
    "A monthly average per city, not today's pump price and not a range of stations: Statistics Canada gives no distribution and no count of stations. Self-service stations only (the full-service series ended with the January 2013 index). " +
    "Only 18 cities plus a Canada average (regular unleaded only) are published, no towns, provinces or postcodes. Statistics Canada's \"regular\" and \"premium\" grades carry no octane number; regular is normally 87 AKI (about 91 RON), " +
    "so petrol95 here means the standard regular grade, not the 95 RON grade sold in Europe. Some cities lack a fuel (for example diesel in Thunder Bay). Ethanol blends (E10, E85), LPG and CNG are not published.",
};

/** Our fuel words -> the table's member names (self-service series; the full-service ones were terminated in 2013). */
export const FUEL_MEMBERS: Partial<Record<Fuel, { name: string; label: string }>> = {
  petrol95: { name: "Regular unleaded gasoline at self service filling stations", label: "regular unleaded gasoline" },
  petrol98: { name: "Premium unleaded gasoline at self service filling stations", label: "premium unleaded gasoline" },
  diesel: { name: "Diesel fuel at self service filling stations", label: "diesel" },
};
const FUEL_ORDER: Fuel[] = ["petrol95", "petrol98", "diesel"];

export const AKI_NOTE =
  "Statistics Canada's grades carry no octane number. Regular is normally 87 AKI (about 91 RON) and premium 91 AKI or higher, so petrol95 here is the standard regular grade, not the 95 RON grade sold in Europe.";

export interface CaFuelInput {
  fuel: Fuel;
  town?: string;
  area?: string;
  postcode?: string;
  service?: string;
  baseUrl?: string;
}

const NATIONAL_WORDS = new Set(["canada", "ca", "national", "nationwide", "country", "all"]);
const plainCents = (v: number) => `${v.toFixed(1)} cents`;

export interface FuelReading {
  place: { id: number; name: string };
  fuel: Fuel;
  month: string; // YYYY-MM
  cents: number;
  previous: { month: string; cents: number } | null;
  yearAgo: { month: string; cents: number } | null;
  last12: { month: string; cents: number }[];
  releaseTime: string | null;
  others: { fuel: Fuel; cents: number }[];
}

/** Pick the headline figure and its context out of the three series of one city (regular, premium, diesel). */
export function readFuel(series: Partial<Record<Fuel, DataSeries>>, fuel: Fuel, place: { id: number; name: string }): FuelReading | null {
  const head = series[fuel];
  const latest = newestUsable(head);
  if (!head || !latest) return null;
  const month = monthOf(latest.period);
  const at = (m: string) => {
    const p = head.points.find((x) => monthOf(x.period) === m);
    return usable(p) ? { month: m, cents: p.value } : null;
  };
  const last12: { month: string; cents: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const m = shiftMonth(month, -i);
    const p = at(m);
    if (p) last12.push(p);
  }
  const others: { fuel: Fuel; cents: number }[] = [];
  for (const f of FUEL_ORDER) {
    if (f === fuel) continue;
    const p = series[f]?.points.find((x) => monthOf(x.period) === month);
    if (usable(p)) others.push({ fuel: f, cents: p.value });
  }
  return { place, fuel, month, cents: latest.value, previous: at(shiftMonth(month, -1)), yearAgo: at(shiftMonth(month, -12)), last12, releaseTime: latest.releaseTime, others };
}

export function caFuelMethod(): string {
  return (
    "Canada (fuel): Statistics Canada's monthly average retail price per litre of regular unleaded gasoline, premium unleaded gasoline and diesel at self-service stations for 18 cities and Canada " +
    "(table 18-10-0001-01, published with the Consumer Price Index). We read the latest months through the Web Data Service and pass on the published average for the city and its month, converted from cents to dollars; " +
    "no range is calculated. It is a monthly average, not today's pump price."
  );
}

const money = (cents: number) => fmtMoney(roundTo(cents / 100, 3), "CAD");

export function caFuelAnswer(r: FuelReading | null, q: { fuel: Fuel; placeAsked: { id: number; name: string }; placeNote?: string; tableTitle?: string; baseUrl?: string; today?: Date }): PriceAnswer {
  const def = FUEL_MEMBERS[q.fuel]!;
  const query = { country: "CA", fuel: q.fuel, town: (r?.place ?? q.placeAsked).name, service: "self" };
  const base = { source: INFO, query, measure: "average" as const, currency: "CAD", unit: "per litre", method: caFuelMethod(), baseUrl: q.baseUrl };

  if (!r) {
    const none = buildStatisticAnswer({ ...base, value: null, period: { from: null, to: null }, reference_period: "", describe: () => "" });
    return {
      ...none,
      summary:
        `Statistics Canada publishes no recent average price of ${def.label} at self-service stations for ${q.placeAsked.name}` +
        (q.placeAsked.name === "Canada" ? " (the Canada average exists for regular unleaded only)" : "") +
        `. Try another fuel (${FUEL_ORDER.join(", ")}) or another of its 18 cities.`,
      extra: { fuels_published: FUEL_ORDER, ...(q.placeNote ? { place_note: q.placeNote } : {}) },
    };
  }

  const today = q.today ?? new Date();
  const range = monthRange(r.month);
  const behind = monthsBehind(r.month, today);
  const change = (from: { month: string; cents: number } | null) =>
    from ? { reference_month: from.month, cents_per_litre: from.cents, value: roundTo(from.cents / 100, 3), change_percent: changePercent(r.cents, from.cents) } : null;
  const mom = change(r.previous);
  const yoy = change(r.yearAgo);
  const notes: string[] = [
    `A monthly average for ${monthWords(r.month)}, not today's pump price: pump prices move daily and Statistics Canada publishes about two weeks after each month ends.`,
    "Self-service stations only.",
  ];
  if (q.fuel === "petrol95") notes.push(AKI_NOTE);
  if (behind >= 3) notes.push(`Old data: the newest average Statistics Canada holds for this city and fuel is from ${monthWords(r.month)}, ${behind} months ago.`);
  if (q.placeNote) notes.push(q.placeNote);

  const attribution = openLicenceNotice(TABLE_NAME, monthWords(r.month));
  const where = r.place.name === "Canada" ? "Canada (national average)" : r.place.name;
  return buildStatisticAnswer({
    ...base,
    value: roundTo(r.cents / 100, 3),
    period: range,
    reference_period: r.month,
    note: notes.join(" "),
    describe: (v) =>
      `The average retail price of ${def.label} at self-service stations in ${where} was ${fmtMoney(v, "CAD")} per litre (${plainCents(r.cents)}) in ${monthWords(r.month)}. ` +
      (yoy
        ? yoy.change_percent === 0
          ? `That is unchanged from a year earlier. `
          : `That is ${Math.abs(yoy.change_percent)}% ${yoy.change_percent > 0 ? "higher" : "lower"} than a year earlier (${fmtMoney(yoy.value, "CAD")} in ${monthWords(yoy.reference_month)}). `
        : "") +
      `This is a monthly average, not a live pump price.` +
      (behind >= 3 ? ` Old data: ${behind} months old.` : ""),
    extra: {
      country_name: "Canada",
      place: { name: r.place.name, wds_member_id: r.place.id },
      fuel: { requested: q.fuel, definition: def.name, grade_note: q.fuel === "petrol95" ? AKI_NOTE : undefined },
      published_value: { cents_per_litre: r.cents, note: "Statistics Canada publishes cents per litre; the answer value is that figure divided by 100 (Canadian dollars per litre)." },
      reference_month: r.month,
      reference_month_label: monthWords(r.month),
      change_on_previous_month: mom,
      change_on_year_earlier: yoy,
      ...(yoy ? {} : { change_on_year_earlier_unavailable: "Statistics Canada holds no average for this series in the same month a year earlier." }),
      last_12_months: r.last12.map((p) => ({ month: p.month, cents_per_litre: p.cents, cad_per_litre: roundTo(p.cents / 100, 3) })),
      other_fuels_same_city_and_month: r.others.map((o) => ({ fuel: o.fuel, definition: FUEL_MEMBERS[o.fuel]!.name, cents_per_litre: o.cents, cad_per_litre: roundTo(o.cents / 100, 3) })),
      what_this_is: "Average retail price per litre for the month, published by Statistics Canada with the Consumer Price Index. Not a station price and not a live price.",
      dataset: { name: q.tableTitle ?? "Monthly average retail prices for gasoline and fuel oil, by geography", table: "18-10-0001-01", url: INFO.homepage, released: r.releaseTime },
      attribution_notice: attribution,
      ...(q.placeNote ? { place_note: q.placeNote } : {}),
    },
  });
}

export async function caFuelNow(input: CaFuelInput, post?: Poster, today = new Date()): Promise<PriceAnswer> {
  const def = FUEL_MEMBERS[input.fuel];
  if (!def) {
    throw new InputError("Canada: Statistics Canada publishes regular unleaded (petrol95), premium unleaded (petrol98) and diesel only. E10, E85, LPG and CNG are not published.");
  }
  if (input.service === "served") {
    throw new InputError("Canada: only self-service prices are published; Statistics Canada stopped the full-service series with the January 2013 index. Leave service out or use self.");
  }
  const asked = (input.town ?? input.area ?? "").trim();
  if (!asked && input.postcode) throw new InputError("Canada: postcodes are not used. Give a city (town), for example Toronto, Vancouver or Montréal, or leave it out for the Canada average.");

  const meta: CubeMeta = await loadCubeMeta(PRODUCT_ID, post);
  const geo = dimension(meta, 1, "Geography");
  const fuels = dimension(meta, 2, "Type of fuel");
  const fuelIds = new Map<Fuel, number>();
  for (const f of FUEL_ORDER) {
    const m = memberByName(fuels, FUEL_MEMBERS[f]!.name);
    if (!m) throw new SourceError(`Statistics Canada changed table 18-10-0001-01 (no series "${FUEL_MEMBERS[f]!.name}"); this source needs updating.`);
    fuelIds.set(f, m.id);
  }

  let placeNote: string | undefined;
  let place: { id: number; name: string };
  if (!asked || NATIONAL_WORDS.has(asked.toLowerCase())) {
    const canada = memberByName(geo, "Canada");
    if (!canada) throw new SourceError("Statistics Canada changed table 18-10-0001-01 (no Canada member); this source needs updating.");
    place = { id: canada.id, name: canada.name };
  } else {
    // Canada itself is not a "town": offer only the cities.
    const m = resolvePlace(geo.members.filter((x) => x.name !== "Canada"), asked, "one of the cities Statistics Canada tracks (Toronto, Vancouver, Montréal, Calgary, Edmonton, Winnipeg, Halifax ...), or leave it out for the Canada average");
    place = { id: m.member.id, name: m.member.name };
    placeNote = m.note;
  }

  const coords = FUEL_ORDER.map((f) => coordinate([place.id, fuelIds.get(f)!]));
  const got = await latestPeriods(PRODUCT_ID, coords, 13, post);
  const series: Partial<Record<Fuel, DataSeries>> = {};
  FUEL_ORDER.forEach((f, i) => (series[f] = got[i]));
  const reading = readFuel(series, input.fuel, place);
  return caFuelAnswer(reading, { fuel: input.fuel, placeAsked: place, placeNote, tableTitle: meta.title, baseUrl: input.baseUrl, today });
}


// ---------- daily collector (stale-if-error copy) ----------
// Once a day the collector stores the newest published month for every city and fuel: 19 places x 3 fuels, at most 57 small rows, dated
// by the end of the reference month (rows are replaced in place until the next month is published, so the library grows by about
// 57 rows a month). The figure is one published average, so n is NO_COUNT (nominalCounts in the manifest). It is only used
// to answer when Statistics Canada does not respond; there is no /history for these monthly averages (noHistory in the manifest).

/** Library area for a place: "ALL" for Canada, otherwise the table's member name. */
export const fuelArea = (name: string) => (name === "Canada" ? NATIONAL_AREA : name);
const NATIONAL_AREA = "ALL";

/** Pure: one library row per place and fuel for the newest month any series has; series that lag behind are left out. */
export function fuelHarvestRows(series: { place: string; fuel: Fuel; data: DataSeries | undefined }[]): HarvestResult {
  const latest = series.map((s) => ({ ...s, point: newestUsable(s.data) })).filter((s) => s.point);
  if (!latest.length) throw new SourceError("Statistics Canada table 18-10-0001-01 returned no usable average for any city");
  const month = latest.map((s) => monthOf(s.point!.period)).sort().pop()!;
  const rows = latest
    .filter((s) => monthOf(s.point!.period) === month)
    .map((s) => {
      const v = roundTo(s.point!.value / 100, 3);
      return { area: fuelArea(s.place), item: s.fuel, n: NO_COUNT, median: v, low: v, high: v, min: v, max: v };
    });
  return {
    date: monthRange(month).to,
    currency: "CAD",
    unit: "per litre",
    rows,
    note: `Statistics Canada table 18-10-0001-01: monthly average retail price per litre (self-service) for ${monthWords(month)}, by city. Published averages, not counts of records (no record count is published).`,
  };
}

export async function caFuelHarvest(post?: Poster): Promise<HarvestResult> {
  const meta = await loadCubeMeta(PRODUCT_ID, post);
  const geo = dimension(meta, 1, "Geography");
  const fuels = dimension(meta, 2, "Type of fuel");
  const wanted: { place: string; fuel: Fuel; coord: string }[] = [];
  for (const f of FUEL_ORDER) {
    const m = memberByName(fuels, FUEL_MEMBERS[f]!.name);
    if (!m) throw new SourceError(`Statistics Canada changed table 18-10-0001-01 (no series "${FUEL_MEMBERS[f]!.name}"); this source needs updating.`);
    for (const g of geo.members.filter((x) => !x.terminated)) wanted.push({ place: g.name, fuel: f, coord: coordinate([g.id, m.id]) });
  }
  const got: DataSeries[] = [];
  for (let i = 0; i < wanted.length; i += 15) got.push(...(await latestPeriods(PRODUCT_ID, wanted.slice(i, i + 15).map((w) => w.coord), 2, post)));
  return fuelHarvestRows(wanted.map((w, i) => ({ place: w.place, fuel: w.fuel, data: got[i] })));
}

/** Where a request lives in the library, without asking Statistics Canada: the places are the areas of our newest stored day. */
export function caFuelHistoryKey(p: { fuel?: string; town?: string; area?: string }, areas: string[]): { area: string; item: string; label: string } | null {
  if (!FUEL_MEMBERS[p.fuel as Fuel]) return null;
  const asked = (p.town ?? p.area ?? "").trim();
  if (!asked || NATIONAL_WORDS.has(asked.toLowerCase())) return { area: NATIONAL_AREA, item: p.fuel!, label: "Canada" };
  const members = areas.filter((a) => a !== NATIONAL_AREA).map((name, i) => ({ id: i + 1, name, parent: null, terminated: false }));
  if (!members.length) return null;
  try {
    const m = resolvePlace(members, asked, "a city").member;
    return { area: m.name, item: p.fuel!, label: m.name };
  } catch {
    return null;
  }
}
