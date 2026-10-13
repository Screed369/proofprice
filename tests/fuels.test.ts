import { test } from "node:test";
import assert from "node:assert/strict";
import { normaliseFuel, stripAccents } from "../lib/fuels";

test("fuel names normalise across countries", () => {
  assert.equal(normaliseFuel("gazole"), "diesel");
  assert.equal(normaliseFuel("Diesel"), "diesel");
  assert.equal(normaliseFuel("SP95"), "petrol95");
  assert.equal(normaliseFuel("gplc"), "lpg");
  assert.equal(normaliseFuel("metano"), "methane");
  assert.equal(normaliseFuel("kerosene"), null);
  assert.equal(stripAccents("Ágreda"), "AGREDA");
});
