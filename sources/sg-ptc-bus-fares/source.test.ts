// Tests for the SG trunk bus fare table. fixtures/bus-fares.json is the REAL, complete response (39 rows) of
// https://data.gov.sg/api/action/datastore_search?resource_id=d_828dcf144fe4f82c85c53d15a19e920f&limit=100 checked on 2026-11-05.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { InputError, SourceError } from "../../lib/http";
import { parseDatastoreSearch } from "../../lib/adapters";
import { INFO, answerFromBusFares, parseBusFares, parseDistance, sgBusFares } from "./source";
import plugin from "./index";

const RECORDS = parseDatastoreSearch(JSON.parse(readFileSync(new URL("./fixtures/bus-fares.json", import.meta.url), "utf8"))).records;

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

test("parses all 39 real rows", () => {
  const rows = parseBusFares(RECORDS);
  assert.equal(rows.length, 39);
  assert.equal(rows[0].cents.adult.card, 128);
  assert.equal(rows[0].cents.adult.cash, 210);
  assert.equal(rows[38].cents.workfare.card, 187);
  assert.throws(() => parseBusFares(RECORDS.slice(0, 3)), SourceError);
});

test("adult card 3 km = 1.28, 8.5 km, cash", () => {
  const rows = parseBusFares(RECORDS);
  const a = answerFromBusFares(rows, { distance_km: 3 });
  assert.equal(a.status, "ok");
  assert.equal(a.price!.currency, "SGD");
  assert.equal(a.price!.value, 1.28);
  assert.equal(a.sample_size, null);
  assert.equal(a.price_type, "posted_price");
  const cash = answerFromBusFares(rows, { distance_km: 3, payment: "cash" });
  assert.equal(cash.price!.value, 2.1);
  const mid = answerFromBusFares(rows, { distance_km: 8.5 });
  assert.ok(mid.price!.value > 1.28 && mid.price!.value < 2.57);
});

test("gap distance 3.25 belongs to the band above; over 40.2 km is the last row", () => {
  const rows = parseBusFares(RECORDS);
  assert.equal(answerFromBusFares(rows, { distance_km: 3.25 }).price!.value, 1.38);
  assert.equal(answerFromBusFares(rows, { distance_km: 99 }).price!.value, 2.57);
  assert.equal(answerFromBusFares(rows, { distance_km: 99, fare_type: "student", payment: "cash" }).price!.value, 1.2);
});

test("bad input", () => {
  const rows = parseBusFares(RECORDS);
  assert.throws(() => answerFromBusFares(rows, { fare_type: "vip" }), InputError);
  assert.throws(() => answerFromBusFares(rows, { payment: "bitcoin" }), InputError);
  assert.throws(() => answerFromBusFares(rows, { distance_km: -2 }), InputError);
});

test("early travel_time: full fare plus a note", () => {
  const a = answerFromBusFares(parseBusFares(RECORDS), { distance_km: 3, travel_time: "early" });
  assert.equal(a.price!.value, 1.28);
  assert.match(JSON.stringify(a), /no early-morning discount/);
});

test("handle goes through the fetcher", async () => {
  const a = await sgBusFares({ distance_km: 12, fare_type: "senior" }, async () => RECORDS);
  assert.equal(a.status, "ok");
  assert.match(a.source.licence ?? "", /Singapore Open Data Licence/);
});

test("routing: only service=bus selects this source", () => {
  assert.equal(plugin.serves!({ country: "SG", service: "bus" }), true);
  assert.equal(plugin.serves!({ country: "SG" }), false);
});
