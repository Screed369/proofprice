// Real format: fixtures.ts holds the header and the rows of five Cariboo municipalities (Jan-Jul 2026) copied from the live
// municipal_monthly_2026.csv on 2026-10-21 (GitHub probe bcptt-1). Package/resource names come from the real package_show of the 2025 dataset (probe bcptt-2).
// Other places (Kelowna etc.) are SYNTHETIC rows in the same layout, marked as such.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeDaily, writeMeta } from "../../lib/library/store";
import { InputError, SourceError } from "../../lib/http";
import { INFO, bcHarvest, bcHomeSales, fold, harvestOptions, itemOf, parseArea, parseMunicipalMonthly, resolvePlace, shortName, snapshotOf, splitCsvLine, stripCode } from "./source";
import type { Place } from "./source";
import plugin from "./index";
import { CSV_2026 } from "./fixtures";

const rows = parseMunicipalMonthly(CSV_2026);
const snap = snapshotOf(rows);
const row = (area: string, months = 3) => snap.rows.find((r) => r.area === area && r.item === itemOf(months));

test("parseMunicipalMonthly reads the real file by column name, strips the numeric codes, skips unusable cells", () => {
  assert.equal(rows.length, 35);
  const q = rows.filter((r) => r.name === "City of Quesnel");
  assert.equal(q.length, 7);
  assert.equal(q[0].district, "Cariboo");
  assert.deepEqual([q[0].year, q[0].month, q[0].n], [2026, 1, 6]);
  assert.equal(stripCode("470 - City of Quesnel"), "City of Quesnel");
  assert.equal(stripCode("572 -"), "");
  assert.throws(() => parseMunicipalMonthly("a,b\n1,2\n"), SourceError);
  // 'nr' (suppressed) in a needed cell: the row is skipped, never read as zero
  const h = "DevelopmentRegion,RegionalDistrict,Municipality,Year,Month,n_res_trans,sum_FMV_res";
  assert.equal(parseMunicipalMonthly(`${h}\nX,01 - Y,1 - City of Z,2026,3,nr,nr\nX,01 - Y,1 - City of Z,2026,4,6,\"2,000.00\"\nX,01 - Y,1 - City of Z,2026,4,6,1800000.00\n`).length, 1);
  assert.deepEqual(splitCsvLine('a,"b,c",d'), ["a", "b,c", "d"]);
});

test("snapshotOf: 3-month average per area ending at the newest month; the 12-month window is skipped when the files hold only 7 months", () => {
  assert.equal(snap.date, "2026-07-31");
  assert.deepEqual(snap.windows, [3]);
  // May-Jul: 8+20+20 transfers, total 23,354,830 -> 486,559
  const q = row("m|City of Quesnel")!;
  assert.equal(q.n, 48);
  assert.equal(q.median, 486559);
  assert.equal(row("m|Quesnel Rural")!.median, 314831);
  assert.equal(row("rd|Cariboo")!.n, 406);
  assert.equal(row("ALL")!.median, 401607);
  // all five stats repeat the average (BC publishes no distribution)
  assert.ok(snap.rows.every((r) => r.low === r.median && r.high === r.median && r.min === r.median && r.max === r.median));
  assert.ok(snap.rows.every((r) => r.n >= 5));
});

test("snapshotOf: under 5 transfers gives no row (Wells Feb-Apr = 5 is kept, Mar-Apr alone would be 4); 12 months appear when all 12 are present", () => {
  const wells = rows.filter((r) => r.name === "District of Wells");
  assert.equal(snapshotOf(wells.filter((r) => r.month <= 4)).rows.find((r) => r.area === "m|District of Wells")?.n, 5);
  const two = wells.filter((r) => r.month === 3 || r.month === 4); // 0 + 4 transfers, but the 3-month window needs Feb: not complete
  assert.deepEqual(snapshotOf(two).windows, []);
  assert.equal(snapshotOf(two).rows.length, 0);
  // SYNTHETIC: 12 months of 6 transfers worth 3.6 million (600,000 each) in one place
  const twelve = Array.from({ length: 12 }, (_, i) => ({ year: 2025 + (i >= 6 ? 1 : 0), month: ((i + 6) % 12) + 1, district: "Okanagan", name: "City of Kelowna", n: 6, value: 3600000 }));
  const s12 = snapshotOf(twelve);
  assert.deepEqual(s12.windows, [3, 12]);
  assert.equal(s12.date, "2026-06-30");
  const k12 = s12.rows.find((r) => r.area === "m|City of Kelowna" && r.item === "residential/12m")!;
  assert.deepEqual([k12.n, k12.median], [72, 600000]);
  assert.throws(() => snapshotOf([]), SourceError);
});

