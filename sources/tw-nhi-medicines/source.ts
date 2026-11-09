// Taiwan medicine prices: National Health Insurance Administration (NHIA) "健保用藥品項查詢項目檔" (drug item file), open data on data.gov.tw (dataset 23715).
// One key-free CSV, about 96.5 MB, 225,028 rows (price history per drug code), UTF-8 with BOM, checked 9 Nov 2026 from the cloud workspace (two full downloads, 96,575,677 bytes each):
//   https://info.nhi.gov.tw/api/iode0000s01/Dataset?rId=A21030000I-E41001-001
// Header: 異動,藥品代號,藥品英文名稱,藥品中文名稱,成分,規格量,規格單位,單複方,支付價,有效起日,有效迄日,藥商,製造廠名稱,劑型,藥品分類,分類分組名稱,ATC代碼,...
// Real rows:  ,B004858100,FLUANXOL 3MG film coated tablets,"""隆柏"" 福祿安膜衣錠３毫克",FLUPENTIXOL (2HCL) 3 MG,,,單方,18.90,  960901,  980930,...,膜衣錠,研發廠,...,N05AF01,...
// 支付價 = NHI payment price in TWD for ONE item (tablet, capsule, vial, tube or pack as listed). Dates are ROC (year 民國 + 1911), "9991231" = still valid.
// The collector (harvest) reads the file once a day and keeps aggregates per ingredient in the price library; requests are answered from there.

import { InputError, SourceError } from "../../lib/http";
import { MIN_PUBLISH } from "../../lib/stats";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { aggregateDaily, NATIONAL } from "../../lib/library/aggregate";
import { readDaily, readMeta } from "../../lib/library/store";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";

export const INFO: SourceInfo = {
  id: "tw-nhi-medicines",
  country: "TW (Taiwan)",
  category: "medicines (National Health Insurance drug payment prices)",
  name: "Health insurance drug item file (健保用藥品項查詢項目檔)",
  publisher: "National Health Insurance Administration (NHIA), Ministry of Health and Welfare, Taiwan",
  what_is_recorded:
    "Every drug item that Taiwan's National Health Insurance reimburses, with its official payment price (支付價) in New Taiwan dollars per item " +
    "(per tablet, capsule, vial, tube or pack as listed), the active ingredient, ATC code, dosage form and whether it is an originator or a generic.",
  price_type: "posted_price",
  freshness: "Updated monthly by the publisher; our copy is refreshed daily",
  licence: "Open Government Data License, version 1.0 (data.gov.tw; any purpose, royalty-free, attribution required, compatible with CC BY 4.0)",
  licence_url: "https://data.gov.tw/license",
  attribution: "Source: National Health Insurance Administration, Taiwan, Health insurance drug item inquiry file (https://data.gov.tw/en/datasets/23715), Open Government Data License v1.0 (https://data.gov.tw/license). Aggregated by ProofPrice.",
  homepage: "https://data.gov.tw/en/datasets/23715",
  limits:
    "Official payment (reimbursement) prices per item, not what a patient paid: patients pay a small co-payment and the pharmacy adds its own fees. Only drugs on the NHI list; over-the-counter products and unlisted drugs are not included. " +
    "A range spans all strengths, makers and pack types of one ingredient, so it mixes strengths; the price is per item as listed (one tablet, one capsule, or one vial/tube/bottle for other forms), not per box. " +
    "The number is the count of listed drug items, not sales. Ingredient names are matched in English (first word, e.g. 'paracetamol' is listed as ACETAMINOPHEN).",
};

export const FILE_URL = "https://info.nhi.gov.tw/api/iode0000s01/Dataset?rId=A21030000I-E41001-001";
const UA = { "user-agent": "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)" };
/** A complete file has about 225,000 rows; the server sometimes cuts the transfer short (seen once on 9 Nov 2026), so fewer rows than this = retry. */
export const MIN_FILE_ROWS = 150_000;

/** RFC 4180 parser for the whole text (quoted fields, doubled quotes, CRLF or LF). Skips a BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQ = false;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export interface Drug {
  code: string;
  ingredient: string; // lower-case first English word of 成分 ("paroxetine")
  atc: string; // upper-case ATC code or ""
  form: string; // 劑型
  unit: "tab" | "cap" | "other";
  price: number; // TWD per item
  start: string; // ISO date
}

/** ROC date "1130401" (leading spaces allowed) -> "2024-04-01"; null if not a date. */
export function rocToIso(s: string): string | null {
  const m = /^\s*(\d{2,3})(\d{2})(\d{2})\s*$/.exec(s);
  if (!m) return null;
  return `${Number(m[1]) + 1911}-${m[2]}-${m[3]}`;
}

