// Hong Kong Government Logistics Department auctions of surplus and confiscated goods (DATA.GOV.HK).
// Format read on 2026-10-29 (probes hkgld-res, hkgld-list, hkgld-r1, hkgld-r17, hkgld-r19 from GitHub): one pair of CSV files per auction,
//   https://www.gld.gov.hk/datagovhk/supplies-mgmt/auctionResult_<n>-<year>_EN.csv  header: Date of Auction,Auction List No.,Lot No.,Transaction Price (HK$)
//   https://www.gld.gov.hk/datagovhk/supplies-mgmt/auctionList_<n>-<year>_EN.csv    header: Date of Auction,Auction List No.,Lot No.,Description,Quantity,Unit
// UTF-8 with BOM, dates d/m/yyyy ("08/1/2026"), n runs 1,2,3... through the year (19 by 22 Oct 2026). The result file lists SOLD lots only.
// A lot can hold several description rows; the price is per lot, so only lots with exactly one row and Quantity 1 are used.
// Descriptions of vehicles carry registration and chassis numbers: they are never kept (only the first line, the vehicle type, is read).
import { SourceError, InputError } from "../../lib/http";
import { MIN_PUBLISH } from "../../lib/stats";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { aggregateDaily, NATIONAL } from "../../lib/library/aggregate";
import { readDaily, readMeta } from "../../lib/library/store";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";

export const INFO: SourceInfo = {
  id: "hk-gld-auctions",
  country: "HK (Hong Kong)",
  category: "auctions (government surplus and confiscated goods)",
  name: "Government Logistics Department: auction results",
  publisher: "Government Logistics Department, HKSAR Government (via DATA.GOV.HK)",
  what_is_recorded: "One lot of surplus, unclaimed or confiscated goods sold at a Government Logistics Department public auction, with the transaction price in HK$ and the auction date.",
  price_type: "transaction",
  freshness: "A new pair of files after each auction, about every two weeks",
  licence:
    "DATA.GOV.HK Terms and Conditions: users may 'browse, download, distribute, reproduce, hyperlink to, and print the Data for both commercial and non-commercial purposes on a free-of-charge basis' on condition of clear source attribution (and an indemnity condition accepted by the ProofPrice owner on 29 Oct 2026)",
  licence_url: "https://data.gov.hk/en/terms-and-conditions",
  attribution: "Source: Government Logistics Department, HKSAR Government, via DATA.GOV.HK. Aggregated by ProofPrice (changed: medians and percentiles only).",
  homepage: "https://data.gov.hk/en-data/dataset/hk-gld-suppmgmt3-auction-result",
  limits:
    "Transaction price per lot in Hong Kong dollars at public auction (used, damaged or confiscated goods; the file does not say whether a buyer's fee is included). Only lots with a single item are used. Groups come from the first line of the lot description. Aggregates only, never a lot, a registration mark or a buyer.",
};

export const HK_EVIDENCE = {
  label: "Government auction transaction price (HK$ per lot)",
  meaning: "The transaction price on a single-item lot sold at a Hong Kong Government Logistics Department auction: used goods sold by the government, not retail prices.",
};

export const GROUPS = ["private-cars", "goods-vehicles", "motorcycles", "containers"] as const;
export type Group = (typeof GROUPS)[number];
export const WINDOWS = [12, 24] as const;

