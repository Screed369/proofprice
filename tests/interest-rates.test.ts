// The interest-rates category as a whole: what it accepts, what it never accepts, how it stays out of the price-check verdict,
// and that a published rate is never rounded or changed anywhere.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const dir = mkdtempSync(path.join(tmpdir(), "pp-ir-"));
process.env.PROOFPRICE_LIBRARY_DIR = dir;
import { buildStatisticAnswer, fmtMoney, noticeFor, NOTICE, RATE_CURRENCY, RATE_NOTICE, RATE_UNIT, roundFigure, evidenceFor, statisticEnding } from "../lib/answer";
import { checkToolDescription, checkToolShape, resolveCategory, runCheck } from "../lib/check";
import { normaliseCountry } from "../lib/countries";
import { InputError } from "../lib/http";
import { dataCheck } from "../lib/library/check";
import { writeDaily, writeMeta } from "../lib/library/store";
import { CATEGORIES, SOURCE_PLUGINS, assertKnownParams, categoryById, paramSchemas, pickSource, toolDescription, toolShape, unknownParams } from "../lib/registry";
import { staleAnswer } from "../lib/stale";
import { SourceError } from "../lib/http";

const cat = categoryById("interest-rates")!;

test("the category: tool name, REST path, three sources, and a country list that includes the euro area", () => {
  assert.ok(cat);
  assert.equal(cat.tool, "pricepaid_interest_rates");
  assert.equal(cat.restPath, "interest-rates");
  const ids = SOURCE_PLUGINS.filter((s) => s.category === "interest-rates").map((s) => s.info.id).sort();
  assert.deepEqual(ids, ["ca-boc-rates", "eu-ecb-mir", "gb-boe-rates"]);
  for (const c of ["EA", "IE", "ES", "FR", "DE", "IT", "NL", "PT", "GB", "CA"]) assert.ok(pickSource(cat, { country: c }).src, c);
  assert.equal(normaliseCountry("euro area"), "EA");
  assert.equal(normaliseCountry("Eurozone"), "EA");
});

test("the tool takes ONLY country, product, term and months: no income, age or other personal detail", () => {
  assert.deepEqual(Object.keys(paramSchemas(cat)).sort(), ["months", "product", "term"]);
  assert.deepEqual(Object.keys(toolShape(cat)).sort(), ["country", "months", "product", "term"]);
  // REST: a personal detail is refused with a 400 that lists the valid names, never silently ignored
  assert.deepEqual(unknownParams(cat, { country: "IE", income: 80000 }), ["income"]);
  assert.throws(() => assertKnownParams(cat, { country: "IE", age: 34 }), /Unknown parameter "age" for \/api\/v1\/interest-rates\. Valid parameters: country, product, term, months/);
  // even if a caller got it through, the category drops it before any source sees it
  assert.deepEqual(pickSource(cat, { country: "IE", product: "mortgage", income: 80000, age: 34, salary: 1 }).prepared, { country: "IE", product: "mortgage" });
  assert.ok(!/income|salary|\bage\b|credit score/i.test(JSON.stringify(Object.values(toolShape(cat)).map((s: any) => s.description))));
});

test("the description says what it is and what it is not", () => {
  const d = toolDescription(cat);
  assert.match(d, /^Use this when/);
  assert.match(d, /official average agreed rate on new loans/);
  assert.match(d, /% a year/);
  assert.match(d, /Do not use for a rate to quote or offer to a person, advice on which loan or lender to choose, whether a rate is fair/);
  assert.match(d, /anything that depends on income, age or other personal details/);
  assert.ok(d.length < 3500, `description is ${d.length} characters`);
});

test("the price-check verdict refuses interest rates with a plain explanation, and no longer lists them", async () => {
  assert.equal(cat.noPriceCheck?.includes("read as financial advice"), true);
  const deps = { categories: CATEGORIES, runCategory: async () => { throw new Error("must not run"); } } as any;
  for (const category of ["interest-rates", "pricepaid_interest_rates", "/api/v1/interest-rates"]) {
    await assert.rejects(runCheck({ category, country: "IE", price: 3.5 }, deps), (e: any) => {
      assert.ok(e instanceof InputError);
      assert.match(e.message, /The price check does not judge interest rates\. A verdict on whether a rate is fair or good would read as financial advice, and ProofPrice is not a lender, broker or insurer\./);
      return true;
    });
  }
  assert.throws(() => resolveCategory(CATEGORIES, "interest-rates"), InputError);
  assert.doesNotMatch(checkToolDescription(CATEGORIES), /interest-rates/);
  assert.ok(!("product" in checkToolShape(CATEGORIES)) || !/interest-rates/.test(String((checkToolShape(CATEGORIES) as any).product?.description)));
  assert.doesNotMatch(String((checkToolShape(CATEGORIES) as any).category.description), /interest-rates/);
  assert.equal(CATEGORIES.filter((c) => c.noPriceCheck).length, 1);
  // an unknown category still gets the normal message, which does not list the refused one
  assert.throws(() => resolveCategory(CATEGORIES, "nope"), (e: any) => !/interest-rates/.test(e.message) && /category is required/.test(e.message));
});

