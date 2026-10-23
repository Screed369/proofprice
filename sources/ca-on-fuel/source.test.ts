// Fixture: fixtures/fueltypesall-sample.csv holds the real header and real Regular Unleaded Gasoline rows copied on 2026-10-23 from
// ontario.ca/v1/files/fuel-prices/fueltypesall.csv (probe onfuelc1: 1990-01-03, 1990-01-10, 2016-09-19, 2016-10-03, 2017-09-18, 2017-09-25).
// The probe sees only the first 200 KB, so rows for the other fuel types and for 2026 are CONSTRUCTED in this test in the same layout, to test the
// logic (marked "constructed"); the live values were checked on the preview deployment.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { InputError, SourceError } from "../../lib/http";
import { categoryById, runCategory, SOURCE_PLUGINS } from "../../lib/registry";
import { INFO, answerFromRows, changeFrom, classifyFuel, findMarket, isOntarioOnlyPlace, onFuelNow, parseSurvey, CSV_URL } from "./source";

const REAL = readFileSync(new URL("./fixtures/fueltypesall-sample.csv", import.meta.url), "utf8");
const HEAD = REAL.split("\n")[0];

/** Constructed rows in the live layout: date, fuel type, then 17 market values in column order (Ottawa ... Northern Average). */
const line = (date: string, type: string, v: Record<string, number>) => {
  const order = ["Ottawa", "TW", "TE", "Windsor", "London", "Peterborough", "StC", "Sudbury", "SSM", "ThunderBay", "NorthBay", "Timmins", "Kenora", "ParrySound", "Ontario", "South", "North"];
  return `${date},${order.map((k) => v[k] ?? 0).join(",")},${type},French name,,,,,,`;
};
const BASE = { Ottawa: 150, TW: 152, TE: 151, Windsor: 148.4, London: 149, Sudbury: 156, SSM: 158, ThunderBay: 160, NorthBay: 157, Timmins: 159, Ontario: 152.1, South: 150.6, North: 158.2 };
const CONSTRUCTED = [
  HEAD,
  line("2025-10-20", "Diesel", { ...BASE, Windsor: 160 }),
  line("2025-10-20", "Regular Unleaded Gasoline", { ...BASE, Windsor: 130 }),
  line("2026-10-12", "Diesel", { ...BASE, Windsor: 168 }),
  line("2026-10-12", "Regular Unleaded Gasoline", { ...BASE, Windsor: 140 }),
  line("2026-10-19", "Diesel", { ...BASE, Windsor: 170.5, Kenora: 0 }),
  line("2026-10-19", "Regular Unleaded Gasoline", { ...BASE, Windsor: 141.2, Kenora: 0 }),
  line("2026-10-19", "Premium Unleaded Gasoline", { ...BASE, Windsor: 160.1 }),
  line("2026-10-19", "Propane", { ...BASE, Windsor: 95.5 }),
  line("2026-10-19", "Compressed Natural Gas", { ...BASE, Windsor: 120 }),
].join("\r\n");

test("ca-on-fuel: the real header and rows parse; 0 (not surveyed) is dropped", () => {
  const rows = parseSurvey(REAL);
  assert.equal(rows.length, 6);
  assert.equal(rows[0].date, "1990-01-03");
  assert.equal(rows[0].fuel, "petrol95");
  assert.equal(rows[0].cents["Windsor"], 45.2);
  assert.equal(rows[0].cents["Toronto West"], 49.1);
  assert.equal(rows[0].cents["Ontario Average"], 50.3);
  assert.equal(rows[0].cents["Northern Average"], 56.2);
  assert.ok(!("Peterborough" in rows[0].cents)); // 0 = no data that week
  assert.ok(!("Kenora" in rows[0].cents));
  assert.equal(rows[5].date, "2017-09-25");
});

test("ca-on-fuel: a changed layout is a SourceError", () => {
  assert.throws(() => parseSurvey("<html>moved</html>"), SourceError);
  assert.throws(() => parseSurvey("Date,Foo,Fuel Type\n2026-10-19,1,Diesel"), SourceError);
});

test("ca-on-fuel: fuel type names are matched by words", () => {
  assert.equal(classifyFuel("Regular Unleaded Gasoline"), "petrol95");
  assert.equal(classifyFuel("Premium Unleaded Gasoline"), "petrol98");
  assert.equal(classifyFuel("Diesel"), "diesel");
  assert.equal(classifyFuel("Propane"), "propane");
  assert.equal(classifyFuel("Compressed Natural Gas"), "methane");
  assert.equal(classifyFuel("Something else"), null);
});

test("ca-on-fuel: places are understood in the usual spellings", () => {
  assert.equal(findMarket("Windsor, ON")!.label, "Windsor");
  assert.equal(findMarket("windsor ontario")!.label, "Windsor");
  assert.equal(findMarket("St. Catharines")!.label, "St. Catharines");
  assert.equal(findMarket("Sault Ste. Marie")!.label, "Sault Ste. Marie");
  assert.equal(findMarket("Toronto East")!.label, "Toronto East");
  assert.equal(findMarket("Ontario, Canada")!.label, "Ontario");
  assert.equal(findMarket("Vancouver"), null);
  assert.equal(isOntarioOnlyPlace("Windsor"), true);
  assert.equal(isOntarioOnlyPlace("Ottawa"), false); // Statistics Canada city
  assert.equal(isOntarioOnlyPlace("Thunder Bay"), false);
  assert.equal(isOntarioOnlyPlace("Toronto"), false);
  assert.equal(isOntarioOnlyPlace(""), false);
});

