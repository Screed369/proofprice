// United States: average COMMERCIAL-sector electricity and natural gas prices by state, from the U.S. Energy Information Administration.
// Formats checked live on 2026-10-21 through the GitHub probe:
//   Electricity: https://www.eia.gov/electricity/monthly/xls/table_5_06_a.xlsx (Electric Power Monthly, table 5.6.A, about 19 KB, one sheet): row 3 holds the
//     sectors (Residential, Commercial, Industrial, ...) over two columns each, row 4 "Census Division and State" + "July 2026" / "July 2025" per sector,
//     then one row per census division and per state, ending with "U.S. Total". Cents per kilowatthour. (The household source reads the Residential columns of the same file.)
//   Natural gas: https://www.eia.gov/dnav/ng/ng_pri_sum_a_EPG0_PCS_DMcf_m.htm (Natural Gas Prices, "Commercial Price", monthly, dollars per thousand cubic feet, about 43 KB of HTML):
//     header cells <th class="Series5">Feb-26</th> ... for the six newest months, then one <tr class="DataRow"> per area ("U.S." in <B>, then 51 states) with
//     <td class="DataB"> / <td class="Current2"> value cells and a "View History" link. Cells can hold "NA", "W", "-" or "--" instead of a number. "Release Date: 9/30/2026" in the notes.
// EIA publishes ONE average per sector, state and month: no distribution, no number of customers, so the answer is an official statistic
// (value + measure "average", range fields null, sample_size null). "Commercial" is EIA's sector for shops, offices, hospitals, schools, government and other
// service businesses; the industrial sector's electricity price (factories) is added to the answer as extra information.
// Both files are small, so they are read per request and cached in memory for six hours; there is no collector for this source.

import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import { periodRange } from "../../lib/adapters";
import { readXlsx } from "../../categories/rent/xlsx";
import type { Cell, Sheet } from "../../categories/rent/xlsx";
import type { SourceInfo } from "../../lib/plugin";
import { ELECTRICITY_PAGE, ELECTRICITY_URL, NATIONAL_KEY, acknowledgmentDate, monthWords, parseMonthHeading, shiftMonth, stateKey, stateName } from "../us-eia-energy/source";

export { NATIONAL_KEY, stateKey, stateName };
export const GAS_URL = "https://www.eia.gov/dnav/ng/ng_pri_sum_a_EPG0_PCS_DMcf_m.htm";
export const USER_AGENT = "ProofPrice/1.0 (+https://proofprice.com; hello@proofprice.com)";

export const INFO: SourceInfo = {
  id: "us-eia-energy-business",
  country: "US (United States, business)",
  category: "energy (business electricity and gas prices)",
  name: "Average commercial-sector electricity price (Electric Power Monthly table 5.6.A) and commercial natural gas price (Natural Gas Prices, commercial), by state",
  publisher: "U.S. Energy Information Administration (EIA)",
  what_is_recorded:
    "For each US state, DC and the U.S. as a whole, the average price of electricity sold to commercial-sector customers (shops, offices, hospitals, schools and other service businesses) each month, in US cents per kilowatthour " +
    "(from the monthly Form EIA-861M survey; the industrial-sector price is added alongside), and the average price of natural gas delivered to commercial consumers, in US dollars per thousand cubic feet. One published average per state and month; never an individual bill or utility.",
  price_type: "official_statistic",
  freshness:
    "Monthly: EIA adds a month to each table about two months after it ends (electricity in the last week of the month, natural gas at the month's end); each answer states its month",
  licence:
    'Public domain. EIA states: "U.S. government publications are in the public domain and are not subject to copyright protection. You may use and/or distribute any of our data, files, databases, reports, graphs, charts, and other information products that are on our website or that you receive through our email distribution service. ' +
    'However, if you use or reproduce any of our information products, you should use an acknowledgment, which includes the publication date, such as: "Source: U.S. Energy Information Administration (Oct 2008)."" ' +
    "The EIA logo is a registered trademark and is not used here.",
  licence_url: "https://www.eia.gov/about/copyrights_reuse.php",
  attribution:
    `Source: U.S. Energy Information Administration, Electric Power Monthly, table 5.6.A (${ELECTRICITY_PAGE}) and Natural Gas Prices, average commercial price by state (${GAS_URL}). ` +
    "Public domain; EIA asks for an acknowledgment with the publication date. Prices are passed on as published; the dollar-per-kWh figure and the changes between months are calculated by ProofPrice. ProofPrice is not endorsed by EIA.",
  homepage: "https://www.eia.gov/electricity/monthly/",
  limits:
    "State averages over all commercial-sector customers (revenue per unit sold), not a tariff, a supplier's offer or a quote for a particular business, and not household prices. " +
    "There are no consumption bands: EIA publishes one average per state, so a small shop and a large hospital share one figure. Utilities classify commercial and industrial customers differently, so the line between the two varies by state. " +
    "EIA labels the electricity figures preliminary estimates based on a cutoff model sample; it does not say how many customers or bills stand behind a figure. " +
    "Electricity is in cents per kilowatthour (shown also in dollars per kWh), gas in US dollars per thousand cubic feet (Mcf), so the two cannot be compared directly. Each table lags the market by about two months. " +
    "EIA leaves some state-months blank (NA or withheld), then the answer uses the state's newest published month and says so.",
};

