// United Kingdom: prices of electricity and gas bought by non-domestic (business) consumers, from DESNZ's Quarterly Energy Prices
// tables 3.4.1 (excluding the Climate Change Levy) and 3.4.2 (including it). Format checked live on 2026-10-21 through the GitHub probe:
//  - GET https://www.gov.uk/api/content/government/statistical-data-sets/gas-and-electricity-prices-in-the-non-domestic-sector lists the
//    attachment (details.attachments[0], title "Prices of fuels purchased by non-domestic consumers in the United Kingdom excluding/including
//    CCL (QEP 3.4.1 and 3.4.2)", file table_341.xlsx, about 270 kB). The file sits at an asset URL with a changing hash, so we always look it up.
//  - sheets "3.4.1 (excl CCL)" and "3.4.2 (incl CCL)" (quarterly) and "3.4.1 (Annual excl CCL)" / "3.4.2 (Annual inc CCL)": a few title and note rows,
//    then "Year | Quarter | Electricity: Very Small (Pence per kWh) | ... Extra Large | Electricity: Average | Gas: Very Small ... Very Large | Gas: Average",
//    one row per quarter from 2004 ("1st".."4th"); the annual sheets have no Quarter column. Blank cells = not collected (Extra Large before 2007).
//    The sheet "Notes" defines the size bands in MWh a year. Newest quarter is provisional ("p" marks provisional rows in the date column).
// DESNZ publishes ONE average per size band and quarter (total value / total quantity bought, from a survey of energy suppliers): no distribution
// and no count, so the answer is an official statistic (value + measure "average", range fields null, sample_size null).
// The workbook is 270 kB, read per request (cached in memory for six hours); there is no collector for it.

import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import { periodRange } from "../../lib/adapters";
import { downloadFile, govukContent, xlsxAttachments } from "../../lib/gov-uk";
import { readXlsx } from "../../categories/rent/xlsx";
import type { Cell, Sheet } from "../../categories/rent/xlsx";
import type { SourceInfo } from "../../lib/plugin";

export const PAGE_PATH = "/government/statistical-data-sets/gas-and-electricity-prices-in-the-non-domestic-sector";
export const HOMEPAGE = "https://www.gov.uk/government/statistical-data-sets/gas-and-electricity-prices-in-the-non-domestic-sector";

export const INFO: SourceInfo = {
  id: "gb-desnz-energy-business",
  country: "GB (United Kingdom, business)",
  category: "energy (business electricity and gas prices)",
  name: "Prices of fuels purchased by non-domestic consumers in the United Kingdom (Quarterly Energy Prices tables 3.4.1 and 3.4.2)",
  publisher: "Department for Energy Security and Net Zero (DESNZ)",
  what_is_recorded:
    "For each quarter and size band (by annual consumption), the average price in pence per kWh paid by non-domestic (business) consumers in the United Kingdom for electricity and for gas, " +
    "excluding VAT, both excluding and including the Climate Change Levy: total value divided by total quantity bought, from DESNZ's survey of energy suppliers. One published figure per cell; never individual bills or suppliers.",
  price_type: "official_statistic",
  freshness: "Quarterly (DESNZ updates the tables at the end of March, June, September and December, about three months after the quarter ends); each answer states its quarter, and the newest quarter is provisional",
  licence:
    'Open Government Licence v3.0 (GOV.UK: "All content is available under the Open Government Licence v3.0, except where otherwise stated"); Crown copyright',
  licence_url: "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/",
  attribution:
    "Contains public sector information licensed under the Open Government Licence v3.0. Source: Department for Energy Security and Net Zero, Quarterly Energy Prices tables 3.4.1 and 3.4.2, " +
    "Gas and electricity prices in the non-domestic sector. Prices are passed on as published (in pence per kWh); the pounds-per-kWh figure and the changes between quarters are calculated by ProofPrice.",
  homepage: HOMEPAGE,
  limits:
    "Official averages by size band of non-domestic consumers across the whole United Kingdom, not a quote, tariff or offer from any supplier and not household prices. " +
    "Prices exclude VAT (which businesses normally reclaim); the Climate Change Levy is shown either way. DESNZ does not say how many consumers or contracts stand behind a figure; " +
    "the newest quarter is provisional and recent quarters are revised, and the smallest electricity band has had data-quality revisions. The figures lag the market by about three months. " +
    "There is no gas band above 'Very Large' (1,111,112 MWh a year), so Eurostat band I6 has no UK figure.",
};

