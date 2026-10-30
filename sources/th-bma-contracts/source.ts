// Bangkok (Thailand) public contract prices from the Bangkok Metropolitan Administration (BMA) open procurement data, published through the
// Open Contracting Partnership data registry under Creative Commons Attribution 4.0 (CC BY 4.0), licence read on 2026-10-30:
// https://data.open-contracting.org/en/publication/158
// Format checked 2026-10-30 by downloading the real file: /en/publication/158/download?name=2026.jsonl.gz answers 302 to
// fastly.data.open-contracting.org/downloads/thailand_bangkok/<n>/2026.jsonl.gz (7 MB gzip, 208,218 JSON lines, last modified 14 Oct 2026). Each line is one
// compiled OCDS release (ocid, date, buyer{id,name}, planning, tender, contracts[]). 48,383 lines carry a contracts[] entry, all status "active", all in THB:
//   contracts[]: { id: "21-31-68-50010700", title: "<Thai text: what was bought>", value: { amount: 9432, currency: "THB" },
//                  period: { startDate: "2568-02-24T00:00:00Z", endDate: ... }, status: "active", awardID: 1,
//                  implementation.financialProgress.totalSpend.amount }
// There is NO dateSigned: the contract start date is period.startDate and it is written in the Buddhist Era (2568 = 2025). Titles are Thai only, so purchases are
// recognised with Thai keywords (below), not with the English aliases the other sources use. Supplier names (awards[].suppliers, parties) are never read or kept.
// The file is a bulk download, so it is read only by harvest() in the daily collector; answers come from the price library.
import { InputError, SourceError } from "../../lib/http";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { summarise } from "../../lib/stats";
import { readLatestDay } from "../../lib/library/store";
import { PURCHASES, matchPurchase } from "../../categories/contracts/purchases";

export const INFO: SourceInfo = {
  id: "th-bma-contracts",
  country: "TH (Bangkok only)",
  category: "government contracts (signed contracts)",
  name: "Bangkok Metropolitan Administration: public contracts (OCDS)",
  publisher: "Bangkok Metropolitan Administration (BMA), Thailand, republished by the Open Contracting Partnership",
  what_is_recorded:
    "Contracts that the Bangkok Metropolitan Administration (its departments, district offices and municipal schools) records as active: what was bought (Thai title), the contract start date and the contract value in baht.",
  price_type: "contract_price",
  freshness: "The Open Contracting Partnership refreshes the BMA file about every two weeks and our copy is collected once a day",
  licence: "Creative Commons Attribution 4.0 International (CC BY 4.0)",
  licence_url: "https://creativecommons.org/licenses/by/4.0/",
  attribution:
    "Source: Bangkok Metropolitan Administration (BMA) open procurement data, via the Open Contracting Partnership data registry (CC BY 4.0). Figures are ProofPrice aggregates of the published contracts.",
  homepage: "https://data.open-contracting.org/en/publication/158",
  limits:
    "Bangkok Metropolitan Administration buyers only (not the national government and not other Thai cities). The value is the contract value, often for a month, a term or a whole budget year; it is not a unit price. " +
    "Contract titles are in Thai and purchases are recognised from Thai keywords, so a contract with unusual wording is missed. Values under 1,000 baht (placeholders) and over 1 billion baht (entry errors) are left out. " +
    "Aggregates only; suppliers and officials are never named or read.",
  method_version: "1",
};

export const WINDOW_MONTHS = 24;
export const MIN_VALUE = 1000;
export const MAX_VALUE = 1_000_000_000;
export const FILE_URL = "https://data.open-contracting.org/en/publication/158/download?name=2026.jsonl.gz";
export const UNIT = "per contract, total contract value";

/** One purchase we recognise in Thai titles: the shared purchase id (categories/contracts/purchases.ts), a pattern that must match and one that must not. */
interface ThaiRule {
  id: string;
  must: RegExp;
  not?: RegExp;
}

/** Repairs, rentals and supplies-for-a-machine are not the purchase itself. */
const NOT_A_PURCHASE = /ซ่อม|เช่า|บำรุงรักษา|อะไหล่|หมึก|ตลับ/;