export type Energy = "electricity" | "gas";

export function normaliseEnergy(raw: string): Energy {
  const s = raw.trim().toLowerCase().replace(/[\s_-]+/g, " ");
  if (["electricity", "electric", "power"].includes(s)) return "electricity";
  if (["gas", "natural gas", "mains gas"].includes(s)) return "gas";
  throw new InputError('energy must be "electricity" or "gas".');
}

const norm = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();

// ---------- electricity: table 5.6.A (pure parsing) ----------

export interface ElecRow {
  commercial: Map<string, number>; // month -> cents per kWh
  industrial: Map<string, number>;
}

export interface ElecTable {
  latest: string;
  yearAgo: string;
  values: Map<string, ElecRow>; // library-style area key: "TX", "ALL"
}

function sectorColumns(rows: Cell[][], headerAt: number, sector: string): { col: number; latest: string; yearAgo: string } {
  const col = rows[headerAt - 1].findIndex((c) => norm(c) === sector);
  if (col < 0) throw new SourceError(`The EIA electricity table has a new layout (no '${sector}' column); this source needs updating.`);
  const latest = parseMonthHeading(rows[headerAt][col]);
  const yearAgo = parseMonthHeading(rows[headerAt][col + 1]);
  if (!latest || !yearAgo || shiftMonth(latest, -12) !== yearAgo) {
    throw new SourceError(`The EIA electricity table's ${sector} columns are not 'month' and 'same month a year earlier'; this source needs updating.`);
  }
  return { col, latest, yearAgo };
}

/** Table 5.6.A: the Commercial (and Industrial) columns hold the newest month and the same month a year earlier. Census-division rows are left out. */
export function parseCommercialElectricity(rows: Cell[][]): ElecTable {
  const headerAt = rows.findIndex((r) => norm(r[0]) === "Census Division and State");
  if (headerAt < 1) throw new SourceError("The EIA electricity table has a new layout (no 'Census Division and State' header); this source needs updating.");
  const com = sectorColumns(rows, headerAt, "Commercial");
  const ind = sectorColumns(rows, headerAt, "Industrial");
  const values = new Map<string, ElecRow>();
  const take = (r: Cell[], c: { col: number; latest: string; yearAgo: string }) => {
    const m = new Map<string, number>();
    const cur = r[c.col];
    const prev = r[c.col + 1];
    if (typeof cur === "number" && cur > 0 && cur < 200) m.set(c.latest, cur);
    if (typeof prev === "number" && prev > 0 && prev < 200) m.set(c.yearAgo, prev);
    return m;
  };
  for (const r of rows.slice(headerAt + 1)) {
    const name = norm(r[0]);
    const key = name === "U.S. Total" ? NATIONAL_KEY : stateKey(name);
    if (!key || (key === NATIONAL_KEY && name !== "U.S. Total")) continue;
    const row = { commercial: take(r, com), industrial: take(r, ind) };
    if (row.commercial.size) values.set(key, row);
  }
  return { latest: com.latest, yearAgo: com.yearAgo, values };
}

