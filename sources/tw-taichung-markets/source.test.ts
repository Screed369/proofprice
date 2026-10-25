// Tests for the Taichung market source. Fixture format copied from the live file on 2026-10-25 (probe from GitHub Actions, 5.3 MB JSON array):
// {"市場名稱":"第五市場","訪價日期":"20261022","絲瓜":"51",...,"雞蛋":"45","鴨蛋":"52",...}; values are strings, "0" = no price that day.
import { test } from "node:test";
import assert from "node:assert/strict";
import { INFO, buildRows, defsFor, isoDate, matchItems, parseMarkets, taichungAnswerFromRows } from "./source";
import manifest from "./index";
import { categoryById, countriesFor } from "../../lib/registry";

const MARKETS = ["南屯市場", "第五市場", "清水第一市場", "第三市場", "東光市場", "沙鹿市場"];
const row = (market: string, date: string, eggs: string, loin: string, belly = "0") => ({ 市場名稱: market, 訪價日期: date, 雞蛋: eggs, 鴨蛋: "52", 里肌肉: loin, 五花肉: belly, 白蝦: "0", 蒜頭: "0" });

function fixture() {
  const data: Record<string, string>[] = [];
  // 6 markets x 2 days of eggs (45..65 per catty); 6 days of loin only in 2 markets; one wild egg typo; one old day; one zero
  MARKETS.forEach((m, i) => {
    data.push(row(m, "20261022", String(45 + i * 4), "162", i < 3 ? String(150 + i) : "0"));
    data.push(row(m, "20261023", String(46 + i * 4), "0"));
  });
  data.push(row("第三市場", "20261023", "4500", "0")); // 100x typo: dropped
  data.push(row("南屯市場", "20250101", "10", "100")); // outside the window
  data.push({ 市場名稱: "南屯市場", 訪價日期: "bad", 雞蛋: "99" });
  return data;
}

test("dates: only real YYYYMMDD days", () => {
  assert.equal(isoDate("20261022"), "2026-10-22");
  assert.equal(isoDate("20261340"), "");
  assert.equal(isoDate("2026-10-22"), "");
  assert.equal(isoDate(undefined), "");
});

test("parse: window, zeros and bad dates are skipped, prices converted from catty to kg, new layout fails loudly", () => {
  const p = parseMarkets(fixture());
  assert.equal(p.newest, "2026-10-23");
  assert.equal(p.markets, 6);
  assert.ok(!p.recs.some((r) => r.date === "2025-01-01"));
  assert.ok(!p.recs.some((r) => r.price === 99 / 0.6));
  assert.ok(p.recs.every((r) => r.price > 0));
  const egg = p.recs.find((r) => r.item === "雞蛋" && r.price === Math.round((45 / 0.6) * 100) / 100);
  assert.ok(egg, "45 per catty = 75 per kg");
  assert.throws(() => parseMarkets([{ a: 1 }]), /new layout/);
  assert.throws(() => parseMarkets([]), /empty/);
});

test("rows: 5 or more market-days, outlier dropped, products with fewer are not published", () => {
  const b = buildRows(parseMarkets(fixture()).recs);
  const egg = b.rows.find((r) => r.item === "雞蛋")!;
  assert.equal(egg.n, 12);
  assert.ok(egg.max < 120, "the 4500 typo is gone");
  assert.equal(b.dropped, 1);
  assert.ok(!b.rows.some((r) => r.item === "五花肉"), "only 3 belly prices");
  assert.ok(!b.rows.some((r) => r.item === "白蝦"));
});

test("matching: English and Chinese, preferred product first", () => {
  const b = buildRows(parseMarkets(fixture()).recs);
  const defs = defsFor(b.rows);
  assert.equal(matchItems(defs, "eggs")[0].key, "雞蛋");
  assert.equal(matchItems(defs, "duck egg")[0].key, "鴨蛋");
  assert.equal(matchItems(defs, "price of pork loin in Taichung")[0].key, "里肌肉");
  assert.equal(matchItems(defs, "雞蛋")[0].key, "雞蛋");
  assert.deepEqual(matchItems(defs, "unicorn"), []);
});

test("answer: posted price per kg, n = market-days, period ends at the newest day; unknown item gives a hint", () => {
  const b = buildRows(parseMarkets(fixture()).recs);
  const day = { date: "2026-10-23", rows: b.rows };
  const a = taichungAnswerFromRows(day, { item: "eggs", today: "2026-10-25" });
  assert.equal(a.status, "ok");
  assert.equal(a.price!.currency, "TWD");
  assert.equal(a.price!.unit, "per kg");
  assert.equal(a.price_type, "posted_price");
  assert.equal(a.sample_size, 12);
  assert.equal(a.period.to, "2026-10-23");
  assert.equal(a.period.from, "2026-10-10");
  assert.match(a.summary, /not receipts/);
  assert.ok(a.price!.median! > 70 && a.price!.median! < 110);
  const none = taichungAnswerFromRows(day, { item: "unicorn", today: "2026-10-25" });
  assert.equal(none.status, "no_matches");
  assert.throws(() => taichungAnswerFromRows(day, { item: "" }), /item is required/);
});

test("manifest: groceries, TW, licence and attribution present", () => {
  assert.equal(manifest.category, "groceries");
  assert.deepEqual(manifest.countries, ["TW"]);
  assert.ok(manifest.harvest && manifest.historyKey);
  assert.ok(categoryById("groceries"));
  assert.ok(countriesFor("groceries").includes("TW"));
  assert.match(INFO.attribution, /data\.gov\.tw\/license/);
  assert.equal(INFO.price_type, "posted_price");
});