/** First matching rule wins, so the narrower rule (school cleaning) comes before the wider one (building cleaning). */
export const RULES: ThaiRule[] = [
  // "จ้างเหมาจัดทำอาหารเช้าและอาหารกลางวันสำหรับนักเรียน" = contract to prepare breakfast and lunch for pupils
  { id: "school-meals", must: /จ้าง.*อาหารกลางวัน.*(นักเรียน|เด็ก|โรงเรียน|ศูนย์)/, not: /ประชุม|สัมมนา|อบรม|รับรอง/ },
  // "จ้างเหมาทำความสะอาดอาคารในโรงเรียน" = contract for cleaning of school buildings
  { id: "school-cleaning", must: /จ้าง.*ทำความสะอาด.*โรงเรียน/, not: /น้ำยา|วัสดุ/ },
  // "จ้างเหมาทำความสะอาดอาคารกองเภสัชกรรม" = contract for cleaning of a building
  { id: "building-cleaning", must: /จ้าง.*ทำความสะอาด(อาคาร|สำนักงาน)/, not: /น้ำยา|วัสดุ/ },
  // "จ้างเหมาดูแลทรัพย์สินและรักษาความปลอดภัย" = contract for guarding of property and security
  { id: "security-guards", must: /จ้าง.*รักษาความปลอดภัย/, not: /บัตร|กล้อง|ระบบ|อุปกรณ์|จัดทำ|ติดตั้ง|เครื่อง/ },
  // "เครื่องคอมพิวเตอร์โน้ตบุ๊ก ... 2 เครื่อง" = notebook computers (lots that also name desktops, "และ", are skipped)
  { id: "laptops", must: /โน้ตบุ๊ก|โน๊ตบุ๊ก|โน้ตบุ้ก|โน้ตบุค/, not: /กระเป๋า|เมาส์|และ|ซ่อม|เช่า|หมึก/ },
];

/** Purchases this source can answer (shared ids). */
export const SUPPORTED_IDS = RULES.map((r) => r.id);

/** Pure: the purchase a Thai contract title is, or null. */
export function purchaseOfTitle(title: string): string | null {
  const t = title.replace(/\s+/g, " ").trim();
  if (!t || NOT_A_PURCHASE.test(t)) return null;
  for (const r of RULES) if (r.must.test(t) && !(r.not && r.not.test(t))) return r.id;
  return null;
}

export interface ThContract {
  /** Release ocid plus contract id plus award id: used to count a contract once. */
  key: string;
  /** Contract start date YYYY-MM-DD (Gregorian). */
  date: string;
  value: number;
  title: string;
}

function clean(s: unknown): string {
  return typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "";
}

/** "2568-02-24T00:00:00Z" (Buddhist Era) or "2025-02-24" -> "2025-02-24"; "" when it is not a date. */
export function gregorianDate(raw: unknown): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(clean(raw));
  if (!m) return "";
  let year = Number(m[1]);
  if (year >= 2400) year -= 543;
  if (year < 2000 || year > 2100) return "";
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return "";
  return `${String(year).padStart(4, "0")}-${m[2]}-${m[3]}`;
}

/** Pure: the usable contracts of one OCDS release. Only active baht contracts with a plausible amount and a readable start date are kept. */
export function contractsOf(doc: any): ThContract[] {
  if (!doc || typeof doc !== "object") return [];
  if (Array.isArray(doc.releases)) return doc.releases.flatMap((r: any) => contractsOf(r));
  if (doc.compiledRelease) return contractsOf(doc.compiledRelease);
  const out: ThContract[] = [];
  const contracts = Array.isArray(doc.contracts) ? doc.contracts : [];
  for (const c of contracts) {
    if (!c || typeof c !== "object") continue;
    if (clean(c.status).toLowerCase() !== "active") continue;
    if (clean(c.value?.currency).toUpperCase() !== "THB") continue;
    const value = Number(c.value?.amount);
    if (!Number.isFinite(value) || value < MIN_VALUE || value > MAX_VALUE) continue;
    const date = gregorianDate(c.period?.startDate);
    if (!date) continue;
    const title = clean(c.title);
    if (!title) continue;
    out.push({ key: `${clean(doc.ocid)}|${clean(String(c.id ?? ""))}|${clean(String(c.awardID ?? ""))}`, date, value, title });
  }
  return out;
}

export function windowStart(today: string, months = WINDOW_MONTHS): string {
  const d = new Date(today + "T00:00:00Z");
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - months, d.getUTCDate())).toISOString().slice(0, 10);
}

/** Pure: contracts to library rows, one per purchase (area ALL), with the 5-contract rule. A contract is counted once. */
export function aggregate(contracts: ThContract[], from: string, to: string): DailyRow[] {
  const seen = new Set<string>();
  const byPurchase = new Map<string, number[]>();
  for (const c of contracts) {
    if (c.date < from || c.date > to) continue;
    if (c.key !== "||") {
      if (seen.has(c.key)) continue;
      seen.add(c.key);
    }
    const id = purchaseOfTitle(c.title);
    if (!id) continue;
    const list = byPurchase.get(id) ?? [];
    list.push(c.value);
    byPurchase.set(id, list);
  }
  const rows: DailyRow[] = [];
  for (const [item, values] of byPurchase) {
    const s = summarise(values);
    if (!s || s.count < 5) continue;
    rows.push({ area: "ALL", item, n: s.count, median: s.median, low: s.low, high: s.high, min: s.min, max: s.max });
  }
  return rows.sort((a, b) => a.item.localeCompare(b.item));
}