// ---------- bands ----------

export type Energy = "electricity" | "gas";
export type Taxes = "all" | "excl_vat" | "none";

export interface GbBand {
  /** The name as DESNZ's column headings write it ("Small/Medium"). */
  name: string;
  /** Lower-case lookup key. */
  key: string;
  /** The Eurostat band with the same annual consumption (IC for electricity "Small/Medium"), for callers who know the EU bands. */
  eu: string | null;
  help: string;
}

export const AVERAGE_KEY = "average";

export const BANDS: Record<Energy, GbBand[]> = {
  electricity: [
    { name: "Very Small", key: "very small", eu: "IA", help: "under 20 MWh a year" },
    { name: "Small", key: "small", eu: "IB", help: "20 to 499 MWh a year" },
    { name: "Small/Medium", key: "small/medium", eu: "IC", help: "500 to 1,999 MWh a year" },
    { name: "Medium", key: "medium", eu: "ID", help: "2,000 to 19,999 MWh a year" },
    { name: "Large", key: "large", eu: "IE", help: "20,000 to 69,999 MWh a year" },
    { name: "Very Large", key: "very large", eu: "IF", help: "70,000 to 150,000 MWh a year" },
    { name: "Extra Large", key: "extra large", eu: "IG", help: "over 150,000 MWh a year" },
  ],
  gas: [
    { name: "Very Small", key: "very small", eu: "I1", help: "under 278 MWh a year" },
    { name: "Small", key: "small", eu: "I2", help: "278 to 2,777 MWh a year" },
    { name: "Medium", key: "medium", eu: "I3", help: "2,778 to 27,777 MWh a year" },
    { name: "Large", key: "large", eu: "I4", help: "27,778 to 277,777 MWh a year" },
    { name: "Very Large", key: "very large", eu: "I5", help: "277,778 to 1,111,112 MWh a year" },
  ],
};
const AVERAGE_BAND: GbBand = { name: "Average", key: AVERAGE_KEY, eu: null, help: "all size bands together (average over all non-domestic consumers)" };

export const DEFAULT_BAND: Record<Energy, string> = { electricity: "small/medium", gas: "medium" };

/** "Small/Medium", "small_medium", "IC", "I3", "average", "" -> the band. Empty -> the reference band (Small/Medium electricity = Eurostat IC, Medium gas = I3). */
export function normaliseGbBand(energy: Energy, raw?: string): GbBand {
  const s = (raw ?? "").trim();
  if (!s) return BANDS[energy].find((b) => b.key === DEFAULT_BAND[energy])!;
  const key = s.toLowerCase().replace(/[\s_-]+/g, " ").replace(/\s*\/\s*/g, "/");
  if (["average", "all", "total", "tot", "avg"].includes(key)) return AVERAGE_BAND;
  const byName = BANDS[energy].find((b) => b.key === key || b.key.replace(/ /g, "") === key.replace(/ /g, "") || b.key.replace("/", " ") === key);
  if (byName) return byName;
  const letter = s.toUpperCase();
  const byEu = BANDS[energy].find((b) => b.eu === letter);
  if (byEu) return byEu;
  if (energy === "gas" && letter === "I6") {
    throw new InputError("DESNZ has no gas band above Very Large (277,778 to 1,111,112 MWh a year, Eurostat I5): there is no UK figure for Eurostat band I6.");
  }
  throw new InputError(
    `consumption_band for UK business ${energy} must be one of: ${BANDS[energy].map((b) => `${b.name} (${b.eu})`).join(", ")}, or Average. Default ${normaliseGbBand(energy).name}.`,
  );
}

