// Brazil (Porto Alegre) home sales from the city's ITBI open data: one row per property-transfer tax guide
// ("guia de ITBI"), published by the Secretaria Municipal da Fazenda as a yearly ZIP of a semicolon CSV (CC BY).
// The price field is base_de_calculo, the ITBI TAX BASE in BRL. It is not proven to equal the price paid (in Brazil the base can be the
// declared transaction value or the municipal assessed value), so every answer is labelled "ITBI tax base", never "price paid".
// The file holds street addresses and registry numbers: we never keep them. A record is reduced in memory to
// (estimate date, neighbourhood, kind, base, private area) and only the aggregate reaches the library.
// Bulk file => the daily collector (harvest) reads the newest yearly ZIPs once; requests are answered from the library.

import { inflateRawSync } from "node:zlib";
import { InputError, SourceError } from "../../lib/http";
import { MIN_PUBLISH, summarise } from "../../lib/stats";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { aggregateDaily, NATIONAL } from "../../lib/library/aggregate";
import { readDaily, readLatestDay, readMeta } from "../../lib/library/store";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";

export const INFO: SourceInfo = {
  id: "br-poa-itbi",
  country: "BR (Porto Alegre only)",
  category: "home sales (ITBI property-transfer tax guides)",
  name: "ITBI, property transfer tax guides of Porto Alegre",
  publisher: "Prefeitura de Porto Alegre, Secretaria Municipal da Fazenda, via dadosabertos.poa.br",
  what_is_recorded:
    "One property-transfer tax (ITBI) guide per transfer in the city of Porto Alegre: the tax base in BRL (base de calculo), the kind of property, the neighbourhood and the private area.",
  price_type: "posted_price",
  freshness: "The city refreshes the yearly files about monthly; guides appear a few days to weeks after the estimate date. Each answer names the period it covers.",
  licence: "Creative Commons Attribution (CC BY), per the publisher's CKAN record (license_title 'Creative Commons Attribution').",
  licence_url: "https://dadosabertos.poa.br/dataset/itbi",
  attribution:
    "Source: Prefeitura de Porto Alegre, Secretaria Municipal da Fazenda, ITBI, dadosabertos.poa.br, CC BY. Changed by ProofPrice: only residential apartments and houses, medians and percentiles computed from the guides.",
  homepage: "https://dadosabertos.poa.br/dataset/itbi",
  limits:
    "Porto Alegre only, not the rest of Brazil. The figure is the ITBI tax base of the transfer guide, not a verified price paid: the tax base can differ from the sale price. " +
    "Apartments and houses only (parking spaces, storage, offices and shops are left out); cancelled guides, partial transfers (under 100% of the property), blank bases, bases under BRL 30,000 and bases of BRL 20 million or more are dropped. " +
    "Aggregates only, by neighbourhood (bairro) and rolling window; never addresses.",
  method_version: "1",
};

export const PACKAGE_URL = "https://dadosabertos.poa.br/api/3/action/package_show?id=itbi";
export const WINDOWS = [3, 6, 12, 24] as const;
export const TYPES = ["any", "apartment", "house"] as const;
export type Kind = "apartment" | "house";
export const MIN_BASE = 30_000;
export const MAX_BASE = 20_000_000; // exclusive
export const M2_RANGE: [number, number] = [1_000, 40_000]; // BRL per m2 of private area
export const MIN_AREA = 15; // m2 of private area to count a price per m2

export interface Guide { date: string; area: string; kind: Kind; base: number; m2: number | null }

