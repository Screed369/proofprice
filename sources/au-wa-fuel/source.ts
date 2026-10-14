// Western Australia: pump prices from the FuelWatch RSS feed (format checked live on 14-15 Oct 2026).
// FuelWatch covers every fuel retailer in Western Australia only; it is not a national Australian source.
import { InputError, SourceError } from "../../lib/http";
import { summarise } from "../../lib/stats";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { Fuel, stripAccents } from "../../lib/fuels";
import type { HarvestResult, SourceInfo } from "../../lib/plugin";
import { aggregateDaily } from "../../lib/library/aggregate";

export const INFO: SourceInfo = {
  id: "au-wa-fuel",
  country: "AU (Western Australia)",
  category: "fuel (pump prices)",
  name: "FuelWatch – daily fuel prices (RSS feed)",
  publisher: "FuelWatch, Department of Energy, Mines, Industry Regulation and Safety (Consumer Protection), Government of Western Australia",
  what_is_recorded:
    "The standard cash pump price notified to FuelWatch by every fuel retailer in Western Australia for the current day, by fuel product.",
  price_type: "posted_pump_price",
  freshness: "Daily (prices are locked in for 24 hours from 6am; tomorrow's prices appear at 2:30pm)",
  licence:
    "NOT CLEARED FOR REUSE (source offline since 2026-10-14). The live FuelWatch RSS feed carries only 'Copyright 2025 FuelWatch. All Rights Reserved.' and no licence. The CC BY 4.0 record on data.wa.gov.au ('FuelWatch Historic Fuel Prices', https://catalogue.data.wa.gov.au/dataset/fuelwatch-historic-fuel-prices) lists only the historic monthly files, not the RSS feed. The WA Government terms of use (https://www.wa.gov.au/terms-of-use) say: 'no part may be reproduced or re-used for any commercial purposes whatsoever without prior written permission of the State of Western Australia.'",
  licence_url: "https://www.wa.gov.au/terms-of-use",
  attribution: "Source: FuelWatch, Government of Western Australia (Department of Energy, Mines, Industry Regulation and Safety), CC BY 4.0.",
  homepage: "https://www.fuelwatch.wa.gov.au/",
  limits:
    "Western Australia only (not the rest of Australia). Prices are posted standard cash prices in Australian dollars per litre, GST included: they exclude supermarket and shopper-docket discounts and card fees. " +
    "Membership-only stations are left out. Perth and Mandurah unleaded follows a seven-day price cycle, so one day can sit well above or below the weekly average. " +
    "In Australia standard unleaded (ULP) is 91 RON, not 95.",
};

const RSS = "https://www.fuelwatch.wa.gov.au/fuelwatch/fuelWatchRSS";

/** Our fuel names -> FuelWatch product ids. Standard unleaded (ULP, 91 RON) answers for petrol95; PULP (95/96 RON) is not offered. */
export const AU_PRODUCT: Partial<Record<Fuel, number>> = {
  petrol95: 1,
  diesel: 4,
  lpg: 5,
  petrol98: 6,
  e85: 10,
};

export const AU_LABEL: Partial<Record<Fuel, string>> = {
  petrol95: "Unleaded petrol (ULP, 91 RON)",
  diesel: "Diesel",
  lpg: "LPG",
  petrol98: "98 RON petrol",
  e85: "E85",
};

/** FuelWatch regions that make up Perth: North of River, South of River, East/Hills. */
export const PERTH_REGIONS = [25, 26, 27];

export interface AuStation {
  brand: string;
  name: string;
  suburb: string;
  address: string;
  price: number; // AUD per litre
  date: string; // YYYY-MM-DD the price applies to
  restrictions: string;
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

function tag(block: string, name: string): string {
  const m = block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? decodeXml(m[1]).trim() : "";
}

/** Parse a FuelWatch RSS document. Prices arrive in cents per litre and leave in dollars. Membership-only stations are dropped. */
export function parseFuelWatchRss(xml: string): AuStation[] {
  if (!/<rss[\s>]/.test(xml) || !xml.includes("<channel>")) throw new SourceError("Unexpected response from FuelWatch");
  const out: AuStation[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const b = m[1];
    const cents = Number(tag(b, "price"));
    // FuelWatch prices are 75-600 cents a litre (LPG from 40); anything else is a data slip.
    if (!Number.isFinite(cents) || cents < 40 || cents > 600) continue;
    const restrictions = tag(b, "restrictions");
    if (/membership/i.test(restrictions)) continue; // restricted-sale stations (e.g. Costco) are not open to every driver
    out.push({
      brand: tag(b, "brand"),
      name: tag(b, "trading-name"),
      suburb: tag(b, "location"),
      address: tag(b, "address"),
      price: Math.round(cents * 10) / 1000, // cents -> dollars, keeping one decimal of a cent
      date: tag(b, "date"),
      restrictions,
    });
  }
  return out;
}

async function fetchText(url: string, timeoutMs = 25000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "user-agent": "ProofPrice/1.0 (+https://proofprice.com; hello@proofprice.com)", accept: "application/rss+xml, text/xml" } });
    if (!res.ok) throw new SourceError(`FuelWatch returned HTTP ${res.status}`);
    return await res.text();
  } catch (e: any) {
    if (e?.name === "AbortError") throw new SourceError("FuelWatch timed out");
    if (e instanceof SourceError) throw e;
    throw new SourceError("Could not reach FuelWatch", String(e?.cause?.code ?? e?.message ?? e));
  } finally {
    clearTimeout(timer);
  }
}

