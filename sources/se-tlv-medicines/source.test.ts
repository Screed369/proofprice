import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSharedStrings } from "../../categories/rent/xlsx";
import { parseSheetRows, parsePacks, nameKey, seDailyRows, seAnswerFromRow, candidateKeys, seHistoryKey, monthFileUrl, latestFileFromListing, fallbackUrls, SvPack } from "./source";
import { SHEET_XML, SHARED_XML } from "./fixture";

// Real start of periodens-vara-oktober-20261001.xlsx, downloaded 30 Oct 2026 (see fixture.ts).
const rows = parseSheetRows(SHEET_XML, parseSharedStrings(SHARED_XML));

test("se-tlv reads the prefixed (x:) sheet XML and the header", () => {
  assert.equal(rows[0][1], "Produktnamn");
  assert.equal(rows[0][9], "Försäljningspris");
  assert.equal(rows[1][0], "PV");
  assert.equal(rows[1][2], "139985"); // Varunummer stays text (leading zeros matter)
  assert.equal(rows[1][8], 20.85);
});
test("se-tlv turns rows into priced packs by header name", () => {
  const packs = parsePacks(rows);
  assert.equal(packs.length, rows.length - 1);
  assert.deepEqual(packs[0], { id: "139985", substance: "Abakavir + lamivudin", product: "Abacavir/Lamivudine Medical Valley", status: "PV", origin: "Generics", size: 30, price: 76.04 });
  assert.ok(packs.every((p) => p.price > 0));
  assert.throws(() => parsePacks([["a", "b"]]), /format changed/);
});
test("se-tlv keys, translation and urls", () => {
  assert.equal(nameKey("Kvetiapin"), "kvetiapin");
  assert.equal(nameKey("Alvedon®"), "alvedon");
  assert.equal(nameKey("10 mg"), null);
  assert.deepEqual(candidateKeys("Quetiapine 25 mg"), ["kvetiapin", "quetiapine", "quetiapin"]);
  assert.deepEqual(candidateKeys("paracetamol"), ["paracetamol"]);
  assert.throws(() => candidateKeys(""));
  assert.equal(seHistoryKey({ medicine: "oxycodone" })?.item, "name:oxikodon");
  assert.equal(seHistoryKey({}), null);
  assert.equal(monthFileUrl(2026, 10), "https://www.tlv.se/webdav/files/Periodens-vara/periodens-vara-oktober-20261001.xlsx");
  assert.deepEqual(fallbackUrls("2026-01-15").map((u) => u.split("/").pop()), ["periodens-vara-januari-20260101.xlsx", "periodens-vara-december-20251201.xlsx", "periodens-vara-november-20251101.xlsx"]);
  const html = `<a href="/webdav/files/Periodens-vara/periodens-vara-oktober-20261001.xlsx">a</a><a href="/webdav/files/Periodens-vara/periodens-vara-november-20261101.xlsx">b</a>`;
  assert.equal(latestFileFromListing(html), "https://www.tlv.se/webdav/files/Periodens-vara/periodens-vara-november-20261101.xlsx");
  assert.equal(latestFileFromListing("nothing"), null);
});
test("se-tlv daily rows need 5 packs per name and count a pack once per key", () => {
  const packs = parsePacks(rows);
  const out = seDailyRows(packs);
  assert.ok(out.every((r) => r.area === "ALL" && r.n >= 5));
  const para = out.find((r) => r.item === "name:paracetamol");
  assert.ok(para && para.n === 6, "six paracetamol packs in the fixture");
  const dup: SvPack[] = Array.from({ length: 5 }, (_, i) => ({ id: "N" + i, substance: "Foo", product: "Foo", status: "Nej", origin: "Generics", size: 10, price: 10 + i }));
  assert.equal(seDailyRows(dup)[0].n, 5);
  assert.equal(seDailyRows(dup.slice(0, 4)).length, 0);
});
test("se-tlv answer is a posted price, never 'paid'", () => {
  const row = { date: "2026-10-30", area: "ALL", item: "name:paracetamol", n: 40, median: 80, low: 40, high: 140, min: 30, max: 160 };
  const a = seAnswerFromRow(row, { key: "paracetamol", today: "2026-10-30" });
  assert.equal(a.status, "ok");
  assert.equal(a.price_type, "posted_price");
  assert.equal(a.price?.currency, "SEK");
  assert.equal(a.price?.median, 80);
  assert.match(a.summary, /not market transactions/);
  assert.doesNotMatch(a.summary, /sold for/);
  assert.equal(a.extra, undefined);
  assert.equal((seAnswerFromRow(row, { key: "paracetamol", today: "2026-11-15" }).extra as any).stale, true);
  assert.equal(seAnswerFromRow({ ...row, n: 4 }, { key: "paracetamol", today: "2026-10-30" }).status, "insufficient_data");
});
