// Germany, North Rhine-Westphalia (NRW): Immobilienrichtwerte (IRW) from BORIS.NRW, the state's official property-value portal.
// The Gutachterausschüsse (expert committees of each town or district) set, once a year at 1 January, a guideline value in EUR per m2 of living
// area for a standard reference property in each location zone. The values are derived by the committees from the purchase-price register
// (Kaufpreissammlung): a VALUATION statistic, not individual prices paid and not asking prices. Open data, licence dl-de/zero-2-0.
// File: IRW_EPSG25832_Shape.zip (46 MB shapefile; we read only the .dbf table). Format checked 2026-11-08 from the cloud workspace:
// 19,388 zone records, UTF-8 (the .cpg says so), reference date (STAG) 01.01.2026, fields in the publisher's IRW_Datenmodell.pdf (same folder).
// harvest() reads the zip once a day, turns the zones of each committee area into one row per type and the answer is read from the price library.
import { inflateRawSync } from "node:zlib";
import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import type { HarvestResult, SourceInfo } from "../../lib/plugin";
import { NATIONAL } from "../../lib/library/aggregate";
import { readLatestDay } from "../../lib/library/store";
import { MIN_PUBLISH, NO_COUNT, percentile } from "../../lib/stats";

export const BASE = "https://www.opengeodata.nrw.de/produkte/infrastruktur_bauen_wohnen/boris/IRW/";
export const ZIP_URL = BASE + "IRW_EPSG25832_Shape.zip";

/** Fewest location zones in one committee area for a figure. Zones are not sales, so this is a guard on the spread, never shown as a sample size. */
export const MIN_ZONES = Math.max(MIN_PUBLISH, 5);
/** A file with fewer committee areas than this has changed shape: refuse it instead of publishing a fragment. */
const MIN_AREAS = 50;

export type Kind = "apartment" | "house" | "terraced";
export const KINDS: Kind[] = ["apartment", "house", "terraced"];
/** TEILMA (Teilmarkt) in the publisher's data model: 1 = Eigentumswohnungen, 2 = Ein- und Zweifamilienhäuser freistehend, 3 = Reihen- und Doppelhäuser. 4-7 are mixed or commercial and left out. */
const TEILMARKT: Record<string, Kind> = { "1": "apartment", "2": "house", "3": "terraced" };
export const KIND_LABEL: Record<Kind, string> = {
  apartment: "owner-occupied flats (Eigentumswohnungen)",
  house: "detached one- and two-family houses",
  terraced: "terraced and semi-detached houses",
};

export const INFO: SourceInfo = {
  id: "de-nrw-irw",
  country: "DE (North Rhine-Westphalia only)",
  category: "home sales (Immobilienrichtwerte: official guideline values per m2, derived from the purchase-price register)",
  name: "BORIS.NRW Immobilienrichtwerte (property guideline values per m2, North Rhine-Westphalia)",
  publisher: "Oberer Gutachterausschuss für Grundstückswerte im Land Nordrhein-Westfalen (BORIS.NRW), Geobasis NRW open data",
  what_is_recorded:
    "For each location zone, the guideline value in EUR per m2 of living area that the local expert committee (Gutachterausschuss) fixes at 1 January for a standard reference property " +
    "(flat, detached house, or terraced/semi-detached house). The committees derive it from the registered purchase prices (Kaufpreissammlung) of their area. " +
    "ProofPrice takes the zones of one committee area and states the median and the 10th-90th percentile of the zone values; never a sale, an address or a person.",
  price_type: "official_statistic",
  freshness: "Annual: values are fixed at 1 January (reference date 01.01.2026 in the file read 8 Nov 2026); the committees republish during the year, the answer states the reference date",
  licence:
    "Datenlizenz Deutschland - Zero - Version 2.0 (dl-de/zero-2-0): free use for any purpose without conditions, per the official GDI-DE catalogue record 'Atom-Feed NW Immobilienrichtwerte' (read 23 Oct 2026 by the Licence Checker). " +
    "Attribution is not required; ProofPrice credits the publisher as a courtesy.",
  licence_url: "https://www.govdata.de/dl-de/zero-2-0",
  attribution: "Quelle: Oberer Gutachterausschuss NRW, BORIS.NRW, Geobasis NRW, dl-de/zero-2-0; Median und Spanne der Richtwertzonen: eigene Berechnung (ProofPrice).",
  homepage: "https://www.boris.nrw.de/",
  limits:
    "A valuation statistic, not prices paid: the committees derive each value from purchase prices but state it for a fictitious standard property (a given year of construction, size and fittings), per zone, once a year. " +
    "Covers North Rhine-Westphalia only, not the rest of Germany. The area is the Gutachterausschuss area named in the file (a town; a committee can also cover neighbouring municipalities); only areas with at least " +
    MIN_ZONES + " zones for the type are published. Resales only (new-build first sales and conversions are left out). The median is of the zone values, not weighted by the number of homes or sales. " +
    "There is no postcode level and no sales count (sample_size is null). Mixed and commercial types are not included.",
};

