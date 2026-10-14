// United States: EIA's weekly retail gasoline and on-highway diesel prices (the "Gasoline and Diesel Fuel Update").
// Formats checked live on 2026-10-14 through the GitHub probe and a throwaway Vercel route. EIA publishes the full weekly history as two
// legacy Excel files (BIFF8 .xls, no API key):
//   https://www.eia.gov/petroleum/gasdiesel/xls/pswrgvwall.xls  ~7.5 MB  gasoline: sheets "Data 3" (regular), "Data 6" (midgrade), "Data 9" (premium),
//                                    all areas and formulations: the U.S., 8 PADD regions, 9 states and 10 cities; one column per series
//   https://www.eia.gov/petroleum/gasdiesel/xls/psw18vwall.xls  ~0.8 MB  diesel: sheet "Data 1" (weekly, all types): the U.S., PADD regions and California
// Each sheet: row 0 title ("Data 3: Regular All Areas All Formulations"), row 1 "Sourcekey" + EIA series keys (EMM_EPMR_PTE_NUS_DPG ...),
// row 2 "Date" + descriptions, then one row per week: an Excel date serial (a Monday) and the price in US dollars per gallon, taxes included.
//
// The files are far too big to read per request, so the daily collector (harvest, on GitHub Actions) reads them and keeps, for the newest
// week every product has, each area's price, the week before (item@w1) and the same week a year earlier (item@y1) in the price library.
// Requests are answered from there. EIA publishes ONE average per series and week: no distribution, no number of stations, so the answer is an
// official statistic (value + measure "average", range fields null, sample_size null).
//
// The library stores US dollars per LITRE (6 decimals), not per gallon, because the shared fuel history tool labels every fuel "per litre";
// answers convert back to the published per-gallon figure exactly (see toGallon).

import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import { excelDate } from "../../categories/rent/xlsx";
import type { Sheet } from "../../categories/rent/xlsx";
import { readLatestDay } from "../../lib/library/store";
import { MIN_PUBLISH } from "../../lib/stats";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { Area, NATIONAL_AREA, Place, areaByEia, areaByKey, isPublished, resolvePlace } from "./areas";
import { readXls } from "./xls";

export const PAGE_URL = "https://www.eia.gov/petroleum/gasdiesel/";
export const GASOLINE_URL = "https://www.eia.gov/petroleum/gasdiesel/xls/pswrgvwall.xls";
export const DIESEL_URL = "https://www.eia.gov/petroleum/gasdiesel/xls/psw18vwall.xls";
export const COLLECTOR_USER_AGENT = "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)";

export const INFO: SourceInfo = {
  id: "us-eia-fuel",
  country: "US (United States)",
  category: "fuel (pump prices)",
  name: "Gasoline and Diesel Fuel Update: weekly retail gasoline and on-highway diesel prices",
  publisher: "U.S. Energy Information Administration (EIA)",
  what_is_recorded:
    "EIA's weekly estimate of the average retail price, including taxes, of regular, midgrade and premium gasoline and of on-highway diesel, in US dollars per gallon: " +
    "for the United States, its PADD regions (and, for gasoline, nine states and ten cities; for diesel, California). One published average per series and Monday; never an individual station.",
  price_type: "official_statistic",
  freshness:
    "Weekly: EIA dates each figure to the Monday it describes and publishes it a day or two later (a day later after a federal holiday); our copy of EIA's history files is refreshed daily and every answer states its week",
  licence:
    'Public domain. EIA states: "U.S. government publications are in the public domain and are not subject to copyright protection. You may use and/or distribute any of our data, files, databases, reports, graphs, charts, and other information products that are on our website or that you receive through our email distribution service. ' +
    'However, if you use or reproduce any of our information products, you should use an acknowledgment, which includes the publication date, such as: "Source: U.S. Energy Information Administration (Oct 2008)."" ' +
    "The EIA logo is a registered trademark and is not used here.",
  licence_url: "https://www.eia.gov/about/copyrights_reuse.php",
  attribution:
    "Source: U.S. Energy Information Administration, Gasoline and Diesel Fuel Update (weekly retail gasoline and diesel prices), https://www.eia.gov/petroleum/gasdiesel/ . Public domain; EIA asks for an acknowledgment with the publication date. " +
    "Prices are passed on as published; the US-dollars-per-litre figures and the changes on the week and the year are calculated by ProofPrice. ProofPrice is not endorsed by EIA.",
  homepage: PAGE_URL,
  limits:
    "Weekly averages that EIA estimates from its survey of retail outlets, including federal, state and local taxes: not an individual station's price, not a range, and EIA does not say how many stations stand behind a figure. " +
    "Gasoline is published for the United States, the PADD regions, nine states (CA, CO, FL, MA, MN, NY, OH, TX, WA) and ten cities (Boston, Chicago, Cleveland, Denver, Houston, Los Angeles, Miami, New York City, San Francisco, Seattle); " +
    "diesel only for the United States, the PADD regions and California. Any other place is answered with the national average and says so. Regular, midgrade and premium are EIA's grades (all areas and formulations); " +
    "EIA publishes no E10, E85, LPG or CNG prices. Prices are in US dollars per US gallon (3.785 litres). EIA warns that its estimates changed method on 14 May 2018 (gasoline) and 13 June 2022 (diesel), so older weeks are not strictly comparable.",
};

