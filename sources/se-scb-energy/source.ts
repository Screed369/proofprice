// Sweden: average household electricity price by annual-consumption band, half-yearly, Statistics Sweden (SCB) table TAB4310
// ("Priser på el för hushåll", dataset SSDHalvarElHus), read through the key-free SCB PxWebApi v2 (v2beta).
// Format proven 2026-10-21 by the Verifier through the GitHub probe (see fixtures.ts): GET .../tables/TAB4310/data?lang=en&outputFormat=csv
// &valuecodes%5BTid%5D=...&valuecodes%5BKategorikwh%5D=*&valuecodes%5BContentsCode%5D=... -> CSV, iso-8859-1, header "Kategorikwh","<content> <period>"...
// Values are csek/kWh (hundredths of a krona = öre per kWh). Kategorikwh DA..DE = the five Eurostat household bands. One published figure per cell:
// an official statistic, no record count. One small request per question (about 25 half-years x 5 bands x 5 price parts); no bulk file.

import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import type { SourceInfo } from "../../lib/plugin";

export const TABLE = "TAB4310";
export const API = `https://api.scb.se/OV0104/v2beta/api/v2/tables/${TABLE}/data`;
export const TABLE_URL = "https://www.scb.se/en/finding-statistics/statistics-by-subject-area/energy/price-development-energy/electricity-prices-and-electricity-network-prices/";
const SOURCE_LINE = "Source: Statistics Sweden (SCB), table TAB4310 Prices of electricity for households";

export const INFO: SourceInfo = {
  id: "se-scb-energy",
  country: "SE (Sweden)",
  category: "energy (household electricity prices)",
  name: "Prices of electricity for households, half-yearly, by consumption band (SCB table TAB4310)",
  publisher: "Statistics Sweden (Statistiska centralbyrån, SCB)",
  what_is_recorded:
    "For each half-year and each of five annual-consumption bands (under 1,000 kWh up to 15,000 kWh and more), the average price of electricity per kWh for households in Sweden: " +
    "the total price including electricity tax and VAT, and its parts (energy price, grid price, electricity tax, VAT). One published average per cell; never a bill or a supplier.",
  price_type: "official_statistic",
  freshness: "Half-yearly (new half-year about three months after it ends); each answer states its reference half-year",
  licence:
    "CC0 (public domain dedication). SCB states: \"We use the licence CC0 for this data\" and \"you may use and disseminate or provide such data without any requirement to state the source.\" " +
    "SCB asks that re-use does not present a service as an official cooperation or partnership with Statistics Sweden.",
  licence_url: "https://www.scb.se/en/services/open-data-api",
  attribution:
    `${SOURCE_LINE} (${TABLE_URL}), CC0. Prices are passed on as published; the change on the previous half-year and any price with VAT or taxes removed are calculated by ProofPrice from SCB's own parts, so this is based on data from Statistics Sweden. Not an official cooperation with Statistics Sweden.`,
  homepage: TABLE_URL,
  limits:
    "An average for households in Sweden by consumption band, not a supplier's offer, a quote or a bill, and not split by region or electricity-trading area. " +
    "Published once per half-year, so it lags the market. SCB does not say how many households or contracts stand behind a figure. Electricity only (SCB publishes no household gas price in this table).",
};

export interface Band {
  code: string;
  help: string;
}
export const BANDS: Band[] = [
  { code: "DA", help: "under 1,000 kWh a year" },
  { code: "DB", help: "1,000 to 2,499 kWh a year" },
  { code: "DC", help: "2,500 to 4,999 kWh a year" },
  { code: "DD", help: "5,000 to 14,999 kWh a year" },
  { code: "DE", help: "15,000 kWh a year or more" },
];
export const DEFAULT_BAND = "DC";

/** SCB ContentsCodes. Total is the price with tax and VAT (relationship of the parts to be confirmed on a preview). */
export const CONTENT = { total: "000006WS", energy: "000006WO", grid: "000006WP", tax: "0000070Q", vat: "000006WR" } as const;
export type Part = keyof typeof CONTENT;
const PARTS = Object.keys(CONTENT) as Part[];
export type Taxes = "all" | "excl_vat" | "none";

/** Request: all half-years, all bands, the five price parts. About 600 values, far below SCB's 100,000 limit. */
export function url(): string {
  const codes = Object.values(CONTENT).join(",");
  return `${API}?lang=en&outputFormat=csv&valuecodes%5BTid%5D=*&valuecodes%5BKategorikwh%5D=*&valuecodes%5BContentsCode%5D=${codes}`;
}

export type Table = Map<string, Map<string, Partial<Record<Part, number>>>>; // period ("2026-S1") -> band -> part -> SEK/kWh

