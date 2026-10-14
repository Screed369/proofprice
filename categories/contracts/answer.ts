// One answer shape for every government-contracts source: the median awarded value per contract, a 10th–90th percentile range,
// the number of awards, and a plain statement that these are TOTAL contract values, not unit prices. Never a supplier name.
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import type { SourceInfo } from "../../lib/plugin";
import { summarise } from "../../lib/stats";
import { daysSince } from "./purchases";

export interface UnitPrice {
  unit: string;
  currency: string;
  median: number;
  typical_low: number;
  typical_high: number;
  sample_size: number;
}

export interface ContractAnswerInput {
  source: SourceInfo;
  query: Record<string, unknown>;
  /** Awarded value of each contract (lot) in `currency`. */
  values: number[];
  currency: string;
  /** What was bought, for the sentence ("laptops"). */
  what: string;
  /** Where the buyers are, for the sentence ("France"). */
  where: string;
  period: { from: string; to: string };
  /** Date of the newest award notice used (YYYY-MM-DD), to flag old data. */
  newest?: string | null;
  /** The part of the method that is specific to this source. */
  method: string;
  unitPrice?: UnitPrice | null;
  /** Extra caveat sentences appended to the summary. */
  notes?: string[];
  baseUrl?: string;
  extra?: Record<string, unknown>;
}

export const VALUE_BASIS = "total awarded value per contract (lot), not a unit price";

export function contractAnswer(i: ContractAnswerInput): PriceAnswer {
  const summary = summarise(i.values);
  const answer = buildAnswer({
    source: i.source,
    query: i.query,
    summary,
    currency: i.currency,
    unit: "per contract (lot), total awarded value",
    period: i.period,
    method: i.method,
    describe: (s) =>
      `Public buyers in ${i.where} awarded ${i.what} contracts with a median total value of ${fmtMoney(s.median, i.currency)} per contract ` +
      `(typical range ${fmtMoney(s.low, i.currency)} to ${fmtMoney(s.high, i.currency)}, 10th to 90th percentile). ` +
      `These are totals per contract (lot), not unit prices` +
      (i.unitPrice
        ? `; where notices also state a quantity, the median works out at ${fmtMoney(i.unitPrice.median, i.unitPrice.currency)} ${i.unitPrice.unit} (${i.unitPrice.sample_size} contracts).`
        : "."),
    baseUrl: i.baseUrl,
    extra: {
      value_basis: VALUE_BASIS,
      ...(i.unitPrice ? { unit_price: i.unitPrice } : {}),
      ...(i.newest ? { newest_award_used: i.newest } : {}),
      ...(i.extra ?? {}),
    },
  });
  const tail: string[] = [];
  if (i.newest && daysSince(i.newest) > 180) {
    tail.push(`Note: the newest matching award is from ${i.newest}, more than six months ago, so this may not reflect today's prices.`);
  } else if (i.newest) {
    tail.push(`Newest award used: ${i.newest}.`);
  }
  tail.push(...(i.notes ?? []));
  if (tail.length) answer.summary = `${answer.summary} ${tail.join(" ")}`;
  return answer;
}

/** Median unit price from (value, quantity, unit) triples, for one unit with at least `min` contracts. Null when the notices rarely state a quantity. */
export function unitPriceFrom(
  rows: { value: number; quantity: number; unit: string }[],
  currency: string,
  min = 5,
): UnitPrice | null {
  const byUnit = new Map<string, number[]>();
  for (const r of rows) {
    if (!(r.value > 0) || !(r.quantity > 0) || !r.unit) continue;
    const list = byUnit.get(r.unit) ?? [];
    list.push(r.value / r.quantity);
    byUnit.set(r.unit, list);
  }
  let best: { unit: string; list: number[] } | null = null;
  for (const [unit, list] of byUnit) if (list.length >= min && (!best || list.length > best.list.length)) best = { unit, list };
  if (!best) return null;
  const s = summarise(best.list);
  if (!s || s.count < min) return null;
  return { unit: `per ${best.unit}`, currency, median: s.median, typical_low: s.low, typical_high: s.high, sample_size: s.count };
}