export type CclBasis = "excl_ccl" | "incl_ccl";

/** DESNZ prices never include VAT. taxes "none" = excluding the Climate Change Levy (table 3.4.1); "excl_vat" (default) and "all" = including it (3.4.2). */
export function cclBasis(taxes: Taxes): { basis: CclBasis; note: string | null } {
  if (taxes === "none") return { basis: "excl_ccl", note: null };
  if (taxes === "all") return { basis: "incl_ccl", note: "DESNZ prices never include VAT (businesses normally reclaim it); this is the closest figure to 'all taxes', including the Climate Change Levy but excluding VAT." };
  return { basis: "incl_ccl", note: null };
}

// ---------- the workbook (pure parsing) ----------

const norm = (c: Cell): string => String(c ?? "").replace(/\s+/g, " ").trim();
const QUARTER_WORDS: Record<string, number> = { "1st": 1, "2nd": 2, "3rd": 3, "4th": 4 };

export interface PriceRow {
  /** "2026-Q2" for a quarter, "2025" for a year. */
  period: string;
  /** "p" / "r" markers DESNZ writes next to the date, if any. */
  flag: string;
  /** "electricity/small/medium", "gas/average": pence per kWh as published. */
  values: Record<string, number>;
}

export interface Table {
  quarterly: PriceRow[];
  annual: PriceRow[];
}

export interface Workbook {
  excl_ccl: Table;
  incl_ccl: Table;
}

function parseDate(cell: Cell): { year: number; flag: string } | null {
  const m = /^(\d{4})\s*([a-z]*)$/i.exec(norm(cell));
  return m ? { year: Number(m[1]), flag: m[2].toLowerCase() } : null;
}

function parseQuarter(cell: Cell): { q: number; flag: string } | null {
  const m = /^([1-4](?:st|nd|rd|th))\s*([a-z]*)$/i.exec(norm(cell));
  return m ? { q: QUARTER_WORDS[m[1].toLowerCase()], flag: m[2].toLowerCase() } : null;
}

/** One of the four price sheets: find the "Year" header, map each "Electricity: <band> (Pence per kWh)" / "Gas: <band> (...)" column, and read the rows. */
export function parsePriceSheet(sheet: Sheet, quarterly: boolean): PriceRow[] {
  const at = sheet.rows.findIndex((r) => norm(r[0]) === "Year");
  if (at < 0) throw new SourceError(`The DESNZ sheet "${sheet.name}" has no 'Year' header row; this source needs updating.`);
  const head = sheet.rows[at].map(norm);
  const cols: { col: number; key: string }[] = [];
  head.forEach((h, col) => {
    const m = /^(Electricity|Gas):\s*(.+?)\s*\(Pence per kWh\)$/i.exec(h);
    if (m) cols.push({ col, key: `${m[1].toLowerCase()}/${m[2].toLowerCase()}` });
  });
  if (!cols.length) throw new SourceError(`The DESNZ sheet "${sheet.name}" has no price columns; this source needs updating.`);
  if (quarterly && norm(sheet.rows[at][1]) !== "Quarter") throw new SourceError(`The DESNZ sheet "${sheet.name}" has no 'Quarter' column; this source needs updating.`);
  const out: PriceRow[] = [];
  for (const r of sheet.rows.slice(at + 1)) {
    const d = parseDate(r[0]);
    if (!d) continue;
    let period = String(d.year);
    let flag = d.flag;
    if (quarterly) {
      const q = parseQuarter(r[1]);
      if (!q) continue;
      period = `${d.year}-Q${q.q}`;
      flag = `${flag}${q.flag}`;
    }
    const values: Record<string, number> = {};
    for (const { col, key } of cols) {
      const v = r[col];
      if (typeof v === "number" && Number.isFinite(v) && v > 0 && v < 1000) values[key] = v;
    }
    out.push({ period, flag, values });
  }
  if (!out.length) throw new SourceError(`The DESNZ sheet "${sheet.name}" has no rows; this source needs updating.`);
  return out;
}

