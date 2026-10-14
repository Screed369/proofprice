// Real formats, checked live on 2026-10-14 (file NDCP2022.xlsx from dol.gov, 2008-2022, 48 308 county-year rows):
//  - one sheet "County_LevelNDCP_v8_update2008_", row 1 = header in upper case; weekly prices in dollars, flags are text ("1", "2", "3");
//  - some counties are listed for 2022 with no price at all (Missouri, Indiana, Pennsylvania, Illinois, ...): all price cells empty.
// ROWS are real rows from that file (county-year rows for 2021/2022; numbers copied from the live file). Only the columns we read are
// kept, and for Cook County 2021 only the columns whose values were read are filled (the rest are empty).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { makeXlsx } from "../../tests/helpers/make-zip";
import { writeDaily } from "../../lib/library/store";
import { InputError, SourceError } from "../../lib/http";
import { INFO, areaKey, headerIndex, harvestOptions, matchCounty, ndcpRows, parseLibArea, pickFileUrl, projectRow, readNdcp, usAnswer, usChildcare, usHarvest } from "./source";

const HEADER = [
  "STATE_NAME", "STATE_ABBREVIATION", "COUNTY_NAME", "COUNTY_FIPS_CODE", "STUDYYEAR",
  "MCINFANT", "MCInfant_flag", "MCTODDLER", "MCToddler_flag", "MCPRESCHOOL", "MCPreschool_flag", "MCSA",
  "MFCCINFANT", "MFCCInfant_flag", "MFCCTODDLER", "MFCCToddler_flag", "MFCCPRESCHOOL", "MFCCPreschool_flag", "MFCCSA",
  "_75CINFANT", "_75CTODDLER", "_75CPRESCHOOL", "_75CSA", "_75FCCINFANT", "_75FCCTODDLER", "_75FCCPRESCHOOL", "_75FCCSA",
];
const E = Array(22).fill(null); // a county listed without any price
type Row = (string | number | null)[];
const ROWS: Row[] = [
  ["Alabama", "AL", "Autauga County", 1001, 2022, 145.8, "3", 138.72, "3", 124.97, "1", 113.52, 135.73, "3", 129.69, "3", 129.69, "1", 117.4, 156.22, 151.25, 138.75, 127.5, 140.95, 137.75, 137.75, 129.25],
  ["Alaska", "AK", "Anchorage Municipality", 2020, 2022, 361.9, "2", 337.18, "1", 289.75, "1", 122.31, 259.61, "2", 233.97, "1", 229.17, "1", 129.22, 447.32, 372.54, 308, 191.15, 301.92, 297.43, 267.31, 169.08],
  ["Illinois", "IL", "Cook County", 17031, 2021, 280, "1", 225, "1", 195, "1", 82.6, 199.95, "1", 186.3, "1", 169.5, "1", 52.1, 311.15, null, null, null, null, null, null, null],
  ["Illinois", "IL", "Cook County", 17031, 2022, 278.33, "1", 220, "1", 189.17, "1", 82.6, 207.77, "1", 193.58, "1", 176.13, "1", 52.1, 307.75, 238.58, 245.83, 97.85, 215.04, 200.39, 182.26, 70.65],
  ["Illinois", "IL", "Washington County", 17189, 2022, ...E.slice(0, 22).map(() => null)] as Row,
  ["Louisiana", "LA", "Orleans Parish", 22071, 2022, 151.67, "3", 145, "1", 140.07, "3", 128.33, 133.33, "1", 133.33, "1", 133.33, "1", 115, 176.67, 166.67, 155, 143.33, 144, 144, 138.67, 131.67],
  ["Missouri", "MO", "St. Louis County", 29189, 2022, ...E.slice(0, 22).map(() => null)] as Row,
  ["Oregon", "OR", "Washington County", 41067, 2022, 384.5, "1", 357, "1", 280.12, "1", 105.89, 244.13, "1", 217.39, "1", 203.96, "1", 171.21, 421.46, 395.1, 318.04, 137.59, 245.99, 225.66, 205.82, 183.68],
  ["Pennsylvania", "PA", "Washington County", 42125, 2022, ...E.slice(0, 22).map(() => null)] as Row,
  ["Texas", "TX", "Harris County", 48201, 2022, 185, "2", 172, "1", 167, "3", 156, 164, "2", 155, "1", 153, "3", 144, 209, 195, 189, 178, 186, 177, 175, 166],
  ["Texas", "TX", "Harrison County", 48203, 2022, 124, "2", 118, "1", 115, "3", 110, 114, "2", 110, "1", 108, "3", 104, 136, 129, 126, 121, 125, 120, 119, 115],
  ["Virginia", "VA", "Richmond County", 51159, 2022, 194.51, "1", 128.87, "1", 128.87, "1", 155.25, 155, "1", 120.16, "1", 120.16, "1", 161.54, 210.29, 159.46, 159.46, 218.19, 156.25, 130.75, 130.75, 138.16],
  ["Virginia", "VA", "Richmond City", 51760, 2022, 308.4, "1", 202.41, "1", 185.94, "1", 148.02, 176.6, "1", 138.81, "1", 134.95, "1", 128.53, 362.78, 258.66, 249.81, 201.19, 237.32, 185.89, 177.98, 131.63],
];
const workbook = (rows = ROWS) => makeXlsx({ County_LevelNDCP_v8_update2008_: [HEADER, ...rows] });

