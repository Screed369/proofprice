// Fixture rows are copied from the LIVE response of the Probe workflow run on 2026-10-24 (probe nycrows5):
// https://data.cityofnewyork.us/resource/usep-8jbt.json?$select=borough,block,sale_price,sale_date,gross_square_feet,land_square_feet,...&$where=tax_class_at_time_of_sale=4 AND sale_price>=100000 AND borough='1'
// (only the columns this source asks for). The category list is from probe nyccat1 (same day). Newest sale in the file that day: 2026-09-30.
import { test } from "node:test";
import assert from "node:assert/strict";
import { InputError } from "../../lib/http";
import { socrataUrl } from "../../lib/adapters";
import { buildSelect, buildWhere, clampMonths, clearLatestCache, COMMERCIAL_CATEGORIES, INFO, monthsBack, parseLatest, parseSales, routePlace, usNycCommercial } from "./source";

const LIVE = [
  { block: "1138", sale_price: "253500", sale_date: "2026-09-30T00:00:00.000" }, // condo hotel: no floor area
  { block: "1323", sale_price: "3500000", sale_date: "2026-09-29T00:00:00.000", gross_square_feet: "6901", land_square_feet: "1,443" },
  { block: "618", sale_price: "14000000", sale_date: "2026-09-25T00:00:00.000", gross_square_feet: "18720", land_square_feet: "3,267" },
  { block: "1548", sale_price: "6300000", sale_date: "2026-09-25T00:00:00.000" },
  { block: "1228", sale_price: "3750000", sale_date: "2026-09-23T00:00:00.000", gross_square_feet: "6900", land_square_feet: "2,554" },
  { block: "895", sale_price: "245000000", sale_date: "2026-09-18T00:00:00.000", gross_square_feet: "493860", land_square_feet: "24,673" },
  { block: "838", sale_price: "250000", sale_date: "2026-09-17T00:00:00.000", gross_square_feet: "83278", land_square_feet: "9,965" }, // nominal transfer: $3 per sq ft
  { block: "520", sale_price: "4115000", sale_date: "2026-09-15T00:00:00.000", gross_square_feet: "4875", land_square_feet: "1,625" },
];

/** A fake Socrata: answers the latest-sale query and the rows query; records every URL. */
function fakePortal(rows: Record<string, any>[], latest = "2026-09-30T00:00:00.000") {
  const urls: string[] = [];
  const fetcher = async (url: string) => {
    urls.push(url);
    return url.includes("max(") ? [{ latest }] : rows;
  };
  return { fetcher, urls };
}

test("parseSales: converts square feet to m², drops rows without area and nominal transfers, reads comma land areas", () => {
  const s = parseSales(LIVE, "commercial");
  assert.equal(s.length, 5);
  const office = s.find((x) => x.price === 3_500_000)!;
  assert.ok(Math.abs(office.perSqm - 3_500_000 / (6901 * 0.09290304)) < 0.01);
  assert.ok(!s.some((x) => x.price === 250_000), "US$3 per sq ft transfer dropped");
  const land = parseSales(LIVE, "land");
  assert.equal(land.length, 5, "land uses land_square_feet, commas removed");
  assert.ok(Math.abs(land.find((x) => x.price === 3_500_000)!.perSqm - 3_500_000 / (1443 * 0.09290304)) < 0.01);
});

test("parseSales: rows of one deal repeated per lot are counted once", () => {
  const dup = { block: "1548", sale_price: "6300000", sale_date: "2026-09-25T00:00:00.000", gross_square_feet: "9000" };
  assert.equal(parseSales([dup, dup, dup], "commercial").length, 1);
});

test("routePlace: whole city, boroughs, neighborhoods, ZIP", () => {
  assert.deepEqual(routePlace({}), { label: "New York City" });
  assert.equal(routePlace({ town: "NYC" }).borough, undefined);
  assert.equal(routePlace({ town: "Brooklyn" }).borough, "3");
  assert.equal(routePlace({ town: "the Bronx" }).borough, "2");
  const n = routePlace({ town: "Midtown East" });
  assert.equal(n.neighborhood, "MIDTOWN EAST");
  assert.equal(n.label, "Midtown East, New York City");
  const nb = routePlace({ town: "Williamsburg, Brooklyn" });
  assert.equal(nb.borough, "3");
  assert.equal(nb.neighborhood, "WILLIAMSBURG");
  assert.equal(routePlace({ postcode: "10017" }).zip, "10017");
  assert.throws(() => routePlace({ postcode: "90210" }), InputError);
  assert.throws(() => routePlace({ town: "x" }), InputError);
});

