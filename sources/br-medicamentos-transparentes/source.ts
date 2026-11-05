// Brazil medicine prices from public tenders: "Medicamentos Transparentes" (Transparência Brasil), the PNCP drug tenders and awards
// republished as Open Contracting (OCDS) JSON lines by the Open Contracting Partnership Data Registry (publication 153).
// File: https://data.open-contracting.org/en/publication/153/download?name=full.jsonl.gz (302 to fastly, gzip, ~41 MB, ~67,000 compiled
// releases, one per tender, Sep 2021 to Apr 2026). Per release: tender.items[] (CATMAT classification, activeIngredients) and
// awards[].items[] with unit.value.amount = awarded unit price in BRL. We read the file once a day (streamed, never kept) and store
// aggregates per presentation (CATMAT code) in the price library. Awarded tender prices paid by public buyers, never pharmacy prices.

import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import { createInterface } from "node:readline";
import { InputError, SourceError } from "../../lib/http";
import { MIN_PUBLISH } from "../../lib/stats";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { aggregateDaily, NATIONAL } from "../../lib/library/aggregate";
import { readLatestDay, readMeta } from "../../lib/library/store";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";

export const INFO: SourceInfo = {
  id: "br-medicamentos-transparentes",
  country: "BR (Brazil)",
  category: "medicines (public tender award prices per unit)",
  name: "Medicamentos Transparentes: medicine tender awards from PNCP (Transparência Brasil, via the Open Contracting Partnership Data Registry)",
  publisher: "Transparência Brasil, republished by the Open Contracting Partnership (Data Registry, publication 153)",
  what_is_recorded:
    "Awarded unit prices (BRL) that Brazilian public buyers (municipalities, states, hospitals, federal bodies) agreed with suppliers in medicine tenders published on the PNCP, with the CATMAT medicine code, active ingredient, strength, form and unit.",
  price_type: "contract_price",
  freshness: "The registry copy is refreshed monthly (data to about April 2026 at the time of writing); our library copy is checked daily",
  licence:
    "Creative Commons Attribution 4.0 (CC BY 4.0) as stated in the Open Contracting Data Registry listing (https://data.open-contracting.org/en/publication/153, read 24 Oct 2026). " +
    "The underlying PNCP terms and Transparência Brasil's own page could not be read, so this source is not cleared for commercial reuse and is served free of charge only.",
  licence_url: "https://data.open-contracting.org/en/publication/153",
  attribution:
    "Source: Medicamentos Transparentes, Transparência Brasil, via the Open Contracting Partnership Data Registry, CC BY 4.0. Medians and ranges are calculated by ProofPrice.",
  homepage: "https://medicamentos.transparencia.org.br/",
  limits:
    "Prices agreed in public tenders (usually large volumes, often below pharmacy prices), per unit as written in the award (tablet, vial, bottle...), not what a patient paid in a pharmacy. " +
    "The medicine code (CATMAT) is attached by the publisher's matching and can be wrong for single awards; typing mistakes in awards are possible, so we show the 10th–90th percentile. Only presentations with 5 or more awards are shown.",
};

export const FILE_URL = "https://data.open-contracting.org/en/publication/153/download?name=full.jsonl.gz";
export const WINDOW_MONTHS = 24;
export const MAX_ITEMS = 6000;

