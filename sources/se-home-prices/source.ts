// Sweden home prices from Statistics Sweden (SCB), real estate prices and registrations of title (BO0501). Format checked live on
// 2026-10-14 through the GitHub probe (PxWebApi v2, JSON-stat 2.0, a GET per answer, no key, no bulk download). Three tables:
//   TAB1169  Sold one- and two-dwelling buildings by region (municipality) and type of real estate, yearly   -> houses in a municipality
//   TAB1167  Sold one- and two-dwelling buildings for permanent living by region, quarterly                  -> houses in a county, a metro area or Sweden
//   TAB1151  Sold tenant-owned flats by region, yearly (average and median)                                  -> flats in a county, a metro area or Sweden
//
// What SCB publishes: for each region and period ONE average purchase price (in SEK thousand) and the number of sales behind it
// (flats: also the median). There is no distribution, so the answers are official statistics: value + measure, range fields null,
// sample_size = the published number of sales. Prices are converted from SEK thousand to SEK. Changes are calculated here.

import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { InputError } from "../../lib/http";
import { parseJsonStat, periodRange, previousPeriod, resolveFetcher } from "../../lib/adapters";
import type { FetchOptions, JsonStatTable } from "../../lib/adapters";
import type { SourceInfo } from "../../lib/plugin";
import { confidenceLabel, MIN_PUBLISH } from "../../lib/stats";
import { SE_REGIONS } from "./places";

export const INFO: SourceInfo = {
  id: "se-home-prices",
  country: "SE (Sweden)",
  category: "home sales (official average purchase price of houses and tenant-owned flats)",
  name: "Real estate prices: sold one- and two-dwelling buildings (BO0501) and sold tenant-owned flats",
  publisher: "Statistics Sweden (SCB)",
  what_is_recorded:
    "For each region and period: the average purchase price (SEK) of one- and two-dwelling buildings for permanent living sold, by municipality (yearly) or county (quarterly), " +
    "and the average and median purchase price of tenant-owned flats sold (county or metropolitan area, yearly), with the number of sales. " +
    "Compiled by Statistics Sweden from granted registrations of title. One published figure per cell; never individual sales or addresses.",
  price_type: "official_statistic",
  freshness:
    "Houses by county: quarterly, published about seven weeks after the quarter ends. Houses by municipality and tenant-owned flats: yearly, published in June and July for the year before. Each answer states its period",
  licence:
    "CC0. Statistics Sweden: \"We use the licence CC0 for this data, which means that you may use and disseminate or provide such data without any requirement to state the source.\" " +
    "Statistics Sweden recommends \"Source: Statistics Sweden\"",
  licence_url: "https://www.scb.se/en/services/open-data-api/",
  attribution:
    "Source: Statistics Sweden (SCB), Real estate prices and registrations of title (https://www.scb.se/BO0501-en): tables \"Sold one- and two-dwelling buildings\" and \"Sold tenant-owned flats\". " +
    "Open data under CC0. Prices are converted from SEK thousand to SEK; the change between periods is calculated by ProofPrice.",
  homepage: "https://www.scb.se/BO0501-en",
  limits:
    "An average purchase price (flats: also the median) for the homes sold in a period, not a valuation or a quote for one home: it moves with the mix of homes sold. " +
    "Houses are one- and two-dwelling buildings for permanent living (villas, terraced and semi-detached houses are not split) sold at a purchase price of at most SEK 20 million; " +
    "extreme purchase-price coefficients are excluded by Statistics Sweden. Municipalities are covered for houses only and yearly; tenant-owned flats are published only for counties, " +
    "Greater Gothenburg, Greater Malmö, Greater Stockholm and Sweden, only second-hand sales of whole flats bought by private persons up to SEK 20 million. " +
    "The latest quarter or year is preliminary. No price per square metre is published.",
};

export const SCB_API = "https://statistikdatabasen.scb.se/api/v2";
export const HOUSES_YEARLY = "TAB1169"; // municipality, yearly
export const HOUSES_QUARTERLY = "TAB1167"; // county, quarterly
export const FLATS_YEARLY = "TAB1151";

// ---------- names and types ----------

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

