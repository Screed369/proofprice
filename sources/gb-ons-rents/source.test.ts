// Real formats, checked live on 2026-10-14 (ONS edition 16 September 2026, latest month August 2026):
//  - GET <dataset>/data lists editions newest first: {"datasets":[{"uri":".../16september2026"}, {"uri":".../19august2026"}, ...]}
//  - GET <edition uri>/data has {"downloads":[{"file":"priceindexofprivaterentsukmonthlypricestatistics.xlsx"}], ...}
//  - the workbook has sheets "Cover sheet", "Contents", "Notes", "Table 1"; Table 1 has two text rows, then the header
//    "Time period | Area code | Area name | Region or country name | Index | Monthly change | Annual change | Rental price | ..."
//    (9 groups of four: all homes, one/two/three/four or more bedrooms, detached, semidetached, terraced, flat maisonette).
//    "Time period" is an Excel date (46235 = 2026-08-01); unavailable cells hold the text [x] or [z].
// ROWS below are real rows from that table (numbers copied from the live file). Only the number of rows is reduced.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { makeXlsx } from "../../tests/helpers/make-zip";
import { excelDate, readXlsx } from "../../categories/rent/xlsx";
import { writeDaily } from "../../lib/library/store";
import { InputError, SourceError } from "../../lib/http";
import { INFO, MEASURES, areaKind, editionFileUrl, gbAnswer, gbHarvest, gbRents, gbSelect, harvestOptions, latestEditionUri, matchArea, monthEnd, parsePipr, piprRows } from "./source";

