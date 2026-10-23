// Finland home prices from Statistics Finland (Tilastokeskus), "Prices of dwellings in housing companies" (ashi), three PxWeb tables:
//   15is  quarterly, whole country / regions / larger cities, by building type: average price per m², number of transactions and the
//         official price-index changes (newest quarter provisional, marked *)
//   13mu  yearly, by postal code area (replaced 13mt, archived by Statistics Finland on 20 Oct 2026): flats in blocks by number of rooms, and terraced houses
//   13mx  yearly, by municipality (all 301): average price per m² and number of transactions, by building type
// Format checked live on 2026-10-14: the table metadata is a GET (Probe workflow); the data needs a POST of an item selection (PxWeb v1)
// and answers JSON-stat 2.0 with format "json-stat2". Variable codes carry a date (alue_43_20260625, postinumeroalue_4_20220101 ...)
// that changes when Statistics Finland revises a classification, so they are read from the metadata at request time, never hard-coded.
//
// Statistics Finland says average prices per m² "describe regional differences in price levels and ... should not be used to calculate
// price change". So no change figure is calculated here: the quarterly answer passes on the official price-index changes (quarterly and
// annual) of the same table; the postal-code and yearly answers carry no change figure.

import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { fetchJson, InputError, SourceError } from "../../lib/http";
import { parseJsonStat, periodRange, previousPeriod, resolveFetcher } from "../../lib/adapters";
import type { FetchOptions, JsonStatTable } from "../../lib/adapters";
import type { SourceInfo } from "../../lib/plugin";
import { confidenceLabel, MIN_PUBLISH } from "../../lib/stats";
import type { DailyRow, HarvestResult } from "../../lib/plugin";
import { FI_MUNICIPALITIES, FI_QUARTERLY_REGIONS } from "./places";

export const INFO: SourceInfo = {
  id: "fi-home-prices",
  country: "FI (Finland)",
  category: "home sales (official price per m² of old dwellings in housing companies)",
  name: "Prices of dwellings in housing companies: price per square metre and number of transactions (Statistics Finland tables 15is, 13mu, 13mx)",
  publisher: "Statistics Finland (Tilastokeskus)",
  what_is_recorded:
    "For old (second-hand) dwellings in housing companies, i.e. flats in blocks of flats and terraced houses: the average price per square metre and the number of transactions " +
    "from the asset transfer tax data of the Tax Administration, by quarter for the whole country, regions and larger cities (with the official price-index changes), " +
    "by year for postal code areas and for every municipality, as published by Statistics Finland. One published figure per cell; never individual sales or addresses.",
  price_type: "official_statistic",
  freshness:
    "Whole country, regions and larger cities: quarterly, the newest quarter provisional (marked * by Statistics Finland) and published about four weeks after it ends. " +
    "Postal code areas and municipalities: yearly, final in May. Each answer states its period and whether it is provisional",
  licence:
    "Statistics Finland: \"Statistics Finland's open data materials and public content of the web service are covered by the Creative Commons Attribution 4.0 International licence. " +
    "According to the licence, you can copy, edit and share these data either in original or edited format. You can also combine the data with other data and use the data for commercial purposes as well.\" " +
    "\"When you use these data or share them, give at least Statistics Finland as the source (Source: Statistics Finland).\"",
  licence_url: "https://stat.fi/en/about-us/get-to-know-statistics-finland/legislation/terms-of-use",
  attribution:
    "Source: Statistics Finland, prices of dwellings in housing companies (tables 15is, 13mu and 13mx; https://stat.fi/en/statistics/ashi), licensed CC BY 4.0 " +
    "(https://creativecommons.org/licenses/by/4.0/). Prices and price-index changes are passed on as published.",
  homepage: "https://stat.fi/en/statistics/ashi",
  limits:
    "Covers only old dwellings in housing companies (flats in blocks of flats and terraced houses, the latter including detached houses with shares in a housing corporation); detached houses owned as real estate and new-builds are not in it. " +
    "An average price per square metre, not a valuation: it moves with the mix of dwellings sold, and Statistics Finland says it should not be used to calculate price change (we pass on the official price-index changes instead, for the whole country, regions and larger cities only). " +
    "The number of transactions also counts price-controlled (HITAS) and subsidised dwellings and outliers that are left out of the price, and it is revised in later releases. " +
    "Statistics Finland withholds a figure where it would identify too few dwellings, so small places and some dwelling types are missing. Whole-country data exclude Åland. Prices are in euros per m², not per home.",
};

export const STATFIN_API = "https://pxdata.stat.fi/PxWeb/api/v1/en/StatFin/ashi";
export const QUARTERLY = "15is";
export const POSTCODE = "13mu";
export const YEARLY = "13mx";

/** Fold a name for matching: lower case, no diacritics (å ä ö é...), punctuation as single spaces. */
export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ø/g, "o")
    .replace(/æ/g, "ae")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// ---------- property types ----------

export type TypeKey = "any" | "flat" | "terraced" | "house" | "detached";
type Building = "any" | "flat" | "terraced";
const BUILDING_LABEL: Record<Building, string> = { any: "all building types", flat: "blocks of flats", terraced: "terraced houses" };

/** "flat", "apartment", "kerrostalo" -> a type. Throws InputError listing the choices. */
export function normaliseType(raw?: string): TypeKey {
  const s = fold(raw ?? "");
  if (["", "any", "all", "total", "kaikki"].includes(s)) return "any";
  if (["flat", "flats", "apartment", "apartments", "condo", "condominium", "block of flats", "blocks of flats", "kerrostalo", "kerrostalot", "osakehuoneisto", "asunto"].includes(s)) return "flat";
  if (["terraced", "terrace", "terraced house", "terraced houses", "row house", "row houses", "rowhouse", "townhouse", "town house", "semi detached", "attached house", "rivitalo", "rivitalot", "paritalo"].includes(s)) return "terraced";
  if (["house", "houses", "home", "single family", "single family house", "omakotitalo", "omakotitalot", "villa"].includes(s)) return "house";
  if (["detached", "detached house", "detached houses"].includes(s)) return "detached";
  throw new InputError(`property_type for Finland must be one of: any (default), flat (blocks of flats), terraced (terraced houses). House and detached are not covered: ${String(raw)}.`);
}

