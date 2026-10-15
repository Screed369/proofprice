// Ireland: the Home Renovation Incentive (HRI), Revenue's tax credit for work on homes. Revenue publishes statistics on data.gov.ie
// (licence Creative Commons Attribution 4.0). Format checked live on 2026-10-15:
//  - https://data.gov.ie/api/3/action/package_show?id=home-renovation-incentive-statistics: license_id "CC-BY-4.0", publisher Revenue Commissioners,
//    resources are CSV files under https://www.revenue.ie/en/corporate/documents/statistics/tax-expenditures/ .
//  - breakdown-by-local-authority.csv (UTF-8 with a byte-order mark): "year,local_authority,no_of_properties,no_of_works,estimated_value_of_works_euro_m",
//    31 local authorities per year; the years are 2013/2014, 2015, 2016, 2017 and 2018/19 (newest year first in the file). The newest year in this
//    table is 2018/19: the table has not been updated since, which the answer states through its period (data_as_of, data_age_days).
// What a figure is: the value of work that claimants declared to Revenue when claiming the credit (the "estimated value of works"), summed per
// local authority. We divide by the published number of properties. That is a declared value of works at claim, not a receipt, and the HRI
// is not split by type of work: it covers any qualifying repair, renovation or improvement (insulation, windows, heating and more).

import { InputError, SourceError } from "../../lib/http";
import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { downloadFile } from "../../lib/gov-uk";
import { readLatestDay } from "../../lib/library/store";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";

export const CSV_URL = "https://www.revenue.ie/en/corporate/documents/statistics/tax-expenditures/breakdown-by-local-authority.csv";
export const HOMEPAGE = "https://data.gov.ie/dataset/home-renovation-incentive-statistics";

export const INFO: SourceInfo = {
  id: "ie-revenue-hri",
  country: "IE (Ireland)",
  category: "home upgrades (declared renovation works)",
  name: "Home Renovation Incentive statistics: breakdown by local authority",
  publisher: "Revenue Commissioners (Ireland), via data.gov.ie",
  what_is_recorded:
    "For each local authority and year: the number of properties and works claimed under the Home Renovation Incentive and the estimated value of the works that claimants declared to Revenue, in millions of euro.",
  price_type: "official_statistic",
  freshness: "Irregular; the local-authority table currently ends with 2018/19",
  licence: "Creative Commons Attribution 4.0 International (CC BY 4.0), as stated on data.gov.ie",
  licence_url: "https://creativecommons.org/licenses/by/4.0/",
  attribution: "Source: Revenue Commissioners, Home Renovation Incentive statistics (data.gov.ie), licensed under CC BY 4.0. Average value per property calculated by ProofPrice from the published totals.",
  homepage: HOMEPAGE,
  limits:
    "Not split by type of work: the Home Renovation Incentive covers any qualifying repair, renovation or improvement, so this is not a heat pump, solar or insulation price. It is the value of works declared when claiming a tax credit (the work had to cost at least €4,405 before VAT), not a receipt or a quote. The table is by local authority and year; its newest year is 2018/19, so the figure is old. We divide the published value by the published number of properties; Revenue does not publish an average itself in this table.",
};

export interface HriRow { year: string; authority: string; properties: number; works: number; valueM: number }

/** Minimal CSV line reader (handles quoted fields, no embedded newlines needed for this file). */
function csvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { out.push(cur); cur = ""; } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export function parseHri(text: string): HriRow[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  const head = csvLine(lines[0] ?? "").map((h) => h.toLowerCase());
  const want = ["year", "local_authority", "no_of_properties", "no_of_works", "estimated_value_of_works_euro_m"];
  if (want.some((w, i) => head[i] !== w)) throw new SourceError("The Revenue HRI table has different columns than expected; this source needs updating.");
  const rows: HriRow[] = [];
  for (const l of lines.slice(1)) {
    const f = csvLine(l);
    const [properties, works, valueM] = [Number(f[2]), Number(f[3]), Number(f[4])];
    if (!f[0] || !f[1] || ![properties, works, valueM].every((x) => Number.isFinite(x) && x > 0)) continue;
    rows.push({ year: f[0], authority: f[1], properties, works, valueM });
  }
  if (rows.length < 20) throw new SourceError("The Revenue HRI table has too few rows; this source needs updating.");
  return rows;
}

