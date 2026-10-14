// Norway home prices from Statistics Norway (SSB), table 14310: "Average price per square meter and number of sales, by type of
// dwelling", by region (whole country, county, municipality) and quarter. Format checked live on 2026-10-14 through the GitHub probe
// (PxWebApi v2, JSON-stat 2.0, one GET per answer, no bulk download, no key).
//
// What SSB publishes: for each region, dwelling type and quarter, ONE average price per m² of usable floor area and the number of
// sales behind it. There is no distribution, so the answer is an official statistic: value + measure "average", range fields null,
// sample_size = the published number of sales. The change figures are calculated here from the published averages.

import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { InputError } from "../../lib/http";
import { parseJsonStat, periodRange, previousPeriod, resolveFetcher } from "../../lib/adapters";
import type { FetchOptions, JsonStatTable } from "../../lib/adapters";
import type { SourceInfo } from "../../lib/plugin";
import { confidenceLabel, MIN_PUBLISH } from "../../lib/stats";
import { NO_REGIONS } from "./places";

export const INFO: SourceInfo = {
  id: "no-home-prices",
  country: "NO (Norway)",
  category: "home sales (official price per m² of existing dwellings)",
  name: "Average price per square meter and number of sales, by type of dwelling (SSB table 14310)",
  publisher: "Statistics Norway (SSB)",
  what_is_recorded:
    "For each region (whole country, county or municipality), type of dwelling (all, detached houses, row houses, multi-dwelling buildings) and quarter: " +
    "the average price paid per square metre of usable floor area for existing dwellings, and the number of sales, as published by Statistics Norway " +
    "in its price statistics for existing dwellings. One published figure per cell; never individual sales or addresses.",
  price_type: "official_statistic",
  freshness: "Quarterly, published about two weeks after the quarter ends; each answer states its quarter and the newest quarter Statistics Norway holds for the place",
  licence:
    "Creative Commons Attribution 4.0 International (CC BY 4.0). Statistics Norway: \"We use the licence Creative Commons Attribution 4.0 International (CC BY 4.0)\"; " +
    "you may share and adapt the material for any purpose, even commercially, if you attribute Statistics Norway (SSB), link to the licence and indicate if changes were made",
  licence_url: "https://www.ssb.no/en/diverse/lisens",
  attribution:
    "Source: Statistics Norway (SSB), table 14310 \"Average price per square meter and number of sales, by type of dwelling\" (https://www.ssb.no/en/statbank/table/14310), " +
    "licensed CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Prices are passed on as published; the change between periods is calculated by ProofPrice.",
  homepage: "https://www.ssb.no/en/statbank/table/14310",
  limits:
    "An average price per square metre for the dwellings sold in a quarter, not a valuation or a quote for one home: it moves with the mix of homes sold (size, age, location). " +
    "Statistics Norway publishes no figure for a place or dwelling type with too few sales, so small municipalities are often missing. The series starts in 2025 " +
    "(a new definition: price per square metre of usable floor area, Norwegian standard NS 3940:2023). Norway is covered by price per square metre only; there is no price per home.",
};

export const SSB_API = "https://data.ssb.no/api/pxwebapi/v2";
export const TABLE = "14310";
/** Quarters asked for: the latest, the previous one and the same quarter a year earlier, with a spare. */
export const WINDOW_QUARTERS = 6;

// ---------- dwelling types ----------

export type TypeKey = "any" | "detached" | "terraced" | "flat";
export const TYPES: Record<TypeKey, { code: string; label: string }> = {
  any: { code: "00", label: "all dwellings" },
  detached: { code: "01", label: "detached houses" },
  terraced: { code: "02", label: "row houses" },
  flat: { code: "03", label: "multi-dwelling buildings (flats)" },
};
const TYPE_ORDER: TypeKey[] = ["any", "detached", "terraced", "flat"];