const toPeriod = (p: string): string | null => {
  const m = /^(\d{4})H([12])$/.exec(p);
  return m ? `${m[1]}-S${m[2]}` : null;
};

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q;
    } else if (c === "," && !q) { out.push(cur); cur = ""; } else cur += c;
  }
  out.push(cur);
  return out;
}

/** Pure: SCB CSV text -> period -> band -> part -> SEK per kWh (csek / 100). Missing cells (".." or empty) are left out. */
export function parseTable(csv: string): Table {
  const lines = csv.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) throw new SourceError("SCB answered with no rows; this source needs updating.");
  const head = splitCsvLine(lines[0]);
  if (head[0] !== "Kategorikwh") throw new SourceError("SCB answered in an unexpected format (first column is not Kategorikwh); this source needs updating.");
  const byCode = new Map<string, Part>(PARTS.map((k) => [CONTENT[k], k]));
  const cols = head.slice(1).map((h) => {
    const [code, per] = h.trim().split(/\s+/);
    const part = byCode.get(code);
    const period = per ? toPeriod(per) : null;
    return part && period ? { part, period } : null;
  });
  const out: Table = new Map();
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const band = cells[0]?.trim();
    if (!BANDS.some((b) => b.code === band)) continue;
    cells.slice(1).forEach((raw, i) => {
      const c = cols[i];
      const v = Number(raw);
      if (!c || raw.trim() === "" || !Number.isFinite(v) || v <= 0) return;
      const bands = out.get(c.period) ?? new Map();
      const parts = bands.get(band) ?? {};
      parts[c.part] = Math.round(v * 100) / 10000;
      bands.set(band, parts);
      out.set(c.period, bands);
    });
  }
  if (!out.size) throw new SourceError("SCB answered with no usable prices; this source needs updating.");
  return out;
}

const r4 = (v: number) => Math.round(v * 10000) / 10000;

/** The price at a tax level, from SCB's own parts: all = published total; excl_vat = total minus VAT; none = total minus VAT minus electricity tax. */
export function priceAt(parts: Partial<Record<Part, number>>, taxes: Taxes): number | null {
  const t = parts.total;
  if (t === undefined) return null;
  if (taxes === "all") return r4(t);
  const vat = parts.vat;
  if (vat === undefined) return null;
  if (taxes === "excl_vat") return r4(t - vat);
  const tax = parts.tax;
  return tax === undefined ? null : r4(t - vat - tax);
}

export function normaliseBand(raw?: string): Band {
  const s = (raw ?? "").trim().toUpperCase();
  if (!s) return BANDS.find((b) => b.code === DEFAULT_BAND)!;
  const hit = BANDS.find((b) => b.code === s);
  if (hit) return hit;
  const eurostat: Record<string, string> = { KWH_LT1000: "DA", "KWH1000-2499": "DB", "KWH2500-4999": "DC", "KWH5000-14999": "DD", KWH_GE15000: "DE" };
  if (eurostat[s]) return BANDS.find((b) => b.code === eurostat[s])!;
  throw new InputError(`consumption_band for Sweden must be one of: ${BANDS.map((b) => `${b.code} (${b.help})`).join("; ")}. Default ${DEFAULT_BAND}.`);
}

export function normaliseTaxes(raw?: string): Taxes {
  const s = (raw ?? "all").trim().toLowerCase();
  if (s === "all" || s === "excl_vat" || s === "none") return s;
  throw new InputError('taxes must be "all" (default), "excl_vat" or "none".');
}

const periodWords = (c: string) => {
  const m = /^(\d{4})-S([12])$/.exec(c);
  return m ? `the ${m[2] === "1" ? "first" : "second"} half of ${m[1]}` : c;
};
const periodRange = (c: string) => {
  const m = /^(\d{4})-S([12])$/.exec(c)!;
  return m[2] === "1" ? { from: `${m[1]}-01-01`, to: `${m[1]}-06-30` } : { from: `${m[1]}-07-01`, to: `${m[1]}-12-31` };
};
const prevOf = (c: string) => {
  const m = /^(\d{4})-S([12])$/.exec(c)!;
  return m[2] === "2" ? `${m[1]}-S1` : `${Number(m[1]) - 1}-S2`;
};
const taxWords: Record<Taxes, string> = { all: "all taxes and VAT included", excl_vat: "excluding VAT", none: "excluding VAT and electricity tax" };

export function seMethod(): string {
  return (
    "Statistics Sweden (SCB) publishes, twice a year, the average price of electricity per kWh for households in five annual-consumption bands (table TAB4310), as a total and in parts " +
    "(energy price, grid price, electricity tax, VAT). We read the table from the SCB open-data API and pass on the newest half-year for the chosen band, with the same band at the other tax levels (calculated " +
    "from SCB's parts), every band and the previous half-year. No range is calculated: SCB gives one average and no count of households or contracts."
  );
}

