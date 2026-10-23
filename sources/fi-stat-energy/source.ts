// Finland: average household electricity price by annual-consumption band, monthly, Statistics Finland table 13rb
// "Price of electricity by type of consumer" (StatFin/ehi), read through the key-free PxWeb v1 API at pxdata.stat.fi.
// Metadata proven 2026-10-23 through the GitHub probe (GET .../StatFin/ehi/13rb.px, see fixtures.ts): variables timeperiod_m (2008M01..2026M06),
// energia_48_20220905 (price component A energy, B distribution, C taxes, SSS total), energia_49_20220905 (consumer type A..E households, F..K business),
// contentscode (hinta_snt_kwh = c/kWh). Data is a POST of an item selection answered as JSON-stat 2.0. One published figure per cell:
// an official statistic from a supplier survey, no record count. One request per question (last 14 months x 5 bands x 4 components).

import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { fetchJson, InputError, SourceError } from "../../lib/http";
import { parseJsonStat } from "../../lib/adapters";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { NO_COUNT } from "../../lib/stats";

export const API = "https://pxdata.stat.fi/PxWeb/api/v1/en/StatFin/ehi/13rb.px";
export const TABLE_URL = "https://stat.fi/en/statistics/ehi";
const SOURCE_LINE = "Source: Statistics Finland, table 13rb Price of electricity by type of consumer";

export const INFO: SourceInfo = {
  id: "fi-stat-energy",
  country: "FI (Finland)",
  category: "energy (household electricity prices)",
  name: "Price of electricity by type of consumer, monthly, households by consumption band (Statistics Finland table 13rb)",
  publisher: "Statistics Finland (Tilastokeskus)",
  what_is_recorded:
    "For each month and each of five annual-consumption bands of household customers (under 1,000 kWh up to over 15,000 kWh), the average price of electricity in cents per kWh in Finland: " +
    "the total price including electricity tax and VAT, and its parts (electric energy, distribution, taxes). One published average per cell, from Statistics Finland's survey of electricity suppliers; never a bill or a supplier.",
  price_type: "official_statistic",
  freshness: "Monthly (about three months after the month ends); each answer states its reference month",
  licence:
    "CC BY 4.0. Statistics Finland: open data materials are \"covered by the Creative Commons Attribution 4.0 International licence\" and may be used for commercial purposes as well; " +
    "\"give at least Statistics Finland as the source (Source: Statistics Finland)\".",
  licence_url: "https://stat.fi/en/about-us/get-to-know-statistics-finland/legislation/terms-of-use",
  attribution:
    `${SOURCE_LINE} (${TABLE_URL}), licensed CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Prices are passed on as published; the change on earlier months and the price without taxes are calculated by ProofPrice from Statistics Finland's own parts.`,
  homepage: TABLE_URL,
  limits:
    "A national average for households by consumption band, from a survey of suppliers: a typical price level, not a supplier's offer, a quote or a bill, and not split by region or contract type. " +
    "Published monthly with a lag of about three months. Statistics Finland gives no count of households or contracts behind a figure. Electricity only (this table has no gas).",
};

export interface Band {
  code: string;
  fi: string;
  help: string;
}
/** Same letters as Eurostat's household bands (DA..DE), mapped to Statistics Finland's consumer types A..E. */
export const BANDS: Band[] = [
  { code: "DA", fi: "A", help: "under 1,000 kWh a year" },
  { code: "DB", fi: "B", help: "1,000 to 2,499 kWh a year" },
  { code: "DC", fi: "C", help: "2,500 to 4,999 kWh a year" },
  { code: "DD", fi: "D", help: "5,000 to 15,000 kWh a year" },
  { code: "DE", fi: "E", help: "over 15,000 kWh a year" },
];
export const DEFAULT_BAND = "DC";

export type Part = "energy" | "distribution" | "taxes" | "total";
const PART_CODE: Record<string, Part> = { A: "energy", B: "distribution", C: "taxes", SSS: "total" };
export type Taxes = "all" | "none";

