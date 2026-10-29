// Western Australia: station-level pump prices from FuelWatch's own open monthly files ("FuelWatch Historic Fuel Prices").
// Every WA fuel retailer notifies FuelWatch a price for each fuel for the next 24 hours (6am to 6am); the Government of Western Australia
// publishes them as one CSV per month, with the current month's file extended every day. The files are big (about 10 MB), so the daily
// collector (harvest) turns the newest day into aggregates (median, 10th-90th percentile, count per state, Perth, region, postcode and
// suburb) and answers come from the price library. Never one station's price: aggregates of 5+ stations. WA only, not national Australia.
// File format checked live on 29 Oct 2026 (probes dep-wafw4 and dep-wafw5, GitHub Actions).
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { Fuel, stripAccents } from "../../lib/fuels";
import { aggregateDaily } from "../../lib/library/aggregate";
import { readDaily, readLatestDay, readMeta } from "../../lib/library/store";
import { MIN_PUBLISH } from "../../lib/stats";

export const INFO: SourceInfo = {
  id: "au-wa-fuelwatch",
  country: "AU (Western Australia)",
  category: "fuel (pump prices)",
  name: "FuelWatch Historic Fuel Prices (daily station prices, Western Australia)",
  publisher: "FuelWatch, Department of Energy, Mines, Industry Regulation and Safety (DEMIRS), Government of Western Australia",
  what_is_recorded:
    "The price per litre that each Western Australian fuel retailer notified to FuelWatch for each fuel for the day (prices are fixed from 6am for 24 hours), by station: trading name, brand, address, suburb, postcode, area and region. We take the newest day of the current monthly file.",
  price_type: "posted_pump_price",
  freshness: "Daily: the current month's file is extended each day with the previous day's prices; our copy is taken once a day and every answer states the day it is for",
  licence:
    "Creative Commons Attribution 4.0 (CC BY 4.0). The Government of Western Australia open-data catalogue record 'FuelWatch Historic Fuel Prices' (author FuelWatch, DEMIRS) states: license_title 'Creative Commons Attribution 4.0', license_id 'cc-by' (read via catalogue.data.wa.gov.au package_show on 29 Oct 2026). The monthly files are the data behind that record's resource link, https://www.fuelwatch.wa.gov.au/retail/historic.",
  licence_url: "https://creativecommons.org/licenses/by/4.0/",
  attribution:
    "Source: FuelWatch, Department of Energy, Mines, Industry Regulation and Safety, Government of Western Australia (FuelWatch Historic Fuel Prices, data.wa.gov.au), licensed CC BY 4.0. Medians and ranges are calculated by ProofPrice.",
  homepage: "https://catalogue.data.wa.gov.au/dataset/fuelwatch-historic-fuel-prices",
  limits:
    "Western Australia only (not the rest of Australia). Posted pump prices in Australian dollars per litre, GST included, as retailers notify them to FuelWatch for the day: not prices paid, and they exclude shopper-docket and loyalty discounts. " +
    "Perth and Mandurah unleaded follows a weekly price cycle, so one day can sit well above or below the weekly average. Standard unleaded (ULP) is 91 RON in Australia, not 95; the file also holds premium unleaded (PULP) and brand diesel. " +
    "Diesel is each station's standard Diesel price, or its Brand Diesel price where it lists no standard Diesel. A place with fewer than 5 stations selling the fuel gets no figure.",
};

/** Our fuel names -> FuelWatch PRODUCT_DESCRIPTION values (upper case). Diesel also takes BRAND DIESEL when a station has no plain Diesel. */
export const WA_PRODUCT: Partial<Record<Fuel, string>> = { petrol95: "ULP", petrol98: "98 RON", diesel: "DIESEL", lpg: "LPG", e85: "E85" };
export const WA_LABEL: Partial<Record<Fuel, string>> = {
  petrol95: "Unleaded petrol (ULP, 91 RON)",
  petrol98: "98 RON petrol",
  diesel: "Diesel",
  lpg: "LPG",
  e85: "E85",
};
const FUEL_BY_PRODUCT: Record<string, Fuel> = { ULP: "petrol95", "98 RON": "petrol98", DIESEL: "diesel", "BRAND DIESEL": "diesel", LPG: "lpg", E85: "e85" };

/** A notified price of 100 to 500 cents per litre is believed; anything else is a slip. */
export const MIN_CENTS = 100;
export const MAX_CENTS = 500;

export const WA_STATE = "WA";
export const WA_PERTH = "PERTH";

/** Normalised form used in library keys and for matching what a caller types: no accents, upper case, single spaces. */
export const waKey = (s: string) => stripAccents(s).replace(/[+_]/g, " ").replace(/\s+/g, " ").trim();

// ---------- the monthly file ----------

