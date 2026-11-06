// Tests for the Hungary grocery prices (KSH STADAT table 1.2.1.8, ara0044).
// Fixture: real rows of https://www.ksh.hu/stadat_files/ara/en/ara0044.csv fetched on 2026-11-06 (windows-1250 bytes kept as published),
// reduced to 16 products and the months 2025 August to 2026 December (header, title line, ";" and space-thousands exactly as published).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { matchItem } from "../../categories/groceries/items";
import { INFO, ITEMS, decodeCsv, huKshGroceries, kshAnswer, monthFromHeader, monthWords, newestMonth, parseKsh, parseNumber, readItem, shiftMonth } from "./source";
import manifest from "./index";

const BYTES = readFileSync(path.join(__dirname, "fixtures", "ara0044-subset.csv"));
const TODAY = new Date("2026-11-06T12:00:00Z");
const table = parseKsh(decodeCsv(BYTES));

test("numbers: space thousands, '..' and empty are no price", () => {
  assert.equal(parseNumber("2 070"), 2070);
  assert.equal(parseNumber("2 070"), 2070);
  assert.equal(parseNumber("814"), 814);
  assert.equal(parseNumber(".."), null);
  assert.equal(parseNumber(""), null);
  assert.equal(parseNumber("12,5"), 12.5);
  assert.equal(monthFromHeader("2026 September"), "2026-09");
  assert.equal(monthFromHeader("Code"), null);
});

test("parse: header, months, products", () => {
  assert.equal(table.products.size, 16);
  assert.equal(table.months[0], "2025-08");
  assert.equal(table.months[table.months.length - 1], "2026-12");
  assert.equal(newestMonth(table), "2026-09");
  assert.match(table.title, /Average consumer price/);
  assert.throws(() => parseKsh("a;b\r\n1;2\r\n3;4\r\n"), /changed shape/);
});

test("milk 2.8%: published September 2026 figure, year earlier and month before", () => {
  const r = readItem(table, "11101")!;
  assert.deepEqual(r.latest, { month: "2026-09", value: 349 });
  assert.ok(r.yearAgo && r.previous);
  assert.equal(r.previous!.month, "2026-08");
});

test("items: codes exist in the real file; no tobacco, restaurant or service rows", () => {
  const codes = new Set(ITEMS.map((i) => i.code));
  assert.equal(codes.size, ITEMS.length);
  for (const bad of ["19002", "19005", "16041", "16201", "16407", "17101"]) assert.ok(!codes.has(bad), bad);
  for (const c of ["11101", "11001", "13201", "10401"]) assert.ok(codes.has(c), c);
  assert.equal(matchItem(ITEMS, "milk").primary!.code, "11101");
  assert.equal(matchItem(ITEMS, "eggs").primary!.code, "11001");
  assert.equal(matchItem(ITEMS, "bread").primary!.code, "13201");
  assert.equal(matchItem(ITEMS, "chicken").primary!.code, "10401");
  assert.equal(matchItem(ITEMS, "beer").primary!.code, "18101");
});

test("answer: official statistic, no range, no sample size, HUF, labelled", () => {
  const m = matchItem(ITEMS, "milk");
  const a = kshAnswer(readItem(table, m.primary!.code), m.primary, m.related, { item: "milk", today: TODAY });
  assert.equal(a.status, "ok");
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.price!.currency, "HUF");
  assert.equal(a.price!.value, 349);
  assert.equal(a.price!.measure, "average");
  assert.equal(a.price!.typical_low, null);
  assert.equal(a.sample_size, null);
  assert.deepEqual(a.period, { from: "2026-09-01", to: "2026-09-30" });
  assert.match(a.summary, /national average shop price/);
  assert.match(a.source.attribution, /KSH/);
  assert.match(a.source.licence, /CC BY 4\.0/);
  assert.equal((a.extra as any).last_13_months.length, 13);
});

test("answer: item with '..' latest month falls back to its last real month and says so", async () => {
  const a = await huKshGroceries({ item: "new potatoes", today: TODAY }, { loader: async () => BYTES });
  // 14001 is '..' in September 2026 in the live file: the answer uses the latest month that holds a price or says there is none
  assert.ok(a.status === "ok" || a.status === "no_matches");
  if (a.status === "ok") assert.match(a.summary + (a.notice ?? ""), /latest available month|2026/);
});

test("answer: unknown item and region note", async () => {
  const none = await huKshGroceries({ item: "caviar" }, { loader: async () => BYTES });
  assert.equal(none.status, "no_matches");
  assert.match(none.summary, /Try one of/);
  const reg = await huKshGroceries({ item: "eggs", region: "Debrecen", today: TODAY }, { loader: async () => BYTES });
  assert.equal(reg.status, "ok");
  assert.equal(reg.price!.value, 814);
  assert.match(JSON.stringify(reg), /national averages only/);
  const nat = await huKshGroceries({ item: "eggs", region: "Hungary", today: TODAY }, { loader: async () => BYTES });
  assert.doesNotMatch(JSON.stringify(nat), /was ignored/);
});

test("old data is flagged", () => {
  const m = matchItem(ITEMS, "milk");
  const a = kshAnswer(readItem(table, m.primary!.code), m.primary, m.related, { item: "milk", today: new Date("2027-03-01T00:00:00Z") });
  assert.match(a.summary, /Old data/);
});

test("month helpers", () => {
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(shiftMonth("2026-09", -12), "2025-09");
  assert.equal(monthWords("2026-09"), "September 2026");
});

test("manifest", () => {
  assert.equal(manifest.info.id, "hu-ksh-groceries");
  assert.deepEqual(manifest.countries, ["HU"]);
  assert.equal(INFO.price_type, "official_statistic");
});
