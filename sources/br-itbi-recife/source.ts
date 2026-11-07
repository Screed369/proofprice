// Brazil (Recife city) home sales from the city's ITBI open data (Prefeitura do Recife, Portal de Dados Abertos / EMPREL, ODbL).
// One row = one property-transfer tax (ITBI) record with the municipal ASSESSED value (valor_avaliacao, the tax base), the bairro,
// the kind of property, the occupation and the built area. The assessed value is NOT stated to be the price paid, so every answer says
// "ITBI assessed value", never "price paid". Streets, numbers, complements, coordinates and plot data are never read: each row is
// reduced in memory to (month, bairro, kind, value, area) and only aggregates reach the library (ODbL share-alike therefore does not
// attach to anything we publish; the attribution is kept). Yearly files of about 4 MB => the daily collector (harvest) reads the
// newest three once; requests are answered from the library.

import { InputError, SourceError } from "../../lib/http";
import { MIN_PUBLISH } from "../../lib/stats";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { aggregateDaily, NATIONAL } from "../../lib/library/aggregate";
import { readDaily, readLatestDay, readMeta } from "../../lib/library/store";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";

export const INFO: SourceInfo = {
  id: "br-itbi-recife",
  country: "BR (Recife city only)",
  category: "home sales (ITBI property-transfer tax records, assessed value)",
  name: "ITBI, property transfers in the city of Recife",
  publisher: "Prefeitura do Recife, Portal de Dados Abertos (EMPREL), dataset 'Imposto sobre Transmissao de Bens Imoveis (ITBI)'",
  what_is_recorded:
    "Property-transfer tax (ITBI) records in the city of Recife, one per transfer: the municipal assessed value in BRL that the tax is charged on (valor de avaliacao), the neighbourhood, the kind of property, the occupation and the built area. Streets, numbers and coordinates are not used.",
  price_type: "posted_price",
  freshness: "The city refreshes the current-year file during the year (CKAN record changed 2026-11-03). Each answer names the period it covers.",
  licence: "Open Data Commons Open Database License (ODbL), as stated on the dataset page and in the CKAN record of the Recife open data portal.",
  licence_url: "https://opendatacommons.org/licenses/odbl/1-0/",
  attribution:
    "Source: Prefeitura do Recife, Portal de Dados Abertos, ITBI dataset (ODbL). Changed by ProofPrice: only residential apartments and houses, medians and percentiles computed by neighbourhood over rolling windows; no row-level data is published.",
  homepage: "https://dados.recife.pe.gov.br/dataset/imposto-sobre-transmissao-de-bens-imoveis-itbi",
  limits:
    "Recife city only, not the rest of Brazil or the metropolitan area. The figure is the municipal ASSESSED value used as the ITBI tax base, not a verified price paid. " +
    "Residential apartments (Apartamento) and houses (Casa) only; commercial uses, rooms, shops and garages are left out; duplicate lines, values under BRL 30,000 and of BRL 20 million or more are dropped. " +
    "The newest month is left out while it is still being filled in. Aggregates only, by neighbourhood (bairro) and rolling window; never streets or owners.",
  method_version: "1",
};

export const PACKAGE_URL = "https://dados.recife.pe.gov.br/api/3/action/package_show?id=imposto-sobre-transmissao-de-bens-imoveis-itbi";
export const WINDOWS = [3, 6, 12, 24] as const;
export const TYPES = ["any", "apartment", "house"] as const;
export type Kind = "apartment" | "house";
export const MIN_VALUE = 30_000;
export const MAX_VALUE = 20_000_000; // exclusive
export const M2_RANGE: [number, number] = [1_000, 60_000]; // BRL per m2 of built area
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

const NEEDED = ["bairro", "tipo_imovel", "tipo_ocupacao", "area_construida", "valor_avaliacao", "data_transacao"] as const;

/** Parse the CSV into plausible residential records. Reads columns by name; streets, numbers and coordinates are never read.
 *  Exact duplicate lines (same address, date, value) are dropped; the address columns are used only to build that in-memory key. */