test("ca-on-fuel: diesel in Windsor is a weekly average in CAD per litre with week and year change (constructed rows)", () => {
  const a = answerFromRows(parseSurvey(CONSTRUCTED), { fuel: "diesel", town: "Windsor" });
  assert.equal(a.status, "ok");
  assert.equal(a.price_type, "posted_pump_price");
  assert.equal(a.price!.currency, "CAD");
  assert.equal(a.price!.unit, "per litre");
  assert.equal(a.price!.value, 1.705);
  assert.equal(a.period.to, "2026-10-19");
  const x = a.extra as any;
  assert.equal(x.change_on_week.from, "2026-10-12");
  assert.equal(x.change_on_week.percent, 1.5);
  assert.equal(x.change_on_year.from, "2025-10-20");
  assert.equal(x.change_on_year.percent, 6.6);
  assert.equal(x.ontario_average_cad_per_litre, 1.521);
  assert.equal(x.other_fuels_same_market.propane_cad_per_litre, 0.955);
  assert.equal(x.other_fuels_same_market.methane_cad_per_litre, 1.2);
  assert.match(a.source.licence, /Open Government Licence – Ontario/);
  assert.match(a.source.attribution, /Contains information licensed under the Open Government Licence – Ontario/);
  assert.match(a.summary, /Windsor, Ontario/);
  assert.doesNotMatch(answerFromRows(parseSurvey(CONSTRUCTED), { fuel: "diesel" }).summary, /Ontario, Ontario/);
});

test("ca-on-fuel: no place means the Ontario average; premium, propane and CNG map to their rows", () => {
  const rows = parseSurvey(CONSTRUCTED);
  assert.equal(answerFromRows(rows, { fuel: "petrol95" }).price!.value, 1.521);
  assert.equal(answerFromRows(rows, { fuel: "petrol98", town: "Windsor" }).price!.value, 1.601);
  assert.equal(answerFromRows(rows, { fuel: "propane", area: "Windsor" }).price!.value, 0.955);
  assert.match(answerFromRows(rows, { fuel: "methane", town: "Windsor" }).statistic!.note!, /gasoline equivalent/);
});

test("ca-on-fuel: a market with no price in the newest 5 weeks is an empty answer, not a made-up one", () => {
  const a = answerFromRows(parseSurvey(CONSTRUCTED), { fuel: "diesel", town: "Kenora" });
  assert.equal(a.status, "no_matches");
  assert.equal(a.price, null);
});

test("ca-on-fuel: bad input is an InputError that names the valid choices", () => {
  const rows = parseSurvey(CONSTRUCTED);
  assert.throws(() => answerFromRows(rows, { fuel: "e10", town: "Windsor" }), InputError);
  assert.throws(() => answerFromRows(rows, { fuel: "diesel", town: "Vancouver" }), /Windsor.*Sudbury/);
  assert.throws(() => answerFromRows(rows, { fuel: "diesel", postcode: "N9A" }), /postcodes are not used/);
  assert.throws(() => answerFromRows(rows, { fuel: "heating_oil" }), InputError);
});

test("ca-on-fuel: a file without the requested fuel type lists the names it holds", () => {
  const onlyRegular = parseSurvey(REAL);
  assert.throws(() => answerFromRows(onlyRegular, { fuel: "diesel", town: "Windsor" }), /fuel types found: Regular Unleaded Gasoline/);
});

test("ca-on-fuel: changeFrom ignores a gap of more than 4 days", () => {
  const rows = parseSurvey(CONSTRUCTED);
  assert.equal(changeFrom(rows.filter((r) => r.fuel === "diesel"), "Windsor", "2026-10-19", 170.5, 100), null);
});

test("ca-on-fuel: fetches the official URL once and routes by place through the registry", async () => {
  const urls: string[] = [];
  const a = await onFuelNow({ fuel: "diesel", town: "Windsor" }, async (u) => (urls.push(u), CONSTRUCTED));
  assert.deepEqual(urls, [CSV_URL]);
  assert.equal(a.status, "ok");
  assert.equal(INFO.id, "ca-on-fuel");
});

test("ca-on-fuel and ca-statcan-fuel share CA without overlap: every name goes to exactly one of them", () => {
  const on = SOURCE_PLUGINS.find((s) => s.info.id === "ca-on-fuel")!;
  const sc = SOURCE_PLUGINS.find((s) => s.info.id === "ca-statcan-fuel")!;
  for (const place of ["Windsor", "London", "Peterborough", "St. Catharines", "Sudbury", "Sault Ste. Marie", "North Bay", "Timmins", "Kenora", "Parry Sound", "Toronto East", "Toronto West", "Ontario", "Southern Ontario", "Northern Ontario", "Windsor, ON", "Ottawa", "Thunder Bay", "Toronto", "Montréal", "Vancouver", "Calgary", "Canada", ""]) {
    const p = { country: "CA", town: place, fuel: "diesel" };
    assert.notEqual(Boolean(on.serves!(p)), Boolean(sc.serves!(p)), `place '${place}' must go to exactly one source`);
    assert.equal(Boolean(on.serves!(p)), isOntarioOnlyPlace(place), place);
  }
  // area works as well as town
  assert.equal(Boolean(on.serves!({ country: "CA", area: "Windsor" })), true);
  assert.equal(Boolean(sc.serves!({ country: "CA", area: "Windsor" })), false);
});

test("ca-on-fuel: a Windsor question reaches this source through the category", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(CONSTRUCTED, { status: 200 })) as typeof fetch;
  try {
    const a: any = await runCategory(categoryById("fuel")!, { country: "CA", town: "Windsor", fuel: "diesel" }, {});
    assert.equal(a.status, "ok");
    assert.equal(a.source.name, INFO.name);
  } finally {
    globalThis.fetch = realFetch;
  }
});
