import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDrugRows, latestEdition, fileUrls, editionDate, unitOf, stemOf, norm, dailyRows, candidateKeys, jpAnswerFromRow, jpHistoryKey, EN_TO_JA, Drug } from "./source";
import type { Cell } from "../../categories/rent/xlsx";

// Real header and first rows of tp20260318-01_01.xlsx (sheet ＨＰ用), probed 21 Oct 2026 from GitHub Actions.
const HEAD: Cell[] = ["区分", "薬価基準収載医薬品コード", "成分名セイブンメイ", "規格タダシカク", null, null, null, "品名", "メーカー名", "診療報酬において加算等の算定対象となる後発医薬品", "先発医薬品センパツイヤクヒン", "同一剤形・規格の後発医薬品がある先発医薬品イヤクイヤク", "薬価", "経過措置による使用期限", "備考"];
const ROWS: Cell[][] = [
  HEAD,
  ["内用薬", "1121001X1018", "ブロモバレリル尿素", "１ｇ", "局", null, null, "ブロモバレリル尿素", null, null, null, null, 7.5],
  ["内用薬", "1124001B1039", "エスタゾラム", "１％１ｇ", null, null, null, "ユーロジン散１％", "Ｔ’ｓ製薬", null, "先発品", null, 37.4],
  ["内用薬", "1124001F1022", "エスタゾラム", "１ｍｇ１錠", null, null, null, "ユーロジン１ｍｇ錠", "Ｔ’ｓ製薬", null, "先発品", null, 6.1],
  ["内用薬", "1124001F1030", "エスタゾラム", "１ｍｇ１錠", null, null, null, "エスタゾラム錠１ｍｇ「アメル」", "共和薬品工業", "★", null, null, 6.1],
  ["内用薬", "1124001F2010", "エスタゾラム", "２ｍｇ１錠", null, null, null, "エスタゾラム２ｍｇ錠", null, "後発品", null, null, 6.6],
  ["内用薬", "1124001F2029", "エスタゾラム", "２ｍｇ１錠", null, null, null, "ユーロジン２ｍｇ錠", "Ｔ’ｓ製薬", null, "先発品", "○", 8.4],
  ["内用薬", "1124003B1070", "ニトラゼパム", "１％１ｇ", null, null, null, "ネルボン散１％", "アルフレッサファーマ", null, null, null, 10.6, "R8.3.31まで"],
  ["内用薬", "9999999X9999", "空欄テスト", "１錠", null, null, null, "価格なし", null, null, null, null, null],
];

test("jp-mhlw parses the real layout", () => {
  const d = parseDrugRows(ROWS);
  assert.equal(d.length, 7); // the row without a price is skipped
  assert.deepEqual(d[2], { ingredient: "エスタゾラム", spec: "1mg1錠", brand: "ユーロジン1mg錠", kind: "brand", price: 6.1 });
  assert.equal(d[4].kind, "generic");
  assert.equal(d[3].kind, "other");
  assert.equal(d[5].price, 8.4);
});
test("jp-mhlw fails loudly when the header is gone", () => {
  assert.throws(() => parseDrugRows([["a", "b"], [1, 2]]), /format changed/);
});
test("jp-mhlw finds the newest full edition on the listing page", () => {
  const html = `<a href="/topics/2025/04/xls/tp20260220-01_05.xlsx"> <a href="/topics/2025/04/xls/tp20260318-01_03.xlsx"><a href="/topics/2025/04/xls/tp20260318-01_01.xlsx"><a href="/topics/2025/04/xls/tp20260318-01_02.xlsx"><a href="/topics/2025/04/xls/tp20260318-01_05.xlsx"><a href="/topics/2025/04/xls/tp20251205-01_01.xlsx">`;
  assert.equal(latestEdition(html), "20260318");
  assert.equal(latestEdition("<p>nothing</p>"), null);
  assert.deepEqual(fileUrls("20260318"), [1, 2, 3].map((n) => `https://www.mhlw.go.jp/topics/2025/04/xls/tp20260318-01_0${n}.xlsx`));
  assert.equal(editionDate("20260318"), "2026-03-18");
});
test("jp-mhlw units and stems", () => {
  assert.equal(unitOf("１ｍｇ１錠"), "tab");
  assert.equal(unitOf("５ｍｇ１カプセル"), "cap");
  assert.equal(unitOf("１％１ｇ"), "g");
  assert.equal(unitOf("１０ｍＬ１瓶"), "other");
  assert.equal(unitOf("１ｍＬ"), "ml");
  assert.equal(stemOf("ロキソプロフェンナトリウム水和物"), "ロキソプロフェン");
  assert.equal(stemOf("アムロジピンベシル酸塩"), "アムロジピン");
  assert.equal(stemOf("メトホルミン塩酸塩"), "メトホルミン");
  assert.equal(stemOf("エスタゾラム"), "エスタゾラム");
  assert.equal(norm("ＡＢＣ　１ｍｇ"), "abc 1mg");
});
test("jp-mhlw daily rows need 5 products per ingredient and unit", () => {
  const d = parseDrugRows(ROWS);
  const r = dailyRows(d);
  assert.deepEqual(r, []); // estazolam has only 4 tablet products and 1 powder: every group is below 5, so nothing is published
  const many: Drug[] = Array.from({ length: 5 }, (_, i) => ({ ingredient: "アムロジピンベシル酸塩", spec: "5mg1錠", brand: "x" + i, kind: "generic" as const, price: 10 + i }));
  const rows = dailyRows(many);
  assert.deepEqual(rows.map((x) => x.item).sort(), ["name:アムロジピン|tab", "name:アムロジピンベシル酸塩|tab"]);
  assert.equal(rows[0].n, 5);
  assert.equal(dailyRows(many.slice(0, 4)).length, 0);
});
test("jp-mhlw maps English names to Japanese keys and demands a name", () => {
  assert.deepEqual(candidateKeys("Amlodipine 5mg"), ["アムロジピン", "amlodipine"]);
  assert.deepEqual(candidateKeys("paracetamol"), ["アセトアミノフェン", "paracetamol"]);
  assert.equal(candidateKeys("アセトアミノフェン")[0], "アセトアミノフェン");
  assert.throws(() => candidateKeys(""));
  assert.equal(jpHistoryKey({ medicine: "metformin" })?.item, "name:メトホルミン|tab");
  assert.ok(Object.values(EN_TO_JA).every((v) => /^[ァ-ヴー]+$/.test(v)));
});
test("jp-mhlw answer is a posted official price in yen, never 'paid'", () => {
  const row = { date: "2026-10-21", area: "ALL", item: "name:アムロジピン|tab", n: 80, median: 10.1, low: 10.1, high: 28.4, min: 10.1, max: 60.4 };
  const a = jpAnswerFromRow(row, { key: "アムロジピン", unit: "tab", today: "2026-10-21" });
  assert.equal(a.status, "ok");
  assert.equal(a.price_type, "posted_price");
  assert.equal(a.price?.currency, "JPY");
  assert.equal(a.sample_size, 80);
  assert.match(a.summary, /not market transactions/);
  assert.match(a.summary, /per tablet/);
  const old = jpAnswerFromRow(row, { key: "アムロジピン", unit: "tab", today: "2026-11-15" });
  assert.match(old.summary, /days old/);
});