const D_TIME = "timeperiod_m";
const D_PART = "energia_48_20220905";
const D_TYPE = "energia_49_20220905";
const D_CONTENT = "contentscode";
export const MONTHS = 14;

/** The POST body: the newest MONTHS months, the four price components, the five household bands, price in c/kWh. */
export function query() {
  return {
    query: [
      { code: D_TIME, selection: { filter: "top", values: [String(MONTHS)] } },
      { code: D_PART, selection: { filter: "item", values: ["A", "B", "C", "SSS"] } },
      { code: D_TYPE, selection: { filter: "item", values: BANDS.map((b) => b.fi) } },
      { code: D_CONTENT, selection: { filter: "item", values: ["hinta_snt_kwh"] } },
    ],
    response: { format: "json-stat2" },
  };
}

export type Table = Map<string, Map<string, Partial<Record<Part, number>>>>; // month ("2026-06") -> band -> part -> EUR/kWh

const r4 = (v: number) => Math.round(v * 10000) / 10000;
const toMonth = (c: string): string | null => {
  const m = /^(\d{4})M(\d{2})$/.exec(c);
  return m ? `${m[1]}-${m[2]}` : null;
};

/** Pure: Statistics Finland JSON-stat -> month -> band -> part -> EUR per kWh (c/kWh / 100). Missing cells are left out. */
export function parseTable(json: unknown): Table {
  const t = parseJsonStat(json);
  for (const id of [D_TIME, D_PART, D_TYPE]) if (!t.ids.includes(id)) throw new SourceError(`Statistics Finland answered in an unexpected format (no ${id} dimension); this source needs updating.`);
  const byFi = new Map(BANDS.map((b) => [b.fi, b.code]));
  const out: Table = new Map();
  for (const r of t.rows) {
    const month = toMonth(String(r[D_TIME]));
    const part = PART_CODE[String(r[D_PART])];
    const band = byFi.get(String(r[D_TYPE]));
    const v = r.value;
    if (!month || !part || !band || typeof v !== "number" || !Number.isFinite(v) || v < 0) continue;
    const bands = out.get(month) ?? new Map();
    const parts = bands.get(band) ?? {};
    parts[part] = r4(v / 100);
    bands.set(band, parts);
    out.set(month, bands);
  }
  if (!out.size) throw new SourceError("Statistics Finland answered with no usable prices; this source needs updating.");
  return out;
}

/** Price at a tax level: all = published total; none = electric energy + distribution (Statistics Finland's own parts, excluding tax and VAT). */
export function priceAt(parts: Partial<Record<Part, number>>, taxes: Taxes): number | null {
  if (taxes === "all") return parts.total !== undefined && parts.total > 0 ? r4(parts.total) : null;
  if (parts.energy === undefined || parts.distribution === undefined) return null;
  const v = r4(parts.energy + parts.distribution);
  return v > 0 ? v : null;
}

export function normaliseBand(raw?: string): Band {
  const s = (raw ?? "").trim().toUpperCase();
  if (!s) return BANDS.find((b) => b.code === DEFAULT_BAND)!;
  const hit = BANDS.find((b) => b.code === s);
  if (hit) return hit;
  const eurostat: Record<string, string> = { KWH_LT1000: "DA", "KWH1000-2499": "DB", "KWH2500-4999": "DC", "KWH5000-14999": "DD", KWH_GE15000: "DE" };
  if (eurostat[s]) return BANDS.find((b) => b.code === eurostat[s])!;
  throw new InputError(`consumption_band for Finland must be one of: ${BANDS.map((b) => `${b.code} (${b.help})`).join("; ")}. Default ${DEFAULT_BAND}.`);
}

export function normaliseTaxes(raw?: string): Taxes {
  const s = (raw ?? "all").trim().toLowerCase();
  if (s === "all" || s === "none") return s;
  throw new InputError('taxes for Finland must be "all" (default, with electricity tax and VAT) or "none" (energy and distribution only). Statistics Finland publishes taxes and VAT as one part, so "excl_vat" is not available.');
}

