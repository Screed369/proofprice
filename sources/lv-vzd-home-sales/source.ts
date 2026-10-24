// Latvia home sales from VZD (Valsts zemes dienests, the State Land Service): "Nekustama ipasuma tirgus statistika", the monthly
// statistics built from the Real Estate Market Database of registered deals. For every town and rural parish (pagasts) and each
// kind of dwelling VZD publishes the number of deals used, minimum, maximum, mean, trimmed means, mode and MEDIAN price in EUR
// (a price per apartment, not per m2), for the two latest full years / half-years / quarters.
// Dataset page: https://data.gov.lv/dati/lv/dataset/tirgus-statistika (CKAN, CC BY 4.0). One small CSV per room count
// (about 60 KB), read per request through a six-hour in-memory cache. Format checked live on 2026-10-24 (see source.test.ts).

import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import type { SourceInfo } from "../../lib/plugin";

export const PAGE_URL = "https://data.gov.lv/dati/lv/dataset/tirgus-statistika";
export const BASE = "https://data.gov.lv/dati/lv/dataset/tirgus-statistika/resource";
/** Yearly CSV resources for 1, 2, 3 and 4-room apartments (resource ids from the CKAN package_show, 2026-10-24). */
export const RESOURCES: Record<number, { id: string; file: string }> = {
  1: { id: "9ee6b0d5-53e8-4afa-b564-95cf2d730485", file: "publish_statistika_dzivokli_1_gads.csv" },
  2: { id: "f229e18f-ca13-4863-b000-7526b0d922f5", file: "publish_statistika_dzivokli_2_gads.csv" },
  3: { id: "7e442c8b-7d3d-4557-969d-4ade896c015f", file: "publish_statistika_dzivokli_3_gads.csv" },
  4: { id: "add5981a-7d99-45ad-be4b-b0d94d31f3c4", file: "publish_statistika_dzivokli_4_gads.csv" },
};
export const csvUrl = (rooms: number): string => `${BASE}/${RESOURCES[rooms].id}/download/${RESOURCES[rooms].file}`;
export const MIN_SALES = 5;

export const INFO: SourceInfo = {
  id: "lv-vzd-home-sales",
  country: "LV (Latvia)",
  category: "home sales (apartments, official statistics of registered deals)",
  name: "VZD Real Estate Market Statistics: apartment sale prices by town and parish",
  publisher: "Valsts zemes dienests (VZD, the State Land Service of Latvia)",
  what_is_recorded:
    "For each town, rural parish (pagasts) and Riga, and for 1, 2, 3 and 4-room apartments: the number of registered deals VZD used and the median price in EUR per apartment, " +
    "for the two latest full calendar years. Built by VZD from its Real Estate Market Database of registered deals; only the statistics are published, never single deals or addresses. " +
    "VZD leaves a place out when fewer than 3 deals stand behind it; we show a figure only from 5 deals.",
  price_type: "official_statistic",
  freshness: "Refreshed monthly by VZD; yearly files switch to the new year on 1 February, so the newest year is the previous calendar year",
  licence: "Creative Commons Attribution 4.0 International (CC BY 4.0), as stated in the data.gov.lv catalogue record of the dataset (license_id CC-BY-4.0), publisher Valsts zemes dienests.",
  licence_url: "https://creativecommons.org/licenses/by/4.0/",
  attribution: "Source: Valsts zemes dienests (State Land Service of Latvia), Real Estate Market Statistics, via data.gov.lv. Licence CC BY 4.0. Selected figures reorganised by ProofPrice; not an endorsement by VZD.",
  homepage: PAGE_URL,
  limits:
    "Apartments only (houses and land are published in other VZD files not used here). A median price per apartment in EUR, not per m2, and a calendar year, so the newest figure is 1 to 13 months old. " +
    "Places with fewer than 5 deals (VZD itself hides under 3) get no figure. The data are prepared automatically without manual checking of deals (VZD notice); extreme records can sit behind the minimum and maximum.",
};

// ---------- the table (pure) ----------

export interface Stat {
  n: number;
  min: number | null;
  max: number | null;
  mean: number | null;
  median: number | null;
}
export interface Row {
  municipality: string; // "Aizkraukles novads", or "Rīga"
  place: string; // "Aizkraukle", "Bebru pagasts", "novada pilsētu teritorijas kopā", "Rīga kopā"
  byYear: Record<number, Stat>;
}
export interface LvTable {
  rooms: number;
  rows: Row[];
  years: number[];
}

export function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Split one CSV line with double-quoted fields. */
export function splitLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

