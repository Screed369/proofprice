// Finland medicine prices: Kela's quarterly "List of prices notified to Kela for interchangeable medicinal products"
// (Luettelo Kansaneläkelaitokselle ilmoitetuista keskenään vaihtokelpoisten lääkevalmisteiden hinnoista). One ~370 KB xlsx
// per quarter at https://www.kela.fi/documents/d/guest/vaihtokelpoiset-laakkeet-<DDMMYYYY> (DDMM = 0101, 0104, 0107, 0110).
// One sheet, header on row 4: Substituutio-koodi, Vnr, Myyntihinta (sis. alv), *, Hintaputken yläraja, Viitehinta, Lääkenimi,
// Vahvuus, Pakkauskoko, Lääkemuoto, Haltija, Lääkeaine. Prices use a decimal comma. The daily collector (harvest) reads the
// newest quarter and keeps aggregates per active substance and per brand (first word); requests are answered from the library.
// Posted (notified) prices incl. VAT, never transactions.

import { InputError, SourceError } from "../../lib/http";
import { MIN_PUBLISH } from "../../lib/stats";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { aggregateDaily, NATIONAL } from "../../lib/library/aggregate";
import { readDaily, readMeta } from "../../lib/library/store";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { Cell, readXlsx } from "../../categories/rent/xlsx";

export const INFO: SourceInfo = {
  id: "fi-kela-medicines",
  country: "FI (Finland)",
  category: "medicines (interchangeable medicinal products, notified sales prices)",
  name: "List of prices notified to Kela for interchangeable medicinal products (Kela, Finland)",
  publisher: "Kela, the Social Insurance Institution of Finland",
  what_is_recorded:
    "Every interchangeable (substitutable) medicinal pack in Finland with its notified sales price including VAT (Myyntihinta, EUR), its pack size, strength, form, holder and active substance, valid for one quarter.",
  price_type: "posted_price",
  freshness: "A new list every quarter (1 Jan, 1 Apr, 1 Jul, 1 Oct), published about a week before; our copy is refreshed daily",
  licence:
    "No licence or reuse terms are stated on Kela's list page (https://www.kela.fi/pharmaceutical-companies-list-price-notifications, read 4 Nov 2026). Not cleared for commercial reuse, so this source is served free of charge only.",
  licence_url: "https://www.kela.fi/pharmaceutical-companies-list-price-notifications",
  attribution:
    "Source: Kela (Finnish Social Insurance Institution), list of prices notified to Kela for interchangeable medicinal products, quarter shown in the answer. Medians and ranges are calculated by ProofPrice.",
  homepage: "https://www.kela.fi/pharmaceutical-companies-list-price-notifications",
  limits:
    "Notified sales prices including VAT per pack for interchangeable (substitutable) medicines only, as listed by Kela; not what a patient paid at a pharmacy (reimbursement, deductibles and pharmacy fees are not included). " +
    "Each pack counts once, so a range spans all pack sizes and strengths of one active substance or brand; it is a spread of listed prices, not of what people paid.",
};

export const MAX_KEYS = 3000;
export const FILE_BASE = "https://www.kela.fi/documents/d/guest/vaihtokelpoiset-laakkeet-";

/** English (INN) name -> Finnish active-substance stem as used in Kela's list, for the most asked medicines. */
export const ALIASES: Record<string, string> = {
  paracetamol: "parasetamoli", acetaminophen: "parasetamoli", ibuprofen: "ibuprofeeni", naproxen: "naprokseeni", diclofenac: "diklofenaakki",
  amoxicillin: "amoksisilliini", omeprazole: "omepratsoli", esomeprazole: "esomepratsoli", pantoprazole: "pantopratsoli", lansoprazole: "lansopratsoli",
  atorvastatin: "atorvastatiini", simvastatin: "simvastatiini", rosuvastatin: "rosuvastatiini", metformin: "metformiini", sertraline: "sertraliini",
  citalopram: "sitalopraami", escitalopram: "essitalopraami", fluoxetine: "fluoksetiini", venlafaxine: "venlafaksiini", mirtazapine: "mirtatsapiini",
  quetiapine: "ketiapiini", olanzapine: "olantsapiini", risperidone: "risperidoni", aripiprazole: "aripipratsoli", pregabalin: "pregabaliini",
  gabapentin: "gabapentiini", oxycodone: "oksikodoni", tramadol: "tramadoli", morphine: "morfiini", buprenorphine: "buprenorfiini",
  bisoprolol: "bisoprololi", metoprolol: "metoprololi", amlodipine: "amlodipiini", losartan: "losartaani", candesartan: "kandesartaani",
  ramipril: "ramipriili", enalapril: "enalapriili", furosemide: "furosemidi", warfarin: "varfariini", rivaroxaban: "rivaroksabaani",
  apixaban: "apiksabaani", levothyroxine: "levotyroksiini", cetirizine: "setiritsiini", loratadine: "loratadiini", montelukast: "montelukasti",
  salbutamol: "salbutamoli", sitagliptin: "sitagliptiini", adalimumab: "adalimumabi", ustekinumab: "ustekinumabi", ciprofloxacin: "siprofloksasiini",
  azithromycin: "atsitromysiini", doxycycline: "doksisykliini", finasteride: "finasteridi", tamsulosin: "tamsulosiini", zolpidem: "tsolpideemi",
};

