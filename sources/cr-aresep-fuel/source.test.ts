// Tests for CR fuel (ARESEP tariffs). Fixture fixtures/tarifas.json: a cut of the REAL reply (25 of its first rows: all 20 products of the
// tariff valid from 2026-10-03 and 5 of 2026-09-10), captured 2026-10-29 12:30 UTC through the GitHub-hosted probe.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { INFO, crAnswer, crHistoryKey, crToday, harvestFromJson, parseTariffs } from "./source";
import manifest from "./index";
import { NO_COUNT } from "../../lib/stats";

const FIX = JSON.parse(readFileSync(new URL("./fixtures/tarifas.json", import.meta.url), "utf8"));
const NOW = new Date("2026-10-29T12:00:00Z");

test("parseTariffs picks the tariff in force for the three fuels", () => {
  const t = parseTariffs(FIX, "2026-10-29");
  const by = Object.fromEntries(t.map((x) => [x.item, x]));
  assert.equal(by.petrol95.price, 764);
  assert.equal(by.petrol91.price, 719);
  assert.equal(by.diesel.price, 785);
  assert.equal(by.diesel.from, "2026-10-03");
  assert.equal(by.petrol95.price_ex_vat, 762.35441);
});

test("a tariff that starts in the future is not used; the earlier one is", () => {
  const t = parseTariffs(FIX, "2026-10-02");
  const by = Object.fromEntries(t.map((x) => [x.item, x]));
  assert.equal(by.petrol95.price, 756);
  assert.equal(by.petrol95.from, "2026-09-10");
});

test("an implausible price or a changed layout is refused", () => {
  assert.throws(() => parseTariffs({}, "2026-10-29"), /changed the layout/);
  const bad = { value: [{ fechaRige: "2026-10-03", producto: "Gasolina RON 95", precioFinal: 7 }] };
  assert.deepEqual(parseTariffs(bad, "2026-10-29"), []);
});

test("harvest: rows dated by the tariff start, no record count", () => {
  const h = harvestFromJson(FIX, NOW);
  assert.equal(h.date, "2026-10-03");
  assert.equal(h.currency, "CRC");
  assert.equal(h.rows.length, 3);
  const d = h.rows.find((r) => r.item === "diesel")!;
  assert.equal(d.median, 785);
  assert.ok(Number.isNaN(d.n) && Number.isNaN(NO_COUNT));
  assert.throws(() => harvestFromJson({ value: [] }, NOW), /no current price/);
});

test("diesel answer: the regulated maximum as a posted price with no range or sample", () => {
  const h = harvestFromJson(FIX, NOW);
  const a = crAnswer({ date: h.date, rows: h.rows as any }, { fuel: "diesel" }, NOW);
  assert.equal(a.status, "ok");
  assert.equal(a.price?.value, 785);
  assert.equal(a.price?.currency, "CRC");
  assert.equal(a.price?.unit, "per litre");
  assert.equal(a.price?.typical_low, null);
  assert.equal(a.sample_size, null);
  assert.equal(a.price_type, "posted_pump_price");
  assert.equal(a.period.from, "2026-10-03");
  assert.match(a.summary, /maximum price/);
  assert.equal((a.extra as any).other_grade.value, 719);
});

test("a place is not used and the answer says so; other fuels are refused in plain words", () => {
  const h = harvestFromJson(FIX, NOW);
  const a = crAnswer({ date: h.date, rows: h.rows as any }, { fuel: "petrol95", town: "San José" }, NOW);
  assert.equal(a.price?.value, 764);
  assert.match(String((a.extra as any).place_note), /San José/);
  assert.throws(() => crAnswer({ date: h.date, rows: h.rows as any }, { fuel: "lpg" }), /petrol95/);
});

test("manifest: Costa Rica, fuel category, history key, licence not claimed", () => {
  assert.deepEqual(manifest.countries, ["CR"]);
  assert.equal(manifest.category, "fuel");
  assert.equal(crHistoryKey({ fuel: "diesel" })?.item, "diesel");
  assert.equal(crHistoryKey({ fuel: "lpg" }), null);
  assert.equal(crToday(new Date("2026-10-29T03:00:00Z")), "2026-10-28");
  assert.match(INFO.licence, /Free tier only/);
});
