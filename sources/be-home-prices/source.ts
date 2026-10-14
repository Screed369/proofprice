// Belgium home prices from Statbel (Statistics Belgium) open data "Vastgoed": for every type of property and every
// municipality, province, region and Belgium, per quarter, half-year and year, the number of transactions and the 25th
// percentile, median and 75th percentile of the transaction price. One 46 MB file (zipped 3 MB):
// https://statbel.fgov.be/sites/default/files/files/opendata/immo/vastgoed_2010_9999.zip  (pipe-delimited text, Latin-1)
//
// It is a bulk file, so it is never downloaded per request: harvest() (run once a day by the collector) keeps the NEWEST
// quarter, half-year and year in the price library, and answers are read from there.
// Formats below were checked live on 2026-10-14 (see source.test.ts and fixtures.ts).

import { inflateRawSync } from "node:zlib";
import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { readLatestDay, readMeta } from "../../lib/library/store";
import type { LibraryRow } from "../../lib/library/store";
import { confidenceLabel, MIN_PUBLISH } from "../../lib/stats";

export const FILE_URL = "https://statbel.fgov.be/sites/default/files/files/opendata/immo/vastgoed_2010_9999.zip";
export const THEME_URL = "https://statbel.fgov.be/en/themes/housing/real-estate";

export const INFO: SourceInfo = {
  id: "be-home-prices",
  country: "BE (Belgium)",
  category: "home sales (official median sale prices)",
  name: "Real estate: number of transactions and sale prices by type of property and municipality (Statbel open data 'Vastgoed')",
  publisher: "Statbel (Statistics Belgium)",
  what_is_recorded:
    "For Belgium, its three regions, provinces, arrondissements and municipalities, each type of property (houses with 2 or 3 facades, houses with 4 or more facades, all houses together without apartments, apartments) and each quarter, half-year and year: " +
    "the number of transactions and the 25th percentile, the median and the 75th percentile of the sale price. Statbel's real-estate sales statistics are based on transaction data of the General Administration of the Patrimonial Documentation (FPS Finance). " +
    "One published row per place, type and period; never individual sales or addresses. In the file the quartiles are left blank for cells with few transactions.",
  price_type: "official_statistic",
  freshness: "Quarterly, about three months after the quarter ends (Statbel: 'Results available 3 months after the reference period'); collected into our price library every day, each answer states its period",
  licence:
    "Creative Commons Attribution 4.0 International (CC BY 4.0). Statbel open data page: \"Open data can be re-used for free. Yet, re-users are required to meet licence conditions. " +
    "Statbel’s open data are published under the Creative Commons Attribution 4.0 license (CC BY 4.0).\"",
  licence_url: "https://statbel.fgov.be/en/open-data",
  attribution:
    "Source: Statbel (Statistics Belgium), real estate prices ('Vastgoed' open data), reused under CC BY 4.0. " +
    "Figures are passed on as published; the comparisons with the region and with Belgium are calculated by ProofPrice. This is not an endorsement by Statbel.",
  homepage: THEME_URL,
  limits:
    "Statbel publishes the 25th percentile, median and 75th percentile (an interquartile range, not a 10th-90th range) and the number of transactions. " +
    "Statbel leaves the quartiles blank for cells with few transactions (we found blanks for cells with 6 to 15 sales), so small municipalities often have no quarterly figure and sometimes none at all; the answer then falls back to the half-year or the year and says which, and we never publish a figure from fewer than 5 transactions. " +
    "Statbel treats the data for the latest quarter as provisional and revises it in its next publication. Prices per home, not per m². The types are Statbel's: all houses, houses with 2 or 3 facades (terraced and semi-detached), houses with 4 or more facades (detached) and apartments. " +
    "Statbel publishes no figure for houses and apartments together, so a request without a property type gets both medians in the summary but no single price; there is no separate villa category (a 'villa' request is answered with the 4-or-more-facades houses).",
};

// ---------- the Statbel file (pure) ----------

export interface VastRow {
  year: number;
  typeNl: string;
  typeFr: string;
  refnis: string;
  nameNl: string;
  nameFr: string;
  period: string; // Q1-Q4, S1, S2, Y
  surface: string; // size class; "totaal / total" for the all-sizes row
  transactions: number;
  p25: number | null;
  p50: number | null;
  p75: number | null;
  level: number; // 1 Belgium, 2 region, 3 province, 4 arrondissement, 5 municipality
}

/** Statbel's file is Latin-1 today; read it as UTF-8 if it ever becomes that. */
export function decodeFile(buf: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return buf.toString("latin1");
  }
}