// ---------- units ----------

export const GALLON_LITRES = 3.785411784; // exact definition of the US liquid gallon

/** US dollars per gallon -> per litre, 6 decimals (what the library stores). */
export const toLitre = (perGallon: number) => Math.round((perGallon / GALLON_LITRES) * 1e6) / 1e6;
/** US dollars per litre as stored -> the published per-gallon figure (EIA publishes 3 decimals; this recovers them exactly). */
export const toGallon = (perLitre: number) => Math.round(perLitre * GALLON_LITRES * 1000) / 1000;
const roundTo = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;

/** What the library's `n` column holds for an EIA average: the library keeps no row below MIN_PUBLISH records, and EIA publishes no count, so every row carries this placeholder. Answers report sample_size null. */
export const LIBRARY_N_PLACEHOLDER = MIN_PUBLISH;

// ---------- products ----------

export type Product = "regular" | "midgrade" | "premium" | "diesel";
export const PRODUCTS: Product[] = ["regular", "midgrade", "premium", "diesel"];

interface ProductDef {
  label: string;
  /** The end of the sheet title in row 0 ("Data 3: Regular All Areas All Formulations"). */
  sheetTitle: string;
  file: "gasoline" | "diesel";
  /** EIA series-key prefix, for traceability. */
  seriesPrefix: string;
}

export const PRODUCT_DEFS: Record<Product, ProductDef> = {
  regular: { label: "regular gasoline", sheetTitle: "Regular All Areas All Formulations", file: "gasoline", seriesPrefix: "EMM_EPMR" },
  midgrade: { label: "midgrade gasoline", sheetTitle: "Midgrade All Areas All Formulations", file: "gasoline", seriesPrefix: "EMM_EPMM" },
  premium: { label: "premium gasoline", sheetTitle: "Premium All Areas All Formulations", file: "gasoline", seriesPrefix: "EMM_EPMP" },
  diesel: { label: "on-highway diesel (all types)", sheetTitle: "W Diesel Prices - All Types", file: "diesel", seriesPrefix: "EMD_EPD2D" },
};

const GRADES: Record<string, Product> = { regular: "regular", midgrade: "midgrade", "mid-grade": "midgrade", mid: "midgrade", premium: "premium" };

/** The fuel tool's fuel (and the US-only gasoline_grade) -> EIA product. */
export function productFor(fuel: string, grade?: string): Product {
  const g = (grade ?? "").trim().toLowerCase();
  const asked = g ? GRADES[g] : undefined;
  if (g && !asked) throw new InputError("gasoline_grade must be regular, midgrade or premium.");
  if (fuel === "diesel") {
    if (asked) throw new InputError("gasoline_grade applies to petrol only; leave it out for diesel.");
    return "diesel";
  }
  if (fuel === "petrol95" || fuel === "petrol98") return asked ?? (fuel === "petrol95" ? "regular" : "premium");
  throw new InputError(
    "For the US, fuel must be petrol95 (regular gasoline), petrol98 (premium gasoline) or diesel; for midgrade gasoline use petrol95 with gasoline_grade=midgrade. EIA publishes no E10, E85, LPG or CNG prices.",
  );
}

