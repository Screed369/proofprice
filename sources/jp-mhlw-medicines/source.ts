// Japan medicine prices: the National Health Insurance (NHI) drug price list ("薬価基準") of the Ministry of Health, Labour and Welfare (MHLW).
// Three key-free Excel files for the edition in force (oral 内用薬 _01, injection 注射薬 _02, topical 外用薬 _03), e.g.
//   https://www.mhlw.go.jp/topics/2025/04/xls/tp20260318-01_01.xlsx  (574,657 bytes, probed 21 Oct 2026 from GitHub Actions, HTTP 200)
// Sheet "ＨＰ用", header row: 区分 | 薬価基準収載医薬品コード | 成分名(+furigana) | 規格 | … | 品名 | メーカー名 | 後発医薬品加算 flag | 先発医薬品 | 同一剤形・規格の後発医薬品がある先発医薬品 | 薬価 | 経過措置による使用期限 | 備考
// Real rows (full-width text, NFKC-normalise):  内用薬|1124001F1022|エスタゾラム|１ｍｇ１錠|…|ユーロジン１ｍｇ錠|Ｔ’ｓ製薬|…|先発品|…|6.1
// 薬価 = the official reimbursement price in yen for ONE unit named in 規格 (one tablet, one capsule, 1 g, 1 mL, one vial...).
// The listing page (https://www.mhlw.go.jp/topics/2025/04/tp20250401-01.html, ASCII hrefs) links every edition; the newest edition that has
// _01, _02 and _03 together is the full list. The collector (harvest) reads the three files once a day and keeps aggregates per
// ingredient in the price library; requests are answered from there. Posted (regulated) prices, never what a patient paid.

import { InputError, SourceError } from "../../lib/http";
import { MIN_PUBLISH } from "../../lib/stats";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { aggregateDaily, NATIONAL } from "../../lib/library/aggregate";
import { readDaily, readMeta } from "../../lib/library/store";
import { readXlsx, Cell } from "../../categories/rent/xlsx";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";

export const INFO: SourceInfo = {
  id: "jp-mhlw-medicines",
  country: "JP (Japan)",
  category: "medicines (National Health Insurance drug price list)",
  name: "National Health Insurance drug price list (薬価基準収載品目リスト)",
  publisher: "Ministry of Health, Labour and Welfare (MHLW), Japan",
  what_is_recorded:
    "Every medicine that Japan's National Health Insurance reimburses (oral, injection and topical), with its official price (薬価) in yen per unit " +
    "(per tablet, per capsule, per gram, per millilitre, per vial...), the maker and whether it is an original (先発品) or a generic (後発品).",
  price_type: "posted_price",
  freshness: "Files updated regularly by the publisher (about monthly or more often); our copy is refreshed daily",
  licence: "Public Data License 1.0 (PDL1.0, compatible with CC BY 4.0) under the MHLW site terms; attribution required",
  licence_url: "https://www.mhlw.go.jp/chosakuken/index.html",
  attribution: "Source: Ministry of Health, Labour and Welfare website, National Health Insurance drug price list (https://www.mhlw.go.jp/topics/2025/04/tp20250401-01.html). Aggregated by ProofPrice; not altered otherwise.",
  homepage: "https://www.mhlw.go.jp/topics/2025/04/tp20250401-01.html",
  limits:
    "Official reimbursement prices per unit, not what a patient paid: patients pay a share (usually 10-30%) at the pharmacy, which adds its own fees. Only medicines reimbursed by " +
    "National Health Insurance; over-the-counter medicines and unlisted products are not included. A range spans all strengths and makers of one ingredient, so it mixes strengths; " +
    "the price is per unit of the form shown (tablet, capsule, gram, millilitre), not per box. English names are matched through a built-in list of common ingredients; any ingredient can also be given in Japanese.",
};

export const LISTING_URL = "https://www.mhlw.go.jp/topics/2025/04/tp20250401-01.html";
export const FILE_BASE = "https://www.mhlw.go.jp/topics/2025/04/xls/";
/** Last edition seen by hand; used only if the listing page cannot be read. */
export const FALLBACK_EDITION = "20260318";
const UA = { "user-agent": "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)" };