const num = (s: string | undefined): number | null => {
  if (s === undefined) return null;
  const t = s.trim();
  if (!t) return null;
  const v = Number(t.replace(",", "."));
  return Number.isFinite(v) ? v : null;
};

const REQUIRED = ["CD_YEAR", "CD_TYPE_NL", "CD_REFNIS", "CD_PERIOD", "MS_TOTAL_TRANSACTIONS", "MS_P_25", "MS_P_50_median", "MS_P_75"];

/** Parse the pipe-delimited text. Columns are found by name, so a reordered file still reads. Throws SourceError if the layout is not recognised. */
export function parseVastgoed(text: string): VastRow[] {
  const lines = text.split("\n");
  const head = (lines[0] ?? "").replace(/^﻿/, "").replace(/\r$/, "").split("|").map((c) => c.trim());
  const at = (name: string) => head.indexOf(name);
  for (const c of REQUIRED) if (at(c) < 0) throw new SourceError(`Statbel real-estate file has an unexpected layout (no ${c} column)`);
  const [iYear, iTypeNl, iTypeFr, iRef, iNameNl, iNameFr, iPeriod, iSurface, iTx, i25, i50, i75, iLevel] = [
    "CD_YEAR", "CD_TYPE_NL", "CD_TYPE_FR", "CD_REFNIS", "CD_REFNIS_NL", "CD_REFNIS_FR", "CD_PERIOD", "CD_CLASS_SURFACE", "MS_TOTAL_TRANSACTIONS", "MS_P_25", "MS_P_50_median", "MS_P_75", "CD_niveau_refnis",
  ].map(at);
  const out: VastRow[] = [];
  for (let n = 1; n < lines.length; n++) {
    const line = lines[n];
    if (!line) continue;
    const c = line.replace(/\r$/, "").split("|");
    const year = Number(c[iYear]);
    if (!Number.isInteger(year)) continue;
    out.push({
      year,
      typeNl: (c[iTypeNl] ?? "").trim(),
      typeFr: iTypeFr >= 0 ? (c[iTypeFr] ?? "").trim() : "",
      refnis: (c[iRef] ?? "").trim(),
      nameNl: iNameNl >= 0 ? (c[iNameNl] ?? "").trim() : "",
      nameFr: iNameFr >= 0 ? (c[iNameFr] ?? "").trim() : "",
      period: (c[iPeriod] ?? "").trim(),
      surface: iSurface >= 0 ? (c[iSurface] ?? "").trim() : "totaal / total",
      transactions: num(c[iTx]) ?? 0,
      p25: num(c[i25]),
      p50: num(c[i50]),
      p75: num(c[i75]),
      level: iLevel >= 0 ? (num(c[iLevel]) ?? 0) : 0,
    });
  }
  return out;
}

/** Read the first file out of a zip held in memory: central directory, then raw deflate. */
export function unzipFirstFile(buf: Buffer): Buffer {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new SourceError("Statbel download is not a zip file");
  const cd = buf.readUInt32LE(eocd + 16);
  if (buf.readUInt32LE(cd) !== 0x02014b50) throw new SourceError("Statbel zip has a bad directory");
  const method = buf.readUInt16LE(cd + 10);
  const csize = buf.readUInt32LE(cd + 20);
  const lho = buf.readUInt32LE(cd + 42);
  if (buf.readUInt32LE(lho) !== 0x04034b50) throw new SourceError("Statbel zip has a bad entry");
  const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
  const data = buf.subarray(start, start + csize);
  if (method === 0) return Buffer.from(data);
  if (method === 8) return inflateRawSync(data);
  throw new SourceError(`Statbel zip uses an unsupported method (${method})`);
}

// ---------- types (pure) ----------

/** Lower case, accents removed, punctuation (apostrophes too) to single spaces: "PROVINCE D'ANVERS" -> "province d anvers". */
export function foldName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Our short key for one of Statbel's property types, or null for a type we do not publish (building land, for instance).
 * The four real labels (checked 2026-10-14) are: "Huizen met 2 of 3 gevels (gesloten + halfopen bebouwing)" -> house-closed,
 * "Huizen met 4 of meer gevels (open bebouwing)" -> house-open, "Alle huizen met 2, 3, 4 of meer gevels (excl. appartementen)" -> all,
 * "Appartementen" -> apartment. The all-houses label mentions "appartementen" and "4 of meer", so it is tested first.
 */