// ---------- gas: the "Commercial Price" page (pure parsing) ----------

export interface GasTable {
  months: string[]; // "2026-02" .. "2026-07"
  releaseDate: string | null; // "2026-09-30"
  values: Map<string, Map<string, number>>; // area key -> month -> dollars per Mcf
}

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Feb-26" -> "2026-02". */
export function parseShortMonth(text: string): string | null {
  const m = /^([A-Za-z]{3})-(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const i = MONTH_SHORT.findIndex((x) => x.toLowerCase() === m[1].toLowerCase());
  return i < 0 ? null : `20${m[2]}-${String(i + 1).padStart(2, "0")}`;
}

const stripTags = (s: string) => s.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

export function parseGasPage(html: string): GasTable {
  const months = [...html.matchAll(/<th class="Series5">([^<]*)<\/th>/g)].map((m) => parseShortMonth(m[1])).filter((m): m is string => !!m);
  if (!months.length) throw new SourceError("The EIA commercial natural gas page has a new layout (no month headings); this source needs updating.");
  const values = new Map<string, Map<string, number>>();
  for (const m of html.matchAll(/<tr class="DataRow">([\s\S]*?class="DataHist"[\s\S]*?)<\/tr>/g)) {
    const row = m[1];
    const nameMatch = /class="DataStub1">([\s\S]*?)<\/td>/.exec(row);
    if (!nameMatch) continue;
    const name = stripTags(nameMatch[1]);
    const key = name === "U.S." ? NATIONAL_KEY : stateKey(name);
    if (!key || (key === NATIONAL_KEY && name !== "U.S.")) continue;
    const cells = [...row.matchAll(/<td[^>]*class="(DataB|Current2|Current)"[^>]*>([\s\S]*?)<\/td>/g)].map((c) => stripTags(c[2]));
    if (cells.length !== months.length) throw new SourceError(`The EIA commercial natural gas page has ${cells.length} values for ${name} but ${months.length} months; this source needs updating.`);
    const byMonth = new Map<string, number>();
    cells.forEach((c, i) => {
      const v = /^\d+(\.\d+)?$/.test(c) ? Number(c) : NaN; // "NA", "W", "-", "--" = no figure
      if (Number.isFinite(v) && v > 0 && v < 1000) byMonth.set(months[i], v);
    });
    values.set(key, byMonth);
  }
  if (!values.has(NATIONAL_KEY)) throw new SourceError("The EIA commercial natural gas page has no U.S. row; this source needs updating.");
  const rel = /Release Date:\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(stripTags(html));
  const releaseDate = rel ? `${rel[3]}-${rel[1].padStart(2, "0")}-${rel[2].padStart(2, "0")}` : null;
  return { months, releaseDate, values };
}

// ---------- fetching (cached) ----------

async function fetchBytes(url: string, timeoutMs = 30000): Promise<Buffer> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { "user-agent": USER_AGENT }, signal: ctl.signal });
    if (!res.ok) throw new SourceError(`The publisher answered ${res.status} for ${new URL(url).host}.`);
    return Buffer.from(await res.arrayBuffer());
  } catch (e) {
    if (e instanceof SourceError) throw e;
    throw new SourceError(`Could not download the file from ${new URL(url).host}.`);
  } finally {
    clearTimeout(t);
  }
}

const CACHE_MS = 6 * 60 * 60 * 1000;
const cache: { elec?: { at: number; v: ElecTable }; gas?: { at: number; v: GasTable } } = {};

