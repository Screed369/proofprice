// Ontario fuel prices: the Ontario Ministry of Energy "Fuels Price Survey". One CSV ("fueltypesall.csv", wide format, one row per week and fuel type,
// every week since 3 January 1990) with the average retail price in cents per litre in 14 Ontario markets plus the provincial, southern and northern averages.
// The file is 1.4 MB, so it is read once per request (the CDN caches answers for 10 minutes) and the newest week is taken. A daily collector (harvest) stores the
// newest survey week (one row per market and fuel, dated by the survey Monday) so an outage is answered from our copy of the last 7 days and /history builds a weekly series.
// Format checked on 2026-10-23 from GitHub's servers (probe onfuelc1): ontario.ca/v1/files/fuel-prices/fueltypesall.csv answers 301 -> 302 -> an S3 file
// (200 text/csv, 1,415,508 bytes). The probe sees only the first 200 KB (Regular Unleaded Gasoline 1990 to 2017), so the other fuel-type names are matched by
// words (diesel, premium, propane, natural gas) and a request for a fuel that is not found lists the names the file really holds.
// A 0 means the market was not surveyed that week and is dropped.

import { InputError, SourceError } from "../../lib/http";
import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import type { HarvestResult, SourceInfo } from "../../lib/plugin";
import { NO_COUNT } from "../../lib/stats";

export const PAGE_URL = "https://data.ontario.ca/dataset/fuels-price-survey-information";
export const CSV_URL = "https://ontario.ca/v1/files/fuel-prices/fueltypesall.csv";
export const LICENCE_URL = "https://www.ontario.ca/page/open-government-licence-ontario";

export const INFO: SourceInfo = {
  id: "ca-on-fuel",
  country: "CA (Ontario)",
  category: "fuel (weekly average pump price, Ontario markets)",
  name: "Ontario Fuels Price Survey (fueltypesall.csv)",
  publisher: "Government of Ontario, Ministry of Energy",
  what_is_recorded:
    "For each week since January 1990, the average retail price in cents per litre of regular unleaded gasoline, premium unleaded gasoline, diesel, propane and compressed natural gas in 14 Ontario markets, with the provincial, southern and northern Ontario averages.",
  price_type: "posted_pump_price",
  freshness: "Weekly (Mondays, before the end of the business day; the next working day after a holiday)",
  licence:
    'Open Government Licence – Ontario: "The Information Provider grants you a worldwide, royalty-free, perpetual, non-exclusive licence to use the Information" including for commercial purposes.',
  licence_url: LICENCE_URL,
  attribution:
    "Contains information licensed under the Open Government Licence – Ontario. Source: Government of Ontario, Ministry of Energy, Fuels Price Survey. " +
    "Prices are passed on as published (converted from cents to dollars per litre); the changes on the week and the year are own calculations by ProofPrice.",
  homepage: PAGE_URL,
  limits:
    "Weekly average pump prices from the Ministry's survey of stations in 14 Ontario markets: not an individual station's price, not a range and no sample size. " +
    "Ontario only. Toronto (city), Ottawa and Thunder Bay are answered by Statistics Canada's monthly series; this source answers the other Ontario markets, Toronto East and Toronto West, and the Ontario averages. " +
    "Some markets are not surveyed every week (a market with no price that week is skipped, and the answer names the week it has). Prices are posted pump prices, not prices of completed sales.",
};

// ---------- markets ----------

export interface Market {
  column: string;
  label: string;
  aliases: readonly string[];
  statcan?: boolean;
}
export const MARKETS: readonly Market[] = [
  { column: "Ottawa", label: "Ottawa", aliases: ["ottawa"], statcan: true },
  { column: "Toronto West", label: "Toronto West", aliases: ["toronto west", "west toronto", "toronto ouest"] },
  { column: "Toronto East", label: "Toronto East", aliases: ["toronto east", "east toronto", "toronto est"] },
  { column: "Windsor", label: "Windsor", aliases: ["windsor"] },
  { column: "London", label: "London", aliases: ["london", "london ontario"] },
  { column: "Peterborough", label: "Peterborough", aliases: ["peterborough"] },
  { column: "St. Catharine", label: "St. Catharines", aliases: ["st catharines", "st catharine", "saint catharines", "st catharines niagara"] },
  { column: "Sudbury", label: "Sudbury", aliases: ["sudbury", "greater sudbury"] },
  { column: "Sault Saint Marie", label: "Sault Ste. Marie", aliases: ["sault ste marie", "sault saint marie", "sault st marie", "ssm"] },
  { column: "Thunder Bay", label: "Thunder Bay", aliases: ["thunder bay"], statcan: true },
  { column: "North Bay", label: "North Bay", aliases: ["north bay"] },
  { column: "Timmins", label: "Timmins", aliases: ["timmins"] },
  { column: "Kenora", label: "Kenora", aliases: ["kenora"] },
  { column: "Parry Sound", label: "Parry Sound", aliases: ["parry sound"] },
  { column: "Ontario Average", label: "Ontario", aliases: ["ontario", "ontario average", "province of ontario", "provincial average", "moyenne provinciale"] },
  { column: "Southern Average", label: "Southern Ontario", aliases: ["southern ontario", "south ontario", "southern average", "southern"] },
  { column: "Northern Average", label: "Northern Ontario", aliases: ["northern ontario", "north ontario", "northern average", "northern"] },
];