/** Lower-case ASCII first usable word ("Parasetamoli" -> "parasetamoli", "Övriga" -> "ovriga"); null for numbers and very short words. */
export function nameKey(name: string): string | null {
  const w = name
    .normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .split(/[^a-z0-9-]+/).map((t) => t.replace(/^-+|-+$/g, "")).find((t) => t.length > 0);
  if (!w || w.length < 3 || /^\d+$/.test(w)) return null;
  return w;
}

/** "52,52" -> 52.52 (decimal comma, thousands space or dot tolerated); null when not a number. */
export function parseFiPrice(v: Cell): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? v : null;
  if (typeof v !== "string") return null;
  const s = v.replace(/\s/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return n > 0 ? n : null;
}

export interface KelaPack { vnr: string; substance: string; brand: string; price: number }
export interface KelaList { packs: KelaPack[]; period: { from: string; to: string } | null; published: string | null }

/** Parse the sheet rows (as returned by readXlsx): title row 1 holds the validity period, the header row starts with "Substituutio-koodi". */
export function parseKelaRows(rows: Cell[][]): KelaList {
  const title = String(rows[0]?.[0] ?? "");
  const pm = /(\d{1,2})\.(\d{1,2})\.(\d{4})\s*[–-]\s*(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(title);
  const iso = (d: string, m: string, y: string) => `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  const period = pm ? { from: iso(pm[1], pm[2], pm[3]), to: iso(pm[4], pm[5], pm[6]) } : null;
  const pub = /Julkaistu\s+(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(rows.slice(0, 4).map((r) => String(r?.[0] ?? "")).join(" "));
  const published = pub ? iso(pub[1], pub[2], pub[3]) : null;
  const h = rows.findIndex((r) => String(r?.[0] ?? "").trim() === "Substituutio-koodi");
  if (h < 0) throw new SourceError("Kela list: header row 'Substituutio-koodi' not found; the layout may have changed.");
  const seen = new Set<string>();
  const packs: KelaPack[] = [];
  for (const r of rows.slice(h + 1)) {
    if (!r || r.length < 12) continue;
    const vnr = String(r[1] ?? "").trim();
    const price = parseFiPrice(r[2]);
    const substance = String(r[11] ?? "").trim();
    if (!vnr || price === null || !substance || seen.has(vnr)) continue;
    seen.add(vnr);
    packs.push({ vnr, substance, brand: String(r[6] ?? "").trim(), price });
  }
  return { packs, period, published };
}

/** Library rows: area ALL, item "name:<key>". Each pack counts once per key (its substance and its brand). Top MAX_KEYS by pack count. */
export function kelaDailyRows(packs: KelaPack[]): DailyRow[] {
  const seen = new Set<string>();
  const recs: { area: string; item: string; price: number }[] = [];
  for (const p of packs) {
    for (const k of [nameKey(p.substance), nameKey(p.brand)]) {
      if (!k) continue;
      const id = `${p.vnr}|${k}`;
      if (seen.has(id)) continue;
      seen.add(id);
      recs.push({ area: NATIONAL, item: `name:${k}`, price: p.price });
    }
  }
  const rows = aggregateDaily(recs, false).filter((r) => r.n >= MIN_PUBLISH);
  return rows.sort((a, b) => b.n - a.n).slice(0, MAX_KEYS).sort((a, b) => a.item.localeCompare(b.item));
}

/** Quarter start dates (DDMMYYYY), newest first, from the quarter containing `today` back `quarters` quarters. */
export function candidateFiles(today = new Date().toISOString().slice(0, 10), quarters = 4): string[] {
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  let qm = Math.floor((m - 1) / 3) * 3 + 1, qy = y;
  const out: string[] = [];
  for (let i = 0; i < quarters; i++) {
    out.push(`01${String(qm).padStart(2, "0")}${qy}`);
    qm -= 3;
    if (qm < 1) { qm += 12; qy -= 1; }
  }
  return out;
}

const UA = { "user-agent": "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)" };

export async function kelaHarvest(): Promise<HarvestResult> {
  let lastErr = "";
  for (const stamp of candidateFiles()) {
    const url = FILE_BASE + stamp;
    let res: Response;
    try {
      res = await fetch(url, { headers: UA, redirect: "follow", signal: AbortSignal.timeout(45000) });
    } catch (e) {
      lastErr = `${stamp}: ${(e as Error).message}`;
      continue;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (!res.ok || buf.length < 1000 || buf[0] !== 0x50 || buf[1] !== 0x4b) { lastErr = `${stamp}: HTTP ${res.status}, ${buf.length} bytes, not an xlsx`; continue; }
    const sheets = readXlsx(buf);
    const list = parseKelaRows(sheets[0]?.rows ?? []);
    const rows = kelaDailyRows(list.packs);
    if (!rows.length) { lastErr = `${stamp}: no usable rows (${list.packs.length} priced packs)`; continue; }
    const date = new Date().toISOString().slice(0, 10);
    return {
      date, currency: "EUR", unit: "per pack", rows,
      note: `Kela list ${list.period ? `${list.period.from} to ${list.period.to}` : stamp}, published ${list.published ?? "?"}, ${list.packs.length} priced packs, ${rows.length} names with 5+ packs.`,
    };
  }
  throw new SourceError(`No Kela list of notified medicine prices found for the last 4 quarters (${lastErr})`);
}

export function kelaKey(medicine?: string): { item: string; key: string } {
  const raw = medicine ? nameKey(medicine) : null;
  if (!raw) throw new InputError("medicine is required: an active substance or brand name such as 'paracetamol' (or Finnish 'parasetamoli') or 'burana'.");
  const key = ALIASES[raw] ?? raw;
  return { item: `name:${key}`, key };
}

export function kelaHistoryKey(p: { medicine?: string }) {
  try {
    const k = kelaKey(p.medicine);
    return { area: NATIONAL, item: k.item, label: `${k.key}, Finland` };
  } catch {
    return null;
  }
}

export const STALE_AFTER_DAYS = 7;

function methodText() {
  return (
    "Median and 10th–90th percentile of the notified sales price per pack (EUR, including VAT) of all interchangeable medicinal packs in Kela's quarterly price list whose active substance or brand name starts with the given word, " +
    "copied once a day from the newest list. Posted prices, not market transactions; the range mixes pack sizes and strengths."
  );
}

export function kelaAnswerFromRow(row: DailyRow & { date: string }, q: { key: string; baseUrl?: string; today?: string }): PriceAnswer {
  const today = q.today ?? new Date().toISOString().slice(0, 10);
  const ageDays = Math.round((Date.parse(today + "T00:00:00Z") - Date.parse(row.date + "T00:00:00Z")) / 86400000);
  const stale = ageDays > STALE_AFTER_DAYS;
  return buildAnswer({
    source: INFO,
    query: { country: "FI", medicine: q.key },
    summary: { count: row.n, median: row.median, low: row.low, high: row.high, min: row.min, max: row.max },
    currency: "EUR",
    unit: "per pack (notified sales price incl. VAT)",
    period: { from: row.date, to: row.date },
    method: methodText(),
    describe: (x) =>
      `Interchangeable packs of "${q.key}" in Finland have a notified sales price (per pack, including VAT) of a median ${fmtMoney(x.median, "EUR")}; ` +
      `10th–90th percentile ${fmtMoney(x.low, "EUR")}–${fmtMoney(x.high, "EUR")} across the packs in Kela's quarterly price list, which mix pack sizes and strengths. ` +
      `These are posted prices, not market transactions or what a patient paid at the pharmacy.` +
      (stale ? ` Our copy of the list is ${ageDays} days old (collected ${row.date}).` : ""),
    baseUrl: q.baseUrl,
    ...(stale ? { extra: { stale: true, days_since_collected: ageDays } } : {}),
  });
}

export async function kelaMedicines(input: { medicine?: string; baseUrl?: string }): Promise<PriceAnswer> {
  const k = kelaKey(input.medicine);
  const meta = readMeta(INFO.id);
  if (!meta?.last_date) throw new SourceError("ProofPrice collects this list daily; data appears after the next collection.");
  const to = meta.last_date;
  const from = new Date(Date.parse(to + "T00:00:00Z") - 60 * 86400000).toISOString().slice(0, 10);
  const rows = readDaily(INFO.id, { area: NATIONAL, item: k.item, from, to });
  const row = rows[rows.length - 1];
  if (!row) {
    return buildAnswer({
      source: INFO, query: { country: "FI", medicine: k.key }, summary: null, currency: "EUR", unit: "per pack (notified sales price incl. VAT)",
      period: { from: null, to: null }, method: methodText(), describe: () => "", baseUrl: input.baseUrl,
      extra: { hint: "No active substance or brand starting with this word has 5 or more interchangeable packs in Kela's price list. Try the generic name (e.g. 'paracetamol' or Finnish 'parasetamoli') or a brand, first word only." },
    });
  }
  return kelaAnswerFromRow(row, { key: k.key, baseUrl: input.baseUrl });
}
