// Fixture: fixtures/oilprice_en.csv is the whole real file, copied on 2026-10-29 from
// https://www.consumer.org.hk/pricewatch/oilwatch/opendata/oilprice_en.csv (BOM, newline inside the third header cell, 15 rows).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { InputError, SourceError } from "../../lib/http";
import { categoryById, SOURCE_PLUGINS } from "../../lib/registry";
import { NO_COUNT } from "../../lib/stats";
import { INFO, answerFromRows, companiesFor, harvestFromRows, hkFuel, hkHistoryKey, parseCsv, parseOilPrices } from "./source";

const CSV = readFileSync(new URL("./fixtures/oilprice_en.csv", import.meta.url), "utf8");

test("hk-consumer-fuel: the CSV parser copes with the BOM and the newline inside the header", () => {
  const rows = parseCsv(CSV);
  assert.equal(rows.length, 16);
  assert.equal(rows[0][2], "Pump Price\n(HKD / Litre)");
  assert.equal(rows[1][0], "Standard Petrol");
});

test("hk-consumer-fuel: 15 price rows, 3 fuels x 5 companies", () => {
  const rows = parseOilPrices(CSV);
  assert.equal(rows.length, 15);
  assert.equal(rows.filter((r) => r.fuel === "Diesel").length, 5);
  assert.equal(rows.find((r) => r.fuel === "Diesel" && r.company === "Esso")!.price, 38.23);
});

test("hk-consumer-fuel: a changed layout is a SourceError", () => {
  assert.throws(() => parseOilPrices("<html>moved</html>"), SourceError);
  assert.throws(() => parseOilPrices('"Auto-fuel Type","Oil Company","Pump Price"\n'), SourceError);
});

test("hk-consumer-fuel: diesel answer is the median of five posted prices in HKD per litre", () => {
  const a = answerFromRows(parseOilPrices(CSV), { fuel: "diesel", asOf: "2026-10-29" });
  assert.equal(a.status, "ok");
  assert.equal(a.price_type, "posted_pump_price");
  assert.equal(a.price!.currency, "HKD");
  assert.equal(a.price!.unit, "per litre");
  assert.equal(a.price!.value, 38.03);
  assert.equal(a.price!.min, 38.03);
  assert.equal(a.price!.max, 38.23);
  assert.equal(a.period.to, "2026-10-29");
  assert.equal((a.extra as any).companies, 5);
  assert.equal((a.extra as any).company_prices_hkd_per_litre.Esso, 38.23);
  assert.match(a.source.licence, /DATA\.GOV\.HK/);
  assert.match(a.summary, /not|posted/i);
});

test("hk-consumer-fuel: standard petrol is petrol95, premium is petrol98, places are answered territory-wide", () => {
  const rows = parseOilPrices(CSV);
  assert.equal(answerFromRows(rows, { fuel: "petrol95" }).price!.value, 34.72);
  const p98 = answerFromRows(rows, { fuel: "petrol98", town: "Kowloon" });
  assert.equal(p98.price!.value, 36.52);
  assert.equal(p98.price!.min, 34.72);
  assert.match(p98.statistic!.note!, /Hong Kong figure/);
  assert.throws(() => answerFromRows(rows, { fuel: "lpg" }), InputError);
});

test("hk-consumer-fuel: a missing fuel gives no_matches, not a made-up number", () => {
  const rows = parseOilPrices(CSV).filter((r) => r.fuel !== "Diesel");
  assert.equal(companiesFor(rows, "diesel"), null);
  assert.equal(answerFromRows(rows, { fuel: "diesel" }).status, "no_matches");
});

test("hk-consumer-fuel: fetch is injected and the registry routes HK to it", async () => {
  const a = await hkFuel({ fuel: "diesel" }, async () => CSV);
  assert.equal(a.status, "ok");
  const plugin = SOURCE_PLUGINS.find((s) => s.info.id === INFO.id)!;
  assert.equal(plugin.category, "fuel");
  assert.deepEqual(plugin.countries, ["HK"]);
  assert.ok(categoryById("fuel"));
});

test("hk-consumer-fuel: harvest keeps one row per fuel with no record count", () => {
  const h = harvestFromRows(parseOilPrices(CSV), "2026-10-29");
  assert.equal(h.date, "2026-10-29");
  assert.equal(h.currency, "HKD");
  assert.deepEqual(h.rows.map((r) => r.item), ["diesel", "petrol95", "petrol98"]);
  assert.equal(h.rows[0].area, "HK");
  assert.equal(h.rows[0].median, 38.03);
  assert.equal(h.rows[0].n, NO_COUNT);
  assert.throws(() => harvestFromRows([]), SourceError);
});

test("hk-consumer-fuel: history key is HK + fuel and rejects other countries and fuels", () => {
  assert.equal(hkHistoryKey({ country: "hk", fuel: "diesel" })?.area, "HK");
  assert.equal(hkHistoryKey({ country: "TW", fuel: "diesel" }), null);
  assert.equal(hkHistoryKey({ country: "HK", fuel: "lpg" }), null);
});
