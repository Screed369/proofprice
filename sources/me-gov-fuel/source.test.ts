// Tests for ME fuel (data.gov.me). Fixture fixtures/package_search.json: a cut of the REAL package_search reply (8 newest datasets: weekly fuel
// notices plus one consumer-price-index dataset), captured 2026-10-30 from data.gov.me.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { INFO, harvestFromJson, meAnswer, meHistoryKey, meToday, noticeDate, parseNotices } from "./source";
import manifest from "./index";
import { NO_COUNT } from "../../lib/stats";

const FIX = JSON.parse(readFileSync(new URL("./fixtures/package_search.json", import.meta.url), "utf8"));
const NOW = new Date("2026-10-30T10:00:00Z");

test("noticeDate reads the date from the dataset name and ignores other datasets", () => {
  assert.equal(noticeDate("nove-cijene-goriva-od-27-10-2026"), "2026-10-27");
  assert.equal(noticeDate("indeks-potrosackih-cijena-avgust-2026"), null);
});

test("parseNotices takes the newest notice in force, whatever the spelling", () => {
  const n = parseNotices(FIX, "2026-10-30")!;
  assert.equal(n.from, "2026-10-27");
  assert.equal(n.prices.petrol95, 1.81);
  assert.equal(n.prices.diesel, 1.98);
  assert.equal(n.prices.petrol98, 1.85);
  assert.equal(n.prices.heating_oil, 2.02); // "FUEL OIL" on 27 Oct
  const older = parseNotices(FIX, "2026-10-20")!; // "EURODIESEL", "HEATING OIL"
  assert.equal(older.from, "2026-10-13");
  assert.equal(older.prices.diesel, 1.98);
  assert.equal(older.prices.heating_oil, 1.98);
  const dash = parseNotices(FIX, "2026-09-10")!; // "EUROSUPER 95 – €1.72/l"
  assert.equal(dash.from, "2026-09-08");
  assert.equal(dash.prices.petrol95, 1.72);
});

test("a layout change is refused; no notice gives null", () => {
  assert.throws(() => parseNotices({}, "2026-10-30"), /changed the layout/);
  assert.equal(parseNotices({ success: true, result: { results: [] } }, "2026-10-30"), null);
  const bad = { success: true, result: { results: [{ name: "nove-cijene-goriva-od-27-10-2026", notes_en: "EUROSUPER 95: €18.1/l EURO DIESEL: €1.98/l" }] } };
  assert.equal(parseNotices(bad, "2026-10-30"), null);
});

test("harvest: rows dated by the notice, no record count", () => {
  const h = harvestFromJson(FIX, NOW);
  assert.equal(h.date, "2026-10-27");
  assert.equal(h.currency, "EUR");
  assert.equal(h.rows.length, 4);
  const d = h.rows.find((r) => r.item === "diesel")!;
  assert.equal(d.median, 1.98);
  assert.ok(Number.isNaN(d.n) && Number.isNaN(NO_COUNT));
  assert.throws(() => harvestFromJson({ success: true, result: { results: [] } }, NOW), /No current fuel notice/);
});

test("diesel answer: the government maximum as a posted price with no range or sample", () => {
  const h = harvestFromJson(FIX, NOW);
  const a = meAnswer({ date: h.date, rows: h.rows as any }, { fuel: "diesel" }, NOW);
  assert.equal(a.status, "ok");
  assert.equal(a.price?.value, 1.98);
  assert.equal(a.price?.currency, "EUR");
  assert.equal(a.price?.unit, "per litre");
  assert.equal(a.price?.typical_low, null);
  assert.equal(a.sample_size, null);
  assert.equal(a.price_type, "posted_pump_price");
  assert.equal(a.period.from, "2026-10-27");
  assert.match(a.summary, /maximum retail price/);
  assert.equal((a.extra as any).other_grades.petrol98.value, 1.85);
});

test("a place is not used and the answer says so; other fuels are refused in plain words", () => {
  const h = harvestFromJson(FIX, NOW);
  const a = meAnswer({ date: h.date, rows: h.rows as any }, { fuel: "petrol95", town: "Podgorica" }, NOW);
  assert.equal(a.price?.value, 1.81);
  assert.match(String((a.extra as any).place_note), /Podgorica/);
  assert.throws(() => meAnswer({ date: h.date, rows: h.rows as any }, { fuel: "lpg" }), /petrol95/);
});

test("manifest: Montenegro, fuel category, history key, free tier only", () => {
  assert.deepEqual(manifest.countries, ["ME"]);
  assert.equal(manifest.category, "fuel");
  assert.equal(meHistoryKey({ fuel: "diesel" })?.item, "diesel");
  assert.equal(meHistoryKey({ fuel: "lpg" }), null);
  assert.equal(meToday(new Date("2026-10-29T23:00:00Z")), "2026-10-30");
  assert.match(INFO.licence, /free tier only/);
});