// ---------- places ----------

export type Level = "country" | "area" | "region" | "municipality";
export interface Place {
  level: Level;
  name: string;
  short: string;
  /** Region code in the quarterly table (15is), when the table has this place. */
  quarterly: string | null;
  /** Municipality code in the yearly table (13mx). */
  municipality: string | null;
}

const COUNTRY: Place = { level: "country", name: "Finland", short: "Finland", quarterly: "SSS", municipality: null };
const QUARTERLY_CODES = new Set(FI_QUARTERLY_REGIONS.map(([c]) => c));

function buildPlaces(): Place[] {
  const out: Place[] = [COUNTRY];
  for (const [code, name] of FI_QUARTERLY_REGIONS) {
    if (code === "SSS" || code.includes("-") || /^\d{3}$/.test(code)) continue; // the country, city sub-areas, municipalities (from the yearly list)
    const short = name.replace(/^MK\d{2}\s+/, "");
    out.push({ level: code.startsWith("MK") ? "region" : "area", name: short, short, quarterly: code, municipality: null });
  }
  for (const [code, name] of FI_MUNICIPALITIES) out.push({ level: "municipality", name, short: name, quarterly: QUARTERLY_CODES.has(code) ? code : null, municipality: code });
  return out;
}
export const PLACES: Place[] = buildPlaces();
const RANK: Record<Level, number> = { municipality: 0, region: 1, area: 2, country: 3 };

const INDEX = new Map<string, Place[]>();
function addKey(key: string, p: Place) {
  const k = fold(key);
  if (!k) return;
  const list = INDEX.get(k) ?? [];
  if (!list.includes(p)) list.push(p);
  INDEX.set(k, list);
}
for (const p of PLACES) addKey(p.short, p);

const byQuarterly = (code: string) => PLACES.find((p) => p.quarterly === code && p.level !== "municipality")!;
const byMunicipality = (code: string) => PLACES.find((p) => p.municipality === code)!;
// Swedish and English names, and short forms.
const ALIASES: Array<[string[], Place]> = [
  [["suomi", "whole country", "the whole country", "national", "nationwide", "koko maa", "koko suomi"], COUNTRY],
  [["helsinki metropolitan area", "capital region", "metropolitan area", "helsinki region", "paakaupunkiseutu", "pks"], byQuarterly("pks")],
  [["helsingfors"], byMunicipality("091")],
  [["esbo"], byMunicipality("049")],
  [["vanda"], byMunicipality("092")],
  [["abo"], byMunicipality("853")],
  [["tammerfors"], byMunicipality("837")],
  [["uleaborg"], byMunicipality("564")],
  [["vasa"], byMunicipality("905")],
  [["lahtis"], byMunicipality("398")],
  [["villmanstrand"], byMunicipality("405")],
  [["bjorneborg"], byMunicipality("609")],
  [["kajana"], byMunicipality("205")],
  [["borga"], byMunicipality("638")],
  [["tavastehus"], byMunicipality("109")],
  [["karleby"], byMunicipality("272")],
  [["grankulla"], byMunicipality("235")],
  [["nyland"], byQuarterly("MK01")],
  [["egentliga finland", "southwest finland", "south west finland"], byQuarterly("MK02")],
  [["birkaland", "tampere region"], byQuarterly("MK06")],
  [["etela karjala", "south carelia"], byQuarterly("MK09")],
  [["south savo", "sodra savolax"], byQuarterly("MK10")],
  [["north savo", "norra savolax"], byQuarterly("MK11")],
  [["pohjois karjala", "north karelia", "north carelia", "norra karelen"], byQuarterly("MK12")],
  [["keski suomi", "mellersta finland"], byQuarterly("MK13")],
  [["etela pohjanmaa", "south ostrobothnia", "sodra osterbotten"], byQuarterly("MK14")],
  [["pohjanmaa", "osterbotten"], byQuarterly("MK15")],
  [["keski pohjanmaa", "mellersta osterbotten"], byQuarterly("MK16")],
  [["pohjois pohjanmaa", "north ostrobothnia", "norra osterbotten"], byQuarterly("MK17")],
  [["lappi", "lappland"], byQuarterly("MK19")],
];
for (const [keys, place] of ALIASES) for (const k of keys) addKey(k, place);

const SUFFIX = /\s+(municipality|city|kaupunki|kunta|region|maakunta|kommun)$/i;

/** Resolve a town, region or area (with or without ä ö å, Finnish, Swedish or English). Empty -> the whole country. Throws InputError if unknown. */
export function resolvePlace(town?: string): Place {
  const raw = (town ?? "").trim();
  if (!raw) return COUNTRY;
  const full = fold(raw);
  const key = INDEX.has(full) ? full : fold(raw.replace(SUFFIX, "")); // "capital region" is a name; "Oulu city" is Oulu
  const hits = INDEX.get(key);
  if (hits && hits.length) {
    const best = Math.min(...hits.map((p) => RANK[p.level]));
    const top = hits.filter((p) => RANK[p.level] === best);
    if (top.length === 1) return top[0];
    throw new InputError(`"${raw}" matches several places in Finland: ${top.map((p) => p.name).join("; ")}. Use one of those names.`);
  }
  const near = PLACES.filter((p) => key.length >= 3 && fold(p.name).includes(key)).slice(0, 5);
  throw new InputError(
    `Statistics Finland has no place called "${raw}". Use a municipality (kunta) such as Helsinki, Espoo, Tampere or Oulu, a region (maakunta) such as Uusimaa or Pirkanmaa, "Greater Helsinki", or a five-digit postcode.` +
      (near.length ? ` Did you mean: ${near.map((p) => p.name).join("; ")}?` : ""),
  );
}

