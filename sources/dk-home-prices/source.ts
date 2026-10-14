// Denmark home prices from Statistics Denmark (Danmarks Statistik), StatBank table EJEN77 "Sales of real property by region, category of
// real property, key figures, type of transfer and time". Format checked live on 2026-10-14 through the GitHub probe (StatBank API v1,
// one GET per answer, JSONSTAT (v1) cube, no key, no sign-up).
//
// What Statistics Denmark publishes: for All Denmark, 5 regions and 11 provinces ("landsdele"), for each category of property (we use
// one-family houses and owner-occupied flats), each quarter, ordinary free-trade sales: ONE average price per property (DKK 1,000) and the
// number of sales behind it. There is no median, no distribution, no price per m² and no municipality. So the answer is an official
// statistic: value + measure "average", range fields null, sample_size = the published number of sales. The change figures are
// calculated here from the published averages. A municipality is answered with the province it lies in, and the answer says so.

import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import { parseJsonStat, periodRange, previousPeriod, resolveFetcher } from "../../lib/adapters";
import type { FetchOptions, JsonStatTable } from "../../lib/adapters";
import type { SourceInfo } from "../../lib/plugin";
import { confidenceLabel, MIN_PUBLISH } from "../../lib/stats";
import { DK_MUNICIPALITIES, DK_PROVINCES, DK_REGIONS, PROVINCE_REGION } from "./places";

export const INFO: SourceInfo = {
  id: "dk-home-prices",
  country: "DK (Denmark)",
  category: "home sales (official average price per property)",
  name: "Sales of real property: average price per property and number of sales (Statistics Denmark table EJEN77)",
  publisher: "Statistics Denmark (Danmarks Statistik)",
  what_is_recorded:
    "For All Denmark, each of the 5 regions and each of the 11 provinces (landsdele), and each quarter: the average purchase price per property, and the number of sales " +
    "in the price calculation, for ordinary free-trade sales of one-family houses and of owner-occupied flats, as published by Statistics Denmark in its statistics " +
    "'Sales of real property'. One published figure per cell; never individual sales or addresses.",
  price_type: "official_statistic",
  freshness:
    "Quarterly, published about three months after the quarter ends (the latest quarter is marked preliminary; Statistics Denmark's figures become final 13 months after the quarter). " +
    "Each answer states its quarter and whether it is preliminary",
  licence:
    "Statistics Denmark: \"All statistics on Statistikbanken.dk and the website dst.dk can be used free of charge commercially as well as non-commercially. " +
    "It is, however, required to indicate the source. This corresponds to the license known as Creative Commons, CC 4.0 BY\"",
  licence_url: "https://www.dst.dk/en/presse/kildeangivelse",
  attribution:
    "Source: Statistics Denmark (Danmarks Statistik), StatBank table EJEN77 \"Sales of real property\" (https://api.statbank.dk/v1/tableinfo/EJEN77?lang=en), " +
    "used under the terms at https://www.dst.dk/en/presse/kildeangivelse (CC BY 4.0). Prices are passed on as published; the changes between periods are own calculations by ProofPrice.",
  homepage: "https://www.dst.dk/en/Statistik/dokumentation/documentationofstatistics/sales-of-real-property",
  limits:
    "An average price per property for the properties sold in a quarter (land and new-builds included), not a valuation or a quote for one home: it moves with the mix of properties sold. " +
    "Published by province (landsdel) and region only, so a town is answered with the province it lies in; there is no median and no price per square metre. " +
    "Statistics Denmark says preliminary average prices are underestimated, because they are not corrected for the bias in the registration pattern; figures become final 13 months after the quarter. " +
    "Flats are owner-occupied flats (ejerlejligheder). Statistics Denmark gives no figure for a province and category with too few sales.",
};

export const DST_API = "https://api.statbank.dk/v1";
export const TABLE = "EJEN77";

// ---------- property types ----------

