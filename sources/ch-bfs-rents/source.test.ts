// Real format, checked live on 2026-10-29 (BFS asset 36398542, file je-d-09.03.03.64.xlsx, last modified 2026-02-09): sheets "2024" to "2020",
// newest first. Each sheet: a title row, the year, three header rows, then "Schweiz" and 26 cantons with
// Total | CI | Neubau | CI | Neubezug (older home) | CI | 2-5 y | CI | 6-10 y | CI | 11-20 y | CI | 21+ y | CI (CHF a month),
// "X   " and "*   " where fewer than 5 observations; then footnotes. ROWS are real rows from the 2024 and 2023 sheets.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeXlsx } from "../../tests/helpers/make-zip";
import { readXlsx } from "../../categories/rent/xlsx";
import { InputError, SourceError } from "../../lib/http";
import { CANTONS, INFO, chAnswer, chRents, clearCache, fetchOptions, matchCanton, matchTenancy, parseTable } from "./source";

const TITLE = ["Durchschnittlicher Mietpreis1) nach Bezugsdauer der Wohnung2) und Kanton", null, null, null, null, null, null, null, null, null, null, null, null, null, "T 09.03.03.64"];
const HEAD = [[null, "Total"], [null, "Durch-schnittlicher Mietpreis "]];
const R24: (string | number)[][] = [
  ["Schweiz", 1485, 3, 1891, 29, 1520, 8, 1550, 6, 1522, 8, 1399, 8, 1241, 7],
  ["Zürich", 1768, 9, 2254, 70, 1853, 23, 1850, 18, 1812, 22, 1637, 20, 1428, 19],
  ["Bern", 1319, 8, 1681, 100, 1367, 19, 1364, 16, 1325, 21, 1246, 21, 1146, 22],
  ["Glarus", 1299, 48, "X   ", "*   ", 1386, 113, 1352, 79, 1271, 105, 1117, 128, 1104, 124],
  ["Genf", 1573, 14, 1851, 108, 1774, 45, 1740, 32, 1647, 35, 1470, 28, 1285, 18],
  ["Tessin", 1245, 10, 1536, 83, 1258, 20, 1288, 19, 1265, 25, 1218, 26, 1089, 23],
  ["Appenzell A.Rh.", 1320, 42, "X   ", "*   ", 1365, 87, 1395, 80, 1259, 83, 1268, 140, 1095, 102],
];
const R23: (string | number)[][] = [["Schweiz", 1451, 3, 1845, 28, 1478, 8, 1523, 6, 1490, 9, 1364, 8, 1202, 7], ["Zürich", 1722, 9, 2190, 69, 1795, 22, 1824, 17, 1749, 23, 1586, 20, 1372, 18]];
const FOOT = [["Die Strukturerhebung umfasst Personen ab 15 Jahren, die in einem Privathaushalt der ständigen Wohnbevölkerung leben."], ["Quellen: BFS – SE, GWS"]];
// sheets deliberately in the order of the real file (2024 first) and with 2023 listed before 2020
const book = (r24 = R24) => makeXlsx({ "2023": [TITLE, ["2023"], ...HEAD, ...R23, ...FOOT], "2024": [TITLE, ["2024"], ...HEAD, ...r24, ...FOOT] });
const table = (r24 = R24) => parseTable(readXlsx(book(r24)), 5);

test("parseTable: newest year sheet, footnotes cut, X cells not published", () => {
  const t = table();
  assert.equal(t.year, 2024);
  assert.equal(t.rows.length, R24.length);
  assert.deepEqual(t.rows[1].cells.any, { rent: 1768, ci: 9 });
  assert.deepEqual(t.rows[1].cells.new_build, { rent: 2254, ci: 70 });
  assert.deepEqual(t.rows[1].cells["21plus"], { rent: 1428, ci: 19 });
  assert.deepEqual(t.rows[3].cells.new_build, { rent: null, ci: null }); // Glarus: X
  assert.throws(() => parseTable(readXlsx(book())), /Only 7 rows/);
  assert.throws(() => parseTable(readXlsx(makeXlsx({ Notes: [["x"]] }))), /no sheet named by year/);
  assert.throws(() => parseTable(readXlsx(makeXlsx({ "2024": [["nothing"]] }))), /no 'Schweiz' row/);
});