/** NFKC folds full-width letters/digits/symbols ("１ｍｇ１錠" -> "1mg1錠"); also lower-cases and trims. */
export function norm(s: unknown): string {
  return String(s ?? "").normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

/** Newest edition (YYYYMMDD) in the listing HTML that has the oral, injection and topical files together. */
export function latestEdition(html: string): string | null {
  const have = new Map<string, Set<string>>();
  for (const m of html.matchAll(/xls\/tp(\d{8})-01_0([123])\.xlsx/g)) {
    if (!have.has(m[1])) have.set(m[1], new Set());
    have.get(m[1])!.add(m[2]);
  }
  const full = [...have.entries()].filter(([, s]) => s.size === 3).map(([d]) => d).sort();
  return full.length ? full[full.length - 1] : null;
}

export function fileUrls(edition: string): string[] {
  return ["01", "02", "03"].map((n) => `${FILE_BASE}tp${edition}-01_${n}.xlsx`);
}

export function editionDate(edition: string): string {
  return `${edition.slice(0, 4)}-${edition.slice(4, 6)}-${edition.slice(6, 8)}`;
}

export interface Drug {
  ingredient: string; // as published, NFKC
  spec: string;
  brand: string;
  kind: "brand" | "generic" | "other";
  price: number; // yen per unit
}

/** Unit code of a 規格 text: tab, cap, g, ml, or other (vial, ampoule, patch, kit...). */
export function unitOf(spec: string): "tab" | "cap" | "g" | "ml" | "other" {
  const s = norm(spec);
  if (/錠$/.test(s)) return "tab";
  if (/カプセル$/.test(s)) return "cap";
  if (/ml$/.test(s)) return "ml";
  if (/g$/.test(s)) return "g";
  return "other";
}
export const UNIT_ORDER = ["tab", "cap", "g", "ml", "other"] as const;
export const UNIT_LABEL: Record<string, string> = { tab: "per tablet", cap: "per capsule", g: "per gram", ml: "per millilitre", other: "per unit (vial, ampoule, patch, kit...)" };

const SALTS = /(水和物|無水物|塩酸塩|臭化水素酸塩|硫酸塩|酢酸塩|リン酸塩|リン酸エステル|ナトリウム|カルシウム|カリウム|マレイン酸塩|フマル酸塩|コハク酸塩|酒石酸塩|クエン酸塩|メシル酸塩|ベシル酸塩|トシル酸塩|乳酸塩|硝酸塩|炭酸塩|安息香酸塩|プロピオン酸エステル|酪酸エステル|吉草酸エステル|二)+$/;

/** Short key of an ingredient: salt and hydrate words removed ("ロキソプロフェンナトリウム水和物" -> "ロキソプロフェン"). */
export function stemOf(name: string): string {
  const n = norm(name);
  const s = n.replace(SALTS, "");
  return s.length >= 2 ? s : n;
}

/** Find the header row (it holds 成分名 and 薬価) and read every priced row below it. Tolerates extra or moved columns. */
export function parseDrugRows(rows: Cell[][]): Drug[] {
  let h = -1;
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const cells = rows[i].map(norm);
    if (cells.some((c) => c.startsWith("成分名")) && cells.some((c) => c === "薬価")) { h = i; break; }
  }
  if (h < 0) throw new SourceError("The MHLW drug price sheet has no header row with 成分名 and 薬価; the format changed and this source needs updating.");
  const head = rows[h].map(norm);
  const col = (pred: (c: string) => boolean) => head.findIndex(pred);
  const cIng = col((c) => c.startsWith("成分名"));
  const cSpec = col((c) => c.startsWith("規格"));
  const cBrand = col((c) => c.startsWith("品名"));
  const cPrice = col((c) => c === "薬価");
  if (cSpec < 0 || cBrand < 0) throw new SourceError("The MHLW drug price sheet lost the 規格 or 品名 column; this source needs updating.");
  const out: Drug[] = [];
  for (const r of rows.slice(h + 1)) {
    const ingredient = norm(r[cIng]);
    const price = typeof r[cPrice] === "number" ? (r[cPrice] as number) : Number(norm(r[cPrice]).replace(/,/g, ""));
    if (!ingredient || !Number.isFinite(price) || price <= 0) continue;
    const between = r.slice(cBrand + 1, cPrice).map((c) => String(c ?? ""));
    const kind = between.some((c) => c.includes("先発品")) ? "brand" : between.some((c) => c.includes("後発品")) ? "generic" : "other";
    out.push({ ingredient, spec: norm(r[cSpec]), brand: norm(r[cBrand]), kind, price });
  }
  return out;
}

