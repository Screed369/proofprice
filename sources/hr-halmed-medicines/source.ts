// Croatia medicine prices: HALMED (Agencija za lijekove i medicinske proizvode) "Zbirni popis objavljenih cijena lijekova",
// the summary list of published MAXIMUM PERMITTED WHOLESALE PRICES (najviša dozvoljena cijena na veliko) of medicines, one xlsx per year.
// Real file (probed 21 Oct 2026 from GitHub Actions, HTTP 200, 596 KB):
//   https://ftp.halmed.hr/fdsak3jnFsk1Kfa/ostale_stranice/Zbirni-popis-objavljenih-cijena-lijekova-7356-svi.xlsx
// Sheet1: three title rows ("ZBIRNI POPIS OBJAVLJENIH CIJENA LIJEKOVA za 2026. godinu", "Datum prve objave: 07.01.2026", "Datum zadnje dopune: 21.10.2026"),
// then the header row:
//   Naziv lijeka i pakiranje | Djelatna tvar | ATK | Broj odobrenja pakiranja | Nositelj odobrenja | Lokalni predstavnik | Nositelj potvrde za paralelni promet |
//   Cijena (EUR ) | Dan objave cijene | Dan početka važenja cijene | Dan prestanka važenja cijene | Tip cijene* / Vrsta postupka
// Real rows: "Aban 10 mg filmom obložene tablete, 10 tableta u blisteru, u kutiji | rivaroksaban | B01AF01 | HR-H-790495386-01 | Alpha-Medical d.o.o. | | | 10.53 | 46164 | 46214 | | NDC / Godišnji izračun cijene lijeka"
// Prices are numbers, but some are text in Croatian format ("1.720,80"). Dates are Excel serial numbers. A pack can appear several times with
// different validity periods (the old price has an end date), so we keep only the price in force today for each pack.
// The listing page links every year's file; the current one has a changing number in its name ("-7356-svi"), so it is read from the page each run.
// A posted ceiling for wholesale, not what a patient or pharmacy paid. The collector reads the file once a day; requests are answered from the library.

import { InputError, SourceError } from "../../lib/http";
import { MIN_PUBLISH } from "../../lib/stats";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { aggregateDaily, NATIONAL } from "../../lib/library/aggregate";
import { readDaily, readMeta } from "../../lib/library/store";
import { readXlsx, excelDate, Cell } from "../../categories/rent/xlsx";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";

export const INFO: SourceInfo = {
  id: "hr-halmed-medicines",
  country: "HR (Croatia)",
  category: "medicines (maximum permitted wholesale prices)",
  name: "Summary list of published medicine prices (Zbirni popis objavljenih cijena lijekova)",
  publisher: "HALMED, Agency for Medicinal Products and Medical Devices of Croatia (Agencija za lijekove i medicinske proizvode)",
  what_is_recorded:
    "For every medicine pack on the Croatian market with a published price: the highest wholesale price (najviša dozvoljena cijena na veliko) in euro per pack, " +
    "the active substance, ATC code, marketing-authorisation holder, and the dates the price was published and is valid.",
  price_type: "posted_price",
  freshness: "Updated by the publisher several times a month; our copy is refreshed daily",
  licence: "Croatian Open Licence (Otvorena dozvola, OD): reuse including commercial use with attribution; changes must be marked",
  licence_url: "https://data.gov.hr/id/licence/otvorena-dozvola-rh",
  attribution:
    "Izvor / Source: Agencija za lijekove i medicinske proizvode (HALMED), Popisi najviših dozvoljenih cijena lijekova, https://www.halmed.hr/. Aggregated by ProofPrice (medians and ranges computed by ProofPrice); not endorsed by HALMED.",
  homepage: "https://ftp.halmed.hr/en/Promet-proizvodnja-i-inspekcija/Najvisa-dozvoljena-cijena-lijeka-na-veliko/Popis-lijekova-s-odredenom-najvisom-dozvoljenom-cijenom-na-veliko-i-iznimno-visom-od-najvise-dozvoljene-cijene-na-veliko/",
  limits:
    "Maximum permitted WHOLESALE prices (ceilings published by HALMED), not what a pharmacy charged or a patient paid: pharmacy margin and VAT come on top, and the health insurance fund (HZZO) decides reimbursement separately. " +
    "Only medicines with a published price; the range mixes pack sizes and strengths of one name, so it is per pack, not per tablet. Needs 5 or more packs under the name. " +
    "Names are matched on the first word of the active substance or brand, ignoring accents and common English/Croatian spelling differences (omeprazole = omeprazol).",
};

