// Hong Kong: private OFFICES, RETAIL premises and FLATTED FACTORIES, average rents and prices, from the Rating and Valuation Department's
// Property Market Statistics (data.gov.hk dataset "hk-rvd-tsinfo_rvd-property-market-statistics"). Annual files back to 1999:
//   2.1A / 2.2A offices: average rent / average price per m² by grade (A, B, C) and district (7 districts)
//   3.1A retail and 4.1A flatted factories: average rents and prices per m² by region (Hong Kong, Kowloon, New Territories)
// One published average per cell per year: no distribution and no sample size, so every answer is an official statistic.
// Format checked live on 2026-10-29 from GitHub's servers (probes hkc21, hkc22, hkc31, hkc41; newest row 2025, Last-Modified 4 Jun 2026).

import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import type { SourceInfo } from "../../lib/plugin";
import { resolveRegion, REGIONS, type Region } from "../hk-rvd-rents/source";

const BASE = "https://www.rvd.gov.hk/datagovhk/";
export const URL_OFFICE_RENT = BASE + "2.1A(from_99).csv";
export const URL_OFFICE_PRICE = BASE + "2.2A(from_99).csv";
export const URL_RETAIL = BASE + "3.1A(from_99).csv";
export const URL_FACTORY = BASE + "4.1A(from_99).csv";
export const TERMS_URL = "https://data.gov.hk/en/terms-and-conditions";

export const INFO: SourceInfo = {
  id: "hk-rvd-commercial",
  country: "HK (Hong Kong)",
  category: "commercial property (private offices, retail premises and flatted factories: average prices and rents)",
  name: "Private offices, retail premises and flatted factories, average prices and rents, yearly (Property Market Statistics)",
  publisher: "Rating and Valuation Department (RVD), The Government of the Hong Kong SAR, via DATA.GOV.HK",
  what_is_recorded:
    "The average price (HK$ per square metre) and the average monthly rent (HK$ per square metre) of private offices by grade (A, B, C) and district, " +
    "and of private retail premises and flatted factories by region (Hong Kong Island, Kowloon, New Territories), as the RVD publishes them each year.",
  price_type: "official_statistic",
  freshness: "Yearly, published about 5 months after the year ends (2025 figures published June 2026)",
  licence: "DATA.GOV.HK Terms and Conditions of Use: reuse free of charge, commercial use allowed, the source must be credited.",
  licence_url: TERMS_URL,
  attribution:
    "Source: Rating and Valuation Department, The Government of the Hong Kong Special Administrative Region, Property Market Statistics (Private Offices, Private Retail, Private Flatted Factories), provided through DATA.GOV.HK.",
  homepage: "https://data.gov.hk/en-data/dataset/hk-rvd-tsinfo_rvd-property-market-statistics",
  limits:
    "One published average per year, grade and district or region: not a list of sales, no range and no count of deals. The area basis of the RVD's per-m² figures is defined in its data dictionary (Data_Dic.pdf) and is not restated here. " +
    "Cells the RVD gives a remark (for example 'X') or leaves blank ('-', 'n/a') are not used. Yearly only. Private premises only (not government or public buildings). Not asking prices.",
};

export type Premises = "office" | "retail" | "factory";
export type Basis = "price" | "rent";
export const GRADES = ["A", "B", "C"] as const;
export type Grade = (typeof GRADES)[number];

export const OFFICE_DISTRICTS = [
  "Sheung Wan", "Central", "Wan Chai / Causeway Bay", "North Point / Quarry Bay", "Tsim Sha Tsui", "Yau Ma Tei / Mong Kok", "Kowloon Bay / Kwun Tong",
] as const;
export type OfficeDistrict = (typeof OFFICE_DISTRICTS)[number];