/** The four sheets of table_341.xlsx, found by name ("3.4.1 (excl CCL)", "3.4.1 (Annual excl CCL)", "3.4.2 (incl CCL)", "3.4.2 (Annual inc CCL)"). */
export function parseWorkbook(sheets: Sheet[]): Workbook {
  const find = (prefix: string, annual: boolean): Sheet => {
    const hit = sheets.find((s) => s.name.startsWith(prefix) && /annual/i.test(s.name) === annual);
    if (!hit) throw new SourceError(`The DESNZ workbook has no ${annual ? "annual " : "quarterly "}sheet for table ${prefix}; this source needs updating.`);
    return hit;
  };
  return {
    excl_ccl: { quarterly: parsePriceSheet(find("3.4.1", false), true), annual: parsePriceSheet(find("3.4.1", true), false) },
    incl_ccl: { quarterly: parsePriceSheet(find("3.4.2", false), true), annual: parsePriceSheet(find("3.4.2", true), false) },
  };
}

// ---------- finding and reading the file ----------

/** The Excel attachment of the release page (title mentions QEP 3.4.1). */
export function workbookUrl(page: any): string {
  const a = xlsxAttachments(page, /3\.4\.1/)[0] ?? xlsxAttachments(page)[0];
  if (!a) throw new SourceError("The DESNZ release page lists no Excel file; this source needs updating.");
  return a.url;
}

let cached: { at: number; book: Workbook } | null = null;
const CACHE_MS = 6 * 60 * 60 * 1000;

export async function loadWorkbook(now = Date.now()): Promise<Workbook> {
  if (cached && now - cached.at < CACHE_MS) return cached.book;
  const page = await govukContent(PAGE_PATH);
  const buf = await downloadFile(workbookUrl(page), 5_000_000);
  const book = parseWorkbook(readXlsx(buf));
  cached = { at: now, book };
  return book;
}

// ---------- reading a figure (pure) ----------

const roundTo = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;

export interface GbReading {
  energy: Energy;
  band: GbBand;
  basis: CclBasis;
  period: string; // "2026-Q2"
  pence: number;
  flag: string;
  newestQuarter: string; // newest quarter in the table (any band)
  previous: { period: string; pence: number; change_percent: number } | null;
  yearAgo: { period: string; pence: number; change_percent: number } | null;
  allBands: { band: string; eu_band: string | null; pence: number }[];
  annual: { year: string; pence: number } | null;
}

export function previousQuarter(p: string): string {
  const m = /^(\d{4})-Q([1-4])$/.exec(p)!;
  return m[2] === "1" ? `${Number(m[1]) - 1}-Q4` : `${m[1]}-Q${Number(m[2]) - 1}`;
}
export function yearAgoQuarter(p: string): string {
  const m = /^(\d{4})-Q([1-4])$/.exec(p)!;
  return `${Number(m[1]) - 1}-Q${m[2]}`;
}

export function quarterWords(p: string): string {
  const m = /^(\d{4})-Q([1-4])$/.exec(p);
  return m ? `the ${["first", "second", "third", "fourth"][Number(m[2]) - 1]} quarter of ${m[1]}` : p;
}