test("routePlace: quotes and wildcards in a place name cannot reach the query", () => {
  const p = routePlace({ town: "SoHo'; DROP % --" });
  assert.match(p.neighborhood!, /^[A-Z0-9 \-/()]+$/);
});

test("buildWhere: tax class 4, categories, window, floor, place; select asks for no address", () => {
  const w = buildWhere({ borough: "1", neighborhood: "SOHO", label: "x" }, "commercial", { from: "2025-09-30", to: "2026-09-30" });
  assert.match(w, /sale_date > '2025-09-30T00:00:00'/);
  assert.match(w, /sale_date < '2026-10-01T00:00:00'/);
  assert.match(w, /sale_price >= 100000/);
  assert.match(w, /tax_class_at_time_of_sale = 4/);
  assert.match(w, /building_class_category in \('21 OFFICE BUILDINGS'/);
  assert.match(w, /borough = '1'/);
  assert.match(w, /upper\(neighborhood\) like '%SOHO%'/);
  assert.ok(!COMMERCIAL_CATEGORIES.some((c) => /CONDO|HOTEL|PARKING/.test(c)));
  assert.match(buildWhere({ label: "x" }, "land", { from: "2025-09-30", to: "2026-09-30" }), /31 COMMERCIAL VACANT LAND/);
  assert.deepEqual(buildSelect(), ["block", "sale_price", "sale_date", "gross_square_feet", "land_square_feet"]);
  assert.doesNotThrow(() => socrataUrl("data.cityofnewyork.us", "usep-8jbt", { select: buildSelect(), where: w }));
});

test("parseLatest, monthsBack and clampMonths", () => {
  assert.equal(parseLatest([{ latest: "2026-09-30T00:00:00.000" }]), "2026-09-30");
  assert.equal(parseLatest([]), null);
  assert.equal(monthsBack("2026-09-30", 12), "2025-09-30");
  assert.deepEqual(clampMonths(24), { requested: 24, applied: 12 });
  assert.deepEqual(clampMonths(undefined), { requested: 12, applied: 12 });
});

test("usNycCommercial: Manhattan answer from a fake portal (the exact manifest example)", async () => {
  clearLatestCache();
  const { fetcher, urls } = fakePortal(LIVE);
  const a = await usNycCommercial({ town: "Manhattan", property_type: "commercial" }, { fetcher, today: new Date("2026-10-24T00:00:00Z") });
  assert.equal(a.status, "ok");
  assert.equal(a.price!.unit, "per m²");
  assert.equal(a.price!.currency, "USD");
  assert.equal(a.sample_size, 5);
  assert.ok(a.price!.median! > 3_000 && a.price!.median! < 30_000, `median ${a.price!.median}`);
  assert.equal(a.period.to, "2026-09-29");
  assert.equal(a.source.id, "us-nyc-commercial");
  assert.match(a.summary, /Manhattan, New York City sold for a median/);
  assert.ok(urls.some((u) => u.includes("borough")), "asked for Manhattan");
  assert.ok(urls.every((u) => !/address|apartment/.test(decodeURIComponent(u))), "no address column requested");
  assert.match(INFO.licence, /23-502/);
});

test("usNycCommercial: fewer than 5 qualifying sales gives no figure", async () => {
  clearLatestCache();
  const { fetcher } = fakePortal(LIVE.slice(0, 4));
  const a = await usNycCommercial({ town: "SoHo" }, { fetcher, today: new Date("2026-10-24T00:00:00Z") });
  assert.notEqual(a.status, "ok");
  assert.equal(a.price, null);
});

test("usNycCommercial: bad property_type is a 400", async () => {
  await assert.rejects(usNycCommercial({ property_type: "farm" }, { fetcher: fakePortal([]).fetcher }), InputError);
});
