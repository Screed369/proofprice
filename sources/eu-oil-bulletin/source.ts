// European Commission Weekly Oil Bulletin: official national average pump prices for the EU Member States that have no
// station-level fuel source of their own (ES, FR, IT and AT are answered by their national sources, so they are left out).
// Formats checked live on 2026-10-14 (bulletin dated Monday 12 October 2026, page showing "15 October 2026").
//
// What is published: every week the Commission publishes, for each Member State, the consumer price of Euro-super 95, automotive
// gas oil (diesel), heating gas oil, fuel oils and LPG motor fuel "inclusive of duties and taxes", in euro per 1000 litres (fuel oils per
// tonne), plus EU and euro-area weighted averages. The Member States report "the prices most frequently charged, based on a weighted
// average" (note in the workbook). Prices of countries outside the euro are converted into euro by the Commission; the workbook
// carries the exchange rate it used (EUR per unit of national currency).
//
// Files (key-free; the document ids are stable, the file behind them is replaced every week):
//  - "Price developments 2005 onwards" (xlsx, 4.3 MB): sheet "Prices with taxes", one row per week, newest first. Row 0 holds column codes
//    ("IE_price_with_tax_diesel", "PL_exchange_rate", "EU_price_with_tax_euro95", ...), row 1 the product names, row 2 the units
//    ("1000 l"), then one row per week with the Monday date as an Excel serial in column A. We read this one file: it holds the newest
//    week, the previous week and the same week a year earlier.
//  - "Prices with taxes latest prices" (xlsx, 17 KB) carries the same newest week by country name; we do not need it.
//
// The file is too big to read per request, so the collector (harvest) reads it once a day and keeps the newest week in the price library;
// requests are answered from there. Library rows (area = ISO country code, "EU" = the EU27 weighted average):
//   item "petrol95" | "diesel" | "lpg" | "heating_oil"  the price in EUR per litre (published EUR per 1000 litres divided by 1000)
//   item "<fuel>@YYYY-MM-DD"                             the price in the bulletin of that earlier date (previous week, a year earlier)
//   item "fx" and "fx@YYYY-MM-DD"                        EUR per unit of national currency (only for countries with their own currency)
// A published figure does not come from counting records, so it is stored with median = low = high = min = max = the figure and n = 5.
// That n is a placeholder to pass the library's "at least 5" gate, NOT a count of records (the answers carry sample_size null).

import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { readLatestDay } from "../../lib/library/store";
import { Cell, excelDate, readXlsx } from "../../categories/rent/xlsx";

export const PAGE_URL = "https://energy.ec.europa.eu/data-and-analysis/weekly-oil-bulletin_en";
/** "Price developments 2005 onwards". The document id is stable; the harvest also looks the link up on the page. */
export const HISTORY_URL =
  "https://energy.ec.europa.eu/document/download/906e60ca-8b6a-44e7-8589-652854d2fd3f_en?filename=Weekly_Oil_Bulletin_Prices_History_maticni_4web.xlsx";
const SITE = "https://energy.ec.europa.eu";
const UA = "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)";