export type TypeKey = "any" | "house" | "detached" | "terraced" | "flat";
export type Category = "house" | "flat";
export const CATEGORIES: Record<Category, { code: string; label: string; noun: string }> = {
  house: { code: "0111", label: "one-family houses", noun: "a one-family house" },
  flat: { code: "2103", label: "owner-occupied flats", noun: "an owner-occupied flat" },
};
const SALES_KEY = "2"; // "Sales in the price calculation (number)"
const PRICE_KEY = "3"; // "Average price per property (dkk 1000)"
const FREE_TRADE = "1"; // "Ordinary free trade"

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

/** "flat", "Ejerlejlighed", "parcelhus" -> a property type. Throws InputError listing the choices. */
export function normaliseType(raw?: string): TypeKey {
  const s = fold(raw ?? "");
  if (["", "any", "all", "total", "alle"].includes(s)) return "any";
  if (["house", "houses", "one family house", "one family houses", "single family house", "single family", "home", "villa", "parcelhus", "parcelhuse", "enfamiliehus", "enfamiliehuse"].includes(s)) return "house";
  if (["detached", "detached house", "detached houses", "fritliggende", "fritliggende hus"].includes(s)) return "detached";
  if (["terraced", "terrace", "terraced house", "terraced houses", "row house", "row houses", "rowhouse", "townhouse", "town house", "semi detached", "rakkehus", "raekkehus"].includes(s)) return "terraced";
  if (["flat", "flats", "apartment", "apartments", "condo", "condominium", "owner occupied flat", "owner occupied flats", "ejerlejlighed", "ejerlejligheder", "lejlighed", "lejligheder"].includes(s)) return "flat";
  throw new InputError(`property_type for Denmark must be one of: any (default), house (one-family houses), flat (owner-occupied flats). Detached and terraced are not published separately. Not available: ${String(raw)}.`);
}

// ---------- places ----------

export type Level = "country" | "region" | "province" | "municipality";
export interface Place {
  /** What was named: the municipality, province or region code, or "000" for all of Denmark. */
  code: string;
  level: Level;
  /** Name as published, e.g. "Province Østjylland", or the municipality name. */
  name: string;
  /** Short name used in answers, e.g. "Østjylland", "Aarhus". */
  short: string;
  /** The EJEN77 region code that holds the figure (the province for a municipality). */
  dataCode: string;
  dataShort: string;
}

const RANK: Record<Level, number> = { municipality: 0, province: 1, region: 2, country: 3 };
const COUNTRY: Place = { code: "000", level: "country", name: "All Denmark", short: "Denmark", dataCode: "000", dataShort: "Denmark" };

function buildPlaces(): Place[] {
  const provinceShort = new Map(DK_PROVINCES.map(([c, , s]) => [c, s] as const));
  const out: Place[] = [COUNTRY];
  for (const [code, name, short] of DK_REGIONS) out.push({ code, level: "region", name, short, dataCode: code, dataShort: short });
  for (const [code, name, short] of DK_PROVINCES) out.push({ code, level: "province", name, short, dataCode: code, dataShort: short });
  for (const [code, [name, province]] of Object.entries(DK_MUNICIPALITIES)) {
    out.push({ code, level: "municipality", name, short: name, dataCode: province, dataShort: provinceShort.get(province) ?? province });
  }
  return out;
}
export const PLACES: Place[] = buildPlaces();
const byKey = (level: Level, code: string) => PLACES.find((p) => p.level === level && p.code === code)!;