export function electricityFromSheets(sheets: Sheet[]): ElecTable {
  const sheet = sheets.find((s) => s.rows.some((r) => norm(r[0]) === "Census Division and State"));
  if (!sheet) throw new SourceError("The EIA electricity workbook has no table 5.6.A sheet; this source needs updating.");
  return parseCommercialElectricity(sheet.rows);
}

export async function loadElectricity(now = Date.now()): Promise<ElecTable> {
  if (cache.elec && now - cache.elec.at < CACHE_MS) return cache.elec.v;
  const v = electricityFromSheets(readXlsx(await fetchBytes(ELECTRICITY_URL)));
  cache.elec = { at: now, v };
  return v;
}

export async function loadGas(now = Date.now()): Promise<GasTable> {
  if (cache.gas && now - cache.gas.at < CACHE_MS) return cache.gas.v;
  const v = parseGasPage((await fetchBytes(GAS_URL)).toString("utf8"));
  cache.gas = { at: now, v };
  return v;
}

// ---------- the answer (pure) ----------

const roundTo = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;

function monthsBehind(month: string, today: Date): number {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  return m ? today.getUTCFullYear() * 12 + today.getUTCMonth() - (Number(m[1]) * 12 + Number(m[2]) - 1) : 0;
}

export interface UsBusinessQuery {
  energy: string;
  state?: string;
  baseUrl?: string;
  today?: Date;
}

const METHOD_ELECTRICITY =
  "The U.S. Energy Information Administration publishes, every month, the average price of electricity sold to commercial-sector customers (and, separately, industrial customers) in each state and the U.S., in cents per kilowatthour " +
  "(Electric Power Monthly, table 5.6.A, from the monthly Form EIA-861M survey), with the same month a year earlier. ProofPrice returns the published commercial figure unchanged (also in dollars per kWh). " +
  "No range is calculated: EIA gives one average and does not say how many customers or bills are behind it.";
const METHOD_GAS =
  "The U.S. Energy Information Administration publishes, every month, the average price of natural gas delivered to commercial consumers in each state and the U.S., in US dollars per thousand cubic feet (Natural Gas Prices, commercial price). " +
  "ProofPrice returns the published figure for the state's newest month, unchanged, with the earlier months on the page. No range is calculated: EIA gives one average and does not say how many customers or bills are behind it. " +
  "EIA leaves some state-months blank; the answer then uses the state's newest published month and says so.";

function noFigure(energy: Energy, area: string, query: Record<string, unknown>, baseUrl?: string): PriceAnswer {
  const isElec = energy === "electricity";
  const none = buildStatisticAnswer({
    source: INFO, query, value: null, measure: "average", currency: "USD", unit: isElec ? "per kWh" : "per thousand cubic feet (Mcf)",
    period: { from: null, to: null }, reference_period: "", method: isElec ? METHOD_ELECTRICITY : METHOD_GAS, describe: () => "", baseUrl,
  });
  const name = stateName(area);
  return {
    ...none,
    summary: isElec
      ? `EIA's Electric Power Monthly has no commercial-sector electricity price for ${name} in table 5.6.A.`
      : `EIA publishes no commercial natural gas price for ${name} in the last months on its commercial price page (its table leaves those state-months blank).`,
  };
}