/** Fold a name for matching: lower case, no diacritics, Nordic letters spelled out, "aa" = "å", punctuation as single spaces. */
export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ø/g, "o")
    .replace(/æ/g, "ae")
    .replace(/ß/g, "ss")
    .replace(/aa/g, "a")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** "flat", "Apartment", "enebolig" -> a dwelling type. "house" means detached houses here. Throws InputError listing the choices. */
export function normaliseType(raw?: string): TypeKey {
  const s = fold(raw ?? "");
  if (["", "any", "all", "total", "alle"].includes(s)) return "any";
  if (["house", "houses", "detached", "detached house", "detached houses", "single family", "single family house", "enebolig", "eneboliger"].includes(s)) return "detached";
  if (["terraced", "terrace", "terraced house", "terraced houses", "row house", "row houses", "rowhouse", "townhouse", "town house", "rekkehus", "smahus"].includes(s)) return "terraced";
  if (["flat", "flats", "apartment", "apartments", "condo", "condominium", "multi dwelling", "block of flats", "blocks of flats", "leilighet", "blokk", "blokkleilighet"].includes(s)) return "flat";
  throw new InputError(`property_type for Norway must be one of: any (default), house or detached (detached houses), terraced (row houses), flat (multi-dwelling buildings). Not available: ${String(raw)}.`);
}

/** True when the caller asked for "house" rather than "detached": the answer then says that house means detached houses. */
export function askedForHouse(raw?: string): boolean {
  const s = fold(raw ?? "");
  return s === "house" || s === "houses";
}

// ---------- places ----------

export type Level = "country" | "county" | "municipality";
export interface Place {
  code: string;
  name: string; // SSB's label, e.g. "Oslo - Oslove"
  short: string; // first name, e.g. "Oslo"
  level: Level;
}

function levelOf(code: string): Level {
  return code === "0" ? "country" : code.length === 2 ? "county" : "municipality";
}

const PLACES: Place[] = [
  { code: "0", name: "The whole country", short: "Norway", level: "country" },
  ...NO_REGIONS.filter(([c]) => c !== "0").map(([code, name]) => ({ code, name, short: name.split(" - ")[0], level: levelOf(code) })),
];

/** Folded name -> places. Every Sami double name counts ("Guovdageaidnu - Kautokeino"), and so does the name without a "(county)" tag. */
const INDEX = new Map<string, Place[]>();
function addKey(key: string, p: Place) {
  const k = fold(key);
  if (!k) return;
  const list = INDEX.get(k) ?? [];
  if (!list.includes(p)) list.push(p);
  INDEX.set(k, list);
}
for (const p of PLACES) {
  for (const part of p.name.split(" - ")) {
    addKey(part, p);
    addKey(part.replace(/\s*\(.*\)\s*$/, ""), p);
  }
}
for (const k of ["norway", "norge", "whole country", "the whole country", "nationwide", "national", "hele landet", "landet"]) addKey(k, PLACES[0]);

const SUFFIX = /\s+(kommune|municipality|county|fylke)$/i;

/** Resolve a town or county name (with or without diacritics, any Sami name). Empty -> the whole country. Throws InputError if unknown or ambiguous. */
export function resolvePlace(town?: string): Place {
  const raw = (town ?? "").trim();
  if (!raw) return PLACES[0];
  const key = fold(raw.replace(SUFFIX, ""));
  const hits = INDEX.get(key);
  if (hits && hits.length === 1) return hits[0];
  if (hits && hits.length > 1) {
    throw new InputError(`"${raw}" matches several places in Norway: ${hits.map((p) => p.name).join("; ")}. Use one of those names.`);
  }
  const near = PLACES.filter((p) => fold(p.name).includes(key) && key.length >= 3).slice(0, 5);
  throw new InputError(
    `Statistics Norway has no region called "${raw}". Use a municipality (kommune) such as Oslo, Bergen, Tromsø or Stavanger, or a county such as Rogaland or Vestland.` +
      (near.length ? ` Did you mean: ${near.map((p) => p.name).join("; ")}?` : ""),
  );
}

// ---------- periods ----------