/** A Finnish postcode is five digits. Returns null for none; throws InputError for anything else. */
export function normalisePostcode(raw?: string): string | null {
  const s = (raw ?? "").trim().replace(/\s+/g, "").replace(/^(FI-?)/i, "");
  if (!s) return null;
  if (!/^\d{5}$/.test(s)) throw new InputError(`A Finnish postcode has five digits (for example 00100), not "${String(raw)}".`);
  return s;
}

// ---------- periods ----------

/** "2026Q2" -> "2026-Q2"; a year stays "2025". */
export function isoPeriod(code: string): string {
  const m = /^(\d{4})Q([1-4])\*?$/.exec(code);
  return m ? `${m[1]}-Q${m[2]}` : code.replace(/\*$/, "");
}

/** "2026-Q3" -> "the third quarter of 2026"; "2025" -> "2025". */
export function periodWords(code: string): string {
  const m = /^(\d{4})-Q([1-4])$/.exec(code);
  return m ? `the ${["first", "second", "third", "fourth"][Number(m[2]) - 1]} quarter of ${m[1]}` : code;
}

/** The same quarter one year earlier: "2026-Q3" -> "2025-Q3". */
export function yearEarlier(code: string): string | null {
  const m = /^(\d{4})-Q([1-4])$/.exec(code);
  return m ? `${Number(m[1]) - 1}-Q${m[2]}` : null;
}

const DAY = 86400000;

/** Plain-words caveat when a figure is old (over 15 months since its period ended). */
export function ageNote(periodTo: string | null, now: Date): string | null {
  if (!periodTo) return null;
  const days = Math.round((now.getTime() - Date.parse(periodTo + "T23:59:59Z")) / DAY);
  if (days <= 450) return null;
  return `This figure is old: its period ended about ${Math.round(days / 30)} months ago.`;
}

// ---------- table metadata and the request ----------

export interface PxVariable {
  code: string;
  text: string;
  values: string[];
  valueTexts: string[];
  time: boolean;
}
export interface PxMeta {
  title: string;
  variables: PxVariable[];
}

/** The answer of GET <table>.px: the variables with their codes and values. */
export function readMeta(json: unknown): PxMeta {
  const j = json as any;
  if (!j || typeof j !== "object" || !Array.isArray(j.variables)) throw new SourceError("Unexpected response from Statistics Finland (no table metadata)");
  return {
    title: String(j.title ?? ""),
    variables: j.variables.map((v: any) => ({
      code: String(v.code),
      text: String(v.text ?? ""),
      values: Array.isArray(v.values) ? v.values.map(String) : [],
      valueTexts: Array.isArray(v.valueTexts) ? v.valueTexts.map(String) : [],
      time: v.time === true,
    })),
  };
}

/** The variable whose code matches. Codes carry a date that changes when a classification is revised, so match the stem. */
export function findVariable(meta: PxMeta, pattern: RegExp, what: string): PxVariable {
  const v = meta.variables.find((x) => pattern.test(x.code));
  if (!v) throw new SourceError(`Statistics Finland has changed this table: no ${what} variable (${meta.title.slice(0, 80)})`);
  return v;
}

function pick(values: string[], pattern: RegExp, what: string): string {
  const v = values.find((x) => pattern.test(x));
  if (!v) throw new SourceError(`Statistics Finland has changed this table: no ${what} among its information (${values.slice(0, 6).join(", ")})`);
  return v;
}

/** The newest "number of sales" code (lkm_julk20 before lkm_julk19). */
function newestCount(values: string[]): string {
  const counts = values.filter((x) => /^lkm_julk\d+$/.test(x)).sort((a, b) => Number(b.replace(/\D/g, "")) - Number(a.replace(/\D/g, "")));
  if (!counts.length) throw new SourceError("Statistics Finland has changed this table: no number of sales among its information");
  return counts[0];
}

export interface PxQuery {
  query: Array<{ code: string; selection: { filter: "item"; values: string[] } }>;
  response: { format: "json-stat2" };
}
export function buildQuery(selections: Array<[string, string[]]>): PxQuery {
  return { query: selections.map(([code, values]) => ({ code, selection: { filter: "item" as const, values } })), response: { format: "json-stat2" } };
}

const lastOf = (values: string[], n: number) => values.slice(Math.max(0, values.length - n));
const tableUrl = (table: string, base = STATFIN_API) => `${base}/${table}.px`;

// ---------- reading the cubes (pure) ----------

type Dims = Record<string, string>;
function cubeOf(table: JsonStatTable): (dims: Dims) => number | null {
  const idx = new Map<string, number>();
  for (const r of table.rows) idx.set(table.ids.map((id) => String(r[id])).join("|"), r.value as number);
  return (dims) => {
    const v = idx.get(table.ids.map((id) => dims[id] ?? "").join("|"));
    return v === undefined ? null : v;
  };
}
const times = (table: JsonStatTable, id: string) => [...(table.codes[id] ?? [])].sort();
const isProvisional = (table: JsonStatTable, id: string, code: string) => (table.labels[id]?.[code] ?? "").endsWith("*");
const positive = (v: number | null) => (v !== null && v > 0 ? v : null);

export interface Group {
  key: string;
  label: string;
  price: number | null;
  sales: number | null;
}
export interface IndexChange {
  previous: { reference_period: string; change_percent: number } | null;
  year_earlier: { reference_period: string; change_percent: number } | null;
}
export interface Figure {
  mode: "quarterly" | "postcode" | "yearly";
  reference_period: string;
  provisional: boolean;
  price: number | null;
  sales: number | null;
  /** What the price is for, e.g. "blocks of flats" or "two-room flats in blocks of flats". */
  groupLabel: string;
  /** The area as the table labels it. */
  areaLabel: string;
  index_change: IndexChange | null;
  national: { price: number; sales: number | null } | null;
  /** The other groups at the same period (building types, or room sizes for a postcode). */
  groups: Group[];
  /** True when the newest period of the table has no price for this place and an earlier one is used. */
  olderThanTable: boolean;
  latestInTable: string | null;
}

export interface QuarterlyVars {
  region: string;
  type: string;
  rooms: string;
  time: string;
  contents: string;
}
export interface QuarterlyCodes {
  price: string;
  count: string;
  qchange: string | null;
  ychange: string | null;
}