test("header: names are matched upper-cased, so the old mixed-case file works too, and a changed layout is refused", () => {
  const idx = headerIndex(HEADER);
  assert.equal(idx.get("MCINFANT"), 5);
  assert.equal(idx.get("MCINFANT_FLAG"), 6);
  const old = headerIndex(["State_Name", "State_Abbreviation", "County_Name", "County_FIPS_Code", "StudyYear", "MCInfant", "MCToddler", "MCPreschool", "MCSA", "MFCCInfant", "MFCCToddler", "MFCCPreschool", "MFCCSA"]);
  assert.equal(old.get("COUNTY_NAME"), 2);
  assert.throws(() => headerIndex(HEADER.filter((h) => h !== "MCSA")), /no column MCSA/);
});

test("rows: a county-year is projected to medians, 75th percentiles and flags; FIPS codes are padded", () => {
  const idx = headerIndex(HEADER);
  const a = projectRow(ROWS[0], idx)!;
  assert.equal(a.fips, "01001");
  assert.equal(areaKey(a), "01001 Autauga County, AL");
  assert.equal(a.year, 2022);
  assert.deepEqual(a.values["infant:centre"], { median: 145.8, p75: 156.22, flag: 3 });
  assert.deepEqual(a.values["school-age:home"], { median: 117.4, p75: 129.25, flag: 0 }); // the school-age series has no flag
  assert.equal(Object.keys(a.values).length, 8);
  const empty = projectRow(ROWS[4], idx)!;
  assert.deepEqual(empty.values, {});
  assert.equal(projectRow(["x"], idx), null);
});

test("pickFileUrl: the newest NDCP<year>.xlsx on the DOL page, not the state-level file", () => {
  const html = `<a href="/sites/dolgov/files/WB/NDCP2022-state-level-estimates-and-rankings.xlsx">s</a> <a href="/sites/dolgov/files/WB/NDCP2022.xlsx">d</a> <a href="/sites/dolgov/files/WB/NDCP2024.xlsx">d</a> <a href="/sites/dolgov/files/WB/media/nationaldatabaseofchildcareprices.xlsx">old</a>`;
  assert.equal(pickFileUrl(html), "https://www.dol.gov/sites/dolgov/files/WB/NDCP2024.xlsx");
  assert.equal(pickFileUrl("<a href='/x'>nothing</a>"), null);
});

test("streaming read: the latest year of every county is kept; counties without a price get a marker row", async () => {
  const r = await readNdcp(workbook(), 5);
  assert.equal(r.year, 2022);
  assert.equal(r.rowsRead, ROWS.length);
  assert.equal(r.counties.length, 12); // Cook County once (2022 wins over 2021)
  const cook = r.counties.find((c) => c.fips === "17031")!;
  assert.equal(cook.year, 2022);
  assert.equal(cook.values["infant:centre"].median, 278.33);
  const rows = ndcpRows(r.counties);
  const row = (area: string, item: string) => rows.find((x) => x.area === area && x.item === item);
  assert.deepEqual(row("17031 Cook County, IL", "infant:centre"), { area: "17031 Cook County, IL", item: "infant:centre", n: 5, median: 278.33, low: 278.33, high: 278.33, min: 1, max: 307.75 });
  assert.equal(row("17031 Cook County, IL", "school-age:centre")!.min, 0);
  assert.equal(row("17189 Washington County, IL", "nodata")!.median, 1);
  assert.equal(rows.filter((x) => x.area === "29189 St. Louis County, MO").length, 1);
  assert.equal(rows.length, 9 * 8 + 3); // 9 priced counties x 8 items, 3 counties without a price
  await assert.rejects(readNdcp(workbook(), 100), /Only 9 counties with prices found for 2022/);
});

