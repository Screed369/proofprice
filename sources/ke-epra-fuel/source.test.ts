// Tests for KE fuel (EPRA maximum pump prices). Fixture fixtures/pump-prices.html: a cut of the REAL page https://www.epra.go.ke/pump-prices
// (header kept; 6 towns x periods 15-10-2026 and 15-09-2026), captured 2026-11-03 23:40 UTC.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { INFO, currentPeriod, harvestFromHtml, keAnswer, keHistoryKey, keToday, parseTable, townKey } from "./source";
import manifest from "./index";
import { NO_COUNT } from "../../lib/stats";

const HTML = readFileSync(new URL("./fixtures/pump-prices.html", import.meta.url), "utf8");
const NOW = new Date("2026-11-03T21:00:00Z");

test("parseTable reads every row with ISO dates and KES prices", () => {
  const e = parseTable(HTML);
  assert.equal(e.length, 12);
  const n = e.find((x) => x.key === "nairobi" && x.from === "2026-10-15")!;
  assert.equal(n.to, "2026-11-14");
  assert.equal(n.petrol95, 226.96);
  assert.equal(n.diesel, 227.76);
  assert.equal(n.kerosene, 219.87);
});

test("a changed layout is refused", () => {
  assert.throws(() => parseTable("<html></html>"), /changed the layout/);
  assert.throws(() => parseTable(HTML.replace("Diesel (AGO)", "Gasoil")), /columns/);
});

test("currentPeriod picks the newest period that has started and needs 5 towns", () => {
  const e = parseTable(HTML);
  assert.equal(currentPeriod(e, "2026-11-03")[0].from, "2026-10-15");
  assert.equal(currentPeriod(e, "2026-10-10")[0].from, "2026-09-15");
  assert.throws(() => currentPeriod(e.slice(0, 3), "2026-11-03"), /fewer than 5/);
});

test("harvest: rows per town and fuel dated by the period start, no record count", () => {
  const h = harvestFromHtml(HTML, NOW);
  assert.equal(h.date, "2026-10-15");
  assert.equal(h.currency, "KES");
  assert.equal(h.rows.length, 18);
  const d = h.rows.find((r) => r.area === "nairobi" && r.item === "diesel")!;
  assert.equal(d.median, 227.76);
  assert.ok(Number.isNaN(d.n) && Number.isNaN(NO_COUNT));
});

test("diesel answer: regulated maximum as a posted price with no range or sample", () => {
  const h = harvestFromHtml(HTML, NOW);
  const a = keAnswer({ date: h.date, rows: h.rows as any }, { fuel: "diesel", town: "Nairobi" }, NOW);
  assert.equal(a.status, "ok");
  assert.equal(a.price?.value, 227.76);
  assert.equal(a.price?.currency, "KES");
  assert.equal(a.sample_size, null);
  assert.equal(a.price_type, "posted_pump_price");
  assert.equal(a.period.from, "2026-10-15");
  assert.equal((a.extra as any).other_product.value, 219.87);
});

test("no town gives Nairobi and says so; an unknown town lists examples; other fuels are refused", () => {
  const h = harvestFromHtml(HTML, NOW);
  const day = { date: h.date, rows: h.rows as any };
  const a = keAnswer(day, { fuel: "petrol95" }, NOW);
  assert.equal(a.price?.value, 226.96);
  assert.match(String(a.note ?? JSON.stringify(a)), /Nairobi/);
  assert.throws(() => keAnswer(day, { fuel: "petrol95", town: "Atlantis" }), /Atlantis.*nairobi/);
  assert.throws(() => keAnswer(day, { fuel: "lpg" }), /petrol95/);
});

test("manifest: Kenya, fuel category, history key, licence not claimed", () => {
  assert.deepEqual(manifest.countries, ["KE"]);
  assert.equal(manifest.category, "fuel");
  assert.equal(keHistoryKey({ fuel: "diesel", town: "Voi" })?.area, "voi");
  assert.equal(keHistoryKey({ fuel: "lpg" }), null);
  assert.equal(townKey("Kakamega "), "kakamega");
  assert.equal(keToday(new Date("2026-11-03T22:00:00Z")), "2026-11-04");
  assert.match(INFO.licence, /Free tier only/);
});
