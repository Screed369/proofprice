// Estonia medicine prices: Tervisekassa (Estonian Health Insurance Fund) price table of reimbursed medicines ("Ülevaatlik tabel").
// Page https://tervisekassa.ee/partnerile/ravimitest/soodusravimid (the old haigekassa.ee host redirects there, 301) links one xlsx per
// edition, e.g. /sites/default/files/ulevaatlik_tabel_veeb_01.11.2026.xlsx (name changes each period, sometimes with a suffix such as _1).
// One sheet HINNATABEL, header on row 1 (bilingual): col A Ravimikood (unique per pack), C Toimeaine (active substance, "a+b" for combinations),
// D Ravim (brand), Q "Pakendi piirhind" = reference price for the package in EUR (blank for ~25% of rows). Prices are real numbers.
// The daily collector (harvest) reads the newest edition and keeps aggregates per single active substance and per brand (first word).
// Reference prices (the reimbursement ceiling) are posted prices, never transactions.

import { InputError, SourceError } from "../../lib/http";
import { MIN_PUBLISH } from "../../lib/stats";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { aggregateDaily, NATIONAL } from "../../lib/library/aggregate";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { Cell, readXlsx } from "../../categories/rent/xlsx";

export const INFO: SourceInfo = {
  id: "ee-tervisekassa-medicines",
  country: "EE (Estonia)",
  category: "medicines (reimbursed medicines, reference prices per pack)",
  name: "Price table of reimbursed medicines (Tervisekassa, Estonian Health Insurance Fund)",
  publisher: "Tervisekassa (Eesti Haigekassa), the Estonian Health Insurance Fund",
  what_is_recorded:
    "Every reimbursed medicine pack in Estonia with its reference price for the package (Pakendi piirhind, EUR; the price the insurance fund reimburses against), active substance, brand, form, strength, pack size and reimbursement rate.",
  price_type: "posted_price",
  freshness: "A new edition about every quarter (1 Jan, 1 Apr, 1 Jul, 1 Oct, with occasional extra editions); our copy is refreshed daily",
  licence:
    "No licence or reuse terms are stated on Tervisekassa's reimbursed-medicines page (https://tervisekassa.ee/partnerile/ravimitest/soodusravimid, read 6 Nov 2026). Not cleared for commercial reuse, so this source is served free of charge only.",
  licence_url: "https://tervisekassa.ee/partnerile/ravimitest/soodusravimid",
  attribution:
    "Source: Tervisekassa (Estonian Health Insurance Fund), price table of reimbursed medicines, edition shown in the answer. Medians and ranges are calculated by ProofPrice.",
  homepage: "https://tervisekassa.ee/partnerile/ravimitest/soodusravimid",
  limits:
    "Reference prices per pack (the reimbursement ceiling) of reimbursed medicines only, as listed by Tervisekassa; not what a patient paid at a pharmacy (the patient's share, pharmacy margins and non-reimbursed medicines are not included). " +
    "About a quarter of listed packs have no reference price and are left out. Each pack counts once, so a range spans all pack sizes and strengths of one active substance or brand; it is a spread of listed prices, not of what people paid.",
};

export const MAX_KEYS = 3000;
export const PAGE_URL = "https://tervisekassa.ee/partnerile/ravimitest/soodusravimid";
export const FILE_ORIGIN = "https://tervisekassa.ee";

