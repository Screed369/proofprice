// US domestic airfares from the US Department of Transportation "Consumer Airfare Report", published as open data on
// data.transportation.gov (Socrata, no key). Formats below were checked live on 2026-10-14 through the GitHub Probe workflow.
//
//   Table 1a  tfrh-tu9e  airport pairs      year, quarter, city1, city2, airport_1, airport_2, nsmiles, passengers, fare, carrier_lg, large_ms, ...
//   Table 6   yj5y-b2ir  city pairs         same columns without airports; every contiguous-state city pair averaging >= 10 passengers a day
//   Table 2   wqw2-rjgd  city summary       year, quarter, city, markets, cur_passengers, cur_fare, cur_yield, distance, ly_passengers, ly_fare, ...
//
// What DOT publishes: for each market and quarter ONE average fare ("the each-way prices paid by all passengers on domestic commercial
// airlines"), the passengers per day behind it and the market share of the largest carrier. There is no distribution, so the answer is an
// official statistic (buildStatisticAnswer): value + measure "average", range fields null. Carrier-level fares in the tables are never passed on.
// BTS "Average Domestic Airline Itinerary Fares" (transtats.bts.gov/AverageFare) is an interactive web page, not a key-free data API, so a
// request with only `from` is answered from DOT's city summary (Table 2) instead.

import { socrataQuery, soqlString, Fetcher } from "../../lib/adapters";
import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { InputError } from "../../lib/http";
import type { SourceInfo } from "../../lib/plugin";
import { AIRPORTS_BY_MARKET, EXTRA_AIRPORTS_BY_MARKET, MARKETS, OUTSIDE_COVERAGE_AIRPORTS } from "./markets";

export const INFO: SourceInfo = {
  id: "us-dot-airfares",
  country: "US (contiguous 48 states)",
  category: "airfares (average domestic fares)",
  name: "Consumer Airfare Report: Table 1a (airport pairs), Table 6 (city pairs) and Table 2 (city summary)",
  publisher: "U.S. Department of Transportation (Office of the Secretary, Office of Aviation Analysis), from airline data submitted to the Bureau of Transportation Statistics",
  what_is_recorded:
    "For each directionless airport pair or city-pair market and quarter: the average fare paid, the passengers per day, the distance, and the market share of the largest carrier. " +
    "Built from the ticket data airlines report to the Bureau of Transportation Statistics (the DB1B 10 percent ticket sample). One published average per market and quarter; never individual tickets or passengers.",
  price_type: "official_statistic",
  freshness: "Quarterly, published about five to six months after the quarter ends (the first quarter of 2026 was published in September 2026); every answer states its quarter",
  licence:
    'Public Domain U.S. Government (the licence stated on the datasets at data.transportation.gov; each dataset also carries licenseId USGOV_WORKS and points to http://www.usa.gov/publicdomain/label/1.0/). ' +
    'USA.gov: "Government work is something created by a U.S. government officer or employee as part of their official duties."',
  licence_url: "https://www.usa.gov/publicdomain/label/1.0/",
  attribution:
    "Source: U.S. Department of Transportation, Consumer Airfare Report (Table 1a, Table 6 and Table 2), data.transportation.gov. " +
    "Average fares are passed on as published; ProofPrice calculates the year-on-year change. Not endorsed by the Department of Transportation.",
  homepage: "https://data.transportation.gov/d/yj5y-b2ir",
  limits:
    "Averages over all tickets sold in a market in one quarter, not today's fare, a quote or an offer; DOT itself says airline prices fluctuate, so these averages likely won't match current ticket prices. " +
    "Each-way fares (the price per direction) including first-class tickets, taxes and airport fees; free tickets such as frequent-flyer awards and extras such as baggage and seat fees are not included. " +
    "Contiguous 48 states only (Alaska, Hawaii and the territories are not in the tables). City-pair markets with fewer than 10 passengers a day are not published. " +
    "Carrier-level fares exist in the DOT tables but are not passed on: no airline's fare is quoted. Published about five to six months after the quarter ends. " +
    "A request with only `from` gets the city-level average over that city's busiest markets (DOT Table 2); BTS's per-airport itinerary-fare tool is an interactive web page, not a data API.",
};

