// Real formats, checked live on 2026-11-05:
//  - fixtures/search.json: the data.gov.au CKAN package_search answer for organisation department-of-justice-tasmania, trimmed to three packages
//    (FY2026-27 with July and August 2026, FY2024-25 which also holds the files up to June 2026, and an old 2016 package that must be ignored).
//  - the August 2026 workbook (220 978 bytes): sheets "Active Bonds" (1 187 rows) and "Closed Bonds"; row 1 is just the word "Active", row 2 the header
//    Suburb | State | Postcode | Bond Amount | Weekly Rent | Bond Lodgement date | Bond Activation date | Number of Bedrooms | Dwelling / Premises Type |
//    Length of Tenancy (In Months) | Housing Type; dates are Excel serial numbers. REAL_ROWS below are rows copied from it.
//    In the real May to August 2026 files the median bond is exactly 4.0 weeks of rent (the outside check used by the collector).
// The larger data sets in these tests are SYNTHETIC, in the same layout.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { makeXlsx } from "../../tests/helpers/make-zip";
import { readXlsx } from "../../categories/rent/xlsx";
import { writeDaily, writeMeta } from "../../lib/library/store";
import {
  INFO, consecutiveRun, dwelling, harvestOptions, medianBondWeeks, monthEnd, parseBonds, parseMonthFiles, tasAnswerFromRow, tasArea, tasBeds, tasDailyRows,
  tasHarvest, tasHistoryKey, tasItem, tasRents, tasType, windowStart, type Bond,
} from "./source";
import manifest from "./index";

const SEARCH = JSON.parse(readFileSync(new URL("./fixtures/search.json", import.meta.url), "utf8"));

const HEADER = ["Suburb", "State", "Postcode", "Bond Amount", "Weekly Rent", "Bond Lodgement date", "Bond Activation date", "Number of Bedrooms", "Dwelling / Premises Type", "Length of Tenancy (In Months)", "Housing Type"];
const REAL_ROWS: (string | number)[][] = [
  ["EAST DEVONPORT", "Tasmania", "7310", 1005, 251.25, 46247.2822, 46252.3372, 1, "Unit", "17", "Private housing"],
  ["SNUG", "Tasmania", "7054", 1920, 480, 46238.1336, 46241.3364, 2, "Apartment", "12", "Private housing"],
  ["BRIDGEWATER", "Tasmania", "7030", 2360, 590, 46245.2402, 46250.3, 3, "Separate House", "12", "Private housing"],
  ["SUMMERHILL", "Tasmania", "7250", 1480, 370, 46236.948, 46240.3, 2, "Unit", "No Fixed Period", "Private housing"],
  ["BLACKSTONE HEIGHTS", "Tasmania", "7250", 1600, 400, 46237.007, 46240.3, 3, "Townhouse", "20", "Private housing"],
];
const sheetOf = (rows: (string | number)[][]) => ({ "Active Bonds": [["Active"], HEADER, ...rows], "Closed Bonds": [["Closed"], [...HEADER, "Bond Closed date"]] });

test("package search: monthly .xlsx files only, newest first, two-digit years and old packages handled", () => {
  const files = parseMonthFiles(SEARCH);
  assert.equal(files[0].month, "2026-08");
  assert.match(files[0].url, /abs-report-august-2026\.xlsx$/);
  assert.equal(files[1].month, "2026-07");
  assert.ok(files.some((f) => f.month === "2024-09")); // abs-report-september-24.xlsx
  assert.ok(!files.some((f) => f.month === "2025-03")); // that month is an .xls file
  assert.equal(new Set(files.map((f) => f.month)).size, files.length);
  assert.ok(files.every((f) => f.url.endsWith(".xlsx")));
  assert.throws(() => parseMonthFiles({ nope: 1 }), /unexpected answer/);
  // the run stops at the missing March 2025
  const run = consecutiveRun(files).map((f) => f.month);
  assert.equal(run[0], "2026-08");
  assert.equal(run[run.length - 1], "2025-04");
  assert.equal(run.length, 17);
  assert.deepEqual(consecutiveRun([]), []);
});

