import { test } from "node:test";
import assert from "node:assert/strict";
import { parseList, parsePrice, nameKey, atcKey, czDailyRows, czAnswerFromRow, czKey, czHistoryKey, listPageUrls, pickScauUrl, fileDate } from "./source";
import { FIXTURE_LINES } from "./fixture";

// Real rows from the live SUKL list SCAU261001v21.txt, checked 30 Oct 2026 (see fixture.ts).
const text = FIXTURE_LINES.join("\r\n") + "\r\n";

test("cz-sukl-medicines parses the live 122-column layout with decimal commas", () => {
  const packs = parseList(text);
  assert.equal(packs.length, 7);
  assert.deepEqual(packs[0], { kod: "0094156", name: "ABAKTAL", atc: "J01MA03", price: 162.82, tcr: "MCV" });
  assert.equal(packs[1].price, 217.88);
  assert.throws(() => parseList("a|b|c\r\nd|e|f\r\n"), /new layout/);
  assert.deepEqual(parseList(""), []);
});
test("cz-sukl-medicines drops lines without a price and repeated codes", () => {
  const noPrice = FIXTURE_LINES[1].split("|"); noPrice[85] = ""; 
  const packs = parseList([FIXTURE_LINES[0], noPrice.join("|"), FIXTURE_LINES[0]].join("\n"));
  assert.equal(packs.length, 1);
});
test("cz-sukl-medicines helpers", () => {
  assert.equal(parsePrice("106,11"), 106.11);
  assert.equal(parsePrice("1 234,50"), 1234.5);
  assert.equal(parsePrice(""), null);
  assert.equal(parsePrice("0,00"), null);
  assert.equal(nameKey("ABAKTAL"), "abaktal");
  assert.equal(nameKey("Přípravek léčivý 5 mg"), "pripravek");
  assert.equal(nameKey("10 mg"), null);
  assert.equal(atcKey("a10ba02"), "A10BA02");
  assert.equal(atcKey("C10AA"), "C10AA");
  assert.equal(atcKey("N02B"), "N02B");
  assert.equal(atcKey("metformin"), null);
  assert.equal(atcKey("N02"), null);
  assert.equal(fileDate("https://sukl.gov.cz/wp-content/uploads/2026/09/SCAU261001v21.txt"), "2026-10-01");
});
test("cz-sukl-medicines finds the newest monthly page and file link", () => {
  assert.deepEqual(listPageUrls(new Date("2026-10-30T12:00:00Z"), 3), [
    "https://sukl.gov.cz/ceny-a-uhrady-leciv/seznam-cen-a-uhrad-lp/seznam-cen-a-uhrad-lp-k-1-10-2026/",
    "https://sukl.gov.cz/ceny-a-uhrady-leciv/seznam-cen-a-uhrad-lp/seznam-cen-a-uhrad-lp-k-1-9-2026/",
    "https://sukl.gov.cz/ceny-a-uhrady-leciv/seznam-cen-a-uhrad-lp/seznam-cen-a-uhrad-lp-k-1-8-2026/",
  ]);
  assert.equal(listPageUrls(new Date("2027-01-05T00:00:00Z"), 2)[1].endsWith("-k-1-12-2026/"), true);
  const html = '<a href="https://sukl.gov.cz/wp-content/uploads/2026/09/SCAU261001v21.zip">z</a><a href="https://sukl.gov.cz/wp-content/uploads/2026/09/SCAU261001v21.txt">t</a><a href="https://sukl.gov.cz/wp-content/uploads/2026/09/SCUP261001v21.txt">u</a>';
  assert.equal(pickScauUrl(html), "https://sukl.gov.cz/wp-content/uploads/2026/09/SCAU261001v21.txt");
  assert.equal(pickScauUrl("<p>nothing</p>"), null);
});
test("cz-sukl-medicines daily rows need 5 packs per key and count a pack once per key", () => {
  const rows = czDailyRows(parseList(text));
  const m = rows.find((r) => r.item === "atc:A10BA02");
  assert.equal(m?.n, 6);
  assert.ok(m && m.median > 94.95 && m.median < 207.91, `median ${m?.median}`);
  assert.equal(m?.min, 75.98);
  assert.equal(m?.max, 410);
  assert.ok(rows.some((r) => r.item === "atc:A10BA" && r.n === 6) && rows.some((r) => r.item === "atc:A10B"));
  assert.ok(rows.some((r) => r.item === "name:metformin" && r.n === 6));
  assert.ok(!rows.some((r) => r.item === "name:abaktal"), "one pack is below the 5-record floor");
  assert.ok(rows.every((r) => r.area === "ALL" && r.n >= 5));
});
test("cz-sukl-medicines keys and answer", () => {
  assert.equal(czKey("Metformin 500").item, "name:metformin");
  assert.equal(czKey("c10aa05").item, "atc:C10AA05");
  assert.throws(() => czKey(""));
  assert.equal(czHistoryKey({}), null);
  assert.equal(czHistoryKey({ medicine: "metformin" })?.item, "name:metformin");
  const row = { date: "2026-10-30", area: "ALL", item: "name:metformin", n: 44, median: 166, low: 66.437, high: 296, min: 45.02, max: 410 };
  const a = czAnswerFromRow(row, { key: "metformin", kind: "name", today: "2026-10-30" });
  assert.equal(a.status, "ok");
  assert.equal(a.price_type, "posted_price");
  assert.equal(a.price?.median, 166);
  assert.equal(a.price?.currency, "CZK");
  assert.match(a.summary, /maximum consumer price/);
  assert.match(a.summary, /not market transactions/);
  assert.doesNotMatch(a.summary, /paid|sold for/);
  assert.equal((czAnswerFromRow(row, { key: "metformin", kind: "name", today: "2026-11-10" }).extra as any).stale, true);
  assert.equal(czAnswerFromRow({ ...row, n: 4 }, { key: "metformin", kind: "name", today: "2026-10-30" }).status, "insufficient_data");
});
