// Fixture fixtures/rate.csv is the real CSTB file captured through the GitHub-hosted probe on 2026-10-20 (824 bytes, 202108 to 202607).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { INFO, hkHotelAnswer, hkHotels, parseRates } from "./source";

const CSV = readFileSync(new URL("./fixtures/rate.csv", import.meta.url), "utf8");

test("real file parses to monthly rows", () => {
  const rows = parseRates(CSV);
  assert.equal(rows.length, 60);
  assert.deepEqual(rows[0], { month: "2021-08", rate: 863 });
  assert.deepEqual(rows[rows.length - 1], { month: "2026-07", rate: 1205 });
});

test("answer: latest month, year-on-year, official statistic", () => {
  const a = hkHotelAnswer(parseRates(CSV), {});
  assert.equal(a.status, "ok");
  assert.equal(a.price!.value, 1205);
  assert.equal(a.price!.currency, "HKD");
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.sample_size, null);
  const e = a.extra as any;
  assert.equal(e.reference_month, "2026-07");
  assert.equal(e.change_on_year_earlier.value, 1138);
  assert.equal(e.change_on_year_earlier.change_percent, 5.9);
  assert.equal(e.last_12_months.length, 12);
  assert.match(a.summary, /HK\$|HKD/);
  assert.equal(INFO.price_type, "official_statistic");
});

test("a district or star class is refused, never answered with the city figure", async () => {
  await assert.rejects(() => hkHotels({ area: "Kowloon" }, async () => CSV), /whole/);
  await assert.rejects(() => hkHotels({ stars: 4 }, async () => CSV), /star/);
  const ok = await hkHotels({ area: "Hong Kong" }, async () => CSV);
  assert.equal(ok.status, "ok");
});

test("layout change is an error", () => {
  assert.throws(() => parseRates("a,b\n1,2\n"), /layout/);
});