test("harvest: finds the file on the DOL page, falls back to the known file, and writes the year's last day", async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  const bytes = workbook();
  globalThis.fetch = (async (url: any) => {
    calls.push(String(url));
    if (String(url).endsWith("featured-childcare")) return new Response('<a href="/sites/dolgov/files/WB/NDCP2022.xlsx">file</a>', { status: 200 });
    return new Response(new Uint8Array(bytes), { status: 200 });
  }) as typeof fetch;
  harvestOptions.retryDelayMs = 0;
  try {
    await assert.rejects(usHarvest(), /Only 9 counties with prices found for 2022/); // the test workbook is far smaller than the real file
    assert.deepEqual(calls, ["https://www.dol.gov/agencies/wb/topics/featured-childcare", "https://www.dol.gov/sites/dolgov/files/WB/NDCP2022.xlsx"]);
  } finally {
    globalThis.fetch = original;
  }
});

// ---------- answers ----------

const lib = () => {
  const counties = ROWS.map((r) => projectRow(r, headerIndex(HEADER))!).filter((c) => c.year === 2022);
  return { date: "2022-12-31", rows: ndcpRows(counties).map((r) => ({ ...r })) };
};
const NOW = new Date("2026-10-14T12:00:00Z");

test("areas: the library key splits into FIPS, name and state", () => {
  assert.deepEqual(parseLibArea("17031 Cook County, IL"), { key: "17031 Cook County, IL", fips: "17031", name: "Cook County", state: "IL" });
  assert.equal(parseLibArea("nonsense"), null);
});

test("Cook County, IL infant: the published 2022 median, flagged plainly as four years old", () => {
  const a = usAnswer(lib(), { area: "Cook County, IL", age_group: "infant" }, NOW);
  assert.equal(a.status, "ok");
  assert.equal(a.price?.value, 278.33);
  assert.equal(a.price?.measure, "median");
  assert.equal(a.price?.median, 278.33);
  assert.equal(a.price?.typical_low, null);
  assert.equal(a.price?.currency, "USD");
  assert.equal(a.price?.unit, "per week");
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.statistic?.reference_period, "2022");
  assert.deepEqual(a.period, { from: "2022-01-01", to: "2022-12-31" });
  assert.equal(a.sample_size, null);
  assert.match(a.summary, /median price charged for full-time infant care \(under 2 years old\) in child care centres in Cook County, IL was US\$278 a week in 2022/);
  assert.match(a.summary, /Official median published by U\.S\. Department of Labor, Women's Bureau for 2022/);
  assert.match(a.statistic?.note ?? "", /currently ends in 2022, 4 years ago/);
  const x = a.extra as any;
  assert.equal(x.percentile_75, 307.75);
  assert.equal(x.quality_flag, 1);
  assert.equal(x.data_age_years, 4);
  assert.deepEqual(x.by_age_group.toddler, { centre_based: 220, home_based: 193.58 });
  assert.equal(a.source.licence_url, "https://www.dol.gov/general/aboutdol/copyright");
  assert.match(a.source.licence, /may be used, reproduced and distributed without permission/);
});

test("age groups, home-based care and the default", () => {
  const home = usAnswer(lib(), { area: "Cook County, IL", age_group: "toddler", care_type: "home-based" }, NOW);
  assert.equal(home.price?.value, 193.58);
  assert.match(home.summary, /home-based family childcare/);
  assert.equal(usAnswer(lib(), { area: "Cook County, IL", age_group: "preschool", care_type: "childminder" }, NOW).price?.value, 176.13);
  const school = usAnswer(lib(), { area: "Cook County, IL", age_group: "school-age" }, NOW);
  assert.equal(school.price?.value, 82.6);
  assert.equal((school.extra as any).quality_flag, null);
  const none = usAnswer(lib(), { area: "Cook County, IL" }, NOW);
  assert.equal(none.price?.value, 278.33);
  assert.match(none.statistic?.note ?? "", /No age_group was given, so the answer is for infants/);
  assert.equal(usAnswer(lib(), { area: "Cook County, IL", hours: "full-time" }, NOW).price?.value, 278.33);
});