export const INFO: SourceInfo = {
  id: "eu-oil-bulletin",
  country: "EU Weekly Oil Bulletin (IE, DE, NL, BE, PT, PL, DK, SE, FI, LU, GR, CZ, SK, SI, HR, HU, RO, BG, EE, LV, LT, CY, MT)",
  category: "fuel (national average pump prices)",
  name: "Weekly Oil Bulletin: consumer prices of petroleum products inclusive of duties and taxes",
  publisher: "European Commission, Directorate-General for Energy",
  what_is_recorded:
    "For each EU Member State, once a week: the national average consumer price, with all duties and taxes included, of Euro-super 95 petrol, automotive gas oil (diesel), heating gas oil and LPG motor fuel, in euro per 1000 litres, " +
    "as reported to the Commission by the national authorities (prices in force on the Monday of the bulletin week). Countries outside the euro are converted into euro by the Commission at the exchange rate shown in the bulletin.",
  price_type: "official_statistic",
  freshness: "Weekly: Monday prices, published that week",
  licence:
    "Creative Commons Attribution 4.0 International (CC BY 4.0). The European Commission's legal notice states: \"Unless otherwise indicated (e.g. in individual copyright notices), content owned by the EU on this website is licensed under the Creative Commons Attribution 4.0 International (CC BY 4.0) licence. " +
    "This means that reuse is allowed, provided appropriate credit is given and changes are indicated.\" The Oil Bulletin workbook itself states: \"Reproduction is authorised provided the source is acknowledged.\" (© European Commission)",
  licence_url: "https://commission.europa.eu/legal-notice_en",
  attribution:
    `Source: European Commission, Directorate-General for Energy, Weekly Oil Bulletin (${PAGE_URL}), consumer prices of petroleum products inclusive of duties and taxes. © European Union, reused under CC BY 4.0. ` +
    "Changes made by ProofPrice: prices converted from euro per 1000 litres to euro per litre, the change on the previous week and on a year earlier calculated from the bulletin's own price history, and (for countries with their own currency) the national-currency price calculated from the bulletin's euro price and exchange rate.",
  homepage: PAGE_URL,
  limits:
    "A national average for each Member State, not the price at a station, town or postcode: an area or postcode in a request is answered with the national figure and says so. " +
    "The Commission states that the prices are \"the prices most frequently charged, based on a weighted average\" and that \"comparisons between prices and price trends in different countries shall be carefully made\" because of differences in product quality, marketing practices and market structures. " +
    "Only Euro-super 95 (petrol95), automotive gas oil (diesel) and LPG (lpg) can be asked for, plus heating gas oil in the extra fields; premium petrol, E10, E85 and natural gas are not published. " +
    "Some Member States report no LPG or heating gas oil price. Prices are those in force on the Monday of the bulletin week. For Czechia, Denmark, Hungary, Poland, Romania and Sweden the euro price moves with the exchange rate the Commission used, so changes in euro can differ from changes in the national currency. " +
    "ES, FR, IT and AT are answered by their own national sources. In the history tool, sample_size is a placeholder (5), not a count of stations.",
};

// ---------- countries and fuels ----------

/** ISO code -> name, for every country this source answers for (EU Member States except ES, FR, IT and AT). */
export const COUNTRIES: Record<string, string> = {
  IE: "Ireland", DE: "Germany", NL: "the Netherlands", BE: "Belgium", PT: "Portugal", PL: "Poland", DK: "Denmark", SE: "Sweden",
  FI: "Finland", LU: "Luxembourg", GR: "Greece", CZ: "Czechia", SK: "Slovakia", SI: "Slovenia", HR: "Croatia", HU: "Hungary",
  RO: "Romania", BG: "Bulgaria", EE: "Estonia", LV: "Latvia", LT: "Lithuania", CY: "Cyprus", MT: "Malta",
};

/** Countries that still have their own currency: the workbook carries an exchange rate for them. */
export const NATIONAL_CURRENCY: Record<string, string> = { CZ: "CZK", DK: "DKK", HU: "HUF", PL: "PLN", RO: "RON", SE: "SEK" };

export const EU_AREA = "EU"; // the EU27 weighted average, as the workbook's "EU_" columns

export type BulletinFuel = "petrol95" | "diesel" | "lpg" | "heating_oil";
export const ITEMS: BulletinFuel[] = ["petrol95", "diesel", "lpg", "heating_oil"];
/** The fuels the tool can ask for (heating gas oil is only given in the extra fields). */
export const ASKABLE: BulletinFuel[] = ["petrol95", "diesel", "lpg"];

/** Column code suffix in the workbook for each fuel. */
const COLUMN: Record<BulletinFuel, string> = { petrol95: "euro95", diesel: "diesel", heating_oil: "heating_oil", lpg: "LPG" };