export const DOT_DOMAIN = "data.transportation.gov";
export const TABLES = {
  airport: { id: "tfrh-tu9e", name: "Consumer Airfare Report: Table 1a - All U.S. Airport Pair Markets", url: "https://data.transportation.gov/d/tfrh-tu9e" },
  city: { id: "yj5y-b2ir", name: "Consumer Airfare Report: Table 6 - Contiguous State City-Pair Markets That Average At Least 10 Passengers Per Day", url: "https://data.transportation.gov/d/yj5y-b2ir" },
  summary: { id: "wqw2-rjgd", name: "Consumer Airfare Report: Table 2 - Top 1,000 City-Pair Markets (summarised by city)", url: "https://data.transportation.gov/d/wqw2-rjgd" },
} as const;
export type TableKind = keyof typeof TABLES;

/** Fewer passengers a day than this and the quarter's average rests on too few tickets to publish (a quarter has about 90 days). */
export const MIN_PASSENGERS_PER_DAY = 1;
export const DEFAULT_QUARTERS = 4;
export const MAX_QUARTERS = 20;
/** A figure whose quarter ended more than this many months ago is flagged as old. */
export const OLD_AFTER_MONTHS = 12;

// ---------- places: airport codes and city markets ----------

const OUT = "Airfares here cover the contiguous 48 states only: Alaska, Hawaii and the US territories are not in the DOT tables.";

/** Lower-case, no accents or punctuation, single spaces; "Saint"/"Fort"/"Mount" are shortened so "St. Louis" and "Saint Louis" meet. */
export function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[.'’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\bsaint\b/g, "st")
    .replace(/\bfort\b/g, "ft")
    .replace(/\bmount\b/g, "mt");
}

export const AIRPORT_MARKET: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>();
  for (const table of [AIRPORTS_BY_MARKET, EXTRA_AIRPORTS_BY_MARKET]) {
    for (const [market, codes] of Object.entries(table)) for (const c of codes.split(" ")) if (c && !m.has(c)) m.set(c, market);
  }
  return m;
})();

interface MarketKey {
  market: string;
  state: string;
  names: string[]; // normalised full base name and each slash-separated part
}

function parseMarket(market: string): MarketKey {
  const m = /^(.*), ([A-Z]{2})(?: \(Metropolitan Area\))?$/.exec(market);
  const base = m ? m[1] : market;
  const state = m ? m[2] : "";
  const names = [...new Set([norm(base), ...base.split("/").map(norm)])].filter(Boolean);
  return { market, state, names };
}

const KEYS: MarketKey[] = MARKETS.map(parseMarket);

const NYC = "New York City, NY (Metropolitan Area)";
const WAS = "Washington, DC (Metropolitan Area)";
const LAX = "Los Angeles, CA (Metropolitan Area)";
const SFO = "San Francisco, CA (Metropolitan Area)";
const MIA = "Miami, FL (Metropolitan Area)";
const TPA = "Tampa, FL (Metropolitan Area)";
const BOS = "Boston, MA (Metropolitan Area)";
const CLE = "Cleveland, OH (Metropolitan Area)";
const ORF = "Norfolk, VA (Metropolitan Area)";

/** Common names that DOT files under another market. Keys are already normalised (see norm). */
export const ALIASES: Record<string, string> = {
  "new york": NYC, nyc: NYC, "new york ny": NYC, newark: NYC, "long island": NYC,
  washington: WAS, "washington dc": WAS, dc: WAS, baltimore: WAS,
  "los angeles": LAX, la: LAX, burbank: LAX, "long beach": LAX, anaheim: LAX, "orange county": LAX, "santa ana": LAX,
  "san francisco": SFO, sf: SFO, "bay area": SFO, "san francisco bay area": SFO, oakland: SFO, "san jose": SFO,
  "ft lauderdale": MIA, "south florida": MIA,
  dallas: "Dallas/Fort Worth, TX",
  "st petersburg": TPA, clearwater: TPA,
  providence: BOS,
  akron: CLE, canton: CLE,
  "virginia beach": ORF, "newport news": ORF,
  "salt lake": "Salt Lake City, UT",
  vegas: "Las Vegas, NV",
  philly: "Philadelphia, PA",
};