/** First English word of an ingredient text: "PAROXETINE HYDROCHLORIDE 20 MG" -> "paroxetine"; "FLUPENTIXOL (2HCL) 3 MG" -> "flupentixol". */
export function ingredientKey(text: string): string | null {
  const m = /^[^A-Za-z]*([A-Za-z][A-Za-z-]{2,})/.exec(String(text ?? "").trim());
  return m ? m[1].toLowerCase() : null;
}

export function unitOf(form: string): "tab" | "cap" | "other" {
  if (/膠囊/.test(form)) return "cap";
  if (/錠/.test(form)) return "tab";
  return "other";
}
export const UNIT_ORDER = ["tab", "cap", "other"] as const;
export const UNIT_LABEL: Record<string, string> = { tab: "per tablet", cap: "per capsule", other: "per item (vial, tube, bottle or pack as listed)" };

/** Read the file: keep rows that are valid today (end date 9991231, start not in the future) with a payment price above 0, one per drug code. */
export function parseDrugs(rows: string[][], today = new Date().toISOString().slice(0, 10)): Drug[] {
  if (!rows.length) throw new SourceError("The NHIA drug file is empty.");
  const head = rows[0].map((h) => h.trim());
  const ix = (name: string) => head.indexOf(name);
  const cCode = ix("藥品代號"), cIng = ix("成分"), cPrice = ix("支付價"), cStart = ix("有效起日"), cEnd = ix("有效迄日"), cForm = ix("劑型"), cAtc = ix("ATC代碼");
  if ([cCode, cIng, cPrice, cStart, cEnd, cForm].some((c) => c < 0))
    throw new SourceError("The NHIA drug file header no longer has 藥品代號, 成分, 支付價, 有效起日, 有效迄日 and 劑型; the format changed and this source needs updating.");
  const byCode = new Map<string, Drug>();
  for (const r of rows.slice(1)) {
    if (r.length < head.length - 3) continue; // cut-off or broken line
    if (r[cEnd].trim() !== "9991231") continue;
    const price = Number(r[cPrice].trim());
    if (!Number.isFinite(price) || price <= 0) continue;
    const start = rocToIso(r[cStart]);
    if (!start || start > today) continue;
    const ingredient = ingredientKey(r[cIng]);
    if (!ingredient) continue;
    const code = r[cCode].trim();
    const prev = byCode.get(code);
    if (prev && prev.start >= start) continue;
    byCode.set(code, { code, ingredient, atc: (cAtc >= 0 ? r[cAtc] : "").trim().toUpperCase(), form: r[cForm].trim(), unit: unitOf(r[cForm]), price, start });
  }
  return [...byCode.values()];
}

/** Library rows: area ALL, item "name:<ingredient>|<unit>" and "atc:<code>|<unit>". Each drug code counts once per key; groups under 5 items are dropped. */
export function dailyRows(drugs: Drug[]): DailyRow[] {
  const recs: { area: string; item: string; price: number }[] = [];
  for (const d of drugs) {
    recs.push({ area: NATIONAL, item: `name:${d.ingredient}|${d.unit}`, price: d.price });
    if (/^[A-Z]\d{2}[A-Z]{2}\d{2}$/.test(d.atc)) recs.push({ area: NATIONAL, item: `atc:${d.atc}|${d.unit}`, price: d.price });
  }
  return aggregateDaily(recs, false).filter((r) => r.n >= MIN_PUBLISH);
}

