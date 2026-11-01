// Brazil (Rio de Janeiro city) home sales from the city's ITBI open data (Prefeitura do Rio, Secretaria Municipal de Fazenda,
// ArcGIS MapServer Fazenda/ITBI layer 8, CC BY 4.0). One row = one street x month x use x property type, already an AVERAGE of 1 or
// more property-transfer tax (ITBI) declarations; "total_transações" says how many. The value is the transaction value declared for the
// transfer tax, so every answer is labelled "declared transaction value", never "price paid".
// Streets are never kept: each row is reduced in memory to (month, neighbourhood, kind, value, area, weight) and only aggregates reach
// the library. Each row counts as total_transações records (street-month averages weighted by the number of transfers).
// Bulk layer => the daily collector (harvest) reads the newest 24 months once; requests are answered from the library.

import { InputError, SourceError } from "../../lib/http";
import { MIN_PUBLISH } from "../../lib/stats";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { arcgisAll } from "../../lib/adapters";
import { aggregateDaily, NATIONAL } from "../../lib/library/aggregate";
import { readDaily, readLatestDay, readMeta } from "../../lib/library/store";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";

export const INFO: SourceInfo = {
  id: "br-itbi-rio",
  country: "BR (Rio de Janeiro city only)",
  category: "home sales (ITBI property-transfer tax declarations)",
  name: "ITBI, property transfers in the city of Rio de Janeiro",
  publisher: "Prefeitura da Cidade do Rio de Janeiro, Secretaria Municipal de Fazenda, via data.rio",
  what_is_recorded:
    "Property-transfer tax (ITBI) declarations in the city of Rio de Janeiro, grouped by street and month by the city: the average declared transaction value in BRL, the number of transfers, the average built area, the use and the main property type, with the neighbourhood.",
  price_type: "posted_price",
  freshness: "The city updates the layer monthly; the newest month is dropped by the publisher from June 2026. Each answer names the period it covers.",
  licence: "Creative Commons Attribution 4.0 International (CC BY 4.0), as stated in the layer's licence information on the publisher's open-data hub.",
  licence_url: "https://creativecommons.org/licenses/by/4.0",
  attribution:
    "Source: Prefeitura da Cidade do Rio de Janeiro, Secretaria Municipal de Fazenda, ITBI, data.rio, CC BY 4.0. Changed by ProofPrice: only residential purchase-and-sale transfers of apartments and houses, medians and percentiles computed over the city's street-month averages weighted by the number of transfers.",
  homepage: "https://pgeo3.rio.rj.gov.br/arcgis/rest/services/Fazenda/ITBI/MapServer/8",
  limits:
    "Rio de Janeiro city only, not the rest of Brazil. The figure is the transaction value declared for the transfer tax (ITBI), not a verified price paid. " +
    "The city publishes street-month averages, not single sales, so ranges are spread between street-month averages and are narrower than single sales would give. " +
    "Residential apartments and houses bought and sold in full (100% transferred) only (promises of sale, parking spaces, rooms and commercial property are left out); values under BRL 30,000 and of BRL 20 million or more are dropped. " +
    "Aggregates only, by neighbourhood (bairro) and rolling window; never streets.",
  method_version: "1",
};

export const LAYER_URL = "https://pgeo3.rio.rj.gov.br/arcgis/rest/services/Fazenda/ITBI/MapServer/8";
export const WINDOWS = [3, 6, 12, 24] as const;
export const TYPES = ["any", "apartment", "house"] as const;
export type Kind = "apartment" | "house";
export const MIN_VALUE = 30_000;
export const MAX_VALUE = 20_000_000; // exclusive
export const M2_RANGE: [number, number] = [1_000, 60_000]; // BRL per m2 of built area
export const MIN_AREA = 15; // m2 to count a price per m2
export const MAX_WEIGHT = 60; // most transfers one street-month row counts as

