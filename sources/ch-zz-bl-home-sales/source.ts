// Switzerland (canton Basel-Landschaft): AVERAGE sale price of condominiums (Eigentumswohnungen) by district, number of rooms and year,
// Statistisches Amt Basel-Landschaft, dataset 10210 on data.bl.ch (opendata.swiss, terms "by": open use, commercial use allowed, source required).
// Format checked 2026-11-10 (GitHub probe): CSV, semicolon, CRLF, ASCII, 411 lines, 15 KB, header
// Jahr;Bezirk_Nummer;Bezirk;Zimmerzahl;Verkaufspreis_CHF. Years 2011-2025, 5 districts, rooms 1,2,3,4,5+,Total. A suppressed cell is "( )".
// No sale counts are published, so the figure is an official average with no sample size (NO_COUNT in the library).
import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { NO_COUNT } from "../../lib/stats";

export const CSV_URL = "https://data.bl.ch/api/v2/catalog/datasets/10210/exports/csv?use_labels=true";
export const DATASET_URL = "https://data.bl.ch/explore/dataset/10210/";

export const INFO: SourceInfo = {
  id: "ch-zz-bl-home-sales",
  country: "CH (canton Basel-Landschaft)",
  category: "home sales (average condominium sale price, canton Basel-Landschaft)",
  name: "Average sale price of condominiums by district, rooms and year (Kanton Basel-Landschaft)",
  publisher: "Kanton Basel-Landschaft, Statistisches Amt (Open Data Basel-Landschaft)",
  what_is_recorded:
    "For each of the five districts (Bezirke) of the canton Basel-Landschaft and for the whole canton's districts together as published: the average sale price in CHF of condominiums sold in a year, " +
    "by number of rooms (1, 2, 3, 4, 5 or more, and all flats). One published figure per district, room count and year; never individual sales or addresses.",
  price_type: "official_statistic",
  freshness: "Yearly; the latest year published is 2025. Each answer states its year.",
  licence: "opendata.swiss terms of use, class 'by': open use, commercial use allowed, the source (author, title, link to the dataset) must be given.",
  licence_url: "https://opendata.swiss/terms-of-use#terms_by",
  attribution:
    "Source: Kanton Basel-Landschaft, Durchschnittlicher Verkaufspreis von Eigentumswohnungen nach Zimmerzahl, Bezirk und Jahr (seit 2011), https://data.bl.ch/explore/dataset/10210/ (opendata.swiss, terms by).",
  homepage: DATASET_URL,
  limits:
    "Condominiums in the five districts of Basel-Landschaft only (no town or village figures, no houses, nothing for Basel-Stadt). An average, not a median: no 10th-90th percentile range and no number of sales are published. " +
    "Cells the publisher suppresses (small numbers) are not answered. Yearly, so up to a year behind.",
};

export interface Row { year: number; code: string; district: string; rooms: string; price: number }

export function parseCsv(text: string): { rows: Row[]; districts: Map<string, string> } {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  const head = (lines.shift() ?? "").split(";").map((h) => h.trim());
  const ix = (n: string) => head.indexOf(n);
  const [iy, ic, id, ir, ip] = ["Jahr", "Bezirk_Nummer", "Bezirk", "Zimmerzahl", "Verkaufspreis_CHF"].map(ix);
  if ([iy, ic, id, ir, ip].some((i) => i < 0)) throw new SourceError("Basel-Landschaft file has changed: expected columns Jahr;Bezirk_Nummer;Bezirk;Zimmerzahl;Verkaufspreis_CHF");
  const rows: Row[] = [];
  const districts = new Map<string, string>();
  for (const line of lines) {
    const c = line.split(";").map((x) => x.trim());
    const code = c[ic];
    const district = (c[id] ?? "").replace(/^Bezirk\s+/i, "");
    if (!code || !district) continue;
    districts.set(code, district);
    const year = /^\d{4}$/.test(c[iy] ?? "") ? Number(c[iy]) : null;
    const price = /^\d+(\.\d+)?$/.test(c[ip] ?? "") ? Number(c[ip]) : null; // "( )" = suppressed
    if (year === null || price === null || price <= 0) continue;
    rows.push({ year, code, district, rooms: c[ir], price });
  }
  if (rows.length === 0) throw new SourceError("Basel-Landschaft file holds no publishable prices");
  return { rows, districts };
}

export function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Words that mean the district list of the canton as a whole. */
const CANTON_WORDS = ["basel landschaft", "baselland", "basel land", "bl", "kanton basel landschaft", "canton basel landschaft", "baselbiet"];

/** "Liestal", "Bezirk Arlesheim", "1301" -> district code. Municipalities are not in the table; the common ones map to their district. */
const PLACE_TO_DISTRICT: Record<string, string> = {
  muttenz: "1301", pratteln: "1301", birsfelden: "1301", reinach: "1301", allschwil: "1301", binningen: "1301", munchenstein: "1301", bottmingen: "1301", oberwil: "1301", aesch: "1301", "arlesheim": "1301",
  laufen: "1302", liestal: "1303", sissach: "1304", waldenburg: "1305",
};