// ---------- dates ----------

export function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(date + "T00:00:00Z") + days * 86400000).toISOString().slice(0, 10);
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function dateWords(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return m ? `${Number(m[3])} ${MONTH_NAMES[Number(m[2]) - 1]} ${m[1]}` : date;
}
/** "Oct 2026": the form EIA asks for in an acknowledgment ("Source: U.S. Energy Information Administration (Oct 2008)"). */
export function acknowledgmentDate(date: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(date);
  return m ? `${MONTH_SHORT[Number(m[2]) - 1]} ${m[1]}` : date;
}

// ---------- the two workbooks (pure parsing) ----------

/** area key -> date (YYYY-MM-DD) -> US dollars per gallon */
export type SeriesByArea = Map<string, Map<string, number>>;

const SERIES_KEY = /^(?:EMM|EMD)_[A-Z0-9]+_PTE_([A-Z0-9]+)_DPG$/;

/** One data sheet: find the Sourcekey and Date rows, map every column to an area by its series key, keep the weekly prices. */
export function parseWeeklySheet(sheet: Sheet): SeriesByArea {
  const keyRow = sheet.rows.findIndex((r) => String(r[0] ?? "").trim() === "Sourcekey");
  const dateRow = sheet.rows.findIndex((r) => String(r[0] ?? "").trim() === "Date");
  if (keyRow < 0 || dateRow < 0) throw new SourceError(`The EIA price sheet "${sheet.name}" has a new layout (no Sourcekey or Date row); this source needs updating.`);
  const cols: { col: number; area: Area }[] = [];
  sheet.rows[keyRow].forEach((c, col) => {
    if (col === 0) return;
    const m = SERIES_KEY.exec(String(c ?? "").trim());
    const area = m ? areaByEia(m[1]) : undefined;
    if (area) cols.push({ col, area });
  });
  const out: SeriesByArea = new Map();
  for (const { area } of cols) out.set(area.key, new Map());
  for (const row of sheet.rows.slice(dateRow + 1)) {
    const date = excelDate(row[0]);
    if (!date) continue;
    for (const { col, area } of cols) {
      const v = row[col];
      if (typeof v === "number" && Number.isFinite(v) && v > 0 && v < 50) out.get(area.key)!.set(date, v);
    }
  }
  return out;
}

function findSheet(sheets: Sheet[], titleEnd: string): Sheet {
  const hit = sheets.find((s) => String(s.rows[0]?.[1] ?? "").trim().endsWith(titleEnd));
  if (!hit) throw new SourceError(`The EIA workbook has no sheet titled "...${titleEnd}"; it may have changed and this source needs updating.`);
  return hit;
}

export function parseWorkbooks(gasoline: Sheet[], diesel: Sheet[]): Record<Product, SeriesByArea> {
  const out = {} as Record<Product, SeriesByArea>;
  for (const p of PRODUCTS) {
    const def = PRODUCT_DEFS[p];
    out[p] = parseWeeklySheet(findSheet(def.file === "gasoline" ? gasoline : diesel, def.sheetTitle));
  }
  return out;
}

/** The point of a series nearest to `target` within `tolerance` days (weeks that EIA dates a day off around holidays). */
export function nearPoint(series: Map<string, number>, target: string, tolerance = 3): { date: string; value: number } | null {
  for (let d = 0; d <= tolerance; d++) {
    for (const off of d === 0 ? [0] : [-d, d]) {
      const date = shiftDate(target, off);
      const v = series.get(date);
      if (v !== undefined) return { date, value: v };
    }
  }
  return null;
}

function libraryRow(area: string, item: string, perGallon: number): DailyRow {
  const v = toLitre(perGallon);
  return { area, item, n: LIBRARY_N_PLACEHOLDER, median: v, low: v, high: v, min: v, max: v };
}

/**
 * Library rows for the newest week for which every product has a national price. For every area and product: the price (item = product),
 * the week before (product@w1) and the same week a year earlier (product@y1), when EIA has them. Values are US dollars per litre.
 */