/** SSB quarter code "2026K3" -> "2026-Q3". Anything else is returned unchanged. */
export function isoQuarter(code: string): string {
  const m = /^(\d{4})K([1-4])$/.exec(code);
  return m ? `${m[1]}-Q${m[2]}` : code;
}

/** "2026-Q3" -> "the third quarter of 2026". */
export function periodWords(code: string): string {
  const m = /^(\d{4})-Q([1-4])$/.exec(code);
  return m ? `the ${["first", "second", "third", "fourth"][Number(m[2]) - 1]} quarter of ${m[1]}` : code;
}

/** The same quarter one year earlier: "2026-Q3" -> "2025-Q3". */
export function yearEarlier(code: string): string | null {
  const m = /^(\d{4})-Q([1-4])$/.exec(code);
  return m ? `${Number(m[1]) - 1}-Q${m[2]}` : null;
}

const roundTo = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;
export const changePercent = (now: number, then: number) => roundTo(((now - then) / then) * 100, 1);

// ---------- reading the cube (pure) ----------

export interface Point {
  reference_period: string;
  price: number;
  sales: number | null;
}
export interface Change {
  reference_period: string;
  price: number;
  change_percent: number;
}
export interface TypeFigure {
  type: TypeKey;
  label: string;
  price: number;
  sales: number | null;
}
export interface Reading {
  place: Place;
  type: TypeKey;
  reference_period: string;
  price: number;
  sales: number | null;
  previous: Change | null;
  year_earlier: Change | null;
  national: { price: number; sales: number | null } | null;
  by_type: TypeFigure[];
  datasetLatest: string | null;
  datasetTitle: string | null;
  datasetUpdated: string | null;
}

function point(table: JsonStatTable, region: string, type: TypeKey, time: string): Point | null {
  const find = (contents: string) =>
    table.rows.find((r) => r.Region === region && r.Boligtype === TYPES[type].code && r.ContentsCode === contents && r.Tid === time);
  const p = find("KvPris");
  if (!p || p.value === null || !(p.value > 0)) return null;
  const n = find("Omsetninger");
  return { reference_period: isoQuarter(time), price: p.value, sales: n && n.value !== null ? n.value : null };
}

/** The quarter codes of the cube, oldest first. */
function quarters(table: JsonStatTable): string[] {
  return [...(table.codes.Tid ?? [])].sort();
}

/**
 * From a parsed table-14310 slice pick the answer for one place: the latest quarter with a price for the chosen type, the previous
 * quarter, the same quarter a year earlier, the national average for that quarter, and every dwelling type for the place.
 * Returns null when SSB holds no price for the place and type in the window.
 */
export function readNorway(table: JsonStatTable, q: { place: Place; type: TypeKey }): Reading | null {
  const times = quarters(table);
  const latestTime = [...times].reverse().find((t) => point(table, q.place.code, q.type, t));
  if (!latestTime) return null;
  const main = point(table, q.place.code, q.type, latestTime)!;
  const at = (iso: string | null): Point | null => {
    if (!iso) return null;
    const t = times.find((x) => isoQuarter(x) === iso);
    return t ? point(table, q.place.code, q.type, t) : null;
  };
  const change = (p: Point | null): Change | null =>
    p ? { reference_period: p.reference_period, price: p.price, change_percent: changePercent(main.price, p.price) } : null;
  const nat = q.place.code === "0" ? null : point(table, "0", q.type, latestTime);
  const by_type: TypeFigure[] = [];
  for (const k of TYPE_ORDER) {
    const p = point(table, q.place.code, k, latestTime);
    if (p) by_type.push({ type: k, label: TYPES[k].label, price: p.price, sales: p.sales });
  }
  return {
    place: q.place,
    type: q.type,
    reference_period: main.reference_period,
    price: main.price,
    sales: main.sales,
    previous: change(at(previousPeriod(main.reference_period))),
    year_earlier: change(at(yearEarlier(main.reference_period))),
    national: nat ? { price: nat.price, sales: nat.sales } : null,
    by_type,
    datasetLatest: times.length ? isoQuarter(times[times.length - 1]) : null,
    datasetTitle: table.label,
    datasetUpdated: table.updated,
  };
}