const num = (s: string | undefined): number | null => {
  if (s === undefined || s.trim() === "") return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
};

export function parseCsv(text: string, rooms: number): LvTable {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (!lines.length) throw new SourceError("VZD's price table is empty", PAGE_URL);
  const head = splitLine(lines[0]);
  if (head[0] !== "Novads" || head[1] !== "Teritorija") throw new SourceError("VZD's price table has changed shape (no Novads/Teritorija header)", PAGE_URL);
  // columns look like 2_istabu_dzivokli_Mediana_2025 : statistic name between the prefix and the year
  const col: Record<string, Record<number, number>> = {};
  const years = new Set<number>();
  head.forEach((h, i) => {
    const m = /_(Izmantotais_dar_sk|Minimala_vert|Maksimala_vert|Videja_vert|Mediana)_(\d{4})$/.exec(h);
    if (!m) return;
    (col[m[1]] ??= {})[Number(m[2])] = i;
    years.add(Number(m[2]));
  });
  for (const k of ["Izmantotais_dar_sk", "Mediana"]) if (!col[k]) throw new SourceError(`VZD's price table has changed shape (no ${k} columns)`, PAGE_URL);
  const rows: Row[] = [];
  for (const line of lines.slice(1)) {
    const c = splitLine(line);
    if (c.length < head.length - 2 || !c[0] || !c[1]) continue; // a cut-off last line
    const byYear: Record<number, Stat> = {};
    for (const y of years) {
      const n = num(c[col.Izmantotais_dar_sk?.[y]]);
      const median = num(c[col.Mediana?.[y]]);
      if (n === null || median === null) continue;
      byYear[y] = { n, min: num(c[col.Minimala_vert?.[y]]), max: num(c[col.Maksimala_vert?.[y]]), mean: num(c[col.Videja_vert?.[y]]), median };
    }
    rows.push({ municipality: c[0], place: c[1], byYear });
  }
  if (!rows.length) throw new SourceError("VZD's price table has changed shape (no rows found)", PAGE_URL);
  return { rooms, rows, years: [...years].sort((a, b) => a - b) };
}

// ---------- the question ----------

export interface Query {
  town: string | null;
  property_type: string | null;
  rooms: number | null;
  baseUrl?: string;
}

const isTotalRow = (r: Row): boolean => /kopa/.test(fold(r.place));
const isUrbanTotal = (r: Row): boolean => /pilsetu teritorijas kopa/.test(fold(r.place));
const isRuralTotal = (r: Row): boolean => /pagastu teritorijas kopa/.test(fold(r.place));

/** The wanted place in one table: a town or parish (exact), Riga, or the town total of a municipality ("Valmieras novads"). */
export function findPlace(rows: Row[], town: string): { row: Row; label: string; kind: "place" | "municipality" } | null {
  let f = fold(town).replace(/\b(latvia|latvija|lv)$/, "").trim();
  if (!f) return null;
  if (f === "riga") return { row: rows.find((r) => fold(r.municipality) === "riga")!, label: "Riga", kind: "place" };
  const exact = rows.filter((r) => !isTotalRow(r) && fold(r.place) === f);
  const hit = exact.find((r) => !/pagasts|novads/.test(fold(r.place))) ?? exact[0];
  if (hit) return { row: hit, label: `${hit.place} (${hit.municipality})`, kind: "place" };
  // "<name> parish" / "<name> pagasts" -> "<Name>s pagasts" style names: match by startsWith on the folded base
  const withoutParish = f.replace(/\b(parish|pagasts)\b/, "").trim();
  if (withoutParish !== f && withoutParish.length >= 3) {
    const p = rows.filter((r) => !isTotalRow(r) && /pagasts/.test(fold(r.place)) && fold(r.place).startsWith(withoutParish));
    if (p.length === 1) return { row: p[0], label: `${p[0].place} (${p[0].municipality})`, kind: "place" };
  }
  const muni = rows.filter((r) => isUrbanTotal(r) && (fold(r.municipality) === f || fold(r.municipality) === `${f} novads`));
  if (muni.length) return { row: muni[0], label: `towns of ${muni[0].municipality}`, kind: "municipality" };
  return null;
}

function latestYear(row: Row): number | null {
  const ys = Object.keys(row.byYear).map(Number).filter((y) => row.byYear[y].n >= MIN_SALES);
  return ys.length ? Math.max(...ys) : null;
}

