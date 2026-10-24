// Real format, read on 2026-10-24 from the 2026-06 workbook (Private Rental Report 2026-06, sheets Suburb / PC / Region / SLA): note rows 1-12,
// title row 14 ("... median weekly rental, 1 April - 30 June 2026, South Australia"), group labels rows 15-16, "Row Labels | Count | Median ..." row 17,
// "Metro" row 18, then one row per suburb / postcode. The Adelaide, Aberfoyle Park, Aldinga Beach, Aldgate and 5000/5006 rows are REAL (copied from the run log);
// Glenelg and Mount Gambier rows are SYNTHETIC in the same layout.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { makeXlsx } from "../../tests/helpers/make-zip";
import { readXlsx } from "../../categories/rent/xlsx";
import { writeDaily, writeMeta } from "../../lib/library/store";
import { findSource } from "../../lib/registry";
import { INFO, PACKAGE_URL, findSheet, harvestOptions, newestWorkbook, parseSheet, quarterEnd, saAnswerFromCandidates, saArea, saHarvest, saRents, saWants, suburbKey } from "./source";

const N = 27;
const pad = (r: (string | number | null)[]) => [...r, ...Array<null>(N - r.length).fill(null)];
const GROUP = pad([null, "Flats/Units", null, null, null, null, null, null, null, "Flats/Units Count", "Flats/Units Median", "Houses", null, null, null, null, null, null, null, "Houses Count", "Houses Median", "Other/Unknown", null, "Other/Unknown Count", "Other/Unknown Median", "Total Count", "Total Median"]);
const BEDS = pad([null, "1 bedroom", null, "2 bedrooms", null, "3 bedrooms", null, "4+ bedrooms", null, null, null, "1 bedroom", null, "2 bedrooms", null, "3 bedrooms", null, "4+ bedrooms", null, null, null, "Not applicable"]);
const HEAD = pad(["Row Labels", "Count", "Median", "Count", "Median", "Count", "Median", "Count", "Median", null, null, "Count", "Median", "Count", "Median", "Count", "Median", "Count", "Median", null, null, "Count", "Median"]);

const sheet = (what: string, body: (string | number | null)[][]) => [
  pad([]),
  pad(["Quarterly Rent Report\nApril-June 2026"]),
  pad([]), pad([]),
  pad(["Source: Rental Bond Data Set of the Tenancies Branch, Office of Consumer and Business Services, provided by Data Analytics, SA Housing Trust"]),
  pad([]), pad(["Notes:"]),
  pad(['1. Excludes bonds that have been "cancelled" or "unlodged" with the Residential Tenancies Branch']),
  pad(['2. Where there are 1 to 5 dwellings the number is replaced with a "*"']),
  pad(["3. Flat/House totals have been rounded to the nearest 5"]),
  pad(["4. Metropolitan area is defined as the sum of the Northern, Western, Eastern and Southern Adelaide regions"]),
  pad(["5. Suburbs which overlap SLAs are allocated to the SLA where the majority of the suburb population is located."]),
  pad([]),
  pad([`${what} by dwelling type and number of bedrooms: Number of bonds lodged and median weekly rental, 1 April - 30 June 2026, South Australia`]),
  GROUP, BEDS, HEAD,
  pad(["Metro"]),
  ...body,
  pad(["Rest of State"]),
];

const SUBURBS = [
  pad(["Aberfoyle Park", null, null, "*", 510, null, null, null, null, "*", 510, null, null, "*", 550, 15, 650, "*", 815, 20, 675, null, null, null, null, 25, 675]),
  pad(["Adelaide", 815, 500, 230, 650, 45, 660, 10, 270, 1100, 524, 15, 460, 40, 650, 40, 695, 10, 390, 110, 630, 95, 252.35, 95, 252.35, 1300, 520]),
  pad(["Aldgate", null, null, null, null, null, null, null, null, null, null, "*", 600, "*", 650, "*", 640, "*", 1125, 5, 650, null, null, null, null, 5, 650]),
  pad(["Aldinga Beach", "*", 450, 10, 487.5, "*", 492.5, "*", 750, 10, 487.5, "*", 300, 5, 520, 55, 600, 15, 695, 80, 600, "*", 250, "*", 250, 95, 590]),
  pad(["Glenelg", 40, 450, 65, 560, 12, 700, "*", 900, 120, 540, "*", 400, 8, 700, 22, 800, 7, 1000, 40, 780, null, null, null, null, 160, 580]),
  pad(["Metro Total", 1295, 474, 1945, 522.5, 435, 647.5, 20, 575, 3695, 515, 280, 290, 830, 562.5, 4505, 620, 1435, 700, 7050, 620, 285, 252.5, 285, 252.5, 11025, 580]),
];
const POSTCODES = [
  pad([5000, 815, 500, 230, 650, 45, 660, 10, 270, 1100, 524, 15, 460, 40, 650, 40, 695, 10, 390, 110, 630, 95, 252.35, 95, 252.35, 1305, 520]),
  pad([5006, 30, 500, 35, 592.5, 10, 825, "*", 1800, 75, 550, "*", 565, 15, 745, 20, 980, 10, 1100, 50, 850, "*", 470, "*", 470, 130, 660]),
  pad([5290, "*", 250, 14, 310, null, null, null, null, 20, 310, "*", 300, 18, 380, 30, 420, 12, 520, 70, 400, null, null, null, null, 95, 380]),
];

