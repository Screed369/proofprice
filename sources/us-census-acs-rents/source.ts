// United States: median gross rent from the U.S. Census Bureau's American Community Survey (ACS) 5-year estimates, table B25064, for the
// whole country, every state, every county and every city or town (census "place"). Read from the Bureau's key-free bulk "table-based"
// summary files on www2.census.gov (the API at api.census.gov needs a key). One small pipe-delimited file holds the table
// (GEO_ID|B25064_E001|B25064_M001, 17 MB) and one holds the geography names (Geos<year>5YR.txt, 91 MB): the collector streams both once
// a day, keeps only an annual set of aggregates, and every answer is read from that copy. Formats probed from GitHub Actions on 2026-11-03.
//
// This is an official survey ESTIMATE of the median gross rent (contract rent plus utilities and fuels the tenant pays) of renter-occupied
// homes paying cash rent, with a published margin of error. It is not a list of rents and not an asking rent; no range and no count.

import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { libraryRoot, readLatestDay, readMeta } from "../../lib/library/store";
import { NO_COUNT } from "../../lib/stats";

export const ITEM = "median gross rent";
export const NATIONAL_AREA = "United States";

export const INFO: SourceInfo = {
  id: "us-census-acs-rents",
  country: "US (United States)",
  category: "rent (ACS median gross rent, official survey estimate)",
  name: "U.S. Census Bureau, American Community Survey 5-year estimates, table B25064 (median gross rent)",
  publisher: "U.S. Census Bureau",
  what_is_recorded:
    "The median monthly gross rent (the contract rent plus the utilities and fuels the tenant pays) of renter-occupied homes that pay cash rent, from the American Community Survey 5-year estimates, " +
    "for the United States, each state, each county and each city or town. The survey is of households and the figure carries a published margin of error; it is never a single tenancy or a listing.",
  price_type: "official_statistic",
  freshness: "Annual: each 5-year release (for example 2020 to 2024) comes out in December of the following year; every answer states its survey years",
  licence:
    "U.S. Census Bureau data are a work of the U.S. federal government and are published without copyright (recorded in our Source Pipeline for the Census Bureau's building-permits data on 21 Oct 2026; " +
    "the Bureau's citation page, https://www.census.gov/about/policies/citation.html, could not be read in full by our tools on 3 Nov 2026, so this source is on the free tier only). " +
    "The Bureau asks users to cite it as the source.",
  licence_url: "https://www.census.gov/about/policies/citation.html",
  attribution: "Source: U.S. Census Bureau, American Community Survey 5-Year Estimates, table B25064 (median gross rent), survey years stated in each answer. This product uses Census Bureau data but is not endorsed or certified by the Census Bureau.",
  homepage: "https://www.census.gov/programs-surveys/acs",
  limits:
    "A survey estimate of the median gross rent of renter-occupied homes paying cash rent, all sizes together: not asking rents, not new lettings only, not rents of homes with no cash rent, and no split by bedrooms. " +
    "It describes five years of survey responses, so it runs behind the market (the newest release covers the five years ending about two years ago). Small places have a wide margin of error, which we state. " +
    "One published median per place and year: no range and no count of homes.",
};

// ---------- the files ----------

export const SUMMARY_ROOT = "https://www2.census.gov/programs-surveys/acs/summary_file";
export const rentFileUrl = (year: number) => `${SUMMARY_ROOT}/${year}/table-based-SF/data/5YRData/acsdt5y${year}-b25064.dat`;
export const geoFileUrl = (year: number) => `${SUMMARY_ROOT}/${year}/table-based-SF/documentation/Geos${year}5YR.txt`;
export const RENT_HEADER = "GEO_ID|B25064_E001|B25064_M001";

/** Summary levels we keep: 010 United States, 040 state (incl. DC and Puerto Rico), 050 county, 160 place (city, town, village, CDP). */
export const LEVELS: Record<string, "country" | "state" | "county" | "place"> = { "010": "country", "040": "state", "050": "county", "160": "place" };

export interface Figure {
  estimate: number;
  moe: number | null;
}