export function typeKeyOf(typeNl: string, typeFr = ""): string | null {
  const t = foldName(typeNl) + " | " + foldName(typeFr);
  if (/bouwgrond|terrain|\bgrond\b/.test(t)) return null;
  if (/\balle huizen\b|\btoutes les maisons\b/.test(t)) return "all";
  if (/\b2 of 3 gevels\b|\b2 ou 3 facades\b/.test(t)) return "house-closed";
  if (/\b4 of meer gevels\b|\b4 ou plus de facades\b|open bebouwing|type ouvert/.test(t)) return "house-open";
  if (/villa|landhuis|buitenverblijf|bungalow/.test(t)) return "villa";
  if (/appartement/.test(t)) return "apartment";
  return null;
}

// ---------- periods (pure) ----------

export interface Period {
  year: number;
  code: string; // Q1..Q4, S1, S2, Y
  kind: "Q" | "S" | "Y";
}

const PERIOD_CODE = /^(\d{4})(Q[1-4]|S[12]|Y)$/;
export const periodId = (p: Period) => `${p.year}${p.code}`;
export function parsePeriodId(id: string): Period | null {
  const m = PERIOD_CODE.exec(id);
  return m ? { year: Number(m[1]), code: m[2], kind: m[2][0] as Period["kind"] } : null;
}
const iso = (d: Date) => d.toISOString().slice(0, 10);
export function periodEnd(p: Period): string {
  const lastMonth = p.kind === "Q" ? Number(p.code[1]) * 3 : p.kind === "S" ? Number(p.code[1]) * 6 : 12;
  return iso(new Date(Date.UTC(p.year, lastMonth, 0)));
}
export function periodStart(p: Period): string {
  const firstMonth = p.kind === "Q" ? (Number(p.code[1]) - 1) * 3 : p.kind === "S" ? (Number(p.code[1]) - 1) * 6 : 0;
  return iso(new Date(Date.UTC(p.year, firstMonth, 1)));
}
/** The label used in answers: 2026-Q2, 2026-S1, 2025. */
export const periodLabel = (p: Period) => (p.kind === "Y" ? String(p.year) : `${p.year}-${p.code}`);
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export function periodWords(p: Period): string {
  if (p.kind === "Y") return `the year ${p.year}`;
  if (p.kind === "S") return p.code === "S1" ? `the first half of ${p.year}` : `the second half of ${p.year}`;
  const q = Number(p.code[1]);
  return `the ${["first", "second", "third", "fourth"][q - 1]} quarter of ${p.year} (${MONTHS[q * 3 - 3]} to ${MONTHS[q * 3 - 1]})`;
}

// ---------- harvest (pure part) ----------

export const AREA_SEP = "|";
/** Library area key: refnis, Dutch name, French name (empty when the same), level. */
export function areaKey(r: Pick<VastRow, "refnis" | "nameNl" | "nameFr" | "level">): string {
  return [r.refnis, r.nameNl, r.nameFr === r.nameNl ? "" : r.nameFr, r.level].join(AREA_SEP);
}

export interface SnapshotResult {
  date: string;
  rows: DailyRow[];
  periods: string[];
  types: Record<string, number>;
  unmapped: string[];
}

/** The newest quarter, half-year and year that Belgium as a whole has a published median for, turned into library rows. */
export function snapshotOf(all: VastRow[]): SnapshotResult {
  const usable = all.filter((r) => /^totaal/i.test(r.surface) && r.p25 !== null && r.p50 !== null && r.p75 !== null && r.p50 > 0 && r.transactions >= MIN_PUBLISH);
  const unmapped = new Set<string>();
  const mapped: (VastRow & { key: string })[] = [];
  for (const r of usable) {
    const key = typeKeyOf(r.typeNl, r.typeFr);
    if (key) mapped.push({ ...r, key });
    else unmapped.add(r.typeNl);
  }
  const rank = (p: Period) => p.year * 10 + (p.kind === "Q" ? Number(p.code[1]) : p.kind === "S" ? Number(p.code[1]) : 0);
  const newest = new Map<Period["kind"], Period>();
  for (const r of mapped.filter((m) => m.level === 1 || m.refnis === "01000")) {
    const p = parsePeriodId(`${r.year}${r.period}`);
    if (!p) continue;
    const cur = newest.get(p.kind);
    if (!cur || rank(p) > rank(cur)) newest.set(p.kind, p);
  }
  const wanted = new Map<string, Period>();
  for (const p of newest.values()) wanted.set(periodId(p), p);
  if (!wanted.size) throw new SourceError("Statbel real-estate file holds no Belgian median to harvest");
  const date = [...wanted.values()].map(periodEnd).sort().pop()!;
  const rows: DailyRow[] = [];
  const types: Record<string, number> = {};
  for (const r of mapped) {
    const id = `${r.year}${r.period}`;
    if (!wanted.has(id)) continue;
    types[r.key] = (types[r.key] ?? 0) + 1;
    rows.push({ area: areaKey(r), item: `${r.key}/${id}`, n: r.transactions, median: r.p50!, low: r.p25!, high: r.p75!, min: r.p25!, max: r.p75! });
  }
  rows.sort((a, b) => a.area.localeCompare(b.area) || a.item.localeCompare(b.item));
  return { date, rows, periods: [...wanted.keys()].sort(), types, unmapped: [...unmapped].sort() };
}

