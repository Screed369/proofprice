// Iceland medicine prices: the Icelandic Medicines Agency (Lyfjastofnun, IMA) "Lyfjaverdskra" (medicine price list), published as an Excel (.xls) file on
// island.is on the 1st of every month. Sheet "Lyfjaskra" lists every pack on the Icelandic market with its legally fixed MAXIMUM retail price
// ("Hamarks smasoluverd": ISK, incl. VAT, which may be discounted; the "reference currency" column only ties the WHOLESALE price to an exchange rate).
// Source of the column meanings: IMA's explanatory notes (skyringar med lyfjaverdskra, PDF on the same page).
// The file is ~4.8 MB, so we never fetch it per request: the daily collector (harvest) reads it once, keeps aggregates per active substance (first word) and per
// brand name (first word) in the price library, and requests are answered from there. Regulated maximum prices, not transactions.
// Column positions are found from the header text, not fixed letters.

import { InputError, SourceError } from "../../lib/http";
import { MIN_PUBLISH } from "../../lib/stats";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { aggregateDaily, NATIONAL } from "../../lib/library/aggregate";
import { readDaily, readMeta } from "../../lib/library/store";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import type { Cell } from "../../categories/rent/xlsx";
import { readXls } from "./xls";

export const INFO: SourceInfo = {
  id: "is-ima-medicines",
  country: "IS (Iceland)",
  category: "medicines (regulated maximum retail prices of prescription medicines)",
  name: "Lyfjaverdskra (Icelandic Medicines Agency price list)",
  publisher: "Lyfjastofnun (Icelandic Medicines Agency, IMA)",
  what_is_recorded: "Every pack of a prescription medicine for humans on the Icelandic price list, with its official maximum retail price (hamarks smasoluverd, ISK incl. VAT), the active substance and the brand name.",
  price_type: "posted_price",
  freshness: "A new price list is published on the 1st of every month; our copy is re-read daily",
  licence: "UNCLEAR: the IMA page (island.is/en/o/ima/icelandic-medicine-price-catalogue) states no licence or reuse terms (read 14 Nov 2026). Treated as free tier only",
  licence_url: "https://island.is/en/o/ima/icelandic-medicine-price-catalogue",
  attribution: "Source: Lyfjastofnun (Icelandic Medicines Agency), Lyfjaverdskra (medicine price list); data not altered in meaning.",
  homepage: "https://island.is/en/o/ima/icelandic-medicine-price-catalogue",
  limits:
    "Legally fixed MAXIMUM retail prices per pack (ISK, incl. 24% VAT, 11% on some contraceptives), not what people paid: pharmacies may give a discount. Only prescription " +
    "medicines for humans (veterinary medicines, over-the-counter products, hospital-only medicines and packs without a retail price are left out). Each pack counts once, so a " +
    "range spans all pack sizes and strengths under one active substance or brand name. Medicines with several active substances count under their brand name only. " +
    "The patient's co-payment (the state insurance share) is not included.",
};

export const PAGE_URL = "https://island.is/en/o/ima/icelandic-medicine-price-catalogue";
export const MAX_KEYS = 3000; // library size guard: the keys with the most packs
const UA = { "user-agent": "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)" };

/** Lower-case ASCII: strips accents and maps the Icelandic letters (eth, thorn, ae). */
export const fold = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/ð/g, "d").replace(/þ/g, "th").replace(/æ/g, "ae").replace(/ø/g, "o");

