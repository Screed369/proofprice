// City of Chicago contract awards (City of Chicago Data Portal, dataset rsxa-ify5, Socrata).
// Format checked 2026-10-31 from GitHub's servers (probes chicontracts31/32): key-free Socrata JSON; revision_number and award_amount are TEXT
// ("0", "750"); approval_date is a floating timestamp "2026-10-29T00:00:00.000". We read only approval_date, award_amount,
// purchase_order_description (matched for words, never stored) and revision_number. Vendor, address and PDF columns are never selected.
// Licence: the dataset carries attribution "City of Chicago" and no licence text -> Unclear, FREE TIER ONLY (nothing here ever charges).
import { InputError, SourceError } from "../../lib/http";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { summarise } from "../../lib/stats";
import { readLatestDay } from "../../lib/library/store";
import { socrataAll } from "../../lib/adapters";
import { matchPurchase, PURCHASES } from "../../categories/contracts/purchases";

export const INFO: SourceInfo = {
  id: "us-chicago-contracts",
  country: "US (City of Chicago)",
  category: "government contracts (city awards)",
  name: "City of Chicago contract awards",
  publisher: "City of Chicago (Data Portal)",
  what_is_recorded:
    "Contracts and purchase orders the City of Chicago awarded: approval date, department, contract type and the awarded amount in US dollars, with a short description.",
  price_type: "contract_price",
  freshness: "Updated daily by the City of Chicago",
  licence: "No licence stated by the publisher (attribution: City of Chicago); free tier only",
  licence_url: "https://data.cityofchicago.org/d/rsxa-ify5",
  attribution: "Source: City of Chicago Data Portal, Contracts (rsxa-ify5). Figures are ProofPrice aggregates (grouped, medians and ranges calculated).",
  homepage: "https://data.cityofchicago.org/d/rsxa-ify5",
  limits:
    "City of Chicago awards only (not Cook County, the state or federal contracts). The amount is the awarded value of the original award (revision 0) of at least US$1,000, often over a whole contract period; " +
    "it is not a unit price and not an amount paid yet. Purchases are recognised from the short free-text description; an unusual description is missed. Aggregates only; vendors are never named.",
  method_version: "1",
};

export const DOMAIN = "data.cityofchicago.org";
export const DATASET = "rsxa-ify5";
export const WINDOW_MONTHS = 24;
export const MIN_VALUE = 1000;
export const UNIT = "per contract, total awarded value";
export const ALL_ITEM = "all";

/** True for a request that names Chicago (serves() here; us-usaspending has the mirror rule). */
export function isChicagoArea(area: unknown): boolean {
  const t = String(area ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
  return ["chicago", "city of chicago", "chicago il", "chicago illinois", "chi"].includes(t);
}

export interface ChiContract { date: string; value: number; text: string }

/** Pure: Socrata rows to contracts. Revision 0 only (later revisions are changes), positive amounts of at least US$1,000, valid dates. */
export function contractsFromRows(rows: Record<string, any>[]): ChiContract[] {
  const out: ChiContract[] = [];
  for (const r of rows) {
    if (String(r.revision_number ?? "0").trim() !== "0") continue;
    const value = Number(r.award_amount);
    const date = String(r.approval_date ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(value) || value < MIN_VALUE) continue;
    out.push({ date, value, text: String(r.purchase_order_description ?? "").replace(/\s+/g, " ").trim() });
  }
  return out;
}

export function windowStart(today: string, months = WINDOW_MONTHS): string {
  const d = new Date(today + "T00:00:00Z");
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - months, d.getUTCDate())).toISOString().slice(0, 10);
}

/** Pure: contracts to library rows: one for all awards and one per recognised purchase, each with at least 5 contracts. */
export function aggregate(contracts: ChiContract[], from: string, to: string): DailyRow[] {
  const groups = new Map<string, number[]>();
  const add = (item: string, v: number) => { const g = groups.get(item); if (g) g.push(v); else groups.set(item, [v]); };
  for (const c of contracts) {
    if (c.date < from || c.date > to) continue;
    add(ALL_ITEM, c.value);
    const p = matchPurchase(c.text);
    if (p) add(p.id, c.value);
  }
  const rows: DailyRow[] = [];
  for (const [item, values] of groups) {
    const s = summarise(values);
    if (!s || s.count < 5) continue;
    rows.push({ area: "ALL", item, n: s.count, median: s.median, low: s.low, high: s.high, min: s.min, max: s.max });
  }
  return rows.sort((a, b) => a.item.localeCompare(b.item));
}

