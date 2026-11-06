import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTitckRows, titckDailyRows, titckAnswerFromRow, titckKey, titckHistoryKey, nameKey, listLinks, TrPack } from "./source";

// Real first rows of the TITCK sheet "REFERANS BAZLI İLAÇ LİSTESİ" (REFERANSBAZLILALSTES_ede284aa-….xlsx), read 6 Nov 2026.
const ROWS = [
  ["          REFERANS BAZLI İLAÇ FİYAT LİSTESİ     \n      EDİT-LST-18 / 02.10.2025 /Rev: 00  ", null, null],
  [null, null, null], [null, null, null], [null, null, null],
  ["ILAC ADI ", "FIRMA ADI", "GERCEK KAYNAK FIYAT (GKF) (€)"],
  ["ABETYL 250 MG TABLET (120 TABLET)", "ABDİ İBRAHİM İLAÇ SANAYİ VE TİCARET A.Ş", 1410.08],
  ["ABILIFY 1 MG/ML ORAL SOLUSYON 150 ML", "ABDİ İBRAHİM OTSUKA İLAÇ SAN. VE TİC. A.Ş", 16.18],
  ["ABILIFY 10 MG 28 TABLET", "ABDİ İBRAHİM OTSUKA İLAÇ SAN. VE TİC. A.Ş", 20.44],
  ["ABILIFY 15 MG 28 TABLET", "ABDİ İBRAHİM OTSUKA İLAÇ SAN. VE TİC. A.Ş", 20.44],
  ["ABILIFY 30 MG 28 TABLET", "ABDİ İBRAHİM OTSUKA İLAÇ SAN. VE TİC. A.Ş", 42.16],
  ["ABILIFY 5 MG 28 TABLET", "ABDİ İBRAHİM OTSUKA İLAÇ SAN. VE TİC. A.Ş", 15.11],
] as any[][];

test("tr-titck parses the live layout", () => {
  const l = parseTitckRows(ROWS);
  assert.equal(l.revision, "2025-10-02");
  assert.equal(l.packs.length, 6);
  assert.deepEqual(l.packs[1], { name: "ABILIFY 1 MG/ML ORAL SOLUSYON 150 ML", company: "ABDİ İBRAHİM OTSUKA İLAÇ SAN. VE TİC. A.Ş", price: 16.18 });
});
test("tr-titck rejects a changed layout and skips duplicates or unpriced rows", () => {
  assert.throws(() => parseTitckRows([["x"], ["y"]]), /header row/);
  const dup = [...ROWS.slice(0, 6), ROWS[5], ["FOO 5 MG", "X", "n/a"], ["BAR", "X", 0]] as any[][];
  assert.equal(parseTitckRows(dup).packs.length, 1);
});
test("tr-titck name helpers fold Turkish letters", () => {
  assert.equal(nameKey("ABILIFY 10 MG"), "abilify");
  assert.equal(nameKey("İBUPROFEN 400"), "ibuprofen");
  assert.equal(nameKey("ÇAYKUR 5"), "caykur");
  assert.equal(nameKey("10 MG"), null);
  assert.equal(titckKey("Abilify 10").item, "name:abilify");
  assert.throws(() => titckKey(""));
  assert.equal(titckHistoryKey({}), null);
  assert.equal(titckHistoryKey({ medicine: "zyprexa" })?.item, "name:zyprexa");
});
test("tr-titck finds xlsx links on the list page, newest first", () => {
  const html = '<a href="https://titck.gov.tr/storage/Archive/2026/dynamicModulesAttachment/A_1.xlsx" class="badge"></a><a href="https://titck.gov.tr/storage/Archive/2025/dynamicModulesAttachment/B_2.xlsx"></a><a href="https://titck.gov.tr/storage/Archive/2026/dynamicModulesAttachment/A_1.xlsx"></a><a href="https://example.com/x.xlsx"></a>';
  assert.deepEqual(listLinks(html), [
    "https://titck.gov.tr/storage/Archive/2026/dynamicModulesAttachment/A_1.xlsx",
    "https://titck.gov.tr/storage/Archive/2025/dynamicModulesAttachment/B_2.xlsx",
  ]);
});
test("tr-titck daily rows need 5 packs per brand", () => {
  const five: TrPack[] = Array.from({ length: 5 }, (_, i) => ({ name: `FOO ${i} MG`, company: "X", price: 2 + i }));
  const r = titckDailyRows(five);
  assert.equal(r.length, 1);
  assert.equal(r[0].n, 5);
  assert.equal(r[0].area, "ALL");
  assert.equal(titckDailyRows(five.slice(0, 4)).length, 0);
  assert.equal(titckDailyRows(parseTitckRows(ROWS).packs).length, 1); // ABILIFY has exactly 5 packs
});
test("tr-titck answer is a posted price, never 'paid'", () => {
  const row = { date: "2026-11-06", area: "ALL", item: "name:abilify", n: 5, median: 20.44, low: 15.11, high: 42.16, min: 15.11, max: 42.16 };
  const a = titckAnswerFromRow(row, { key: "abilify", today: "2026-11-06" });
  assert.equal(a.status, "ok");
  assert.equal(a.price_type, "posted_price");
  assert.equal(a.price?.currency, "EUR");
  assert.match(a.summary, /reference ex-factory price/);
  assert.match(a.summary, /not market transactions/);
  assert.equal(a.extra, undefined);
  assert.equal((titckAnswerFromRow(row, { key: "abilify", today: "2026-11-20" }).extra as any).stale, true);
  assert.equal(titckAnswerFromRow({ ...row, n: 4 }, { key: "abilify", today: "2026-11-06" }).status, "insufficient_data");
});
