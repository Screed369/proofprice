// Tests for Canada fuel (Statistics Canada table 18-10-0001-01). The fixtures are real WDS replies captured on 2026-10-14 (see fixtures.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeWds } from "../_ca-statcan/fake-wds";
import { FUEL_DATA, FUEL_META } from "./fixtures";
import { AKI_NOTE, FUEL_MEMBERS, INFO, caFuelNow, caFuelMethod, readFuel } from "./source";
import manifest from "./index";
import { parseCoordData } from "../_ca-statcan/wds";

const TODAY = new Date("2026-10-14T12:00:00Z");
const calls: { path: string; body: unknown }[] = [];
const post = () => fakeWds({ meta: FUEL_META, data: FUEL_DATA, calls });
const ask = (o: Parameters<typeof caFuelNow>[0]) => caFuelNow(o, post(), TODAY);

test("Vancouver petrol95: the August 2026 regular unleaded average, in dollars per litre, with the change on a year earlier", async () => {
  const a = await ask({ fuel: "petrol95", town: "Vancouver" });
  assert.equal(a.status, "ok");
  assert.equal(a.price?.value, 2.067);
  assert.equal(a.price?.currency, "CAD");
  assert.equal(a.price?.unit, "per litre");
  assert.equal(a.price?.measure, "average");
  assert.equal(a.price?.median, null);
  assert.equal(a.price?.typical_low, null);
  assert.equal(a.price?.typical_high, null);
  assert.equal(a.sample_size, null);
  assert.equal(a.confidence, "high");
  assert.equal(a.price_type, "official_statistic");
  assert.deepEqual(a.period, { from: "2026-08-01", to: "2026-08-31" });
  assert.equal(a.statistic?.reference_period, "2026-08");
  assert.deepEqual(a.query, { country: "CA", fuel: "petrol95", town: "Vancouver, British Columbia", service: "self" });
  const x = a.extra as any;
  assert.equal(x.published_value.cents_per_litre, 206.7);
  assert.equal(x.change_on_previous_month.reference_month, "2026-07");
  assert.equal(x.change_on_previous_month.cents_per_litre, 200.7);
  assert.equal(x.change_on_year_earlier.reference_month, "2025-08");
  assert.equal(x.change_on_year_earlier.cents_per_litre, 168.8);
  assert.equal(x.change_on_year_earlier.change_percent, 22.5);
  assert.equal(x.last_12_months.length, 12);
  assert.equal(x.last_12_months[0].month, "2025-09");
  assert.equal(x.last_12_months[11].month, "2026-08");
  assert.deepEqual(
    x.other_fuels_same_city_and_month.map((o: any) => [o.fuel, o.cents_per_litre]),
    [["petrol98", 233], ["diesel", 251.7]],
  );
  assert.match(a.summary, /CA\$2\.067 per litre \(206\.7 cents\) in August 2026/);
  assert.match(a.summary, /22\.5% higher than a year earlier/);
  assert.match(a.summary, /Official average published by Statistics Canada for 2026-08/);
  assert.match(a.summary, /monthly average, not a live pump price/);
  assert.match(a.statistic?.note ?? "", /not today's pump price/);
  assert.match(a.statistic?.note ?? "", /87 AKI/);
  assert.match(x.attribution_notice, /^Source: Statistics Canada, Table 18-10-0001-01 .*, August 2026\. Reproduced and distributed on an "as is" basis with the permission of Statistics Canada\./);
  assert.match(x.attribution_notice, /This does not constitute an endorsement by Statistics Canada of this product\.$/);
});

test("diesel and premium read their own series; the two WDS calls are metadata then one batch of three series", async () => {
  calls.length = 0;
  const d = await ask({ fuel: "diesel", town: "Vancouver" });
  assert.equal(d.price?.value, 2.517);
  assert.match(d.summary, /diesel at self-service stations in Vancouver, British Columbia/);
  const p = await ask({ fuel: "petrol98", town: "Vancouver, BC" });
  assert.equal(p.price?.value, 2.33);
  assert.equal(calls.filter((c) => c.path === "getCubeMetadata").length, 2, "tests use a fresh fake each time: nothing is cached across them");
  const dataCall = calls.find((c) => c.path === "getDataFromCubePidCoordAndLatestNPeriods")!;
  assert.deepEqual(dataCall.body, [
    { productId: 18100001, coordinate: "16.2.0.0.0.0.0.0.0.0", latestN: 13 },
    { productId: 18100001, coordinate: "16.4.0.0.0.0.0.0.0.0", latestN: 13 },
    { productId: 18100001, coordinate: "16.6.0.0.0.0.0.0.0.0", latestN: 13 },
  ]);
});

test("city names are matched the way people write them", async () => {
  const names = async (town: string) => ((await ask({ fuel: "petrol95", town })).query as any).town;
  assert.equal(await names("Ottawa"), "Ottawa-Gatineau, Ontario part, Ontario/Quebec");
  assert.equal(await names("thunder bay"), "Thunder Bay, Ontario");
  const ottawa = await ask({ fuel: "petrol95", area: "Ottawa" });
  assert.equal(ottawa.price?.value, 1.65);
  assert.match((ottawa.statistic?.note ?? ""), /'Ottawa' is covered by the area/);
});

test("no town or 'Canada': the national average, which exists for regular unleaded only", async () => {
  const reg = await ask({ fuel: "petrol95" });
  assert.equal(reg.status, "ok");
  assert.equal(reg.price?.value, 1.738);
  assert.match(reg.summary, /Canada \(national average\)/);
  const diesel = await ask({ fuel: "diesel", town: "Canada" });
  assert.equal(diesel.status, "no_matches");
  assert.equal(diesel.price, null);
  assert.match(diesel.summary, /Canada average exists for regular unleaded only/);
});

test("a series a city does not have (diesel in Thunder Bay) is no_matches, not an error", async () => {
  const a = await ask({ fuel: "diesel", town: "Thunder Bay" });
  assert.equal(a.status, "no_matches");
  assert.equal(a.price, null);
  assert.match(a.summary, /publishes no recent average price of diesel at self-service stations for Thunder Bay, Ontario/);
});

test("bad input is a clear InputError: unknown fuel, full service, postcode only, unknown city, a province", async () => {
  await assert.rejects(ask({ fuel: "e10", town: "Toronto" }), /regular unleaded \(petrol95\), premium unleaded \(petrol98\) and diesel only/);
  await assert.rejects(ask({ fuel: "diesel", town: "Toronto", service: "served" }), /full-service series/);
  await assert.rejects(ask({ fuel: "diesel", postcode: "M5V" }), /postcodes are not used/);
  await assert.rejects(ask({ fuel: "diesel", town: "Atlantis" }), /'Atlantis' is not a place in this table/);
  await assert.rejects(ask({ fuel: "diesel", town: "Ontario" }), /'Ontario' is a province or territory; this table is by town or city\. In Ontario it has: .*Toronto, Ontario/);
});

test("old data is flagged plainly when the newest month is 3 or more months behind", async () => {
  const a = await caFuelNow({ fuel: "petrol95", town: "Vancouver" }, post(), new Date("2027-01-14T12:00:00Z"));
  assert.equal(a.status, "ok");
  assert.match(a.statistic?.note ?? "", /Old data: the newest average Statistics Canada holds for this city and fuel is from August 2026, 5 months ago/);
  assert.match(a.summary, /Old data: 5 months old/);
});

test("readFuel picks the newest usable month even when the latest point is empty", () => {
  const raw = JSON.parse(JSON.stringify(FUEL_DATA)) as any[];
  const reg = raw.find((s) => s.object.coordinate === "16.2.0.0.0.0.0.0.0.0");
  reg.object.vectorDataPoint[reg.object.vectorDataPoint.length - 1].value = null;
  const series = parseCoordData([reg]);
  const r = readFuel({ petrol95: series[0] }, "petrol95", { id: 16, name: "Vancouver, British Columbia" })!;
  assert.equal(r.month, "2026-07");
  assert.equal(r.cents, 200.7);
});

test("a changed table layout is a SourceError that names the table", async () => {
  const broken = JSON.parse(JSON.stringify(FUEL_META));
  broken[0].object.dimension[1].member = broken[0].object.dimension[1].member.filter((m: any) => !/Diesel fuel at self/.test(m.memberNameEn));
  await assert.rejects(caFuelNow({ fuel: "diesel", town: "Toronto" }, fakeWds({ meta: broken, data: FUEL_DATA }), TODAY), /changed table 18-10-0001-01 \(no series "Diesel fuel at self service filling stations"\)/);
});

test("manifest: fuel tool, CA, first example is the smoke test, licence is quoted with its URL", () => {
  assert.equal(manifest.category, "fuel");
  assert.deepEqual(manifest.countries, ["CA"]);
  assert.equal(manifest.examples[0].params.town, "Vancouver");
  assert.equal(manifest.examples[0].params.fuel, "petrol95");
  assert.equal(INFO.price_type, "official_statistic");
  assert.equal(INFO.licence_url, "https://www.statcan.gc.ca/en/terms-conditions/open-licence");
  assert.match(INFO.licence, /use, reproduce, publish, freely distribute, or sell the Information/);
  assert.match(INFO.attribution, /Reproduced and distributed on an "as is" basis with the permission of Statistics Canada/);
  assert.match(INFO.attribution, /This does not constitute an endorsement by Statistics Canada of this product\./);
  assert.ok(Object.keys(FUEL_MEMBERS).length === 3);
  assert.match(caFuelMethod(), /monthly average, not today's pump price/);
  assert.match(AKI_NOTE, /87 AKI/);
});

// ---------- daily collector and stale-if-error ----------

import { caFuelHarvest, caFuelHistoryKey, fuelHarvestRows } from "./source";

test("harvest: one row per city and fuel for the newest month, dated by the month's end, in dollars per litre, n a placeholder", async () => {
  const calls: { path: string; body: unknown }[] = [];
  const h = await caFuelHarvest(fakeWds({ meta: FUEL_META, data: FUEL_DATA, calls }));
  assert.equal(h.currency, "CAD");
  assert.equal(h.unit, "per litre");
  assert.match(h.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(h.rows.length > 0 && h.rows.length <= 57);
  assert.ok(h.rows.every((r) => r.n === 5 && r.low === r.median && r.max === r.median && r.median > 0.5 && r.median < 5));
  const van = h.rows.find((r) => r.area === "Vancouver, British Columbia" && r.item === "petrol95");
  const live = await caFuelNow({ fuel: "petrol95", town: "Vancouver" }, fakeWds({ meta: FUEL_META, data: FUEL_DATA }), TODAY);
  assert.equal(van?.median, live.price!.value, "the copy holds the same figure as the live answer");
  assert.ok(calls.filter((c) => c.path === "getDataFromCubePidCoordAndLatestNPeriods").every((c) => (c.body as unknown[]).length <= 15));
  assert.throws(() => fuelHarvestRows([]), /no usable average/);
});

test("history key: cities resolve from the stored areas without asking Statistics Canada; no history is offered", () => {
  const areas = ["ALL", "Vancouver, British Columbia", "Toronto, Ontario"];
  assert.deepEqual(caFuelHistoryKey({ fuel: "petrol95", town: "vancouver" }, areas), { area: "Vancouver, British Columbia", item: "petrol95", label: "Vancouver, British Columbia" });
  assert.equal(caFuelHistoryKey({ fuel: "petrol95" }, areas)!.area, "ALL");
  assert.equal(caFuelHistoryKey({ fuel: "lpg", town: "Toronto" }, areas), null);
  assert.equal(caFuelHistoryKey({ fuel: "diesel", town: "Atlantis" }, areas), null);
  assert.ok(manifest.harvest && manifest.historyKey && manifest.referenceDates && manifest.nominalCounts);
  assert.match(manifest.noHistory!, /no daily history/);
});
