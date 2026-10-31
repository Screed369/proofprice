// Poland medicine prices: Ministry of Health (Ministerstwo Zdrowia) "Obwieszczenie w sprawie wykazu refundowanych lekow, srodkow spozywczych specjalnego
// przeznaczenia zywieniowego oraz wyrobow medycznych", published about every two months on gov.pl. Its Excel annex (sheet A1 = reimbursed medicines available
// in pharmacies on prescription) lists every pack with the official ex-factory price, the wholesale price and the maximum RETAIL price (Cena detaliczna, PLN
// incl. VAT and margin). One ~1 MB workbook; we never download it per request: the daily collector (harvest) reads it once, keeps aggregates per brand name
// (first word) and per active substance (Latin INN, first word) in the price library, and requests are answered from there.
// Regulated maximum prices, not transactions. Column positions are found from the header row text, not fixed letters.

import { inflateRawSync } from "node:zlib";
import { InputError, SourceError } from "../../lib/http";
import { MIN_PUBLISH } from "../../lib/stats";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { aggregateDaily, NATIONAL } from "../../lib/library/aggregate";
import { readDaily, readMeta } from "../../lib/library/store";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";

export const INFO: SourceInfo = {
  id: "pl-mz-medicines",
  country: "PL (Poland)",
  category: "medicines (regulated maximum retail prices of reimbursed medicines)",
  name: "Wykaz refundowanych lekow (Ministerstwo Zdrowia)",
  publisher: "Ministerstwo Zdrowia (Ministry of Health, Poland)",
  what_is_recorded: "Every pack of a medicine on the Polish list of reimbursed medicines available in pharmacies on prescription, with its official maximum retail price (cena detaliczna, PLN incl. VAT and the pharmacy margin), the active substance and the brand name.",
  price_type: "posted_price",
  freshness: "A new list is published about every two months (entry into force on the 1st of January, March, May and so on); our copy is re-read daily",
  licence: "gov.pl states that its text content is licensed CC BY-SA 4.0 (read 24 Oct 2026); the Excel annexes of the announcement are not clearly covered by that statement, and the list is an official act that Polish copyright law excludes from copyright (art. 4) - a legal reading, not a licence. Treated as UNCLEAR: free tier only",
  licence_url: "https://www.gov.pl/web/zdrowie/leki-refundowane",
  attribution: "Zrodlo: Ministerstwo Zdrowia, obwieszczenie w sprawie wykazu refundowanych lekow, srodkow spozywczych specjalnego przeznaczenia zywieniowego oraz wyrobow medycznych; data not altered in meaning.",
  homepage: "https://www.gov.pl/web/zdrowie/leki-refundowane",
  limits:
    "Legally fixed MAXIMUM retail prices per pack (PLN, incl. VAT), not what people paid; pharmacies may charge less. Only reimbursed medicines sold in pharmacies on prescription " +
    "(sheet A1); hospital programmes, chemotherapy, dietary foods and medical devices are left out, and so are over-the-counter products with free prices. The Ministry's page calls the " +
    "published list a draft announcement (projekt obwieszczenia) until it appears in the official gazette; prices are those of the list that applies from its stated date. " +
    "Each pack counts once, so a range spans all pack sizes and strengths under one brand name or substance. The patient's co-payment is not included. " +
    "Packs with several active substances count under their brand name only.",
};

export const LISTING_URL = "https://www.gov.pl/web/zdrowie/leki-refundowane";
export const MAX_KEYS = 3000; // library size guard: the keys with the most packs
export const SHEET = "A1";

const UA = { "user-agent": "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)" };
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/ł/g, "l");

