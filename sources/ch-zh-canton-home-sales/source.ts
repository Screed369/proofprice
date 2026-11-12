// Switzerland (canton Zürich): registered sale prices of single-family houses and condominiums, Statistisches Amt Kanton Zürich
// (Handänderungsstatistik), opendata.swiss dataset "Immobilienpreise im Kanton Zürich". Formats checked live 2026-11-12 (plain GET, no key):
//  - Regions: https://daten.statistik.zh.ch/ogd/daten/ressourcen/KTZH_00003158_00006781.csv (houses) / _00006784.csv (flats), one row per year and
//    market region (Stadt Zürich, Agglomerationsgemeinden, Seegemeinden, Stadt Winterthur, Landgemeinden, Ganzer Kanton Zürich), 2011-2025:
//    "Jahr","Kantonsnr.","Kanton","region","Verkaeufe","Durchschnitt","Q10","Q25","Median","Q75","Q90","Quelle","Indikator". Numbers can be
//    written "8e+05": always Number().
//  - Municipalities: ..._00006788.json (houses) / _00006789.json (flats), 1.4 MB each: [{geoLevelNumber, geoLevelName, verkaeufe, q25, median, q75,
//    pooling (1, 3 or 5 years), ref_jahr, zeitraum}], three pooling rows per municipality and year; median/q25/q75 null when the pool is too small.
import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import type { SourceInfo } from "../../lib/plugin";
import { MIN_PUBLISH } from "../../lib/stats";
import { MUNICIPALITIES } from "./municipalities";

export const BASE = "https://daten.statistik.zh.ch/ogd/daten/ressourcen/KTZH_00003158_";
export const FILES = {
  house: { region: `${BASE}00006781.csv`, town: `${BASE}00006788.json` },
  flat: { region: `${BASE}00006784.csv`, town: `${BASE}00006789.json` },
} as const;
export type Kind = keyof typeof FILES;
export const DATASET_URL = "https://opendata.swiss/en/dataset/immobilienpreise-im-kanton-zurich";
export const ATTRIBUTION_LINE = "Source: Kanton Zürich, Statistisches Amt, 'Immobilienpreise im Kanton Zürich' (opendata.swiss, open use incl. commercial; source recommended).";

export const INFO: SourceInfo = {
  id: "ch-zh-canton-home-sales",
  country: "CH (canton Zürich)",
  category: "home sales (registered sale prices of houses and condominiums, canton Zürich)",
  name: "Sale prices of single-family houses and condominiums by market region and municipality (Statistisches Amt Kanton Zürich)",
  publisher: "Kanton Zürich, Direktion der Justiz und des Innern, Statistisches Amt (Handänderungsstatistik)",
  what_is_recorded:
    "From the registered property transfers of canton Zürich: for each year and market region (city of Zürich, city of Winterthur, lakeside, agglomeration and rural municipalities, whole canton) the number of sales of single-family houses or condominiums, " +
    "the mean, the 10th, 25th, 50th, 75th and 90th percentile of the sale price; and for each of the 160 municipalities the 25th, 50th and 75th percentile pooled over up to five years. Published aggregates only, never single sales or addresses.",
  price_type: "transaction",
  freshness: "Yearly; the newest year is 2025 (dataset modified 4 May 2026). The last three years are provisional. Each answer states its year.",
  licence: "opendata.swiss 'terms_open': open use, commercial use allowed, source recommended.",
  licence_url: "https://opendata.swiss/en/terms-of-use#terms_open",
  attribution: ATTRIBUTION_LINE,
  homepage: DATASET_URL,
  limits:
    "Single-family houses (Einfamilienhäuser) and freehold condominiums (Eigentumswohnungen) in canton Zürich only, not land, not other cantons. Yearly, so up to a year behind; the publisher flags the last three years as provisional. " +
    "Municipality figures pool up to five years and are left out by the publisher when too few sales (fewer than 15) are behind them. No filter by size or age of the home.",
};

// ---------- parsing ----------

export interface RegionRow { year: number; region: string; sales: number; mean: number | null; q10: number; q25: number | null; median: number; q75: number | null; q90: number }

const toNum = (s: unknown): number | null => {
  if (s === null || s === undefined || String(s).trim() === "") return null;
  const n = Number(String(s).trim());
  return Number.isFinite(n) ? n : null;
};

/** One CSV line into fields, honouring double quotes ("Kanton Zürich, Stand 2025 / Q4" holds a comma). */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { out.push(cur); cur = ""; } else cur += c;
  }
  out.push(cur);
  return out;
}