export const METHOD =
  "Latvia: the median price in EUR per apartment (not per m2) of the deals VZD (State Land Service) registered in its Real Estate Market Database, for one town, parish or Riga and one room count, for the latest full calendar year VZD publishes. " +
  "We pass on VZD's published median and deal count, the previous year's median, and the other room counts; a place with fewer than 5 deals gets no figure.";

function noMatch(q: Query, summary: string, extra: Record<string, unknown> = {}): PriceAnswer {
  return {
    ...buildStatisticAnswer({
      source: INFO, query: { country: "LV", town: q.town, rooms: q.rooms }, value: null, measure: "median", currency: "EUR", unit: "per apartment",
      period: { from: null, to: null }, reference_period: "", method: METHOD, baseUrl: q.baseUrl, describe: () => "",
    }),
    summary,
    extra,
  };
}

export function parseRooms(rooms: number | null, propertyType: string | null): number | null {
  if (rooms !== null && rooms !== undefined) {
    if (!Number.isInteger(rooms) || rooms < 1 || rooms > 4) throw new InputError("rooms must be 1, 2, 3 or 4 (VZD publishes apartments by room count)");
    return rooms;
  }
  const t = (propertyType ?? "").trim().toLowerCase();
  const m = /^([1-4])[\s-]*(room|rooms|bed)?$/.exec(t);
  return m ? Number(m[1]) : null;
}

export function lvAnswer(tables: LvTable[], q: Query): PriceAnswer {
  const t = (q.property_type ?? "").trim().toLowerCase();
  if (t && !["any", "flat", "flats", "apartment", "apartments", "1", "2", "3", "4"].includes(t) && !/^[1-4][\s-]*(room|rooms|bed)?$/.test(t)) {
    throw new InputError("property_type: Latvia has apartments only ('flat', 'apartment' or 'any'); choose the size with rooms=1, 2, 3 or 4");
  }
  if (!q.town) throw new InputError("town is required for Latvia (a town, a rural parish such as 'Bebru pagasts', or Riga)");
  const wanted = parseRooms(q.rooms, q.property_type);
  const found = tables.map((tb) => ({ tb, hit: findPlace(tb.rows, q.town!) }));
  if (!found.some((f) => f.hit)) {
    return noMatch(q, `VZD publishes apartment prices by town and rural parish and for Riga, not for '${q.town}'. Try the town name (for example Riga, Jurmala, Liepaja, Daugavpils, Valmiera) or a municipality such as 'Valmieras novads'.`);
  }
  // figures per room count for the latest year with >= 5 deals
  const per: { rooms: number; year: number; stat: Stat; prev: Stat | null; label: string; kind: string }[] = [];
  for (const { tb, hit } of found) {
    if (!hit) continue;
    const y = latestYear(hit.row);
    if (y === null) continue;
    const prevStat = hit.row.byYear[y - 1];
    per.push({ rooms: tb.rooms, year: y, stat: hit.row.byYear[y], prev: prevStat && prevStat.n >= MIN_SALES ? prevStat : null, label: hit.label, kind: hit.kind });
  }
  const label = found.find((f) => f.hit)!.hit!.label;
  if (!per.length) {
    return noMatch(q, `VZD has fewer than ${MIN_SALES} registered apartment deals in ${label} in the latest two years, so ProofPrice shows no figure. Try the municipality (for example 'Valmieras novads') or a bigger town nearby.`);
  }
  let pick = wanted !== null ? per.find((p) => p.rooms === wanted) : undefined;
  if (wanted !== null && !pick) {
    return noMatch(q, `VZD has fewer than ${MIN_SALES} registered ${wanted}-room apartment deals in ${label}; other room counts: ${per.map((p) => `${p.rooms}-room ${fmtMoney(p.stat.median!, "EUR")} (${p.stat.n} deals, ${p.year})`).join("; ")}.`, { by_rooms: per.map(rowOut) });
  }
  pick = pick ?? per.reduce((a, b) => (b.stat.n > a.stat.n ? b : a));
  const st = pick.stat;
  const change = pick.prev && pick.prev.median ? Math.round(((st.median! - pick.prev.median) / pick.prev.median) * 1000) / 10 : null;
  const notes: string[] = [];
  if (wanted === null) notes.push(`No room count was given, so the figure is for ${pick.rooms}-room apartments, the size with the most deals in ${label}; other sizes are in extra.by_rooms.`);
  const newest = Math.max(...found.flatMap((f) => (f.hit ? Object.keys(f.hit.row.byYear).map(Number) : [0])));
  if (pick.year < newest) notes.push(`VZD's ${newest} figure rests on fewer than ${MIN_SALES} deals, so the newest usable year is ${pick.year}.`);
  notes.push("Median price per apartment in EUR (not per m2), from VZD's registered deals; extreme records are not removed.");
  const range = st.min !== null && st.max !== null ? `${fmtMoney(st.min, "EUR")} to ${fmtMoney(st.max, "EUR")}` : null;
  return buildStatisticAnswer({
    source: INFO,
    query: { country: "LV", town: q.town, rooms: pick.rooms, property_type: "flat" },
    value: st.median,
    measure: "median",
    currency: "EUR",
    unit: "per apartment",
    period: { from: `${pick.year}-01-01`, to: `${pick.year}-12-31` },
    reference_period: String(pick.year),
    sample_size: st.n,
    method: METHOD,
    note: notes.join(" "),
    baseUrl: q.baseUrl,
    describe: (v) =>
      `In ${label} the median price paid for a ${pick!.rooms}-room apartment was ${fmtMoney(v, "EUR")} in ${pick!.year}, from ${st.n} registered deals (VZD, State Land Service).` +
      (change !== null ? ` That is ${Math.abs(change)}% ${change >= 0 ? "above" : "below"} ${pick!.year - 1} (${fmtMoney(pick!.prev!.median!, "EUR")}).` : "") +
      (range ? ` Single deals ran from ${range}.` : ""),
    extra: {
      place: { name: label, kind: pick.kind },
      rooms: pick.rooms,
      mean: st.mean,
      lowest_deal: st.min,
      highest_deal: st.max,
      previous_year: pick.prev ? { reference_period: String(pick.year - 1), median: pick.prev.median, deals: pick.prev.n, change_percent: change } : null,
      by_rooms: per.map(rowOut),
      definition: "Median price in EUR per apartment from VZD's Real Estate Market Database of registered deals; a calendar year.",
      dataset: { page: PAGE_URL, csv: csvUrl(pick.rooms) },
    },
  });
}

