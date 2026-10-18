// Spain medicine prices: Ministerio de Sanidad "Nomenclator de facturacion" (every medicine billed to the national health
// service, with its legally fixed public price per pack incl. VAT, PVP, and the reference price). One ~4.5 MB CSV,
// refreshed monthly. We never download it per request: the daily collector (harvest) reads it once, keeps aggregates per
// active ingredient and per brand name (first word) in the price library, and requests are answered from there.
// Regulated/posted prices, not transactions.

import { InputError, SourceError } from "../../lib/http";
import { MIN_PUBLISH } from "../../lib/stats";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { aggregateDaily, NATIONAL } from "../../lib/library/aggregate";
import { readDaily, readMeta } from "../../lib/library/store";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";

export const INFO: SourceInfo = {
  id: "es-medicines",
  country: "ES (Spain)",
  category: "medicines (regulated public pharmacy prices of medicines billed to the national health service)",
  name: "Nomenclator de facturacion (Ministerio de Sanidad)",
  publisher: "Ministerio de Sanidad (Spain)",
  what_is_recorded: "Every medicine pack billed to the Spanish national health service that is currently on sale (status ALTA), with its legally fixed maximum public price (PVP, incl. VAT) and, where one exists, its reference price.",
  price_type: "posted_price",
  freshness: "Published monthly (billing edition); our copy is refreshed daily",
  licence: "Reuse allowed incl. commercial use with the source cited and the date of last update (Sanidad legal notice, no named licence)",
  licence_url: "https://www.sanidad.gob.es/avisoLegal/home.htm",
  attribution: "Fuente: Ministerio de Sanidad, Nomenclator de facturacion de medicamentos y productos sanitarios; data not altered.",
  homepage: "https://www.sanidad.gob.es/profesionales/nomenclator.do",
  limits:
    "Regulated maximum public prices per pack including VAT, not market transactions. Only medicines billed to the national health service (prescription medicines and some others); " +
    "devices, magistral formulas, hospital-only and discontinued (BAJA) packs are left out. Each pack counts once, so a range spans all pack sizes and strengths of one ingredient or brand; " +
    "it is a spread of list prices, not of what people paid. The patient's co-payment share is not included.",
};

export const CSV_URL = "https://www.sanidad.gob.es/profesionales/nomenclator.do?metodo=buscarProductos&especialidad=%25%25%25&d-4015021-e=1&6578706f7274=1";
export const MAX_KEYS = 3000; // library size guard: the names with the most packs
const SKIP_FIRST = new Set(["acido", "vitamina", "sodio", "potasio", "calcio", "hidroxido", "cloruro", "sulfato"]);