/** Stream a gzip JSON-lines file: every non-empty line is parsed and handed to `onDoc`. A damaged line is counted in `bad` and skipped. */
export async function streamJsonLines(url: string, onDoc: (doc: any) => void, timeoutMs = 300000): Promise<{ lines: number; bad: number }> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { "user-agent": "ProofPrice/1.0 (+https://proofprice.com; hello@proofprice.com)" }, signal: AbortSignal.timeout(timeoutMs), redirect: "follow" });
  } catch (err: any) {
    throw new SourceError("Could not reach the Open Contracting Partnership data registry", String(err?.cause?.code ?? err?.message ?? err));
  }
  if (!res.ok || !res.body) throw new SourceError(`Open Contracting Partnership registry returned HTTP ${res.status}`, url, res.status);
  const text = res.body.pipeThrough(new DecompressionStream("gzip")).pipeThrough(new TextDecoderStream());
  const reader = text.getReader();
  let lines = 0;
  let bad = 0;
  let tail = "";
  const handle = (line: string) => {
    if (!line.trim()) return;
    lines++;
    let doc: any;
    try {
      doc = JSON.parse(line);
    } catch {
      bad++;
      return;
    }
    onDoc(doc);
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    tail += value;
    let at: number;
    let start = 0;
    while ((at = tail.indexOf("\n", start)) >= 0) {
      handle(tail.slice(start, at));
      start = at + 1;
    }
    tail = tail.slice(start);
  }
  handle(tail);
  return { lines, bad };
}

export async function thContractsHarvest(now: Date = new Date(), url: string = FILE_URL): Promise<HarvestResult> {
  const to = now.toISOString().slice(0, 10);
  const from = windowStart(to);
  const contracts: ThContract[] = [];
  let seenContracts = 0;
  const { lines, bad } = await streamJsonLines(url, (doc) => {
    for (const c of contractsOf(doc)) {
      seenContracts++;
      if (c.date >= from && c.date <= to) contracts.push(c);
    }
  });
  if (lines === 0) throw new SourceError("The BMA bulk file held no records");
  if (bad > lines / 10) throw new SourceError(`The BMA bulk file changed: ${bad} of ${lines} lines are not JSON`);
  if (seenContracts === 0) throw new SourceError("The BMA bulk file changed: no active contracts in baht were found in its records");
  const rows = aggregate(contracts, from, to);
  return {
    date: to,
    currency: "THB",
    unit: UNIT,
    rows,
    note: `Contracts starting ${from} to ${to}; ${contracts.length} usable active contracts from ${lines} records (${seenContracts} contracts in all).`,
  };
}

// ---------- the answer ----------

export interface ThInput {
  what: string;
  cpv?: string;
  buyer_area?: string;
  baseUrl?: string;
}

export const SUPPORTED_EXAMPLES = ["school meals", "building cleaning", "school cleaning", "security guard services", "laptops"];

export async function thContracts(input: ThInput): Promise<PriceAnswer> {
  if (input.cpv) throw new InputError("Thailand: cpv is not used (the Bangkok data carries no CPV codes). Leave it out and say what was bought in words.");
  if (input.buyer_area) throw new InputError("Thailand: buyer_area is not used; the figures are for all Bangkok Metropolitan Administration buyers together.");
  const p = matchPurchase(input.what);
  if (!p || !SUPPORTED_IDS.includes(p.id)) {
    const labels = SUPPORTED_IDS.map((id) => PURCHASES.find((x) => x.id === id)?.label ?? id);
    throw new InputError(
      `Thailand: "${input.what}" is not one of the purchases we summarise from the Bangkok contract data. Try one of: ${labels.join(", ")} (for example what=${SUPPORTED_EXAMPLES[0]}).`,
    );
  }
  const day = readLatestDay(INFO.id);
  if (!day) throw new SourceError("Bangkok contract prices have not been collected yet; the daily collector fills them. Try again tomorrow.");
  const from = windowStart(day.date);
  const row = day.rows.find((r) => r.area === "ALL" && r.item === p.id);
  const summary = row ? { count: row.n, median: row.median, low: row.low, high: row.high, min: row.min, max: row.max } : null;
  return buildAnswer({
    source: INFO,
    query: { country: "TH", what: input.what },
    summary,
    currency: "THB",
    unit: UNIT,
    period: { from, to: day.date },
    method:
      `Bangkok Metropolitan Administration contracts starting ${from} to ${day.date}, recognised by Thai keywords in the contract title (${p.label}). Median and 10th–90th percentile of the contract value in THB, ` +
      "from contracts recorded as active. Totals per contract (often per month or per term), not unit prices; suppliers are never named.",
    describe: (s) =>
      `Bangkok Metropolitan Administration buyers signed ${p.label} contracts with a median total value of ${fmtMoney(s.median, "THB")} per contract ` +
      `(typical range ${fmtMoney(s.low, "THB")} to ${fmtMoney(s.high, "THB")}, 10th to 90th percentile). These are totals per contract (Bangkok city administration only), not unit prices.`,
    baseUrl: input.baseUrl,
    extra: { value_basis: "total contract value (active contract), not a unit price", matched_purchase: p.id, newest_collection: day.date, buyers: "Bangkok Metropolitan Administration only" },
  });
}