/** Polish decimal comma: "1 234,50" or "19,05" -> number; null when empty, zero or not a number. */
export function parsePrice(v: string): number | null {
  const s = (v ?? "").trim().replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** First usable word of a brand name, lower-case ASCII ("Adeksa, tabl., 100 mg" -> "adeksa"); null when too short or numeric. */
export function nameKey(name: string): string | null {
  const w = fold(name).split(/[^a-z0-9]+/).filter((x) => x.length > 0)[0];
  if (!w || w.length < 3 || /^\d+$/.test(w)) return null;
  return w;
}

/** Latin INN as written on the list ("Metformini hydrochloridum", "Atorvastatinum", "Acidum acetylsalicylicum") -> the plain stem ("metformin", "atorvastatin",
 *  "acetylsalicylic"). null for combinations ("A + B"), empty or too short names. */
export function substanceKey(sub: string): string | null {
  if (/\+/.test(sub)) return null;
  const words = fold(sub).split(/[^a-z0-9]+/).filter((x) => x.length > 0);
  let w = words[0];
  if (w === "acidum" && words[1]) w = words[1].replace(/icum$/, "ic");
  return stem(w);
}
/** Strip the Latin ending: -um (nominative), -i (genitive of a salt). Used for list entries and for what the user types. */
function stem(w: string | undefined): string | null {
  if (!w) return null;
  const s = w.replace(/um$/, "").replace(/(?<=[a-z]{5})i$/, "");
  return s.length >= 4 ? s : null;
}

// --- minimal xlsx reader (zip central directory + deflate + shared strings); no dependency ---

interface ZipEntry { name: string; method: number; csize: number; offset: number }
function zipEntries(buf: Buffer): Map<string, ZipEntry> {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new SourceError("Polish list is not a zip/xlsx file (no end-of-directory record)");
  const total = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, ZipEntry>();
  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new SourceError("Polish list zip directory is damaged");
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    out.set(buf.toString("utf8", p + 46, p + 46 + nl), { name: buf.toString("utf8", p + 46, p + 46 + nl), method, csize, offset });
    p += 46 + nl + el + cl;
  }
  return out;
}
function zipRead(buf: Buffer, e: ZipEntry): string {
  const nl = buf.readUInt16LE(e.offset + 26), el = buf.readUInt16LE(e.offset + 28);
  const data = buf.subarray(e.offset + 30 + nl + el, e.offset + 30 + nl + el + e.csize);
  if (e.method === 0) return data.toString("utf8");
  if (e.method === 8) return inflateRawSync(data).toString("utf8");
  throw new SourceError(`Polish list zip uses unsupported compression ${e.method}`);
}
const unxml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** Rows of one worksheet (by sheet name) as arrays of cell texts indexed by column letter order (A=0). Empty cells are "". */
export function readSheet(xlsx: Buffer, sheetName: string): string[][] {
  const zip = zipEntries(xlsx);
  const get = (name: string) => { const e = zip.get(name); if (!e) throw new SourceError(`Polish list workbook has no ${name}`); return zipRead(xlsx, e); };
  const wb = get("xl/workbook.xml");
  const sm = [...wb.matchAll(/<sheet\b[^>]*>/g)].map((m) => m[0]).find((t) => new RegExp(`name="${sheetName}"`).test(t));
  const rid = sm && /r:id="([^"]+)"/.exec(sm)?.[1];
  if (!rid) throw new SourceError(`Polish list workbook has no sheet ${sheetName}`);
  const relTag = [...get("xl/_rels/workbook.xml.rels").matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((t) => t.includes(`Id="${rid}"`));
  const target = relTag && /Target="([^"]+)"/.exec(relTag)?.[1];
  if (!target) throw new SourceError(`Polish list workbook sheet ${sheetName} has no file`);
  const sheetXml = get("xl/" + target.replace(/^\/?(xl\/)?/, ""));
  const ssXml = zip.has("xl/sharedStrings.xml") ? get("xl/sharedStrings.xml") : "";
  const strings = [...ssXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => unxml(m[1].replace(/<[^>]+>/g, "")));
  const colIndex = (letters: string) => letters.split("").reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  const rows: string[][] = [];
  for (const rm of sheetXml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const cm of rm[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const v = /<v>([\s\S]*?)<\/v>/.exec(cm[3] ?? "")?.[1] ?? "";
      const inline = /<is>([\s\S]*?)<\/is>/.exec(cm[3] ?? "")?.[1];
      const val = inline !== undefined ? unxml(inline.replace(/<[^>]+>/g, "")) : /\bt="s"/.test(cm[2]) && v !== "" ? strings[Number(v)] ?? "" : unxml(v);
      cells[colIndex(cm[1])] = val.trim();
    }
    rows.push(Array.from(cells, (c) => c ?? ""));
  }
  return rows;
}

export interface PlPack { gtin: string; name: string; substance: string; price: number }

const norm = (s: string) => fold(s).replace(/\s+/g, " ").trim();
/** Packs of sheet A1: needs the header row (substance, name, GTIN, retail price). Throws on a new layout. Keeps packs with a GTIN, a name and a retail price. */
export function parsePacks(rows: string[][]): PlPack[] {
  const h = rows.findIndex((r) => r.some((c) => norm(c) === "cena detaliczna") && r.some((c) => norm(c) === "substancja czynna"));
  if (h < 0) throw new SourceError("Polish list has a new layout: no header row with 'Substancja czynna' and 'Cena detaliczna' in sheet " + SHEET);
  const col = (re: RegExp) => rows[h].findIndex((c) => re.test(norm(c)));
  const cSub = col(/^substancja czynna$/), cName = col(/^nazwa/), cGtin = col(/^numer gtin/), cPrice = col(/^cena detaliczna$/);
  if ([cSub, cName, cGtin, cPrice].some((x) => x < 0)) throw new SourceError("Polish list has a new layout: a column of sheet " + SHEET + " is missing");
  const seen = new Set<string>();
  const packs: PlPack[] = [];
  for (const r of rows.slice(h + 1)) {
    const gtin = (r[cGtin] ?? "").replace(/\s/g, "");
    const price = parsePrice(r[cPrice] ?? "");
    const name = (r[cName] ?? "").trim();
    if (!/^\d{8,14}$/.test(gtin) || !name || price === null || seen.has(gtin)) continue;
    seen.add(gtin);
    packs.push({ gtin, name, substance: (r[cSub] ?? "").trim(), price });
  }
  return packs;
}