export function resolveDistrict(town: string | undefined, districts: Map<string, string>): { code: string; name: string; viaPlace: string | null } | null {
  const raw = (town ?? "").trim();
  const key = fold(raw).replace(/^(bezirk|district)\s+/, "");
  if (key === "" || CANTON_WORDS.includes(fold(raw))) return null;
  for (const [code, name] of districts) if (code === key || fold(name) === key) return { code, name, viaPlace: null };
  const via = PLACE_TO_DISTRICT[key];
  if (via && districts.has(via)) return { code: via, name: districts.get(via)!, viaPlace: raw };
  throw new InputError(
    `No Basel-Landschaft district called "${raw}". Use one of the five districts: ${[...districts.values()].join(", ")}. Town and village figures are not published.`,
  );
}

export function normaliseType(raw?: string): "flat" {
  const s = fold(raw ?? "");
  if (["", "any", "flat", "flats", "apartment", "apartments", "condo", "condominium", "eigentumswohnung", "wohnung"].includes(s)) return "flat";
  throw new InputError(`property_type for Basel-Landschaft must be flat (a condominium) or left out; houses are not in this table. Not available: ${String(raw)}.`);
}

export function normaliseRooms(raw?: string | number): string {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "" || s === "total" || s === "all" || s === "any") return "Total";
  const m = s.match(/^([1-5])\s*(\+|or more|plus)?(\s*rooms?|\s*zimmer)?$/);
  if (m) return m[1] === "5" ? "5+" : m[1];
  throw new InputError(`rooms must be 1, 2, 3, 4, 5 (meaning 5 or more) or left out for all condominiums. Not available: ${String(raw)}.`);
}

export const METHOD =
  "The Statistisches Amt Basel-Landschaft publishes, for each year, the average sale price of condominiums by district and number of rooms. ProofPrice returns the newest year in which the district " +
  "has a published figure, unchanged, with the year before. The publisher gives no number of sales and no percentile range, so none is shown. Changes are calculated by ProofPrice from two published averages.";

const pct = (a: number, b: number) => Math.round(((a - b) / b) * 1000) / 10;
export interface AnswerInput { town?: string; property_type?: string; rooms?: string | number; baseUrl?: string }

export function blAnswer(csv: string, q: AnswerInput): PriceAnswer {
  normaliseType(q.property_type);
  const rooms = normaliseRooms(q.rooms);
  const { rows, districts } = parseCsv(csv);
  const d = resolveDistrict(q.town, districts);
  const roomLabel = rooms === "Total" ? "all condominiums" : rooms === "5+" ? "condominiums with 5 or more rooms" : `${rooms}-room condominiums`;
  const base = { source: INFO, measure: "average" as const, currency: "CHF", unit: "per flat", method: METHOD, baseUrl: q.baseUrl };
  if (!d) {
    const latest = rows.filter((r) => r.rooms === rooms).reduce((m, r) => Math.max(m, r.year), 0);
    const list = [...districts].map(([code, name]) => ({ code, name, r: rows.find((r) => r.code === code && r.rooms === rooms && r.year === latest) })).filter((x) => x.r);
    const query = { country: "CH", town: "Basel-Landschaft", property_type: "flat", rooms };
    if (list.length === 0) {
      const none = buildStatisticAnswer({ ...base, query, value: null, period: { from: null, to: null }, reference_period: "", describe: () => "" });
      return { ...none, summary: `Kanton Basel-Landschaft publishes no average price for ${roomLabel}. Try rooms left out.` };
    }
    // No canton-wide figure is published and districts cannot be averaged without sale counts: answer with the district range.
    const prices = list.map((x) => x.r!.price);
    const lo = Math.min(...prices), hi = Math.max(...prices);
    const none = buildStatisticAnswer({ ...base, query, value: null, period: { from: `${latest}-01-01`, to: `${latest}-12-31` }, reference_period: String(latest), describe: () => "" });
    return {
      ...none,
      summary:
        `Kanton Basel-Landschaft publishes no canton-wide average, only one per district. For ${roomLabel} in ${latest} the district averages run from ${fmtMoney(lo, "CHF")} to ${fmtMoney(hi, "CHF")}: ` +
        list.map((x) => `${x.name} ${fmtMoney(x.r!.price, "CHF")}`).join("; ") + ". Ask again with town set to one district (for example Arlesheim or Liestal) for a full answer.",
      extra: { districts: list.map((x) => ({ district: x.name, average_chf: x.r!.price, year: latest })) },
    };
  }
  const mine = rows.filter((r) => r.code === d.code && r.rooms === rooms).sort((a, b) => b.year - a.year);
  const query = { country: "CH", town: d.name, property_type: "flat", rooms };
  const latestYear = rows.reduce((m, r) => Math.max(m, r.year), 0);
  const newest = mine[0];
  if (!newest || newest.year < latestYear - 4) {
    const none = buildStatisticAnswer({ ...base, query, value: null, period: { from: null, to: null }, reference_period: "", describe: () => "" });
    return { ...none, summary: `Kanton Basel-Landschaft publishes no average price for ${roomLabel} in the district of ${d.name} in the last five years (small numbers are suppressed). Try rooms left out.` };
  }
  const prev = mine.find((r) => r.year === newest.year - 1) ?? null;
  const notes: string[] = [];
  if (d.viaPlace) notes.push(`${d.viaPlace} lies in the district of ${d.name}; the table has no town figures, so the district average is shown.`);
  if (newest.year < latestYear) notes.push(`The newest year for this district and room count is ${newest.year}; the table runs to ${latestYear}.`);
  return buildStatisticAnswer({
    ...base,
    query,
    value: newest.price,
    period: { from: `${newest.year}-01-01`, to: `${newest.year}-12-31` },
    reference_period: String(newest.year),
    sample_size: null,
    note: notes.length ? notes.join(" ") : undefined,
    extra: {
      district: d.name,
      rooms,
      previous_year: prev ? { year: prev.year, average_chf: prev.price, change_percent: pct(newest.price, prev.price) } : null,
    },
    describe: (v) =>
      `The average sale price of ${roomLabel} in the district of ${d.name} (Basel-Landschaft) in ${newest.year} was ${fmtMoney(v, "CHF")}.` +
      `${prev ? ` That is ${Math.abs(pct(v, prev.price))}% ${v >= prev.price ? "higher" : "lower"} than the average in ${prev.year}.` : ""}`,
    ending: "Official average published by Kanton Basel-Landschaft; no number of sales and no price range are published.",
  });
}

