// Hungary home prices from KSH (Hungarian Central Statistical Office) STADAT table 18.1.2.9: the average price per m² of a
// dwelling in thousand HUF, by region and settlement type (capital, county seats, towns, villages), used and new dwellings,
// one figure per calendar year since 2007, built by KSH from the tax authority's records of sale contracts.
// Page: https://www.ksh.hu/stadat_files/lak/hu/lak0025.html  CSV: same folder, lak0025.csv (small, ISO-8859-2, ';' separated).
// The CSV is read through a six-hour in-memory cache. KSH gives no sale counts, so there is no harvest() (the library keeps only
// rows with a record count or NO_COUNT; this table would be better served by a later historical backfill).
// Format checked live on 2026-10-23 (see source.test.ts).

import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import type { SourceInfo } from "../../lib/plugin";

export const CSV_URL = "https://www.ksh.hu/stadat_files/lak/hu/lak0025.csv";
export const PAGE_URL = "https://www.ksh.hu/stadat_files/lak/hu/lak0025.html";
export const LICENCE_URL = "https://www.ksh.hu/copyright_hungarian_central_statistical_office";

export const INFO: SourceInfo = {
  id: "hu-ksh-home-prices",
  country: "HU (Hungary)",
  category: "home sales (official average price per m²)",
  name: "KSH STADAT 18.1.2.9: average price per m² of a dwelling by region and settlement type",
  publisher: "KSH (Hungarian Central Statistical Office)",
  what_is_recorded:
    "For Budapest, the 7 statistical regions (the Pest region, 3 Transdanubian, Northern Hungary and 2 Great Plain regions), split by settlement type (county seats, towns, villages, all together) and for Hungary as a whole, and each year from 2007: " +
    "the average price per square metre of a used or a new dwelling bought by private individuals, calculated by KSH from the sale contracts the tax authority records. One published figure per place, type of dwelling and year; never individual sales or addresses. " +
    "KSH leaves a cell out (shown as '..') when fewer than 3 contracts stand behind it.",
  price_type: "official_statistic",
  freshness: "Annual: the previous year's figures are published in summer (the 2025 figures were on the page last updated 31 July 2026); each answer states its year",
  licence:
    "KSH copyright page: \"HCSO uses standardised international licence Creative Commons Attribution 4.0 International (CC BY 4.0)\" for website content including tables; " +
    "the content can be copied, reproduced and redistributed. The exception, CC BY-NC, covers only data files queried from KSH's internal databases on request, which this public STADAT table is not.",
  licence_url: LICENCE_URL,
  attribution: "Source: HCSO / ksh.hu (KSH STADAT 18.1.2.9). Figures converted from thousand HUF to HUF by ProofPrice; the changes against the year before are calculated by ProofPrice. Not an endorsement by KSH.",
  homepage: PAGE_URL,
  limits:
    "An average (not a median) per m², not a price per home, and annual, so the newest figure is 3 to 15 months old. Regions and settlement types only: KSH publishes no figure for a single town other than Budapest. " +
    "No sample size is published, and cells with fewer than 3 contracts are blank (common for new dwellings in villages). Averages are moved by the mix of homes sold.",
};

// ---------- the table (pure) ----------

export type Used = "existing" | "new";
export type SettlementKey = "capital" | "county_seat" | "towns" | "villages" | "all";

export interface Row {
  region: string; // as published, accents kept: "Budapest", "Pest", "Közép-Dunántúl", "Ország"
  type: string; // as published: "főváros", "megyeszékhely", "városok", "községek", "együtt"
  values: Record<number, number>; // year -> thousand HUF per m²
}
export interface HuData {
  existing: Row[];
  new: Row[];
  latestYear: number;
}

const SETTLEMENT_PUBLISHED: Record<SettlementKey, string> = {
  capital: "főváros", county_seat: "megyeszékhely", towns: "városok", villages: "községek", all: "együtt",
};
const SETTLEMENT_WORDS: Record<SettlementKey, string> = {
  capital: "the capital", county_seat: "county seats", towns: "other towns", villages: "villages", all: "all settlements together",
};
export const SETTLEMENTS = ["all", "county_seat", "towns", "villages"] as const;

