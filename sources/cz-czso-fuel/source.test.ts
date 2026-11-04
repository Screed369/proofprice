// Fixture: fixtures/cenyphm-2026-w44.csv holds real rows of https://vdb.czso.cz/pll/eweb/cenyphm.data (fetched 2026-11-04, plain GET),
// reduced to weeks 2016-W01, 2025-W44, 2026-W40, 2026-W43 and 2026-W44; layout and values unchanged.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { InputError, SourceError } from "../../lib/http";
import { findSource } from "../../lib/registry";
import { INFO, czFuel, czFuelHistoryKey, harvestRows, isoWeekMonday, parseWeeks, shiftWeek } from "./source";

const CSV = readFileSync(new URL("./fixtures/cenyphm-2026-w44.csv", import.meta.url), "utf8");
const getter = async () => CSV;

test("cz-czso-fuel: parses the real weekly rows (whole country, three fuels)", () => {
  const w = parseWeeks(CSV);
  assert.equal(w.length, 5);
  const last = w[w.length - 1];
  assert.equal(last.label, "2026-W44");
  assert.deepEqual(last.values, { diesel: 47.51, petrol95: 43.82, lpg: 23.28 });
  assert.equal(last.from, "2026-10-26");
  assert.equal(last.to, "2026-11-01");
  assert.equal(w[0].label, "2016-W01");
  assert.equal(w[0].from, "2016-01-04");
});

test("cz-czso-fuel: ISO week arithmetic", () => {
  assert.equal(shiftWeek("2026-W44", -4), "2026-W40");
  assert.equal(shiftWeek("2026-W44", -52), "2025-W44");
  assert.equal(shiftWeek("2026-W01", -1), "2025-W52");
  assert.equal(shiftWeek("2021-W01", -1), "2020-W53");
  assert.equal(isoWeekMonday(2026, 44).toISOString().slice(0, 10), "2026-10-26");
});

test("cz-czso-fuel: diesel answer is an official statistic in CZK per litre with four-week and year change", async () => {
  const a = await czFuel({ fuel: "diesel" }, { getter });
  assert.equal(a.status, "ok");
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.price!.value, 47.51);
  assert.equal(a.price!.currency, "CZK");
  assert.equal(a.price!.unit, "per litre");
  assert.equal(a.sample_size, null);
  assert.equal(a.period.from, "2026-10-26");
  assert.equal(a.period.to, "2026-11-01");
  const x = a.extra as any;
  assert.equal(x.change_on_four_weeks_earlier.from_week, "2026-W40");
  assert.equal(x.change_on_four_weeks_earlier.change_percent, -6.2);
  assert.equal(x.change_on_year_earlier.from_week, "2025-W44");
  assert.equal(x.change_on_year_earlier.change_percent, 44);
  assert.equal(x.other_fuels.petrol95.price_czk, 43.82);
  assert.equal(x.other_fuels.lpg.price_czk, 23.28);
  assert.match(a.summary, /diesel in Czechia was 47\.51 CZK per litre in week 2026-W44/);
  assert.match(a.source.licence, /CC BY 4\.0/);
});

test("cz-czso-fuel: petrol95 and lpg; a place is answered with the national figure and a note; other fuels are input errors", async () => {
  const p = await czFuel({ fuel: "petrol95", town: "Brno" }, { getter });
  assert.equal(p.price!.value, 43.82);
  assert.match(JSON.stringify(p.extra), /Brno/);
  const l = await czFuel({ fuel: "lpg", area: "Czechia" }, { getter });
  assert.equal(l.price!.value, 23.28);
  assert.ok(!(l.extra as any).place_note);
  await assert.rejects(() => czFuel({ fuel: "e10" }, { getter }), InputError);
});

test("cz-czso-fuel: an empty or foreign-layout file is a source error, not a made-up answer", async () => {
  await assert.rejects(() => czFuel({ fuel: "diesel" }, { getter: async () => "" }), SourceError);
  await assert.rejects(() => czFuel({ fuel: "diesel" }, { getter: async () => '"a","b"\n"1","2"\n' }), SourceError);
});

test("cz-czso-fuel: harvest stores the newest week, dated by its Sunday, with NO_COUNT", () => {
  const h = harvestRows(parseWeeks(CSV));
  assert.equal(h.date, "2026-11-01");
  assert.equal(h.currency, "CZK");
  assert.equal(h.rows.length, 3);
  assert.ok(h.rows.every((r) => r.area === "CZ" && Number.isNaN(r.n)));
  assert.equal(h.rows.find((r) => r.item === "diesel")!.median, 47.51);
  assert.deepEqual(czFuelHistoryKey({ fuel: "lpg" }), { area: "CZ", item: "lpg", label: "Czechia (national average)" });
  assert.equal(czFuelHistoryKey({ fuel: "e10" }), null);
});

test("cz-czso-fuel: routing keeps tax=without and heating oil on the EU Oil Bulletin", () => {
  assert.equal(findSource("fuel", "CZ", { country: "CZ", fuel: "diesel" })!.info.id, "cz-czso-fuel");
  assert.equal(findSource("fuel", "CZ", { country: "CZ", fuel: "lpg" })!.info.id, "cz-czso-fuel");
  assert.equal(findSource("fuel", "CZ", { country: "CZ", fuel: "diesel", tax: "without" })!.info.id, "eu-oil-bulletin");
  assert.equal(findSource("fuel", "CZ", { country: "CZ", fuel: "heating_oil" })!.info.id, "eu-oil-bulletin");
  assert.equal(INFO.id, "cz-czso-fuel");
});