const UA = "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)";

/** The daily collector: download Statbel's file once, keep the newest periods. */
export async function beHarvest(): Promise<HarvestResult> {
  const res = await fetch(FILE_URL, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(180_000) });
  if (!res.ok) throw new SourceError(`Statbel returned HTTP ${res.status}`);
  const text = decodeFile(unzipFirstFile(Buffer.from(await res.arrayBuffer())));
  const snap = snapshotOf(parseVastgoed(text));
  return {
    date: snap.date,
    currency: "EUR",
    unit: "per home",
    rows: snap.rows,
    note:
      `Newest periods Statbel publishes for Belgium: ${snap.periods.join(", ")}. low and high are the 25th and 75th percentile (Statbel publishes quartiles, not deciles); min and max repeat them. ` +
      `Types kept: ${Object.entries(snap.types).map(([k, v]) => `${k} ${v}`).join(", ")}.` +
      (snap.unmapped.length ? ` Not kept: ${snap.unmapped.join("; ")}.` : ""),
  };
}

// ---------- places (pure) ----------

export interface Place {
  key: string; // the library area key
  refnis: string;
  nl: string;
  fr: string; // "" when the same as nl
  level: number;
}

export function parseAreaKey(key: string): Place | null {
  const [refnis, nl, fr, level] = key.split(AREA_SEP);
  if (!refnis || !nl || level === undefined) return null;
  return { key, refnis, nl, fr: fr ?? "", level: Number(level) };
}

const SMALL_WORDS = new Set(["de", "van", "der", "den", "het", "aan", "op", "ten", "ter", "te", "la", "le", "les", "sur", "en", "lez", "sous", "du", "des", "d", "l"]);
/** "SINT-JANS-MOLENBEEK" -> "Sint-Jans-Molenbeek". */
export function titleCase(s: string): string {
  let first = true;
  return s
    .toLowerCase()
    .replace(/[\p{L}]+/gu, (w) => {
      const out = first || !SMALL_WORDS.has(w) ? w[0].toUpperCase() + w.slice(1) : w;
      first = false;
      return out;
    });
}

/** The way a place is named in answers: Dutch name, plus the French one when it differs ("Elsene / Ixelles"). */
export function placeLabel(p: Place): string {
  if (p.level === 1) return "Belgium";
  return p.fr && foldName(p.fr) !== foldName(p.nl) ? `${titleCase(p.nl)} / ${titleCase(p.fr)}` : titleCase(p.nl);
}

export const LEVEL_NAME: Record<number, string> = { 1: "Belgium", 2: "region", 3: "province", 4: "arrondissement", 5: "municipality" };

/** English (and common alternative) spellings -> the folded Dutch or French name Statbel uses. A list means "try these". */
export const ALIASES: Record<string, string[]> = {
  brussels: ["brussel", "bruxelles"],
  brussel: ["brussel"],
  bruxelles: ["bruxelles"],
  antwerp: ["antwerpen"],
  anvers: ["anvers"],
  ghent: ["gent"],
  gand: ["gand"],
  bruges: ["brugge"],
  ostend: ["oostende"],
  louvain: ["leuven", "louvain"],
  liege: ["luik", "liege"],
  mechelen: ["mechelen"],
  malines: ["malines", "mechelen"],
  ypres: ["ieper"],
  courtrai: ["kortrijk", "courtrai"],
  tournai: ["doornik", "tournai"],
  namur: ["namen", "namur"],
  mons: ["bergen", "mons"],
  "knokke heist": ["knokke heist"],
  waterloo: ["waterloo"],
  // regions and the country
  flanders: ["vlaams gewest"],
  vlaanderen: ["vlaams gewest"],
  "flemish region": ["vlaams gewest"],
  wallonia: ["waals gewest"],
  wallonie: ["waals gewest"],
  wallonien: ["waals gewest"],
  "walloon region": ["waals gewest"],
  "brussels capital region": ["brussels hoofdstedelijk gewest"],
  "brussels capital": ["brussels hoofdstedelijk gewest"],
  "brussels region": ["brussels hoofdstedelijk gewest"],
  "brussels hoofdstedelijk gewest": ["brussels hoofdstedelijk gewest"],
  "region de bruxelles capitale": ["brussels hoofdstedelijk gewest"],
  "bruxelles capitale": ["brussels hoofdstedelijk gewest"],
};
const NATIONAL_WORDS = new Set(["belgium", "belgie", "belgique", "belgien", "be", "national", "nationwide", "all", "whole country", "country"]);

