// Italy medicine prices: AIFA "Liste di trasparenza" (class A equivalent medicines: public shelf price per pack and
// the SSN reference price). One ~1.7 MB CSV, refreshed in place about the 15th of each month. We never download it per
// request: the daily collector (harvest) reads it once, keeps aggregates per active substance and per brand name
// (first word) in the price library, and requests are answered from there. Regulated/posted prices, not transactions.

import { InputError, SourceError } from "../../lib/http";
import { MIN_PUBLISH } from "../../lib/stats";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { aggregateDaily, NATIONAL } from "../../lib/library/aggregate";
import { readDaily, readMeta } from "../../lib/library/store";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";

export const INFO: SourceInfo = {
  id: "it-medicines",
  country: "IT (Italy)",
  category: "medicines (public pharmacy prices of reimbursed generics and brands)",
  name: "Liste di trasparenza (AIFA)",
  publisher: "AIFA, Agenzia Italiana del Farmaco (Italy)",
  what_is_recorded: "Every pack of the off-patent class A (state-reimbursed) medicines in the AIFA transparency list, with its public shelf price and the reference price the national health service (SSN) reimburses.",
  price_type: "posted_price",
  freshness: "Published monthly (about the 15th); our copy is refreshed daily",
  licence: "CC BY 4.0",
  licence_url: "https://creativecommons.org/licenses/by/4.0/",
  attribution: "Fonte: AIFA - Agenzia Italiana del Farmaco (Liste di trasparenza), CC BY 4.0; data not altered.",
  homepage: "https://www.aifa.gov.it/en/liste-di-trasparenza",
  limits:
    "Posted public prices per pack including VAT, not market transactions. Only class A (reimbursable) prescription medicines whose patent has expired and that have equivalents; " +
    "new patented medicines and over-the-counter products are not in the list. Each pack counts once, so a range spans all pack sizes and strengths of one substance or brand; " +
    "it is a spread of list prices, not of what people paid. Per-prescription fees and any regional co-payments are not included.",
};

export const CSV_URL = "https://www.aifa.gov.it/documents/20142/825643/Lista_farmaci_equivalenti.csv";
export const MAX_KEYS = 3000; // library size guard: the names with the most packs
const SKIP_FIRST = new Set(["acido", "associazioni", "vitamina", "sodio", "potassio", "calcio"]);

/** Decode bytes as UTF-8, falling back to windows-1252 when they are not valid UTF-8. */
export function decodeCsv(buf: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder("windows-1252").decode(buf);
  }
}

/** "5,63 " -> 5.63; "1.234,50" -> 1234.5; null when empty, zero or not a number. */
export function parseEuro(v: string): number | null {
  const s = v.replace(/[\s ]/g, "").replace(/\./g, "").replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Semicolon CSV with "quoted" fields ("" = a quote). Returns rows of cells. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ";") { row.push(cell); cell = ""; }
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

const MONTHS: Record<string, string> = { gennaio: "01", febbraio: "02", marzo: "03", aprile: "04", maggio: "05", giugno: "06", luglio: "07", agosto: "08", settembre: "09", ottobre: "10", novembre: "11", dicembre: "12" };

/** "Prezzo Pubblico 15 ottobre 2026" -> "2026-10-15"; null when there is no date. */
export function headerDate(h: string): string | null {
  const m = /(\d{1,2})\s+([a-zà-ù]+)\s+(\d{4})/i.exec(h);
  const mo = m ? MONTHS[m[2].toLowerCase()] : undefined;
  return m && mo ? `${m[3]}-${mo}-${m[1].padStart(2, "0")}` : null;
}

/** Lower-case ASCII slug of the first usable word ("Paracetamolo" -> "paracetamolo"); skips generic leading words like "acido". */
export function nameKey(name: string): string | null {
  const words = name
    .normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .split(/[^a-z0-9-]+/).map((w) => w.replace(/^-+|-+$/g, "")).filter((w) => w.length > 0);
  const w = words.find((t, i) => !(SKIP_FIRST.has(t) && i < words.length - 1)) ?? words[0];
  if (!w || w.length < 3 || /^\d+$/.test(w)) return null;
  return w;
}

export interface ItPack { aic: string; substance: string; brand: string; reference: number | null; price: number }
export interface ItList { packs: ItPack[]; asOf: string | null }

/** Parse the whole CSV. Columns are found by header name; the price column by the prefix "Prezzo Pubblico" (its date changes monthly). */
export function parseList(text: string): ItList {
  const rows = parseCsv(text.replace(/^﻿/, ""));
  if (!rows.length) return { packs: [], asOf: null };
  const head = rows[0].map((h) => h.trim());
  const col = (re: RegExp) => head.findIndex((h) => re.test(h));
  const iSub = col(/^Principio attivo/i), iAic = col(/^AIC$/i), iBrand = col(/^Farmaco$/i), iRef = col(/^Prezzo riferimento/i), iPub = col(/^Prezzo Pubblico/i);
  if (iSub < 0 || iAic < 0 || iBrand < 0 || iPub < 0) throw new SourceError("AIFA list has a new layout: expected columns Principio attivo, AIC, Farmaco and Prezzo Pubblico");
  const packs: ItPack[] = [];
  for (const c of rows.slice(1)) {
    if (c.length <= iPub) continue;
    const price = parseEuro(c[iPub]);
    const aic = c[iAic].trim();
    if (price === null || !aic) continue;
    packs.push({ aic, substance: c[iSub].trim(), brand: c[iBrand].trim(), reference: iRef >= 0 ? parseEuro(c[iRef]) : null, price });
  }
  return { packs, asOf: headerDate(head[iPub]) };
}

