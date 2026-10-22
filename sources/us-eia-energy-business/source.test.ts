import { test } from "node:test";
import assert from "node:assert/strict";
import { InputError, SourceError } from "../../lib/http";
import { categoryById, findSource, paramSchemas, pickSource, runCategory, SOURCE_PLUGINS } from "../../lib/registry";
import {
  electricityFromSheets, INFO, NATIONAL_KEY, normaliseEnergy, parseCommercialElectricity, parseGasPage, parseShortMonth, stateKey, usBusinessElectricityAnswer,
  usBusinessEnergy, usBusinessGasAnswer,
} from "./source";
import { ELECTRICITY_SHEETS, GAS_COMMERCIAL_HTML } from "./fixtures";

// Fixtures: real EIA values captured 2026-10-21 (see fixtures.ts).
const elec = electricityFromSheets(ELECTRICITY_SHEETS);
const gas = parseGasPage(GAS_COMMERCIAL_HTML);
const TODAY = new Date("2026-10-21T12:00:00Z");
const load = { electricity: async () => elec, gas: async () => gas };

test("us-eia-energy-business: public domain, EIA acknowledgment, official statistic", () => {
  assert.equal(INFO.id, "us-eia-energy-business");
  assert.equal(INFO.price_type, "official_statistic");
  assert.match(INFO.licence, /public domain/);
  assert.match(INFO.licence, /you should use an acknowledgment, which includes the publication date/);
  assert.equal(INFO.licence_url, "https://www.eia.gov/about/copyrights_reuse.php");
  assert.match(INFO.limits, /no consumption bands/);
  const plugin = SOURCE_PLUGINS.find((s) => s.info.id === "us-eia-energy-business")!;
  assert.equal(plugin.category, "energy");
  assert.deepEqual(plugin.countries, ["US"]);
  assert.ok(plugin.placeName.endsWith("(business)"));
  assert.deepEqual(plugin.examples.map((e) => e.params), [
    { country: "US", sector: "business", energy: "electricity", state: "TX" },
    { country: "US", sector: "business", energy: "gas", state: "NY" },
  ]);
});

test("us-eia-energy-business: table 5.6.A commercial and industrial columns, divisions skipped", () => {
  assert.equal(elec.latest, "2026-07");
  assert.equal(elec.yearAgo, "2025-07");
  assert.equal(elec.values.get("TX")!.commercial.get("2026-07"), 8.47);
  assert.equal(elec.values.get("TX")!.commercial.get("2025-07"), 8.85);
  assert.equal(elec.values.get("TX")!.industrial.get("2026-07"), 7.07);
  assert.equal(elec.values.get(NATIONAL_KEY)!.commercial.get("2026-07"), 14.53);
  assert.ok(!elec.values.has("New England"));
  assert.ok(elec.values.has("DC"));
  // a changed layout is reported in words
  assert.throws(() => parseCommercialElectricity([["x"]]), /new layout/);
  assert.throws(() => electricityFromSheets([{ name: "s", rows: [["nothing"]] }]), SourceError);
});

test("us-eia-energy-business: the commercial gas page: months, areas, blanks (NA), release date", () => {
  assert.deepEqual(gas.months, ["2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07"]);
  assert.equal(gas.releaseDate, "2026-09-30");
  assert.equal(gas.values.get(NATIONAL_KEY)!.get("2026-07"), 13.03);
  assert.equal(gas.values.get("NY")!.get("2026-07"), 11.21);
  assert.equal(gas.values.get("TX")!.size, 6);
  // Hawaii has "NA" in February and May: those months are simply missing
  const hi = gas.values.get("HI")!;
  assert.equal(hi.has("2026-02"), false);
  assert.equal(hi.has("2026-05"), false);
  assert.equal(hi.get("2026-07"), 50.11);
  assert.equal(parseShortMonth("Feb-26"), "2026-02");
  assert.equal(parseShortMonth("Dec-25"), "2025-12");
  assert.equal(parseShortMonth("View"), null);
  assert.throws(() => parseGasPage("<html>nothing</html>"), /new layout/);
});