/** Library rows: area ALL, item "name:<key>" and "sub:<stem>". Each pack counts once per key. Top MAX_KEYS by pack count. */
export function plDailyRows(packs: PlPack[]): DailyRow[] {
  const recs: { area: string; item: string; price: number }[] = [];
  for (const p of packs) {
    const nk = nameKey(p.name);
    if (nk) recs.push({ area: NATIONAL, item: `name:${nk}`, price: p.price });
    const sk = substanceKey(p.substance);
    if (sk) recs.push({ area: NATIONAL, item: `sub:${sk}`, price: p.price });
  }
  const rows = aggregateDaily(recs, false).filter((r) => r.n >= MIN_PUBLISH);
  return rows.sort((a, b) => b.n - a.n).slice(0, MAX_KEYS).sort((a, b) => a.item.localeCompare(b.item));
}

const MONTHS: Record<string, number> = { stycznia: 1, lutego: 2, marca: 3, kwietnia: 4, maja: 5, czerwca: 6, lipca: 7, sierpnia: 8, wrzesnia: 9, pazdziernika: 10, listopada: 11, grudnia: 12 };

/** Pages of the list that applies from a date, from the listing page; newest first, only those starting no later than 45 days after `today`.
 *  Slugs end "...-ktory-wejdzie-w-zycie-1-pazdziernika-2026-r" (a trailing digit such as "-r2" marks a corrected page). */
