// New Zealand rents: MBIE Tenancy Services "Rental bond data". Private-sector bonds lodged each month, listed by tenancy start date:
// number of bonds lodged, median, geometric mean and lower/upper quartile of the weekly rent, by territorial authority or region, February 1993 onwards.
// Two monthly CSV files (the file name changes with the month, e.g. "...-october.csv", so the links are read from the publisher's page):
//   detailed-monthly-tla-tenancy-<month>.csv     "Time Frame","Location Id","Location","Lodged Bonds","Active Bonds","Closed Bonds","Median Rent",
//   detailed-monthly-region-tenancy-<month>.csv  "Geometric Mean Rent","Upper Quartile Rent","Lower Quartile Rent","Log Std Dev Weekly Rent"
// Formats checked live on 2026-10-14 from GitHub's servers and a Vercel deployment (fixtures/ hold rows copied from them). Numbers can carry a
// thousands comma inside quotes ("14,700"); the Location Id of the whole country is " -99" (with a leading space).
// The quarterly "detailed" file (dwelling type x bedrooms) is keyed by Statistics NZ SA2 codes without names, so bedrooms and dwelling type
// cannot be answered by place name; this source says so in every answer where they are asked for.

import { InputError, SourceError } from "../../lib/http";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import type { PriceSummary } from "../../lib/stats";
import type { SourceInfo } from "../../lib/plugin";

export const PAGE_URL = "https://www.tenancy.govt.nz/about-tenancy-services/data-and-statistics/rental-bond-data/";
export const LICENCE_URL = "https://creativecommons.org/licenses/by/3.0/nz/";

export const INFO: SourceInfo = {
  id: "nz-mbie-rents",
  country: "NZ (New Zealand)",
  category: "rent (rental bond data)",
  name: "Rental bond data (monthly, by territorial authority and region)",
  publisher: "Ministry of Business, Innovation and Employment (MBIE), Tenancy Services, New Zealand",
  what_is_recorded:
    "Private-sector rental bonds lodged in a month, by tenancy start date: the number of bonds lodged and the median, geometric mean, lower quartile and upper quartile of the weekly rent, by territorial authority and region, from February 1993. Bond counts are randomly rounded to base 3 and results with fewer than 5 bonds are suppressed.",
  price_type: "transaction",
  freshness: "Monthly; the files run about two months behind (the October 2026 files end in August 2026) and the latest month can still change",
  licence:
    'MBIE Tenancy Services, Rental bond data, "Using data under Creative Commons": "We\'re making this raw data available under a Creative Commons licence. This means you can use the data free of charge to perform your own analysis, as long as you credit us (\'The Ministry of Business, Innovation and Employment\') as the source of the data. This work is licensed under a Creative Commons Attribution 3.0 New Zealand License."',
  licence_url: LICENCE_URL,
  attribution:
    "Source: The Ministry of Business, Innovation and Employment (MBIE), Tenancy Services, Rental bond data. Licensed under a Creative Commons Attribution 3.0 New Zealand License. Figures are passed on as published; changes on the year are own calculations by ProofPrice.",
  homepage: PAGE_URL,
  limits:
    "Rents of NEW private-sector tenancies whose bond was lodged in the month (not sitting tenants, not social housing). By territorial authority or region, all dwelling types and sizes together: the published place files do not split by bedrooms or dwelling type, so those filters are not applied (the answer says so). " +
    "The range is the published lower to upper quartile (25th–75th percentile), not the 10th–90th. Bond counts are randomly rounded to base 3. " +
    "MBIE warns that the data is provisional while the bond system migrates, may be incomplete or revised, and recent months may not be comparable with earlier ones.",
};

// ---------- reading the page and the files (pure) ----------

export interface FileLinks {
  tla: string | null;
  region: string | null;
}

/** The monthly territorial authority and region CSV links on the Tenancy Services page. */
export function parseLinks(html: string): FileLinks {
  const find = (kind: string) => {
    const m = new RegExp(`href="([^"]*detailed-monthly-${kind}-tenancy[^"]*\\.csv[^"]*)"`, "i").exec(html);
    return m ? m[1].replace(/&amp;/g, "&") : null;
  };
  return { tla: find("tla"), region: find("region") };
}

export interface RentRow {
  month: string; // YYYY-MM
  id: string; // Location Id, trimmed ("-99" = whole country)
  name: string;
  lodged: number | null;
  median: number | null;
  geoMean: number | null;
  upper: number | null;
  lower: number | null;
}

function splitLine(line: string): string[] {
  const out: string[] = [];
  let f = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        f += '"';
        i++;
      } else if (c === '"') q = false;
      else f += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      out.push(f);
      f = "";
    } else f += c;
  }
  out.push(f);
  return out;
}

