// New Zealand medicine prices: PHARMAC "Pharmaceutical Schedule" (Section B, Community Pharmaceuticals). One ~2.9 MB XML
// per edition (about monthly, irregular dates) at /pub/schedule/archive/<yyyy>/<yyyy-mm-dd>/Schedule_<yyyy-mm-dd>.xml.
// Every subsidised pack has a list price (NZD). We never download it per request: the daily collector (harvest) finds the
// newest edition, keeps aggregates per chemical and per brand (first word) in the price library, and requests are
// answered from there. Posted/regulated list prices, never transactions.

import { InputError, SourceError } from "../../lib/http";
import { MIN_PUBLISH } from "../../lib/stats";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { aggregateDaily, NATIONAL } from "../../lib/library/aggregate";
import { readDaily, readMeta } from "../../lib/library/store";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";

export const INFO: SourceInfo = {
  id: "nz-pharmac-medicines",
  country: "NZ (New Zealand)",
  category: "medicines (subsidised community pharmacy list prices)",
  name: "Pharmaceutical Schedule (PHARMAC)",
  publisher: "PHARMAC, the New Zealand Pharmaceutical Management Agency",
  what_is_recorded: "Every pack of the medicines that PHARMAC subsidises in the community (Section B of the Pharmaceutical Schedule), with its pack size and list price in NZD.",
  price_type: "posted_price",
  freshness: "A new edition about every month; our copy is refreshed daily",
  licence: "CC BY 4.0",
  licence_url: "https://creativecommons.org/licenses/by/4.0/",
  attribution: "Source: PHARMAC, Pharmaceutical Schedule (schedule.pharmac.govt.nz), licensed under CC BY 4.0; data not altered. The PHARMAC logo is not used.",
  homepage: "https://schedule.pharmac.govt.nz",
  limits:
    "List prices per pack as published in the Schedule (the price the supplier lists, not the amount a patient paid at a pharmacy; patient part-charges, pharmacy fees and GST are not included). " +
    "Only subsidised community medicines; hospital-only medicines and unsubsidised products are not in Section B. Each pack counts once, so a range spans all pack sizes and strengths " +
    "of one chemical or brand; it is a spread of list prices, not of what people paid.",
};

export const ARCHIVE_BASE = "https://schedule.pharmac.govt.nz/pub/schedule/archive";
export const MAX_KEYS = 3000;
const SKIP_FIRST = new Set(["sodium", "potassium", "calcium", "magnesium", "vitamin", "acid", "zinc", "iron", "ferrous"]);

export function editionUrl(date: string): string {
  return `${ARCHIVE_BASE}/${date.slice(0, 4)}/${date}/Schedule_${date}.xml`;
}

/** Dates (YYYY-MM-DD, newest first) from `today` back `days` days: the edition dates are irregular so we probe each one. */
export function candidateDates(today: string, days = 62): string[] {
  const t = Date.parse(today + "T00:00:00Z");
  return Array.from({ length: days + 1 }, (_, i) => new Date(t - i * 86400000).toISOString().slice(0, 10));
}

/** Lower-case ASCII first usable word of a chemical or brand name ("Paracetamol" -> "paracetamol"); skips generic leading words like "sodium". */
export function nameKey(name: string): string | null {
  const words = name
    .normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .split(/[^a-z0-9-]+/).map((w) => w.replace(/^-+|-+$/g, "")).filter((w) => w.length > 0);
  const w = words.find((t, i) => !(SKIP_FIRST.has(t) && i < words.length - 1)) ?? words[0];
  if (!w || w.length < 3 || /^\d+$/.test(w)) return null;
  return w;
}

function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

export interface NzPack { id: string; chemical: string; brand: string; quantity: number | null; price: number }
export interface NzSchedule { packs: NzPack[]; published: string | null; edition: string | null }

/**
 * Stream-parse the Schedule XML with a tag tokenizer (no DOM: the file is 2.9 MB). Only Section B (community) is read.
 * Tolerates a truncated file (used for the test fixture).
 */
