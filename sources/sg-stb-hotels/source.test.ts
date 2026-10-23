// Fixture fixtures/rows.json is the real data.gov.sg response captured through the GitHub-hosted probe on 2026-10-23 (1,856 bytes, 2008 to 2025).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { INFO, sgHotelAnswer, sgHotels, parseRows } from "./source";

const JSON_ROWS = JSON.parse(readFileSync(new URL("./fixtures/rows.json", import.meta.url), "utf8"));

test("real response parses to yearly series", () => {
  const d = parseRows(JSON_ROWS);
  assert.equal(d.rate["2025"], 273.5);
  assert.equal(d.rate["2024"], 276.2);
  assert.equal(d.hotels["2025"], 285);
  assert.equal(d.occupancy["2025"], 82);
});

test("answer: latest year, hotel count as sample, official statistic", () => {
  const a = sgHotelAnswer(parseRows(JSON_ROWS), {});
  assert.equal(a.status, "ok");
  assert.equal(a.price!.value, 273.5);
  assert.equal(a.price!.currency, "SGD");
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.sample_size, 285);
  const e = a.extra as any;
  assert.equal(e.reference_year, "2025");
  assert.equal(e.change_on_year_earlier.value, 276.2);
  assert.equal(e.change_on_year_earlier.change_percent, -1);
  assert.equal(e.last_five_years.length, 5);
  assert.match(a.summary, /S\$|SGD/);
});

test("an earlier year can be asked for", () => {
  const a = sgHotelAnswer(parseRows(JSON_ROWS), { year: "2019" });
  assert.equal(a.price!.value, 220.8);
  assert.equal(a.sample_size, 248);
});

test("a district, star class or unknown year is refused, never answered with the national figure", async () => {
  await assert.rejects(() => sgHotels({ area: "Sentosa" }, async () => JSON_ROWS), /whole/);
  await assert.rejects(() => sgHotels({ stars: 5 }, async () => JSON_ROWS), /star/);
  await assert.rejects(() => sgHotels({ year: "1999" }, async () => JSON_ROWS), /available/);
  const ok = await sgHotels({ area: "Singapore" }, async () => JSON_ROWS);
  assert.equal(ok.status, "ok");
  assert.equal(INFO.price_type, "official_statistic");
});

test("layout change is an error", () => {
  assert.throws(() => parseRows({ data: { rows: [{ DataSeries: "x" }] } }), /layout/);
});