export function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Region names: English and Hungarian spellings (folded) to the published name. */
export const REGIONS: { published: string; english: string; aliases: string[] }[] = [
  { published: "Budapest", english: "Budapest", aliases: ["budapest", "bp"] },
  { published: "Pest", english: "Pest region", aliases: ["pest", "pest county", "pest region", "pest megye"] },
  { published: "Közép-Dunántúl", english: "Central Transdanubia", aliases: ["kozep dunantul", "central transdanubia", "fejer", "komarom esztergom", "veszprem", "szekesfehervar", "gyor"] },
  { published: "Nyugat-Dunántúl", english: "Western Transdanubia", aliases: ["nyugat dunantul", "western transdanubia", "gyor moson sopron", "vas", "zala", "szombathely", "zalaegerszeg"] },
  { published: "Dél-Dunántúl", english: "Southern Transdanubia", aliases: ["del dunantul", "southern transdanubia", "baranya", "somogy", "tolna", "pecs", "kaposvar"] },
  { published: "Észak-Magyarország", english: "Northern Hungary", aliases: ["eszak magyarorszag", "northern hungary", "borsod", "heves", "nograd", "miskolc", "eger"] },
  { published: "Észak-Alföld", english: "Northern Great Plain", aliases: ["eszak alfold", "northern great plain", "hajdu bihar", "szabolcs", "debrecen", "nyiregyhaza"] },
  { published: "Dél-Alföld", english: "Southern Great Plain", aliases: ["del alfold", "southern great plain", "bacs kiskun", "bekes", "csongrad", "szeged", "kecskemet"] },
  { published: "Ország", english: "Hungary", aliases: ["orszag", "hungary", "magyarorszag", "hu", "national"] },
];

export function parseCsv(text: string): HuData {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  const headerAt = lines.findIndex((l) => /^[^;]*;[^;]*;\s*2007\b/.test(l));
  if (headerAt < 0) throw new SourceError("KSH's price table has changed shape (no year header found)", CSV_URL);
  const years = lines[headerAt].split(";").slice(2).map((c) => Number(c.trim()));
  if (years.length < 5 || years.some((y) => !Number.isInteger(y) || y < 2000)) throw new SourceError("KSH's price table has changed shape (bad year header)", CSV_URL);
  const out: HuData = { existing: [], new: [], latestYear: 0 };
  let section: Used | null = null;
  for (const line of lines.slice(headerAt + 1)) {
    const cells = line.split(";").map((c) => c.trim());
    if (cells.slice(1).every((c) => c === "")) {
      // a section title: "Használt lakások" (used dwellings) then "Új lakások" (new)
      const f = fold(cells[0]);
      section = /^hasznalt/.test(f) ? "existing" : /^uj\b/.test(f) ? "new" : section;
      continue;
    }
    if (!section || cells.length < 3) continue;
    const values: Record<number, number> = {};
    years.forEach((y, i) => {
      const raw = (cells[2 + i] ?? "").replace(/[\s ]/g, "").replace(",", ".");
      const v = Number(raw);
      if (raw && raw !== ".." && Number.isFinite(v) && v > 0) {
        values[y] = v;
        if (y > out.latestYear) out.latestYear = y;
      }
    });
    out[section].push({ region: cells[0], type: cells[1], values });
  }
  if (!out.existing.length || !out.new.length || !out.latestYear) throw new SourceError("KSH's price table has changed shape (no rows found)", CSV_URL);
  return out;
}

export interface Query {
  town: string | null;
  property_type: string | null;
  settlement: string | null;
  baseUrl?: string;
}

export function findRegion(town: string | null): { published: string; english: string } | null {
  if (!town || !town.trim()) return REGIONS[REGIONS.length - 1];
  const f = fold(town);
  for (const r of REGIONS) if (r.aliases.includes(f) || fold(r.published) === f || fold(r.english) === f) return r;
  return null;
}

function pickRow(rows: Row[], region: string, settlement: SettlementKey): Row | undefined {
  if (region === "Budapest") return rows.find((r) => r.region === "Budapest");
  if (settlement === "capital") return rows.find((r) => r.region === "Ország" && r.type === SETTLEMENT_PUBLISHED.capital);
  return rows.find((r) => r.region === region && r.type === SETTLEMENT_PUBLISHED[settlement]);
}

