// Tests for the Taipower tariff source. fixtures/tariffs.json is a REAL copy of the residential block of
// https://service.taipower.com.tw/data/opendata/apply/file/d007008/001.json checked on 2026-10-22 (tariff in force from 2025-10-01).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { InputError, SourceError } from "../../lib/http";
import { SOURCE_PLUGINS } from "../../lib/registry";
import { INFO, answerFromTable, monthlyBill, normaliseSeason, normaliseUse, parseTable, tierUpperLimit, twElectricity, URL_JSON } from "./source";

const JSON_FIXTURE = JSON.parse(readFileSync(new URL("./fixtures/tariffs.json", import.meta.url), "utf8"));
const TABLE = parseTable(JSON_FIXTURE);

test("licence and type", () => {
  assert.match(INFO.licence, /Open Government Data License/);
  assert.equal(INFO.price_type, "posted_price");
});

test("tier labels", () => {
  assert.equal(tierUpperLimit("120度以下部分"), 120);
  assert.equal(tierUpperLimit("121~330度部分"), 330);
  assert.equal(tierUpperLimit("1001度以上部分"), Infinity);
  assert.equal(tierUpperLimit("每燈每月"), null);
});

test("parses the real table", () => {
  assert.equal(TABLE.effective, "2025-10-01");
  assert.equal(TABLE.tiers.length, 6);
  assert.deepEqual(TABLE.tiers.map((t) => t.upTo), [120, 330, 500, 700, 1000, Infinity]);
  assert.deepEqual([TABLE.tiers[1].summer, TABLE.tiers[1].nonSummer], [2.55, 2.26]);
  assert.throws(() => parseTable({ data: {}, metadata: {} }), SourceError);
  assert.throws(() => parseTable("<html>moved</html>"), SourceError);
});

test("bill is charged tier by tier", () => {
  // 120 x 1.78 + 210 x 2.26 = 213.6 + 474.6 = 688.2 (non-summer); summer 120 x 1.78 + 210 x 2.55 = 749.1
  assert.equal(Math.round(monthlyBill(TABLE, 330, "non_summer") * 100) / 100, 688.2);
  assert.equal(Math.round(monthlyBill(TABLE, 330, "summer") * 100) / 100, 749.1);
  assert.equal(Math.round(monthlyBill(TABLE, 120, "summer") * 100) / 100, 213.6);
  // 1,200 kWh summer: 213.6 + 210*2.55 + 170*3.8 + 200*5.14 + 300*6.44 + 200*8.86
  assert.equal(Math.round(monthlyBill(TABLE, 1200, "summer") * 100) / 100, 213.6 + 535.5 + 646 + 1028 + 1932 + 1772);
});

test("input handling", () => {
  assert.deepEqual(normaliseUse(""), { kwh: 330, band: "standard" });
  assert.deepEqual(normaliseUse("LOW"), { kwh: 120, band: "low" });
  assert.deepEqual(normaliseUse("450 kWh"), { kwh: 450, band: "450 kWh a month" });
  assert.throws(() => normaliseUse("0"), InputError);
  assert.throws(() => normaliseUse("lots"), InputError);
  assert.equal(normaliseSeason(""), "non_summer");
  assert.equal(normaliseSeason("Summer"), "summer");
  assert.throws(() => normaliseSeason("spring"), InputError);
});

test("default answer: standard use, non-summer, posted tariff with no sample size", () => {
  const a = answerFromTable(TABLE, { energy: "electricity", taxes: "all" });
  assert.equal(a.status, "ok");
  assert.equal(a.price!.currency, "TWD");
  assert.equal(a.price!.value, 2.0855); // 688.2 / 330
  assert.equal(a.sample_size, null);
  assert.equal(a.price_type, "posted_price");
  assert.equal(a.period!.from, "2025-10-01");
  assert.equal(a.period!.to, new Date().toISOString().slice(0, 10));
  assert.equal(a.data_as_of, a.period!.to);
  assert.equal((a.extra as any).monthly_bill_twd, 688.2);
  assert.equal((a.extra as any).tiers.length, 6);
  assert.equal(a.source.id, "tw-taipower-tariffs");
});

test("summer and high use", () => {
  const a = answerFromTable(TABLE, { consumption_band: "high", season: "summer" });
  // 213.6 + 210*2.55 + 170*3.8 + 200*5.14 = 213.6+535.5+646+1028 = 2423.1 ; / 700
  assert.equal((a.extra as any).monthly_bill_twd, 2423.1);
  assert.equal(a.price!.value, 3.4616);
  assert.ok((a.extra as any).average_price_other_season_twd_per_kwh < a.price!.value);
});

test("gas is refused", () => {
  assert.throws(() => answerFromTable(TABLE, { energy: "gas" }), InputError);
});

test("fetch path uses the official URL and reports a changed layout", async () => {
  const seen: string[] = [];
  const a = await twElectricity({ energy: "electricity" }, async (u) => { seen.push(u); return JSON_FIXTURE; });
  assert.equal(a.status, "ok");
  assert.deepEqual(seen, [URL_JSON]);
  await assert.rejects(() => twElectricity({}, async () => ({ nope: 1 })), SourceError);
  await assert.rejects(() => twElectricity({ consumption_band: "x" }, async () => JSON_FIXTURE), InputError);
});

test("manifest is registered for TW energy", () => {
  const p = SOURCE_PLUGINS.find((x) => x.info.id === "tw-taipower-tariffs")!;
  assert.ok(p);
  assert.equal(p.category, "energy");
  assert.deepEqual(p.countries, ["TW"]);
});
