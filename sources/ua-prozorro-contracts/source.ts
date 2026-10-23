// Ukrainian public contract prices from Prozorro, the national e-procurement system (Ministry of Economy of Ukraine).
// Licence read 2026-10-23 by the Licence Checker on the national open-data portal: data.gov.ua dataset f9c0acdb-23c5-4a2d-b549-9868df8ca927
// (resource public.api.openprocurement.org/api/0/tenders) says "Creative Commons Attribution" (CC BY 4.0), reuse needs a reference to the source.
// Format checked 2026-10-21 and 2026-10-23 from GitHub's servers (probes, no key, plain GET):
//   list   GET https://public-api.prozorro.gov.ua/api/2.5/contracts?limit=100&descending=1 -> {data:[{id,dateModified,status}], next_page:{offset,uri}}
//          (opt_fields other than status is ignored by the list, so the amounts need one detail call per contract)
//   detail GET .../contracts/<id> -> {data:{contractID, status:"active", dateSigned:"2026-10-14T00:00:00+03:00",
//          value:{amount:773760.0, currency:"UAH", valueAddedTaxIncluded:true, amountNet:644800.0},
//          items:[{classification:{scheme:"ДК021", id:"45510000-5"}, quantity, unit}], suppliers, procuringEntity, ...}}
// Suppliers and buyers are never read into the library. The feed is far too big to walk per request: harvest() reads the newest contracts
// once a day with polite concurrency and keeps aggregates only.
import { InputError, SourceError, fetchJson } from "../../lib/http";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { summarise } from "../../lib/stats";
import { readLatestDay } from "../../lib/library/store";
import { cleanCpv, cpvStem, matchPurchase, PURCHASES } from "../../categories/contracts/purchases";

export const INFO: SourceInfo = {
  id: "ua-prozorro-contracts",
  country: "UA (state, local authorities, state companies and other public buyers)",
  category: "government contracts (signed contracts)",
  name: "Prozorro: Ukrainian public procurement contracts",
  publisher: "Ministry of Economy of Ukraine (Prozorro), published on data.gov.ua",
  what_is_recorded:
    "Contracts that Ukrainian public buyers signed with the winner of a Prozorro tender: what was bought (official product code, DK 021 based on the CPV), the date signed and the contract value in hryvnia including VAT.",
  price_type: "contract_price",
  freshness: "Daily: Prozorro updates continuously; our copy is collected once a day from the newest contracts",
  licence: "Creative Commons Attribution 4.0 (CC BY 4.0)",
  licence_url: "https://data.gov.ua/en/dataset/f9c0acdb-23c5-4a2d-b549-9868df8ca927",
  attribution:
    "Source: Prozorro public procurement data, Ministry of Economy of Ukraine, data.gov.ua (CC BY 4.0), https://data.gov.ua/en/dataset/f9c0acdb-23c5-4a2d-b549-9868df8ca927. Figures are ProofPrice aggregates of the published contracts.",
  homepage: "https://prozorro.gov.ua/en",
  limits:
    "Contract values as signed, in hryvnia including VAT, over the whole contract (often a year or more); they are not unit prices and not amounts paid yet. " +
    "The daily collector reads the most recently updated contracts (a sample of the whole feed, up to " + "3,000 per day" + "), not every contract, and only contracts signed in the last 90 days that are active or finished. " +
    "Values under 1,000 UAH (placeholders) or over 10 billion UAH (entry errors) are left out, a contract is counted once, and contracts that mix purchases from different product divisions are left out. " +
    "Purchases are recognised from the contract's first product code, so a contract filed under another code is missed. Aggregates only; suppliers and buyers are never read or kept.",
  method_version: "1",
};

export const API = "https://public-api.prozorro.gov.ua/api/2.5/contracts";
export const WINDOW_DAYS = 90;
export const MIN_VALUE = 1_000;
export const MAX_VALUE = 10_000_000_000;
export const MAX_CONTRACTS = 3000;
export const CONCURRENCY = 6;
export const UNIT = "per contract, total contract value incl. VAT";
export const TIME_BUDGET_MS = 7 * 60 * 1000;
const UA_HEADER = "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)";

export interface UaContract {
  id: string;
  date: string; // YYYY-MM-DD signed
  value: number; // UAH incl. VAT
  cpv: string; // 8 digits, no check digit
}

