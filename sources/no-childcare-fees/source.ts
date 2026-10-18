// Norway: average monthly kindergarten (barnehage) payment per child by municipality, Statistics Norway table 11573
// "Average kindergarten fees. January (NOK), by region and year" (KOSTRA). Annual, January figures.
// Format checked live on 2026-10-18 from GitHub's servers (JSON-stat2; see fixtures/t11573.json: Oslo, whole country, Stavanger).
import { InputError, SourceError, fetchJson } from "../../lib/http";
import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { parseJsonStat, rowsWhere, JsonStatTable } from "../../lib/adapters";
import type { SourceInfo } from "../../lib/plugin";

export const INFO: SourceInfo = {
  id: "no-childcare-fees",
  country: "NO (Norway)",
  category: "childcare (official kindergarten fee statistics)",
  name: "Average kindergarten fees by municipality (Statistics Norway, table 11573)",
  publisher: "Statistics Norway (SSB), from the KOSTRA municipal reporting",
  what_is_recorded:
    "Average monthly parental payment per kindergarten place in January, in NOK, by municipality and for the whole country: the kindergarten price (free places counted as zero), food fees, additional fees and the sum of all three. A published average; SSB gives no number of children per cell.",
  price_type: "official_statistic",
  freshness: "Annual (January figures); the 2026 figures were published on 30 April 2026",
  licence: "Creative Commons Attribution 4.0 (CC BY 4.0), Statistics Norway",
  licence_url: "https://www.ssb.no/en/diverse/lisens",
  attribution: "Source: Statistics Norway (SSB), table 11573, Average kindergarten fees. Licensed under CC BY 4.0.",
  homepage: "https://www.ssb.no/en/statbank/table/11573",
  limits:
    "A municipal average per child, not a price list: no range and no sample size. Free places (for example from the 2026 price cap and income-based exemptions) pull the average down, so it is lower than the fee a parent without a discount pays. January only. Municipalities that merged or split have blank years.",
};

export const TABLE = "11573";
const BASE = `https://data.ssb.no/api/pxwebapi/v2/tables/${TABLE}/data?lang=en&outputFormat=json-stat2`;
/** All municipalities, the two contents we read, latest two years. A request must list Region, ContentsCode and Tid. */
export const URL_ALL = `${BASE}&valuecodes%5BTid%5D=top(2)&valuecodes%5BRegion%5D=*&valuecodes%5BContentsCode%5D=GjSnittMndBetaling,GjSnittMndBarnehage`;

const D_REGION = "Region";
const D_YEAR = "Tid";
const D_CONTENTS = "ContentsCode";
/** Monthly payment including free places, food fees and additional fees. */
export const C_TOTAL = "GjSnittMndBetaling";
/** Monthly kindergarten price only (free places counted as zero). */
export const C_PRICE = "GjSnittMndBarnehage";

