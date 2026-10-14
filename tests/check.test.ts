// The price referee (lib/check.ts) and the audit trail on every answer (lib/answer.ts). No network: answers are built from fixtures.
import { test } from "node:test";
import assert from "node:assert/strict";
import { answerIdFor, buildAnswer, buildStatisticAnswer, evidenceFor, normaliseQuery } from "../lib/answer";
import type { PriceAnswer } from "../lib/answer";
import { CHECK_TOOL, judge, normUnit, periodEnd, runCheck, sameUnit } from "../lib/check";
import { InputError } from "../lib/http";
import { buildToolSpecs, ToolDeps, LIVE_DEPS } from "../lib/mcp-tools";
import { buildOpenApi, buildLlmsTxt } from "../lib/openapi";
import { buildLlmsFullTxt } from "../lib/open-book";
import { CATEGORIES, SOURCES } from "../lib/registry";
import { checkResultSchema, priceAnswerSchema } from "../lib/schemas";
import { summarise } from "../lib/stats";

const TODAY = new Date("2026-10-14T12:00:00Z");

function sales(n = 30, source = "gb-hmlr-ppd"): PriceAnswer {
  const prices = Array.from({ length: n }, (_, i) => 300000 + i * 10000); // median ~ 445k, p10 ~ 314k, p90 ~ 576k
  return buildAnswer({
    source: SOURCES[source],
    query: { country: "GB", town: "Bristol", property_type: "terraced" },
    summary: summarise(prices),
    currency: "GBP",
    unit: "per home",
    period: { from: "2026-04-01", to: "2026-09-30" },
    method: "m",
    describe: (s) => `Median ${s.median}.`,
  });
}

function rent(value = 2165, ref = "2026-Q2"): PriceAnswer {
  return buildStatisticAnswer({
    source: SOURCES["ie-rtb-rents"],
    query: { country: "IE", town: "Dublin" },
    value,
    measure: "average",
    currency: "EUR",
    unit: "per month",
    period: { from: "2026-04-01", to: "2026-06-30" },
    reference_period: ref,
    method: "m",
    describe: () => "Average rent.",
  });
}

function diesel(n = 40): PriceAnswer {
  const prices = Array.from({ length: n }, (_, i) => 1.6 + i * 0.01);
  return buildAnswer({
    source: SOURCES["fr-fuel"],
    query: { country: "FR", department: "69", fuel: "diesel" },
    summary: summarise(prices),
    currency: "EUR",
    unit: "per litre",
    period: { from: "2026-10-14", to: "2026-10-14" },
    method: "m",
    describe: () => "Diesel.",
  });
}

// ---------- verdicts ----------

test("transaction source: above, within and below the typical range, with where the price sits", () => {
  const a = sales();
  const hi = judge(a, { category: "home-sales", country: "GB", price: 700000 }, TODAY);
  assert.equal(hi.verdict, "above_typical_range");
  assert.match(hi.position!.text, /^\d+% above the median and above the 90th percentile$/);
  assert.equal(hi.position!.basis, "range");
  assert.ok(hi.position!.vs_median_percent! > 50);
  assert.match(hi.summary, /^£700,000 per home is \d+% above the median and above the 90th percentile/);
  assert.ok(hi.reasons.some((r) => /actually paid in recorded sales, not asking prices/.test(r)));
  assert.deepEqual(hi.answer, a); // the full evidence answer is embedded unchanged

  const mid = judge(a, { category: "home-sales", country: "GB", price: a.price!.median! }, TODAY);
  assert.equal(mid.verdict, "within_typical_range");
  assert.match(mid.position!.text, /^at the median and within the typical range/);

  const lo = judge(a, { category: "home-sales", country: "GB", price: 200000 }, TODAY);
  assert.equal(lo.verdict, "below_typical_range");
  assert.match(lo.position!.text, /below the median and below the 10th percentile/);

  // exactly on the 10th and 90th percentile is still within
  assert.equal(judge(a, { category: "home-sales", country: "GB", price: a.price!.typical_high! }, TODAY).verdict, "within_typical_range");
  assert.equal(judge(a, { category: "home-sales", country: "GB", price: a.price!.typical_low! }, TODAY).verdict, "within_typical_range");
});

