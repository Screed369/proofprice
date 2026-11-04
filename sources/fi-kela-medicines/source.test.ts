import { test } from "node:test";
import assert from "node:assert/strict";
import { parseKelaRows, kelaDailyRows, kelaAnswerFromRow, kelaKey, kelaHistoryKey, nameKey, parseFiPrice, candidateFiles, KelaPack } from "./source";

// Real first rows of the Kela sheet "Hinnat ja hintaputket 1.10.2026" (vaihtokelpoiset-laakkeet-01102026.xlsx), read 4 Nov 2026 through readXlsx.
const ROWS = [
  ["Luettelo Kansaneläkelaitokselle ilmoitetuista keskenään vaihtokelpoisten lääkevalmisteiden hinnoista 1.10.2026–31.12.2026"],
  ["Hintaputkeen kuuluvat pakkaukset on merkitty tähdellä (*)"],
  ["Julkaistu 23.9.2026, päivitetty 24.9.2026"],
  ["Substituutio-koodi", "Vnr", "Myyntihinta (sis. alv)", "*", "Hintaputken yläraja", "Viitehinta", "Lääkenimi", "Vahvuus", "Pakkauskoko", "Lääkemuoto", "Haltija", "Lääkeaine"],
  ["0000110056", "508702", "52,52", "*", "53,02", "53,02", "Losec MUPS", "20 mg", "56", "enterotabletti", "Paranova Oy", "omepratsoli"],
  ["0000110056", "016220", "53,02", "*", "53,02", "53,02", "Losec MUPS", "20 mg", "56", "enterotabletti", "Cheplapharm Arzneimittel GmbH", "omepratsoli"],
  ["0000110100", "395341", "90,35", null, "91,35", null, "Losec MUPS", "20 mg", "100 (2 x 50)", "enterotabletti", "Orifarm Oy", "omepratsoli"],
  ["0000110100", "016428", "90,85", "*", "91,35", null, "Losec MUPS", "20 mg", "100 (2 x 50)", "enterotabletti", "Cheplapharm Arzneimittel GmbH", "omepratsoli"],
  ["0000120014", "189691", "10,48", "*", "10,98", null, "Zolt", "15 mg", "14", "enterokapseli, kova", "Orion Corporation", "lansopratsoli"],
  [], [],
] as any[][];

test("fi-kela parses the live layout", () => {
  const l = parseKelaRows(ROWS);
  assert.deepEqual(l.period, { from: "2026-10-01", to: "2026-12-31" });
  assert.equal(l.published, "2026-09-23");
  assert.equal(l.packs.length, 5);
  assert.deepEqual(l.packs[0], { vnr: "508702", substance: "omepratsoli", brand: "Losec MUPS", price: 52.52 });
  assert.equal(l.packs[4].price, 10.48);
});
test("fi-kela rejects a changed layout and skips duplicate or unpriced packs", () => {
  assert.throws(() => parseKelaRows([["x"], ["y"]]), /header row/);
  const dup = [...ROWS.slice(0, 5), ROWS[4], ["0", "999", "n/a", null, null, null, "X", "", "", "", "", "foo"]] as any[][];
  assert.equal(parseKelaRows(dup).packs.length, 1);
});
test("fi-kela price and name helpers", () => {
  assert.equal(parseFiPrice("1 052,50"), 1052.5);
  assert.equal(parseFiPrice("0,00"), null);
  assert.equal(parseFiPrice(null), null);
  assert.equal(parseFiPrice(12.5), 12.5);
  assert.equal(nameKey("Äänekoski lääke"), "aanekoski");
  assert.equal(nameKey("10 mg"), null);
  assert.equal(kelaKey("Paracetamol").item, "name:parasetamoli");
  assert.equal(kelaKey("parasetamoli").item, "name:parasetamoli");
  assert.equal(kelaKey("Burana 400").item, "name:burana");
  assert.throws(() => kelaKey(""));
  assert.equal(kelaHistoryKey({}), null);
  assert.equal(kelaHistoryKey({ medicine: "ibuprofen" })?.item, "name:ibuprofeeni");
});
test("fi-kela file names are the four quarter starts, newest first", () => {
  assert.deepEqual(candidateFiles("2026-11-04", 4), ["01102026", "01072026", "01042026", "01012026"]);
  assert.deepEqual(candidateFiles("2026-02-10", 3), ["01012026", "01102025", "01072025"]);
});
test("fi-kela daily rows need 5 packs per name and count a pack once per key", () => {
  const five: KelaPack[] = Array.from({ length: 5 }, (_, i) => ({ vnr: "V" + i, substance: "foo", brand: "Foo", price: 2 + i }));
  const r = kelaDailyRows(five);
  assert.equal(r.length, 1);
  assert.equal(r[0].n, 5);
  assert.equal(r[0].area, "ALL");
  assert.equal(kelaDailyRows(five.slice(0, 4)).length, 0);
  assert.equal(kelaDailyRows(parseKelaRows(ROWS).packs).length, 0); // only 3 omepratsoli-or-Losec packs: hidden
});
test("fi-kela answer is a posted price, never 'paid'", () => {
  const row = { date: "2026-11-04", area: "ALL", item: "name:parasetamoli", n: 40, median: 4.8, low: 2.5, high: 9.9, min: 1.9, max: 14 };
  const a = kelaAnswerFromRow(row, { key: "parasetamoli", today: "2026-11-04" });
  assert.equal(a.status, "ok");
  assert.equal(a.price_type, "posted_price");
  assert.equal(a.price?.currency, "EUR");
  assert.match(a.summary, /notified sales price/);
  assert.match(a.summary, /not market transactions/);
  assert.doesNotMatch(a.summary, /sold for/);
  assert.equal(a.extra, undefined);
  assert.equal((kelaAnswerFromRow(row, { key: "parasetamoli", today: "2026-11-20" }).extra as any).stale, true);
  assert.equal(kelaAnswerFromRow({ ...row, n: 4 }, { key: "parasetamoli", today: "2026-11-04" }).status, "insufficient_data");
});
