// Sweden medicine prices: TLV (Tandvårds- och läkemedelsförmånsverket) "Periodens vara" list of substitutable medicines.
// One Excel file per month (periodens-vara-<monthname-sv>-<YYYYMM01>.xlsx, ~0.7 MB zipped, ~7 MB sheet XML, regenerated daily).
// Every pack has the pharmacies' purchase price (AIP) and the regulated pharmacy retail price (AUP) in SEK. We never download it
// per request: the daily collector (harvest) reads the newest file, keeps aggregates per substance and per brand (first word)
// in the price library, and requests are answered from there. Posted/regulated prices, never transactions.
// Checked 30 Oct 2026: the real file downloads from the sandbox shell (HTTP 200, 743,719 bytes); its XML uses an "x:" prefix on every
// element, which the shared reader in categories/rent/xlsx does not handle, so this folder has its own small sheet reader.

import { InputError, SourceError } from "../../lib/http";
import { MIN_PUBLISH } from "../../lib/stats";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { aggregateDaily, NATIONAL } from "../../lib/library/aggregate";
import { readDaily, readMeta } from "../../lib/library/store";
import { parseSharedStrings, unzipAll } from "../../categories/rent/xlsx";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";

export const INFO: SourceInfo = {
  id: "se-tlv-medicines",
  country: "SE (Sweden)",
  category: "medicines (pharmacy retail prices of substitutable medicines)",
  name: "Periodens vara price list (TLV)",
  publisher: "TLV, the Dental and Pharmaceutical Benefits Agency (Tandvårds- och läkemedelsförmånsverket)",
  what_is_recorded: "Every pack of the medicines that can be substituted at Swedish pharmacies (generic exchange), with its regulated pharmacy retail price (AUP) and pharmacy purchase price (AIP) in SEK.",
  price_type: "posted_price",
  freshness: "TLV regenerates the file daily; our copy is refreshed daily",
  licence: "Swedish open-data re-use (law 2022:818, 'tillgängliga för vidareutnyttjande'); no named licence on the TLV page",
  licence_url: "https://www.tlv.se/om-tlv/oppna-data.html",
  attribution: "Source: TLV (Tandvårds- och läkemedelsförmånsverket), tlv.se, Periodens vara; data not altered.",
  homepage: "https://www.tlv.se/om-tlv/oppna-data.html",
  limits:
    "Posted retail prices per pack (AUP) as set under the Swedish pharmacy price rules, not what a patient paid; patient co-payment and the high-cost protection are not included. " +
    "Only medicines on TLV's substitution list (generics, their originals and parallel imports), not every medicine sold in Sweden and not over-the-counter goods with free prices. " +
    "Each pack counts once, so a range spans pack sizes and strengths of one substance or brand; it is a spread of list prices, not of what people paid.",
};

export const BASE = "https://www.tlv.se/webdav/files/Periodens-vara";
export const LISTING_URL = "https://www.tlv.se/apotek/generiskt-utbyte/periodens-varor.html";
export const MAX_KEYS = 3000;
const SV_MONTHS = ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"];

/** File URL for a month: periodens-vara-oktober-20261001.xlsx. `month` is 1-12. */
export function monthFileUrl(year: number, month: number): string {
  return `${BASE}/periodens-vara-${SV_MONTHS[month - 1]}-${year}${String(month).padStart(2, "0")}01.xlsx`;
}

/** Newest monthly file linked on the TLV listing page (by the YYYYMM01 stamp); null if none is linked. */
export function latestFileFromListing(html: string): string | null {
  const found = [...html.matchAll(/Periodens-vara\/periodens-vara-([a-z]+)-(\d{8})\.xlsx/g)].map((m) => ({ stamp: m[2], path: m[0] }));
  if (!found.length) return null;
  found.sort((a, b) => (a.stamp < b.stamp ? 1 : -1));
  return `https://www.tlv.se/webdav/files/${found[0].path}`;
}

/** Candidate files when the listing cannot be read: this month and the two before it. */
export function fallbackUrls(today = new Date().toISOString().slice(0, 10)): string[] {
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  return [0, 1, 2].map((i) => { const mm = m - i; return mm >= 1 ? monthFileUrl(y, mm) : monthFileUrl(y - 1, mm + 12); });
}