/** Library rows: area ALL, item "name:<key>". Each pack counts once per key (its substance and its brand). Top MAX_KEYS by pack count. */
export function itDailyRows(packs: ItPack[]): DailyRow[] {
  const seen = new Set<string>();
  const recs: { area: string; item: string; price: number }[] = [];
  for (const p of packs) {
    for (const k of [nameKey(p.substance), nameKey(p.brand)]) {
      if (!k) continue;
      const id = `${p.aic}|${k}`;
      if (seen.has(id)) continue;
      seen.add(id);
      recs.push({ area: NATIONAL, item: `name:${k}`, price: p.price });
    }
  }
  const rows = aggregateDaily(recs, false).filter((r) => r.n >= MIN_PUBLISH);
  return rows.sort((a, b) => b.n - a.n).slice(0, MAX_KEYS).sort((a, b) => a.item.localeCompare(b.item));
}

const UA = { "user-agent": "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)" };

export async function itHarvest(): Promise<HarvestResult> {
  const res = await fetch(CSV_URL, { headers: UA });
  if (!res.ok) throw new SourceError(`AIFA transparency list returned HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const list = parseList(decodeCsv(buf));
  const rows = itDailyRows(list.packs);
  if (!rows.length) throw new SourceError(`AIFA transparency list held no usable priced packs (${buf.length} bytes, ${list.packs.length} packs, type ${res.headers.get("content-type")}, ${diagnose(decodeCsv(buf))})`);
  const date = new Date().toISOString().slice(0, 10);
  return { date, currency: "EUR", unit: "per pack", rows, note: `List dated ${list.asOf ?? "unknown"}, ${list.packs.length} priced packs, ${rows.length} names with 5+ packs.` };
}

export function itKey(medicine?: string): { item: string; key: string } {
  const key = medicine ? nameKey(medicine) : null;
  if (!key) throw new InputError("medicine is required: an active substance or brand name such as 'paracetamolo' or 'tachipirina' (Italian names).");
  return { item: `name:${key}`, key };
}

export function itHistoryKey(p: { medicine?: string }) {
  try {
    const k = itKey(p.medicine);
    return { area: NATIONAL, item: k.item, label: `${k.key}, Italy` };
  } catch {
    return null;
  }
}

export const STALE_AFTER_DAYS = 7;

function methodText() {
  return (
    "Median and 10th–90th percentile of the public shelf price per pack (including VAT) of all packs in the AIFA transparency list whose active substance or brand name starts with the given word, " +
    "copied once a day. Posted prices of reimbursable off-patent medicines, not market transactions; the range mixes pack sizes and strengths."
  );
}

export function itAnswerFromRow(row: DailyRow & { date: string }, q: { key: string; baseUrl?: string; today?: string }): PriceAnswer {
  const today = q.today ?? new Date().toISOString().slice(0, 10);
  const ageDays = Math.round((Date.parse(today + "T00:00:00Z") - Date.parse(row.date + "T00:00:00Z")) / 86400000);
  const stale = ageDays > STALE_AFTER_DAYS;
  return buildAnswer({
    source: INFO,
    query: { country: "IT", medicine: q.key },
    summary: { count: row.n, median: row.median, low: row.low, high: row.high, min: row.min, max: row.max },
    currency: "EUR",
    unit: "per pack (public price incl. VAT)",
    period: { from: row.date, to: row.date },
    method: methodText(),
    describe: (x) =>
      `Reimbursable off-patent packs of "${q.key}" in Italy have a public shelf price (per pack, incl. VAT) of a median ${fmtMoney(x.median, "EUR")}; ` +
      `10th–90th percentile ${fmtMoney(x.low, "EUR")}–${fmtMoney(x.high, "EUR")} across the packs in the AIFA transparency list, which mix pack sizes and strengths. ` +
      `These are posted list prices, not market transactions; the state reimburses only the (lower) reference price of each equivalent group.` +
      (stale ? ` Our copy of the list is ${ageDays} days old (collected ${row.date}).` : ""),
    baseUrl: q.baseUrl,
    ...(stale ? { extra: { stale: true, days_since_collected: ageDays } } : {}),
  });
}

export async function itMedicines(input: { medicine?: string; baseUrl?: string }): Promise<PriceAnswer> {
  const k = itKey(input.medicine);
  const meta = readMeta(INFO.id);
  if (!meta?.last_date) throw new SourceError("ProofPrice collects this list daily; data appears after the next collection.");
  const to = meta.last_date;
  const from = new Date(Date.parse(to + "T00:00:00Z") - 60 * 86400000).toISOString().slice(0, 10);
  const rows = readDaily(INFO.id, { area: NATIONAL, item: k.item, from, to });
  const row = rows[rows.length - 1];
  if (!row) {
    return buildAnswer({
      source: INFO, query: { country: "IT", medicine: k.key }, summary: null, currency: "EUR", unit: "per pack (public price incl. VAT)",
      period: { from: null, to: null }, method: methodText(), describe: () => "", baseUrl: input.baseUrl,
      extra: { hint: "No active substance or brand starting with this word has 5 or more packs in the AIFA transparency list. Try the Italian substance name (e.g. 'paracetamolo') or a brand, first word only." },
    });
  }
  return itAnswerFromRow(row, { key: k.key, baseUrl: input.baseUrl });
}

/** Short description of how the file parsed, for the collector's error message. */
export function diagnose(text: string): string {
  const rows = parseCsv(text.replace(/^\uFEFF/, ""));
  const h = rows[0] ?? [];
  return `${rows.length} rows; head ${JSON.stringify(h.map((x) => x.slice(0, 14)))}; r1 ${JSON.stringify((rows[1] ?? []).slice(6).map((x) => x.slice(0, 12)))}`;
}
