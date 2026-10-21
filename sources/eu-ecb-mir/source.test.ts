// Tests for the ECB interest rates (MIR). Fixtures are real replies captured on 2026-10-21 (see fixtures.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
process.env.PROOFPRICE_LIBRARY_DIR = mkdtempSync(path.join(tmpdir(), "pp-ecb-"));
import { RATE_NOTICE } from "../../lib/answer";
import { InputError } from "../../lib/http";
import { answerRate, harvestRows, backfillPeriods } from "../_rates/rates";
import { AREAS, CATALOG, INFO, collectorUrls, ecbKey, makeSource, parseEcbCsv, toSeriesMap } from "./source";
import { ECB_DATAONLY } from "./fixtures";
import manifest from "./index";

const TODAY = new Date("2026-10-21T12:00:00Z");
const fake = (calls: string[] = []) => async (url: string) => {
  calls.push(url);
  return ECB_DATAONLY;
};

test("parse: the ECB csvdata gives one point per month and series, exactly as published", () => {
  const m = parseEcbCsv(ECB_DATAONLY);
  const ie = m.get("MIR.M.IE.B.A2C.A.R.A.2250.EUR.N")!;
  assert.deepEqual(ie.map((p) => p.period), ["2026-06", "2026-07", "2026-08"]);
  assert.equal(ie[2].value, 3.45);
  assert.equal(m.get("MIR.M.ES.B.A2C.A.R.A.2250.EUR.N")![2].value, 3.04);
  assert.equal(m.get("MIR.M.U2.B.A2C.A.R.A.2250.EUR.N")![2].value, 3.6);
  assert.throws(() => parseEcbCsv("<html>blocked</html>"), /format we do not recognise/);
});

test("parse: a missing observation (empty value) is skipped, not read as zero", () => {
  const csv = "KEY,TIME_PERIOD,OBS_VALUE\nMIR.M.IE.B.A2A.P.R.A.2240.EUR.N,2026-07,\nMIR.M.IE.B.A2A.P.R.A.2240.EUR.N,2026-08,3.1\n";
  assert.deepEqual(parseEcbCsv(csv).get("MIR.M.IE.B.A2A.P.R.A.2240.EUR.N"), [{ period: "2026-08", value: 3.1 }]);
});

test("Ireland, mortgages: the official average agreed rate on new loans, as published, in the one answer format", async () => {
  const calls: string[] = [];
  const a = await answerRate(makeSource(fake(calls)), { country: "IE", product: "mortgage" }, {}, TODAY);
  assert.equal(a.status, "ok");
  assert.equal(a.price?.value, 3.45);
  assert.equal(a.price?.currency, "PERCENT");
  assert.equal(a.price?.unit, "% a year");
  assert.equal(a.price?.measure, "average");
  assert.equal(a.price?.median, null);
  assert.equal(a.price?.typical_low, null);
  assert.equal(a.price?.typical_high, null);
  assert.equal(a.price?.min, null);
  assert.equal(a.price?.max, null);
  assert.equal(a.sample_size, null);
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.statistic?.reference_period, "2026-08");
  assert.deepEqual(a.period, { from: "2026-08-01", to: "2026-08-31" });
  assert.equal(a.reliability, "official_median_no_count");
  assert.equal(a.evidence?.label, "Official average rate on new business");
  assert.match(a.summary, /The official average agreed rate on new loans to households for house purchase in Ireland was 3\.45 % a year in August 2026/);
  assert.equal(a.notice, RATE_NOTICE);
  assert.equal(a.notice, "Official statistics, for information only. Not advice, an offer or a quote. ProofPrice is not a lender, broker or insurer.");
  assert.deepEqual(a.query, { country: "IE", product: "mortgage", term: "total", months: 12 });
  const x = a.extra as any;
  assert.equal(x.series.publisher_code, "MIR.M.IE.B.A2C.A.R.A.2250.EUR.N");
  assert.equal(x.change_on_previous_month.value, 3.45);
  assert.equal(x.change_on_previous_month.change_points, 0);
  assert.equal(x.change_on_year_earlier, null); // the fixture holds three months only
  assert.deepEqual(x.history.map((h: any) => h.reference_period), ["2026-06", "2026-07", "2026-08"]);
  assert.equal(x.answered_from, "the official source, live");
  assert.match(a.source.attribution, /^Source: ECB statistics/);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^https:\/\/data-api\.ecb\.europa\.eu\/service\/data\/MIR\/M\.IE\.B\.A2C\.A\.R\.A\.2250\.EUR\.N\?startPeriod=2025-08&detail=dataonly&format=csvdata$/);
});

test("the euro area aggregate and Spain answer from the same file; the figure is never rounded or changed", async () => {
  const ea = await answerRate(makeSource(fake()), { country: "EA" }, {}, TODAY);
  assert.equal(ea.price?.value, 3.6);
  assert.match(ea.summary, /in the euro area was 3\.6 % a year/);
  const es = await answerRate(makeSource(fake()), { country: "ES", product: "mortgage" }, {}, TODAY);
  assert.equal(es.price?.value, 3.04);
  assert.equal((es.extra as any).change_on_previous_month.change_points, 0.15); // 3.04 - 2.89, calculated and said so
  assert.match((es.extra as any).changes_note, /calculated by ProofPrice/);
});

