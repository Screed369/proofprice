// Austria: pump prices from E-Control's Spritpreisrechner service (api.e-control.at/sprit/1.0), format checked live on 14 Oct 2026.
// IMPORTANT: for a region and a fuel the service returns only the CHEAPEST stations (about 10-15), not every station.
// Every figure we give for Austria therefore describes the cheap end of the market, and the answer says so.
import { fetchJson, InputError, SourceError } from "../../lib/http";
import { summarise } from "../../lib/stats";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { Fuel, FUEL_LABEL, stripAccents } from "../../lib/fuels";
import type { HarvestResult, SourceInfo } from "../../lib/plugin";
import { aggregateDaily } from "../../lib/library/aggregate";

export const INFO: SourceInfo = {
  id: "at-fuel",
  country: "AT",
  category: "fuel (pump prices)",
  name: "Spritpreisrechner (Preistransparenzdatenbank für Treibstoffe) – cheapest stations per region",
  publisher: "E-Control (Energie-Control Austria für die Regulierung der Elektrizitäts- und Erdgaswirtschaft)",
  what_is_recorded:
    "Current pump price reported by Austrian filling stations for diesel, Super 95 and CNG. For a region and fuel the service returns only the cheapest stations.",
  price_type: "posted_pump_price",
  freshness: "Live (stations must report changes to E-Control by law); cheapest stations per region only",
  licence:
    "No reuse licence or terms of use are published for this service: its documentation page (https://api.e-control.at/sprit/1.0/doc/index.html) is a bare Swagger interface with no terms, and it needs no key. " +
    "It is the open interface of E-Control's statutory fuel price database (Preistransparenzgesetz, § 1a). E-Control's only terms page for the database (\"Nutzungsbedingungen für die Preistransparenzdatenbank der E-Control für CNG-Tankstellen\", https://www.e-control.at/nutzungsbedingungen-spritpreisrechner-cng) was unreadable when we checked, so reuse terms have not been confirmed with E-Control.",
  licence_url: "https://api.e-control.at/sprit/1.0/doc/index.html",
  attribution: "Quelle: E-Control – Spritpreisrechner (Preistransparenzdatenbank für Treibstoffe).",
  homepage: "https://www.spritpreisrechner.at/",
  limits:
    "E-Control returns only the cheapest stations for the region asked for (about 10-15), so the median and range describe the cheapest stations, not the whole market: the true market average is higher. " +
    "Posted pump prices, not receipts. Individual prices carry no timestamp, so the date shown is the day of the query.",
};

const BASE = "https://api.e-control.at/sprit/1.0";

/** Our fuel names -> E-Control fuel type codes. */
export const AT_FUEL: Partial<Record<Fuel, string>> = {
  diesel: "DIE",
  petrol95: "SUP",
  methane: "GAS",
};

/** The nine Bundesländer: E-Control region type "BL" and code 1-9. */
export const AT_STATES: Record<string, string> = {
  "1": "Burgenland",
  "2": "Kärnten",
  "3": "Niederösterreich",
  "4": "Oberösterreich",
  "5": "Salzburg",
  "6": "Steiermark",
  "7": "Tirol",
  "8": "Vorarlberg",
  "9": "Wien",
};

const STATE_ALIASES: Record<string, string> = {
  VIENNA: "9",
  CARINTHIA: "2",
  "LOWER AUSTRIA": "3",
  "UPPER AUSTRIA": "4",
  STYRIA: "6",
  TYROL: "7",
};

export interface AtStation {
  id: string;
  brand: string;
  address: string;
  town: string;
  postcode: string;
  price: number;
}

export interface AtRegion {
  code: string;
  type: "BL" | "PB";
  name: string;
  parent: string | null; // code of the Bundesland for a district
  postalCodes: string[];
}

export interface AtResolved {
  code: string;
  type: "BL" | "PB";
  label: string;
  parentCode: string | null; // Bundesland to widen to when a district has too few stations
  parentLabel: string | null;
}