const INDEX = new Map<string, Place[]>();
function addKey(key: string, p: Place) {
  const k = fold(key);
  if (!k) return;
  const list = INDEX.get(k) ?? [];
  if (!list.includes(p)) list.push(p);
  INDEX.set(k, list);
}
for (const p of PLACES) {
  addKey(p.short, p);
  addKey(p.name, p);
  if (p.level === "municipality") addKey(`${p.short} kommune`, p);
}
// English and local spellings, and towns that are named instead of their municipality.
const ALIASES: Array<[string[], Level, string]> = [
  [["denmark", "danmark", "all denmark", "whole country", "the whole country", "national", "nationwide", "hele landet", "landet"], "country", "000"],
  [["kobenhavn", "københavn", "copenhagen", "kbh", "city of copenhagen", "kobenhavns", "kobenhavns kommune", "copenhagen municipality"], "municipality", "101"],
  [["elsinore"], "municipality", "217"],
  [["taastrup", "hoje taastrup"], "municipality", "169"],
  [["lyngby"], "municipality", "173"],
  [["holte"], "municipality", "230"],
  [["hellerup"], "municipality", "157"],
  [["skagen"], "municipality", "813"],
  [["nykobing falster", "nykobing f"], "municipality", "376"],
  [["ronne"], "municipality", "400"],
  [["byen kobenhavn", "copenhagen city area"], "province", "01"],
  [["kobenhavns omegn", "kobenhavn omegn", "copenhagen suburbs", "copenhagen surroundings"], "province", "02"],
  [["north zealand", "nordsjaelland"], "province", "03"],
  [["east zealand", "ostsjaelland"], "province", "05"],
  [["west and south zealand", "south zealand", "vest og sydsjaelland"], "province", "06"],
  [["funen", "fyen"], "province", "07"],
  [["south jutland", "sydjylland"], "province", "08"],
  [["east jutland", "eastern jutland", "ostjylland"], "province", "09"],
  [["west jutland", "western jutland", "vestjylland"], "province", "10"],
  [["north jutland", "northern jutland", "nordjylland"], "province", "11"],
  [["capital region", "capital region of denmark", "hovedstaden"], "region", "084"],
  [["zealand", "region zealand", "sjaelland", "sjalland", "region sjaelland"], "region", "085"],
  [["southern denmark", "south denmark", "region of southern denmark", "syddanmark"], "region", "083"],
  [["central denmark", "central jutland", "region central jutland", "midtjylland"], "region", "082"],
  [["north denmark", "north denmark region", "region north jutland"], "region", "081"],
];
for (const [keys, level, code] of ALIASES) for (const k of keys) addKey(k, byKey(level, code));

const SUFFIX = /\s+(kommune|municipality|province|landsdel)$/i;
const PREFIX = /^(province|landsdel|kommune)\s+/i;

/** Resolve a town, municipality, province or region (with or without diacritics, English or Danish). Empty -> all of Denmark. Throws InputError if unknown. */
export function resolvePlace(town?: string): Place {
  const raw = (town ?? "").trim();
  if (!raw) return COUNTRY;
  const key = fold(raw.replace(SUFFIX, "").replace(PREFIX, ""));
  if (["jutland", "jylland"].includes(key)) {
    throw new InputError('Statistics Denmark publishes Jutland as separate provinces: Nordjylland, Østjylland, Vestjylland and Sydjylland. Name one of those or a town, or leave town out for all of Denmark.');
  }
  const hits = INDEX.get(key) ?? INDEX.get(key.replace(/oe/g, "o"));
  if (hits && hits.length) {
    const best = Math.min(...hits.map((p) => RANK[p.level]));
    const top = hits.filter((p) => RANK[p.level] === best);
    if (top.length === 1) return top[0];
    throw new InputError(`"${raw}" matches several places in Denmark: ${top.map((p) => p.name).join("; ")}. Use one of those names.`);
  }
  const near = PLACES.filter((p) => key.length >= 3 && fold(p.name).includes(key)).slice(0, 5);
  throw new InputError(
    `Statistics Denmark has no place called "${raw}". Use a municipality or town such as København, Aarhus, Odense or Aalborg, a province such as Fyn or Østjylland, or a region such as Hovedstaden.` +
      (near.length ? ` Did you mean: ${near.map((p) => p.name).join("; ")}?` : ""),
  );
}