test("the composite cost-of-borrowing indicator and a fixation period are separate series", async () => {
  const csv = "KEY,TIME_PERIOD,OBS_VALUE\nMIR.M.IE.B.A2C.AM.R.A.2250.EUR.N,2026-08,3.52\nMIR.M.IE.B.A2C.I.R.A.2250.EUR.N,2026-08,3.4\n";
  const get = (term: string) => answerRate(makeSource(async () => csv), { country: "IE", product: "mortgage", term }, {}, TODAY);
  assert.equal((await get("composite")).price?.value, 3.52);
  assert.equal((await get("1-5y")).price?.value, 3.4);
  assert.match((await get("1-5y")).summary, /initial rate-fixation period of over 1 and up to 5 years/);
});

test("a term the country does not publish is a plain 400 that lists the terms", async () => {
  await assert.rejects(answerRate(makeSource(fake()), { country: "IE", product: "mortgage", term: "3-5y" }, {}, TODAY), (e: any) => {
    assert.ok(e instanceof InputError);
    assert.match(e.message, /term must be one of total, floating, 1-5y, 5-10y, over-10y, over-1y, composite for mortgage in Ireland/);
    return true;
  });
  await assert.rejects(answerRate(makeSource(fake()), { country: "IE", product: "payday_loan" }, {}, TODAY), /product must be one of/);
});

test("a series with no figure in the window says so instead of inventing one", async () => {
  const a = await answerRate(makeSource(async () => "KEY,TIME_PERIOD,OBS_VALUE\n"), { country: "IE", product: "deposit" }, {}, TODAY);
  assert.equal(a.status, "no_matches");
  assert.equal(a.price, null);
  assert.match(a.summary, /has no published rate/);
  assert.deepEqual((a.extra as any).available_terms, ["total", "up-to-1y", "1-2y", "over-2y", "over-1y", "up-to-2y"]);
});

test("every area offered is a euro-area country with a code the ECB uses, and every key is well formed", () => {
  assert.equal(AREAS.length, 22);
  assert.ok(AREAS.some((a) => a.code === "EA" && a.ref === "U2"));
  for (const a of AREAS) for (const s of CATALOG.forArea(a.code)) assert.match(s.code, /^MIR\.M\.[A-Z0-9]{2}\.B\.[A-Z0-9]+\.[A-Z]{1,2}\.R\.[A0-9]\.(2240|2250)\.EUR\.N$/);
  assert.equal(ecbKey("U2", { item: "A2C", sector: "2250", amount: "A" }, "AM"), "MIR.M.U2.B.A2C.AM.R.A.2250.EUR.N");
});

test("the collector asks four times, once per product group, for every area", () => {
  const urls = collectorUrls("2024-09", "2026-10");
  assert.equal(urls.length, 4);
  for (const u of urls) {
    assert.match(u, /^https:\/\/data-api\.ecb\.europa\.eu\/service\/data\/MIR\/M\.U2\+AT\+BE\+BG\+HR\+CY\+EE\+FI\+FR\+DE\+GR\+IE\+IT\+LV\+LT\+LU\+MT\+NL\+PT\+SK\+SI\+ES\.B\./);
    assert.match(u, /\.R\.[A0-9+]+\.(2240|2250)\.EUR\.N\?startPeriod=2024-09&endPeriod=2026-10&detail=dataonly&format=csvdata$/);
  }
});

test("harvest: the newest month, one row per series, dated by the month end; backfill: whole months", async () => {
  const src = makeSource(fake());
  const got = await src.fetchAll("2026-06", "2026-10");
  const h = harvestRows(src, got);
  assert.equal(h.date, "2026-08-31");
  assert.equal(h.currency, "PERCENT");
  assert.equal(h.unit, "% a year");
  const rowOf = (area: string, item: string) => h.rows.find((r) => r.area === area && r.item === item)!;
  assert.equal(rowOf("IE", "mortgage/total").median, 3.45);
  assert.equal(rowOf("EA", "mortgage/total").median, 3.6);
  assert.equal(rowOf("ES", "dep-term/total").n, 5); // the placeholder count
  const b = backfillPeriods(src, got);
  assert.deepEqual(b.periods.map((p) => p.period), ["2026-06", "2026-07", "2026-08"]);
});

test("the manifest is a stored-copy source: reference-dated, no record counts, an average", () => {
  assert.equal(manifest.info.id, "eu-ecb-mir");
  assert.equal(manifest.referenceDates, true);
  assert.equal(manifest.nominalCounts, true);
  assert.equal(manifest.statisticMeasure, "average");
  assert.deepEqual(manifest.historyKey!({ country: "IE", product: "mortgage", term: "1-5y" }), { area: "IE", item: "mortgage/1-5y", label: "Ireland, loans to households for house purchase" });
  assert.equal(manifest.historyKey!({ country: "IE", product: "mortgage", term: "nonsense" }), null);
  assert.match(INFO.licence, /ECB/);
  assert.ok(toSeriesMap(parseEcbCsv(ECB_DATAONLY)).has("IE\u0000mortgage/total"));
});
