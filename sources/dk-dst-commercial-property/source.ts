// Denmark commercial property from Statistics Denmark (Danmarks Statistik), StatBank table EJEN77 "Sales of real property" (the table
// dk-home-prices reads for homes). Here: category 0301 "Business properties" and 0401 "Industrial properties and warehouses", ordinary
// free-trade sales, key figures 2 (sales in the price calculation) and 3 (average price per property, DKK 1,000), by region/province, quarterly.
// Format checked live on 2026-11-04 (curl api.statbank.dk from the build workspace, see fixtures.ts). Building sites (0903) have a sales COUNT only
// (key 1), no price, so property_type=land is answered with a plain "not published".
import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import { periodRange, previousPeriod, resolveFetcher } from "../../lib/adapters";
import type { FetchOptions, JsonStatTable } from "../../lib/adapters";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { confidenceLabel, MIN_PUBLISH, NO_COUNT } from "../../lib/stats";
import {
  ageNote, changePercent, DST_API, isoQuarter, isPreliminary, municipalitiesIn, parseStatbank, periodWords, quarterEnd, resolvePlace, yearEarlier,
} from "../dk-home-prices/source";
import type { Place } from "../dk-home-prices/source";
import { DK_PROVINCES, DK_REGIONS } from "../dk-home-prices/places";

export const INFO: SourceInfo = {
  id: "dk-dst-commercial-property",
  country: "DK (Denmark)",
  category: "commercial property (official average price per property: business properties, industrial properties and warehouses)",
  name: "Sales of real property: business and industrial properties, average price per property (Statistics Denmark table EJEN77)",
  publisher: "Statistics Denmark (Danmarks Statistik)",
  what_is_recorded:
    "For All Denmark, each of the 5 regions and each of the 11 provinces (landsdele), and each quarter: the average purchase price per property, and the number of sales in the price calculation, " +
    "for ordinary free-trade sales of business properties (shops, offices, hotels and the like) and of industrial properties and warehouses, as published by Statistics Denmark in 'Sales of real property'. " +
    "One published figure per cell; never individual sales or addresses.",
  price_type: "official_statistic",
  freshness:
    "Quarterly, published about three months after the quarter ends (the latest quarter is marked preliminary; figures become final 13 months after the quarter). Each answer states its quarter.",
  licence:
    "Statistics Denmark: \"All statistics on Statistikbanken.dk and the website dst.dk can be used free of charge commercially as well as non-commercially. " +
    "It is, however, required to indicate the source. This corresponds to the license known as Creative Commons, CC 4.0 BY\"",
  licence_url: "https://www.dst.dk/en/presse/kildeangivelse",
  attribution:
    "Source: Statistics Denmark (Danmarks Statistik), StatBank table EJEN77 \"Sales of real property\" (https://api.statbank.dk/v1/tableinfo/EJEN77?lang=en), " +
    "used under the terms at https://www.dst.dk/en/presse/kildeangivelse (CC 4.0 BY). Prices are passed on as published; the combined figure and the changes between periods are own calculations by ProofPrice.",
  homepage: "https://www.dst.dk/en/Statistik/dokumentation/documentationofstatistics/sales-of-real-property",
  limits:
    "An average price per PROPERTY (not per square metre) for the properties sold in a quarter, so it moves with the mix of properties sold and a few large deals can move it a lot; there is no median or range. " +
    "Published by province and region only (a town is answered with the province it lies in). Business properties and industrial properties/warehouses are published as two groups; the headline is their sales-weighted mean. " +
    "A group with fewer than 5 sales in the price calculation is left out. Building sites have no published price. Statistics Denmark says preliminary average prices are underestimated.",
};

export const TABLE = "EJEN77";
export const GROUPS = [
  { key: "business", code: "0301", label: "business properties", noun: "business properties (shops, offices and the like)" },
  { key: "industrial", code: "0401", label: "industrial properties and warehouses", noun: "industrial properties and warehouses" },
] as const;
const SALES_KEY = "2";
const PRICE_KEY = "3";
const FREE_TRADE = "1";

export const METHOD =
  "Statistics Denmark publishes, each quarter, the average purchase price per property for ordinary free-trade sales of business properties and of industrial properties and warehouses, " +
  `and the number of sales behind each average, by province and region (table ${TABLE}, key figures 3 and 2). ProofPrice takes the latest quarter in which the place has at least ${MIN_PUBLISH} sales ` +
  "and returns the sales-weighted mean of the two published averages (a group with fewer than 5 sales is left out), with the previous quarter and the year before. " +
  "A town is answered with the province it lies in. The result is a price per property, not per square metre; it is an official statistic, not a list of sales, and no range is calculated.";