/** The market a place name means, or null. "Ontario, Canada" and "Windsor, ON" are understood. */
export function findMarket(asked: string): Market | null {
  const raw = asked.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const plain = raw.replace(/[^a-z0-9]+/g, " ").trim();
  const stripped = plain.replace(/\s+(ontario|on|canada|ca)(\s+(canada|ca))?$/, "").trim();
  for (const m of MARKETS) {
    if (m.aliases.some((a) => a === plain || a === stripped)) return m;
  }
  return null;
}

/** True when the name is a market only this source answers (not one of Statistics Canada's cities), so the registry routes it here. */
export function isOntarioOnlyPlace(asked: string): boolean {
  const m = findMarket(asked);
  return m !== null && !m.statcan;
}

// ---------- fuels ----------

export type FuelKey = "petrol95" | "petrol98" | "diesel" | "propane" | "methane";
const FUEL_LABEL: Record<FuelKey, string> = {
  petrol95: "regular unleaded gasoline",
  petrol98: "premium unleaded gasoline",
  diesel: "diesel",
  propane: "propane",
  methane: "compressed natural gas (CNG)",
};

/** Which of our fuels a "Fuel Type" cell is (the file's English name), or null for a type we do not use. */
export function classifyFuel(name: string): FuelKey | null {
  const n = name.toLowerCase();
  if (/diesel/.test(n)) return "diesel";
  if (/propane/.test(n)) return "propane";
  if (/natural gas|\bcng\b/.test(n)) return "methane";
  if (/premium/.test(n) && /(gasoline|unleaded|gas)/.test(n)) return "petrol98";
  if (/regular/.test(n) && /(gasoline|unleaded|gas)/.test(n)) return "petrol95";
  return null;
}

// ---------- parsing ----------

export interface Row {
  date: string; // YYYY-MM-DD (the Monday of the survey week)
  fuelType: string; // the file's English name, e.g. "Regular Unleaded Gasoline"
  fuel: FuelKey | null;
  cents: Record<string, number>; // market column -> cents per litre (0 / missing dropped)
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

/** Market column name from a header cell: "Toronto West/Ouest" -> "Toronto West", "Ontario Average/Moyenne provinciale" -> "Ontario Average". */
const columnName = (h: string) => h.split("/")[0].trim();

/** Every survey row, oldest first. Throws SourceError when the layout is not the one we know. */
export function parseSurvey(text: string): Row[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  const head = lines.length ? splitLine(lines[0]).map((h) => h.trim()) : [];
  const iDate = head.findIndex((h) => h.toLowerCase() === "date");
  const iType = head.findIndex((h) => h.toLowerCase().startsWith("fuel type"));
  if (iDate < 0 || iType < 0) {
    throw new SourceError("Ontario changed the layout of the fuels price survey file (expected Date and Fuel Type columns); this source needs updating.");
  }
  // header cell -> our market column
  const cols: { index: number; column: string }[] = [];
  head.forEach((h, index) => {
    const base = columnName(h);
    const m = MARKETS.find((x) => x.column.toLowerCase() === base.toLowerCase() || base.toLowerCase().startsWith(x.column.toLowerCase()));
    if (m && index !== iDate && index !== iType) cols.push({ index, column: m.column });
  });
  if (cols.length < 10) {
    throw new SourceError("Ontario changed the market columns of the fuels price survey file; this source needs updating.");
  }
  const out: Row[] = [];
  for (const l of lines.slice(1)) {
    const c = splitLine(l);
    const date = (c[iDate] ?? "").trim();
    const fuelType = (c[iType] ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !fuelType) continue;
    const cents: Record<string, number> = {};
    for (const { index, column } of cols) {
      const v = Number(c[index]);
      if (Number.isFinite(v) && v > 0 && !(column in cents)) cents[column] = v;
    }
    out.push({ date, fuelType, fuel: classifyFuel(fuelType), cents });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// ---------- answer ----------

const dollars = (c: number) => Math.round(c * 10) / 1000; // cents -> dollars, 0.1 cent
const cad = (d: number) => `$${d.toFixed(3)}`;

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(a + "T00:00:00Z") - Date.parse(b + "T00:00:00Z")) / 86400000);
}

