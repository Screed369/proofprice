// Fixture copied from the live Socrata response on 2026-11-01 (first two rows, VIN removed), plus synthetic van sales.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSales, matchSales, seattleFleetPrices } from "./source";

const REAL = [
  { equip_id: "32570", year: "2014", make: "FORD", model: "TRANSCT", description: "MINIVAN CARGO", dept: "SPU", sale_price: "6100", sale_date: "2026-10-15T00:00:01.000", sold_by: "BIDADOO ONLINE AUCTION", equipment_type: "VAN - MINIVAN", asset_weight_category: "ASSET", system_group: "MINIVAN", fuel_type: "UNL" },
  { equip_id: "33137", year: "2015", make: "FORD", model: "TRANSIT", description: "VAN 2WD PASSENGER", dept: "DPR", sale_price: "17400", sale_date: "2026-10-15T00:00:01.000", sold_by: "BIDADOO ONLINE AUCTION", equipment_type: "VAN", asset_weight_category: "ASSET", system_group: "VAN", fuel_type: "DSL" },
  { equip_id: "1", year: "2010", make: "X", model: "Y", description: "NO PRICE", sale_price: "0", sale_date: "2026-10-15T00:00:01.000", equipment_type: "VAN" },
];
function vans() {
  return parseSales([
    ...REAL,
    ...[4000, 5000, 6000, 7000].map((p, i) => ({ year: "2012", make: "DODGE", model: "GC", description: "VAN CARGO", sale_price: String(p), sale_date: `2026-0${i + 1}-10T00:00:01.000`, equipment_type: "VAN", system_group: "VAN" })),
  ]);
}

test("keeps only priced sales and never reads the VIN", () => {
  const s = parseSales(REAL);
  assert.equal(s.length, 2);
  assert.equal(s[0].price, 6100);
  assert.equal(s[0].date, "2026-10-15");
  assert.ok(!JSON.stringify(s).includes("NM0"));
});
test("matches on every word", () => {
  const s = vans();
  assert.equal(matchSales(s, "van").length, 6);
  assert.equal(matchSales(s, "ford van").length, 2);
  assert.equal(matchSales(s, "boat").length, 0);
});
test("six sales give a range and are labelled", async () => {
  const a = await seattleFleetPrices({ what: "van", months: 24 }, vans());
  assert.equal(a.status, "ok");
  assert.equal(a.sample_size, 6);
  assert.equal(a.price?.currency, "USD");
  assert.equal(a.source.licence, "Public domain (City of Seattle open data)");
});
test("under 5 sales gives no figure", async () => {
  const a = await seattleFleetPrices({ what: "ford van", months: 24 }, vans());
  assert.notEqual(a.status, "ok");
});