test("county matching", () => {
  const counties = [...new Set(lib().rows.map((r) => r.area))].map((k) => parseLibArea(k)!);
  const m = (t: string) => matchCounty(counties, t).key;
  assert.equal(m("Cook County, IL"), "17031 Cook County, IL");
  assert.equal(m("cook county, illinois"), "17031 Cook County, IL");
  assert.equal(m("Cook, IL"), "17031 Cook County, IL");
  assert.equal(m("Cook County IL"), "17031 Cook County, IL");
  assert.equal(m("17031"), "17031 Cook County, IL");
  assert.equal(m("Orleans, LA"), "22071 Orleans Parish, LA");
  assert.equal(m("Anchorage, Alaska"), "02020 Anchorage Municipality, AK");
  assert.equal(m("Saint Louis County, MO"), "29189 St. Louis County, MO");
  assert.equal(m("Richmond City, VA"), "51760 Richmond City, VA");
  assert.equal(m("Richmond County, VA"), "51159 Richmond County, VA");
  assert.equal(m("Harris County, TX"), "48201 Harris County, TX");
  assert.equal(m("Harris, TX"), "48201 Harris County, TX");
  assert.throws(() => m("Richmond, VA"), (e: any) => e instanceof InputError && /Give a state as well/.test(e.message) && /Richmond City, VA/.test(e.message));
  assert.throws(() => m("Washington County"), (e: any) => e instanceof InputError && /Give a state as well/.test(e.message) && /IL/.test(e.message) && /OR/.test(e.message));
  assert.equal(m("Washington County, OR"), "41067 Washington County, OR");
  assert.throws(() => m("Illinois"), (e: any) => e instanceof InputError && /no state figure/.test(e.message));
  assert.throws(() => m("IL"), (e: any) => e instanceof InputError && /no state figure/.test(e.message));
  assert.throws(() => m("Chicago, IL"), (e: any) => e instanceof InputError && /No county called "Chicago" in IL/.test(e.message));
  assert.throws(() => m("Cook County, Narnia"), (e: any) => e instanceof InputError && /Give a US state/.test(e.message));
  assert.throws(() => m("99999"), (e: any) => e instanceof InputError);
});

test("counties without a price, and other bad requests", () => {
  const none = usAnswer(lib(), { area: "St. Louis County, MO" }, NOW);
  assert.equal(none.status, "no_matches");
  assert.equal(none.price, null);
  assert.match((none.extra as any).reason, /lists St\. Louis County, MO for 2022 but publishes no childcare price/);
  assert.equal(usAnswer(lib(), { area: "Washington County, IL" }, NOW).status, "no_matches");
  assert.throws(() => usAnswer(lib(), {}, NOW), (e: any) => e instanceof InputError && /county is required/.test(e.message));
  assert.throws(() => usAnswer(lib(), { area: "Cook County, IL", hours: "part-time" }, NOW), (e: any) => e instanceof InputError && /full-time/.test(e.message));
  assert.throws(() => usAnswer(lib(), { area: "Cook County, IL", age_group: "teen" }, NOW), (e: any) => e instanceof InputError);
});

test("library round trip: stored by the collector, answered from the library", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "us-childcare-"));
  process.env.PROOFPRICE_LIBRARY_DIR = dir;
  try {
    await assert.rejects(usChildcare({ area: "Cook County, IL" }, NOW), (e: any) => e instanceof SourceError && /Not yet available/.test(e.message));
    const l = lib();
    writeDaily(INFO.id, { date: l.date, currency: "USD", unit: "per week", rows: l.rows });
    const a = await usChildcare({ area: "Harris County, TX", age_group: "infant", care_type: "centre" }, NOW);
    assert.equal(a.price?.value, 185);
    assert.equal((a.extra as any).quality_flag, 2);
    assert.equal((await usChildcare({ area: "Autauga County, AL", age_group: "toddler" }, NOW)).price?.value, 138.72);
  } finally {
    delete process.env.PROOFPRICE_LIBRARY_DIR;
  }
});
