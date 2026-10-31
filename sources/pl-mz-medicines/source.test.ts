import { test } from "node:test";
import assert from "node:assert/strict";
import { readSheet, parsePacks, parsePrice, nameKey, substanceKey, plDailyRows, plAnswerFromRow, plKey, plHistoryKey, listPages, pickAnnexUrl } from "./source";
import { MINI_XLSX_BASE64 } from "./fixture";

// Real workbook rows from the live Ministry of Health list (84W, sheet A1), checked 31 Oct 2026 (see fixture.ts).
const xlsx = Buffer.from(MINI_XLSX_BASE64, "base64");

test("pl-mz-medicines reads the real xlsx layout (shared strings, decimal commas)", () => {
  const rows = readSheet(xlsx, "A1");
  assert.equal(rows[1][1], "Substancja czynna");
  const packs = parsePacks(rows);
  assert.equal(packs.length, 7);
  assert.equal(packs[0].substance, "Metformini hydrochloridum");
  assert.ok(packs.every((p) => p.price > 0 && /^\d{8,14}$/.test(p.gtin)));
  assert.equal(packs[packs.length - 1].name, "Adeksa, tabl., 100 mg");
  assert.equal(packs[packs.length - 1].price, 19.05);
  assert.throws(() => readSheet(xlsx, "Z9"), /no sheet/);
  assert.throws(() => parsePacks([["a", "b"], ["1", "2"]]), /new layout/);
});
test("pl-mz-medicines drops repeated GTINs and packs without a price", () => {
  const rows = readSheet(xlsx, "A1");
  const dup = [rows[0], rows[1], rows[2], rows[2], rows[3].map((c, i) => (i === 11 ? "" : c))];
  assert.equal(parsePacks(dup).length, 1);
});
test("pl-mz-medicines helpers", () => {
  assert.equal(parsePrice("1 234,50"), 1234.5);
  assert.equal(parsePrice("19,05"), 19.05);
  assert.equal(parsePrice(""), null);
  assert.equal(parsePrice("0,00"), null);
  assert.equal(nameKey("Adeksa, tabl., 100 mg"), "adeksa");
  assert.equal(nameKey("10 mg"), null);
  assert.equal(substanceKey("Metformini hydrochloridum"), "metformin");
  assert.equal(substanceKey("Atorvastatinum"), "atorvastatin");
  assert.equal(substanceKey("Acidum acetylsalicylicum"), "acetylsalicylic");
  assert.equal(substanceKey("Tramadoli hydrochloridum + Paracetamolum"), null);
});
test("pl-mz-medicines finds the newest list page and the annex workbook", () => {
  const html = ['<a href="/web/zdrowie/projekt-obwieszczenia-ministra-zdrowia-ktory-wejdzie-w-zycie-1-pazdziernika-2026-r">x</a>',
    '<a href="/web/zdrowie/projekt-obwieszczenia-ministra-zdrowia-ktory-wejdzie-w-zycie-1-lipca-2026-r">y</a>',
    '<a href="/web/zdrowie/projekt-obwieszczenia-ministra-zdrowia-ktory-wejdzie-w-zycie-1-stycznia-2027-r">future</a>',
    '<a href="/web/zdrowie/inna-strona">z</a>'].join("");
  const pages = listPages(html, new Date("2026-10-31T00:00:00Z"));
  assert.deepEqual(pages.map((p) => p.from), ["2026-10-01", "2026-07-01"]);
  assert.equal(listPages(html, new Date("2026-12-20T00:00:00Z"))[0].from, "2027-01-01");
  const page = '<a class="file-download" href="/attachment/815bb134-37f0-4fc1-947e-03478d2df840" target="_blank" download><span>84W projekt zalacznik do obwieszczenia</span><span>84W projekt zalacznik do obwieszczenia.xlsx</span></a>' +
    '<a href="/attachment/598b437e-f060-4759-be09-8936e9912de9" download>84W projekt zalacznik do obwieszczenia.pdf</a>';
  assert.equal(pickAnnexUrl(page), "https://www.gov.pl/attachment/815bb134-37f0-4fc1-947e-03478d2df840");
  assert.equal(pickAnnexUrl("<p>none</p>"), null);
});
test("pl-mz-medicines daily rows need 5 packs per key and count a pack once per key", () => {
  const rows = plDailyRows(parsePacks(readSheet(xlsx, "A1")));
  const m = rows.find((r) => r.item === "sub:metformin");
  assert.equal(m?.n, 6);
  assert.ok(m && m.min > 0 && m.max >= m.median && m.median >= m.min);
  assert.ok(!rows.some((r) => r.item === "sub:acarbos"), "one pack is below the 5-record floor");
  assert.ok(rows.every((r) => r.area === "ALL" && r.n >= 5));
});
test("pl-mz-medicines keys and answer", () => {
  assert.deepEqual(plKey("Metformin 500").names.map((n) => n.item), ["sub:metformin", "name:metformin"]);
  assert.equal(plKey("euthyrox").names[0].item, "sub:euthyrox");
  assert.throws(() => plKey(""));
  assert.equal(plHistoryKey({}), null);
  assert.equal(plHistoryKey({ medicine: "atorvastatin" })?.item, "sub:atorvastatin");
  const row = { date: "2026-10-31", area: "ALL", item: "sub:metformin", n: 105, median: 15.5, low: 8.4, high: 30.2, min: 6.1, max: 61 };
  const a = plAnswerFromRow(row, { key: "metformin", kind: "sub", today: "2026-10-31" });
  assert.equal(a.status, "ok");
  assert.equal(a.price_type, "posted_price");
  assert.equal(a.price?.currency, "PLN");
  assert.match(a.summary, /maximum retail price/);
  assert.match(a.summary, /not market transactions/);
  assert.doesNotMatch(a.summary, /paid|sold for/);
  assert.equal((plAnswerFromRow(row, { key: "metformin", kind: "sub", today: "2026-11-10" }).extra as any).stale, true);
  assert.equal(plAnswerFromRow({ ...row, n: 4 }, { key: "metformin", kind: "sub", today: "2026-10-31" }).status, "insufficient_data");
});
