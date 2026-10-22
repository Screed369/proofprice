// Fixture: fixtures/MainProdListPrice_English.json holds real rows copied on 2026-10-18 from
// https://vipmbr.cpc.com.tw/openData/MainProdListPrice_English (5 per-litre products and 2 marine fuels).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { InputError, SourceError } from "../../lib/http";
import { categoryById, SOURCE_PLUGINS } from "../../lib/registry";
import { API_URL, answerFromProducts, harvestFromProducts, minguoToIso, parseProducts, twFuel, twHistoryKey } from "./source";

const JSON_ROWS = JSON.parse(readFileSync(new URL("./fixtures/MainProdListPrice_English.json", import.meta.url), "utf8"));

test("tw-fuel: Minguo dates become ISO dates", () => {
  assert.equal(minguoToIso("1151019"), "2026-10-19");
  assert.equal(minguoToIso("1150105"), "2026-01-05");
  assert.equal(minguoToIso("20261019"), null);
  assert.equal(minguoToIso("1151319"), null);
  assert.equal(minguoToIso(undefined), null);
});

test("tw-fuel: keeps per-litre products and drops marine fuels (per kilolitre)", () => {
  const p = parseProducts(JSON_ROWS);
  assert.equal(p.length, 5);
  assert.ok(!p.some((x) => /Marine/.test(x.name)));
  assert.equal(p.find((x) => x.name === "Premium Diesel")!.ntdPerLitre, 29.9);
});

test("tw-fuel: a changed layout is a SourceError", () => {
  assert.throws(() => parseProducts({ error: "moved" }), SourceError);
  assert.throws(() => parseProducts([{ 產品名稱: "x", 計價單位: "NT$ per kiloliter", 參考牌價_金額: 1, 牌價生效日期: "1151019" }]), SourceError);
});

test("tw-fuel: diesel answer is a posted NT$ per litre price with its effective date", async () => {
  const a = await twFuel({ fuel: "diesel" }, async (u) => {
    assert.equal(u, API_URL);
    return JSON_ROWS;
  });
  assert.equal(a.status, "ok");
  assert.equal(a.price!.currency, "TWD");
  assert.equal(a.price!.unit, "per litre");
  assert.equal(a.price!.value, 29.9);
  assert.equal(a.period.to, "2026-10-19");
  assert.equal((a.extra as any).list_prices_ntd_per_litre["92 Unleaded Gasoline"], 31.2);
  assert.match(a.source.licence, /Open Data License/);
  assert.equal(answerFromProducts(parseProducts(JSON_ROWS), { fuel: "petrol98" }).price!.value, 34.7);
});

test("tw-fuel: places are answered nationally; unknown fuels are input errors", () => {
  const p = parseProducts(JSON_ROWS);
  const a = answerFromProducts(p, { fuel: "petrol95", town: "Taipei" });
  assert.equal(a.price!.value, 32.7);
  assert.match(a.statistic!.note!, /island-wide/);
  assert.throws(() => answerFromProducts(p, { fuel: "lpg" }), InputError);
});

test("tw-fuel: harvest gives one national row per fuel with the effective date", () => {
  const h = harvestFromProducts(parseProducts(JSON_ROWS));
  assert.equal(h.date, "2026-10-19");
  assert.equal(h.currency, "TWD");
  assert.deepEqual(h.rows.map((r) => r.item).sort(), ["diesel", "petrol95", "petrol98"]);
  assert.ok(h.rows.every((r) => r.area === "ALL" && r.low === r.median && r.high === r.median));
  assert.deepEqual(twHistoryKey({ country: "tw", fuel: "diesel" }), { area: "ALL", item: "diesel", label: "Taiwan (CPC posted list price)" });
  assert.equal(twHistoryKey({ country: "TW", fuel: "lpg" }), null);
});

test("tw-fuel: registered in the fuel category for TW", () => {
  assert.ok(categoryById("fuel"));
  assert.ok(SOURCE_PLUGINS.some((s) => s.info.id === "tw-fuel" && s.countries.includes("TW")));
});

test("a CPC list price is called a list price, and one published price is not a thin range", () => {
  const a = answerFromProducts(parseProducts(JSON_ROWS), { fuel: "petrol95" });
  assert.doesNotMatch(a.summary, /Official average/);
  assert.match(a.summary, /List price published by CPC Corporation/);
  assert.equal(a.reliability, "official_median_no_count");
});