export function usBusinessElectricityAnswer(t: ElecTable, area: string, q: UsBusinessQuery): PriceAnswer {
  const today = q.today ?? new Date();
  const name = stateName(area);
  const query: Record<string, unknown> = { country: "US", sector: "business", energy: "electricity", ...(q.state ? { state: q.state } : {}) };
  const row = t.values.get(area);
  const month = row ? [...row.commercial.keys()].sort().pop() : undefined;
  if (!row || !month) return noFigure("electricity", area, query, q.baseUrl);
  const cents = row.commercial.get(month)!;
  const prevMonth = shiftMonth(month, -12);
  const prev = row.commercial.get(prevMonth);
  const change = prev !== undefined ? { reference_month: prevMonth, cents_per_kwh: prev, change_percent: roundTo(((cents - prev) / prev) * 100, 1) } : null;
  const nat = area === NATIONAL_KEY ? undefined : t.values.get(NATIONAL_KEY)?.commercial.get(month);
  const ind = row.industrial.get(month);
  const behind = monthsBehind(month, today);
  const notes = ["EIA labels these values preliminary estimates based on a cutoff model sample."];
  if (behind >= 5) notes.push(`Old data: the newest month in EIA's table is ${monthWords(month)}, ${behind} months ago.`);
  const where = area === NATIONAL_KEY ? "the United States" : name;
  const answer = buildStatisticAnswer({
    source: INFO,
    query,
    value: cents / 100,
    measure: "average",
    currency: "USD",
    unit: "per kWh",
    period: periodRange(month) ?? { from: null, to: null },
    reference_period: month,
    method: METHOD_ELECTRICITY,
    note: notes.join(" "),
    baseUrl: q.baseUrl,
    describe: () =>
      `In ${where} the official average price paid by businesses (commercial-sector customers) for electricity was ${cents.toFixed(2)} cents per kilowatthour (about $${(cents / 100).toFixed(4)} per kWh) in ${monthWords(month)}. ` +
      "EIA publishes one commercial average per state, not consumption bands." +
      (change
        ? change.change_percent === 0
          ? ` That is unchanged from a year earlier (${change.cents_per_kwh.toFixed(2)} cents in ${monthWords(change.reference_month)}).`
          : ` That is ${Math.abs(change.change_percent)}% ${change.change_percent > 0 ? "higher" : "lower"} than a year earlier (${change.cents_per_kwh.toFixed(2)} cents in ${monthWords(change.reference_month)}).`
        : " EIA has no price for the same month a year earlier.") +
      (nat !== undefined ? ` The U.S. commercial average was ${nat.toFixed(2)} cents.` : ""),
    extra: {
      sector: "business",
      country_name: "United States",
      energy: "electricity",
      state: area === NATIONAL_KEY ? { code: "US", name: "United States", scope: "national average" } : { code: area, name },
      customers: "commercial (shops, offices, hospitals, schools and other service businesses)",
      consumption_band: "not used: EIA publishes one commercial average per state",
      reference_month: month,
      reference_month_label: monthWords(month),
      cents_per_kwh: cents,
      unit_note: "Published in US cents per kilowatthour (100 cents = 1 US dollar); the price value is in US dollars per kWh.",
      change_on_year_earlier: change,
      ...(nat !== undefined ? { us_commercial_average_cents_per_kwh: nat } : {}),
      ...(ind !== undefined ? { industrial_sector_cents_per_kwh: ind, industrial_note: "EIA's separate industrial-sector average (factories and plants) for the same month." } : {}),
      dataset: { name: "Electric Power Monthly, table 5.6.A", file: ELECTRICITY_URL, page: ELECTRICITY_PAGE, sector: "Commercial", form: "EIA-861M" },
    },
  });
  return { ...answer, source: { ...answer.source, attribution: `Source: U.S. Energy Information Administration (${acknowledgmentDate(month)}). ${INFO.attribution.replace(/^Source: /, "")}` } };
}