const n = (s: string | undefined): number | null => {
  const v = Number((s ?? "").replace(/,/g, "").trim());
  return s !== undefined && s.trim() !== "" && Number.isFinite(v) ? v : null;
};

const HEADER = ["time frame", "location id", "location", "lodged bonds", "active bonds", "closed bonds", "median rent", "geometric mean rent", "upper quartile rent", "lower quartile rent"];

export function parseRents(text: string): RentRow[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  const head = lines.length ? splitLine(lines[0]).map((h) => h.trim().toLowerCase()) : [];
  if (HEADER.some((h, i) => head[i] !== h)) {
    throw new SourceError("Tenancy Services changed the layout of the rental bond file (expected Time Frame, Location Id, Location, Lodged Bonds ... Lower Quartile Rent); this source needs updating.");
  }
  const out: RentRow[] = [];
  for (const l of lines.slice(1)) {
    const c = splitLine(l);
    const month = /^(\d{4}-\d{2})-\d{2}$/.exec(c[0]?.trim() ?? "")?.[1];
    if (!month) continue;
    out.push({ month, id: c[1].trim(), name: c[2].trim(), lodged: n(c[3]), median: n(c[6]), geoMean: n(c[7]), upper: n(c[8]), lower: n(c[9]) });
  }
  return out;
}

// ---------- place matching (pure) ----------

const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[.,']/g, "").replace(/\s+/g, " ").trim();
const stripSuffix = (s: string) => s.replace(/ (city|district|region)$/, "");

export interface Place {
  id: string;
  name: string;
  kind: "country" | "territorial authority" | "region";
}

const COUNTRY_WORDS = new Set(["new zealand", "nz", "aotearoa", "all", "national", "nationwide"]);

/** Names of the places in a file (excluding "NA" = unknown location). */
export function placesIn(rows: RentRow[], kind: Place["kind"]): Place[] {
  const seen = new Map<string, Place>();
  for (const r of rows) if (r.id !== "-1" && r.name !== "NA" && r.id !== "-99" && !seen.has(r.id)) seen.set(r.id, { id: r.id, name: r.name, kind });
  return [...seen.values()];
}

/** Exact name, name without City/District/Region, then a single unique part-match (4+ letters). null when nothing fits. */
export function matchPlace(query: string, places: Place[]): Place | null {
  const q = norm(query);
  const exact = places.find((p) => norm(p.name) === q);
  if (exact) return exact;
  const loose = places.filter((p) => stripSuffix(norm(p.name)) === stripSuffix(q));
  if (loose.length) return loose[0];
  if (q.length >= 4) {
    const part = places.filter((p) => norm(p.name).includes(q));
    if (part.length === 1) return part[0];
  }
  return null;
}

// ---------- the answer ----------

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export function monthLabel(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  return `${MONTHS[mo - 1]} ${y}`;
}
function monthEnd(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
}
function yearBefore(m: string): string {
  const [y, mo] = m.split("-");
  return `${Number(y) - 1}-${mo}`;
}

export interface NzRentInput {
  town?: string;
  postcode?: string;
  property_type?: string;
  house_type?: string;
  bedrooms?: number;
  baseUrl?: string;
}

const METHOD =
  "New Zealand rents: the median weekly rent, with the published lower and upper quartile, of new private-sector tenancies whose rental bond was lodged in the latest month MBIE Tenancy Services has published, for a territorial authority or region (or the whole country). " +
  "The count is the number of bonds lodged (randomly rounded to base 3). The range is the quartiles, not the 10th–90th percentile.";

export function answerFromRows(rows: RentRow[], place: Place, input: NzRentInput, otherRegion?: Place): PriceAnswer {
  const mine = rows.filter((r) => (place.kind === "country" ? r.id === "-99" : r.id === place.id));
  const usable = mine.filter((r) => r.median !== null && r.median > 0 && r.lower !== null && r.upper !== null).sort((a, b) => a.month.localeCompare(b.month));
  const latest = usable[usable.length - 1];
  const query: Record<string, unknown> = { country: "NZ", place: place.kind === "country" ? "New Zealand" : place.name };
  const ignored: string[] = [];
  if (input.bedrooms !== undefined) ignored.push(`bedrooms=${input.bedrooms}`);
  if (input.property_type && input.property_type !== "any") ignored.push(`property_type=${input.property_type}`);
  if (input.house_type) ignored.push(`house_type=${input.house_type}`);
  if (!latest) {
    return buildAnswer({
      source: INFO, query, summary: null, currency: "NZD", unit: "per week", period: { from: null, to: null }, method: METHOD,
      describe: () => "", baseUrl: input.baseUrl,
    });
  }
  const summary: PriceSummary = { count: latest.lodged ?? 0, median: latest.median!, low: latest.lower!, high: latest.upper!, min: latest.lower!, max: latest.upper! };
  const before = usable.find((r) => r.month === yearBefore(latest.month));
  const yoy = before && before.median ? Math.round(((latest.median! - before.median) / before.median) * 1000) / 10 : null;
  const where = place.kind === "country" ? "New Zealand" : place.name;
  const a = buildAnswer({
    source: INFO,
    query,
    summary,
    currency: "NZD",
    unit: "per week",
    period: { from: `${latest.month}-01`, to: monthEnd(latest.month) },
    method: METHOD,
    describe: (s) =>
      `The median weekly rent on new private tenancies in ${where} was ${fmtMoney(s.median, "NZD")} in ${monthLabel(latest.month)}, ` +
      `with the middle half of rents between ${fmtMoney(s.low, "NZD")} (lower quartile) and ${fmtMoney(s.high, "NZD")} (upper quartile)` +
      (yoy !== null ? `; the median is ${yoy > 0 ? "up" : yoy < 0 ? "down" : "unchanged"}${yoy === 0 ? "" : ` ${Math.abs(yoy)}%`} on ${monthLabel(before!.month)} (${fmtMoney(before!.median!, "NZD")})` : "") +
      ".",
    baseUrl: input.baseUrl,
    extra: {
      month: latest.month,
      place_kind: place.kind,
      range_basis: "lower and upper quartile (25th–75th percentile), as published; typical_low and typical_high are null because they mean 10th–90th",
      p25: latest.lower,
      p75: latest.upper,
      geometric_mean_rent: latest.geoMean,
      median_a_year_earlier: before ? { month: before.month, median: before.median, change_percent: yoy } : null,
      bond_counts_rounded_to: 3,
      ...(otherRegion ? { also_matches: `${otherRegion.name} (region); ask for it by name for the region figure` } : {}),
      ...(ignored.length ? { filters_not_applied: ignored } : {}),
    },
  });
  if (a.price) {
    a.price.min = null;
    a.price.max = null;
    // Quartiles are not 10th-90th percentiles: typical_low/high stay null, the quartiles live in extra.p25 / extra.p75.
    a.price.typical_low = null;
    a.price.typical_high = null;
  }
  if (ignored.length) {
    a.summary += ` Note: MBIE does not publish rents by bedrooms or dwelling type for a named place, so ${ignored.join(", ")} was not applied; the figure covers all new private tenancies.`;
  }
  a.summary += " Quartile range, not 10th–90th. MBIE flags this data as provisional while its bond system migrates.";
  return a;
}

// ---------- fetching ----------

async function fetchText(url: string, timeoutMs = 25000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "user-agent": "pricepaid-plug/0.1 (+https://proofprice.com)" } });
    if (!res.ok) throw new SourceError(`Source returned HTTP ${res.status}`, url, res.status);
    return await res.text();
  } catch (err: any) {
    if (err instanceof SourceError) throw err;
    if (err?.name === "AbortError") throw new SourceError("Source timed out", url);
    throw new SourceError("Could not reach the official source", String(err?.cause?.code ?? err?.message ?? err));
  } finally {
    clearTimeout(timer);
  }
}