export const FILE_BASE = "https://warsydprdstafuelwatch.blob.core.windows.net/historical-reports";

export function fileUrl(year: number, month: number): string {
  return `${FILE_BASE}/FuelWatchRetail-${String(month).padStart(2, "0")}-${year}.csv`;
}

export interface WaRecord {
  date: string; // YYYY-MM-DD
  station: string;
  brand: string;
  address: string;
  suburb: string;
  postcode: string;
  region: string;
  area: string;
  fuel: Fuel;
  brandDiesel: boolean;
  cents: number;
}

/** Split one CSV line (comma separated, double quotes may hold commas). */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Parse a FuelWatch monthly CSV. Unknown products (PULP and others) and implausible prices are skipped; `unknown` lists the product names skipped. */
export function parseFuelWatchCsv(text: string): { records: WaRecord[]; unknown: string[] } {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const head = splitCsvLine(lines[0] ?? "").map((h) => h.trim().toUpperCase());
  const col = (n: string) => head.indexOf(n);
  const c = {
    date: col("PUBLISH_DATE"), name: col("TRADING_NAME"), brand: col("BRAND_DESCRIPTION"), product: col("PRODUCT_DESCRIPTION"), price: col("PRODUCT_PRICE"),
    address: col("ADDRESS"), suburb: col("LOCATION"), postcode: col("POSTCODE"), area: col("AREA_DESCRIPTION"), region: col("REGION_DESCRIPTION"),
  };
  if (Object.values(c).some((i) => i < 0)) throw new SourceError("The FuelWatch file does not have the expected columns", lines[0]?.slice(0, 200));
  const records: WaRecord[] = [];
  const unknown = new Set<string>();
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const f = splitCsvLine(lines[i]);
    const dm = (f[c.date] ?? "").trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!dm) continue;
    const product = (f[c.product] ?? "").trim().toUpperCase();
    const fuel = FUEL_BY_PRODUCT[product];
    if (!fuel) {
      if (product) unknown.add(product);
      continue;
    }
    const cents = Number((f[c.price] ?? "").trim());
    if (!Number.isFinite(cents) || cents < MIN_CENTS || cents > MAX_CENTS) continue;
    records.push({
      date: `${dm[3]}-${dm[2]}-${dm[1]}`,
      station: (f[c.name] ?? "").trim(),
      brand: (f[c.brand] ?? "").trim(),
      address: (f[c.address] ?? "").trim(),
      suburb: waKey(f[c.suburb] ?? ""),
      postcode: (f[c.postcode] ?? "").trim(),
      region: waKey(f[c.region] ?? ""),
      area: waKey(f[c.area] ?? ""),
      fuel,
      brandDiesel: product === "BRAND DIESEL",
      cents,
    });
  }
  return { records, unknown: [...unknown].sort() };
}

/** The newest day in the records: one price per station and fuel (standard Diesel wins over Brand Diesel; else the later row). */
export function newestDay(records: WaRecord[]): { date: string; stations: WaRecord[] } {
  let date = "";
  for (const r of records) if (r.date > date) date = r.date;
  if (!date) throw new SourceError("The FuelWatch file held no usable prices");
  const seen = new Map<string, WaRecord>();
  for (const r of records) {
    if (r.date !== date) continue;
    const k = `${r.station}\u0000${r.address}\u0000${r.fuel}`;
    const prev = seen.get(k);
    if (!prev || (prev.brandDiesel && !r.brandDiesel)) seen.set(k, r);
  }
  return { date, stations: [...seen.values()] };
}

/** Library rows for the newest day. Areas: WA, PERTH (region Metro), R:<REGION>, A:<AREA>, a 4-digit postcode, or the upper-case suburb. */
export function waDailyRows(records: WaRecord[], unknown: string[] = []): HarvestResult {
  const { date, stations } = newestDay(records);
  const flat: { area: string; item: string; price: number }[] = [];
  for (const s of stations) {
    const price = Math.round(s.cents * 10) / 1000; // cents per litre -> dollars (one decimal of a cent)
    const add = (area: string) => area && flat.push({ area, item: s.fuel, price });
    add(WA_STATE);
    if (s.region === "METRO") add(WA_PERTH);
    if (s.region) add(`R:${s.region}`);
    if (s.area) add(`A:${s.area}`);
    if (/^6\d{3}$/.test(s.postcode)) add(s.postcode);
    add(s.suburb);
  }
  const rows: DailyRow[] = aggregateDaily(flat, false);
  return {
    date,
    currency: "AUD",
    unit: "per litre",
    rows,
    note:
      `FuelWatch prices for ${date}: one price per station and fuel. Areas: WA = Western Australia, PERTH = Metro region, R:name = region, A:name = area, 4-digit postcode, or upper-case suburb (5+ stations).` +
      (unknown.length ? ` Products not offered: ${unknown.join(", ")}.` : ""),
  };
}

