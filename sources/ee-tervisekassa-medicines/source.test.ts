import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEeRows, eeDailyRows, eeAnswerFromRow, eeKey, eeHistoryKey, nameKey, parseEePrice, pickFiles, EePack } from "./source";

// Real first rows of sheet HINNATABEL in ulevaatlik_tabel_veeb_01.11.2026.xlsx (tervisekassa.ee), read 6 Nov 2026 through openpyxl; only the columns used are shown in full.
const HEAD = ["Ravimikood/Pharmaceutical's code", "ATC-kood/code", "Toimeaine/Active substance", "Ravim/Pharmaceutical", "Ravimvorm", "Ravimi tugevus", "Kogus pakendis", "Müügiloa hoidja/Marketing Authorisation Holder", "50% soodustus/reimbursement", "Soodustuse tingimused/Reimbursement conditions", "75% soodustus/reimbursement", "Soodustuse tingimused/Reimbursement Conditions.1", "100% soodustus/reimbursement", "Soodustuse tingimused/Reimbursement conditions.2", "Keskmine päevaannus/Defined Daily Dose", "Keskmise päevaannuse hind/Retail price of defined daily dose, EUR", "Pakendi piirhind/Reference price for package, EUR", "Pakendi hind hinnakokkuleppe järgi/Retail price according to price agreement, EUR", "Hinnakokkuleppe kehtivus alates/Valid from", "Hinnakokkuleppe kehtivus kuni/Valid to"];
const ROWS = [
  HEAD,
  ["1024579", "A01AB09", "mikonasool", "DAKTARIN", "suukaudne geel", "20mg 1g 40g", "1TK", "McNeil Healthcare (Ireland) Limited", "50%", null, null, null, null, null, null, null, 8.92, null, null, null],
  ["1828379", "A01AB09", "mikonasool", "DAKTARIN", "suukaudne geel", "20mg 1g 40g", "1TK", "Lex Ano UAB", "50%", null, null, null, null, null, "200 mg", 2.23, 8.92, 8.89, "01.07.2021", "01.07.2027"],
  ["1891379", "A01AB09", "mikonasool", "DAKTARIN", "suukaudne geel", "20mg 1g 40g", "1TK", "Ideal Trade Links UAB", "50%", null, null, null, null, null, "200 mg", 2.23, 8.92, 8, "01.07.2023", "01.07.2027"],
  ["1062166", "A02BC01", "omeprasool", "OMEPRAZOLE-RATIOPHARM", "gastroresistentne kõvakapsel", "20mg", "30TK", "Ratiopharm GmbH", "50%", null, null, null, null, null, null, null, 3, 5.38, "01.01.2025", "01.01.2027"],
  ["1820719", "A10BH01", "sitagliptiin", "JAZETA", "õhukese polümeerikattega tablett", "50mg", "28TK", "Zentiva k.s.", "50%", null, "75%", "RV E11-E11,E14-E14", null, null, null, null, 7, null, null, null],
  ["1563555", "A10BG03", "pioglitasoon", "PIOGLITAZONE ACCORD", "tablett", "30mg", "28TK", "Accord Healthcare S.L.U.", "50%", null, "75%", "RV E11", null, null, null, null, 21.56, 25.87, "01.10.2018", "01.10.2027"],
  ["9999999", "A10BA02", "metformiin+sitagliptiin", "JANUMET", "tablett", "50/850", "56TK", "X", "50%", null, null, null, null, null, null, null, null, null, null, null],
] as any[][];