export function readGb(book: Workbook, q: { energy: Energy; band: GbBand; taxes: Taxes }): GbReading | null {
  const { basis } = cclBasis(q.taxes);
  const table = book[basis];
  const key = `${q.energy}/${q.band.key}`;
  const have = table.quarterly.filter((r) => r.values[key] !== undefined);
  if (!have.length) return null;
  const latest = have.reduce((a, r) => (r.period > a.period ? r : a));
  const pence = latest.values[key];
  const at = (period: string): number | undefined => table.quarterly.find((r) => r.period === period)?.values[key];
  const change = (period: string) => {
    const v = at(period);
    return v !== undefined ? { period, pence: v, change_percent: roundTo(((pence - v) / v) * 100, 1) } : null;
  };
  const allBands = [...BANDS[q.energy], AVERAGE_BAND]
    .map((b) => ({ band: b.name, eu_band: b.eu, pence: latest.values[`${q.energy}/${b.key}`] }))
    .filter((b): b is { band: string; eu_band: string | null; pence: number } => b.pence !== undefined);
  const newestQuarter = table.quarterly.reduce((a, r) => (r.period > a ? r.period : a), "");
  const lastYear = table.annual.filter((r) => r.values[key] !== undefined).reduce<PriceRow | null>((a, r) => (!a || r.period > a.period ? r : a), null);
  return {
    energy: q.energy,
    band: q.band,
    basis,
    period: latest.period,
    pence,
    flag: latest.flag,
    newestQuarter,
    previous: change(previousQuarter(latest.period)),
    yearAgo: change(yearAgoQuarter(latest.period)),
    allBands,
    annual: lastYear ? { year: lastYear.period, pence: lastYear.values[key] } : null,
  };
}

// ---------- the answer (pure) ----------

const WORD: Record<Energy, string> = { electricity: "electricity", gas: "gas" };

function pence(v: number): string {
  return `${v.toFixed(2)} pence`;
}

function plainChange(c: { change_percent: number } | null, versus: string): string {
  if (!c) return "";
  if (c.change_percent === 0) return ` That is unchanged from ${versus}.`;
  return ` That is ${Math.abs(c.change_percent)}% ${c.change_percent > 0 ? "higher" : "lower"} than ${versus}.`;
}

function yearSentence(c: { change_percent: number } | null): string {
  if (!c) return "";
  if (c.change_percent === 0) return " Against the same quarter a year earlier it is unchanged.";
  return ` Against the same quarter a year earlier it is ${Math.abs(c.change_percent)}% ${c.change_percent > 0 ? "higher" : "lower"}.`;
}