export const FUEL_INFO: Record<BulletinFuel, { label: string; product: string }> = {
  petrol95: { label: "unleaded petrol (Euro-super 95)", product: "Euro-super 95 (I)" },
  diesel: { label: "diesel (automotive gas oil)", product: "Gas oil automobile / Automotive gas oil / Dieselkraftstoff (I)" },
  lpg: { label: "LPG motor fuel (autogas)", product: "GPL pour moteur / LPG motor fuel" },
  heating_oil: { label: "heating gas oil", product: "Gas oil de chauffage / Heating gas oil / Heizöl (II)" },
};

// ---------- reading the price-history workbook (pure) ----------

export interface Week {
  serial: number; // Excel date serial of the Monday
  date: string; // YYYY-MM-DD
  /** EUR per litre, by area ("EU" or an ISO code). */
  prices: Record<string, Partial<Record<BulletinFuel, number>>>;
  /** EUR per unit of national currency, by area. */
  fx: Record<string, number>;
}

const r5 = (v: number) => Math.round(v * 1e5) / 1e5;
const r10 = (v: number) => Math.round(v * 1e10) / 1e10;
const isNum = (c: Cell): c is number => typeof c === "number" && Number.isFinite(c);

interface Col {
  area: string;
  kind: BulletinFuel | "fx";
  col: number;
}

/** Parse the "Prices with taxes" sheet. Throws SourceError, saying what changed, if the layout is not the one we know. */
export function parseHistory(rows: Cell[][], keepWeeks = 60, minCountries = 15): Week[] {
  const hi = rows.findIndex((r) => r.some((c) => typeof c === "string" && /_price_with_tax_euro95$/.test(c.trim())));
  if (hi < 0) throw new SourceError("The Oil Bulletin history sheet has a new layout (no '<country>_price_with_tax_euro95' columns); this source needs updating.");
  const head = rows[hi];
  const cols: Col[] = [];
  const byColumn = new Map(Object.entries(COLUMN).map(([fuel, code]) => [code, fuel as BulletinFuel]));
  head.forEach((h, col) => {
    if (typeof h !== "string") return;
    const m = /^([A-Z]{2,3})_(?:(exchange_rate)|price_with_tax_(euro95|diesel|heating_oil|LPG))$/.exec(h.trim());
    if (!m) return;
    const area = m[1];
    if (area !== EU_AREA && !COUNTRIES[area]) return;
    if (m[2]) cols.push({ area, kind: "fx", col });
    else cols.push({ area, kind: byColumn.get(m[3])!, col });
  });
  // Units: every price column must be euro per 1000 litres. A different unit means the file changed under us.
  const unitRow = rows.slice(hi + 1, hi + 6).find((r) => String(r[0] ?? "").trim() === "Date");
  if (!unitRow) throw new SourceError("The Oil Bulletin history sheet has a new layout (no unit row starting with 'Date'); this source needs updating.");
  for (const c of cols) {
    if (c.kind === "fx") continue;
    const unit = String(unitRow[c.col] ?? "").replace(/\s+/g, "").toLowerCase();
    if (unit !== "1000l") throw new SourceError(`The Oil Bulletin unit for ${head[c.col]} is '${unitRow[c.col]}', not '1000 l'; this source needs updating.`);
  }
  const weeks: Week[] = [];
  const seen = new Set<number>();
  for (const r of rows.slice(hi + 1)) {
    const serial = r[0];
    if (!isNum(serial) || seen.has(serial)) continue;
    const date = excelDate(serial);
    if (!date) continue;
    seen.add(serial);
    const w: Week = { serial, date, prices: {}, fx: {} };
    for (const c of cols) {
      const v = r[c.col];
      if (!isNum(v) || v <= 0) continue;
      if (c.kind === "fx") w.fx[c.area] = r10(v);
      else (w.prices[c.area] ??= {})[c.kind] = r5(v / 1000);
    }
    weeks.push(w);
  }
  weeks.sort((a, b) => b.serial - a.serial);
  const newest = weeks[0];
  const withPetrol = newest ? Object.keys(newest.prices).filter((a) => a !== EU_AREA && newest.prices[a].petrol95 !== undefined).length : 0;
  // The real file has about 23 of our countries with a Euro-super 95 price in a week; far fewer means the layout changed.
  if (!newest || withPetrol < minCountries) throw new SourceError(`The newest Oil Bulletin week has Euro-super 95 prices for only ${withPetrol} countries; the file may have changed.`);
  return weeks.slice(0, keepWeeks);
}