const STATES: Record<string, string> = {
  al: "AL", alabama: "AL", ak: "AK", alaska: "AK", az: "AZ", arizona: "AZ", ar: "AR", arkansas: "AR", ca: "CA", california: "CA", co: "CO", colorado: "CO",
  ct: "CT", connecticut: "CT", de: "DE", delaware: "DE", dc: "DC", fl: "FL", florida: "FL", ga: "GA", georgia: "GA", hi: "HI", hawaii: "HI", id: "ID", idaho: "ID",
  il: "IL", illinois: "IL", in: "IN", indiana: "IN", ia: "IA", iowa: "IA", ks: "KS", kansas: "KS", ky: "KY", kentucky: "KY", la: "LA", louisiana: "LA",
  me: "ME", maine: "ME", md: "MD", maryland: "MD", ma: "MA", massachusetts: "MA", mi: "MI", michigan: "MI", mn: "MN", minnesota: "MN", ms: "MS", mississippi: "MS",
  mo: "MO", missouri: "MO", mt: "MT", montana: "MT", ne: "NE", nebraska: "NE", nv: "NV", nevada: "NV", nh: "NH", "new hampshire": "NH", nj: "NJ", "new jersey": "NJ",
  nm: "NM", "new mexico": "NM", ny: "NY", "new york": "NY", nc: "NC", "north carolina": "NC", nd: "ND", "north dakota": "ND", oh: "OH", ohio: "OH",
  ok: "OK", oklahoma: "OK", or: "OR", oregon: "OR", pa: "PA", pennsylvania: "PA", ri: "RI", "rhode island": "RI", sc: "SC", "south carolina": "SC",
  sd: "SD", "south dakota": "SD", tn: "TN", tennessee: "TN", tx: "TX", texas: "TX", ut: "UT", utah: "UT", vt: "VT", vermont: "VT", va: "VA", virginia: "VA",
  wa: "WA", washington: "WA", wv: "WV", "west virginia": "WV", wi: "WI", wisconsin: "WI", wy: "WY", wyoming: "WY",
};

export type Place =
  | { kind: "airport"; input: string; code: string; market: string }
  | { kind: "city"; input: string; market: string };

/** "New York City, NY (Metropolitan Area)" -> "New York City, NY". */
export function shortMarket(market: string): string {
  return market.replace(/ \(Metropolitan Area\)$/, "");
}

/** "JFK, New York City, NY" or "Chicago, IL". */
export function placeLabel(p: Place): string {
  return p.kind === "airport" ? `${p.code} (${shortMarket(p.market)})` : shortMarket(p.market);
}

/** Split "Portland, OR" / "Portland OR" / "Portland, Oregon" into a name and a state; the state is undefined when none is given. */
function splitState(text: string): { name: string; state?: string } {
  const comma = text.split(",");
  if (comma.length >= 2) {
    const st = STATES[norm(comma[comma.length - 1])];
    if (st) return { name: norm(comma.slice(0, -1).join(" ")), state: st };
  }
  const n = norm(text);
  const words = n.split(" ");
  for (const take of [2, 1]) {
    if (words.length > take) {
      const st = STATES[words.slice(-take).join(" ")];
      if (st) return { name: words.slice(0, -take).join(" "), state: st };
    }
  }
  return { name: n };
}

/**
 * An airport code (JFK, lax) or a city name ("Chicago", "Portland, OR", "New York") -> the DOT market it belongs to.
 * Throws InputError with a plain message when the place is unknown, ambiguous or outside the contiguous 48 states.
 */