// ---------- the zip and the table (pure) ----------

/** Read the first file in a zip held in memory whose name matches (central directory, then raw deflate). */
export function unzipFind(buf: Buffer, match: (name: string) => boolean): { name: string; data: Buffer } {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new SourceError("The NRW download is not a zip file");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let k = 0; k < count; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new SourceError("The NRW zip has a bad directory");
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nlen);
    if (match(name)) {
      if (buf.readUInt32LE(lho) !== 0x04034b50) throw new SourceError("The NRW zip has a bad entry");
      const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
      const data = buf.subarray(start, start + csize);
      if (method === 0) return { name, data: Buffer.from(data) };
      if (method === 8) return { name, data: inflateRawSync(data) };
      throw new SourceError(`The NRW zip uses an unsupported method (${method})`);
    }
    p += 46 + nlen + elen + clen;
  }
  throw new SourceError("The NRW zip has no Polygon .dbf table: the download changed and this source needs updating.");
}

export interface Zone {
  committee: string; // GENA: the Gutachterausschuss area named in the file (a town)
  kind: Kind;
  value: number; // IMRW, EUR per m2 of living area
  stichtag: string; // YYYY-MM-DD
}

const NEED = ["GENA", "IMRW", "STAG", "TEILMA", "OBJGR", "IRWTYP"] as const;

/** Parse the dBase III table of the Polygon shapefile into zones. Keeps only resale (OBJGR 3) zone values (IRWTYP 1) for flats, detached and terraced houses. */
export function parseDbf(buf: Buffer): { zones: Zone[]; records: number; skipped: number } {
  if (buf.length < 33) throw new SourceError("The NRW .dbf table is empty");
  const records = buf.readUInt32LE(4);
  const headerLen = buf.readUInt16LE(8);
  const recLen = buf.readUInt16LE(10);
  const fields: Record<string, { off: number; len: number }> = {};
  let off = 1;
  for (let p = 32; p + 32 <= headerLen && buf[p] !== 0x0d; p += 32) {
    const name = buf.toString("latin1", p, p + 11).split("\0")[0];
    const len = buf[p + 16];
    fields[name] = { off, len };
    off += len;
  }
  for (const f of NEED) {
    if (!fields[f]) throw new SourceError(`The NRW guideline-value table has a new layout (no ${f} column); this source needs updating.`);
  }
  const cell = (rec: number, f: string) => buf.toString("utf8", rec + fields[f].off, rec + fields[f].off + fields[f].len).replace(/\0/g, "").trim();
  const zones: Zone[] = [];
  let skipped = 0;
  for (let i = 0; i < records; i++) {
    const rec = headerLen + i * recLen;
    if (rec + recLen > buf.length) break;
    if (buf[rec] === 0x2a) { skipped++; continue; } // deleted row
    const kind = TEILMARKT[cell(rec, "TEILMA")];
    const value = Number(cell(rec, "IMRW"));
    const stag = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(cell(rec, "STAG"));
    if (!kind || cell(rec, "OBJGR") !== "3" || cell(rec, "IRWTYP") !== "1" || !Number.isFinite(value) || value <= 0 || value > 50000 || !stag) {
      skipped++;
      continue;
    }
    const committee = cell(rec, "GENA");
    if (!committee) { skipped++; continue; }
    zones.push({ committee, kind, value, stichtag: `${stag[3]}-${stag[2]}-${stag[1]}` });
  }
  return { zones, records, skipped };
}

