// Tests for the Bank of England effective interest rates. The fixture is a real reply captured on 2026-10-21 (see fixtures.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
process.env.PROOFPRICE_LIBRARY_DIR = mkdtempSync(path.join(tmpdir(), "pp-boe-"));
import { RATE_NOTICE } from "../../lib/answer";
import { answerRate, harvestRows } from "../_rates/rates";
import { BOE_CSV } from "./fixtures";
import { CATALOG, INFO, boePeriod, boeUrl, makeSource, parseBoeCsv } from "./source";
import manifest from "./index";

const TODAY = new Date("2026-10-21T12:00:00Z");
const fake = (calls: string[] = []) => async (url: string) => {
  calls.push(url);
  return BOE_CSV;
};

test("parse: the CSV with its description block gives 19 series of 25 months", () => {
  const m = parseBoeCsv(BOE_CSV);
  assert.equal(m.size, 19);
  const mort = m.get("CFMZ6JM")!;
  assert.equal(mort.length, 25);
  assert.deepEqual(mort[0], { period: "2024-08", value: 4.84 });
  assert.deepEqual(mort[24], { period: "2026-08", value: 4.6 });
  assert.equal(boePeriod("28 Feb 2025"), "2025-02");
  assert.equal(boePeriod("nonsense"), null);
  assert.throws(() => parseBoeCsv("<html>blocked</html>"), /format we do not recognise/);
});

test("UK mortgages: 4.6 % a year in August 2026, with the change on a year earlier calculated and labelled", async () => {
  const calls: string[] = [];
  const a = await answerRate(makeSource(fake(calls)), { country: "GB", product: "mortgage" }, {}, TODAY);
  assert.equal(a.status, "ok");
  assert.equal(a.price?.value, 4.6);
  assert.equal(a.price?.currency, "PERCENT");
  assert.equal(a.price?.measure, "average");
  assert.equal(a.sample_size, null);
  assert.equal(a.statistic?.reference_period, "2026-08");
  assert.equal(a.notice, RATE_NOTICE);
  assert.match(a.summary, /The official average agreed rate on new sterling loans secured on dwellings \(mortgages\) to individuals and individual trusts in the United Kingdom was 4\.6 % a year in August 2026/);
  assert.match(a.summary, /\+0\.34 percentage points on a year earlier \(4\.26 % a year in August 2025; change calculated by ProofPrice\)/);
  const x = a.extra as any;
  assert.equal(x.change_on_year_earlier.change_points, 0.34);
  assert.equal(x.change_on_previous_month.change_points, 0.15);
  assert.equal(x.history.length, 12);
  assert.equal(x.history[0].reference_period, "2025-09");
  assert.equal(x.series.publisher_code, "CFMZ6JM");
  assert.match(a.source.licence, /Open Government Licence v3\.0/);
  assert.match(a.source.attribution, /^Contains public sector information licensed under the Open Government Licence v3\.0\./);
  assert.match(calls[0], /^https:\/\/www\.bankofengland\.co\.uk\/boeapps\/iadb\/fromshowcolumns\.asp\?csv\.x=yes&Datefrom=01\/Aug\/2025&Dateto=now&SeriesCodes=CFMZ6JM&CSVF=TT/);
});

test("months=24 returns the whole two years the Bank held in the fixture", async () => {
  const a = await answerRate(makeSource(fake()), { country: "GB", product: "mortgage", term: "5y", months: 24 }, {}, TODAY);
  assert.equal(a.price?.value, 4.59);
  const h = (a.extra as any).history;
  assert.equal(h.length, 24);
  assert.equal(h[0].reference_period, "2024-09");
  assert.equal(h[23].reference_period, "2026-08");
});

test("SME loans, fixed-rate bonds and an unsupported product", async () => {
  assert.equal((await answerRate(makeSource(fake()), { country: "GB", product: "business_loan_small", term: "fixed" }, {}, TODAY)).price?.value, 7.88);
  const dep = await answerRate(makeSource(fake()), { country: "GB", product: "deposit", term: "1-2y" }, {}, TODAY);
  assert.equal(dep.price?.value, 4.2);
  assert.match(dep.summary, /The official average rate paid on new sterling fixed-rate bond deposits/);
  await assert.rejects(answerRate(makeSource(fake()), { country: "GB", product: "deposit_overnight" }, {}, TODAY), /no deposit_overnight series/);
  await assert.rejects(answerRate(makeSource(fake()), { country: "GB", product: "months" as any, term: "x" }, {}, TODAY), /product must be one of/);
});

test("the Database URL names the codes and the first of the month", () => {
  assert.equal(
    boeUrl(["CFMZ6JM", "CFMZ6JO"], "2024-09"),
    "https://www.bankofengland.co.uk/boeapps/iadb/fromshowcolumns.asp?csv.x=yes&Datefrom=01/Sep/2024&Dateto=now&SeriesCodes=CFMZ6JM,CFMZ6JO&CSVF=TT&UsingCodes=Y&VPD=Y&VFD=N",
  );
});

test("harvest: one row per series for the newest month, dated by the month end", async () => {
  const src = makeSource(fake());
  const h = harvestRows(src, await src.fetchAll("2026-07", "2026-10"));
  assert.equal(h.date, "2026-08-31");
  assert.equal(h.rows.length, 19);
  assert.equal(h.rows.find((r) => r.item === "mortgage/total")!.median, 4.6);
});

test("catalog and manifest", () => {
  assert.equal(CATALOG.forArea("GB").length, 19);
  assert.equal(CATALOG.forArea("IE").length, 0);
  assert.deepEqual(manifest.countries, ["GB"]);
  assert.equal(manifest.referenceDates, true);
  assert.equal(INFO.price_type, "official_statistic");
  assert.match(INFO.limits, /Information only/);
});