/** The week one week before the newest (or the closest earlier one within 14 days, if a week was skipped). */
export function previousWeek(weeks: Week[]): Week | null {
  const s0 = weeks[0]?.serial;
  if (s0 === undefined) return null;
  return weeks.find((w) => w.serial < s0 && s0 - w.serial <= 14) ?? null;
}

/** The week closest to 52 weeks (364 days) before the newest, within 4 days. */
export function yearEarlierWeek(weeks: Week[]): Week | null {
  const s0 = weeks[0]?.serial;
  if (s0 === undefined) return null;
  let best: Week | null = null;
  for (const w of weeks) {
    const off = Math.abs(w.serial - (s0 - 364));
    if (off <= 4 && (!best || off < Math.abs(best.serial - (s0 - 364)))) best = w;
  }
  return best;
}

/** Library rows for the newest bulletin week (see the note at the top of this file). */
export function wobRows(weeks: Week[]): DailyRow[] {
  const [w0] = weeks;
  if (!w0) return [];
  const earlier = [previousWeek(weeks), yearEarlierWeek(weeks)].filter((w): w is Week => !!w);
  const rows: DailyRow[] = [];
  const put = (area: string, item: string, v: number) => rows.push({ area, item, n: 5, median: v, low: v, high: v, min: v, max: v });
  for (const area of Object.keys(w0.prices).sort()) {
    for (const item of ITEMS) {
      const v = w0.prices[area][item];
      if (v === undefined) continue;
      put(area, item, v);
      for (const w of earlier) {
        const then = w.prices[area]?.[item];
        if (then !== undefined) put(area, `${item}@${w.date}`, then);
      }
    }
    if (NATIONAL_CURRENCY[area] && w0.fx[area] !== undefined) {
      put(area, "fx", w0.fx[area]);
      for (const w of earlier) if (w.fx[area] !== undefined) put(area, `fx@${w.date}`, w.fx[area]);
    }
  }
  return rows;
}

// ---------- the collector ----------

/** Tests set retryDelayMs to 0. */
export const harvestOptions = { retryDelayMs: 2000 };

async function download(url: string, kind: "text" | "binary", tries = 3, timeoutMs = 120000): Promise<any> {
  let last = "";
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(timeoutMs) });
      if (res.ok) return kind === "text" ? await res.text() : Buffer.from(await res.arrayBuffer());
      last = `HTTP ${res.status}`;
    } catch (e: any) {
      last = String(e?.cause?.code ?? e?.message ?? e);
    }
    if (i < tries - 1) await new Promise((r) => setTimeout(r, harvestOptions.retryDelayMs * (i + 1)));
  }
  throw new SourceError(`Could not download ${url}: ${last}`);
}

/** The price-history link on the bulletin page (the page lists it as "Price developments 2005 onwards"), as an absolute URL. */
export function findHistoryUrl(html: string): string | null {
  const m = /href="(\/document\/download\/[0-9a-f-]{36}_en\?filename=[^"]*Prices_History[^"]*\.xlsx)"/i.exec(html);
  return m ? SITE + m[1].replace(/&amp;/g, "&") : null;
}