/** Group from the first line of the description (the vehicle type). Registration and chassis lines are never read. */
export function classify(description: string): Group | null {
  const first = description.split(/\r?\n/)[0].replace(/\s+/g, " ").trim();
  if (/^used (private car|taxi|private light bus)/i.test(first)) return "private-cars";
  if (/^used (light|medium|heavy) goods vehicle|^used (van|lorry|truck|pick-?up)/i.test(first)) return "goods-vehicles";
  if (/^used (motor ?cycle|motorcycle|scooter)/i.test(first)) return "motorcycles";
  if (/^used (20|40)['′’]? ?(ft )?container/i.test(first)) return "containers";
  return null;
}

/** RFC 4180 CSV, row by row (descriptions hold line breaks inside quotes). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const t = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const end = () => {
    row.push(cell);
    cell = "";
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
  };
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (quoted) {
      if (c === '"') {
        if (t[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      end();
    } else cell += c;
  }
  if (cell !== "" || row.length) end();
  return rows;
}

/** "08/1/2026" (day/month/year) to "2026-01-08", or null. */
export function parseDate(s: string): string | null {
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const d = Number(m[1]), mo = Number(m[2]);
  if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
  return `${m[3]}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export interface Sale { group: Group; date: string; price: number }

/** Join the result file and the list file of one auction: single-row, quantity-1 lots of a known group that were sold at a positive price. */
export function parseAuction(resultText: string, listText: string): Sale[] {
  const res = parseCsv(resultText);
  const list = parseCsv(listText);
  const col = (head: string[], name: string) => head.map((h) => h.trim()).indexOf(name);
  if (!res.length || !list.length) return [];
  const rd = col(res[0], "Date of Auction"), rl = col(res[0], "Lot No."), rn = col(res[0], "Auction List No."), rp = col(res[0], "Transaction Price (HK$)");
  const ld = col(list[0], "Description"), ll = col(list[0], "Lot No."), lq = col(list[0], "Quantity"), ln = col(list[0], "Auction List No.");
  if ([rd, rl, rn, rp].some((i) => i < 0) || [ld, ll, lq, ln].some((i) => i < 0)) throw new SourceError("Unexpected file format from the Government Logistics Department");
  const lots = new Map<string, { n: number; desc: string; qty: string }>();
  for (const r of list.slice(1)) {
    const k = `${(r[ln] ?? "").trim()}|${(r[ll] ?? "").trim()}`;
    const cur = lots.get(k);
    if (cur) cur.n++;
    else lots.set(k, { n: 1, desc: r[ld] ?? "", qty: (r[lq] ?? "").trim() });
  }
  const sales: Sale[] = [];
  for (const r of res.slice(1)) {
    const lot = lots.get(`${(r[rn] ?? "").trim()}|${(r[rl] ?? "").trim()}`);
    if (!lot || lot.n !== 1 || lot.qty !== "1") continue;
    const price = Number((r[rp] ?? "").replace(/[,\s]/g, ""));
    const date = parseDate(r[rd] ?? "");
    const group = classify(lot.desc);
    if (!group || !date || !(price > 0)) continue;
    sales.push({ group, date, price });
  }
  return sales;
}

export function monthsBack(date: string, months: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

/** Library rows: area ALL, item "<group>:<months>m", windows ending at the newest auction. */
export function dailyRows(sales: Sale[]): { date: string; rows: DailyRow[] } {
  const last = sales.reduce((m, s) => (s.date > m ? s.date : m), "0000-00-00");
  const recs: { area: string; item: string; price: number }[] = [];
  for (const w of WINDOWS) {
    const from = monthsBack(last, w);
    for (const s of sales) if (s.date > from) recs.push({ area: NATIONAL, item: `${s.group}:${w}m`, price: s.price });
  }
  return { date: last, rows: aggregateDaily(recs, false).filter((r) => r.n >= MIN_PUBLISH) };
}

const BASE = "https://www.gld.gov.hk/datagovhk/supplies-mgmt/";
const UA = { "user-agent": "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)" };
export const resultUrl = (n: number, year: number) => `${BASE}auctionResult_${n}-${year}_EN.csv`;
export const listUrl = (n: number, year: number) => `${BASE}auctionList_${n}-${year}_EN.csv`;

async function getText(url: string): Promise<string | null> {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new SourceError(`gld.gov.hk returned HTTP ${res.status}`, url, res.status);
  const text = await res.text();
  return /^﻿?Date of Auction/.test(text) ? text : null; // an HTML error page is a missing file
}

/** The daily collector: auctions n = 1, 2, ... of this and last year (24 months), stopping after 3 missing numbers in a row. */
export async function hkHarvest(): Promise<HarvestResult> {
  const thisYear = new Date().getUTCFullYear();
  const sales: Sale[] = [];
  let files = 0;
  for (const year of [thisYear, thisYear - 1]) {
    let misses = 0;
    for (let n = 1; n <= 60 && misses < 3; n++) {
      const [r, l] = await Promise.all([getText(resultUrl(n, year)), getText(listUrl(n, year))]);
      if (!r || !l) { misses++; continue; }
      misses = 0;
      files++;
      sales.push(...parseAuction(r, l));
    }
  }
  if (!sales.length) throw new SourceError("No usable auction lots found in the Government Logistics Department files");
  const { date, rows } = dailyRows(sales);
  return { date, currency: "HKD", unit: "per lot", rows, note: `Windows of 12/24 months ending ${date}; single-item vehicle and container lots; ${files} auctions read.` };
}

export const snapWindow = (m: number | undefined): number => ((m ?? 12) > 18 ? 24 : 12);

/** An exact group name or a common word to a group, or null. */
export function groupFor(what: string): Group | null {
  const slug = what.toLowerCase().trim().replace(/[\s_&]+/g, "-");
  if ((GROUPS as readonly string[]).includes(slug)) return slug as Group;
  const alias: Record<string, Group> = { car: "private-cars", cars: "private-cars", "private-car": "private-cars", vehicles: "private-cars", vehicle: "private-cars", taxi: "private-cars",
    van: "goods-vehicles", vans: "goods-vehicles", truck: "goods-vehicles", trucks: "goods-vehicles", lorry: "goods-vehicles", "goods-vehicle": "goods-vehicles",
    motorcycle: "motorcycles", motorbike: "motorcycles", scooter: "motorcycles", container: "containers", "shipping-container": "containers" };
  return alias[slug] ?? null;
}

export function hkKey(p: { what?: string; months?: number }) {
  const group = groupFor(p.what ?? "");
  if (!group) return null;
  const months = snapWindow(p.months);
  return { area: NATIONAL, item: `${group}:${months}m`, group, months };
}

export function hkHistoryKey(p: { what?: string; months?: number }) {
  const k = hkKey(p);
  return k ? { area: k.area, item: k.item, label: `Hong Kong, ${k.group}` } : null;
}

export function hkAnswerFromRow(row: DailyRow & { date: string }, q: { group: Group; months: number; baseUrl?: string }): PriceAnswer {
  return buildAnswer({
    source: INFO,
    query: { country: "HK", what: q.group, months: q.months },
    summary: { count: row.n, median: row.median, low: row.low, high: row.high, min: row.min, max: row.max },
    currency: "HKD",
    unit: "per lot",
    period: { from: monthsBack(row.date, q.months), to: row.date },
    method:
      "Median and 10th–90th percentile of the transaction price on single-item lots sold at Hong Kong Government Logistics Department auctions, in the group, over the last 12 or 24 months (your request is rounded) ending at the newest auction. " +
      "Groups come from the first line of the lot description. Lots with several items are left out because the price is per lot. No range under 5 lots.",
    describe: (x) =>
      `Hong Kong government auction lots in the ${q.group.replace("-", " ")} group sold for a median of ${fmtMoney(x.median, "HKD")} per lot (10th–90th percentile ${fmtMoney(x.low, "HKD")} to ${fmtMoney(x.high, "HKD")}); ` +
      "used, unclaimed or confiscated goods sold by the government, not retail prices.",
    baseUrl: q.baseUrl,
    evidence: HK_EVIDENCE,
  });
}

export async function hkAuctionPrices(input: { what: string; months?: number; baseUrl?: string }): Promise<PriceAnswer> {
  const k = hkKey(input);
  if (!k) throw new InputError(`Hong Kong government auctions are grouped as: ${GROUPS.join(", ")}. Ask for one of these (or a word such as 'car', 'van', 'container').`);
  const meta = readMeta(INFO.id);
  if (!meta?.last_date) throw new SourceError("ProofPrice collects the Government Logistics Department auction files daily; data appears after the next collection.");
  const to = meta.last_date;
  const from = new Date(Date.parse(to + "T00:00:00Z") - 60 * 86400000).toISOString().slice(0, 10);
  const rows = readDaily(INFO.id, { area: k.area, item: k.item, from, to });
  const row = rows[rows.length - 1];
  if (!row || row.n < MIN_PUBLISH) {
    const a = buildAnswer({
      source: INFO,
      query: { country: "HK", what: k.group, months: k.months },
      summary: null, currency: "HKD", unit: "per lot", period: { from: null, to: null },
      method: "Rolling windows of Government Logistics Department auction results.", describe: () => "", baseUrl: input.baseUrl,
      extra: { reason: `Fewer than ${MIN_PUBLISH} single-item ${k.group} lots sold in the last ${k.months} months` },
    });
    a.summary = `Fewer than ${MIN_PUBLISH} single-item ${k.group.replace("-", " ")} lots are recorded in the last ${k.months} months, so no price range is published. Try months=24.`;
    return a;
  }
  return hkAnswerFromRow(row, { group: k.group, months: k.months, baseUrl: input.baseUrl });
}