test("ee-tervisekassa parses the live layout and skips packs without a reference price", () => {
  const l = parseEeRows(ROWS);
  assert.equal(l.total, 7);
  assert.equal(l.packs.length, 6);
  assert.deepEqual(l.packs[0], { code: "1024579", substance: "mikonasool", brand: "DAKTARIN", price: 8.92 });
  assert.equal(l.packs[3].price, 3);
  assert.equal(l.packs.find((p) => p.code === "9999999"), undefined);
});
test("ee-tervisekassa rejects a changed layout and skips duplicate codes", () => {
  assert.throws(() => parseEeRows([["x"], ["y"]]), /header row/);
  assert.throws(() => parseEeRows([["Ravimikood", "ATC", "Toimeaine", "Ravim"], ["1", "a", "b", "c"]]), /Pakendi piirhind/);
  assert.equal(parseEeRows([...ROWS, ROWS[1]]).packs.length, 6);
});
test("ee-tervisekassa price and name helpers", () => {
  assert.equal(parseEePrice(8.92), 8.92);
  assert.equal(parseEePrice("8,92"), 8.92);
  assert.equal(parseEePrice(null), null);
  assert.equal(parseEePrice(0), null);
  assert.equal(nameKey("Östradiool"), "ostradiool");
  assert.equal(nameKey("10 mg"), null);
  assert.equal(eeKey("Omeprazole").item, "name:omeprasool");
  assert.equal(eeKey("omeprasool").item, "name:omeprasool");
  assert.equal(eeKey("Daktarin 20mg").item, "name:daktarin");
  assert.throws(() => eeKey(""));
  assert.equal(eeHistoryKey({}), null);
  assert.equal(eeHistoryKey({ medicine: "metformin" })?.item, "name:metformiin");
});
test("ee-tervisekassa picks the newest edition link that is not in the future", () => {
  const html = `<a href="/sites/default/files/ulevaatlik_tabel_veeb_01.10.2026_1.xlsx">a</a> <a href="/sites/default/files/ulevaatlik_tabel_veeb_01.11.2026.xlsx">b</a> <a href="/sites/default/files/ulevaatlik_tabel_veeb_01.01.2027.xlsx">c</a><a href="/x.pdf">p</a>`;
  const f = pickFiles(html, "2026-11-06");
  assert.deepEqual(f.map((x) => x.date), ["2026-11-01", "2026-10-01"]);
  assert.equal(pickFiles(html, "2026-01-01")[0].date, "2027-01-01");
  assert.equal(pickFiles("<p>none</p>").length, 0);
});
test("ee-tervisekassa daily rows need 5 packs per name, count a pack once per key and skip combination substances", () => {
  const five: EePack[] = Array.from({ length: 5 }, (_, i) => ({ code: "C" + i, substance: "foo", brand: "Foo", price: 2 + i }));
  const r = eeDailyRows(five);
  assert.equal(r.length, 1);
  assert.equal(r[0].n, 5);
  assert.equal(r[0].area, "ALL");
  assert.equal(eeDailyRows(five.slice(0, 4)).length, 0);
  const combo = five.map((p) => ({ ...p, substance: "foo+bar", brand: "Combo" }));
  assert.deepEqual(eeDailyRows(combo).map((x) => x.item), ["name:combo"]);
  assert.equal(eeDailyRows(parseEeRows(ROWS).packs).length, 0); // only 3 daktarin packs: hidden
});
test("ee-tervisekassa answer is a posted reference price, never 'paid'", () => {
  const row = { date: "2026-11-06", area: "ALL", item: "name:omeprasool", n: 13, median: 6.1, low: 3, high: 14.2, min: 2.5, max: 20 };
  const a = eeAnswerFromRow(row, { key: "omeprasool", today: "2026-11-06" });
  assert.equal(a.status, "ok");
  assert.equal(a.price_type, "posted_price");
  assert.equal(a.price?.currency, "EUR");
  assert.match(a.summary, /reference price/);
  assert.match(a.summary, /not market transactions/);
  assert.doesNotMatch(a.summary, /sold for/);
  assert.equal(a.extra, undefined);
  assert.equal((eeAnswerFromRow(row, { key: "omeprasool", today: "2026-11-20" }).extra as any).stale, true);
  assert.equal(eeAnswerFromRow({ ...row, n: 4 }, { key: "omeprasool", today: "2026-11-06" }).status, "insufficient_data");
});