const DISTRICT_WORDS: Record<string, OfficeDistrict> = {
  "sheung wan": "Sheung Wan", central: "Central", "central and western": "Central", admiralty: "Central",
  "wan chai": "Wan Chai / Causeway Bay", "causeway bay": "Wan Chai / Causeway Bay", "wan chai / causeway bay": "Wan Chai / Causeway Bay", "wan chai/causeway bay": "Wan Chai / Causeway Bay",
  "north point": "North Point / Quarry Bay", "quarry bay": "North Point / Quarry Bay", "tai koo": "North Point / Quarry Bay", "north point / quarry bay": "North Point / Quarry Bay", "north point/quarry bay": "North Point / Quarry Bay",
  "tsim sha tsui": "Tsim Sha Tsui", tst: "Tsim Sha Tsui",
  "yau ma tei": "Yau Ma Tei / Mong Kok", "mong kok": "Yau Ma Tei / Mong Kok", "yau ma tei / mong kok": "Yau Ma Tei / Mong Kok", "yau ma tei/mong kok": "Yau Ma Tei / Mong Kok",
  "kowloon bay": "Kowloon Bay / Kwun Tong", "kwun tong": "Kowloon Bay / Kwun Tong", "kowloon bay / kwun tong": "Kowloon Bay / Kwun Tong", "kowloon bay/kwun tong": "Kowloon Bay / Kwun Tong",
};

export function resolveDistrict(input: string): OfficeDistrict | null {
  return DISTRICT_WORDS[input.trim().toLowerCase().replace(/\s+/g, " ")] ?? null;
}

export function normalisePremises(input: string | undefined): Premises | undefined {
  if (input === undefined || input.trim() === "") return undefined;
  const t = input.trim().toLowerCase();
  if (["office", "offices", "commercial"].includes(t)) return "office";
  if (["retail", "shop", "shops", "retail premises"].includes(t)) return "retail";
  if (["factory", "factories", "industrial", "flatted factory", "flatted factories", "warehouse"].includes(t)) return "factory";
  throw new InputError("premises must be office, retail or factory (private offices, private retail premises, private flatted factories).");
}

export function normaliseGrade(input: string | undefined): Grade | undefined {
  if (input === undefined || input.trim() === "") return undefined;
  const m = /^(?:grade\s*)?([abc])$/i.exec(input.trim());
  if (!m) throw new InputError("grade must be A, B or C (RVD office grades).");
  return m[1].toUpperCase() as Grade;
}

export function normaliseBasis(input: string | undefined): Basis | undefined {
  if (input === undefined || input.trim() === "") return undefined;
  const t = input.trim().toLowerCase();
  if (["price", "prices", "sale", "sales", "sale price"].includes(t)) return "price";
  if (["rent", "rents", "rental"].includes(t)) return "rent";
  throw new InputError("basis must be price (the default: average sale price per m²) or rent (average monthly rent per m²).");
}

export interface Cell { value: number | null; remark: string }
export interface YearRow { year: number; cells: Record<string, Cell> }

/** Parse an RVD yearly CSV: a title line, a header "Year,<name>,<name> - Remarks,...", then one row per year ("2025 ,684,,858,..."). Keys are the column names. */
export function parseYearly(text: string): YearRow[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  const h = lines.findIndex((l) => l.startsWith("Year,"));
  if (h < 0) throw new SourceError("The RVD file changed layout (no Year header)", "");
  const header = lines[h].split(",").map((s) => s.trim());
  const cols: { key: string; value: number; remark: number }[] = [];
  header.forEach((name, i) => {
    if (i === 0 || name.endsWith(" - Remarks")) return;
    cols.push({ key: name, value: i, remark: header[i + 1] === `${name} - Remarks` ? i + 1 : -1 });
  });
  if (cols.length < 6) throw new SourceError("The RVD file changed layout (value columns missing)", String(cols.length));
  const rows: YearRow[] = [];
  for (const line of lines.slice(h + 1)) {
    const f = line.split(",");
    const y = /^(\d{4})\b/.exec((f[0] ?? "").trim());
    if (!y) continue;
    const cells: Record<string, Cell> = {};
    for (const c of cols) {
      const raw = (f[c.value] ?? "").trim();
      const v = /^\d+(\.\d+)?$/.test(raw) ? Number(raw) : NaN;
      cells[c.key] = { value: Number.isFinite(v) && v > 0 ? v : null, remark: c.remark >= 0 ? (f[c.remark] ?? "").trim() : "" };
    }
    rows.push({ year: Number(y[1]), cells });
  }
  if (rows.length < 5) throw new SourceError("The RVD file looks empty", String(rows.length));
  rows.sort((a, b) => a.year - b.year);
  return rows;
}