test("us-eia-energy-business: Texas commercial electricity, an official average in dollars per kWh, no invented range", () => {
  const a = usBusinessElectricityAnswer(elec, "TX", { energy: "electricity", state: "TX", today: TODAY, baseUrl: "https://proofprice.com" });
  assert.equal(a.status, "ok");
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.price!.measure, "average");
  assert.equal(a.price!.currency, "USD");
  assert.equal(a.price!.unit, "per kWh");
  assert.equal(a.price!.value, 0.0847);
  assert.equal(a.price!.median, null);
  assert.equal(a.price!.typical_low, null);
  assert.equal(a.price!.typical_high, null);
  assert.equal(a.sample_size, null);
  assert.deepEqual(a.period, { from: "2026-07-01", to: "2026-07-31" });
  assert.equal(a.statistic!.reference_period, "2026-07");
  assert.match(a.summary, /official average price paid by businesses \(commercial-sector customers\) for electricity was 8\.47 cents per kilowatthour/);
  assert.match(a.summary, /not consumption bands/);
  assert.match(a.summary, /4\.3% lower than a year earlier \(8\.85 cents in July 2025\)/);
  assert.match(a.summary, /U\.S\. commercial average was 14\.53 cents/);
  assert.deepEqual(a.query, { country: "US", sector: "business", energy: "electricity", state: "TX" });
  const x = a.extra as any;
  assert.equal(x.cents_per_kwh, 8.47);
  assert.equal(x.industrial_sector_cents_per_kwh, 7.07);
  assert.equal(x.change_on_year_earlier.change_percent, -4.3);
  assert.match(a.source.attribution, /^Source: U\.S\. Energy Information Administration \(Jul 2026\)\./);
  assert.ok(a.price!.value > 0.04 && a.price!.value < 0.3);
});

test("us-eia-energy-business: New York commercial gas and the national figure", () => {
  const a = usBusinessGasAnswer(gas, "NY", { energy: "gas", state: "NY", today: TODAY });
  assert.equal(a.status, "ok");
  assert.equal(a.price!.value, 11.21);
  assert.equal(a.price!.unit, "per thousand cubic feet (Mcf)");
  assert.equal(a.sample_size, null);
  assert.match(a.summary, /official average price paid by businesses \(commercial consumers\) for natural gas was \$11\.21 per thousand cubic feet in July 2026/);
  assert.match(a.summary, /1\.8% lower than in June 2026 \(\$11\.41\)/);
  assert.equal((a.extra as any).recent_months.length, 6);
  assert.equal((a.extra as any).eia_release_date, "2026-09-30");
  const us = usBusinessGasAnswer(gas, NATIONAL_KEY, { energy: "gas", today: TODAY });
  assert.equal(us.price!.value, 13.03);
  assert.match(us.summary, /In the United States/);
});

test("us-eia-energy-business: a state with a blank newest month uses its newest published month and says so; old data is flagged", () => {
  const t = parseGasPage(GAS_COMMERCIAL_HTML.replace(/(<td width="76" class="Current2">)50\.11/, "$1NA"));
  const a = usBusinessGasAnswer(t, "HI", { energy: "gas", state: "HI", today: TODAY });
  assert.equal(a.status, "ok");
  assert.equal(a.price!.value, 52.96);
  assert.match(a.statistic!.note!, /no commercial natural gas price for Hawaii for July 2026/);
  assert.equal((a.extra as any).newest_month_in_dataset, "2026-07");
  const old = usBusinessGasAnswer(gas, NATIONAL_KEY, { energy: "gas", today: new Date("2027-03-01T00:00:00Z") });
  assert.match(old.statistic!.note!, /Old data/);
});

test("us-eia-energy-business: input handling and missing figures", async () => {
  assert.equal(normaliseEnergy("Natural Gas"), "gas");
  assert.throws(() => normaliseEnergy("oil"), InputError);
  assert.equal(stateKey("Texas"), "TX");
  assert.equal(stateKey(undefined), NATIONAL_KEY);
  await assert.rejects(usBusinessEnergy({ energy: "gas", state: "Atlantis" }, load), /state must be a US state name/);
  await assert.rejects(usBusinessEnergy({ energy: "coal" }, load), /energy must be/);
  const a = await usBusinessEnergy({ energy: "electricity", state: "texas", baseUrl: "https://proofprice.com" }, load);
  assert.equal(a.price!.value, 0.0847);
  const none = usBusinessGasAnswer({ ...gas, values: new Map([[NATIONAL_KEY, gas.values.get(NATIONAL_KEY)!]]) }, "TX", { energy: "gas" });
  assert.equal(none.status, "no_matches");
  assert.equal(none.price, null);
  await assert.rejects(usBusinessEnergy({ energy: "gas" }, { electricity: load.electricity, gas: async () => { throw new SourceError("The publisher answered 503 for www.eia.gov."); } }), /503/);
});

test("energy category: US business and household answers come from different sources; state works for both", async () => {
  const cat = categoryById("energy")!;
  assert.equal(pickSource(cat, { country: "US", energy: "electricity" }).src.info.id, "us-eia-energy");
  assert.equal(pickSource(cat, { country: "US", energy: "electricity", sector: "business" }).src.info.id, "us-eia-energy-business");
  assert.equal(findSource("energy", "US")!.info.id, "us-eia-energy"); // household stays the default
  assert.ok("state" in paramSchemas(cat));
  assert.deepEqual(cat.prepare!({ country: "US", sector: "commercial", energy: "gas", state: "NY" }), { country: "US", sector: "business", energy: "gas", state: "NY", taxes: "excl_vat" });
  await assert.rejects(runCategory(cat, { country: "US", energy: "oil", sector: "business" }), /energy must be/);
});