export function windowStart(today: string, days = WINDOW_DAYS): string {
  const d = new Date(today + "T00:00:00Z");
  return new Date(d.getTime() - days * 86400000).toISOString().slice(0, 10);
}

/** Pure: the data object of one contract detail to a usable contract, or null. */
export function contractOf(d: any, from: string, to: string): UaContract | null {
  if (!d || typeof d !== "object") return null;
  const status = String(d.status ?? "");
  if (status !== "active" && status !== "terminated") return null;
  const v = d.value;
  if (!v || String(v.currency ?? "") !== "UAH" || v.valueAddedTaxIncluded === false) return null;
  const value = Number(v.amount);
  if (!Number.isFinite(value) || value < MIN_VALUE || value > MAX_VALUE) return null;
  const date = String(d.dateSigned ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < from || date > to) return null;
  const codes: string[] = [];
  for (const it of Array.isArray(d.items) ? d.items : []) {
    const c = String(it?.classification?.id ?? "").replace(/\D/g, "").slice(0, 8);
    if (c.length === 8) codes.push(c);
  }
  if (!codes.length) return null;
  if (new Set(codes.map((c) => c.slice(0, 2))).size > 1) return null; // a mixed basket is not one purchase
  const id = String(d.id ?? "");
  if (!id) return null;
  return { id, date, value, cpv: codes[0] };
}

/** Pure: ids from one list page, and where the next page starts. */
export function listPage(page: any): { ids: string[]; next: string | null } {
  const ids = (Array.isArray(page?.data) ? page.data : []).map((r: any) => String(r?.id ?? "")).filter(Boolean);
  const next = typeof page?.next_page?.offset === "string" && ids.length ? page.next_page.offset : null;
  return { ids, next };
}

const PURCHASE_STEMS = PURCHASES.map((p) => ({ id: p.id, stems: p.cpv.map(cpvStem) }));
export function itemsOf(cpv: string): string[] {
  const items: string[] = [];
  for (const p of PURCHASE_STEMS) if (p.stems.some((s) => cpv.startsWith(s))) items.push(p.id);
  items.push(`cpv-${cpv.slice(0, 2)}`, `cpv-${cpv.slice(0, 4)}`);
  return items;
}

/** Pure: library rows for every item with at least 5 distinct contracts. */
export function aggregateAll(contracts: Iterable<UaContract>, from: string, to: string): DailyRow[] {
  const seen = new Set<string>();
  const groups = new Map<string, number[]>();
  for (const c of contracts) {
    if (c.date < from || c.date > to || seen.has(c.id)) continue;
    seen.add(c.id);
    for (const item of itemsOf(c.cpv)) {
      const g = groups.get(item);
      if (g) g.push(c.value);
      else groups.set(item, [c.value]);
    }
  }
  const rows: DailyRow[] = [];
  for (const [item, values] of groups) {
    const s = summarise(values);
    if (!s || s.count < 5) continue;
    rows.push({ area: "ALL", item, n: s.count, median: s.median, low: s.low, high: s.high, min: s.min, max: s.max });
  }
  return rows.sort((a, b) => a.item.localeCompare(b.item));
}

export type Getter = (url: string) => Promise<any>;
const httpGet: Getter = (url) => fetchJson(url, { headers: { "user-agent": UA_HEADER, accept: "application/json" } }, 30000);

export interface HarvestOptions {
  get?: Getter;
  budgetMs?: number;
  maxContracts?: number;
}