export type BeLookup = { kind: "found"; place: Place } | { kind: "ambiguous"; options: Place[] } | { kind: "similar"; options: Place[] } | { kind: "none" };

const LEVEL_PREFIX = /^(province of|provincie|province de|province d|province|arrondissement of|arrondissement de|arrondissement|municipality of|gemeente|commune de|commune d|city of|ville de|stad)\s+/;

/** Match what the caller typed to a place in the snapshot. Only an exact Dutch or French name (after aliases) resolves; municipalities come before provinces, arrondissements and regions. */
export function findPlace(input: string, places: Place[]): BeLookup {
  let q = foldName(input.split(",")[0].replace(/\([^)]*\)/g, " "));
  if (!q) return { kind: "none" };
  if (NATIONAL_WORDS.has(q)) {
    const be = places.find((p) => p.level === 1);
    return be ? { kind: "found", place: be } : { kind: "none" };
  }
  let wantLevel: number | null = null;
  const lp = LEVEL_PREFIX.exec(q);
  if (lp) {
    wantLevel = /^province|^provincie/.test(lp[1]) ? 3 : /^arrondissement/.test(lp[1]) ? 4 : /^(municipality|gemeente|commune|city|ville|stad)/.test(lp[1]) ? 5 : null;
    q = q.slice(lp[0].length).trim();
  }
  const suffix = /\s+(province|provincie|arrondissement|municipality|gemeente|city)$/.exec(q);
  if (suffix) {
    wantLevel = /^province|^provincie/.test(suffix[1]) ? 3 : suffix[1] === "arrondissement" ? 4 : 5;
    q = q.slice(0, suffix.index).trim();
  }
  const names = ALIASES[q] ?? [q];
  const strip = (s: string) => foldName(s).replace(/^(provincie|province de|province d|province|arrondissement de|arrondissement|arrondissement d)\s+/, "");
  const sameName = (p: Place) => names.some((n) => foldName(p.nl) === n || foldName(p.fr) === n || strip(p.nl) === n || strip(p.fr) === n);
  let hits = places.filter((p) => p.level > 1 && sameName(p));
  if (wantLevel !== null) hits = hits.filter((p) => p.level === wantLevel);
  if (hits.length) {
    const best = Math.max(...hits.map((p) => p.level)); // municipality (5) before arrondissement (4), province (3), region (2)
    const top = hits.filter((p) => p.level === best);
    if (top.length === 1) return { kind: "found", place: top[0] };
    // The same name for two municipalities that are both named exactly this: ask.
    return { kind: "ambiguous", options: top };
  }
  if (q.length < 3) return { kind: "none" };
  const words = q.split(" ");
  const similar = places.filter((p) => {
    if (p.level < 4) return false;
    const names2 = [foldName(p.nl), foldName(p.fr)].filter(Boolean);
    return names2.some((nm) => words.every((w) => nm.split(" ").includes(w) || (w.length >= 4 && nm.split(" ").some((x) => x.startsWith(w)))));
  });
  if (similar.length) return { kind: "similar", options: similar.sort((a, b) => a.nl.localeCompare(b.nl)) };
  return { kind: "none" };
}

// ---------- the snapshot in the library (pure) ----------

export interface Figure {
  period: Period;
  n: number;
  p25: number;
  p50: number;
  p75: number;
}
export interface Snapshot {
  date: string;
  places: Place[];
  /** key: area key + "\u0000" + type key */
  figures: Map<string, Figure[]>;
}

export function snapshotFromRows(date: string, rows: Pick<LibraryRow, "area" | "item" | "n" | "median" | "low" | "high">[]): Snapshot {
  const places = new Map<string, Place>();
  const figures = new Map<string, Figure[]>();
  for (const r of rows) {
    const [type, pid] = r.item.split("/");
    const period = pid ? parsePeriodId(pid) : null;
    if (!type || !period) continue;
    let place = places.get(r.area);
    if (!place) {
      const p = parseAreaKey(r.area);
      if (!p) continue;
      places.set(r.area, p);
      place = p;
    }
    const k = r.area + "\u0000" + type;
    const list = figures.get(k) ?? [];
    list.push({ period, n: r.n, p25: r.low, p50: r.median, p75: r.high });
    figures.set(k, list);
  }
  return { date, places: [...places.values()], figures };
}

