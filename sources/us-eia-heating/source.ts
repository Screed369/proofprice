// United States: EIA's weekly residential heating oil and propane prices (the "Heating Oil and Propane Update").
// EIA publishes each series as a legacy Excel history file (BIFF8 .xls, no API key), the same "dnav" family as the gasoline and diesel files read by us-eia-fuel:
//   https://www.eia.gov/dnav/pet/hist_xls/W_EPD2F_PRS_NUS_DPGw.xls   residential heating oil, US weekly, dollars per gallon (probe 21 Oct 2026: 200, 68 KB)
//   https://www.eia.gov/dnav/pet/hist_xls/W_EPLLPA_PRS_NUS_DPGw.xls  residential propane, US weekly, dollars per gallon (link read from the series page on 22 Oct 2026)
// Layout (same as every dnav history workbook): sheet "Data 1": row 0 "Back to Contents" + "Data 1: <title>", row 1 "Sourcekey" + the series key,
// row 2 "Date" + description, then one row per week: an Excel date serial and the price in US dollars per gallon.
// Prices are collected only in the heating season (October to March), so the newest week can be months old in summer; every answer states its week.
// EIA publishes ONE national average per series and week (no distribution, no count of outlets): an official statistic.
//
// The daily collector (harvest, GitHub Actions) reads both files and stores, for the newest week both series have, the price, the week before (item@w1) and the
// same week a year earlier (item@y1) in the price library, in US dollars per LITRE like us-eia-fuel (the shared fuel history tool labels every fuel "per litre").

import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { SourceError } from "../../lib/http";
import { excelDate } from "../../categories/rent/xlsx";
import type { Sheet } from "../../categories/rent/xlsx";
import { readLatestDay } from "../../lib/library/store";
import { NO_COUNT } from "../../lib/stats";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { readXls } from "../us-eia-fuel/xls";
import { GALLON_LITRES, acknowledgmentDate, dateWords, nearPoint, shiftDate, toGallon, toLitre } from "../us-eia-fuel/source";

export const PAGE_URL = "https://www.eia.gov/petroleum/heatingoilpropane/";
export const COLLECTOR_USER_AGENT = "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)";
export const AREA = "ALL";

export const INFO: SourceInfo = {
  id: "us-eia-heating",
  country: "US (United States)",
  category: "fuel (home heating oil and propane)",
  name: "Heating Oil and Propane Update: weekly US residential heating oil and propane prices",
  publisher: "U.S. Energy Information Administration (EIA)",
  what_is_recorded:
    "EIA's weekly estimate of the average US retail (residential) price of No. 2 heating oil and of propane, in US dollars per gallon, collected from fuel suppliers in the heating season (October to March). One national average per series and week; never an individual supplier's price.",
  price_type: "official_statistic",
  freshness:
    "Weekly in the heating season (October to March, published Wednesdays); EIA collects no heating oil or propane prices from April to September, so in summer the newest week is from March. Our copy of EIA's files is refreshed daily and every answer states its week",
  licence:
    'Public domain. EIA states: "U.S. government publications are in the public domain and are not subject to copyright protection. You may use and/or distribute any of our data, files, databases, reports, graphs, charts, and other information products that are on our website or that you receive through our email distribution service. ' +
    'However, if you use or reproduce any of our information products, you should use an acknowledgment, which includes the publication date, such as: "Source: U.S. Energy Information Administration (Oct 2008)."" ' +
    "The EIA logo is a registered trademark and is not used here.",
  licence_url: "https://www.eia.gov/about/copyrights_reuse.php",
  attribution:
    "Source: U.S. Energy Information Administration, Heating Oil and Propane Update (weekly residential heating oil and propane prices), https://www.eia.gov/petroleum/heatingoilpropane/ . Public domain; EIA asks for an acknowledgment with the publication date. " +
    "Prices are passed on as published; the US-dollars-per-litre figures and the changes on the week and the year are calculated by ProofPrice. ProofPrice is not endorsed by EIA.",
  homepage: PAGE_URL,
  limits:
    "A national weekly average that EIA estimates from its survey of suppliers: not an individual supplier's price, not a range, and EIA does not say how many suppliers stand behind a figure. " +
    "Only the United States as a whole is published here (EIA's state detail covers the northeast and a few other states and is not read). Prices are collected only from October to March, so outside the heating season the newest week is old. " +
    "Prices are in US dollars per US gallon (3.785 litres). These are posted retail prices, not prices of completed sales.",
};