const workbook = (opts: { title?: string } = {}) => {
  const sub = sheet("Suburbs", SUBURBS);
  if (opts.title) sub[13] = pad([opts.title]);
  return makeXlsx({ Suburb: sub, PC: sheet("Postcode", POSTCODES), Region: sheet("South Australian Government Regions", []) });
};

test("quarter end comes from the title row", () => {
  const rows = readXlsx(workbook());
  assert.equal(quarterEnd(findSheet(rows, "Suburb")), "2026-06-30");
  assert.throws(() => quarterEnd(findSheet(readXlsx(workbook({ title: "no dates here" })), "Suburb")), /new layout/);
});

test("parse: cells by bedroom, rounded totals need 10, stars are dropped, totals rows skipped", () => {
  const sub = parseSheet(findSheet(readXlsx(workbook()), "Suburb"), "suburb");
  assert.equal(sub.date, "2026-06-30");
  const get = (area: string, item: string) => sub.rows.find((r) => r.area === area && r.item === item);
  assert.deepEqual([get("s:adelaide", "flat-1")?.n, get("s:adelaide", "flat-1")?.median], [815, 500]);
  assert.equal(get("s:adelaide", "house-4")?.n, 10);
  assert.equal(get("s:adelaide", "all")?.median, 520);
  assert.equal(get("s:aberfoyle park", "flat-2"), undefined); // "*" count
  assert.equal(get("s:aberfoyle park", "house-3")?.median, 650);
  assert.equal(get("s:aldgate", "house"), undefined); // rounded total of 5 < 10
  assert.equal(get("s:aldgate", "all"), undefined);
  assert.equal(get("s:aldinga beach", "house-2")?.n, 5 >= 6 ? 5 : undefined); // count 5 is under 6, withheld
  assert.equal(get("s:aldinga beach", "house-2"), undefined);
  assert.ok(!sub.rows.some((r) => r.area.includes("total") || r.area.includes("rest of state") || r.area === "s:metro"));
  const pc = parseSheet(findSheet(readXlsx(workbook()), "PC"), "postcode");
  assert.ok(pc.rows.some((r) => r.area === "5000" && r.item === "all" && r.n === 1305 && r.median === 520));
  assert.ok(pc.rows.every((r) => r.n >= 6 && /^\d{4}$/.test(r.area)));
});

test("parse: a moved column layout is an error, not a wrong price", () => {
  const bad = readXlsx(workbook());
  const s = findSheet(bad, "Suburb");
  s[14][11] = "Townhouses";
  assert.throws(() => parseSheet(s, "suburb"), /new layout/);
});

test("newest workbook is picked from package_show by its name", () => {
  const res = (n: string, u: string, f = "XLSX") => ({ id: n, name: n, format: f, url: u, last_modified: "2026-01-01T00:00:00" });
  const json = { success: true, result: { id: "x", name: "private-rent-report", title: "Private Rent Report", resources: [res("Private Rental Report 2026-03", "https://d/a.xlsx"), res("Private Rental Report 2026-06", "https://d/b.xlsx"), res("Notes", "https://d/n.pdf", "PDF")] } };
  assert.equal(newestWorkbook(json).url, "https://d/b.xlsx");
  assert.throws(() => newestWorkbook({ success: true, result: { id: "x", resources: [] } }), /lists no/);
});

test("request helpers", () => {
  assert.deepEqual(saArea({ postcode: "5000" }), { area: "5000", label: "postcode 5000" });
  assert.deepEqual(saArea({ town: "5067" }), { area: "5067", label: "postcode 5067" });
  assert.equal(saArea({ town: "Mount  Barker" }).area, "s:mount barker");
  assert.throws(() => saArea({ town: "SA" }), /suburb/);
  assert.throws(() => saArea({}), /suburb/);
  assert.deepEqual(saWants(), ["all"]);
  assert.deepEqual(saWants("apartment"), ["flat"]);
  assert.deepEqual(saWants(undefined, 2), ["flat-2", "house-2"]);
  assert.deepEqual(saWants("house", 7), ["house-4"]);
  assert.deepEqual(saWants(undefined, 0), []);
  assert.throws(() => saWants("room"), /rooms/);
  assert.equal(suburbKey(" Glenelg  North "), "s:glenelg north");
});

