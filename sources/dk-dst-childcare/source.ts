// Denmark childcare fees from Statistics Denmark (Danmarks Statistik), StatBank table RES88 "Yearly rates of child-care by region, type of
// measure and time" (Takster for børnepasning). Posted yearly parental rates set by each municipality, DKK per year, 2007 onwards.
// Format checked live on 2026-11-04 (GET api.statbank.dk/v1/data/RES88/JSONSTAT from the build workspace, see fixtures/res88.json; the same
// cells as CSV are in fixtures/res88.csv and the metadata in fixtures/tableinfo.json). Suppressed cells are ".." (null in the cube).
import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import { resolveFetcher, rowsWhere } from "../../lib/adapters";
import type { FetchOptions, JsonStatTable } from "../../lib/adapters";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { NO_COUNT } from "../../lib/stats";
import { DST_API, parseStatbank } from "../dk-home-prices/source";

export const TABLE = "RES88";

export const INFO: SourceInfo = {
  id: "dk-dst-childcare",
  country: "DK (Denmark)",
  category: "childcare (official posted municipal day-care rates)",
  name: "Yearly rates of child-care by municipality (Statistics Denmark, StatBank table RES88, Takster for børnepasning)",
  publisher: "Statistics Denmark (Danmarks Statistik)",
  what_is_recorded:
    "For All Denmark and each of the 98 municipalities, and each year from 2007: the yearly parental rate (DKK per child place per year) for nursery (0-2), kindergarten (3-5), school-care schemes (6-9) and municipal day-care in a childminder's home (0-2 and 3-5, including lunch). " +
    "The rate each municipality sets for a full-time place, as published by Statistics Denmark. One published figure per cell; never individual families.",
  price_type: "official_statistic",
  freshness: "Annual; the 2026 rates were published on 8 April 2026. Each answer states its year.",
  licence: "Statistics Denmark: free re-use including commercial, source credit required (equivalent to CC BY 4.0)",
  licence_url: "https://www.dst.dk/en/presse/kildeangivelse",
  attribution: "Source: Statistics Denmark - StatBank.dk/RES88. Own calculations based on data from Statistics Denmark where ProofPrice has processed the figure.",
  homepage: "https://www.dst.dk/da/Statistik/dokumentation/statistikdokumentation/takster-for-boernepasning",
  limits:
    "A posted municipal rate, not what parents paid: the municipalities set the rates, and the amount a family pays is often lower (sibling and income-based reductions) and is not in this table. " +
    "No sample size (one published rate per municipality and arrangement). Some cells are suppressed by the publisher (for example day-care for 3 to 5 year olds in Copenhagen); the answer then says so. Rates before public subsidy changes are not adjusted. Logo use is not permitted.",
};

const D_AREA = "OMRÅDE";
const D_KIND = "INSTITUTION";
const D_YEAR = "Tid";
/** The five arrangements we read (all others in the table are out of scope or are lunch-only rates). */
export const KINDS = ["F03", "F47", "F48", "F50", "F55"] as const;

export interface Kind {
  code: (typeof KINDS)[number];
  item: string;
  words: string;
}
const KIND_BY_CODE: Record<string, Kind> = {
  F03: { code: "F03", item: "nursery", words: "a nursery place (vuggestue, age 0-2)" },
  F47: { code: "F47", item: "home-0-2", words: "municipal day-care in a childminder's home (dagpleje, age 0-2, lunch included)" },
  F48: { code: "F48", item: "home-3-5", words: "municipal day-care in a childminder's home (dagpleje, age 3-5, lunch included)" },
  F50: { code: "F50", item: "kindergarten", words: "a kindergarten place (børnehave, age 3-5)" },
  F55: { code: "F55", item: "school-care", words: "a school-care place (SFO, age 6-9)" },
};

/** Which table row answers the question. Infant and toddler are both "0-2" in Danish rates. Default: nursery (age 0-2). */
export function pickKind(age?: string, care?: string): Kind {
  const home = care === "home-based" || care === "childminder";
  const a = age === "preschool" ? "3-5" : age === "school-age" ? "6-9" : "0-2";
  if (a === "6-9") {
    if (home) throw new InputError("Denmark publishes no childminder rate for school-age children, only school-care schemes (SFO). Leave out care_type, or ask for age_group infant, toddler or preschool.");
    return KIND_BY_CODE.F55;
  }
  if (a === "3-5") return home ? KIND_BY_CODE.F48 : KIND_BY_CODE.F50;
  return home ? KIND_BY_CODE.F47 : KIND_BY_CODE.F03;
}