const UA = "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)";

async function fetchMonth(year: number, month: number): Promise<string | null> {
  const url = fileUrl(year, month);
  let res: Response;
  try {
    res = await fetch(url, { headers: { "user-agent": UA, accept: "text/csv,*/*" }, signal: AbortSignal.timeout(180000) });
  } catch (e: any) {
    throw new SourceError("Could not reach the FuelWatch open-data files", String(e?.cause?.code ?? e?.message ?? e));
  }
  if (res.status === 404 || res.status === 400) return null; // the month's file is not there yet
  if (!res.ok) throw new SourceError(`FuelWatch returned HTTP ${res.status}`, url, res.status);
  return await res.text();
}

/** Daily collector: the current month's file, or the previous month's on the first day before the new file exists. */
export async function waHarvest(now = new Date()): Promise<HarvestResult> {
  let y = now.getUTCFullYear();
  let m = now.getUTCMonth() + 1;
  for (let i = 0; i < 2; i++) {
    const text = await fetchMonth(y, m);
    if (text !== null) {
      const { records, unknown } = parseFuelWatchCsv(text);
      if (records.length) return waDailyRows(records, unknown);
    }
    m--;
    if (m < 1) {
      m = 12;
      y--;
    }
  }
  throw new SourceError("No FuelWatch monthly file with prices found for this or last month");
}

// ---------- places ----------

export interface WaPlace {
  area: string; // library key
  label: string;
}

const STATE_NAMES = new Set(["WA", "W A", "WESTERN AUSTRALIA", "STATE", "STATEWIDE", "ALL"]);
const PERTH_NAMES = new Set(["PERTH", "GREATER PERTH", "PERTH METRO", "PERTH METROPOLITAN", "PERTH AREA", "METRO", "METROPOLITAN"]);

function titleCase(s: string): string {
  return s.toLowerCase().replace(/(^|[\s\-'/])([a-z])/g, (_, a, b) => a + b.toUpperCase());
}

/** Area keys of the newest library day, cached per day. */
const keyCache = new Map<string, { date: string; keys: Set<string> }>();
export function libraryKeys(sourceId: string): Set<string> {
  const date = readMeta(sourceId)?.last_date ?? "";
  const hit = keyCache.get(sourceId);
  if (hit && hit.date === date) return hit.keys;
  const keys = new Set<string>();
  for (const r of readLatestDay(sourceId)?.rows ?? []) keys.add(r.area);
  keyCache.set(sourceId, { date, keys });
  return keys;
}

/** What a request means: all of WA, Perth (Metro region), a region or area, a postcode or a suburb. */
export function resolveWaPlace(p: { area?: string; town?: string; postcode?: string }, keys: () => Set<string> = () => libraryKeys(INFO.id)): WaPlace {
  const pc = p.postcode?.trim();
  if (pc) {
    if (!/^6\d{3}$/.test(pc)) throw new InputError("Give a Western Australian postcode of 4 digits starting with 6 (for example 6000), or a suburb as town, or area 'Perth' or 'WA'.");
    return { area: pc, label: `postcode ${pc}` };
  }
  const area = p.area ? waKey(p.area).toUpperCase() : "";
  const town = p.town ? waKey(p.town).toUpperCase() : "";
  if (town && !STATE_NAMES.has(town) && !PERTH_NAMES.has(town)) return { area: town, label: `the suburb of ${titleCase(town)}` };
  const name = area || town;
  if (!name) throw new InputError("Give a Western Australian suburb as town (for example 'Rockingham'), a postcode (for example 6000), or area 'Perth' or 'WA' (the whole state).");
  if (STATE_NAMES.has(name)) return { area: WA_STATE, label: "Western Australia" };
  if (PERTH_NAMES.has(name)) return { area: WA_PERTH, label: "Perth (the FuelWatch Metro region)" };
  const k = keys();
  if (k.has(`R:${name}`)) return { area: `R:${name}`, label: `the ${titleCase(name)} region` };
  if (k.has(`A:${name}`)) return { area: `A:${name}`, label: `the ${titleCase(name)} area` };
  return { area: name, label: `the suburb of ${titleCase(name)}` };
}

/** Does this request belong to Western Australia (rather than Queensland, the other Australian fuel source)? */
export function servesWa(p: { area?: string; town?: string; postcode?: string }, wa: () => Set<string> = () => libraryKeys(INFO.id), qld: () => Set<string> = () => libraryKeys("au-qld-fuel")): boolean {
  const pc = p.postcode?.trim() || (/^\d{4}$/.test((p.town ?? "").trim()) ? p.town!.trim() : "");
  if (pc && /^\d{4}$/.test(pc)) return /^6/.test(pc);
  const names = [p.area, p.town].filter(Boolean).map((s) => waKey(s!).toUpperCase());
  if (names.some((n) => STATE_NAMES.has(n) && n !== "ALL" && n !== "STATE" && n !== "STATEWIDE")) return true;
  if (names.some((n) => n === "PERTH" || n === "GREATER PERTH" || n === "PERTH METRO" || n === "PERTH METROPOLITAN")) return true;
  try {
    const w = wa();
    const q = qld();
    return names.some((n) => (w.has(n) || w.has(`R:${n}`) || w.has(`A:${n}`)) && !q.has(n));
  } catch {
    return false;
  }
}

export function waHistoryKey(p: { area?: string; town?: string; postcode?: string; fuel: string }): { area: string; item: string; label: string } | null {
  if (!WA_PRODUCT[p.fuel as Fuel]) return null;
  try {
    const place = resolveWaPlace(p);
    return { area: place.area, item: p.fuel, label: `${place.label}, Western Australia` };
  } catch {
    return null;
  }
}

// ---------- answers ----------

export function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso + "T00:00:00Z") + days * 86400000).toISOString().slice(0, 10);
}
const today = () => new Date().toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);

