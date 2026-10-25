// Real format, checked live on 2026-10-20 through the GitHub probe (rta-bond-statistics.xlsx, 6.4 MB, Last-Modified 15 Oct 2026, data to Sep Qtr 2026):
//  - sheet "Contents" (topics table, CC BY 4.0 line), "1 pc-rents" = "Median rents, by Postcode", "2 pc-new-bonds" = "Bonds lodged, by Postcode", "3 pc-all-bonds" = bonds held, ...
//  - in each postcode sheet: a link row, the title row, a description row, the header "Postcode | Dwelling" in columns C and D, a row of months (Mar Jun Sep Dec)
//    and a row of years above one column per quarter starting in column E (59 quarters, Mar 2012 .. Sep 2026), then one row per postcode x dwelling.
// The rows for postcode 4000 below are REAL (the last six quarters, Jun 2025 .. Sep 2026, copied from the probe). Postcode 4870 and the extra
// 4005 bonds are SYNTHETIC, in the same layout.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { makeXlsx } from "../../tests/helpers/make-zip";
import { readXlsx } from "../../categories/rent/xlsx";
import { writeDaily, writeMeta } from "../../lib/library/store";
import {
  INFO, WORKBOOK_URL, findSheets, harvestOptions, parseDwelling, parsePostcodeTable, qldBeds, qldDailyRows, qldHarvest, qldItem, qldKinds, qldPostcode, qldRents,
  qldHistoryKey,
} from "./source";
import type { Cell } from "../../categories/rent/xlsx";

const MONTHS = ["Jun", "Sep", "Dec", "Mar", "Jun", "Sep"];
const YEARS = [2025, 2025, 2025, 2026, 2026, 2026];
const blank = (n: number) => Array<null>(n).fill(null);
const cells = (v: (number | null)[]) => v;

const sheet = (title: string, desc: string, body: [string, string, (number | null)[]][]): (string | number | null)[][] => [
  [null, "Contents", ...blank(5), "h", "Click '+' symbol above to see previous quarters data"],
  [null, title],
  [null, desc],
  [null, null, "Postcode", "Dwelling"],
  [null, null, null, null, ...MONTHS],
  [null, null, null, null, ...YEARS],
  ...body.map(([pc, d, v]) => [null, null, Number(pc), d, ...cells(v)]),
];

// postcode, dwelling, last six quarters
const RENTS: [string, string, (number | null)[]][] = [
  ["4000", "Flat 1", [600, 600, 620, 619, 600, 625]],
  ["4000", "Flat 2", [800, 800, 825, 835, 850, 830]],
  ["4000", "Flat 3", [1070, 1150, 1200, 1100, 1295, 1200]],
  ["4000", "House 2", [null, null, null, null, null, 500]],
  ["4000", "House 3", [900, 810, null, 850, 800, 850]],
  ["4000", "House 4", [null, 800, null, null, null, 1200]],
  ["4000", "Townhouse 2", [435, null, null, null, null, 535]],
  ["4000", "Townhouse 3", [685, null, null, null, null, 800]],
  ["4870", "Flat 2", [450, 460, 470, 480, 480, 490]],
  ["4870", "House 3", [600, 610, 620, 640, 650, 660]],
  ["4870", "House 4", [700, 720, 730, 740, 750, 760]],
];
const BONDS: [string, string, (number | null)[]][] = [
  ["4000", "Flat 1", [427, 481, 404, 619, 374, 548]],
  ["4000", "Flat 2", [345, 330, 301, 422, 287, 313]],
  ["4000", "Flat 3", [48, 43, 47, 48, 45, 51]],
  ["4000", "House 2", [8, 9, 7, 9, 10, 4]],
  ["4000", "House 3", [12, 16, 7, 10, 15, 18]],
  ["4000", "House 4", [5, 5, 3, 9, 8, 4]],
  ["4000", "Townhouse 2", [3, 1, 4, 4, 4, 4]],
  ["4000", "Townhouse 3", [4, null, 6, 6, 4, 2]],
  ["4870", "Flat 2", [30, 31, 28, 35, 33, 30]],
  ["4870", "House 3", [40, 41, 38, 45, 43, 44]],
  ["4870", "House 4", [9, 10, 8, 11, 7, 12]],
];

