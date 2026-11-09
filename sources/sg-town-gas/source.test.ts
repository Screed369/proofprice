// Tests for the Singapore town gas source. fixtures/tariff.json is a REAL copy of
// https://data.gov.sg/api/action/datastore_search?resource_id=d_9835e2085751e6b9c3efae9fdf2b9c5c&limit=20 checked on 2026-11-09.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { InputError, SourceError } from "../../lib/http";
import { datastoreSearchUrl, parseDatastoreSearch } from "../../lib/adapters";
import { SOURCE_PLUGINS, findSource } from "../../lib/registry";
import { RESOURCE_ID, SITE, INFO, answerFromSeries, normaliseBand, parseTariff, sgGas } from "./source";

const RECORDS = parseDatastoreSearch(JSON.parse(readFileSync(new URL("./fixtures/tariff.json", import.meta.url), "utf8"))).records;

test("licence and type", () => {
  assert.match(INFO.licence, /Singapore Open Data Licence/);
  assert.equal(INFO.price_type, "posted_price");
});

test("parses the three real rows", () => {
  assert.equal(RECORDS.length, 3);
  assert.equal(parseTariff(RECORDS, "general").byYear[2025], 22.52);
  assert.equal(parseTariff(RECORDS, "general").byYear[2024], 23.17);
  assert.equal(parseTariff(RECORDS, "bulk_a").byYear[2025], 21.26);
  assert.equal(parseTariff(RECORDS, "bulk_b").byYear[2025], 20.63);
  assert.throws(() => parseTariff([RECORDS[0]], "bulk_a"), SourceError);
  assert.throws(() => parseTariff([{ DataSeries: "Piped Town Gas Tariff - General Tariff", "2025": "22.52" }], "general"), SourceError);
});

test("answer: SGD per kWh, latest year, posted tariff, no sample size", () => {
  const a = answerFromSeries(parseTariff(RECORDS, "general"), {});
  assert.equal(a.status, "ok");
  assert.equal(a.price!.currency, "SGD");
  assert.equal(a.price!.value, 0.2252);
  assert.equal(a.sample_size, null);
  assert.equal(a.price_type, "posted_price");
  assert.deepEqual(a.period, { from: "2025-01-01", to: "2025-12-31" });
  assert.equal((a.extra as any).previous_cents_per_kwh, 23.17);
  assert.equal((a.extra as any).change_pct, -2.8);
  assert.match(a.summary, /excluding GST/);
});

test("bands and input handling", async () => {
  assert.equal(normaliseBand(""), "general");
  assert.equal(normaliseBand("Standard"), "general");
  assert.equal(normaliseBand("Bulk A"), "bulk_a");
  assert.equal(normaliseBand("bulk-b"), "bulk_b");
  assert.throws(() => normaliseBand("huge"), InputError);
  await assert.rejects(() => sgGas({ energy: "electricity" }, async () => RECORDS), InputError);
  const b = await sgGas({ energy: "gas", consumption_band: "bulk_b" }, async () => RECORDS);
  assert.equal(b.price!.value, 0.2063);
});

test("end to end with a fake fetcher", async () => {
  const a = await sgGas({ energy: "gas" }, async () => RECORDS);
  assert.equal(a.price!.value, 0.2252);
});

test("registered for SG energy and routed by energy=gas", () => {
  const p = SOURCE_PLUGINS.find((x) => x.info.id === "sg-town-gas");
  assert.ok(p);
  assert.deepEqual(p!.countries, ["SG"]);
  assert.equal(findSource("energy", "SG", { country: "SG", energy: "gas" })?.info.id, "sg-town-gas");
  assert.equal(findSource("energy", "SG", { country: "SG", energy: "electricity" })?.info.id, "sg-sp-tariff");
});

test("the live request URL is the plain datastore_search call we probed", () => {
  assert.equal(
    datastoreSearchUrl(SITE, { resourceId: RESOURCE_ID, limit: 20 }),
    "https://data.gov.sg/api/action/datastore_search?resource_id=d_9835e2085751e6b9c3efae9fdf2b9c5c&limit=20",
  );
});
