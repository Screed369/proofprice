// Finland rents from Statistics Finland (Tilastokeskus), "Rent index and average rents" (asvu), table 15fa on PxWeb:
// average rent per square metre and the number of observations behind it, by area (whole country, Greater Helsinki, regions, towns and
// town districts), type of funding, number of rooms and quarter. Table metadata (GET) checked live 2026-10-22 from GitHub's servers
// (see meta-15fa.json); the data is a POST of an item selection (PxWeb v1) that answers JSON-stat 2.0, as in sources/fi-home-prices.
// Variable codes carry a date (alue_44_20260101 ...), so they are read from the metadata at request time, never hard-coded.

import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { fetchJson, InputError, SourceError } from "../../lib/http";
import { parseJsonStat, resolveFetcher } from "../../lib/adapters";
import type { FetchOptions, JsonStatTable } from "../../lib/adapters";
import type { SourceInfo } from "../../lib/plugin";
import { MIN_PUBLISH } from "../../lib/stats";

export const INFO: SourceInfo = {
  id: "fi-stat-rents",
  country: "FI (Finland)",
  category: "rent (official average rent per m² of rented flats)",
  name: "Rent index and average rents per square metre by area, type of funding, number of rooms and quarter (Statistics Finland, table 15fa)",
  publisher: "Statistics Finland (Tilastokeskus)",
  what_is_recorded:
    "The average rent per square metre (EUR/m²) of rented flats in Finland and the number of observations behind it, by quarter, for the whole country, Greater Helsinki, regions, towns and town districts, " +
    "for market-rate (non-subsidised) flats, by number of rooms (one, two, three or more). Also the average rent per m² of new rental contracts, with its own count. One published figure per cell; never individual rents or addresses.",
  price_type: "official_statistic",
  freshness: "Quarterly; the newest quarter in the table on 22 Oct 2026 was 2026Q3",
  licence:
    "Statistics Finland: \"Statistics Finland's open data materials and public content of the web service are covered by the Creative Commons Attribution 4.0 International licence. " +
    "According to the licence, you can copy, edit and share these data either in original or edited format. You can also combine the data with other data and use the data for commercial purposes as well.\"",
  licence_url: "https://stat.fi/en/about-us/get-to-know-statistics-finland/legislation/terms-of-use",
  attribution:
    "Source: Statistics Finland, rent index and average rents (table 15fa; https://stat.fi/en/statistics/asvu), licensed CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Figures are passed on as published.",
  homepage: "https://stat.fi/en/statistics/asvu",
  limits:
    "An average rent per square metre of rented flats, not the rent of one home: a flat's rent is this figure times its floor area, and rents differ widely inside an area. " +
    "The answer covers market-rate (non-subsidised) flats; government-subsidised flats are published separately and left out. Statistics Finland's table does not state in its metadata whether the figure is per month, so the unit is given as EUR per m² (rents in Finland are normally quoted per month). " +
    "Statistics Finland withholds figures with too few observations, so small areas and some room sizes are missing. Rooms are counted the Finnish way (a living room counts, the kitchen does not): a flat with one bedroom is usually a two-room flat.",
};

export const STATFIN_API = "https://pxdata.stat.fi/PxWeb/api/v1/en/StatFin/asvu";
export const TABLE = "15fa";
export const tableUrl = (base = STATFIN_API) => `${base}/${TABLE}.px`;

const C_PRICE = "asvu_keskineliovuokra";
const C_COUNT = "asvu_keskineliovuokra_lkm";
const C_NEW = "asvu_keskineliovuokra_u";
const C_NEW_COUNT = "asvu_keskineliovuokra_u_lkm";
const HOW_MANY_QUARTERS = 4;

/** Fold a name for matching: lower case, no diacritics, punctuation as single spaces. */
export function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/ø/g, "o").replace(/[^a-z0-9]+/g, " ").trim();
}

// ---------- table metadata ----------

export interface PxVariable { code: string; text: string; values: string[]; valueTexts: string[]; time: boolean }
export interface PxMeta { title: string; variables: PxVariable[] }

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

export function findVariable(meta: PxMeta, pattern: RegExp, what: string): PxVariable {
  const v = meta.variables.find((x) => pattern.test(x.code));
  if (!v) throw new SourceError(`Statistics Finland has changed table ${TABLE}: no ${what} variable`);
  return v;
}

export interface Vars { area: PxVariable; funding: PxVariable; rooms: PxVariable; time: PxVariable; contents: PxVariable }
export function readVars(meta: PxMeta): Vars {
  const v: Vars = {
    area: findVariable(meta, /^alue_/, "area"),
    funding: findVariable(meta, /^rahoitus_/, "type of funding"),
    rooms: findVariable(meta, /^huoneluku_/, "number of rooms"),
    time: findVariable(meta, /^timeperiod_q$/, "quarter"),
    contents: findVariable(meta, /^contentscode$/, "information"),
  };
  for (const c of [C_PRICE, C_COUNT]) {
    if (!v.contents.values.includes(c)) throw new SourceError(`Statistics Finland has changed table ${TABLE}: no ${c} among its information`);
  }
  return v;
}

