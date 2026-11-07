// Brazil (Belo Horizonte city) home sales from the city's ITBI open data (Prefeitura de Belo Horizonte, Portal de Dados Abertos,
// dataset "ITBI Relatorios", CC BY). One row = one property-transfer tax (ITBI) declaration settled in a month, with the value the buyer
// DECLARED ("Valor Declarado": acquisition value declared by the taxpayer, per the publisher's data dictionary), the neighbourhood, the
// occupation (residential or not), the main building type (AP flat, CA house, ...) and the built area acquired. The declared value is not a
// verified price paid, so every answer says "declared transaction value".
// Streets, postcodes and building numbers are never kept: each row is reduced in memory to (month, bairro, kind, value, area) and only
// aggregates reach the library. Bulk files (one CSV a month, about 0.4 MB each) => the daily collector (harvest) reads the newest 24
// monthly files once; requests are answered from the library. The 80 MB back-file (2008 to May 2024) is not needed for a 24-month window.

import { InputError, SourceError, retryOnce } from "../../lib/http";
import { MIN_PUBLISH } from "../../lib/stats";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { ckanPackage } from "../../lib/adapters";
import { aggregateDaily, NATIONAL } from "../../lib/library/aggregate";
import { readDaily, readLatestDay, readMeta } from "../../lib/library/store";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";

export const INFO: SourceInfo = {
  id: "br-itbi-bh",
  country: "BR (Belo Horizonte city only)",
  category: "home sales (ITBI property-transfer tax declarations)",
  name: "ITBI, property transfers in the city of Belo Horizonte",
  publisher: "Prefeitura de Belo Horizonte (PBH), Secretaria Municipal de Fazenda, Portal de Dados Abertos",
  what_is_recorded:
    "Property-transfer tax (ITBI) declarations settled in the city of Belo Horizonte, one per transfer: the value declared by the taxpayer in BRL, the neighbourhood, the occupation, the main building type (flat or house) and the built area acquired. Streets and building numbers are not used.",
  price_type: "posted_price",
  freshness: "The city publishes one file a month, a few weeks after the month ends (record changed 2026-11-03). Each answer names the period it covers.",
  licence: "Creative Commons Attribution (CC BY), as stated in the dataset record on the PBH open-data portal.",
  licence_url: "https://opendefinition.org/licenses/cc-by",
  attribution:
    "Source: Prefeitura de Belo Horizonte, Portal de Dados Abertos, ITBI Relatorios, CC BY. Changed by ProofPrice: only residential flats and houses, medians and percentiles computed by neighbourhood over rolling windows.",
  homepage: "https://dados.pbh.gov.br/dataset/itbi-relatorios",
  limits:
    "Belo Horizonte city only, not the rest of Brazil. The figure is the value declared by the taxpayer for the ITBI transfer tax, not a verified price paid. " +
    "Residential flats (AP) and houses (CA) only; other building types (small sheds, shops, offices, garages, land) are left out; values under BRL 30,000 and of BRL 20 million or more are dropped. " +
    "The city does not say whether a transfer was of the whole property or a share: a share transfer shows a proportional value, so per-home figures can be slightly low (per-m2 figures use the area acquired and are not affected). " +
    "The newest month is left out while it is still being filled in. Aggregates only, by neighbourhood (bairro) and rolling window; never streets or owners.",
  method_version: "1",
};

export const SITE = "https://dados.pbh.gov.br";
export const DATASET = "itbi-relatorios";
export const WINDOWS = [3, 6, 12, 24] as const;
export const TYPES = ["any", "apartment", "house"] as const;
export type Kind = "apartment" | "house";
export const MIN_VALUE = 30_000;
export const MAX_VALUE = 20_000_000; // exclusive
export const M2_RANGE: [number, number] = [500, 60_000]; // BRL per m2 of built area
export const MIN_AREA = 15; // m2 to count a price per m2
export const FILES_TO_READ = 25; // 24-month window plus one spare in case the newest month is dropped as incomplete

/** One transfer, reduced: no street, no owner. */
export interface Rec { ym: number; area: string; kind: Kind; value: number; m2: number | null }

