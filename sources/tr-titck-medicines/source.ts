// Turkey medicine prices: TITCK (Turkish Medicines and Medical Devices Agency) "Referans Bazlı İlaç Fiyat Listesi".
// The page https://www.titck.gov.tr/dinamikmodul/100 links one xlsx per revision (newest first, under /storage/Archive/<year>/).
// One sheet, header on row 5: "ILAC ADI " (drug name with strength and pack), "FIRMA ADI" (company), "GERCEK KAYNAK FIYAT (GKF) (€)"
// (reference ex-factory price in EUR). No active-substance column, so names are grouped by the brand's first word.
// The daily collector (harvest) keeps aggregates per brand with 5+ packs; requests are answered from the library.
// Reference (posted) prices, never transactions or pharmacy shelf prices.

import { InputError, SourceError } from "../../lib/http";
import { MIN_PUBLISH } from "../../lib/stats";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { aggregateDaily, NATIONAL } from "../../lib/library/aggregate";
import { readDaily, readMeta } from "../../lib/library/store";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { Cell, readXlsx } from "../../categories/rent/xlsx";

export const INFO: SourceInfo = {
  id: "tr-titck-medicines",
  country: "TR (Türkiye)",
  category: "medicines (reference ex-factory prices)",
  name: "Reference-based medicine price list (TITCK, Türkiye)",
  publisher: "TITCK, Türkiye İlaç ve Tıbbi Cihaz Kurumu (Turkish Medicines and Medical Devices Agency)",
  what_is_recorded:
    "Each listed medicine pack in Türkiye with its reference ex-factory price in euro (Gerçek Kaynak Fiyat, GKF) from the agency's reference-based price list.",
  price_type: "posted_price",
  freshness: "The agency publishes a new list whenever the reference prices are revised; our copy is refreshed daily",
  licence:
    "No licence or reuse terms are stated on the TITCK list page (https://www.titck.gov.tr/dinamikmodul/100, read 6 Nov 2026). Not cleared for commercial reuse, so this source is served free of charge only.",
  licence_url: "https://www.titck.gov.tr/dinamikmodul/100",
  attribution:
    "Source: TITCK (Türkiye İlaç ve Tıbbi Cihaz Kurumu), Referans Bazlı İlaç Fiyat Listesi, list shown in the answer. Medians and ranges are calculated by ProofPrice.",
  homepage: "https://www.titck.gov.tr/dinamikmodul/100",
  limits:
    "Reference ex-factory prices in euro per pack as set in the agency's list; not what a patient paid at a pharmacy (pharmacy margin, VAT and Turkish-lira price conversion are not included). " +
    "The list has no active-substance column, so packs are grouped by the brand name's first word; a range spans all strengths and pack sizes of that brand.",
};

export const MAX_KEYS = 3000;
export const LIST_PAGE = "https://www.titck.gov.tr/dinamikmodul/100";

/** Upper-case Turkish letters folded to lower-case ASCII; first usable word, or null for numbers and very short words. */
export function nameKey(name: string): string | null {
  const w = name
    .replace(/İ/g, "i").replace(/I/g, "i").replace(/ı/g, "i")
    .normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/ß/g, "ss")
    .split(/[^a-z0-9-]+/).map((t) => t.replace(/^-+|-+$/g, "")).find((t) => t.length > 0);
  if (!w || w.length < 3 || /^\d+$/.test(w)) return null;
  return w;
}

export interface TrPack { name: string; company: string; price: number }
export interface TrList { packs: TrPack[]; revision: string | null }

/** Parse the sheet rows (as returned by readXlsx): the header row starts with "ILAC ADI". */
export function parseTitckRows(rows: Cell[][]): TrList {
  const title = String(rows[0]?.[0] ?? "");
  const rev = /EDİT-LST-\d+\s*\/\s*(\d{2})\.(\d{2})\.(\d{4})/i.exec(title);
  const revision = rev ? `${rev[3]}-${rev[2]}-${rev[1]}` : null;
  const h = rows.findIndex((r) => String(r?.[0] ?? "").trim().toUpperCase() === "ILAC ADI");
  if (h < 0) throw new SourceError("TITCK list: header row 'ILAC ADI' not found; the layout may have changed.");
  const seen = new Set<string>();
  const packs: TrPack[] = [];
  for (const r of rows.slice(h + 1)) {
    if (!r || r.length < 3) continue;
    const name = String(r[0] ?? "").trim();
    const price = typeof r[2] === "number" && Number.isFinite(r[2]) && r[2] > 0 ? r[2] : null;
    if (!name || price === null) continue;
    const id = `${name}|${String(r[1] ?? "").trim()}`;
    if (seen.has(id)) continue;
    seen.add(id);
    packs.push({ name, company: String(r[1] ?? "").trim(), price });
  }
  return { packs, revision };
}

/** Library rows: area ALL, item "name:<brand first word>". Each listed pack counts once. Brands with 5+ packs, top MAX_KEYS. */
export function titckDailyRows(packs: TrPack[]): DailyRow[] {
  const recs: { area: string; item: string; price: number }[] = [];
  for (const p of packs) {
    const k = nameKey(p.name);
    if (k) recs.push({ area: NATIONAL, item: `name:${k}`, price: p.price });
  }
  const rows = aggregateDaily(recs, false).filter((r) => r.n >= MIN_PUBLISH);
  return rows.sort((a, b) => b.n - a.n).slice(0, MAX_KEYS).sort((a, b) => a.item.localeCompare(b.item));
}