test("real workbook layout: title row, header by name, strays and social housing dropped", () => {
  const sheets = readXlsx(makeXlsx(sheetOf(REAL_ROWS)));
  assert.equal(sheets[0].name, "Active Bonds");
  const bonds = parseBonds(sheets[0].rows, "2026-08");
  assert.equal(bonds.length, 5);
  assert.deepEqual(bonds[0], { postcode: "7310", suburb: "EAST DEVONPORT", type: "apartment", beds: 1, rent: 251.25, bond: 1005 });
  assert.equal(bonds[2].type, "house");
  assert.equal(bonds[4].type, "house"); // townhouse
  const odd = parseBonds(
    [
      HEADER,
      ["A", "Tasmania", "7000", 2000, 500, 46247, 0, 2, "Unit", "12", "Community housing"], // social housing
      ["B", "Tasmania", "7000", 2000, 500, 46100, 0, 2, "Unit", "12", "Private housing"], // lodged in another month
      ["C", "Tasmania", "7000", 2000, 8650, 46247, 0, 2, "Unit", "12", "Private housing"], // absurd rent
      ["D", "Tasmania", "7000", 100, 10, 46247, 0, 2, "Unit", "12", "Private housing"], // absurd rent
      ["E", "Tasmania", "7000", 2000, 500, 46247, 0, 23, "Unit", "12", "Private housing"], // 23 bedrooms
      ["F", "Tasmania", "3000", 2000, 500, 46247, 0, 2, "Unit", "12", "Private housing"], // not a Tasmanian postcode
      ["G", "Tasmania", "7000", 2000, 500, 46247, 0, 2, "Garage", "12", "Private housing"], // not a home
      ["H", "Tasmania", "7000", 2000, 500, 46247, 0, "x", "Cabin", "12", "Private housing"], // unknown type and bedrooms
    ],
    "2026-08",
  );
  assert.deepEqual(odd, [{ postcode: "7000", suburb: "H", type: "other", beds: null, rent: 500, bond: 2000 }]);
  assert.throws(() => parseBonds([["a", "b"]], "2026-08"), /new layout/);
  assert.throws(() => parseBonds([["Postcode", "Weekly Rent"], ["7000", 500]], "2026-08"), /new layout/);
  assert.equal(dwelling("Semi-detached"), "house");
  assert.equal(dwelling("Flat"), "apartment");
  assert.equal(dwelling("Car space"), "skip");
});

test("outside check: median bond is four weeks of rent", () => {
  const bonds = parseBonds(readXlsx(makeXlsx(sheetOf(REAL_ROWS)))[0].rows, "2026-08");
  assert.ok(Math.abs(medianBondWeeks(bonds)! - 4) < 0.01);
  assert.equal(medianBondWeeks([]), null);
});

/** SYNTHETIC bonds: postcode 7000 (suburb HOBART) flats and houses, 8 per month in each of a few sizes. */
function bondsFor(rentBase: number): Bond[] {
  const out: Bond[] = [];
  const mk = (postcode: string, suburb: string, type: Bond["type"], beds: number | null, rent: number): Bond => ({ postcode, suburb, type, beds, rent, bond: rent * 4 });
  for (let i = 0; i < 8; i++) {
    out.push(mk("7000", "HOBART", "apartment", 2, rentBase + i * 10));
    out.push(mk("7000", "HOBART", "apartment", 1, rentBase - 100 + i * 10));
    out.push(mk("7000", "HOBART", "house", 3, rentBase + 200 + i * 10));
    out.push(mk("7250", "LAUNCESTON", "other", null, 400 + i));
  }
  return out;
}
const MONTHS = ["2026-08", "2026-07", "2026-06", "2026-05", "2026-04", "2026-03", "2026-02", "2026-01", "2025-12", "2025-11", "2025-10", "2025-09"];

test("window arithmetic", () => {
  assert.equal(monthEnd("2026-08"), "2026-08-31");
  assert.equal(windowStart("2026-08", 3), "2026-06-01");
  assert.equal(windowStart("2026-08", 12), "2025-09-01");
  assert.equal(tasItem("apartment", "2", 3), "apartment:2:3m");
});

test("daily rows: windows, types, bedrooms, postcode, suburb and state level", () => {
  const { date, rows } = tasDailyRows(MONTHS.map((m, i) => ({ month: m, bonds: bondsFor(500 + i) })));
  assert.equal(date, "2026-08-31");
  const get = (area: string, item: string) => rows.find((r) => r.area === area && r.item === item);
  const flats2 = get("7000", "apartment:2:3m")!;
  assert.equal(flats2.n, 24);
  assert.equal(get("7000", "apartment:2:12m")!.n, 96);
  assert.ok(flats2.low <= flats2.median && flats2.median <= flats2.high);
  assert.equal(get("HOBART", "apartment:2:3m")!.n, 24); // the same bonds by suburb
  assert.equal(get("7000", "house:3:3m")!.n, 24);
  assert.equal(get("7000", "any:any:3m")!.n, 72);
  assert.equal(get("7250", "any:any:3m")!.n, 24); // unrecognised type counts in 'any' only
  assert.equal(get("7250", "house:any:3m"), undefined);
  assert.equal(get("7250", "any:2:3m"), undefined); // unknown bedrooms only count in 'any'
  assert.equal(get("ALL", "any:any:3m")!.n, 32 * 3);
  const short = tasDailyRows(MONTHS.slice(0, 6).map((m) => ({ month: m, bonds: bondsFor(500) })));
  assert.ok(short.rows.some((r) => r.item.endsWith(":3m")));
  assert.ok(!short.rows.some((r) => r.item.endsWith(":12m")));
  assert.throws(() => tasDailyRows(MONTHS.slice(0, 2).map((m) => ({ month: m, bonds: bondsFor(500) }))), /at least 3/);
});