test("official statistic: compared with the published average, not a distribution; within 5% is about_average", () => {
  const a = rent(2165);
  const r = judge(a, { category: "rent", country: "IE", price: 2400, unit: "per month", currency: "EUR" }, TODAY);
  assert.equal(r.verdict, "above_average");
  assert.equal(r.position!.basis, "average");
  assert.equal(r.position!.vs_median_percent, 10.9);
  assert.equal(r.position!.text, "11% above the official average");
  assert.match(r.summary, /^€2,400 per month is 11% above the official average of €2,165 per month for Dublin in 2026-Q2 \(an official average, not a range\)\.$/);
  assert.match(r.summary, /\(an official average, not a range\)\.$/);
  assert.ok(r.reasons.some((x) => /not with a distribution of individual prices/.test(x)));

  assert.equal(judge(a, { category: "rent", country: "IE", price: 2165 * 1.049 }, TODAY).verdict, "about_average");
  assert.equal(judge(a, { category: "rent", country: "IE", price: 2165 * 0.951 }, TODAY).verdict, "about_average");
  assert.equal(judge(a, { category: "rent", country: "IE", price: 2165 * 1.06 }, TODAY).verdict, "above_average");
  const low = judge(a, { category: "rent", country: "IE", price: 1500 }, TODAY);
  assert.equal(low.verdict, "below_average");
  assert.match(low.position!.text, /^31% below the official average$/);
  assert.match(judge(a, { category: "rent", country: "IE", price: 2165 }, TODAY).position!.text, /equal to it/);
});

test("posted price: the verdict names posted prices and says they are not what customers paid", () => {
  const a = diesel();
  assert.equal(judge(a, { category: "fuel", country: "FR", price: 1.75, unit: "per litre" }, TODAY).verdict, "within_typical_range");
  const hi = judge(a, { category: "fuel", country: "FR", price: 2.3, unit: "per litre" }, TODAY);
  assert.equal(hi.verdict, "above_typical_range");
  assert.ok(hi.reasons.some((x) => /posted prices \(what sellers display\), not receipts/.test(x)));
  assert.match(hi.summary, /posted prices from/);
});

test("currency or unit mismatch is cannot_judge, never converted", () => {
  const a = sales();
  const cur = judge(a, { category: "home-sales", country: "GB", price: 450000, currency: "EUR" }, TODAY);
  assert.equal(cur.verdict, "cannot_judge");
  assert.equal(cur.position, null);
  assert.match(cur.reasons[0], /never converts currencies silently/);
  assert.ok(cur.missing.length > 0);
  assert.match(cur.summary, /does not convert currencies/);

  const unit = judge(rent(), { category: "rent", country: "IE", price: 500, unit: "per week" }, TODAY);
  assert.equal(unit.verdict, "cannot_judge");
  assert.match(unit.reasons[0], /"per week" but the evidence is per month/);

  // same unit in other words is fine
  for (const u of ["per month", "a month", "/month", "monthly", "Per Month", "pcm"]) {
    assert.equal(judge(rent(), { category: "rent", country: "IE", price: 2200, unit: u }, TODAY).verdict, "about_average", u);
  }
  // symbol and lower case currency codes are read
  assert.equal(judge(rent(), { category: "rent", country: "IE", price: 2200, currency: "€" }, TODAY).verdict, "about_average");
  assert.equal(judge(rent(), { category: "rent", country: "IE", price: 2200, currency: "eur" }, TODAY).verdict, "about_average");
  assert.equal(judge(rent(), { category: "rent", country: "IE", price: 2200, currency: "$" }, TODAY).verdict, "cannot_judge");
});