export function parseItbi(text: string): Rec[] {
  const rows = parseCsv(text.replace(/^\uFEFF/, ""));
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const ix: Record<string, number> = {};
  for (const n of NEEDED) {
    ix[n] = head.indexOf(n);
    if (ix[n] < 0) throw new SourceError("The Recife ITBI file has an unexpected format (columns changed)", head.join(",").slice(0, 200));
  }
  const keyCols = ["logradouro", "numero", "complemento"].map((n) => head.indexOf(n));
  const seen = new Set<string>();
  const out: Rec[] = [];
  for (let r = 1; r < rows.length; r++) {
    const f = rows[r];
    if (normaliseName(f[ix.tipo_ocupacao] ?? "") !== "residencial") continue;
    const t = normaliseName(f[ix.tipo_imovel] ?? "");
    const kind: Kind | null = t === "apartamento" ? "apartment" : t === "casa" ? "house" : null;
    if (!kind) continue;
    const value = brNumber(f[ix.valor_avaliacao]);
    if (!Number.isFinite(value) || value < MIN_VALUE || value >= MAX_VALUE) continue;
    const d = /^(\d{4})-(\d{2})-(\d{2})/.exec((f[ix.data_transacao] ?? "").trim());
    if (!d) continue;
    const y = Number(d[1]), m = Number(d[2]);
    if (m < 1 || m > 12 || y < 2000) continue;
    const area = slug(f[ix.bairro] ?? "");
    if (!area || area === "indefinido") continue;
    const dupKey = keyCols.map((c) => (c >= 0 ? (f[c] ?? "").trim().toLowerCase() : "")).join("|") + "|" + d[0] + "|" + value;
    if (seen.has(dupKey)) continue;
    seen.add(dupKey);
    const a = brNumber(f[ix.area_construida]);
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
  if (!months.length) throw new SourceError("The Recife ITBI file held no usable residential records");
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

const UA = { "user-agent": "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)" };

/** The yearly CSV urls listed in the publisher's CKAN record, newest year first. Resource names read "ITBI 2026 - Imposto ...". */
export function csvUrls(pkg: any): { year: number; url: string }[] {
  const res: any[] = pkg?.result?.resources ?? [];
  const out: { year: number; url: string }[] = [];
  for (const r of res) {
    if (!r?.url || String(r.format ?? "").toUpperCase() !== "CSV") continue;
    const m = /\bITBI\s+(\d{4})\b/i.exec(String(r.name ?? ""));
    if (m) out.push({ year: Number(m[1]), url: String(r.url) });
  }
  return out.sort((a, b) => b.year - a.year);
}

async function get(url: string): Promise<Response> {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(90_000), redirect: "follow" });
  if (!res.ok) throw new SourceError(`Recife open data returned HTTP ${res.status}`, url, res.status);
  return res;
}

/** The daily collector: the newest three yearly files (about 4 MB each) cover the 24-month window. */
export async function recifeHarvest(): Promise<HarvestResult> {
  const pkg = await (await get(PACKAGE_URL)).json();
  const files = csvUrls(pkg).slice(0, 3);
  if (!files.length) throw new SourceError("No ITBI yearly files found in the publisher's record");
  const recs: Rec[] = [];
  for (const f of files) recs.push(...parseItbi(await (await get(f.url)).text()));
  if (!recs.length) throw new SourceError("The Recife ITBI files returned no usable residential rows");
  const { date, rows } = dailyRows(recs);
  return { date, currency: "BRL", unit: "per home", rows, note: `Windows of 3/6/12/24 months ending ${date}; residential ITBI assessed values (apartments and houses), by bairro.` };
}

/** Distinctive Recife bairros (normalised) that can be recognised without the city name. Names shared with Rio or Fortaleza are left out. */
export const RECIFE_PLACES = [
  "boa viagem", "imbiribeira", "varzea", "pina", "madalena", "casa amarela", "casa forte", "espinheiro", "gracas", "derby", "parnamirim",
  "apipucos", "encruzilhada", "afogados", "iputinga", "tamarineira", "aflitos", "jaqueira", "rosarinho", "ilha do leite", "paissandu",
  "brasilia teimosa", "dois unidos", "dois irmaos", "cordeiro", "ipsep", "torreao", "ilha do retiro", "sitio dos pintos", "mustardinha",
  "bongi", "jiquia", "tejipio", "arruda", "hipodromo", "beberibe", "ibura", "cabanga",
];

/** True when the request names Recife or one of its distinctive neighbourhoods, or a Recife CEP (50000-52999). */
export function servesRecife(town: string | undefined, postcode?: string): boolean {
  const n = normaliseName(town ?? "");
  if (/\brecife\b/.test(n)) return true;
  const bare = n.replace(/\b(pe|brasil|brazil|bairro)\b/g, " ").replace(/\s+/g, " ").trim();
  if (bare && RECIFE_PLACES.includes(bare)) return true;
  return /^5[0-2]\d{3}-?\d{3}$/.test((postcode ?? "").trim());
}