const round2 = (v: number) => Math.round(v * 100) / 100;

function summary(values: number[]) {
  const v = [...values].sort((a, b) => a - b);
  return { median: round2(percentile(v, 0.5)), low: round2(percentile(v, 0.1)), high: round2(percentile(v, 0.9)), min: v[0], max: v[v.length - 1] };
}

export const ITEM_UNIT = "per m2 of living area";

/** One library row per committee area and type (at least MIN_ZONES zones), plus an "ALL" row per type for the whole of NRW. */
export function harvestFrom(parsed: { zones: Zone[]; records: number; skipped: number }): HarvestResult {
  const groups = new Map<string, number[]>();
  const all = new Map<Kind, number[]>();
  let date = "";
  for (const z of parsed.zones) {
    const k = `${z.committee}\u0000${z.kind}`;
    const g = groups.get(k);
    if (g) g.push(z.value);
    else groups.set(k, [z.value]);
    const a = all.get(z.kind);
    if (a) a.push(z.value);
    else all.set(z.kind, [z.value]);
    if (z.stichtag > date) date = z.stichtag;
  }
  const rows: HarvestResult["rows"] = [];
  const areas = new Set<string>();
  for (const [k, values] of groups) {
    if (values.length < MIN_ZONES) continue;
    const [area, item] = k.split("\u0000");
    areas.add(area);
    rows.push({ area, item, n: NO_COUNT, ...summary(values) });
  }
  for (const [item, values] of all) if (values.length >= MIN_ZONES) rows.push({ area: NATIONAL, item, n: NO_COUNT, ...summary(values) });
  if (areas.size < MIN_AREAS) throw new SourceError(`Only ${areas.size} committee areas had enough zones in the NRW guideline-value file; it has probably changed.`);
  rows.sort((a, b) => a.area.localeCompare(b.area) || a.item.localeCompare(b.item));
  return {
    date,
    currency: "EUR",
    unit: ITEM_UNIT,
    rows,
    note:
      `BORIS.NRW Immobilienrichtwerte, reference date ${date}: ${parsed.zones.length} resale zone values of ${parsed.records} table rows (${parsed.skipped} left out: first sales, conversions, municipality-wide values, mixed and commercial types). ` +
      `${areas.size} committee areas with at least ${MIN_ZONES} zones for a type. Median and 10th-90th percentile are of the zone values, not weighted. n is NO_COUNT: zones are not sales.`,
  };
}

/** The values are fixed once a year. If the download is refused or unreachable and the library already holds the same reference day, keep those stored figures. */
export function reuseStored(why: string): HarvestResult | null {
  const held = readLatestDay(INFO.id);
  if (!held || held.rows.length < MIN_AREAS) return null;
  return {
    date: held.date,
    currency: "EUR",
    unit: ITEM_UNIT,
    rows: held.rows.map((r) => ({ area: r.area, item: r.item, n: NO_COUNT, median: r.median, low: r.low, high: r.high, min: r.min, max: r.max })),
    note: `BORIS.NRW Immobilienrichtwerte, reference date ${held.date}. The download was unavailable today (${why}), so the figures stored on the last successful read are kept. n is NO_COUNT: zones are not sales.`,
  };
}

export async function nrwHarvest(): Promise<HarvestResult> {
  const ua = "Mozilla/5.0 (compatible; ProofPrice-collector/1.0; +https://proofprice.com; hello@proofprice.com)";
  let res: Response;
  try {
    res = await fetch(ZIP_URL, { headers: { "user-agent": ua, accept: "application/zip,*/*" }, signal: AbortSignal.timeout(240_000) });
  } catch (e: any) {
    const kept = reuseStored(String(e?.message ?? e).slice(0, 80));
    if (kept) return kept;
    throw e;
  }
  if (!res.ok) {
    const kept = reuseStored(`HTTP ${res.status}`);
    if (kept) return kept;
    throw new SourceError(`geoportal.nrw returned HTTP ${res.status}`);
  }
  const dbf = unzipFind(Buffer.from(await res.arrayBuffer()), (n) => /polygon\.dbf$/i.test(n)).data;
  return harvestFrom(parseDbf(dbf));
}

