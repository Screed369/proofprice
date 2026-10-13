import { test } from "node:test";
import assert from "node:assert/strict";
import { buildUkQuery, parseUkBindings } from "./source";

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
