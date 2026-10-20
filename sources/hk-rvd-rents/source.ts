// Hong Kong: private domestic AVERAGE RENTS by class, from the Rating and Valuation Department's Property Market Statistics
// (data.gov.hk dataset "hk-rvd-tsinfo_rvd-property-market-statistics", file 1.1M.csv). Monthly, back to January 1999.
// One published average per class (A to E, by saleable floor area) and region (Hong Kong Island, Kowloon, New Territories) per month,
// in HK$ per square metre of saleable area per month. No distribution and no sample size, so every answer is an official statistic.
// Format checked live on 2026-10-20 from GitHub's servers (probe hk-rvd-rent, 29 253 bytes, 332 monthly rows 01-1999 to 08-2026).

import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import type { SourceInfo } from "../../lib/plugin";

export const URL_RENTS = "https://www.rvd.gov.hk/datagovhk/1.1M.csv";
export const TERMS_URL = "https://data.gov.hk/en/terms-and-conditions";

export const INFO: SourceInfo = {
  id: "hk-rvd-rents",
  country: "HK (Hong Kong)",
  category: "rent (private domestic average rents by class)",
  name: "Private domestic average rents by class, monthly (Property Market Statistics)",
  publisher: "Rating and Valuation Department (RVD), The Government of the Hong Kong SAR, via DATA.GOV.HK",
  what_is_recorded:
    "The average monthly rent per square metre of saleable area of private domestic flats, by class (A to E, by flat size) and region (Hong Kong Island, Kowloon, New Territories), " +
    "worked out by the RVD from the tenancy agreements it receives. One published average per class and region per month.",
  price_type: "official_statistic",
  freshness: "Monthly, about 6 weeks after the month ends; the newest three months are provisional",
  licence: "DATA.GOV.HK Terms and Conditions of Use: reuse free of charge, commercial use allowed, the source must be credited.",
  licence_url: TERMS_URL,
  attribution:
    "Source: Rating and Valuation Department, The Government of the Hong Kong Special Administrative Region, Property Market Statistics (Private Domestic - Average Rents by Class), provided through DATA.GOV.HK.",
  homepage: "https://data.gov.hk/en-data/dataset/hk-rvd-tsinfo_rvd-property-market-statistics",
  limits:
    "Private domestic flats only (not public housing, village houses or commercial space). An average per class and region, not a list of rents and not an asking rent; no range and no count of tenancies. " +
    "Cells the RVD marks as unreliable (small sample) are not used. The newest three months are provisional and can be revised. Region level only: no district or building.",
};

export const REGIONS = ["Hong Kong", "Kowloon", "New Territories"] as const;
export type Region = (typeof REGIONS)[number];
export const CLASSES = ["A", "B", "C", "D", "E"] as const;
export type FlatClass = (typeof CLASSES)[number];
export const CLASS_LABEL: Record<FlatClass, string> = {
  A: "Class A (saleable area under 40 m²)",
  B: "Class B (40 to 69.9 m²)",
  C: "Class C (70 to 99.9 m²)",
  D: "Class D (100 to 159.9 m²)",
  E: "Class E (160 m² and over)",
};
/** The RVD's usual headline size when none is asked for. */
export const DEFAULT_CLASS: FlatClass = "B";

const REGION_WORDS: Record<string, Region> = {
  "hong kong": "Hong Kong", "hong kong island": "Hong Kong", "hk island": "Hong Kong", hk: "Hong Kong", island: "Hong Kong",
  kowloon: "Kowloon", "new territories": "New Territories", nt: "New Territories", "n.t.": "New Territories",
};
const DISTRICTS: Record<string, Region> = {
  central: "Hong Kong", "wan chai": "Hong Kong", "causeway bay": "Hong Kong", "north point": "Hong Kong", "quarry bay": "Hong Kong",
  "tai koo": "Hong Kong", aberdeen: "Hong Kong", "happy valley": "Hong Kong", "mid-levels": "Hong Kong", "mid levels": "Hong Kong",
  "the peak": "Hong Kong", peak: "Hong Kong", "sai ying pun": "Hong Kong", "kennedy town": "Hong Kong", "chai wan": "Hong Kong",
  "tsim sha tsui": "Kowloon", "mong kok": "Kowloon", "yau ma tei": "Kowloon", "kowloon city": "Kowloon", "kwun tong": "Kowloon",
  "sham shui po": "Kowloon", "wong tai sin": "Kowloon", "hung hom": "Kowloon", "kowloon tong": "Kowloon", "lai chi kok": "Kowloon",
  "cheung sha wan": "Kowloon", "to kwa wan": "Kowloon", "kowloon bay": "Kowloon", "diamond hill": "Kowloon",
  "sha tin": "New Territories", "tuen mun": "New Territories", "tsuen wan": "New Territories", "yuen long": "New Territories",
  "tai po": "New Territories", fanling: "New Territories", "sheung shui": "New Territories", "tseung kwan o": "New Territories",
  "sai kung": "New Territories", "ma on shan": "New Territories", "tung chung": "New Territories", "kwai chung": "New Territories",
  "tin shui wai": "New Territories", lantau: "New Territories",
};