// ---------- products ----------

export type Product = "heating_oil" | "propane";
export const PRODUCTS: Product[] = ["heating_oil", "propane"];

interface ProductDef {
  label: string;
  url: string;
  /** EIA series key (row 1 of the data sheet). */
  seriesKey: string;
  /** Text the sheet title (row 0, column 1) must contain. */
  titleHas: string;
}

export const PRODUCT_DEFS: Record<Product, ProductDef> = {
  heating_oil: {
    label: "residential heating oil (No. 2)",
    url: "https://www.eia.gov/dnav/pet/hist_xls/W_EPD2F_PRS_NUS_DPGw.xls",
    seriesKey: "W_EPD2F_PRS_NUS_DPG",
    titleHas: "Heating Oil",
  },
  propane: {
    label: "residential propane",
    url: "https://www.eia.gov/dnav/pet/hist_xls/W_EPLLPA_PRS_NUS_DPGw.xls",
    seriesKey: "W_EPLLPA_PRS_NUS_DPG",
    titleHas: "Propane",
  },
};

export function productFor(fuel: string): Product {
  if (fuel === "heating_oil" || fuel === "propane") return fuel;
  throw new SourceError("For heating oil and propane, fuel must be heating_oil or propane.");
}

// ---------- the workbooks (pure parsing) ----------

/** date (YYYY-MM-DD) -> US dollars per gallon */
export type Series = Map<string, number>;

/** One workbook -> the weekly national series. Finds the data sheet by its series key, so a re-ordered workbook still works. */
export function parseSeries(sheets: Sheet[], product: Product): Series {
  const def = PRODUCT_DEFS[product];
  for (const sheet of sheets) {
    const keyRow = sheet.rows.findIndex((r) => String(r[0] ?? "").trim() === "Sourcekey");
    const dateRow = sheet.rows.findIndex((r) => String(r[0] ?? "").trim() === "Date");
    if (keyRow < 0 || dateRow < 0) continue;
    const col = sheet.rows[keyRow].findIndex((c, i) => i > 0 && String(c ?? "").trim() === def.seriesKey);
    if (col < 0) continue;
    const out: Series = new Map();
    for (const row of sheet.rows.slice(dateRow + 1)) {
      const date = excelDate(row[0]);
      const v = row[col];
      if (date && typeof v === "number" && Number.isFinite(v) && v > 0 && v < 50) out.set(date, v);
    }
    if (!out.size) throw new SourceError(`The EIA ${product} sheet holds no weekly prices; this source needs updating.`);
    return out;
  }
  throw new SourceError(`The EIA ${product} workbook has no sheet with series ${def.seriesKey}; it may have changed and this source needs updating.`);
}

function libraryRow(item: string, perGallon: number): DailyRow {
  const v = toLitre(perGallon);
  return { area: AREA, item, n: NO_COUNT, median: v, low: v, high: v, min: v, max: v };
}