// ---------- reading the cube (pure) ----------

type Index = Map<string, number>;
function indexOf(table: JsonStatTable): Index {
  const idx: Index = new Map();
  for (const r of table.rows) idx.set(`${r["OMRÅDE"]}|${r["EJENDOMSKATE"]}|${r["BNØGLE"]}|${r["OVERDRAG"]}|${r["Tid"]}`, r.value as number);
  return idx;
}
interface GroupPoint { key: string; label: string; sales: number; average: number }
interface Combined { reference_period: string; sales: number; average: number; groups: GroupPoint[]; hidden: string[] }

function pointsAt(idx: Index, region: string, time: string): { used: GroupPoint[]; hidden: string[] } {
  const used: GroupPoint[] = [];
  const hidden: string[] = [];
  for (const g of GROUPS) {
    const get = (k: string) => idx.get(`${region}|${g.code}|${k}|${FREE_TRADE}|${time}`);
    const price = get(PRICE_KEY);
    const sales = get(SALES_KEY);
    if (price !== undefined && price > 0 && sales !== undefined && sales >= MIN_PUBLISH) used.push({ key: g.key, label: g.label, sales, average: price * 1000 });
    else hidden.push(g.label);
  }
  return { used, hidden };
}
function combine(idx: Index, region: string, time: string): Combined | null {
  const { used, hidden } = pointsAt(idx, region, time);
  const sales = used.reduce((s, u) => s + u.sales, 0);
  if (sales < MIN_PUBLISH) return null;
  const average = used.reduce((s, u) => s + u.sales * u.average, 0) / sales;
  return { reference_period: isoQuarter(time), sales, average, groups: used, hidden };
}

export interface Change { reference_period: string; average: number; sales: number; change_percent: number }
export interface Reading {
  place: Place;
  main: Combined;
  previous: Change | null;
  year_earlier: Change | null;
  national: { average: number; sales: number } | null;
  datasetLatest: string | null;
  datasetTitle: string | null;
  datasetUpdated: string | null;
}

/** The latest quarter in which the place has >= 5 commercial sales behind a published price, with comparisons. Null when none. */
export function readCommercial(table: JsonStatTable, place: Place): Reading | null {
  const idx = indexOf(table);
  const times = [...(table.codes["Tid"] ?? [])].sort();
  const region = place.dataCode;
  let t: string | null = null;
  let main: Combined | null = null;
  for (let i = times.length - 1; i >= 0; i--) {
    const c = combine(idx, region, times[i]);
    if (c) { t = times[i]; main = c; break; }
  }
  if (!t || !main) return null;
  const compare = (iso: string | null): Change | null => {
    if (!iso) return null;
    const code = times.find((x) => isoQuarter(x) === iso);
    if (!code) return null;
    const c = combine(idx, region, code);
    return c ? { reference_period: iso, average: c.average, sales: c.sales, change_percent: changePercent(main!.average, c.average) } : null;
  };
  const nat = region === "000" ? null : combine(idx, "000", t);
  return {
    place,
    main,
    previous: compare(previousPeriod(main.reference_period)),
    year_earlier: compare(yearEarlier(main.reference_period)),
    national: nat ? { average: nat.average, sales: nat.sales } : null,
    datasetLatest: times.length ? isoQuarter(times[times.length - 1]) : null,
    datasetTitle: table.label,
    datasetUpdated: table.updated,
  };
}

// ---------- the answer (pure) ----------

function oneChange(c: Change, label: string): string {
  if (c.change_percent === 0) return `unchanged from ${label.replace(/^in /, "")}`;
  return `${Math.abs(c.change_percent)}% ${c.change_percent > 0 ? "higher" : "lower"} than ${label}`;
}
export function changeSentence(previous: Change | null, yearAgo: Change | null): string {
  const parts: string[] = [];
  if (previous) parts.push(oneChange(previous, `in ${periodWords(previous.reference_period)}`));
  if (yearAgo) parts.push(oneChange(yearAgo, `a year earlier (${periodWords(yearAgo.reference_period)})`));
  return parts.length ? ` That is ${parts.join(" and ")}.` : "";
}

