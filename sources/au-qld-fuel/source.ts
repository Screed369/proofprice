// Queensland: pump prices reported by every Queensland fuel station under the mandatory Fuel Price Reporting scheme,
// published monthly as a CKAN datastore on data.qld.gov.au (format checked live on 21 Oct 2026).
// Rows are price CHANGES reported by stations; Price is in tenths of a cent per litre (2559 = 255.9 c/L = A$2.559).
// This is a Queensland-only source, not a national Australian one, and it lags about 7 weeks (the newest month is the one before last).
import { InputError, SourceError } from "../../lib/http";
import { summarise } from "../../lib/stats";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { Fuel, stripAccents } from "../../lib/fuels";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { MIN_PUBLISH } from "../../lib/stats";
import { ckanPackage, ckanSql, sqlIdent, sqlLiteral, type CkanResource } from "../../lib/adapters";
import type { FetchOptions } from "../../lib/adapters";

export const SITE = "https://www.data.qld.gov.au";

export const INFO: SourceInfo = {
  id: "au-qld-fuel",
  country: "AU (Queensland)",
  category: "fuel (pump prices)",
  name: "Fuel Price Reporting, Queensland (monthly station prices)",
  publisher: "Queensland Treasury, Queensland Government (Fuel Price Reporting)",
  what_is_recorded:
    "Every price change that Queensland fuel stations report under the mandatory fuel price reporting scheme, by station and fuel type. We take each station's latest reported price in the newest published month.",
  price_type: "posted_pump_price",
  freshness: "Monthly file, published about a month after the month ends (the newest data is usually 5 to 8 weeks old)",
  licence: "Creative Commons Attribution 4.0 (CC BY 4.0), as stated on the dataset page (licence id CC-BY-4.0)",
  licence_url: "https://creativecommons.org/licenses/by/4.0/",
  attribution: "Fuel Price Reporting, Queensland Government (Treasury), licensed CC BY 4.0, data.qld.gov.au",
  homepage: "https://www.data.qld.gov.au/dataset/fuel-price-reporting-2026",
  limits:
    "Queensland only (not the rest of Australia). Posted pump prices in Australian dollars per litre, GST included, as reported by stations: not prices paid. " +
    "The data is a month old or more, so this is NOT today's price. Only stations that reported a price change in the month are counted; a station whose price did not change that month is missing. " +
    "A reported price of 999.9 c/L or more is the scheme's 'not available' marker and is left out. Standard unleaded (Unleaded) is 91 RON in Australia, not 95; the file also holds a separate 95/96 RON product (PULP 95/96 RON) and Premium Diesel, which we do not offer yet.",
};

/** Our fuel names -> the Fuel_Type text in the data. Unleaded (91 RON) answers for petrol95 as in the rest of Australia (the answer says 91 RON). The file does hold "PULP 95/96 RON" (checked in the August 2026 file, 13,637 rows) and "Premium Diesel", but there is no fuel name for them in lib/fuels.ts yet (platform task). */
export const QLD_FUEL_TYPE: Partial<Record<Fuel, string>> = {
  petrol95: "Unleaded",
  petrol98: "PULP 98 RON",
  diesel: "Diesel",
  e10: "e10",
  e85: "e85",
  lpg: "LPG",
};

export const QLD_LABEL: Partial<Record<Fuel, string>> = {
  petrol95: "Unleaded petrol (91 RON)",
  petrol98: "98 RON petrol",
  diesel: "Diesel",
  e10: "E10 unleaded",
  e85: "E85",
  lpg: "LPG",
};

/** A reported Price is tenths of a cent: 1000 to 5000 means 100.0 to 500.0 c/L. 9999 is the "not available" marker. */
export const MIN_TENTHS = 1000;
export const MAX_TENTHS = 5000;

export interface QldSite {
  siteId: number;
  name: string;
  brand: string;
  address: string;
  suburb: string;
  postcode: number | null;
  tenths: number;
  date: string; // YYYY-MM-DD (UTC) of the reported change
}