const CONTENTS: (string | number | null)[][] = [[null, "Bond statistics data"], [null, "Select a topic from the table below"], [null, null, "Contents"]];

function workbook(opts: { rents?: typeof RENTS; bonds?: typeof BONDS; bondYears?: number[] } = {}) {
  const held = sheet("Bonds held, by Postcode", "Number of tenancy bonds held by the RTA at the last day of each quarter", BONDS);
  const b = sheet("Bonds lodged, by Postcode", "Number of new bonds lodged with the RTA during each quarter", opts.bonds ?? BONDS);
  if (opts.bondYears) b[5] = [null, null, null, null, ...opts.bondYears];
  return makeXlsx({
    Contents: CONTENTS,
    "1 pc-rents": sheet("Median rents, by Postcode", "Median value of weekly rent paid for new tenancies commencing in each quarter", opts.rents ?? RENTS),
    "2 pc-new-bonds": b,
    "3 pc-all-bonds": held,
  });
}

const tables = (wb = workbook()) => {
  const { rents, bonds } = findSheets(readXlsx(wb));
  return { rents: parsePostcodeTable(rents), bonds: parsePostcodeTable(bonds) };
};

test("parseDwelling: kind and bedrooms", () => {
  assert.deepEqual(parseDwelling("Flat 1"), { kind: "flat", beds: 1 });
  assert.deepEqual(parseDwelling("Townhouse 3"), { kind: "townhouse", beds: 3 });
  assert.deepEqual(parseDwelling(" house 4 "), { kind: "house", beds: 4 });
  assert.equal(parseDwelling("Other"), null);
  assert.equal(parseDwelling("Flat"), null);
});

test("sheets are found by their title, and the newest quarter by the month and year rows", () => {
  const { rents, bonds } = tables();
  assert.equal(rents.date, "2026-09-30");
  assert.equal(bonds.date, "2026-09-30");
  assert.equal(rents.lastCol, 9); // column J: E..J are the six quarters
  assert.equal(rents.values.size, 11);
  assert.deepEqual(rents.values.get("4000|flat-2"), { postcode: "4000", kind: "flat", beds: 2, value: 830 });
  assert.equal(rents.values.get("4000|house-2")!.value, 500);
  assert.equal(bonds.values.get("4000|flat-1")!.value, 548);
  // the "Bonds held" sheet is not mistaken for "Bonds lodged"
  assert.equal(bonds.values.get("4000|house-2")!.value, 4);
});

test("a blank latest cell means no figure", () => {
  const t = tables(workbook({ rents: RENTS.map((r) => (r[0] === "4870" && r[1] === "House 4" ? [r[0], r[1], [700, 720, 730, 740, 750, null]] : r)) as typeof RENTS }));
  assert.equal(t.rents.values.get("4870|house-4")!.value, null);
});

test("library rows: the RTA's median and its bond count; fewer than 5 bonds, no figure", () => {
  const { rents, bonds } = tables();
  const { date, rows } = qldDailyRows(rents, bonds);
  assert.equal(date, "2026-09-30");
  const get = (a: string, i: string) => rows.find((r) => r.area === a && r.item === i);
  assert.deepEqual(get("4000", "flat-2"), { area: "4000", item: "flat-2", n: 313, median: 830, low: 830, high: 830, min: 830, max: 830 });
  assert.equal(get("4000", "flat-3")!.n, 51);
  assert.equal(get("4000", "house-3")!.median, 850);
  assert.equal(get("4000", "house-2"), undefined); // 4 bonds
  assert.equal(get("4000", "house-4"), undefined); // 4 bonds
  assert.equal(get("4000", "townhouse-2"), undefined); // 4 bonds
  assert.equal(get("4000", "townhouse-3"), undefined); // 2 bonds
  assert.equal(rows.length, 7); // 4 in postcode 4000, 3 in 4870
  assert.ok(rows.every((r) => r.n >= 5));
});