/** The names of the municipalities in a province. */
export function municipalitiesIn(province: string): string[] {
  return Object.values(DK_MUNICIPALITIES).filter(([, p]) => p === province).map(([n]) => n);
}

// ---------- periods ----------

/** StatBank quarter code "2026K3" -> "2026-Q3". Anything else is returned unchanged. */
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

const DAY = 86400000;

/** Statistics Denmark's figures become final 13 months after the reference period; until then they are preliminary. */
export function isPreliminary(periodTo: string | null, now: Date): boolean {
  if (!periodTo) return false;
  return (now.getTime() - Date.parse(periodTo + "T23:59:59Z")) / DAY < 395;
}

/** Plain-words caveat when a figure is old (over 15 months since its period ended). */
export function ageNote(periodTo: string | null, now: Date): string | null {
  if (!periodTo) return null;
  const days = Math.round((now.getTime() - Date.parse(periodTo + "T23:59:59Z")) / DAY);
  if (days <= 450) return null;
  return `This figure is old: its period ended about ${Math.round(days / 30)} months ago.`;
}

// ---------- reading the cube (pure) ----------

/** StatBank API v1 answers {dataset: {dimension: {id, size, <dimension>...}, value, ...}}. Turn it into the JSON-stat 2.0 shape the shared parser reads. */
export function parseStatbank(json: unknown): JsonStatTable {
  const j = json as any;
  if (j && typeof j === "object" && j.errorTypeCode) {
    throw new SourceError(`Statistics Denmark refused the request: ${String(j.message ?? j.errorTypeCode)}`.slice(0, 300));
  }
  const ds = j?.dataset;
  if (!ds || typeof ds !== "object" || !ds.dimension || !Array.isArray(ds.dimension.id) || !Array.isArray(ds.dimension.size)) {
    throw new SourceError("Unexpected response from Statistics Denmark (not a JSONSTAT dataset)");
  }
  return parseJsonStat({ ...ds, class: "dataset", id: ds.dimension.id, size: ds.dimension.size });
}

export interface Change {
  reference_period: string;
  average: number;
  sales: number;
  change_percent: number;
}
export interface Figure {
  type: Category;
  reference_period: string;
  average: number | null;
  sales: number | null;
  previous: Change | null;
  year_earlier: Change | null;
  national: { average: number; sales: number } | null;
}
export interface Reading {
  place: Place;
  asked: TypeKey;
  figure: Figure;
  /** The other category in the same place and quarter, when it has a figure. */
  other: { type: Category; reference_period: string; average: number | null; sales: number | null } | null;
  datasetLatest: string | null;
  datasetTitle: string | null;
  datasetUpdated: string | null;
}

type Index = Map<string, number>;
function indexOf(table: JsonStatTable): Index {
  const idx: Index = new Map();
  for (const r of table.rows) idx.set(`${r["OMRÅDE"]}|${r["EJENDOMSKATE"]}|${r["BNØGLE"]}|${r["OVERDRAG"]}|${r["Tid"]}`, r.value as number);
  return idx;
}
function pointOf(idx: Index, region: string, type: Category, time: string): { average: number | null; sales: number | null } {
  const get = (key: string) => idx.get(`${region}|${CATEGORIES[type].code}|${key}|${FREE_TRADE}|${time}`);
  const price = get(PRICE_KEY);
  const sales = get(SALES_KEY);
  return { average: price !== undefined && price > 0 ? price * 1000 : null, sales: sales !== undefined ? sales : null };
}
/** The newest quarter in which this region and category has a price or any sale. */
function latestTime(idx: Index, times: string[], region: string, type: Category): string | null {
  for (let i = times.length - 1; i >= 0; i--) {
    const p = pointOf(idx, region, type, times[i]);
    if (p.average !== null || (p.sales ?? 0) > 0) return times[i];
  }
  return null;
}

