// Negotiation evidence on the price check (Jarvis order step 1). No network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAnswer, buildStatisticAnswer } from "../lib/answer";
import type { PriceAnswer } from "../lib/answer";
import { judge, runCheck, splitCheckArgs } from "../lib/check";
import { parseStance } from "../lib/negotiation";
import { CATEGORIES, SOURCES } from "../lib/registry";
import { checkResultSchema } from "../lib/schemas";
import { summarise } from "../lib/stats";

const TODAY = new Date("2026-10-14T12:00:00Z");

function sales(): PriceAnswer {
  const prices = Array.from({ length: 30 }, (_, i) => 300000 + i * 10000);
  return buildAnswer({
    source: SOURCES["gb-hmlr-ppd"],
    query: { country: "GB", town: "Bristol", property_type: "terraced" },
    summary: summarise(prices),
    currency: "GBP",
    unit: "per home",
    period: { from: "2026-04-01", to: "2026-09-30" },
    method: "m",
    describe: (s) => `Median ${s.median}.`,
  });
}

function rent(): PriceAnswer {
  return buildStatisticAnswer({
    source: SOURCES["ie-rtb-rents"],
    query: { country: "IE", town: "Dublin" },
    value: 2165,
    measure: "average",
    currency: "EUR",
    unit: "per month",
    period: { from: "2026-04-01", to: "2026-06-30" },
    reference_period: "2026-Q2",
    method: "m",
    describe: () => "avg",
  });
}

const base = { category: "home-sales", country: "GB", price: 700000 };

test("no negotiate option: no negotiation block (answer unchanged)", () => {
  const r = judge(sales(), base, TODAY);
  assert.equal("negotiation" in r, false);
  assert.ok(checkResultSchema.safeParse(r).success);
});

test("buyer, price above the 90th percentile: strong leverage, points and quotable sentences", () => {
  const r = judge(sales(), { ...base, negotiate: "buyer" }, TODAY);
  const n = r.negotiation!;
  assert.equal(n.stance, "buyer");
  assert.equal(n.leverage, "strong");
  assert.equal(n.points.length, 3);
  assert.ok(n.gap_to_median! > 0);
  assert.match(n.talking_points.join(" "), /90th percentile/);
  assert.match(n.talking_points[0], /Source:/);
  assert.ok(checkResultSchema.safeParse(r).success);
});

test("seller with a high price: no leverage for the seller's argument against the buyer's", () => {
  const r = judge(sales(), { ...base, negotiate: "seller" }, TODAY);
  assert.equal(r.negotiation!.leverage, "none");
});

test("seller, price below the 10th percentile: strong", () => {
  const r = judge(sales(), { ...base, price: 250000, negotiate: "seller" }, TODAY);
  assert.equal(r.negotiation!.leverage, "strong");
});

test("buyer, price inside the range but above the median: some", () => {
  const r = judge(sales(), { ...base, price: 500000, negotiate: "buyer" }, TODAY);
  assert.equal(r.negotiation!.leverage, "some");
});

test("official average: one point, says it is an average, within 5% is no leverage", () => {
  const near = judge(rent(), { category: "rent", country: "IE", price: 2200, negotiate: "buyer" }, TODAY);
  assert.equal(near.negotiation!.points.length, 1);
  assert.equal(near.negotiation!.leverage, "some");
  const high = judge(rent(), { category: "rent", country: "IE", price: 2600, negotiate: "buyer" }, TODAY);
  assert.equal(high.negotiation!.leverage, "strong");
  assert.ok(high.negotiation!.cautions.some((c) => /official average or median/.test(c)));
});

test("cannot_judge: negotiation is null, no invented figure", () => {
  const r = judge(sales(), { ...base, currency: "EUR", negotiate: "buyer" }, TODAY);
  assert.equal(r.verdict, "cannot_judge");
  assert.equal(r.negotiation, null);
});

test("parseStance and the argument split", () => {
  assert.equal(parseStance("Tenant"), "buyer");
  assert.equal(parseStance("landlord"), "seller");
  assert.equal(parseStance(""), null);
  const { fixed, params } = splitCheckArgs({ category: "rent", price: 1, negotiate: "buyer", country: "IE" });
  assert.equal(fixed.negotiate, "buyer");
  assert.equal("negotiate" in params, false);
});

test("runCheck rejects a bad negotiate value with a plain message", async () => {
  const deps = { categories: CATEGORIES, runCategory: async () => sales() };
  await assert.rejects(runCheck({ category: "home-sales", country: "GB", town: "Bristol", price: 1, negotiate: "banana" }, deps), /negotiate must be/);
  const ok = await runCheck({ category: "home-sales", country: "GB", town: "Bristol", price: 700000, negotiate: "buyer" }, deps, {}, TODAY);
  assert.equal(ok.negotiation!.stance, "buyer");
});