/** Lower-case ASCII first usable word of a substance or brand ("Kvetiapin" -> "kvetiapin", "Alvedon®" -> "alvedon"). */
export function nameKey(name: string): string | null {
  const w = name
    .normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .split(/[^a-z0-9]+/).filter((t) => t.length > 0)[0];
  if (!w || w.length < 3 || /^\d+$/.test(w)) return null;
  return w;
}

function decodeEntities(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, "&");
}

function colIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export type Cell = string | number | null;

/** Read rows from a worksheet XML whose elements may carry a namespace prefix (x:row, x:c, x:v). Strings (t="str"/"s"/inline) and numbers. */
export function parseSheetRows(xml: string, shared: string[] = []): Cell[][] {
  const rows: Cell[][] = [];
  for (const rm of xml.matchAll(/<(?:\w+:)?row\b[^>]*>(.*?)<\/(?:\w+:)?row>/gs)) {
    const row: Cell[] = [];
    for (const cm of rm[1].matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>(.*?)<\/(?:\w+:)?c>)/gs)) {
      const ref = /\br="([A-Z]+)\d+"/.exec(cm[1]);
      if (!ref) continue;
      const t = /\bt="([^"]*)"/.exec(cm[1])?.[1] ?? "n";
      const body = cm[2] ?? "";
      let val: Cell = null;
      if (t === "inlineStr") {
        val = decodeEntities([...body.matchAll(/<(?:\w+:)?t\b[^>]*>(.*?)<\/(?:\w+:)?t>/gs)].map((x) => x[1]).join(""));
      } else {
        const v = /<(?:\w+:)?v>(.*?)<\/(?:\w+:)?v>/s.exec(body)?.[1];
        if (v !== undefined) {
          if (t === "s") val = shared[Number(v)] ?? null;
          else if (t === "str") val = decodeEntities(v);
          else { const n = Number(v); val = Number.isFinite(n) ? n : decodeEntities(v); }
        }
      }
      row[colIndex(ref[1])] = val;
    }
    for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = null;
    rows.push(row);
  }
  return rows;
}

export interface SvPack { id: string; substance: string; product: string; status: string; origin: string; size: number | null; price: number }

const norm = (c: Cell | undefined) => String(c ?? "").normalize("NFC").trim().toLowerCase();

/** Turn the sheet rows into priced packs. Finds columns by their Swedish header names. */
export function parsePacks(rows: Cell[][]): SvPack[] {
  const h = rows.findIndex((r) => r.some((c) => norm(c) === "produktnamn"));
  if (h < 0) throw new SourceError("The TLV Periodens vara sheet has no header row with 'Produktnamn'; the format changed and this source needs updating.");
  const head = rows[h].map(norm);
  const col = (...names: string[]) => head.findIndex((x) => names.includes(x));
  const cProd = col("produktnamn"), cNo = col("varunummer"), cSub = col("substans"), cSt = col("status"), cOr = col("ursprung"), cSize = col("storlek");
  const cAup = col("försäljningspris", "forsaljningspris");
  if (cProd < 0 || cSub < 0 || cAup < 0 || cNo < 0) throw new SourceError("The TLV Periodens vara sheet lost the Produktnamn, Varunummer, Substans or Försäljningspris column; this source needs updating.");
  const packs: SvPack[] = [];
  for (const r of rows.slice(h + 1)) {
    const price = r[cAup];
    const substance = String(r[cSub] ?? "").trim();
    if (typeof price !== "number" || !(price > 0) || !substance) continue;
    const size = typeof r[cSize] === "number" ? (r[cSize] as number) : null;
    packs.push({ id: String(r[cNo] ?? ""), substance, product: String(r[cProd] ?? "").trim(), status: String(r[cSt] ?? ""), origin: String(r[cOr] ?? ""), size, price });
  }
  return packs;
}

