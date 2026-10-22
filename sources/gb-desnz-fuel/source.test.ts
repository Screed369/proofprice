// Real formats, checked live on 2026-10-14 (newest row dated Monday 12 October 2026):
//  - GET https://www.gov.uk/api/content/government/statistics/weekly-road-fuel-prices has details.attachments: the Excel file, "Weekly road fuel prices
//    (CSV) 2018 to 2026", "... (CSV) 2003 to 2017" and the XML, each with a title and an assets.publishing.service.gov.uk address (it changes every week).
//  - the CSV starts with a byte order mark and the header
//    "Date,ULSP (Ultra low sulphur unleaded petrol) Pump price in pence/litre,ULSD (...) Pump price in pence/litre,... Duty rate in pence/litre,...,... VAT percentage rate,..."
//    then one row per week, dd/mm/yyyy, e.g. "12/10/2026,175.28,200.04,52.95,52.95,20,20".
// CSV_TEXT and CONTENT_ATTACHMENTS (./fixtures.ts) are real copies. Only the number of weeks is reduced.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeDaily } from "../../lib/library/store";
import { InputError, SourceError } from "../../lib/http";
import { CONTENT_ATTACHMENTS, CSV_TEXT } from "./fixtures";
import def from "./index";
import {
  CONTENT_API, INFO, csvCandidates, desnzAnswer, desnzFuelNow, desnzHarvest, desnzHistoryKey, desnzMonthly, desnzBackfill, desnzResult, desnzRows, harvestOptions, parseDesnzCsv,
  previousOf, yearEarlierOf,
} from "./source";

const NOW = new Date("2026-10-14T12:00:00Z");
const content = { details: { attachments: CONTENT_ATTACHMENTS } };

function libraryWithFixture(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "desnz-lib-"));
  process.env.PROOFPRICE_LIBRARY_DIR = dir;
  writeDaily(INFO.id, desnzResult(parseDesnzCsv(CSV_TEXT)));
  return dir;
}

test("discovery: the newest CSV table comes first, the old 2003 to 2017 table last, Excel and XML never", () => {
  assert.deepEqual(csvCandidates(content), [
    "https://assets.publishing.service.gov.uk/media/6acd0403ec9d3aba1e013c7b/CSV__2018_-__.csv",
    "https://assets.publishing.service.gov.uk/media/68a3326b32d2c63f869343a3/weekly_road_fuel_prices_2003_to_2017.csv",
  ]);
  assert.deepEqual(csvCandidates({ details: { attachments: [{ title: "Weekly road fuel prices (Excel)", url: "https://x/y.xlsx", content_type: "application/vnd.ms-excel" }] } }), []);
  assert.deepEqual(csvCandidates({}), []);
  // next year's table is preferred automatically
  const next = [{ title: "Weekly road fuel prices (CSV) 2018 to 2027", url: "https://x/new.csv", content_type: "text/csv" }, ...CONTENT_ATTACHMENTS];
  assert.equal(csvCandidates({ details: { attachments: next } })[0], "https://x/new.csv");
});

test("parseDesnzCsv: dates, pence per litre, duty and VAT; oldest first", () => {
  const w = parseDesnzCsv(CSV_TEXT);
  assert.equal(w.length, 59);
  assert.equal(w[0].date, "2025-09-01");
  const last = w[w.length - 1];
  assert.deepEqual(last, { date: "2026-10-12", ulsp: 175.28, ulsd: 200.04, ulspDuty: 52.95, ulsdDuty: 52.95, ulspVat: 20, ulsdVat: 20 });
  assert.equal(w.find((x) => x.date === "2026-10-05")?.ulsd, 199.52);
  assert.equal(w.find((x) => x.date === "2025-10-13")?.ulsp, 134.81);
  assert.equal(w.find((x) => x.date === "2025-10-13")?.ulsd, 142.99);
});