export function norm(s: string): string {
  return s
    .replace(/æ/gi, "ae").replace(/ø/gi, "o").replace(/å/gi, "aa")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[.,'’]/g, "").replace(/\s+/g, " ").trim();
}

const NATIONAL = new Set(["denmark", "danmark", "all denmark", "whole country", "the whole country", "national", "nationwide", "all", "dk"]);
/** Danish and alternative spellings of English labels in the cube (after norm()). */
const ALIASES: Record<string, string> = {
  kobenhavn: "101", copenhagen: "101", "kobenhavns kommune": "101",
  aarhus: "751", arhus: "751", "aarhus kommune": "751",
  aalborg: "851", alborg: "851", "aalborg kommune": "851",
  "frederiksberg kommune": "147", "odense kommune": "461",
};

export function parseTable(json: unknown): JsonStatTable {
  const t = parseStatbank(json);
  if (!t.codes[D_AREA] || !t.codes[D_KIND] || !t.codes[D_YEAR]) {
    throw new SourceError("Statistics Denmark changed the layout of table RES88; this source needs updating.");
  }
  for (const k of KINDS) if (!t.codes[D_KIND].includes(k)) throw new SourceError("Statistics Denmark changed the arrangements in table RES88; this source needs updating.");
  return t;
}

export function dataUrl(base = DST_API): string {
  return `${base}/data/${TABLE}/JSONSTAT?lang=en&OMR%C3%85DE=*&INSTITUTION=${KINDS.join(",")}&Tid=*`;
}

export function matchArea(table: JsonStatTable, input?: string): { code: string; label: string } {
  const q = norm(input ?? "");
  const labels = table.labels[D_AREA];
  if (!q || NATIONAL.has(q)) return { code: "000", label: "All Denmark" };
  const codes = table.codes[D_AREA].filter((c) => c !== "000");
  let hit = ALIASES[q] && codes.includes(ALIASES[q]) ? [ALIASES[q]] : codes.filter((c) => norm(labels[c] ?? c) === q || norm(labels[c] ?? c) + " kommune" === q);
  if (!hit.length && /^\d{3}$/.test(q) && codes.includes(q)) hit = [q];
  if (!hit.length && q.length >= 4) hit = codes.filter((c) => norm(labels[c] ?? c).startsWith(q));
  if (hit.length > 1) throw new InputError(`'${input}' matches several Danish municipalities: ${hit.slice(0, 6).map((c) => labels[c]).join(", ")}. Give the full municipality name.`);
  if (!hit.length) {
    throw new InputError("Give a Danish municipality such as Copenhagen (København), Aarhus, Odense, Aalborg, Frederiksberg or Esbjerg, or leave out area for All Denmark.");
  }
  return { code: hit[0], label: labels[hit[0]] ?? hit[0] };
}

export interface Pick {
  year: string;
  value: number;
  previous: { year: string; value: number } | null;
  yearEarlier: { year: string; value: number } | null;
  tableLatestYear: string;
}

/** Newest year in which the area has a published (not suppressed) rate for the arrangement. */
export function pickLatest(table: JsonStatTable, area: string, kind: string): Pick | null {
  const byYear = new Map<string, number>();
  for (const r of rowsWhere(table, { [D_AREA]: area, [D_KIND]: kind })) {
    if (r.value !== null && r.value > 0) byYear.set(String(r[D_YEAR]), r.value);
  }
  const years = [...byYear.keys()].sort();
  if (!years.length) return null;
  const year = years[years.length - 1];
  const prevYear = String(Number(year) - 1);
  const tableLatestYear = [...table.codes[D_YEAR]].sort().slice(-1)[0];
  // A municipality that stopped publishing this arrangement is not answered with an old rate: at most one year behind the table.
  if (Number(tableLatestYear) - Number(year) > 1) return null;
  return {
    year,
    value: byYear.get(year)!,
    previous: byYear.has(prevYear) ? { year: prevYear, value: byYear.get(prevYear)! } : null,
    yearEarlier: null,
    tableLatestYear,
  };
}

const pct = (a: number, b: number) => Math.round(((a - b) / b) * 1000) / 10;

export interface DkChildcareInput {
  area?: string;
  age_group?: string;
  care_type?: string;
  baseUrl?: string;
}

export async function dkChildcare(input: DkChildcareInput, o: FetchOptions & { apiBase?: string } = {}): Promise<PriceAnswer> {
  const kind = pickKind(input.age_group, input.care_type);
  const table = parseTable(await resolveFetcher(o)(dataUrl(o.apiBase)));
  const area = matchArea(table, input.area);
  const pick = pickLatest(table, area.code, kind.code);
  const place = area.code === "000" ? "Denmark" : area.label;

  const others: Record<string, number | null> = {};
  for (const k of KINDS) {
    const p = pickLatest(table, area.code, k);
    others[KIND_BY_CODE[k].item] = p && pick && p.year === pick.year ? p.value : null;
  }
  const stale = pick && pick.year !== pick.tableLatestYear ? ` The newest year in the table is ${pick.tableLatestYear}, but ${area.label} has no published rate for this arrangement after ${pick.year}.` : "";

  return buildStatisticAnswer({
    source: INFO,
    query: { country: "DK", area: place, arrangement: kind.item },
    value: pick ? pick.value : null,
    measure: "average",
    currency: "DKK",
    unit: "per year",
    period: pick ? { from: `${pick.year}-01-01`, to: `${pick.year}-12-31` } : { from: null, to: null },
    reference_period: pick ? pick.year : "",
    method:
      "Denmark (Statistics Denmark, StatBank table RES88, Takster for børnepasning): the yearly parental rate for a full-time place that the municipality (or, for All Denmark, the national average of the municipalities) sets for the chosen arrangement, DKK per child per year. We pass on the published figure and its year; it is a posted rate, not a range and not what each family paid.",
    describe: (v) => `In ${pick!.year}, the posted yearly parental rate for ${kind.words} in ${place} was ${fmtMoney(v, "DKK")} per year.${stale}`,
    note: pick
      ? `Posted municipal rate before sibling and income-based reductions, so families often pay less than this.${stale}`
      : `Statistics Denmark publishes no rate for ${kind.words} in ${area.label} (the cell is suppressed or the municipality has no such arrangement). Try another age_group or care_type; ${Object.entries(others).filter(([, v]) => v !== null).map(([k]) => k).join(", ") || "no other arrangement is published for this municipality either"}.`,
    baseUrl: input.baseUrl,
    extra: {
      municipality: { name: area.label, statbank_code: area.code },
      arrangement: { code: kind.code, item: kind.item },
      ...(pick
        ? {
            per_month_if_12_equal_parts: Math.round(pick.value / 12),
            previous_year: pick.previous ? { year: pick.previous.year, value: pick.previous.value, change_percent: pct(pick.value, pick.previous.value) } : null,
            same_year_other_arrangements: others,
            table_updated: table.updated,
            fee_kind: "posted municipal yearly parental rate, DKK per child place per year, before reductions",
          }
        : {}),
    },
  });
}

// ---------- daily collector (stale-if-error copy and history) ----------
// One cube request; the newest year for All Denmark and the 21 largest municipalities, five arrangements. Dated by the first day of the
// rate year (referenceDates); n = NO_COUNT (one published rate, not a record sample).

/** All Denmark plus the municipalities that ask most often; others are answered live only. */
export const HARVEST_AREAS = ["000", "101", "751", "461", "851", "147", "561", "730", "621", "615", "630", "265", "657", "740", "370", "607", "791", "259", "661", "330", "219", "540"];

export function harvestRows(table: JsonStatTable): HarvestResult {
  const year = [...table.codes[D_YEAR]].sort().slice(-1)[0];
  if (!year) throw new SourceError("Statistics Denmark returned no year of childcare rates to collect");
  const rows: DailyRow[] = [];
  for (const area of HARVEST_AREAS) {
    if (!table.codes[D_AREA].includes(area)) continue;
    for (const k of KINDS) {
      const r = rowsWhere(table, { [D_AREA]: area, [D_KIND]: k, [D_YEAR]: year })[0];
      if (!r || r.value === null || r.value <= 0) continue;
      const v = Math.round(r.value);
      rows.push({ area, item: KIND_BY_CODE[k].item, n: NO_COUNT, median: v, low: v, high: v, min: v, max: v });
    }
  }
  if (!rows.some((r) => r.area === "000")) throw new SourceError("Statistics Denmark returned no national childcare rate to collect");
  return {
    date: `${year}-01-01`,
    currency: "DKK",
    unit: "per year",
    rows,
    note: `Statistics Denmark table ${TABLE}: posted yearly parental rates for ${year}, ${rows.length} area/arrangement cells. Published rates, not counts of records.`,
  };
}

export async function dkChildcareHarvest(o: FetchOptions & { apiBase?: string } = {}): Promise<HarvestResult> {
  return harvestRows(parseTable(await resolveFetcher(o)(dataUrl(o.apiBase))));
}

export function dkChildcareHistoryKey(p: { area?: string; age_group?: string; care_type?: string }): { area: string; item: string; label: string } | null {
  try {
    const kind = pickKind(p.age_group, p.care_type);
    const q = norm(p.area ?? "");
    const code = !q || NATIONAL.has(q) ? "000" : ALIASES[q] ?? (/^\d{3}$/.test(q) ? q : null);
    if (!code || !HARVEST_AREAS.includes(code)) return null;
    return { area: code, item: kind.item, label: code === "000" ? "Denmark" : (p.area ?? code) };
  } catch {
    return null;
  }
}