/** English (INN) name -> Estonian active-substance stem as used in the table, for commonly asked medicines. */
export const ALIASES: Record<string, string> = {
  omeprazole: "omeprasool", pantoprazole: "pantoprasool", esomeprazole: "esomeprasool", mesalazine: "mesalasiin", mesalamine: "mesalasiin",
  metformin: "metformiin", gliclazide: "gliklasiid", glimepiride: "glimepiriid", sitagliptin: "sitagliptiin", warfarin: "varfariin",
  clopidogrel: "klopidogreel", ticagrelor: "tikagreloor", dabigatran: "dabigatraaneteksilaat", rivaroxaban: "rivaroksabaan", edoxaban: "edoksabaan",
  apixaban: "apiksabaan", bisoprolol: "bisoprolool", metoprolol: "metoprolool", nebivolol: "nebivolool", carvedilol: "karvedilool",
  amlodipine: "amlodipiin", felodipine: "felodipiin", lercanidipine: "lerkanidipiin", enalapril: "enalapriil", perindopril: "perindopriil",
  ramipril: "ramipriil", losartan: "losartaan", valsartan: "valsartaan", candesartan: "kandesartaan", telmisartan: "telmisartaan",
  simvastatin: "simvastatiin", atorvastatin: "atorvastatiin", rosuvastatin: "rosuvastatiin", ezetimibe: "esetimiib", terbinafine: "terbinafiin",
  mometasone: "mometasoon", tacrolimus: "takroliimus", estradiol: "ostradiool", tamsulosin: "tamsulosiin", sildenafil: "sildenafiil",
  dexamethasone: "deksametasoon", levothyroxine: "naatriumlevoturoksiin", amoxicillin: "amoksitsilliin", cefuroxime: "tsefuroksiim",
  clarithromycin: "klaritromutsiin", azithromycin: "asitromutsiin", clindamycin: "klindamutsiin", ciprofloxacin: "tsiprofloksatsiin",
  fluconazole: "flukonasool", valaciclovir: "valatsikloviir", imatinib: "imatiniib", letrozole: "letrosool", anastrozole: "anastrosool",
  adalimumab: "adalimumab", etanercept: "etanertsept", ustekinumab: "ustekinumab", diclofenac: "diklofenak", meloksikaam: "meloksikaam",
  meloxicam: "meloksikaam", ibuprofen: "ibuprofeen", celecoxib: "tselekoksiib", allopurinol: "allopurinool", oxycodone: "oksukodoon",
  fentanyl: "fentanuul", tramadol: "tramadool", gabapentin: "gabapentiin", pregabalin: "pregabaliin", sumatriptan: "sumatriptaan",
  carbamazepine: "karbamasepiin", topiramate: "topiramaat", levetiracetam: "levetiratsetaam", quetiapine: "kvetiapiin", olanzapine: "olansapiin",
  risperidone: "risperidoon", aripiprazole: "aripiprasool", citalopram: "tsitalopraam", escitalopram: "estsitalopraam", paroxetine: "paroksetiin",
  sertraline: "sertraliin", mirtazapine: "mirtasapiin", venlafaxine: "venlafaksiin", duloxetine: "duloksetiin", methylphenidate: "metuulfenidaat",
  donepezil: "donepesiil", memantine: "memantiin", hydroxychloroquine: "hudroksuklorokviin", montelukast: "montelukast", cetirizine: "tsetirisiin",
  latanoprost: "latanoprost", spironolactone: "spironolaktoon", indapamide: "indapamiid", torasemide: "torasemiid",
};

/** Lower-case ASCII first usable word ("Östradiool" -> "ostradiool"); null for numbers and very short words. */
export function nameKey(name: string): string | null {
  const w = name
    .normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/ü/g, "u").replace(/ö/g, "o").replace(/õ/g, "o").replace(/ä/g, "a")
    .split(/[^a-z0-9-]+/).map((t) => t.replace(/^-+|-+$/g, "")).find((t) => t.length > 0);
  if (!w || w.length < 3 || /^\d+$/.test(w)) return null;
  return w;
}

/** Cell to a positive price: numbers as they are, "8,92" or "8.92" strings parsed; null otherwise. */
export function parseEePrice(v: Cell): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? v : null;
  if (typeof v !== "string") return null;
  const s = v.replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return n > 0 ? n : null;
}

export interface EePack { code: string; substance: string; brand: string; price: number }

/** Parse the HINNATABEL rows (as returned by readXlsx): the header row starts with "Ravimikood". Packs without a reference price are skipped. */
export function parseEeRows(rows: Cell[][]): { packs: EePack[]; total: number } {
  const h = rows.findIndex((r) => String(r?.[0] ?? "").trim().startsWith("Ravimikood"));
  if (h < 0) throw new SourceError("Tervisekassa table: header row 'Ravimikood' not found; the layout may have changed.");
  const head = rows[h].map((c) => String(c ?? ""));
  const iRef = head.findIndex((c) => /^Pakendi piirhind/.test(c));
  if (iRef < 0) throw new SourceError("Tervisekassa table: column 'Pakendi piirhind' (reference price) not found; the layout may have changed.");
  const seen = new Set<string>();
  const packs: EePack[] = [];
  let total = 0;
  for (const r of rows.slice(h + 1)) {
    if (!r || r.length < iRef + 1) continue;
    const code = String(r[0] ?? "").trim();
    if (!code) continue;
    total++;
    const price = parseEePrice(r[iRef]);
    const substance = String(r[2] ?? "").trim();
    if (price === null || seen.has(code)) continue;
    seen.add(code);
    packs.push({ code, substance, brand: String(r[3] ?? "").trim(), price });
  }
  return { packs, total };
}