function figureFor(idx: Index, times: string[], region: string, type: Category): Figure | null {
  const t = latestTime(idx, times, region, type);
  if (!t) return null;
  const main = pointOf(idx, region, type, t);
  const ref = isoQuarter(t);
  // A comparison needs a published price from enough sales in the other quarter too.
  const compare = (iso: string | null): Change | null => {
    if (!iso || main.average === null) return null;
    const code = times.find((x) => isoQuarter(x) === iso);
    if (!code) return null;
    const p = pointOf(idx, region, type, code);
    if (p.average === null || p.sales === null || p.sales < MIN_PUBLISH) return null;
    return { reference_period: iso, average: p.average, sales: p.sales, change_percent: changePercent(main.average, p.average) };
  };
  const nat = region === "000" ? null : pointOf(idx, "000", type, t);
  return {
    type,
    reference_period: ref,
    average: main.average,
    sales: main.sales,
    previous: compare(previousPeriod(ref)),
    year_earlier: compare(yearEarlier(ref)),
    national: nat && nat.average !== null && nat.sales !== null ? { average: nat.average, sales: nat.sales } : null,
  };
}

/**
 * From a parsed EJEN77 slice pick the answer for one place: for the asked category (or, when none is asked, the category with more sales
 * in the latest quarter) the latest quarter with a price, the previous quarter, the same quarter a year earlier and the national average.
 * Returns null when Statistics Denmark holds nothing for the place.
 */