export async function nzRents(input: NzRentInput, fetcher: (url: string) => Promise<string> = fetchText): Promise<PriceAnswer> {
  if (!input.town) {
    if (input.postcode) throw new InputError("Give a town, city, district or region: New Zealand rents are published by territorial authority and region, not by postcode.");
    throw new InputError("Give a town, city, district or region (for example Wellington, Auckland, Christchurch) or 'New Zealand'.");
  }
  const links = parseLinks(await fetcher(PAGE_URL));
  if (!links.tla || !links.region) {
    throw new SourceError("The Tenancy Services page no longer lists the monthly rental bond files; this source needs updating.");
  }
  if (COUNTRY_WORDS.has(norm(input.town))) {
    return answerFromRows(parseRents(await fetcher(links.tla)), { id: "-99", name: "New Zealand", kind: "country" }, input);
  }
  const tlaRows = parseRents(await fetcher(links.tla));
  const wantsRegion = /\bregion$/.test(norm(input.town));
  const ta = wantsRegion ? null : matchPlace(input.town, placesIn(tlaRows, "territorial authority"));
  if (ta) {
    // A name that is also a region (Wellington, Auckland): the city/district answers, the region is mentioned.
    return answerFromRows(tlaRows, ta, input);
  }
  const regionRows = parseRents(await fetcher(links.region));
  const region = matchPlace(input.town, placesIn(regionRows, "region"));
  if (!region) {
    throw new InputError(`'${input.town}' is not a New Zealand territorial authority or region in the Tenancy Services rental bond data. Use a city or district such as Wellington, Auckland, Christchurch, Hamilton, Dunedin, or a region such as Canterbury.`);
  }
  return answerFromRows(regionRows, region, input);
}