// ---------- places and types (pure) ----------

/** Lower case, umlauts to base letters, accents and punctuation removed: "Münster" and "Muenster" both become "munster". */
export function fold(s: string): string {
  return s
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/ä/g, "a").replace(/ö/g, "o").replace(/ü/g, "u")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/ae|oe|ue/g, (m) => m[0])
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const ALIASES: Record<string, string> = { cologne: "Köln", "koln": "Köln", dusseldorf: "Düsseldorf", "essen ruhr": "Essen" };

export interface Row { area: string; item: string; median: number; low: number; high: number; min: number; max: number; date: string }

export function areasOf(rows: Row[]): string[] {
  return [...new Set(rows.filter((r) => r.area !== NATIONAL).map((r) => r.area))].sort((a, b) => a.localeCompare(b));
}

export function findArea(input: string, rows: Row[]): string | null {
  const q = fold(input.replace(/,?\s*(nrw|nordrhein westfalen|north rhine westphalia|deutschland|germany)\s*$/i, "").replace(/^(stadt|kreis)\s+/i, ""));
  if (!q) return null;
  const areas = areasOf(rows);
  const want = ALIASES[q] ? fold(ALIASES[q]) : q;
  return areas.find((a) => fold(a) === want) ?? null;
}

export function kindOf(propertyType: string | undefined): { kind: Kind; defaulted: boolean } {
  const t = (propertyType ?? "any").toLowerCase();
  if (t === "any" || t === "") return { kind: "apartment", defaulted: true };
  if (t === "apartment" || t === "flat" || t === "condo") return { kind: "apartment", defaulted: false };
  if (t === "house" || t === "detached") return { kind: "house", defaulted: false };
  if (t === "terraced" || t === "semi-detached" || t === "semi") return { kind: "terraced", defaulted: false };
  throw new InputError(`Germany (NRW): property_type must be apartment, house (detached) or terraced (terraced and semi-detached); "${propertyType}" is not one of them. Leave it out for flats.`);
}

export interface NrwInput { town?: string; postcode?: string; property_type?: string; baseUrl?: string }

export function nrwMethod(): string {
  return (
    "North Rhine-Westphalia: the local expert committees (Gutachterausschüsse) fix, at 1 January each year, a guideline value (Immobilienrichtwert) in EUR per m2 of living area for a standard reference property in each location zone, " +
    "derived from the registered purchase prices of their area. We take the zones of one committee area and report the median and the 10th-90th percentile of the zone values for flats, detached houses or terraced/semi-detached houses (resales). " +
    "A valuation statistic for a fictitious standard property, not an average of prices paid and not an asking price; the zones are not weighted by the number of homes."
  );
}

