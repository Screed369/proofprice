// Brazil (Fortaleza city) home sales from the city's ITBI open data (Prefeitura de Fortaleza, Secretaria Municipal das Financas,
// dados.fortaleza.ce.gov.br, CC BY). One row = one property-transfer tax (ITBI) declaration with the tax base (VL_BASE_CALCULO), the
// bairro, the use, the built area and the ideal fraction of the plot (below 1 = a flat in a building, 1 = a house on its own plot).
// The tax base is the transaction value used for the transfer tax, not a verified price paid, so every answer says "ITBI tax base".
// Names, streets, plot numbers and coordinates are never read: each row is reduced in memory to (month, bairro, kind, value, area)
// and only aggregates reach the library. Bulk file (about 42 MB) => the daily collector (harvest) reads it once; requests are answered
// from the library.

import { InputError, SourceError } from "../../lib/http";
import { MIN_PUBLISH } from "../../lib/stats";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { aggregateDaily, NATIONAL } from "../../lib/library/aggregate";
import { readDaily, readLatestDay, readMeta } from "../../lib/library/store";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";

export const INFO: SourceInfo = {
  id: "br-itbi-fortaleza",
  country: "BR (Fortaleza city only)",
  category: "home sales (ITBI property-transfer tax declarations)",
  name: "ITBI, property transfers in the city of Fortaleza",
  publisher: "Prefeitura Municipal de Fortaleza, Secretaria Municipal das Financas (SEFIN), Fortaleza Dados Abertos",
  what_is_recorded:
    "Property-transfer tax (ITBI) declarations in the city of Fortaleza, one per transfer: the tax base (base de calculo) in BRL, the neighbourhood, the use, the built area and whether the property is a flat or a house. Names, streets and plot numbers are not used.",
  price_type: "posted_price",
  freshness: "The city refreshes the file about monthly (CKAN record changed 2026-10-26). Each answer names the period it covers.",
  licence: "Creative Commons Attribution (CC BY), as stated in the dataset record on Fortaleza Dados Abertos.",
  licence_url: "https://opendefinition.org/licenses/cc-by",
  attribution:
    "Source: Prefeitura Municipal de Fortaleza, Secretaria Municipal das Financas, ITBI transacoes imobiliarias, Fortaleza Dados Abertos, CC BY. Changed by ProofPrice: only residential apartments and houses, medians and percentiles computed by neighbourhood over rolling windows.",
  homepage: "https://dados.fortaleza.ce.gov.br/dataset/dados_abertos_itbi_transacoes_imobiliarias",
  limits:
    "Fortaleza city only, not the rest of Brazil. The figure is the ITBI tax base (the transaction value the tax is charged on), not a verified price paid. " +
    "Flat versus house is inferred from the ideal fraction of the plot (below 1 = flat, 1 = house). Residential uses only; bases under BRL 30,000 and of BRL 20 million or more are dropped. " +
    "The newest month is left out while it is still being filled in. Aggregates only, by neighbourhood (bairro) and rolling window; never streets or owners.",
  method_version: "1",
};

export const CSV_URL = "https://dados.fortaleza.ce.gov.br/dataset/32608ed2-e4ad-4cd2-b7bc-deea35dd189f/resource/46324d49-9809-4d32-8e5c-b4b570f067ce/download/dados_abertos_itbi_transacoes_imobiliarias.csv";
export const WINDOWS = [3, 6, 12, 24] as const;
export const TYPES = ["any", "apartment", "house"] as const;
export type Kind = "apartment" | "house";
export const MIN_VALUE = 30_000;
export const MAX_VALUE = 20_000_000; // exclusive
export const M2_RANGE: [number, number] = [500, 60_000]; // BRL per m2 of built area
export const MIN_AREA = 15; // m2 to count a price per m2

/** One transfer, reduced: no street, no owner. */
export interface Rec { ym: number; area: string; kind: Kind; value: number; m2: number | null }