export const LISTING_URL = INFO.homepage;
export const SITE = "https://ftp.halmed.hr";
/** The file read by hand on 21 Oct 2026; used only if the listing page cannot be read. */
export const FALLBACK_FILE = "/fdsak3jnFsk1Kfa/ostale_stranice/Zbirni-popis-objavljenih-cijena-lijekova-7356-svi.xlsx";
const UA = { "user-agent": "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)" };

/** Lower-case, accents removed (č ć š ž đ), spaces collapsed. */
export function plain(s: unknown): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/đ/g, "d")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * One spelling for a drug name so English and Croatian INN forms meet: "amoxicillin" and "amoksicilin" both become "amocsicilin",
 * "omeprazole"/"omeprazol", "levothyroxine"/"levotiroksin", "diclofenac"/"diklofenak", "insulin"/"inzulin", "warfarin"/"varfarin".
 */
export function canon(word: string): string {
  let w = plain(word).replace(/[^a-z0-9]/g, "");
  w = w.replace(/ph/g, "f").replace(/th/g, "t").replace(/y/g, "i").replace(/w/g, "v").replace(/x/g, "ks").replace(/z/g, "s").replace(/k/g, "c");
  w = w.replace(/(.)\1+/g, "$1");
  if (w.length > 4) w = w.replace(/e$/, "");
  return w;
}

/** A few English names whose Croatian name is not just a spelling variant. */
export const ALIASES: Record<string, string> = {
  aspirin: "acetilsalicilna", acetylsalicylic: "acetilsalicilna", acetylsalicylate: "acetilsalicilna",
  paracetamol: "paracetamol", acetaminophen: "paracetamol",
  vitamin: "vitamin",
};

export interface Pack {
  name: string; // product and pack text
  substance: string; // as published
  approval: string;
  parallel: string;
  price: number; // EUR per pack
  start: string | null; // ISO date
  end: string | null;
}

/** "1.720,80" -> 1720.8; 10.53 -> 10.53; "35.6" -> 35.6. */
export function parsePrice(c: Cell): number {
  if (typeof c === "number") return c;
  const s = String(c ?? "").trim().replace(/\s/g, "");
  if (!s) return NaN;
  if (s.includes(",")) return Number(s.replace(/\./g, "").replace(",", "."));
  return Number(s);
}

function dateCell(c: Cell): string | null {
  if (typeof c === "number" && c > 30000 && c < 80000) return excelDate(c);
  const s = String(c ?? "").trim();
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})\.?$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (/^\d{5}$/.test(s)) return excelDate(Number(s));
  return null;
}

/** Find the header row (it holds "Djelatna tvar" and "Cijena") and read every priced row below it. */
export function parsePacks(rows: Cell[][]): Pack[] {
  let h = -1;
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const cells = rows[i].map(plain);
    if (cells.some((c) => c.startsWith("djelatna tvar")) && cells.some((c) => c.startsWith("cijena"))) { h = i; break; }
  }
  if (h < 0) throw new SourceError("The HALMED price list has no header row with 'Djelatna tvar' and 'Cijena'; the format changed and this source needs updating.");
  const head = rows[h].map(plain);
  const col = (pred: (c: string) => boolean) => head.findIndex(pred);
  const cName = col((c) => c.startsWith("naziv lijeka"));
  const cSub = col((c) => c.startsWith("djelatna tvar"));
  const cApp = col((c) => c.startsWith("broj odobrenja"));
  const cPar = col((c) => c.startsWith("nositelj potvrde"));
  const cPrice = col((c) => c.startsWith("cijena"));
  const cFrom = col((c) => c.startsWith("dan pocetka"));
  const cTo = col((c) => c.startsWith("dan prestanka"));
  if (cName < 0 || cPrice < 0 || cFrom < 0) throw new SourceError("The HALMED price list lost the name, price or start-date column; this source needs updating.");
  const out: Pack[] = [];
  for (const r of rows.slice(h + 1)) {
    const price = parsePrice(r[cPrice]);
    const name = String(r[cName] ?? "").trim();
    if (!name || !Number.isFinite(price) || price <= 0) continue;
    out.push({
      name,
      substance: String(r[cSub] ?? "").trim(),
      approval: String(cApp >= 0 ? r[cApp] ?? "" : "").trim(),
      parallel: String(cPar >= 0 ? r[cPar] ?? "" : "").trim(),
      price,
      start: dateCell(r[cFrom]),
      end: cTo >= 0 ? dateCell(r[cTo]) : null,
    });
  }
  return out;
}