export function weeklyRows(data: Record<Product, SeriesByArea>): { date: string; rows: DailyRow[] } {
  let date = "";
  for (const p of PRODUCTS) {
    const nat = data[p].get(NATIONAL_AREA.key);
    if (!nat || !nat.size) throw new SourceError(`The EIA ${p} sheet has no national weekly series; this source needs updating.`);
    const latest = [...nat.keys()].sort().pop()!;
    if (!date || latest < date) date = latest; // the newest week every product has
  }
  const rows: DailyRow[] = [];
  for (const p of PRODUCTS) {
    for (const [area, series] of data[p]) {
      const v = series.get(date);
      if (v === undefined) continue;
      rows.push(libraryRow(area, p, v));
      const w = nearPoint(series, shiftDate(date, -7));
      if (w) rows.push(libraryRow(area, p + "@w1", w.value));
      const y = nearPoint(series, shiftDate(date, -364));
      if (y) rows.push(libraryRow(area, p + "@y1", y.value));
    }
  }
  rows.sort((a, b) => a.area.localeCompare(b.area) || a.item.localeCompare(b.item));
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

/** The daily collector: read EIA's two history files, return the newest week of every area and product. */
export async function usFuelHarvest(): Promise<HarvestResult> {
  const [gas, dsl] = await Promise.all([download(GASOLINE_URL), download(DIESEL_URL)]);
  const data = parseWorkbooks(readXls(gas), readXls(dsl));
  const { date, rows } = weeklyRows(data);
  if (!rows.length) throw new SourceError("EIA's weekly fuel files held no usable prices");
  const current = rows.filter((r) => !r.item.includes("@")).length;
  return {
    date,
    currency: "USD",
    unit: "per litre",
    rows,
    note:
      `EIA weekly retail prices for the week of ${date}: ${current} series (regular, midgrade, premium gasoline and on-highway diesel x the areas EIA publishes), plus the week before (item@w1) and the same week a year earlier (item@y1). ` +
      `Stored in US dollars per litre (published US dollars per gallon / ${GALLON_LITRES}). EIA publishes one average per series and week, so low/high/min/max repeat it and n is the library minimum (${LIBRARY_N_PLACEHOLDER}), not a count of stations.`,
  };
}

// ---------- reading the library (pure once the day is loaded) ----------

export interface Snapshot {
  date: string;
  /** "<area>|<item>" -> US dollars per litre, as stored */
  values: Map<string, number>;
}

export function snapshotOf(day: { date: string; rows: { area: string; item: string; median: number }[] }): Snapshot {
  const values = new Map<string, number>();
  for (const r of day.rows) if (Number.isFinite(r.median) && r.median > 0) values.set(`${r.area}|${r.item}`, r.median);
  return { date: day.date, values };
}

export interface Reading {
  area: Area;
  product: Product;
  /** US dollars per gallon, as published */
  value: number;
  weekAgo: number | null;
  yearAgo: number | null;
}

export function readingFor(snap: Snapshot, area: Area, product: Product): Reading | null {
  const get = (item: string) => {
    const v = snap.values.get(`${area.key}|${item}`);
    return v === undefined ? null : toGallon(v);
  };
  const value = get(product);
  if (value === null) return null;
  return { area, product, value, weekAgo: get(product + "@w1"), yearAgo: get(product + "@y1") };
}

// ---------- the answer (pure) ----------

const usd = (v: number) => `$${v.toFixed(3)}`;

export function usMethod(): string {
  return (
    "The U.S. Energy Information Administration publishes, every week, its estimate of the average retail price (taxes included) of regular, midgrade and premium gasoline and of on-highway diesel, " +
    "in US dollars per gallon, for the United States, its PADD regions, nine states and ten cities (diesel: the United States, the regions and California). ProofPrice copies EIA's two history files once a day " +
    "and returns the published figure for the newest week, unchanged, with the week before and the same week a year earlier. No range is calculated: EIA gives one average and does not say how many stations are behind it. " +
    "A place EIA does not publish is answered with the national average, and the answer says so."
  );
}

export interface UsFuelQuery {
  fuel: string;
  gasoline_grade?: string;
  area?: string;
  town?: string;
  postcode?: string;
  baseUrl?: string;
  today?: Date;
}

function whereWords(a: Area): string {
  if (a.kind === "national") return "the United States (national average)";
  if (a.kind === "padd") return `the ${a.name} region`;
  if (a.kind === "state") return a.name;
  return a.name;
}

function seriesKey(a: Area, p: Product): string {
  return `${PRODUCT_DEFS[p].seriesPrefix}_PTE_${a.eia}_DPG`;
}

const daysBetween = (from: string, to: Date) => Math.floor((to.getTime() - Date.parse(from + "T00:00:00Z")) / 86400000);

export function usFuelAnswer(snap: Snapshot, place: Place, product: Product, q: UsFuelQuery): PriceAnswer {
  const label = PRODUCT_DEFS[product].label;
  const query: Record<string, unknown> = {
    country: "US",
    fuel: q.fuel,
    ...(q.gasoline_grade ? { gasoline_grade: q.gasoline_grade } : {}),
    ...(q.area ? { area: q.area } : {}),
    ...(q.town ? { town: q.town } : {}),
    ...(q.postcode ? { postcode: q.postcode } : {}),
  };
  const base = { source: INFO, query, measure: "average" as const, currency: "USD", unit: "per gallon", method: usMethod(), baseUrl: q.baseUrl };

  const requestedArea = place.area;
  let chosen = requestedArea ? readingFor(snap, requestedArea, product) : null;
  const national = readingFor(snap, NATIONAL_AREA, product);
  let fellBack = false;
  if (!chosen) {
    chosen = national;
    fellBack = !!place.requested;
  }
  if (!chosen) {
    const none = buildStatisticAnswer({ ...base, value: null, period: { from: null, to: null }, reference_period: "", describe: () => "" });
    return { ...none, summary: `EIA's weekly files hold no ${label} price for ${requestedArea?.name ?? place.requested ?? "the United States"}, and no national figure was found either.` };
  }

  const date = snap.date;
  const today = q.today ?? new Date();
  const age = daysBetween(date, today);
  const r = chosen;

  // What stands in for a place EIA does not publish: the nearest published region, as context beside the national figure.
  let context: Reading | null = null;
  if (fellBack) {
    const stateArea = place.state ? areaByKey(place.state.code) : undefined;
    for (const a of [stateArea, place.padd ?? undefined]) {
      if (!a || a.key === NATIONAL_AREA.key || (requestedArea && a.key === requestedArea.key)) continue;
      context = readingFor(snap, a, product);
      if (context) break;
    }
  }

  const change = (from: number | null, referenceDate: string) =>
    from === null
      ? null
      : { reference_date: referenceDate, value: from, change_amount: roundTo(r.value - from, 3), change_percent: roundTo(((r.value - from) / from) * 100, 1) };
  const week = change(r.weekAgo, shiftDate(date, -7));
  const year = change(r.yearAgo, shiftDate(date, -364));

  const otherFuels: Record<string, number> = {};
  for (const p of PRODUCTS) {
    if (p === product) continue;
    const o = readingFor(snap, r.area, p);
    if (o) otherFuels[p] = o.value;
  }
  const nationalOther = national && r.area.key !== NATIONAL_AREA.key ? national.value : null;

  // The sentence that says a place EIA does not publish is answered with the national average.
  let fallbackSentence = "";
  if (fellBack) {
    const what = requestedArea ? requestedArea.name : place.state ? place.state.name : place.requested!;
    fallbackSentence =
      `EIA publishes no ${label} price for ${what}` +
      (product === "diesel" && (requestedArea || place.state) ? " (it publishes diesel only for the United States, the PADD regions and California)" : "") +
      ", so this is the national average.";
  }
  const notes: string[] = [];
  if (fallbackSentence) notes.push(fallbackSentence);
  if (place.note) notes.push(place.note);
  if (age > 14) notes.push(`Old data: the newest weekly price in our copy of EIA's files is from ${dateWords(date)}, ${age} days ago.`);

  const describeChange = (c: NonNullable<ReturnType<typeof change>>, span: string, detail: string) =>
    c.change_percent === 0
      ? ` That is unchanged from ${span} (${detail}).`
      : ` That is ${Math.abs(c.change_percent)}% ${c.change_percent > 0 ? "higher" : "lower"} than ${span} (${detail}).`;

  const fallbackText = fallbackSentence
    ? `${fallbackSentence} ` +
      (context ? `For context, the ${context.area.name}${context.area.kind === "padd" ? " region" : ""} averaged ${usd(context.value)} a gallon. ` : "")
    : "";

  const extra: Record<string, unknown> = {
    country_name: "United States",
    fuel: { requested: q.fuel, ...(q.gasoline_grade ? { gasoline_grade: q.gasoline_grade } : {}), product, label, eia_series: seriesKey(r.area, product) },
    area: {
      code: r.area.key === "ALL" ? "US" : r.area.key,
      name: r.area.name,
      kind: r.area.kind,
      ...(place.requested ? { requested: place.requested } : {}),
      ...(fellBack ? { national_average_used: true } : {}),
    },
    price_per_litre_usd: roundTo(r.value / GALLON_LITRES, 3),
    unit_note: "US dollars per US gallon (3.785 litres), taxes included.",
    reference_week: date,
    reference_week_label: dateWords(date),
    change_on_week: week,
    change_on_year: year,
    ...(year ? {} : { change_on_year_unavailable: "EIA's file holds no price for this series in the same week a year earlier." }),
    other_fuels_usd_per_gallon: otherFuels,
    ...(nationalOther !== null ? { national_average_usd_per_gallon: nationalOther } : {}),
    ...(context ? { regional_context: { area: context.area.name, kind: context.area.kind, usd_per_gallon: context.value, note: "EIA publishes this region; the requested place is not published." } } : {}),
    ...(place.note ? { place_note: place.note } : {}),
    eia_method_note: "EIA changed its estimation method for gasoline on 14 May 2018 and for diesel on 13 June 2022; prices before those dates are not directly comparable with later ones.",
    dataset: { gasoline_file: GASOLINE_URL, diesel_file: DIESEL_URL, page: PAGE_URL, newest_week_held: date },
  };

  const answer = buildStatisticAnswer({
    ...base,
    value: r.value,
    period: { from: date, to: date },
    reference_period: `the week of ${date}`,
    note: notes.length ? notes.join(" ") : undefined,
    describe: (v) =>
      fallbackText +
      `In ${whereWords(r.area)} the average retail price of ${label} was ${usd(v)} a gallon (about ${usd(roundTo(v / GALLON_LITRES, 3))} a litre), taxes included, in the week of ${dateWords(date)}.` +
      (week ? describeChange(week, "a week earlier", usd(week.value)) : "") +
      (year ? describeChange(year, "a year earlier", `${usd(year.value)} on ${dateWords(year.reference_date)}`) : " EIA has no price for the same week a year earlier.") +
      (age > 14 ? ` Old data: this is the newest week in our copy, ${age} days ago.` : ""),
    extra,
  });
  // EIA asks for an acknowledgment that includes the publication date.
  return { ...answer, source: { ...answer.source, attribution: `Source: U.S. Energy Information Administration (${acknowledgmentDate(date)}). ${INFO.attribution}` } };
}

// ---------- the request ----------

export async function usFuelNow(q: UsFuelQuery): Promise<PriceAnswer> {
  const product = productFor(q.fuel, q.gasoline_grade);
  const place = resolvePlace({ area: q.area, town: q.town, postcode: q.postcode });
  const day = readLatestDay(INFO.id);
  if (!day) throw new SourceError("ProofPrice has not collected EIA's weekly fuel prices yet; data appears after the next daily collection.");
  return usFuelAnswer(snapshotOf(day), place, product, q);
}

/** The library keys for the history tool: the area EIA publishes for the request (the nation when it publishes none) and the product. */
export function usFuelHistoryKey(p: { fuel: string; gasoline_grade?: string; area?: string; town?: string }): { area: string; item: string; label: string } | null {
  let product: Product;
  try {
    product = productFor(p.fuel, p.gasoline_grade);
  } catch {
    return null;
  }
  const place = resolvePlace({ area: p.area, town: p.town });
  const area = place.area && isPublished(place.area.key, product) ? place.area : NATIONAL_AREA;
  return { area: area.key, item: product, label: whereWords(area).replace(/^the /, "") };
}