/** Pure: the answer from a parsed table. */
export function seAnswer(table: Table, q: { band: Band; taxes: Taxes; baseUrl?: string }): PriceAnswer {
  const query = { country: "SE", energy: "electricity", consumption_band: q.band.code, taxes: q.taxes };
  const base = { source: INFO, query, measure: "average" as const, currency: "SEK", unit: "per kWh", method: seMethod(), baseUrl: q.baseUrl };
  const periods = [...table.keys()].filter((p) => priceAt(table.get(p)?.get(q.band.code) ?? {}, q.taxes) !== null).sort();
  const period = periods[periods.length - 1];
  if (!period) {
    const none = buildStatisticAnswer({ ...base, value: null, period: { from: null, to: null }, reference_period: "", describe: () => "" });
    return { ...none, summary: `Statistics Sweden publishes no household electricity price for consumption band ${q.band.code} (${q.band.help}) at this tax level.` };
  }
  const parts = table.get(period)!.get(q.band.code)!;
  const value = priceAt(parts, q.taxes) as number;
  const prevCode = prevOf(period);
  const prevVal = priceAt(table.get(prevCode)?.get(q.band.code) ?? {}, q.taxes);
  const change = prevVal ? Math.round(((value - prevVal) / prevVal) * 1000) / 10 : null;
  const latestAnywhere = [...table.keys()].sort().pop()!;
  const notes: string[] = [];
  if (latestAnywhere > period) notes.push(`Statistics Sweden has published ${latestAnywhere}, but not for this band and tax level; the newest figure for it is given.`);
  if (q.taxes !== "all") notes.push("This tax level is calculated by ProofPrice by removing SCB's published VAT (and electricity tax) from SCB's published total.");
  const byTax: Record<string, number> = {};
  for (const [k, name] of [["all", "all_taxes_included"], ["excl_vat", "excluding_vat"], ["none", "excluding_all_taxes"]] as const) {
    const v = priceAt(parts, k);
    if (v !== null) byTax[name] = v;
  }
  const allBands = BANDS.flatMap((b) => {
    const v = priceAt(table.get(period)?.get(b.code) ?? {}, q.taxes);
    return v === null ? [] : [{ band: b.code, label: b.help, value: v }];
  });
  const published: Record<string, number> = {};
  for (const k of PARTS) if (parts[k] !== undefined) published[k === "tax" ? "electricity_tax" : k] = r4(parts[k] as number);
  return buildStatisticAnswer({
    ...base,
    value,
    period: periodRange(period),
    reference_period: period,
    note: notes.length ? notes.join(" ") : undefined,
    describe: (v) =>
      `In Sweden the average household price of electricity was ${v.toFixed(2)} SEK per kWh in ${periodWords(period)} (${taxWords[q.taxes]}; annual consumption band ${q.band.code}, ${q.band.help}).` +
      (change === null ? "" : change === 0 ? ` That is unchanged from ${periodWords(prevCode)}.` : ` That is ${Math.abs(change)}% ${change > 0 ? "higher" : "lower"} than in ${periodWords(prevCode)}.`),
    extra: {
      energy: "electricity",
      country_name: "Sweden",
      consumption_band: { band: q.band.code, annual_consumption: q.band.help },
      taxes: { level: q.taxes, label: taxWords[q.taxes] },
      reference_period_label: periodWords(period),
      price_by_tax_level_sek_per_kwh: byTax,
      scb_parts_sek_per_kwh: published,
      previous_period: prevVal ? { reference_period: prevCode, value: prevVal, change_percent: change } : null,
      all_bands_sek_per_kwh: allBands,
      dataset: { table: TABLE, url: TABLE_URL, unit_published: "csek/kWh (hundredths of a krona per kWh); ProofPrice divides by 100" },
      attribution_notice: SOURCE_LINE,
    },
  });
}

export async function fetchCsv(): Promise<string> {
  const res = await fetch(url(), { headers: { accept: "text/csv" }, signal: AbortSignal.timeout(25000) });
  if (!res.ok) throw new SourceError(`Statistics Sweden answered HTTP ${res.status}`);
  return new TextDecoder("iso-8859-1").decode(await res.arrayBuffer());
}

export async function seEnergy(input: { consumption_band?: string; taxes?: string; baseUrl?: string }): Promise<PriceAnswer> {
  const band = normaliseBand(input.consumption_band);
  const taxes = normaliseTaxes(input.taxes);
  return seAnswer(parseTable(await fetchCsv()), { band, taxes, baseUrl: input.baseUrl });
}