/** Pure: GEO_ID -> estimate and margin of error. Negative codes (-666666666 no estimate, -222222222 too few samples, ...) are not figures and are dropped. */
export function parseRentLines(lines: Iterable<string>): Map<string, Figure> {
  const out = new Map<string, Figure>();
  let first = true;
  for (const raw of lines) {
    const line = raw.replace(/\r$/, "").replace(/^﻿/, "");
    if (!line.trim()) continue;
    if (first) {
      first = false;
      if (line.trim() !== RENT_HEADER) throw new SourceError(`The Census Bureau changed the B25064 file (header "${line.slice(0, 60)}"); this source needs updating.`);
      continue;
    }
    const [id, est, moe] = line.split("|");
    const e = Number(est);
    if (!id || est === undefined || est.trim() === "" || !Number.isFinite(e) || e <= 0) continue;
    const m = Number(moe);
    out.set(id, { estimate: e, moe: moe !== undefined && moe.trim() !== "" && Number.isFinite(m) && m >= 0 ? m : null });
  }
  if (first) throw new SourceError("The Census Bureau B25064 file was empty.");
  return out;
}

/** Pure: library rows from the geography file and the figures. One row per geography with a figure; n is NO_COUNT (no count of homes is published
 *  in this table). The row's min and max hold the 90% confidence bounds (estimate minus and plus the margin of error), low and high repeat the estimate. */
export function geoRows(lines: Iterable<string>, figures: Map<string, Figure>): { rows: DailyRow[]; levels: Record<string, number> } {
  let col: Record<string, number> | null = null;
  const seen = new Set<string>();
  const rows: DailyRow[] = [];
  const levels: Record<string, number> = { country: 0, state: 0, county: 0, place: 0 };
  for (const raw of lines) {
    const line = raw.replace(/\r$/, "").replace(/^﻿/, "");
    if (!line) continue;
    const cells = line.split("|");
    if (!col) {
      col = Object.fromEntries(cells.map((c, i) => [c, i]));
      for (const need of ["SUMLEVEL", "COMPONENT", "GEO_ID", "NAME"]) {
        if (col[need] === undefined) throw new SourceError(`The Census Bureau changed the geography file (no column ${need}); this source needs updating.`);
      }
      continue;
    }
    const level = LEVELS[cells[col.SUMLEVEL]];
    if (!level || cells[col.COMPONENT] !== "00") continue;
    const id = cells[col.GEO_ID];
    const name = (cells[col.NAME] ?? "").trim();
    const fig = figures.get(id);
    if (!fig || !name || seen.has(name)) continue;
    seen.add(name);
    levels[level]++;
    const lo = fig.moe === null ? fig.estimate : Math.max(1, fig.estimate - fig.moe);
    const hi = fig.moe === null ? fig.estimate : fig.estimate + fig.moe;
    rows.push({ area: name, item: ITEM, n: NO_COUNT, median: fig.estimate, low: fig.estimate, high: fig.estimate, min: lo, max: hi });
  }
  if (!col) throw new SourceError("The Census Bureau geography file was empty.");
  return { rows, levels };
}

/** Streams a text URL line by line (the geography file is 91 MB). */
export async function* linesOf(url: string, timeoutMs = 240000): AsyncGenerator<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "user-agent": "pricepaid-plug/0.1 (+price-paid data for AI agents)" } });
    if (!res.ok || !res.body) throw new SourceError(`Census Bureau returned HTTP ${res.status}`, url, res.status);
    const rl = createInterface({ input: Readable.fromWeb(res.body as any), crlfDelay: Infinity });
    for await (const line of rl) yield line;
  } catch (err: any) {
    if (err instanceof SourceError) throw err;
    if (err?.name === "AbortError") throw new SourceError("Source timed out", url);
    throw new SourceError("Could not reach the official source", String(err?.cause?.code ?? err?.message ?? err));
  } finally {
    clearTimeout(timer);
  }
}

