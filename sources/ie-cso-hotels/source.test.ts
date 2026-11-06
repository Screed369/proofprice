// Fixture ita12.csv: the complete real CSO ITA12 CSV (50 rows, 2023-2024), downloaded 2026-11-06.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { INFO, ITA12_URL, accommodationCode, answerFromRows, ieHotels, parseIta12, pickLatest, residencyCode, splitCsvLine } from "./source";

const CSV = readFileSync(new URL("./fixtures/ita12.csv", import.meta.url), "utf8");

test("parses 50 rows, strips the BOM, blank cells become null", () => {
  const rows = parseIta12(CSV);
  assert.equal(rows.length, 50);
  const allHotels2024 = rows.find((r) => r.year === "2024" && r.residencyCode === "-" && r.accommodationCode === "111")!;
  assert.equal(allHotels2024.value, null);
  const gb2023 = rows.find((r) => r.year === "2023" && r.residencyCode === "XB" && r.accommodationCode === "111")!;
  assert.equal(gb2023.value, 119);
});

test("csv line splitting handles quotes and commas", () => {
  assert.deepEqual(splitCsvLine('"a","b, c","d ""q"""'), ["a", "b, c", 'd "q"']);
});

test("word matching", () => {
  assert.equal(residencyCode(), "-");
  assert.equal(residencyCode("UK"), "XB");
  assert.equal(residencyCode("USA & Canada"), "USCA");
  assert.equal(residencyCode("Germany"), "OTHEUR3");
  assert.throws(() => residencyCode("Mars"), /not a visitor home market/);
  assert.equal(accommodationCode(), "111");
  assert.equal(accommodationCode("B&B"), "92");
  assert.equal(accommodationCode("self-catering"), "94");
  assert.throws(() => accommodationCode("igloo"), /not an accommodation type/);
});

test("latest published year falls back when the newest cell is blank", () => {
  const rows = parseIta12(CSV);
  const p = pickLatest(rows, "-", "111")!;
  assert.equal(p.row.year, "2023");
  assert.equal(p.row.value, 130);
  assert.equal(p.previous, null);
  assert.deepEqual(p.blankNewerYears, ["2024"]);
});

test("USA & Canada hotels 2024 with year-on-year", () => {
  const a = answerFromRows(parseIta12(CSV), { area: "USA & Canada" });
  assert.equal(a.status, "ok");
  assert.equal(a.price?.currency, "EUR");
  assert.equal(a.price?.value, 148);
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.sample_size, null);
  assert.equal(a.price?.typical_low, null);
  assert.match(a.summary, /2024/);
  assert.match(a.summary, /€148/);
});

test("all visitors hotels says the 2024 cell is not published", () => {
  const a = answerFromRows(parseIta12(CSV), {});
  assert.equal(a.status, "ok");
  assert.equal(a.price?.value, 130);
  assert.match(a.statistic?.note ?? "", /2024/);
});

test("fetch uses the CSO URL; bad words fail before any request", async () => {
  const calls: string[] = [];
  const a = await ieHotels({ area: "Great Britain" }, async (u) => (calls.push(u), CSV));
  assert.deepEqual(calls, [ITA12_URL]);
  assert.equal(a.status, "ok");
  let n = 0;
  await assert.rejects(ieHotels({ area: "Mars" }, async () => (n++, CSV)), /not a visitor home market/);
  assert.equal(n, 0);
  assert.match(INFO.licence, /CC BY 4.0/);
});

test("layout change is reported", () => {
  assert.throws(() => parseIta12('"A","B"\n"1","2"'), /changed the layout/);
});