export interface Change {
  from: string;
  value: number;
  absolute: number;
  percent: number;
}

/** The figure for the same market and fuel closest to `days` days before `date` (within 4 days), as a change. */
export function changeFrom(rows: Row[], column: string, date: string, cents: number, days: number): Change | null {
  let best: Row | null = null;
  for (const r of rows) {
    if (r.date >= date || !(column in r.cents)) continue;
    const gap = Math.abs(daysBetween(date, r.date) - days);
    if (gap <= 4 && (!best || gap < Math.abs(daysBetween(date, best.date) - days))) best = r;
  }
  if (!best) return null;
  const was = best.cents[column];
  return {
    from: best.date,
    value: dollars(was),
    absolute: Math.round((cents - was) * 10) / 1000,
    percent: Math.round(((cents - was) / was) * 1000) / 10,
  };
}

const move = (c: Change | null, what: string) =>
  c ? `${c.percent > 0 ? "up" : c.percent < 0 ? "down" : "unchanged"}${c.percent === 0 ? "" : ` ${Math.abs(c.percent)}%`} on ${what} (${cad(c.value)} on ${c.from})` : `no figure for ${what}`;

export interface OnFuelInput {
  fuel?: string;
  town?: string;
  area?: string;
  postcode?: string;
  service?: string;
  baseUrl?: string;
}

export const METHOD =
  "Ontario fuel: the Ontario Ministry of Energy's weekly Fuels Price Survey, the average retail price per litre in the market asked about (or the Ontario average), shown in Canadian dollars, for the newest week that market has a price, " +
  "with the change on the week before and on the same week a year earlier. A posted pump price average for a market, not what each driver paid; no range or sample size is published.";

/** A market that has no price in the newest 5 weeks of this fuel is treated as not surveyed any more. */
const MAX_AGE_DAYS = 35;

export function answerFromRows(rows: Row[], input: OnFuelInput): PriceAnswer {
  const fuel = (input.fuel ?? "") as FuelKey;
  if (!(fuel in FUEL_LABEL)) {
    throw new InputError("Ontario: fuel must be petrol95 (regular unleaded), petrol98 (premium unleaded), diesel, propane or methane (CNG). E10, E85, LPG and heating oil are not published.");
  }
  if (input.service && input.service.toLowerCase() !== "self") {
    throw new InputError("Ontario: the survey does not separate self and full service. Leave service out.");
  }
  const asked = (input.town ?? input.area ?? "").trim();
  if (!asked && input.postcode) throw new InputError("Ontario: postcodes are not used. Give a market (town), for example Windsor, London or Sudbury, or leave it out for the Ontario average.");
  const market = asked ? findMarket(asked) : MARKETS.find((m) => m.column === "Ontario Average");
  if (!market) {
    throw new InputError(
      `Ontario: '${asked}' is not one of the markets in the Ontario Fuels Price Survey. Use one of: ${MARKETS.filter((m) => !m.statcan).map((m) => m.label).join(", ")}. Ottawa and Thunder Bay come from Statistics Canada, and 'Toronto' on its own is answered by Statistics Canada.`,
    );
  }
  const mine = rows.filter((r) => r.fuel === fuel);
  if (mine.length === 0) {
    const seen = [...new Set(rows.map((r) => r.fuelType))].join(", ");
    throw new SourceError(`The Ontario file has no rows for ${FUEL_LABEL[fuel]} (fuel types found: ${seen || "none"}); this source needs updating.`);
  }
  const newestAny = mine[mine.length - 1].date;
  const latest = [...mine].reverse().find((r) => market.column in r.cents);
  const query = { country: "CA", region: "Ontario", fuel, town: market.label };
  const stale = !latest || daysBetween(newestAny, latest.date) > MAX_AGE_DAYS;
  if (!latest || stale) {
    return buildStatisticAnswer({
      source: INFO, query, value: null, measure: "average", currency: "CAD", unit: "per litre",
      period: { from: null, to: null }, reference_period: "n/a", method: METHOD, describe: () => "", baseUrl: input.baseUrl,
      note: `${market.label} has no price in the Ontario survey for ${FUEL_LABEL[fuel]} in the last 5 weeks (newest survey week ${newestAny}).`,
    });
  }
  const cents = latest.cents[market.column];
  const value = dollars(cents);
  const week = changeFrom(mine, market.column, latest.date, cents, 7);
  const year = changeFrom(mine, market.column, latest.date, cents, 364);
  const provincial = latest.cents["Ontario Average"];
  const sameWeek = rows.filter((r) => r.date === latest.date);
  const others: Record<string, number> = {};
  for (const k of Object.keys(FUEL_LABEL) as FuelKey[]) {
    if (k === fuel) continue;
    const r = sameWeek.find((x) => x.fuel === k && market.column in x.cents);
    if (r) others[`${k}_cad_per_litre`] = dollars(r.cents[market.column]);
  }
  const notes = [
    fuel === "methane" ? "CNG is priced per litre of gasoline equivalent." : "",
    fuel === "petrol98" ? "Premium unleaded as the survey reports it." : "",
    latest.date !== newestAny ? `${market.label} was not surveyed in the newest week (${newestAny}); this is its latest price.` : "",
  ].filter(Boolean);
  return buildStatisticAnswer({
    source: INFO,
    query,
    value,
    measure: "average",
    currency: "CAD",
    unit: "per litre",
    period: { from: latest.date, to: latest.date },
    reference_period: `week of ${latest.date}`,
    method: METHOD,
    note: notes.join(" ") || undefined,
    describe: (v) =>
      `The average pump price of ${FUEL_LABEL[fuel]} in ${/Ontario/.test(market.label) ? market.label : `${market.label}, Ontario`} was ${cad(v)} CAD per litre in the survey week of ${latest.date}, ` +
      `${move(week, "the week before")} and ${move(year, "a year earlier")}.`,
    baseUrl: input.baseUrl,
    extra: {
      survey_week: latest.date,
      market: market.label,
      change_on_week: week,
      change_on_year: year,
      ...(typeof provincial === "number" && market.column !== "Ontario Average" ? { ontario_average_cad_per_litre: dollars(provincial) } : {}),
      other_fuels_same_market: others,
    },
  });
}

