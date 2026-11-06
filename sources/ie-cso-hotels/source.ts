// Ireland: mean nightly accommodation costs paid by overnight foreign resident visitors, from the Central Statistics Office (CSO)
// PxStat table ITA12 (Overseas Travel / Travel and Tourism). Format checked live on 2026-11-06 (fixtures/ita12.csv: the complete
// 8,863 byte CSV, 50 rows, years 2023 and 2024). Plain GET, no key. Tiny annual table, so one request per answer.
//
// What the CSO publishes: a survey MEAN per night, by visitor home market (all, Great Britain, Other Europe, USA & Canada, Other) and
// accommodation type (hotels, guest house/B&B, self catering, other private, all). One figure per year; no sample size, no range.
// So the answer is an official statistic: value + measure "average", range fields null, sample_size null.
// Foreign RESIDENT visitors only (Irish residents are not in the table). Some cells are blank (for example 2024 "All Residencies"
// hotels): we never compute them, we fall back to the newest year the CSO did publish and say so.
import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError, retryOnce } from "../../lib/http";
import type { SourceInfo } from "../../lib/plugin";

export const INFO: SourceInfo = {
  id: "ie-cso-hotels",
  country: "IE (Ireland)",
  category: "hotels (mean nightly accommodation cost paid by foreign visitors)",
  name: "Mean nightly accommodation costs of overnight foreign resident visitors (PxStat table ITA12)",
  publisher: "Central Statistics Office (CSO), Ireland",
  what_is_recorded:
    "The mean amount in euro that overnight foreign resident visitors to Ireland say they paid per night for their accommodation, by visitor home market " +
    "and accommodation type (hotels, guest house or B&B, self catering, other private), one figure per year, from the CSO's visitor survey.",
  price_type: "official_statistic",
  freshness: "Annual, published about a year after the survey year; every answer states its year",
  licence: "Creative Commons Attribution 4.0 (CC BY 4.0). data.gov.ie dataset page: \"Licensed under: Creative Commons Attribution 4.0\".",
  licence_url: "https://data.gov.ie/dataset/ita12-mean-nightly-accommodation-costs-of-overnight-foreign-resident-visitors",
  attribution: "Source: Central Statistics Office, Ireland (CSO), table ITA12, https://data.cso.ie/table/ITA12. Licensed under CC BY 4.0.",
  homepage: "https://data.cso.ie/table/ITA12",
  limits:
    "A survey mean per night, what foreign visitors reported paying, not a hotel rate card, not a booking quote and not a range: no sample size and no percentiles. " +
    "Foreign resident visitors only (people living in Ireland are not covered). One figure per year, so it lags by about a year. National only (no city or county). " +
    "Some cells are not published; then the newest published year is used and the answer says so.",
};

export const ITA12_URL = "https://ws.cso.ie/public/api.restful/PxStat.Data.Cube_API.ReadDataset/ITA12/CSV/1.0/en";

// ---------- reading the CSV (pure) ----------

export interface Ita12Row {
  year: string;
  residencyCode: string;
  residency: string;
  accommodationCode: string;
  accommodation: string;
  /** whole euros, or null when the CSO leaves the cell blank */
  value: number | null;
}

/** Split one CSV line with quoted fields ("" is an escaped quote). */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

export function parseIta12(csv: string): Ita12Row[] {
  const lines = csv.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) throw new SourceError("The CSO file for table ITA12 was empty.");
  const head = splitCsvLine(lines[0]);
  const idx = (name: string) => head.indexOf(name);
  const cols = { year: idx("Year"), rc: idx("C04189V04961"), r: idx("Residency"), ac: idx("C02164V02610"), a: idx("Accommodation Type"), v: idx("VALUE") };
  if (Object.values(cols).some((i) => i < 0)) throw new SourceError("The CSO changed the layout of table ITA12; this source needs updating.");
  const rows: Ita12Row[] = [];
  for (const l of lines.slice(1)) {
    const f = splitCsvLine(l);
    const raw = (f[cols.v] ?? "").trim();
    const n = raw === "" ? null : Number(raw);
    rows.push({
      year: f[cols.year], residencyCode: f[cols.rc], residency: f[cols.r], accommodationCode: f[cols.ac], accommodation: f[cols.a],
      value: n !== null && Number.isFinite(n) && n > 0 ? n : null,
    });
  }
  return rows;
}

