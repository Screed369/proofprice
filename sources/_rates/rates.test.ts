// Tests for the shared interest-rate machinery: vocabulary, the stored copy first and the live source second, and the size of the library.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const dir = mkdtempSync(path.join(tmpdir(), "pp-rates-"));
process.env.PROOFPRICE_LIBRARY_DIR = dir;
import { applyBackfill, sourceHistoryBytes } from "../../lib/library/backfill";
import { writeDaily, writeMeta } from "../../lib/library/store";
import { InputError } from "../../lib/http";
import { BOE_CSV } from "../gb-boe-rates/fixtures";
import * as boe from "../gb-boe-rates/source";
import * as ecb from "../eu-ecb-mir/source";
import * as boc from "../ca-boc-rates/source";
import {
  addMonths, allSeries, answerRate, backfillPeriods, harvestRows, isCurrent, monthEnd, monthWords, normaliseProduct, normaliseTerm, parseRateRequest, pickSeries, readStored,
} from "./rates";
import type { RatePoint, RateSource } from "./rates";

const TODAY = new Date("2026-10-21T12:00:00Z");

test("terms and products: the words an agent might use become our codes, anything else stays as written", () => {
  assert.equal(normaliseTerm("Variable"), "floating");
  assert.equal(normaliseTerm("1 to 5y"), "1-5y");
  assert.equal(normaliseTerm("Over 5 years"), "over-5y");
  assert.equal(normaliseTerm(""), "total");
  assert.equal(normaliseTerm("cost of borrowing"), "composite");
  assert.equal(normaliseTerm("7y"), "7y");
  assert.equal(normaliseProduct("Mortgages"), "mortgage");
  assert.equal(normaliseProduct("consumer credit"), "consumer_loan");
  assert.equal(normaliseProduct("business loan small"), "business_loan_small");
  assert.equal(normaliseProduct(undefined), "mortgage");
  assert.equal(normaliseProduct("crypto"), undefined);
});

test("request: only country, product, term and months are read; months is 1 to 24", () => {
  assert.deepEqual(parseRateRequest({ country: "ie" }), { country: "IE", product: "mortgage", term: "total", months: 12 });
  assert.equal(parseRateRequest({ country: "IE", months: "24" }).months, 24);
  for (const bad of [0, 25, 1.5, "x"]) assert.throws(() => parseRateRequest({ country: "IE", months: bad }), /months must be a whole number from 1 to 24/);
  // personal details in the request are never read
  const r = parseRateRequest({ country: "IE", product: "mortgage", income: 90000, age: 31, creditScore: 700 } as any);
  assert.deepEqual(Object.keys(r).sort(), ["country", "months", "product", "term"]);
});

test("dates", () => {
  assert.equal(addMonths("2026-01", -1), "2025-12");
  assert.equal(addMonths("2026-10", -14), "2025-08");
  assert.equal(addMonths("2026-11", 3), "2027-02");
  assert.equal(monthEnd("2024-02"), "2024-02-29");
  assert.equal(monthWords("2026-08"), "August 2026");
});

test("pickSeries: unknown country, product and term are plain input errors that say what is offered", () => {
  assert.throws(() => pickSeries(boe.CATALOG, parseRateRequest({ country: "FR" }), "x"), InputError);
  assert.throws(() => pickSeries(boe.CATALOG, parseRateRequest({ country: "GB", product: "deposit_notice" }), "x"), /Products offered: mortgage, consumer_loan, business_loan, business_loan_small, deposit/);
  assert.throws(() => pickSeries(boe.CATALOG, parseRateRequest({ country: "GB", term: "10y" }), "x"), /term must be one of total, floating, fixed, up-to-2y, 5y for mortgage in the United Kingdom/);
});

test("every library label the three sources write passes the library's label rules, and 24 months of every series fits the history budget", () => {
  const months = Array.from({ length: 24 }, (_, i) => addMonths("2024-09", i));
  for (const [name, mod] of [["ecb", ecb], ["boe", boe], ["boc", boc]] as const) {
    const src: RateSource = { info: mod.INFO, catalog: mod.CATALOG, freshDays: 75, method: "m", fetchLive: async () => [], fetchAll: async () => new Map() };
    const got = new Map<string, RatePoint[]>(allSeries(src.catalog).map((s) => [`${s.area}\u0000${s.item}`, months.map((period, i) => ({ period, value: 2 + i / 100 }))]));
    const rep = applyBackfill(mod.INFO.id, backfillPeriods(src, got), { today: TODAY, dryRun: true });
    assert.equal(rep.dropped_invalid, 0, `${name}: some rows were refused by the library`);
    assert.equal(rep.monthly_rows, allSeries(src.catalog).length * 24, name);
    assert.ok(rep.bytes_added < 5 * 1024 * 1024, `${name}: ${rep.bytes_added} bytes of history is over the 5 MB budget`);
    if (name === "ecb") assert.ok(rep.bytes_added < 2 * 1024 * 1024, `ECB history should be about 1.5 MB, is ${rep.bytes_added}`);
  }
});

// A source whose live call is counted, backed by the Bank of England fixture, to prove which path an answer takes.
function countingSource(): { src: RateSource; live: () => number } {
  let live = 0;
  const base = boe.makeSource(async () => BOE_CSV);
  return {
    src: { ...base, fetchLive: async (...a) => (live++, base.fetchLive(...a)) },
    live: () => live,
  };
}

test("stored copy first: with the collector's day and the history loader's months in the library, no call to the Bank is made", async () => {
  const { src, live } = countingSource();
  const got = await src.fetchAll("2024-08", "2026-10");
  const h = harvestRows(src, got);
  writeDaily(src.info.id, h);
  writeMeta(src.info.id, { source: src.info.id, currency: h.currency, unit: h.unit, first_date: h.date, last_date: h.date, days: 1, last_harvest_at: null, last_rows: h.rows.length, last_ok_at: TODAY.toISOString(), last_error: null });
  const rep = applyBackfill(src.info.id, backfillPeriods(src, got), { today: TODAY });
  assert.ok(rep.monthly_rows > 0);
  const a = await answerRate(src, { country: "GB", product: "mortgage", months: 24 }, {}, TODAY);
  assert.equal(live(), 0);
  assert.equal(a.price?.value, 4.6);
  assert.equal((a.extra as any).answered_from, "ProofPrice's stored copy of the official monthly figures");
  assert.equal((a.extra as any).history.length, 24);
  assert.equal((a.extra as any).history[0].reference_period, "2024-09");
  assert.equal((a.extra as any).change_on_year_earlier.change_points, 0.34);
  assert.ok(sourceHistoryBytes(src.info.id) > 0);
  assert.deepEqual(readStored(src.info.id, { area: "GB", item: "mortgage/total" }, 12, TODAY).slice(-1), [{ period: "2026-08", value: 4.6 }]);
});

test("a stored copy that has gone old is not used: the live source answers", async () => {
  const { src, live } = countingSource();
  // seven months later the August figure is far older than the Bank's usual lag, so the stored copy is not trusted
  const later = new Date("2027-04-10T12:00:00Z");
  const a = await answerRate(src, { country: "GB", product: "mortgage" }, {}, later);
  assert.equal(live(), 1);
  assert.equal((a.extra as any).answered_from, "the official source, live");
  assert.equal(isCurrent([{ period: "2026-08", value: 4.6 }], 75, later), false);
  assert.equal(isCurrent([{ period: "2026-08", value: 4.6 }], 75, TODAY), true);
  assert.equal(isCurrent([], 75, TODAY), false);
});