export async function chicagoHarvest(now: Date = new Date(), fetcher?: (url: string) => Promise<unknown>): Promise<HarvestResult> {
  const to = now.toISOString().slice(0, 10);
  const from = windowStart(to);
  let got;
  try {
    got = await socrataAll(
      DOMAIN,
      DATASET,
      {
        select: ["approval_date", "award_amount", "purchase_order_description", "revision_number"],
        where: `revision_number = '0' AND approval_date >= '${from}T00:00:00' AND approval_date <= '${to}T23:59:59'`,
        order: ["approval_date DESC", ":id"],
      },
      { maxRows: 50000, pageSize: 5000, timeoutMs: 60000, ...(fetcher ? { fetcher } : {}) },
    );
  } catch (err: any) {
    if (err instanceof SourceError) throw err;
    throw new SourceError("Could not read the City of Chicago contracts dataset", String(err?.message ?? err));
  }
  if (!got.rows.length) throw new SourceError("The City of Chicago contracts dataset returned no awards for the window");
  const contracts = contractsFromRows(got.rows);
  const rows = aggregate(contracts, from, to);
  return { date: to, currency: "USD", unit: UNIT, rows, note: `Awards approved ${from} to ${to}; ${contracts.length} usable awards read${got.truncated ? " (row cap reached)" : ""}.` };
}

export interface ChiInput { what: string; cpv?: string; buyer_area?: string; baseUrl?: string }

export const SUPPORTED_EXAMPLES = ["all", "consultancy", "legal services", "IT services", "software", "office cleaning", "security guards"];

export async function chicagoContracts(input: ChiInput): Promise<PriceAnswer> {
  if (input.cpv) throw new InputError("Chicago: cpv is not used. Leave it out and say what was bought in words.");
  const w = input.what.trim().toLowerCase();
  const isAll = ["all", "any", "everything", "city contracts", "all contracts"].includes(w);
  const p = isAll ? null : matchPurchase(input.what);
  if (!isAll && !p) {
    throw new InputError(
      `Chicago: "${input.what}" is not one of the purchases we summarise from the city's awards. Try what=all or a common purchase such as ${SUPPORTED_EXAMPLES.join(", ")} (${PURCHASES.length} purchases are recognised).`,
    );
  }
  const item = isAll ? ALL_ITEM : p!.id;
  const label = isAll ? "all" : p!.label;
  const day = readLatestDay(INFO.id);
  if (!day) throw new SourceError("City of Chicago contract figures have not been collected yet; the daily collector fills them. Try again tomorrow.");
  const from = windowStart(day.date);
  const row = day.rows.find((r) => r.area === "ALL" && r.item === item);
  const summary = row ? { count: row.n, median: row.median, low: row.low, high: row.high, min: row.min, max: row.max } : null;
  return buildAnswer({
    source: INFO,
    query: { country: "US", buyer_area: "Chicago", what: input.what },
    summary,
    currency: "USD",
    unit: UNIT,
    period: { from, to: day.date },
    method:
      `City of Chicago contract awards (original awards of US$1,000 or more) approved ${from} to ${day.date}${isAll ? "" : `, recognised by words in the description (${label})`}. ` +
      "Median and 10th–90th percentile of the awarded value in USD. Totals per contract, not unit prices; vendors are never named.",
    describe: (s) =>
      `The City of Chicago awarded ${isAll ? "contracts" : `${label} contracts`} with a median total value of ${fmtMoney(s.median, "USD")} per contract ` +
      `(typical range ${fmtMoney(s.low, "USD")} to ${fmtMoney(s.high, "USD")}, 10th to 90th percentile). These are awarded contract values, not market prices or unit prices.`,
    baseUrl: input.baseUrl,
    extra: { value_basis: "total awarded contract value, not a unit price", matched_purchase: item, newest_collection: day.date },
  });
}
