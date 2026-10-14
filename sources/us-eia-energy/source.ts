// United States: average residential electricity and natural gas prices by state, from the U.S. Energy Information Administration.
// Formats checked live on 2026-10-14 through the GitHub probe and a throwaway Vercel route. Two key-free files, both small:
//   Electricity: https://www.eia.gov/electricity/monthly/xls/table_5_06_a.xlsx  (Electric Power Monthly, table 5.6.A, about 19 KB; one sheet)
//     "Table 5.6.A. Average Price of Electricity to Ultimate Customers by End-Use Sector, by State, July 2026 and 2025 (Cents per Kilowatthour)":
//     row 2 holds the sectors (Residential, Commercial ... in every second column), row 3 "Census Division and State" + "July 2026" / "July 2025"
//     per sector, then one row per census division and per state, ending with "U.S. Total". Source line: Form EIA-861M (formerly EIA-826).
//   Natural gas: https://www.eia.gov/naturalgas/monthly/xls/ngm20vmall.xls  (Natural Gas Monthly, table 20, about 290 KB; sheet "Data 1")
//     "Average Price of NG Delivered to Residential Consumers" in dollars per thousand cubic feet: row 1 "Sourcekey" (N3010<ST>3, N3010US3),
//     row 2 "Date" + descriptions, then one row per month since January 1973 (an Excel date, the 15th of the month), 51 states + the U.S.
//     Some state-months are blank (EIA publishes no figure), for example Florida and Louisiana for May to July 2026.
// EIA publishes ONE average per state and month: no distribution, no number of customers, so the answer is an official statistic
// (value + measure "average", range fields null, sample_size null).
//
// The daily collector (harvest) reads both files and keeps in the price library, for every state and the U.S.: the newest month and the same
// month a year earlier, as items "electricity/YYYY-MM" and "gas/YYYY-MM" (the month is in the item because the two files are not always
// the same month; the row's date is the first day of the newer of the two). Requests are answered from there.

import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import { periodRange } from "../../lib/adapters";
import { excelDate, readXlsx } from "../../categories/rent/xlsx";
import type { Cell, Sheet } from "../../categories/rent/xlsx";
import { readLatestDay } from "../../lib/library/store";
import { MIN_PUBLISH } from "../../lib/stats";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { STATES, plain } from "../us-eia-fuel/areas";
import { readXls } from "../us-eia-fuel/xls";

export const ELECTRICITY_URL = "https://www.eia.gov/electricity/monthly/xls/table_5_06_a.xlsx";
export const ELECTRICITY_PAGE = "https://www.eia.gov/electricity/monthly/epm_table_grapher.php?t=epmt_5_6_a";
export const GAS_URL = "https://www.eia.gov/naturalgas/monthly/xls/ngm20vmall.xls";
export const GAS_PAGE = "https://www.eia.gov/dnav/ng/ng_pri_sum_a_EPG0_PRS_DMcf_m.htm";
export const COLLECTOR_USER_AGENT = "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)";