export async function uaContractsHarvest(now: Date = new Date(), o: HarvestOptions = {}): Promise<HarvestResult> {
  const started = Date.now();
  const to = now.toISOString().slice(0, 10);
  const from = windowStart(to);
  const get = o.get ?? httpGet;
  const budget = o.budgetMs ?? TIME_BUDGET_MS;
  const max = o.maxContracts ?? MAX_CONTRACTS;
  const ids: string[] = [];
  let offset: string | null = "";
  while (offset !== null && ids.length < max && Date.now() - started < budget / 3) {
    const url = `${API}?limit=100&descending=1&opt_fields=status${offset ? `&offset=${encodeURIComponent(offset)}` : ""}`;
    const page = listPage(await get(url));
    if (!page.ids.length && !ids.length) throw new SourceError("The Prozorro contract list is empty: the API may have changed");
    for (const id of page.ids) if (ids.length < max) ids.push(id);
    offset = page.next;
  }
  if (!ids.length) throw new SourceError("Could not read the Prozorro contract list");
  const contracts: UaContract[] = [];
  let fetched = 0;
  let failed = 0;
  let cursor = 0;
  let lastError: unknown = null;
  async function worker() {
    while (cursor < ids.length && Date.now() - started < budget) {
      const id = ids[cursor++];
      try {
        const detail = await get(`${API}/${id}`);
        fetched++;
        const c = contractOf(detail?.data, from, to);
        if (c) contracts.push(c);
      } catch (err) {
        failed++;
        lastError = err;
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  if (!fetched) throw new SourceError("Could not read any Prozorro contract (public-api.prozorro.gov.ua)", String((lastError as any)?.message ?? lastError));
  if (!contracts.length) throw new SourceError("The Prozorro contracts held nothing usable in the window: the format may have changed");
  const rows = aggregateAll(contracts, from, to);
  return {
    date: to,
    currency: "UAH",
    unit: UNIT,
    rows,
    note: `Sample of the ${ids.length} most recently updated contracts; ${fetched} read, ${failed} failed, ${contracts.length} usable (signed ${from} to ${to}).`,
  };
}

// ---------- the answer ----------

export interface UaInput {
  what: string;
  cpv?: string;
  buyer_area?: string;
  baseUrl?: string;
}

export const SUPPORTED_EXAMPLES = ["laptops", "school meals", "road resurfacing", "office cleaning", "catering", "ambulances"];

export async function uaContracts(input: UaInput): Promise<PriceAnswer> {
  if (input.buyer_area) throw new InputError("Ukraine: buyer_area is not used; the figures are for all Ukrainian public buyers together.");
  let item: string;
  let label: string;
  let matched: Record<string, string>;
  if (input.cpv) {
    const code = cleanCpv(input.cpv);
    if (!code || code.length === 3) {
      throw new InputError("Ukraine: cpv must be a product code of 2 digits (a division such as 30) or 4 to 8 digits (30213100); 4 digits or more are read as the 4-digit group (3021).");
    }
    const group = code.length === 2 ? code : code.slice(0, 4);
    item = `cpv-${group}`;
    label = `contracts under product group ${group}`;
    matched = { cpv_group: group, cpv_requested: code };
  } else {
    const p = matchPurchase(input.what);
    if (!p) {
      throw new InputError(
        `Ukraine: "${input.what}" is not one of the purchases we summarise from Prozorro. Try a common purchase such as ${SUPPORTED_EXAMPLES.join(", ")} (${PURCHASES.length} are recognised), or pass a product code in cpv.`,
      );
    }
    item = p.id;
    label = `${p.label} contracts`;
    matched = { matched_purchase: p.id };
  }
  const day = readLatestDay(INFO.id);
  if (!day) throw new SourceError("Ukrainian contract prices have not been collected yet; the daily collector fills them. Try again tomorrow.");
  const from = windowStart(day.date);
  const row = day.rows.find((r) => r.area === "ALL" && r.item === item);
  const summary = row ? { count: row.n, median: row.median, low: row.low, high: row.high, min: row.min, max: row.max } : null;
  return buildAnswer({
    source: INFO,
    query: { country: "UA", what: input.what, ...(input.cpv ? { cpv: input.cpv } : {}) },
    summary,
    currency: "UAH",
    unit: UNIT,
    period: { from, to: day.date },
    method:
      `Prozorro contracts signed ${from} to ${day.date} (a sample of the newest contracts), recognised by their product code (${label}). Median and 10th–90th percentile of the contract value in UAH including VAT. ` +
      "Totals per contract, not unit prices; contract values as signed, not confirmed payments; suppliers are never named.",
    describe: (s) =>
      `Ukrainian public buyers signed ${label} with a median total value of ${fmtMoney(s.median, "UAH")} per contract ` +
      `(typical range ${fmtMoney(s.low, "UAH")} to ${fmtMoney(s.high, "UAH")}, 10th to 90th percentile). These are contract values as signed (VAT included), not unit prices.`,
    baseUrl: input.baseUrl,
    extra: { value_basis: "total signed contract value incl. VAT, not a unit price", ...matched, newest_collection: day.date },
  });
}
