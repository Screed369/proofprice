import { test } from "node:test";
import assert from "node:assert/strict";
import { buildUkQuery, parseUkBindings, INFO } from "./source";

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

test("UK: limits state per-home prices, category A only and the registration lag (audit 2026-10-14)", () => {
  assert.match(INFO.limits, /Prices are per home/);
  assert.match(INFO.limits, /category B\) are left out/);
  assert.match(INFO.limits, /most recent months are incomplete/);
  assert.match(INFO.freshness, /latest months are incomplete/);
});

test("UK bindings: zero, empty and missing amounts are dropped, never counted as a price", () => {
  const rows = parseUkBindings({
    results: { bindings: [
      { amount: { value: "" }, date: { value: "2026-08-01" } },
      { amount: { value: "0" }, date: { value: "2026-08-01" } },
      { date: { value: "2026-08-01" } },
      { amount: { value: "250000" } },
    ] },
  });
  assert.deepEqual(rows, []);
});