test("insufficient data and no matches are cannot_judge", () => {
  const few = buildAnswer({
    source: SOURCES["gb-hmlr-ppd"], query: { country: "GB", town: "Tiny" }, summary: summarise([100, 200, 300]),
    currency: "GBP", unit: "per home", period: { from: null, to: null }, method: "m", describe: () => "x",
  });
  assert.equal(few.status, "insufficient_data");
  const r = judge(few, { category: "home-sales", country: "GB", price: 250 }, TODAY);
  assert.equal(r.verdict, "cannot_judge");
  assert.match(r.reasons[0], /Only 3 matching records/);
  assert.match(r.missing[0], /at least 5/);

  const none = buildAnswer({
    source: SOURCES["gb-hmlr-ppd"], query: { country: "GB", town: "Nowhere" }, summary: null,
    currency: "GBP", unit: "per home", period: { from: null, to: null }, method: "m", describe: () => "x",
  });
  const n = judge(none, { category: "home-sales", country: "GB", price: 250 }, TODAY);
  assert.equal(n.verdict, "cannot_judge");
  assert.match(n.reasons[0], /No matching records/);
});

test("old periods, our own copy, a missing currency or unit, and includes are flagged but do not stop the verdict", () => {
  const old = judge(rent(2165, "2024-Q4"), { category: "rent", country: "IE", price: 2400 }, TODAY);
  assert.equal(old.verdict, "above_average");
  assert.ok(old.reasons.some((r) => /^Old period: the evidence ends 2024-12-31/.test(r)));
  assert.ok(old.reasons.some((r) => /No currency was given/.test(r)));
  assert.ok(old.reasons.some((r) => /No unit was given/.test(r)));
  assert.ok(!judge(rent(2165, "2026-Q2"), { category: "rent", country: "IE", price: 2400 }, TODAY).reasons.some((r) => /Old period/.test(r)));

  const stale = { ...diesel(), extra: { stale: true, snapshot_date: "2026-10-10" } };
  assert.ok(judge(stale, { category: "fuel", country: "FR", price: 1.8 }, TODAY).reasons.some((r) => /own copy from 2026-10-10/.test(r)));
  // a posted price from months ago is old too
  const oldFuel = { ...diesel(), period: { from: "2026-08-01", to: "2026-08-01" } };
  assert.ok(judge(oldFuel, { category: "fuel", country: "FR", price: 1.8 }, TODAY).reasons.some((r) => /Old period/.test(r)));

  const inc = judge(rent(), { category: "rent", country: "IE", price: 2400, includes: "VAT included, delivery excluded" }, TODAY);
  assert.ok(inc.reasons.some((r) => /VAT included, delivery excluded/.test(r) && /cannot adjust/.test(r)));
  assert.equal(inc.input.includes, "VAT included, delivery excluded");
});

test("unit and period helpers", () => {
  assert.equal(normUnit("per m²"), normUnit("per square metre"));
  assert.equal(normUnit("per litre"), normUnit("per liter"));
  assert.ok(!sameUnit("per passenger, each way", "per way"));
  assert.ok(sameUnit("per passenger, each way", "per passenger each way"));
  assert.equal(periodEnd("2025-Q4")!.toISOString().slice(0, 10), "2025-12-31");
  assert.equal(periodEnd("2025-S1")!.toISOString().slice(0, 10), "2025-06-30");
  assert.equal(periodEnd("2025-02")!.toISOString().slice(0, 10), "2025-02-28");
  assert.equal(periodEnd("2025")!.toISOString().slice(0, 10), "2025-12-31");
  assert.equal(periodEnd("2025-10-14")!.toISOString().slice(0, 10), "2025-10-14");
  assert.equal(periodEnd("later"), null);
});

// ---------- running a check ----------

const fixtureDeps = (answer: PriceAnswer) => ({
  categories: CATEGORIES,
  runCategory: async () => answer,
});

