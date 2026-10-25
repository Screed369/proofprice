// Real formats, checked live on 2026-10-14:
//  - fixtures/links.html: every <li><a> link to an .xlsx file on the NSW "Rental bond data" page (monthly lodgements, annual lodgements, refunds, holdings).
//  - the September 2026 workbook (26 615 rows, 715 KB): sheet "Sept26 Rental Bond Lodgments" with a title row, a blank row, the header
//    Lodgement Date | Postcode | Dwelling Type | Bedrooms | Weekly Rent, then rows such as [46281, 2000, "F", "0", "680"]
//    (date as an Excel serial number, bedrooms and rent as text), and a sheet "Definitions". REAL_ROWS below are rows copied from it.
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
  INFO, consecutiveRun, harvestOptions, nswArea, nswBeds, nswDailyRows, nswHarvest, nswHistoryKey, nswItem, nswRents, nswType, parseBonds, parseLodgementLinks, windowStart, monthEnd, type Bond,
} from "./source";

const LINKS = readFileSync(new URL("./fixtures/links.html", import.meta.url), "utf8");

const TITLE = "NSW Fair Trading\r\n\r\nResidential Rental Bond Lodgements\r\n\r\nSeptember  2026";
const HEADER = ["Lodgement Date", "Postcode", "Dwelling Type", "Bedrooms", "Weekly Rent"];
const REAL_ROWS: (string | number)[][] = [
  [46281, 2000, "F", "0", "680"],
  [46281, 2000, "F", "0", "900"],
  [46295, 2000, "F", "0", "800"],
  [46276, 2000, "F", "0", "800"],
  [46280, 2000, "F", "0", "670"],
  [46273, 2880, "T", "1", "260"],
  [46280, 2880, "U", "1", "240"],
];
const DEFINITIONS: string[][] = [
  ["Description"],
  ["Column", "Definition"],
  ["Postcode", "Postcode of the rented premises address"],
  ["Dwelling Type", "Type of rented premises as provided by the agent of landlord. (F) Flat/unit; (H) House; (T) Terrace/townhouse/semi-detached; (O) Other; (U) Unknown."],
];

const sheetOf = (rows: (string | number)[][]) => ({ "Sept26 Rental Bond Lodgments": [[TITLE], [], HEADER, ...rows], Definitions: DEFINITIONS });

test("links: monthly lodgement files only, newest first, absolute URLs", () => {
  const files = parseLodgementLinks(LINKS);
  assert.equal(files.length, 57); // January 2022 .. September 2026
  assert.deepEqual(files[0], { month: "2026-09", url: "https://www.nsw.gov.au/sites/default/files/noindex/2026-10/rentalbond_lodgements_september_2026.xlsx" });
  assert.equal(files[56].month, "2022-01");
  assert.ok(files.every((f) => /^\d{4}-\d{2}$/.test(f.month) && f.url.endsWith(".xlsx")));
  assert.ok(!files.some((f) => /refund|held/.test(f.url)));
  assert.equal(new Set(files.map((f) => f.month)).size, 57);
  assert.equal(files.find((f) => f.month === "2025-07")?.url, "https://www.nsw.gov.au/sites/default/files/noindex/2025-08/rental-bond-lodgement-data-july-2025.xlsx");
  assert.deepEqual(parseLodgementLinks("<p>nothing</p>"), []);
  // titles on the real page are inconsistent; the visible text is what counts
  const odd = files.filter((f) => ["2024-04", "2025-08", "2025-09", "2026-03"].includes(f.month));
  assert.equal(odd.length, 4);
});

test("consecutiveRun stops at the first missing month", () => {
  const f = (m: string) => ({ month: m, url: `https://x/${m}.xlsx` });
  assert.deepEqual(consecutiveRun([f("2026-01"), f("2025-12"), f("2025-11"), f("2025-09"), f("2025-08")]).map((x) => x.month), ["2026-01", "2025-12", "2025-11"]);
  assert.deepEqual(consecutiveRun([f("2026-01"), f("2025-12")]).map((x) => x.month), ["2026-01", "2025-12"]);
  assert.deepEqual(consecutiveRun([]), []);
  // the real page lists every month from 2026-09 back well past 12 months
  assert.ok(consecutiveRun(parseLodgementLinks(LINKS)).length >= 12);
});

