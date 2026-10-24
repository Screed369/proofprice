import { test } from "node:test";
import assert from "node:assert/strict";
import { buildUrl, INFO, parseCalc, sinFilter, usLaborRates } from "./source";
import { isLaborRateRequest, laborKeyword } from "../../categories/contracts/labor";
import { InputError, SourceError } from "../../lib/http";
import usaspending from "../us-usaspending/index";
import gsa from "./index";

// Trimmed from the live response of GET https://api.gsa.gov/acquisition/calc/v3/api/ceilingrates/?keyword=software%20engineer&page=1&page_size=1
// (HTTP 200, probe plb-gsa-calc3 from GitHub Actions, checked 2026-10-24). Only the fields we read are kept.
const SOFTWARE_ENGINEER = {"hits": {"total": {"value": 4842, "relation": "eq"}, "hits": [{"_index": "ceilingrates-2026-10-24_02-00-02", "_source": {"next_year_price": null, "second_year_price": null, "labor_category": "Intern Software Engineer", "schedule": "MAS", "sin": "54151", "worksite": "Customer_Facility", "current_price": 29.27, "_timestamp": "2026-10-24T02:00:02Z"}}]}, "aggregations": {"histogram_percentiles": {"values": {"10.0": 88.48853697893696, "25.0": 108.84433377210112, "30.0": 114.42812502838031, "35.0": 120.1126533474104, "50.0": 137.28652293461008, "65.0": 156.2263894232552, "70.0": 162.9619404189353, "75.0": 170.81828221409526, "90.0": 211.3478226191443}}, "median_price": {"values": {"50.0": 137.28652293461008}}, "wage_stats": {"count": 4842, "min": 29.270000457763672, "max": 465.5964050292969, "avg": 144.62338761995764}}};
// Live response for a keyword with no match (keyword=zzqqxx, same day): total 0 and null percentiles.
const EMPTY = { hits: { total: { value: 0, relation: "eq" }, hits: [] }, aggregations: { histogram_percentiles: { values: { "10.0": null, "50.0": null, "90.0": null } }, median_price: { values: { "50.0": null } }, wage_stats: { count: 0, min: null, max: null, avg: null } } };

async function withFetch(body: unknown, run: (urls: string[]) => Promise<void>, status = 200) {
  const real = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (u: any) => {
    urls.push(String(u));
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    await run(urls);
  } finally {
    globalThis.fetch = real;
  }
}

test("GSA CALC+: the whole-match percentiles and count are read from the aggregations, with the index date", () => {
  const s = parseCalc(SOFTWARE_ENGINEER)!;
  assert.equal(s.count, 4842);
  assert.equal(Math.round(s.median * 100) / 100, 137.29);
  assert.equal(Math.round(s.low * 100) / 100, 88.49);
  assert.equal(Math.round(s.high * 100) / 100, 211.35);
  assert.equal(s.indexDate, "2026-10-24");
  assert.equal(parseCalc(EMPTY), null);
  assert.throws(() => parseCalc({ hits: {} }), SourceError);
});

test("GSA CALC+: request URL carries the keyword and an optional SIN filter, one row only", () => {
  assert.equal(buildUrl("software engineer", null), "https://api.gsa.gov/acquisition/calc/v3/api/ceilingrates/?page=1&page_size=1&keyword=software+engineer");
  assert.match(buildUrl("", "541330ENG"), /filter=sin%3A541330ENG/);
  assert.equal(sinFilter("sin:541330eng"), "541330ENG");
  assert.equal(sinFilter("psc:7010"), null);
});

test("routing: hourly labour-rate questions go to us-gsa-calc, every other US contracts question stays with USAspending", () => {
  assert.equal(isLaborRateRequest({ country: "US", what: "software engineer hourly rate" }), true);
  assert.equal(isLaborRateRequest({ country: "US", what: "project manager", cpv: "sin:541611" }), true);
  assert.equal(isLaborRateRequest({ country: "US", what: "laptops" }), false);
  assert.equal(isLaborRateRequest({ country: "US" }), false);
  assert.equal(gsa.serves!({ country: "US", what: "software engineer hourly rate" }), true);
  assert.equal(usaspending.serves!({ country: "US", what: "software engineer hourly rate" }), false);
  assert.equal(gsa.serves!({ country: "US", what: "laptops" }), false);
  assert.equal(usaspending.serves!({ country: "US", what: "laptops" }), true);
  assert.equal(usaspending.serves!({ country: "US" }), true);
  assert.equal(laborKeyword("software engineer hourly rate"), "software engineer");
  assert.equal(laborKeyword("what is the hourly rate for a project manager"), "project manager");
});

test("GSA CALC+ end to end with a stubbed API: ceiling rate, labelled as ceiling and not as paid", async () => {
  await withFetch(SOFTWARE_ENGINEER, async (urls) => {
    const a = await usLaborRates({ what: "software engineer hourly rate" });
    assert.equal(a.status, "ok");
    assert.equal(a.source.id, "us-gsa-calc");
    assert.equal(a.price_type, "posted_price");
    assert.equal(a.price?.currency, "USD");
    assert.equal(a.price?.unit, "per hour, ceiling rate");
    assert.equal(a.price?.median, 137.29);
    assert.equal(a.sample_size, 4842);
    assert.match(a.summary, /ceiling/i);
    assert.match(a.summary, /not what agencies actually paid/);
    assert.equal(a.extra?.rate_basis, "ceiling");
    assert.equal(a.period.to, "2026-10-24");
    assert.equal(a.evidence?.label, "Ceiling hourly rate");
    assert.equal(urls.length, 1);
    assert.match(urls[0], /keyword=software\+engineer/);
  });
});

test("GSA CALC+: no match gives no_matches, a bad cpv or empty question is a clear input error", async () => {
  await withFetch(EMPTY, async () => {
    const a = await usLaborRates({ what: "zzqqxx hourly rate" });
    assert.equal(a.status, "no_matches");
    assert.equal(a.price, null);
  });
  await assert.rejects(usLaborRates({ what: "hourly rate" }), InputError);
  await assert.rejects(usLaborRates({ what: "welder hourly rate", cpv: "psc:7010" }), InputError);
});

test("GSA CALC+: an HTTP error from the source is a SourceError", async () => {
  await withFetch({}, async () => {
    await assert.rejects(usLaborRates({ what: "welder hourly rate" }), SourceError);
  }, 503);
});

test("GSA CALC+ licence block names CC0 and ceiling-rate wording", () => {
  assert.match(INFO.licence, /CC0/);
  assert.match(INFO.limits, /NOT what agencies actually paid/);
  assert.equal(INFO.price_type, "posted_price");
});
