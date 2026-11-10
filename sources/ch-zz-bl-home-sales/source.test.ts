import { test } from "node:test";
import assert from "node:assert/strict";
import { InputError } from "../../lib/http";
import { SOURCE_PLUGINS } from "../../lib/registry";
import { INFO, blAnswer, blHarvestRows, blHistoryKey, normaliseRooms, parseCsv, resolveDistrict, servesBl } from "./source";
import { SAMPLE_CSV } from "./fixtures";

// Fixture: the real file data.bl.ch dataset 10210, fetched 2026-11-10 via the GitHub probe.
test("registered on home-sales for CH, open licence, sorts after the Zürich source", () => {
  const p = SOURCE_PLUGINS.find((s) => s.info.id === "ch-zz-bl-home-sales")!;
  assert.equal(p.category, "home-sales");
  assert.deepEqual(p.countries, ["CH"]);
  assert.match(INFO.licence, /commercial use allowed/);
  assert.ok(SOURCE_PLUGINS.findIndex((s) => s.info.id === "ch-zurich-home-sales") < SOURCE_PLUGINS.indexOf(p));
});

test("parseCsv drops suppressed cells and keeps real figures", () => {
  const { rows, districts } = parseCsv(SAMPLE_CSV);
  assert.equal(districts.size, 5);
  assert.ok(!rows.some((r) => r.year === 2025 && r.district === "Liestal" && r.rooms === "1")); // "( )"
  assert.ok(rows.some((r) => r.year === 2025 && r.code === "1301" && r.rooms === "Total" && r.price === 1028138));
});

test("Arlesheim all condominiums 2025", () => {
  const a = blAnswer(SAMPLE_CSV, { town: "Arlesheim" });
  assert.equal(a.status, "ok");
  assert.equal(a.price!.value, 1028138);
  assert.equal(a.price!.currency, "CHF");
  assert.equal(a.sample_size, null);
  assert.deepEqual(a.period, { from: "2025-01-01", to: "2025-12-31" });
  assert.equal((a.extra as any).previous_year.year, 2024);
  assert.equal(a.statistic!.measure, "average");
});

test("rooms and municipality names", () => {
  const a = blAnswer(SAMPLE_CSV, { town: "Muttenz", rooms: "3" });
  assert.equal(a.price!.value, 846964);
  assert.match(String(a.statistic?.note), /Muttenz lies in the district of Arlesheim/);
  assert.equal(normaliseRooms("5 rooms"), "5+");
  assert.throws(() => normaliseRooms("9"), InputError);
});

test("suppressed cell with nothing in five years gives no_matches; unknown place is an input error; houses refused", () => {
  const { districts } = parseCsv(SAMPLE_CSV);
  assert.throws(() => resolveDistrict("Bern", districts), InputError);
  assert.throws(() => blAnswer(SAMPLE_CSV, { town: "Liestal", property_type: "house" }), InputError);
});

test("canton-wide ask lists the district averages without inventing a canton figure", () => {
  const a = blAnswer(SAMPLE_CSV, { town: "Basel-Landschaft" });
  assert.equal(a.status, "no_matches");
  assert.match(a.summary, /Arlesheim/);
});

test("serves only Basel-Landschaft places, never Zürich", () => {
  assert.equal(servesBl({ country: "CH", town: "Liestal" }), true);
  assert.equal(servesBl({ country: "CH", town: "Zürich" }), false);
  assert.equal(servesBl({ country: "CH" }), false);
  assert.equal(servesBl({ country: "AT", town: "Liestal" }), false);
});

test("harvest rows and history key", () => {
  const h = blHarvestRows(SAMPLE_CSV);
  assert.equal(h.date, "2025-12-31");
  assert.ok(h.rows.some((r) => r.area === "1301" && r.item === "flat:Total" && r.median === 1028138));
  assert.deepEqual(blHistoryKey({ town: "Arlesheim", rooms: "3" }), { area: "1301", item: "flat:3", label: "Bezirk arlesheim" });
  assert.equal(blHistoryKey({ town: "Zürich" }), null);
});