/** Table 15is for one region (and the whole country): newest quarter with a price for the building type, plus the official index changes. */
export function readQuarterly(
  table: JsonStatTable,
  v: QuarterlyVars,
  c: QuarterlyCodes,
  q: { region: string; building: Building; buildingCodes: Record<Building, string> },
): Figure | null {
  const cell = cubeOf(table);
  const rooms = table.codes[v.rooms]?.[0] ?? "00";
  const get = (region: string, type: string, t: string, content: string | null) =>
    content ? cell({ [v.region]: region, [v.type]: type, [v.rooms]: rooms, [v.time]: t, [v.contents]: content }) : null;
  const ts = times(table, v.time);
  const type = q.buildingCodes[q.building];
  const latest = [...ts].reverse().find((t) => positive(get(q.region, type, t, c.price)) !== null);
  if (!latest) return null;
  const ref = isoPeriod(latest);
  const prevRef = previousPeriod(ref);
  const yearRef = yearEarlier(ref);
  const qch = get(q.region, type, latest, c.qchange);
  const ych = get(q.region, type, latest, c.ychange);
  const nat = q.region === "SSS" ? null : positive(get("SSS", type, latest, c.price));
  const groups: Group[] = (["any", "terraced", "flat"] as Building[])
    .filter((b) => q.buildingCodes[b])
    .map((b) => ({ key: b, label: BUILDING_LABEL[b], price: positive(get(q.region, q.buildingCodes[b], latest, c.price)), sales: get(q.region, q.buildingCodes[b], latest, c.count) }));
  return {
    mode: "quarterly",
    reference_period: ref,
    provisional: isProvisional(table, v.time, latest),
    price: positive(get(q.region, type, latest, c.price)),
    sales: get(q.region, type, latest, c.count),
    groupLabel: BUILDING_LABEL[q.building],
    areaLabel: table.labels[v.region]?.[q.region] ?? q.region,
    index_change:
      qch !== null || ych !== null
        ? {
            previous: qch !== null && prevRef ? { reference_period: prevRef, change_percent: qch } : null,
            year_earlier: ych !== null && yearRef ? { reference_period: yearRef, change_percent: ych } : null,
          }
        : null,
    national: nat !== null ? { price: nat, sales: get("SSS", type, latest, c.count) } : null,
    groups,
    olderThanTable: latest !== ts[ts.length - 1],
    latestInTable: ts.length ? isoPeriod(ts[ts.length - 1]) : null,
  };
}

export interface PostcodeVars {
  time: string;
  postal: string;
  type: string;
  contents: string;
}
export interface PostcodeCodes {
  price: string;
  count: string;
}
/** Which building-type codes of table 13mu are flats (by number of rooms) and which are terraced houses, read from their texts. */
export function classifyPostcodeTypes(meta: PxMeta): { flats: string[]; terraced: string[] } {
  const v = findVariable(meta, /^talotyyppi_/, "building type");
  const flats: string[] = [];
  const terraced: string[] = [];
  v.values.forEach((code, i) => {
    const text = v.valueTexts[i] ?? "";
    if (/blocks of flats/i.test(text)) flats.push(code);
    else if (/terraced/i.test(text)) terraced.push(code);
  });
  return { flats, terraced };
}

/**
 * Table 13mu (or the archived quarterly 13mt, same layout) for one postal code area: the newest quarter in which a group of the asked kind has a price from at least MIN_PUBLISH
 * transactions. The headline is the group with most transactions (flats come by number of rooms, there is no total); the others are listed.
 * Returns {insufficient} when there are prices but every group has fewer transactions than that, and null when everything is withheld.
 */
export function readPostcode(
  table: JsonStatTable,
  v: PostcodeVars,
  c: PostcodeCodes,
  q: { postcode: string; codes: string[] },
): Figure | { insufficient: { sales: number; label: string } } | null {
  const cell = cubeOf(table);
  const ts = times(table, v.time);
  const label = (code: string) => table.labels[v.type]?.[code] ?? code;
  const groupsAt = (t: string): Group[] =>
    q.codes.map((code) => ({
      key: code,
      label: label(code),
      price: positive(cell({ [v.time]: t, [v.postal]: q.postcode, [v.type]: code, [v.contents]: c.price })),
      sales: cell({ [v.time]: t, [v.postal]: q.postcode, [v.type]: code, [v.contents]: c.count }),
    }));
  const usable = (g: Group) => g.price !== null && g.sales !== null && g.sales >= MIN_PUBLISH;
  let thin: { sales: number; label: string } | null = null;
  for (let i = ts.length - 1; i >= 0; i--) {
    const groups = groupsAt(ts[i]);
    const good = groups.filter(usable).sort((a, b) => (b.sales ?? 0) - (a.sales ?? 0));
    if (good.length) {
      const head = good[0];
      return {
        mode: "postcode",
        reference_period: isoPeriod(ts[i]),
        provisional: isProvisional(table, v.time, ts[i]),
        price: head.price,
        sales: head.sales,
        groupLabel: head.label,
        areaLabel: (table.labels[v.postal]?.[q.postcode] ?? q.postcode).replace(/\s+/g, " ").trim(),
        index_change: null,
        national: null,
        groups: groups.filter((g) => g.price !== null || g.sales !== null),
        olderThanTable: i !== ts.length - 1,
        latestInTable: ts.length ? isoPeriod(ts[ts.length - 1]) : null,
      };
    }
    if (!thin) {
      const priced = groups.filter((g) => g.price !== null).sort((a, b) => (b.sales ?? 0) - (a.sales ?? 0))[0];
      if (priced) thin = { sales: priced.sales ?? 0, label: priced.label };
    }
  }
  return thin ? { insufficient: thin } : null;
}