/** How many years back we look for a usable figure (a cell with no usable figure for 3 years is not current). */
export const MAX_LOOKBACK = 3;

export function newestUsable(rows: YearRow[], key: string): { row: YearRow; cell: Cell } | null {
  for (let i = rows.length - 1; i >= Math.max(0, rows.length - MAX_LOOKBACK); i--) {
    const cell = rows[i].cells[key];
    if (cell && cell.value !== null && cell.remark === "") return { row: rows[i], cell };
  }
  return null;
}

export interface HkCommercialInput { town?: string; premises?: string; grade?: string; basis?: string; property_type?: string; baseUrl?: string }

interface Plan { premises: Premises; basis: Basis; grade?: Grade; key: string; label: string; place: string; url: string; placeNote?: string }

export function plan(input: HkCommercialInput): Plan {
  const pt = input.property_type?.trim().toLowerCase();
  if (pt === "land") throw new InputError("Hong Kong: land prices are not available. This source covers private offices, retail premises and flatted factories (property_type = commercial).");
  if (!input.town || !input.town.trim()) {
    throw new InputError(`Hong Kong: town is required. For offices give a district (${OFFICE_DISTRICTS.join(", ")}); for retail premises or flatted factories give a region: "Hong Kong" (Hong Kong Island), "Kowloon" or "New Territories".`);
  }
  const district = resolveDistrict(input.town);
  const asked = normalisePremises(input.premises);
  const premises: Premises = asked ?? (district ? "office" : "retail");
  const basis = normaliseBasis(input.basis) ?? "price";
  const grade = normaliseGrade(input.grade);
  if (premises === "office") {
    if (!district) {
      throw new InputError(`Hong Kong offices are published by district only. Use town = one of: ${OFFICE_DISTRICTS.join(", ")}. (For retail premises or flatted factories use premises = retail or factory with a region.)`);
    }
    const g = grade ?? "A";
    return {
      premises, basis, grade: g, key: `Grade ${g} ${district}`, label: `Grade ${g} private offices`, place: district,
      url: basis === "price" ? URL_OFFICE_PRICE : URL_OFFICE_RENT,
      ...(grade ? {} : { placeNote: "No grade was asked for, so this is Grade A (prime offices); Grades B and C are in extra.grades." }),
    };
  }
  const { region, note } = resolveRegion(input.town);
  const regionName = region === "Hong Kong" ? "Hong Kong Island" : region;
  return {
    premises, basis, key: `${basis === "price" ? "Prices" : "Rents"} (${region})`,
    label: premises === "retail" ? "private retail premises" : "private flatted factories", place: regionName,
    url: premises === "retail" ? URL_RETAIL : URL_FACTORY,
    ...(note ? { placeNote: note } : {}),
  };
}

export function hkCommercialMethod(): string {
  return (
    "Hong Kong commercial property: the average price (or average monthly rent) per square metre of private offices (by grade and district), retail premises or flatted factories (by region), " +
    "as the Rating and Valuation Department publishes it for the newest year with a usable figure, with the change on the year before. " +
    "It is a published yearly average, not a list of sales and not an asking price; no range is calculated. Cells the RVD marks with a remark are skipped."
  );
}

const hkd = (v: number) => fmtMoney(v, "HKD");