// ---------- places ----------

export interface Place { code: string; name: string; kind: "country" | "area" | "region" | "town" | "district" }

function kindOf(code: string): Place["kind"] {
  if (code === "SSS") return "country";
  if (code.startsWith("MK")) return "region";
  if (code === "pks" || code === "msu" || code === "keh") return "area";
  if (code.includes("_")) return "district";
  return "town";
}

/** The places of the table, from its metadata. Region names lose their "MK01 " prefix. */
export function placesOf(area: PxVariable): Place[] {
  return area.values.map((code, i) => ({ code, name: (area.valueTexts[i] ?? code).replace(/^MK\d{2}\s+/, ""), kind: kindOf(code) }));
}

const ALIASES: Record<string, string> = {
  finland: "SSS", suomi: "SSS", national: "SSS", nationwide: "SSS", "whole country": "SSS",
  "helsinki region": "pks", "greater helsinki": "pks", "helsinki metropolitan area": "pks", "capital region": "pks", "paakaupunkiseutu": "pks",
  helsingfors: "091", espoo: "049", kauniainen: "049", "espoo kauniainen": "049", esbo: "049", vanda: "092", abo: "853", tammerfors: "837", uleaborg: "564",
  "outside greater helsinki": "msu", "rest of finland": "msu", "rest of country": "msu",
};

export function resolvePlace(places: Place[], town?: string): Place {
  const raw = (town ?? "").trim();
  if (!raw) return places.find((p) => p.code === "SSS")!;
  const key = fold(raw);
  const byCode = places.find((p) => fold(p.name) === key || p.code.toLowerCase() === key);
  if (byCode) return byCode;
  const alias = ALIASES[key];
  const viaAlias = alias ? places.find((p) => p.code === alias) : undefined;
  if (viaAlias) return viaAlias;
  const part = places.filter((p) => fold(p.name).startsWith(key + " "));
  if (part.length === 1) return part[0];
  const towns = places.filter((p) => p.kind === "town" || p.kind === "area").map((p) => p.name);
  throw new InputError(
    `Statistics Finland publishes rents for Finland as a whole, Greater Helsinki, regions, towns and town districts, but not for "${raw}". ` +
      `Try a town such as ${towns.slice(0, 14).join(", ")}, or leave town out for the whole country.`,
  );
}

/** Finnish room count: 1, 2, 3 (three or more). Returns the table code or null for all sizes. */
export function roomsCode(rooms: Vars["rooms"], n?: number): string | null {
  if (n === undefined) return null;
  if (!Number.isInteger(n) || n < 1) throw new InputError("For Finland, bedrooms is the number of ROOMS (a living room counts, the kitchen does not): 1, 2 or 3 (3 means three or more). Leave it out for all sizes.");
  const want = String(Math.min(n, 3));
  if (!rooms.values.includes(want)) throw new SourceError(`Statistics Finland has changed table ${TABLE}: room size ${want} not found`);
  return want;
}

export function nonSubsidisedCode(funding: PxVariable): string {
  const i = funding.valueTexts.findIndex((t) => /non-subsidised/i.test(t));
  if (i < 0) throw new SourceError(`Statistics Finland has changed table ${TABLE}: type of funding not recognised`);
  return funding.values[i];
}

// ---------- the request ----------

export interface PxQuery { query: Array<{ code: string; selection: { filter: "item"; values: string[] } }>; response: { format: "json-stat2" } }
export function buildQuery(selections: Array<[string, string[]]>): PxQuery {
  return { query: selections.map(([code, values]) => ({ code, selection: { filter: "item" as const, values } })), response: { format: "json-stat2" } };
}

export function requestFor(v: Vars, areaCode: string, fundingCode: string, roomCode: string): PxQuery {
  const quarters = v.time.values.slice(Math.max(0, v.time.values.length - HOW_MANY_QUARTERS));
  const contents = [C_PRICE, C_COUNT, C_NEW, C_NEW_COUNT].filter((c) => v.contents.values.includes(c));
  return buildQuery([
    [v.area.code, [areaCode]],
    [v.funding.code, [fundingCode]],
    [v.rooms.code, [roomCode]],
    [v.time.code, quarters],
    [v.contents.code, contents],
  ]);
}

// ---------- reading the cube (pure) ----------

export interface Figure {
  quarter: string;
  price: number;
  count: number | null;
  newPrice: number | null;
  newCount: number | null;
  /** Quarters newer than this one that had no usable figure (missing or fewer than 5 observations). */
  skipped: string[];
}

export function quarterRange(q: string): { from: string; to: string } {
  const m = /^(\d{4})Q([1-4])$/.exec(q);
  if (!m) throw new SourceError(`Unexpected quarter code from Statistics Finland: ${q}`);
  const y = Number(m[1]);
  const startM = (Number(m[2]) - 1) * 3 + 1;
  const endM = startM + 2;
  const lastDay = new Date(Date.UTC(y, endM, 0)).getUTCDate();
  const p = (n: number) => String(n).padStart(2, "0");
  return { from: `${y}-${p(startM)}-01`, to: `${y}-${p(endM)}-${p(lastDay)}` };
}
export const quarterWords = (q: string) => q.replace(/^(\d{4})Q(\d)$/, "Q$2 $1");