/** Library rows: area ALL, item "name:<key>|<unit>" for the full ingredient name and its stem. Each product counts once per key. */
export function dailyRows(drugs: Drug[]): DailyRow[] {
  const recs: { area: string; item: string; price: number }[] = [];
  for (const d of drugs) {
    const keys = new Set([d.ingredient, stemOf(d.ingredient)]);
    for (const k of keys) if (!/[",\n]/.test(k)) recs.push({ area: NATIONAL, item: `name:${k}|${unitOf(d.spec)}`, price: d.price });
  }
  return aggregateDaily(recs, false).filter((r) => r.n >= MIN_PUBLISH);
}

async function fetchSheetRows(url: string): Promise<Cell[][]> {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new SourceError(`MHLW drug price file ${url} returned HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const sheets = readXlsx(buf);
  const sheet = sheets.find((s) => s.rows.slice(0, 30).some((r) => r.some((c) => norm(c) === "薬価"))) ?? sheets[0];
  if (!sheet) throw new SourceError(`MHLW drug price file ${url} holds no sheet`);
  return sheet.rows;
}

export async function jpHarvest(): Promise<HarvestResult> {
  let edition = FALLBACK_EDITION;
  try {
    const r = await fetch(LISTING_URL, { headers: UA });
    if (r.ok) edition = latestEdition(Buffer.from(await r.arrayBuffer()).toString("latin1")) ?? FALLBACK_EDITION;
  } catch { /* fall back to the last edition seen by hand */ }
  const drugs: Drug[] = [];
  for (const url of fileUrls(edition)) drugs.push(...parseDrugRows(await fetchSheetRows(url)));
  if (drugs.length < 5000) throw new SourceError(`MHLW edition ${edition} gave only ${drugs.length} priced products; the format may have changed.`);
  const rows = dailyRows(drugs);
  const date = new Date().toISOString().slice(0, 10);
  return { date, currency: "JPY", unit: "per unit", rows, note: `Edition ${editionDate(edition)}, ${drugs.length} priced products, ${rows.length} ingredient/unit groups with 5+ products.` };
}

/** English (and common brand-free) names of frequent ingredients -> the Japanese ingredient stem used in the list. */
export const EN_TO_JA: Record<string, string> = {
  paracetamol: "アセトアミノフェン", acetaminophen: "アセトアミノフェン", loxoprofen: "ロキソプロフェン", ibuprofen: "イブプロフェン",
  diclofenac: "ジクロフェナク", celecoxib: "セレコキシブ", aspirin: "アスピリン", ketoprofen: "ケトプロフェン",
  amlodipine: "アムロジピン", atorvastatin: "アトルバスタチン", rosuvastatin: "ロスバスタチン", simvastatin: "シンバスタチン", pravastatin: "プラバスタチン",
  metformin: "メトホルミン", glimepiride: "グリメピリド", sitagliptin: "シタグリプチン", omeprazole: "オメプラゾール", esomeprazole: "エソメプラゾール",
  lansoprazole: "ランソプラゾール", rabeprazole: "ラベプラゾール", famotidine: "ファモチジン", amoxicillin: "アモキシシリン", clarithromycin: "クラリスロマイシン",
  azithromycin: "アジスロマイシン", levofloxacin: "レボフロキサシン", loratadine: "ロラタジン", fexofenadine: "フェキソフェナジン", cetirizine: "セチリジン",
  montelukast: "モンテルカスト", levothyroxine: "レボチロキシン", prednisolone: "プレドニゾロン", warfarin: "ワルファリン", losartan: "ロサルタン",
  valsartan: "バルサルタン", candesartan: "カンデサルタン", olmesartan: "オルメサルタン", telmisartan: "テルミサルタン", enalapril: "エナラプリル",
  bisoprolol: "ビソプロロール", carvedilol: "カルベジロール", furosemide: "フロセミド", sertraline: "セルトラリン", escitalopram: "エスシタロプラム",
  zolpidem: "ゾルピデム", etizolam: "エチゾラム", alprazolam: "アルプラゾラム", diazepam: "ジアゼパム", lorazepam: "ロラゼパム", gabapentin: "ガバペンチン",
  pregabalin: "プレガバリン", tramadol: "トラマドール", oseltamivir: "オセルタミビル", acyclovir: "アシクロビル", valacyclovir: "バラシクロビル",
  allopurinol: "アロプリノール", febuxostat: "フェブキソスタット", donepezil: "ドネペジル", tamsulosin: "タムスロシン", sildenafil: "シルデナフィル",
  tadalafil: "タダラフィル", clopidogrel: "クロピドグレル", rivaroxaban: "リバーロキサバン", apixaban: "アピキサバン", tacrolimus: "タクロリムス",
  methotrexate: "メトトレキサート", hydrocortisone: "ヒドロコルチゾン", betamethasone: "ベタメタゾン", nitrazepam: "ニトラゼパム", estazolam: "エスタゾラム",
};

/** Candidate library keys for the user's medicine text: the Japanese text itself, its stem, or the Japanese stem of an English name. */
export function candidateKeys(medicine?: string): string[] {
  const raw = norm(medicine);
  if (!raw) throw new InputError("medicine is required: an ingredient name such as 'paracetamol', 'amlodipine' or Japanese 'アムロジピン' (a medicine's active ingredient, not a brand).");
  const first = raw.split(/[\s,;/]+/)[0];
  const out: string[] = [];
  const add = (k?: string) => { if (k && !out.includes(k)) out.push(k); };
  const ja = EN_TO_JA[first];
  if (ja) add(ja);
  add(first);
  add(stemOf(first));
  return out;
}

export function jpHistoryKey(p: { medicine?: string }) {
  try {
    const k = candidateKeys(p.medicine)[0];
    return { area: NATIONAL, item: `name:${k}|tab`, label: `${k}, Japan (per tablet)` };
  } catch {
    return null;
  }
}

export const STALE_AFTER_DAYS = 7;

function methodText() {
  return (
    "Median and 10th–90th percentile of the official National Health Insurance price (yen per unit: tablet, capsule, gram, millilitre or vial) of all products listed by the MHLW whose active ingredient " +
    "matches the given name, copied once a day from the newest price list. Posted reimbursement prices, not market transactions; the range mixes strengths and makers (originals and generics)."
  );
}

export function jpAnswerFromRow(row: DailyRow & { date: string }, q: { key: string; unit: string; baseUrl?: string; today?: string }): PriceAnswer {
  const today = q.today ?? new Date().toISOString().slice(0, 10);
  const ageDays = Math.round((Date.parse(today + "T00:00:00Z") - Date.parse(row.date + "T00:00:00Z")) / 86400000);
  const stale = ageDays > STALE_AFTER_DAYS;
  const unitLabel = UNIT_LABEL[q.unit] ?? "per unit";
  return buildAnswer({
    source: INFO,
    query: { country: "JP", medicine: q.key },
    summary: { count: row.n, median: row.median, low: row.low, high: row.high, min: row.min, max: row.max },
    currency: "JPY",
    unit: `${unitLabel} (official price)`,
    period: { from: row.date, to: row.date },
    method: methodText(),
    describe: (x) =>
      `Products containing "${q.key}" on Japan's National Health Insurance list have an official price ${unitLabel} of a median ${fmtMoney(x.median, "JPY")}; ` +
      `10th–90th percentile ${fmtMoney(x.low, "JPY")}–${fmtMoney(x.high, "JPY")} across ${x.count} listed products, which mix strengths and makers (originals and generics). ` +
      `These are official reimbursement prices, not market transactions or what a patient paid (patients pay a share at the pharmacy).` +
      (stale ? ` Our copy of the list is ${ageDays} days old (collected ${row.date}).` : ""),
    baseUrl: q.baseUrl,
    extra: { unit_form: q.unit, ...(stale ? { stale: true, days_since_collected: ageDays } : {}) },
  });
}

export async function jpMedicines(input: { medicine?: string; baseUrl?: string }): Promise<PriceAnswer> {
  const keys = candidateKeys(input.medicine);
  const meta = readMeta(INFO.id);
  if (!meta?.last_date) throw new SourceError("ProofPrice collects this list daily; data appears after the next collection.");
  const to = meta.last_date;
  const from = new Date(Date.parse(to + "T00:00:00Z") - 60 * 86400000).toISOString().slice(0, 10);
  for (const key of keys) {
    let best: { row: DailyRow & { date: string }; unit: string } | null = null;
    for (const unit of UNIT_ORDER) {
      const rows = readDaily(INFO.id, { area: NATIONAL, item: `name:${key}|${unit}`, from, to });
      const row = rows[rows.length - 1];
      if (row && (!best || row.n > best.row.n)) best = { row, unit };
    }
    if (best) return jpAnswerFromRow(best.row, { key, unit: best.unit, baseUrl: input.baseUrl });
  }
  return buildAnswer({
    source: INFO, query: { country: "JP", medicine: keys[0] }, summary: null, currency: "JPY", unit: "per unit (official price)",
    period: { from: null, to: null }, method: methodText(), describe: () => "", baseUrl: input.baseUrl,
    extra: { hint: "No ingredient matching this name has 5 or more listed products. Give the active ingredient (e.g. 'amlodipine' or Japanese 'アムロジピン'), not a brand name." },
  });
}