test("real workbook layout: title row, header found by name, text numbers read, unknowns skipped", () => {
  const sheets = readXlsx(makeXlsx(sheetOf(REAL_ROWS)));
  assert.equal(sheets[0].name, "Sept26 Rental Bond Lodgments");
  const bonds = parseBonds(sheets[0].rows);
  assert.equal(bonds.length, 7);
  assert.deepEqual(bonds[0], { postcode: "2000", type: "F", beds: 0, rent: 680 });
  assert.deepEqual(bonds[5], { postcode: "2880", type: "T", beds: 1, rent: 260 });
  assert.equal(bonds[6].type, "U");
  // unknown rent, unknown bedrooms, nonsense postcode and absurd rents
  const odd = parseBonds([HEADER, [46281, 2000, "H", "U", "500"], [46281, 2000, "H", "2", "U"], [46281, 99, "H", "2", "500"], [46281, 2000, "H", "2", "5"], [46281, 2000, "H", "2", "99999"]]);
  assert.deepEqual(odd, [{ postcode: "2000", type: "H", beds: null, rent: 500 }]);
  assert.throws(() => parseBonds([["a", "b"]]), /new layout/);
  assert.throws(() => parseBonds([["Postcode", "Weekly Rent"], [2000, "500"]]), /Dwelling Type/);
});

/** SYNTHETIC bonds: postcode 2000 flats and houses, 8 per month in each of a few sizes. */
function bondsFor(rentBase: number): Bond[] {
  const out: Bond[] = [];
  for (let i = 0; i < 8; i++) {
    out.push({ postcode: "2000", type: "F", beds: 2, rent: rentBase + i * 10 });
    out.push({ postcode: "2000", type: "F", beds: 1, rent: rentBase - 100 + i * 10 });
    out.push({ postcode: "2000", type: "H", beds: 3, rent: rentBase + 400 + i * 10 });
    out.push({ postcode: "2000", type: "T", beds: 3, rent: rentBase + 300 + i * 10 });
    out.push({ postcode: "2000", type: "O", beds: 0, rent: 100 + i }); // a garage
    out.push({ postcode: "2150", type: "F", beds: null, rent: 500 + i });
  }
  return out;
}
const MONTHS = ["2026-09", "2026-08", "2026-07", "2026-06", "2026-05", "2026-04", "2026-03", "2026-02", "2026-01", "2025-12", "2025-11", "2025-10"];

test("window arithmetic", () => {
  assert.equal(monthEnd("2026-09"), "2026-09-30");
  assert.equal(monthEnd("2024-02"), "2024-02-29");
  assert.equal(windowStart("2026-09", 3), "2026-07-01");
  assert.equal(windowStart("2026-09", 12), "2025-10-01");
  assert.equal(nswItem("apartment", "2", 3), "apartment:2:3m");
});

test("daily rows: windows, types, bedrooms, postcode and state level", () => {
  const { date, rows } = nswDailyRows(MONTHS.map((m, i) => ({ month: m, bonds: bondsFor(600 + i) })));
  assert.equal(date, "2026-09-30");
  const get = (area: string, item: string) => rows.find((r) => r.area === area && r.item === item);
  const flats2 = get("2000", "apartment:2:3m")!;
  assert.equal(flats2.n, 24); // 8 a month for 3 months
  assert.equal(get("2000", "apartment:2:12m")!.n, 96);
  assert.ok(flats2.median >= 600 && flats2.median <= 710);
  assert.ok(flats2.low <= flats2.median && flats2.median <= flats2.high);
  assert.equal(get("2000", "house:3:3m")!.n, 48); // houses and townhouses together
  // Audit 2026-10-14: 'other' bonds (garages, car spaces, rooms) are not homes and are left out everywhere, even from 'any'
  // (production showed postcode 2000 'any' at a A$50 minimum and a median A$250 below flats).
  assert.equal(get("2000", "any:any:3m")!.n, 24 * 4); // four kinds of home bond a month; the garages are not counted
  assert.equal(get("2000", "any:0:3m"), undefined); // the only 0-bedroom bonds are garages
  assert.equal(get("2000", "apartment:0:3m"), undefined);
  assert.equal(get("2150", "any:any:12m")!.n, 96);
  assert.equal(get("2150", "apartment:any:3m")!.n, 24);
  assert.equal(get("2150", "apartment:2:3m"), undefined); // unknown bedrooms only count in 'any'
  assert.equal(get("ALL", "any:any:3m")!.n, 24 * 5);
  assert.ok(!rows.some((r) => r.min < 500 && r.item.startsWith("any:"))); // no garage rent (100-107) in any row
  // fewer than 12 months: only the 3 month windows
  const short = nswDailyRows(MONTHS.slice(0, 6).map((m) => ({ month: m, bonds: bondsFor(600) })));
  assert.ok(short.rows.some((r) => r.item.endsWith(":3m")));
  assert.ok(!short.rows.some((r) => r.item.endsWith(":12m")));
  assert.throws(() => nswDailyRows(MONTHS.slice(0, 2).map((m) => ({ month: m, bonds: bondsFor(600) }))), /at least 3/);
});