test("parseDesnzCsv: a changed file is refused with a plain message", () => {
  assert.throws(() => parseDesnzCsv(""), /is empty/);
  assert.throws(() => parseDesnzCsv("Date,Something\n01/01/2026,1"), /new layout/);
  assert.throws(() => parseDesnzCsv(CSV_TEXT.replace(/pence\/litre/g, "pounds")), /no longer says pence\/litre/);
  const lines = CSV_TEXT.split("\n");
  assert.throws(() => parseDesnzCsv([lines[0], ...lines.slice(1, 20)].join("\n")), /only 19 usable weeks/);
  // a price in pounds instead of pence would be a thousand-fold error in the answer
  const pounds = CSV_TEXT.replace("175.28,200.04", "1.7528,2.0004");
  assert.throws(() => parseDesnzCsv(pounds), /not a plausible pence-per-litre figure/);
  // blank and malformed rows are skipped, not turned into zeros
  const messy = CSV_TEXT + "\n,,,,,,\n99/99/2026,1,2,3,4,5,6\n19/10/2026,,201,52.95,52.95,20,20\n";
  assert.equal(parseDesnzCsv(messy).length, 59);
});

test("previous week and the same week a year earlier", () => {
  const w = parseDesnzCsv(CSV_TEXT);
  assert.equal(previousOf(w)?.date, "2026-10-05");
  assert.equal(yearEarlierOf(w)?.date, "2025-10-13");
  assert.equal(yearEarlierOf(w.slice(-20)), null);
  assert.equal(previousOf(w.filter((x) => x.date !== "2026-10-05"))?.date, "2026-09-28");
  assert.equal(previousOf(w.slice(-1)), null);
});

test("library rows: pounds per litre, dated earlier weeks, duty and VAT", () => {
  const rows = desnzRows(parseDesnzCsv(CSV_TEXT));
  assert.ok(rows.every((r) => r.area === "ALL" && Number.isNaN(r.n) && r.median === r.low && r.low === r.high && r.high === r.min && r.min === r.max));
  const get = (item: string) => rows.find((r) => r.item === item)?.median;
  assert.equal(get("petrol95"), 1.7528);
  assert.equal(get("diesel"), 2.0004);
  assert.equal(get("diesel@2026-10-05"), 1.9952);
  assert.equal(get("diesel@2025-10-13"), 1.4299);
  assert.equal(get("petrol95@2025-10-13"), 1.3481);
  assert.equal(get("diesel:duty"), 0.5295);
  assert.equal(get("diesel:vat"), 20);
  assert.equal(rows.length, 10);
});

function fakeGov(opts: { csvStatus?: number; firstBad?: boolean } = {}) {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: any) => {
    const u = String(url);
    calls.push(u);
    if (u === CONTENT_API) return new Response(JSON.stringify({ details: { attachments: CONTENT_ATTACHMENTS } }), { status: 200, headers: { "content-type": "application/json" } });
    if (u.endsWith("CSV__2018_-__.csv")) return opts.csvStatus ? new Response("busy", { status: opts.csvStatus }) : new Response(opts.firstBad ? "Date,Nothing\n" : CSV_TEXT, { status: 200 });
    if (u.endsWith("weekly_road_fuel_prices_2003_to_2017.csv")) return new Response("Date,Nothing\n01/01/2003,1", { status: 200 });
    return new Response("nope", { status: 404 });
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = original) };
}

test("harvest end to end (fake gov.uk): finds the CSV through the Content API and returns the newest week", async () => {
  harvestOptions.retryDelayMs = 0;
  const site = fakeGov();
  try {
    const h = await desnzHarvest();
    assert.deepEqual(site.calls, [CONTENT_API, "https://assets.publishing.service.gov.uk/media/6acd0403ec9d3aba1e013c7b/CSV__2018_-__.csv"]);
    assert.equal(h.date, "2026-10-12");
    assert.equal(h.currency, "GBP");
    assert.equal(h.unit, "per litre");
    assert.ok(h.rows.some((r) => r.item === "diesel" && r.median === 2.0004));
    assert.match(h.note ?? "", /previous week 2026-10-05, year earlier 2025-10-13/);
  } finally {
    site.restore();
  }
  const down = fakeGov({ csvStatus: 503 });
  try {
    await assert.rejects(desnzHarvest(), (e: any) => e instanceof SourceError);
  } finally {
    down.restore();
  }
  const bad = fakeGov({ firstBad: true });
  try {
    await assert.rejects(desnzHarvest(), /new layout/);
  } finally {
    bad.restore();
  }
});