export type TypeKey = "any" | "house" | "flat" | "detached" | "terraced";

/** Plain words to a type. "detached" and "terraced" are known words, but Statistics Sweden does not split houses by form. */
export function normaliseType(raw?: string): TypeKey {
  const s = fold(raw ?? "");
  if (["", "any", "all", "total", "alla"].includes(s)) return "any";
  if (["house", "houses", "home", "homes", "villa", "smahus", "one and two dwelling buildings", "one or two dwelling buildings"].includes(s)) return "house";
  if (["detached", "detached house", "detached houses", "single family", "single family house", "fristaende"].includes(s)) return "detached";
  if (["terraced", "terrace", "terraced house", "terraced houses", "row house", "row houses", "townhouse", "radhus"].includes(s)) return "terraced";
  if (["flat", "flats", "apartment", "apartments", "condo", "condominium", "coop", "co op", "tenant owned", "tenant owned flat", "tenant owned flats", "bostadsratt", "lagenhet"].includes(s)) return "flat";
  throw new InputError(`property_type for Sweden must be one of: any (default, houses), house (one- and two-dwelling buildings), flat (tenant-owned flats). Not available: ${String(raw)}.`);
}

export type Level = "country" | "metro" | "county" | "municipality";
export interface Place {
  code: string;
  name: string;
  level: Level;
}

const COUNTRY: Place = { code: "00", name: "Sweden", level: "country" };
const METROS: Place[] = [
  { code: "0010", name: "Greater Stockholm", level: "metro" },
  { code: "0020", name: "Greater Gothenburg", level: "metro" },
  { code: "0030", name: "Greater Malmö", level: "metro" },
];

function levelOf(code: string): Level {
  return code === "00" ? "country" : code.length === 2 ? "county" : "municipality";
}

export const PLACES: Place[] = [
  COUNTRY,
  ...METROS,
  ...SE_REGIONS.filter(([c]) => c !== "00").map(([code, name]) => ({ code, name, level: levelOf(code) })),
];

/** Folded name -> places, by priority: 1 municipality or metro area name, 2 county name ("Skåne", "Stockholms län"). */
const INDEX = new Map<string, Array<{ place: Place; priority: number }>>();
function addKey(key: string, place: Place, priority: number) {
  const k = fold(key);
  if (!k) return;
  const list = INDEX.get(k) ?? [];
  if (!list.some((x) => x.place === place)) list.push({ place, priority });
  INDEX.set(k, list);
}
for (const p of PLACES) {
  if (p.level === "county") {
    const short = p.name.replace(/ county$/, "");
    addKey(p.name, p, 1);
    addKey(short, p, 2);
    addKey(`${short} lan`, p, 1);
    addKey(`${short}s lan`, p, 1);
  } else if (p.level === "metro") {
    addKey(p.name, p, 1);
    addKey(p.name.replace("Greater ", "") + " metropolitan area", p, 1);
    addKey(p.name.replace("Greater ", "") + " region", p, 1);
  } else {
    addKey(p.name, p, 1);
  }
}
// English and plain spellings
const ALIASES: Array<[string, string]> = [["gothenburg", "1480"], ["goteborg", "1480"], ["sverige", "00"], ["riket", "00"], ["whole country", "00"], ["nationwide", "00"], ["national", "00"], ["greater goteborg", "0020"], ["greater gothenburg", "0020"]];
for (const [alias, code] of ALIASES) addKey(alias, PLACES.find((p) => p.code === code)!, 1);

const SUFFIX = /\s+(kommun|municipality|county|lan|metropolitan area)$/i;