/** Lower-case, strip accents and punctuation: "Petrópolis" -> "petropolis". */
export function normaliseName(raw: string): string {
  return raw.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
export const slug = (raw: string) => normaliseName(raw).replace(/ /g, "-");

/** Split one line of the semicolon CSV; fields may be wrapped in double quotes ("" = a quote). */
export function splitLine(line: string): string[] {
  const out: string[] = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ";") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

/** Residential kind of a finalidade_construcao value, or null (parking, storage, rooms, shops...). */
export function kindOf(finalidade: string): Kind | null {
  const f = normaliseName(finalidade);
  if (!f) return null;
  if (/^apartamento\b/.test(f) && !/(estacionamento|garagem|deposito)/.test(f)) return "apartment";
  if (/^(residencia|casa)\b/.test(f)) return "house";
  return null;
}

/** Parse the ITBI CSV into plausible residential guides. Reads columns by header name; addresses are never read. */
export function parseItbi(csv: string): Guide[] {
  const lines = csv.split(/\r?\n/);
  if (!lines.length) return [];
  const head = splitLine(lines[0]).map((h) => h.trim().toLowerCase());
  const ix = (n: string) => head.indexOf(n);
  const iDate = ix("data_estimativa"), iBase = ix("base_de_calculo"), iPerc = ix("perc_transmitido"), iFin = ix("finalidade_construcao"),
    iBairro = ix("bairro"), iPriv = ix("area_constr_privativa"), iSit = ix("situacao");
  if ([iDate, iBase, iFin, iBairro].some((i) => i < 0)) throw new SourceError("The ITBI file has an unexpected format (columns changed)", head.join(";").slice(0, 200));
  const out: Guide[] = [];
  for (let l = 1; l < lines.length; l++) {
    if (!lines[l]) continue;
    const f = splitLine(lines[l]);
    if (iSit >= 0 && /cancelad/i.test(f[iSit] ?? "")) continue;
    if (iPerc >= 0) { const p = Number(f[iPerc]); if (Number.isFinite(p) && p < 100) continue; }
    const kind = kindOf(f[iFin] ?? "");
    if (!kind) continue;
    const date = (f[iDate] ?? "").slice(0, 10);
    const base = Number(f[iBase]);
    const area = slug(f[iBairro] ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(base) || !f[iBase] || !area) continue;
    if (base < MIN_BASE || base >= MAX_BASE) continue;
    const priv = iPriv >= 0 ? Number(f[iPriv]) : NaN;
    let m2: number | null = null;
    if (Number.isFinite(priv) && priv >= MIN_AREA) {
      const v = base / priv;
      if (v >= M2_RANGE[0] && v <= M2_RANGE[1]) m2 = v;
    }
    out.push({ date, area, kind, base, m2 });
  }
  return out;
}

export function monthsBack(last: string, months: number): string {
  const d = new Date(last + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

/** Aggregates for every window ending at the newest guide date. Items: "<type>:<N>m" (BRL per home) and "<type>-m2:<N>m" (BRL per m2). */
export function dailyRows(guides: Guide[], today: string): { date: string; rows: DailyRow[] } {
  const valid = guides.filter((g) => g.date <= today);
  if (!valid.length) throw new SourceError("The ITBI files held no usable residential guides");
  const last = valid.reduce((a, g) => (g.date > a ? g.date : a), "0000-00-00");
  const recs: { area: string; item: string; price: number }[] = [];
  for (const m of WINDOWS) {
    const from = monthsBack(last, m);
    for (const g of valid) {
      if (g.date <= from || g.date > last) continue;
      for (const t of ["any", g.kind] as const) {
        recs.push({ area: g.area, item: `${t}:${m}m`, price: g.base });
        if (g.m2 !== null) recs.push({ area: g.area, item: `${t}-m2:${m}m`, price: g.m2 });
      }
    }
  }
  return { date: last, rows: aggregateDaily(recs, true).filter((r) => r.n >= MIN_PUBLISH) };
}

const UA = { "user-agent": "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)" };

/** The yearly ZIP urls listed in the publisher's CKAN record, newest first. */
export function zipUrls(pkg: any): { year: number; url: string }[] {
  const res: any[] = pkg?.result?.resources ?? [];
  const out: { year: number; url: string }[] = [];
  for (const r of res) {
    const m = String(r?.url ?? "").match(/itbi[-_ ]?(\d{4})\.zip/i);
    if (m && r.url) out.push({ year: Number(m[1]), url: String(r.url) });
  }
  return out.sort((a, b) => b.year - a.year);
}

/** Read the first (only) file out of a zip held in memory. */
export function unzipFirstFile(buf: Buffer): Buffer {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new SourceError("Not a zip file");
  const cd = buf.readUInt32LE(eocd + 16);
  if (buf.readUInt32LE(cd) !== 0x02014b50) throw new SourceError("Bad zip directory");
  const method = buf.readUInt16LE(cd + 10);
  const csize = buf.readUInt32LE(cd + 20);
  const lho = buf.readUInt32LE(cd + 42);
  if (buf.readUInt32LE(lho) !== 0x04034b50) throw new SourceError("Bad zip entry");
  const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
  const data = buf.subarray(start, start + csize);
  if (method === 0) return Buffer.from(data);
  if (method === 8) return inflateRawSync(data);
  throw new SourceError(`Unsupported zip method ${method}`);
}

async function get(url: string): Promise<Response> {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(90_000) });
  if (!res.ok) throw new SourceError(`Porto Alegre open data returned HTTP ${res.status}`, url, res.status);
  return res;
}

/** The daily collector: the newest three yearly files cover the 24-month window. */
export async function poaHarvest(): Promise<HarvestResult> {
  const pkg = await (await get(PACKAGE_URL)).json();
  const files = zipUrls(pkg).slice(0, 3);
  if (!files.length) throw new SourceError("No ITBI yearly files found in the publisher's record");
  const guides: Guide[] = [];
  for (const f of files) {
    const buf = Buffer.from(await (await get(f.url)).arrayBuffer());
    const raw = unzipFirstFile(buf);
    let text = raw.toString("utf8");
    if (text.includes("\uFFFD")) text = raw.toString("latin1"); // older files may be latin-1
    guides.push(...parseItbi(text));
  }
  const { date, rows } = dailyRows(guides, new Date().toISOString().slice(0, 10));
  return { date, currency: "BRL", unit: "per home", rows, note: `Windows of 3/6/12/24 months ending ${date}; residential ITBI tax bases (apartments and houses).` };
}

/** Resolve a place to a library area. "" / "Porto Alegre" = the whole city. Known neighbourhoods come from the latest library day. */
export function resolveArea(town: string | undefined, known: string[]): { area: string; label: string } | null {
  const n = normaliseName(town ?? "").replace(/\b(porto alegre|rs|brasil|brazil|bairro)\b/g, " ").replace(/\s+/g, " ").trim();
  if (!n) return { area: NATIONAL, label: "Porto Alegre" };
  const s = n.replace(/ /g, "-");
  const exact = known.find((k) => k === s);
  // The city's file truncates long names ("CENTRO HISTORIC", "JAR LEOPOLDINA"): accept a prefix either way.
  const loose = exact ?? known.find((k) => k.length >= 6 && (s.startsWith(k) || k.startsWith(s))) ;
  const area = loose ?? (known.length ? null : s);
  if (!area) return null;
  return { area, label: area.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") + ", Porto Alegre" };
}

export function poaKey(p: { town?: string; property_type?: string; months?: number }, known: string[]) {
  const place = resolveArea(p.town, known);
  if (!place) return null;
  const t = (p.property_type ?? "any").toLowerCase();
  if (!(TYPES as readonly string[]).includes(t)) return null;
  const v = p.months === undefined || !Number.isFinite(p.months) ? 12 : p.months;
  const months = WINDOWS.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
  return { ...place, type: t as (typeof TYPES)[number], months, item: `${t}:${months}m` };
}

export function poaHistoryKey(p: { town?: string; property_type?: string; months?: number }) {
  const latest = readLatestDay(INFO.id);
  const known = latest ? [...new Set(latest.rows.map((r) => r.area))].filter((a) => a !== NATIONAL) : [];
  const k = poaKey(p, known);
  return k ? { area: k.area, item: k.item, label: `${k.label}, Brazil` } : null;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const R = (v: number) => fmtMoney(v, "BRL");

export function poaAnswerFromRow(
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
      "Brazil, Porto Alegre: median and 10th-90th percentile of the ITBI tax base (base de calculo) on property-transfer tax guides for apartments and houses over the last 3, 6, 12 or 24 months " +
      "(your request is rounded to the nearest) ending at the newest guide. The tax base is not a verified price paid. Cancelled guides, partial transfers, blank bases, bases under BRL 30,000 and of BRL 20 million or more are dropped.",
    describe: (x) =>
      `${cap(word)} in ${q.label} had a median ITBI tax base of ${R(x.median)} (typical range ${R(x.low)} to ${R(x.high)})` +
      (m2 && m2.n >= MIN_PUBLISH ? `, a median of ${R(m2.median)} per m2 of private area` : "") +
      `. This is the property-transfer tax base on the city's guides, which may differ from the price actually paid.`,
    baseUrl: q.baseUrl,
    extra: {
      price_basis: "ITBI tax base (base de calculo), not a verified price paid",
      per_m2: m2 && m2.n >= MIN_PUBLISH ? { median: m2.median, typical_low: m2.low, typical_high: m2.high, sample_size: m2.n, currency: "BRL" } : null,
    },
  });
}

export async function poaHomeSales(input: { town?: string; property_type?: string; months?: number; baseUrl?: string }): Promise<PriceAnswer> {
  const meta = readMeta(INFO.id);
  const latest = readLatestDay(INFO.id);
  if (!meta?.last_date || !latest) throw new SourceError("ProofPrice collects this register daily; data appears after the next collection.");
  const known = [...new Set(latest.rows.map((r) => r.area))].filter((a) => a !== NATIONAL).sort();
  if (input.property_type && !(TYPES as readonly string[]).includes(input.property_type.toLowerCase())) {
    throw new InputError(`property_type must be one of: ${TYPES.join(", ")}`);
  }
  const k = poaKey(input, known);
  if (!k) {
    throw new InputError(`Unknown neighbourhood '${input.town}'. Give a Porto Alegre neighbourhood (bairro) such as Moinhos de Vento, Centro Historico or Petropolis, or leave town out for the whole city. Neighbourhoods with enough guides: ${known.join(", ")}.`);
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
      method: "Rolling windows of the Porto Alegre ITBI guides.", describe: () => "", baseUrl: input.baseUrl,
      extra: { reason: `Fewer than ${MIN_PUBLISH} ${word} guides in ${k.label} in any window up to 24 months` },
    });
    a.summary = `Fewer than ${MIN_PUBLISH} ${word} transfer guides are recorded in ${k.label} in the last 24 months, so no price range is published (it would identify individual sales). Try the whole city by leaving town out.`;
    return a;
  }
  const m2row = pick(`${k.type}-m2:${usedMonths}m`);
  const a = poaAnswerFromRow(row, m2row, { label: k.label, type: k.type, months: usedMonths, baseUrl: input.baseUrl });
  if (widened) {
    (a.query as Record<string, unknown>).months = k.months;
    a.summary = `Fewer than ${MIN_PUBLISH} ${word} guides in ${k.label} in the last ${k.months} months, so this uses the last ${usedMonths} months. ` + a.summary;
    a.extra = { ...(a.extra ?? {}), requested_months: k.months, window_months: usedMonths, window_widened: true };
  }
  return a;
}