/** xlsx links on the list page, in page order (newest first). */
export function listLinks(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/href="(https:\/\/(?:www\.)?titck\.gov\.tr\/storage\/Archive\/[^"]+\.xlsx)"/gi)) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

const UA = { "user-agent": "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)" };

async function get(url: string, ms: number): Promise<Buffer> {
  const res = await fetch(url, { headers: UA, redirect: "follow", signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new SourceError(`HTTP ${res.status} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function titckHarvest(): Promise<HarvestResult> {
  const html = (await get(LIST_PAGE, 60000)).toString("utf8");
  const links = listLinks(html).slice(0, 3);
  if (!links.length) throw new SourceError("TITCK list page shows no xlsx links; the page layout may have changed.");
  let lastErr = "";
  for (const url of links) {
    try {
      const buf = await get(url, 60000);
      if (buf.length < 1000 || buf[0] !== 0x50 || buf[1] !== 0x4b) { lastErr = `${url}: not an xlsx`; continue; }
      const list = parseTitckRows(readXlsx(buf)[0]?.rows ?? []);
      const rows = titckDailyRows(list.packs);
      if (!rows.length) { lastErr = `${url}: no usable rows (${list.packs.length} priced packs)`; continue; }
      return {
        date: new Date().toISOString().slice(0, 10), currency: "EUR", unit: "per pack", rows,
        note: `TITCK reference list, form dated ${list.revision ?? "?"}, ${list.packs.length} priced packs, ${rows.length} brands with 5+ packs.`,
      };
    } catch (e) {
      lastErr = `${url}: ${(e as Error).message}`;
    }
  }
  throw new SourceError(`No usable TITCK reference price list found (${lastErr})`);
}

export function titckKey(medicine?: string): { item: string; key: string } {
  const key = medicine ? nameKey(medicine) : null;
  if (!key) throw new InputError("medicine is required: a Turkish brand name such as 'zyprexa' or 'abilify' (first word used).");
  return { item: `name:${key}`, key };
}

export function titckHistoryKey(p: { medicine?: string }) {
  try {
    const k = titckKey(p.medicine);
    return { area: NATIONAL, item: k.item, label: `${k.key}, Türkiye` };
  } catch {
    return null;
  }
}

export const STALE_AFTER_DAYS = 7;

function methodText() {
  return (
    "Median and 10th–90th percentile of the reference ex-factory price per pack (EUR) of all packs in TITCK's reference-based price list whose brand name starts with the given word, " +
    "copied once a day from the newest list. Reference prices, not market transactions; the range mixes strengths and pack sizes."
  );
}

export function titckAnswerFromRow(row: DailyRow & { date: string }, q: { key: string; baseUrl?: string; today?: string }): PriceAnswer {
  const today = q.today ?? new Date().toISOString().slice(0, 10);
  const ageDays = Math.round((Date.parse(today + "T00:00:00Z") - Date.parse(row.date + "T00:00:00Z")) / 86400000);
  const stale = ageDays > STALE_AFTER_DAYS;
  return buildAnswer({
    source: INFO,
    query: { country: "TR", medicine: q.key },
    summary: { count: row.n, median: row.median, low: row.low, high: row.high, min: row.min, max: row.max },
    currency: "EUR",
    unit: "per pack (reference ex-factory price)",
    period: { from: row.date, to: row.date },
    method: methodText(),
    describe: (x) =>
      `Packs of "${q.key}" in TITCK's Turkish reference price list have a reference ex-factory price (per pack) of a median ${fmtMoney(x.median, "EUR")}; ` +
      `10th–90th percentile ${fmtMoney(x.low, "EUR")}–${fmtMoney(x.high, "EUR")} across the listed strengths and pack sizes. ` +
      `These are reference prices, not market transactions or what a patient paid at the pharmacy.` +
      (stale ? ` Our copy of the list is ${ageDays} days old (collected ${row.date}).` : ""),
    baseUrl: q.baseUrl,
    ...(stale ? { extra: { stale: true, days_since_collected: ageDays } } : {}),
  });
}

export async function titckMedicines(input: { medicine?: string; baseUrl?: string }): Promise<PriceAnswer> {
  const k = titckKey(input.medicine);
  const meta = readMeta(INFO.id);
  if (!meta?.last_date) throw new SourceError("ProofPrice collects this list daily; data appears after the next collection.");
  const to = meta.last_date;
  const from = new Date(Date.parse(to + "T00:00:00Z") - 60 * 86400000).toISOString().slice(0, 10);
  const rows = readDaily(INFO.id, { area: NATIONAL, item: k.item, from, to });
  const row = rows[rows.length - 1];
  if (!row) {
    return buildAnswer({
      source: INFO, query: { country: "TR", medicine: k.key }, summary: null, currency: "EUR", unit: "per pack (reference ex-factory price)",
      period: { from: null, to: null }, method: methodText(), describe: () => "", baseUrl: input.baseUrl,
      extra: { hint: "No brand starting with this word has 5 or more packs in TITCK's reference price list. Try a Turkish brand name (first word only), e.g. 'zyprexa' or 'abilify'." },
    });
  }
  return titckAnswerFromRow(row, { key: k.key, baseUrl: input.baseUrl });
}