export function normaliseName(raw: string): string {
  return raw.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
export const slug = (raw: string) => normaliseName(raw).replace(/ /g, "-");

/** Brazilian decimal: "276666,66" -> 276666.66; "" -> NaN. */
export function brNumber(s: string): number {
  const t = (s ?? "").trim();
  if (!t) return NaN;
  return Number(t.replace(/\./g, "").replace(",", "."));
}

/** Split CSV text with ';' separators and "quoted" fields into rows of fields (handles quotes and line breaks inside quotes). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (inQ) {
      if (c === 34) { if (text.charCodeAt(i + 1) === 34) { field += '"'; i++; } else inQ = false; }
      else field += text[i];
    } else if (c === 34) inQ = true;
    else if (c === 59) { row.push(field); field = ""; }
    else if (c === 10 || c === 13) {
      if (c === 13 && text.charCodeAt(i + 1) === 10) i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += text[i];
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const NEEDED = ["BAIRRO", "TIPO_USO_IMOVEL", "AREA_EDIFICADA", "FRACAO_IDEAL", "VL_BASE_CALCULO", "DATA_CADASTRAMENTO_GI_IMOVEL"] as const;

/** Parse the CSV into plausible residential records. Reads columns by name; streets, owners and plot numbers are never read. */
export function parseItbi(text: string): Rec[] {
  const rows = parseCsv(text.replace(/^﻿/, ""));
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim().toUpperCase());
  const ix: Record<string, number> = {};
  for (const n of NEEDED) {
    ix[n] = head.indexOf(n);
    if (ix[n] < 0) throw new SourceError("The Fortaleza ITBI file has an unexpected format (columns changed)", head.join(",").slice(0, 200));
  }
  const out: Rec[] = [];
  for (let r = 1; r < rows.length; r++) {
    const f = rows[r];
    if (normaliseName(f[ix.TIPO_USO_IMOVEL] ?? "") !== "residencial") continue;
    const value = brNumber(f[ix.VL_BASE_CALCULO]);
    if (!Number.isFinite(value) || value < MIN_VALUE || value >= MAX_VALUE) continue;
    const frac = brNumber(f[ix.FRACAO_IDEAL]);
    if (!Number.isFinite(frac) || frac <= 0 || frac > 1) continue;
    const kind: Kind = frac >= 0.9999 ? "house" : "apartment";
    const d = /^(\d{2})\/(\d{2})\/(\d{4})/.exec((f[ix.DATA_CADASTRAMENTO_GI_IMOVEL] ?? "").trim());
    if (!d) continue;
    const y = Number(d[3]), m = Number(d[2]);
    if (m < 1 || m > 12 || y < 2000) continue;
    const area = slug(f[ix.BAIRRO] ?? "");
    if (!area) continue;
    const a = brNumber(f[ix.AREA_EDIFICADA]);
    let m2: number | null = null;
    if (Number.isFinite(a) && a >= MIN_AREA) {
      const v = value / a;
      if (v >= M2_RANGE[0] && v <= M2_RANGE[1]) m2 = v;
    }
    out.push({ ym: y * 12 + (m - 1), area, kind, value, m2 });
  }
  return out;
}

export function ymToDate(ym: number): string {
  const y = Math.floor(ym / 12), m = (ym % 12) + 1;
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); // last day of the month
}
/** First day of the window of `months` months that ends with the month of `last` (YYYY-MM-DD). */
export function monthsBack(last: string, months: number): string {
  const d = new Date(last + "T00:00:00Z");
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - months + 1, 1)).toISOString().slice(0, 10);
}

/** The newest month that looks complete: the newest month is dropped when it holds under 60% of the month before it. */
export function lastCompleteMonth(recs: Rec[]): number {
  const count = new Map<number, number>();
  for (const r of recs) count.set(r.ym, (count.get(r.ym) ?? 0) + 1);
  const months = [...count.keys()].sort((a, b) => b - a);
  if (!months.length) throw new SourceError("The Fortaleza ITBI file held no usable residential records");
  const [newest, prev] = months;
  if (prev !== undefined && newest - prev === 1 && (count.get(newest) ?? 0) < 0.6 * (count.get(prev) ?? 0)) return prev;
  return newest;
}

/** Aggregates for every window ending at the newest complete month. Items: "<type>:<N>m" (BRL per home) and "<type>-m2:<N>m" (BRL per m2). */
export function dailyRows(recs: Rec[]): { date: string; rows: DailyRow[] } {
  const last = lastCompleteMonth(recs);
  const out: { area: string; item: string; price: number }[] = [];
  for (const m of WINDOWS) {
    for (const g of recs) {
      if (g.ym <= last - m || g.ym > last) continue;
      for (const t of ["any", g.kind] as const) {
        out.push({ area: g.area, item: `${t}:${m}m`, price: g.value });
        if (g.m2 !== null) out.push({ area: g.area, item: `${t}-m2:${m}m`, price: g.m2 });
      }
    }
  }
  return { date: ymToDate(last), rows: aggregateDaily(out, true).filter((r) => r.n >= MIN_PUBLISH) };
}