export function normaliseName(raw: string): string {
  return raw.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
export const slug = (raw: string) => normaliseName(raw).replace(/ /g, "-");

/** Brazilian money/area: "1265,78" -> 1265.78, "430000" -> 430000, "195985.06" -> 195985.06 (the city mixes comma and dot decimals); "" -> NaN. */
export function brNumber(s: string): number {
  const t = (s ?? "").trim();
  if (!t) return NaN;
  if (t.includes(",")) return Number(t.replace(/\./g, "").replace(",", "."));
  return Number(t);
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

// Columns are found by their normalised header ("Descrição Tipo Ocupacao (Unidade)" -> "descricao tipo ocupacao unidade").
const NEEDED = {
  bairro: "bairro",
  type: "tipo construtivo preponderante",
  occupation: "descricao tipo ocupacao unidade",
  area: "area construida adquirida",
  value: "valor declarado",
  date: "data quitacao",
} as const;

/** Parse one monthly CSV into plausible residential records. Reads columns by name; streets are never read. */
export function parseItbi(text: string): Rec[] {
  const rows = parseCsv(text.replace(/^﻿/, ""));
  if (!rows.length) return [];
  const head = rows[0].map((h) => normaliseName(h));
  const ix = {} as Record<keyof typeof NEEDED, number>;
  for (const k of Object.keys(NEEDED) as (keyof typeof NEEDED)[]) {
    ix[k] = head.indexOf(NEEDED[k]);
    if (ix[k] < 0) throw new SourceError("The Belo Horizonte ITBI file has an unexpected format (columns changed)", head.join(",").slice(0, 200));
  }
  const out: Rec[] = [];
  for (let r = 1; r < rows.length; r++) {
    const f = rows[r];
    if (normaliseName(f[ix.occupation] ?? "") !== "residencial") continue;
    const t = (f[ix.type] ?? "").trim().toUpperCase();
    const kind: Kind | null = t === "AP" ? "apartment" : t === "CA" ? "house" : null;
    if (!kind) continue;
    const value = brNumber(f[ix.value]);
    if (!Number.isFinite(value) || value < MIN_VALUE || value >= MAX_VALUE) continue;
    const d = /^(\d{2})\/(\d{2})\/(\d{4})/.exec((f[ix.date] ?? "").trim());
    if (!d) continue;
    const y = Number(d[3]), m = Number(d[2]);
    if (m < 1 || m > 12 || y < 2000) continue;
    const area = slug(f[ix.bairro] ?? "");
    if (!area) continue;
    const a = brNumber(f[ix.area]);
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
  if (!months.length) throw new SourceError("The Belo Horizonte ITBI files held no usable residential records");
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

export interface MonthFile { ym: number; url: string; modified: string }

/** The monthly CSV files of the dataset, newest first. Names are not fully regular (202407 is "..._corrigido"), so the month is read from the file name
 *  "pda_itbi_relatorio_YYYYMM"; the 80 MB back-file "..._200801_a_202405" has no single month and is skipped. If a month appears twice the newer upload wins. */
export function monthFiles(resources: { format: string; url: string; modified: string | null }[]): MonthFile[] {
  const byMonth = new Map<number, MonthFile>();
  for (const r of resources) {
    if (r.format !== "CSV") continue;
    const m = /pda_itbi_relatorio_(\d{4})(\d{2})(?!\d|_a_)/.exec(r.url);
    if (!m) continue;
    const y = Number(m[1]), mo = Number(m[2]);
    if (y < 2000 || mo < 1 || mo > 12) continue;
    const ym = y * 12 + (mo - 1), modified = r.modified ?? "";
    const old = byMonth.get(ym);
    if (!old || modified >= old.modified) byMonth.set(ym, { ym, url: r.url, modified });
  }
  return [...byMonth.values()].sort((a, b) => b.ym - a.ym);
}

const UA = "ProofPrice/1.0 (+https://proofprice.com; hello@proofprice.com)";
async function fetchText(url: string): Promise<string> {
  return retryOnce(async () => {
    const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new SourceError(`Belo Horizonte open data returned HTTP ${res.status}`, url, res.status);
    return new TextDecoder("utf-8").decode(new Uint8Array(await res.arrayBuffer()));
  });
}

/** Read the newest monthly files (four at a time) and reduce them. Any file that fails fails the run: a window with a hole in it must not be published. */
export async function readMonths(files: MonthFile[], get: (url: string) => Promise<string> = fetchText): Promise<Rec[]> {
  const chosen = files.slice(0, FILES_TO_READ);
  const out: Rec[][] = new Array(chosen.length);
  let next = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < chosen.length) {
      const i = next++;
      out[i] = parseItbi(await get(chosen[i].url));
    }
  }));
  return out.flat();
}

