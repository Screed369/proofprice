// Great Britain: the cost of small-scale solar PV installations, from DESNZ's "Solar photovoltaic (PV) cost data" statistics.
// DESNZ takes the cost of every installation certified under the Microgeneration Certification Scheme (MCS) and publishes the
// median / mean cost per kW (pounds per kilowatt of Declared Net Capacity) by size band and financial year, with the number of
// installations behind each figure. Format checked live on 2026-10-15 (edition of 28 May 2026, financial year 2025/26):
//  - GET https://www.gov.uk/api/content/government/statistics/solar-pv-cost-data lists the attachments; the one titled
//    "Solar PV cost data: DNC basis (Excel)" is the workbook (about 136 kB).
//  - sheets "Annual table (DNC)": "Financial year | Number of installations included in analysis | ... | 0-4 kW - Number of installations
//    included in analysis | 0-4 kW: Median (£/kW) | 0-4 kW: Mean (£/kW) | Lower CI | Upper CI | 4-10 kW ... | 10-50 kW ...", one row per year.
//    "Domestic costs (DNC)" and "New build costs (DNC)": "Financial year | Installation Type | Number ... | All installations ...: Mean (£/kW) |
//    0-4 kW - Number | 0-4 kW: Mean (£/kW) | 4-10 kW ... | 10-50 kW ...", two or four rows per year.
// A figure is a published statistic, so the answer is an official statistic. The number of installations IS published, so it
// is the sample size and the library keeps it as n. Costs are what the installer declared on the MCS certificate: they include
// equipment, installation and connection (note 1 of the workbook), so they are "declared installed cost", not receipts.

import { InputError, SourceError } from "../../lib/http";
import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { govukContent, downloadFile, xlsxAttachments } from "../../lib/gov-uk";
import { readLatestDay } from "../../lib/library/store";
import { Cell, readXlsx, Sheet } from "../../categories/rent/xlsx";
import type { DailyRow, HarvestResult, Params, SourceInfo } from "../../lib/plugin";

export const PAGE_PATH = "/government/statistics/solar-pv-cost-data";
export const HOMEPAGE = "https://www.gov.uk/government/statistics/solar-pv-cost-data";

export const INFO: SourceInfo = {
  id: "gb-desnz-solar-cost",
  country: "GB (Great Britain)",
  category: "home upgrades (solar PV installed cost)",
  name: "Solar photovoltaic (PV) cost data",
  publisher: "Department for Energy Security and Net Zero (DESNZ)",
  what_is_recorded:
    "The cost per kilowatt of small-scale solar PV installations in Great Britain, as declared by the installer on the Microgeneration Certification Scheme (MCS) certificate (equipment, installation and connection): median by size band for all installations, and mean for domestic, non-domestic, new-build and retrofit installations, per financial year, with the number of installations behind each figure.",
  price_type: "official_statistic",
  freshness: "Yearly (published each May for the financial year just ended; April to March)",
  licence: "Open Government Licence v3.0 (GOV.UK: \"All content is available under the Open Government Licence v3.0, except where otherwise stated\"); Crown copyright",
  licence_url: "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/",
  attribution:
    "Contains public sector information licensed under the Open Government Licence v3.0. Source: Department for Energy Security and Net Zero, Solar photovoltaic (PV) cost data (installation costs from the Microgeneration Certification Scheme).",
  homepage: HOMEPAGE,
  limits:
    "Great Britain only (Northern Ireland is excluded by DESNZ), one national figure per size band and financial year: no regions or towns here. The cost is the installer's declared cost per kW of Declared Net Capacity from the MCS certificate (equipment, installation and connection, not adjusted for inflation), not a receipt or a quote, and covers small installations up to 50 kW. A system's price is roughly the figure per kW times its size in kW. Domestic, new-build and retrofit figures are means; the all-installations figure is a median.",
};

export type Band = "0-4" | "4-10" | "10-50";
export const BANDS: Band[] = ["0-4", "4-10", "10-50"];