test("answer from the library: the published UK average, with the change on the week and the year", async () => {
  libraryWithFixture();
  try {
    const a = await desnzFuelNow({ fuel: "diesel" }, NOW);
    assert.equal(a.status, "ok");
    assert.equal(a.price_type, "official_statistic");
    assert.equal(a.confidence, "high");
    assert.equal(a.price?.currency, "GBP");
    assert.equal(a.price?.unit, "per litre");
    assert.equal(a.price?.measure, "average");
    assert.equal(a.price?.value, 2.0004);
    assert.equal(a.price?.median, null);
    assert.equal(a.price?.typical_low, null);
    assert.equal(a.sample_size, null);
    assert.deepEqual(a.period, { from: "2026-10-12", to: "2026-10-12" });
    assert.equal(a.statistic?.reference_period, "2026-10-12");
    assert.match(a.summary, /^The average UK pump price of diesel \(ULSD\) was 200\.04 pence per litre \(£2\.0004\) in DESNZ's weekly road fuel prices for the week dated 12 October 2026/);
    assert.match(a.summary, /0\.3% higher than the previous week \(5 October 2026\) and 39\.9% higher than a year earlier \(13 October 2025\)\./);
    assert.match(a.summary, /Official average published by Department for Energy Security and Net Zero \(DESNZ\), United Kingdom for 2026-10-12\./);
    assert.match(a.source.licence, /^Open Government Licence v3\.0/);
    assert.equal(a.source.licence_url, "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/");
    assert.ok(!a.statistic?.note);
    const x = a.extra as any;
    assert.equal(x.price_pence_per_litre, 200.04);
    assert.equal(x.change_on_previous_week.change_pence_per_litre, 0.52);
    assert.equal(x.change_on_previous_week.change_percent, 0.3);
    assert.equal(x.change_on_year_earlier.price_pence_per_litre, 142.99);
    assert.equal(x.change_on_year_earlier.change_percent, 39.9);
    assert.equal(x.fuel_duty_pence_per_litre, 52.95);
    assert.equal(x.vat_percent, 20);
    assert.equal(x.petrol95_price_pence_per_litre, 175.28);

    const p = await desnzFuelNow({ fuel: "petrol95" }, NOW);
    assert.equal(p.price?.value, 1.7528);
    assert.match(p.summary, /unleaded petrol \(ULSP\) was 175\.28 pence per litre \(£1\.7528\)/);
    assert.match(p.summary, /30% higher than a year earlier \(13 October 2025\)/);
  } finally {
    delete process.env.PROOFPRICE_LIBRARY_DIR;
  }
});

test("a place or postcode is answered nationally, and says so", async () => {
  libraryWithFixture();
  try {
    const a = await desnzFuelNow({ fuel: "diesel", town: "Leeds", postcode: "LS1 4AP" }, NOW);
    assert.equal(a.status, "ok");
    assert.equal(a.price?.value, 2.0004);
    assert.match(a.summary, /^The United Kingdom is covered by one national average only \(you asked about postcode LS1 4AP, Leeds\)\./);
    assert.match(a.statistic?.note ?? "", /UK national average, not a price for that place/);
    assert.equal((a.extra as any).answered_as, "UK national average");
  } finally {
    delete process.env.PROOFPRICE_LIBRARY_DIR;
  }
});

test("old data is flagged plainly", async () => {
  libraryWithFixture();
  try {
    assert.ok(!(await desnzFuelNow({ fuel: "diesel" }, new Date("2026-10-26T00:00:00Z"))).statistic?.note); // 14 days
    const old = await desnzFuelNow({ fuel: "diesel" }, new Date("2026-11-20T00:00:00Z"));
    assert.match(old.summary, /This is old data: 39 days have passed since that week\./);
    assert.match(old.statistic?.note ?? "", /newest week we hold is dated 12 October 2026, 39 days ago/);
  } finally {
    delete process.env.PROOFPRICE_LIBRARY_DIR;
  }
});

test("input errors and missing data", async () => {
  libraryWithFixture();
  try {
    for (const fuel of ["petrol98", "e10", "lpg", "methane", "e85"]) {
      await assert.rejects(desnzFuelNow({ fuel }, NOW), (e: any) => e instanceof InputError && /petrol95 \(unleaded petrol, ULSP\) or diesel \(ULSD\)/.test(e.message));
    }
  } finally {
    delete process.env.PROOFPRICE_LIBRARY_DIR;
  }
  const none = desnzAnswer({ date: "2026-10-12", rows: [] }, { fuel: "diesel" }, NOW);
  assert.equal(none.status, "no_matches");
  assert.equal(none.price, null);
  process.env.PROOFPRICE_LIBRARY_DIR = mkdtempSync(path.join(tmpdir(), "desnz-empty-"));
  try {
    await assert.rejects(desnzFuelNow({ fuel: "diesel" }), (e: any) => e instanceof SourceError && /Not yet available/.test(e.message));
  } finally {
    delete process.env.PROOFPRICE_LIBRARY_DIR;
  }
});

test("history key: the UK national series for petrol95 and diesel", () => {
  assert.deepEqual(desnzHistoryKey({ fuel: "diesel" }), { area: "ALL", item: "diesel", label: "the United Kingdom (national average)" });
  assert.equal(desnzHistoryKey({ fuel: "petrol95" })?.item, "petrol95");
  assert.equal(desnzHistoryKey({ fuel: "lpg" }), null);
});

test("manifest and INFO: GB only, the examples, the licence quoted from gov.uk", () => {
  assert.deepEqual(def.countries, ["GB"]);
  assert.equal(def.category, "fuel");
  assert.deepEqual(def.examples[0].params, { country: "GB", fuel: "diesel" });
  assert.ok(def.harvest && def.historyKey);
  assert.equal(INFO.price_type, "official_statistic");
  assert.match(INFO.licence, /All content is available under the Open Government Licence v3\.0, except where otherwise stated/);
  assert.equal(INFO.homepage, "https://www.gov.uk/government/statistics/weekly-road-fuel-prices");
  assert.match(INFO.limits, /whole United Kingdom/);
});

test("backfill: monthly mean, cheapest and dearest week; thin months and duplicate weeks handled", () => {
  const wk = (date: string, ulsp: number, ulsd: number) => ({ date, ulsp, ulsd, ulspDuty: null, ulsdDuty: null, ulspVat: null, ulsdVat: null });
  const weeks = [
    wk("2003-06-09", 74.5, 76.5), wk("2003-06-16", 74.5, 76.5), wk("2003-06-16", 74.5, 76.5), wk("2003-06-23", 75.5, 77.5), wk("2003-06-30", 75.5, 77.5),
    wk("2003-07-07", 74, 76), wk("2003-07-14", 74, 76), // only 2 weeks: left out
  ];
  const p = desnzMonthly(weeks, "2003-01", "2003-12");
  assert.equal(p.length, 1);
  assert.equal(p[0].period, "2003-06");
  const petrol = p[0].rows.find((r) => r.item === "petrol95")!;
  assert.equal(petrol.median, 0.75);
  assert.equal(petrol.low, 0.745);
  assert.equal(petrol.high, 0.755);
  assert.ok(Number.isNaN(petrol.n));
  assert.equal(petrol.area, "ALL");
  assert.equal(desnzMonthly(weeks, "2004-01", "2004-12").length, 0);
});

test("backfill: merges the old and new CSV through the Content API", async () => {
  const old = "Date,ULSP (Ultra low sulphur unleaded petrol) Pump price in pence/litre,ULSD (Ultra low sulphur diesel) Pump price in pence/litre\n" +
    Array.from({ length: 60 }, (_, i) => `${String(1 + ((i * 7) % 28)).padStart(2, "0")}/${String(1 + Math.floor(i / 4) % 12).padStart(2, "0")}/${2003 + Math.floor(i / 48)},70.${i % 10},72.${i % 10}`).join("\n");
  const real = globalThis.fetch;
  harvestOptions.retryDelayMs = 0;
  globalThis.fetch = (async (url: any) => {
    const u = String(url);
    if (u.startsWith(CONTENT_API)) return new Response(JSON.stringify({ details: { attachments: [
      { title: "Weekly road fuel prices (CSV) 2018 to 2026", url: "https://x.test/new.csv" },
      { title: "Weekly road fuel prices (CSV) 2003 to 2017", url: "https://x.test/old.csv" } ] } }), { headers: { "content-type": "application/json" } });
    return new Response(u.endsWith("new.csv") ? CSV_TEXT : old);
  }) as typeof fetch;
  try {
    const r = await desnzBackfill("2003-01-01", "2026-09-30");
    assert.equal(r.currency, "GBP");
    assert.equal(r.unit, "per litre");
    assert.ok(r.periods.length > 3);
    for (const per of r.periods) for (const row of per.rows) assert.ok(row.median > 0.3 && row.median < 3);
  } finally {
    globalThis.fetch = real;
  }
});