async function fetchText(url: string, timeoutMs = 25000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: "follow", headers: { "user-agent": "pricepaid-plug/0.1 (+https://proofprice.com)" } });
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

export async function onFuelNow(input: OnFuelInput, fetcher: (url: string) => Promise<string> = fetchText): Promise<PriceAnswer> {
  return answerFromRows(parseSurvey(await fetcher(CSV_URL)), input);
}

// ---------- library copy (harvest) and its key ----------

const FUEL_ORDER: FuelKey[] = ["petrol95", "petrol98", "diesel", "propane", "methane"];

/** Pure: one library row per market and fuel for the newest survey week that holds any price. Each row is a published average (n is NO_COUNT). */
export function harvestFromRows(rows: Row[]): HarvestResult {
  const usable = rows.filter((r) => r.fuel !== null && Object.keys(r.cents).length > 0);
  if (!usable.length) throw new SourceError("The Ontario fuels price survey file holds no usable prices; this source needs updating.");
  const date = usable[usable.length - 1].date;
  const out: HarvestResult["rows"] = [];
  for (const r of usable.filter((x) => x.date === date)) {
    for (const m of MARKETS) {
      if (m.statcan) continue; // Ottawa and Thunder Bay are answered by Statistics Canada
      const c = r.cents[m.column];
      if (typeof c !== "number") continue;
      const v = dollars(c);
      out.push({ area: m.label, item: r.fuel!, n: NO_COUNT, median: v, low: v, high: v, min: v, max: v });
    }
  }
  return {
    date,
    currency: "CAD",
    unit: "per litre",
    rows: out,
    note: `Ontario Ministry of Energy Fuels Price Survey, week of ${date}: average retail price per litre in each Ontario market. Published averages, not counts of records (no record count is published).`,
  };
}

export async function onFuelHarvest(fetcher: (url: string) => Promise<string> = fetchText): Promise<HarvestResult> {
  return harvestFromRows(parseSurvey(await fetcher(CSV_URL)));
}

/** Where a request lives in the library: the market's label and the fuel. Null for an unknown fuel or market. */
export function onFuelHistoryKey(p: { fuel?: string; town?: string; area?: string }): { area: string; item: string; label: string } | null {
  if (!FUEL_ORDER.includes(p.fuel as FuelKey)) return null;
  const asked = (p.town ?? p.area ?? "").trim();
  const m = asked ? findMarket(asked) : MARKETS.find((x) => x.column === "Ontario Average");
  if (!m) return null;
  return { area: m.label, item: p.fuel!, label: /Ontario/.test(m.label) ? m.label : `${m.label}, Ontario` };
}