export function listPages(html: string, today: Date): { url: string; from: string }[] {
  const out = new Map<string, { url: string; from: string }>();
  for (const m of html.matchAll(/href="(\/web\/zdrowie\/[^"]*obwieszczenia[^"]*wejdzie-w-zycie-(\d{1,2})-([a-z]+)-(\d{4})-r\d*)"/g)) {
    const mon = MONTHS[m[3]];
    if (!mon) continue;
    const from = `${m[4]}-${String(mon).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
    if (Date.parse(from + "T00:00:00Z") > today.getTime() + 45 * 86400000) continue;
    out.set(m[1], { url: "https://www.gov.pl" + m[1], from });
  }
  return [...out.values()].sort((a, b) => b.from.localeCompare(a.from) || b.url.localeCompare(a.url));
}

/** The annex workbook on a list page: the attachment whose label is "...zalacznik do obwieszczenia.xlsx". null if none. */
export function pickAnnexUrl(html: string): string | null {
  for (const m of html.matchAll(/<a\b[^>]*href="(\/attachment\/[0-9a-f-]{36})"[^>]*>([\s\S]*?)<\/a>/g)) {
    const label = fold(m[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");
    if (/zalacznik do obwieszczenia\.xlsx/.test(label)) return "https://www.gov.pl" + m[1];
  }
  return null;
}

export async function plHarvest(): Promise<HarvestResult> {
  const lr = await fetch(LISTING_URL, { headers: UA });
  if (!lr.ok) throw new SourceError(`gov.pl list page returned HTTP ${lr.status}`);
  const pages = listPages(await lr.text(), new Date());
  if (!pages.length) throw new SourceError("gov.pl list page has no announcement page links (layout changed?)");
  const errors: string[] = [];
  for (const pg of pages.slice(0, 3)) {
    try {
      const r = await fetch(pg.url, { headers: UA });
      if (!r.ok) { errors.push(`${pg.url} HTTP ${r.status}`); continue; }
      const annex = pickAnnexUrl(await r.text());
      if (!annex) { errors.push(`${pg.url} has no annex xlsx link`); continue; }
      const xr = await fetch(annex, { headers: UA });
      if (!xr.ok) { errors.push(`${annex} HTTP ${xr.status}`); continue; }
      const packs = parsePacks(readSheet(Buffer.from(await xr.arrayBuffer()), SHEET));
      const rows = plDailyRows(packs);
      if (!rows.length) throw new SourceError(`Polish list held no usable priced packs (${packs.length} packs)`);
      const date = new Date().toISOString().slice(0, 10);
      return { date, currency: "PLN", unit: "per pack", rows, note: `List in force from ${pg.from}, ${packs.length} priced pharmacy packs, ${rows.length} keys with 5+ packs.` };
    } catch (e) {
      if (e instanceof SourceError && /new layout|held no usable/.test(e.message)) throw e;
      errors.push(`${pg.url} ${(e as Error).message}`);
    }
  }
  throw new SourceError(`Polish list not found: ${errors.join("; ")}`);
}

export interface PlKey { names: { item: string; key: string }[]; key: string }
/** What the user typed -> the library keys to try, best first: the active substance (Latin stem), then the brand name. */
export function plKey(medicine?: string): PlKey {
  const raw = (medicine ?? "").trim();
  const first = raw ? fold(raw).split(/[^a-z0-9]+/).filter((x) => x.length > 0)[0] : undefined;
  const sub = stem(first);
  const nm = raw ? nameKey(raw) : null;
  if (!sub && !nm) throw new InputError("medicine is required: an active substance such as 'metformin' or 'atorvastatin', or a Polish brand name such as 'euthyrox'.");
  const names: { item: string; key: string }[] = [];
  if (sub) names.push({ item: `sub:${sub}`, key: sub });
  if (nm) names.push({ item: `name:${nm}`, key: nm });
  return { names, key: (sub ?? nm)! };
}

export function plHistoryKey(p: { medicine?: string }) {
  try {
    const k = plKey(p.medicine);
    return { area: NATIONAL, item: k.names[0].item, label: `${k.names[0].key}, Poland` };
  } catch {
    return null;
  }
}

export const STALE_AFTER_DAYS = 7;
const UNIT = "per pack (maximum retail price incl. VAT)";

function methodText() {
  return (
    "Median and 10th–90th percentile of the official maximum retail price per pack (cena detaliczna, PLN incl. VAT) of all packs on the Ministry of Health list of reimbursed medicines " +
    "available in pharmacies on prescription whose active substance (Latin INN stem) or brand name starts with the given word, copied once a day. " +
    "Regulated maximum prices, not market transactions; the range mixes pack sizes and strengths."
  );
}

export function plAnswerFromRow(row: DailyRow & { date: string }, q: { key: string; kind: "sub" | "name"; baseUrl?: string; today?: string }): PriceAnswer {
  const today = q.today ?? new Date().toISOString().slice(0, 10);
  const ageDays = Math.round((Date.parse(today + "T00:00:00Z") - Date.parse(row.date + "T00:00:00Z")) / 86400000);
  const stale = ageDays > STALE_AFTER_DAYS;
  const what = q.kind === "sub" ? `the substance "${q.key}"` : `the brand name "${q.key}"`;
  return buildAnswer({
    source: INFO,
    query: { country: "PL", medicine: q.key },
    summary: { count: row.n, median: row.median, low: row.low, high: row.high, min: row.min, max: row.max },
    currency: "PLN",
    unit: UNIT,
    period: { from: row.date, to: row.date },
    method: methodText(),
    describe: (x) =>
      `Reimbursed pharmacy packs of ${what} in Poland have an official maximum retail price (per pack, incl. VAT) of a median ${fmtMoney(x.median, "PLN")}; ` +
      `10th–90th percentile ${fmtMoney(x.low, "PLN")}–${fmtMoney(x.high, "PLN")} across the packs on the Ministry of Health list, which mix pack sizes and strengths. ` +
      `These are regulated maximum prices, not market transactions.` +
      (stale ? ` Our copy of the list is ${ageDays} days old (collected ${row.date}).` : ""),
    baseUrl: q.baseUrl,
    ...(stale ? { extra: { stale: true, days_since_collected: ageDays } } : {}),
  });
}

export async function plMedicines(input: { medicine?: string; baseUrl?: string }): Promise<PriceAnswer> {
  const k = plKey(input.medicine);
  const meta = readMeta(INFO.id);
  if (!meta?.last_date) throw new SourceError("ProofPrice collects this list daily; data appears after the next collection.");
  const to = meta.last_date;
  const from = new Date(Date.parse(to + "T00:00:00Z") - 60 * 86400000).toISOString().slice(0, 10);
  for (const n of k.names) {
    const row = readDaily(INFO.id, { area: NATIONAL, item: n.item, from, to }).pop();
    if (row) return plAnswerFromRow(row, { key: n.key, kind: n.item.startsWith("sub:") ? "sub" : "name", baseUrl: input.baseUrl });
  }
  return buildAnswer({
    source: INFO, query: { country: "PL", medicine: k.key }, summary: null, currency: "PLN", unit: UNIT,
    period: { from: null, to: null }, method: methodText(), describe: () => "", baseUrl: input.baseUrl,
    extra: { hint: "No active substance or brand name like this has 5 or more packs on the Polish list of reimbursed pharmacy medicines. Try the English or Latin substance name (e.g. 'metformin', 'atorvastatin') or the first word of the Polish brand name." },
  });
}
