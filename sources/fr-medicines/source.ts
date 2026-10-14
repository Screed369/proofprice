// France medicine prices: the public medicines database (ANSM, HAS, Assurance Maladie). Two files (~4 MB + ~3 MB):
// packs with their legally fixed price (CIS_CIP_bdpm.txt, UTF-8) and medicine names (CIS_bdpm.txt, latin-1).
// We never download them per request: the daily collector (harvest) reads them once, keeps aggregates per medicine
// name (first word of the name, e.g. DOLIPRANE or PARACETAMOL) in the price library, and requests are answered from there.
// These are regulated (posted) prices, identical in every pharmacy; they are not market transactions.

import { InputError, SourceError } from "../../lib/http";
import { MIN_PUBLISH } from "../../lib/stats";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { aggregateDaily, NATIONAL } from "../../lib/library/aggregate";
import { readDaily, readMeta } from "../../lib/library/store";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";

export const INFO: SourceInfo = {
  id: "fr-medicines",
  country: "FR (France)",
  category: "medicines (regulated pharmacy prices)",
  name: "Base de données publique des médicaments",
  publisher: "ANSM, HAS and Assurance Maladie (France)",
  what_is_recorded: "Every medicine pack on the French market with its legally fixed price (excluding and including the dispensing fee) and its reimbursement rate, where reimbursable.",
  price_type: "posted_price",
  freshness: "Files updated regularly by the publisher (about monthly or more often); our copy is refreshed daily",
  licence: "Licence Ouverte / Etalab 2.0",
  licence_url: "https://www.etalab.gouv.fr/licence-ouverte-open-licence/",
  attribution:
    "Source: Base de données publique des médicaments (ANSM, HAS, Assurance Maladie), licence ouverte Etalab 2.0; data not altered.",
  homepage: "https://base-donnees-publique.medicaments.gouv.fr/",
  limits:
    "Regulated (posted) public prices of reimbursable packs on sale, not market transactions: the price per box including VAT and the per-box dispensing fee, which is also the base Assurance Maladie reimburses from; " +
    "the patient pays it minus the reimbursement (and any top-up insurance), and per-prescription pharmacy fees are not included. " +
    "Each pack counts once, so a range spans all pack sizes and strengths of one medicine name (a box of 8 and a box of 100 sit side by side); it is a spread of list prices, not of what people paid. " +
    "Packs without a fixed price (not reimbursed, or no longer sold) are left out. Overseas departments have mark-ups.",
};

export const CIP_URL = "https://base-donnees-publique.medicaments.gouv.fr/download/file/CIS_CIP_bdpm.txt";
export const NAMES_URL = "https://base-donnees-publique.medicaments.gouv.fr/download/file/CIS_bdpm.txt";
export const MAX_NAMES = 2000; // library size guard: the medicine names with the most packs

/** "24,34", "1 234,56" or "1,234,56" -> 24.34 / 1234.56 / 1234.56 (the LAST comma is the decimal mark); null when empty or not a number. */
export function parseEuro(v: string): number | null {
  const s = v.replace(/[\s\u00a0]/g, "").replace(/\./g, "");
  const i = s.lastIndexOf(",");
  const t = i < 0 ? s : s.slice(0, i).replace(/,/g, "") + "." + s.slice(i + 1);
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** "100%", "65 %", "15 %" -> 100 / 65 / 15; null when empty. */
export function parseRate(v: string): number | null {
  const m = /(\d{1,3})\s*%/.exec(v);
  return m ? Number(m[1]) : null;
}

/** Lower-case ASCII slug of the FIRST word of a medicine name ("Doliprané" -> "doliprane"); null if unusable. */
export function nameKey(name: string): string | null {
  const first = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .split(/[^a-z0-9-]+/)
    .find((t) => t.length > 0);
  if (!first || first.length < 3 || /^\d+$/.test(first)) return null;
  return first.replace(/^-+|-+$/g, "") || null;
}

/** CIS_bdpm.txt (tab separated, no header): CIS (col 1) -> medicine name (col 2). */
export function parseNames(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const c = line.split("\t");
    if (c.length < 2 || !/^\d{8}$/.test(c[0])) continue;
    out.set(c[0], c[1]);
  }
  return out;
}

export interface FrPack {
  cis: string;
  cip13: string;
  rate: number | null; // reimbursement rate in %, null when not reimbursed
  priceIncl: number; // EUR per box, including the dispensing fee
  priceExcl: number | null; // EUR per box, excluding the dispensing fee
}

/**
 * CIS_CIP_bdpm.txt: tab separated, no header, 13 columns. Cols (1-based): 1 CIS, 5 marketing status,
 * 7 CIP13, 9 reimbursement rate, 10 price excl. fee, 11 price incl. fee (decimal comma). Rows are kept only when the
 * pack is on sale ("Déclaration de commercialisation") and carries a fixed price.
 */
export function parseCip(text: string): FrPack[] {
  const out: FrPack[] = [];
  for (const line of text.split(/\r?\n/)) {
    const c = line.split("\t");
    if (c.length < 11 || !/^\d{8}$/.test(c[0])) continue;
    if (!/d.claration de commercialisation/i.test(c[4])) continue;
    const priceIncl = parseEuro(c[10]);
    if (priceIncl === null) continue;
    out.push({ cis: c[0], cip13: c[6].trim(), rate: parseRate(c[8]), priceIncl, priceExcl: parseEuro(c[9]) });
  }
  return out;
}