/** Pure: the region rows with a whole-franc year, at least 5 sales and numeric median, Q10 and Q90. Throws when the header is not the one we know. */
export function parseRegionCsv(text: string): RegionRow[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  const head = lines.length ? splitCsvLine(lines[0]) : [];
  const col = (n: string) => head.indexOf(n);
  const ix = { y: col("Jahr"), r: col("region"), n: col("Verkaeufe"), mean: col("Durchschnitt"), q10: col("Q10"), q25: col("Q25"), m: col("Median"), q75: col("Q75"), q90: col("Q90") };
  if (Object.values(ix).some((v) => v < 0)) throw new SourceError("Statistisches Amt Kanton Zürich changed its price file (columns not as expected); this source needs updating.");
  const rows: RegionRow[] = [];
  for (const l of lines.slice(1)) {
    const f = splitCsvLine(l);
    const year = toNum(f[ix.y]);
    const sales = toNum(f[ix.n]);
    const median = toNum(f[ix.m]);
    const q10 = toNum(f[ix.q10]);
    const q90 = toNum(f[ix.q90]);
    if (year === null || sales === null || sales < MIN_PUBLISH || median === null || median <= 0 || q10 === null || q90 === null) continue;
    rows.push({ year, region: f[ix.r].trim(), sales, mean: toNum(f[ix.mean]), q10, q25: toNum(f[ix.q25]), median, q75: toNum(f[ix.q75]), q90 });
  }
  return rows;
}

export interface TownRow { name: string; sales: number; q25: number; median: number; q75: number; pooling: number; refYear: number; period: string }

/** Pure: municipality rows of the newest reference year that carry a median; for each municipality the shortest pooling that has one. */
export function parseTownJson(json: any): { rows: TownRow[]; latest: number } {
  if (!Array.isArray(json)) throw new SourceError("Statistisches Amt Kanton Zürich changed its municipality file (not a list); this source needs updating.");
  const latest = json.reduce((m: number, r: any) => Math.max(m, Number(r?.ref_jahr) || 0), 0);
  const best = new Map<string, TownRow>();
  for (const r of json) {
    if (Number(r?.ref_jahr) !== latest) continue;
    const median = toNum(r.median);
    const q25 = toNum(r.q25);
    const q75 = toNum(r.q75);
    const sales = toNum(r.verkaeufe);
    const pooling = toNum(r.pooling) ?? 0;
    if (median === null || q25 === null || q75 === null || sales === null || sales < MIN_PUBLISH || median <= 0) continue;
    const name = String(r.geoLevelName ?? "").trim();
    const prev = best.get(name);
    if (!prev || pooling < prev.pooling) best.set(name, { name, sales, q25, median, q75, pooling, refYear: latest, period: String(r.zeitraum ?? latest) });
  }
  return { rows: [...best.values()], latest };
}

// ---------- place matching ----------

export function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, " ").trim();
}

const REGIONS: { key: string; csv: string; words: string[] }[] = [
  { key: "canton", csv: "Ganzer Kanton Zürich", words: ["kanton zurich", "canton zurich", "canton of zurich", "kanton zuerich", "zh", "ganzer kanton zurich", "whole canton", "canton"] },
  { key: "city", csv: "Stadt Zürich", words: ["", "zurich", "zuerich", "stadt zurich", "city of zurich", "zurich city", "ch", "switzerland", "schweiz"] },
  { key: "lake", csv: "Seegemeinden", words: ["seegemeinden", "lakeside", "lakeside municipalities", "zurichsee", "lake zurich"] },
  { key: "agglo", csv: "Agglomerationsgemeinden", words: ["agglomerationsgemeinden", "agglomeration", "agglomeration municipalities"] },
  { key: "rural", csv: "Landgemeinden", words: ["landgemeinden", "rural", "rural municipalities", "countryside"] },
];
const regionFor = (key: string) => REGIONS.find((r) => r.words.includes(key));

const TOWN_FOLD = MUNICIPALITIES.map((n) => ({ name: n, key: fold(n) }));
/** Municipality named in `town`: exact folded match, else the single municipality whose name starts with it ("Affoltern" = Affoltern a.A.). */
export function matchTown(town: string | undefined): { name: string | null; near: string[] } {
  const key = fold(town ?? "");
  if (key.length < 3) return { name: null, near: [] };
  const exact = TOWN_FOLD.find((t) => t.key === key);
  if (exact) return { name: exact.name, near: [] };
  const near = TOWN_FOLD.filter((t) => t.key.startsWith(key + " ") || t.key.startsWith(key)).map((t) => t.name);
  return near.length === 1 ? { name: near[0], near } : { name: null, near: near.slice(0, 6) };
}