// ---------- the answer (pure) ----------

const DAY = 86400000;

/** Plain-words caveat when a figure is old (over 15 months since its period ended). */
export function ageNote(periodTo: string | null, now: Date): string | null {
  if (!periodTo) return null;
  const days = Math.round((now.getTime() - Date.parse(periodTo + "T23:59:59Z")) / DAY);
  if (days <= 450) return null;
  return `This figure is old: its period ended about ${Math.round(days / 30)} months ago.`;
}

function oneChange(c: Change, label: string): string {
  if (c.change_percent === 0) return `unchanged from ${label.replace(/^in /, "")}`;
  return `${Math.abs(c.change_percent)}% ${c.change_percent > 0 ? "higher" : "lower"} than ${label}`;
}

/** "That is 0.3% lower than in the second quarter of 2026 and unchanged from a year earlier (the third quarter of 2025)." */
export function changeSentence(previous: Change | null, yearAgo: Change | null): string {
  const parts: string[] = [];
  if (previous) parts.push(oneChange(previous, `in ${periodWords(previous.reference_period)}`));
  if (yearAgo) parts.push(oneChange(yearAgo, `a year earlier (${periodWords(yearAgo.reference_period)})`));
  return parts.length ? ` That is ${parts.join(" and ")}.` : "";
}

export const METHOD =
  "Statistics Norway (SSB) publishes, each quarter, the average price paid per square metre of usable floor area for existing dwellings, and the number of sales, " +
  `by region and dwelling type (table ${TABLE}). ProofPrice returns the published average for the latest quarter SSB holds for the place and dwelling type, unchanged, ` +
  "with the previous quarter, the same quarter a year earlier and the national average. The change percentages are calculated by ProofPrice from the published averages; " +
  "they are not a price index, because the mix of homes sold changes from quarter to quarter. No range is calculated: SSB publishes one average and the number of sales behind it.";

export interface AnswerInput {
  place: Place;
  type: TypeKey;
  requestedType?: string;
  baseUrl?: string;
  apiUrl?: string;
  now?: Date;
  notes?: string[];
}

