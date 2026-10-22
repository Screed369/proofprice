// Tests for the SP Group tariff source. fixtures/tariff.json is a REAL copy (first three rows) of
// https://data.gov.sg/api/action/datastore_search?resource_id=d_d610f8ed1864daa6c7e790318bbc3323 checked on 2026-10-22.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { InputError, SourceError } from "../../lib/http";
import { parseDatastoreSearch } from "../../lib/adapters";
import { SOURCE_PLUGINS } from "../../lib/registry";
import { INFO, answerFromSeries, normaliseBand, parseDomestic, sgElectricity } from "./source";

const RECORDS = parseDatastoreSearch(JSON.parse(readFileSync(new URL("./fixtures/tariff.json", import.meta.url), "utf8"))).records;

test("licence and type", () => {
  assert.match(INFO.licence, /Singapore Open Data Licence/);
  assert.equal(INFO.price_type, "posted_price");
});

test("parses the domestic row of the real table", () => {
  const s = parseDomestic(RECORDS);
  assert.equal(s.byYear[2025], 27.82);
  assert.equal(s.byYear[2024], 29.67);
  assert.equal(Object.keys(s.byYear).length, 14);
  assert.throws(() => parseDomestic([RECORDS[2]]), SourceError);
  assert.throws(() => parseDomestic([{ DataSeries: "Low Tension Supplies - Domestic", "2025": "27.82" }]), SourceError);
});

test("answer: SGD per kWh, latest year, posted tariff, no sample size", () => {
  const a = answerFromSeries(parseDomestic(RECORDS), { energy: "electricity" });
  assert.equal(a.status, "ok");
  assert.equal(a.price!.currency, "SGD");
  assert.equal(a.price!.value, 0.2782);
  assert.equal(a.sample_size, null);
  assert.equal(a.price_type, "posted_price");
  assert.deepEqual(a.period, { from: "2025-01-01", to: "2025-12-31" });
  assert.equal((a.extra as any).previous_cents_per_kwh, 29.67);
  assert.equal((a.extra as any).change_pct, -6.2);
  assert.match(a.summary, /excluding GST/);
});

test("input handling", () => {
  assert.doesNotThrow(() => normaliseBand(""));
  assert.doesNotThrow(() => normaliseBand("Standard"));
  assert.throws(() => normaliseBand("high"), InputError);
  assert.throws(() => answerFromSeries(parseDomestic(RECORDS), { energy: "gas" }), InputError);
});

test("end to end with a fake fetcher", async () => {
  const a = await sgElectricity({ energy: "electricity" }, async () => RECORDS);
  assert.equal(a.price!.value, 0.2782);
});

test("registered for SG energy", () => {
  const p = SOURCE_PLUGINS.find((x) => x.info.id === "sg-sp-tariff");
  assert.ok(p);
  assert.deepEqual(p!.countries, ["SG"]);
});