test("runCheck resolves the category by id, REST path or tool name, validates like the category tool, and embeds the answer", async () => {
  const a = diesel();
  const base = { country: "FR", department: "69", fuel: "diesel", price: 2.3 };
  for (const category of ["fuel", "pricepaid_fuel_prices_now"]) {
    const r = await runCheck({ category, ...base }, fixtureDeps(a), {}, TODAY);
    assert.equal(r.verdict, "above_typical_range");
    assert.equal(r.input.category, "fuel");
    assert.equal(r.input.country, "FR");
    assert.deepEqual(r.answer, a);
    assert.ok(checkResultSchema.safeParse(r).success, JSON.stringify(checkResultSchema.safeParse(r).error?.issues));
  }
  await assert.rejects(() => runCheck({ category: "fuel", country: "FR", fuel: "diesel" }, fixtureDeps(a)), (e: any) => e instanceof InputError && /price is required/.test(e.message));
  await assert.rejects(() => runCheck({ category: "fuel", country: "FR", fuel: "diesel", price: -3 }, fixtureDeps(a)), InputError);
  await assert.rejects(() => runCheck({ category: "fuel", country: "FR", fuel: "diesel", price: "abc" }, fixtureDeps(a)), InputError);
  await assert.rejects(() => runCheck({ category: "nothing", country: "FR", price: 1 }, fixtureDeps(a)), (e: any) => /category is required/.test(e.message));
  await assert.rejects(() => runCheck({ category: "fuel", price: 1 }, fixtureDeps(a)), (e: any) => /country is required/.test(e.message));
  await assert.rejects(() => runCheck({ category: "fuel", country: "ZZ", price: 1 }, fixtureDeps(a)), InputError);
  // the category's own validation: a bad bedrooms value is refused before any lookup
  await assert.rejects(
    () => runCheck({ category: "rent", country: "IE", town: "Dublin", bedrooms: 99, price: 2000 }, { categories: CATEGORIES, runCategory: async () => { throw new Error("must not run"); } }),
    (e: any) => /bedrooms must be/.test(e.message),
  );
});

test("the MCP tool is listed with a title, read-only annotations, input and output schemas, and returns structuredContent", async () => {
  const a = diesel();
  const deps: ToolDeps = { ...LIVE_DEPS, runCategory: (async () => a) as any };
  const specs = buildToolSpecs(deps);
  const spec = specs.find((s) => s.name === CHECK_TOOL)!;
  assert.ok(spec);
  assert.equal(CHECK_TOOL, "pricepaid_check_price");
  assert.equal(spec.config.title, "Check a price before you pay");
  assert.equal(spec.config.annotations.readOnlyHint, true);
  assert.equal(spec.config.annotations.destructiveHint, false);
  assert.ok(spec.config.description.length > 200);
  const res = await spec.call({ category: "fuel", country: "FR", department: "69", fuel: "diesel", price: 2.3, unit: "per litre", currency: "EUR" });
  assert.ok(!res.isError, JSON.stringify(res));
  assert.ok(spec.config.outputSchema.safeParse(res.structuredContent).success);
  assert.equal((res.structuredContent as any).verdict, "above_typical_range");
  assert.match(res.content[0].text, /^€2\.30 per litre is/);
  const bad = await spec.call({ category: "fuel", country: "FR", fuel: "diesel" });
  assert.equal(bad.isError, true);
  // every category parameter is accepted by the input schema (strings or numbers), and the check's own fields are required/optional as documented
  const inputOk = spec.config.inputSchema.safeParse({ category: "rent", country: "IE", town: "Dublin", bedrooms: 2, price: 2400 });
  assert.ok(inputOk.success, JSON.stringify((inputOk as any).error?.issues));
  assert.ok(!spec.config.inputSchema.safeParse({ category: "rent", country: "IE" }).success); // price is required
});