export function resolvePlace(raw: string | undefined, role: "from" | "to" = "from"): Place {
  const text = (raw ?? "").trim();
  if (!text) throw new InputError(`${role} is required: an airport code (JFK) or a city (Chicago).`);
  if (/^[A-Za-z]{3}$/.test(text)) {
    const code = text.toUpperCase();
    if (ALIASES[norm(text)]) return { kind: "city", input: text, market: ALIASES[norm(text)] }; // "NYC" means the whole New York market
    const market = AIRPORT_MARKET.get(code);
    if (market) return { kind: "airport", input: text, code, market };
    if (OUTSIDE_COVERAGE_AIRPORTS[code]) throw new InputError(`${code} (${OUTSIDE_COVERAGE_AIRPORTS[code]}) is outside the DOT airfare tables. ${OUT}`);
    throw new InputError(`'${text}' is not an airport code in the DOT airfare tables (contiguous US). Give the city name instead, for example 'Springfield, MO'. ${OUT}`);
  }
  const full = norm(text);
  if (ALIASES[full]) return { kind: "city", input: text, market: ALIASES[full] };
  const { name, state } = splitState(text);
  if (state === "AK" || state === "HI" || name === "honolulu" || name === "anchorage") throw new InputError(`'${text}' is outside the DOT airfare tables. ${OUT}`);
  if (ALIASES[name] && !state) return { kind: "city", input: text, market: ALIASES[name] };
  const hits = KEYS.filter((k) => k.names.includes(name) && (!state || k.state === state));
  if (hits.length === 1) return { kind: "city", input: text, market: hits[0].market };
  if (hits.length > 1) {
    throw new InputError(
      `'${text}' matches more than one DOT market: ${hits.map((h) => shortMarket(h.market)).join("; ")}. Add the state, for example '${shortMarket(hits[0].market)}'.`,
    );
  }
  throw new InputError(
    `'${text}' is not a city market or airport in the DOT airfare tables. Use an airport code (JFK) or a city name ('Boston', 'Austin, TX'). ${OUT}`,
  );
}

// ---------- quarters ----------

export function normaliseQuarters(q: number | undefined): number {
  if (q === undefined || q === null || !Number.isFinite(q)) return DEFAULT_QUARTERS;
  return Math.max(1, Math.min(MAX_QUARTERS, Math.round(q)));
}

export function quarterLabel(year: number, quarter: number): string {
  return `${year}-Q${quarter}`;
}