function fakeSite(fail = false) {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (url: any) => {
    const u = String(url);
    calls.push(u);
    if (fail) return new Response("nope", { status: 503 });
    if (u === PACKAGE_URL) {
      return new Response(JSON.stringify({ success: true, result: { id: "x", name: "private-rent-report", title: "Private Rent Report", resources: [{ id: "1", name: "Private Rental Report 2026-06", format: "XLSX", url: "https://data.sa.gov.au/files/pr-2026-06.xlsx", last_modified: "2026-08-11T06:37:43" }] } }), { status: 200 });
    }
    if (u === "https://data.sa.gov.au/files/pr-2026-06.xlsx") return new Response(new Uint8Array(workbook()), { status: 200 });
    return new Response("nope", { status: 404 });
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = original) };
}

test("harvest and answers from the library (fake site)", async () => {
  harvestOptions.retryDelayMs = 0;
  process.env.PROOFPRICE_LIBRARY_DIR = mkdtempSync(path.join(tmpdir(), "sa-lib-"));
  const site = fakeSite();
  try {
    const h = await saHarvest();
    assert.equal(site.calls.length, 2);
    assert.equal(h.date, "2026-06-30");
    assert.equal(h.unit, "per week");
    writeDaily(INFO.id, h);
    writeMeta(INFO.id, { source: INFO.id, currency: "AUD", unit: "per week", first_date: h.date, last_date: h.date, days: 1, last_harvest_at: "x", last_rows: h.rows.length, last_ok_at: "x", last_error: null, note: h.note });
  } finally {
    site.restore();
  }
  try {
    const a = await saRents({ postcode: "5000" });
    assert.equal(a.status, "ok");
    assert.equal(a.price_type, "official_statistic");
    assert.equal(a.price?.value, 520);
    assert.equal(a.price?.unit, "per week");
    assert.equal(a.price?.typical_low, null);
    assert.equal(a.sample_size, 1305);
    assert.deepEqual(a.period, { from: "2026-04-01", to: "2026-06-30" });
    assert.equal(a.statistic?.reference_period, "2026-Q2");
    assert.match(a.summary, /homes of all kinds .* in postcode 5000, South Australia, was A\$520 \(about A\$2,253 a month\)/);

    const g = await saRents({ town: "Glenelg", property_type: "apartment", bedrooms: 2 });
    assert.equal(g.price?.value, 560);
    assert.equal(g.sample_size, 65);
    assert.match(g.summary, /2-bedroom flats and units in Glenelg/);

    // no type, 3 bedrooms: the kind with most bonds (Glenelg house-3 = 22, flat-3 = 12)
    const t = await saRents({ town: "glenelg", bedrooms: 3 });
    assert.equal(t.price?.value, 800);
    assert.deepEqual((t.extra as any).other_dwellings.map((x: any) => x.dwelling), ["3-bedroom flats and units"]);

    // 4 or more
    assert.equal((await saRents({ postcode: "5006", property_type: "house", bedrooms: 5 })).price?.value, 1100);

    // too few bonds: no figure, never a guess; unknown suburb; studios
    assert.equal((await saRents({ town: "Aldgate" })).status, "no_matches");
    assert.equal((await saRents({ postcode: "5000", bedrooms: 0 })).status, "no_matches");
    const u = await saRents({ town: "Nowhere" });
    assert.equal(u.status, "no_matches");
    assert.equal(u.price, null);

    // routing: SA postcodes and known suburbs come here; NSW and Queensland keep theirs
    assert.equal(findSource("rent", "AU", { postcode: "5000" })?.info.id, "au-adelaide-sa-rents");
    assert.equal(findSource("rent", "AU", { town: "Glenelg" })?.info.id, "au-adelaide-sa-rents");
    assert.equal(findSource("rent", "AU", { postcode: "2000" })?.info.id, "au-nsw-rents");
    assert.equal(findSource("rent", "AU", { postcode: "4000" })?.info.id, "au-qld-rents");
    assert.equal(findSource("rent", "AU", { town: "Parramatta" })?.info.id, "au-nsw-rents");
  } finally {
    delete process.env.PROOFPRICE_LIBRARY_DIR;
  }
  const down = fakeSite(true);
  try {
    await assert.rejects(saHarvest(), /Could not download/);
  } finally {
    down.restore();
  }
});

test("no library yet gives a readable error", async () => {
  process.env.PROOFPRICE_LIBRARY_DIR = mkdtempSync(path.join(tmpdir(), "sa-empty-"));
  try {
    await assert.rejects(saRents({ postcode: "5000" }), /Not yet available/);
  } finally {
    delete process.env.PROOFPRICE_LIBRARY_DIR;
  }
});

test("answer with no candidate says what to try", () => {
  const a = saAnswerFromCandidates([], { area: "5999", label: "postcode 5999" });
  assert.equal(a.status, "no_matches");
  assert.match(String((a.extra as any).hint), /nearby suburb/);
});

test("INFO: CC BY 4.0, official statistic, new tenancies only", () => {
  assert.match(INFO.licence, /Creative Commons Attribution 4\.0/);
  assert.equal(INFO.price_type, "official_statistic");
  assert.match(INFO.attribution, /SA Housing Authority/);
  assert.match(INFO.limits, /NEW tenancies/);
});
