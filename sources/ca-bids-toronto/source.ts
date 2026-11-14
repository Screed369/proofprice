// City of Toronto awarded contracts (Toronto Bids, Open Data Toronto), Open Government Licence - Toronto.
// Format checked 2026-11-09 from the cloud workspace (plain GET, no key): CKAN package "tobids-awarded-contracts",
// CSV https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/f78fe449-.../resource/81be799c-.../download/awarded-contracts.csv (200, 2.28 MB, UTF-8, header row, 7,803 rows).
// Columns: _id, Document Number, RFx (Solicitation) Type, High Level Category, Successful Supplier, Award (CAD; "26773.58", "771,931.57" with thousands
// commas, or "None"), Award Authority Obtained Date (YYYY-MM-DD, some blank), Division, Buyer Name / Email / Phone (personal: NEVER read or kept),
// Solicitation Document Description, Supplier Address (empty), Wards.
// The supplier name is read only to count a document+supplier award once; it is never stored or shown. Aggregates only.
import { InputError, SourceError } from "../../lib/http";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { summarise } from "../../lib/stats";
import { readLatestDay } from "../../lib/library/store";
import { matchPurchase, PURCHASES } from "../../categories/contracts/purchases";

export const INFO: SourceInfo = {
  id: "ca-bids-toronto",
  country: "CA (City of Toronto)",
  category: "government contracts (awarded contracts)",
  name: "Toronto Bids: awarded contracts of the City of Toronto",
  publisher: "City of Toronto (Purchasing and Materials Management), via Open Data Toronto",
  what_is_recorded:
    "Contracts that the City of Toronto awarded after a call for bids: the award date, the type of call (RFT, RFQ, RFP...), the high-level category (construction, goods and services, professional services), the City division and the awarded amount in Canadian dollars.",
  price_type: "contract_price",
  freshness: "Daily file from Open Data Toronto, copied by the collector each night; the newest award in it can be weeks old",
  licence: "Open Government Licence - Toronto",
  licence_url: "https://www.toronto.ca/city-government/data-research-maps/open-data/open-data-licence/",
  attribution:
    "Contains information licensed under the Open Government Licence – Toronto. Source: City of Toronto, Toronto Bids awarded contracts (Open Data Toronto). Figures are ProofPrice aggregates of the published awards (changes made: deduplicated, grouped, medians and ranges calculated).",
  homepage: "https://open.toronto.ca/dataset/tobids-awarded-contracts/",
  limits:
    "City of Toronto only (not other Ontario buyers, not federal contracts). The amount is the awarded value of a contract, often over several years and it may be a ceiling for a standing order; it is not a unit price and not an amount already paid. " +
    "Only calls for bids are listed, so purchases made without a call are missing. Roughly 150 awards a year, so most common purchases have too few awards for a figure (nothing is shown below 5 awards); the three categories and the overall figure are the ones that usually answer. " +
    "Awards with no amount, no date or a placeholder amount under 100 dollars are left out. Suppliers, buyers and officials are never named.",
  method_version: "1",
};

/** Months of awards kept in each daily aggregate. */
export const WINDOW_MONTHS = 24;
export const MIN_VALUE = 100;
export const CSV_URL =
  "https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/f78fe449-53f4-4962-9ec8-8f7eeece1072/resource/81be799c-0fae-4a29-9458-0dc3ef471ca5/download/awarded-contracts.csv";
export const UNIT = "per contract (award), total awarded value";

/** True for a request that names Toronto (used by serves() in this folder). */
export function isTorontoArea(area: unknown): boolean {
  const t = String(area ?? "").toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
  return ["toronto", "city of toronto", "toronto ontario", "toronto on"].includes(t);
}

/** The three high-level categories the City publishes, as library item ids. */
export const CATEGORIES: { id: string; label: string; csv: string; aliases: string[] }[] = [
  { id: "category/construction-services", label: "construction services", csv: "construction services", aliases: ["construction", "construction services", "construction work", "building works", "civil works"] },
  { id: "category/goods-and-services", label: "goods and services", csv: "goods and services", aliases: ["goods", "goods and services", "supplies", "goods services"] },
  { id: "category/professional-services", label: "professional services", csv: "professional services", aliases: ["professional services", "consulting", "consultancy", "consultants", "engineering services"] },
];