export interface Figure { value: number; n: number }
export interface SolarFigures {
  /** Financial year as published, e.g. "2025/26". */
  fy: string;
  /** Items keyed "<median|mean>/<type>/<band>": type is all, domestic, non-domestic, retrofit-domestic or newbuild-domestic; band is 0-4, 4-10, 10-50 or all. */
  items: Record<string, Figure>;
}

// ---------- reading the workbook ----------

const norm = (c: Cell): string => String(c ?? "").replace(/\s+/g, " ").trim();
const FY = /^(\d{4})\/(\d{2})$/;

/** Financial year "2025/26" as the dates it covers: 2025-04-01 to 2026-03-31. */
export function fyPeriod(fy: string): { from: string; to: string } {
  const m = FY.exec(fy);
  if (!m) throw new SourceError(`Unexpected financial year "${fy}"; this source needs updating.`);
  return { from: `${m[1]}-04-01`, to: `${Number(m[1]) + 1}-03-31` };
}

/** Financial year from the library date of its last day: 2026-03-31 gives "2025/26". */
export function fyFromEnd(date: string): string {
  const y = Number(date.slice(0, 4));
  return `${y - 1}/${String(y).slice(2)}`;
}

function sheetLike(sheets: Sheet[], start: string): Sheet {
  const s = sheets.find((x) => x.name.toLowerCase().startsWith(start.toLowerCase()));
  if (!s) throw new SourceError(`The DESNZ workbook has no sheet "${start}"; this source needs updating.`);
  return s;
}

function headerRow(rows: Cell[][]): { at: number; head: string[] } {
  const at = rows.findIndex((r) => norm(r[0]) === "Financial year");
  if (at < 0) throw new SourceError("A DESNZ table has no 'Financial year' header; this source needs updating.");
  return { at, head: rows[at].map(norm) };
}

const col = (head: string[], text: string): number => {
  const i = head.findIndex((h) => h === text);
  if (i < 0) throw new SourceError(`The DESNZ table has no column "${text}"; this source needs updating.`);
  return i;
};
const num = (c: Cell): number | null => (typeof c === "number" && Number.isFinite(c) ? c : null);

/** Read the three tables of the workbook (DNC basis) into the figures of the latest financial year. */
export function parseSolar(sheets: Sheet[]): SolarFigures {
  const items: Record<string, Figure> = {};

  // Annual table: median per size band, with the number of installations.
  const annual = sheetLike(sheets, "Annual table");
  const a = headerRow(annual.rows);
  const years = annual.rows.slice(a.at + 1).filter((r) => FY.test(norm(r[0])));
  if (!years.length) throw new SourceError("The DESNZ annual table has no rows; this source needs updating.");
  const latest = years.reduce((x, y) => (norm(y[0]) > norm(x[0]) ? y : x));
  const fy = norm(latest[0]);
  for (const b of BANDS) {
    const nC = col(a.head, `${b} kW - Number of installations included in analysis`);
    const mC = col(a.head, `${b} kW: Median (£/kW)`);
    const v = num(latest[mC]);
    const n = num(latest[nC]);
    if (v !== null && v > 0 && n !== null && n > 0) items[`median/all/${b}`] = { value: v, n };
  }

  // Domestic / non-domestic and new build / retrofit tables: mean per size band (and for all sizes), with the number of installations.
  const typed: { sheet: string; map: (t: string) => string | null }[] = [
    { sheet: "Domestic costs", map: (t) => (/^domestic$/i.test(t) ? "domestic" : /^non-domestic$/i.test(t) ? "non-domestic" : null) },
    { sheet: "New build costs", map: (t) => (/^retrofit \(domestic\)$/i.test(t) ? "retrofit-domestic" : /^new build \(domestic\)$/i.test(t) ? "newbuild-domestic" : null) },
  ];
  for (const { sheet, map } of typed) {
    const s = sheetLike(sheets, sheet);
    const h = headerRow(s.rows);
    const typeC = col(h.head, "Installation Type");
    const allN = h.head.findIndex((x) => x.startsWith("Number of installations included in analysis") && !x.includes("not included"));
    const allM = col(h.head, "All installations included in analysis: Mean (£/kW)");
    for (const r of s.rows.slice(h.at + 1)) {
      if (norm(r[0]) !== fy) continue;
      const type = map(norm(r[typeC]));
      if (!type) continue;
      const v = num(r[allM]);
      const n = allN >= 0 ? num(r[allN]) : null;
      if (v !== null && v > 0 && n !== null && n > 0) items[`mean/${type}/all`] = { value: v, n };
      for (const b of BANDS) {
        const bn = num(r[col(h.head, `${b} kW - Number of installations included in analysis`)]);
        const bv = num(r[col(h.head, `${b} kW: Mean (£/kW)`)]);
        if (bv !== null && bv > 0 && bn !== null && bn > 0) items[`mean/${type}/${b}`] = { value: bv, n: bn };
      }
    }
  }
  if (!Object.keys(items).length) throw new SourceError("No solar cost figures could be read from the DESNZ workbook; this source needs updating.");
  return { fy, items };
}

