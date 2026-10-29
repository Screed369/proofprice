// Germany: average net cold rent per m2 from the Zensus 2022 (census of 15 May 2022), published by the Federal Statistical Office (Destatis)
// as grid-cell open data. "Durchschnittliche Nettokaltmiete in Gitterzellen": one average per 1 km (and 100 m, 10 km) cell of the ETRS89-LAEA grid.
// The file is big (zip 9.4 MB, 1 km csv 7.4 MB), static (census date 2022-05-15) and holds no place names, so harvest() reads it once,
// turns the 1 km cells around each of ~90 German city centres into one row (median and 10th-90th percentile of the cell averages) and
// the answer is read from the price library. Format checked 2026-10-23 with the probe (header, first rows of the 100 m file: see fixtures.ts).
import { inflateRawSync } from "node:zlib";
import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import type { HarvestResult, SourceInfo } from "../../lib/plugin";
import { readLatestDay } from "../../lib/library/store";
import { NO_COUNT, percentile, MIN_PUBLISH } from "../../lib/stats";
import { CITIES, City } from "./cities";

export const ZIP_URL = "https://www.destatis.de/static/DE/zensus/gitterdaten/Zensus2022_Durchschn_Nettokaltmiete.zip";
export const ENTRY_NAME = "Zensus2022_Durchschn_Nettokaltmiete_1km-Gitter.csv";
export const CENSUS_DATE = "2022-05-15";
export const ITEM = "net cold rent per m2, median of 1 km grid cells";
/** Fewest valid 1 km cells around a centre for a figure (more than the 5-record rule: a handful of cells is one district). */
export const MIN_CELLS = 8;

export const INFO: SourceInfo = {
  id: "de-zensus-rents",
  country: "DE (Germany)",
  category: "rent (Zensus 2022 average net cold rent per m2, grid cells)",
  name: "Zensus 2022: average net cold rent (Nettokaltmiete) per m2 in 1 km grid cells",
  publisher: "Statistisches Bundesamt (Destatis), Zensus 2022",
  what_is_recorded:
    "From the 2022 census (reference date 15 May 2022): the average net cold rent per m2 of the rented dwellings in each 1 km square of the European grid, " +
    "for squares with enough rented dwellings to publish. Net cold rent = the rent agreed in the tenancy contract without heating and service charges. " +
    "ProofPrice takes the squares around a city centre and states the median and 10th-90th percentile of their averages; never a tenancy or an address.",
  price_type: "official_statistic",
  freshness: "Static: the census date is 15 May 2022 (published 2024); the answer states that date and is not updated",
  licence:
    "Destatis copyright terms for its website content and downloadable products: \"Die Weiterverwendung ist sowohl für nicht gewerbliche als auch gewerbliche Zwecke erlaubt\"; " +
    "\"Eine Quellenangabe ist jedoch erforderlich\"; Destatis must be named as publisher and changes or calculations marked ('eigene Berechnung'). " +
    "The Zensus 2022 grid data are offered \"zur freien Nutzung (mit Namensnennung) als OpenData\". Licence read 23 Oct 2026 by the Licence Checker.",
  licence_url: "https://www.destatis.de/DE/Service/Impressum/copyright-allgemein.html",
  attribution: "Quelle: Statistisches Bundesamt (Destatis), Zensus 2022; eigene Berechnung (Median der 1-km-Gitterzellen um das Stadtzentrum).",
  homepage: "https://www.destatis.de/DE/Themen/Gesellschaft-Umwelt/Bevoelkerung/Zensus2022/_inhalt.html",
  limits:
    "A census snapshot of 15 May 2022, so rents have risen since: treat it as a level and a spread between districts, not today's rent. It is the average over ALL rented dwellings (existing contracts, not new lettings), " +
    "all sizes and types together, so no filter by bedrooms or house type. Squares with too few rented dwellings are not published; squares marked unreliable (in brackets) are left out. " +
    "The figure is the median of the square averages within a few kilometres of the city centre (not weighted by the number of dwellings), not the city's official average. No postcode level.",
};

// ---------- projection (pure): WGS84 -> ETRS89-LAEA (EPSG:3035) ----------

const A = 6378137;
const F = 1 / 298.257222101;
const E2 = F * (2 - F);
const E = Math.sqrt(E2);
const LAT0 = (52 * Math.PI) / 180;
const LON0 = (10 * Math.PI) / 180;
const FE = 4321000;
const FN = 3210000;