export function whatToItem(what: string): { item: string; label: string } | null {
  const t = what.toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
  if (["all", "everything", "all contracts", "any"].includes(t)) return { item: "all", label: "all contracts" };
  const c = CATEGORIES.find((x) => x.aliases.includes(t));
  if (c) return { item: c.id, label: c.label };
  const p = matchPurchase(what);
  if (p) return { item: p.id, label: p.label };
  return null;
}

/** Pure, quote-aware CSV reader (quoted fields may hold commas, doubled quotes and line breaks). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQ = false;
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQ) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** One award, only the fields we use. */
export interface TorAward {
  /** document number + supplier, used only to count an award once. Never stored or shown. */
  key: string;
  date: string;
  value: number;
  category: string;
  description: string;
}

/** Pure: CSV text to awards. Buyer name, e-mail and phone columns are not read. */
export function awardsFromCsv(text: string): TorAward[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const head = rows[0].map((h) => h.trim());
  const col = (name: string) => head.indexOf(name);
  const iDoc = col("Document Number"), iCat = col("High Level Category"), iSup = col("Successful Supplier"), iAward = col("Award");
  const iDate = col("Award Authority Obtained Date"), iDesc = col("Solicitation Document Description");
  // Since 2026-11-13 the publisher has no "Successful Supplier" column: "Award" holds a JSON list of awards for the solicitation
  // ([{"Award_Amount": "771,931.57", "Date_Awarded": "2012-10-04", "Successful_Bidder": "..."}]) and the list is repeated on every
  // row of the same solicitation. Both layouts are read; the repeats collapse on the document + supplier key downstream.
  if ([iDoc, iCat, iAward, iDate].some((i) => i < 0) || (iSup < 0 && !head.includes("Award"))) throw new SourceError("Open Data Toronto changed the awarded-contracts file: an expected column is missing", head.join("|"));
  const out: TorAward[] = [];
  const push = (doc: string, sup: string, rawAmount: unknown, rawDate: unknown, cat: string, desc: string) => {
    const raw = String(rawAmount ?? "").replace(/[$,\s]/g, "");
    if (!/^\d+(\.\d+)?$/.test(raw)) return; // "None", blank
    const value = Number(raw);
    if (!Number.isFinite(value) || value < MIN_VALUE) return;
    const date = String(rawDate ?? "").trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    out.push({ key: `${doc.trim()}|${sup.trim().toLowerCase()}`, date, value, category: cat.trim().toLowerCase(), description: desc });
  };
  for (const r of rows.slice(1)) {
    const desc = iDesc >= 0 ? (r[iDesc] ?? "").replace(/\s+/g, " ").trim() : "";
    const awardCell = (r[iAward] ?? "").trim();
    if (iSup < 0 || awardCell.startsWith("[")) {
      let list: unknown;
      try { list = JSON.parse(awardCell); } catch { continue; }
      if (!Array.isArray(list)) continue;
      for (const a of list as Array<Record<string, unknown>>) {
        if (!a || typeof a !== "object") continue;
        push(r[iDoc] ?? "", String(a.Successful_Bidder ?? ""), a.Award_Amount ?? a.Initial_Contract_Val, a.Date_Awarded ?? a.AwardedDate ?? r[iDate], r[iCat] ?? "", desc);
      }
      continue;
    }
    push(r[iDoc] ?? "", r[iSup] ?? "", r[iAward], r[iDate], r[iCat] ?? "", desc);
  }
  return out;
}

export function windowStart(today: string, months = WINDOW_MONTHS): string {
  const d = new Date(today + "T00:00:00Z");
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - months, d.getUTCDate())).toISOString().slice(0, 10);
}