export interface RegionMatch { region: Region; note?: string }

export function resolveRegion(input: string): RegionMatch {
  const t = input.trim().toLowerCase().replace(/\s+/g, " ");
  if (REGION_WORDS[t]) return { region: REGION_WORDS[t] };
  if (DISTRICTS[t]) {
    const region = DISTRICTS[t];
    return { region, note: `The RVD publishes rents by region only, so this is the average for ${region === "Hong Kong" ? "Hong Kong Island" : region} as a whole, not for ${input.trim()} alone.` };
  }
  throw new InputError(`'${input}' is not a Hong Kong region. Use town = "Hong Kong" (Hong Kong Island), "Kowloon" or "New Territories" (a well-known district such as Mong Kok or Sha Tin also works and gives its region).`);
}

export function normaliseClass(input: string | undefined): FlatClass | undefined {
  if (input === undefined || input.trim() === "") return undefined;
  const m = /^(?:class\s*)?([a-e])$/i.exec(input.trim());
  if (!m) throw new InputError(`flat_class must be one of ${CLASSES.join(", ")} (RVD classes by saleable area: A under 40 m², B 40–69.9, C 70–99.9, D 100–159.9, E 160 and over).`);
  return m[1].toUpperCase() as FlatClass;
}

export interface Cell { value: number | null; provisional: boolean; unreliable: boolean }
export interface MonthRow { month: string; cells: Record<string, Cell> } // month "YYYY-MM"; key "<class>|<region>"

/** Parse the RVD CSV: a title line, a header line ("Month,Class A Hong Kong,Class A Hong Kong - Remarks,..."), then "MM-YYYY" rows. */
export function parseRents(text: string): MonthRow[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  const h = lines.findIndex((l) => l.startsWith("Month,"));
  if (h < 0) throw new SourceError("The RVD rents file changed layout (no Month header)", "");
  const header = lines[h].split(",").map((s) => s.trim());
  const cols: { key: string; value: number; remark: number }[] = [];
  header.forEach((name, i) => {
    const m = /^Class ([A-E]) (Hong Kong|Kowloon|New Territories)$/.exec(name);
    if (m) cols.push({ key: `${m[1]}|${m[2]}`, value: i, remark: header[i + 1] === `${name} - Remarks` ? i + 1 : -1 });
  });
  if (cols.length < 15) throw new SourceError("The RVD rents file changed layout (class columns missing)", String(cols.length));
  const rows: MonthRow[] = [];
  for (const line of lines.slice(h + 1)) {
    const f = line.split(",");
    const m = /^(\d{2})-(\d{4})$/.exec((f[0] ?? "").trim());
    if (!m) continue;
    const cells: Record<string, Cell> = {};
    for (const c of cols) {
      const raw = (f[c.value] ?? "").trim();
      const v = raw === "" ? NaN : Number(raw);
      const flag = c.remark >= 0 ? (f[c.remark] ?? "").trim() : "";
      cells[c.key] = { value: Number.isFinite(v) && v > 0 ? v : null, provisional: flag.includes("P"), unreliable: flag.includes("Z") };
    }
    rows.push({ month: `${m[2]}-${m[1]}`, cells });
  }
  if (rows.length < 12) throw new SourceError("The RVD rents file looks empty", String(rows.length));
  rows.sort((a, b) => a.month.localeCompare(b.month));
  return rows;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const monthWords = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
function monthRange(m: string) {
  const last = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate();
  return { from: `${m}-01`, to: `${m}-${String(last).padStart(2, "0")}` };
}
const hkd = (v: number) => fmtMoney(v, "HKD");

/** Newest month with a usable (present and not unreliable) figure for one class and region. */
export function newestUsable(rows: MonthRow[], cls: FlatClass, region: Region): { index: number; row: MonthRow; cell: Cell } | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    const cell = rows[i].cells[`${cls}|${region}`];
    if (cell && cell.value !== null && !cell.unreliable) return { index: i, row: rows[i], cell };
  }
  return null;
}

export interface HkRentInput { town?: string; flat_class?: string; baseUrl?: string }

export function hkRentMethod(): string {
  return (
    "Hong Kong rents: the average monthly rent per square metre of saleable area of private domestic flats, for the region and flat class asked, from the Rating and Valuation Department's " +
    "Property Market Statistics (worked out from tenancy agreements the RVD receives). We pass on the newest published monthly figure with the change on a year earlier; figures the RVD marks unreliable are skipped, " +
    "and the newest three months are provisional. It is a published average, not a list of rents and not an asking rent; no range is calculated."
  );
}

