// Fixture: fixtures/rows-2026-10-19.json holds real rows copied on 2026-10-20 from
// https://data.moa.gov.tw/api/v1/AgriProductsTransType/?Start_time=115.10.19&End_time=115.10.19&TcType=N04 and TcType=N05 (probe from GitHub's servers).
// Tests that need 5 or more records spread those real rows over several days with SYNTHETIC prices (marked below): the real day has too few records per product.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { InputError, SourceError } from "../../lib/http";
import { categoryById, SOURCE_PLUGINS } from "../../lib/registry";
import { answerFromRows, harvestFromRows, isoToMinguo, minguoToIso, parseRows, resolveProduct, taiwanDate, twHarvest, twHistoryKey, twWholesale, type Row } from "./source";

const JSON_ROWS = JSON.parse(readFileSync(new URL("./fixtures/rows-2026-10-19.json", import.meta.url), "utf8"));

/** SYNTHETIC: n cabbage records, one per day/market, with prices 20..20+n-1 (a test double, not market data). */
function synthetic(item: string, n: number, crop = "甘藍-初秋"): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    date: `2026-10-${String(10 + (i % 5)).padStart(2, "0")}`, type: "N04", crop, marketCode: String(500 + i), market: i % 2 ? "西螺鎮" : "溪湖鎮", avg: 20 + i, qty: 1000,
  }));
}

test("tw-coa-wholesale: Minguo dates convert both ways", () => {
  assert.equal(minguoToIso("115.10.19"), "2026-10-19");
  assert.equal(minguoToIso("115.1.5"), "2026-01-05");
  assert.equal(minguoToIso("2026-10-19"), null);
  assert.equal(isoToMinguo("2026-10-19"), "115.10.19");
  assert.equal(taiwanDate(0, new Date("2026-10-20T20:00:00Z")), "2026-10-21"); // UTC+8 is already the next day
});

test("tw-coa-wholesale: parsing keeps vegetables and fruit, drops closed markets", () => {
  const rows = parseRows(JSON_ROWS);
  assert.equal(rows.length, 10);
  assert.ok(!rows.some((r) => r.crop === "休市"));
  assert.equal(rows.find((r) => r.crop === "香蕉")!.avg, 23);
  assert.equal(rows.find((r) => r.crop === "香蕉")!.date, "2026-10-19");
});

test("tw-coa-wholesale: a changed layout is a SourceError", () => {
  assert.throws(() => parseRows({ error: "moved" }), SourceError);
  assert.throws(() => parseRows({ RS: "OK", Data: [{ foo: 1 }] }), SourceError);
  assert.deepEqual(parseRows({ RS: "OK", Data: [] }), []);
});

test("tw-coa-wholesale: product names, aliases and Taiwanese names resolve", () => {
  assert.equal(resolveProduct("Cabbage")!.key, "cabbage");
  assert.equal(resolveProduct("tomatoes")!.key, "tomato");
  assert.equal(resolveProduct("甘藍")!.key, "cabbage");
  assert.equal(resolveProduct("potatoes")!.key, "potato");
  assert.equal(resolveProduct("unobtainium"), null);
});

test("tw-coa-wholesale: a range needs 5 records; fewer is insufficient_data, not a figure", () => {
  const few = answerFromRows(parseRows(JSON_ROWS), { product: "cabbage" }); // the real day has 3 cabbage records
  assert.equal(few.status, "insufficient_data");
  assert.equal(few.price, null);
});

test("tw-coa-wholesale: answer is a TWD per kg range with sample size, period, markets and licence", () => {
  const a = answerFromRows(synthetic("cabbage", 8), { product: "cabbage" });
  assert.equal(a.status, "ok");
  assert.equal(a.price!.currency, "TWD");
  assert.equal(a.price!.unit, "per kg");
  assert.equal(a.price!.median, 23.5);
  assert.equal(a.price!.min, 20);
  assert.equal(a.price!.max, 27);
  assert.equal(a.sample_size, 8);
  assert.equal(a.price_type, "transaction");
  assert.deepEqual((a.extra as any).markets, ["溪湖鎮", "西螺鎮"]);
  assert.match(a.source.licence, /Open Data License/);
  assert.match(a.source.attribution, /Council of Agriculture/);
});

test("tw-coa-wholesale: a market filter narrows the records; an unknown market is an input error", () => {
  const rows = synthetic("cabbage", 12);
  const a = answerFromRows(rows, { product: "cabbage", market: "西螺" });
  assert.equal(a.sample_size, 6);
  assert.equal(answerFromRows(rows, { product: "cabbage", market: "Xiluo" }).sample_size, 6);
  assert.throws(() => answerFromRows(rows, { product: "cabbage", market: "Atlantis" }), InputError);
});