export interface HarvestDeps {
  lines: (url: string) => AsyncIterable<string>;
  now: () => Date;
}
const realDeps: HarvestDeps = { lines: (u) => linesOf(u), now: () => new Date() };

async function collect(it: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const l of it) out.push(l);
  return out;
}

/** The newest ACS 5-year release that has the table: this year minus one is tried first (a December release), then the year before. */
export async function usRentHarvest(deps: HarvestDeps = realDeps): Promise<HarvestResult> {
  const thisYear = deps.now().getUTCFullYear();
  let year = 0;
  let figures: Map<string, Figure> | null = null;
  const errors: string[] = [];
  for (const y of [thisYear - 1, thisYear - 2]) {
    if (y < 2023) continue;
    try {
      figures = parseRentLines(await collect(deps.lines(rentFileUrl(y))));
      year = y;
      break;
    } catch (err: any) {
      if (err?.status === 404 || err?.status === 403) {
        errors.push(`${y}: HTTP ${err.status}`);
        continue;
      }
      throw err;
    }
  }
  if (!figures) throw new SourceError(`No ACS 5-year B25064 file found (${errors.join("; ") || "no year tried"}).`);
  const { rows, levels } = geoRows(await collect(deps.lines(geoFileUrl(year))), figures);
  if (levels.country < 1 || levels.state < 50 || levels.county < 1000) {
    throw new SourceError(`ACS ${year} B25064 looks incomplete (${JSON.stringify(levels)}); nothing stored.`);
  }
  return {
    date: `${year}-12-31`,
    currency: "USD",
    unit: "per month",
    rows,
    note: `ACS ${year - 4}-${year} 5-year estimates, table B25064 (median gross rent): ${levels.country} country, ${levels.state} states, ${levels.county} counties, ${levels.place} places with a published estimate. Survey estimates with margins of error (min and max hold the 90% bounds); no count of homes is published.`,
  };
}

// ---------- places ----------

export const STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
  DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico",
  NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island",
  SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington",
  WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", PR: "Puerto Rico",
};
const STATE_BY_NAME = new Map(Object.values(STATES).map((n) => [norm(n), n]));