export interface YearlyVars {
  time: string;
  municipality: string;
  type: string;
  contents: string;
}
/** Table 13mx for one municipality: the newest year with a price for the building type. */
export function readYearly(
  table: JsonStatTable,
  v: YearlyVars,
  c: PostcodeCodes,
  q: { municipality: string; building: Building; buildingCodes: Record<Building, string> },
): Figure | null {
  const cell = cubeOf(table);
  const ts = times(table, v.time);
  const get = (type: string, t: string, content: string) => cell({ [v.time]: t, [v.municipality]: q.municipality, [v.type]: type, [v.contents]: content });
  const type = q.buildingCodes[q.building];
  const latest = [...ts].reverse().find((t) => positive(get(type, t, c.price)) !== null);
  if (!latest) return null;
  const groups: Group[] = (["any", "terraced", "flat"] as Building[])
    .filter((b) => q.buildingCodes[b])
    .map((b) => ({ key: b, label: BUILDING_LABEL[b], price: positive(get(q.buildingCodes[b], latest, c.price)), sales: get(q.buildingCodes[b], latest, c.count) }));
  return {
    mode: "yearly",
    reference_period: isoPeriod(latest),
    provisional: isProvisional(table, v.time, latest),
    price: positive(get(type, latest, c.price)),
    sales: get(type, latest, c.count),
    groupLabel: BUILDING_LABEL[q.building],
    areaLabel: table.labels[v.municipality]?.[q.municipality] ?? q.municipality,
    index_change: null,
    national: null,
    groups,
    olderThanTable: latest !== ts[ts.length - 1],
    latestInTable: ts.length ? isoPeriod(ts[ts.length - 1]) : null,
  };
}

// ---------- the answer (pure) ----------

function oneChange(percent: number, label: string): string {
  if (percent === 0) return `unchanged from ${label.replace(/^in /, "")}`;
  return `${Math.abs(percent)}% ${percent > 0 ? "higher" : "lower"} than ${label}`;
}

/** The official price-index changes, in words. */
export function changeSentence(ic: IndexChange | null): string {
  if (!ic) return "";
  const parts: string[] = [];
  if (ic.previous) parts.push(oneChange(ic.previous.change_percent, `in ${periodWords(ic.previous.reference_period)}`));
  if (ic.year_earlier) parts.push(oneChange(ic.year_earlier.change_percent, `a year earlier (${periodWords(ic.year_earlier.reference_period)})`));
  return parts.length ? ` Statistics Finland's price index for these dwellings (a quality-adjusted measure, not this average) is ${parts.join(" and ")}.` : "";
}

export const METHOD =
  "Statistics Finland publishes, from the Tax Administration's asset transfer tax data, the average price per square metre and the number of transactions of old dwellings in housing companies " +
  `(flats in blocks and terraced houses): quarterly for the whole country, regions and larger cities (table ${QUARTERLY}, with the official price-index changes), yearly by postal code area (table ${POSTCODE}) ` +
  `and yearly for every municipality (table ${YEARLY}). ProofPrice returns the published average for the newest period that has a price, unchanged. ` +
  "Statistics Finland says average prices per square metre describe regional differences in price levels and should not be used to calculate price change, so no change is calculated: " +
  "the quarterly answer carries the published price-index changes, and the other tables carry none. For a postal code, flats are published by number of rooms with no total, so the answer is the room size with most transactions and the others are listed. " +
  "No range is calculated: only one average and the number of transactions are published.";

export interface AnswerInput {
  place: Place | null;
  postcode?: string | null;
  type: TypeKey;
  baseUrl?: string;
  apis?: { metadata_url: string; data_url: string; method: "POST"; query: PxQuery };
  now?: Date;
  notes?: string[];
}

const eur = (v: number) => fmtMoney(v, "EUR");
const nf = (n: number) => n.toLocaleString("en-GB");

/** A table-13mt group label in words: "Blocks of flats, two-room flat" -> "two-room flats". */
export function roomsPhrase(label: string): string {
  const m = /^Blocks of flats,\s*(one|two|three)-room flat(\+?)$/i.exec(label.trim());
  if (m) return m[1].toLowerCase() === "three" && m[2] ? "flats with three or more rooms" : `${m[1].toLowerCase()}-room flats`;
  return label.replace(/\s+total$/i, "").toLowerCase();
}

function whereOf(q: AnswerInput, f?: Figure): string {
  if (q.postcode) {
    const name = f ? f.areaLabel.replace(/^\d{5}\s*/, "").trim() : "";
    return name ? `postal code area ${q.postcode} ${name}` : `postal code ${q.postcode}`; // the name already ends in "(Helsinki)", so no extra brackets
  }
  return q.place && q.place.level !== "country" ? q.place.short : "Finland";
}

