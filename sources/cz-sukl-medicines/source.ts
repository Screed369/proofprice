// Czech medicine prices: SUKL (Statni ustav pro kontrolu leciv) "Seznam cen a uhrad LP" (SCAU file): every reimbursable medicine pack with
// the legally fixed maximum final consumer price in CZK incl. VAT (field MFC). One ~3 MB pipe-delimited text file (windows-1250, no header,
// 122 columns, decimal comma), published on the 1st of the month. We never download it per request: the daily collector (harvest) reads it once,
// keeps aggregates per brand name (first word) and per ATC code in the price library, and requests are answered from there.
// Regulated maximum prices, not transactions. Column map read from the publisher's "Format Seznamu hrazenych leciv. pripravku, verze 21.0" (27 Oct 2026).

import { InputError, SourceError } from "../../lib/http";
import { MIN_PUBLISH } from "../../lib/stats";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { aggregateDaily, NATIONAL } from "../../lib/library/aggregate";
import { readDaily, readMeta } from "../../lib/library/store";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";

export const INFO: SourceInfo = {
  id: "cz-sukl-medicines",
  country: "CZ (Czech Republic)",
  category: "medicines (regulated maximum consumer prices of reimbursable medicines)",
  name: "Seznam cen a uhrad LP (SUKL)",
  publisher: "Statni ustav pro kontrolu leciv, SUKL (State Institute for Drug Control, Czech Republic)",
  what_is_recorded: "Every pack of a medicine on the Czech list of reimbursed medicines, with its legally fixed maximum final price for the consumer (MFC, CZK incl. VAT and the maximum pharmacy margin) and its ATC code.",
  price_type: "posted_price",
  freshness: "Published by SUKL on the 1st of each month (changes are also published mid-month); our copy is refreshed daily",
  licence: "No licence statement on the price-list page itself. SUKL's open-data terms (opendata.sukl.gov.cz/podminky-uziti-otevrenych-dat) allow commercial reuse with SUKL named as the source and the meaning unchanged, but this list is not shown in the open-data catalogue, so reuse is treated as UNCLEAR: free tier only",
  licence_url: "https://opendata.sukl.gov.cz/podminky-uziti-otevrenych-dat",
  attribution: "Zdroj: Statni ustav pro kontrolu leciv (SUKL), Seznam cen a uhrad LP; data not altered in meaning.",
  homepage: "https://sukl.gov.cz/ceny-a-uhrady-leciv/",
  limits:
    "Legally fixed MAXIMUM consumer prices per pack (CZK, incl. VAT), not what people paid; pharmacies may charge less. Only medicines on the reimbursement list (prescription medicines and some others); " +
    "over-the-counter products with free prices are not in it. Each pack counts once, so a range spans all pack sizes and strengths under one brand name or ATC code. " +
    "The patient's co-payment is not included. The list has no active-substance names, so search by Czech brand name or by ATC code.",
};

export const SLUG_BASE = "https://sukl.gov.cz/ceny-a-uhrady-leciv/seznam-cen-a-uhrad-lp/seznam-cen-a-uhrad-lp-k-1-";
export const MAX_KEYS = 3000; // library size guard: the keys with the most packs

// Column positions (0-based) in the 122-column pipe file.
export const COL = { KOD: 0, NAZ: 1, TCR: 14, CP: 15, UHR1: 18, ATC: 50, MFC: 85 } as const;
export const COLUMNS = 122;