/** Small ASCII lower-case key: "Ácido Acetilsalicílico" -> "acido acetilsalicilico". */
export function asciiKey(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

/** English / brand words people ask with -> Portuguese active-ingredient key used by CATMAT. */
export const ALIASES: Record<string, string> = {
  aspirin: "acido acetilsalicilico", aspirina: "acido acetilsalicilico", acetaminophen: "paracetamol", amoxicillin: "amoxicilina",
  metformin: "metformina", omeprazole: "omeprazol", dipyrone: "dipirona", metamizole: "dipirona", insulin: "insulina", diazepam: "diazepam",
  azithromycin: "azitromicina", ciprofloxacin: "ciprofloxacino", losartan: "losartana", simvastatin: "sinvastatina", atorvastatin: "atorvastatina",
  fluoxetine: "fluoxetina", sertraline: "sertralina", carbamazepine: "carbamazepina", furosemide: "furosemida", prednisone: "prednisona",
  dexamethasone: "dexametasona", ranitidine: "ranitidina", captopril: "captopril", enalapril: "enalapril", folic: "acido folico",
  vitamin: "acido ascorbico", salbutamol: "salbutamol", albuterol: "salbutamol", ceftriaxone: "ceftriaxona", ketoprofen: "cetoprofeno",
};

export interface Presentation { ingredient: string; catmat: string; detail: string; unit: string }
export interface AwardRecord extends Presentation { price: number; date: string }

function normUnit(u: unknown): string {
  return asciiKey(String(u ?? "")).slice(0, 24);
}

/** "268370 - Aciclovir, Dosagem:200 MG" -> { code: "268370", ingredient: "aciclovir", detail: "Dosagem 200 MG" }. */
export function parseCatmat(desc: string): { code: string; ingredient: string; detail: string } | null {
  const m = /^\s*(\d{3,8})\s*-\s*(.+)$/.exec(desc || "");
  if (!m) return null;
  const parts = m[2].split(",").map((s) => s.trim()).filter(Boolean);
  const ingredient = asciiKey(parts[0] ?? "");
  if (!ingredient || ingredient.length < 3) return null;
  const detail = parts.slice(1).join("; ").replace(/[|"\n\r]/g, " ").replace(/:/g, " ").replace(/\s+/g, " ").trim().slice(0, 90);
  return { code: m[1], ingredient, detail };
}

/** Pull the priced award items out of one compiled OCDS release (pure). Award item fields win; the tender item fills gaps. */
export function awardRecords(release: any): AwardRecord[] {
  const out: AwardRecord[] = [];
  const tenderItems = new Map<string, any>();
  for (const it of release?.tender?.items ?? []) if (it?.id != null) tenderItems.set(String(it.id), it);
  for (const a of release?.awards ?? []) {
    const date = String(a?.date ?? release?.date ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    for (const it of a?.items ?? []) {
      const price = Number(it?.unit?.value?.amount);
      if (!Number.isFinite(price) || price <= 0) continue;
      const base = tenderItems.get(String(it.id)) ?? {};
      const cl = it.classification?.description ? it.classification : base.classification;
      const cat = parseCatmat(String(cl?.description ?? ""));
      if (!cat) continue;
      const unit = normUnit(it?.unit?.name ?? base?.unit?.name);
      if (!unit) continue;
      out.push({ ingredient: cat.ingredient, catmat: cat.code, detail: cat.detail, unit, price, date });
    }
  }
  return out;
}

/** Library rows: area ALL, item "<ingredient>|<catmat>|<detail>|<unit>". Per CATMAT code only the most common unit name is kept;
 *  only awards inside the window; 5+ awards. Top MAX_ITEMS by count. */
export function medicineDailyRows(recs: AwardRecord[], newest: string, months = WINDOW_MONTHS): DailyRow[] {
  const cut = new Date(Date.parse(newest + "T00:00:00Z"));
  cut.setUTCMonth(cut.getUTCMonth() - months);
  const from = cut.toISOString().slice(0, 10);
  const inWin = recs.filter((r) => r.date >= from && r.date <= newest);
  const unitCount = new Map<string, Map<string, number>>();
  for (const r of inWin) {
    const m = unitCount.get(r.catmat) ?? new Map<string, number>();
    m.set(r.unit, (m.get(r.unit) ?? 0) + 1);
    unitCount.set(r.catmat, m);
  }
  const topUnit = new Map<string, string>();
  for (const [c, m] of unitCount) topUnit.set(c, [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0]);
  const recsOut = inWin
    .filter((r) => topUnit.get(r.catmat) === r.unit)
    .map((r) => ({ area: NATIONAL, item: `${r.ingredient}|${r.catmat}|${r.detail}|${r.unit}`, price: r.price }));
  return aggregateDaily(recsOut, false).filter((r) => r.n >= MIN_PUBLISH).sort((a, b) => b.n - a.n).slice(0, MAX_ITEMS).sort((a, b) => a.item.localeCompare(b.item));
}

/** Stream the gzip JSONL; returns every priced award record plus the newest award date. */
export async function readAwards(lines: AsyncIterable<string>): Promise<{ recs: AwardRecord[]; releases: number; newest: string }> {
  const recs: AwardRecord[] = [];
  let releases = 0, newest = "";
  const today = new Date().toISOString().slice(0, 10);
  for await (const line of lines) {
    if (!line.trim()) continue;
    let r: any;
    try { r = JSON.parse(line); } catch { continue; }
    releases++;
    for (const a of awardRecords(r)) {
      if (a.date > today) continue; // future-dated mistakes
      recs.push(a);
      if (a.date > newest) newest = a.date;
    }
  }
  return { recs, releases, newest };
}

const UA = { "user-agent": "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)" };

export async function medicinesHarvest(): Promise<HarvestResult> {
  let res: Response;
  try {
    res = await fetch(FILE_URL, { headers: UA, redirect: "follow", signal: AbortSignal.timeout(240000) });
  } catch (e) {
    throw new SourceError(`Could not reach the Open Contracting Data Registry (${(e as Error).message})`);
  }
  if (!res.ok || !res.body) throw new SourceError(`Open Contracting Data Registry answered HTTP ${res.status} for publication 153`);
  const gunzip = createGunzip();
  const rl = createInterface({ input: Readable.fromWeb(res.body as any).pipe(gunzip), crlfDelay: Infinity });
  let parsed;
  try {
    parsed = await readAwards(rl);
  } catch (e) {
    throw new SourceError(`Could not read the medicine tenders file (${(e as Error).message})`);
  }
  if (parsed.releases < 1000) throw new SourceError(`Medicine tenders file looks truncated (${parsed.releases} releases).`);
  const rows = medicineDailyRows(parsed.recs, parsed.newest);
  if (!rows.length) throw new SourceError(`No medicine presentation with 5+ awards (${parsed.recs.length} priced award items).`);
  const date = new Date().toISOString().slice(0, 10);
  return {
    date, currency: "BRL", unit: "per unit as written in the award", rows,
    note: `OCP publication 153: ${parsed.releases} releases, ${parsed.recs.length} priced award items, newest award ${parsed.newest}, window ${WINDOW_MONTHS} months, ${rows.length} presentations with 5+ awards.`,
  };
}

export interface Presented { ingredient: string; catmat: string; detail: string; unit: string; row: DailyRow }

export function parseItem(item: string): Presentation | null {
  const [ingredient, catmat, detail, unit] = item.split("|");
  return ingredient && catmat && unit !== undefined ? { ingredient, catmat, detail: detail ?? "", unit } : null;
}

export function queryKey(medicine?: string): string {
  const raw = asciiKey(medicine ?? "");
  if (raw.length < 3) throw new InputError("medicine is required: an active substance such as 'paracetamol', 'dipirona', 'amoxicilina' or 'insulina' (English names like 'aspirin' also work for the common ones).");
  const first = raw.split(" ")[0];
  return ALIASES[raw] ?? ALIASES[first] ?? raw;
}

/** Rows whose ingredient equals the key, else starts with it, else has a word starting with it (key 4+ chars). Best ingredient = most awards. */
export function matchIngredient(rows: DailyRow[], key: string): Presented[] {
  const all: Presented[] = [];
  for (const r of rows) {
    const p = parseItem(r.item);
    if (p) all.push({ ...p, row: r });
  }
  const tiers = [
    (p: Presented) => p.ingredient === key,
    (p: Presented) => p.ingredient.startsWith(key),
    (p: Presented) => key.length >= 4 && p.ingredient.split(" ").some((w) => w.startsWith(key)),
  ];
  for (const t of tiers) {
    const hit = all.filter(t);
    if (!hit.length) continue;
    const byIng = new Map<string, number>();
    for (const h of hit) byIng.set(h.ingredient, (byIng.get(h.ingredient) ?? 0) + h.row.n);
    const best = [...byIng.entries()].sort((a, b) => b[1] - a[1])[0][0];
    return hit.filter((h) => h.ingredient === best).sort((a, b) => b.row.n - a.row.n);
  }
  return [];
}

export const STALE_AFTER_DAYS = 7;

export function windowStart(newest: string, months = WINDOW_MONTHS): string {
  const d = new Date(Date.parse(newest + "T00:00:00Z"));
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

function methodText() {
  return (
    "Median and 10th–90th percentile of the unit price (BRL) awarded by Brazilian public buyers in medicine tenders on the PNCP, for the most-awarded presentation (CATMAT code, strength and form) of the active ingredient, " +
    `over awards of the last ${WINDOW_MONTHS} months of the republished file (Medicamentos Transparentes via the Open Contracting Partnership). Tender award prices, not pharmacy prices.`
  );
}

export function medicineAnswer(
  list: Presented[], q: { key: string; date: string; newest?: string; today?: string; baseUrl?: string },
): PriceAnswer {
  const today = q.today ?? new Date().toISOString().slice(0, 10);
  const ageDays = Math.round((Date.parse(today + "T00:00:00Z") - Date.parse(q.date + "T00:00:00Z")) / 86400000);
  const stale = ageDays > STALE_AFTER_DAYS;
  const top = list[0];
  const label = `${top.ingredient}${top.detail ? " (" + top.detail + ")" : ""}, price per ${top.unit}`;
  return buildAnswer({
    source: INFO,
    query: { country: "BR", medicine: q.key },
    summary: { count: top.row.n, median: top.row.median, low: top.row.low, high: top.row.high, min: top.row.min, max: top.row.max },
    currency: "BRL",
    unit: `per ${top.unit} as written in the award`,
    period: { from: q.newest ? windowStart(q.newest) : q.date, to: q.newest ?? q.date },
    method: methodText(),
    describe: (x) =>
      `Public buyers in Brazil awarded ${label} at a median ${fmtMoney(x.median, "BRL")}; 10th–90th percentile ${fmtMoney(x.low, "BRL")}–${fmtMoney(x.high, "BRL")} across ${x.count} tender awards in the ${WINDOW_MONTHS} months to the newest award in the file${q.newest ? ` (${q.newest})` : ""}. ` +
      `These are public tender award prices (usually bulk volumes), not pharmacy prices.` + (stale ? ` Our copy was collected ${ageDays} days ago.` : ""),
    baseUrl: q.baseUrl,
    extra: {
      presentation: { catmat: top.catmat, ingredient: top.ingredient, detail: top.detail, unit: top.unit },
      other_presentations: list.slice(1, 6).map((p) => ({ catmat: p.catmat, detail: p.detail, unit: p.unit, awards: p.row.n, median_brl: p.row.median })),
      ...(stale ? { stale: true, days_since_collected: ageDays } : {}),
    },
  });
}

export async function medicamentosTransparentes(input: { medicine?: string; baseUrl?: string }): Promise<PriceAnswer> {
  const key = queryKey(input.medicine);
  const meta = readMeta(INFO.id);
  const day = meta?.last_date ? readLatestDay(INFO.id) : null;
  if (!day) throw new SourceError("ProofPrice collects this file daily; data appears after the next collection.");
  const list = matchIngredient(day.rows, key);
  if (!list.length) {
    return buildAnswer({
      source: INFO, query: { country: "BR", medicine: key }, summary: null, currency: "BRL", unit: "per unit as written in the award",
      period: { from: null, to: null }, method: methodText(), describe: () => "", baseUrl: input.baseUrl,
      extra: { hint: "No medicine starting with this name has 5 or more tender awards in the last 24 months of the file. Try the Portuguese active ingredient, e.g. 'dipirona', 'amoxicilina', 'insulina', 'ibuprofeno'." },
    });
  }
  return medicineAnswer(list, { key, date: day.date, newest: /newest award (\d{4}-\d{2}-\d{2})/.exec(meta?.note ?? "")?.[1], baseUrl: input.baseUrl });
}