export function usBusinessGasAnswer(t: GasTable, area: string, q: UsBusinessQuery): PriceAnswer {
  const today = q.today ?? new Date();
  const name = stateName(area);
  const query: Record<string, unknown> = { country: "US", sector: "business", energy: "gas", ...(q.state ? { state: q.state } : {}) };
  const series = t.values.get(area);
  const months = series ? [...series.keys()].sort() : [];
  if (!series || !months.length) return noFigure("gas", area, query, q.baseUrl);
  const month = months[months.length - 1];
  const value = series.get(month)!;
  const datasetMonth = t.months[t.months.length - 1];
  const prevMonth = shiftMonth(month, -1);
  const prev = series.get(prevMonth);
  const change = prev !== undefined ? { reference_month: prevMonth, value: prev, change_percent: roundTo(((value - prev) / prev) * 100, 1) } : null;
  const nat = area === NATIONAL_KEY ? undefined : t.values.get(NATIONAL_KEY)?.get(month);
  const behind = monthsBehind(month, today);
  const notes: string[] = [];
  if (month < datasetMonth) notes.push(`EIA has no commercial natural gas price for ${name} for ${monthWords(datasetMonth)} (its table leaves that state-month blank); this is ${name}'s newest published month, ${monthWords(month)}.`);
  if (behind >= 5) notes.push(`Old data: the newest month on EIA's page is ${monthWords(month)}, ${behind} months ago.`);
  const where = area === NATIONAL_KEY ? "the United States" : name;
  const answer = buildStatisticAnswer({
    source: INFO,
    query,
    value,
    measure: "average",
    currency: "USD",
    unit: "per thousand cubic feet (Mcf)",
    period: periodRange(month) ?? { from: null, to: null },
    reference_period: month,
    method: METHOD_GAS,
    note: notes.length ? notes.join(" ") : undefined,
    baseUrl: q.baseUrl,
    describe: (v) =>
      `In ${where} the official average price paid by businesses (commercial consumers) for natural gas was $${v.toFixed(2)} per thousand cubic feet in ${monthWords(month)}. ` +
      "EIA publishes one commercial average per state, not consumption bands." +
      (change
        ? change.change_percent === 0
          ? ` That is unchanged from ${monthWords(change.reference_month)}.`
          : ` That is ${Math.abs(change.change_percent)}% ${change.change_percent > 0 ? "higher" : "lower"} than in ${monthWords(change.reference_month)} ($${change.value.toFixed(2)}).`
        : "") +
      (nat !== undefined ? ` The U.S. commercial average was $${nat.toFixed(2)}.` : ""),
    extra: {
      sector: "business",
      country_name: "United States",
      energy: "gas",
      state: area === NATIONAL_KEY ? { code: "US", name: "United States", scope: "national average" } : { code: area, name },
      customers: "commercial (shops, offices, hospitals, schools and other service businesses)",
      consumption_band: "not used: EIA publishes one commercial average per state",
      reference_month: month,
      reference_month_label: monthWords(month),
      unit_note: "US dollars per thousand cubic feet (Mcf) of natural gas.",
      change_on_previous_month: change,
      recent_months: months.map((m) => ({ month: m, value: series.get(m)! })),
      ...(nat !== undefined ? { us_commercial_average: nat } : {}),
      ...(month < datasetMonth ? { newest_month_in_dataset: datasetMonth } : {}),
      ...(t.releaseDate ? { eia_release_date: t.releaseDate } : {}),
      dataset: { name: "Natural Gas Prices, commercial price (monthly, by state)", page: GAS_URL },
    },
  });
  return { ...answer, source: { ...answer.source, attribution: `Source: U.S. Energy Information Administration (${acknowledgmentDate(month)}). ${INFO.attribution.replace(/^Source: /, "")}` } };
}

// ---------- the request ----------

export async function usBusinessEnergy(
  q: UsBusinessQuery,
  load: { electricity: () => Promise<ElecTable>; gas: () => Promise<GasTable> } = { electricity: () => loadElectricity(), gas: () => loadGas() },
): Promise<PriceAnswer> {
  const energy = normaliseEnergy(String(q.energy ?? ""));
  const area = stateKey(q.state);
  if (!area) {
    throw new InputError(`state must be a US state name or two-letter code (for example TX, Texas or DC), or left out for the U.S. average. Not recognised: ${q.state}.`);
  }
  return energy === "electricity" ? usBusinessElectricityAnswer(await load.electricity(), area, q) : usBusinessGasAnswer(await load.gas(), area, q);
}