// ---------- finding and reading the file (collector and live fallback) ----------

/** The DNC-basis Excel attachment of the release page. */
export function dncWorkbookUrl(page: any): string {
  const a = xlsxAttachments(page, /DNC basis/i)[0];
  if (!a) throw new SourceError("The DESNZ release page lists no DNC-basis Excel file; this source needs updating.");
  return a.url;
}

export async function loadSolar(): Promise<SolarFigures> {
  const page = await govukContent(PAGE_PATH);
  const buf = await downloadFile(dncWorkbookUrl(page), 5_000_000);
  return parseSolar(readXlsx(buf));
}

export function solarRows(f: SolarFigures): DailyRow[] {
  return Object.entries(f.items).map(([item, x]) => ({ area: "GB", item, n: x.n, median: x.value, low: x.value, high: x.value, min: x.value, max: x.value }));
}

export async function solarHarvest(): Promise<HarvestResult> {
  const f = await loadSolar();
  return {
    date: fyPeriod(f.fy).to,
    currency: "GBP",
    unit: "per kW",
    rows: solarRows(f),
    note: `DESNZ solar PV cost data, financial year ${f.fy}: published median/mean cost per kW by size band. n is the published number of installations.`,
  };
}

// ---------- choosing the figure ----------

const TYPE_ALIASES: Record<string, string> = {
  "": "all", any: "all", all: "all",
  domestic: "domestic", home: "domestic", house: "domestic", residential: "domestic",
  "non-domestic": "non-domestic", "non domestic": "non-domestic", nondomestic: "non-domestic", commercial: "non-domestic", business: "non-domestic",
  retrofit: "retrofit-domestic", "existing home": "retrofit-domestic", "existing building": "retrofit-domestic", "retrofit (domestic)": "retrofit-domestic",
  "new build": "newbuild-domestic", newbuild: "newbuild-domestic", "new-build": "newbuild-domestic", "new build (domestic)": "newbuild-domestic",
};
const TYPE_LABEL: Record<string, string> = {
  all: "all small installations (domestic and non-domestic)",
  domestic: "domestic installations",
  "non-domestic": "non-domestic installations",
  "retrofit-domestic": "domestic installations on existing homes (retrofit)",
  "newbuild-domestic": "domestic installations on new builds",
};

export function bandFor(sizeKw: number | undefined): { band: Band; assumed: boolean } {
  if (sizeKw === undefined) return { band: "0-4", assumed: true };
  if (!(sizeKw > 0)) throw new InputError("size_kw must be a number above zero (the system size in kilowatts, e.g. 4).");
  if (sizeKw > 50) throw new InputError("size_kw above 50 kW is outside what DESNZ publishes (small-scale solar up to 50 kW).");
  return { band: sizeKw <= 4 ? "0-4" : sizeKw <= 10 ? "4-10" : "10-50", assumed: false };
}

