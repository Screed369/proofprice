// Fixture: fixtures/m213761-2026-sep.json holds the real SingStat response for timeFilter "2026 Sep" (fetched 2026-10-24 through the GitHub probe),
// reduced to the petrol, diesel, LPG and one egg row; layout unchanged.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { InputError, SourceError } from "../../lib/http";
import { categoryById, SOURCE_PLUGINS } from "../../lib/registry";
import { INFO, harvestRows, sgFuel, sgFuelHistoryKey } from "./source";
import { parseMonth, readLatest } from "../sg-singstat-prices/source";

const FIX = JSON.parse(readFileSync(new URL("./fixtures/m213761-2026-sep.json", import.meta.url), "utf8"));
const TODAY = new Date("2026-10-24T12:00:00Z");

/** Serve the fixture for any month by relabelling the column; the year-earlier month gets a lower price. */
function getter(onlySep = false) {
  return async (url: string) => {
    const tf = decodeURIComponent(new URL(url).searchParams.get("timeFilter") ?? "");
    if (tf === "2026 Sep") return FIX;
    if (onlySep || tf === "2026 Oct") return { Data: { ...FIX.Data, row: [] } };
    const copy = JSON.parse(JSON.stringify(FIX));
    for (const r of copy.Data.row) r.columns = r.columns.map((c: any) => ({ key: tf, value: String(Math.round(Number(c.value) * (tf === "2025 Sep" ? 0.9 : 0.99) * 100) / 100) }));
    return copy;
  };
}

test("sg-singstat-fuel: parses the real fuel rows", () => {
  const m = parseMonth(FIX, "2026-09");
  assert.equal(m.rows.get("petrol, 95 octane (per litre)")!.value, 2.92);
  assert.equal(m.rows.get("diesel (per litre)")!.value, 3.38);
  assert.equal(m.rows.get("liquefied petroleum gas (lpg) (per kilogram)")!.value, 3.04);
  assert.equal(m.dataLastUpdated, "2026-10-23");
});

test("sg-singstat-fuel: petrol95 answer is an official statistic in SGD per litre with month and year change", async () => {
  const a = await sgFuel({ fuel: "petrol95", today: TODAY }, { getter: getter() });
  assert.equal(a.status, "ok");
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.price!.value, 2.92);
  assert.equal(a.price!.currency, "SGD");
  assert.equal(a.price!.unit, "per litre");
  assert.equal(a.period.to, "2026-09-30");
  const x = a.extra as any;
  assert.equal(x.change_on_year_earlier.from_month, "2025-09");
  assert.ok(x.change_on_year_earlier.change_percent > 10);
  assert.equal(x.change_on_previous_month.from_month, "2026-08");
  assert.equal(x.other_fuels.petrol92.price_sgd, 2.91);
  assert.equal(x.other_fuels.diesel.price_sgd, 3.38);
  assert.match(a.summary, /95-octane petrol in Singapore was S\$2\.92 per litre in September 2026/);
  assert.match(a.summary, /a year earlier/);
});

test("sg-singstat-fuel: lpg is per kg; a place is ignored with a note; unsupported fuel is an input error", async () => {
  const lpg = await sgFuel({ fuel: "lpg", today: TODAY }, { getter: getter() });
  assert.equal(lpg.price!.unit, "per kg");
  assert.equal(lpg.price!.value, 3.04);
  const town = await sgFuel({ fuel: "diesel", town: "Jurong", today: TODAY }, { getter: getter() });
  assert.match(town.summary + JSON.stringify(town.extra), /Jurong/);
  assert.equal(town.price!.value, 3.38);
  await assert.rejects(() => sgFuel({ fuel: "e85", today: TODAY }, { getter: getter() }), InputError);
});

test("sg-singstat-fuel: with no earlier months the answer still works and says so", async () => {
  const a = await sgFuel({ fuel: "diesel", today: TODAY }, { getter: getter(true) });
  assert.equal(a.status, "ok");
  assert.match(a.summary, /no figure for the month before/);
});

test("sg-singstat-fuel: harvest keeps one row per fuel with NO_COUNT; history key; changed shape is a SourceError", async () => {
  const reading = await readLatest(TODAY, { getter: getter() });
  const h = harvestRows(reading);
  assert.equal(h.date, "2026-09-30");
  assert.deepEqual(h.rows.map((r) => r.item).sort(), ["diesel", "lpg", "petrol95", "petrol98"]);
  assert.equal(h.rows.find((r) => r.item === "petrol95")!.median, 2.92);
  assert.deepEqual(sgFuelHistoryKey({ fuel: "diesel" }), { area: "SG", item: "diesel", label: "Singapore (national average)" });
  assert.equal(sgFuelHistoryKey({ fuel: "e10" }), null);
  assert.throws(() => parseMonth({ nope: 1 }, "2026-09"), SourceError);
});

test("sg-singstat-fuel: registered in the fuel category for SG with a licence", () => {
  const plugin = SOURCE_PLUGINS.find((s) => s.info.id === INFO.id)!;
  assert.ok(plugin);
  assert.ok(categoryById("fuel"));
  assert.match(INFO.licence, /Singapore Open Data Licence/);
  assert.ok(plugin.countries.includes("SG"));
});