/** Library rows: area ALL, item "name:<key>". Each pack counts once per key (its single active substance, and its brand). Top MAX_KEYS by pack count. */
export function eeDailyRows(packs: EePack[]): DailyRow[] {
  const seen = new Set<string>();
  const recs: { area: string; item: string; price: number }[] = [];
  for (const p of packs) {
    const keys = [p.substance && !p.substance.includes("+") ? nameKey(p.substance) : null, nameKey(p.brand)];
    for (const k of keys) {
      if (!k) continue;
      const id = `${p.code}|${k}`;
      if (seen.has(id)) continue;
      seen.add(id);
      recs.push({ area: NATIONAL, item: `name:${k}`, price: p.price });
    }
  }
  const rows = aggregateDaily(recs, false).filter((r) => r.n >= MIN_PUBLISH);
  return rows.sort((a, b) => b.n - a.n).slice(0, MAX_KEYS).sort((a, b) => a.item.localeCompare(b.item));
}

export interface EeFile { href: string; date: string }

/** Edition xlsx links on the page: name contains ulevaatlik_tabel_veeb_DD.MM.YYYY. Newest edition not after `today` first (else newest overall). */
export function pickFiles(html: string, today = new Date().toISOString().slice(0, 10)): EeFile[] {
  const out = new Map<string, EeFile>();
  for (const m of html.matchAll(/href="([^"]*ulevaatlik_tabel_veeb_(\d{2})\.(\d{2})\.(\d{4})[^"]*\.xlsx)"/gi)) {
    out.set(m[1], { href: m[1], date: `${m[4]}-${m[3]}-${m[2]}` });
  }
  const all = [...out.values()].sort((a, b) => (a.date === b.date ? b.href.localeCompare(a.href) : b.date.localeCompare(a.date)));
  const current = all.filter((f) => f.date <= today);
  return current.length ? current : all;
}

const UA = { "user-agent": "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)" };