export function parseSchedule(xml: string): NzSchedule {
  const tok = /<(Section|ATC1|ATC2|ATC3|Chemical|Formulation|Brand|Pack)\b([^>]*)>|<\/Section>|<(Name|Published|Edition|Quantity|Price)>([^<]*)<\/\3>/g;
  const packs: NzPack[] = [];
  let section = "", last = "", chemical = "", brand = "", pack: { id: string; q: number | null; p: number | null } | null = null;
  let published: string | null = null, edition: string | null = null;
  const flush = () => {
    if (pack && pack.p !== null && pack.p > 0 && section === "B" && chemical) packs.push({ id: pack.id, chemical, brand, quantity: pack.q, price: pack.p });
    pack = null;
  };
  let m: RegExpExecArray | null;
  while ((m = tok.exec(xml))) {
    if (m[1]) {
      if (m[1] !== "Pack") flush();
      last = m[1];
      if (m[1] === "Section") section = /\bID="([^"]*)"/.exec(m[2])?.[1] ?? "";
      else if (m[1] === "Chemical") { chemical = ""; brand = ""; }
      else if (m[1] === "Brand") brand = "";
      else if (m[1] === "Pack") { flush(); pack = { id: /\bID="([^"]*)"/.exec(m[2])?.[1] ?? "", q: null, p: null }; }
    } else if (m[0] === "</Section>") { flush(); section = ""; last = ""; }
    else {
      const v = m[4];
      if (m[3] === "Name") { if (last === "Chemical") chemical = decodeEntities(v).trim(); else if (last === "Brand") brand = decodeEntities(v).trim(); }
      else if (m[3] === "Published") published = v.trim();
      else if (m[3] === "Edition") edition = v.trim();
      else if (pack && m[3] === "Quantity") { const n = Number(v); pack.q = Number.isFinite(n) && n > 0 ? n : null; }
      else if (pack && m[3] === "Price") { const n = Number(v); pack.p = Number.isFinite(n) ? n : null; }
    }
  }
  flush();
  return { packs, published, edition };
}

/** Library rows: area ALL, item "name:<key>". Each pack counts once per key (its chemical and its brand). Top MAX_KEYS by pack count. */
export function nzDailyRows(packs: NzPack[]): DailyRow[] {
  const seen = new Set<string>();
  const recs: { area: string; item: string; price: number }[] = [];
  for (const p of packs) {
    for (const k of [nameKey(p.chemical), nameKey(p.brand)]) {
      if (!k) continue;
      const id = `${p.id}|${k}`;
      if (seen.has(id)) continue;
      seen.add(id);
      recs.push({ area: NATIONAL, item: `name:${k}`, price: p.price });
    }
  }
  const rows = aggregateDaily(recs, false).filter((r) => r.n >= MIN_PUBLISH);
  return rows.sort((a, b) => b.n - a.n).slice(0, MAX_KEYS).sort((a, b) => a.item.localeCompare(b.item));
}

const UA = { "user-agent": "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)" };

/** Newest edition URL: probe each date back from today (404 redirects elsewhere, 200 = an edition exists). */
export async function findLatestEdition(today = new Date().toISOString().slice(0, 10)): Promise<{ date: string; url: string }> {
  const dates = candidateDates(today);
  for (let i = 0; i < dates.length; i += 8) {
    const batch = dates.slice(i, i + 8);
    const hits = await Promise.all(
      batch.map(async (d) => {
        try {
          const r = await fetch(editionUrl(d), { method: "HEAD", headers: UA, redirect: "manual" });
          return r.status === 200 ? d : null;
        } catch {
          return null;
        }
      }),
    );
    const hit = hits.find((h) => h);
    if (hit) return { date: hit, url: editionUrl(hit) };
  }
  throw new SourceError("No PHARMAC Schedule edition found in the last 62 days under /pub/schedule/archive/");
}