/** Resolve a municipality, county or metropolitan area. Empty -> Sweden. A bare name that is both a municipality and a county is the municipality. */
export function resolvePlace(town?: string): Place {
  const raw = (town ?? "").trim();
  if (!raw) return COUNTRY;
  const direct = INDEX.get(fold(raw)) ?? INDEX.get(fold(raw.replace(SUFFIX, "")));
  if (direct && direct.length) {
    const best = Math.min(...direct.map((x) => x.priority));
    const top = direct.filter((x) => x.priority === best).map((x) => x.place);
    if (top.length === 1) return top[0];
    throw new InputError(`"${raw}" matches several places in Sweden: ${top.map((p) => p.name).join("; ")}. Use one of those names.`);
  }
  const key = fold(raw);
  const near = PLACES.filter((p) => key.length >= 3 && fold(p.name).includes(key)).slice(0, 5);
  throw new InputError(
    `Statistics Sweden has no region called "${raw}". Use a municipality such as Stockholm, Göteborg (or Gothenburg), Malmö or Uppsala, or a county such as Skåne or Västra Götaland.` +
      (near.length ? ` Did you mean: ${near.map((p) => p.name).join("; ")}?` : ""),
  );
}

/** The county code of a municipality: its first two digits ("0180" Stockholm -> "01"). */
export const countyOf = (code: string) => code.slice(0, 2);

// ---------- periods and numbers ----------

/** SCB code "2026K2" -> "2026-Q2"; a year stays "2025". */
export function isoPeriod(code: string): string {
  const m = /^(\d{4})K([1-4])$/.exec(code);
  return m ? `${m[1]}-Q${m[2]}` : code;
}

export function periodWords(code: string): string {
  const m = /^(\d{4})-Q([1-4])$/.exec(code);
  return m ? `the ${["first", "second", "third", "fourth"][Number(m[2]) - 1]} quarter of ${m[1]}` : code;
}

const roundTo = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;
export const changePercent = (now: number, then: number) => roundTo(((now - then) / then) * 100, 1);

const DAY = 86400000;
/** Plain-words caveat when a figure is old (over 15 months since its period ended). */
export function ageNote(periodTo: string | null, now: Date): string | null {
  if (!periodTo) return null;
  const days = Math.round((now.getTime() - Date.parse(periodTo + "T23:59:59Z")) / DAY);
  return days > 450 ? `This figure is old: its period ended about ${Math.round(days / 30)} months ago.` : null;
}

// ---------- reading a cube (pure) ----------

export interface Point {
  reference_period: string;
  average: number | null; // SEK
  median: number | null; // SEK
  sales: number | null;
}
export interface Change {
  reference_period: string;
  value: number;
  change_percent: number;
}

interface SeriesCodes {
  region: string;
  price: string; // ContentsCode: average, SEK thousand
  count: string; // ContentsCode: number of sales
  median?: string; // ContentsCode: median, SEK thousand (flats)
  where?: Record<string, string>; // other dimensions fixed (Fastighetstyp)
}

/** All periods of one region in the cube, oldest first, prices in SEK. Periods without a price are left out. */
export function readSeries(table: JsonStatTable, c: SeriesCodes): Point[] {
  const cell = (contents: string, time: string) =>
    table.rows.find((r) => r.Region === c.region && r.ContentsCode === contents && r.Tid === time && Object.entries(c.where ?? {}).every(([k, v]) => r[k] === v));
  const out: Point[] = [];
  for (const time of [...(table.codes.Tid ?? [])].sort()) {
    const avg = cell(c.price, time);
    const med = c.median ? cell(c.median, time) : undefined;
    const hasAvg = avg && avg.value !== null && avg.value > 0;
    const hasMed = med && med.value !== null && med.value > 0;
    if (!hasAvg && !hasMed) continue;
    const n = cell(c.count, time);
    out.push({
      reference_period: isoPeriod(time),
      average: hasAvg ? avg!.value! * 1000 : null,
      median: hasMed ? med!.value! * 1000 : null,
      sales: n && n.value !== null ? n.value : null,
    });
  }
  return out;
}

export type Kind = "house" | "flat";
export interface Figure {
  kind: Kind;
  asked: Place; // what the caller asked for
  place: Place; // what the statistic describes (a flat in Göteborg is answered for Greater Gothenburg)
  measure: "average" | "median";
  reference_period: string;
  value: number; // SEK per home
  average: number | null;
  median: number | null;
  sales: number | null;
  previous: Change | null;
  year_earlier: Change | null;
  national: { average: number | null; median: number | null; sales: number | null } | null;
  datasetLatest: string | null;
  datasetTitle: string | null;
  datasetUpdated: string | null;
  table: string;
  cadence: "yearly" | "quarterly";
}