function norm(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[.']/g, "").replace(/\s+/g, " ").trim();
}

/** "TX", "tx" or "Texas" -> "Texas"; null if it is not a state. */
export function stateName(s: string): string | null {
  const t = s.trim();
  if (/^[A-Za-z]{2}$/.test(t) && STATES[t.toUpperCase()]) return STATES[t.toUpperCase()];
  return STATE_BY_NAME.get(norm(t)) ?? null;
}

export interface Geo {
  area: string; // the Census NAME, e.g. "Austin city, Texas"
  level: "country" | "state" | "county" | "place";
  base: string; // "Austin"
  kind: string; // "city"
  state: string | null; // "Texas"
}

const PLACE_KINDS = /\s(city and borough|urban county|metropolitan government|municipality|consolidated government|unified government|metro government|borough|city|town|village|CDP|township|plantation|comunidad|zona urbana)(?:\s\(balance\))?$/i;

export function geoOf(area: string): Geo {
  if (area === NATIONAL_AREA) return { area, level: "country", base: area, kind: "", state: null };
  const comma = area.lastIndexOf(", ");
  if (comma < 0) return { area, level: "state", base: area, kind: "", state: area };
  const head = area.slice(0, comma);
  const state = area.slice(comma + 2);
  if (/\s(County|Parish|Census Area|Municipio)$/.test(head)) {
    return { area, level: "county", base: head, kind: "county", state };
  }
  const m = PLACE_KINDS.exec(head);
  return { area, level: "place", base: m ? head.slice(0, m.index) : head, kind: m ? m[1].toLowerCase() : "", state };
}

const ALIASES: Record<string, string> = { nyc: "New York city, New York", "new york city": "New York city, New York", dc: "District of Columbia", "washington dc": "District of Columbia", "washington d c": "District of Columbia" };

export interface Resolved {
  area: string;
  note?: string;
}

/** Pure: which stored area does the asker mean? Throws InputError when it is ambiguous or unknown. */
export function resolveArea(areas: string[], town: string | undefined): Resolved {
  const ask = (town ?? "").trim();
  if (!ask) return { area: NATIONAL_AREA };
  const geos = areas.map(geoOf);
  const key = norm(ask);
  if (ALIASES[key]) {
    const hit = geos.find((g) => norm(g.area) === norm(ALIASES[key]));
    if (hit) return { area: hit.area };
  }
  const exact = geos.find((g) => norm(g.area) === key);
  if (exact) return { area: exact.area };
  if (key === "us" || key === "usa" || key === "united states" || key === "united states of america") return { area: NATIONAL_AREA };

  let name = ask;
  let state: string | null = null;
  const comma = ask.lastIndexOf(",");
  if (comma > 0) {
    const st = stateName(ask.slice(comma + 1));
    if (!st) throw new InputError(`"${ask.slice(comma + 1).trim()}" is not a US state. Give a place as "Austin, Texas" or "Austin, TX".`);
    state = st;
    name = ask.slice(0, comma).trim();
  } else {
    const st = stateName(ask);
    if (st) {
      const hit = geos.find((g) => g.level === "state" && g.area === st);
      if (hit) return { area: hit.area };
    }
  }
  const nk = norm(name.replace(/^city of\s+/i, ""));
  const wantsCounty = /\b(county|parish|borough)$/.test(nk);
  const cands = geos.filter((g) => {
    if (g.level === "country" || g.level === "state") return false;
    if (state && g.state !== state) return false;
    if (g.level === "county") return norm(g.base) === nk || norm(g.base.replace(/\s(County|Parish)$/i, "")) === nk;
    return !wantsCounty && norm(g.base) === nk;
  });
  if (!cands.length) {
    throw new InputError(`No ACS rent figure for "${ask}". Give a US state, a county ("Travis County, Texas") or a city or town with its state ("Austin, Texas"); leave town out for the whole United States.`);
  }
  // A city is preferred to a CDP or township of the same name; a place to a county only when "County" was not typed.
  const rank = (g: Geo) => (g.level === "place" ? (g.kind === "city" ? 0 : g.kind === "town" || g.kind === "village" || g.kind === "borough" ? 1 : 3) : wantsCounty ? 0 : 2);
  const sorted = [...cands].sort((a, b) => rank(a) - rank(b) || a.area.localeCompare(b.area));
  const best = sorted.filter((g) => rank(g) === rank(sorted[0]));
  const states = new Set(best.map((g) => g.state));
  if (best.length > 1 && !state) {
    throw new InputError(`"${ask}" matches several US places (${best.slice(0, 5).map((g) => g.area).join("; ")}${best.length > 5 ? "; ..." : ""}). Add the state, for example "${best[0].base}, ${best[0].state}".`);
  }
  if (best.length > 1 && states.size === 1) {
    throw new InputError(`"${ask}" matches several places in ${best[0].state} (${best.slice(0, 5).map((g) => g.area).join("; ")}). Use the full name, for example "${best[0].area}".`);
  }
  const hit = best[0];
  return { area: hit.area, note: hit.level === "county" && !wantsCounty ? `"${ask}" is read as the county.` : undefined };
}

// ---------- the library copy ----------

export interface Snapshot {
  date: string;
  note: string | null;
  rows: Map<string, { median: number; lo: number; hi: number }>;
  areas: string[];
}

let cache: { key: string; snap: Snapshot } | null = null;
/** The newest annual copy in the library, or null when the collector has not stored one yet. */
export function loadSnapshot(): Snapshot | null {
  const meta = readMeta(INFO.id);
  const day = readLatestDay(INFO.id);
  if (!day) return null;
  const key = `${libraryRoot()}:${day.date}:${day.rows.length}:${meta?.last_ok_at ?? ""}`;
  if (cache?.key === key) return cache.snap;
  const rows = new Map<string, { median: number; lo: number; hi: number }>();
  for (const r of day.rows) if (r.item === ITEM) rows.set(r.area, { median: r.median, lo: r.min, hi: r.max });
  const snap: Snapshot = { date: day.date, note: meta?.note ?? null, rows, areas: [...rows.keys()] };
  cache = { key, snap };
  return snap;
}

const usd = (v: number) => fmtMoney(v, "USD");

export interface UsRentInput {
  town?: string;
  postcode?: string;
  property_type?: string;
  house_type?: string;
  bedrooms?: number;
  baseUrl?: string;
}

/** Pure: the answer for one place from a snapshot. */
export function usRentAnswer(snap: Snapshot, input: UsRentInput): PriceAnswer {
  const { area, note: placeNote } = resolveArea(snap.areas, input.town);
  const row = snap.rows.get(area)!;
  const endYear = Number(snap.date.slice(0, 4));
  const survey = `${endYear - 4}-${endYear}`;
  const geo = geoOf(area);
  const notes: string[] = [
    `The median gross rent (contract rent plus tenant-paid utilities and fuels) of renter-occupied homes paying cash rent in ${area}, from the American Community Survey ${survey} 5-year estimates: a survey estimate with a margin of error, not a list of rents and not an asking rent.`,
  ];
  if (input.bedrooms !== undefined) notes.push("This table does not split by bedrooms; the figure is for homes of all sizes.");
  if (input.property_type && input.property_type !== "any") notes.push("This table does not split by kind of home; the figure is for all renter-occupied homes paying cash rent.");
  if (input.postcode) notes.push("Postcodes are not used; the figure is for the place named.");
  if (placeNote) notes.push(placeNote);
  const moe = Math.round((row.hi - row.lo) / 2);
  const wide = row.median > 0 && (row.hi - row.lo) / 2 / row.median > 0.15;
  if (wide) notes.push("The margin of error is wide (over 15% of the figure): treat it as a rough guide.");
  const attribution = `${INFO.attribution.replace("survey years stated in each answer", `survey years ${survey}`)}`;
  return buildStatisticAnswer({
    source: INFO,
    query: { country: "US", town: area },
    value: row.median,
    measure: "median",
    currency: "USD",
    unit: "per month",
    period: { from: `${endYear - 4}-01-01`, to: snap.date },
    reference_period: survey,
    method:
      "Median gross rent of renter-occupied homes paying cash rent, American Community Survey 5-year estimates, table B25064, read by our daily collector from the Census Bureau's published summary files; no range is calculated.",
    baseUrl: input.baseUrl,
    note: notes.join(" "),
    describe: (v) =>
      `The median gross rent in ${area} was ${usd(v)} a month in the American Community Survey ${survey} 5-year estimates (90% confidence interval ${usd(row.lo)} to ${usd(row.hi)}). ` +
      `This is a survey estimate of what renters pay including utilities, not an asking rent.` +
      (wide ? " The margin of error is wide, so treat it as a rough guide." : ""),
    extra: {
      country_name: "United States",
      place: { name: area, level: geo.level, ...(geo.state ? { state: geo.state } : {}) },
      survey_years: survey,
      margin_of_error_90: moe,
      confidence_interval_90: { low: row.lo, high: row.hi },
      what_this_is: "Median gross rent of renter-occupied homes paying cash rent: contract rent plus utilities and fuels paid by the tenant. A survey estimate, all home sizes together.",
      dataset: { name: "American Community Survey 5-Year Estimates, table B25064", url: INFO.homepage },
      attribution_notice: attribution,
      ...(placeNote ? { place_note: placeNote } : {}),
    },
  });
}

export async function usRent(input: UsRentInput, snap: Snapshot | null = loadSnapshot()): Promise<PriceAnswer> {
  if (!snap) throw new SourceError("The US rent figures (Census ACS) have not been collected yet; try again after the next daily collection.");
  return usRentAnswer(snap, input);
}

/** Where a request lives in the library, without any network. */
export function usRentHistoryKey(p: { town?: string }, areas: string[]): { area: string; item: string; label: string } | null {
  if (!areas.length) return null;
  try {
    const { area } = resolveArea(areas, p.town);
    return { area, item: ITEM, label: area };
  } catch {
    return null;
  }
}