export async function nzHarvest(): Promise<HarvestResult> {
  const ed = await findLatestEdition();
  const res = await fetch(ed.url, { headers: UA });
  if (!res.ok) throw new SourceError(`PHARMAC Schedule ${ed.date} returned HTTP ${res.status}`);
  const text = await res.text();
  const sched = parseSchedule(text);
  const rows = nzDailyRows(sched.packs);
  if (!rows.length) throw new SourceError(`PHARMAC Schedule ${ed.date} held no usable priced packs (${text.length} chars, ${sched.packs.length} packs, type ${res.headers.get("content-type")})`);
  const date = new Date().toISOString().slice(0, 10);
  return { date, currency: "NZD", unit: "per pack", rows, note: `Edition ${sched.edition ?? "?"} published ${sched.published ?? ed.date}, ${sched.packs.length} priced packs, ${rows.length} names with 5+ packs.` };
}

export function nzKey(medicine?: string): { item: string; key: string } {
  const key = medicine ? nameKey(medicine) : null;
  if (!key) throw new InputError("medicine is required: a chemical or brand name such as 'paracetamol' or 'panadol' (English names as in the NZ Pharmaceutical Schedule).");
  return { item: `name:${key}`, key };
}

export function nzHistoryKey(p: { medicine?: string }) {
  try {
    const k = nzKey(p.medicine);
    return { area: NATIONAL, item: k.item, label: `${k.key}, New Zealand` };
  } catch {
    return null;
  }
}

export const STALE_AFTER_DAYS = 7;

function methodText() {
  return (
    "Median and 10th–90th percentile of the list price per pack (NZD) of all subsidised community packs in PHARMAC's Pharmaceutical Schedule whose chemical or brand name starts with the given word, " +
    "copied once a day from the newest edition. Posted list prices, not market transactions; the range mixes pack sizes and strengths."
  );
}

export function nzAnswerFromRow(row: DailyRow & { date: string }, q: { key: string; baseUrl?: string; today?: string }): PriceAnswer {
  const today = q.today ?? new Date().toISOString().slice(0, 10);
  const ageDays = Math.round((Date.parse(today + "T00:00:00Z") - Date.parse(row.date + "T00:00:00Z")) / 86400000);
  const stale = ageDays > STALE_AFTER_DAYS;
  return buildAnswer({
    source: INFO,
    query: { country: "NZ", medicine: q.key },
    summary: { count: row.n, median: row.median, low: row.low, high: row.high, min: row.min, max: row.max },
    currency: "NZD",
    unit: "per pack (list price)",
    period: { from: row.date, to: row.date },
    method: methodText(),
    describe: (x) =>
      `Subsidised packs of "${q.key}" in New Zealand have a list price (per pack) of a median ${fmtMoney(x.median, "NZD")}; ` +
      `10th–90th percentile ${fmtMoney(x.low, "NZD")}–${fmtMoney(x.high, "NZD")} across the packs in PHARMAC's Pharmaceutical Schedule, which mix pack sizes and strengths. ` +
      `These are posted list prices, not market transactions or what a patient paid at the pharmacy.` +
      (stale ? ` Our copy of the Schedule is ${ageDays} days old (collected ${row.date}).` : ""),
    baseUrl: q.baseUrl,
    ...(stale ? { extra: { stale: true, days_since_collected: ageDays } } : {}),
  });
}

export async function nzMedicines(input: { medicine?: string; baseUrl?: string }): Promise<PriceAnswer> {
  const k = nzKey(input.medicine);
  const meta = readMeta(INFO.id);
  if (!meta?.last_date) throw new SourceError("ProofPrice collects this list daily; data appears after the next collection.");
  const to = meta.last_date;
  const from = new Date(Date.parse(to + "T00:00:00Z") - 60 * 86400000).toISOString().slice(0, 10);
  const rows = readDaily(INFO.id, { area: NATIONAL, item: k.item, from, to });
  const row = rows[rows.length - 1];
  if (!row) {
    return buildAnswer({
      source: INFO, query: { country: "NZ", medicine: k.key }, summary: null, currency: "NZD", unit: "per pack (list price)",
      period: { from: null, to: null }, method: methodText(), describe: () => "", baseUrl: input.baseUrl,
      extra: { hint: "No chemical or brand starting with this word has 5 or more subsidised packs in the Pharmaceutical Schedule. Try the generic chemical name (e.g. 'paracetamol') or a brand, first word only." },
    });
  }
  return nzAnswerFromRow(row, { key: k.key, baseUrl: input.baseUrl });
}