// ---------- matching what the user asked ----------

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9& ]+/g, " ").replace(/\s+/g, " ").trim();

const RESIDENCY_WORDS: Record<string, string> = {
  "": "-", all: "-", ie: "-", ireland: "-", national: "-", nationwide: "-", "whole country": "-", overall: "-", foreign: "-", "all visitors": "-", "all residencies": "-",
  gb: "XB", uk: "XB", "united kingdom": "XB", britain: "XB", "great britain": "XB", england: "XB", scotland: "XB", wales: "XB", british: "XB",
  us: "USCA", usa: "USCA", "united states": "USCA", america: "USCA", american: "USCA", canada: "USCA", "usa & canada": "USCA", "usa canada": "USCA", "us & canada": "USCA", "north america": "USCA",
  europe: "OTHEUR3", "other europe": "OTHEUR3", "continental europe": "OTHEUR3", eu: "OTHEUR3", france: "OTHEUR3", germany: "OTHEUR3", spain: "OTHEUR3", italy: "OTHEUR3", netherlands: "OTHEUR3",
  other: "OTHR1", "rest of world": "OTHR1", "other residencies": "OTHR1", australia: "OTHR1", asia: "OTHR1",
};

export const ACCOMMODATION_WORDS: Record<string, string> = {
  "": "111", hotel: "111", hotels: "111",
  "guest house": "92", guesthouse: "92", "guest houses": "92", "b&b": "92", bnb: "92", "bed and breakfast": "92", "bed & breakfast": "92", "guest house b&b": "92",
  "self catering": "94", "self-catering": "94", "rented house": "94", "holiday home": "94", "holiday rental": "94", rental: "94", "self catering rented house": "94",
  "other private": "225", other: "225", private: "225",
  all: "-", "all types": "-", any: "-", overall: "-", average: "-",
};

export function residencyCode(area?: string): string {
  const k = norm(area ?? "");
  const code = RESIDENCY_WORDS[k];
  if (code === undefined) throw new InputError(`"${area}" is not a visitor home market in the CSO table. Use one of: all (default), Great Britain, USA & Canada, Other Europe, Other.`);
  return code;
}

export function accommodationCode(accommodation?: string): string {
  const k = norm(accommodation ?? "").replace(/-/g, " ");
  const code = ACCOMMODATION_WORDS[k] ?? ACCOMMODATION_WORDS[k.replace(/ /g, "")];
  if (code === undefined) throw new InputError(`"${accommodation}" is not an accommodation type in the CSO table. Use one of: hotels (default), guest house, self catering, other private, all.`);
  return code;
}

export interface Pick {
  row: Ita12Row;
  /** the year before, when published */
  previous: Ita12Row | null;
  /** years newer than the one used that exist in the table but are blank for this cell */
  blankNewerYears: string[];
}

/** Newest published (non-blank) year for the cell, the year before it, and any newer blank years. Null when nothing is published. */
export function pickLatest(rows: Ita12Row[], resCode: string, accCode: string): Pick | null {
  const cell = rows.filter((r) => r.residencyCode === resCode && r.accommodationCode === accCode).sort((a, b) => a.year.localeCompare(b.year));
  const published = cell.filter((r) => r.value !== null);
  if (!published.length) return null;
  const row = published[published.length - 1];
  const prevYear = String(Number(row.year) - 1);
  return {
    row,
    previous: published.find((r) => r.year === prevYear) ?? null,
    blankNewerYears: cell.filter((r) => r.value === null && r.year > row.year).map((r) => r.year),
  };
}

const eur = (v: number) => `€${v}`;