const HEADER: string[] = [
  "Time period", "Area code", "Area name", "Region or country name",
  "Index", "Monthly change", "Annual change", "Rental price",
  "Index one bed", "Monthly change one bed", "Annual change one bed", "Rental price one bed",
  "Index two bed", "Monthly change two bed", "Annual change two bed", "Rental price two bed",
  "Index three bed", "Monthly change three bed", "Annual change three bed", "Rental price three bed",
  "Index four or more bed", "Monthly change four or more bed", "Annual change four or more bed", "Rental price four or more bed",
  "Index detached", "Monthly change detached", "Annual change detached", "Rental price detached",
  "Index semidetached", "Monthly change semidetached", "Annual change semidetached", "Rental price semidetached",
  "Index terraced", "Monthly change terraced", "Annual change terraced", "Rental price terraced",
  "Index flat maisonette", "Monthly change flat maisonette", "Annual change flat maisonette", "Rental price flat maisonette",
];
const X = Array(36).fill("[x]");
const L = 46235; // August 2026
const ROWS: (string | number)[][] = [
  [L, "K02000001", "United Kingdom", "[z]", 124.932225, 0.498334, 3.814671, 1400, 127.079726, 0.404803, 3.848848, 1136, 125.479373, 0.484801, 3.89678, 1281, 125.087103, 0.568037, 4.208251, 1430, 121.182323, 0.615298, 3.440842, 2080, 121.866627, 0.496477, 3.442539, 1589, 124.569883, 0.555372, 4.10733, 1392, 124.846001, 0.56187, 4.219668, 1387, 125.996241, 0.423397, 3.466163, 1367],
  [L, "K03000001", "Great Britain", "[z]", 124.962941, 0.509967, 3.872213, 1412, 127.097502, 0.405537, 3.854188, 1138, 125.496544, 0.48868, 3.925084, 1290, 125.160833, 0.599011, 4.349754, 1454, 121.0794, 0.64145, 3.5483, 2118, 121.942903, 0.507251, 3.515568, 1607, 124.621556, 0.580817, 4.232672, 1412, 124.828351, 0.578642, 4.292316, 1404, 126.022927, 0.425161, 3.485793, 1373],
  [L, "E92000001", "England", "[z]", 125.128016, 0.555099, 3.995037, 1459, 127.369704, 0.416707, 3.907523, 1195, 125.722805, 0.531699, 4.044089, 1335, 125.158818, 0.644585, 4.45069, 1489, 120.905578, 0.695231, 3.64814, 2161, 121.956078, 0.610047, 3.903824, 1640, 124.708781, 0.603378, 4.30447, 1449, 124.847822, 0.603201, 4.375176, 1435, 126.34064, 0.480828, 3.584318, 1444],
  [L, "W92000004", "Wales", "[z]", 128.393411, 0.283161, 4.336074, 846, 128.106991, 0.263043, 4.109194, 636, 127.575369, 0.290178, 4.277523, 779, 128.731577, 0.194699, 4.644776, 890, 129.958658, 0.276427, 3.130158, 1247, 128.412996, 0.36084, 4.516214, 1083, 128.010166, 0.39071, 4.507059, 877, 129.517069, 0.260514, 4.616317, 833, 127.22326, 0.15571, 3.66224, 706],
  [L, "S92000003", "Scotland", "[z]", 120.015945, -0.319383, 1.080998, 1013, 122.560693, 0.273782, 2.799579, 702, 121.028142, -0.18414, 1.790517, 911, 121.833927, -0.335576, 1.356956, 1172, 118.711143, -0.805332, 1.042965, 1941, 117.165613, -0.656604, -1.264384, 1555, 117.177874, -0.15424, 0.873713, 1077, 118.858283, -0.150072, 0.413988, 1004, 121.588373, -0.29562, 1.976004, 840],
  [L, "N92000002", "Northern Ireland", "[z]", ...X],
  [L, "[z]", "Belfast BRMA", "Northern Ireland", ...X],
  [L, "E12000002", "North West", "[z]", 129.759821, 0.486583, 5.78024, 969, 131.383981, 0.293063, 5.521597, 702, 130.158785, 0.445496, 5.731182, 882, 129.899875, 0.560678, 6.15589, 1056, 125.218575, 0.529241, 5.120016, 1499, 127.154631, 0.538235, 5.395495, 1349, 129.956491, 0.527403, 6.035424, 1062, 130.166387, 0.531871, 6.032258, 977, 129.811893, 0.318479, 5.213547, 815],
  [L, "E12000007", "London", "[z]", 127.395646, 0.643146, 3.521148, 2332, 129.104548, 0.478914, 3.662321, 1760, 127.738787, 0.620801, 3.582624, 2232, 127.372878, 0.770397, 3.892124, 2643, 123.061732, 0.872192, 3.049964, 3646, 126.173082, 0.706704, 3.608006, 2920, 126.555155, 0.744276, 3.521202, 2946, 126.509802, 0.805957, 3.763007, 2840, 127.94823, 0.557469, 3.433214, 2056],
  [L, "E06000023", "Bristol, City of", "South West", 118.586462, 0.185038, 5.906697, 1883, 121.321855, 0.168259, 5.943274, 1225, 119.878951, 0.181418, 5.940077, 1544, 119.91534, 0.219408, 6.41545, 1759, 114.685558, 0.153033, 5.48431, 2546, 118.009663, 0.227473, 5.580909, 2106, 118.789341, 0.223887, 6.15899, 2091, 117.93904, 0.172462, 6.083396, 2008, 119.663176, 0.149845, 5.673837, 1508],
  [L, "E08000003", "Manchester", "North West", 130.879931, 0.536133, 4.198189, 1373, 132.196373, 0.46272, 3.7056, 1003, 130.801409, 0.480989, 3.7327, 1233, 131.236122, 0.56185, 4.474527, 1433, 126.379906, 0.472374, 3.399154, 2014, 129.115337, 0.562311, 3.723771, 1878, 131.27547, 0.58915, 4.497806, 1496, 130.975276, 0.540146, 4.474971, 1405, 131.014685, 0.463824, 3.617801, 1147],
  [45870, "E08000003", "Manchester", "North West", 125.606724, 0.131915, 5.135835, 1317, 127.472744, 0.212545, 5.844331, 967, 126.094673, 0.166532, 5.381975, 1189, 125.615427, 0.124088, 4.999818, 1371, 122.22528, 0.062101, 3.809318, 1948, 124.479986, 0.002921, 4.069659, 1810, 125.625098, 0.065889, 4.62717, 1431, 125.365219, 0.16169, 5.251054, 1345, 126.440326, 0.179969, 5.645197, 1107],
  [L, "E09000033", "Westminster", "London", 125.695566, 0.540043, -0.57962, 3196, 127.875575, 0.57069, -0.070139, 2548, 126.103825, 0.579021, -0.338329, 3305, 124.915706, 0.601064, -0.456538, 3895, 120.655695, 0.521219, -1.35674, 5424, 125.695566, 0.540043, -0.57962, 2908, 126.000276, 0.540043, -0.57962, 2921, 124.276031, 0.569373, -0.638923, 3810, 126.242266, 0.527983, -0.546785, 2957],
  [L, "W06000015", "Cardiff", "Wales", 134.111595, 0.662138, 3.465786, 1177, 133.161328, 0.609725, 3.039537, 908, 132.242937, 0.593946, 3.127968, 1085, 134.974027, 0.699122, 4.205662, 1211, 137.444938, 0.553528, 2.555948, 1703, 134.538047, 0.75982, 3.274341, 1516, 133.68091, 0.739586, 3.68772, 1186, 135.453517, 0.631885, 3.90196, 1177, 132.31852, 0.568262, 2.752948, 995],
];