/** E-Control's /regions tree -> a flat list of Bundesländer and districts. */
export function flattenAtRegions(json: any): AtRegion[] {
  if (!Array.isArray(json)) throw new SourceError("Unexpected regions response from E-Control");
  const out: AtRegion[] = [];
  const walk = (r: any, parent: string | null) => {
    const type = r?.type === "BL" ? "BL" : "PB";
    out.push({
      code: String(r.code),
      type,
      name: String(r.name ?? ""),
      parent,
      postalCodes: Array.isArray(r.postalCodes) ? r.postalCodes.map(String) : [],
    });
    for (const s of Array.isArray(r.subRegions) ? r.subRegions : []) walk(s, String(r.code));
  };
  for (const r of json) walk(r, null);
  return out;
}

/** "Graz(Stadt)" and "Stadt Linz" and "Klagenfurt Stadt" all become the town name for matching. */
export function atNameKey(name: string): string {
  return stripAccents(name)
    .replace(/\(.*?\)/g, " ")
    .replace(/\b(STADT|BEZIRK)\b/g, " ")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

function stateByName(q: string): string | null {
  const k = atNameKey(q);
  for (const [code, name] of Object.entries(AT_STATES)) if (atNameKey(name) === k) return code;
  return STATE_ALIASES[k] ?? null;
}

function labelOf(r: AtRegion): string {
  return r.type === "BL" ? (AT_STATES[r.code] ?? r.name) : r.name;
}

/** Work out which E-Control region a request means. Pass the regions list only when a name or postcode needs it. */
export function resolveAtRegion(
  input: { area?: string; town?: string; postcode?: string },
  regions: AtRegion[] | null,
): AtResolved | "need-regions" {
  const state = (code: string): AtResolved => ({ code, type: "BL", label: AT_STATES[code], parentCode: null, parentLabel: null });
  const fromRegion = (r: AtRegion): AtResolved => {
    const parent = r.parent && AT_STATES[r.parent] ? r.parent : null;
    return { code: r.code, type: r.type, label: labelOf(r), parentCode: r.type === "PB" ? parent : null, parentLabel: r.type === "PB" && parent ? AT_STATES[parent] : null };
  };
  const area = input.area?.trim();
  if (area && /^\d+$/.test(area)) {
    if (AT_STATES[area]) return state(area);
    if (/^\d{3}$/.test(area) && AT_STATES[area[0]]) {
      const known = regions?.find((r) => r.code === area);
      if (known) return fromRegion(known);
      return { code: area, type: "PB", label: `district ${area}`, parentCode: area[0], parentLabel: AT_STATES[area[0]] };
    }
    throw new InputError("Austrian area must be a Bundesland code 1-9 (9 = Wien), a 3-digit district code such as 901, or a place name.");
  }
  const name = area || input.town?.trim();
  if (name) {
    const s = stateByName(name);
    if (s) return state(s);
    if (!regions) return "need-regions";
    const key = atNameKey(name);
    const hit = regions.find((r) => r.type === "PB" && atNameKey(r.name) === key) ?? regions.find((r) => r.type === "PB" && atNameKey(r.name).startsWith(key + " "));
    if (!hit) throw new InputError(`Unknown Austrian place '${name}'. Use a Bundesland (Wien, Tirol...), a district or city name (Graz, Linz, Salzburg...), or a 4-digit postcode.`);
    return fromRegion(hit);
  }
  const cp = input.postcode?.replace(/\D/g, "");
  if (cp) {
    if (cp.length !== 4) throw new InputError("Austrian postcodes have 4 digits, e.g. '1010' or '8010'.");
    if (!regions) return "need-regions";
    const inside = regions.filter((r) => r.type === "PB" && r.postalCodes.includes(cp)).sort((a, b) => a.postalCodes.length - b.postalCodes.length);
    const hit = inside[0] ?? regions.find((r) => r.type === "BL" && r.postalCodes.includes(cp));
    if (!hit) throw new InputError(`Postcode ${cp} was not found among Austria's regions.`);
    return fromRegion(hit);
  }
  throw new InputError("Give an Austrian Bundesland, district or city as area (or town), or a 4-digit postcode. Example: area 'Wien' or '9'.");
}

/** Parse a by-region response into stations that have a price for the fuel. */
export function parseAtStations(json: any, fuelCode: string): AtStation[] {
  if (!Array.isArray(json)) throw new SourceError("Unexpected response from the E-Control fuel price service");
  const out: AtStation[] = [];
  for (const s of json) {
    const p = Array.isArray(s?.prices) ? s.prices.find((x: any) => x?.fuelType === fuelCode) : null;
    const price = Number(p?.amount);
    // E-Control occasionally lists a placeholder such as 4.000 EUR for a closed station: keep only plausible pump prices.
    if (!Number.isFinite(price) || price < 0.5 || price > 3.5) continue;
    out.push({
      id: String(s.id ?? ""),
      brand: String(s.name ?? "").replace(/\s+/g, " ").trim(),
      address: String(s.location?.address ?? "").trim(),
      town: String(s.location?.city ?? "").trim(),
      postcode: String(s.location?.postalCode ?? ""),
      price,
    });
  }
  return dropAtOutliers(out);
}

/** A posted price more than 20% away from the median of its own list is a probable entry error (Kärnten stations listed
 *  diesel at 1.129 and 1.529 EUR beside 2.09 EUR for the rest): leave it out so it cannot distort the range. Needs 5+ stations. */
export function dropAtOutliers(stations: AtStation[]): AtStation[] {
  if (stations.length < 5) return stations;
  const sorted = stations.map((x) => x.price).sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return stations.filter((x) => x.price >= median * 0.8 && x.price <= median * 1.2);
}

function regionUrl(code: string, type: string, fuelCode: string): string {
  return `${BASE}/search/gas-stations/by-region?${new URLSearchParams({ code, type, fuelType: fuelCode, includeClosed: "true" })}`;
}

let regionsCache: { at: number; regions: AtRegion[] } | null = null;
async function loadRegions(): Promise<AtRegion[]> {
  if (regionsCache && Date.now() - regionsCache.at < 12 * 3600 * 1000) return regionsCache.regions;
  const regions = flattenAtRegions(await fetchJson(`${BASE}/regions`, { headers: { accept: "application/json" } }, 20000));
  regionsCache = { at: Date.now(), regions };
  return regions;
}

export function viennaToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Vienna", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export async function atFuelNow(input: { postcode?: string; area?: string; town?: string; fuel: Fuel; baseUrl?: string }): Promise<PriceAnswer> {
  const fuelCode = AT_FUEL[input.fuel];
  if (!fuelCode) throw new InputError(`Fuel '${input.fuel}' is not published for Austria. Use diesel, petrol95 (Super 95) or methane (CNG).`);
  let resolved = resolveAtRegion(input, null);
  if (resolved === "need-regions") resolved = resolveAtRegion(input, await loadRegions()) as AtResolved;
  const target = resolved as AtResolved;

  let stations = parseAtStations(await fetchJson(regionUrl(target.code, target.type, fuelCode), { headers: { accept: "application/json" } }, 20000), fuelCode);
  let where = target.label;
  let note: string | undefined;
  if (stations.length < 5 && target.type === "PB" && target.parentCode) {
    note = `Fewer than 5 stations are listed for ${target.label}; widened to the whole Bundesland ${target.parentLabel}.`;
    stations = parseAtStations(await fetchJson(regionUrl(target.parentCode, "BL", fuelCode), { headers: { accept: "application/json" } }, 20000), fuelCode);
    where = `${target.parentLabel} (around ${target.label})`;
  }
  return atAnswer(stations, { fuel: input.fuel, where, query: input, note, baseUrl: input.baseUrl });
}