/** Pure: awards to library rows (area ALL): all, each category, each recognised purchase. Each document+supplier counted once; 5-award rule. */
export function aggregate(awards: TorAward[], from: string, to: string): DailyRow[] {
  const seen = new Set<string>();
  const buckets = new Map<string, number[]>();
  const add = (item: string, v: number) => { const l = buckets.get(item) ?? []; l.push(v); buckets.set(item, l); };
  for (const a of awards) {
    if (a.date < from || a.date > to) continue;
    if (a.key !== "|" && seen.has(a.key)) continue;
    seen.add(a.key);
    add("all", a.value);
    const c = CATEGORIES.find((x) => x.csv === a.category);
    if (c) add(c.id, a.value);
    const p = a.description ? matchPurchase(a.description) : null;
    if (p) add(p.id, a.value);
  }
  const rows: DailyRow[] = [];
  for (const [item, values] of buckets) {
    const s = summarise(values);
    if (!s || s.count < 5) continue;
    rows.push({ area: "ALL", item, n: s.count, median: s.median, low: s.low, high: s.high, min: s.min, max: s.max });
  }
  return rows.sort((a, b) => a.item.localeCompare(b.item));
}

async function getText(url: string, timeoutMs: number): Promise<string> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { "user-agent": "ProofPrice/1.0 (+https://proofprice.com; hello@proofprice.com)" }, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err: any) {
    throw new SourceError("Could not reach Open Data Toronto", String(err?.cause?.code ?? err?.message ?? err));
  }
  if (!res.ok) throw new SourceError(`Open Data Toronto returned HTTP ${res.status}`, url, res.status);
  return res.text();
}

export async function torontoHarvest(now: Date = new Date()): Promise<HarvestResult> {
  const to = now.toISOString().slice(0, 10);
  const from = windowStart(to);
  const awards = awardsFromCsv(await getText(CSV_URL, 120000));
  if (!awards.length) throw new SourceError("Open Data Toronto returned no usable awards");
  const rows = aggregate(awards, from, to);
  const inWindow = awards.filter((a) => a.date >= from && a.date <= to).length;
  return { date: to, currency: "CAD", unit: UNIT, rows, note: `Awards dated ${from} to ${to}; ${inWindow} usable award rows of ${awards.length} read.` };
}

// ---------- the answer ----------

export interface TorInput { what: string; cpv?: string; baseUrl?: string }

export const SUPPORTED_EXAMPLES = ["all", "construction services", "goods and services", "professional services"];

export async function torontoContracts(input: TorInput): Promise<PriceAnswer> {
  if (input.cpv) throw new InputError("Toronto: cpv is not used. Leave it out and say what was bought in words.");
  const w = whatToItem(input.what);
  if (!w) {
    throw new InputError(
      `Toronto: "${input.what}" is not one of the groups we summarise from Toronto Bids. Try ${SUPPORTED_EXAMPLES.map((x) => `"${x}"`).join(", ")}, or a common purchase such as laptops (most single purchases have fewer than 5 awards, so no figure).`,
    );
  }
  const day = readLatestDay(INFO.id);
  if (!day) throw new SourceError("Toronto contract prices have not been collected yet; the daily collector fills them. Try again tomorrow.");
  const from = windowStart(day.date);
  const row = day.rows.find((r) => r.area === "ALL" && r.item === w.item);
  const summary = row ? { count: row.n, median: row.median, low: row.low, high: row.high, min: row.min, max: row.max } : null;
  return buildAnswer({
    source: INFO,
    query: { country: "CA", buyer_area: "Toronto", what: input.what },
    summary,
    currency: "CAD",
    unit: UNIT,
    period: { from, to: day.date },
    method:
      `Contracts awarded by the City of Toronto with an award date from ${from} to ${day.date} (${w.label}). Median and 10th–90th percentile of the awarded amount in CAD; ` +
      "each document and supplier counted once. Totals per contract, not unit prices; suppliers and buyers are never named.",
    describe: (s) =>
      `The City of Toronto awarded ${w.label} contracts with a median total value of ${fmtMoney(s.median, "CAD")} per contract ` +
      `(typical range ${fmtMoney(s.low, "CAD")} to ${fmtMoney(s.high, "CAD")}, 10th to 90th percentile). These are awarded totals per contract, not unit prices.`,
    baseUrl: input.baseUrl,
    extra: { value_basis: "total awarded value per contract, not a unit price", matched_group: w.item, newest_collection: day.date, purchases_recognised: PURCHASES.length },
  });
}