const TITLE = "Price Index of Private Rents, UK: monthly price statistics [note 1, 2, 3, 4, 5, 6, 7, 8]";
const INTRO = "This worksheet contains one table. Some cells refer to notes that can be found within the notes worksheet.";
const workbook = (rows = ROWS) => makeXlsx({ "Cover sheet": [["Price Index of Private Rents (PIPR), UK: monthly price statistics"]], Notes: [["Notes"]], "Table 1": [[TITLE], [INTRO], HEADER, ...rows] });
const tableRows = (rows = ROWS) => readXlsx(workbook(rows)).find((s) => s.name === "Table 1")!.rows;

const BASE = "/economy/inflationandpriceindices/datasets/priceindexofprivaterentsukmonthlypricestatistics";
const LIST = { section: {}, relatedDatasets: [], datasets: [{ uri: `${BASE}/16september2026` }, { uri: `${BASE}/19august2026` }, { uri: `${BASE}/22july2026` }] };
const EDITION = { downloads: [{ file: "priceindexofprivaterentsukmonthlypricestatistics.xlsx" }], supplementaryFiles: [], versions: [], type: "dataset", uri: `${BASE}/16september2026` };

test("dates: the table's Time period is an Excel date for the first of the month", () => {
  assert.equal(excelDate(L), "2026-08-01");
  assert.equal(excelDate(45870), "2025-08-01");
  assert.equal(monthEnd("2026-08"), "2026-08-31");
});

test("edition discovery: newest edition first, then the xlsx download", () => {
  assert.equal(latestEditionUri(LIST), `${BASE}/16september2026`);
  assert.throws(() => latestEditionUri({ datasets: [] }), /lists no editions/);
  assert.equal(editionFileUrl(`${BASE}/16september2026`, EDITION), `https://www.ons.gov.uk/file?uri=${BASE}/16september2026/priceindexofprivaterentsukmonthlypricestatistics.xlsx`);
  assert.throws(() => editionFileUrl("/x", { downloads: [{ file: "notes.pdf" }] }), /no \.xlsx/);
});

test("area codes: England and Wales only", () => {
  assert.equal(areaKind("E92000001"), "country");
  assert.equal(areaKind("W92000004"), "country");
  assert.equal(areaKind("E12000007"), "region");
  for (const c of ["E06000023", "E07000008", "E08000003", "E09000033", "W06000015"]) assert.equal(areaKind(c), "local authority");
  for (const c of ["K02000001", "K03000001", "S92000003", "S33000009", "N92000002", "[z]", ""]) assert.equal(areaKind(c), null);
});

test("parsePipr: latest month only, England and Wales only, published numbers", () => {
  const p = parsePipr(tableRows(), 5);
  assert.equal(p.month, "2026-08");
  assert.equal(p.serial, L);
  assert.deepEqual(p.areas.map((a) => a.name).sort(), ["Bristol, City of", "Cardiff", "England", "London", "Manchester", "North West", "Wales", "Westminster"]);
  const m = p.areas.find((a) => a.name === "Manchester")!;
  assert.equal(m.code, "E08000003");
  assert.equal(m.kind, "local authority");
  assert.deepEqual(m.values.all, { rent: 1373, change: 4.2 }); // the August row, not the 2025 one (1317)
  assert.deepEqual(m.values.bed2, { rent: 1233, change: 3.7 });
  assert.deepEqual(m.values.bed4, { rent: 2014, change: 3.4 });
  assert.deepEqual(m.values.detached, { rent: 1878, change: 3.7 });
  assert.deepEqual(m.values.flat, { rent: 1147, change: 3.6 });
  assert.deepEqual(p.areas.find((a) => a.name === "Westminster")!.values.all, { rent: 3196, change: -0.6 });
  assert.throws(() => parsePipr(tableRows()), /Only 8 England and Wales areas/);
  assert.throws(() => parsePipr([["a"], ["b"]]), /no 'Time period' header/);
  assert.throws(() => parsePipr([["Time period", "Area code", "Area name"], [L, "E92000001", "England"]]), /no 'Rental price' column/);
  assert.throws(() => parsePipr([HEADER], 1), /no dated rows/);
});