/** The daily collector: finds the monthly files through the portal's package_show, reads the newest 25, reduces them to aggregates. */
export async function bhHarvest(): Promise<HarvestResult> {
  const pkg = await ckanPackage(SITE, DATASET);
  if (pkg.licenceId && pkg.licenceId !== "cc-by") throw new SourceError(`The Belo Horizonte ITBI dataset licence changed to ${pkg.licenceId}; check it before collecting`);
  const files = monthFiles(pkg.resources);
  if (files.length < 12) throw new SourceError("The Belo Horizonte ITBI dataset lists fewer monthly files than expected", `${files.length} files`);
  const recs = await readMonths(files);
  if (!recs.length) throw new SourceError("The Belo Horizonte ITBI files returned no usable residential rows");
  const { date, rows } = dailyRows(recs);
  return { date, currency: "BRL", unit: "per home", rows, note: `Windows of 3/6/12/24 months ending ${date}; residential ITBI declared transaction values (flats and houses), by bairro.` };
}

/** Distinctive Belo Horizonte bairros (normalised) that can be recognised without the city name. Names shared with other Brazilian cities
 *  (Copacabana, Centro, Castelo, Floresta, Santo Antonio...) are left out on purpose: they need "Belo Horizonte" in the request. */
export const BH_PLACES = [
  "buritis", "lourdes", "sion", "savassi", "funcionarios", "sagrada familia", "nova suissa", "santo agostinho", "cidade nova", "santa efigenia",
  "carlos prates", "padre eustaquio", "barro preto", "mangabeiras", "belvedere", "pampulha", "gutierrez", "anchieta", "coracao eucaristico",
  "santa tereza", "luxemburgo", "castelo branco", "ouro preto", "dom cabral", "prado", "sao luiz", "nova granada", "cidade jardim",
];

/** True when the request names Belo Horizonte or one of its distinctive neighbourhoods, or a Belo Horizonte CEP (30100-31999). */
export function servesBh(town: string | undefined, postcode?: string): boolean {
  const n = normaliseName(town ?? "");
  if (/\bbelo horizonte\b/.test(n) || /^bh$/.test(n) || /\bbh\b.*\bmg\b/.test(n)) return true;
  const bare = n.replace(/\b(mg|brasil|brazil|bairro)\b/g, " ").replace(/\s+/g, " ").trim();
  if (bare && BH_PLACES.includes(bare)) return true;
  return /^3[01]\d{3}-?\d{3}$/.test((postcode ?? "").trim());
}

