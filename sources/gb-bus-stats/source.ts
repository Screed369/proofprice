// England and Wales: the cost of a heat pump installed with a Boiler Upgrade Scheme (BUS) grant, from DESNZ's monthly "Boiler Upgrade
// Scheme statistics". For every installation that received a BUS grant, the installer's MCS certificate gives the cost; DESNZ
// publishes the median and the lower and upper quartile per technology and quarter. Format checked live on 2026-10-15 (release of
// 24 September 2026, "August 2026"; the cost tables run to 2026 Q2):
//  - GET https://www.gov.uk/api/content/government/statistics/boiler-upgrade-scheme-statistics-<month>-<year> lists the attachments; the one
//    titled "Boiler Upgrade Scheme Statistics: <Month Year> (Excel)" is the workbook (about 1.1 MB). Releases are monthly, a month in arrears.
//  - sheet "Q1.1A": a header row "Technology type | Measure | 2022 Q2:\nApr to Jun | ... | 2026 Q2:\nApr to Jun" then, per technology (Air-to-Water
//    Heat Pump, Air-to-Air Heat Pump, Ground Source Heat Pump, Shared Ground Loop Ground Source Heat Pump, Biomass boiler), rows
//    "Median/Lower quartile/Upper quartile capacity of installation (kW)" and "... cost of installation (£)". Suppressed cells hold
//    [c1] (1 to 4 records), [c2] or [x] (no data).
// Costs are what the installer reported on the MCS certificate (note 4: system, labour and VAT; they should include the grant value but
// installers may read that differently). DESNZ publishes no number of records per quarter, so the answer carries sample_size null. The
// quartiles are quartiles, not 10th/90th percentiles, so they are given in `extra`, never as typical_low / typical_high.

import { InputError, SourceError } from "../../lib/http";
import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { GOVUK, govukContent, downloadFile, monthlySlugs, xlsxAttachments } from "../../lib/gov-uk";
import { readLatestDay } from "../../lib/library/store";
import { Cell, readXlsx, Sheet } from "../../categories/rent/xlsx";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { NO_COUNT } from "../../lib/stats";

export const COLLECTION = "https://www.gov.uk/government/collections/boiler-upgrade-scheme-statistics";
export const SLUG_PREFIX = "boiler-upgrade-scheme-statistics";

export const INFO: SourceInfo = {
  id: "gb-bus-stats",
  country: "GB (England and Wales)",
  category: "home upgrades (heat pump installed cost)",
  name: "Boiler Upgrade Scheme statistics",
  publisher: "Department for Energy Security and Net Zero (DESNZ), with data from Ofgem and the Microgeneration Certification Scheme",
  what_is_recorded:
    "The installation cost reported by the installer on the MCS certificate for every heat pump (and biomass boiler) installed with a Boiler Upgrade Scheme grant in England and Wales: the median and the lower and upper quartile per technology and quarter, with the median system capacity.",
  price_type: "official_statistic",
  freshness: "Monthly (the cost tables are updated each quarter, in January, April, July and October; the latest quarter ends about three months earlier)",
  licence: "Open Government Licence v3.0 (GOV.UK: \"All content is available under the Open Government Licence v3.0, except where otherwise stated\"); Crown copyright",
  licence_url: "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/",
  attribution:
    "Contains public sector information licensed under the Open Government Licence v3.0. Source: Department for Energy Security and Net Zero, Boiler Upgrade Scheme statistics (data from Ofgem and the Microgeneration Certification Scheme).",
  homepage: COLLECTION,
  limits:
    "England and Wales only (the scheme does not run in Scotland or Northern Ireland), and only homes that took a BUS grant. One national figure per technology and quarter: no regions, no dwelling types. The cost is the installer's self-reported cost on the MCS certificate (system, labour and VAT; it should include the grant, which installers may read differently), not a receipt or a quote. Costs for fewer than 5 installations are suppressed by DESNZ, so ground source, biomass and shared-loop figures can be missing for a quarter. DESNZ does not publish the number of installations behind a quarterly cost, so there is no sample size. Quartiles are 25th/75th percentiles, not 10th/90th.",
};

export type Tech = "air_to_water" | "ground_source" | "biomass_boiler";
export const TECHS: Record<Tech, { sheetName: string; label: string }> = {
  air_to_water: { sheetName: "Air-to-Water Heat Pump", label: "air-to-water heat pump" },
  ground_source: { sheetName: "Ground Source Heat Pump", label: "ground source heat pump" },
  biomass_boiler: { sheetName: "Biomass boiler", label: "biomass boiler" },
};

const norm = (c: Cell): string => String(c ?? "").replace(/\s+/g, " ").trim();

export interface BusQuarter {
  /** As published, e.g. "2026 Q2". */
  quarter: string;
  /** Keyed "<tech>/<median|lq|uq|kw>"; only unsuppressed numbers. */
  items: Record<string, number>;
}

