import { test } from "node:test";
import assert from "node:assert/strict";
import { summarise, confidenceLabel, percentile } from "../lib/stats";
import { buildUkQuery, parseUkBindings } from "../lib/sources/uk";
import { buildSgUrl, parseSgRecords } from "../lib/sources/sg";
import { parseFrRecords, normalisePrice, buildFrUrl } from "../lib/sources/frfuel";
import { buildAnswer } from "../lib/answer";

test("percentiles and summary", () => {
  assert.equal(percentile([1, 2, 3, 4, 5], 0.5), 3);
  const s = summarise([300000, 250000, 400000, 275000, 320000, 0, NaN])!;
  assert.equal(s.count, 5);
  assert.equal(s.median, 300000);
  assert.ok(s.low < s.median && s.median < s.high);
  assert.equal(summarise([]), null);
});

test("confidence labels and publish threshold", () => {
  assert.equal(confidenceLabel(4), "insufficient");
  assert.equal(confidenceLabel(5), "low");
  assert.equal(confidenceLabel(15), "medium");
  assert.equal(confidenceLabel(50), "high");
});

test("UK SPARQL query is built safely", () => {
  const q = buildUkQuery({ town: 'bristol"; DROP', postcodeDistrict: "bs8", propertyType: "terraced", fromDate: "2025-10-12", limit: 100 });
  assert.match(q, /"BRISTOL; DROP"\^\^xsd:string/);
  assert.match(q, /STRSTARTS\(\?postcode, "BS8 "\)/);
  assert.match(q, /lrcommon:terraced/);
  assert.match(q, /standardPricePaidTransaction/);
  assert.doesNotMatch(q, /"BRISTOL";/);
});

test("UK bindings parse", () => {
  const rows = parseUkBindings({
    results: { bindings: [
      { amount: { value: "325000" }, date: { value: "2026-08-01" } },
      { amount: { value: "abc" }, date: { value: "2026-08-02" } },
    ] },
  });
  assert.deepEqual(rows, [{ amount: 325000, date: "2026-08-01" }]);
  assert.throws(() => parseUkBindings({}));
});

test("SG url and records parse (shape seen on data.gov.sg)", () => {
  const url = new URL(buildSgUrl("tampines", "4 room"));
  const filters = JSON.parse(url.searchParams.get("filters")!);
  assert.deepEqual(filters, { town: "TAMPINES", flat_type: "4 ROOM" });
  assert.equal(url.searchParams.get("sort"), "month desc");
  const recs = parseSgRecords({
    success: true,
    result: { records: [
      { _id: 1, month: "2026-08", town: "TAMPINES", flat_type: "4 ROOM", floor_area_sqm: "92", resale_price: "615000" },
      { _id: 2, month: "2026-07", town: "TAMPINES", flat_type: "4 ROOM", floor_area_sqm: "93", resale_price: 640000 },
    ] },
  });
  assert.equal(recs.length, 2);
  assert.equal(recs[0].price, 615000);
});

test("FR fuel records parse and prices normalise", () => {
  assert.equal(normalisePrice(1.789), 1.789);
  assert.equal(normalisePrice(1789), 1.789);
  assert.ok(Number.isNaN(normalisePrice(null)));
  const st = parseFrRecords({ results: [
    { id: 1, adresse: "1 rue A", ville: "Paris", cp: "75015", gazole_prix: 1.759, gazole_maj: "2026-10-12T08:00:00+00:00" },
    { id: 2, adresse: "2 rue B", ville: "Paris", cp: "75015", gazole_prix: null },
  ] }, "gazole");
  assert.equal(st.length, 1);
  assert.match(decodeURIComponent(buildFrUrl('cp="75015"', 0)), /where=cp="75015"/);
});

test("answer refuses to publish below 5 records and is citable above", () => {
  const thin = buildAnswer({ sourceId: "sg-hdb-resale", query: {}, summary: summarise([1, 2, 3]), currency: "SGD", unit: "per flat", period: { from: null, to: null }, method: "m", describe: () => "x" });
  assert.equal(thin.status, "insufficient_data");
  assert.equal(thin.price, null);
  const ok = buildAnswer({ sourceId: "sg-hdb-resale", query: {}, summary: summarise([500000, 520000, 540000, 560000, 580000, 600000]), currency: "SGD", unit: "per flat", period: { from: "2026-01", to: "2026-08" }, method: "m", describe: () => "Flats sold for a median of S$550,000." });
  assert.equal(ok.status, "ok");
  assert.ok(ok.price && ok.price.median === 550000);
  assert.match(ok.summary, /Based on 6 records/);
  assert.match(ok.source.attribution, /Singapore Open Data Licence/);
});