/** Parse the records of a datastore_search_sql answer into stations; unusable prices (markers, slips) are dropped. */
export function parseSites(records: Record<string, any>[]): QldSite[] {
  const out: QldSite[] = [];
  for (const r of records) {
    const tenths = Number(r.Price);
    if (!Number.isFinite(tenths) || tenths < MIN_TENTHS || tenths > MAX_TENTHS) continue;
    const date = typeof r.TransactionDateutc === "string" ? r.TransactionDateutc.slice(0, 10) : "";
    out.push({
      siteId: Number(r.SiteId),
      name: String(r.Site_Name ?? "").trim(),
      brand: String(r.Site_Brand ?? "").trim(),
      address: String(r.Sites_Address_Line_1 ?? "").trim(),
      suburb: String(r.Site_Suburb ?? "").trim(),
      postcode: Number.isFinite(Number(r.Site_Post_Code)) ? Number(r.Site_Post_Code) : null,
      tenths,
      date,
    });
  }
  return out;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** "Queensland Fuel Prices August 2026" -> 2026*12+7. Other files (column explanation, API sign-up) -> null. */
export function monthIndexOf(resourceName: string): number | null {
  const m = resourceName.match(/Queensland Fuel Prices\s+([A-Za-z]+)\s+(\d{4})/i);
  if (!m) return null;
  const mi = MONTHS.indexOf(m[1].toLowerCase());
  return mi < 0 ? null : Number(m[2]) * 12 + mi;
}

export function monthLabel(index: number): string {
  return `${MONTHS[index % 12][0].toUpperCase()}${MONTHS[index % 12].slice(1)} ${Math.floor(index / 12)}`;
}

/** The newest monthly file that is searchable through the API. */
export function newestMonthly(resources: CkanResource[]): { resource: CkanResource; month: number } | null {
  let best: { resource: CkanResource; month: number } | null = null;
  for (const r of resources) {
    const month = monthIndexOf(r.name);
    if (month === null || !r.datastoreActive) continue;
    if (!best || month > best.month) best = { resource: r, month };
  }
  return best;
}

const cache = new Map<string, { at: number; value: { resource: CkanResource; month: number } }>();

/** Find the newest monthly file: this year's dataset, else last year's (in January the new year's dataset may still be empty). */
export async function findMonthly(now = new Date(), o: FetchOptions = {}): Promise<{ resource: CkanResource; month: number }> {
  const year = now.getUTCFullYear();
  const hit = cache.get("newest");
  if (!o.fetcher && hit && Date.now() - hit.at < 60 * 60 * 1000) return hit.value;
  for (const y of [year, year - 1]) {
    let pkg;
    try {
      pkg = await ckanPackage(SITE, `fuel-price-reporting-${y}`, o);
    } catch (e) {
      if (y === year) continue; // the new year's dataset may not exist yet
      throw e;
    }
    const found = newestMonthly(pkg.resources);
    if (found) {
      if (!o.fetcher) cache.set("newest", { at: Date.now(), value: found });
      return found;
    }
  }
  throw new SourceError("Could not find a Queensland fuel price file on data.qld.gov.au");
}

export type QldScope =
  | { kind: "state"; label: string }
  | { kind: "brisbane"; label: string }
  | { kind: "postcode"; postcode: number; label: string }
  | { kind: "suburb"; name: string; label: string };

function titleCase(s: string): string {
  return s.toLowerCase().replace(/(^|[\s\-'/])([a-z])/g, (_, a, b) => a + b.toUpperCase());
}

/** What a request means: all of Queensland, Greater Brisbane (postcodes 4000 to 4179), one postcode or one suburb. */
export function resolveQldScope(input: { area?: string; town?: string; postcode?: string }): QldScope {
  const norm = (s: string) => stripAccents(s).replace(/\s+/g, " ");
  const pc = input.postcode?.trim();
  if (pc) {
    if (!/^4\d{3}$/.test(pc)) throw new InputError("Give a Queensland postcode of 4 digits starting with 4 (for example 4122), or a suburb as town, or area 'Brisbane' or 'QLD'.");
    return { kind: "postcode", postcode: Number(pc), label: `postcode ${pc}` };
  }
  const area = input.area ? norm(input.area) : "";
  if (area) {
    if (["QLD", "QUEENSLAND", "STATE", "ALL", "STATEWIDE"].includes(area)) return { kind: "state", label: "Queensland" };
    if (["BRISBANE", "GREATER BRISBANE", "BRISBANE METRO", "BRISBANE AREA"].includes(area)) return { kind: "brisbane", label: "Greater Brisbane (postcodes 4000 to 4179)" };
    return { kind: "suburb", name: area, label: `the suburb of ${titleCase(area)}` };
  }
  if (input.town) {
    const t = norm(input.town);
    if (t === "BRISBANE") return { kind: "brisbane", label: "Greater Brisbane (postcodes 4000 to 4179)" };
    return { kind: "suburb", name: t, label: `the suburb of ${titleCase(t)}` };
  }
  throw new InputError("Give a Queensland suburb as town (for example 'Mount Gravatt'), a postcode (for example 4122), or area 'Brisbane' or 'QLD' (the whole state).");
}

/** The SQL that returns each station's latest reported price for one fuel in one scope (read-only SELECT; values are quoted). */
export function buildSql(resourceId: string, fuelType: string, scope: QldScope): string {
  const where = [`${sqlIdent("Fuel_Type")} = ${sqlLiteral(fuelType)}`];
  if (scope.kind === "postcode") where.push(`${sqlIdent("Site_Post_Code")} = ${sqlLiteral(scope.postcode)}`);
  if (scope.kind === "brisbane") where.push(`${sqlIdent("Site_Post_Code")} BETWEEN 4000 AND 4179`);
  if (scope.kind === "suburb") where.push(`upper(${sqlIdent("Site_Suburb")}) = ${sqlLiteral(scope.name)}`);
  const cols = ["SiteId", "Site_Name", "Site_Brand", "Sites_Address_Line_1", "Site_Suburb", "Site_Post_Code", "Price", "TransactionDateutc"].map(sqlIdent).join(",");
  return `SELECT DISTINCT ON (${sqlIdent("SiteId")}) ${cols} FROM ${sqlIdent(resourceId)} WHERE ${where.join(" AND ")} ORDER BY ${sqlIdent("SiteId")},${sqlIdent("TransactionDateutc")} DESC`;
}

export async function qldFuelNow(
  input: { postcode?: string; area?: string; town?: string; fuel: Fuel; baseUrl?: string },
  o: FetchOptions & { now?: Date } = {},
): Promise<PriceAnswer> {
  const fuelType = QLD_FUEL_TYPE[input.fuel];
  if (!fuelType) throw new InputError(`Fuel '${input.fuel}' is not published for Queensland. Use diesel, petrol95 (standard unleaded 91), petrol98, e10, e85 or lpg.`);
  const scope = resolveQldScope(input);
  const { resource, month } = await findMonthly(o.now, o);
  const { records } = await ckanSql(SITE, buildSql(resource.id, fuelType, scope), { ...o, timeoutMs: o.timeoutMs ?? 25000 });
  return qldAnswer(parseSites(records), { fuel: input.fuel, scope, month, query: input, baseUrl: input.baseUrl });
}

export function qldAnswer(
  sites: QldSite[],
  q: { fuel: Fuel; scope: QldScope; month: number; query: { postcode?: string; area?: string; town?: string }; baseUrl?: string },
): PriceAnswer {
  const dollars = sites.map((x) => Math.round(x.tenths) / 1000); // tenths of a cent -> dollars per litre
  const s = summarise(dollars);
  const dates = sites.map((x) => x.date).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  const cheapest = [...sites].sort((a, b) => a.tenths - b.tenths).slice(0, 3).map((x) => ({
    brand: x.brand, name: x.name, address: x.address, suburb: x.suburb, postcode: x.postcode, price: x.tenths / 1000, date: x.date,
  }));
  const label = q.scope.label;
  const month = monthLabel(q.month);
  return buildAnswer({
    source: INFO,
    query: { country: "AU", state: "QLD", postcode: q.query.postcode ?? null, area: q.query.area ?? null, town: q.query.town ?? null, fuel: q.fuel },
    summary: s,
    currency: "AUD",
    unit: "per litre",
    period: { from: dates[0] ?? null, to: dates[dates.length - 1] ?? null },
    method:
      `Median and 10th–90th percentile of each Queensland station's latest reported price per litre for the selected fuel in the newest published month (${month}). ` +
      "Only stations that reported a price change that month are counted. This is a posted price reported by stations, a month or more old, not today's price.",
    describe: (x) =>
      `${QLD_LABEL[q.fuel]} in ${label}: posted pump prices reported by stations in ${month} (latest reported price per station, GST included) have a median of ${fmtMoney(x.median, "AUD")} per litre; ` +
      `typical range (10th–90th percentile) ${fmtMoney(x.low, "AUD")}–${fmtMoney(x.high, "AUD")} across stations. This data is about a month or more old, not today's price.`,
    baseUrl: q.baseUrl,
    extra: {
      cheapest_stations: cheapest,
      stations_counted: sites.length,
      data_month: month,
      coverage: "Queensland only",
      freshness_warning: "Queensland publishes this dataset monthly, so the figure is for " + month + " and does not show today's pump prices.",
    },
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Daily collector (stale-if-error and history). Queensland publishes one file per month, so the library rows are dated by the last
// day of the data month (referenceDates): a Queensland portal outage is then answered from our copy, and /history shows one point
// per month. Area keys: "QLD" (whole state), "BRISBANE" (postcodes 4000 to 4179), a 4-digit postcode, or the upper-case suburb.
// Each station counts once per fuel (its latest reported price in the month); an area with fewer than 5 stations is not stored.
// ---------------------------------------------------------------------------------------------------------------------

export const QLD_STATE = "QLD";
export const QLD_BRISBANE = "BRISBANE";

/** Last day (YYYY-MM-DD) of the month with index year*12+month0. */
export function monthEndDate(index: number): string {
  const y = Math.floor(index / 12);
  const m = index % 12;
  return new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
}

/** Library rows from per-fuel station lists: state, Greater Brisbane, every postcode and every suburb with at least MIN_PUBLISH stations. */
export function qldDailyRows(byFuel: Partial<Record<Fuel, QldSite[]>>): DailyRow[] {
  const rows: DailyRow[] = [];
  for (const [fuel, sites] of Object.entries(byFuel) as [Fuel, QldSite[]][]) {
    const groups = new Map<string, number[]>();
    const add = (area: string, dollars: number) => {
      const g = groups.get(area);
      if (g) g.push(dollars);
      else groups.set(area, [dollars]);
    };
    for (const x of sites) {
      const dollars = Math.round(x.tenths) / 1000;
      add(QLD_STATE, dollars);
      if (x.postcode !== null) {
        add(String(x.postcode), dollars);
        if (x.postcode >= 4000 && x.postcode <= 4179) add(QLD_BRISBANE, dollars);
      }
      const suburb = stripAccents(x.suburb).replace(/\s+/g, " ");
      if (suburb) add(suburb, dollars);
    }
    for (const [area, prices] of groups) {
      if (prices.length < MIN_PUBLISH) continue;
      const s = summarise(prices);
      if (s) rows.push({ area, item: fuel, n: s.count, median: s.median, low: s.low, high: s.high, min: s.min, max: s.max });
    }
  }
  return rows.sort((a, b) => a.area.localeCompare(b.area) || a.item.localeCompare(b.item));
}

export async function qldHarvest(o: FetchOptions & { now?: Date } = {}): Promise<HarvestResult> {
  const { resource, month } = await findMonthly(o.now, o);
  const byFuel: Partial<Record<Fuel, QldSite[]>> = {};
  for (const fuel of Object.keys(QLD_FUEL_TYPE) as Fuel[]) {
    const { records } = await ckanSql(SITE, buildSql(resource.id, QLD_FUEL_TYPE[fuel]!, { kind: "state", label: "Queensland" }), { ...o, timeoutMs: o.timeoutMs ?? 60000 });
    byFuel[fuel] = parseSites(records);
  }
  const rows = qldDailyRows(byFuel);
  const state = rows.filter((r) => r.area === QLD_STATE && r.item === "diesel");
  if (!state.length) throw new SourceError("Queensland fuel file held no usable diesel prices; nothing written.");
  return { date: monthEndDate(month), currency: "AUD", unit: "per litre", rows, note: `Queensland Fuel Price Reporting, ${monthLabel(month)}` };
}

/** Where a request lives in the library; the same place rules as the live answer. */
export function qldHistoryKey(p: { fuel?: string; area?: string; town?: string; postcode?: string }): { area: string; item: string; label: string } | null {
  if (!p.fuel || !QLD_FUEL_TYPE[p.fuel as Fuel]) return null;
  let scope: QldScope;
  try {
    scope = resolveQldScope(p);
  } catch {
    return null;
  }
  const item = p.fuel;
  if (scope.kind === "state") return { area: QLD_STATE, item, label: "Queensland" };
  if (scope.kind === "brisbane") return { area: QLD_BRISBANE, item, label: scope.label };
  if (scope.kind === "postcode") return { area: String(scope.postcode), item, label: scope.label };
  return { area: scope.name.replace(/\s+/g, " "), item, label: scope.label };
}
