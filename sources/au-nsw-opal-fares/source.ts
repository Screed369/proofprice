// NSW Opal card fares: Transport for NSW's posted fare table (train, bus, light rail, ferry by distance band, peak and off-peak).
// Format checked live on 2026-11-03: CKAN package_show on opendata.transport.nsw.gov.au (package "opal-fares", licence_id cc-by, no key)
// lists one XLSX resource "Open Data Opal Distance Tables and Opal Fare Values" (1.2 MB). Its VISIBLE sheet "Opal Fare Values" still held
// the July 2025 fares; the current fares (effective 29 June 2026) sit in a HIDDEN sheet "Opal Fare Values 29 June 2026". The publisher's
// own "Opal Fares Business Rules and Information v1.7" PDF (same dataset) names that tab as current and its worked examples use $4.49
// (bus 3-8 km peak) and $5.77 (bus 8 km+ peak), which are the cells of that sheet. So this source picks the newest dated sheet
// whose date is not in the future, never the plain-named one. Posted tariff, not amounts paid: no record count.

import { ckanPackage, latestResource } from "../../lib/adapters";
import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import { NO_COUNT } from "../../lib/stats";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { Cell, parseSharedStrings, parseSheetXml, unzipAll, xmlText } from "../../categories/rent/xlsx";

export const SITE = "https://opendata.transport.nsw.gov.au/data";
export const PACKAGE = "opal-fares";
const UA = "ProofPrice/1.0 (+https://proofprice.com; hello@proofprice.com)";

export const INFO: SourceInfo = {
  id: "au-nsw-opal-fares",
  country: "AU (New South Wales: Sydney, Newcastle, Central Coast, Illawarra, Blue Mountains)",
  category: "transport fares (Opal card: train, bus, light rail, ferry)",
  name: "Opal card fare values by mode and distance band, Transport for NSW",
  publisher: "Transport for NSW, published on the TfNSW Open Data Hub",
  what_is_recorded:
    "The posted Opal card fare for one trip by mode (train, bus, light rail, ferry), distance band, peak or off-peak, for adults and for child/youth and concession cards. A published fare table, not amounts paid.",
  price_type: "posted_price",
  freshness: "Updated when fares change (yearly, around 1 July); the table read 3 Nov 2026 carried the fares effective from 29 June 2026",
  licence: "Creative Commons Attribution (CC BY)",
  licence_url: "https://opendefinition.org/licenses/cc-by/",
  attribution:
    "Contains information from the Opal Fares dataset (Opal Fare Values) by Transport for NSW, accessed from the TfNSW Open Data Hub (https://opendata.transport.nsw.gov.au/data/dataset/opal-fares) and licensed under Creative Commons Attribution (CC BY). " +
    "ProofPrice looks up the distance band; this is not an official service of Transport for NSW.",
  homepage: "https://opendata.transport.nsw.gov.au/data/dataset/opal-fares",
  limits:
    "Opal card fare per trip from the published table, not amounts paid, not a ticket and not a quote. Daily and weekly caps, the Sunday cap, Station Access Fees, inter-modal transfer reductions, the frequency-of-use discount, contactless-only rules and tourist or single-trip tickets are not modelled. Regional NSW bus fares and Sydney Trains rail distances between particular stations are not included: give the trip distance. No sample size.",
};

export type Mode = "train" | "bus" | "light_rail" | "ferry";
export type Group = "adult" | "child_youth";
export type TimeBand = "peak" | "off_peak";

export interface OpalRow {
  mode: Mode;
  group: Group;
  time: TimeBand;
  /** Band index within the mode, 0 = shortest. */
  index: number;
  from: number;
  to: number;
  label: string;
  dollars: number;
}

export interface OpalTable {
  /** Name of the sheet used and the date its fares take effect (YYYY-MM-DD). */
  sheet: string;
  effective: string;
  rows: OpalRow[];
}

/** Upper edges (km) of every distance band except the last, per mode. The last band is "this much and more". Checked 3 Nov 2026. */
export const EDGES: Record<Mode, number[]> = { train: [10, 20, 35, 65], bus: [3, 8], light_rail: [3, 8], ferry: [9] };