/** Czech decimal comma: "1 234,50" or "106,11" -> number; null when empty, zero or not a number. */
export function parsePrice(v: string): number | null {
  const s = (v ?? "").trim().replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** First usable word of a brand name, lower-case ASCII ("ABAKTAL" -> "abaktal"); null when too short or numeric. */
export function nameKey(name: string): string | null {
  const words = fold(name).split(/[^a-z0-9]+/).filter((w) => w.length > 0);
  const w = words[0];
  if (!w || w.length < 3 || /^\d+$/.test(w)) return null;
  return w;
}

const ATC_RE = /^[A-V]\d{2}[A-Z]{1,2}(\d{2})?$/;
/** ATC code as typed ("n02be01") -> "N02BE01" when it has a valid level 4, 5 or 7 shape; else null. */
export function atcKey(v: string): string | null {
  const s = (v ?? "").trim().toUpperCase();
  if (!ATC_RE.test(s)) return null;
  return [4, 5, 7].includes(s.length) ? s : null;
}

export interface CzPack { kod: string; name: string; atc: string; price: number; tcr: string }

/** Parse the whole file (already decoded). Keeps packs that have a code, a name and a maximum consumer price. Throws if the layout looks wrong. */
export function parseList(text: string): CzPack[] {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (!lines.length) return [];
  const packs: CzPack[] = [];
  let wide = 0;
  const seen = new Set<string>();
  for (const line of lines) {
    const c = line.split("|");
    if (c.length < COLUMNS - 5) continue;
    wide++;
    const kod = c[COL.KOD].trim();
    if (!/^\d{7}$/.test(kod) || seen.has(kod)) continue;
    const price = parsePrice(c[COL.MFC]);
    if (price === null) continue;
    seen.add(kod);
    packs.push({ kod, name: c[COL.NAZ].trim(), atc: c[COL.ATC].trim().toUpperCase(), price, tcr: c[COL.TCR].trim() });
  }
  if (wide < lines.length * 0.9) throw new SourceError(`SUKL price list has a new layout: only ${wide} of ${lines.length} lines have about ${COLUMNS} pipe-separated columns`);
  return packs;
}

/** Library rows: area ALL, item "name:<key>" and "atc:<code>" (levels 4, 5 and 7). Each pack counts once per key. Top MAX_KEYS by pack count. */
export function czDailyRows(packs: CzPack[]): DailyRow[] {
  const recs: { area: string; item: string; price: number }[] = [];
  for (const p of packs) {
    const nk = nameKey(p.name);
    if (nk) recs.push({ area: NATIONAL, item: `name:${nk}`, price: p.price });
    if (ATC_RE.test(p.atc)) for (const len of [4, 5, 7]) if (p.atc.length >= len) recs.push({ area: NATIONAL, item: `atc:${p.atc.slice(0, len)}`, price: p.price });
  }
  const rows = aggregateDaily(recs, false).filter((r) => r.n >= MIN_PUBLISH);
  return rows.sort((a, b) => b.n - a.n).slice(0, MAX_KEYS).sort((a, b) => a.item.localeCompare(b.item));
}

const UA = { "user-agent": "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)" };

/** Page slugs of the monthly list, newest first: ...-k-1-10-2026/, ...-k-1-9-2026/ ... for the current and previous `months` months. */
export function listPageUrls(today: Date, months = 4): string[] {
  const out: string[] = [];
  let y = today.getUTCFullYear(), m = today.getUTCMonth() + 1;
  for (let i = 0; i < months; i++) {
    out.push(`${SLUG_BASE}${m}-${y}/`);
    m--; if (m === 0) { m = 12; y--; }
  }
  return out;
}

/** The effective-list .txt link on a monthly page, e.g. .../uploads/2026/09/SCAU261001v21.txt (newest if several). null if none. */
export function pickScauUrl(html: string): string | null {
  const m = [...html.matchAll(/https:\/\/sukl\.gov\.cz\/wp-content\/uploads\/\d{4}\/\d{2}\/SCAU\d{6}v\d+\.txt/g)].map((x) => x[0]);
  return m.length ? m.sort().pop()! : null;
}

/** "SCAU261001v21.txt" -> "2026-10-01" (or null). */
export function fileDate(url: string): string | null {
  const m = /SCAU(\d{2})(\d{2})(\d{2})v\d+/.exec(url);
  return m ? `20${m[1]}-${m[2]}-${m[3]}` : null;
}

export async function czHarvest(): Promise<HarvestResult> {
  let url: string | null = null;
  const errors: string[] = [];
  for (const page of listPageUrls(new Date())) {
    try {
      const r = await fetch(page, { headers: UA });
      if (!r.ok) { errors.push(`${page} HTTP ${r.status}`); continue; }
      url = pickScauUrl(await r.text());
      if (url) break;
      errors.push(`${page} has no SCAU .txt link`);
    } catch (e) { errors.push(`${page} ${(e as Error).message}`); }
  }
  if (!url) throw new SourceError(`SUKL price list not found: ${errors.join("; ")}`);
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new SourceError(`SUKL price list file returned HTTP ${res.status}`);
  const text = new TextDecoder("windows-1250").decode(Buffer.from(await res.arrayBuffer()));
  const packs = parseList(text);
  const rows = czDailyRows(packs);
  if (!rows.length) throw new SourceError(`SUKL price list held no usable priced packs (${text.length} chars, ${packs.length} packs)`);
  const date = new Date().toISOString().slice(0, 10);
  return { date, currency: "CZK", unit: "per pack", rows, note: `List dated ${fileDate(url) ?? "unknown"}, ${packs.length} priced packs, ${rows.length} keys with 5+ packs.` };
}

export function czKey(medicine?: string): { item: string; key: string; kind: "atc" | "name" } {
  const raw = (medicine ?? "").trim();
  const atc = atcKey(raw);
  if (atc) return { item: `atc:${atc}`, key: atc, kind: "atc" };
  const key = raw ? nameKey(raw) : null;
  if (!key) throw new InputError("medicine is required: a Czech brand name such as 'metformin' or 'ventolin', or an ATC code such as C10AA05 (atorvastatin) or the group C10AA.");
  return { item: `name:${key}`, key, kind: "name" };
}

export function czHistoryKey(p: { medicine?: string }) {
  try {
    const k = czKey(p.medicine);
    return { area: NATIONAL, item: k.item, label: `${k.key}, Czech Republic` };
  } catch {
    return null;
  }
}

export const STALE_AFTER_DAYS = 7;
const UNIT = "per pack (maximum consumer price incl. VAT)";

function methodText() {
  return (
    "Median and 10th–90th percentile of the legally fixed maximum final consumer price per pack (MFC, CZK incl. VAT) of all packs on the SUKL list of reimbursed medicines whose brand name starts with the given word, " +
    "or that carry the given ATC code (or start with it), copied once a day. Regulated maximum prices, not market transactions; the range mixes pack sizes and strengths."
  );
}

export function czAnswerFromRow(row: DailyRow & { date: string }, q: { key: string; kind: "atc" | "name"; baseUrl?: string; today?: string }): PriceAnswer {
  const today = q.today ?? new Date().toISOString().slice(0, 10);
  const ageDays = Math.round((Date.parse(today + "T00:00:00Z") - Date.parse(row.date + "T00:00:00Z")) / 86400000);
  const stale = ageDays > STALE_AFTER_DAYS;
  const what = q.kind === "atc" ? `ATC ${q.key}` : `"${q.key}"`;
  return buildAnswer({
    source: INFO,
    query: { country: "CZ", medicine: q.key },
    summary: { count: row.n, median: row.median, low: row.low, high: row.high, min: row.min, max: row.max },
    currency: "CZK",
    unit: UNIT,
    period: { from: row.date, to: row.date },
    method: methodText(),
    describe: (x) =>
      `Reimbursed packs of ${what} in the Czech Republic have a legally fixed maximum consumer price (per pack, incl. VAT) of a median ${fmtMoney(x.median, "CZK")}; ` +
      `10th–90th percentile ${fmtMoney(x.low, "CZK")}–${fmtMoney(x.high, "CZK")} across the packs on the SUKL price list, which mix pack sizes and strengths. ` +
      `These are regulated maximum prices, not market transactions.` +
      (stale ? ` Our copy of the list is ${ageDays} days old (collected ${row.date}).` : ""),
    baseUrl: q.baseUrl,
    ...(stale ? { extra: { stale: true, days_since_collected: ageDays } } : {}),
  });
}

export async function czMedicines(input: { medicine?: string; baseUrl?: string }): Promise<PriceAnswer> {
  const k = czKey(input.medicine);
  const meta = readMeta(INFO.id);
  if (!meta?.last_date) throw new SourceError("ProofPrice collects this list daily; data appears after the next collection.");
  const to = meta.last_date;
  const from = new Date(Date.parse(to + "T00:00:00Z") - 60 * 86400000).toISOString().slice(0, 10);
  const rows = readDaily(INFO.id, { area: NATIONAL, item: k.item, from, to });
  const row = rows[rows.length - 1];
  if (!row) {
    return buildAnswer({
      source: INFO, query: { country: "CZ", medicine: k.key }, summary: null, currency: "CZK", unit: UNIT,
      period: { from: null, to: null }, method: methodText(), describe: () => "", baseUrl: input.baseUrl,
      extra: { hint: "No brand name or ATC code like this has 5 or more packs on the SUKL list of reimbursed medicines. Try the Czech brand name (first word, e.g. 'metformin') or an ATC code (e.g. C10AA05, or the group C10AA)." },
    });
  }
  return czAnswerFromRow(row, { key: k.key, kind: k.kind, baseUrl: input.baseUrl });
}