/** 2026, 1 -> { from: "2026-01-01", to: "2026-03-31" } */
export function quarterRange(year: number, quarter: number): { from: string; to: string } {
  const startMonth = (quarter - 1) * 3;
  const from = new Date(Date.UTC(year, startMonth, 1));
  const to = new Date(Date.UTC(year, startMonth + 3, 0));
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export function quarterWords(year: number, quarter: number): string {
  return `the ${["first", "second", "third", "fourth"][quarter - 1]} quarter of ${year}`;
}

/** Whole months from the end of the quarter to `today` (negative never). */
export function monthsSinceQuarterEnd(year: number, quarter: number, today: Date): number {
  const end = new Date(quarterRange(year, quarter).to + "T00:00:00Z");
  return Math.max(0, (today.getUTCFullYear() - end.getUTCFullYear()) * 12 + (today.getUTCMonth() - end.getUTCMonth()));
}

// ---------- reading the tables (pure) ----------

export interface FareRow {
  year: number;
  quarter: number;
  fare: number;
  passengersPerDay: number | null;
  miles: number | null;
  largestCarrier: string | null;
  largestShare: number | null;
  label: string; // "Los Angeles, CA / New York City, NY"
}

export interface SummaryRow {
  year: number;
  quarter: number;
  fare: number;
  passengers: number | null; // passengers in the quarter across the city's top-1,000 markets
  markets: number | null;
  miles: number | null;
  yearAgoFare: number | null;
  yearAgoPassengers: number | null;
}

function numOrNull(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function yq(r: Record<string, any>): { year: number; quarter: number } | null {
  const year = Number(r.year);
  const quarter = Number(r.quarter);
  return Number.isInteger(year) && year >= 1993 && Number.isInteger(quarter) && quarter >= 1 && quarter <= 4 ? { year, quarter } : null;
}

/** Table 1a / Table 6 rows -> newest first, one row per quarter (the busier record wins if a quarter repeats), no row without a fare. */
export function parsePairRows(rows: Record<string, any>[]): FareRow[] {
  const best = new Map<string, FareRow>();
  for (const r of rows) {
    const p = yq(r);
    const fare = numOrNull(r.fare);
    if (!p || fare === null || fare <= 0) continue;
    const row: FareRow = {
      ...p,
      fare,
      passengersPerDay: numOrNull(r.passengers),
      miles: numOrNull(r.nsmiles),
      largestCarrier: typeof r.carrier_lg === "string" && r.carrier_lg ? r.carrier_lg : null,
      largestShare: numOrNull(r.large_ms),
      label: [r.city1, r.city2].filter((x) => typeof x === "string" && x).join(" / "),
    };
    const key = quarterLabel(p.year, p.quarter);
    const have = best.get(key);
    if (!have || (row.passengersPerDay ?? 0) > (have.passengersPerDay ?? 0)) best.set(key, row);
  }
  return [...best.values()].sort((a, b) => b.year - a.year || b.quarter - a.quarter);
}

/** Table 2 rows -> newest first. cur_* is the quarter shown, ly_* the same quarter a year earlier. */
export function parseSummaryRows(rows: Record<string, any>[]): SummaryRow[] {
  const out: SummaryRow[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const p = yq(r);
    const fare = numOrNull(r.cur_fare);
    if (!p || fare === null || fare <= 0) continue;
    const key = quarterLabel(p.year, p.quarter);
    if (seen.has(key)) continue;
    seen.add(key);
    const ly = numOrNull(r.ly_fare);
    out.push({
      ...p,
      fare,
      passengers: numOrNull(r.cur_passengers),
      markets: numOrNull(r.markets),
      miles: numOrNull(r.distance),
      yearAgoFare: ly !== null && ly > 0 ? ly : null,
      yearAgoPassengers: numOrNull(r.ly_passengers),
    });
  }
  return out.sort((a, b) => b.year - a.year || b.quarter - a.quarter);
}

// ---------- queries (pure) ----------

function inList(values: string[]): string {
  return `(${values.map(soqlString).join(",")})`;
}

/** Directionless pair: both orders match. Airport pair uses Table 1a columns, city pair Table 6 columns. */
export function pairWhere(kind: "airport" | "city", a: string, b: string): string {
  const [c1, c2] = kind === "airport" ? ["airport_1", "airport_2"] : ["city1", "city2"];
  return `${c1} in ${inList([a, b])} AND ${c2} in ${inList([a, b])}`;
}

export function summaryWhere(market: string): string {
  return `city = ${soqlString(market)}`;
}

export const ORDER = ["year DESC", "quarter DESC"];

// ---------- the answer ----------

const HOW =
  "DOT publishes, every quarter, the average fare paid in each market: its report defines average fares as 'the each-way prices paid by all passengers on domestic commercial airlines', " +
  "including first-class tickets, taxes and airport fees, built from the ticket data airlines report to the Bureau of Transportation Statistics (the DB1B 10 percent ticket sample). " +
  "ProofPrice returns the published figure for the latest quarter DOT holds for the market, unchanged, with the passengers per day behind it and recent quarters. " +
  "No range is calculated: DOT gives one average per market and quarter. Fares are per direction; free tickets (such as frequent-flyer awards) and extras such as baggage and seat fees are not included, and no airline's own fare is quoted.";

const moneyUsd = (v: number) => fmtMoney(v, "USD");
const pct = (v: number) => Math.round(v * 10) / 10;

function changeWords(p: number): string {
  if (p === 0) return " That is unchanged from a year earlier.";
  return ` That is ${Math.abs(p)}% ${p > 0 ? "higher" : "lower"} than a year earlier.`;
}

function ageNote(year: number, quarter: number, today: Date): string | null {
  const months = monthsSinceQuarterEnd(year, quarter, today);
  if (months < OLD_AFTER_MONTHS) return null;
  const years = Math.floor(months / 12);
  return `This is the newest figure DOT holds for this market and its quarter ended more than ${years === 1 ? "a year" : `${years} years`} ago, so it may not describe fares today.`;
}

function trendOf(rows: { year: number; quarter: number; fare: number; passengersPerDay?: number | null }[]) {
  return rows.map((r) => ({
    reference_period: quarterLabel(r.year, r.quarter),
    average_fare: Math.round(r.fare * 100) / 100,
    ...(r.passengersPerDay !== undefined ? { passengers_per_day: r.passengersPerDay === null ? null : Math.round(r.passengersPerDay * 10) / 10 } : {}),
  }));
}

function yearAgoOf(rows: { year: number; quarter: number; fare: number }[]): { reference_period: string; average_fare: number; change_percent: number } | null {
  const head = rows[0];
  const ago = rows.find((r) => r.year === head.year - 1 && r.quarter === head.quarter);
  if (!ago || ago.fare <= 0) return null;
  return { reference_period: quarterLabel(ago.year, ago.quarter), average_fare: Math.round(ago.fare * 100) / 100, change_percent: pct(((head.fare - ago.fare) / ago.fare) * 100) };
}

export interface PairContext {
  table: TableKind; // "airport" or "city"
  from: Place;
  to: Place;
  quarters: number;
  notes?: string[];
  baseUrl?: string;
  today?: Date;
}

type AnswerBase = Omit<Parameters<typeof buildStatisticAnswer>[0], "value" | "period" | "reference_period" | "describe">;

function emptyAnswer(base: AnswerBase, summary: string, status: PriceAnswer["status"] = "no_matches"): PriceAnswer {
  const none = buildStatisticAnswer({ ...base, value: null, period: { from: null, to: null }, reference_period: "", describe: () => "" });
  return { ...none, status, summary };
}

/** The finished answer for a pair of places. `rows` is newest first. Pure. */
export function pairAnswer(rows: FareRow[], ctx: PairContext): PriceAnswer {
  const today = ctx.today ?? new Date();
  const T = TABLES[ctx.table];
  const kindWord = ctx.table === "airport" ? "airport pair" : "city-pair market";
  const query = { country: "US", from: ctx.from.input, to: ctx.to.input, quarters: ctx.quarters };
  const base = {
    source: INFO,
    query,
    measure: "average" as const,
    currency: "USD",
    unit: "per passenger, each way",
    method: HOW,
    baseUrl: ctx.baseUrl,
  };
  const a = placeLabel(ctx.from);
  const b = placeLabel(ctx.to);
  const head = rows[0];
  if (!head) {
    return emptyAnswer(
      base,
      `DOT's ${kindWord} table (${T.name}) holds no average fare for ${a} to ${b}. City pairs with fewer than 10 passengers a day are not published, and only the contiguous 48 states are covered.`,
    );
  }
  if ((head.passengersPerDay ?? Infinity) < MIN_PASSENGERS_PER_DAY) {
    return emptyAnswer(
      base,
      `DOT reports only ${head.passengersPerDay} passengers a day between ${a} and ${b} in ${quarterWords(head.year, head.quarter)}: too few to publish an average fare.`,
      "insufficient_data",
    );
  }
  const notes = [...(ctx.notes ?? [])];
  const old = ageNote(head.year, head.quarter, today);
  if (old) notes.push(old);
  notes.push("Averages include every ticket sold in the market that quarter, so they will not match today's fare for a given date or airline.");
  const ago = yearAgoOf(rows);
  const range = quarterRange(head.year, head.quarter);
  const pax = head.passengersPerDay === null ? null : Math.round(head.passengersPerDay * 10) / 10;

  return buildStatisticAnswer({
    ...base,
    value: head.fare,
    period: range,
    reference_period: quarterLabel(head.year, head.quarter),
    note: notes.join(" "),
    describe: (v) =>
      `People paid an average of ${moneyUsd(v)} each way between ${a} and ${b} in ${quarterWords(head.year, head.quarter)}` +
      (pax !== null ? `, with about ${Math.round(pax).toLocaleString("en-US")} passengers a day in both directions` : "") +
      ". Fares are per direction, including taxes and airport fees." +
      (ago ? changeWords(ago.change_percent) : ""),
    extra: {
      market: { type: ctx.table === "airport" ? "airport_pair" : "city_pair", from: a, to: b, from_market: ctx.from.market, to_market: ctx.to.market, miles: head.miles },
      fare_basis: "average fare per passenger for one direction of travel (each-way price), USD, taxes and airport fees included",
      passengers_per_day: pax,
      ...(head.largestShare !== null
        ? { largest_carrier_share: { carrier: head.largestCarrier, share_of_passengers: Math.round(head.largestShare * 1000) / 1000 } }
        : {}),
      year_ago: ago,
      trend: trendOf(rows.slice(0, ctx.quarters)),
      dataset: { id: T.id, name: T.name, url: T.url, publisher_page: "https://www.transportation.gov/policy/aviation-policy/air-fare-information-consumers" },
      ...(notes.length ? { notes } : {}),
    },
  });
}

export interface CityContext {
  from: Place;
  quarters: number;
  notes?: string[];
  baseUrl?: string;
  today?: Date;
}

/** The finished answer for one city (no destination). `rows` is newest first. Pure. */
export function cityAnswer(rows: SummaryRow[], ctx: CityContext): PriceAnswer {
  const today = ctx.today ?? new Date();
  const T = TABLES.summary;
  const city = shortMarket(ctx.from.market);
  const query = { country: "US", from: ctx.from.input, to: null, quarters: ctx.quarters };
  const base = {
    source: INFO,
    query,
    measure: "average" as const,
    currency: "USD",
    unit: "per passenger, each way",
    method:
      HOW +
      " With no destination given, the figure is DOT's city summary (Table 2): the average each-way fare over the city's markets among the 1,000 busiest city pairs, to and from the city.",
    baseUrl: ctx.baseUrl,
  };
  const head = rows[0];
  if (!head) {
    return emptyAnswer(base, `DOT's city summary (${T.name}) has no average fare for ${city}: only cities that appear in the 1,000 busiest city-pair markets are listed. Give a destination to look up a specific route.`);
  }
  const notes = [...(ctx.notes ?? [])];
  const old = ageNote(head.year, head.quarter, today);
  if (old) notes.push(old);
  notes.push("This is an average over many routes to and from the city, not the fare for one route; give a destination for a route.");
  const ago = head.yearAgoFare !== null ? { average_fare: Math.round(head.yearAgoFare * 100) / 100, change_percent: pct(((head.fare - head.yearAgoFare) / head.yearAgoFare) * 100) } : null;

  return buildStatisticAnswer({
    ...base,
    value: head.fare,
    period: quarterRange(head.year, head.quarter),
    reference_period: quarterLabel(head.year, head.quarter),
    note: notes.join(" "),
    describe: (v) =>
      `Across its busiest routes, passengers travelling to or from ${city} paid an average of ${moneyUsd(v)} each way in ${quarterWords(head.year, head.quarter)}` +
      (head.markets !== null ? ` (${head.markets} city-pair markets among DOT's 1,000 busiest)` : "") +
      "." +
      (ago ? changeWords(ago.change_percent) : ""),
    extra: {
      market: { type: "city_summary", city, dot_market: ctx.from.market, markets_counted: head.markets, average_miles: head.miles === null ? null : Math.round(head.miles) },
      fare_basis: "average fare per passenger for one direction of travel (each-way price), USD, taxes and airport fees included",
      passengers_in_quarter: head.passengers,
      year_ago: ago ? { reference_period: quarterLabel(head.year - 1, head.quarter), ...ago } : null,
      trend: trendOf(rows.slice(0, ctx.quarters)),
      dataset: { id: T.id, name: T.name, url: T.url, publisher_page: "https://www.transportation.gov/policy/aviation-policy/air-fare-information-consumers" },
      ...(notes.length ? { notes } : {}),
    },
  });
}

// ---------- the request ----------

export interface AirfareInput {
  from?: string;
  to?: string;
  quarters?: number;
  baseUrl?: string;
}

export interface AirfareOptions {
  fetcher?: Fetcher;
  today?: Date;
}

const SELECT_PAIR = (kind: "airport" | "city") =>
  kind === "airport"
    ? ["year", "quarter", "city1", "city2", "airport_1", "airport_2", "nsmiles", "passengers", "fare", "carrier_lg", "large_ms"]
    : ["year", "quarter", "city1", "city2", "nsmiles", "passengers", "fare", "carrier_lg", "large_ms"];
const SELECT_SUMMARY = ["year", "quarter", "city", "markets", "cur_passengers", "cur_fare", "distance", "ly_passengers", "ly_fare"];

async function queryPair(kind: "airport" | "city", a: string, b: string, quarters: number, o: AirfareOptions): Promise<FareRow[]> {
  const rows = await socrataQuery(
    DOT_DOMAIN,
    TABLES[kind].id,
    { select: SELECT_PAIR(kind), where: pairWhere(kind, a, b), order: ORDER, limit: quarters * 2 },
    { fetcher: o.fetcher, timeoutMs: 25000 },
  );
  return parsePairRows(rows);
}

export async function usAirfares(input: AirfareInput, o: AirfareOptions = {}): Promise<PriceAnswer> {
  const quarters = normaliseQuarters(input.quarters);
  const from = resolvePlace(input.from, "from");
  const notes: string[] = [];
  const noteMatch = (p: Place) => {
    if (p.kind !== "city") return;
    if (!parseMarket(p.market).names.includes(splitState(p.input).name)) notes.push(`'${p.input}' is filed by DOT under the market ${shortMarket(p.market)}.`);
  };

  if (!input.to || !input.to.trim()) {
    if (from.kind === "airport") notes.push(`${from.code} is part of the DOT city market ${shortMarket(from.market)}; the city summary covers the whole market.`);
    noteMatch(from);
    const rows = await socrataQuery(
      DOT_DOMAIN,
      TABLES.summary.id,
      { select: SELECT_SUMMARY, where: summaryWhere(from.market), order: ORDER, limit: quarters * 2 },
      { fetcher: o.fetcher, timeoutMs: 25000 },
    );
    return cityAnswer(parseSummaryRows(rows), { from, quarters, notes, baseUrl: input.baseUrl, today: o.today });
  }

  const to = resolvePlace(input.to, "to");
  if (from.market === to.market) {
    throw new InputError(`${placeLabel(from)} and ${placeLabel(to)} are in the same DOT city market (${shortMarket(from.market)}); give two different cities or airports.`);
  }
  noteMatch(from);
  noteMatch(to);

  if (from.kind === "airport" && to.kind === "airport") {
    const rows = await queryPair("airport", from.code, to.code, quarters, o);
    if (rows.length) return pairAnswer(rows, { table: "airport", from, to, quarters, notes, baseUrl: input.baseUrl, today: o.today });
    notes.push(`DOT's airport-pair table has no row for ${from.code} to ${to.code}, so this is the city-pair market ${shortMarket(from.market)} to ${shortMarket(to.market)} (all airports in both cities).`);
  } else if (from.kind === "airport" || to.kind === "airport") {
    const ap = from.kind === "airport" ? from : (to as Extract<Place, { kind: "airport" }>);
    notes.push(`${ap.code} is treated as its whole city market, ${shortMarket(ap.market)}: DOT publishes airport-level fares only between two airports.`);
  }
  const rows = await queryPair("city", from.market, to.market, quarters, o);
  return pairAnswer(rows, { table: "city", from, to, quarters, notes, baseUrl: input.baseUrl, today: o.today });
}