export function readDenmark(table: JsonStatTable, q: { place: Place; type: TypeKey }): Reading | null {
  const idx = indexOf(table);
  const times = [...(table.codes["Tid"] ?? [])].sort();
  const region = q.place.dataCode;
  const house = figureFor(idx, times, region, "house");
  const flat = figureFor(idx, times, region, "flat");
  let main: Figure | null;
  let other: Figure | null;
  if (q.type === "flat") [main, other] = [flat, house];
  else if (q.type === "house") [main, other] = [house, flat];
  else if (house && flat) [main, other] = (flat.sales ?? 0) > (house.sales ?? 0) ? [flat, house] : [house, flat];
  else [main, other] = [house ?? flat, null];
  if (!main) return null;
  return {
    place: q.place,
    asked: q.type,
    figure: main,
    other: other ? { type: other.type, reference_period: other.reference_period, average: other.average, sales: other.sales } : null,
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

/** "That is 0.5% lower than in the first quarter of 2026 and 16.7% higher than a year earlier (the second quarter of 2025)." */
export function changeSentence(previous: Change | null, yearAgo: Change | null): string {
  const parts: string[] = [];
  if (previous) parts.push(oneChange(previous, `in ${periodWords(previous.reference_period)}`));
  if (yearAgo) parts.push(oneChange(yearAgo, `a year earlier (${periodWords(yearAgo.reference_period)})`));
  return parts.length ? ` That is ${parts.join(" and ")}.` : "";
}

export const METHOD =
  "Statistics Denmark publishes, each quarter, the average purchase price per property for ordinary free-trade sales of one-family houses and of owner-occupied flats, " +
  `and the number of sales behind it, by province and region (table ${TABLE}, key figures 3 and 2). ProofPrice returns the published average for the latest quarter ` +
  "for the place's province (a town or municipality is answered with the province it lies in), unchanged, with the previous quarter, the same quarter a year earlier and the national average. " +
  "The change percentages are calculated by ProofPrice from the published averages and only against quarters with at least 5 sales; they are not a price index, because the mix of properties sold changes. " +
  "Statistics Denmark marks quarters as preliminary until 13 months after they end and says preliminary average prices are underestimated. No range is calculated: only one average and the number of sales are published.";

export interface AnswerInput {
  place: Place;
  type: TypeKey;
  baseUrl?: string;
  apiUrl?: string;
  now?: Date;
  notes?: string[];
}

const where = (p: Place) => (p.level === "country" ? "Denmark" : p.level === "municipality" ? `${p.short} (province ${p.dataShort})` : p.short);

export function denmarkAnswer(reading: Reading | null, q: AnswerInput): PriceAnswer {
  const now = q.now ?? new Date();
  const query = { country: "DK", town: q.place.short, property_type: q.type };
  const base = { source: INFO, query, measure: "average" as const, currency: "DKK", unit: "per home", method: METHOD, baseUrl: q.baseUrl };
  const place = q.place;

  if (!reading) {
    const none = buildStatisticAnswer({ ...base, value: null, period: { from: null, to: null }, reference_period: "", describe: () => "" });
    return {
      ...none,
      summary:
        `Statistics Denmark publishes no average price for ${q.type === "any" ? "homes" : CATEGORIES[q.type as Category]?.label ?? "this kind of property"} in ${where(place)}. ` +
        "Try a larger area such as the region, or all of Denmark.",
    };
  }

  const f = reading.figure;
  const cat = CATEGORIES[f.type];
  const range = periodRange(f.reference_period);
  const prelim = isPreliminary(range?.to ?? null, now);
  const notes: string[] = [];
  if (place.level === "municipality") {
    const covers = municipalitiesIn(place.dataCode);
    notes.push(
      `Statistics Denmark publishes this table by province, not by municipality: the figure is for ${place.dataShort}, the province where ${place.short} lies` +
        (covers.length <= 3 ? ` (${covers.join(", ")}).` : "."),
    );
  }
  if (q.type === "any") {
    notes.push(
      reading.other
        ? `No property type was given, so the answer is for ${cat.label}, the group with more sales here in ${periodWords(f.reference_period)}; ${CATEGORIES[reading.other.type].label} are in other_type.`
        : `No property type was given; Statistics Denmark holds a figure only for ${cat.label}.`,
    );
  }
  if (prelim) {
    notes.push(
      "Preliminary: Statistics Denmark says preliminary average prices are underestimated (they are not corrected for the bias in the registration pattern) and become final 13 months after the quarter, " +
        "so a change measured against an older, final quarter can understate a rise.",
    );
  }
  if (reading.datasetLatest && f.reference_period < reading.datasetLatest) {
    notes.push(`This is the latest quarter Statistics Denmark holds for ${place.dataShort}; ${periodWords(reading.datasetLatest)} has been published for other places.`);
  }
  const old = ageNote(range?.to ?? null, now);
  if (old) notes.push(old);
  if (f.sales !== null && f.sales >= MIN_PUBLISH && f.sales < 30) notes.push(`Only ${f.sales} sales stand behind this average, so it is volatile.`);
  if (q.notes) notes.push(...q.notes);

  const extra: Record<string, unknown> = {
    place: { code: place.code, name: place.short, level: place.level, figure_is_for: { code: place.dataCode, name: place.dataShort } },
    ...(place.dataCode.length === 2 ? { province_covers_municipalities: municipalitiesIn(place.dataCode), region_code: PROVINCE_REGION[place.dataCode] } : {}),
    property_type: { used: f.type, code: cat.code, label: cat.label, chosen: q.type === "any" ? "the group with more sales" : "as asked" },
    reference_period_label: periodWords(f.reference_period),
    preliminary: prelim,
    previous_period: f.previous,
    year_earlier: f.year_earlier,
    ...(f.national ? { national_average: { ...f.national, reference_period: f.reference_period } } : {}),
    ...(reading.other
      ? {
          other_type: {
            type: reading.other.type,
            label: CATEGORIES[reading.other.type].label,
            reference_period: reading.other.reference_period,
            average_price: reading.other.average,
            sales: reading.other.sales,
          },
        }
      : {}),
    dataset: { table: TABLE, title: reading.datasetTitle, updated: reading.datasetUpdated, latest_period_in_dataset: reading.datasetLatest, url: INFO.homepage },
    ...(q.apiUrl ? { statbank_api_url: q.apiUrl } : {}),
  };

  const stat = buildStatisticAnswer({
    ...base,
    value: f.average,
    period: range ?? { from: null, to: null },
    reference_period: f.reference_period,
    sample_size: f.sales,
    note: notes.length ? notes.join(" ") : undefined,
    describe: (v) =>
      `In ${where(place)} the average price of ${cat.noun} (ordinary free-trade sales) was ${fmtMoney(v, "DKK")} in ${periodWords(f.reference_period)}${prelim ? " (preliminary)" : ""}` +
      (f.sales !== null ? `, from ${f.sales.toLocaleString("en-GB")} sales.` : ".") +
      changeSentence(f.previous, f.year_earlier),
    extra,
  });

  // The publisher gives the number of sales, so confidence follows it, and a figure from fewer than 5 sales is not published.
  if (f.sales !== null) {
    if (f.sales < MIN_PUBLISH) {
      return {
        ...stat,
        status: "insufficient_data",
        price: null,
        confidence: "insufficient",
        summary: `Statistics Denmark reports only ${f.sales} sale(s) of ${cat.label} behind the latest average for ${where(place)}; at least ${MIN_PUBLISH} are needed before we publish a figure.`,
      };
    }
    stat.confidence = confidenceLabel(f.sales);
  }
  return stat;
}

/** Detached and terraced houses are not published separately. */
export function unavailableAnswer(type: TypeKey, place: Place, baseUrl?: string): PriceAnswer {
  const none = buildStatisticAnswer({
    source: INFO,
    query: { country: "DK", town: place.short, property_type: type },
    value: null,
    measure: "average",
    currency: "DKK",
    unit: "per home",
    period: { from: null, to: null },
    reference_period: "",
    method: METHOD,
    describe: () => "",
    baseUrl,
  });
  return {
    ...none,
    summary:
      `Statistics Denmark does not publish a price for ${type} houses separately: its table has one group, one-family houses. ` +
      "Ask with property_type 'house' for that group, or 'flat' for owner-occupied flats.",
  };
}

// ---------- the request ----------

/** One GET for the place's area and the whole country: both categories, price and number of sales, ordinary free trade, every quarter (about 11 KB). */
export function dataUrl(regions: string[], base = DST_API): string {
  const q = [
    "lang=en",
    `OMR%C3%85DE=${regions.join(",")}`,
    `EJENDOMSKATE=${CATEGORIES.house.code},${CATEGORIES.flat.code}`,
    `BN%C3%98GLE=${SALES_KEY},${PRICE_KEY}`,
    `OVERDRAG=${FREE_TRADE}`,
    "Tid=*",
  ];
  return `${base}/data/${TABLE}/JSONSTAT?${q.join("&")}`;
}

export interface DenmarkInput {
  town?: string;
  postcode?: string;
  property_type?: string;
  baseUrl?: string;
}

export async function denmarkHomePrices(input: DenmarkInput, o: FetchOptions & { now?: Date; apiBase?: string } = {}): Promise<PriceAnswer> {
  const type = normaliseType(input.property_type);
  const place = resolvePlace(input.town);
  if (input.postcode && !input.town) {
    throw new InputError("Denmark's home prices are published by province and region, not by postcode. Give town (for example København, Aarhus, Odense) or leave it out for all of Denmark.");
  }
  if (type === "detached" || type === "terraced") return unavailableAnswer(type, place, input.baseUrl);
  const notes: string[] = [];
  if (input.postcode) notes.push(`The postcode ${input.postcode} was ignored: Statistics Denmark publishes by province, not postcode.`);
  const regions = place.dataCode === "000" ? ["000"] : [place.dataCode, "000"];
  const url = dataUrl(regions, o.apiBase);
  const table = parseStatbank(await resolveFetcher(o)(url));
  const reading = readDenmark(table, { place, type });
  return denmarkAnswer(reading, { place, type, baseUrl: input.baseUrl, apiUrl: url, now: o.now, notes });
}