test("input checks", () => {
  assert.deepEqual(nswArea({ postcode: "2000" }), { area: "2000", label: "postcode 2000" });
  assert.deepEqual(nswArea({ town: "2150" }), { area: "2150", label: "postcode 2150" });
  assert.equal(nswArea({ town: "NSW" }).area, "ALL");
  assert.throws(() => nswArea({ town: "Sydney" }), /postcode is required.*'Sydney' is not a postcode/);
  assert.throws(() => nswArea({ postcode: "20" }), /four digits/);
  assert.throws(() => nswArea({}), /postcode is required/);
  assert.equal(nswType("apartment").type, "apartment");
  assert.throws(() => nswType("room"), /rooms separately|rented rooms/);
  assert.deepEqual(nswBeds(7), { key: "4", label: "4+ bedroom " });
  assert.equal(nswBeds(undefined).key, "any");
});

/** A fake nsw.gov.au: the real link list for the page, and one synthetic workbook per month. */
function fakeSite(opts: { failMonthsBefore?: string } = {}) {
  const files = parseLodgementLinks(LINKS);
  const byUrl = new Map<string, string>();
  files.forEach((f, i) => byUrl.set(f.url, f.month));
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: any) => {
    const u = String(url);
    calls.push(u);
    if (u.includes("rental-bond-data")) return new Response(LINKS, { status: 200 });
    const month = byUrl.get(u);
    if (!month || (opts.failMonthsBefore && month < opts.failMonthsBefore)) return new Response("nope", { status: 404 });
    const idx = files.findIndex((f) => f.month === month);
    return new Response(makeXlsx(sheetOf([...REAL_ROWS, ...bondsFor(600 + idx).map((b) => [46250, Number(b.postcode), b.type, b.beds === null ? "U" : String(b.beds), String(b.rent)])])), { status: 200 });
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = original) };
}

test("harvest end to end (fake site): 12 files read, rows for 3 and 12 month windows", async () => {
  harvestOptions.retryDelayMs = 0;
  const site = fakeSite();
  try {
    const h = await nswHarvest();
    assert.equal(h.date, "2026-09-30");
    assert.equal(h.currency, "AUD");
    assert.equal(h.unit, "per week");
    assert.equal(site.calls.length, 13); // the page + 12 monthly files
    assert.ok(h.rows.some((r) => r.area === "2000" && r.item === "apartment:2:12m"));
    assert.match(h.note ?? "", /3\/12 months ending 2026-09-30/);
  } finally {
    site.restore();
  }
});

test("harvest: an older file that cannot be read gives the shorter windows only; an unreadable newest file fails", async () => {
  harvestOptions.retryDelayMs = 0;
  let site = fakeSite({ failMonthsBefore: "2026-07" });
  try {
    const h = await nswHarvest();
    assert.ok(h.rows.some((r) => r.item.endsWith(":3m")));
    assert.ok(!h.rows.some((r) => r.item.endsWith(":12m")));
  } finally {
    site.restore();
  }
  site = fakeSite({ failMonthsBefore: "2026-10" });
  try {
    await assert.rejects(nswHarvest(), /Could not download/);
  } finally {
    site.restore();
  }
});