const MODE_TITLE: Record<string, Mode> = { TRAIN: "train", BUS: "bus", "LIGHT RAIL": "light_rail", FERRY: "ferry" };
const MODE_LABEL: Record<Mode, string> = { train: "train", bus: "bus", light_rail: "light rail", ferry: "ferry" };
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** Pure: "Opal Fare Values 29 June 2026" -> "2026-06-29"; the plain name or a sheet that is not a fare sheet -> null. */
export function sheetDate(name: string): string | null {
  const m = /^Opal Fare Values\s+(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\s*$/i.exec(name.trim());
  if (!m) return null;
  const mi = MONTHS.indexOf(m[2].toLowerCase());
  if (mi < 0) return null;
  return `${m[3]}-${String(mi + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

/** Pure: "0-10km" -> [0, 10]; "10-20km" -> [10, 20]; "65km+" / "8km+" -> [65, Infinity]. */
export function parseBand(text: string): { from: number; to: number } | null {
  const s = text.trim().toLowerCase().replace(/\s+/g, "");
  let m = s.match(/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)km$/);
  if (m) return { from: Number(m[1]), to: Number(m[2]) };
  m = s.match(/^(\d+(?:\.\d+)?)km\+$/);
  if (m) return { from: Number(m[1]), to: Infinity };
  return null;
}

const num = (c: Cell | undefined): number | null => (typeof c === "number" && Number.isFinite(c) && c >= 0 ? Math.round(c * 100) / 100 : null);

/**
 * Pure: read one fare sheet (rows of cells). Each mode has a title row (TRAIN, BUS, LIGHT RAIL, FERRY in column B), then band rows with the
 * band in column B ("0-10km"). Adult PEAK and OFF PEAK are columns C and D; Child/Youth and Concession PEAK and OFF PEAK are columns O and P.
 */
export function parseFareSheet(rows: Cell[][]): OpalRow[] {
  const out: OpalRow[] = [];
  let mode: Mode | null = null;
  let index = 0;
  for (const r of rows) {
    const b = typeof r[1] === "string" ? r[1].trim() : "";
    const title = MODE_TITLE[b.toUpperCase()];
    if (title) { mode = title; index = 0; continue; }
    if (!mode) continue;
    const band = parseBand(b);
    if (!band) { if (b.toUpperCase() === "DISCOUNTS") mode = null; continue; }
    // "Stockton Ferry" repeats the 0-3 km bus fare under its own label in column A: it is not another band.
    if (typeof r[0] === "string" && r[0].trim() !== "") continue;
    const label = b.replace(/\s+/g, "");
    const cols: [Group, TimeBand, number][] = [["adult", "peak", 2], ["adult", "off_peak", 3], ["child_youth", "peak", 14], ["child_youth", "off_peak", 15]];
    for (const [group, time, c] of cols) {
      const dollars = num(r[c]);
      if (dollars !== null) out.push({ mode, group, time, index, from: band.from, to: band.to, label, dollars });
    }
    index++;
  }
  return out;
}

/** Pure: pick the sheet whose fares are in force on `today` (newest dated "Opal Fare Values <date>" sheet that is not in the future) and parse it. */
export function pickTable(sheets: { name: string; rows: Cell[][] }[], today = new Date().toISOString().slice(0, 10)): OpalTable {
  const dated = sheets
    .map((s) => ({ s, d: sheetDate(s.name) }))
    .filter((x): x is { s: { name: string; rows: Cell[][] }; d: string } => x.d !== null && x.d <= today)
    .sort((a, b) => a.d.localeCompare(b.d));
  const best = dated[dated.length - 1];
  if (!best) throw new SourceError("The Opal workbook has no dated 'Opal Fare Values' sheet; this source needs updating.");
  const rows = parseFareSheet(best.s.rows);
  for (const mode of Object.keys(EDGES) as Mode[]) {
    const bands = new Set(rows.filter((r) => r.mode === mode && r.group === "adult" && r.time === "peak").map((r) => r.index));
    if (bands.size !== EDGES[mode].length + 1) throw new SourceError(`The Opal fare sheet no longer has the expected ${MODE_LABEL[mode]} distance bands; this source needs updating.`);
  }
  if (rows.length < 40) throw new SourceError("The Opal fare table has far fewer rows than expected; this source needs updating.");
  return { sheet: best.s.name, effective: best.d, rows };
}

// ---------- reading the workbook (only the fare sheets: the file also holds two 3 MB rail-distance sheets we do not need) ----------

function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(tag);
  return m ? xmlText(m[1]) : undefined;
}

/** Read just the "Opal Fare Values ..." sheets of the workbook (hidden sheets included). */
export function readFareSheets(buf: Buffer): { name: string; rows: Cell[][] }[] {
  const files = unzipAll(buf);
  const get = (n: string) => files.get(n)?.toString("utf8");
  const workbook = get("xl/workbook.xml");
  if (!workbook) throw new SourceError("Not an Excel workbook (xl/workbook.xml missing)");
  const rels = new Map<string, string>();
  for (const m of (get("xl/_rels/workbook.xml.rels") ?? "").matchAll(/<Relationship\s[^>]*?\/?>/g)) {
    const id = attr(m[0], "Id");
    const target = attr(m[0], "Target");
    if (id && target) rels.set(id, target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`);
  }
  const shared = parseSharedStrings(get("xl/sharedStrings.xml") ?? "");
  const out: { name: string; rows: Cell[][] }[] = [];
  let i = 0;
  for (const m of workbook.matchAll(/<sheet\s[^>]*?\/?>/g)) {
    i++;
    const name = attr(m[0], "name") ?? "";
    if (!/^Opal Fare Values/i.test(name)) continue;
    const path = rels.get(attr(m[0], "r:id") ?? "") ?? `xl/worksheets/sheet${i}.xml`;
    const xml = get(path);
    if (xml) out.push({ name, rows: parseSheetXml(xml, shared) });
  }
  return out;
}