/** "2026 Q2" to its dates: 2026-04-01 and 2026-06-30. */
export function quarterPeriod(q: string): { from: string; to: string } {
  const m = /^(\d{4}) Q([1-4])$/.exec(q.trim());
  if (!m) throw new SourceError(`Unexpected quarter "${q}"; this source needs updating.`);
  const y = Number(m[1]);
  const n = Number(m[2]);
  const endMonth = n * 3;
  const startMonth = endMonth - 2;
  const lastDay = new Date(Date.UTC(y, endMonth, 0)).getUTCDate();
  const p2 = (x: number) => String(x).padStart(2, "0");
  return { from: `${y}-${p2(startMonth)}-01`, to: `${y}-${p2(endMonth)}-${p2(lastDay)}` };
}

export function quarterFromEnd(date: string): string {
  const y = date.slice(0, 4);
  const q = Math.ceil(Number(date.slice(5, 7)) / 3);
  return `${y} Q${q}`;
}

/** Read the latest quarter of table Q1.1A. */
export function parseBus(sheets: Sheet[]): BusQuarter {
  const s = sheets.find((x) => x.name === "Q1.1A");
  if (!s) throw new SourceError("The BUS workbook has no sheet Q1.1A; this source needs updating.");
  const at = s.rows.findIndex((r) => norm(r[0]) === "Technology type" && norm(r[1]) === "Measure");
  if (at < 0) throw new SourceError("Table Q1.1A has no 'Technology type | Measure' header; this source needs updating.");
  const head = s.rows[at].map((c) => norm(c));
  let last = -1;
  head.forEach((h, i) => { if (/^\d{4} Q[1-4]:/.test(h)) last = i; });
  if (last < 0) throw new SourceError("Table Q1.1A has no quarter columns; this source needs updating.");
  const quarter = head[last].split(":")[0];
  const items: Record<string, number> = {};
  const keyFor = (m: string): string | null => {
    if (/^Median cost of installation/i.test(m)) return "median";
    if (/^Lower quartile cost of installation/i.test(m)) return "lq";
    if (/^Upper quartile cost of installation/i.test(m)) return "uq";
    if (/^Median capacity of installation/i.test(m)) return "kw";
    return null;
  };
  for (const r of s.rows.slice(at + 1)) {
    const tech = (Object.keys(TECHS) as Tech[]).find((t) => norm(r[0]) === TECHS[t].sheetName);
    const k = keyFor(norm(r[1]));
    const v = r[last];
    if (tech && k && typeof v === "number" && Number.isFinite(v) && v > 0) items[`${tech}/${k}`] = v;
  }
  if (!Object.keys(items).some((k) => k.endsWith("/median"))) throw new SourceError("No BUS cost medians could be read from table Q1.1A; this source needs updating.");
  return { quarter, items };
}

// ---------- finding and reading the file ----------

/** The Excel workbook of a monthly release page. */
export function busWorkbookUrl(page: any): string {
  const a = xlsxAttachments(page)[0];
  if (!a) throw new SourceError("The BUS release page lists no Excel file; this source needs updating.");
  return a.url;
}

/** The newest monthly release: try this month's predecessor first, then earlier months (a release can be late). */
export async function loadBus(now = new Date()): Promise<BusQuarter> {
  let lastError: unknown;
  for (const slug of monthlySlugs(SLUG_PREFIX, now, 4)) {
    let page: any;
    try {
      page = await govukContent(`/government/statistics/${slug}`);
    } catch (e) {
      lastError = e;
      continue;
    }
    const buf = await downloadFile(busWorkbookUrl(page), 8_000_000, 90000);
    return parseBus(readXlsx(buf));
  }
  throw lastError instanceof Error ? lastError : new SourceError(`No BUS release found on ${GOVUK}.`);
}

export function busRows(q: BusQuarter): DailyRow[] {
  // The publisher gives one figure and no record count: n is NO_COUNT (nominalCounts).
  return Object.entries(q.items).map(([item, v]) => ({ area: "EW", item, n: NO_COUNT, median: v, low: v, high: v, min: v, max: v }));
}

export async function busHarvest(): Promise<HarvestResult> {
  const q = await loadBus();
  return {
    date: quarterPeriod(q.quarter).to,
    currency: "GBP",
    unit: "per installation",
    rows: busRows(q),
    note: `DESNZ Boiler Upgrade Scheme statistics, ${q.quarter}: reported installation cost per technology (median and quartiles). Figures are published values, not counts of records (no record count is published).`,
  };
}

// ---------- answering ----------

const TECH_ALIASES: Record<string, Tech> = {
  "": "air_to_water", air_to_water: "air_to_water", "air to water": "air_to_water", air: "air_to_water", ashp: "air_to_water", "air source": "air_to_water", awhp: "air_to_water",
  ground_source: "ground_source", "ground source": "ground_source", gshp: "ground_source", ground: "ground_source", geothermal: "ground_source",
  biomass_boiler: "biomass_boiler", "biomass boiler": "biomass_boiler", biomass: "biomass_boiler",
};