export interface IeHotelsInput {
  area?: string;
  accommodation?: string;
  baseUrl?: string;
}

export function answerFromRows(rows: Ita12Row[], input: IeHotelsInput): PriceAnswer {
  const res = residencyCode(input.area);
  const acc = accommodationCode(input.accommodation);
  const pick = pickLatest(rows, res, acc);
  const anyRow = rows.find((r) => r.residencyCode === res && r.accommodationCode === acc);
  const resLabel = anyRow?.residency ?? "All Residencies";
  const accLabel = anyRow?.accommodation ?? "Hotels";
  const change = pick?.previous ? Math.round(((pick.row.value! - pick.previous.value!) / pick.previous.value!) * 1000) / 10 : null;
  const marketWords = res === "-" ? "foreign visitors" : `visitors from ${resLabel}`;
  const lagNote = pick && pick.blankNewerYears.length ? `The CSO has not published ${pick.blankNewerYears.join(", ")} for this combination, so the newest published year (${pick.row.year}) is shown.` : undefined;
  return buildStatisticAnswer({
    source: INFO,
    query: { country: "IE", ...(res !== "-" ? { area: resLabel } : {}), accommodation: accLabel },
    value: pick ? pick.row.value : null,
    measure: "average",
    currency: "EUR",
    unit: "per night",
    period: pick ? { from: `${pick.row.year}-01-01`, to: `${pick.row.year}-12-31` } : { from: null, to: null },
    reference_period: pick ? pick.row.year : "",
    method:
      "Ireland (CSO table ITA12): the mean nightly accommodation cost that overnight foreign resident visitors report in the CSO's visitor survey, by home market and accommodation type. " +
      "We pass on the newest published year unchanged, with the year before. It is a survey mean: no range and no sample size. Irish residents are not covered.",
    describe: (v) =>
      `In ${pick!.row.year} ${marketWords} staying in ${accLabel.toLowerCase()} in Ireland paid a mean of ${eur(v)} per night (CSO visitor survey).` +
      (change !== null ? (change === 0 ? " That is unchanged from the year before." : ` That is ${Math.abs(change)}% ${change > 0 ? "higher" : "lower"} than in ${pick!.previous!.year} (${eur(pick!.previous!.value!)}).`) : ""),
    note: [
      "Survey mean per night paid by foreign resident visitors to Ireland (not a rate card, not a booking quote, not Irish residents).",
      lagNote,
    ].filter(Boolean).join(" "),
    baseUrl: input.baseUrl,
    extra: pick
      ? {
          visitor_market: resLabel,
          accommodation_type: accLabel,
          year: pick.row.year,
          year_before: pick.previous ? { year: pick.previous.year, value: pick.previous.value } : null,
          change_on_year_before_percent: change,
          blank_newer_years: pick.blankNewerYears,
          price_basis: "mean nightly accommodation cost reported by foreign resident visitors (official survey statistic)",
        }
      : undefined,
  });
}

export async function ieHotels(input: IeHotelsInput, fetcher?: (url: string) => Promise<string>): Promise<PriceAnswer> {
  // validate the words before any network call
  residencyCode(input.area);
  accommodationCode(input.accommodation);
  const get = fetcher ?? fetchCsv;
  const rows = parseIta12(await get(ITA12_URL));
  return answerFromRows(rows, input);
}

async function fetchCsv(url: string): Promise<string> {
  return retryOnce(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const res = await fetch(url, { signal: controller.signal, headers: { "user-agent": "pricepaid-plug/0.1 (+https://proofprice.com)" } });
      if (!res.ok) throw new SourceError(`Source returned HTTP ${res.status}`, "", res.status);
      return await res.text();
    } catch (err: any) {
      if (err instanceof SourceError) throw err;
      if (err?.name === "AbortError") throw new SourceError("Source timed out", url);
      throw new SourceError("Could not reach the official source", String(err?.cause?.code ?? err?.message ?? err));
    } finally {
      clearTimeout(timer);
    }
  });
}