export function finlandAnswer(result: Figure | { insufficient: { sales: number; label: string } } | null, q: AnswerInput): PriceAnswer {
  const now = q.now ?? new Date();
  const query = { country: "FI", ...(q.postcode ? { postcode: q.postcode } : { town: q.place?.short ?? "Finland" }), property_type: q.type };
  const base = { source: INFO, query, measure: "average" as const, currency: "EUR", unit: "per m²", method: METHOD, baseUrl: q.baseUrl };
  const none = (summary: string): PriceAnswer => ({
    ...buildStatisticAnswer({ ...base, value: null, period: { from: null, to: null }, reference_period: "", describe: () => "" }),
    summary,
  });
  const kind = q.type === "flat" ? "flats in blocks of flats" : q.type === "terraced" ? "terraced houses" : "old dwellings in housing companies";

  if (!result) {
    return none(
      `Statistics Finland publishes no price per m² of ${kind} for ${whereOf(q)} in the periods checked (too few dwellings, or the place is not covered). ` +
        (q.postcode ? "Try the town or the whole country." : "Try the region or the whole country."),
    );
  }
  if ("insufficient" in result) {
    const a = none(
      `Statistics Finland reports only ${result.insufficient.sales} transaction(s) of ${result.insufficient.label.toLowerCase()} behind the latest average for ${whereOf(q)}; at least ${MIN_PUBLISH} are needed before we publish a figure.`,
    );
    return { ...a, status: "insufficient_data" };
  }

  const f = result;
  const range = periodRange(f.reference_period);
  const place = q.place;
  const notes: string[] = [];
  if (f.provisional) {
    notes.push(
      "Provisional: Statistics Finland marks the newest periods with * and revises them; the number of transactions is also revised as the Tax Administration's transfer tax statements arrive (final data normally in May).",
    );
  }
  if (f.mode === "quarterly" && place && place.municipality && place.quarterly && f.areaLabel && fold(f.areaLabel) !== fold(place.short)) {
    notes.push(`Statistics Finland's quarterly table publishes ${f.areaLabel} together, so the figure is for ${f.areaLabel}.`);
  }
  if (f.mode === "yearly" && place) {
    notes.push(`Statistics Finland publishes quarterly figures only for the whole country, regions and larger cities; for ${place.short} the yearly municipality figure is used.`);
  }
  if (f.mode === "postcode" && q.type !== "terraced") {
    notes.push("Statistics Finland publishes flats in a postal code area by number of rooms, with no total: the figure is for the room size with most transactions and the other sizes are in extra.groups.");
  }
  if (f.olderThanTable && f.latestInTable) {
    notes.push(`The newest period in the table is ${periodWords(f.latestInTable)}, but Statistics Finland has no usable price for ${whereOf(q)} then (withheld or too few transactions), so the newest period with a price is shown.`);
  }
  if (f.mode === "postcode" && f.latestInTable) {
    notes.push(`The postal code table runs one period behind the city table (newest here: ${periodWords(f.latestInTable)}).`);
  }
  const old = ageNote(range?.to ?? null, now);
  if (old) notes.push(old);
  if (f.sales !== null && f.sales >= MIN_PUBLISH && f.sales < 30) notes.push(`Only ${f.sales} transactions stand behind this average, so it is volatile.`);
  notes.push("An average price per m² shows the price level, not price change (Statistics Finland); the transactions count also includes price-controlled and subsidised dwellings and outliers left out of the price.");
  if (q.notes) notes.push(...q.notes);

  const extra: Record<string, unknown> = {
    place: q.postcode
      ? { postcode: q.postcode, name: f.areaLabel }
      : { name: place?.short ?? "Finland", level: place?.level ?? "country", table_area: f.areaLabel, region_code: place?.quarterly ?? null, municipality_code: place?.municipality ?? null },
    property_type: { used: q.type, group: f.groupLabel },
    table: f.mode === "quarterly" ? QUARTERLY : f.mode === "postcode" ? POSTCODE : YEARLY,
    reference_period_label: periodWords(f.reference_period),
    provisional: f.provisional,
    groups: f.groups.map((g) => ({ label: g.label, price_per_m2: g.price, transactions: g.sales })),
    ...(f.index_change ? { price_index_change: f.index_change } : {}),
    ...(f.national ? { national_average: { price_per_m2: f.national.price, transactions: f.national.sales, reference_period: f.reference_period } } : {}),
    latest_period_in_table: f.latestInTable,
    ...(q.apis ? { statfin_api: q.apis } : {}),
  };

  const stat = buildStatisticAnswer({
    ...base,
    value: f.price,
    period: range ?? { from: null, to: null },
    reference_period: f.reference_period,
    sample_size: f.sales,
    note: notes.join(" "),
    describe: (v) => {
      const others =
        f.mode === "postcode"
          ? f.groups
              .filter((g) => g.price !== null && g.label !== f.groupLabel && (g.sales ?? 0) >= MIN_PUBLISH)
              .map((g) => `${roomsPhrase(g.label)} ${eur(g.price as number)} (${g.sales} transactions)`)
          : [];
      const what = f.mode === "postcode" ? `${roomsPhrase(f.groupLabel)}${/flat/.test(f.groupLabel) ? " in blocks of flats" : ""}` : `old dwellings in housing companies (${f.groupLabel})`;
      return (
        `In ${whereOf(q, f)} the average price per m² of ${what} ` +
        `was ${eur(v)} in ${periodWords(f.reference_period)}${f.provisional ? " (provisional)" : ""}` +
        // Statistics Finland's count also holds price-controlled (HITAS) and subsidised dwellings and outliers that are left out of the
        // average, so the count is not the number of sales behind the price: say so in the sentence itself.
        (f.sales !== null ? `, with ${nf(f.sales)} transactions counted (a count that also includes price-controlled and subsidised dwellings left out of the average).` : ".") +
        (others.length ? ` Other sizes: ${others.join("; ")}.` : "") +
        changeSentence(f.index_change)
      );
    },
    extra,
  });

  if (f.sales !== null) {
    if (f.sales < MIN_PUBLISH) {
      return { ...none(`Statistics Finland reports only ${f.sales} transaction(s) behind this average for ${whereOf(q)}; at least ${MIN_PUBLISH} are needed before we publish a figure.`), status: "insufficient_data" };
    }
    stat.confidence = confidenceLabel(f.sales);
  }
  return stat;
}

/** House and detached are not in these tables. */
export function unavailableAnswer(type: TypeKey, q: { place: Place | null; postcode?: string | null; baseUrl?: string }): PriceAnswer {
  const none = buildStatisticAnswer({
    source: INFO,
    query: { country: "FI", ...(q.postcode ? { postcode: q.postcode } : { town: q.place?.short ?? "Finland" }), property_type: type },
    value: null,
    measure: "average",
    currency: "EUR",
    unit: "per m²",
    period: { from: null, to: null },
    reference_period: "",
    method: METHOD,
    describe: () => "",
    baseUrl: q.baseUrl,
  });
  return {
    ...none,
    summary:
      `Statistics Finland's price statistics cover old dwellings in housing companies (flats in blocks of flats and terraced houses); ${type === "detached" ? "detached" : "single-family"} houses owned as real estate are not in them. ` +
      "Ask with property_type 'flat' for blocks of flats or 'terraced' for terraced houses.",
  };
}

// ---------- the request ----------

export interface FinlandInput {
  town?: string;
  postcode?: string;
  property_type?: string;
  baseUrl?: string;
}
export interface FinlandOptions extends FetchOptions {
  /** Replace the POST (tests). Default: lib/http fetchJson. */
  poster?: (url: string, body: unknown) => Promise<unknown>;
  now?: Date;
  apiBase?: string;
}

