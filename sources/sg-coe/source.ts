// Singapore Certificate of Entitlement (COE) bidding results from data.gov.sg (Land Transport Authority).

import { fetchJson, SourceError } from "../../lib/http";
import { summarise } from "../../lib/stats";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import type { SourceInfo } from "../../lib/plugin";

export const INFO: SourceInfo = {
  id: "sg-coe",
  country: "SG",
  category: "cars (Certificate of Entitlement)",
  name: "COE bidding results and prices",
  publisher: "Land Transport Authority via data.gov.sg",
  what_is_recorded:
    "Result of each COE bidding exercise by vehicle category: quota, successful bids, bids received and the premium (the price every successful bidder paid).",
  price_type: "transaction",
  freshness: "Two bidding rounds a month; updated after each round",
  licence: "Singapore Open Data Licence v1.0",
  licence_url: "https://data.gov.sg/open-data-licence",
  attribution:
    "Contains information from COE Bidding Results and Prices accessed from data.gov.sg, made available under the terms of the Singapore Open Data Licence version 1.0.",
  homepage: "https://data.gov.sg/datasets/d_69b3380ad7e51aff3a7dcc84eba52b8a/view",
  limits:
    "The COE is the legal right to own a car in Singapore for 10 years, not the car itself. One premium per bidding round and category; all successful bidders pay the same premium. Ranges are taken across bidding rounds over time (sample size = number of rounds), not across individual buyers.",
};

const RESOURCE_ID = "d_69b3380ad7e51aff3a7dcc84eba52b8a";
const ENDPOINT = "https://data.gov.sg/api/action/datastore_search";

export const COE_CLASSES = ["A", "B", "C", "D", "E"] as const;
export const COE_CLASS_HELP: Record<string, string> = {
  A: "Cars up to 1600cc",
  B: "Cars above 1600cc",
  C: "Goods vehicles and buses",
  D: "Motorcycles",
  E: "Open category (any vehicle)",
};

export interface CoeRound {
  month: string; // YYYY-MM
  round: number;
  cls: string; // A-E
  quota: number;
  bidsSuccess: number;
  bidsReceived: number;
  premium: number;
}

export function buildCoeUrl(cls: string, limit = 1000): string {
  const params = new URLSearchParams({
    resource_id: RESOURCE_ID,
    filters: JSON.stringify({ vehicle_class: `Category ${cls}` }),
    sort: "_id desc",
    limit: String(limit),
  });
  return `${ENDPOINT}?${params.toString()}`;
}

export function parseCoeRecords(json: any): CoeRound[] {
  const recs = json?.result?.records;
  if (!json?.success || !Array.isArray(recs)) throw new SourceError("Unexpected response from data.gov.sg");
  return recs
    .map((r: any) => ({
      month: String(r.month),
      round: Number(r.bidding_no),
      cls: String(r.vehicle_class ?? "").replace(/^Category\s+/i, "").trim().toUpperCase(),
      quota: Number(r.quota),
      bidsSuccess: Number(r.bids_success),
      bidsReceived: Number(r.bids_received),
      premium: Number(r.premium),
    }))
    .filter((r) => /^\d{4}-\d{2}$/.test(r.month) && Number.isFinite(r.premium) && r.premium > 0);
}

export function normaliseClass(v?: string): string {
  const c = (v ?? "A").trim().toUpperCase().replace(/^CATEGORY\s+/, "");
  if (!(COE_CLASSES as readonly string[]).includes(c)) throw new SourceError("vehicle_class must be one of A, B, C, D, E.");
  return c;
}

/** First month of the window: `months` calendar months ending with the current month (the start month itself is excluded). */
export function coeCutoffMonth(months: number, now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 7); // rounds in this month are excluded: window = (cutoff, current month]
}

/** The answer from parsed rounds (pure). Rounds outside the class or window are ignored. */
export function coeAnswer(all: CoeRound[], cls: string, months: number, now = new Date(), baseUrl?: string): PriceAnswer {
  const cutoff = coeCutoffMonth(months, now);
  const rows = all
    .filter((r) => r.cls === cls && r.month > cutoff)
    .sort((a, b) => (a.month < b.month ? 1 : a.month > b.month ? -1 : b.round - a.round)); // newest round first
  const ms = rows.map((r) => r.month).sort();
  const s = summarise(rows.map((r) => r.premium));
  const bids = rows.reduce((a, r) => a + (Number.isFinite(r.bidsSuccess) ? r.bidsSuccess : 0), 0);
  const latest = rows[0];
  return buildAnswer({
    source: INFO,
    query: { country: "SG", product: "coe", vehicle_class: cls, months },
    summary: s,
    currency: "SGD",
    unit: "per COE (10-year right to own a vehicle; vehicle not included)",
    period: { from: ms[0] ?? null, to: ms[ms.length - 1] ?? null },
    method:
      "One clearing premium per bidding round (every successful bidder in that round pays it). The median and 10th–90th percentile are taken across the rounds in the period, " +
      "so the range shows how the premium moved from round to round over time, not a spread of prices paid by different buyers in one round. " +
      "Sample size counts bidding rounds; extra.successful_bids counts the winning bids; extra.latest_premium is the most recent round.",
    describe: (x) =>
      `COE Category ${cls} (${COE_CLASS_HELP[cls]}) in Singapore: the latest bidding round (${latest.month} round ${latest.round}) cleared at ${fmtMoney(latest.premium, "SGD")}, the premium every successful bidder in that round paid. ` +
      `Across the ${rows.length} bidding rounds in the period the premium had a median of ${fmtMoney(x.median, "SGD")} and a 10th–90th percentile range of ${fmtMoney(x.low, "SGD")}–${fmtMoney(x.high, "SGD")} ` +
      "(a range over rounds through time, not between buyers; the COE is the right to own a vehicle for 10 years, not the vehicle).",
    baseUrl,
    extra: {
      successful_bids: bids,
      latest_premium: latest?.premium ?? null,
      latest_round: latest ? `${latest.month} round ${latest.round}` : null,
      sample_unit: "bidding rounds (one clearing premium each)",
    },
  });
}

export async function sgCoe(input: { vehicle_class?: string; months?: number; baseUrl?: string }): Promise<PriceAnswer> {
  const cls = normaliseClass(input.vehicle_class);
  const months = Math.max(1, Math.min(60, Math.round(input.months ?? 12)));
  const json = await fetchJson(buildCoeUrl(cls), {}, 20000);
  return coeAnswer(parseCoeRecords(json), cls, months, new Date(), input.baseUrl);
}