export const INFO: SourceInfo = {
  id: "us-eia-energy",
  country: "US (United States)",
  category: "energy (household electricity and gas prices)",
  name: "Average residential electricity price (Electric Power Monthly table 5.6.A) and residential natural gas price (Natural Gas Monthly table 20), by state",
  publisher: "U.S. Energy Information Administration (EIA)",
  what_is_recorded:
    "For each US state, DC and the U.S. as a whole, the average price of electricity sold to residential customers each month, in US cents per kilowatthour (from the monthly Form EIA-861M survey), " +
    "and the average price of natural gas delivered to residential consumers, in US dollars per thousand cubic feet. One published average per state and month; never an individual bill or utility.",
  price_type: "official_statistic",
  freshness:
    "Monthly: EIA adds a month to each table about two months after it ends (electricity in the last week of the month, natural gas at the month's end); our copy is refreshed daily and each answer states its month",
  licence:
    'Public domain. EIA states: "U.S. government publications are in the public domain and are not subject to copyright protection. You may use and/or distribute any of our data, files, databases, reports, graphs, charts, and other information products that are on our website or that you receive through our email distribution service. ' +
    'However, if you use or reproduce any of our information products, you should use an acknowledgment, which includes the publication date, such as: "Source: U.S. Energy Information Administration (Oct 2008)."" ' +
    "The EIA logo is a registered trademark and is not used here.",
  licence_url: "https://www.eia.gov/about/copyrights_reuse.php",
  attribution:
    `Source: U.S. Energy Information Administration, Electric Power Monthly, table 5.6.A (${ELECTRICITY_PAGE}) and Natural Gas Monthly, average price of natural gas sold to residential consumers, by state (${GAS_PAGE}). ` +
    "Public domain; EIA asks for an acknowledgment with the publication date. Prices are passed on as published; the dollar-per-kWh figure and the change on a year earlier are calculated by ProofPrice. ProofPrice is not endorsed by EIA.",
  homepage: "https://www.eia.gov/electricity/monthly/",
  limits:
    "State averages over all residential customers (revenue per unit sold), not a tariff, a supplier's offer or a quote for a particular home, and not business prices. " +
    "EIA labels the electricity figures preliminary estimates based on a cutoff model sample; it does not say how many customers or bills stand behind a figure. " +
    "Gas: EIA publishes no figure for some state-months (blank cells in its table, for example Florida and Louisiana for May to July 2026); then the answer uses the state's newest published month within a year and says so. " +
    "Electricity is in cents per kilowatthour, gas in US dollars per thousand cubic feet (Mcf), so the two cannot be compared directly. Each table lags the market by about two months.",
};

/** What the library's `n` column holds for an EIA average: the library keeps no row below MIN_PUBLISH records, and EIA publishes no count, so every row carries this placeholder. Answers report sample_size null. */
export const LIBRARY_N_PLACEHOLDER = MIN_PUBLISH;

export type Energy = "electricity" | "gas";

export const NATIONAL_KEY = "ALL";

// ---------- months ----------

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function monthWords(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  return m ? `${MONTH_NAMES[Number(m[2]) - 1]} ${m[1]}` : month;
}
export function acknowledgmentDate(month: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(month);
  return m ? `${MONTH_SHORT[Number(m[2]) - 1]} ${m[1]}` : month;
}
export function shiftMonth(month: string, delta: number): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month)!;
  const idx = Number(m[1]) * 12 + (Number(m[2]) - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}
/** "July 2026" -> "2026-07"; null if it is not a month heading. */
export function parseMonthHeading(text: unknown): string | null {
  const m = /^\s*([A-Za-z]+)\s+(\d{4})\s*$/.exec(String(text ?? ""));
  if (!m) return null;
  const i = MONTH_NAMES.findIndex((n) => n.toLowerCase() === m[1].toLowerCase());
  return i < 0 ? null : `${m[2]}-${String(i + 1).padStart(2, "0")}`;
}
function monthsBehind(month: string, today: Date): number {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  return m ? today.getUTCFullYear() * 12 + today.getUTCMonth() - (Number(m[1]) * 12 + Number(m[2]) - 1) : 0;
}

// ---------- states ----------

const STATE_BY_NAME = new Map(STATES.map((s) => [plain(s.name), s.code]));

/** "Texas", "tx", "District of Columbia", "DC", "U.S. Total", "" -> a library key ("TX", "DC", "ALL"); null if unknown. */
export function stateKey(text?: string): string | null {
  const t = plain(text ?? "");
  if (!t || ["us", "usa", "u s", "u s a", "united states", "u s total", "united states of america", "america", "national", "nationwide", "all"].includes(t)) return NATIONAL_KEY;
  if (["d c", "washington dc", "washington d c"].includes(t)) return "DC";
  const byName = STATE_BY_NAME.get(t);
  if (byName) return byName;
  const code = t.toUpperCase();
  return STATES.some((s) => s.code === code) ? code : null;
}

export function stateName(key: string): string {
  return key === NATIONAL_KEY ? "the United States" : STATES.find((s) => s.code === key)?.name ?? key;
}

// ---------- the two files (pure parsing) ----------

/** state key -> month "YYYY-MM" -> value as published */
export type MonthlyByState = Map<string, Map<string, number>>;

const norm = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();

/**
 * Table 5.6.A: the Residential columns hold the newest month and the same month a year earlier. Returns both values for every state and the U.S.
 * ("U.S. Total"); census-division rows are left out. Throws SourceError if the layout is not the one checked on 2026-10-14.
 */