async function download(url: string): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, { headers: { "user-agent": UA }, signal: controller.signal });
    if (!res.ok) throw new SourceError(`Source returned HTTP ${res.status}`, url, res.status);
    return Buffer.from(await res.arrayBuffer());
  } catch (e: any) {
    if (e instanceof SourceError) throw e;
    if (e?.name === "AbortError") throw new SourceError("Source timed out", url);
    throw new SourceError("Could not reach the official source", String(e?.cause?.code ?? e?.message ?? e));
  } finally {
    clearTimeout(timer);
  }
}

let cache: { at: number; table: OpalTable } | null = null;
const CACHE_MS = 6 * 3600 * 1000;

/** Fetch the newest workbook through the dataset record (so a renamed file is found) and parse the current fare sheet. Cached for 6 hours per instance. */
export async function fetchTable(): Promise<OpalTable> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.table;
  const pkg = await ckanPackage(SITE, PACKAGE);
  const res = latestResource(pkg.resources, { format: ["XLSX"], nameMatches: /opal fare values/i });
  if (!res) throw new SourceError("The Opal Fares dataset no longer lists the fare-values workbook; this source needs updating.");
  const table = pickTable(readFareSheets(await download(res.url)));
  cache = { at: Date.now(), table };
  return table;
}

// ---------- answers ----------

export interface OpalInput {
  mode?: string;
  fare_type?: string;
  distance_km?: number;
  travel_time?: string;
  baseUrl?: string;
}

const MODES: Mode[] = ["train", "bus", "light_rail", "ferry"];
const MODE_ALIAS: Record<string, Mode> = { train: "train", rail: "train", metro: "train", bus: "bus", "light rail": "light_rail", light_rail: "light_rail", lightrail: "light_rail", tram: "light_rail", ferry: "ferry" };

const METHOD =
  "NSW Opal: Transport for NSW's posted Opal card fare for one trip, for the chosen mode, distance band, peak or off-peak and card type, read from the current 'Opal Fare Values' sheet of the Opal Fares dataset and shown in Australian dollars. " +
  "A published fare table, the same for everyone with that card type, not a count of fares paid. Caps, discounts and add-on fees are not applied.";

function resolve(input: OpalInput) {
  const mode = MODE_ALIAS[String(input.mode ?? "train").toLowerCase().replace(/\s+/g, " ").trim()];
  if (!mode) throw new InputError(`mode for AU must be one of ${MODES.join(", ")}.`);
  const ft = String(input.fare_type ?? "adult").toLowerCase();
  if (ft !== "adult" && ft !== "student" && ft !== "senior") throw new InputError("fare_type for AU (NSW Opal) must be adult, student (the Child/Youth fare) or senior (the concession fare).");
  const group: Group = ft === "adult" ? "adult" : "child_youth";
  const tt = String(input.travel_time ?? "other").toLowerCase();
  if (tt !== "early" && tt !== "other") throw new InputError('travel_time must be "other" (peak, default) or "early" (off-peak).');
  const time: TimeBand = tt === "early" ? "off_peak" : "peak";
  const km = input.distance_km === undefined ? 5 : input.distance_km;
  if (!Number.isFinite(km) || km < 0) throw new InputError("distance_km must be a number of kilometres, e.g. 8.5.");
  return { mode, ft, group, time, km };
}