/** Library rows: area ALL, item "name:<key>". Each pack counts once per key (its substance and its product name). Top MAX_KEYS by pack count. */
export function seDailyRows(packs: SvPack[]): DailyRow[] {
  const seen = new Set<string>();
  const recs: { area: string; item: string; price: number }[] = [];
  for (const p of packs) {
    for (const k of [nameKey(p.substance), nameKey(p.product)]) {
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

/** Read the first worksheet of a TLV workbook (a zip) into rows. */
export function readTlvWorkbook(buf: Buffer): Cell[][] {
  const files = unzipAll(buf);
  const shared = files.get("xl/sharedStrings.xml") ? parseSharedStrings(files.get("xl/sharedStrings.xml")!.toString("utf8")) : [];
  const names = [...files.keys()].filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort();
  for (const n of names) {
    const rows = parseSheetRows(files.get(n)!.toString("utf8"), shared);
    if (rows.slice(0, 5).some((r) => r.some((c) => norm(c) === "produktnamn"))) return rows;
  }
  throw new SourceError("The TLV workbook has no worksheet with a 'Produktnamn' header; the format changed and this source needs updating.");
}

const UA = { "user-agent": "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)" };

async function getOk(url: string, tries = 3): Promise<Response> {
  let last = "";
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: UA });
      if (r.ok) return r;
      last = `HTTP ${r.status}`;
    } catch (e) {
      last = (e as Error).message;
    }
    await new Promise((res) => setTimeout(res, 1500 * (i + 1)));
  }
  throw new SourceError(`TLV ${url} failed: ${last}`);
}

export async function seHarvest(): Promise<HarvestResult> {
  const urls: string[] = [];
  try {
    const r = await getOk(LISTING_URL, 2);
    const u = latestFileFromListing(await r.text());
    if (u) urls.push(u);
  } catch { /* fall back to the month pattern */ }
  for (const u of fallbackUrls()) if (!urls.includes(u)) urls.push(u);
  let lastErr = "";
  for (const url of urls) {
    let buf: Buffer;
    try {
      buf = Buffer.from(await (await getOk(url)).arrayBuffer());
    } catch (e) {
      lastErr = (e as Error).message;
      continue;
    }
    const packs = parsePacks(readTlvWorkbook(buf));
    const rows = seDailyRows(packs);
    if (packs.length < 2000 || !rows.length) throw new SourceError(`TLV file ${url} gave only ${packs.length} priced packs and ${rows.length} names with 5+ packs; the format may have changed.`);
    const date = new Date().toISOString().slice(0, 10);
    return { date, currency: "SEK", unit: "per pack", rows, note: `${url.split("/").pop()}, ${packs.length} priced packs, ${rows.length} names with 5+ packs.` };
  }
  throw new SourceError(`No TLV Periodens vara file could be read (${lastErr}).`);
}

/** English (INN) names of common substances -> the Swedish substance name used in the list. Names that are the same in both need no entry. */
export const EN_TO_SV: Record<string, string> = {
  quetiapine: "kvetiapin", oxycodone: "oxikodon", olanzapine: "olanzapin", risperidone: "risperidon", paliperidone: "paliperidon", aripiprazole: "aripiprazol",
  omeprazole: "omeprazol", esomeprazole: "esomeprazol", pantoprazole: "pantoprazol", lansoprazole: "lansoprazol", azithromycin: "azitromycin",
  levothyroxine: "levotyroxin", sertraline: "sertralin", fluoxetine: "fluoxetin", mirtazapine: "mirtazapin", venlafaxine: "venlafaxin", paroxetine: "paroxetin",
  morphine: "morfin", codeine: "kodein", lamotrigine: "lamotrigin", topiramate: "topiramat", carbamazepine: "karbamazepin", memantine: "memantin",
  methotrexate: "metotrexat", cetirizine: "cetirizin", amoxicillin: "amoxicillin", simvastatin: "simvastatin", clonazepam: "klonazepam", haloperidol: "haloperidol",
  levodopa: "levodopa", bisoprolol: "bisoprolol", metoprolol: "metoprolol", furosemide: "furosemid", hydrochlorothiazide: "hydroklortiazid", spironolactone: "spironolakton",
  prednisolone: "prednisolon", ciprofloxacin: "ciprofloxacin", clindamycin: "klindamycin", doxycycline: "doxycyklin", fluconazole: "flukonazol",
  acyclovir: "aciklovir", valacyclovir: "valaciklovir", tamsulosin: "tamsulosin", finasteride: "finasterid", alendronate: "alendronat", gabapentin: "gabapentin",
  ondansetron: "ondansetron", escitalopram: "escitalopram", citalopram: "citalopram", clopidogrel: "klopidogrel", atorvastatin: "atorvastatin", rosuvastatin: "rosuvastatin",
  ibuprofen: "ibuprofen", acetaminophen: "paracetamol", albuterol: "salbutamol", metformin: "metformin", warfarin: "warfarin", diazepam: "diazepam",
};

