// England care home unit costs: DHSC "Adult social care finance report, England 2024 to 2025", data tables (ODS), Table_52
// (checked 14 Nov 2026): unit cost in GBP per person per week of care that councils bought, by setting (Nursing, Residential,
// Residential and nursing), age band (18 to 64, 65 and over, Total) and year (2023 to 2024 and 2024 to 2025), for England, 9 regions
// and about 150 councils. Header row = spreadsheet row 6: Geography code, LA code, LA name, Region code, Region name, then the figures.
// It is the average a council reports paying providers (not what private self-funders pay). No record count is published.

import { InputError, SourceError, withDeadline } from "../../lib/http";
import { buildStatisticAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { NO_COUNT } from "../../lib/stats";
import { downloadFile, govukContent } from "../../lib/gov-uk";
import { readOds } from "../at-home-prices/ods";
import type { SourceInfo } from "../../lib/plugin";

export const INFO: SourceInfo = {
  id: "gb-dhsc-care-home-costs",
  country: "GB (England)",
  category: "doctor and hospital prices (care home unit costs)",
  name: "Adult social care finance report: care home unit costs (England)",
  publisher: "Department of Health and Social Care (DHSC), from the councils' Adult Social Care Finance Return",
  what_is_recorded:
    "The average weekly cost (GBP per person) of the nursing and residential care that English councils bought for adults, by setting, age band, region and council, for the latest two financial years.",
  price_type: "official_statistic",
  freshness: "Annual: one edition each autumn (2024-25 published 23 Oct 2025, tables revised 13 Nov 2025)",
  licence: "Open Government Licence v3.0 (Crown copyright, DHSC)",
  licence_url: "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/",
  attribution: "Contains public sector information licensed under the Open Government Licence v3.0. Source: Department of Health and Social Care, Adult social care finance report, England 2024 to 2025.",
  homepage: "https://www.gov.uk/government/statistics/adult-social-care-finance-report-england-2024-to-2025",
  limits:
    "This is what councils report paying care providers on average, NOT what private self-funders pay (they usually pay more), and not a quote for one home. " +
    "Nursing costs exclude funded nursing care. Council figures are published only where the council reported them. England only (Scotland, Wales and Northern Ireland are not covered). No sample size is published.",
};

export const PAGE_PATH = "/government/statistics/adult-social-care-finance-report-england-2024-to-2025";
export const FALLBACK_FILE = "https://assets.publishing.service.gov.uk/media/6915f5b6bc34c86ce4e6e77a/adult-social-care-finance-report-2024-to-2025-data-tables-13-nov.ods";

export type Setting = "Nursing" | "Residential" | "Residential and nursing";
export type Age = "18 to 64" | "65 and over" | "Total";
export interface Place { code: string; name: string; kind: "country" | "region" | "council"; region: string | null }
export interface CostTable { header: string[]; places: Array<Place & { cells: string[] }> }

/** Table_52 rows (spreadsheet rows as string arrays) into a lookup. Throws when the layout is not the expected one. */
export function parseTable52(rows: string[][]): CostTable {
  const hi = rows.findIndex((r) => r[0] === "Geography code" && r[4] === "Region name");
  if (hi < 0) throw new SourceError("DHSC care cost table layout changed", "no header row");
  const header = rows[hi];
  if (!header.some((h) => /^Residential and nursing: Total, \d{4} to \d{4}$/.test(h))) throw new SourceError("DHSC care cost table layout changed", header.slice(5, 8).join("|"));
  const places: CostTable["places"] = [];
  for (const r of rows.slice(hi + 1)) {
    const geo = r[0] || r[3];
    const name = r[2] || r[4];
    if (!geo || !name) continue;
    const kind: Place["kind"] = geo.startsWith("E92") ? "country" : geo.startsWith("E12") ? "region" : "council";
    places.push({ code: geo, name, kind, region: kind === "council" ? r[4] || null : null, cells: r.slice(5) });
  }
  if (places.length < 100) throw new SourceError("DHSC care cost table layout changed", `only ${places.length} places`);
  return { header, places };
}

export function parseSetting(service: string): Setting {
  const s = service.toLowerCase();
  const nursing = /nursing/.test(s);
  const resi = /residential|care home|rest home|old people|elderly/.test(s);
  if (nursing && !resi) return "Nursing";
  if (resi && !nursing) return /residential care|residential home/.test(s) || !/care home|nursing/.test(s) ? "Residential" : "Residential and nursing";
  return "Residential and nursing";
}
export function parseAge(service: string): Age {
  const s = service.toLowerCase();
  if (/18\s*(to|-|–)\s*64|working age|under 65|younger adult|learning disab/.test(s)) return "18 to 64";
  if (/65|older|elderly|senior|pension/.test(s)) return "65 and over";
  return "Total";
}
export function isCareService(service: string): boolean {
  return /care home|nursing|residential|rest home|elderly care|social care/i.test(service);
}

/** Find the place: England by default; a region or council by name (case and punctuation ignored; "Greater Manchester" style words are not guessed). */
export function findPlace(t: CostTable, state: string | undefined): Place & { cells: string[] } | null {
  const norm = (x: string) => x.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").replace(/\b(city of|county|council|royal borough of|london borough of|borough of)\b/g, " ").replace(/\s+/g, " ").trim();
  if (!state || /^(england|uk|united kingdom|gb|great britain|national)$/i.test(state.trim())) return t.places.find((p) => p.kind === "country") ?? null;
  const w = norm(state);
  if (!w) return null;
  const exact = t.places.filter((p) => norm(p.name) === w);
  if (exact.length) return exact[0];
  const part = t.places.filter((p) => p.kind !== "country" && (norm(p.name).startsWith(w) || w.startsWith(norm(p.name))));
  return part.length === 1 ? part[0] : part.find((p) => p.kind === "council") ?? part[0] ?? null;
}

export function valueFor(t: CostTable, place: { cells: string[] }, setting: Setting, age: Age): { latest: { year: string; value: number } | null; previous: { year: string; value: number } | null } {
  const out: Array<{ year: string; value: number }> = [];
  t.header.slice(5).forEach((h, i) => {
    if (!h.startsWith(`${setting}: ${age}, `)) return;
    const raw = place.cells[i];
    const value = raw === undefined || raw === "" ? NaN : Number(raw);
    if (Number.isFinite(value) && value > 0) out.push({ year: h.slice(h.lastIndexOf(", ") + 2), value });
  });
  out.sort((a, b) => a.year.localeCompare(b.year));
  return { latest: out[out.length - 1] ?? null, previous: out.length > 1 ? out[out.length - 2] : null };
}

const ukYear = (y: string) => { const m = y.match(/^(\d{4}) to (\d{4})$/); return m ? { from: `${m[1]}-04-01`, to: `${m[2]}-03-31`, label: `${m[1]}-${m[2].slice(2)}` } : { from: null, to: null, label: y }; };

export function careAnswer(opts: { table: CostTable; service: string; state?: string; baseUrl?: string }): PriceAnswer {
  if (!isCareService(opts.service)) {
    throw new InputError("This source covers care home costs in England only. Ask for 'care home', 'nursing care' or 'residential care' (optionally 'over 65' or '18 to 64'), and put a region or council in state.");
  }
  const setting = parseSetting(opts.service);
  const age = parseAge(opts.service);
  const place = findPlace(opts.table, opts.state);
  const england = opts.table.places.find((p) => p.kind === "country")!;
  const v = place ? valueFor(opts.table, place, setting, age) : { latest: null, previous: null };
  const yr = v.latest ? ukYear(v.latest.year) : { from: null, to: null, label: "" };
  const eng = valueFor(opts.table, england, setting, age).latest;
  const where = place ? (place.kind === "country" ? "England" : place.name) : "";
  return buildStatisticAnswer({
    source: INFO,
    query: { country: "GB", service: opts.service, ...(opts.state ? { state: opts.state } : {}) },
    value: v.latest?.value ?? null,
    measure: "average",
    currency: "GBP",
    unit: "per person per week (council-funded care)",
    period: { from: yr.from, to: yr.to },
    reference_period: yr.label || "latest",
    sample_size: NO_COUNT,
    method:
      "England: the unit cost per person per week that councils reported in the Adult Social Care Finance Return (total spend minus grants to voluntary organisations, divided by weeks of care), as published by DHSC for the chosen setting, age band and area. " +
      "It is the average councils paid providers, not what private self-funders pay.",
    describe: (x) =>
      `${where}: councils paid on average ${fmtMoney(x, "GBP")} a week for ${setting.toLowerCase()} care (${age === "Total" ? "all adult ages" : "ages " + age}) in ${yr.label}` +
      (v.previous ? `, up from ${fmtMoney(v.previous.value, "GBP")} the year before` : "") +
      (place && place.kind !== "country" && eng ? `; the England average is ${fmtMoney(eng.value, "GBP")}` : "") + ".",
    ending: "Official statistic from councils' returns (what councils paid), not a price quote and not what self-funders pay.",
    note: "Council-funded care only.",
    baseUrl: opts.baseUrl,
    extra: {
      area: place ? { name: place.name, kind: place.kind, code: place.code, region: place.region } : null,
      setting, age_band: age,
      previous_year: v.previous ? { year: ukYear(v.previous.year).label, gbp_per_week: Math.round(v.previous.value * 100) / 100 } : null,
      england_average_gbp_per_week: eng ? Math.round(eng.value * 100) / 100 : null,
    },
  });
}

const CACHE_MS = 6 * 3600_000;
let cached: { at: number; table: CostTable } | null = null;
const UA_NOTE = "DHSC ODS";

async function dataFileUrl(): Promise<string> {
  try {
    const page = await govukContent(PAGE_PATH);
    const att = (page?.details?.attachments ?? []).find((a: any) => typeof a?.url === "string" && /\.ods$/i.test(a.url) && /data tables$/i.test(String(a.title ?? "")) && !/net current/i.test(String(a.title)));
    return att?.url ?? FALLBACK_FILE;
  } catch {
    return FALLBACK_FILE;
  }
}

export async function loadTable(): Promise<CostTable> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.table;
  const work = (async () => {
    const buf = await downloadFile(await dataFileUrl(), 8_000_000, 20000);
    let sheets;
    try { sheets = readOds(buf); } catch { throw new SourceError(`${UA_NOTE} file could not be read`, PAGE_PATH); }
    const t = sheets.find((s) => s.name === "Table_52");
    if (!t) throw new SourceError("DHSC care cost table layout changed", "no Table_52");
    return parseTable52(t.rows);
  })();
  const table = await withDeadline(work, 24000, () => new SourceError("Source timed out", PAGE_PATH));
  cached = { at: Date.now(), table };
  return table;
}

export async function gbCareHomeCosts(p: { service: string | undefined; state?: string | undefined; setting?: string | undefined; baseUrl?: string }): Promise<PriceAnswer> {
  if (!p.service) throw new InputError("service is required: 'care home', 'nursing care' or 'residential care' (optionally 'over 65' or '18 to 64').");
  if (p.setting) throw new InputError("England care home costs have no setting option: say 'nursing' or 'residential' in service and leave setting out.");
  if (!isCareService(p.service)) return careAnswer({ table: { header: [], places: [] }, service: p.service, state: p.state, baseUrl: p.baseUrl });
  return careAnswer({ table: await loadTable(), service: p.service, state: p.state, baseUrl: p.baseUrl });
}