test("different last quarters in the two sheets is an error, a changed layout is an error", () => {
  const { rents, bonds } = tables(workbook({ bondYears: [2025, 2025, 2025, 2026, 2026, 2025] }));
  assert.throws(() => qldDailyRows(rents, bonds), /different quarters/);
  assert.throws(() => parsePostcodeTable([["a", "b"], ["c"]]), /new layout.*Postcode \/ Dwelling/);
  assert.throws(() => parsePostcodeTable([[null, null, "Postcode", "Dwelling"], [null, null, null, null, "x"], [null, null, null, null, "y"]]), /no quarter labels/);
  assert.throws(() => findSheets([{ name: "Contents", rows: [["nothing"]] }]), /sheet was not found/);
});

test("input checks", () => {
  assert.equal(qldPostcode({ postcode: "4000" }), "4000");
  assert.equal(qldPostcode({ town: "4870" }), "4870");
  assert.throws(() => qldPostcode({ town: "Brisbane" }), /postcode is required.*'Brisbane' is not a postcode/);
  assert.throws(() => qldPostcode({ postcode: "40" }), /four digits/);
  assert.throws(() => qldPostcode({}), /postcode is required/);
  assert.deepEqual(qldKinds("apartment").kinds, ["flat"]);
  assert.deepEqual(qldKinds("house").kinds, ["house"]);
  assert.equal(qldKinds(undefined).kinds.length, 3);
  assert.throws(() => qldKinds("room"), /rooms/);
  assert.equal(qldBeds(undefined), undefined);
  assert.throws(() => qldBeds(1.5), /whole number/);
});

/** A fake rta.qld.gov.au serving the workbook. */
function fakeSite(opts: { fail?: boolean } = {}) {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: any) => {
    calls.push(String(url));
    if (opts.fail || String(url) !== WORKBOOK_URL) return new Response("nope", { status: 503 });
    return new Response(new Uint8Array(workbook()), { status: 200 });
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = original) };
}

test("harvest end to end (fake site): one download, rows for the newest quarter", async () => {
  harvestOptions.retryDelayMs = 0;
  const site = fakeSite();
  try {
    const h = await qldHarvest();
    assert.equal(site.calls.length, 1);
    assert.equal(h.date, "2026-09-30");
    assert.equal(h.currency, "AUD");
    assert.equal(h.unit, "per week");
    assert.ok(h.rows.some((r) => r.area === "4870" && r.item === "house-3" && r.median === 660 && r.n === 44));
    assert.match(h.note ?? "", /quarter ending 2026-09-30/);
  } finally {
    site.restore();
  }
  const down = fakeSite({ fail: true });
  try {
    await assert.rejects(qldHarvest(), /Could not download/);
  } finally {
    down.restore();
  }
});