test("a published rate is never rounded or changed: every precision the ECB, the Bank of England and the Bank of Canada use comes back identical", () => {
  const src = SOURCE_PLUGINS.find((s) => s.info.id === "eu-ecb-mir")!.info;
  for (const v of [0, 0.01, 0.1, 0.29, 1.28, 2.18, 3.45, 3.5063, 3.51, 4.4, 7.92, 9.96, 12.3456, 21.28, 99.9999, 0.0001]) {
    const a = buildStatisticAnswer({ source: src, query: {}, value: v, measure: "average", currency: RATE_CURRENCY, unit: RATE_UNIT, period: { from: "2026-08-01", to: "2026-08-31" }, reference_period: "2026-08", method: "m", describe: (x) => `${x}` });
    assert.equal(a.status, "ok", String(v));
    assert.equal(a.price?.value, v, `${v} must come back unchanged`);
    assert.equal(a.price?.median, null);
    assert.equal(a.sample_size, null);
    assert.equal(a.notice, RATE_NOTICE);
  }
  // a figure above 100 would be rounded to 2 decimals as money; as a rate it is still passed on as published
  const big = buildStatisticAnswer({ source: src, query: {}, value: 123.4567, measure: "average", currency: RATE_CURRENCY, unit: RATE_UNIT, period: { from: null, to: null }, reference_period: "2026-08", method: "m", describe: (x) => `${x}` });
  assert.equal(big.price?.value, 123.4567);
  assert.equal(roundFigure(123.4567), 123.46); // money keeps its rule
  // the same figure in any other currency keeps the money rules and the ordinary notice
  const money = buildStatisticAnswer({ source: src, query: {}, value: 2503.06005859375, measure: "average", currency: "EUR", unit: "per month", period: { from: null, to: null }, reference_period: "2026-08", method: "m", describe: () => "x" });
  assert.equal(money.price?.value, 2503.06);
  assert.equal(money.notice, NOTICE);
});

test("the rate marker follows the INDEX pattern: its own evidence, ending, notice and formatting", () => {
  assert.equal(RATE_CURRENCY, "PERCENT");
  assert.equal(RATE_UNIT, "% a year");
  assert.equal(noticeFor("percent"), RATE_NOTICE);
  assert.equal(noticeFor("EUR"), NOTICE);
  assert.equal(evidenceFor("official_statistic", "average", "PERCENT").label, "Official average rate on new business");
  assert.equal(fmtMoney(3.45, "PERCENT"), "3.45%");
  assert.equal(fmtMoney(1500, "EUR"), "€1,500");
  const info = SOURCE_PLUGINS.find((s) => s.info.id === "gb-boe-rates")!.info;
  assert.equal(statisticEnding(info, "average", "PERCENT", "2026-08"), "Official average rate published by Bank of England for 2026-08.");
  // no other file spells the marker another way
  for (const f of readdirSync("sources", { recursive: true, encoding: "utf8" }).filter((x) => /rates?.*\.ts$/.test(x) && !x.endsWith(".test.ts"))) {
    assert.doesNotMatch(readFileSync(path.join("sources", f), "utf8"), /currency:\s*"(?!PERCENT")(?:PERCENT|percent|PCT|RATE)"/i, f);
  }
});

test("the data checker does not hold back a rate for moving more than 3x, but still stops a change of unit", () => {
  const rows = [{ area: "EA", item: "dep-night/total", n: 5, median: 0.4, low: 0.4, high: 0.4, min: 0.4, max: 0.4 }];
  const previous = new Map([[`EA\u0000dep-night/total`, { date: "2026-07-31", ...rows[0], median: 0.1 }]]);
  const rate = dataCheck({ result: { date: "2026-08-31", currency: "PERCENT", unit: "% a year", rows }, prevMeta: { source: "x", currency: "PERCENT", unit: "% a year" } as any, previous });
  assert.equal(rate.held.length, 0);
  const money = dataCheck({ result: { date: "2026-08-31", currency: "EUR", unit: "per litre", rows }, prevMeta: { source: "x", currency: "EUR", unit: "per litre" } as any, previous });
  assert.equal(money.held.length, 1);
  const unit = dataCheck({ result: { date: "2026-08-31", currency: "PERCENT", unit: "basis points", rows }, prevMeta: { source: "x", currency: "PERCENT", unit: "% a year" } as any, previous });
  assert.ok(unit.unitChange);
});

test("stale-if-error: the copy is still an official average (not a median), with the reference month and the rate notice", () => {
  const src = SOURCE_PLUGINS.find((s) => s.info.id === "eu-ecb-mir")!;
  const row = { area: "IE", item: "mortgage/total", n: 5, median: 3.45, low: 3.45, high: 3.45, min: 3.45, max: 3.45 };
  writeDaily(src.info.id, { date: "2026-08-31", currency: "PERCENT", unit: "% a year", rows: [row] });
  writeMeta(src.info.id, { source: src.info.id, currency: "PERCENT", unit: "% a year", first_date: "2026-08-31", last_date: "2026-08-31", days: 1, last_harvest_at: null, last_rows: 1, last_ok_at: "2026-10-21T03:17:00Z", last_error: null });
  const params = pickSource(cat, { country: "IE", product: "mortgage" }).prepared;
  const a = staleAnswer({ cat, src, params, query: params, error: new SourceError("Source timed out"), today: new Date("2026-10-22T09:00:00Z") })!;
  assert.ok(a, "the library copy should stand in");
  assert.equal(a.status, "ok");
  assert.equal(a.price?.value, 3.45);
  assert.equal(a.price?.currency, "PERCENT");
  assert.equal(a.price?.measure, "average");
  assert.equal(a.price?.median, null);
  assert.equal(a.price?.typical_low, null);
  assert.equal(a.sample_size, null);
  assert.equal(a.statistic?.reference_period, "2026-08");
  assert.equal(a.extra?.stale, true);
  assert.match(a.summary, /official average rate 3\.45 % a year for 2026-08/);
  assert.doesNotMatch(a.summary, /Confidence|median|records/);
  assert.ok(a.notice.endsWith(RATE_NOTICE));
});

test("the tool-name allow-list on this branch names the category and why", () => {
  const approved = JSON.parse(readFileSync("categories/APPROVED.json", "utf8"));
  assert.equal(approved["interest-rates"], "approved by Simon 21 Oct 2026 for publication when the council gate is met");
});