/** One street-month group, reduced: no street. */
export interface Group { ym: number; area: string; kind: Kind; value: number; m2: number | null; weight: number }

/** Lower-case, strip accents and punctuation: "Jacarepaguá  " -> "jacarepagua". */
export function normaliseName(raw: string): string {
  return raw.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
export const slug = (raw: string) => normaliseName(raw).replace(/ /g, "-");

export function kindOf(tipologia: string): Kind | null {
  const t = normaliseName(tipologia);
  if (t === "apartamento") return "apartment";
  if (t === "casa") return "house";
  return null;
}

/** Parse the attribute rows of the ArcGIS layer into plausible residential groups. Reads fields by name; streets are never read. */
export function parseRows(rows: Record<string, any>[]): Group[] {
  const out: Group[] = [];
  if (rows.length && !("média_valor_transação" in rows[0] && "bairro" in rows[0] && "ano_transação" in rows[0])) {
    throw new SourceError("The Rio ITBI layer has an unexpected format (fields changed)", Object.keys(rows[0]).join(",").slice(0, 200));
  }
  for (const r of rows) {
    if (normaliseName(String(r["uso"] ?? "")) !== "residencial") continue;
    if (!/compra e venda/i.test(String(r["principal_transação_mercado"] ?? "").normalize("NFD").replace(/[̀-ͯ]/g, ""))) continue;
    const perc = Number(r["média_percentual_transferido"]);
    if (!Number.isFinite(perc) || perc < 99.5) continue;
    const kind = kindOf(String(r["principais_tipologias"] ?? ""));
    if (!kind) continue;
    const y = Number(r["ano_transação"]), m = Number(r["mês_transação"]);
    const value = Number(r["média_valor_transação"]);
    const n = Math.floor(Number(r["total_transações"]));
    const area = slug(String(r["bairro"] ?? ""));
    if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12 || y < 2000 || !Number.isFinite(value) || !Number.isFinite(n) || n < 1 || !area) continue;
    if (value < MIN_VALUE || value >= MAX_VALUE) continue;
    const a = Number(r["média_área_construída"]);
    let m2: number | null = null;
    if (Number.isFinite(a) && a >= MIN_AREA) {
      const v = value / a;
      if (v >= M2_RANGE[0] && v <= M2_RANGE[1]) m2 = v;
    }
    out.push({ ym: y * 12 + (m - 1), area, kind, value, m2, weight: Math.min(n, MAX_WEIGHT) });
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

/** Aggregates for every window ending at the newest month. Items: "<type>:<N>m" (BRL per home) and "<type>-m2:<N>m" (BRL per m2). */
export function dailyRows(groups: Group[], thisMonth: number): { date: string; rows: DailyRow[] } {
  const valid = groups.filter((g) => g.ym <= thisMonth);
  if (!valid.length) throw new SourceError("The Rio ITBI layer held no usable residential groups");
  const last = valid.reduce((a, g) => Math.max(a, g.ym), 0);
  const recs: { area: string; item: string; price: number }[] = [];
  for (const m of WINDOWS) {
    for (const g of valid) {
      if (g.ym <= last - m || g.ym > last) continue;
      for (const t of ["any", g.kind] as const) {
        for (let i = 0; i < g.weight; i++) {
          recs.push({ area: g.area, item: `${t}:${m}m`, price: g.value });
          if (g.m2 !== null) recs.push({ area: g.area, item: `${t}-m2:${m}m`, price: g.m2 });
        }
      }
    }
  }
  return { date: ymToDate(last), rows: aggregateDaily(recs, true).filter((r) => r.n >= MIN_PUBLISH) };
}

const FIELDS = ["bairro", "total_transações", "uso", "principais_tipologias", "média_percentual_transferido", "média_área_construída", "média_valor_transação", "principal_transação_mercado", "ano_transação", "mês_transação"];

/** The daily collector: the newest three calendar years of residential purchase-and-sale rows cover the 24-month window. */
export async function rioHarvest(): Promise<HarvestResult> {
  const now = new Date();
  const where = `uso='RESIDENCIAL' AND principal_transação_mercado='COMPRA E VENDA' AND ano_transação>=${now.getUTCFullYear() - 2}`;
  const res = await arcgisAll(LAYER_URL, { where, outFields: FIELDS, orderByFields: "objectid ASC" }, { maxRows: 50_000, pageSize: 2000, timeoutMs: 90_000 });
  if (!res.rows.length) throw new SourceError("The Rio ITBI layer returned no rows");
  const groups = parseRows(res.rows);
  const { date, rows } = dailyRows(groups, now.getUTCFullYear() * 12 + now.getUTCMonth());
  return { date, currency: "BRL", unit: "per home", rows, note: `Windows of 3/6/12/24 months ending ${date}; residential ITBI declared transaction values (apartments and houses), street-month averages weighted by transfers.` };
}

/** Neighbourhoods of the city (normalised names) a request can name before the library is read; also used by serves(). */
export const RIO_PLACES = [
  "copacabana", "barra da tijuca", "recreio dos bandeirantes", "tijuca", "botafogo", "ipanema", "barra olimpica", "flamengo", "jacarepagua", "leblon",
  "freguesia", "campo grande", "laranjeiras", "taquara", "vila isabel", "camorim", "gavea", "pechincha", "gloria", "catete", "cachambi", "santo cristo",
  "maracana", "grajau", "meier", "lagoa", "andarai", "humaita", "praca seca", "todos os santos", "iraja", "leme", "sao cristovao", "engenho de dentro",
  "del castilho", "rio comprido", "jardim botanico", "santa teresa", "santa cruz", "penha", "sao conrado", "urca", "vidigal", "bangu", "realengo", "madureira",
];

/** True when the request names Rio de Janeiro city or one of its well-known neighbourhoods. */
export function servesRio(town: string | undefined, postcode?: string): boolean {
  const n = normaliseName(town ?? "");
  if (/\brio de janeiro\b/.test(n) || /^rio$/.test(n) || /\brio\b.*\brj\b/.test(n)) return true;
  const bare = n.replace(/\b(rio de janeiro|rj|brasil|brazil|bairro)\b/g, " ").replace(/\s+/g, " ").trim();
  if (bare && RIO_PLACES.includes(bare)) return true;
  return /^2[0-3]\d{3}-?\d{3}$/.test((postcode ?? "").trim()); // CEP 20000-23799 = Rio de Janeiro city
}

/** Resolve a place to a library area. "" / "Rio de Janeiro" = the whole city. Known neighbourhoods come from the latest library day. */
export function resolveArea(town: string | undefined, known: string[]): { area: string; label: string } | null {
  const n = normaliseName(town ?? "").replace(/\b(rio de janeiro|rj|brasil|brazil|bairro)\b/g, " ").replace(/\s+/g, " ").trim();
  if (!n) return { area: NATIONAL, label: "Rio de Janeiro" };
  const s = n.replace(/ /g, "-");
  const bare = (x: string) => x.replace(/-(de|do|da|dos|das)(?=-)/g, "");
  const exact = known.find((k) => k === s);
  const loose = exact ?? known.find((k) => bare(k) === bare(s)) ?? known.find((k) => k.length >= 6 && (bare(s).startsWith(bare(k)) || bare(k).startsWith(bare(s))));
  const area = loose ?? (known.length ? null : s);
  if (!area) return null;
  return { area, label: area.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") + ", Rio de Janeiro" };
}

export function rioKey(p: { town?: string; property_type?: string; months?: number }, known: string[]) {
  const place = resolveArea(p.town, known);
  if (!place) return null;
  const t = (p.property_type ?? "any").toLowerCase();
  if (!(TYPES as readonly string[]).includes(t)) return null;
  const v = p.months === undefined || !Number.isFinite(p.months) ? 12 : p.months;
  const months = WINDOWS.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
  return { ...place, type: t as (typeof TYPES)[number], months, item: `${t}:${months}m` };
}

export function rioHistoryKey(p: { town?: string; property_type?: string; months?: number }) {
  const latest = readLatestDay(INFO.id);
  const known = latest ? [...new Set(latest.rows.map((r) => r.area))].filter((a) => a !== NATIONAL) : [];
  const k = rioKey(p, known);
  return k ? { area: k.area, item: k.item, label: `${k.label}, Brazil` } : null;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const R = (v: number) => fmtMoney(v, "BRL");

export function rioAnswerFromRow(
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
      "Brazil, Rio de Janeiro city: median and 10th-90th percentile of the transaction value declared for the ITBI property-transfer tax, for full purchase-and-sale transfers of apartments and houses over the last 3, 6, 12 or 24 months " +
      "(your request is rounded to the nearest) ending at the newest month. The city publishes street-month averages; each counts once per transfer. The declared value is not a verified price paid. Promises of sale, partial transfers, values under BRL 30,000 and of BRL 20 million or more are dropped.",
    describe: (x) =>
      `${cap(word)} in ${q.label} had a median declared transaction value of ${R(x.median)} (typical range ${R(x.low)} to ${R(x.high)})` +
      (m2 && m2.n >= MIN_PUBLISH ? `, a median of ${R(m2.median)} per m2 of built area` : "") +
      `. This is the value declared for the property-transfer tax on the city's records, which may differ from the price actually paid.`,
    baseUrl: q.baseUrl,
    extra: {
      price_basis: "ITBI declared transaction value, not a verified price paid",
      per_m2: m2 && m2.n >= MIN_PUBLISH ? { median: m2.median, typical_low: m2.low, typical_high: m2.high, sample_size: m2.n, currency: "BRL" } : null,
    },
  });
}

export async function rioHomeSales(input: { town?: string; property_type?: string; months?: number; baseUrl?: string }): Promise<PriceAnswer> {
  const meta = readMeta(INFO.id);
  const latest = readLatestDay(INFO.id);
  if (!meta?.last_date || !latest) throw new SourceError("ProofPrice collects this register daily; data appears after the next collection.");
  const known = [...new Set(latest.rows.map((r) => r.area))].filter((a) => a !== NATIONAL).sort();
  if (input.property_type && !(TYPES as readonly string[]).includes(input.property_type.toLowerCase())) {
    throw new InputError(`property_type must be one of: ${TYPES.join(", ")}`);
  }
  const k = rioKey(input, known);
  if (!k) {
    throw new InputError(`Unknown neighbourhood '${input.town}'. Give a Rio de Janeiro neighbourhood (bairro) such as Copacabana, Ipanema or Tijuca, or leave town out for the whole city. Neighbourhoods with enough transfers: ${known.join(", ")}.`);
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
      method: "Rolling windows of the Rio de Janeiro ITBI records.", describe: () => "", baseUrl: input.baseUrl,
      extra: { reason: `Fewer than ${MIN_PUBLISH} ${word} transfers in ${k.label} in any window up to 24 months` },
    });
    a.summary = `Fewer than ${MIN_PUBLISH} ${word} transfers are recorded in ${k.label} in the last 24 months, so no price range is published (it would identify individual sales). Try the whole city by leaving town out.`;
    return a;
  }
  const m2row = pick(`${k.type}-m2:${usedMonths}m`);
  const a = rioAnswerFromRow(row, m2row, { label: k.label, type: k.type, months: usedMonths, baseUrl: input.baseUrl });
  if (widened) {
    (a.query as Record<string, unknown>).months = k.months;
    a.summary = `Fewer than ${MIN_PUBLISH} ${word} transfers in ${k.label} in the last ${k.months} months, so this uses the last ${usedMonths} months. ` + a.summary;
    a.extra = { ...(a.extra ?? {}), requested_months: k.months, window_months: usedMonths, window_widened: true };
  }
  return a;
}