const headline = (p: Point, kind: Kind) => (kind === "flat" ? p.median ?? p.average : p.average);

/**
 * From a parsed slice pick the figure: the latest period with a price for the place, the one before, a year earlier (quarterly
 * tables), and Sweden for the same period. Houses are an average; flats are headlined with the median (Statistics Sweden also
 * publishes the average, which is kept alongside).
 */
export function readFigure(
  table: JsonStatTable,
  q: { kind: Kind; asked: Place; place: Place; cadence: "yearly" | "quarterly"; tableId: string; codes: Omit<SeriesCodes, "region"> },
): Figure | null {
  const series = readSeries(table, { ...q.codes, region: q.place.code });
  const last = series[series.length - 1];
  if (!last) return null;
  const value = headline(last, q.kind);
  if (value === null) return null;
  const earlier = (iso: string | null): Change | null => {
    const p = iso ? series.find((x) => x.reference_period === iso) : undefined;
    const v = p ? headline(p, q.kind) : null;
    return p && v !== null ? { reference_period: p.reference_period, value: v, change_percent: changePercent(value, v) } : null;
  };
  const prevCode = previousPeriod(last.reference_period);
  const yearCode = q.cadence === "quarterly" ? (/^(\d{4})-Q([1-4])$/.test(last.reference_period) ? `${Number(last.reference_period.slice(0, 4)) - 1}${last.reference_period.slice(4)}` : null) : null;
  const nat = q.place.code === "00" ? [] : readSeries(table, { ...q.codes, region: "00" });
  const natPoint = nat.find((p) => p.reference_period === last.reference_period);
  const times = table.codes.Tid ?? [];
  return {
    kind: q.kind,
    asked: q.asked,
    place: q.place,
    measure: q.kind === "flat" && last.median !== null ? "median" : "average",
    reference_period: last.reference_period,
    value,
    average: last.average,
    median: last.median,
    sales: last.sales,
    previous: earlier(prevCode),
    year_earlier: earlier(yearCode),
    national: natPoint ? { average: natPoint.average, median: natPoint.median, sales: natPoint.sales } : null,
    datasetLatest: times.length ? isoPeriod([...times].sort()[times.length - 1]) : null,
    datasetTitle: table.label,
    datasetUpdated: table.updated,
    table: q.tableId,
    cadence: q.cadence,
  };
}

// ---------- the answer (pure) ----------

function oneChange(c: Change, label: string): string {
  if (c.change_percent === 0) return `unchanged from ${label.replace(/^in /, "")}`;
  return `${Math.abs(c.change_percent)}% ${c.change_percent > 0 ? "higher" : "lower"} than ${label}`;
}

/** "That is 0.3% lower than in the first quarter of 2026 and unchanged from a year earlier (the second quarter of 2025)." */
export function changeSentence(previous: Change | null, yearAgo: Change | null): string {
  const parts: string[] = [];
  if (previous) parts.push(oneChange(previous, /^\d{4}$/.test(previous.reference_period) ? `in ${previous.reference_period}` : `in ${periodWords(previous.reference_period)}`));
  if (yearAgo) parts.push(oneChange(yearAgo, `a year earlier (${periodWords(yearAgo.reference_period)})`));
  return parts.length ? ` That is ${parts.join(" and ")}.` : "";
}

const KIND_WORDS: Record<Kind, { label: string; what: string }> = {
  house: { label: "one- and two-dwelling buildings for permanent living (houses)", what: "average purchase price of a house" },
  flat: { label: "tenant-owned flats", what: "median purchase price of a tenant-owned flat" },
};

export const METHOD =
  "Statistics Sweden (SCB) publishes the average purchase price (SEK thousand) and the number of sales of one- and two-dwelling buildings for permanent living, " +
  "by municipality (yearly) and by county, metropolitan area and for Sweden (quarterly), and the average and median purchase price of tenant-owned flats by county, " +
  "metropolitan area and for Sweden (yearly), all compiled from registrations of title. ProofPrice returns the published figure for the latest period SCB holds for the place, " +
  "converted to SEK and otherwise unchanged, with the previous period (and a year earlier for quarterly figures). Change percentages are calculated by ProofPrice from the published figures " +
  "and are not a price index. No range is calculated: SCB publishes one average (flats: also one median) and the number of sales behind it. SCB publishes no price per square metre.";