const qOf = (phi: number): number => {
  const s = Math.sin(phi);
  return (1 - E2) * (s / (1 - E2 * s * s) - (1 / (2 * E)) * Math.log((1 - E * s) / (1 + E * s)));
};

/** Latitude/longitude in degrees to ETRS89-LAEA easting/northing in metres (Snyder, ellipsoidal Lambert azimuthal equal-area). */
export function toLaea(latDeg: number, lonDeg: number): { x: number; y: number } {
  const phi = (latDeg * Math.PI) / 180;
  const lam = (lonDeg * Math.PI) / 180;
  const qp = qOf(Math.PI / 2);
  const q0 = qOf(LAT0);
  const beta = Math.asin(qOf(phi) / qp);
  const beta0 = Math.asin(q0 / qp);
  const rq = A * Math.sqrt(qp / 2);
  const m0 = Math.cos(LAT0) / Math.sqrt(1 - E2 * Math.sin(LAT0) ** 2);
  const d = (A * m0) / (rq * Math.cos(beta0));
  const dl = lam - LON0;
  const b = rq * Math.sqrt(2 / (1 + Math.sin(beta0) * Math.sin(beta) + Math.cos(beta0) * Math.cos(beta) * Math.cos(dl)));
  return {
    x: FE + b * d * Math.cos(beta) * Math.sin(dl),
    y: FN + (b / d) * (Math.cos(beta0) * Math.sin(beta) - Math.sin(beta0) * Math.cos(beta) * Math.cos(dl)),
  };
}

// ---------- the file (pure) ----------

export interface Cell {
  x: number; // easting of the cell midpoint, metres
  y: number; // northing of the cell midpoint, metres
  rent: number; // EUR per m2 per month
}

/** Read one named file out of a zip held in memory (central directory, then raw deflate). */
export function unzipEntry(buf: Buffer, name: string): Buffer {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new SourceError("Destatis download is not a zip file");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let k = 0; k < count; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new SourceError("Destatis zip has a bad directory");
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const entry = buf.toString("utf8", p + 46, p + 46 + nlen);
    if (entry === name) {
      if (buf.readUInt32LE(lho) !== 0x04034b50) throw new SourceError("Destatis zip has a bad entry");
      const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
      const data = buf.subarray(start, start + csize);
      if (method === 0) return Buffer.from(data);
      if (method === 8) return inflateRawSync(data);
      throw new SourceError(`Destatis zip uses an unsupported method (${method})`);
    }
    p += 46 + nlen + elen + clen;
  }
  throw new SourceError(`Destatis zip has no file ${name}: the download changed and this source needs updating.`);
}

export interface ParsedGrid {
  cells: Cell[];
  skippedFlagged: number;
  skippedBad: number;
}

/** Parse the semicolon csv: GITTER_ID_1km;x_mp_1km;y_mp_1km;durchschnMieteQM;werterlaeuternde_Zeichen. Decimal comma. A row with a mark in the last
 *  column (KLAMMERN = value in brackets, less reliable) is skipped. The cell midpoint comes from the id (CRS3035RES1000mN<north>E<east>, lower-left corner). */
export function parseGrid(text: string): ParsedGrid {
  const lines = text.split(/\r?\n/);
  const head = (lines.shift() ?? "").replace(/^﻿/, "").split(";").map((h) => h.trim());
  const iId = head.findIndex((h) => /^GITTER_ID/i.test(h));
  const iRent = head.findIndex((h) => /miete/i.test(h));
  const iFlag = head.findIndex((h) => /erl\w{1,2}uternde/i.test(h));
  if (iId < 0 || iRent < 0) throw new SourceError("The Destatis rent grid has a new layout (no GITTER_ID or rent column); this source needs updating.");
  const cells: Cell[] = [];
  let skippedFlagged = 0;
  let skippedBad = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    const f = line.split(";");
    const m = /^CRS3035RES(\d+)mN(\d+)E(\d+)$/.exec((f[iId] ?? "").trim());
    const rent = Number((f[iRent] ?? "").trim().replace(",", "."));
    if (!m || !Number.isFinite(rent) || rent <= 0 || rent > 100) {
      skippedBad++;
      continue;
    }
    if (iFlag >= 0 && (f[iFlag] ?? "").trim() !== "") {
      skippedFlagged++;
      continue;
    }
    const half = Number(m[1]) / 2;
    cells.push({ x: Number(m[3]) + half, y: Number(m[2]) + half, rent });
  }
  return { cells, skippedFlagged, skippedBad };
}