export function normaliseKind(raw?: string): Kind | null {
  const s = fold(raw ?? "");
  if (["house", "houses", "detached", "villa", "single family", "einfamilienhaus", "einfamilienhauser"].includes(s)) return "house";
  if (["flat", "flats", "apartment", "apartments", "condo", "condominium", "condominiums", "eigentumswohnung", "stockwerkeigentum", "wohnung"].includes(s)) return "flat";
  if (["", "any"].includes(s)) return null;
  throw new InputError(`property_type for canton Zürich must be house (single-family house) or flat (condominium); not available: ${String(raw)}.`);
}

/** serves(): true when this source should answer a CH request. The city of Zürich asked for flats stays with ch-zurich-home-sales (district detail); Basel-Landschaft stays with its own source. */
export function servesZh(p: { country?: unknown; town?: unknown; property_type?: unknown }, isBl: (p: { country?: unknown; town?: unknown }) => boolean): boolean {
  if (String(p.country ?? "").toUpperCase() !== "CH" || isBl(p)) return false;
  let kind: Kind | null = null;
  try { kind = normaliseKind(p.property_type as string | undefined); } catch { return true; }
  const key = fold(String(p.town ?? ""));
  const region = regionFor(key);
  if (region?.key === "city") return kind === "house";
  if (region) return true;
  if (key === "zurich") return kind === "house";
  if (matchTown(String(p.town ?? "")).name) return true;
  return kind === "house"; // a house anywhere else in CH: answer with the list of places we do have
}

// ---------- answers ----------

const pct = (a: number, b: number) => Math.round(((a - b) / b) * 1000) / 10;
const KIND_WORDS: Record<Kind, { one: string; many: string; unit: string }> = {
  house: { one: "single-family house", many: "single-family houses", unit: "per house" },
  flat: { one: "freehold condominium", many: "freehold condominiums", unit: "per flat" },
};
export const METHOD =
  "The Statistisches Amt of canton Zürich publishes, from the registered property transfers, the number of sales and the 10th, 25th, 50th, 75th and 90th percentile of the price of single-family houses and condominiums, by year and market region; " +
  "and, for each municipality, the 25th, 50th and 75th percentile pooled over up to five years. ProofPrice returns the published median of the newest year (or newest pool), unchanged, with the published range. No figure rests on fewer than 5 sales. The last three years are provisional.";

export function regionAnswer(rows: RegionRow[], kind: Kind, regionCsv: string, asked: string, baseUrl?: string): PriceAnswer {
  const mine = rows.filter((r) => r.region === regionCsv).sort((a, b) => b.year - a.year);
  const latestYear = rows.reduce((m, r) => Math.max(m, r.year), 0);
  const newest = mine[0];
  const w = KIND_WORDS[kind];
  const query = { country: "CH", town: asked || regionCsv, property_type: kind };
  const base = { source: INFO, query, measure: "median" as const, currency: "CHF", unit: w.unit, method: METHOD, baseUrl };
  if (!newest || newest.year < latestYear - 2) {
    const none = buildStatisticAnswer({ ...base, value: null, period: { from: null, to: null }, reference_period: "", describe: () => "" });
    return { ...none, summary: `Statistisches Amt Kanton Zürich publishes no ${w.one} price for ${regionCsv} with at least ${MIN_PUBLISH} sales in the last three years.` };
  }
  const prev = mine.find((r) => r.year === newest.year - 1) ?? null;
  const canton = regionCsv !== "Ganzer Kanton Zürich" ? rows.find((r) => r.region === "Ganzer Kanton Zürich" && r.year === newest.year) ?? null : null;
  const notes = [newest.year >= latestYear - 2 ? `The publisher marks ${newest.year} as provisional (the last three years are).` : ""];
  if (newest.year < latestYear) notes.push(`The newest year for ${regionCsv} is ${newest.year}; the table runs to ${latestYear}.`);
  return buildStatisticAnswer({
    ...base,
    value: newest.median,
    low: newest.q10,
    high: newest.q90,
    period: { from: `${newest.year}-01-01`, to: `${newest.year}-12-31` },
    reference_period: String(newest.year),
    sample_size: newest.sales,
    note: notes.filter(Boolean).join(" ") || undefined,
    describe: (v) =>
      `The median price paid for a ${w.one} in ${regionCsv} (canton Zürich) in ${newest.year} was ${fmtMoney(v, "CHF")} (${newest.sales} sales; 10th to 90th percentile ${fmtMoney(newest.q10, "CHF")} to ${fmtMoney(newest.q90, "CHF")}).` +
      `${prev ? ` That is ${Math.abs(pct(v, prev.median))}% ${v >= prev.median ? "higher" : "lower"} than the median in ${prev.year}.` : ""}`,
    ending: "Registered sales published by Statistisches Amt Kanton Zürich.",
    extra: {
      region: regionCsv,
      property_kind: w.one,
      year: newest.year,
      q25_chf: newest.q25,
      q75_chf: newest.q75,
      mean_chf: newest.mean,
      previous_year: prev ? { year: prev.year, median_chf: prev.median, sales: prev.sales, change_percent: pct(newest.median, prev.median) } : null,
      whole_canton: canton ? { median_chf: canton.median, sales: canton.sales } : null,
      attribution_notice: ATTRIBUTION_LINE,
    },
  });
}