test("a missing value ([x]) gives no row; library rows are the published figures", () => {
  const rows = tableRows([...ROWS, [L, "E07000008", "Cambridge", "East of England", ...Array(36).fill(0).map((_, i) => (i % 4 === 3 ? (i === 3 ? 1500 : "[x]") : i % 4 === 2 ? 2.5 : "[x]"))]]);
  const p = parsePipr(rows, 5);
  const c = p.areas.find((a) => a.name === "Cambridge")!;
  assert.deepEqual(c.values.all, { rent: 1500, change: 2.5 });
  assert.deepEqual(c.values.bed1, { rent: null, change: 2.5 });
  const lib = piprRows(p);
  assert.ok(lib.every((r) => r.n === 5 && r.median === r.low && r.low === r.high && r.high === r.min && r.min === r.max));
  assert.ok(!lib.some((r) => r.area.startsWith("E07000008") && r.item === "bed1"));
  assert.ok(lib.some((r) => r.area === "E07000008 Cambridge" && r.item === "all" && r.median === 1500));
  assert.equal(lib.filter((r) => r.area === "E08000003 Manchester").length, 18);
  assert.ok(lib.some((r) => r.area === "E08000003 Manchester" && r.item === "flat:yoy" && r.median === 3.6));
  assert.ok(!lib.some((r) => /Scotland|Northern|Kingdom|Great Britain|BRMA/.test(r.area)));
});

test("matching names to areas", () => {
  const names = [
    "England", "Wales", "North West", "North East", "London", "City of London", "Westminster", "Camden", "Manchester", "Bristol, City of", "Kingston upon Hull, City of",
    "Kingston upon Thames", "Newcastle upon Tyne", "Newcastle-under-Lyme", "Cambridge", "South Cambridgeshire", "East Cambridgeshire", "Brighton and Hove",
    "Bath and North East Somerset", "Bournemouth, Christchurch and Poole", "Herefordshire, County of", "Cardiff", "Leeds",
  ].map((name, i) => ({ code: `E${i}`, name }));
  const pick = (t: string) => matchArea(names, t).name;
  assert.equal(pick("manchester"), "Manchester");
  assert.equal(pick("Bristol"), "Bristol, City of");
  assert.equal(pick("bristol, city of"), "Bristol, City of");
  assert.equal(pick("Hull"), "Kingston upon Hull, City of");
  assert.equal(pick("London"), "London");
  assert.equal(pick("city of london"), "City of London");
  assert.equal(pick("Cambridge"), "Cambridge");
  assert.equal(pick("Brighton"), "Brighton and Hove");
  assert.equal(pick("Bournemouth"), "Bournemouth, Christchurch and Poole");
  assert.equal(pick("Herefordshire"), "Herefordshire, County of");
  assert.equal(pick("north west"), "North West");
  assert.equal(pick("Bath"), "Bath and North East Somerset");
  assert.throws(() => matchArea(names, "Kingston"), /matches several areas: Kingston upon Hull, City of; Kingston upon Thames/);
  assert.throws(() => matchArea(names, "Newcastle"), /Newcastle upon Tyne; Newcastle-under-Lyme/);
  assert.throws(() => matchArea(names, "Edinburgh"), /No England or Wales area named 'Edinburgh'/);
  for (const t of ["Scotland", "Northern Ireland", "UK", "United Kingdom", "Great Britain"]) assert.throws(() => matchArea(names, t), /England and Wales only/);
  assert.throws(() => matchArea(names, "  "), /A place is required/);
});

test("bedrooms or property type, never both", () => {
  assert.equal(gbSelect({}).measure.key, "all");
  assert.equal(gbSelect({ property_type: "any" }).basis, "all");
  assert.equal(gbSelect({ bedrooms: 2 }).measure.key, "bed2");
  assert.equal(gbSelect({ bedrooms: 7 }).measure.key, "bed4");
  assert.equal(gbSelect({ property_type: "apartment" }).measure.key, "flat");
  assert.equal(gbSelect({ property_type: "house", house_type: "semi-detached" }).measure.key, "semi-detached");
  assert.equal(gbSelect({ house_type: "terraced" }).measure.key, "terraced");
  assert.throws(() => gbSelect({ bedrooms: 0 }), /start at one bedroom/);
  assert.throws(() => gbSelect({ bedrooms: 2, property_type: "apartment" }), /bedrooms or by property type, not both/);
  assert.throws(() => gbSelect({ property_type: "house" }), /add house_type/);
  assert.throws(() => gbSelect({ property_type: "room" }), /rooms/);
  assert.equal(MEASURES.length, 9);
});