export function norwayAnswer(reading: Reading | null, q: AnswerInput): PriceAnswer {
  const now = q.now ?? new Date();
  const query = { country: "NO", town: q.place.short, property_type: q.type };
  const base = { source: INFO, query, measure: "average" as const, currency: "NOK", unit: "per m²", method: METHOD, baseUrl: q.baseUrl };
  const where = q.place.level === "country" ? "Norway" : q.place.short;

  if (!reading) {
    const none = buildStatisticAnswer({ ...base, value: null, period: { from: null, to: null }, reference_period: "", describe: () => "" });
    return {
      ...none,
      summary:
        `Statistics Norway publishes no price per m² for ${TYPES[q.type].label} in ${where} in the last ${WINDOW_QUARTERS} quarters ` +
        "(too few sales, or the place is not covered). Try the county or the whole country.",
    };
  }

  const r = reading;
  const range = periodRange(r.reference_period);
  const notes: string[] = [];
  if (askedForHouse(q.requestedType)) notes.push("Statistics Norway has no single 'house' group: house is answered with detached houses; row houses (terraced) are listed under by_type.");
  if (r.datasetLatest && r.reference_period < r.datasetLatest) {
    notes.push(`This is the latest quarter Statistics Norway holds for ${where}; ${periodWords(r.datasetLatest)} has been published for other places.`);
  }
  const old = ageNote(range?.to ?? null, now);
  if (old) notes.push(old);
  if (r.sales !== null && r.sales < 30) notes.push(`Only ${r.sales} sales stand behind this average, so it is volatile.`);
  if (q.notes) notes.push(...q.notes);

  const extra: Record<string, unknown> = {
    place: { code: r.place.code, name: r.place.short, ssb_name: r.place.name, level: r.place.level },
    property_type: { used: r.type, code: TYPES[r.type].code, label: TYPES[r.type].label },
    reference_period_label: periodWords(r.reference_period),
    price_per_m2_by_type: r.by_type.map((t) => ({ type: t.type, label: t.label, price: t.price, sales: t.sales })),
    previous_period: r.previous,
    year_earlier: r.year_earlier,
    ...(r.national ? { national_average: { price: r.national.price, sales: r.national.sales, reference_period: r.reference_period } } : {}),
    dataset: {
      table: TABLE,
      title: r.datasetTitle,
      updated: r.datasetUpdated,
      latest_period_in_dataset: r.datasetLatest,
      url: INFO.homepage,
    },
    ...(q.apiUrl ? { ssb_api_url: q.apiUrl } : {}),
  };

  const stat = buildStatisticAnswer({
    ...base,
    value: r.price,
    period: range ?? { from: null, to: null },
    reference_period: r.reference_period,
    sample_size: r.sales,
    note: notes.length ? notes.join(" ") : undefined,
    describe: (v) =>
      `In ${where} the average price paid per m² for ${TYPES[r.type].label} (existing dwellings) was ${fmtMoney(v, "NOK")} in ${periodWords(r.reference_period)}` +
      (r.sales !== null ? `, from ${r.sales.toLocaleString("en-GB")} sales.` : ".") +
      changeSentence(r.previous, r.year_earlier),
    extra,
  });

  // The publisher gives the number of sales, so confidence follows it, and a figure from fewer than 5 sales is not published.
  if (r.sales !== null) {
    if (r.sales < MIN_PUBLISH) {
      return {
        ...stat,
        status: "insufficient_data",
        price: null,
        confidence: "insufficient",
        summary: `Statistics Norway reports only ${r.sales} sale(s) behind this average for ${where}; at least ${MIN_PUBLISH} are needed before we publish a figure.`,
      };
    }
    stat.confidence = confidenceLabel(r.sales);
  }
  return stat;
}

// ---------- the request ----------

/** One GET for the place and the whole country: every dwelling type, price and number of sales, the last WINDOW_QUARTERS quarters. */
export function dataUrl(regions: string[], base = SSB_API): string {
  const q = [
    "lang=en",
    "outputFormat=json-stat2",
    `valueCodes%5BRegion%5D=${regions.join(",")}`,
    `valueCodes%5BBoligtype%5D=${TYPE_ORDER.map((k) => TYPES[k].code).join(",")}`,
    "valueCodes%5BContentsCode%5D=KvPris,Omsetninger",
    `valueCodes%5BTid%5D=top(${WINDOW_QUARTERS})`,
  ];
  return `${base}/tables/${TABLE}/data?${q.join("&")}`;
}

export interface NorwayInput {
  town?: string;
  postcode?: string;
  property_type?: string;
  baseUrl?: string;
}

export async function norwayHomePrices(input: NorwayInput, o: FetchOptions & { now?: Date; apiBase?: string } = {}): Promise<PriceAnswer> {
  const type = normaliseType(input.property_type);
  const place = resolvePlace(input.town);
  const notes: string[] = [];
  if (input.postcode && !input.town) {
    throw new InputError("Norway's home prices are published by municipality or county, not by postcode. Give town (for example Oslo, Bergen, Tromsø) or leave it out for the whole country.");
  }
  if (input.postcode) notes.push(`The postcode ${input.postcode} was ignored: Statistics Norway publishes by municipality, not postcode.`);
  const regions = place.code === "0" ? ["0"] : [place.code, "0"];
  const url = dataUrl(regions, o.apiBase);
  const table = parseJsonStat(await resolveFetcher(o)(url));
  const reading = readNorway(table, { place, type });
  return norwayAnswer(reading, { place, type, requestedType: input.property_type, baseUrl: input.baseUrl, apiUrl: url, now: o.now, notes });
}