function latest(row: Row | undefined): { year: number; value: number } | null {
  if (!row) return null;
  const ys = Object.keys(row.values).map(Number);
  if (!ys.length) return null;
  const year = Math.max(...ys);
  return { year, value: row.values[year] };
}

const noMatch = (q: Query, label: string, summary: string): PriceAnswer => ({
  ...buildStatisticAnswer({
    source: INFO, query: { country: "HU", town: q.town, property_type: q.property_type, settlement: q.settlement }, value: null, measure: "average",
    currency: "HUF", unit: "per m²", period: { from: null, to: null }, reference_period: "", method: METHOD, baseUrl: q.baseUrl, describe: () => "",
  }),
  summary,
  extra: { region: label },
});

export const METHOD =
  "Hungary: the average price per m² of used and of new dwellings that KSH publishes once a year for Budapest, the seven statistical regions and Hungary, split by settlement type, from the tax authority's records of sale contracts. " +
  "We pass on the published figure for the latest year (converted from thousand HUF to HUF) with the change on the year before and the Hungarian figure; it is an average per m², not a price per home.";

export function huAnswer(data: HuData, q: Query): PriceAnswer {
  const kindRaw = (q.property_type ?? "existing").trim().toLowerCase();
  const kind: Used | null = ["existing", "used", "second-hand", "secondhand", "resale", "any", ""].includes(kindRaw) ? "existing" : ["new", "new-build", "newbuild", "new_build"].includes(kindRaw) ? "new" : null;
  if (!kind) throw new InputError("property_type must be 'existing' (used dwellings, the default) or 'new' (newly built dwellings)");
  const settleRaw = (q.settlement ?? "all").trim().toLowerCase().replace(/[\s-]+/g, "_");
  const settlement = (({ all: "all", together: "all", county_seat: "county_seat", county_seats: "county_seat", towns: "towns", town: "towns", villages: "villages", village: "villages", capital: "capital" }) as Record<string, SettlementKey>)[settleRaw];
  if (!settlement) throw new InputError(`settlement must be one of: ${SETTLEMENTS.join(", ")}`);
  const region = findRegion(q.town);
  if (!region) {
    return noMatch(q, q.town ?? "", `KSH publishes prices for Budapest, the Pest region, the six other statistical regions (${REGIONS.slice(2, 8).map((r) => r.english).join(", ")}) and Hungary as a whole, not for '${q.town}'. Name a region, or a county or big city in it (for example Debrecen, Győr, Pécs, Szeged).`);
  }
  const rows = data[kind];
  const row = pickRow(rows, region.published, region.published === "Budapest" ? "capital" : settlement);
  const hit = latest(row);
  const label = region.published === "Budapest" ? "Budapest" : region.english + (settlement === "all" ? "" : `, ${SETTLEMENT_WORDS[settlement]}`);
  const kindWords = kind === "new" ? "newly built dwellings" : "used dwellings";
  if (!hit) {
    return noMatch(q, label, `KSH publishes no price per m² for ${kindWords} in ${label} in any year (a cell is left blank when fewer than 3 contracts stand behind it, common for new dwellings in villages). Try settlement=all or the whole region.`);
  }
  const year = hit.year;
  const prev = row!.values[year - 1];
  const change = prev ? Math.round(((hit.value - prev) / prev) * 1000) / 10 : null;
  const nat = rows.find((r) => r.region === "Ország" && r.type === (region.published === "Budapest" ? "főváros" : SETTLEMENT_PUBLISHED[settlement]));
  const natYear = nat?.values[year];
  const natAll = rows.find((r) => r.region === "Ország" && r.type === "együtt")?.values[year];
  const hung = region.published === "Ország" && settlement === "all" ? null : natAll ?? null;
  const notes: string[] = [];
  if (year < data.latestYear) notes.push(`KSH has no ${data.latestYear} figure for ${label} (too few contracts); the newest is for ${year}.`);
  notes.push("Average price per m² of living space from sale contracts; KSH gives no sample size.");
  const series = Object.keys(row!.values).map(Number).sort((a, b) => a - b).map((y) => ({ reference_period: String(y), value_huf_per_m2: row!.values[y] * 1000 }));
  const other = kind === "existing" ? "new" : "existing";
  const otherHit = latest(pickRow(data[other], region.published, region.published === "Budapest" ? "capital" : settlement));
  return buildStatisticAnswer({
    source: INFO,
    query: { country: "HU", town: q.town, property_type: kind === "new" ? "new" : "existing", settlement },
    value: hit.value * 1000,
    measure: "average",
    currency: "HUF",
    unit: "per m²",
    period: { from: `${year}-01-01`, to: `${year}-12-31` },
    reference_period: String(year),
    method: METHOD,
    note: notes.join(" "),
    baseUrl: q.baseUrl,
    describe: (v) =>
      `In ${label} the average price paid for ${kindWords} was ${fmtMoney(v, "HUF")} per m² of living space (not per home) in ${year}, an official KSH figure from tax-office sale contracts.` +
      (change !== null ? ` That is ${Math.abs(change)}% ${change >= 0 ? "above" : "below"} ${year - 1} (${fmtMoney(prev * 1000, "HUF")}).` : "") +
      (hung ? ` The Hungarian average for ${kindWords} in ${year} was ${fmtMoney(hung * 1000, "HUF")} per m².` : ""),
    extra: {
      region: { name: label, published_as: row!.region + (row!.type ? " / " + row!.type : ""), settlement: region.published === "Budapest" ? "capital" : settlement },
      property_type_published: { key: kind, description: kindWords },
      previous_period: prev ? { reference_period: String(year - 1), value: prev * 1000, change_percent: change } : null,
      hungary_average_all_settlements: hung ? { reference_period: String(year), value: hung * 1000 } : null,
      same_settlement_type_nationally: natYear && nat && nat !== row ? { reference_period: String(year), value: natYear * 1000 } : null,
      other_property_type: otherHit ? { key: other, reference_period: String(otherHit.year), value: otherHit.value * 1000 } : null,
      series,
      definition: "Average price per m² of a dwelling bought by private individuals, from the tax authority's sale-contract records; published in thousand HUF, converted to HUF.",
      dataset: { url: CSV_URL, page: PAGE_URL },
    },
  });
}