/** Icelandic number text: "." is the thousands separator, "," the decimal ("2.106" -> 2106, "1.076,93" -> 1076.93). Numbers pass through. null when empty, zero or not a number. */
export function parsePrice(v: Cell | undefined): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? v : null;
  const s = String(v ?? "").trim().replace(/\s/g, "");
  if (!/^\d{1,3}(\.\d{3})+(,\d+)?$|^\d+(,\d+)?$/.test(s)) return null;
  const n = Number(s.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Day text "30.9.2026" -> "2026-09-30"; null when empty or not a date. */
export function parseDay(v: Cell | undefined): string | null {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(String(v ?? "").trim());
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
}

/** First usable word of a brand name, lower-case ASCII ("Metformin Bluefish" -> "metformin"); null when too short or numeric. */
export function nameKey(name: string): string | null {
  const w = fold(name).split(/[^a-z0-9]+/).filter((x) => x.length > 0)[0];
  if (!w || w.length < 3 || /^\d+$/.test(w)) return null;
  return w;
}

/** English names people type, for substances whose Icelandic name differs beyond accents. */
const ALIASES: Record<string, string> = { acetaminophen: "paracetamol" };

/** Active substance as written on the list ("Atorvastatín", "Paracetamól") -> plain stem ("atorvastatin", "paracetamol"). null for combinations ("A og B", "A/B") or empty. */
export function substanceKey(sub: string): string | null {
  if (/[/+,]| og /i.test(sub)) return null;
  const w = fold(sub).split(/[^a-z0-9]+/).filter((x) => x.length > 0)[0];
  if (!w || w.length < 4) return null;
  return w;
}

export interface IsPack { code: string; name: string; substance: string; price: number }

const norm = (s: unknown) => fold(String(s ?? "")).replace(/\s+/g, " ").trim();
/** Packs of the price sheet, from its header row. Throws on a new layout. Keeps prescription medicines for humans with a retail price that are still listed on `today`. */
export function parsePacks(rows: Cell[][], today = new Date().toISOString().slice(0, 10)): IsPack[] {
  const h = rows.findIndex((r) => r.some((c) => norm(c) === "hamarks smasoluverd") && r.some((c) => norm(c) === "heiti lyfs"));
  if (h < 0) throw new SourceError("Icelandic price list has a new layout: no header row with 'Heiti lyfs' and 'Hámarks smásöluverð'");
  const col = (name: string) => rows[h].findIndex((c) => norm(c) === name);
  const cCode = col("norraent vorunumer"), cName = col("heiti lyfs"), cSub = col("heiti virka innihaldsefnis"), cPrice = col("hamarks smasoluverd");
  const cMode = col("afgreidslumati"), cClass = col("alagningarflokkur"), cOff = col("afskraningardagsetning"), cAtc = col("atc-flokkur");
  if ([cCode, cName, cSub, cPrice, cMode, cClass].some((x) => x < 0)) throw new SourceError("Icelandic price list has a new layout: a column is missing");
  const seen = new Set<string>();
  const packs: IsPack[] = [];
  for (const r of rows.slice(h + 1)) {
    const code = String(r[cCode] ?? "").trim();
    const price = parsePrice(r[cPrice]);
    const name = String(r[cName] ?? "").trim();
    const klass = norm(r[cClass]);
    const off = cOff >= 0 ? parseDay(r[cOff]) : null;
    const atc = cAtc >= 0 ? String(r[cAtc] ?? "").trim().toUpperCase() : "";
    // prescription (R) human medicines with the VAT classes of pharmacy medicines; Q... ATC = veterinary
    if (!code || !name || price === null || seen.has(code)) continue;
    if (String(r[cMode] ?? "").trim().toUpperCase() !== "R" || !(klass === "lyfalmen" || klass === "lyfalm11") || atc.startsWith("Q")) continue;
    if (off && off <= today) continue; // already deregistered
    seen.add(code);
    packs.push({ code, name, substance: String(r[cSub] ?? "").trim(), price });
  }
  return packs;
}

/** Library rows: area ALL, item "name:<key>" and "sub:<stem>". Each pack counts once per key. Top MAX_KEYS by pack count. */
export function isDailyRows(packs: IsPack[]): DailyRow[] {
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

/** The price-list workbooks linked from the IMA page, newest list first: names look like lyfjaverdskra-20261001-2__1_.xls (the number is the date it applies from). */
export function listFiles(html: string): { url: string; from: string }[] {
  const out = new Map<string, { url: string; from: string }>();
  for (const m of html.matchAll(/https:\/\/assets\.ctfassets\.net\/[A-Za-z0-9_\-/.%]*?\/lyfjaverdskra-(\d{4})(\d{2})(\d{2})[A-Za-z0-9_\-.%]*\.xls(?![a-z])/g)) {
    out.set(m[0], { url: m[0], from: `${m[1]}-${m[2]}-${m[3]}` });
  }
  return [...out.values()].sort((a, b) => b.from.localeCompare(a.from) || b.url.localeCompare(a.url));
}

export async function isHarvest(): Promise<HarvestResult> {
  const pr = await fetch(PAGE_URL, { headers: UA });
  if (!pr.ok) throw new SourceError(`island.is price list page returned HTTP ${pr.status}`);
  const files = listFiles(await pr.text());
  if (!files.length) throw new SourceError("island.is price list page has no lyfjaverdskra .xls link (layout changed?)");
  const errors: string[] = [];
  for (const f of files.slice(0, 2)) {
    try {
      const xr = await fetch(f.url, { headers: UA });
      if (!xr.ok) { errors.push(`${f.url} HTTP ${xr.status}`); continue; }
      const sheets = readXls(Buffer.from(await xr.arrayBuffer()));
      const sheet = sheets.find((s) => norm(s.name) === "lyfjaskra") ?? sheets[0];
      const packs = parsePacks(sheet.rows);
      const rows = isDailyRows(packs);
      if (!rows.length) throw new SourceError(`Icelandic price list held no usable priced packs (${packs.length} packs)`);
      const date = new Date().toISOString().slice(0, 10);
      return { date, currency: "ISK", unit: "per pack", rows, note: `Price list in force from ${f.from}, ${packs.length} priced prescription packs, ${rows.length} keys with 5+ packs.` };
    } catch (e) {
      if (e instanceof SourceError && /new layout|held no usable/.test(e.message)) throw e;
      errors.push(`${f.url} ${(e as Error).message}`);
    }
  }
  throw new SourceError(`Icelandic price list not found: ${errors.join("; ")}`);
}

export interface IsKey { names: { item: string; key: string }[]; key: string }
/** What the user typed -> the library keys to try, best first: the active substance, then the brand name. */
export function isKey(medicine?: string): IsKey {
  const raw = (medicine ?? "").trim();
  const first = raw ? fold(raw).split(/[^a-z0-9]+/).filter((x) => x.length > 0)[0] : undefined;
  const sub = first && first.length >= 4 ? (ALIASES[first] ?? first) : null;
  const nm = raw ? nameKey(raw) : null;
  if (!sub && !nm) throw new InputError("medicine is required: an active substance such as 'atorvastatin' or 'metformin', or an Icelandic brand name such as 'panodil'.");
  const names: { item: string; key: string }[] = [];
  if (sub) names.push({ item: `sub:${sub}`, key: sub });
  if (nm) names.push({ item: `name:${nm}`, key: nm });
  return { names, key: (sub ?? nm)! };
}

export function isHistoryKey(p: { medicine?: string }) {
  try {
    const k = isKey(p.medicine);
    return { area: NATIONAL, item: k.names[0].item, label: `${k.names[0].key}, Iceland` };
  } catch {
    return null;
  }
}

export const STALE_AFTER_DAYS = 40; // the list changes monthly
const UNIT = "per pack (maximum retail price incl. VAT)";

function methodText() {
  return (
    "Median and 10th–90th percentile of the official maximum retail price per pack (hámarks smásöluverð, ISK incl. VAT) of all prescription medicines for humans on the Icelandic Medicines Agency price list " +
    "whose active substance or brand name starts with the given word, copied once a day. Regulated maximum prices, not market transactions; the range mixes pack sizes and strengths."
  );
}

export function isAnswerFromRow(row: DailyRow & { date: string }, q: { key: string; kind: "sub" | "name"; baseUrl?: string; today?: string }): PriceAnswer {
  const today = q.today ?? new Date().toISOString().slice(0, 10);
  const ageDays = Math.round((Date.parse(today + "T00:00:00Z") - Date.parse(row.date + "T00:00:00Z")) / 86400000);
  const stale = ageDays > STALE_AFTER_DAYS;
  const what = q.kind === "sub" ? `the substance "${q.key}"` : `the brand name "${q.key}"`;
  return buildAnswer({
    source: INFO,
    query: { country: "IS", medicine: q.key },
    summary: { count: row.n, median: row.median, low: row.low, high: row.high, min: row.min, max: row.max },
    currency: "ISK",
    unit: UNIT,
    period: { from: row.date, to: row.date },
    method: methodText(),
    describe: (x) =>
      `Prescription packs of ${what} in Iceland have an official maximum retail price (per pack, incl. VAT) of a median ${fmtMoney(x.median, "ISK")}; ` +
      `10th–90th percentile ${fmtMoney(x.low, "ISK")}–${fmtMoney(x.high, "ISK")} across the packs on the Icelandic Medicines Agency price list, which mix pack sizes and strengths. ` +
      `These are regulated maximum prices, not market transactions.` +
      (stale ? ` Our copy of the list is ${ageDays} days old (collected ${row.date}).` : ""),
    baseUrl: q.baseUrl,
    ...(stale ? { extra: { stale: true, days_since_collected: ageDays } } : {}),
  });
}

export async function isMedicines(input: { medicine?: string; baseUrl?: string }): Promise<PriceAnswer> {
  const k = isKey(input.medicine);
  const meta = readMeta(INFO.id);
  if (!meta?.last_date) throw new SourceError("ProofPrice collects this list daily; data appears after the next collection.");
  const to = meta.last_date;
  const from = new Date(Date.parse(to + "T00:00:00Z") - 60 * 86400000).toISOString().slice(0, 10);
  for (const n of k.names) {
    const row = readDaily(INFO.id, { area: NATIONAL, item: n.item, from, to }).pop();
    if (row) return isAnswerFromRow(row, { key: n.key, kind: n.item.startsWith("sub:") ? "sub" : "name", baseUrl: input.baseUrl });
  }
  return buildAnswer({
    source: INFO, query: { country: "IS", medicine: k.key }, summary: null, currency: "ISK", unit: UNIT,
    period: { from: null, to: null }, method: methodText(), describe: () => "", baseUrl: input.baseUrl,
    extra: { hint: "No active substance or brand name like this has 5 or more prescription packs on the Icelandic price list. Try the English substance name (e.g. 'atorvastatin', 'metformin') or the first word of the Icelandic brand name." },
  });
}