/** Comma CSV with "quoted" fields ("" = a quote). Returns rows of cells. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** "1.9" -> 1.9; ".86" -> 0.86; "1.234,50" never occurs (decimal point). null when empty, zero or not a number. */
export function parsePrice(v: string): number | null {
  const s = (v ?? "").trim().replace(/[^\d.]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Lower-case ASCII slug of the first usable word ("PARACETAMOL CINFA 1G" -> "paracetamol"); skips generic leading words like "acido". */
export function nameKey(name: string): string | null {
  const words = fold(name).split(/[^a-z0-9-]+/).map((w) => w.replace(/^-+|-+$/g, "")).filter((w) => w.length > 0);
  const w = words.find((t, i) => !(SKIP_FIRST.has(t) && i < words.length - 1)) ?? words[0];
  if (!w || w.length < 3 || /^\d+$/.test(w)) return null;
  return w;
}

export interface EsPack { cn: string; substance: string; product: string; price: number; reference: number | null }

/** Parse the whole CSV. Columns are found by header name (accents ignored). Keeps medicine packs (national code 6xxxxx) on sale (ALTA) with a PVP. */
export function parseList(text: string): EsPack[] {
  const rows = parseCsv(text.replace(/^﻿/, ""));
  if (!rows.length) return [];
  const head = rows[0].map((h) => fold(h.trim()));
  const col = (re: RegExp) => head.findIndex((h) => re.test(h));
  const iCn = col(/^codigo nacional/), iName = col(/^nombre del producto/), iEstado = col(/^estado$/), iSub = col(/^principio activo/),
    iPvp = col(/^precio venta al publico/), iRef = col(/^precio de referencia/);
  if (iCn < 0 || iName < 0 || iEstado < 0 || iSub < 0 || iPvp < 0) throw new SourceError("Nomenclator has a new layout: expected columns Codigo Nacional, Nombre del producto, Estado, Principio activo and Precio venta al publico");
  const packs: EsPack[] = [];
  for (const c of rows.slice(1)) {
    if (c.length <= iPvp) continue;
    const cn = c[iCn].trim();
    if (!/^6\d{5}$/.test(cn)) continue; // 6xxxxx = medicines; other ranges are devices, formulas, dietary products
    if (!/^alta/i.test(c[iEstado].trim())) continue;
    const price = parsePrice(c[iPvp]);
    if (price === null) continue;
    packs.push({ cn, substance: c[iSub].trim(), product: c[iName].trim(), price, reference: iRef >= 0 ? parsePrice(c[iRef]) : null });
  }
  return packs;
}

/** Library rows: area ALL, item "name:<key>". Each pack counts once per key (its ingredient and its brand). Top MAX_KEYS by pack count. */
export function esDailyRows(packs: EsPack[]): DailyRow[] {
  const seen = new Set<string>();
  const recs: { area: string; item: string; price: number }[] = [];
  for (const p of packs) {
    for (const k of [nameKey(p.substance), nameKey(p.product)]) {
      if (!k) continue;
      const id = `${p.cn}|${k}`;
      if (seen.has(id)) continue;
      seen.add(id);
      recs.push({ area: NATIONAL, item: `name:${k}`, price: p.price });
    }
  }
  const rows = aggregateDaily(recs, false).filter((r) => r.n >= MIN_PUBLISH);
  return rows.sort((a, b) => b.n - a.n).slice(0, MAX_KEYS).sort((a, b) => a.item.localeCompare(b.item));
}

const UA = { "user-agent": "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)" };

/** "attachment; filename=\"20261018_Nomenclator_de_Facturacion.csv\"" -> "2026-10-18" (or null). */
export function fileDate(disposition: string | null): string | null {
  const m = /(\d{4})(\d{2})(\d{2})_/.exec(disposition ?? "");
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

export async function esHarvest(): Promise<HarvestResult> {
  const res = await fetch(CSV_URL, { headers: UA });
  if (!res.ok) throw new SourceError(`Sanidad Nomenclator returned HTTP ${res.status}`);
  const text = new TextDecoder("utf-8").decode(Buffer.from(await res.arrayBuffer()));
  const packs = parseList(text);
  const rows = esDailyRows(packs);
  if (!rows.length) throw new SourceError(`Sanidad Nomenclator held no usable priced packs (${text.length} chars, ${packs.length} packs, type ${res.headers.get("content-type")})`);
  const date = new Date().toISOString().slice(0, 10);
  return { date, currency: "EUR", unit: "per pack", rows, note: `File dated ${fileDate(res.headers.get("content-disposition")) ?? "unknown"}, ${packs.length} priced packs on sale, ${rows.length} names with 5+ packs.` };
}

export function esKey(medicine?: string): { item: string; key: string } {
  const key = medicine ? nameKey(medicine) : null;
  if (!key) throw new InputError("medicine is required: an active ingredient or brand name such as 'paracetamol' or 'dolocatil' (Spanish names).");
  return { item: `name:${key}`, key };
}

export function esHistoryKey(p: { medicine?: string }) {
  try {
    const k = esKey(p.medicine);
    return { area: NATIONAL, item: k.item, label: `${k.key}, Spain` };
  } catch {
    return null;
  }
}

export const STALE_AFTER_DAYS = 7;

function methodText() {
  return (
    "Median and 10th–90th percentile of the legally fixed public price per pack (PVP, including VAT) of all packs on sale in the Spanish Nomenclator whose active ingredient or product name starts with the given word, " +
    "copied once a day. Regulated maximum prices of medicines billed to the national health service, not market transactions; the range mixes pack sizes and strengths."
  );
}

export function esAnswerFromRow(row: DailyRow & { date: string }, q: { key: string; baseUrl?: string; today?: string }): PriceAnswer {
  const today = q.today ?? new Date().toISOString().slice(0, 10);
  const ageDays = Math.round((Date.parse(today + "T00:00:00Z") - Date.parse(row.date + "T00:00:00Z")) / 86400000);
  const stale = ageDays > STALE_AFTER_DAYS;
  return buildAnswer({
    source: INFO,
    query: { country: "ES", medicine: q.key },
    summary: { count: row.n, median: row.median, low: row.low, high: row.high, min: row.min, max: row.max },
    currency: "EUR",
    unit: "per pack (public price incl. VAT)",
    period: { from: row.date, to: row.date },
    method: methodText(),
    describe: (x) =>
      `Packs of "${q.key}" on sale in Spain have a legally fixed public price (per pack, incl. VAT) of a median ${fmtMoney(x.median, "EUR")}; ` +
      `10th–90th percentile ${fmtMoney(x.low, "EUR")}–${fmtMoney(x.high, "EUR")} across the packs in the Ministerio de Sanidad Nomenclator, which mix pack sizes and strengths. ` +
      `These are regulated list prices, not market transactions.` +
      (stale ? ` Our copy of the list is ${ageDays} days old (collected ${row.date}).` : ""),
    baseUrl: q.baseUrl,
    ...(stale ? { extra: { stale: true, days_since_collected: ageDays } } : {}),
  });
}

export async function esMedicines(input: { medicine?: string; baseUrl?: string }): Promise<PriceAnswer> {
  const k = esKey(input.medicine);
  const meta = readMeta(INFO.id);
  if (!meta?.last_date) throw new SourceError("ProofPrice collects this list daily; data appears after the next collection.");
  const to = meta.last_date;
  const from = new Date(Date.parse(to + "T00:00:00Z") - 60 * 86400000).toISOString().slice(0, 10);
  const rows = readDaily(INFO.id, { area: NATIONAL, item: k.item, from, to });
  const row = rows[rows.length - 1];
  if (!row) {
    return buildAnswer({
      source: INFO, query: { country: "ES", medicine: k.key }, summary: null, currency: "EUR", unit: "per pack (public price incl. VAT)",
      period: { from: null, to: null }, method: methodText(), describe: () => "", baseUrl: input.baseUrl,
      extra: { hint: "No active ingredient or product name starting with this word has 5 or more packs on sale in the Nomenclator. Try the Spanish ingredient name (e.g. 'paracetamol') or a brand, first word only." },
    });
  }
  return esAnswerFromRow(row, { key: k.key, baseUrl: input.baseUrl });
}