export function solarSelect(p: { dwelling_type?: string; size_kw?: number }): { key: string; type: string; band: Band; assumed: boolean; measure: "median" | "average" } {
  const t = (p.dwelling_type ?? "").toLowerCase().trim();
  const type = TYPE_ALIASES[t];
  if (!type) throw new InputError('dwelling_type for solar must be "domestic", "non-domestic", "retrofit" (existing home) or "new build"; leave it out for all small installations.');
  const { band, assumed } = bandFor(p.size_kw);
  const measure = type === "all" ? "median" : "average";
  return { key: `${measure === "median" ? "median" : "mean"}/${type}/${band}`, type, band, assumed, measure };
}

// ---------- answering ----------

export interface SolarInput { dwelling_type?: string; size_kw?: number; area?: string; baseUrl?: string }

export function solarAnswer(f: SolarFigures, input: SolarInput): PriceAnswer {
  const sel = solarSelect(input);
  const fig = f.items[sel.key];
  const per = fyPeriod(f.fy);
  const bandText = `${sel.band} kW systems`;
  const extra: Record<string, unknown> = {
    price_basis: "declared installed cost per kW (MCS certificate), not a receipt or a quote",
    size_band_kw: sel.band,
    installation_group: TYPE_LABEL[sel.type],
    financial_year: f.fy,
  };
  if (sel.assumed) extra.size_assumed = "No size_kw given, so the 0-4 kW band (the usual home system) is used. Give size_kw for 4-10 kW or 10-50 kW.";
  if (input.area) extra.area_note = "DESNZ publishes one Great Britain figure per size band: the area was ignored.";
  const typical = (kw: number) => (fig ? `${fmtMoney(fig.value * kw, "GBP")} for a ${kw} kW system` : "");
  const answer = buildStatisticAnswer({
    source: INFO,
    query: { country: "GB", measure: "solar_pv", dwelling_type: input.dwelling_type, size_kw: input.size_kw, area: input.area },
    value: fig?.value ?? null,
    measure: sel.measure,
    currency: "GBP",
    unit: "per kW installed",
    period: per,
    reference_period: f.fy,
    sample_size: fig?.n ?? null,
    method:
      `DESNZ publishes the ${sel.measure === "median" ? "median" : "mean"} cost per kW of small-scale solar PV installations certified under the MCS, by size band and financial year (April to March), ` +
      `with the number of installations behind it. We pass on the figure for ${bandText}, ${TYPE_LABEL[sel.type]}, financial year ${f.fy}, unchanged. ` +
      "It is the installer's declared cost from the MCS certificate (equipment, installation and connection), not inflation-adjusted, not a receipt and not a quote.",
    describe: (v) =>
      `Declared installed cost of ${TYPE_LABEL[sel.type]} (${bandText}) in Great Britain: ${fmtMoney(v, "GBP")} per kW, ` +
      `so roughly ${typical(sel.band === "0-4" ? 4 : sel.band === "4-10" ? 6 : 20)}, based on ${fig!.n.toLocaleString("en-GB")} installations.`,
    note: "Declared installed cost at MCS certification, per kW of Declared Net Capacity; not a quote.",
    baseUrl: input.baseUrl,
    extra,
  });
  if (!fig) {
    answer.summary = `DESNZ publishes no ${TYPE_LABEL[sel.type]} figure for ${bandText} for ${f.fy}, so there is no answer for this combination.`;
  }
  return answer;
}

/** The newest day in our price library, rebuilt into figures. Null when the collector has not stored this source yet. */
export function libraryFigures(): SolarFigures | null {
  const lib = readLatestDay(INFO.id);
  if (!lib) return null;
  const items: Record<string, Figure> = {};
  for (const r of lib.rows) if (r.area === "GB") items[r.item] = { value: r.median, n: r.n };
  return { fy: fyFromEnd(lib.date), items };
}

export async function gbSolar(input: SolarInput & Params): Promise<PriceAnswer> {
  const f = libraryFigures() ?? (await loadSolar());
  return solarAnswer(f, input);
}