/** "2018/19" is 2018 and 2019; "2015" is 2015. Returns the first and last year, or null. */
export function yearSpan(label: string): { from: number; to: number } | null {
  const m = /^(\d{4})(?:\/(\d{2}|\d{4}))?$/.exec(label.trim());
  if (!m) return null;
  const from = Number(m[1]);
  const to = !m[2] ? from : m[2].length === 2 ? Math.floor(from / 100) * 100 + Number(m[2]) : Number(m[2]);
  return to >= from ? { from, to } : null;
}

export function periodOf(label: string): { from: string; to: string } {
  const s = yearSpan(label);
  if (!s) throw new SourceError(`Unexpected year "${label}"; this source needs updating.`);
  return { from: `${s.from}-01-01`, to: `${s.to}-12-31` };
}

export function latestYear(rows: HriRow[]): string {
  const years = [...new Set(rows.map((r) => r.year))].filter((y) => yearSpan(y));
  if (!years.length) throw new SourceError("The Revenue HRI table has no readable year; this source needs updating.");
  return years.reduce((a, b) => (yearSpan(b)!.to > yearSpan(a)!.to ? b : a));
}

// ---------- areas ----------

/** Counties made of several local authorities in the table. */
export const COUNTIES: Record<string, string[]> = {
  dublin: ["Dublin City", "DLR", "Fingal", "South Dublin"],
  cork: ["Cork City", "Cork County"],
  galway: ["Galway City", "Galway County"],
};
const ALIASES: Record<string, string> = {
  "dun laoghaire": "dlr", "dun laoghaire rathdown": "dlr", "dún laoghaire-rathdown": "dlr", "dun laoghaire-rathdown": "dlr", dlr: "dlr",
  "south dublin": "south dublin", "dublin city": "dublin city", fingal: "fingal", "cork city": "cork city", "cork county": "cork county", "galway city": "galway city", "galway county": "galway county",
  ireland: "", "republic of ireland": "", national: "", all: "",
};
const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/^(co\.?|county)\s+/, "").replace(/\s+/g, " ").trim();

/** The local authorities an area text stands for: [] means all of Ireland. Throws InputError for an unknown place. */
export function authoritiesFor(area: string | undefined, known: string[]): string[] {
  const t = fold(area ?? "");
  if (t === "" || ALIASES[t] === "") return [];
  const key = ALIASES[t] ?? t;
  if (COUNTIES[key]) return COUNTIES[key].filter((a) => known.includes(a));
  const hit = known.find((k) => fold(k) === key);
  if (!hit) throw new InputError(`area "${area}" is not a county or local authority in the Revenue table. Use a county (e.g. Kerry, Cork, Dublin) or leave it out for all of Ireland.`);
  return [hit];
}

// ---------- library ----------

/** Library rows: one per authority and item. Items are "properties/<year>", "works/<year>" (counts) and "value_m/<year>" (euro millions), all with
 *  n = the number of properties; the year label is kept in the item because the library's date is only the last day of the last year. */
export function hriRows(rows: HriRow[], year: string): DailyRow[] {
  const out: DailyRow[] = [];
  for (const r of rows.filter((x) => x.year === year)) {
    for (const [item, v] of [["properties", r.properties], ["works", r.works], ["value_m", r.valueM]] as const) {
      out.push({ area: r.authority, item: `${item}/${year}`, n: r.properties, median: v, low: v, high: v, min: v, max: v });
    }
  }
  return out;
}

export function rowsFromLibrary(lib: { date: string; rows: DailyRow[] }): { year: string; rows: HriRow[] } {
  const by = new Map<string, Partial<HriRow>>();
  let year = "";
  for (const r of lib.rows) {
    const [kind, ...rest] = r.item.split("/");
    year = rest.join("/") || year;
    const e = by.get(r.area) ?? { authority: r.area };
    if (kind === "properties") e.properties = r.median;
    if (kind === "works") e.works = r.median;
    if (kind === "value_m") e.valueM = r.median;
    by.set(r.area, e);
  }
  if (!year) throw new SourceError("Our copy of the Revenue HRI table has no year; the next collection will fix it.");
  const rows = [...by.values()].filter((e): e is HriRow => !!e.properties && !!e.works && !!e.valueM).map((e) => ({ ...e, year }) as HriRow);
  return { year, rows };
}