let cache: { key: string; snap: Snapshot } | null = null;
/** The newest snapshot in the library, or null if the collector has not stored one yet. */
export function loadSnapshot(): Snapshot | null {
  const meta = readMeta(INFO.id);
  const day = readLatestDay(INFO.id);
  if (!meta || !day) return null;
  const key = `${day.date}:${day.rows.length}:${meta.last_ok_at ?? ""}`;
  if (cache?.key === key) return cache.snap;
  const snap = snapshotFromRows(day.date, day.rows);
  cache = { key, snap };
  return snap;
}

// ---------- the request (pure) ----------

export const TYPE_ASK = ["any", "house", "apartment", "villa", "detached", "semi-detached", "terraced", "flat-maisonette", "condo"] as const;
export type AskType = (typeof TYPE_ASK)[number];

/** Which of Statbel's types answer each request, best first. "any" has none: Statbel publishes no figure for houses and apartments together. */
export const TYPE_ORDER: Record<AskType, string[]> = {
  any: [],
  house: ["all", "house-closed"],
  apartment: ["apartment"],
  "flat-maisonette": ["apartment"],
  condo: ["apartment"],
  villa: ["villa", "house-open"],
  detached: ["house-open"],
  "semi-detached": ["house-closed"],
  terraced: ["house-closed"],
};

const TYPE_WORDS: Record<string, string> = {
  all: "houses (all types, not apartments)",
  "house-closed": "houses with 2 or 3 facades (terraced and semi-detached)",
  "house-open": "houses with 4 or more facades (detached)",
  apartment: "apartments",
  villa: "villas, bungalows and cottages",
};

/** Periods with at least this many transactions are steady enough to prefer the shorter period. */
export const STEADY_N = 30;

/**
 * The figure to answer with. Among the periods that end last, the shortest one (quarter before half-year before year)
 * that has at least STEADY_N transactions; if none has, the one with the most transactions.
 */
export function bestFigure(list: Figure[]): Figure | null {
  if (!list.length) return null;
  const lastEnd = list.map((f) => periodEnd(f.period)).sort().pop()!;
  const latest = list.filter((f) => periodEnd(f.period) === lastEnd);
  const length = { Q: 0, S: 1, Y: 2 };
  const steady = latest.filter((f) => f.n >= STEADY_N).sort((a, b) => length[a.period.kind] - length[b.period.kind]);
  if (steady.length) return steady[0];
  return [...latest].sort((a, b) => b.n - a.n)[0];
}

const roundTo = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

export interface BeQuery {
  town: string | null;
  property_type: AskType;
  baseUrl?: string;
  now?: Date;
}

const METHOD =
  "Statbel (Statistics Belgium) publishes, per type of property, municipality, province, region and for Belgium, the number of transactions and the 25th percentile, median and 75th percentile of the sale price, per quarter, half-year and year. " +
  "ProofPrice collects the newest quarter, half-year and year from Statbel's open-data file once a day and answers from that copy: the most recent period with a published figure for the place, " +
  "unchanged, with the transaction count, the interquartile range, and the figures for the region and for Belgium. Statbel leaves the quartiles blank for cells with few transactions, so a small municipality may only have a half-year or a year.";

function noMatch(q: BeQuery, place: string | null, summary: string): PriceAnswer {
  const none = buildStatisticAnswer({
    source: INFO,
    query: { country: "BE", town: place ?? q.town ?? "Belgium", property_type: q.property_type },
    value: null,
    measure: "median",
    currency: "EUR",
    unit: "per home",
    period: { from: null, to: null },
    reference_period: "",
    method: METHOD,
    describe: () => "",
    baseUrl: q.baseUrl,
  });
  return { ...none, summary };
}