export function resolveArea(town: string | undefined, known: string[]): { area: string; label: string } | null {
  const n = normaliseName(town ?? "").replace(/\b(belo horizonte|mg|brasil|brazil|bairro)\b/g, " ").replace(/\s+/g, " ").trim();
  if (!n) return { area: NATIONAL, label: "Belo Horizonte" };
  const s = n.replace(/ /g, "-");
  const bare = (x: string) => x.replace(/-(de|do|da|dos|das)(?=-)/g, "");
  const exact = known.find((k) => k === s);
  const loose = exact ?? known.find((k) => bare(k) === bare(s)) ?? known.find((k) => k.length >= 6 && (bare(s).startsWith(bare(k)) || bare(k).startsWith(bare(s))));
  const area = loose ?? (known.length ? null : s);
  if (!area) return null;
  return { area, label: area.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") + ", Belo Horizonte" };
}

export function bhKey(p: { town?: string; property_type?: string; months?: number }, known: string[]) {
  const place = resolveArea(p.town, known);
  if (!place) return null;
  const t = (p.property_type ?? "any").toLowerCase();
  if (!(TYPES as readonly string[]).includes(t)) return null;
  const v = p.months === undefined || !Number.isFinite(p.months) ? 12 : p.months;
  const months = WINDOWS.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
  return { ...place, type: t as (typeof TYPES)[number], months, item: `${t}:${months}m` };
}

export function bhHistoryKey(p: { town?: string; property_type?: string; months?: number }) {
  const latest = readLatestDay(INFO.id);
  const known = latest ? [...new Set(latest.rows.map((r) => r.area))].filter((a) => a !== NATIONAL) : [];
  const k = bhKey(p, known);
  return k ? { area: k.area, item: k.item, label: `${k.label}, Brazil` } : null;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const R = (v: number) => fmtMoney(v, "BRL");

export function bhAnswerFromRow(
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
    unit: "per home (declared transaction value)",
    period: { from: monthsBack(row.date, q.months), to: row.date },
    method:
      "Brazil, Belo Horizonte city: median and 10th-90th percentile of the value declared by the taxpayer on ITBI property-transfer tax records (Valor Declarado) for residential apartments and houses over the last 3, 6, 12 or 24 months " +
      "(your request is rounded to the nearest) ending at the newest complete month. The declared value is not a verified price paid. Flat or house comes from the city's building type (AP, CA); values under BRL 30,000 and of BRL 20 million or more are dropped.",
    describe: (x) =>
      `${cap(word)} in ${q.label} had a median declared transaction value of ${R(x.median)} (typical range ${R(x.low)} to ${R(x.high)})` +
      (m2 && m2.n >= MIN_PUBLISH ? `, a median of ${R(m2.median)} per m2 of built area` : "") +
      `. This is the value declared for the property-transfer tax in the city's records, which may differ from the price actually paid.`,
    baseUrl: q.baseUrl,
    extra: {
      price_basis: "declared transaction value, not a verified price paid",
      per_m2: m2 && m2.n >= MIN_PUBLISH ? { median: m2.median, typical_low: m2.low, typical_high: m2.high, sample_size: m2.n, currency: "BRL" } : null,
    },
  });
}

export async function bhHomeSales(input: { town?: string; property_type?: string; months?: number; baseUrl?: string }): Promise<PriceAnswer> {
  const meta = readMeta(INFO.id);
  const latest = readLatestDay(INFO.id);
  if (!meta?.last_date || !latest) throw new SourceError("ProofPrice collects this register daily; data appears after the next collection.");
  const known = [...new Set(latest.rows.map((r) => r.area))].filter((a) => a !== NATIONAL).sort();
  if (input.property_type && !(TYPES as readonly string[]).includes(input.property_type.toLowerCase())) {
    throw new InputError(`property_type must be one of: ${TYPES.join(", ")}`);
  }
  const k = bhKey(input, known);
  if (!k) {
    throw new InputError(`Unknown neighbourhood '${input.town}'. Give a Belo Horizonte neighbourhood (bairro) such as Savassi, Buritis or Lourdes, or leave town out for the whole city. Neighbourhoods with enough transfers: ${known.join(", ")}.`);
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
      summary: null, currency: "BRL", unit: "per home (declared transaction value)", period: { from: null, to: null },
      method: "Rolling windows of the Belo Horizonte ITBI records.", describe: () => "", baseUrl: input.baseUrl,
      extra: { reason: `Fewer than ${MIN_PUBLISH} ${word} transfers in ${k.label} in any window up to 24 months` },
    });
    a.summary = `Fewer than ${MIN_PUBLISH} ${word} transfers are recorded in ${k.label} in the last 24 months, so no price range is published (it would identify individual sales). Try the whole city by leaving town out.`;
    return a;
  }
  const m2row = pick(`${k.type}-m2:${usedMonths}m`);
  const a = bhAnswerFromRow(row, m2row, { label: k.label, type: k.type, months: usedMonths, baseUrl: input.baseUrl });
  if (widened) {
    (a.query as Record<string, unknown>).months = k.months;
    a.summary = `Fewer than ${MIN_PUBLISH} ${word} transfers in ${k.label} in the last ${k.months} months, so this uses the last ${usedMonths} months. ` + a.summary;
    a.extra = { ...(a.extra ?? {}), requested_months: k.months, window_months: usedMonths, window_widened: true };
  }
  return a;
}
