// Answer quality rules that hold for every source (lib/answer.ts): a single published figure is never a "thin" range, the
// closing words say what the figure really is, data_as_of is never in the future, figures carry no floating-point leftovers,
// an index has one currency spelling, typical_low/high are percentiles only, and old data is not "high" confidence.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import {
  ageAdjustedConfidence, buildAnswer, buildStatisticAnswer, dataAsOfFor, INDEX_CURRENCY, reliabilityOf, roundFigure, statisticEnding,
} from "../lib/answer";
import { SOURCES } from "../lib/registry";
import { summarise } from "../lib/stats";

const stat = (source: string, extra: Partial<Parameters<typeof buildStatisticAnswer>[0]> = {}) =>
  buildStatisticAnswer({
    source: SOURCES[source], query: { country: "XX" }, value: 2.5, measure: "average", currency: "GBP", unit: "per kg",
    period: { from: "2026-10-01", to: "2026-10-01" }, reference_period: "2026-10-01", method: "m", describe: (v) => `Price ${v}.`, ...extra,
  });

test("a single published figure (posted, listed or official) is never 'thin', and never says 'few records'", () => {
  for (const id of ["gb-defra-wholesale", "hk-afcd-wholesale", "tw-fuel", "eu-tuition-fees", "ie-rtb-rents"]) {
    const a = stat(id);
    assert.equal(a.status, "ok", id);
    assert.equal(a.reliability, "official_median_no_count", id);
    assert.ok(!a.suggestions!.some((s) => /Few records/.test(s)), id);
  }
  assert.equal(stat("gb-defra-wholesale", { sample_size: 12 }).reliability, "official_with_count");
  // a range from few records is still thin
  assert.equal(reliabilityOf({ status: "ok", price: {} as any, sample_size: 8, price_type: "transaction" }), "thin");
});

test("the closing words follow what the figure is: official average, index value, or a neutral 'Published by'", () => {
  assert.match(stat("ie-rtb-rents").summary, /Official average published by/);
  const posted = stat("gb-defra-wholesale").summary;
  assert.doesNotMatch(posted, /Official average/);
  assert.match(posted, /Published by .* for 2026-10-01\.$/);
  const idx = stat("oecd-price-levels", { currency: "INDEX", unit: "index (OECD = 100)", value: 119.4 });
  assert.match(idx.summary, /Official index value published by/);
  assert.equal(idx.evidence!.label, "Official published index");
  assert.match(idx.evidence!.meaning, /not a price anyone paid/);
  assert.equal(statisticEnding(SOURCES["ie-rtb-rents"], "median", "EUR", "2025"), `Official median published by ${SOURCES["ie-rtb-rents"].publisher} for 2025.`);
  const custom = stat("gb-defra-wholesale", { ending: "Worked out by ProofPrice.", evidence: { label: "L", meaning: "M" } });
  assert.match(custom.summary, /Worked out by ProofPrice\.$/);
  assert.deepEqual(custom.evidence, { type: "posted_price", label: "L", meaning: "M" });
  assert.equal(stat("gb-defra-wholesale").evidence!.label, "Posted or listed price");
});

test("data_as_of is never after the day the answer is made", () => {
  const now = "2026-10-21T09:00:00.000Z";
  assert.equal(dataAsOfFor({ period: { from: "2026-01-01", to: "2026-12-31" } }, now), "2026-10-21");
  assert.equal(dataAsOfFor({ period: { from: "2026-01-01", to: "2026-12-31" } }, now, "2026-10-01T08:00:00+0200"), "2026-10-01");
  assert.equal(dataAsOfFor({ period: { from: "2026-10", to: "2026-10" } }, now), "2026-10-21");
  assert.equal(dataAsOfFor({ period: { from: "2026-10-22", to: "2026-10-22" } }, now), "2026-10-21");
  assert.equal(dataAsOfFor({ period: { from: "2025-01-01", to: "2025-12-31" } }, now), "2025-12-31");
  assert.equal(dataAsOfFor({ period: { from: null, to: null }, statistic: { measure: "average", reference_period: "2024" } }, now), "2024-12-31");
  const today = new Date().toISOString().slice(0, 10);
  const year = new Date().getUTCFullYear();
  const live = stat("ie-rtb-rents", { period: { from: `${year}-01-01`, to: `${year + 1}-12-31` }, reference_period: String(year + 1) });
  assert.ok(live.data_as_of! <= today);
  assert.equal(live.data_age_days, 0);
  const month = new Date().toISOString().slice(0, 7);
  const rec = buildAnswer({
    source: SOURCES["sg-hdb-resale"], query: {}, summary: summarise([1, 2, 3, 4, 5, 6]), currency: "SGD", unit: "per flat",
    period: { from: month, to: month }, method: "m", describe: () => "x",
  });
  assert.equal(rec.data_as_of, today);
});

test("figures carry no floating-point leftovers; per-unit prices keep their published decimals", () => {
  assert.equal(roundFigure(2503.06005859375), 2503.06);
  assert.equal(roundFigure(1.79469), 1.79469);
  assert.equal(roundFigure(0.02792), 0.02792);
  assert.equal(roundFigure(0.1 + 0.2), 0.3);
  const a = stat("sg-moh-bills", { value: 2503.06005859375, low: 1800.123456, high: 3900.98765, currency: "SGD", unit: "per bill" });
  assert.equal(a.price!.value, 2503.06);
  assert.equal(a.price!.typical_low, 1800.12);
  assert.equal(a.price!.typical_high, 3900.99);
  assert.match(a.summary, /^Price 2503\.06\./);
});

test("an index has one currency spelling: INDEX", () => {
  assert.equal(INDEX_CURRENCY, "INDEX");
  for (const dir of readdirSync("sources")) {
    const f = `sources/${dir}/source.ts`;
    if (!existsSync(f)) continue;
    assert.doesNotMatch(readFileSync(f, "utf8"), /currency:\s*"(?!INDEX")[iI][nN][dD][eE][xX]"/, f);
  }
});

test("min and max go to min/max; typical_low/high are left for percentiles", () => {
  const a = stat("gb-defra-wholesale", { min: 1.2, max: 3.4 });
  assert.equal(a.price!.min, 1.2);
  assert.equal(a.price!.max, 3.4);
  assert.equal(a.price!.typical_low, null);
  assert.equal(a.price!.typical_high, null);
});

test("data more than five years old is at most 'low' confidence", () => {
  const now = "2026-10-21T00:00:00Z";
  assert.equal(ageAdjustedConfidence("high", "2016-12-31", now), "low");
  assert.equal(ageAdjustedConfidence("medium", "2020-12-31", now), "low");
  assert.equal(ageAdjustedConfidence("high", "2022-12-31", now), "high");
  assert.equal(ageAdjustedConfidence("insufficient", "2010-12-31", now), "insufficient");
  assert.equal(stat("ie-childcare-fees", { period: { from: "2016-01-01", to: "2016-12-31" }, reference_period: "2016" }).confidence, "low");
  assert.equal(stat("ie-rtb-rents").confidence, "high");
});