/** Candidate library keys for the medicine text, most likely first: Swedish name of an English substance, the word itself, and the word minus a final "e". */
export function candidateKeys(medicine?: string): string[] {
  const first = medicine ? nameKey(medicine) : null;
  if (!first) throw new InputError("medicine is required: a substance or brand name such as 'paracetamol', 'quetiapine' or 'alvedon' (the list uses Swedish substance names; common English names are translated).");
  const out: string[] = [];
  const add = (k?: string) => { if (k && k.length >= 3 && !out.includes(k)) out.push(k); };
  add(EN_TO_SV[first]);
  add(first);
  if (first.endsWith("e")) add(first.slice(0, -1));
  return out;
}

export function seHistoryKey(p: { medicine?: string }) {
  try {
    const k = candidateKeys(p.medicine)[0];
    return { area: NATIONAL, item: `name:${k}`, label: `${k}, Sweden` };
  } catch {
    return null;
  }
}

export const STALE_AFTER_DAYS = 7;

function methodText() {
  return (
    "Median and 10th–90th percentile of the regulated pharmacy retail price per pack (SEK, AUP) of all packs on TLV's 'Periodens vara' substitution list whose substance or product name starts with the given word, " +
    "copied once a day from TLV's newest monthly file. Posted prices, not market transactions; the range mixes pack sizes and strengths."
  );
}

export function seAnswerFromRow(row: DailyRow & { date: string }, q: { key: string; baseUrl?: string; today?: string }): PriceAnswer {
  const today = q.today ?? new Date().toISOString().slice(0, 10);
  const ageDays = Math.round((Date.parse(today + "T00:00:00Z") - Date.parse(row.date + "T00:00:00Z")) / 86400000);
  const stale = ageDays > STALE_AFTER_DAYS;
  return buildAnswer({
    source: INFO,
    query: { country: "SE", medicine: q.key },
    summary: { count: row.n, median: row.median, low: row.low, high: row.high, min: row.min, max: row.max },
    currency: "SEK",
    unit: "per pack (pharmacy retail price)",
    period: { from: row.date, to: row.date },
    method: methodText(),
    describe: (x) =>
      `Packs of "${q.key}" on Sweden's pharmacy substitution list have a regulated retail price (per pack) of a median ${fmtMoney(x.median, "SEK")}; ` +
      `10th–90th percentile ${fmtMoney(x.low, "SEK")}–${fmtMoney(x.high, "SEK")} across the packs in TLV's Periodens vara list, which mix pack sizes and strengths. ` +
      `These are posted prices, not market transactions or what a patient paid.` +
      (stale ? ` Our copy of the list is ${ageDays} days old (collected ${row.date}).` : ""),
    baseUrl: q.baseUrl,
    ...(stale ? { extra: { stale: true, days_since_collected: ageDays } } : {}),
  });
}

export async function seMedicines(input: { medicine?: string; baseUrl?: string }): Promise<PriceAnswer> {
  const keys = candidateKeys(input.medicine);
  const meta = readMeta(INFO.id);
  if (!meta?.last_date) throw new SourceError("ProofPrice collects this list daily; data appears after the next collection.");
  const to = meta.last_date;
  const from = new Date(Date.parse(to + "T00:00:00Z") - 60 * 86400000).toISOString().slice(0, 10);
  for (const key of keys) {
    const rows = readDaily(INFO.id, { area: NATIONAL, item: `name:${key}`, from, to });
    const row = rows[rows.length - 1];
    if (row) return seAnswerFromRow(row, { key, baseUrl: input.baseUrl });
  }
  return buildAnswer({
    source: INFO, query: { country: "SE", medicine: keys[0] }, summary: null, currency: "SEK", unit: "per pack (pharmacy retail price)",
    period: { from: null, to: null }, method: methodText(), describe: () => "", baseUrl: input.baseUrl,
    extra: { hint: "No substance or product starting with this word has 5 or more packs on TLV's substitution list. Try the Swedish substance name (e.g. 'kvetiapin') or a brand name, first word only." },
  });
}