export interface CityFigure {
  city: string;
  cells: number;
  median: number;
  low: number;
  high: number;
  min: number;
  max: number;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** The cells whose midpoint lies within the city's radius of its centre, summarised. Null when fewer than MIN_CELLS cells. */
export function cityFigure(cells: Cell[], city: City): CityFigure | null {
  const c = toLaea(city.lat, city.lon);
  const r2 = (city.radiusKm * 1000) ** 2;
  const rents: number[] = [];
  for (const cell of cells) {
    const dx = cell.x - c.x;
    if (dx * dx > r2) continue;
    const dy = cell.y - c.y;
    if (dx * dx + dy * dy <= r2) rents.push(cell.rent);
  }
  if (rents.length < Math.max(MIN_CELLS, MIN_PUBLISH)) return null;
  rents.sort((a, b) => a - b);
  return {
    city: city.name,
    cells: rents.length,
    median: round2(percentile(rents, 0.5)),
    low: round2(percentile(rents, 0.1)),
    high: round2(percentile(rents, 0.9)),
    min: round2(rents[0]),
    max: round2(rents[rents.length - 1]),
  };
}

export function harvestFrom(grid: ParsedGrid): HarvestResult {
  const figures = CITIES.map((c) => cityFigure(grid.cells, c)).filter((x): x is CityFigure => x !== null);
  if (figures.length < 20) throw new SourceError(`Only ${figures.length} cities had enough grid cells in the Destatis rent file; it has probably changed.`);
  return {
    date: CENSUS_DATE,
    currency: "EUR",
    unit: "per m2 per month",
    rows: figures.map((f) => ({ area: f.city, item: ITEM, n: NO_COUNT, median: f.median, low: f.low, high: f.high, min: f.min, max: f.max })),
    note:
      `Zensus 2022 average net cold rent per m2 (census date ${CENSUS_DATE}), 1 km grid: median, 10th and 90th percentile, lowest and highest of the cell averages within a radius of the city centre. ` +
      `${grid.cells.length} usable cells (${grid.skippedFlagged} marked unreliable and ${grid.skippedBad} unusable rows left out). Cell counts per city: ` +
      figures.map((f) => `${f.city} ${f.cells}`).join(", ") + ". n is NO_COUNT: the cell averages are not counts of tenancies.",
  };
}

/** The census is static (15 May 2022). If the download is refused or unreachable (Destatis answered HTTP 403 to the collector on 28-29 Oct 2026)
 *  and the library already holds that census day, keep those stored figures instead of reporting a fault every day. */
export function reuseStored(why: string): HarvestResult | null {
  const held = readLatestDay("de-zensus-rents");
  if (!held || held.date !== CENSUS_DATE || held.rows.length < 20) return null;
  return {
    date: held.date,
    currency: "EUR",
    unit: "per m2 per month",
    rows: held.rows.map((r) => ({ area: r.area, item: r.item, n: NO_COUNT, median: r.median, low: r.low, high: r.high, min: r.min, max: r.max })),
    note: `Zensus 2022 average net cold rent per m2 (census date ${held.date}), 1 km grid. The census figures do not change; the Destatis download was unavailable today (${why}), so the figures stored on the first successful read are kept. n is NO_COUNT: the cell averages are not counts of tenancies.`,
  };
}

export async function deHarvest(): Promise<HarvestResult> {
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
    throw new SourceError(`Destatis returned HTTP ${res.status}`);
  }
  const csv = unzipEntry(Buffer.from(await res.arrayBuffer()), ENTRY_NAME).toString("utf8");
  return harvestFrom(parseGrid(csv));
}

// ---------- places (pure) ----------

/** Lower case, German umlauts to base letters, accents and punctuation removed: "München" and "Muenchen" both become "munchen". */
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

export function findCity(input: string, cities: City[] = CITIES): City | null {
  const q = fold(input.replace(/,?\s*(deutschland|germany)\s*$/i, ""));
  if (!q) return null;
  for (const c of cities) if ([c.name, ...(c.aliases ?? [])].some((n) => fold(n) === q)) return c;
  return null;
}

// ---------- the request (pure) ----------

export interface DeRentInput {
  town?: string;
  postcode?: string;
  property_type?: string;
  house_type?: string;
  bedrooms?: number;
  baseUrl?: string;
}

export interface Figure { city: string; median: number; low: number; high: number; min: number; max: number; date: string }

export function figureFromRows(rows: { area: string; item: string; median: number; low: number; high: number; min: number; max: number; date: string }[], city: string): Figure | null {
  const r = rows.find((x) => x.area === city && x.item === ITEM);
  return r ? { city: r.area, median: r.median, low: r.low, high: r.high, min: r.min, max: r.max, date: r.date } : null;
}