// ---------- fetching ----------

const UA = "ProofPrice/1.0 (+https://proofprice.com; hello@proofprice.com)";
export type TextFetcher = () => Promise<string>;

export async function downloadCsv(): Promise<string> {
  try {
    const res = await fetch(CSV_URL, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(25_000) });
    if (!res.ok) throw new SourceError(`Source returned HTTP ${res.status}`, CSV_URL, res.status);
    return new TextDecoder("iso-8859-2").decode(await res.arrayBuffer());
  } catch (err: any) {
    if (err instanceof SourceError) throw err;
    if (err?.name === "TimeoutError" || err?.name === "AbortError") throw new SourceError("Source timed out", CSV_URL);
    throw new SourceError("Could not reach the official source", String(err?.cause?.code ?? err?.message ?? err));
  }
}

export const CACHE_MS = 6 * 3600 * 1000;
let cache: { at: number; data: HuData } | null = null;
export function clearCache(): void {
  cache = null;
}

export async function loadData(o: { fetcher?: TextFetcher; now?: number } = {}): Promise<HuData> {
  const now = o.now ?? Date.now();
  if (cache && now - cache.at < CACHE_MS) return cache.data;
  try {
    const data = parseCsv(await (o.fetcher ?? downloadCsv)());
    cache = { at: now, data };
    return data;
  } catch (err) {
    if (cache) return cache.data;
    throw err;
  }
}

export async function huHomePrices(input: { town?: string | null; property_type?: string | null; settlement?: string | null; baseUrl?: string }, o: { data?: HuData; fetcher?: TextFetcher; now?: number } = {}): Promise<PriceAnswer> {
  const data = o.data ?? (await loadData({ fetcher: o.fetcher, now: o.now }));
  return huAnswer(data, { town: input.town ?? null, property_type: input.property_type ?? null, settlement: input.settlement ?? null, baseUrl: input.baseUrl });
}