test("OpenAPI, llms.txt and llms-full.txt describe the price check", () => {
  const api: any = buildOpenApi("https://example.test");
  const op = api.paths["/api/v1/check"].get;
  assert.equal(op.operationId, "checkPrice");
  const names = op.parameters.map((p: any) => p.name);
  for (const n of ["category", "country", "price", "currency", "unit", "includes"]) assert.ok(names.includes(n), n);
  assert.ok(op.parameters.find((p: any) => p.name === "price").required);
  assert.ok(api.components.schemas.CheckResult.properties.verdict);
  assert.ok(api.components.schemas.PriceAnswer.properties.answer_id);
  const llms = buildLlmsTxt("https://example.test");
  assert.ok(llms.includes("pricepaid_check_price") && llms.includes("/api/v1/check?category="));
  const full = buildLlmsFullTxt("https://example.test");
  assert.ok(full.includes("### pricepaid_check_price") && full.includes("cannot_judge") && full.includes("answer_id"));
});

// ---------- audit trail ----------

test("every answer carries answer_id, method_version, retrieved_at and evidence; existing fields are unchanged", () => {
  const a = sales();
  assert.match(a.answer_id!, /^ans_[0-9a-f]{20}$/);
  assert.equal(a.method_version, "1");
  assert.ok(!Number.isNaN(Date.parse(a.retrieved_at!)));
  assert.deepEqual(a.evidence, { type: "transaction", label: "Recorded sale prices", meaning: a.evidence!.meaning });
  assert.ok(a.evidence!.meaning.length > 20);
  for (const k of ["query", "status", "price", "sample_size", "period", "confidence", "price_type", "as_of", "source", "method", "method_url", "summary", "notice"]) assert.ok(k in a, k);
  assert.equal(a.price_type, "transaction");
  assert.ok(priceAnswerSchema.safeParse(a).success);
  assert.ok(priceAnswerSchema.safeParse(rent()).success);

  assert.equal(rent().evidence!.label, "Official published average");
  assert.equal(diesel().evidence!.label, "Posted shelf or pump price");
  assert.equal(evidenceFor("contract_price").label, "Contract award value");
  assert.equal(evidenceFor("reimbursement_price").label, "Regulated reimbursement price");
  assert.equal(evidenceFor("official_statistic", "median").label, "Official published median");
});

test("answer_id is stable for the same source, normalised query, period and method version, and changes with any of them", () => {
  const period = { from: "2026-01-01", to: "2026-03-31" };
  const id = answerIdFor("gb-hmlr-ppd", { country: "GB", town: "Bristol" }, period, "1");
  assert.equal(id, answerIdFor("gb-hmlr-ppd", { town: "  BRISTOL ", country: "GB", postcode: null, note: "" }, period, "1"));
  assert.notEqual(id, answerIdFor("gb-hmlr-ppd", { country: "GB", town: "Leeds" }, period, "1"));
  assert.notEqual(id, answerIdFor("gb-hmlr-ppd", { country: "GB", town: "Bristol" }, { from: "2026-01-01", to: "2026-04-30" }, "1"));
  assert.notEqual(id, answerIdFor("gb-hmlr-ppd", { country: "GB", town: "Bristol" }, period, "2"));
  assert.notEqual(id, answerIdFor("fr-dvf", { country: "GB", town: "Bristol" }, period, "1"));
  assert.deepEqual(normaliseQuery({ b: " X  y ", a: 2, c: undefined, d: "" }), { a: 2, b: "x y" });
  // two builds of the same answer give the same id (retrieved_at differs, the id does not)
  assert.equal(sales().answer_id, sales().answer_id);
  // a per-source method_version changes the id
  const bumped = buildAnswer({
    source: { ...SOURCES["gb-hmlr-ppd"], method_version: "2" }, query: { country: "GB", town: "Bristol", property_type: "terraced" }, summary: summarise([1, 2, 3, 4, 5, 6]),
    currency: "GBP", unit: "per home", period: { from: "2026-04-01", to: "2026-09-30" }, method: "m", describe: () => "x",
  });
  assert.equal(bumped.method_version, "2");
});