export function parseElectricityTable(rows: Cell[][]): { latest: string; yearAgo: string; values: MonthlyByState } {
  const headerAt = rows.findIndex((r) => norm(r[0]) === "Census Division and State");
  if (headerAt < 1) throw new SourceError("The EIA electricity table has a new layout (no 'Census Division and State' header); this source needs updating.");
  const sectorRow = rows[headerAt - 1];
  const col = sectorRow.findIndex((c) => norm(c) === "Residential");
  if (col < 0) throw new SourceError("The EIA electricity table has a new layout (no 'Residential' column); this source needs updating.");
  const latest = parseMonthHeading(rows[headerAt][col]);
  const yearAgo = parseMonthHeading(rows[headerAt][col + 1]);
  if (!latest || !yearAgo || shiftMonth(latest, -12) !== yearAgo) {
    throw new SourceError("The EIA electricity table's residential columns are not 'month' and 'same month a year earlier'; this source needs updating.");
  }
  const values: MonthlyByState = new Map();
  for (const r of rows.slice(headerAt + 1)) {
    const name = norm(r[0]);
    const key = name === "U.S. Total" ? NATIONAL_KEY : STATE_BY_NAME.get(plain(name));
    if (!key) continue;
    const cur = r[col];
    const prev = r[col + 1];
    const m = new Map<string, number>();
    if (typeof cur === "number" && cur > 0 && cur < 200) m.set(latest, cur);
    if (typeof prev === "number" && prev > 0 && prev < 200) m.set(yearAgo, prev);
    if (m.size) values.set(key, m);
  }
  return { latest, yearAgo, values };
}

/** Natural Gas Monthly table 20, "Data 1": one column per state (series N3010<ST>3) and the U.S. (N3010US3), one row per month. Blank cells are left out. */
export function parseGasSheet(sheet: Sheet): MonthlyByState {
  const keyRow = sheet.rows.findIndex((r) => norm(r[0]) === "Sourcekey");
  const dateRow = sheet.rows.findIndex((r) => norm(r[0]) === "Date");
  if (keyRow < 0 || dateRow < 0) throw new SourceError("The EIA natural gas sheet has a new layout (no Sourcekey or Date row); this source needs updating.");
  const cols: { col: number; key: string }[] = [];
  sheet.rows[keyRow].forEach((c, col) => {
    const m = /^N3010([A-Z]{2})3$/.exec(norm(c));
    if (!m) return;
    const key = m[1] === "US" ? NATIONAL_KEY : STATES.some((s) => s.code === m[1]) ? m[1] : null;
    if (key) cols.push({ col, key });
  });
  const out: MonthlyByState = new Map();
  for (const { key } of cols) out.set(key, new Map());
  for (const row of sheet.rows.slice(dateRow + 1)) {
    const date = excelDate(row[0]);
    if (!date) continue;
    const month = date.slice(0, 7);
    for (const { col, key } of cols) {
      const v = row[col];
      if (typeof v === "number" && Number.isFinite(v) && v > 0 && v < 1000) out.get(key)!.set(month, v);
    }
  }
  return out;
}

export function findGasSheet(sheets: Sheet[]): Sheet {
  const hit = sheets.find((s) => norm(s.rows[0]?.[1]).endsWith("Average Price of NG Delivered to Residential Consumers") && /^Data 1:/.test(norm(s.rows[0]?.[1])));
  if (!hit) throw new SourceError("The EIA natural gas workbook has no 'Data 1: Average Price of NG Delivered to Residential Consumers' sheet; this source needs updating.");
  return hit;
}

function libraryRow(area: string, item: string, v: number): DailyRow {
  return { area, item, n: LIBRARY_N_PLACEHOLDER, median: v, low: v, high: v, min: v, max: v };
}

/** How far back a state's newest published gas month may be before we say EIA has no price for it. */
export const GAS_WINDOW_MONTHS = 12;

/**
 * Library rows: for every state and the U.S., electricity/<newest month> and electricity/<a year earlier>, and gas/<newest month the state has,
 * within GAS_WINDOW_MONTHS of the newest month any state has> and gas/<a year earlier>. The row date is the first day of the newer of the two months.
 */
