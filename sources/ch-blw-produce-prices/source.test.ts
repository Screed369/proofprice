// Tests for the BLW Switzerland produce price source.
// Fixture rows are copied from the live LINDAS answer (SPARQL POST, CSV), checked 2026-11-04: vine tomatoes (product 1011) and their
// organic twin (1067), national; every price below is a real published value (the junk rows at the end are deliberate).
import { test } from "node:test";
import assert from "node:assert/strict";
import { InputError } from "../../lib/http";
import { INFO, ITEMS, buildQuery, chProduceAnswer, findRegion, parseCsv, parsePoints, shiftMonth } from "./source";
import { matchItem } from "../../categories/groceries/items";

const F = "https://agriculture.ld.admin.ch/foag/";
const M = "https://ld.admin.ch/time/month/";
const row = (p: string, m: string, v: number | string, u = 1) => `${F}product/${p},${M}${m},${v},${F}unit/${u}`;
const CSV = [
  "product,month,price,unit",
  row("1011", "2025-08", 3.53), row("1067", "2025-08", 8.94),
  row("1011", "2025-09", 3.67), row("1067", "2025-09", 8.79),
  row("1011", "2026-08", 4.05), row("1067", "2026-08", 7.37),
  row("1011", "2026-09", 4.58), row("1067", "2026-09", 8.25),
  row("1011", "2026-09", "bad"), // dropped
  row("9999", "2026-09", 1), // other product: dropped
  row("1011", "2026-09", 7, 2), // wrong unit: dropped
].join("\r\n");
const TOMATO = ITEMS.find((i) => i.code === "1011")!;
const TODAY = new Date("2026-11-04T10:00:00Z");

test("licence and type", () => {
  assert.match(INFO.licence, /Open use/);
  assert.equal(INFO.price_type, "posted_price");
});

test("CSV reader handles CRLF and quotes", () => {
  assert.deepEqual(parseCsv('a,b\r\n"x,1","y""z"\r\n'), [["a", "b"], ["x,1", 'y"z']]);
});

test("parse real rows, drop other products, bad numbers and other units", () => {
  const pts = parsePoints(CSV, TOMATO);
  assert.equal(pts.length, 8);
  assert.deepEqual(pts[0], { month: "2025-08", price: 3.53, organic: false });
  assert.equal(pts.filter((p) => p.organic).length, 4);
});

test("a changed layout is reported, not guessed", () => {
  assert.throws(() => parsePoints("a,b\n1,2\n", TOMATO), /unexpected layout/);
});

test("query asks one region, the product and its organic twin, from a start month", () => {
  const q = buildQuery(TOMATO, "L4-10006", "2025-07");
  assert.match(q, /sales-region\/L4-10006/);
  assert.match(q, /product\/1011> <[^>]*product\/1067>/);
  assert.match(q, /month\/2025-07/);
});

test("tomatoes: newest month, change on a year earlier, organic twin", () => {
  const a = chProduceAnswer(parsePoints(CSV, TOMATO), TOMATO, [], { item: "tomatoes", today: TODAY });
  assert.equal(a.status, "ok");
  assert.equal(a.price?.value, 4.58);
  assert.equal(a.price?.currency, "CHF");
  assert.equal(a.price?.unit, "per kg");
  assert.equal(a.price_type, "posted_price");
  assert.deepEqual(a.period, { from: "2026-09-01", to: "2026-09-30" });
  assert.equal((a.extra as any).change_on_year_earlier.value, 3.67);
  assert.equal((a.extra as any).change_on_year_earlier.change_percent, 24.8);
  assert.equal((a.extra as any).organic_price_same_month, 8.25);
  assert.match(a.summary, /September 2026/);
  assert.match(a.summary, /24\.8% higher/);
});

test("organic asked for: the organic figure is the headline", () => {
  const a = chProduceAnswer(parsePoints(CSV, TOMATO), TOMATO, [], { item: "organic tomatoes", organic: "true", today: TODAY });
  assert.equal(a.price?.value, 8.25);
  assert.match(a.summary, /organic/);
});

test("an item we do not carry says so and lists what we have (no invented price)", () => {
  const a = chProduceAnswer([], null, [], { item: "milk", today: TODAY });
  assert.equal(a.status, "no_matches");
  assert.match(a.summary, /no standard item for "milk"/);
});

test("old data is flagged", () => {
  const old = parsePoints(CSV, TOMATO).filter((p) => p.month <= "2025-09");
  const a = chProduceAnswer(old, TOMATO, [], { item: "tomatoes", today: TODAY });
  assert.match(a.statistic?.note ?? "", /Old data/);
});

test("regions", () => {
  assert.equal(findRegion(undefined).id, "1");
  assert.equal(findRegion("F-CH").id, "L4-10006");
  assert.equal(findRegion("Ticino").id, "L4-10007");
  assert.throws(() => findRegion("Mars"), InputError);
});

test("everyday words find the right item; the default tomato and potato are the common ones", () => {
  assert.equal(matchItem(ITEMS, "tomatoes").primary?.code, "1011");
  assert.equal(matchItem(ITEMS, "Potatoes").primary?.code, "1273");
  assert.equal(matchItem(ITEMS, "apples").primary?.code, "1061");
  assert.equal(matchItem(ITEMS, "courgette").primary?.code, "1015");
  assert.equal(matchItem(ITEMS, "bread").primary, null);
  assert.ok(matchItem(ITEMS, "tomatoes").related.length >= 1);
});

test("month arithmetic", () => {
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(shiftMonth("2026-09", -12), "2025-09");
});
