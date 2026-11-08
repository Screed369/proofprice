// serves(): FR crops the EU portal does not carry are left to fr-famag-grain; everything else stays here.
import { test } from "node:test";
import assert from "node:assert/strict";
import manifest from "./index";
import famag from "../fr-famag-grain/index";

const serves = manifest.serves!;
test("eu-farm-prices keeps FR cereals, FR with no product, and other countries", () => {
  assert.equal(serves({ country: "FR", product: "wheat" }), true);
  assert.equal(serves({ country: "FR" }), true);
  assert.equal(serves({ country: "IE", product: "rapeseed" }), true);
});
test("FR crops the EU portal cannot resolve go to FranceAgriMer", () => {
  for (const product of ["rapeseed", "sunflower", "peas"]) {
    assert.equal(serves({ country: "FR", product }), false);
    assert.equal(famag.serves!({ country: "FR", product }), true);
  }
});
test("both sources never claim the same FR question", () => {
  for (const product of ["wheat", "barley", "maize", "rapeseed", "peas"]) {
    assert.equal(serves({ country: "FR", product }) && famag.serves!({ country: "FR", product }), false);
  }
});