test("places: cantons by German, English, French, Italian name or code; towns are refused with the list", () => {
  assert.equal(matchCanton(undefined), "Schweiz");
  assert.equal(matchCanton("Switzerland"), "Schweiz");
  assert.equal(matchCanton("Zurich"), "Zürich");
  assert.equal(matchCanton("ZH"), "Zürich");
  assert.equal(matchCanton("geneva"), "Genf");
  assert.equal(matchCanton("Genève"), "Genf");
  assert.equal(matchCanton("Ticino"), "Tessin");
  assert.equal(matchCanton("Vaud"), "Waadt");
  assert.equal(matchCanton("Grisons"), "Graubünden");
  assert.equal(matchCanton("St. Gallen"), "St.Gallen");
  assert.equal(matchCanton("Basel-Stadt"), "Basel-Stadt");
  assert.equal(matchCanton("Appenzell Innerrhoden"), "Appenzell I.Rh.");
  assert.equal(CANTONS.length, 26);
  assert.throws(() => matchCanton("Lausanne"), /not a Swiss canton.*canton only|canton only/s);
  assert.throws(() => matchCanton("Lausanne"), InputError);
});

test("tenancy length options", () => {
  assert.equal(matchTenancy(undefined).key, "any");
  assert.equal(matchTenancy("new_let").key, "new_let");
  assert.equal(matchTenancy("New build").key, "new_build");
  assert.equal(matchTenancy("2_5y").key, "2_5y");
  assert.equal(matchTenancy("21plus").key, "21plus");
  assert.throws(() => matchTenancy("forever"), /tenancy_length must be one of/);
});

test("answer: Zürich all tenancies is the published 1,768 CHF with its interval and comparison", () => {
  const a = chAnswer(table(), { town: "Zürich" }, new Date("2026-10-29"));
  assert.equal(a.status, "ok");
  assert.equal(a.price?.value, 1768);
  assert.equal(a.price?.median, null);
  assert.equal(a.price?.currency, "CHF");
  assert.equal(a.price?.unit, "per month");
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.sample_size ?? null, null);
  assert.equal(a.period?.from, "2024-01-01");
  assert.match(a.summary, /1,768/);
  assert.match(a.summary, /canton Zürich/);
  assert.equal((a.extra as any).confidence_interval_chf, 9);
  assert.equal((a.extra as any).switzerland_same_tenancy, 1485);
  assert.equal((a.extra as any).by_tenancy_length.new_build, 2254);
  const geneva = chAnswer(table(), { town: "Geneva", tenancy_length: "new_let" });
  assert.equal(geneva.price?.value, 1774);
  const ch = chAnswer(table(), {});
  assert.equal(ch.price?.value, 1485);
  assert.match(ch.summary, /Switzerland/);
});

test("answer: an unpublished cell (fewer than 5 observations) is no_matches, never a made-up number", () => {
  const a = chAnswer(table(), { town: "Glarus", tenancy_length: "new_build" });
  assert.equal(a.status, "no_matches");
  assert.equal(a.price, null);
  assert.equal(a.statistic?.note?.includes("fewer than 5 observations"), true);
});

test("answer: unsupported options are refused clearly", () => {
  assert.throws(() => chAnswer(table(), { bedrooms: 2 }), /number of rooms or bedrooms/);
  assert.throws(() => chAnswer(table(), { property_type: "house" }), /property type/);
  assert.throws(() => chAnswer(table(), { postcode: "8001" }), /canton, not by postcode/);
  assert.throws(() => chAnswer(table(), { town: "Basel-Stadt", tenancy_length: "x" }), InputError);
});

test("source info: free-tier licence wording, official statistic", () => {
  assert.equal(INFO.price_type, "official_statistic");
  assert.match(INFO.licence, /free-tier/);
});

test("fetching: reads the workbook once, caches it, and a bad request does not download", async () => {
  clearCache();
  const real = globalThis.fetch;
  let calls = 0;
  const body = book(R24.concat([]));
  // widen to 27 rows so parseTable's default minimum passes
  const rows27 = Array.from({ length: 27 }, (_, i) => (i < R24.length ? R24[i] : [`Kanton${i}`, 1200 + i, 20, 1500, 90, 1300, 30, 1300, 25, 1300, 30, 1200, 30, 1100, 30]));
  const wide = book(rows27);
  globalThis.fetch = (async () => {
    calls++;
    return new Response(wide, { status: 200 });
  }) as typeof fetch;
  try {
    await assert.rejects(chRents({ town: "Lausanne" }), InputError);
    assert.equal(calls, 0);
    const a = await chRents({ town: "Bern" });
    assert.equal(a.price?.value, 1319);
    await chRents({ town: "Zürich" });
    assert.equal(calls, 1);
    clearCache();
    fetchOptions.retryDelayMs = 0;
    globalThis.fetch = (async () => new Response("no", { status: 503 })) as typeof fetch;
    await assert.rejects(chRents({}), (e: any) => e instanceof SourceError && /Could not reach the official source/.test(e.message));
  } finally {
    globalThis.fetch = real;
    fetchOptions.retryDelayMs = 1500;
    clearCache();
  }
  assert.ok(body.length > 0);
});