const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthWords = (c: string) => {
  const m = /^(\d{4})-(\d{2})$/.exec(c);
  return m ? `${MONTHS_EN[Number(m[2]) - 1]} ${m[1]}` : c;
};
const monthRange = (c: string) => {
  const [y, m] = c.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${c}-01`, to: `${c}-${String(last).padStart(2, "0")}` };
};
const shiftMonth = (c: string, back: number) => {
  const [y, m] = c.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 - back, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
const taxWords: Record<Taxes, string> = { all: "electricity tax and VAT included", none: "excluding electricity tax and VAT" };

export function fiMethod(): string {
  return (
    "Statistics Finland publishes every month the average price of electricity in cents per kWh for household customers in five annual-consumption bands (table 13rb), as a total and in parts " +
    "(electric energy, distribution, taxes). We read the newest months from the Statistics Finland open-data API and pass on the newest month for the chosen band, the same band without taxes " +
    "(energy plus distribution, calculated from the published parts), every band, and the change on the previous month and the same month a year earlier. " +
    "No range is calculated: Statistics Finland gives one average and no count of households or contracts."
  );
}

/** Pure: the answer from a parsed table. */
export function fiAnswer(table: Table, q: { band: Band; taxes: Taxes; baseUrl?: string }): PriceAnswer {
  const query = { country: "FI", energy: "electricity", consumption_band: q.band.code, taxes: q.taxes };
  const base = { source: INFO, query, measure: "average" as const, currency: "EUR", unit: "per kWh", method: fiMethod(), baseUrl: q.baseUrl };
  const months = [...table.keys()].filter((p) => priceAt(table.get(p)?.get(q.band.code) ?? {}, q.taxes) !== null).sort();
  const month = months[months.length - 1];
  if (!month) {
    const none = buildStatisticAnswer({ ...base, value: null, period: { from: null, to: null }, reference_period: "", describe: () => "" });
    return { ...none, summary: `Statistics Finland publishes no household electricity price for consumption band ${q.band.code} (${q.band.help}) at this tax level.` };
  }
  const parts = table.get(month)!.get(q.band.code)!;
  const value = priceAt(parts, q.taxes) as number;
  const at = (m: string) => priceAt(table.get(m)?.get(q.band.code) ?? {}, q.taxes);
  const prevMonth = shiftMonth(month, 1);
  const prevYear = shiftMonth(month, 12);
  const pct = (a: number | null) => (a ? Math.round(((value - a) / a) * 1000) / 10 : null);
  const mChange = pct(at(prevMonth));
  const yChange = pct(at(prevYear));
  const latestAnywhere = [...table.keys()].sort().pop()!;
  const notes: string[] = [];
  if (latestAnywhere > month) notes.push(`Statistics Finland has published ${monthWords(latestAnywhere)}, but not for this band and tax level; the newest figure for it is given.`);
  if (q.taxes === "none") notes.push("This tax level is calculated by ProofPrice by adding Statistics Finland's published electric-energy and distribution parts.");
  const byTax: Record<string, number> = {};
  for (const [k, name] of [["all", "taxes_included"], ["none", "excluding_taxes"]] as const) {
    const v = priceAt(parts, k);
    if (v !== null) byTax[name] = v;
  }
  const allBands = BANDS.flatMap((b) => {
    const v = priceAt(table.get(month)?.get(b.code) ?? {}, q.taxes);
    return v === null ? [] : [{ band: b.code, label: b.help, value: v }];
  });
  const published: Record<string, number> = {};
  for (const k of ["energy", "distribution", "taxes", "total"] as Part[]) if (parts[k] !== undefined) published[k] = parts[k] as number;
  const change = (c: number | null, since: string) => (c === null ? "" : c === 0 ? ` That is unchanged from ${monthWords(since)}.` : ` That is ${Math.abs(c)}% ${c > 0 ? "higher" : "lower"} than in ${monthWords(since)}.`);
  return buildStatisticAnswer({
    ...base,
    value,
    period: monthRange(month),
    reference_period: month,
    note: notes.length ? notes.join(" ") : undefined,
    describe: (v) =>
      `In Finland the average household price of electricity was ${v.toFixed(4).replace(/0+$/, "").replace(/\.$/, "")} EUR per kWh in ${monthWords(month)} (${taxWords[q.taxes]}; annual consumption band ${q.band.code}, ${q.band.help}).` +
      change(yChange, prevYear),
    extra: {
      energy: "electricity",
      country_name: "Finland",
      consumption_band: { band: q.band.code, annual_consumption: q.band.help },
      taxes: { level: q.taxes, label: taxWords[q.taxes] },
      reference_period_label: monthWords(month),
      price_by_tax_level_eur_per_kwh: byTax,
      statfin_parts_eur_per_kwh: published,
      previous_month: at(prevMonth) ? { reference_period: prevMonth, value: at(prevMonth), change_percent: mChange } : null,
      same_month_last_year: at(prevYear) ? { reference_period: prevYear, value: at(prevYear), change_percent: yChange } : null,
      all_bands_eur_per_kwh: allBands,
      dataset: { table: "13rb", url: TABLE_URL, unit_published: "c/kWh (cents per kWh); ProofPrice divides by 100" },
      attribution_notice: SOURCE_LINE,
    },
  });
}

export type Poster = (url: string, body: unknown) => Promise<unknown>;
const defaultPoster: Poster = (url, body) => fetchJson(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, 25000);

export async function fiEnergy(input: { consumption_band?: string; taxes?: string; baseUrl?: string }, post: Poster = defaultPoster): Promise<PriceAnswer> {
  const band = normaliseBand(input.consumption_band);
  const taxes = normaliseTaxes(input.taxes);
  return fiAnswer(parseTable(await post(API, query())), { band, taxes, baseUrl: input.baseUrl });
}

// ---------- daily collector copy (harvest) and history keys ----------
// Stores the newest month: total and tax-free price for each band (EUR per kWh, n NO_COUNT, dated by the month's first day). If
// pxdata.stat.fi does not answer (it has blocked cloud servers before), runCategory answers from this copy for up to 7 days and says so.
export const ALL_AREA = "ALL";
export const itemKey = (band: string, taxes: Taxes) => `electricity/${band}/${taxes}`;

export function harvestFromTable(table: Table): HarvestResult {
  const month = [...table.keys()].sort().pop()!;
  const rows: DailyRow[] = [];
  for (const b of BANDS) {
    for (const taxes of ["all", "none"] as Taxes[]) {
      const v = priceAt(table.get(month)?.get(b.code) ?? {}, taxes);
      if (v !== null) rows.push({ area: ALL_AREA, item: itemKey(b.code, taxes), n: NO_COUNT, median: v, low: v, high: v, min: v, max: v });
    }
  }
  if (!rows.length) throw new SourceError("Statistics Finland's newest month holds no household electricity price; this source needs updating.");
  return {
    date: `${month}-01`,
    currency: "EUR",
    unit: "per kWh",
    rows,
    note: `Statistics Finland average household electricity price for ${monthWords(month)} by consumption band. An official statistic; no record count is published.`,
  };
}

export async function fiHarvest(post: Poster = defaultPoster): Promise<HarvestResult> {
  return harvestFromTable(parseTable(await post(API, query())));
}

export function fiHistoryKey(p: { consumption_band?: string; taxes?: string }): { area: string; item: string; label: string } | null {
  try {
    const b = normaliseBand(p.consumption_band);
    const t = normaliseTaxes(p.taxes);
    return { area: ALL_AREA, item: itemKey(b.code, t), label: `Finland, band ${b.code}, ${taxWords[t]}` };
  } catch {
    return null;
  }
}