/** Index of the distance band a trip falls in, from the fixed edges (a trip of exactly 10 km is in the 0-10 km band). */
export function bandIndex(mode: Mode, km: number): number {
  const i = EDGES[mode].findIndex((e) => km <= e);
  return i < 0 ? EDGES[mode].length : i;
}

/** Pure: pick the fare for the request out of the parsed table. */
export function answerFromTable(table: OpalTable, input: OpalInput): PriceAnswer {
  const { mode, ft, group, time, km } = resolve(input);
  const idx = bandIndex(mode, km);
  const hit = table.rows.find((r) => r.mode === mode && r.group === group && r.time === time && r.index === idx);
  if (!hit) throw new SourceError("No fare band found for that request in the Opal fare table.");
  const who = ft === "adult" ? "adult" : ft === "student" ? "Child/Youth" : "Senior/Pensioner (concession)";
  const notes = ["Posted fare table, not an amount paid. Daily and weekly caps, Station Access Fees and transfer reductions are not applied."];
  if (ft === "senior") notes.push("Senior/Pensioner Opal trips are capped at $2.50 a day.");
  if (ft === "student") notes.push("Child/Youth is the Opal card fare for children and youths; it is not a school-student pass.");
  return buildStatisticAnswer({
    source: INFO,
    query: { country: "AU", mode, fare_type: ft, distance_km: km, travel_time: input.travel_time ?? "other" },
    value: hit.dollars,
    measure: "average",
    currency: "AUD",
    unit: "per trip (Opal card fare)",
    period: { from: table.effective, to: null },
    reference_period: `fares effective ${table.effective}`,
    method: METHOD,
    describe: (v) =>
      `The posted Opal ${who} fare in New South Wales for a ${MODE_LABEL[mode]} trip of ${hit.label} (${time === "peak" ? "peak" : "off-peak"}) is AUD ${v.toFixed(2)} per trip.`,
    note: notes.join(" "),
    baseUrl: input.baseUrl,
    extra: { mode, fare_group: group, time_band: time, distance_band: hit.label, sheet: table.sheet, region: "Sydney, Newcastle, Central Coast, Illawarra, Blue Mountains" },
  });
}

export async function opalFares(input: OpalInput, load: () => Promise<OpalTable> = fetchTable): Promise<PriceAnswer> {
  resolve(input); // reject bad input before touching the network
  return answerFromTable(await load(), input);
}

// ---------- daily collector (library, history and stale-if-error) ----------

export const itemKey = (group: Group, time: TimeBand, index: number) => `${group}/${time}/${index}`;

/** Pure: one library row per mode (area) and card type, time and band (item). The publisher gives one figure per cell, so n is NO_COUNT. */
export function rowsFromTable(table: OpalTable): DailyRow[] {
  return table.rows
    .map((r) => ({ area: r.mode, item: itemKey(r.group, r.time, r.index), n: NO_COUNT, median: r.dollars, low: r.dollars, high: r.dollars, min: r.dollars, max: r.dollars }))
    .sort((a, b) => a.area.localeCompare(b.area) || a.item.localeCompare(b.item));
}

export async function opalHarvest(load: () => Promise<OpalTable> = fetchTable): Promise<HarvestResult> {
  const table = await load();
  return { date: table.effective, currency: "AUD", unit: "per trip (Opal card fare)", rows: rowsFromTable(table), note: `Opal Fare Values sheet "${table.sheet}"` };
}

export function opalHistoryKey(input: OpalInput): { area: string; item: string; label: string } | null {
  try {
    const { mode, group, time, km } = resolve(input);
    return { area: mode, item: itemKey(group, time, bandIndex(mode, km)), label: MODE_LABEL[mode] };
  } catch {
    return null;
  }
}