export function deMethod(): string {
  return (
    "Germany rents: Destatis publishes the average net cold rent per m2 of rented dwellings (Zensus 2022, census date 15 May 2022) for every 1 km square of the European grid. " +
    "We take the squares whose centre lies within a few kilometres of the city centre and report the median and the 10th-90th percentile of their averages. " +
    "It is a census snapshot of existing contracts, not today's asking or new-letting rents; the squares are not weighted by the number of dwellings."
  );
}

export function deRentAnswer(fig: Figure, input: DeRentInput, city: City): PriceAnswer {
  const eur = (v: number) => fmtMoney(v, "EUR");
  const notes: string[] = [
    "Census snapshot of 15 May 2022: the average net cold rent (without heating and service charges) of rented dwellings in each 1 km square, all sizes and types together; rents have risen since.",
    `Median and 10th-90th percentile are calculated by ProofPrice over the squares within ${city.radiusKm} km of the city centre, not weighted by the number of dwellings.`,
  ];
  if (input.property_type && input.property_type !== "any") notes.push(`The figure covers all rented dwellings together; the file has no split by property type, so "${input.property_type}" was not applied.`);
  return buildStatisticAnswer({
    source: INFO,
    query: { country: "DE", town: city.name },
    value: fig.median,
    measure: "median",
    currency: "EUR",
    unit: "per m2 per month",
    period: { from: fig.date, to: fig.date },
    reference_period: "census date 15 May 2022",
    low: fig.low,
    high: fig.high,
    min: fig.min,
    max: fig.max,
    method: deMethod(),
    note: notes.join(" "),
    baseUrl: input.baseUrl,
    describe: (v) =>
      `In ${city.name} the typical average net cold rent in the census was ${eur(v)} per m2 a month (middle of the 1 km squares within ${city.radiusKm} km of the centre; ` +
      `10th-90th percentile ${eur(fig.low)} to ${eur(fig.high)}), at the census of 15 May 2022. This is the rent in existing contracts, not an asking rent.`,
    ending: "Zensus 2022, Statistisches Bundesamt (Destatis); median calculated by ProofPrice from the published 1 km grid.",
    extra: {
      country_name: "Germany",
      place: { name: city.name, radius_km: city.radiusKm, centre: { lat: city.lat, lon: city.lon } },
      census_date: CENSUS_DATE,
      range_basis: "10th and 90th percentile of the 1 km square averages around the centre (district spread), not of individual rents",
      lowest_and_highest_square: { lowest: fig.min, highest: fig.max },
      what_this_is: "Average net cold rent per m2 of rented dwellings (existing contracts) in the 2022 census, by 1 km grid square. Not an asking rent, not a new-letting rent.",
      attribution_notice: INFO.attribution,
    },
  });
}

export function deRent(input: DeRentInput, o: { rows?: ReturnType<typeof readRows> } = {}): PriceAnswer {
  const asked = (input.town ?? "").trim();
  if (!asked) throw new InputError("Germany: town is required. Give a German city, for example Berlin, Hamburg, München, Köln, Frankfurt am Main or Leipzig.");
  if (input.postcode) throw new InputError("Germany: the census rent grid has no postcode level. Give the city as town.");
  if (input.bedrooms !== undefined) throw new InputError("Germany: the census rent figure covers all rented dwellings together; bedrooms cannot be applied. Leave bedrooms out.");
  if (input.house_type) throw new InputError("Germany: the census rent figure covers all rented dwellings together; house_type cannot be applied. Leave it out.");
  if (input.property_type === "room") throw new InputError("Germany: the census rent figure covers whole rented dwellings, not rooms. Leave property_type out.");
  const city = findCity(asked);
  if (!city) {
    throw new InputError(`Germany: town must be one of the ${CITIES.length} cities covered (for example ${CITIES.slice(0, 12).map((c) => c.name).join(", ")}); "${asked}" is not one of them.`);
  }
  const rows = o.rows !== undefined ? o.rows : readRows();
  if (!rows) throw new SourceError("ProofPrice collects the Destatis Zensus 2022 rent grid once; data appears after the next collection.");
  const fig = figureFromRows(rows, city.name);
  if (!fig) throw new SourceError(`The Destatis rent grid had too few squares around ${city.name} to publish a figure.`);
  return deRentAnswer(fig, input, city);
}

export function readRows() {
  return readLatestDay(INFO.id)?.rows ?? null;
}