const where = (p: Place) => (p.level === "country" ? "Denmark" : p.level === "municipality" ? `${p.short} (province ${p.dataShort})` : p.short);

export interface AnswerInput { place: Place; baseUrl?: string; apiUrl?: string; now?: Date; notes?: string[] }

export function denmarkCommercialAnswer(reading: Reading | null, q: AnswerInput): PriceAnswer {
  const now = q.now ?? new Date();
  const place = q.place;
  const base = { source: INFO, query: { country: "DK", town: place.short, property_type: "commercial" }, measure: "average" as const, currency: "DKK", unit: "per property", method: METHOD, baseUrl: q.baseUrl };
  if (!reading) {
    const none = buildStatisticAnswer({ ...base, value: null, period: { from: null, to: null }, reference_period: "", describe: () => "" });
    return {
      ...none,
      summary:
        `Statistics Denmark publishes no average price for commercial properties in ${where(place)} backed by at least ${MIN_PUBLISH} sales in any quarter. ` +
        "Try a larger area such as the region, or all of Denmark (leave town out).",
    };
  }
  const m = reading.main;
  const range = periodRange(m.reference_period);
  const prelim = isPreliminary(range?.to ?? null, now);
  const notes: string[] = [
    "Average price per property (not per m2), a sales-weighted mean of Statistics Denmark's two commercial groups; a few large sales can move it a lot. Building sites and farms are not included.",
  ];
  if (place.level === "municipality") {
    const covers = municipalitiesIn(place.dataCode);
    notes.push(
      `Statistics Denmark publishes this table by province, not by municipality: the figure is for ${place.dataShort}, the province where ${place.short} lies` + (covers.length <= 3 ? ` (${covers.join(", ")}).` : "."),
    );
  }
  if (m.hidden.length) notes.push(`Not included (fewer than ${MIN_PUBLISH} sales or no published price in this quarter): ${m.hidden.join("; ")}.`);
  if (prelim) {
    notes.push("Preliminary: Statistics Denmark says preliminary average prices are underestimated and become final 13 months after the quarter, so a change against an older, final quarter can understate a rise.");
  }
  if (reading.datasetLatest && m.reference_period < reading.datasetLatest) {
    notes.push(`${periodWords(reading.datasetLatest)} has been published, but ${place.dataShort} has fewer than ${MIN_PUBLISH} commercial sales behind a price there; this is the latest quarter with enough.`);
  }
  const old = ageNote(range?.to ?? null, now);
  if (old) notes.push(old);
  if (m.sales < 30) notes.push(`Only ${m.sales} sales stand behind this average, so it is volatile.`);
  if (q.notes) notes.push(...q.notes);

  const stat = buildStatisticAnswer({
    ...base,
    value: m.average,
    period: range ?? { from: null, to: null },
    reference_period: m.reference_period,
    sample_size: m.sales,
    note: notes.join(" "),
    describe: (v) =>
      `In ${where(place)} the average price of a commercial property (business properties, industrial properties and warehouses; ordinary free-trade sales) was ${fmtMoney(v, "DKK")} per property in ${periodWords(m.reference_period)}` +
      `${prelim ? " (preliminary; Statistics Denmark says preliminary averages are underestimated)" : ""}, from ${m.sales.toLocaleString("en-GB")} sales.` +
      changeSentence(reading.previous, reading.year_earlier),
    extra: {
      place: { code: place.code, name: place.short, level: place.level, figure_is_for: { code: place.dataCode, name: place.dataShort } },
      price_basis: "average purchase price per property, DKK (not per m2)",
      reference_period_label: periodWords(m.reference_period),
      preliminary: prelim,
      by_group: m.groups.map((g) => ({ group: g.label, sales: g.sales, average_price: Math.round(g.average) })),
      groups_not_shown: m.hidden,
      previous_period: reading.previous,
      year_earlier: reading.year_earlier,
      ...(reading.national ? { national_average: { ...reading.national, reference_period: m.reference_period } } : {}),
      dataset: { table: TABLE, title: reading.datasetTitle, updated: reading.datasetUpdated, latest_period_in_dataset: reading.datasetLatest, url: INFO.homepage },
      ...(q.apiUrl ? { statbank_api_url: q.apiUrl } : {}),
    },
  });
  stat.confidence = confidenceLabel(m.sales);
  return stat;
}

// ---------- the request ----------