export async function loadHri(): Promise<{ year: string; rows: HriRow[] }> {
  const buf = await downloadFile(CSV_URL, 2_000_000);
  const all = parseHri(buf.toString("utf8"));
  const year = latestYear(all);
  return { year, rows: all.filter((r) => r.year === year) };
}

export async function hriHarvest(): Promise<HarvestResult> {
  const { year, rows } = await loadHri();
  return {
    date: periodOf(year).to,
    currency: "EUR",
    unit: "per property",
    rows: hriRows(rows, year),
    note: `Revenue Home Renovation Incentive, ${year}: counts of properties and works and the declared value of works (EUR millions) per local authority. n is the published number of properties.`,
  };
}

// ---------- answering ----------

export interface HriInput { area?: string; baseUrl?: string }

export function hriAnswer(year: string, rows: HriRow[], measure: string, input: HriInput): PriceAnswer {
  const per = periodOf(year);
  const query = { country: "IE", measure, area: input.area };
  const place = (input.area ?? "").trim() || "Ireland";
  if (measure !== "renovation") {
    const a = buildStatisticAnswer({
      source: INFO, query, value: null, measure: "average", currency: "EUR", unit: "per property", period: per, reference_period: year,
      method: "No figure: the Home Renovation Incentive statistics are not split by type of work.", describe: () => "", baseUrl: input.baseUrl,
      extra: { reason: "not_split_by_measure", detail: "Ask with measure renovation for the Home Renovation Incentive average (all qualifying work). SEAI grant figures for heat pumps, solar and insulation are not included yet." },
    });
    a.summary = `The Irish Home Renovation Incentive statistics are not split by type of work, so there is no ${measure.replace(/_/g, " ")} figure. Ask with measure "renovation" for the average declared value of all qualifying works.`;
    return a;
  }
  const names = authoritiesFor(input.area, rows.map((r) => r.authority));
  const chosen = names.length ? rows.filter((r) => names.includes(r.authority)) : rows;
  const properties = chosen.reduce((s, r) => s + r.properties, 0);
  const works = chosen.reduce((s, r) => s + r.works, 0);
  const valueEur = chosen.reduce((s, r) => s + r.valueM, 0) * 1_000_000;
  const value = properties > 0 ? Math.round(valueEur / properties) : null;
  const perWork = works > 0 ? Math.round(valueEur / works) : null;
  return buildStatisticAnswer({
    source: INFO,
    query,
    value,
    measure: "average",
    currency: "EUR",
    unit: "per property",
    period: per,
    reference_period: year,
    sample_size: properties || null,
    method:
      `Revenue publishes, per local authority and year, the number of properties and works claimed under the Home Renovation Incentive and the estimated value of the works that claimants declared. ` +
      `We add up the authorities for ${place} for ${year} and divide the declared value by the number of properties. It is the declared value of works at claim, not a receipt or a quote, and not split by type of work.`,
    describe: (v) =>
      `Average value of work declared per property under Ireland's Home Renovation Incentive in ${place}: ${fmtMoney(v, "EUR")} (all qualifying repair, renovation and improvement work, not one type), ` +
      `across ${properties.toLocaleString("en-GB")} properties in ${year}.`,
    note: "Declared value of works at tax-credit claim; the newest year in this table is old. Not split by type of work.",
    baseUrl: input.baseUrl,
    extra: {
      price_basis: "declared value of works at Home Renovation Incentive claim, not a receipt or a quote",
      works_claimed: works,
      average_per_work: perWork,
      total_declared_value_eur: Math.round(valueEur),
      years_covered: year,
      authorities: chosen.map((r) => r.authority),
      not_split_by_type: "The HRI covers any qualifying work, so this is not a heat pump, solar or insulation price.",
      seai: "SEAI grant and cost figures are not included yet.",
    },
  });
}

export async function ieHri(measure: string, input: HriInput): Promise<PriceAnswer> {
  const lib = readLatestDay(INFO.id);
  const data = lib ? rowsFromLibrary(lib) : await loadHri();
  return hriAnswer(data.year, data.rows, measure, input);
}