export function wobResult(weeks: Week[]): HarvestResult {
  const w0 = weeks[0];
  const prev = previousWeek(weeks);
  const year = yearEarlierWeek(weeks);
  return {
    date: w0.date,
    currency: "EUR",
    unit: "per litre",
    rows: wobRows(weeks),
    note:
      `European Commission Weekly Oil Bulletin, prices in force on ${w0.date}: published national averages (all duties and taxes included), euro per litre. ` +
      `Items petrol95, diesel, lpg, heating_oil; "<item>@<date>" = the price in the bulletin of that earlier date (${prev ? `previous week ${prev.date}` : "no previous week"}, ${year ? `year earlier ${year.date}` : "no year-earlier week"}); ` +
      "fx = euro per unit of national currency. Published values, not counts of records (n=5 is a placeholder).",
  };
}

/** The daily collector: find the price-history file, read the "Prices with taxes" sheet once, keep the newest week. */
export async function wobHarvest(minCountries = 15): Promise<HarvestResult> {
  let url = HISTORY_URL;
  try {
    const found = findHistoryUrl(await download(PAGE_URL, "text", 2, 30000));
    if (found) url = found;
  } catch {
    // The page lookup is only a convenience: the document id in HISTORY_URL is stable.
  }
  const buf: Buffer = await download(url, "binary");
  const sheets = readXlsx(buf, { maxRows: 90 });
  const sheet = sheets.find((s) => s.rows.some((r) => r.some((c) => typeof c === "string" && /_price_with_tax_euro95$/.test(c.trim()))));
  if (!sheet) throw new SourceError("The Oil Bulletin workbook has no sheet with '<country>_price_with_tax_euro95' columns; this source needs updating.");
  return wobResult(parseHistory(sheet.rows, 60, minCountries));
}

// ---------- answering ----------

export interface WobInput {
  country: string;
  fuel: string;
  area?: string;
  town?: string;
  postcode?: string;
  baseUrl?: string;
}