/** The price in force on `today` for each pack (approval number + parallel-import holder): latest start that has begun and not ended. */
export function currentPacks(packs: Pack[], today: string): Pack[] {
  const best = new Map<string, Pack>();
  for (const p of packs) {
    if (p.start && p.start > today) continue; // not yet in force
    if (p.end && p.end < today) continue; // expired
    const key = p.approval ? `${p.approval}|${p.parallel}` : `${p.name}|${p.parallel}`;
    const cur = best.get(key);
    if (!cur || (p.start ?? "") >= (cur.start ?? "")) best.set(key, p);
  }
  return [...best.values()];
}

const MULTI = /[,;+/]| i | and /;

/** Library keys of one pack: the full substance, its first word (single-substance packs only) and the brand's first word. */
export function keysOf(p: Pack): string[] {
  const keys = new Set<string>();
  const sub = plain(p.substance);
  if (sub) {
    const full = sub.split(/\s+/).map(canon).filter(Boolean).join(" ");
    if (full) keys.add(full);
    if (!MULTI.test(sub)) {
      const first = canon(sub.split(" ")[0]);
      if (first.length >= 3) keys.add(first);
    }
  }
  const brand = canon(plain(p.name).split(/[\s,]+/)[0]);
  if (brand.length >= 3 && !/^\d/.test(brand)) keys.add(brand);
  return [...keys].filter((k) => !/[",\n|]/.test(k));
}

export function dailyRows(packs: Pack[]): DailyRow[] {
  const recs: { area: string; item: string; price: number }[] = [];
  for (const p of packs) for (const k of keysOf(p)) recs.push({ area: NATIONAL, item: `name:${k}`, price: p.price });
  return aggregateDaily(recs, false).filter((r) => r.n >= MIN_PUBLISH);
}

/** The newest summary-list file linked from the listing page: the highest "-NNNN-svi" number, else the highest "_YYYY" year. */
export function latestFile(html: string): string | null {
  const links = [...html.matchAll(/href="([^"]*Zbirni-popis-objavljenih-cijena-lijekova[^"]*\.xlsx)"/gi)].map((m) => m[1]);
  const num = links.map((l) => ({ l, n: Number(l.match(/-(\d+)-svi\.xlsx$/i)?.[1] ?? NaN) })).filter((x) => Number.isFinite(x.n)).sort((a, b) => b.n - a.n);
  if (num.length) return num[0].l;
  const yr = links.map((l) => ({ l, n: Number(l.match(/_(\d{4})\.xlsx$/i)?.[1] ?? NaN) })).filter((x) => Number.isFinite(x.n)).sort((a, b) => b.n - a.n);
  return yr.length ? yr[0].l : null;
}

export function fileUrl(path: string): string {
  return path.startsWith("http") ? path : `${SITE}${path.replace(/^\/en\//, "/")}`;
}

export async function hrHarvest(): Promise<HarvestResult> {
  let path = FALLBACK_FILE;
  try {
    const r = await fetch(LISTING_URL, { headers: UA });
    if (r.ok) path = latestFile(Buffer.from(await r.arrayBuffer()).toString("utf8")) ?? FALLBACK_FILE;
  } catch { /* fall back to the file seen by hand */ }
  const url = fileUrl(path);
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new SourceError(`HALMED price list ${url} returned HTTP ${res.status}`);
  const sheets = readXlsx(Buffer.from(await res.arrayBuffer()));
  const sheet = sheets.find((s) => s.rows.slice(0, 30).some((r) => r.some((c) => plain(c).startsWith("djelatna tvar")))) ?? sheets[0];
  if (!sheet) throw new SourceError(`HALMED price list ${url} holds no sheet`);
  const date = new Date().toISOString().slice(0, 10);
  const all = parsePacks(sheet.rows);
  const packs = currentPacks(all, date);
  if (packs.length < 1500) throw new SourceError(`HALMED price list gave only ${packs.length} packs priced today (of ${all.length} rows); the format may have changed.`);
  const rows = dailyRows(packs);
  return { date, currency: "EUR", unit: "per pack", rows, note: `${packs.length} packs with a price in force on ${date}, ${rows.length} names with 5+ packs, file ${path.split("/").pop()}.` };
}

/** Candidate library keys for the user's text: the alias target, the whole name, its first word. */
export function candidateKeys(medicine?: string): string[] {
  const raw = plain(medicine);
  if (!raw) throw new InputError("medicine is required: an active substance or brand name such as 'paracetamol', 'omeprazole' or 'Lipitor' (first word used).");
  const words = raw.split(/[\s,;/]+/).filter(Boolean);
  const out: string[] = [];
  const add = (k?: string) => { if (k && k.length >= 2 && !out.includes(k)) out.push(k); };
  const first = words[0];
  add(ALIASES[first] ? canon(ALIASES[first]) : undefined);
  add(canon(first));
  if (words.length > 1) add(words.map(canon).join(" "));
  return out;
}

export function hrHistoryKey(p: { medicine?: string }) {
  try {
    const k = candidateKeys(p.medicine)[0];
    return { area: NATIONAL, item: `name:${k}`, label: `${k}, Croatia (per pack)` };
  } catch {
    return null;
  }
}

export const STALE_AFTER_DAYS = 7;

function methodText() {
  return (
    "Median and 10th–90th percentile of the highest permitted wholesale price (euro per pack) of all packs with a price in force whose active substance or brand starts with the given name, " +
    "copied once a day from HALMED's summary list of published prices. Posted ceilings for wholesale, not market transactions and not pharmacy or patient prices; the range mixes pack sizes and strengths."
  );
}

export function hrAnswerFromRow(row: DailyRow & { date: string }, q: { key: string; baseUrl?: string; today?: string }): PriceAnswer {
  const today = q.today ?? new Date().toISOString().slice(0, 10);
  const ageDays = Math.round((Date.parse(today + "T00:00:00Z") - Date.parse(row.date + "T00:00:00Z")) / 86400000);
  const stale = ageDays > STALE_AFTER_DAYS;
  return buildAnswer({
    source: INFO,
    query: { country: "HR", medicine: q.key },
    summary: { count: row.n, median: row.median, low: row.low, high: row.high, min: row.min, max: row.max },
    currency: "EUR",
    unit: "per pack (highest permitted wholesale price)",
    period: { from: row.date, to: row.date },
    method: methodText(),
    describe: (x) =>
      `Packs of "${q.key}" on HALMED's list in Croatia have a highest permitted wholesale price of a median ${fmtMoney(x.median, "EUR")} per pack; ` +
      `10th–90th percentile ${fmtMoney(x.low, "EUR")}–${fmtMoney(x.high, "EUR")} across ${x.count} packs, which mix pack sizes and strengths. ` +
      `These are posted wholesale ceilings, not market transactions: pharmacy margin and VAT come on top, and this is not what a patient paid.` +
      (stale ? ` Our copy of the list is ${ageDays} days old (collected ${row.date}).` : ""),
    baseUrl: q.baseUrl,
    extra: { price_level: "wholesale_ceiling", ...(stale ? { stale: true, days_since_collected: ageDays } : {}) },
  });
}

export async function hrMedicines(input: { medicine?: string; baseUrl?: string }): Promise<PriceAnswer> {
  const keys = candidateKeys(input.medicine);
  const meta = readMeta(INFO.id);
  if (!meta?.last_date) throw new SourceError("ProofPrice collects this list daily; data appears after the next collection.");
  const to = meta.last_date;
  const from = new Date(Date.parse(to + "T00:00:00Z") - 60 * 86400000).toISOString().slice(0, 10);
  for (const key of keys) {
    const rows = readDaily(INFO.id, { area: NATIONAL, item: `name:${key}`, from, to });
    const row = rows[rows.length - 1];
    if (row) return hrAnswerFromRow(row, { key: String(input.medicine ?? key).trim().split(/\s+/)[0] || key, baseUrl: input.baseUrl });
  }
  return buildAnswer({
    source: INFO, query: { country: "HR", medicine: keys[0] }, summary: null, currency: "EUR", unit: "per pack (highest permitted wholesale price)",
    period: { from: null, to: null }, method: methodText(), describe: () => "", baseUrl: input.baseUrl,
    extra: { hint: "No active substance or brand matching this name has 5 or more priced packs. Try the active substance (e.g. 'omeprazole', 'paracetamol') or a brand name." },
  });
}