function norm(s: string): string {
  return s
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/æ/gi, "ae").replace(/ø/gi, "o").replace(/å/gi, "a")
    .toLowerCase().replace(/[.,']/g, "").replace(/\s+/g, " ").trim();
}

const NATIONAL = new Set(["norway", "norge", "whole country", "the whole country", "national", "nationwide", "all", "norway total"]);

export function parseTable(json: unknown): JsonStatTable {
  const t = parseJsonStat(json);
  if (!t.codes[D_REGION] || !t.codes[D_YEAR] || !t.codes[D_CONTENTS]) {
    throw new SourceError("Statistics Norway changed the layout of table 11573; this source needs updating.");
  }
  for (const c of [C_TOTAL, C_PRICE]) {
    if (!t.codes[D_CONTENTS].includes(c)) throw new SourceError("Statistics Norway changed the measures in table 11573; this source needs updating.");
  }
  return t;
}

/** Newest year in which the region has the monthly-payment figure, with the year before when published. */
export function pickLatest(table: JsonStatTable, region: string) {
  const byYear = new Map<string, { total: number; price: number | null }>();
  for (const r of rowsWhere(table, { [D_REGION]: region, [D_CONTENTS]: C_TOTAL })) {
    if (r.value !== null && r.value > 0) byYear.set(String(r[D_YEAR]), { total: r.value, price: null });
  }
  for (const r of rowsWhere(table, { [D_REGION]: region, [D_CONTENTS]: C_PRICE })) {
    const e = byYear.get(String(r[D_YEAR]));
    if (e && r.value !== null) e.price = r.value;
  }
  const years = [...byYear.keys()].sort();
  if (!years.length) return null;
  const year = years[years.length - 1];
  const prevYear = String(Number(year) - 1);
  return { year, ...byYear.get(year)!, previous: byYear.has(prevYear) ? { year: prevYear, ...byYear.get(prevYear)! } : null };
}

/** Label such as "Oslo - Oslove" or "Karasjok - Karasjohka": the first part is the Norwegian name used by agents. */
function nameParts(label: string): string[] {
  return label.split(/\s+-\s+|\s*\/\s*/).map(norm).filter(Boolean);
}

export function matchRegion(table: JsonStatTable, input?: string): { code: string; label: string } {
  const q = norm(input ?? "");
  if (!q || NATIONAL.has(q)) return { code: "0", label: table.labels[D_REGION]["0"] ?? "The whole country" };
  const hasValue = (code: string) => pickLatest(table, code) !== null;
  const all = table.codes[D_REGION].filter((c) => c !== "0");
  const exact = all.filter((c) => nameParts(table.labels[D_REGION][c]).includes(q));
  let hits = exact.filter(hasValue);
  if (!hits.length && !exact.length && q.length >= 4) hits = all.filter((c) => nameParts(table.labels[D_REGION][c]).some((p) => p.includes(q)) && hasValue(c));
  if (hits.length > 1) {
    throw new InputError(`'${input}' matches several Norwegian municipalities: ${hits.slice(0, 6).map((c) => `${table.labels[D_REGION][c]} (${c})`).join(", ")}. Use the municipality name or number.`);
  }
  if (!hits.length && /^\d{4}$/.test(q) && table.codes[D_REGION].includes(q) && hasValue(q)) hits = [q];
  if (!hits.length) {
    throw new InputError(`'${input}' is not a Norwegian municipality with kindergarten fee figures. Give a municipality such as Oslo, Bergen, Trondheim, Stavanger or Tromso, or leave out area for the whole country.`);
  }
  return { code: hits[0], label: table.labels[D_REGION][hits[0]] };
}

export interface NoChildcareInput {
  area?: string;
  baseUrl?: string;
}

export async function noChildcare(input: NoChildcareInput, fetcher?: (url: string) => Promise<unknown>): Promise<PriceAnswer> {
  const get = fetcher ?? ((u: string) => fetchJson(u, {}, 25000));
  const table = parseTable(await get(URL_ALL));
  const region = matchRegion(table, input.area);
  const pick = pickLatest(table, region.code);
  const changePct = (a: number, b: number) => Math.round(((a - b) / b) * 1000) / 10;
  const place = region.code === "0" ? "Norway" : region.label;

  return buildStatisticAnswer({
    source: INFO,
    query: { country: "NO", area: place },
    value: pick ? pick.total : null,
    measure: "average",
    currency: "NOK",
    unit: "per month",
    period: pick ? { from: `${pick.year}-01-01`, to: `${pick.year}-01-31` } : { from: null, to: null },
    reference_period: pick ? `January ${pick.year}` : "",
    method:
      "Norway (Statistics Norway, table 11573, KOSTRA): the average monthly payment per kindergarten place in January, covering the kindergarten price, food fees and additional fees, with free places counted as zero. We pass on the published municipal (or national) average and its year; it is an average, not a range.",
    describe: (v) => `In January ${pick!.year}, parents in ${place} paid on average ${fmtMoney(v, "NOK")} per month per kindergarten place (all fees included, free places counted as zero).`,
    note: "Average over all children including free places and income-based discounts, so it is lower than the fee a parent without a discount pays. Fee caps cut national fees in 2026.",
    baseUrl: input.baseUrl,
    extra: pick
      ? {
          municipality: { name: region.label, ssb_code: region.code },
          kindergarten_price_only_per_month: pick.price,
          previous_year: pick.previous ? { year: pick.previous.year, value: pick.previous.total, change_percent: changePct(pick.total, pick.previous.total) } : null,
          table_updated: table.updated,
          fee_kind: "average monthly payment per place, January, free places counted as zero",
        }
      : undefined,
  });
}