/** Library rows for the newest week that BOTH series have (items: product, product@w1, product@y1). Values are US dollars per litre. */
export function weeklyRows(data: Record<Product, Series>): { date: string; rows: DailyRow[] } {
  let date = "";
  for (const p of PRODUCTS) {
    const latest = [...data[p].keys()].sort().pop();
    if (!latest) throw new SourceError(`The EIA ${p} series is empty; this source needs updating.`);
    if (!date || latest < date) date = latest;
  }
  const rows: DailyRow[] = [];
  for (const p of PRODUCTS) {
    const series = data[p];
    const v = nearPoint(series, date, 3);
    if (!v) continue;
    rows.push(libraryRow(p, v.value));
    const w = nearPoint(series, shiftDate(date, -7));
    if (w) rows.push(libraryRow(p + "@w1", w.value));
    const y = nearPoint(series, shiftDate(date, -364));
    if (y) rows.push(libraryRow(p + "@y1", y.value));
  }
  rows.sort((a, b) => a.item.localeCompare(b.item));
  return { date, rows };
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

/** The daily collector: read EIA's two history files, return the newest week both have. */
export async function usHeatingHarvest(): Promise<HarvestResult> {
  const [oil, propane] = await Promise.all(PRODUCTS.map((p) => download(PRODUCT_DEFS[p].url)));
  const { date, rows } = weeklyRows({ heating_oil: parseSeries(readXls(oil), "heating_oil"), propane: parseSeries(readXls(propane), "propane") });
  if (!rows.length) throw new SourceError("EIA's weekly heating oil and propane files held no usable prices");
  return {
    date,
    currency: "USD",
    unit: "per litre",
    rows,
    note:
      `EIA weekly US residential heating oil and propane prices for the week of ${date}, plus the week before (item@w1) and the same week a year earlier (item@y1). ` +
      `Stored in US dollars per litre (published US dollars per gallon / ${GALLON_LITRES}). One national average per series and week, so low/high/min/max repeat it and no record count is stored (n is empty). ` +
      "EIA collects these prices only from October to March, so outside the season the newest week is from March.",
  };
}

// ---------- reading the library (pure once the day is loaded) ----------

export interface Snapshot {
  date: string;
  /** item -> US dollars per litre, as stored */
  values: Map<string, number>;
}

export function snapshotOf(day: { date: string; rows: { area: string; item: string; median: number }[] }): Snapshot {
  const values = new Map<string, number>();
  for (const r of day.rows) if (r.area === AREA && Number.isFinite(r.median) && r.median > 0) values.set(r.item, r.median);
  return { date: day.date, values };
}

const usd = (v: number) => `$${v.toFixed(3)}`;
const roundTo = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;
const daysBetween = (from: string, to: Date) => Math.floor((to.getTime() - Date.parse(from + "T00:00:00Z")) / 86400000);

export function usHeatingMethod(): string {
  return (
    "The U.S. Energy Information Administration publishes, every week of the heating season (October to March), its estimate of the national average retail (residential) price of No. 2 heating oil and of propane, " +
    "in US dollars per gallon. ProofPrice copies EIA's history files once a day and returns the published figure for the newest week, unchanged, with the week before and the same week a year earlier. " +
    "No range is calculated: EIA gives one average and does not say how many suppliers are behind it. EIA collects no prices from April to September, so in summer the newest week is from March, and the answer says how old it is. " +
    "A town, area or postcode in the request is answered with the national average, and the answer says so."
  );
}

export interface UsHeatingQuery {
  fuel: string;
  area?: string;
  town?: string;
  postcode?: string;
  baseUrl?: string;
  today?: Date;
}

export function usHeatingAnswer(snap: Snapshot, product: Product, q: UsHeatingQuery): PriceAnswer {
  const def = PRODUCT_DEFS[product];
  const label = def.label;
  const query: Record<string, unknown> = {
    country: "US",
    fuel: q.fuel,
    ...(q.area ? { area: q.area } : {}),
    ...(q.town ? { town: q.town } : {}),
    ...(q.postcode ? { postcode: q.postcode } : {}),
  };
  const base = { source: INFO, query, measure: "average" as const, currency: "USD", unit: "per gallon", method: usHeatingMethod(), baseUrl: q.baseUrl };

  const get = (item: string) => {
    const v = snap.values.get(item);
    return v === undefined ? null : toGallon(v);
  };
  const value = get(product);
  if (value === null) {
    const none = buildStatisticAnswer({ ...base, value: null, period: { from: null, to: null }, reference_period: "", describe: () => "" });
    return { ...none, summary: `EIA's weekly files hold no ${label} price in our copy yet.` };
  }
  const weekAgo = get(product + "@w1");
  const yearAgo = get(product + "@y1");
  const date = snap.date;
  const age = daysBetween(date, q.today ?? new Date());

  const change = (from: number | null, referenceDate: string) =>
    from === null ? null : { reference_date: referenceDate, value: from, change_amount: roundTo(value - from, 3), change_percent: roundTo(((value - from) / from) * 100, 1) };
  const week = change(weekAgo, shiftDate(date, -7));
  const year = change(yearAgo, shiftDate(date, -364));

  const placeAsked = q.postcode || q.town || q.area;
  const notes: string[] = [];
  if (placeAsked) notes.push(`EIA's heating oil and propane series used here are national; no price for "${placeAsked}" is published, so this is the national average.`);
  if (age > 14) {
    notes.push(
      `Old data: the newest weekly price in our copy of EIA's files is from ${dateWords(date)}, ${age} days ago. EIA collects heating oil and propane prices only from October to March, so outside the heating season the newest week is from March.`,
    );
  }

  const describeChange = (c: NonNullable<ReturnType<typeof change>>, span: string, detail: string) =>
    c.change_percent === 0
      ? ` That is unchanged from ${span} (${detail}).`
      : ` That is ${Math.abs(c.change_percent)}% ${c.change_percent > 0 ? "higher" : "lower"} than ${span} (${detail}).`;

  const extra: Record<string, unknown> = {
    country_name: "United States",
    fuel: { requested: q.fuel, product, label, eia_series: def.seriesKey },
    area: { code: "US", name: "United States", kind: "national", ...(placeAsked ? { national_average_used: true, requested: placeAsked } : {}) },
    price_per_litre_usd: roundTo(value / GALLON_LITRES, 3),
    unit_note: "US dollars per US gallon (3.785 litres).",
    reference_week: date,
    reference_week_label: dateWords(date),
    change_on_week: week,
    change_on_year: year,
    ...(week ? {} : { change_on_week_unavailable: "EIA's file holds no price for the week before (prices are collected only from October to March)." }),
    ...(year ? {} : { change_on_year_unavailable: "EIA's file holds no price for the same week a year earlier." }),
    heating_season_note: "EIA collects residential heating oil and propane prices only from October to March; there is no new price from April to September.",
    dataset: { file: def.url, page: PAGE_URL, newest_week_held: date },
  };

  const answer = buildStatisticAnswer({
    ...base,
    value,
    period: { from: date, to: date },
    reference_period: `the week of ${date}`,
    note: notes.length ? notes.join(" ") : undefined,
    describe: (v) =>
      (placeAsked ? "EIA publishes no local price here, so this is the national average. " : "") +
      `In the United States the average residential price of ${label} was ${usd(v)} a gallon (about ${usd(roundTo(v / GALLON_LITRES, 3))} a litre) in the week of ${dateWords(date)}.` +
      (week ? describeChange(week, "a week earlier", usd(week.value)) : "") +
      (year ? describeChange(year, "a year earlier", `${usd(year.value)} on ${dateWords(year.reference_date)}`) : " EIA has no price for the same week a year earlier.") +
      (age > 14 ? ` Old data: this is the newest week in our copy, ${age} days ago (EIA collects these prices only from October to March).` : ""),
    extra,
  });
  return { ...answer, source: { ...answer.source, attribution: `Source: U.S. Energy Information Administration (${acknowledgmentDate(date)}). ${INFO.attribution}` } };
}

// ---------- the request ----------

export async function usHeatingNow(q: UsHeatingQuery): Promise<PriceAnswer> {
  const product = productFor(q.fuel);
  const day = readLatestDay(INFO.id);
  if (!day) throw new SourceError("ProofPrice has not collected EIA's weekly heating oil and propane prices yet; data appears after the next daily collection.");
  return usHeatingAnswer(snapshotOf(day), product, q);
}

/** The library keys for the history tool. */
export function usHeatingHistoryKey(p: { fuel: string }): { area: string; item: string; label: string } | null {
  if (p.fuel !== "heating_oil" && p.fuel !== "propane") return null;
  return { area: AREA, item: p.fuel, label: "United States" };
}