const cache = new Map<string, { at: number; stations: AuStation[] }>();

async function loadFeed(params: Record<string, string | number>): Promise<AuStation[]> {
  const url = `${RSS}?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))}`;
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.stations;
  const stations = parseFuelWatchRss(await fetchText(url));
  if (cache.size > 50) cache.clear();
  cache.set(url, { at: Date.now(), stations });
  return stations;
}

export type AuScope = { kind: "perth" } | { kind: "state" } | { kind: "region"; id: number; label: string } | { kind: "suburb"; name: string };

const REGION_NAMES: Record<string, { id: number; label: string }> = {
  "NORTH OF RIVER": { id: 25, label: "Perth north of the river" },
  "SOUTH OF RIVER": { id: 26, label: "Perth south of the river" },
  "EAST HILLS": { id: 27, label: "Perth East/Hills" },
  "EAST/HILLS": { id: 27, label: "Perth East/Hills" },
};

/** What a request means: all of Perth, all of Western Australia, a FuelWatch metro region, or one suburb. */
export function resolveAuScope(input: { area?: string; town?: string; postcode?: string }): AuScope {
  const norm = (s: string) => stripAccents(s).replace(/\s+/g, " ");
  const area = input.area ? norm(input.area) : "";
  if (area) {
    if (["PERTH", "PERTH METRO", "METRO", "METROPOLITAN PERTH", "GREATER PERTH", "PERTH METROPOLITAN AREA"].includes(area)) return { kind: "perth" };
    if (["WA", "WESTERN AUSTRALIA", "STATE", "ALL", "STATEWIDE"].includes(area)) return { kind: "state" };
    if (REGION_NAMES[area]) return { kind: "region", ...REGION_NAMES[area] };
    return { kind: "suburb", name: area };
  }
  if (input.town) {
    const t = norm(input.town);
    if (t === "PERTH") return { kind: "perth" }; // "Perth" means the city and its suburbs, not the one CBD suburb
    return { kind: "suburb", name: t };
  }
  if (input.postcode) {
    throw new InputError("FuelWatch is organised by suburb, not postcode. Give a suburb as town (e.g. 'Fremantle') or area 'Perth' for the whole metropolitan area.");
  }
  throw new InputError("Give a Western Australian suburb as town (e.g. 'Fremantle'), or area 'Perth' (metropolitan area) or 'WA' (the whole state).");
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/(^|[\s\-'/])([a-z])/g, (_, a, b) => a + b.toUpperCase());
}

export function scopeLabel(scope: AuScope): string {
  if (scope.kind === "perth") return "Perth (metropolitan area)";
  if (scope.kind === "state") return "Western Australia";
  if (scope.kind === "region") return scope.label;
  return `${titleCase(scope.name)} and neighbouring suburbs`; // FuelWatch's suburb search includes the neighbours

}

async function loadScope(scope: AuScope, product: number): Promise<AuStation[]> {
  if (scope.kind === "perth") {
    const parts = await Promise.all(PERTH_REGIONS.map((r) => loadFeed({ Product: product, Region: r })));
    return parts.flat();
  }
  if (scope.kind === "state") return loadFeed({ Product: product });
  if (scope.kind === "region") return loadFeed({ Product: product, Region: scope.id });
  return loadFeed({ Product: product, Suburb: titleCase(scope.name) });
}

/** Today's date in Perth (AWST, UTC+8, no daylight saving). */
export function perthToday(now = new Date()): string {
  return new Date(now.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

export async function auFuelNow(input: { postcode?: string; area?: string; town?: string; fuel: Fuel; baseUrl?: string }): Promise<PriceAnswer> {
  const product = AU_PRODUCT[input.fuel];
  if (!product) throw new InputError(`Fuel '${input.fuel}' is not published for Western Australia. Use diesel, petrol95 (standard unleaded), petrol98, lpg or e85.`);
  const scope = resolveAuScope(input);
  const stations = await loadScope(scope, product);
  return auAnswer(stations, { fuel: input.fuel, scope, query: input, baseUrl: input.baseUrl });
}

export function auAnswer(
  stations: AuStation[],
  q: { fuel: Fuel; scope: AuScope; query: { postcode?: string; area?: string; town?: string }; today?: string; baseUrl?: string },
): PriceAnswer {
  const label = scopeLabel(q.scope);
  const s = summarise(stations.map((x) => x.price));
  const dates = stations.map((x) => x.date).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  const today = q.today ?? perthToday();
  const newest = dates[dates.length - 1] ?? null;
  const cheapest = [...stations].sort((a, b) => a.price - b.price).slice(0, 3).map((x) => ({
    brand: x.brand, name: x.name, address: x.address, suburb: x.suburb, price: x.price, date: x.date,
  }));
  const stale = newest && Date.parse(today) - Date.parse(newest) > 2 * 86400000;
  const cycle = q.fuel === "petrol95" && (q.scope.kind === "perth" || q.scope.kind === "region");
  return buildAnswer({
    source: INFO,
    query: { country: "AU", state: "WA", postcode: q.query.postcode ?? null, area: q.query.area ?? null, town: q.query.town ?? null, fuel: q.fuel },
    summary: s,
    currency: "AUD",
    unit: "per litre",
    period: { from: dates[0] ?? null, to: newest },
    method:
      "Median and 10th–90th percentile of the standard cash price per litre notified to FuelWatch by each fuel retailer in the area for the selected fuel, for the day shown. " +
      "Membership-only stations are left out. Standard unleaded (ULP) is 91 RON in Australia.",
    describe: (x) =>
      `${AU_LABEL[q.fuel]} in ${label}${q.scope.kind === "state" ? "" : ", Western Australia"}: posted pump prices (standard cash price notified to FuelWatch, GST included) have a median of ${fmtMoney(x.median, "AUD")} per litre; typical range (10th–90th percentile) ${fmtMoney(x.low, "AUD")}–${fmtMoney(x.high, "AUD")} across stations.` +
      (stale ? ` WARNING: the newest price date is ${newest}, which is old.` : ""),
    baseUrl: q.baseUrl,
    extra: {
      cheapest_stations: cheapest,
      stations_counted: stations.length,
      coverage: "Western Australia only",
      ...(cycle ? { price_cycle_note: "Perth and Mandurah unleaded prices follow a seven-day cycle (a sharp rise on one day, then a fall over six days), so today's figure can be above or below the weekly average." } : {}),
      ...(stale ? { stale_warning: `Newest price date ${newest} is more than 2 days before today (${today}).` } : {}),
    },
  });
}

// ---------- daily collection (price library) ----------

/** Library area key for a suburb. */
export function auSuburbKey(name: string): string {
  return stripAccents(name).replace(/\s+/g, " ");
}

export function auDailyRows(state: Record<string, AuStation[]>, perth: Record<string, AuStation[]>): HarvestResult {
  const records: { area: string; item: string; price: number }[] = [];
  let newest = "";
  for (const [fuel, list] of Object.entries(state)) {
    for (const s of list) {
      records.push({ area: "ALL", item: fuel, price: s.price });
      if (s.suburb) records.push({ area: auSuburbKey(s.suburb), item: fuel, price: s.price });
      if (s.date > newest) newest = s.date;
    }
  }
  for (const [fuel, list] of Object.entries(perth)) for (const s of list) records.push({ area: "PERTH", item: fuel, price: s.price });
  return {
    date: newest || perthToday(),
    currency: "AUD",
    unit: "per litre",
    rows: aggregateDaily(records, false),
    note: "Western Australia (FuelWatch). Areas: ALL = the state, PERTH = the three metropolitan regions, plus suburbs with 5+ stations.",
  };
}

export async function auHarvest(): Promise<HarvestResult> {
  const state: Record<string, AuStation[]> = {};
  const perth: Record<string, AuStation[]> = {};
  for (const [fuel, product] of Object.entries(AU_PRODUCT) as [Fuel, number][]) {
    state[fuel] = await loadFeed({ Product: product });
    perth[fuel] = (await Promise.all(PERTH_REGIONS.map((r) => loadFeed({ Product: product, Region: r })))).flat();
  }
  return auDailyRows(state, perth);
}

export function auHistoryKey(p: { area?: string; town?: string; postcode?: string; fuel: string }): { area: string; item: string; label: string } | null {
  if (!AU_PRODUCT[p.fuel as Fuel]) return null;
  if (!p.area && !p.town && !p.postcode) return { area: "ALL", item: p.fuel, label: "Western Australia" };
  if (p.postcode && !p.area && !p.town) return null;
  const scope = resolveAuScope(p);
  if (scope.kind === "perth") return { area: "PERTH", item: p.fuel, label: "Perth (metropolitan area)" };
  if (scope.kind === "state") return { area: "ALL", item: p.fuel, label: "Western Australia" };
  if (scope.kind === "suburb") return { area: auSuburbKey(scope.name), item: p.fuel, label: `the suburb of ${titleCase(scope.name)}, Western Australia (stations located in that suburb)` };
  return null;
}