test("input checks", () => {
  assert.deepEqual(tasArea({ postcode: "7000" }), { area: "7000", label: "postcode 7000" });
  assert.deepEqual(tasArea({ town: "7250" }), { area: "7250", label: "postcode 7250" });
  assert.equal(tasArea({ town: "Tasmania" }).area, "ALL");
  assert.deepEqual(tasArea({ town: "new norfolk" }), { area: "NEW NORFOLK", label: "New Norfolk" });
  assert.throws(() => tasArea({ postcode: "2000" }), /starts with 7/);
  assert.throws(() => tasArea({}), /postcode or suburb/);
  assert.equal(tasType("apartment").type, "apartment");
  assert.throws(() => tasType("room"), /rooms/);
  assert.deepEqual(tasBeds(7), { key: "4", label: "4+ bedroom " });
  assert.equal(tasBeds(undefined).key, "any");
});

test("routing: 7xxx postcodes and Tasmanian places come here, other Australian postcodes do not", () => {
  const s = manifest.serves!;
  assert.equal(s({ country: "AU", postcode: "7000" }), true);
  assert.equal(s({ country: "AU", town: "7250" }), true);
  assert.equal(s({ country: "AU", town: "Launceston" }), true);
  assert.equal(s({ country: "AU", town: "TAS" }), true);
  assert.equal(s({ country: "AU", postcode: "2000" }), false);
  assert.equal(s({ country: "AU", town: "Sydney" }), false);
});

/** A fake data.gov.au: a package_search answer listing the 12 months, and one synthetic workbook per month. */
function fakeSite(opts: { failMonthsBefore?: string; wrongRentColumn?: boolean } = {}) {
  const calls: string[] = [];
  const original = globalThis.fetch;
  const urlOf = (m: string) => `https://data.gov.au/data/dataset/x/resource/y/download/abs-report-${["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"][Number(m.slice(5)) - 1]}-${m.slice(0, 4)}.xlsx`;
  const search = { result: { results: [{ name: "p", resources: MONTHS.map((m) => ({ name: m, url: urlOf(m), last_modified: "2026-09-17" })) }] } };
  globalThis.fetch = (async (url: any) => {
    const u = String(url);
    calls.push(u);
    if (u.includes("package_search")) return new Response(JSON.stringify(search), { status: 200 });
    const month = MONTHS.find((m) => urlOf(m) === u);
    if (!month || (opts.failMonthsBefore && month < opts.failMonthsBefore)) return new Response("nope", { status: 404 });
    const [y, mo] = month.split("-").map(Number);
    const serial = Math.floor(Date.UTC(y, mo - 1, 10) / 86400000) + 25569;
    const rows = bondsFor(500).map((b) => [b.suburb, "Tasmania", b.postcode, opts.wrongRentColumn ? 99 : b.bond!, b.rent, serial, serial, b.beds ?? "", b.type === "apartment" ? "Unit" : b.type === "house" ? "Separate House" : "Cabin", "12", "Private housing"]);
    return new Response(makeXlsx(sheetOf(rows)), { status: 200 });
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = original) };
}

test("harvest end to end (fake site): 12 files read, rows for 3 and 12 month windows", async () => {
  harvestOptions.retryDelayMs = 0;
  const site = fakeSite();
  try {
    const h = await tasHarvest();
    assert.equal(h.date, "2026-08-31");
    assert.equal(h.currency, "AUD");
    assert.equal(h.unit, "per week");
    assert.equal(site.calls.length, 13); // the search + 12 monthly files
    assert.ok(h.rows.some((r) => r.area === "7000" && r.item === "apartment:2:12m"));
    assert.match(h.note ?? "", /3\/12 months ending 2026-08-31/);
  } finally {
    site.restore();
  }
});

