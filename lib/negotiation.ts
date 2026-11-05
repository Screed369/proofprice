// Negotiation evidence for a price check (Jarvis order, step 1, 5 Nov 2026). Opt-in: `negotiate=buyer|seller` on the price check.
// Pure and deterministic. It only restates the evidence the check already holds (median, 10th and 90th percentile or one
// official average) as numbers an agent can quote across the table. It never invents a benchmark, never converts, and never
// tells anyone what to offer: the points are evidence, not advice.

import type { PriceAnswer } from "./answer";
import { fmtMoney } from "./answer";
import type { CheckPosition } from "./check";

export type Stance = "buyer" | "seller";

export interface NegotiationPoint {
  label: string;
  value: number;
  /** Percent difference of the asked price from this point (positive = the asked price is above it). */
  asked_vs_point_percent: number;
}

export interface Negotiation {
  stance: Stance;
  /** none = the evidence gives this side no argument; some = the price is beyond the median against this side; strong = beyond the typical range. */
  leverage: "none" | "some" | "strong";
  asked_price: number;
  gap_to_median: number | null;
  gap_to_median_percent: number | null;
  points: NegotiationPoint[];
  talking_points: string[];
  cautions: string[];
}

export function parseStance(raw: unknown): Stance | null {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return null;
  if (s === "buyer" || s === "buy" || s === "tenant" || s === "renter") return "buyer";
  if (s === "seller" || s === "sell" || s === "landlord" || s === "owner") return "seller";
  return null;
}

const r1 = (x: number) => Math.round(x * 10) / 10;
const pct = (price: number, ref: number) => ((price - ref) / ref) * 100;

/** Build the negotiation block, or null when the check could not judge (no evidence, nothing to quote). */
export function buildNegotiation(
  stance: Stance,
  price: number,
  position: CheckPosition | null,
  answer: PriceAnswer,
  sourceLine: string,
): Negotiation | null {
  if (!position || !answer.price) return null;
  const cur = answer.price.currency;
  const unit = answer.price.unit;
  const m = (v: number) => `${fmtMoney(v, cur)} ${unit}`;
  const points: NegotiationPoint[] = [];
  const add = (label: string, v: number | null | undefined) => {
    if (typeof v === "number" && Number.isFinite(v) && v > 0) points.push({ label, value: v, asked_vs_point_percent: r1(pct(price, v)) });
  };

  const isRange = position.basis === "range";
  if (isRange) {
    add("10th percentile (lower end of the typical range)", position.typical_low);
    add("median", position.reference_value);
    add("90th percentile (upper end of the typical range)", position.typical_high);
  } else {
    add("official average", position.reference_value);
  }

  const ref = position.reference_value;
  const gap = r1(price - ref);
  const gapPct = r1(pct(price, ref));

  // leverage is on the side of the party the price is against: a high price helps the buyer, a low price helps the seller
  const against = stance === "buyer" ? price > ref : price < ref;
  let leverage: Negotiation["leverage"] = "none";
  if (against) {
    const beyond =
      isRange && typeof position.typical_high === "number" && typeof position.typical_low === "number"
        ? stance === "buyer"
          ? price > position.typical_high
          : price < position.typical_low
        : Math.abs(gapPct) > 5; // an average: beyond the 5% "about average" band
    leverage = beyond ? "strong" : "some";
  }

  const talking: string[] = [];
  const dir = price > ref ? "above" : price < ref ? "below" : "at";
  const meas = isRange ? "median" : "official average";
  if (leverage === "none") {
    talking.push(
      price === ref
        ? `The price is at the ${meas} of ${m(ref)}. ${sourceLine}`
        : `The price is ${dir} the ${meas} of ${m(ref)} (${Math.abs(gapPct)}% ${dir}), which does not favour the ${stance} in this evidence. ${sourceLine}`,
    );
  } else {
    talking.push(
      `The price of ${m(price)} is ${Math.abs(gapPct)}% ${dir} the ${meas} of ${m(ref)} (${m(Math.abs(gap))} ${dir}). ${sourceLine}`,
    );
    if (isRange && typeof position.typical_high === "number" && typeof position.typical_low === "number") {
      if (stance === "buyer" && price > position.typical_high) talking.push(`It is above the 90th percentile of ${m(position.typical_high)}: nine in ten recorded prices were lower.`);
      else if (stance === "seller" && price < position.typical_low) talking.push(`It is below the 10th percentile of ${m(position.typical_low)}: nine in ten recorded prices were higher.`);
      else talking.push(`It is inside the typical range of ${m(position.typical_low)} to ${m(position.typical_high)}, so this is an argument about the median, not about an outlier.`);
    }
  }

  const cautions: string[] = [
    "Evidence, not advice: ProofPrice does not say what to offer or accept.",
    "The comparison is with recorded prices for the area and type asked about; one particular item can differ for reasons the data does not show (condition, extras, timing).",
  ];
  if (answer.price_type === "posted_price" || answer.price_type === "posted_pump_price") cautions.push("The evidence is posted (displayed) prices, not what customers paid; say so when quoting it.");
  if (answer.price_type === "official_statistic") cautions.push("The evidence is one official average or median, not individual prices: the other side can fairly say their item differs.");
  if (answer.confidence === "low") cautions.push("Confidence is low (5 to 14 records): quote the figure with its sample size.");

  return { stance, leverage, asked_price: price, gap_to_median: gap, gap_to_median_percent: gapPct, points, talking_points: talking, cautions };
}