/** Fetch the newest edition (page -> xlsx) and aggregate it. Used by the live path (and by eeHarvest if the collector can reach the host). */
export async function loadEeTable(): Promise<{ rows: DailyRow[]; edition: string; total: number; withPrice: number }> {
  let html: string;
  try {
    const res = await fetch(PAGE_URL, { headers: UA, redirect: "follow", signal: AbortSignal.timeout(25000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    html = await res.text();
  } catch (e) {
    throw new SourceError(`Tervisekassa reimbursed-medicines page not reachable (${(e as Error).message})`);
  }
  const files = pickFiles(html).slice(0, 3);
  if (!files.length) throw new SourceError("No ulevaatlik_tabel_veeb xlsx link found on the Tervisekassa page; the layout may have changed.");
  let lastErr = "";
  for (const f of files) {
    const url = f.href.startsWith("http") ? f.href : FILE_ORIGIN + (f.href.startsWith("/") ? "" : "/") + f.href;
    let res: Response;
    try {
      res = await fetch(url, { headers: UA, redirect: "follow", signal: AbortSignal.timeout(30000) });
    } catch (e) {
      lastErr = `${f.date}: ${(e as Error).message}`;
      continue;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (!res.ok || buf.length < 1000 || buf[0] !== 0x50 || buf[1] !== 0x4b) { lastErr = `${f.date}: HTTP ${res.status}, ${buf.length} bytes, not an xlsx`; continue; }
    const list = parseEeRows(readXlsx(buf)[0]?.rows ?? []);
    const rows = eeDailyRows(list.packs);
    if (!rows.length) { lastErr = `${f.date}: no usable rows (${list.packs.length} packs with a reference price)`; continue; }
    return { rows, edition: f.date, total: list.total, withPrice: list.packs.length };
  }
  throw new SourceError(`No usable Tervisekassa price table found (${lastErr})`);
}

export async function eeHarvest(): Promise<HarvestResult> {
  const t = await loadEeTable();
  return {
    date: new Date().toISOString().slice(0, 10), currency: "EUR", unit: "per pack", rows: t.rows,
    note: `Tervisekassa table edition ${t.edition}, ${t.total} packs listed, ${t.withPrice} with a reference price, ${t.rows.length} names with 5+ packs.`,
  };
}

let cache: { at: number; rows: Map<string, DailyRow>; edition: string } | null = null;
const CACHE_MS = 6 * 3600 * 1000;

async function liveRow(item: string): Promise<{ row: (DailyRow & { date: string }) | undefined; edition: string }> {
  if (!cache || Date.now() - cache.at > CACHE_MS) {
    const t = await loadEeTable();
    cache = { at: Date.now(), rows: new Map(t.rows.map((r) => [r.item, r])), edition: t.edition };
  }
  const r = cache.rows.get(item);
  return { row: r ? { ...r, date: new Date(cache.at).toISOString().slice(0, 10) } : undefined, edition: cache.edition };
}

export function eeKey(medicine?: string): { item: string; key: string } {
  const raw = medicine ? nameKey(medicine) : null;
  if (!raw) throw new InputError("medicine is required: an active substance or brand name such as 'omeprazole' (or Estonian 'omeprasool') or 'daktarin'.");
  const key = ALIASES[raw] ?? raw;
  return { item: `name:${key}`, key };
}

export function eeHistoryKey(p: { medicine?: string }) {
  try {
    const k = eeKey(p.medicine);
    return { area: NATIONAL, item: k.item, label: `${k.key}, Estonia` };
  } catch {
    return null;
  }
}

export const STALE_AFTER_DAYS = 7;

function methodText() {
  return (
    "Median and 10th–90th percentile of the reference price per pack (EUR) of all reimbursed packs in Tervisekassa's price table whose single active substance or brand name starts with the given word, " +
    "read from the newest edition when asked (cached for a few hours). Posted reference prices (the reimbursement ceiling), not market transactions; the range mixes pack sizes and strengths."
  );
}

export function eeAnswerFromRow(row: DailyRow & { date: string }, q: { key: string; baseUrl?: string; today?: string }): PriceAnswer {
  const today = q.today ?? new Date().toISOString().slice(0, 10);
  const ageDays = Math.round((Date.parse(today + "T00:00:00Z") - Date.parse(row.date + "T00:00:00Z")) / 86400000);
  const stale = ageDays > STALE_AFTER_DAYS;
  return buildAnswer({
    source: INFO,
    query: { country: "EE", medicine: q.key },
    summary: { count: row.n, median: row.median, low: row.low, high: row.high, min: row.min, max: row.max },
    currency: "EUR",
    unit: "per pack (reference price)",
    period: { from: row.date, to: row.date },
    method: methodText(),
    describe: (x) =>
      `Reimbursed packs of "${q.key}" in Estonia have a reference price (per pack) of a median ${fmtMoney(x.median, "EUR")}; ` +
      `10th–90th percentile ${fmtMoney(x.low, "EUR")}–${fmtMoney(x.high, "EUR")} across the packs in Tervisekassa's price table, which mix pack sizes and strengths. ` +
      `These are posted reference prices (the reimbursement ceiling), not market transactions or what a patient paid at the pharmacy.` +
      (stale ? ` Our copy of the table is ${ageDays} days old (collected ${row.date}).` : ""),
    baseUrl: q.baseUrl,
    ...(stale ? { extra: { stale: true, days_since_collected: ageDays } } : {}),
  });
}

export async function eeMedicines(input: { medicine?: string; baseUrl?: string }): Promise<PriceAnswer> {
  const k = eeKey(input.medicine);
  const { row } = await liveRow(k.item);
  if (!row) {
    return buildAnswer({
      source: INFO, query: { country: "EE", medicine: k.key }, summary: null, currency: "EUR", unit: "per pack (reference price)",
      period: { from: null, to: null }, method: methodText(), describe: () => "", baseUrl: input.baseUrl,
      extra: { hint: "No single active substance or brand starting with this word has 5 or more reimbursed packs with a reference price in Tervisekassa's table. Try the generic name (e.g. 'omeprazole' or Estonian 'omeprasool') or a brand, first word only." },
    });
  }
  return eeAnswerFromRow(row, { key: k.key, baseUrl: input.baseUrl });
}