export async function fetchCsv(timeoutMs = 20000): Promise<string> {
  let res: Response;
  try {
    res = await fetch(CSV_URL, { headers: { "user-agent": "ProofPrice/1.0 (+https://proofprice.com; hello@proofprice.com)", accept: "text/csv" }, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    throw new SourceError(`Basel-Landschaft open data did not answer: ${(e as Error).message}`);
  }
  if (!res.ok) throw new SourceError(`Basel-Landschaft open data answered HTTP ${res.status}`);
  return res.text();
}

export async function blHomeSales(q: AnswerInput & { csv?: string }): Promise<PriceAnswer> {
  return blAnswer(q.csv ?? (await fetchCsv()), q);
}

// ---- Stale-if-error copy (library) ----
/** One library row per district and room count for the newest year in the file. Item = "flat:<rooms>". */
export function blHarvestRows(csv: string): HarvestResult {
  const { rows } = parseCsv(csv);
  const latest = rows.reduce((m, r) => Math.max(m, r.year), 0);
  const out: DailyRow[] = rows
    .filter((r) => r.year === latest)
    .map((r) => ({ area: r.code, item: `flat:${r.rooms}`, n: NO_COUNT, median: r.price, low: r.price, high: r.price, min: r.price, max: r.price }));
  return {
    date: `${latest}-12-31`,
    currency: "CHF",
    unit: "per flat",
    rows: out,
    note: `Average condominium sale price ${latest}, ${out.length} district and room-count figures published by Kanton Basel-Landschaft. Published averages, no price range.`,
  };
}

export async function blHarvest(): Promise<HarvestResult> {
  return blHarvestRows(await fetchCsv(30000));
}

export function blHistoryKey(p: { town?: string; property_type?: string; rooms?: string | number }): { area: string; item: string; label: string } | null {
  try {
    normaliseType(p.property_type);
    const rooms = normaliseRooms(p.rooms);
    const key = fold(p.town ?? "").replace(/^(bezirk|district)\s+/, "");
    const code = Object.entries({ arlesheim: "1301", laufen: "1302", liestal: "1303", sissach: "1304", waldenburg: "1305" }).find(([n, c]) => n === key || c === key)?.[1] ?? PLACE_TO_DISTRICT[key];
    return code ? { area: code, item: `flat:${rooms}`, label: `Bezirk ${key}` } : null;
  } catch {
    return null;
  }
}

/** True when this source should answer: Switzerland with a Basel-Landschaft district or one of its main municipalities. */
export function servesBl(p: { country?: unknown; town?: unknown }): boolean {
  if (String(p.country ?? "").toUpperCase() !== "CH") return false;
  const raw = String(p.town ?? "");
  const key = fold(raw).replace(/^(bezirk|district)\s+/, "");
  return CANTON_WORDS.includes(fold(raw)) || ["arlesheim", "laufen", "liestal", "sissach", "waldenburg", "1301", "1302", "1303", "1304", "1305"].includes(key) || key in PLACE_TO_DISTRICT;
}