/** The finished answer from a snapshot. Throws InputError for an ambiguous name; returns no_matches for anything Statbel has no figure for. */
export function beAnswer(snap: Snapshot, q: BeQuery): PriceAnswer {
  let place: Place;
  if (q.town) {
    const f = findPlace(q.town, snap.places);
    if (f.kind === "ambiguous") {
      throw new InputError(`'${q.town}' names several places in Statbel's data: ${f.options.slice(0, 8).map((p) => `${placeLabel(p)} (${LEVEL_NAME[p.level]}, code ${p.refnis})`).join("; ")}. Give the full name.`);
    }
    if (f.kind !== "found") {
      const did = f.kind === "similar" ? ` Did you mean ${f.options.slice(0, 6).map((p) => `${placeLabel(p)} (${LEVEL_NAME[p.level]})`).join("; ")}? Ask again with the full name.` : "";
      return noMatch(q, null, `Statbel's real-estate data has no municipality, province or region called '${q.town}'.${did} Use the Dutch, French or English name of a Belgian municipality, province or region, or leave town out for Belgium.`);
    }
    place = f.place;
  } else {
    const be = snap.places.find((p) => p.level === 1);
    if (!be) return noMatch(q, "Belgium", "Statbel's national figure is not in the price library yet.");
    place = be;
  }
  const label = placeLabel(place);

  if (q.property_type === "any") {
    // Statbel has no all-dwellings figure, and a median of two medians would be made up: give both published medians in the summary.
    const parts = (["all", "apartment"] as const).flatMap((t) => {
      const f = bestFigure(snap.figures.get(place.key + "\u0000" + t) ?? []);
      return f ? [{ key: t, description: TYPE_WORDS[t], reference_period: periodLabel(f.period), median: f.p50, transactions: f.n, p25: f.p25, p75: f.p75 }] : [];
    });
    const said = parts.length
      ? `In ${label}: ` + parts.map((x) => `${x.description}, median ${fmtMoney(x.median, "EUR")} (${x.transactions} transactions, ${x.reference_period})`).join("; ") + "."
      : `Statbel has no published house or apartment price for ${label} in the latest period.`;
    return {
      ...noMatch(q, label, `Statbel publishes no single price for houses and apartments together, only separate figures. ${said} Ask again with property_type 'house' or 'apartment' for the full answer.`),
      extra: { by_type: parts },
    };
  }

  // Pick the Statbel type: the first of the preferred ones that has a figure for this place.
  const order = TYPE_ORDER[q.property_type];
  let typeKey: string | null = null;
  let fig: Figure | null = null;
  for (const t of order) {
    const f = bestFigure(snap.figures.get(place.key + "\u0000" + t) ?? []);
    if (f) {
      typeKey = t;
      fig = f;
      break;
    }
  }
  if (!fig || !typeKey) {
    const kinds = ["all", "house-closed", "house-open", "apartment", "villa"].filter((t) => snap.figures.has(place.key + "\u0000" + t));
    const asked = TYPE_WORDS[order.find((t) => t !== "villa") ?? order[0]] ?? q.property_type;
    const hint = kinds.length ? ` Statbel does publish ${kinds.map((t) => TYPE_WORDS[t]).join("; ")} for ${label}.` : "";
    return noMatch(q, label, `Statbel publishes no price for ${asked} in ${label} for the latest quarter, half-year or year (Statbel leaves the quartiles blank for cells with few transactions).${hint}`);
  }

  const others = (snap.figures.get(place.key + "\u0000" + typeKey) ?? []).filter((f) => periodId(f.period) !== periodId(fig!.period));
  const compare = (placeFor: Place | undefined) => {
    if (!placeFor || placeFor.key === place.key) return null;
    const f = (snap.figures.get(placeFor.key + "\u0000" + typeKey) ?? []).find((x) => periodId(x.period) === periodId(fig!.period));
    return f ? { place: placeLabel(placeFor), level: LEVEL_NAME[placeFor.level], median: f.p50, transactions: f.n, difference_percent: roundTo(((fig!.p50 - f.p50) / f.p50) * 100, 1) } : null;
  };
  const regionPlace = snap.places.find((p) => p.level === 2 && regionOfRefnis(place.refnis) === regionOfRefnis(p.refnis));
  const region = place.level >= 3 ? compare(regionPlace) : null;
  const belgium = place.level > 1 ? compare(snap.places.find((p) => p.level === 1)) : null;

  const p = fig.period;
  const notes: string[] = [];
  if (p.kind !== "Q") {
    const thinQuarter = (snap.figures.get(place.key + "\u0000" + typeKey) ?? []).find((f) => f.period.kind === "Q" && periodEnd(f.period) === periodEnd(p));
    notes.push(
      thinQuarter
        ? `Statbel's quarterly figure rests on only ${thinQuarter.n} transactions, so this is the steadier figure for ${periodWords(p)}.`
        : `Statbel has no quarterly figure for ${label} (${TYPE_WORDS[typeKey]}) in the latest quarter, so this is the figure for ${periodWords(p)}.`,
    );
  }
  const now = q.now ?? new Date();
  if (Date.parse(periodEnd(p) + "T00:00:00Z") < now.getTime() - 400 * 86400000) notes.push(`This figure is for ${periodWords(p)}, more than a year old: Statbel has no newer figure for this place and type.`);
  if (typeKey === "house-closed" && q.property_type === "house") notes.push("Statbel's all-houses figure is not available for this place; this is the figure for houses with 2 or 3 facades.");
  if (typeKey === "house-open" && q.property_type === "villa") notes.push("Statbel has no separate villa category; this is its figure for houses with 4 or more facades (open construction, which includes villas and other detached houses).");
  if (typeKey === "house-closed" && (q.property_type === "terraced" || q.property_type === "semi-detached")) notes.push("Statbel combines terraced and semi-detached houses (2 or 3 facades) in one figure.");
  if (periodEnd(p) === snap.date) notes.push("Statbel treats the data for the latest quarter as provisional and revises it in its next publication.");

  const typeWords = TYPE_WORDS[typeKey];
  const extra: Record<string, unknown> = {
    region: { code: place.refnis, name: label, level: LEVEL_NAME[place.level] },
    property_type_published: { key: typeKey, description: typeWords },
    transactions: fig.n,
    interquartile_range: { p25: fig.p25, p75: fig.p75, note: "Statbel publishes the 25th and 75th percentile; this is not a 10th-90th range." },
    reference_period_label: periodLabel(p),
    region_comparison: region,
    belgium_comparison: belgium,
    other_periods: others
      .sort((a, b) => periodEnd(b.period).localeCompare(periodEnd(a.period)))
      .map((f) => ({ reference_period: periodLabel(f.period), median: f.p50, transactions: f.n, p25: f.p25, p75: f.p75 })),
    collected: snap.date,
    dataset: { url: FILE_URL, page: THEME_URL },
  };
  const out = buildStatisticAnswer({
    source: INFO,
    query: { country: "BE", town: label, property_type: q.property_type },
    value: fig.p50,
    measure: "median",
    currency: "EUR",
    unit: "per home",
    period: { from: periodStart(p), to: periodEnd(p) },
    reference_period: periodLabel(p),
    sample_size: fig.n,
    method: METHOD,
    baseUrl: q.baseUrl,
    note: notes.length ? notes.join(" ") : undefined,
    describe: (v) =>
      `In ${label} the median sale price of ${typeWords} was ${fmtMoney(v, "EUR")} in ${periodWords(p)}, from ${fig!.n.toLocaleString("en-GB")} transactions; ` +
      `half of the sales were between ${fmtMoney(fig!.p25, "EUR")} and ${fmtMoney(fig!.p75, "EUR")} (25th to 75th percentile).` +
      (belgium ? ` The Belgian median for the same period was ${fmtMoney(belgium.median, "EUR")} (${Math.abs(belgium.difference_percent)}% ${belgium.difference_percent >= 0 ? "above" : "below"}).` : ""),
    extra,
  });
  return { ...out, confidence: confidenceLabel(fig.n) };
}

