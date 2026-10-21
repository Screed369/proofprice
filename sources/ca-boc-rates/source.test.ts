// Tests for the Bank of Canada interest rates on new lending. Fixtures are real Valet replies captured on 2026-10-21 (see fixtures.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
process.env.PROOFPRICE_LIBRARY_DIR = mkdtempSync(path.join(tmpdir(), "pp-boc-"));
import { RATE_NOTICE } from "../../lib/answer";
import { answerRate, harvestRows } from "../_rates/rates";
import { VALET_CONSUMER, VALET_EXTENDED, VALET_MORTGAGES } from "./fixtures";
import { CATALOG, INFO, makeSource, parseValet, valetUrl } from "./source";
import manifest from "./index";

const TODAY = new Date("2026-10-21T12:00:00Z");
// one reply for every request: the three groups merged, as one Valet call for all series would give
const merged = JSON.stringify({
  observations: [VALET_MORTGAGES, VALET_CONSUMER, VALET_EXTENDED].map((t) => JSON.parse(t).observations).reduce((acc: any[], obs: any[]) => {
    obs.forEach((o, i) => (acc[i] = { ...(acc[i] ?? {}), ...o }));
    return acc;
  }, []),
});
const fake = (calls: string[] = []) => async (url: string) => {
  calls.push(url);
  return merged;
};

test("parse: Valet observations give a point per month and series", () => {
  const m = parseValet(VALET_MORTGAGES);
  assert.deepEqual(m.get("V122667781"), [{ period: "2026-07", value: 4.29 }, { period: "2026-06", value: 4.32 }]);
  assert.equal(parseValet(VALET_CONSUMER).get("V122667803")![0].value, 5.82);
  assert.throws(() => parseValet("<html>"), /not JSON/);
  assert.throws(() => parseValet("{}"), /no observations/);
});

test("mortgage in Canada is the uninsured rate and the answer says so", async () => {
  const calls: string[] = [];
  const a = await answerRate(makeSource(fake(calls)), { country: "CA", product: "mortgage" }, {}, TODAY);
  assert.equal(a.status, "ok");
  assert.equal(a.price?.value, 4.29);
  assert.equal(a.price?.currency, "PERCENT");
  assert.equal(a.statistic?.reference_period, "2026-07");
  assert.equal(a.sample_size, null);
  assert.match(a.summary, /The official average agreed rate on new uninsured residential mortgages in Canada was 4\.29 % a year in July 2026/);
  assert.match(a.statistic?.note ?? "", /uninsured \(conventional\) mortgage rate; ask for product=mortgage_insured/);
  assert.equal((a.extra as any).product_answered, "mortgage_uninsured");
  assert.equal((a.extra as any).series.publisher_code, "V122667781");
  assert.equal(a.notice, RATE_NOTICE);
  assert.equal(calls[0], "https://www.bankofcanada.ca/valet/observations/V122667781/json?start_date=2025-08-01");
});

test("insured, fixed 5 years and over, with the change on the previous month", async () => {
  const a = await answerRate(makeSource(fake()), { country: "CA", product: "mortgage_insured", term: "over-5y" }, {}, TODAY);
  assert.equal(a.price?.value, 4.05);
  assert.equal((a.extra as any).change_on_previous_month.change_points, 0.04);
  assert.equal((a.extra as any).change_on_year_earlier, null);
});

test("consumer credit and business loans: funds advanced (new lending), never outstanding balances", async () => {
  assert.equal((await answerRate(makeSource(fake()), { country: "CA", product: "consumer_loan" }, {}, TODAY)).price?.value, 5.82);
  assert.equal((await answerRate(makeSource(fake()), { country: "CA", product: "business_loan" }, {}, TODAY)).price?.value, 4.4);
  const codes = CATALOG.forArea("CA").map((s) => s.code);
  for (const outstanding of ["V122667787", "V122667809", "V122667821"]) assert.ok(!codes.includes(outstanding));
  await assert.rejects(answerRate(makeSource(fake()), { country: "CA", product: "deposit" }, {}, TODAY), /no deposit series/);
});

test("harvest takes the newest month for every series in one call", async () => {
  const calls: string[] = [];
  const src = makeSource(fake(calls));
  const h = harvestRows(src, await src.fetchAll("2026-07", "2026-10"));
  assert.equal(h.date, "2026-07-31");
  assert.equal(h.rows.length, 14);
  assert.equal(calls.length, 1);
  assert.match(valetUrl(["V1", "V2"], "2026-07"), /\/V1,V2\/json\?start_date=2026-07-01$/);
});

test("manifest", () => {
  assert.deepEqual(manifest.countries, ["CA"]);
  assert.match(INFO.licence, /Open Government Licence - Canada/);
  assert.equal(manifest.statisticMeasure, "average");
});