test("answers from the library: median and range in AUD per week, period, fallback to 12 months, no figure below 5 bonds", async () => {
  harvestOptions.retryDelayMs = 0;
  const dir = mkdtempSync(path.join(tmpdir(), "nsw-lib-"));
  process.env.PROOFPRICE_LIBRARY_DIR = dir;
  const site = fakeSite();
  try {
    const h = await nswHarvest();
    writeDaily(INFO.id, h);
    writeMeta(INFO.id, { source: INFO.id, currency: "AUD", unit: "per week", first_date: h.date, last_date: h.date, days: 1, last_harvest_at: "x", last_rows: h.rows.length, last_ok_at: "x", last_error: null, note: h.note });
  } finally {
    site.restore();
  }
  try {
    const a = await nswRents({ postcode: "2000", property_type: "apartment", bedrooms: 2 });
    assert.equal(a.status, "ok");
    assert.equal(a.price_type, "transaction");
    assert.equal(a.price?.currency, "AUD");
    assert.equal(a.price?.unit, "per week");
    assert.equal(a.price?.measure, "median");
    assert.ok(a.price!.typical_low! <= a.price!.median! && a.price!.median! <= a.price!.typical_high!);
    assert.ok(a.sample_size! >= 5);
    assert.deepEqual(a.period, { from: "2026-07-01", to: "2026-09-30" });
    assert.match(a.summary, /Rental bonds lodged for new tenancies of 2-bedroom flats and units in postcode 2000, NSW show a median agreed weekly rent of A\$\d+/);
    assert.match(a.summary, /typical range \(10th–90th percentile\) A\$[\d,]+–A\$[\d,]+ a week/);
    assert.match(a.summary, /new leases .* not what sitting tenants pay/);
    assert.equal((a.extra as any).window_months, 3);
    assert.equal((a.extra as any).median_per_month_equivalent, Math.round((a.price!.median! * 52) / 12));
    assert.equal(a.source.licence.startsWith("Creative Commons Attribution"), true);

    // 2150 has only 8 bonds a month with unknown bedrooms, all flats: 3 months = 24 >= 5, fine; but 4+ bedrooms has none at all
    const none = await nswRents({ postcode: "2150", bedrooms: 4 });
    assert.equal(none.status, "no_matches");
    assert.equal(none.price, null);

    // explicit months: 12 uses the 12 month row
    const yr = await nswRents({ postcode: "2000", months: 12 });
    assert.deepEqual(yr.period, { from: "2025-10-01", to: "2026-09-30" });
    assert.ok(yr.sample_size! > a.sample_size!);

    const state = await nswRents({ town: "NSW" });
    assert.equal(state.status, "ok");
    assert.equal((state.query as any).town, "New South Wales");
  } finally {
    delete process.env.PROOFPRICE_LIBRARY_DIR;
  }
});

test("no library yet gives a readable error", async () => {
  process.env.PROOFPRICE_LIBRARY_DIR = mkdtempSync(path.join(tmpdir(), "nsw-empty-"));
  try {
    await assert.rejects(nswRents({ postcode: "2000" }), /Not yet available.*figures appear after the next collection/);
  } finally {
    delete process.env.PROOFPRICE_LIBRARY_DIR;
  }
});

test("INFO: licence quoted from the NSW data portal, and what the rents are", () => {
  assert.match(INFO.licence, /Creative Commons Attribution \(CC BY\)/);
  assert.match(INFO.licence_url, /^https:\/\/data\.nsw\.gov\.au\//);
  assert.equal(INFO.price_type, "transaction");
  assert.match(INFO.limits, /new tenancies, not sitting tenants/);
});

test("nswHistoryKey: 3-month window by postcode, type and bedrooms; state default; bad input throws", () => {
  assert.deepEqual(nswHistoryKey({ postcode: "2000" }).item, nswItem("any", "any", 3));
  assert.equal(nswHistoryKey({ postcode: "2150", property_type: "apartment", bedrooms: 2 }).item, nswItem("apartment", "2", 3));
  assert.equal(nswHistoryKey({ postcode: "2150", bedrooms: 6 }).item, nswItem("any", "4", 3));
  assert.equal(nswHistoryKey({ town: "NSW" }).area, nswArea({ town: "NSW" }).area);
  assert.throws(() => nswHistoryKey({ town: "Sydney" }));
  assert.throws(() => nswHistoryKey({ postcode: "2000", property_type: "room" }));
});