export function energyRows(elec: { latest: string; values: MonthlyByState }, gas: MonthlyByState): { date: string; rows: DailyRow[]; electricityMonth: string; gasMonth: string } {
  const gasNational = gas.get(NATIONAL_KEY);
  if (!gasNational || !gasNational.size) throw new SourceError("The EIA natural gas sheet has no U.S. series; this source needs updating.");
  const gasMonth = [...gasNational.keys()].sort().pop()!;
  const rows: DailyRow[] = [];
  for (const [area, months] of elec.values) for (const [m, v] of months) rows.push(libraryRow(area, `electricity/${m}`, v));
  for (const [area, months] of gas) {
    let latest: string | null = null;
    for (let i = 0; i < GAS_WINDOW_MONTHS; i++) {
      const m = shiftMonth(gasMonth, -i);
      if (months.has(m)) {
        latest = m;
        break;
      }
    }
    if (!latest) continue;
    rows.push(libraryRow(area, `gas/${latest}`, months.get(latest)!));
    const y = shiftMonth(latest, -12);
    if (months.has(y)) rows.push(libraryRow(area, `gas/${y}`, months.get(y)!));
  }
  rows.sort((a, b) => a.area.localeCompare(b.area) || a.item.localeCompare(b.item));
  const newer = elec.latest > gasMonth ? elec.latest : gasMonth;
  return { date: `${newer}-01`, rows, electricityMonth: elec.latest, gasMonth };
}

async function download(url: string): Promise<Buffer> {
  let lastError = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120000);
    try {
      const res = await fetch(url, { headers: { "user-agent": COLLECTOR_USER_AGENT }, signal: controller.signal });
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      lastError = `HTTP ${res.status}`;
    } catch (e: any) {
      lastError = String(e?.cause?.code ?? e?.message ?? e);
    } finally {
      clearTimeout(timer);
    }
    await new Promise((r) => setTimeout(r, attempt * 3000));
  }
  throw new SourceError(`EIA file ${url} could not be downloaded (${lastError})`);
}

/** The daily collector: read the two EIA files and return the newest month of every state. */
export async function usEnergyHarvest(): Promise<HarvestResult> {
  const [elecBuf, gasBuf] = await Promise.all([download(ELECTRICITY_URL), download(GAS_URL)]);
  const sheets = readXlsx(elecBuf);
  const elecSheet = sheets.find((s) => s.rows.some((r) => norm(r[0]) === "Census Division and State"));
  if (!elecSheet) throw new SourceError("The EIA electricity workbook has no table 5.6.A sheet; this source needs updating.");
  const elec = parseElectricityTable(elecSheet.rows);
  const gas = parseGasSheet(findGasSheet(readXls(gasBuf)));
  const day = energyRows(elec, gas);
  if (!day.rows.length) throw new SourceError("EIA's electricity and gas tables held no usable prices");
  return {
    date: day.date,
    currency: "USD",
    unit: "electricity: US cents per kWh; gas: US dollars per thousand cubic feet",
    rows: day.rows,
    note:
      `EIA residential prices: electricity ${monthWords(day.electricityMonth)} (and a year earlier), natural gas ${monthWords(day.gasMonth)} (and a year earlier), ` +
      "for every state, DC and the U.S.; the month is in the item (electricity/YYYY-MM, gas/YYYY-MM). " +
      `EIA publishes one average per state and month, so low/high/min/max repeat it and n is the library minimum (${LIBRARY_N_PLACEHOLDER}), not a count of customers.`,
  };
}

// ---------- reading the library ----------

export interface Snapshot {
  date: string;
  /** "<area>|<energy>" -> month -> value as published */
  values: Map<string, Map<string, number>>;
}

export function snapshotOf(day: { date: string; rows: { area: string; item: string; median: number }[] }): Snapshot {
  const values = new Map<string, Map<string, number>>();
  for (const r of day.rows) {
    const m = /^(electricity|gas)\/(\d{4}-\d{2})$/.exec(r.item);
    if (!m || !(r.median > 0)) continue;
    const key = `${r.area}|${m[1]}`;
    let s = values.get(key);
    if (!s) values.set(key, (s = new Map()));
    s.set(m[2], r.median);
  }
  return { date: day.date, values };
}