export function atAnswer(
  stations: AtStation[],
  q: { fuel: Fuel; where: string; query: { postcode?: string; area?: string; town?: string }; note?: string; today?: string; baseUrl?: string },
): PriceAnswer {
  const s = summarise(stations.map((x) => x.price));
  const day = q.today ?? viennaToday();
  const unit = q.fuel === "methane" ? "per kg" : "per litre";
  const cheapest = [...stations].sort((a, b) => a.price - b.price).slice(0, 3);
  return buildAnswer({
    source: INFO,
    query: { country: "AT", postcode: q.query.postcode ?? null, area: q.query.area ?? null, town: q.query.town ?? null, fuel: q.fuel },
    summary: s,
    currency: "EUR",
    unit,
    period: { from: day, to: day },
    method:
      "E-Control's Spritpreisrechner returns only the cheapest stations (here " + stations.length + ") for the region and fuel. " +
      "The median and the 10th–90th percentile are computed over those stations only, so they describe the cheap end of the market and sit below the average price across all stations in the region. " +
      "Posted prices of the stations E-Control lists, whether open or closed at the moment of the query; a price more than 20% from the median of the list is treated as an entry error and left out.",
    describe: (x) =>
      `${FUEL_LABEL[q.fuel]} in ${q.where}: the ${stations.length} cheapest stations listed by E-Control charge a median of ${fmtMoney(x.median, "EUR")} ${unit}, ` +
      `range ${fmtMoney(x.min, "EUR")}–${fmtMoney(x.max, "EUR")}. This is the cheap end of the market, not every station, so the typical price across all stations is higher.`,
    baseUrl: q.baseUrl,
    extra: {
      coverage: "cheapest_stations_only",
      coverage_note: "E-Control lists only the cheapest stations for a region; the range is not the whole market.",
      cheapest_stations: cheapest,
      stations_counted: stations.length,
      ...(q.note ? { note: q.note } : {}),
    },
  });
}

