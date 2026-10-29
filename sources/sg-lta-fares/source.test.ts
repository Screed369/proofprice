// Tests for the SG MRT fare table. fixtures/fares.json is a REAL slice (first 78 rows = adult card fare, both time bands, plus the last 10 rows)
// of https://data.gov.sg/api/action/datastore_search?resource_id=d_2ca29f673b89e0cfddbb7c74516fa4d3&limit=400 checked on 2026-10-29.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { InputError, SourceError } from "../../lib/http";
import { parseDatastoreSearch } from "../../lib/adapters";
import { INFO, answerFromFares, parseDistance, parseFares, sgFares } from "./source";

const RECORDS = parseDatastoreSearch(JSON.parse(readFileSync(new URL("./fixtures/fares.json", import.meta.url), "utf8"))).records;

test("licence and type", () => {
  assert.match(INFO.licence, /Singapore Open Data Licence/);
  assert.equal(INFO.price_type, "posted_price");
});

test("distance bands", () => {
  assert.deepEqual(parseDistance("Up to 3.2 km"), { from: 0, to: 3.2 });
  assert.deepEqual(parseDistance("3.3 km - 4.2 km"), { from: 3.3, to: 4.2 });
  assert.deepEqual(parseDistance("Over 40.2 km"), { from: 40.2, to: Infinity });
  assert.equal(parseDistance("nonsense"), null);
});

test("parses the real rows", () => {
  const rows = parseFares(RECORDS);
  assert.equal(rows.length, 88);
  assert.equal(rows[0].group, "adult");
  assert.equal(rows[0].band, "early");
  assert.equal(rows[0].cents, 78);
  assert.throws(() => parseFares(RECORDS.slice(0, 3)), SourceError);
});

test("adult 3 km: early 0.78, other 1.28 (real table)", () => {
  const rows = parseFares(RECORDS);
  const early = answerFromFares(rows, { distance_km: 3, travel_time: "early" });
  assert.equal(early.status, "ok");
  assert.equal(early.price!.currency, "SGD");
  assert.equal(early.price!.value, 0.78);
  assert.equal(early.sample_size, null);
  assert.equal(early.price_type, "posted_price");
  const other = answerFromFares(rows, { distance_km: 3 });
  assert.equal(other.price!.value, 1.28);
});

test("a distance in the gap between bands takes the band above; default is adult at 5 km", () => {
  const rows = parseFares(RECORDS);
  const gap = answerFromFares(rows, { distance_km: 3.25, travel_time: "early" });
  assert.equal((gap.extra as any).distance_band, "3.3 km - 4.2 km");
  assert.equal(gap.price!.value, 0.88);
  const def = answerFromFares(rows, {});
  assert.equal((def.extra as any).distance_band, "4.3 km - 5.2 km");
});

test("input handling", async () => {
  const rows = parseFares(RECORDS);
  assert.throws(() => answerFromFares(rows, { fare_type: "vip" }), InputError);
  assert.throws(() => answerFromFares(rows, { travel_time: "night" }), InputError);
  assert.throws(() => answerFromFares(rows, { distance_km: -1 }), InputError);
  // the fixture holds adult fares only, so another group has no band
  assert.throws(() => answerFromFares(rows, { fare_type: "student" }), SourceError);
  const a = await sgFares({ distance_km: 50 }, async () => RECORDS);
  assert.equal((a.extra as any).distance_band, "Over 40.2 km");
});