export function busTech(text: string | undefined): Tech {
  const t = TECH_ALIASES[(text ?? "").toLowerCase().trim().replace(/[-\s]+/g, " ")] ?? TECH_ALIASES[(text ?? "").toLowerCase().trim()];
  if (!t) throw new InputError('technology must be "air_to_water" (the default), "ground_source" or "biomass_boiler".');
  return t;
}

export interface BusInput { technology?: string; dwelling_type?: string; area?: string; baseUrl?: string }

export function busAnswer(q: BusQuarter, input: BusInput): PriceAnswer {
  const tech = busTech(input.technology);
  const label = TECHS[tech].label;
  const value = q.items[`${tech}/median`] ?? null;
  const per = quarterPeriod(q.quarter);
  const extra: Record<string, unknown> = {
    price_basis: "installer-reported installation cost on the MCS certificate for homes that took a Boiler Upgrade Scheme grant: not a receipt or a quote",
    technology: label,
    quarter: q.quarter,
    grant_note: "DESNZ note 4: costs are self-reported by installers and include the system, labour and VAT; they should include the grant value (up to £7,500 for heat pumps) but installers may read this differently, so check before subtracting the grant.",
  };
  if (q.items[`${tech}/lq`] !== undefined) extra.lower_quartile = q.items[`${tech}/lq`];
  if (q.items[`${tech}/uq`] !== undefined) extra.upper_quartile = q.items[`${tech}/uq`];
  if (q.items[`${tech}/kw`] !== undefined) extra.median_capacity_kw = q.items[`${tech}/kw`];
  extra.quartile_note = "lower_quartile and upper_quartile are the 25th and 75th percentiles of reported costs, not the 10th and 90th.";
  if (input.dwelling_type) extra.dwelling_type_note = "DESNZ does not split costs by dwelling type: dwelling_type was ignored.";
  if (input.area) extra.area_note = "DESNZ publishes one England and Wales figure per technology and quarter: the area was ignored.";
  const answer = buildStatisticAnswer({
    source: INFO,
    query: { country: "GB", measure: "heat_pump", technology: input.technology, dwelling_type: input.dwelling_type, area: input.area },
    value,
    measure: "median",
    currency: "GBP",
    unit: "per installation",
    period: per,
    reference_period: q.quarter,
    sample_size: null,
    method:
      `DESNZ publishes, for every quarter, the median and the lower and upper quartile of the installation cost reported on the MCS certificate for homes that received a Boiler Upgrade Scheme grant, per technology. ` +
      `We pass on the ${label} figures for ${q.quarter}, unchanged. DESNZ gives no number of installations for the quarter. Costs are self-reported by installers, not receipts or quotes.`,
    describe: (v) => {
      const lq = q.items[`${tech}/lq`];
      const uq = q.items[`${tech}/uq`];
      const range = lq !== undefined && uq !== undefined ? ` (middle half of installations: ${fmtMoney(lq, "GBP")} to ${fmtMoney(uq, "GBP")})` : "";
      return `Reported installed cost of ${/^[aeiou]/i.test(label) ? "an" : "a"} ${label} with a Boiler Upgrade Scheme grant in England and Wales: median ${fmtMoney(v, "GBP")}${range}, as declared by installers on the MCS certificate.`;
    },
    note: "Reported installation cost at grant redemption (MCS certificate), as the installer declared it; not a quote.",
    baseUrl: input.baseUrl,
    extra,
  });
  if (value === null) {
    answer.summary = `DESNZ publishes no ${label} cost for ${q.quarter}: figures based on fewer than 5 installations are suppressed, so there is no answer for this technology.`;
  }
  return answer;
}

export function libraryBus(): BusQuarter | null {
  const lib = readLatestDay(INFO.id);
  if (!lib) return null;
  const items: Record<string, number> = {};
  for (const r of lib.rows) if (r.area === "EW") items[r.item] = r.median;
  return { quarter: quarterFromEnd(lib.date), items };
}

export async function gbBus(input: BusInput): Promise<PriceAnswer> {
  busTech(input.technology); // bad input fails before any download
  const q = libraryBus() ?? (await loadBus());
  return busAnswer(q, input);
}

/** The answer when the request is for a measure this source does not publish (insulation, windows, solar, renovation). */
export function notPublished(measure: string, baseUrl?: string): PriceAnswer {
  const a = buildStatisticAnswer({
    source: INFO,
    query: { country: "GB", measure },
    value: null,
    measure: "median",
    currency: "GBP",
    unit: "per installation",
    period: { from: null, to: null },
    reference_period: "n/a",
    method: "No figure: this source publishes heat pump installation costs only.",
    describe: () => "",
    baseUrl,
    extra: { reason: "not_published", detail: "For Great Britain this tool has solar_pv (per kW) and heat_pump (per installation). No open cost statistic for insulation or windows has been added yet." },
  });
  a.summary = `No open official cost statistic for ${measure.replace(/_/g, " ")} in Great Britain is available here yet. Great Britain covers solar_pv and heat_pump.`;
  return a;
}