test("tw-coa-wholesale: imports are left out unless there are fewer than 5 domestic records", () => {
  const mixed = [...synthetic("onion", 6, "洋蔥-本產"), ...synthetic("onion", 6, "洋蔥-進口").map((r) => ({ ...r, avg: 99 }))];
  const a = answerFromRows(mixed, { product: "onion" });
  assert.equal(a.sample_size, 6);
  assert.ok(a.price!.max < 99);
  const onlyImport = answerFromRows(synthetic("onion", 6, "洋蔥-進口"), { product: "onion" });
  assert.equal(onlyImport.status, "ok");
  assert.equal((onlyImport.extra as any).imports_included, true);
});

test("tw-coa-wholesale: pineapple does not pick up pear (梨 is a whole base name, 鳳梨 is not 梨)", () => {
  const rows = [...synthetic("p", 6, "鳳梨-金鑽鳳梨"), ...synthetic("p", 6, "梨-寶島甘露梨").map((r) => ({ ...r, avg: 63 }))];
  assert.equal(answerFromRows(rows, { product: "pear" }).price!.median, 63);
  assert.ok(answerFromRows(rows, { product: "pineapple" }).price!.max < 63);
  assert.equal(answerFromRows([...rows, ...synthetic("l", 5, "雜柑-檸檬")], { product: "lemon" }).sample_size, 5);
});

test("tw-coa-wholesale: an unknown product is an input error before any network call", async () => {
  await assert.rejects(twWholesale({ product: "unobtainium" }, async () => { throw new Error("network must not be used"); }), InputError);
  await assert.rejects(twWholesale({}, async () => ({})), InputError);
});

test("tw-coa-wholesale: live handler asks for vegetables and fruit for the last 8 days", async () => {
  const urls: string[] = [];
  const now = new Date("2026-10-20T10:00:00Z");
  const a = await twWholesale({ product: "banana" }, async (u) => { urls.push(u); return { RS: "OK", Data: [] }; }, now);
  assert.equal(a.status, "no_matches");
  assert.equal(urls.length, 2);
  assert.ok(urls.every((u) => u.includes("Start_time=115.10.13") && u.includes("End_time=115.10.20")));
  assert.deepEqual(urls.map((u) => /TcType=(\w+)/.exec(u)![1]).sort(), ["N04", "N05"]);
});

test("tw-coa-wholesale: harvest gives national rows with 5+ records and no imports", () => {
  const rows = [...synthetic("cabbage", 6).map((r) => ({ ...r, date: "2026-10-19" })), ...synthetic("onion", 6, "洋蔥-進口").map((r) => ({ ...r, date: "2026-10-19" })), ...synthetic("banana", 3, "香蕉").map((r) => ({ ...r, date: "2026-10-19" }))];
  const h = harvestFromRows(rows, "2026-10-19");
  assert.deepEqual(h.rows.map((r) => r.item), ["cabbage"]);
  assert.equal(h.rows[0].area, "ALL");
  assert.equal(h.rows[0].n, 6);
  assert.equal(h.currency, "TWD");
  assert.throws(() => harvestFromRows([], "2026-10-19"), SourceError);
});

test("tw-coa-wholesale: collector steps back over a market holiday", async () => {
  const day = (d: string) => ({ RS: "OK", Data: synthetic("cabbage", 6).map((r, i) => ({ TransDate: d, TcType: "N04", CropCode: "LA1", CropName: r.crop, MarketCode: String(i), MarketName: r.market, Avg_Price: r.avg, Trans_Quantity: 100 })) });
  const asked: string[] = [];
  const h = await twHarvest(async (u) => {
    const d = /Start_time=([\d.]+)/.exec(u)![1];
    asked.push(d);
    return d === "115.10.19" ? { RS: "OK", Data: [] } : day(d);
  }, new Date("2026-10-20T03:17:00Z"));
  assert.equal(h.date, "2026-10-18");
  assert.ok(asked.includes("115.10.19") && asked.includes("115.10.18"));
});

test("tw-coa-wholesale: history key and manifest", () => {
  assert.deepEqual(twHistoryKey({ country: "TW", product: "tomatoes" }), { area: "ALL", item: "tomato", label: "Taiwan wholesale tomato" });
  assert.equal(twHistoryKey({ country: "TW", product: "unobtainium" }), null);
  assert.equal(twHistoryKey({ country: "FR", product: "cabbage" }), null);
  const src = SOURCE_PLUGINS.find((s) => s.info.id === "tw-coa-wholesale")!;
  assert.equal(src.category, "wholesale-markets");
  assert.ok(categoryById("wholesale-markets"));
});