async function downloadOnce(url: string): Promise<string> {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(280_000) });
  if (!res.ok) throw new SourceError(`NHIA drug file returned HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer()).toString("utf8");
}

/** The server has cut this transfer short before: try the whole GET up to 3 times and keep the longest complete result. */
export async function fetchRows(url = FILE_URL, tries = 3, get: (u: string) => Promise<string> = downloadOnce): Promise<string[][]> {
  let best: string[][] = [];
  let lastErr = "";
  for (let i = 0; i < tries; i++) {
    try {
      const rows = parseCsv(await get(url));
      if (rows.length > best.length) best = rows;
      if (rows.length >= MIN_FILE_ROWS) return rows;
      lastErr = `only ${rows.length} rows`;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
  }
  throw new SourceError(`NHIA drug file incomplete after ${tries} tries (${lastErr}; best ${best.length} rows, need ${MIN_FILE_ROWS}).`);
}

export async function twHarvest(): Promise<HarvestResult> {
  const rows = await fetchRows();
  const drugs = parseDrugs(rows);
  if (drugs.length < 5000) throw new SourceError(`NHIA file gave only ${drugs.length} current priced drug items; the format may have changed.`);
  const out = dailyRows(drugs);
  const date = new Date().toISOString().slice(0, 10);
  return { date, currency: "TWD", unit: "per item", rows: out, note: `${drugs.length} current priced drug items, ${out.length} ingredient/ATC groups with 5+ items.` };
}

/** Common names -> the English name used in the list. */
export const ALIASES: Record<string, string> = {
  paracetamol: "acetaminophen", tylenol: "acetaminophen", panadol: "acetaminophen", adrenaline: "epinephrine", noradrenaline: "norepinephrine",
  salbutamol: "albuterol", frusemide: "furosemide", glibenclamide: "glyburide", "vitamin": "ascorbic",
};

export function candidateKeys(medicine?: string): string[] {
  const raw = String(medicine ?? "").trim().toLowerCase();
  if (!raw) throw new InputError("medicine is required: an active ingredient such as 'amlodipine', 'metformin' or 'acetaminophen', or an ATC code such as 'C08CA01' (not a brand name).");
  const first = raw.split(/[\s,;/]+/)[0];
  if (/^[a-z]\d{2}[a-z]{2}\d{2}$/.test(first)) return [`atc:${first.toUpperCase()}`];
  const out: string[] = [];
  const add = (k?: string) => { if (k && !out.includes(k)) out.push(k); };
  if (ALIASES[first]) add(`name:${ALIASES[first]}`);
  add(`name:${first}`);
  return out;
}

export function twHistoryKey(p: { medicine?: string }) {
  try {
    const k = candidateKeys(p.medicine)[0];
    return { area: NATIONAL, item: `${k}|tab`, label: `${k.split(":")[1]}, Taiwan (per tablet)` };
  } catch {
    return null;
  }
}

export const STALE_AFTER_DAYS = 7;

function methodText() {
  return (
    "Median and 10th–90th percentile of the official National Health Insurance payment price (New Taiwan dollars per listed item: tablet, capsule, or vial/tube/bottle/pack) of all drug items currently reimbursed by the NHIA " +
    "whose active ingredient matches the given name, copied once a day from the newest drug file. Posted reimbursement prices, not market transactions; the range mixes strengths, makers (originals and generics) and pack types."
  );
}

export function twAnswerFromRow(row: DailyRow & { date: string }, q: { key: string; unit: string; baseUrl?: string; today?: string }): PriceAnswer {
  const today = q.today ?? new Date().toISOString().slice(0, 10);
  const ageDays = Math.round((Date.parse(today + "T00:00:00Z") - Date.parse(row.date + "T00:00:00Z")) / 86400000);
  const stale = ageDays > STALE_AFTER_DAYS;
  const unitLabel = UNIT_LABEL[q.unit] ?? "per item";
  const label = q.key.split(":")[1];
  return buildAnswer({
    source: INFO,
    query: { country: "TW", medicine: label },
    summary: { count: row.n, median: row.median, low: row.low, high: row.high, min: row.min, max: row.max },
    currency: "TWD",
    unit: `${unitLabel} (official payment price)`,
    period: { from: row.date, to: row.date },
    method: methodText(),
    describe: (x) =>
      `Drug items with "${label}" on Taiwan's National Health Insurance list have an official payment price ${unitLabel} of a median ${fmtMoney(x.median, "TWD")}; ` +
      `10th–90th percentile ${fmtMoney(x.low, "TWD")}–${fmtMoney(x.high, "TWD")} across ${x.count} listed items, which mix strengths, makers (originals and generics) and pack types. ` +
      `These are official reimbursement prices, not market transactions or what a patient paid.` +
      (stale ? ` Our copy of the list is ${ageDays} days old (collected ${row.date}).` : ""),
    baseUrl: q.baseUrl,
    extra: { unit_form: q.unit, ...(stale ? { stale: true, days_since_collected: ageDays } : {}) },
  });
}

export async function twMedicines(input: { medicine?: string; baseUrl?: string }): Promise<PriceAnswer> {
  const keys = candidateKeys(input.medicine);
  const meta = readMeta(INFO.id);
  if (!meta?.last_date) throw new SourceError("ProofPrice collects this list daily; data appears after the next collection.");
  const to = meta.last_date;
  const from = new Date(Date.parse(to + "T00:00:00Z") - 60 * 86400000).toISOString().slice(0, 10);
  for (const key of keys) {
    let best: { row: DailyRow & { date: string }; unit: string } | null = null;
    for (const unit of UNIT_ORDER) {
      const rows = readDaily(INFO.id, { area: NATIONAL, item: `${key}|${unit}`, from, to });
      const row = rows[rows.length - 1];
      if (row && (!best || row.n > best.row.n)) best = { row, unit };
    }
    if (best) return twAnswerFromRow(best.row, { key, unit: best.unit, baseUrl: input.baseUrl });
  }
  return buildAnswer({
    source: INFO, query: { country: "TW", medicine: keys[0].split(":")[1] }, summary: null, currency: "TWD", unit: "per item (official payment price)",
    period: { from: null, to: null }, method: methodText(), describe: () => "", baseUrl: input.baseUrl,
    extra: { hint: "No ingredient matching this name has 5 or more listed drug items. Give the active ingredient in English (e.g. 'amlodipine', 'metformin', 'acetaminophen') or an ATC code (e.g. 'C08CA01'), not a brand name." },
  });
}