function poster(o: FinlandOptions): (url: string, body: unknown) => Promise<unknown> {
  return o.poster ?? ((url, body) => fetchJson(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, o.timeoutMs ?? 20000));
}

function buildingCodes(v: PxVariable): Record<Building, string> {
  const out: Partial<Record<Building, string>> = {};
  v.values.forEach((code, i) => {
    const text = v.valueTexts[i] ?? "";
    if (/total/i.test(text)) out.any = code;
    else if (/terraced/i.test(text)) out.terraced = code;
    else if (/blocks of flats/i.test(text)) out.flat = code;
  });
  if (!out.any || !out.terraced || !out.flat) throw new SourceError("Statistics Finland has changed this table: building types not recognised");
  return out as Record<Building, string>;
}

export async function finlandHomePrices(input: FinlandInput, o: FinlandOptions = {}): Promise<PriceAnswer> {
  const type = normaliseType(input.property_type);
  const postcode = normalisePostcode(input.postcode);
  const place = postcode ? null : resolvePlace(input.town);
  if (type === "house" || type === "detached") return unavailableAnswer(type, { place, postcode, baseUrl: input.baseUrl });
  const building: Building = type === "flat" ? "flat" : type === "terraced" ? "terraced" : "any";
  const notes: string[] = [];
  if (postcode && input.town) notes.push(`The town "${input.town}" was ignored: the postcode ${postcode} is more precise.`);
  const get = resolveFetcher(o);
  const post = poster(o);
  const common = { type, baseUrl: input.baseUrl, now: o.now, notes };

  // ---- postal code: table 13mu (yearly) ----
  if (postcode) {
    const url = tableUrl(POSTCODE, o.apiBase);
    const meta = readMeta(await get(url));
    const time = findVariable(meta, /^timeperiod_/, "time");
    const postal = findVariable(meta, /^postinumeroalue_/, "postal code");
    const typeVar = findVariable(meta, /^talotyyppi_/, "building type");
    const contents = findVariable(meta, /^contentscode$/, "information");
    if (!postal.values.includes(postcode)) {
      return {
        ...finlandAnswer(null, { place, postcode, ...common }),
        summary: `Statistics Finland's postal code table has no area with the postcode ${postcode}. Check the postcode, or give the town instead.`,
      };
    }
    const cls = classifyPostcodeTypes(meta);
    const codes = building === "flat" ? cls.flats : building === "terraced" ? cls.terraced : [...cls.flats, ...cls.terraced];
    const price = pick(contents.values, /^keskihinta_aritm/, "price per square metre");
    const count = newestCount(contents.values);
    const query = buildQuery([
      [time.code, lastOf(time.values, 5)],
      [postal.code, [postcode]],
      [typeVar.code, codes],
      [contents.code, [price, count]],
    ]);
    const table = parseJsonStat(await post(url, query));
    const result = readPostcode(table, { time: time.code, postal: postal.code, type: typeVar.code, contents: contents.code }, { price, count }, { postcode, codes });
    return finlandAnswer(result, { place, postcode, apis: { metadata_url: url, data_url: url, method: "POST", query }, ...common });
  }

  // ---- quarterly: table 15is (country, regions, larger cities) ----
  const p = place as Place;
  if (p.quarterly) {
    const url = tableUrl(QUARTERLY, o.apiBase);
    const meta = readMeta(await get(url));
    const region = findVariable(meta, /^alue_/, "region");
    const typeVar = findVariable(meta, /^talotyyppi_/, "building type");
    const rooms = findVariable(meta, /^huoneluku_/, "number of rooms");
    const time = findVariable(meta, /^timeperiod_/, "time");
    const contents = findVariable(meta, /^contentscode$/, "information");
    if (region.values.includes(p.quarterly)) {
      const bc = buildingCodes(typeVar);
      const price = pick(contents.values, /keskineliohinta$/, "price per square metre");
      const count = pick(contents.values, /kauppamaara_vvero$/, "number of transactions");
      const qchange = contents.values.find((x) => /indeksi_nmuutos/.test(x) && !/real/.test(x)) ?? null;
      const ychange = contents.values.find((x) => /indeksi_vmuutos/.test(x) && !/real/.test(x)) ?? null;
      const roomTotal = rooms.values.find((x, i) => /total/i.test(rooms.valueTexts[i] ?? "")) ?? rooms.values[0];
      const regions = p.quarterly === "SSS" ? ["SSS"] : [p.quarterly, "SSS"];
      const query = buildQuery([
        [region.code, regions],
        [typeVar.code, [bc.any, bc.terraced, bc.flat]],
        [rooms.code, [roomTotal]],
        [time.code, lastOf(time.values, 6)],
        [contents.code, [price, count, ...(qchange ? [qchange] : []), ...(ychange ? [ychange] : [])]],
      ]);
      const table = parseJsonStat(await post(url, query));
      const figure = readQuarterly(
        table,
        { region: region.code, type: typeVar.code, rooms: rooms.code, time: time.code, contents: contents.code },
        { price, count, qchange, ychange },
        { region: p.quarterly, building, buildingCodes: bc },
      );
      return finlandAnswer(figure, { place, apis: { metadata_url: url, data_url: url, method: "POST", query }, ...common });
    }
  }

  // ---- yearly: table 13mx (every municipality) ----
  if (!p.municipality) {
    throw new InputError(`Statistics Finland publishes ${p.short} only in its quarterly table, and that table does not list it now. Try a municipality or "Finland".`);
  }
  const municipality = p.municipality;
  const url = tableUrl(YEARLY, o.apiBase);
  const meta = readMeta(await get(url));
  const time = findVariable(meta, /^timeperiod_/, "time");
  const muni = findVariable(meta, /^kunta_/, "municipality");
  const typeVar = findVariable(meta, /^talotyyppi_/, "building type");
  const contents = findVariable(meta, /^contentscode$/, "information");
  if (!muni.values.includes(municipality)) return finlandAnswer(null, { place, ...common });
  const bc = buildingCodes(typeVar);
  const price = pick(contents.values, /^keskihinta_aritm/, "price per square metre");
  const count = newestCount(contents.values);
  const query = buildQuery([
    [time.code, lastOf(time.values, 3)],
    [muni.code, [municipality]],
    [typeVar.code, [bc.any, bc.terraced, bc.flat]],
    [contents.code, [price, count]],
  ]);
  const table = parseJsonStat(await post(url, query));
  const figure = readYearly(table, { time: time.code, municipality: muni.code, type: typeVar.code, contents: contents.code }, { price, count }, { municipality, building, buildingCodes: bc });
  return finlandAnswer(figure, { place, apis: { metadata_url: url, data_url: url, method: "POST", query }, ...common });
}