export function hkRentAnswer(rows: MonthRow[], input: HkRentInput): PriceAnswer {
  if (!input.town || !input.town.trim()) {
    throw new InputError('Hong Kong: town is required. Give "Hong Kong" (Hong Kong Island), "Kowloon" or "New Territories", or a district such as Mong Kok or Sha Tin.');
  }
  const { region, note: placeNote } = resolveRegion(input.town);
  const asked = normaliseClass(input.flat_class);
  const cls = asked ?? DEFAULT_CLASS;
  const regionName = region === "Hong Kong" ? "Hong Kong Island" : region;
  const query = { country: "HK", town: region, flat_class: cls };
  const base = { source: INFO, query, measure: "average" as const, currency: "HKD", unit: "per m² of saleable area per month", method: hkRentMethod(), baseUrl: input.baseUrl };

  const hit = newestUsable(rows, cls, region);
  if (!hit) {
    const none = buildStatisticAnswer({ ...base, value: null, period: { from: null, to: null }, reference_period: "", describe: () => "" });
    return { ...none, summary: `The RVD publishes no usable average rent for ${CLASS_LABEL[cls]} flats in ${regionName}. Try another flat class.` };
  }
  const month = hit.row.month;
  const prevMonth = `${Number(month.slice(0, 4)) - 1}${month.slice(4)}`;
  const prev = rows.find((r) => r.month === prevMonth)?.cells[`${cls}|${region}`];
  const yoy = prev && prev.value !== null && !prev.unreliable
    ? { month: prevMonth, value: prev.value, change_percent: Math.round(((hit.cell.value! - prev.value) / prev.value) * 1000) / 10 }
    : null;
  const lastMonth = rows[rows.length - 1].month;
  const classes = CLASSES.map((c) => {
    const h = newestUsable(rows, c, region);
    return { flat_class: c, label: CLASS_LABEL[c], average_rent_hkd_per_m2_per_month: h?.cell.value ?? null, month: h?.row.month ?? null, provisional: h?.cell.provisional ?? false };
  });
  const recent = rows.slice(-12).map((r) => {
    const c = r.cells[`${cls}|${region}`];
    return { month: r.month, value: c && !c.unreliable ? c.value : null, provisional: !!c?.provisional };
  });
  const notes: string[] = [
    `The average monthly rent per m² of saleable area of ${CLASS_LABEL[cls]} private flats in ${regionName}, for ${monthWords(month)}: an average over tenancies the RVD recorded, not an asking rent and not a single rent.`,
  ];
  if (!asked) notes.push(`No flat class was asked for, so this is Class ${DEFAULT_CLASS} (flats of 40 to 69.9 m²); every class is in extra.classes.`);
  if (hit.cell.provisional) notes.push("Provisional: the RVD can revise its newest three months.");
  if (month !== lastMonth) notes.push(`The RVD's newest month (${monthWords(lastMonth)}) is marked unreliable or blank for this cell, so the latest usable month is shown.`);
  if (placeNote) notes.push(placeNote);

  return buildStatisticAnswer({
    ...base,
    value: hit.cell.value,
    period: monthRange(month),
    reference_period: month,
    note: notes.join(" "),
    describe: (v) =>
      `The average rent of ${CLASS_LABEL[cls]} private flats in ${regionName} was ${hkd(v)} per square metre of saleable area per month in ${monthWords(month)}` +
      (hit.cell.provisional ? " (provisional)" : "") + ". " +
      (yoy ? (yoy.change_percent === 0 ? "That is unchanged from a year earlier. " : `That is ${Math.abs(yoy.change_percent)}% ${yoy.change_percent > 0 ? "higher" : "lower"} than a year earlier (${hkd(yoy.value)}). `) : "") +
      "This is an official average, not an asking rent.",
    extra: {
      country_name: "Hong Kong",
      region: regionName,
      flat_class: { class: cls, label: CLASS_LABEL[cls] },
      reference_month: month,
      reference_month_label: monthWords(month),
      provisional: hit.cell.provisional,
      change_on_year_earlier: yoy,
      classes,
      last_12_months: recent,
      what_this_is: "Average monthly rent per square metre of saleable area of private domestic flats in the region, from the Rating and Valuation Department's tenancy records. Not an asking rent and not a single tenancy.",
      dataset: { name: "Private Domestic - Average Rents by Class (Property Market Statistics)", url: INFO.homepage, file: URL_RENTS },
      ...(placeNote ? { place_note: placeNote } : {}),
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

export async function hkRents(input: HkRentInput, fetcher: (url: string) => Promise<string> = fetchText): Promise<PriceAnswer> {
  // Validate the question before touching the network.
  if (!input.town || !input.town.trim()) {
    throw new InputError('Hong Kong: town is required. Give "Hong Kong" (Hong Kong Island), "Kowloon" or "New Territories", or a district such as Mong Kok or Sha Tin.');
  }
  resolveRegion(input.town);
  normaliseClass(input.flat_class);
  return hkRentAnswer(parseRents(await fetcher(URL_RENTS)), input);
}