/** The newest quarter with a price backed by at least 5 observations (the table's own count). */
export function readFigure(table: JsonStatTable, v: Vars): Figure | null {
  const get = (q: string, c: string): number | null => {
    const r = table.rows.find((x) => String(x[v.time.code]) === q && String(x[v.contents.code]) === c);
    return r && typeof r.value === "number" && Number.isFinite(r.value) ? r.value : null;
  };
  const quarters = [...(table.codes[v.time.code] ?? [])].sort().reverse();
  const skipped: string[] = [];
  for (const q of quarters) {
    const price = get(q, C_PRICE);
    const count = get(q, C_COUNT);
    if (price !== null && price > 0 && count !== null && count >= MIN_PUBLISH) {
      const np = get(q, C_NEW);
      const nc = get(q, C_NEW_COUNT);
      const newOk = np !== null && np > 0 && nc !== null && nc >= MIN_PUBLISH;
      return { quarter: q, price, count, newPrice: newOk ? np : null, newCount: newOk ? nc : null, skipped };
    }
    skipped.push(q);
  }
  return null;
}

export interface FinlandRentInput { town?: string; bedrooms?: number; baseUrl?: string }
export interface FinlandRentOptions extends FetchOptions {
  poster?: (url: string, body: unknown) => Promise<unknown>;
  apiBase?: string;
}

export function answerFor(input: FinlandRentInput, place: Place, roomText: string, f: Figure | null, tableUpdated: string | null): PriceAnswer {
  const range = f ? quarterRange(f.quarter) : { from: null, to: null };
  const where = place.kind === "country" ? "Finland" : place.name;
  const notes: string[] = [];
  if (f && f.skipped.length) notes.push(`The newest quarter${f.skipped.length > 1 ? "s" : ""} (${f.skipped.map(quarterWords).join(", ")}) had no figure with at least ${MIN_PUBLISH} observations, so the latest usable quarter is shown.`);
  if (f && f.count !== null && f.count < 30) notes.push(`Only ${f.count} rents stand behind this average, so it is volatile.`);
  if (!f) notes.push(`Statistics Finland publishes no rent per m² backed by at least ${MIN_PUBLISH} observations for ${where} (${roomText}) in the latest quarters. Try a wider area or all room sizes.`);
  return buildStatisticAnswer({
    source: INFO,
    query: { country: "FI", town: where, rooms: input.bedrooms ?? "all" },
    value: f ? f.price : null,
    measure: "average",
    currency: "EUR",
    unit: "per m²",
    period: range,
    reference_period: f ? f.quarter : "",
    sample_size: f ? f.count : null,
    method:
      "Finland (Statistics Finland, table 15fa): the average rent per square metre of market-rate (non-subsidised) rented flats in the chosen area and room size for the newest quarter backed by at least 5 observations. " +
      "We pass on the published average and its observation count; it is an average of rents, not a range of individual rents.",
    describe: (x) => `The average rent of market-rate rented flats (${roomText}) in ${where} was ${fmtMoney(x, "EUR")} per m² in ${quarterWords(f!.quarter)}, from ${f!.count} rents.`,
    note: notes.length ? notes.join(" ") : undefined,
    baseUrl: input.baseUrl,
    published: tableUpdated ?? null,
    extra: f
      ? {
          area: { name: place.name, statfin_code: place.code, kind: place.kind },
          rooms: roomText,
          funding: "non-subsidised (market-rate) flats",
          observations: f.count,
          average_rent_per_m2_new_contracts: f.newPrice,
          observations_new_contracts: f.newCount,
          table_updated: tableUpdated,
        }
      : undefined,
  });
}

export async function finlandRent(input: FinlandRentInput, o: FinlandRentOptions = {}): Promise<PriceAnswer> {
  const get = resolveFetcher(o);
  const post = o.poster ?? ((url: string, body: unknown) => fetchJson(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, o.timeoutMs ?? 20000));
  const url = tableUrl(o.apiBase);
  const meta = readMeta(await get(url));
  const v = readVars(meta);
  const place = resolvePlace(placesOf(v.area), input.town);
  const room = roomsCode(v.rooms, input.bedrooms) ?? v.rooms.values.find((c) => c === "SSS") ?? v.rooms.values[0];
  const roomText = v.rooms.valueTexts[v.rooms.values.indexOf(room)]?.toLowerCase() ?? "all sizes";
  const table = parseJsonStat(await post(url, requestFor(v, place.code, nonSubsidisedCode(v.funding), room)));
  if (!table.codes[v.time.code] || !table.codes[v.contents.code]) throw new SourceError("Statistics Finland changed the layout of table 15fa; this source needs updating.");
  return answerFor(input, place, roomText === "total" ? "all room sizes" : roomText, readFigure(table, v), table.updated);
}