export interface Reading {
  area: string;
  energy: Energy;
  month: string;
  value: number;
  yearAgo: { month: string; value: number } | null;
  /** The newest month any state has for this energy in the snapshot (the dataset's month). */
  datasetMonth: string;
}

export function readingFor(snap: Snapshot, area: string, energy: Energy): Reading | null {
  const s = snap.values.get(`${area}|${energy}`);
  if (!s || !s.size) return null;
  const month = [...s.keys()].sort().pop()!;
  const nat = snap.values.get(`${NATIONAL_KEY}|${energy}`);
  const datasetMonth = nat && nat.size ? [...nat.keys()].sort().pop()! : month;
  const prev = shiftMonth(month, -12);
  const y = s.get(prev);
  return { area, energy, month, value: s.get(month)!, yearAgo: y !== undefined ? { month: prev, value: y } : null, datasetMonth };
}

// ---------- the answer (pure) ----------

const roundTo = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;

export function usEnergyMethod(energy: Energy): string {
  return energy === "electricity"
    ? "The U.S. Energy Information Administration publishes, every month, the average price of electricity sold to residential customers in each state and the U.S., in cents per kilowatthour (Electric Power Monthly, table 5.6.A, from the monthly Form EIA-861M survey), " +
        "with the same month a year earlier. ProofPrice copies the table once a day and returns the published figure unchanged. No range is calculated: EIA gives one average and does not say how many customers or bills are behind it."
    : "The U.S. Energy Information Administration publishes, every month, the average price of natural gas delivered to residential consumers in each state and the U.S., in US dollars per thousand cubic feet (Natural Gas Monthly, table 20). " +
        "ProofPrice copies the table once a day and returns the published figure for the state's newest month, unchanged, with the same month a year earlier. No range is calculated: EIA gives one average and does not say how many customers or bills are behind it. " +
        "EIA publishes no figure for some state-months; the answer then uses the state's newest published month and says so.";
}

export interface UsEnergyQuery {
  energy: string;
  state?: string;
  baseUrl?: string;
  today?: Date;
}

export function normaliseEnergy(raw: string): Energy {
  const s = raw.trim().toLowerCase().replace(/[\s_-]+/g, " ");
  if (["electricity", "electric", "power"].includes(s)) return "electricity";
  if (["gas", "natural gas", "mains gas"].includes(s)) return "gas";
  throw new InputError('energy must be "electricity" or "gas".');
}