function rowOut(p: { rooms: number; year: number; stat: Stat }) {
  return { rooms: p.rooms, reference_period: String(p.year), median: p.stat.median, deals: p.stat.n };
}

// ---------- fetching ----------

const UA = "ProofPrice/1.0 (+https://proofprice.com; hello@proofprice.com)";
export type CsvFetcher = (rooms: number) => Promise<string>;

export async function downloadCsv(rooms: number): Promise<string> {
  const url = csvUrl(rooms);
  try {
    const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(25_000) });
    if (!res.ok) throw new SourceError(`Source returned HTTP ${res.status}`, url, res.status);
    return await res.text();
  } catch (err: any) {
    if (err instanceof SourceError) throw err;
    if (err?.name === "TimeoutError" || err?.name === "AbortError") throw new SourceError("Source timed out", url);
    throw new SourceError("Could not reach the official source", String(err?.cause?.code ?? err?.message ?? err));
  }
}

export const CACHE_MS = 6 * 3600 * 1000;
const cache = new Map<number, { at: number; table: LvTable }>();
export function clearCache(): void {
  cache.clear();
}

export async function loadTable(rooms: number, o: { fetcher?: CsvFetcher; now?: number } = {}): Promise<LvTable> {
  const now = o.now ?? Date.now();
  const hit = cache.get(rooms);
  if (hit && now - hit.at < CACHE_MS) return hit.table;
  try {
    const table = parseCsv(await (o.fetcher ?? downloadCsv)(rooms), rooms);
    cache.set(rooms, { at: now, table });
    return table;
  } catch (err) {
    if (hit) return hit.table;
    throw err;
  }
}

export async function lvHomeSales(
  input: { town?: string | null; property_type?: string | null; rooms?: number | null; baseUrl?: string },
  o: { tables?: LvTable[]; fetcher?: CsvFetcher; now?: number } = {},
): Promise<PriceAnswer> {
  const rooms = parseRooms(input.rooms ?? null, input.property_type ?? null);
  const q: Query = { town: input.town ?? null, property_type: input.property_type ?? null, rooms, baseUrl: input.baseUrl };
  if (o.tables) return lvAnswer(o.tables, q);
  // validate before any network call
  if (!q.town) throw new InputError("town is required for Latvia (a town, a rural parish such as 'Bebru pagasts', or Riga)");
  const sizes = rooms !== null ? [rooms] : [1, 2, 3, 4];
  const tables = await Promise.all(sizes.map((r) => loadTable(r, { fetcher: o.fetcher, now: o.now })));
  return lvAnswer(tables, q);
}