test("places: area keys, short names, folding", () => {
  assert.equal(shortName("City of Quesnel"), "Quesnel");
  assert.equal(shortName("Resort Municipality of Whistler"), "Whistler");
  assert.equal(shortName("Quesnel Rural"), "Quesnel Rural");
  assert.equal(shortName("100 Mile House"), "100 Mile House");
  assert.equal(parseArea("ALL")?.kind, "province");
  assert.deepEqual(parseArea("m|City of Quesnel"), { key: "m|City of Quesnel", kind: "municipality", label: "City of Quesnel", short: "Quesnel" });
  assert.equal(parseArea("rd|Cariboo")?.label, "Cariboo regional district");
  assert.equal(parseArea("zz|x"), null);
  assert.equal(fold("Prince George, B.C."), "prince george b c");
});

const places = snap.rows.map((r) => parseArea(r.area)).filter((p): p is Place => !!p).filter((p, i, a) => a.findIndex((q) => q.key === p.key) === i);

test("resolvePlace: city beats rural area of the same name, rural area by its own name, district, province, 'Quesnel, BC'", () => {
  assert.equal(resolvePlace("Quesnel", places).key, "m|City of Quesnel");
  assert.equal(resolvePlace("Quesnel, BC", places).key, "m|City of Quesnel");
  assert.equal(resolvePlace("quesnel rural", places).key, "m|Quesnel Rural");
  assert.equal(resolvePlace("Williams Lake", places).key, "m|City of Williams Lake");
  assert.equal(resolvePlace("Cariboo", places).key, "rd|Cariboo");
  assert.equal(resolvePlace("District of Wells", places).key, "m|District of Wells");
  assert.equal(resolvePlace(undefined, places).key, "ALL");
  assert.equal(resolvePlace("British Columbia", places).key, "ALL");
  assert.throws(() => resolvePlace("Toronto", places), (e: any) => e instanceof InputError && /Give a British Columbia/.test(e.message));
  assert.throws(() => resolvePlace("Lake", places), InputError); // matches two municipalities: no guessing
});

// ---------- end to end from a temporary library ----------

function library(extra: { area: string; item: string; n: number; v: number }[] = []) {
  process.env.PROOFPRICE_LIBRARY_DIR = mkdtempSync(path.join(tmpdir(), "bc-lib-"));
  const rowsOut = [...snap.rows, ...extra.map((e) => ({ area: e.area, item: e.item, n: e.n, median: e.v, low: e.v, high: e.v, min: e.v, max: e.v }))];
  const h = { date: snap.date, currency: "CAD", unit: "per home (average declared fair market value)", rows: rowsOut };
  writeDaily(INFO.id, h);
  writeMeta(INFO.id, { source: INFO.id, currency: "CAD", unit: h.unit, first_date: h.date, last_date: h.date, days: 1, last_harvest_at: "x", last_rows: rowsOut.length, last_ok_at: "x", last_error: null, note: "t" });
}

test("bcHomeSales: Quesnel gives the average, the sample size, the period and the honest wording", async () => {
  library();
  try {
    const a = await bcHomeSales({ town: "Quesnel" });
    assert.equal(a.status, "ok");
    assert.equal(a.price!.currency, "CAD");
    assert.equal(a.price!.value, 486559);
    assert.equal(a.price!.measure, "average");
    assert.equal(a.price!.median, null);
    assert.equal(a.sample_size, 48);
    assert.deepEqual(a.period, { from: "2026-05-01", to: "2026-07-31" });
    assert.equal(a.statistic?.reference_period, "2026-05 to 2026-07");
    assert.match(a.summary, /average declared fair market value/);
    assert.match(a.summary, /not a median/);
    assert.match(a.summary, /48 residential property transfers/);
    assert.match(JSON.stringify(a.source), /Open Government Licence - British Columbia/);
    assert.equal(a.price_type, "official_statistic");
    const p = await bcHomeSales({});
    assert.equal(p.price!.value, 401607);
    assert.match(p.summary, /British Columbia/);
  } finally {
    delete process.env.PROOFPRICE_LIBRARY_DIR;
  }
});