export interface AnswerInput {
  type: TypeKey;
  asked: Place;
  baseUrl?: string;
  apiUrls?: string[];
  now?: Date;
  notes?: string[];
  /** Best-effort context: the county's latest quarter for a municipality, flats next to houses. */
  context?: Record<string, unknown>;
}

export function swedenAnswer(fig: Figure | null, q: AnswerInput): PriceAnswer {
  const now = q.now ?? new Date();
  const kind: Kind = q.type === "flat" ? "flat" : "house";
  const query = { country: "SE", town: q.asked.name, property_type: q.type };
  const base = { source: INFO, query, measure: (kind === "flat" ? "median" : "average") as "median" | "average", currency: "SEK", unit: "per home", method: METHOD, baseUrl: q.baseUrl };
  const where = q.asked.level === "country" ? "Sweden" : q.asked.name;

  if (!fig) {
    const none = buildStatisticAnswer({ ...base, value: null, period: { from: null, to: null }, reference_period: "", describe: () => "" });
    return {
      ...none,
      summary:
        `Statistics Sweden publishes no ${KIND_WORDS[kind].what} for ${where}` +
        (kind === "flat" ? " (tenant-owned flat prices exist only for counties, Greater Gothenburg, Greater Malmö and Sweden)." : " in the latest periods (too few sales, or the place is not covered).") +
        " Try the county or Sweden as a whole.",
    };
  }

  const f = fig;
  const range = periodRange(f.reference_period);
  const notes: string[] = [];
  if (f.place.code !== f.asked.code) {
    notes.push(
      `Statistics Sweden publishes tenant-owned flat prices for counties and the three metropolitan areas, not for municipalities: the figure is for ${f.place.name}, where ${f.asked.name} lies.`,
    );
  }
  if (f.datasetLatest && f.reference_period < f.datasetLatest) {
    notes.push(`This is the latest period Statistics Sweden holds for ${f.place.name}; ${periodWords(f.datasetLatest)} has been published for other places.`);
  }
  const old = ageNote(range?.to ?? null, now);
  if (old) notes.push(old);
  if (f.cadence === "yearly") notes.push("Statistics Sweden publishes this figure once a year, for the whole year before.");
  if (q.type === "any") notes.push("No property type was given, so houses are shown; tenant-owned flats are in other_types where available.");
  if (f.sales !== null && f.sales < 30) notes.push(`Only ${f.sales} sales stand behind this figure, so it is volatile.`);
  if (q.notes) notes.push(...q.notes);

  const extra: Record<string, unknown> = {
    place: { code: f.place.code, name: f.place.name, level: f.place.level, asked: f.asked.name },
    property_type: { used: kind, label: KIND_WORDS[kind].label },
    reference_period_label: periodWords(f.reference_period),
    average_price: f.average,
    ...(f.median !== null ? { median_price: f.median } : {}),
    previous_period: f.previous,
    year_earlier: f.year_earlier,
    ...(f.national ? { sweden: { reference_period: f.reference_period, average_price: f.national.average, median_price: f.national.median, sales: f.national.sales } } : {}),
    ...(q.context ?? {}),
    dataset: {
      table: f.table,
      title: f.datasetTitle,
      updated: f.datasetUpdated,
      latest_period_in_dataset: f.datasetLatest,
      url: INFO.homepage,
    },
    ...(q.apiUrls?.length ? { scb_api_urls: q.apiUrls } : {}),
  };

  const stat = buildStatisticAnswer({
    ...base,
    measure: f.measure,
    value: f.value,
    period: range ?? { from: null, to: null },
    reference_period: f.reference_period,
    sample_size: f.sales,
    note: notes.length ? notes.join(" ") : undefined,
    describe: (v) =>
      `In ${where} the ${f.measure === "median" ? "median" : "average"} purchase price of ${kind === "flat" ? "a tenant-owned flat" : "a house (one- or two-dwelling building)"}` +
      `${f.place.code !== f.asked.code ? ` in ${f.place.name}` : ""} was ${fmtMoney(v, "SEK")} in ${f.cadence === "yearly" ? f.reference_period : periodWords(f.reference_period)}` +
      (f.sales !== null ? `, from ${f.sales.toLocaleString("en-GB")} sales.` : ".") +
      changeSentence(f.previous, f.year_earlier),
    extra,
  });

  if (f.sales !== null) {
    if (f.sales < MIN_PUBLISH) {
      return {
        ...stat,
        status: "insufficient_data",
        price: null,
        confidence: "insufficient",
        summary: `Statistics Sweden reports only ${f.sales} sale(s) behind this figure for ${where}; at least ${MIN_PUBLISH} are needed before we publish a figure.`,
      };
    }
    stat.confidence = confidenceLabel(f.sales);
  }
  return stat;
}