/** The real rows plus 110 SYNTHETIC districts (copies of the Manchester row under made-up codes), to reach the real file's size. */
const BULK: (string | number)[][] = Array.from({ length: 110 }, (_, i) => [L, `E07${String(900000 + i)}`, `Synthetic district ${i}`, "North West", ...ROWS[9].slice(4)]);

function fakeOns(bulk = true) {
  const calls: string[] = [];
  const original = globalThis.fetch;
  const xlsx = workbook(bulk ? [...ROWS, ...BULK] : ROWS);
  globalThis.fetch = (async (url: any) => {
    const u = String(url);
    calls.push(u);
    if (u === `https://www.ons.gov.uk${BASE}/data`) return new Response(JSON.stringify(LIST), { status: 200, headers: { "content-type": "application/json" } });
    if (u === `https://www.ons.gov.uk${BASE}/16september2026/data`) return new Response(JSON.stringify(EDITION), { status: 200, headers: { "content-type": "application/json" } });
    if (u === `https://www.ons.gov.uk/file?uri=${BASE}/16september2026/priceindexofprivaterentsukmonthlypricestatistics.xlsx`) return new Response(xlsx, { status: 200 });
    return new Response("nope", { status: 404 });
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = original) };
}

test("harvest end to end (fake ONS): finds the newest edition and returns the latest month", async () => {
  harvestOptions.retryDelayMs = 0;
  const site = fakeOns();
  try {
    const h = await gbHarvest();
    assert.equal(site.calls.length, 3);
    assert.equal(h.date, "2026-08-31");
    assert.equal(h.currency, "GBP");
    assert.equal(h.unit, "per month");
    assert.equal(h.rows.length, (8 + 110) * 18);
    assert.ok(h.rows.some((r) => r.area === "E08000003 Manchester" && r.item === "all" && r.median === 1373));
    assert.match(h.note ?? "", /2026-08 \(edition 16september2026\)/);
  } finally {
    site.restore();
  }
  // a short table is refused rather than stored
  const short = fakeOns(false);
  try {
    await assert.rejects(gbHarvest(), /Only 8 England and Wales areas/);
  } finally {
    short.restore();
  }
});

/** Writes the fixture as a library day (what the collector does) and returns the directory. */
function libraryWithFixture(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "gb-lib-"));
  process.env.PROOFPRICE_LIBRARY_DIR = dir;
  const p = parsePipr(tableRows(), 5);
  writeDaily(INFO.id, { date: monthEnd(p.month), currency: "GBP", unit: "per month", rows: piprRows(p) });
  return dir;
}

