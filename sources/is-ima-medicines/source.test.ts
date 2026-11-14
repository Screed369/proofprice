import { test } from "node:test";
import assert from "node:assert/strict";
import { readXls } from "./xls";
import { parsePacks, parsePrice, parseDay, nameKey, substanceKey, isDailyRows, isAnswerFromRow, isKey, isHistoryKey, listFiles } from "./source";
import { MINI_XLS_BASE64 } from "./fixture";

// Real rows of the live IMA price list (lyfjaverdskra-20261001, sheet Lyfjaskra), checked 14 Nov 2026 (see fixture.ts).
const sheet = readXls(Buffer.from(MINI_XLS_BASE64, "base64"))[0];

test("is-ima-medicines reads the real .xls layout (BIFF8, text cells)", () => {
  assert.equal(sheet.name, "Lyfjaskrá");
  assert.equal(sheet.rows[0][2], "Heiti lyfs");
  assert.equal(sheet.rows[0][27], "Hámarks smásöluverð");
  const packs = parsePacks(sheet.rows, "2026-11-14");
  assert.equal(packs.length, 12, "6 metformin + 5 atorvastatin + the combination; vet, OTC without price and deregistered packs dropped");
  assert.equal(packs[0].name, "Glucophage");
  assert.equal(packs[0].price, 1868);
  assert.throws(() => parsePacks([["a", "b"], ["1", "2"]]), /new layout/);
});
test("is-ima-medicines drops repeated pack codes", () => {
  const dup = [sheet.rows[0], sheet.rows[1], sheet.rows[1]];
  assert.equal(parsePacks(dup, "2026-11-14").length, 1);
});
test("is-ima-medicines keeps a deregistered pack only before its end date", () => {
  assert.equal(parsePacks(sheet.rows, "2026-08-01").length, 13);
});
test("is-ima-medicines helpers", () => {
  assert.equal(parsePrice("2.106"), 2106);
  assert.equal(parsePrice("1.076,93"), 1076.93);
  assert.equal(parsePrice("374,82"), 374.82);
  assert.equal(parsePrice(""), null);
  assert.equal(parsePrice("0"), null);
  assert.equal(parsePrice("lyflausa"), null);
  assert.equal(parseDay("30.9.2026"), "2026-09-30");
  assert.equal(parseDay(""), null);
  assert.equal(nameKey("Metformin Bluefish"), "metformin");
  assert.equal(nameKey("10 mg"), null);
  assert.equal(substanceKey("Atorvastatín"), "atorvastatin");
  assert.equal(substanceKey("Metformín"), "metformin");
  assert.equal(substanceKey("Lósartan og þvagræsilyf"), null);
  assert.equal(substanceKey("Sítagliptín/Metformín"), null);
});
test("is-ima-medicines finds the price list files on the island.is page", () => {
  const html =
    '<a href="https://assets.ctfassets.net/8k0h54kbe6bj/1RX2ssNU8rgM5gBZDvDB1a/f20e3d206492200062bacbad62742a2e/lyfjaverdskra-20261001-2__1_.xls">list</a>' +
    '<a href="https://assets.ctfassets.net/8k0h54kbe6bj/35DdEMRB5VqB1wv5DErQj/60be06589730196e20b29761bd7935ab/helstu-breytingar-20261001-1.xls">changes</a>' +
    '<a href="https://assets.ctfassets.net/8k0h54kbe6bj/aaa/bbb/lyfjaverdskra-20260901.xls">older</a>';
  const f = listFiles(html);
  assert.deepEqual(f.map((x) => x.from), ["2026-10-01", "2026-09-01"]);
  assert.ok(f[0].url.endsWith("lyfjaverdskra-20261001-2__1_.xls"));
  assert.deepEqual(listFiles("<p>none</p>"), []);
});
test("is-ima-medicines daily rows need 5 packs per key and count a pack once per key", () => {
  const rows = isDailyRows(parsePacks(sheet.rows, "2026-11-14"));
  const m = rows.find((r) => r.item === "sub:metformin");
  assert.equal(m?.n, 6);
  assert.ok(m && m.min === 1868 && m.max === 2393 && m.median >= m.min && m.median <= m.max);
  assert.equal(rows.find((r) => r.item === "sub:atorvastatin")?.n, 5);
  assert.ok(!rows.some((r) => r.item === "sub:losartan"), "a combination has no substance key");
  assert.ok(rows.every((r) => r.area === "ALL" && r.n >= 5));
});
test("is-ima-medicines keys and answer", () => {
  assert.deepEqual(isKey("Metformin 500").names.map((n) => n.item), ["sub:metformin", "name:metformin"]);
  assert.equal(isKey("acetaminophen").names[0].item, "sub:paracetamol");
  assert.throws(() => isKey(""));
  assert.equal(isHistoryKey({}), null);
  assert.equal(isHistoryKey({ medicine: "atorvastatin" })?.item, "sub:atorvastatin");
  const row = { date: "2026-11-14", area: "ALL", item: "sub:atorvastatin", n: 21, median: 3200, low: 2400, high: 9000, min: 2300, max: 21171 };
  const a = isAnswerFromRow(row, { key: "atorvastatin", kind: "sub", today: "2026-11-14" });
  assert.equal(a.status, "ok");
  assert.equal(a.price_type, "posted_price");
  assert.equal(a.price?.currency, "ISK");
  assert.match(a.summary, /maximum retail price/);
  assert.match(a.summary, /not market transactions/);
  assert.doesNotMatch(a.summary, /paid|sold for/);
  assert.equal((isAnswerFromRow(row, { key: "atorvastatin", kind: "sub", today: "2026-12-30" }).extra as any).stale, true);
  assert.equal(isAnswerFromRow({ ...row, n: 4 }, { key: "atorvastatin", kind: "sub", today: "2026-11-14" }).status, "insufficient_data");
});