export function townAnswer(parsed: { rows: TownRow[]; latest: number }, kind: Kind, town: string, asked: string, baseUrl?: string): PriceAnswer {
  const w = KIND_WORDS[kind];
  const row = parsed.rows.find((r) => r.name === town);
  const base = { source: INFO, query: { country: "CH", town: asked || town, property_type: kind }, measure: "median" as const, currency: "CHF", unit: w.unit, method: METHOD, baseUrl };
  if (!row) {
    const none = buildStatisticAnswer({ ...base, value: null, period: { from: null, to: null }, reference_period: "", describe: () => "" });
    return { ...none, summary: `Statistisches Amt Kanton Zürich publishes no ${w.one} median for ${town} in ${parsed.latest} (fewer than 15 sales behind it). Try its market region (Seegemeinden, Agglomerationsgemeinden, Landgemeinden) or Kanton Zürich.` };
  }
  const [from, to] = row.period.includes("-") ? row.period.split("-").map(Number).sort((a, b) => a - b) : [row.refYear, row.refYear];
  return buildStatisticAnswer({
    ...base,
    value: row.median,
    period: { from: `${from}-01-01`, to: `${to}-12-31` },
    reference_period: row.period,
    sample_size: row.sales,
    note: `Municipality figure pooled over ${row.pooling === 1 ? "one year" : `${row.pooling} years (${row.period})`}; the publisher gives the 25th and 75th percentile, not a 10th-90th range. The last three years are provisional.`,
    describe: (v) =>
      `The median price paid for a ${w.one} in ${town} (canton Zürich) over ${row.pooling === 1 ? String(row.refYear) : row.period} was ${fmtMoney(v, "CHF")} (${row.sales} sales; middle half of sales ${fmtMoney(row.q25, "CHF")} to ${fmtMoney(row.q75, "CHF")}).`,
    ending: "Registered sales published by Statistisches Amt Kanton Zürich, pooled over several years.",
    extra: { municipality: town, property_kind: w.one, pooled_years: row.pooling, pool_period: row.period, q25_chf: row.q25, q75_chf: row.q75, attribution_notice: ATTRIBUTION_LINE },
  });
}

// ---------- fetching ----------

export type TextGetter = (url: string) => Promise<string>;
export const getText: TextGetter = async (url) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "user-agent": "pricepaid-plug/0.1 (+https://proofprice.com; price-paid data for AI agents)" } });
    if (!res.ok) throw new SourceError(`Source returned HTTP ${res.status}`, url, res.status);
    return await res.text();
  } catch (err: any) {
    if (err?.name === "AbortError") throw new SourceError("Source timed out", url);
    if (err instanceof SourceError) throw err;
    throw new SourceError("Could not reach the official source", String(err?.cause?.code ?? err?.message ?? err));
  } finally {
    clearTimeout(timer);
  }
};

export interface Query { town?: string; property_type?: string; baseUrl?: string }

export async function zhHomeSales(q: Query, get: TextGetter = getText): Promise<PriceAnswer> {
  const kind = normaliseKind(q.property_type) ?? "flat";
  const key = fold(q.town ?? "");
  const region = regionFor(key) ?? (key === "zurich" ? REGIONS[1] : undefined);
  if (region) {
    if (region.key === "city" && kind === "flat") throw new InputError("For flats in the city of Zürich use town Zürich with property_type flat (served by the city's own district-level figures).");
    return regionAnswer(parseRegionCsv(await get(FILES[kind].region)), kind, region.csv, q.town?.trim() ?? "", q.baseUrl);
  }
  const t = matchTown(q.town);
  if (!t.name) {
    throw new InputError(
      `No canton Zürich place called "${q.town ?? ""}". Give a municipality such as Winterthur, Uster, Dübendorf, Horgen or Küsnacht, a market region (Seegemeinden, Agglomerationsgemeinden, Landgemeinden) or Kanton Zürich.` +
        (t.near.length ? ` Did you mean: ${t.near.join("; ")}?` : ""),
    );
  }
  return townAnswer(parseTownJson(JSON.parse(await get(FILES[kind].town))), kind, t.name, q.town?.trim() ?? "", q.baseUrl);
}