// ---------- daily collector (stale-if-error copy) ----------
// pxdata.stat.fi sometimes times out from Vercel. Once a day the collector (GitHub Actions) stores, in ONE request to the quarterly table 15is,
// the newest quarter's average price per m² and transaction count for the country, the regions, Greater Helsinki and every larger city, for
// all building types, blocks of flats and terraced houses. Rows are dated by the last day of that quarter (referenceDates) and carry the real
// count of transactions; a group with fewer than MIN_PUBLISH transactions is not stored. Postcodes and the smaller municipalities (yearly
// tables) are not collected: those requests still fail honestly when Statistics Finland is down.

const BUILDING_ITEMS: Building[] = ["any", "flat", "terraced"];

/** Quarter code "2026Q2" -> its last day, "2026-06-30". */
export function quarterEndDate(code: string): string {
  const m = /^(\d{4})Q([1-4])\*?$/.exec(code);
  if (!m) throw new SourceError(`Statistics Finland quarter not recognised: ${code}`);
  return `${m[1]}-${["03-31", "06-30", "09-30", "12-31"][Number(m[2]) - 1]}`;
}

/** The quarterly regions the collector asks for: every place the answer code can route to table 15is, plus the country. */
export function harvestRegions(available: string[]): string[] {
  const have = new Set(available);
  return Array.from(new Set(["SSS", ...PLACES.map((p) => p.quarterly).filter((c): c is string => !!c)])).filter((c) => have.has(c));
}

/** One row per region and building type that has a price and at least MIN_PUBLISH transactions in the newest quarter that has a country price. */
export function harvestRows(table: JsonStatTable, v: QuarterlyVars, c: { price: string; count: string }, bc: Record<Building, string>): HarvestResult {
  const cell = cubeOf(table);
  const rooms = table.codes[v.rooms]?.[0] ?? "00";
  const ts = times(table, v.time);
  const get = (region: string, type: string, t: string, content: string) => cell({ [v.region]: region, [v.type]: type, [v.rooms]: rooms, [v.time]: t, [v.contents]: content });
  const latest = [...ts].reverse().find((t) => positive(get("SSS", bc.any, t, c.price)) !== null);
  if (!latest) throw new SourceError("Statistics Finland returned no national price per square metre to collect");
  const rows: DailyRow[] = [];
  for (const region of table.codes[v.region] ?? []) {
    for (const b of BUILDING_ITEMS) {
      const price = positive(get(region, bc[b], latest, c.price));
      const n = get(region, bc[b], latest, c.count);
      if (price === null || n === null || n < MIN_PUBLISH) continue;
      rows.push({ area: region, item: b, n, median: price, low: price, high: price, min: price, max: price });
    }
  }
  if (!rows.some((r) => r.area === "SSS" && r.item === "any")) throw new SourceError("Statistics Finland returned no national figure with enough transactions to collect");
  const ref = isoPeriod(latest);
  return {
    date: quarterEndDate(latest),
    currency: "EUR",
    unit: "per m²",
    rows,
    note: `Statistics Finland table ${QUARTERLY}: average price per m² of old dwellings in housing companies, ${periodWords(ref)}, ${rows.length} region and building-type figures with at least ${MIN_PUBLISH} transactions each (the average itself, not single sales).`,
  };
}

export async function fiHarvest(o: FinlandOptions = {}): Promise<HarvestResult> {
  const get = resolveFetcher(o);
  const post = poster(o);
  const url = tableUrl(QUARTERLY, o.apiBase);
  const meta = readMeta(await get(url));
  const region = findVariable(meta, /^alue_/, "region");
  const typeVar = findVariable(meta, /^talotyyppi_/, "building type");
  const rooms = findVariable(meta, /^huoneluku_/, "number of rooms");
  const time = findVariable(meta, /^timeperiod_/, "time");
  const contents = findVariable(meta, /^contentscode$/, "information");
  const bc = buildingCodes(typeVar);
  const price = pick(contents.values, /keskineliohinta$/, "price per square metre");
  const count = pick(contents.values, /kauppamaara_vvero$/, "number of transactions");
  const roomTotal = rooms.values.find((x, i) => /total/i.test(rooms.valueTexts[i] ?? "")) ?? rooms.values[0];
  const query = buildQuery([
    [region.code, harvestRegions(region.values)],
    [typeVar.code, [bc.any, bc.terraced, bc.flat]],
    [rooms.code, [roomTotal]],
    [time.code, lastOf(time.values, 3)],
    [contents.code, [price, count]],
  ]);
  const table = parseJsonStat(await post(url, query));
  return harvestRows(table, { region: region.code, type: typeVar.code, rooms: rooms.code, time: time.code, contents: contents.code }, { price, count }, bc);
}

/** Library key for a request: the table-15is region code and building type. Null when the copy cannot answer it (postcode, a municipality outside the quarterly table, houses). */
export function fiHistoryKey(p: { town?: string; postcode?: string; property_type?: string }): { area: string; item: string; label: string } | null {
  if (p.postcode && String(p.postcode).trim() !== "") return null;
  try {
    const type = normaliseType(p.property_type);
    if (type === "house" || type === "detached") return null;
    const place = resolvePlace(p.town);
    if (!place.quarterly) return null;
    return { area: place.quarterly, item: type, label: place.short };
  } catch {
    return null;
  }
}