export function resolveArea(town: string | undefined, known: string[]): { area: string; label: string } | null {
  const n = normaliseName(town ?? "").replace(/\b(recife|pe|brasil|brazil|bairro)\b/g, " ").replace(/\s+/g, " ").trim();
  if (!n) return { area: NATIONAL, label: "Recife" };
  const s = n.replace(/ /g, "-");
  const bare = (x: string) => x.replace(/-(de|do|da|dos|das)(?=-)/g, "");
  const exact = known.find((k) => k === s);
  const loose = exact ?? known.find((k) => bare(k) === bare(s)) ?? known.find((k) => k.length >= 6 && (bare(s).startsWith(bare(k)) || bare(k).startsWith(bare(s))));
  const area = loose ?? (known.length ? null : s);
  if (!area) return null;
  return { area, label: area.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") + ", Recife" };
}

export function recifeKey(p: { town?: string; property_type?: string; months?: number }, known: string[]) {
  const place = resolveArea(p.town, known);
  if (!place) return null;
  const t = (p.property_type ?? "any").toLowerCase();
  if (!(TYPES as readonly string[]).includes(t)) return null;
  const v = p.months === undefined || !Number.isFinite(p.months) ? 12 : p.months;
  const months = WINDOWS.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
  return { ...place, type: t as (typeof TYPES)[number], months, item: `${t}:${months}m` };
}

export function recifeHistoryKey(p: { town?: string; property_type?: string; months?: number }) {
  const latest = readLatestDay(INFO.id);
  const known = latest ? [...new Set(latest.rows.map((r) => r.area))].filter((a) => a !== NATIONAL) : [];
  const k = recifeKey(p, known);
  return k ? { area: k.area, item: k.item, label: `${k.label}, Brazil` } : null;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const R = (v: number) => fmtMoney(v, "BRL");

export function recifeAnswerFromRow(
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
    unit: "per home (ITBI assessed value)",
    period: { from: monthsBack(row.date, q.months), to: row.date },
    method:
      "Brazil, Recife city: median and 10th-90th percentile of the tax base (base de calculo) declared on ITBI property-transfer tax records for residential apartments and houses over the last 3, 6, 12 or 24 months " +
      "(your request is rounded to the nearest) ending at the newest complete month. The assessed value is not a verified price paid. Duplicate lines are dropped; values under BRL 30,000 and of BRL 20 million or more are dropped.",
    describe: (x) =>
      `${cap(word)} in ${q.label} had a median ITBI assessed value of ${R(x.median)} (typical range ${R(x.low)} to ${R(x.high)})` +
      (m2 && m2.n >= MIN_PUBLISH ? `, a median of ${R(m2.median)} per m2 of built area` : "") +
      `. This is the municipal assessed value the property-transfer tax is charged on, which may differ from the price actually paid.`,
    baseUrl: q.baseUrl,
    extra: {
      price_basis: "ITBI assessed value (valor de avaliacao), not a verified price paid",
      per_m2: m2 && m2.n >= MIN_PUBLISH ? { median: m2.median, typical_low: m2.low, typical_high: m2.high, sample_size: m2.n, currency: "BRL" } : null,
    },
  });
}

export async function recifeHomeSales(input: { town?: string; property_type?: string; months?: number; baseUrl?: string }): Promise<PriceAnswer> {
  const meta = readMeta(INFO.id);
  const latest = readLatestDay(INFO.id);
  if (!meta?.last_date || !latest) throw new SourceError("ProofPrice collects this register daily; data appears after the next collection.");
  const known = [...new Set(latest.rows.map((r) => r.area))].filter((a) => a !== NATIONAL).sort();
  if (input.property_type && !(TYPES as readonly string[]).includes(input.property_type.toLowerCase())) {
    throw new InputError(`property_type must be one of: ${TYPES.join(", ")}`);
  }
  const k = recifeKey(input, known);
  if (!k) {
    throw new InputError(`Unknown neighbourhood '${input.town}'. Give a Recife neighbourhood (bairro) such as Boa Viagem, Pina or Casa Forte, or leave town out for the whole city. Neighbourhoods with enough transfers: ${known.join(", ")}.`);
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
      summary: null, currency: "BRL", unit: "per home (ITBI assessed value)", period: { from: null, to: null },
      method: "Rolling windows of the Recife ITBI records.", describe: () => "", baseUrl: input.baseUrl,
      extra: { reason: `Fewer than ${MIN_PUBLISH} ${word} transfers in ${k.label} in any window up to 24 months` },
    });
    a.summary = `Fewer than ${MIN_PUBLISH} ${word} transfers are recorded in ${k.label} in the last 24 months, so no price range is published (it would identify individual sales). Try the whole city by leaving town out.`;
    return a;
  }
  const m2row = pick(`${k.type}-m2:${usedMonths}m`);
  const a = recifeAnswerFromRow(row, m2row, { label: k.label, type: k.type, months: usedMonths, baseUrl: input.baseUrl });
  if (widened) {
    (a.query as Record<string, unknown>).months = k.months;
    a.summary = `Fewer than ${MIN_PUBLISH} ${word} transfers in ${k.label} in the last ${k.months} months, so this uses the last ${usedMonths} months. ` + a.summary;
    a.extra = { ...(a.extra ?? {}), requested_months: k.months, window_months: usedMonths, window_widened: true };
  }
  return a;
}