export function gbAnswer(reading: GbReading | null, q: { energy: Energy; band: GbBand; taxes: Taxes; baseUrl?: string }): PriceAnswer {
  const { basis, note: basisNote } = cclBasis(q.taxes);
  const basisWords = basis === "incl_ccl" ? "excluding VAT, including the Climate Change Levy" : "excluding VAT and the Climate Change Levy";
  const query = { country: "GB", sector: "business", energy: q.energy, consumption_band: q.band.name, taxes: q.taxes };
  const method =
    `DESNZ publishes every quarter the average price in pence per kWh that non-domestic consumers in the United Kingdom paid for ${WORD[q.energy]}, by size band of annual consumption ` +
    "(Quarterly Energy Prices tables 3.4.1 excluding and 3.4.2 including the Climate Change Levy; total value divided by total quantity bought, from a survey of energy suppliers). " +
    "ProofPrice returns the published figure for the newest quarter, converted from pence to pounds per kWh, with the other size bands, the previous quarter, the same quarter a year earlier and the latest calendar-year average. " +
    "No range is calculated: DESNZ gives one average and does not say how many consumers or contracts are behind it.";
  const base = { source: INFO, query, measure: "average" as const, currency: "GBP", unit: "per kWh", method, baseUrl: q.baseUrl };

  if (!reading) {
    const none = buildStatisticAnswer({ ...base, value: null, period: { from: null, to: null }, reference_period: "", describe: () => "" });
    return { ...none, summary: `DESNZ publishes no ${WORD[q.energy]} price for the ${q.band.name} size band of non-domestic consumers (${q.band.help}) in this table.` };
  }

  const r = reading;
  const notes: string[] = [];
  if (basisNote) notes.push(basisNote);
  if (r.flag.includes("p") || r.period === r.newestQuarter) notes.push("DESNZ treats the newest quarter as provisional: it may be revised in the next release.");
  if (r.flag.includes("r")) notes.push("DESNZ marks this figure as revised.");
  if (r.energy === "electricity" && r.band.key === "very small") notes.push("DESNZ warns that the Very Small electricity series has been revised from Q4 2024 and may be revised again.");
  if (r.period < r.newestQuarter) notes.push(`This is the newest ${r.band.name} figure DESNZ holds; ${quarterWords(r.newestQuarter)} is published for other bands.`);

  const gbp = r.pence / 100;
  const extra: Record<string, unknown> = {
    sector: "business",
    energy: q.energy,
    country_name: "United Kingdom",
    consumption_band: { name: r.band.name, eu_equivalent_band: r.band.eu, annual_consumption: r.band.help },
    taxes: { level: q.taxes, basis: basis === "incl_ccl" ? "excluding VAT, including the Climate Change Levy (table 3.4.2)" : "excluding VAT and the Climate Change Levy (table 3.4.1)" },
    reference_period_label: quarterWords(r.period),
    pence_per_kwh: roundTo(r.pence, 3),
    ...(r.flag ? { data_flag: r.flag } : {}),
    previous_quarter: r.previous ? { reference_period: r.previous.period, pence_per_kwh: roundTo(r.previous.pence, 3), change_percent: r.previous.change_percent } : null,
    same_quarter_a_year_earlier: r.yearAgo ? { reference_period: r.yearAgo.period, pence_per_kwh: roundTo(r.yearAgo.pence, 3), change_percent: r.yearAgo.change_percent } : null,
    ...(r.annual ? { latest_calendar_year: { year: r.annual.year, pence_per_kwh: roundTo(r.annual.pence, 3) } } : {}),
    all_bands_pence_per_kwh: r.allBands.map((b) => ({ band: b.band, eu_equivalent_band: b.eu_band, pence_per_kwh: roundTo(b.pence, 3) })),
    dataset: { name: "Quarterly Energy Prices tables 3.4.1 and 3.4.2 (table_341.xlsx)", page: HOMEPAGE, newest_quarter_in_table: r.newestQuarter },
  };

  return buildStatisticAnswer({
    ...base,
    value: gbp,
    period: periodRange(r.period) ?? { from: null, to: null },
    reference_period: r.period,
    note: notes.length ? notes.join(" ") : undefined,
    describe: () =>
      `In the United Kingdom the official average price paid by businesses (non-domestic consumers) for ${WORD[q.energy]} in size band ${r.band.name}` +
      `${r.band.eu ? ` (Eurostat band ${r.band.eu})` : ""}, ${r.band.help}, was ${pence(r.pence)} per kWh (£${gbp.toFixed(4)}) in ${quarterWords(r.period)}, ${basisWords}.` +
      plainChange(r.previous, `in ${quarterWords(r.previous?.period ?? "")}`) +
      yearSentence(r.yearAgo),
    extra,
  });
}

// ---------- the request ----------

export async function gbBusinessEnergy(
  input: { energy: string; consumption_band?: string; taxes?: string; baseUrl?: string },
  load: () => Promise<Workbook> = () => loadWorkbook(),
): Promise<PriceAnswer> {
  const s = input.energy.trim().toLowerCase().replace(/[\s_-]+/g, " ");
  const energy: Energy | null = ["electricity", "electric", "power"].includes(s) ? "electricity" : ["gas", "natural gas", "mains gas"].includes(s) ? "gas" : null;
  if (!energy) throw new InputError('energy must be "electricity" or "gas".');
  const band = normaliseGbBand(energy, input.consumption_band);
  const t = (input.taxes ?? "excl_vat").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!["all", "excl_vat", "none"].includes(t)) throw new InputError('taxes must be "all", "excl_vat" (default) or "none".');
  const taxes = t as Taxes;
  const book = await load();
  return gbAnswer(readGb(book, { energy, band, taxes }), { energy, band, taxes, baseUrl: input.baseUrl });
}