test("bcHomeSales: default window widens from a thin 3 months to 12 months, and months asks for one", async () => {
  library([
    { area: "m|City of Kelowna", item: "residential/3m", n: 7, v: 900000 }, // SYNTHETIC: thin 3 months
    { area: "m|City of Kelowna", item: "residential/12m", n: 80, v: 950000 }, // SYNTHETIC
  ]);
  try {
    const a = await bcHomeSales({ town: "Kelowna" });
    assert.equal(a.price!.value, 950000);
    assert.equal((a.extra as any).window_months, 12);
    assert.equal((a.extra as any).other_window.average_declared_value, 900000);
    assert.equal(a.statistic?.reference_period, "2025-08 to 2026-07");
    const three = await bcHomeSales({ town: "Kelowna", months: 3 });
    assert.equal(three.price!.value, 900000);
    const twelve = await bcHomeSales({ town: "Kelowna", months: 12 });
    assert.equal(twelve.price!.value, 950000);
  } finally {
    delete process.env.PROOFPRICE_LIBRARY_DIR;
  }
});

test("bcHomeSales: input mistakes are InputErrors; an empty library says not yet", async () => {
  library();
  try {
    await assert.rejects(() => bcHomeSales({ postcode: "V1Y 1A1" }), (e: any) => e instanceof InputError && /municipality/.test(e.message));
    await assert.rejects(() => bcHomeSales({ town: "Quesnel", property_type: "house" }), (e: any) => e instanceof InputError && /must be 'any'/.test(e.message));
    await assert.rejects(() => bcHomeSales({ town: "Vancouver Island Nowhere" }), InputError);
  } finally {
    delete process.env.PROOFPRICE_LIBRARY_DIR;
  }
  process.env.PROOFPRICE_LIBRARY_DIR = mkdtempSync(path.join(tmpdir(), "bc-empty-"));
  try {
    await assert.rejects(() => bcHomeSales({ town: "Quesnel" }), /Not yet available/);
  } finally {
    delete process.env.PROOFPRICE_LIBRARY_DIR;
  }
});

// ---------- the collector, with a fake network ----------

test("bcHarvest: finds the Municipal Monthly CSV through package_show for this and last year, and builds the snapshot", async () => {
  harvestOptions.retryDelayMs = 0;
  const year = new Date().getUTCFullYear();
  const pkg = (y: number) => ({
    success: true,
    result: {
      id: "x", name: `property-transfer-tax-data-${y}`, title: "PTT", license_id: "other-open",
      resources: [
        { id: "1", name: `Provincial Monthly ${y}`, format: "csv", url: `https://catalogue.data.gov.bc.ca/p${y}.csv` },
        { id: "2", name: `Municipal Monthly ${y}`, format: "xlsx", url: `https://catalogue.data.gov.bc.ca/m${y}.xlsx` },
        { id: "3", name: `Municipal Monthly ${y}`, format: "csv", url: `https://catalogue.data.gov.bc.ca/m${y}.csv` },
      ],
    },
  });
  const seen: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: any) => {
    const url = String(input);
    seen.push(url);
    const pk = /package_show\?id=property-transfer-tax-data-(\d{4})/.exec(url);
    if (pk) return new Response(JSON.stringify(Number(pk[1]) >= year ? pkg(Number(pk[1])) : { success: false, error: { message: "Not found" } }), { status: Number(pk[1]) >= year ? 200 : 404 });
    if (url.endsWith(`m${year}.csv`)) return new Response(CSV_2026, { status: 200 });
    return new Response("nope", { status: 500 });
  }) as typeof fetch;
  try {
    const h = await bcHarvest();
    assert.equal(h.date, "2026-07-31");
    assert.equal(h.currency, "CAD");
    assert.ok(h.rows.find((r) => r.area === "m|City of Quesnel" && r.median === 486559));
    assert.ok(seen.some((u) => u.includes(`/m${year}.csv`)));
    assert.ok(!seen.some((u) => u.endsWith(".xlsx")));
  } finally {
    globalThis.fetch = real;
  }
});

test("bcHarvest: a source outage is a SourceError, not an empty snapshot", async () => {
  harvestOptions.retryDelayMs = 0;
  const real = globalThis.fetch;
  globalThis.fetch = (async () => new Response("down", { status: 503 })) as typeof fetch;
  try {
    await assert.rejects(() => bcHarvest(), SourceError);
  } finally {
    globalThis.fetch = real;
  }
});

test("manifest: CA, home-sales, first example is a smoke test with a town, harvest present", () => {
  assert.deepEqual(plugin.countries, ["CA"]);
  assert.equal(plugin.category, "home-sales");
  assert.equal(plugin.examples![0].params.town, "Kelowna");
  assert.equal(typeof plugin.harvest, "function");
  assert.throws(() => plugin.historyKey!({} as any), InputError);
});