export function hkCommercialAnswer(rows: YearRow[], input: HkCommercialInput): PriceAnswer {
  const p = plan(input);
  const unit = p.basis === "price" ? "per m²" : "per m² per month";
  const query = { country: "HK", town: input.town?.trim(), premises: p.premises, ...(p.grade ? { grade: p.grade } : {}), basis: p.basis };
  const base = { source: INFO, query, measure: "average" as const, currency: "HKD", unit, method: hkCommercialMethod(), baseUrl: input.baseUrl };
  const hit = newestUsable(rows, p.key);
  if (!hit) {
    const none = buildStatisticAnswer({ ...base, value: null, period: { from: null, to: null }, reference_period: "", describe: () => "" });
    return { ...none, summary: `The RVD publishes no usable average ${p.basis} for ${p.label} in ${p.place} in the last ${MAX_LOOKBACK} years. Try another grade, district or region.` };
  }
  const year = hit.row.year;
  const prev = rows.find((r) => r.year === year - 1)?.cells[p.key];
  const yoy = prev && prev.value !== null && prev.remark === ""
    ? { year: year - 1, value: prev.value, change_percent: Math.round(((hit.cell.value! - prev.value) / prev.value) * 1000) / 10 }
    : null;
  const lastYear = rows[rows.length - 1].year;
  const notes: string[] = [`The average ${p.basis === "price" ? "price" : "monthly rent"} per m² of ${p.label} in ${p.place}, for ${year}: a yearly average published by the RVD, not an asking price and not a single sale.`];
  if (p.placeNote) notes.push(p.placeNote);
  if (year !== lastYear) notes.push(`The RVD's newest year (${lastYear}) is blank or carries a remark for this cell, so the latest usable year is shown.`);
  const recent = rows.slice(-5).map((r) => {
    const c = r.cells[p.key];
    return { year: r.year, value: c && c.remark === "" ? c.value : null };
  });
  const grades = p.premises === "office"
    ? GRADES.map((g) => {
        const h = newestUsable(rows, `Grade ${g} ${p.place}`);
        return { grade: g, value_hkd_per_m2: h?.cell.value ?? null, year: h?.row.year ?? null };
      })
    : undefined;
  return buildStatisticAnswer({
    ...base,
    value: hit.cell.value,
    period: { from: `${year}-01-01`, to: `${year}-12-31` },
    reference_period: String(year),
    note: notes.join(" "),
    describe: (v) =>
      `The average ${p.basis === "price" ? "price" : "monthly rent"} of ${p.label} in ${p.place} was ${hkd(v)} ${unit} in ${year}. ` +
      (yoy ? (yoy.change_percent === 0 ? "That is unchanged from the year before. " : `That is ${Math.abs(yoy.change_percent)}% ${yoy.change_percent > 0 ? "higher" : "lower"} than in ${yoy.year} (${hkd(yoy.value)}). `) : "") +
      "This is an official yearly average, not an asking price.",
    extra: {
      country_name: "Hong Kong",
      premises: p.premises,
      basis: p.basis,
      place: p.place,
      ...(p.grade ? { grade: p.grade } : {}),
      reference_year: year,
      change_on_year_earlier: yoy,
      last_5_years: recent,
      ...(grades ? { grades } : {}),
      what_this_is: "Yearly average price or monthly rent per square metre of private commercial premises, from the Rating and Valuation Department's property market statistics. Not an asking price and not a single sale.",
      dataset: { name: "Property Market Statistics (Private Offices, Retail, Flatted Factories)", url: INFO.homepage, file: p.url },
      regions_available: REGIONS as unknown as Region[],
    },
  });
}

async function fetchText(url: string, timeoutMs = 25000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "user-agent": "pricepaid-plug/0.1 (+https://proofprice.com)" } });
    if (!res.ok) throw new SourceError(`Source returned HTTP ${res.status}`, url, res.status);
    return await res.text();
  } catch (err: any) {
    if (err instanceof SourceError) throw err;
    if (err?.name === "AbortError") throw new SourceError("Source timed out", url);
    throw new SourceError("Could not reach the official source", String(err?.cause?.code ?? err?.message ?? err));
  } finally {
    clearTimeout(timer);
  }
}

export async function hkCommercial(input: HkCommercialInput, fetcher: (url: string) => Promise<string> = fetchText): Promise<PriceAnswer> {
  const p = plan(input); // validates the question before touching the network
  return hkCommercialAnswer(parseYearly(await fetcher(p.url)), input);
}