/** The answer for a property type Statistics Sweden does not split (detached, terraced). Not an error: a clear "no figure" with what to ask instead. */
export function unavailableAnswer(type: TypeKey, asked: Place, baseUrl?: string): PriceAnswer {
  const none = buildStatisticAnswer({
    source: INFO,
    query: { country: "SE", town: asked.name, property_type: type },
    value: null,
    measure: "average",
    currency: "SEK",
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
      `Statistics Sweden does not publish a price for ${type} houses separately: it counts all one- and two-dwelling buildings together (villas, terraced and semi-detached houses). ` +
      "Ask with property_type 'house' for that group, or 'flat' for tenant-owned flats.",
  };
}

// ---------- the requests ----------

function url(table: string, vars: Record<string, string[]>, last: number, base = SCB_API): string {
  const parts = ["lang=en", "outputFormat=json-stat2"];
  for (const [name, codes] of Object.entries(vars)) parts.push(`valueCodes%5B${name}%5D=${codes.join(",")}`);
  parts.push(`valueCodes%5BTid%5D=top(${last})`);
  return `${base}/tables/${table}/data?${parts.join("&")}`;
}

export const housesYearlyUrl = (regions: string[], base?: string) =>
  url(HOUSES_YEARLY, { Region: regions, Fastighetstyp: ["220"], ContentsCode: ["BO0501C1", "BO0501C2"] }, 3, base);
export const housesQuarterlyUrl = (regions: string[], base?: string) =>
  url(HOUSES_QUARTERLY, { Region: regions, ContentsCode: ["BO0501L2", "BO0501L3"] }, 6, base);
export const flatsYearlyUrl = (regions: string[], base?: string) =>
  url(FLATS_YEARLY, { Region: regions, ContentsCode: ["BO0501R6", "BO0501R7", "BO0501R8"] }, 3, base);

const HOUSES_YEARLY_CODES = { price: "BO0501C2", count: "BO0501C1", where: { Fastighetstyp: "220" } };
const HOUSES_QUARTERLY_CODES = { price: "BO0501L3", count: "BO0501L2" };
const FLATS_YEARLY_CODES = { price: "BO0501R7", count: "BO0501R6", median: "BO0501R8" };

/** A tenant-owned flat is answered for the place's county, except Göteborg and Malmö, which are answered for their metropolitan areas. */
export function flatPlace(asked: Place): Place {
  if (asked.level !== "municipality") return asked;
  if (asked.code === "1480") return METROS[1];
  if (asked.code === "1280") return METROS[2];
  return PLACES.find((p) => p.code === countyOf(asked.code) && p.level === "county") ?? COUNTRY;
}

/** Publisher notes worth passing on: the ones that say a figure is preliminary. */
export function preliminaryNote(raw: unknown): string | null {
  const notes = (raw as { note?: unknown })?.note;
  if (!Array.isArray(notes)) return null;
  const hit = notes.map(String).find((n) => /preliminary/i.test(n));
  return hit ? `Statistics Sweden notes: ${hit}` : null;
}

export interface SwedenInput {
  town?: string;
  postcode?: string;
  property_type?: string;
  baseUrl?: string;
}

export async function swedenHomePrices(input: SwedenInput, o: FetchOptions & { now?: Date; apiBase?: string } = {}): Promise<PriceAnswer> {
  const type = normaliseType(input.property_type);
  if (input.postcode && !input.town) {
    throw new InputError("Sweden's home prices are published by municipality or county, not by postcode. Give town (for example Stockholm, Göteborg, Malmö) or leave it out for Sweden as a whole.");
  }
  const place = resolvePlace(input.town);
  if (type === "detached" || type === "terraced") return unavailableAnswer(type, place, input.baseUrl);
  const get = resolveFetcher(o);
  const notes: string[] = [];
  if (input.postcode) notes.push(`The postcode ${input.postcode} was ignored: Statistics Sweden publishes by municipality, not postcode.`);
  const base = o.apiBase;
  const asOf = { now: o.now, baseUrl: input.baseUrl };

  const fetchHouses = async () => {
    if (place.level === "municipality") {
      const u = housesYearlyUrl([place.code, "00"], base);
      const raw = await get(u);
      const fig = readFigure(parseJsonStat(raw), { kind: "house", asked: place, place, cadence: "yearly", tableId: HOUSES_YEARLY, codes: HOUSES_YEARLY_CODES });
      return { fig, urls: [u], note: preliminaryNote(raw) };
    }
    const u = housesQuarterlyUrl(place.level === "country" ? ["00"] : [place.code, "00"], base);
    const raw = await get(u);
    const fig = readFigure(parseJsonStat(raw), { kind: "house", asked: place, place, cadence: "quarterly", tableId: HOUSES_QUARTERLY, codes: HOUSES_QUARTERLY_CODES });
    return { fig, urls: [u], note: preliminaryNote(raw) };
  };
  const fetchFlats = async () => {
    const target = flatPlace(place);
    const u = flatsYearlyUrl(target.level === "country" ? ["00"] : [target.code, "00"], base);
    const raw = await get(u);
    const fig = readFigure(parseJsonStat(raw), { kind: "flat", asked: place, place: target, cadence: "yearly", tableId: FLATS_YEARLY, codes: FLATS_YEARLY_CODES });
    return { fig, urls: [u], note: preliminaryNote(raw) };
  };
  /** The county's latest quarter, next to a municipality's yearly figure: fresher context. Best effort. */
  const fetchCounty = async () => {
    const county = PLACES.find((p) => p.level === "county" && p.code === countyOf(place.code));
    if (!county) return null;
    const u = housesQuarterlyUrl([county.code, "00"], base);
    const fig = readFigure(parseJsonStat(await get(u)), { kind: "house", asked: county, place: county, cadence: "quarterly", tableId: HOUSES_QUARTERLY, codes: HOUSES_QUARTERLY_CODES });
    return fig && fig.average !== null
      ? { county: county.name, reference_period: fig.reference_period, average_price: fig.average, sales: fig.sales, year_earlier: fig.year_earlier, url: u }
      : null;
  };

  if (type === "flat") {
    const r = await fetchFlats();
    return swedenAnswer(r.fig, { type, asked: place, ...asOf, apiUrls: r.urls, notes: [...notes, ...(r.note ? [r.note] : [])] });
  }

  const [houses, flats, county] = await Promise.all([
    fetchHouses(),
    type === "any" ? fetchFlats().catch(() => null) : Promise.resolve(null),
    place.level === "municipality" ? fetchCounty().catch(() => null) : Promise.resolve(null),
  ]);
  const context: Record<string, unknown> = {};
  const urls = [...houses.urls];
  if (county) {
    const { url: u, ...rest } = county;
    context.county_latest_quarter = rest;
    urls.push(u);
  }
  if (flats?.fig) {
    context.other_types = [
      {
        type: "flat",
        label: KIND_WORDS.flat.label,
        place: flats.fig.place.name,
        reference_period: flats.fig.reference_period,
        median_price: flats.fig.median,
        average_price: flats.fig.average,
        sales: flats.fig.sales,
      },
    ];
    urls.push(...flats.urls);
  }
  return swedenAnswer(houses.fig, { type, asked: place, ...asOf, apiUrls: urls, notes: [...notes, ...(houses.note ? [houses.note] : [])], context });
}