test("harvest: an older unreadable file gives shorter windows; an unreadable newest file fails; a failed bond check fails", async () => {
  harvestOptions.retryDelayMs = 0;
  let site = fakeSite({ failMonthsBefore: "2026-06" });
  try {
    const h = await tasHarvest();
    assert.ok(h.rows.some((r) => r.item.endsWith(":3m")));
    assert.ok(!h.rows.some((r) => r.item.endsWith(":12m")));
  } finally {
    site.restore();
  }
  site = fakeSite({ failMonthsBefore: "2026-09" });
  try {
    await assert.rejects(tasHarvest(), /Could not download/);
  } finally {
    site.restore();
  }
  site = fakeSite({ wrongRentColumn: true });
  try {
    await assert.rejects(tasHarvest(), /bond check/);
  } finally {
    site.restore();
  }
});

test("answers from the library: median and range in AUD per week, period, fallback to 12 months, no figure below 5 bonds", async () => {
  harvestOptions.retryDelayMs = 0;
  const dir = mkdtempSync(path.join(tmpdir(), "tas-lib-"));
  process.env.PROOFPRICE_LIBRARY_DIR = dir;
  const site = fakeSite();
  try {
    const h = await tasHarvest();
    writeDaily(INFO.id, h);
    writeMeta(INFO.id, { source: INFO.id, currency: "AUD", unit: "per week", first_date: h.date, last_date: h.date, days: 1, last_harvest_at: "x", last_rows: h.rows.length, last_ok_at: "x", last_error: null, note: h.note });
  } finally {
    site.restore();
  }
  try {
    const a = await tasRents({ postcode: "7000", property_type: "apartment", bedrooms: 2 });
    assert.equal(a.status, "ok");
    assert.equal(a.price_type, "transaction");
    assert.equal(a.price?.currency, "AUD");
    assert.equal(a.price?.unit, "per week");
    assert.ok(a.price!.typical_low! <= a.price!.median! && a.price!.median! <= a.price!.typical_high!);
    assert.ok(a.sample_size! >= 5);
    assert.deepEqual(a.period, { from: "2026-06-01", to: "2026-08-31" });
    assert.match(a.summary, /new private tenancies of 2-bedroom units and apartments in postcode 7000, Tasmania show a median agreed weekly rent of A\$\d+/);
    assert.match(a.summary, /not what sitting tenants pay/);
    assert.equal((a.extra as any).window_months, 3);
    assert.equal(a.source.licence.startsWith("Creative Commons Attribution 4.0"), true);

    const sub = await tasRents({ town: "Hobart", property_type: "house", bedrooms: 3 });
    assert.equal(sub.status, "ok");
    const none = await tasRents({ postcode: "7250", bedrooms: 2 });
    assert.equal(none.status, "no_matches");
    assert.equal(none.price, null);
    const yr = await tasRents({ postcode: "7000", months: 12 });
    assert.deepEqual(yr.period, { from: "2025-09-01", to: "2026-08-31" });
    const state = await tasRents({ town: "Tasmania" });
    assert.equal(state.status, "ok");
    assert.equal((state.query as any).town, "Tasmania");
  } finally {
    delete process.env.PROOFPRICE_LIBRARY_DIR;
  }
});

test("no library yet gives a readable error", async () => {
  process.env.PROOFPRICE_LIBRARY_DIR = mkdtempSync(path.join(tmpdir(), "tas-empty-"));
  try {
    await assert.rejects(tasRents({ postcode: "7000" }), /Not yet available.*figures appear after the next collection/);
  } finally {
    delete process.env.PROOFPRICE_LIBRARY_DIR;
  }
});

test("INFO: licence and what the rents are", () => {
  assert.match(INFO.licence, /Creative Commons Attribution 4\.0/);
  assert.equal(INFO.price_type, "transaction");
  assert.match(INFO.limits, /new tenancies, not sitting tenants/);
  assert.ok(tasAnswerFromRow(null, { area: "7000", areaLabel: "postcode 7000", typeLabel: "homes", bedLabel: "", type: "any", bedKey: "any", window: 3, triedWindows: [3, 12] }).status !== "ok");
});

test("tasHistoryKey: 3-month window by area, type and bedrooms; bad input throws", () => {
  assert.equal(tasHistoryKey({ postcode: "7000" }).item, tasItem("any", "any", 3));
  assert.equal(tasHistoryKey({ postcode: "7250", property_type: "apartment", bedrooms: 2 }).item, tasItem("apartment", "2", 3));
  assert.equal(tasHistoryKey({ town: "Tasmania" }).area, "ALL");
  assert.throws(() => tasHistoryKey({ postcode: "2000" }));
});