test("answers from the library: the published median, bonds as sample size, quarter as period; no type means the most common dwelling", async () => {
  harvestOptions.retryDelayMs = 0;
  process.env.PROOFPRICE_LIBRARY_DIR = mkdtempSync(path.join(tmpdir(), "qld-lib-"));
  const site = fakeSite();
  try {
    const h = await qldHarvest();
    writeDaily(INFO.id, h);
    writeMeta(INFO.id, { source: INFO.id, currency: "AUD", unit: "per week", first_date: h.date, last_date: h.date, days: 1, last_harvest_at: "x", last_rows: h.rows.length, last_ok_at: "x", last_error: null, note: h.note });
  } finally {
    site.restore();
  }
  try {
    const a = await qldRents({ postcode: "4000", property_type: "apartment", bedrooms: 2 });
    assert.equal(a.status, "ok");
    assert.equal(a.price_type, "official_statistic");
    assert.equal(a.price?.currency, "AUD");
    assert.equal(a.price?.unit, "per week");
    assert.equal(a.price?.measure, "median");
    assert.equal(a.price?.value, 830);
    assert.equal(a.price?.typical_low, null);
    assert.equal(a.sample_size, 313);
    assert.deepEqual(a.period, { from: "2026-07-01", to: "2026-09-30" });
    assert.equal(a.statistic?.reference_period, "2026-Q3");
    assert.match(a.summary, /median weekly rent of new tenancies of 2-bedroom flats in postcode 4000, Queensland, was A\$830 \(about A\$3,597 a month\)/);
    assert.match(a.summary, /313 new rental bonds/);
    assert.equal((a.extra as any).median_per_month_equivalent, 3597);
    assert.equal(a.source.licence.startsWith("Creative Commons Attribution 4.0"), true);

    // nothing chosen: the dwelling with most bonds in the postcode (4000: Flat 1, 548 bonds); the others are listed
    const d = await qldRents({ postcode: "4000" });
    assert.equal(d.price?.value, 625);
    assert.equal(d.sample_size, 548);
    assert.match(d.summary, /most common dwelling/);
    assert.deepEqual((d.extra as any).other_dwellings.map((x: any) => x.dwelling), ["2-bedroom flat", "3-bedroom flat", "3-bedroom house"]);

    // a house in 4870 with no bedrooms: 3-bedroom (44 bonds) beats 4-bedroom (12)
    const h3 = await qldRents({ postcode: "4870", property_type: "house" });
    assert.equal(h3.price?.value, 660);
    assert.equal((h3.extra as any).other_dwellings.length, 1);

    // asked for something with fewer than 5 bonds: no figure, never a guess
    const none = await qldRents({ postcode: "4000", property_type: "house", bedrooms: 2 });
    assert.equal(none.status, "no_matches");
    assert.equal(none.price, null);
    const unknown = await qldRents({ postcode: "4999" });
    assert.equal(unknown.status, "no_matches");
    const studio = await qldRents({ postcode: "4000", bedrooms: 0 });
    assert.equal(studio.status, "no_matches");
  } finally {
    delete process.env.PROOFPRICE_LIBRARY_DIR;
  }
});

test("no library yet gives a readable error", async () => {
  process.env.PROOFPRICE_LIBRARY_DIR = mkdtempSync(path.join(tmpdir(), "qld-empty-"));
  try {
    await assert.rejects(qldRents({ postcode: "4000" }), /Not yet available.*figures appear after the next collection/);
  } finally {
    delete process.env.PROOFPRICE_LIBRARY_DIR;
  }
});

test("INFO: CC BY 4.0 from the workbook, official statistic, new tenancies only", () => {
  assert.match(INFO.licence, /Creative Commons Attribution 4\.0/);
  assert.equal(INFO.licence_url, "https://creativecommons.org/licenses/by/4.0/");
  assert.equal(INFO.price_type, "official_statistic");
  assert.match(INFO.attribution, /Residential Tenancies Authority/);
  assert.match(INFO.limits, /NEW tenancies/);
});

// keep the type import used
export type _Cell = Cell;

test("qldHistoryKey: one point per quarter for a postcode, type and bedrooms; open type or bedrooms has no key; bad input throws", () => {
  assert.deepEqual(qldHistoryKey({ postcode: "4000", property_type: "apartment", bedrooms: 2 })?.item, qldItem("flat", 2));
  assert.equal(qldHistoryKey({ postcode: "4000", property_type: "apartment", bedrooms: 2 })?.area, "4000");
  assert.equal(qldHistoryKey({ postcode: "4870", property_type: "house", bedrooms: 3 })?.item, qldItem("house", 3));
  assert.equal(qldHistoryKey({ postcode: "4000" }), null);
  assert.equal(qldHistoryKey({ postcode: "4000", property_type: "apartment" }), null);
  assert.equal(qldHistoryKey({ postcode: "4000", property_type: "apartment", bedrooms: 4 }), null);
  assert.throws(() => qldHistoryKey({ town: "Brisbane" }));
  assert.throws(() => qldHistoryKey({ postcode: "4000", property_type: "room", bedrooms: 1 }));
});