export function nrwAnswer(row: Row, scope: { label: string; nrwWide: boolean }, kind: Kind, defaulted: boolean, baseUrl?: string): PriceAnswer {
  const eur = (v: number) => fmtMoney(v, "EUR");
  const notes = [
    "Immobilienrichtwerte are guideline values per m2 of living area for a standard reference property, fixed by the local expert committee from the registered purchase prices of its area; they are not individual prices paid and not asking prices.",
    "Median and 10th-90th percentile are calculated by ProofPrice over the location-zone values, not weighted by the number of homes. Resales only.",
  ];
  if (defaulted) notes.push("No property_type was given, so flats are shown; use property_type=house (detached) or terraced for the other types.");
  if (scope.nrwWide) notes.push("No town was given, so the figure covers all of North Rhine-Westphalia only (one German state), not Germany. Give a town such as Köln, Münster or Bielefeld.");
  return buildStatisticAnswer({
    source: INFO,
    query: { country: "DE", ...(scope.nrwWide ? {} : { town: scope.label }), property_type: kind },
    value: row.median,
    measure: "median",
    currency: "EUR",
    unit: ITEM_UNIT,
    period: { from: row.date, to: row.date },
    reference_period: `reference date ${row.date}`,
    low: row.low,
    high: row.high,
    min: row.min,
    max: row.max,
    method: nrwMethod(),
    note: notes.join(" "),
    baseUrl,
    describe: (v) =>
      `${scope.nrwWide ? "Across North Rhine-Westphalia (not all of Germany)" : `In ${scope.label}`} the official guideline value for ${KIND_LABEL[kind]} was ${eur(v)} per m2 of living area in the middle of the location zones ` +
      `(10th-90th percentile ${eur(row.low)} to ${eur(row.high)}), reference date ${row.date}. This is a valuation guideline derived from registered purchase prices for a standard property, not an asking price and not a sale.`,
    ending: "BORIS.NRW Immobilienrichtwerte (Gutachterausschüsse NRW); median calculated by ProofPrice from the published zone values.",
    extra: {
      country_name: "Germany (North Rhine-Westphalia only)",
      place: scope.nrwWide ? { name: "North Rhine-Westphalia", level: "state" } : { name: scope.label, level: "Gutachterausschuss area" },
      property_type: kind,
      reference_date: row.date,
      range_basis: "10th and 90th percentile of the zone guideline values in the area (spread between locations), not of individual sales",
      lowest_and_highest_zone: { lowest: row.min, highest: row.max },
      what_this_is: "Official guideline value (Immobilienrichtwert) per m2 of living area for a standard reference property, derived from registered purchase prices. A valuation statistic, not prices paid, not asking prices.",
      attribution_notice: INFO.attribution,
    },
  });
}

export function nrwHomePrices(input: NrwInput, o: { rows?: Row[] | null } = {}): PriceAnswer {
  if (input.postcode) throw new InputError("Germany (NRW): the guideline values have no postcode level. Give the town as town (for example Köln, Münster, Bielefeld, Dortmund) or leave it out for North Rhine-Westphalia as a whole.");
  const { kind, defaulted } = kindOf(input.property_type);
  const rows = o.rows !== undefined ? o.rows : readRows();
  if (!rows) throw new SourceError("ProofPrice collects the BORIS.NRW guideline values once a day; data appears after the next collection.");
  const asked = (input.town ?? "").trim();
  if (!asked) {
    const r = rows.find((x) => x.area === NATIONAL && x.item === kind);
    if (!r) throw new SourceError("No state-wide guideline value for this type in the library yet.");
    return nrwAnswer(r, { label: "North Rhine-Westphalia", nrwWide: true }, kind, defaulted, input.baseUrl);
  }
  const area = findArea(asked, rows);
  if (!area) {
    throw new InputError(
      `Germany: only North Rhine-Westphalia is covered. town must be a Gutachterausschuss area there, for example ${["Köln", "Düsseldorf", "Dortmund", "Essen", "Münster", "Bielefeld", "Bonn", "Aachen"].join(", ")}; "${asked}" is not one of the ${areasOf(rows).length} areas with enough zones.`,
    );
  }
  const r = rows.find((x) => x.area === area && x.item === kind);
  if (!r) {
    const have = KINDS.filter((k) => rows.some((x) => x.area === area && x.item === k));
    throw new InputError(`${area} has too few guideline-value zones for ${KIND_LABEL[kind]} to publish a figure. Types available there: ${have.length ? have.join(", ") : "none"}.`);
  }
  return nrwAnswer(r, { label: area, nrwWide: false }, kind, defaulted, input.baseUrl);
}

export function nrwHistoryKey(input: { town?: string; property_type?: string }, rows: Row[] | null = readRows()): { area: string; item: string; label: string } | null {
  let kind: Kind;
  try { kind = kindOf(input.property_type).kind; } catch { return null; }
  if (!input.town) return { area: NATIONAL, item: kind, label: `North Rhine-Westphalia, ${KIND_LABEL[kind]}` };
  if (!rows) return null;
  const area = findArea(input.town, rows);
  return area ? { area, item: kind, label: `${area}, ${KIND_LABEL[kind]}` } : null;
}

export function readRows(): Row[] | null {
  const d = readLatestDay(INFO.id);
  return d ? d.rows.map((r) => ({ area: r.area, item: r.item, median: r.median, low: r.low, high: r.high, min: r.min, max: r.max, date: d.date })) : null;
}