// ---------- daily collection (price library): the cheapest stations of each Bundesland ----------

export function atDailyRows(perState: { state: string; fuel: Fuel; prices: number[] }[], date: string): HarvestResult {
  const records = perState.flatMap((r) => r.prices.map((price) => ({ area: r.state, item: r.fuel, price })));
  return {
    date,
    currency: "EUR",
    unit: "per litre (CNG per kg)",
    rows: aggregateDaily(records, false),
    note: "Cheapest stations only: E-Control lists the cheapest stations per Bundesland, so these medians are for the cheap end of the market.",
  };
}

export async function atHarvest(): Promise<HarvestResult> {
  const perState: { state: string; fuel: Fuel; prices: number[] }[] = [];
  let failures = 0;
  for (const state of Object.keys(AT_STATES)) {
    for (const [fuel, code] of Object.entries(AT_FUEL) as [Fuel, string][]) {
      try {
        const stations = parseAtStations(await fetchJson(regionUrl(state, "BL", code), { headers: { accept: "application/json" } }, 30000), code);
        perState.push({ state, fuel, prices: stations.map((x) => x.price) });
      } catch {
        failures++;
      }
      await new Promise((r) => setTimeout(r, 300)); // be gentle with a public service
    }
  }
  if (!perState.length) throw new SourceError("E-Control fuel price service unreachable (all requests failed)");
  const day = viennaToday();
  return atDailyRows(perState, day);
}

/** Library keys: only the nine Bundesländer are collected. */
export function atHistoryKey(p: { area?: string; town?: string; fuel: string }): { area: string; item: string; label: string } | null {
  if (!AT_FUEL[p.fuel as Fuel]) return null;
  const name = p.area?.trim() || p.town?.trim();
  if (!name) return null;
  const code = AT_STATES[name] ? name : stateByName(name);
  if (!code) return null;
  return { area: code, item: p.fuel, label: `the cheapest stations in ${AT_STATES[code]} (E-Control lists only the cheapest)` };
}