/** One GET for the place's area and the whole country: both commercial groups, price and number of sales, ordinary free trade, every quarter. */
export function dataUrl(regions: string[], base = DST_API): string {
  const q = [
    "lang=en",
    `OMR%C3%85DE=${regions.join(",")}`,
    `EJENDOMSKATE=${GROUPS.map((g) => g.code).join(",")}`,
    `BN%C3%98GLE=${SALES_KEY},${PRICE_KEY}`,
    `OVERDRAG=${FREE_TRADE}`,
    "Tid=*",
  ];
  return `${base}/data/${TABLE}/JSONSTAT?${q.join("&")}`;
}

export interface DkCommercialInput { town?: string; postcode?: string; property_type?: string; baseUrl?: string }

export async function denmarkCommercialProperty(input: DkCommercialInput, o: FetchOptions & { now?: Date; apiBase?: string } = {}): Promise<PriceAnswer> {
  if (input.property_type === "land") {
    throw new InputError("Denmark has no building-plot price in this statistic: Statistics Denmark publishes only the number of building sites sold, not a price. Use property_type=commercial (business properties, industrial properties and warehouses).");
  }
  if (input.postcode && !input.town) {
    throw new InputError("Denmark's commercial property prices are published by province and region, not by postcode. Give town (for example København, Aarhus, Odense, Fyn) or leave it out for all of Denmark.");
  }
  const place = resolvePlace(input.town);
  const notes: string[] = [];
  if (input.postcode) notes.push(`The postcode ${input.postcode} was ignored: Statistics Denmark publishes by province, not postcode.`);
  const regions = place.dataCode === "000" ? ["000"] : [place.dataCode, "000"];
  const url = dataUrl(regions, o.apiBase);
  const table = parseStatbank(await resolveFetcher(o)(url));
  return denmarkCommercialAnswer(readCommercial(table, place), { place, baseUrl: input.baseUrl, apiUrl: url, now: o.now, notes });
}

// ---------- daily collector (stale-if-error copy and history) ----------
// One cube request; the newest national quarter for every region/province (and all of Denmark) that has >= 5 commercial sales in THAT quarter.
// Rows dated by the quarter's end (referenceDates); n = NO_COUNT (one published average, not a record sample).

export const HARVEST_ITEM = "commercial";

export function harvestUrl(base = DST_API): string {
  return dataUrl(["000", ...DK_REGIONS.map(([c]) => c), ...DK_PROVINCES.map(([c]) => c)], base);
}

export function harvestRows(table: JsonStatTable): HarvestResult {
  const idx = indexOf(table);
  const times = [...(table.codes["Tid"] ?? [])].sort();
  let national: string | null = null;
  for (let i = times.length - 1; i >= 0; i--) if (combine(idx, "000", times[i])) { national = times[i]; break; }
  if (!national) throw new SourceError("Statistics Denmark returned no national commercial property price to collect");
  const regions = [...new Set(table.rows.map((r) => String(r["OMRÅDE"])))].filter((c) => c === "000" || DK_REGIONS.some(([x]) => x === c) || DK_PROVINCES.some(([x]) => x === c));
  const rows: DailyRow[] = [];
  for (const region of regions) {
    const c = combine(idx, region, national);
    if (!c) continue;
    const v = Math.round(c.average);
    rows.push({ area: region, item: HARVEST_ITEM, n: NO_COUNT, median: v, low: v, high: v, min: v, max: v });
  }
  return {
    date: quarterEnd(national),
    currency: "DKK",
    unit: "per property",
    rows,
    note: `Statistics Denmark table ${TABLE}: sales-weighted average price per property of ordinary free-trade sales of business and industrial properties in ${isoQuarter(national)}, ${rows.length} areas. Published averages, not counts of records.`,
  };
}

export async function dkCommercialHarvest(o: FetchOptions & { apiBase?: string } = {}): Promise<HarvestResult> {
  return harvestRows(parseStatbank(await resolveFetcher(o)(harvestUrl(o.apiBase))));
}

export function dkCommercialHistoryKey(p: { town?: string; postcode?: string; property_type?: string }): { area: string; item: string; label: string } | null {
  try {
    if (p.postcode && !p.town) return null;
    if (p.property_type === "land") return null;
    const place = resolvePlace(p.town);
    return { area: place.dataCode, item: HARVEST_ITEM, label: place.dataShort };
  } catch {
    return null;
  }
}