export function usEnergyAnswer(snap: Snapshot, energy: Energy, area: string, q: UsEnergyQuery): PriceAnswer {
  const today = q.today ?? new Date();
  const name = stateName(area);
  const query: Record<string, unknown> = { country: "US", energy, ...(q.state ? { state: q.state } : {}) };
  const isElec = energy === "electricity";
  const unit = isElec ? "cents per kWh" : "per thousand cubic feet (Mcf)";
  const base = { source: INFO, query, measure: "average" as const, currency: "USD", unit, method: usEnergyMethod(energy), baseUrl: q.baseUrl };

  const r = readingFor(snap, area, energy);
  if (!r) {
    const none = buildStatisticAnswer({ ...base, value: null, period: { from: null, to: null }, reference_period: "", describe: () => "" });
    return {
      ...none,
      summary: isElec
        ? `EIA's Electric Power Monthly has no residential electricity price for ${name} in table 5.6.A.`
        : `EIA's Natural Gas Monthly has no residential natural gas price for ${name} in the last ${GAS_WINDOW_MONTHS} months (EIA's table leaves those state-months blank).`,
    };
  }

  const nat = area === NATIONAL_KEY ? null : readingFor(snap, NATIONAL_KEY, energy);
  const behind = monthsBehind(r.month, today);
  const notes: string[] = [];
  if (r.month < r.datasetMonth) {
    notes.push(`EIA has no ${energy === "gas" ? "natural gas" : "electricity"} price for ${name} for ${monthWords(r.datasetMonth)} (its table leaves that state-month blank); this is ${name}'s newest published month, ${monthWords(r.month)}.`);
  }
  if (isElec) notes.push("EIA labels these values preliminary estimates based on a cutoff model sample.");
  if (behind >= 5) notes.push(`Old data: the newest month in our copy of EIA's table is ${monthWords(r.month)}, ${behind} months ago.`);

  const change = r.yearAgo
    ? {
        reference_month: r.yearAgo.month,
        value: r.yearAgo.value,
        change_amount: roundTo(r.value - r.yearAgo.value, 3),
        change_percent: roundTo(((r.value - r.yearAgo.value) / r.yearAgo.value) * 100, 1),
      }
    : null;
  const num = (v: number) => (isElec ? `${v.toFixed(2)} cents` : `$${v.toFixed(2)}`);
  const per = isElec ? "per kilowatthour (kWh)" : "per thousand cubic feet";
  const what = isElec ? "residential electricity" : "residential natural gas";
  const where = area === NATIONAL_KEY ? "the United States" : name;

  const extra: Record<string, unknown> = {
    country_name: "United States",
    energy,
    state: area === NATIONAL_KEY ? { code: "US", name: "United States", scope: "national average" } : { code: area, name },
    customers: "residential",
    reference_month: r.month,
    reference_month_label: monthWords(r.month),
    unit_note: isElec ? "US cents per kilowatthour (100 cents = 1 US dollar)." : "US dollars per thousand cubic feet (Mcf) of natural gas.",
    ...(isElec ? { price_usd_per_kwh: roundTo(r.value / 100, 4) } : {}),
    change_on_year_earlier: change,
    ...(change ? {} : { change_on_year_earlier_unavailable: "EIA holds no price for this state in the same month a year earlier." }),
    ...(nat ? { us_average: { value: nat.value, reference_month: nat.month, unit } } : {}),
    ...(r.month < r.datasetMonth ? { newest_month_in_dataset: r.datasetMonth } : {}),
    dataset: isElec
      ? { name: "Electric Power Monthly, table 5.6.A", file: ELECTRICITY_URL, page: ELECTRICITY_PAGE, sector: "Residential", form: "EIA-861M" }
      : { name: "Natural Gas Monthly, table 20 (average price of natural gas sold to residential consumers, by state)", file: GAS_URL, page: GAS_PAGE },
  };

  const answer = buildStatisticAnswer({
    ...base,
    value: r.value,
    period: periodRange(r.month) ?? { from: null, to: null },
    reference_period: r.month,
    note: notes.length ? notes.join(" ") : undefined,
    describe: (v) =>
      `In ${where} the average ${what} price was ${num(v)} ${per} in ${monthWords(r.month)}` +
      (isElec ? ` (about $${(v / 100).toFixed(4)} per kWh)` : "") +
      "." +
      (change
        ? change.change_percent === 0
          ? ` That is unchanged from a year earlier (${num(change.value)} in ${monthWords(change.reference_month)}).`
          : ` That is ${Math.abs(change.change_percent)}% ${change.change_percent > 0 ? "higher" : "lower"} than a year earlier (${num(change.value)} in ${monthWords(change.reference_month)}).`
        : " EIA has no price for the same month a year earlier.") +
      (nat ? ` The U.S. average was ${num(nat.value)} in ${monthWords(nat.month)}.` : "") +
      (r.month < r.datasetMonth ? ` EIA has no figure for ${name} for ${monthWords(r.datasetMonth)}.` : "") +
      (behind >= 5 ? ` Old data: this is the newest month in our copy, ${behind} months ago.` : ""),
    extra,
  });
  // EIA asks for an acknowledgment that includes the publication date; the month the figure describes is the closest we hold.
  return { ...answer, source: { ...answer.source, attribution: `Source: U.S. Energy Information Administration (${acknowledgmentDate(r.month)}). ${INFO.attribution}` } };
}

// ---------- the request ----------

export async function usEnergy(q: UsEnergyQuery): Promise<PriceAnswer> {
  const energy = normaliseEnergy(String(q.energy ?? ""));
  const area = stateKey(q.state);
  if (!area) {
    throw new InputError(`state must be a US state name or two-letter code (for example TX, Texas or DC), or left out for the U.S. average. Not recognised: ${q.state}.`);
  }
  const day = readLatestDay(INFO.id);
  if (!day) throw new SourceError("ProofPrice has not collected EIA's residential energy prices yet; data appears after the next daily collection.");
  return usEnergyAnswer(snapshotOf(day), energy, area, q);
}