test("answers from the library: the published average, its month, the annual change", async () => {
  libraryWithFixture();
  try {
    const now = new Date("2026-10-14T12:00:00Z");
    const a = await gbRents({ town: "Manchester" }, now);
    assert.equal(a.status, "ok");
    assert.equal(a.price_type, "official_statistic");
    assert.equal(a.price?.currency, "GBP");
    assert.equal(a.price?.unit, "per month");
    assert.equal(a.price?.measure, "average");
    assert.equal(a.price?.value, 1373);
    assert.equal(a.price?.median, null);
    assert.equal(a.price?.typical_low, null);
    assert.equal(a.sample_size, null);
    assert.deepEqual(a.period, { from: "2026-08-01", to: "2026-08-31" });
    assert.equal(a.statistic?.reference_period, "2026-08");
    assert.match(a.summary, /The average monthly private rent for all homes in Manchester was £1,373, up 4\.2% on a year earlier\./);
    assert.match(a.summary, /Official average published by Office for National Statistics \(ONS\) for 2026-08\./);
    // audit 2026-10-14: the new-and-existing-tenancies bias is in the sentence itself, not only in the note
    assert.match(a.summary, /averages new and existing private tenancies, so a tenancy starting today usually costs more; one published average, not a range\./);
    assert.doesNotMatch(a.summary, /paid|typical range|days ago/);
    assert.match(a.statistic?.note ?? "", /new and existing/);
    assert.ok(!/ended about/.test(a.statistic?.note ?? ""));
    const extra = a.extra as any;
    assert.equal(extra.area.ons_code, "E08000003");
    assert.equal(extra.area.kind, "local authority");
    assert.equal(extra.annual_change_percent, 4.2);
    assert.deepEqual(extra.by_bedrooms, { "1": 1003, "2": 1233, "3": 1433, "4 or more": 2014 });
    assert.deepEqual(extra.by_property_type, { detached: 1878, "semi-detached": 1496, terraced: 1405, flat: 1147 });
    assert.match(a.source.licence, /^Open Government Licence v3\.0/);

    const bristol = await gbRents({ town: "Bristol" }, now);
    assert.equal(bristol.price?.value, 1883);
    assert.equal((bristol.query as any).town, "City of Bristol");

    const westminster = await gbRents({ town: "Westminster", bedrooms: 2 }, now);
    assert.equal(westminster.price?.value, 3305);
    assert.match(westminster.summary, /two-bedroom homes in Westminster was £3,305, down 0\.3% on a year earlier/);

    const cardiff = await gbRents({ town: "Cardiff", property_type: "house", house_type: "terraced" }, now);
    assert.equal(cardiff.price?.value, 1177);
    assert.match(cardiff.summary, /terraced houses in Cardiff/);

    assert.equal((await gbRents({ town: "London" }, now)).price?.value, 2332); // the region
    assert.equal((await gbRents({ town: "England" }, now)).price?.value, 1459);
    assert.equal((await gbRents({ town: "wales", property_type: "apartment" }, now)).price?.value, 706);
    assert.equal((await gbRents({ town: "North West", bedrooms: 4 }, now)).price?.value, 1499);

    // old data is flagged
    const old = await gbRents({ town: "Manchester" }, new Date("2027-01-20T00:00:00Z"));
    assert.match(old.statistic?.note ?? "", /latest month we hold is 2026-08, which ended about 142 days ago/);
    assert.match(old.summary, /That month ended about 142 days ago, so rents today may differ\./);
  } finally {
    delete process.env.PROOFPRICE_LIBRARY_DIR;
  }
});

test("input errors are InputErrors with a way forward", async () => {
  libraryWithFixture();
  try {
    await assert.rejects(gbRents({}), (e: any) => e instanceof InputError && /place is required/.test(e.message));
    await assert.rejects(gbRents({ postcode: "M1 1AA" }), (e: any) => e instanceof InputError && /does not publish rents by postcode/.test(e.message));
    await assert.rejects(gbRents({ town: "Scotland" }), (e: any) => e instanceof InputError && /England and Wales only/.test(e.message));
    await assert.rejects(gbRents({ town: "Edinburgh" }), (e: any) => e instanceof InputError);
    await assert.rejects(gbRents({ town: "Manchester", bedrooms: 2, property_type: "apartment" }), (e: any) => e instanceof InputError);
  } finally {
    delete process.env.PROOFPRICE_LIBRARY_DIR;
  }
});

test("an area with no value for the chosen breakdown is no_matches, not a made-up number", () => {
  const lib = { date: "2026-08-31", rows: [{ area: "E07000008 Cambridge", item: "all", median: 1500 }] };
  const a = gbAnswer(lib, { town: "Cambridge", bedrooms: 1 });
  assert.equal(a.status, "no_matches");
  assert.equal(a.price, null);
  assert.equal(gbAnswer(lib, { town: "Cambridge" }).price?.value, 1500);
});

test("no library yet gives a readable error", async () => {
  process.env.PROOFPRICE_LIBRARY_DIR = mkdtempSync(path.join(tmpdir(), "gb-empty-"));
  try {
    await assert.rejects(gbRents({ town: "Manchester" }), (e: any) => e instanceof SourceError && /Not yet available/.test(e.message));
  } finally {
    delete process.env.PROOFPRICE_LIBRARY_DIR;
  }
});

test("INFO: licence quoted from the ONS dataset page; what the figures are and are not", () => {
  assert.match(INFO.licence, /Open Government Licence v3\.0/);
  assert.equal(INFO.licence_url, "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/");
  assert.equal(INFO.price_type, "official_statistic");
  assert.match(INFO.limits, /Scotland \(mainly advertised new lets\)/);
});

test("a published annual change of 0 reads 'unchanged', not 'up 0%'", async () => {
  const lib = { date: "2026-08-31", rows: [
    { area: "E08000003 Manchester", item: "all", median: 1373 },
    { area: "E08000003 Manchester", item: "all:yoy", median: 0 },
  ] };
  const a = gbAnswer(lib, { town: "Manchester" }, new Date("2026-10-14T12:00:00Z"));
  assert.match(a.summary, /was £1,373, unchanged on a year earlier\./);
});