/** The daily collector: one download of the whole file (latin-1), reduced to aggregates. */
export async function fortalezaHarvest(): Promise<HarvestResult> {
  const res = await fetch(CSV_URL, { headers: { "user-agent": "ProofPrice/1.0 (+https://proofprice.com; hello@proofprice.com)" }, signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new SourceError(`Fortaleza open data returned HTTP ${res.status}`, CSV_URL, res.status);
  const text = new TextDecoder("latin1").decode(new Uint8Array(await res.arrayBuffer()));
  const recs = parseItbi(text);
  if (!recs.length) throw new SourceError("The Fortaleza ITBI file returned no usable residential rows");
  const { date, rows } = dailyRows(recs);
  return { date, currency: "BRL", unit: "per home", rows, note: `Windows of 3/6/12/24 months ending ${date}; residential ITBI tax bases (apartments and houses), by bairro.` };
}

/** Distinctive Fortaleza bairros (normalised) that can be recognised without the city name. */
export const FORTALEZA_PLACES = [
  "aldeota", "meireles", "papicu", "mucuripe", "varjota", "dionisio torres", "joaquim tavora", "coco", "praia de iracema", "cidade 2000",
  "edson queiroz", "engenheiro luciano cavalcante", "guararapes", "luciano cavalcante", "parquelandia", "montese", "messejana", "benfica",
  "fatima", "bairro de fatima", "jose bonifacio", "monte castelo", "passare", "mondubim", "presidente kennedy", "barra do ceara", "cais do porto",
];

/** True when the request names Fortaleza or one of its distinctive neighbourhoods, or a Fortaleza CEP (60000-61999). */
export function servesFortaleza(town: string | undefined, postcode?: string): boolean {
  const n = normaliseName(town ?? "");
  if (/\bfortaleza\b/.test(n)) return true;
  const bare = n.replace(/\b(ce|brasil|brazil|bairro)\b/g, " ").replace(/\s+/g, " ").trim();
  if (bare && FORTALEZA_PLACES.includes(bare)) return true;
  return /^6[01]\d{3}-?\d{3}$/.test((postcode ?? "").trim());
}

export function resolveArea(town: string | undefined, known: string[]): { area: string; label: string } | null {
  const n = normaliseName(town ?? "").replace(/\b(fortaleza|ce|brasil|brazil|bairro)\b/g, " ").replace(/\s+/g, " ").trim();
  if (!n) return { area: NATIONAL, label: "Fortaleza" };
  const s = n.replace(/ /g, "-");
  const bare = (x: string) => x.replace(/-(de|do|da|dos|das)(?=-)/g, "");
  const exact = known.find((k) => k === s);
  const loose = exact ?? known.find((k) => bare(k) === bare(s)) ?? known.find((k) => k.length >= 6 && (bare(s).startsWith(bare(k)) || bare(k).startsWith(bare(s))));
  const area = loose ?? (known.length ? null : s);
  if (!area) return null;
  return { area, label: area.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") + ", Fortaleza" };
}

export function fortalezaKey(p: { town?: string; property_type?: string; months?: number }, known: string[]) {
  const place = resolveArea(p.town, known);
  if (!place) return null;
  const t = (p.property_type ?? "any").toLowerCase();
  if (!(TYPES as readonly string[]).includes(t)) return null;
  const v = p.months === undefined || !Number.isFinite(p.months) ? 12 : p.months;
  const months = WINDOWS.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
  return { ...place, type: t as (typeof TYPES)[number], months, item: `${t}:${months}m` };
}

export function fortalezaHistoryKey(p: { town?: string; property_type?: string; months?: number }) {
  const latest = readLatestDay(INFO.id);
  const known = latest ? [...new Set(latest.rows.map((r) => r.area))].filter((a) => a !== NATIONAL) : [];
  const k = fortalezaKey(p, known);
  return k ? { area: k.area, item: k.item, label: `${k.label}, Brazil` } : null;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const R = (v: number) => fmtMoney(v, "BRL");

export function fortalezaAnswerFromRow(
  row: DailyRow & { date: string },
  m2: (DailyRow & { date: string }) | undefined,
  q: { label: string; type: (typeof TYPES)[number]; months: number; baseUrl?: string },
): PriceAnswer {
  const word = q.type === "any" ? "homes" : q.type === "apartment" ? "apartments" : "houses";
  return buildAnswer({
    source: INFO,
    query: { country: "BR", town: q.label, property_type: q.type, months: q.months },
    summary: { count: row.n, median: row.median, low: row.low, high: row.high, min: row.min, max: row.max },
    currency: "BRL",
    unit: "per home (ITBI tax base)",
    period: { from: monthsBack(row.date, q.months), to: row.date },
    method:
      "Brazil, Fortaleza city: median and 10th-90th percentile of the tax base (base de calculo) declared on ITBI property-transfer tax records for residential apartments and houses over the last 3, 6, 12 or 24 months " +
      "(your request is rounded to the nearest) ending at the newest complete month. The tax base is not a verified price paid. Flat or house is inferred from the ideal plot fraction; bases under BRL 30,000 and of BRL 20 million or more are dropped.",
    describe: (x) =>
      `${cap(word)} in ${q.label} had a median ITBI tax base of ${R(x.median)} (typical range ${R(x.low)} to ${R(x.high)})` +
      (m2 && m2.n >= MIN_PUBLISH ? `, a median of ${R(m2.median)} per m2 of built area` : "") +
      `. This is the value the property-transfer tax was charged on in the city's records, which may differ from the price actually paid.`,
    baseUrl: q.baseUrl,
    extra: {
      price_basis: "ITBI tax base, not a verified price paid",
      per_m2: m2 && m2.n >= MIN_PUBLISH ? { median: m2.median, typical_low: m2.low, typical_high: m2.high, sample_size: m2.n, currency: "BRL" } : null,
    },
  });
}

export async function fortalezaHomeSales(input: { town?: string; property_type?: string; months?: number; baseUrl?: string }): Promise<PriceAnswer> {
  const meta = readMeta(INFO.id);
  const latest = readLatestDay(INFO.id);
  if (!meta?.last_date || !latest) throw new SourceError("ProofPrice collects this register daily; data appears after the next collection.");
  const known = [...new Set(latest.rows.map((r) => r.area))].filter((a) => a !== NATIONAL).sort();
  if (input.property_type && !(TYPES as readonly string[]).includes(input.property_type.toLowerCase())) {
    throw new InputError(`property_type must be one of: ${TYPES.join(", ")}`);
  }
  const k = fortalezaKey(input, known);
  if (!k) {
    throw new InputError(`Unknown neighbourhood '${input.town}'. Give a Fortaleza neighbourhood (bairro) such as Aldeota, Meireles or Papicu, or leave town out for the whole city. Neighbourhoods with enough transfers: ${known.join(", ")}.`);
  }
  const to = meta.last_date;
  const from = new Date(Date.parse(to + "T00:00:00Z") - 60 * 86400000).toISOString().slice(0, 10);
  const pick = (item: string) => { const r = readDaily(INFO.id, { area: k.area, item, from, to }); return r[r.length - 1]; };
  let row = pick(k.item), usedMonths = k.months, widened = false;
  if (!row || row.n < MIN_PUBLISH) {
    for (const m of WINDOWS) {
      if (m <= k.months) continue;
      const r = pick(`${k.type}:${m}m`);
      if (r && r.n >= MIN_PUBLISH) { row = r; usedMonths = m; widened = true; break; }
    }
  }
  const word = k.type === "any" ? "homes" : k.type === "apartment" ? "apartments" : "houses";
  if (!row || row.n < MIN_PUBLISH) {
    const a = buildAnswer({
      source: INFO, query: { country: "BR", town: k.label, property_type: k.type, months: k.months },
      summary: null, currency: "BRL", unit: "per home (ITBI tax base)", period: { from: null, to: null },
      method: "Rolling windows of the Fortaleza ITBI records.", describe: () => "", baseUrl: input.baseUrl,
      extra: { reason: `Fewer than ${MIN_PUBLISH} ${word} transfers in ${k.label} in any window up to 24 months` },
    });
    a.summary = `Fewer than ${MIN_PUBLISH} ${word} transfers are recorded in ${k.label} in the last 24 months, so no price range is published (it would identify individual sales). Try the whole city by leaving town out.`;
    return a;
  }
  const m2row = pick(`${k.type}-m2:${usedMonths}m`);
  const a = fortalezaAnswerFromRow(row, m2row, { label: k.label, type: k.type, months: usedMonths, baseUrl: input.baseUrl });
  if (widened) {
    (a.query as Record<string, unknown>).months = k.months;
    a.summary = `Fewer than ${MIN_PUBLISH} ${word} transfers in ${k.label} in the last ${k.months} months, so this uses the last ${usedMonths} months. ` + a.summary;
    a.extra = { ...(a.extra ?? {}), requested_months: k.months, window_months: usedMonths, window_widened: true };
  }
  return a;
}