/** Library rows: area ALL, item "name:<first-word>" (one price per pack, EUR incl. fee). Top MAX_NAMES by pack count. */
export function frDailyRows(packs: FrPack[], names: Map<string, string>): DailyRow[] {
  const recs: { area: string; item: string; price: number }[] = [];
  for (const p of packs) {
    const n = names.get(p.cis);
    const key = n ? nameKey(n) : null;
    if (key) recs.push({ area: NATIONAL, item: `name:${key}`, price: p.priceIncl });
  }
  const rows = aggregateDaily(recs, false).filter((r) => r.n >= MIN_PUBLISH);
  return rows.sort((a, b) => b.n - a.n).slice(0, MAX_NAMES).sort((a, b) => a.item.localeCompare(b.item));
}

const UA = { "user-agent": "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)" };

/** The daily collector: download both files once, return one aggregate row per medicine name. */
export async function frHarvest(): Promise<HarvestResult> {
  const [cipRes, namesRes] = await Promise.all([fetch(CIP_URL, { headers: UA }), fetch(NAMES_URL, { headers: UA })]);
  if (!cipRes.ok) throw new SourceError(`Medicines database (prices) returned HTTP ${cipRes.status}`);
  if (!namesRes.ok) throw new SourceError(`Medicines database (names) returned HTTP ${namesRes.status}`);
  const packs = parseCip(Buffer.from(await cipRes.arrayBuffer()).toString("utf8"));
  const names = parseNames(Buffer.from(await namesRes.arrayBuffer()).toString("latin1"));
  const rows = frDailyRows(packs, names);
  if (!rows.length) throw new SourceError("Medicines database held no usable priced packs");
  const date = new Date().toISOString().slice(0, 10);
  return { date, currency: "EUR", unit: "per box", rows, note: `Regulated prices incl. dispensing fee, ${packs.length} priced packs on sale, ${rows.length} medicine names with 5+ packs.` };
}

/** Normalise a request's medicine to its library key; throws InputError for nothing usable. */
export function frKey(medicine?: string): { item: string; key: string } {
  const key = medicine ? nameKey(medicine) : null;
  if (!key) throw new InputError("medicine is required: a medicine brand or active-substance name such as 'doliprane' or 'paracetamol'.");
  return { item: `name:${key}`, key };
}

export function frHistoryKey(p: { medicine?: string }) {
  try {
    const k = frKey(p.medicine);
    return { area: NATIONAL, item: k.item, label: `${k.key}, France` };
  } catch {
    return null;
  }
}

/** Pure: turn the latest library row into an answer. */
export const STALE_AFTER_DAYS = 7; // the collector runs daily; an older copy means it has stopped

export function frAnswerFromRow(row: DailyRow & { date: string }, q: { key: string; baseUrl?: string; today?: string }): PriceAnswer {
  const today = q.today ?? new Date().toISOString().slice(0, 10);
  const ageDays = Math.round((Date.parse(today + "T00:00:00Z") - Date.parse(row.date + "T00:00:00Z")) / 86400000);
  const stale = ageDays > STALE_AFTER_DAYS;
  return buildAnswer({
    source: INFO,
    query: { country: "FR", medicine: q.key },
    summary: { count: row.n, median: row.median, low: row.low, high: row.high, min: row.min, max: row.max },
    currency: "EUR",
    unit: "per box (incl. dispensing fee)",
    period: { from: row.date, to: row.date },
    method: methodText(),
    describe: (x) =>
      `Reimbursable packs of "${q.key}" in France have a legally fixed public price (per box, incl. VAT and the dispensing fee; also the base Assurance Maladie reimburses from) of a median ${fmtMoney(x.median, "EUR")} per box; ` +
      `10th–90th percentile ${fmtMoney(x.low, "EUR")}–${fmtMoney(x.high, "EUR")} across the packs listed, which mix pack sizes and strengths. ` +
      `These are regulated list prices, the same in every pharmacy in mainland France, not market transactions; the patient pays this minus the reimbursement.` +
      (stale ? ` Our copy of the database is ${ageDays} days old (collected ${row.date}).` : ""),
    baseUrl: q.baseUrl,
    ...(stale ? { extra: { stale: true, days_since_collected: ageDays } } : {}),
  });
}

function methodText() {
  return (
    "Median and 10th–90th percentile of the legally fixed price per box (including the dispensing fee) of all reimbursable packs currently on sale whose medicine name starts with the given word, " +
    "from the French public medicines database, copied once a day. Posted regulated prices, not market transactions; the range mixes pack sizes and strengths."
  );
}

export async function frMedicines(input: { medicine?: string; baseUrl?: string }): Promise<PriceAnswer> {
  const k = frKey(input.medicine);
  const meta = readMeta(INFO.id);
  if (!meta?.last_date) throw new SourceError("ProofPrice collects this database daily; data appears after the next collection.");
  const to = meta.last_date;
  const from = new Date(Date.parse(to + "T00:00:00Z") - 60 * 86400000).toISOString().slice(0, 10);
  const rows = readDaily(INFO.id, { area: NATIONAL, item: k.item, from, to });
  const row = rows[rows.length - 1];
  if (!row) {
    return buildAnswer({
      source: INFO, query: { country: "FR", medicine: k.key }, summary: null, currency: "EUR", unit: "per box (incl. dispensing fee)",
      period: { from: null, to: null }, method: methodText(), describe: () => "", baseUrl: input.baseUrl,
      extra: { hint: "No medicine name starting with this word has 5 or more reimbursable packs on sale. Try the brand or the active substance, first word only." },
    });
  }
  return frAnswerFromRow(row, { key: k.key, baseUrl: input.baseUrl });
}