interface LibLike {
  date: string;
  rows: { area: string; item: string; median: number }[];
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

const dayMs = 86400000;
const dayOf = (iso: string) => Math.round(Date.parse(iso + "T00:00:00Z") / dayMs);
const round1 = (v: number) => Math.round(v * 10) / 10;
const round3 = (v: number) => Math.round(v * 1000) / 1000;
const round4 = (v: number) => Math.round(v * 10000) / 10000;
const eur = (v: number) => `€${v.toFixed(4)}`;

/** A bulletin older than this many days is flagged as old data (a weekly release has been missed). */
export const OLD_AFTER_DAYS = 17;

export function pickPrevious(list: { date: string; value: number }[], date: string): { date: string; value: number } | null {
  const d = dayOf(date);
  return [...list].filter((x) => dayOf(x.date) < d && d - dayOf(x.date) <= 14).sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;
}

export function pickYearEarlier(list: { date: string; value: number }[], date: string): { date: string; value: number } | null {
  const target = dayOf(date) - 364;
  let best: { date: string; value: number } | null = null;
  for (const x of list) {
    const off = Math.abs(dayOf(x.date) - target);
    if (off <= 4 && (!best || off < Math.abs(dayOf(best.date) - target))) best = x;
  }
  return best;
}

function changeSentence(pct: number, label: string): string {
  return pct === 0 ? `unchanged on ${label}` : `${Math.abs(pct)}% ${pct > 0 ? "higher" : "lower"} than ${label}`;
}

/** Pure: the answer for one country and fuel from the library's newest week. */
export function wobAnswer(lib: LibLike, input: WobInput, now = new Date()): PriceAnswer {
  const country = input.country.trim().toUpperCase();
  const name = COUNTRIES[country];
  if (!name) throw new InputError(`The Weekly Oil Bulletin source answers for ${Object.keys(COUNTRIES).join(", ")}. Not yet: ${input.country}.`);
  const fuel = input.fuel as BulletinFuel;
  if (!ASKABLE.includes(fuel)) {
    throw new InputError("fuel must be petrol95 (Euro-super 95), diesel or lpg for the EU Weekly Oil Bulletin; premium petrol, E10, E85 and natural gas are not published.");
  }
  const get = (area: string, item: string): number | null => lib.rows.find((r) => r.area === area && r.item === item)?.median ?? null;
  const dated = (area: string, item: string) =>
    lib.rows.filter((r) => r.area === area && r.item.startsWith(`${item}@`)).map((r) => ({ date: r.item.slice(item.length + 1), value: r.median }));

  const asked = [input.postcode && `postcode ${input.postcode}`, input.town && input.town, input.area && input.area].filter(Boolean) as string[];
  const info = FUEL_INFO[fuel];
  const query: Record<string, unknown> = { country, fuel, ...(input.area ? { area: input.area } : {}), ...(input.town ? { town: input.town } : {}), ...(input.postcode ? { postcode: input.postcode } : {}) };
  const method =
    "The European Commission's Weekly Oil Bulletin publishes every week, for each Member State, the consumer price of Euro-super 95, automotive gas oil (diesel), heating gas oil and LPG motor fuel with all duties and taxes included, " +
    "as reported by the national authorities (\"the prices most frequently charged, based on a weighted average\"). ProofPrice returns the published national figure for the newest bulletin it holds, converted from euro per 1000 litres to euro per litre, " +
    "with the change on the previous week and on a year earlier calculated from the bulletin's own price history. No range is calculated and the Commission gives no number of stations.";
  const base = { source: INFO, query, measure: "average" as const, currency: "EUR", unit: "per litre", method, baseUrl: input.baseUrl };

  const value = get(country, fuel);
  const ageDays = Math.round((now.getTime() - Date.parse(lib.date + "T00:00:00Z")) / dayMs);
  const old = ageDays > OLD_AFTER_DAYS;

  if (value === null) {
    const available = ITEMS.filter((i) => get(country, i) !== null).map((i) => FUEL_INFO[i].label);
    const none = buildStatisticAnswer({ ...base, value: null, period: { from: null, to: null }, reference_period: "", describe: () => "" });
    return {
      ...none,
      summary:
        `The Weekly Oil Bulletin of ${longDate(lib.date)} carries no ${info.label} price for ${name} (the Member State does not report one). ` +
        (available.length ? `It does carry: ${available.join(", ")}.` : ""),
      extra: { country_name: name, bulletin_date: lib.date, published_fuels: available },
    };
  }

  const prev = pickPrevious(dated(country, fuel), lib.date);
  const year = pickYearEarlier(dated(country, fuel), lib.date);
  const chg = (then: { date: string; value: number } | null) =>
    then ? { date: then.date, price_eur_per_litre: then.value, change_percent: round1(((value - then.value) / then.value) * 100), change_eur_per_litre: round4(value - then.value) } : null;
  const prevChange = chg(prev);
  const yearChange = chg(year);

  // National currency, for the countries that have one: calculated from the euro price and the exchange rate the bulletin states.
  const currency = NATIONAL_CURRENCY[country];
  const fxNow = currency ? get(country, "fx") : null;
  let national: Record<string, unknown> | null = null;
  let nationalPrice: number | null = null;
  if (currency && fxNow) {
    nationalPrice = round3(value / fxNow);
    const nat = (then: { date: string; value: number } | null) => {
      const fx = then ? get(country, `fx@${then.date}`) : null;
      if (!then || !fx) return null;
      const was = then.value / fx;
      return { date: then.date, price_per_litre: round3(was), change_percent: round1(((value / fxNow - was) / was) * 100) };
    };
    national = {
      currency,
      price_per_litre: nationalPrice,
      exchange_rate_eur_per_unit: fxNow,
      previous_week: nat(prev),
      year_earlier: nat(year),
      note: "Calculated by ProofPrice as the bulletin's euro price divided by the exchange rate the bulletin states (euro per unit of national currency).",
    };
  }

  const phrases = [prevChange && changeSentence(prevChange.change_percent, `the previous week (${longDate(prevChange.date)})`), yearChange && changeSentence(yearChange.change_percent, `a year earlier (${longDate(yearChange.date)})`)].filter(Boolean);
  const notes: string[] = [];
  if (asked.length) {
    notes.push(`You asked about ${asked.join(", ")}. The Weekly Oil Bulletin publishes one national average per Member State, so this is the national average for ${name}, not a price for that place.`);
  }
  if (old) {
    notes.push(`This is old data: the newest bulletin we hold is for ${longDate(lib.date)}, ${ageDays} days ago, and a more recent one may have been published.`);
  }
  if (currency) notes.push(`${name} is outside the euro: the Commission converts the national price into euro, so the euro price also moves with the exchange rate.`);

  const published: Record<string, number> = {};
  for (const i of ITEMS) {
    const v = get(country, i);
    if (v !== null) published[i === "heating_oil" ? "heating_gas_oil" : i] = v;
  }
  const euAverage = get(EU_AREA, fuel);
  const heating = get(country, "heating_oil");

  return buildStatisticAnswer({
    ...base,
    value,
    period: { from: lib.date, to: lib.date },
    reference_period: lib.date,
    note: notes.length ? notes.join(" ") : undefined,
    describe: (v) =>
      (asked.length ? `${name} is covered by national averages only (you asked about ${asked.join(", ")}). ` : "") +
      `In ${name} the average pump price of ${info.label} was ${eur(v)} per litre (all duties and taxes included${nationalPrice !== null ? `; about ${nationalPrice} ${currency} per litre` : ""}) ` +
      `in the Weekly Oil Bulletin for prices in force on ${longDate(lib.date)}` +
      (phrases.length ? `, ${phrases.join(" and ")}` : "") +
      "." +
      (old ? ` This is old data: ${ageDays} days have passed since that bulletin.` : ""),
    extra: {
      country_name: name,
      fuel,
      product_in_bulletin: info.product,
      scope: "national average (one figure per Member State; no area, town or postcode figures)",
      taxes: "all duties and taxes included (VAT and excise)",
      bulletin_date: lib.date,
      price_eur_per_1000_litres: Math.round(value * 1000 * 100) / 100,
      price_eur_per_litre: value,
      change_on_previous_week: prevChange,
      change_on_year_earlier: yearChange,
      ...(national ? { national_currency: national } : {}),
      ...(euAverage !== null ? { eu27_weighted_average_eur_per_litre: euAverage } : {}),
      ...(heating !== null ? { heating_gas_oil_eur_per_litre: heating } : {}),
      published_prices_eur_per_litre: published,
      data_age_days: ageDays,
      ...(old ? { stale_warning: `The newest Weekly Oil Bulletin we hold is for ${lib.date}, ${ageDays} days ago.` } : {}),
      ...(asked.length ? { asked_place: asked.join(", "), answered_as: "national average" } : {}),
      bulletin_note:
        "The prices communicated by the Member States are the prices most frequently charged, based on a weighted average. Comparisons between prices and price trends in different countries shall be carefully made.",
      source_file: "Weekly Oil Bulletin, price developments 2005 onwards (xlsx), sheet \"Prices with taxes\"",
    },
  });
}

export async function wobFuelNow(input: WobInput, now = new Date()): Promise<PriceAnswer> {
  const lib = readLatestDay(INFO.id);
  if (!lib) throw new SourceError("Not yet available: the Weekly Oil Bulletin prices appear after the next collection (the price library has no data for this source yet).");
  return wobAnswer(lib, input, now);
}

export function wobHistoryKey(p: { country: string; fuel: string }): { area: string; item: string; label: string } | null {
  const country = p.country.trim().toUpperCase();
  if (!COUNTRIES[country] || !ASKABLE.includes(p.fuel as BulletinFuel)) return null;
  return { area: country, item: p.fuel, label: `${COUNTRIES[country]} (national average)` };
}