export function waAnswerFromRow(
  row: DailyRow & { date: string },
  q: { fuel: Fuel; place: WaPlace; query: Record<string, unknown>; libraryDate: string; now?: string; baseUrl?: string },
): PriceAnswer {
  const age = Math.max(0, daysBetween(row.date, q.now ?? today()));
  const label = WA_LABEL[q.fuel] ?? q.fuel;
  const old = age > 7;
  return buildAnswer({
    source: INFO,
    query: q.query,
    summary: { count: row.n, median: row.median, low: row.low, high: row.high, min: row.min, max: row.max },
    currency: "AUD",
    unit: "per litre",
    period: { from: row.date, to: row.date },
    method:
      "Median and 10th–90th percentile of the price per litre that each Western Australian station notified to FuelWatch for the day shown (one price per station and fuel, GST included). " +
      "A posted price, not a price paid. ProofPrice copies the FuelWatch file once a day.",
    describe: (x) =>
      `${label} in ${q.place.label}, Western Australia: FuelWatch posted pump prices for ${row.date} (one price per station, GST included) have a median of ${fmtMoney(x.median, "AUD")} per litre; ` +
      `typical range (10th–90th percentile) ${fmtMoney(x.low, "AUD")}–${fmtMoney(x.high, "AUD")} across ${row.n} stations.` +
      (old ? ` This is old data: ${age} days have passed since that day.` : ""),
    baseUrl: q.baseUrl,
    extra: {
      coverage: "Western Australia only",
      price_day: row.date,
      data_age_days: age,
      stations_counted: row.n,
      ...(old ? { stale_warning: `The newest FuelWatch day for this place is ${age} days old.` } : {}),
      ...(row.date < q.libraryDate
        ? { note: `This place had fewer than ${MIN_PUBLISH} stations selling this fuel on the newest day (${q.libraryDate}); the figure is from ${row.date}.` }
        : {}),
    },
  });
}

export async function waFuelNow(input: { area?: string; town?: string; postcode?: string; fuel: Fuel; baseUrl?: string }): Promise<PriceAnswer> {
  if (!WA_PRODUCT[input.fuel]) throw new InputError("Fuel for Western Australia must be diesel, petrol95 (standard unleaded ULP, 91 RON), petrol98, lpg or e85.");
  const meta = readMeta(INFO.id);
  if (!meta?.last_date) throw new SourceError("Not yet available: ProofPrice collects the FuelWatch price files daily; figures appear after the first collection.");
  const place = resolveWaPlace(input);
  const query = { country: "AU", state: "WA", postcode: input.postcode ?? null, area: input.area ?? null, town: input.town ?? null, fuel: input.fuel };
  const rows = readDaily(INFO.id, { area: place.area, item: input.fuel, from: addDays(meta.last_date, -14), to: meta.last_date }).filter((r) => r.n >= MIN_PUBLISH);
  const row = rows[rows.length - 1];
  if (!row) {
    return buildAnswer({
      source: INFO,
      query,
      summary: null,
      currency: "AUD",
      unit: "per litre",
      period: { from: null, to: null },
      method: "FuelWatch prices notified by Western Australian stations; a place is published when at least 5 stations sell the fuel there.",
      describe: () => "",
      baseUrl: input.baseUrl,
      extra: {
        note: `${place.label} had fewer than ${MIN_PUBLISH} Western Australian stations selling this fuel in the last two weeks (or the name is not a suburb FuelWatch lists). Try area 'Perth' or 'WA', a neighbouring suburb, or a larger area.`,
      },
    });
  }
  return waAnswerFromRow(row, { fuel: input.fuel, place, query, libraryDate: meta.last_date, baseUrl: input.baseUrl });
}