/** Region of a refnis code: 1 Flanders, 2 Brussels, 3 Wallonia (provinces and municipalities by their leading digits; 0 for Belgium). */
export function regionOfRefnis(refnis: string): number {
  if (refnis === "01000") return 0;
  if (refnis === "02000") return 1;
  if (refnis === "03000") return 3;
  if (refnis === "04000") return 2;
  const d = refnis[0];
  const dd = refnis.slice(0, 2);
  if (dd === "21") return 2;
  if (d === "1" || d === "3" || d === "4" || d === "7" || dd === "23" || dd === "24" || refnis === "20001") return 1;
  return 3; // 25 (Walloon Brabant), 5, 6, 8, 9
}

export async function beHomePrices(
  input: { town?: string; postcode?: string; property_type?: string; baseUrl?: string },
  o: { snapshot?: Snapshot | null; now?: Date } = {},
): Promise<PriceAnswer> {
  const type = (input.property_type ?? "any").trim().toLowerCase() || "any";
  if (!(TYPE_ASK as readonly string[]).includes(type)) {
    throw new InputError(`property_type must be one of: ${TYPE_ASK.join(", ")}`);
  }
  if (input.postcode && !input.town) {
    throw new InputError("Statbel publishes Belgian home prices by municipality, province and region, not by postcode. Give the municipality as town, or omit it for Belgium.");
  }
  const snap = o.snapshot !== undefined ? o.snapshot : loadSnapshot();
  if (!snap) throw new SourceError("ProofPrice collects Statbel's real-estate prices daily; data appears after the next collection.");
  return beAnswer(snap, { town: input.town ?? null, property_type: type as AskType, baseUrl: input.baseUrl, now: o.now });
}
