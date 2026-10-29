// Tests for the South Africa grocery prices (Stats SA CPI average prices, publication P0141).
// Fixture: the REAL September 2026 file "CPI Average Prices All urban (202609).zip" (172 KB, one .xlsx), downloaded from GitHub's servers on 2026-10-29.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { matchItem } from "../../categories/groceries/items";
import { NO_COUNT } from "../../lib/stats";
import { INFO, ITEMS, candidateUrls, change, harvestFromSeries, itemKey, monthWords, newestMonth, packUnit, parseRows, parseZip, shiftMonth, snapshotFromRows, zaAnswer, zaGroceryPrices, zaHarvest, zaHistoryKey } from "./source";
import manifest from "./index";

const ZIP = readFileSync(path.join(__dirname, "fixtures", "CPI-Average-Prices-All-urban-202609.zip"));
const TODAY = new Date("2026-10-29T12:00:00Z");
const series = parseZip(ZIP);
const harvest = harvestFromSeries(series);
const snap = () => snapshotFromRows(harvest.date, harvest.rows.map((r) => ({ ...r, date: harvest.date })));
const MILK = itemKey("01141101", "1 Litre");

test("keys and units", () => {
  assert.equal(itemKey("01141101", "2 Litre"), "01141101_2litre");
  assert.equal(itemKey("01112601", "2,5 Kilogram"), "01112601_2.5kilogram");
  assert.equal(packUnit("1 Kilogram"), "per 1 kilogram");
  assert.equal(packUnit("Per Kilogram"), "per kilogram");
  assert.equal(packUnit("For 18"), "pack of 18");
  assert.equal(packUnit("Each"), "each");
  assert.equal(new Set(ITEMS.map((i) => i.code)).size, ITEMS.length, "item keys are unique");
});

test("parse: every listed item is in the real file; milk 1 l figures are the published ones", () => {
  for (const def of ITEMS) assert.ok(series.has(def.code), `missing in the real file: ${def.label} (${def.code})`);
  const milk = series.get(MILK)!;
  assert.equal(milk.find((p) => p.month === "2026-09")!.value, 20.46);
  assert.equal(milk.find((p) => p.month === "2026-08")!.value, 20.54);
  assert.ok(milk.find((p) => p.month === "2025-09")!.value > 15, "year-earlier price present");
  assert.equal(series.get(itemKey("01148101", "For 18"))!.find((p) => p.month === "2026-09")!.value, 60.58);
  assert.equal(series.get(itemKey("01221101", "x")), undefined);
  assert.equal(newestMonth(series), "2026-09");
});

test("parse: a changed sheet is refused", () => {
  assert.throws(() => parseRows([["a", "b"], [1, 2]]), /changed shape/);
  assert.throws(() => parseZip(Buffer.from("not a zip at all, definitely not a zip file")), /Not a zip/);
});

test("harvest: one row per item and month, NO_COUNT, dated to the reference month", () => {
  assert.equal(harvest.date, "2026-09-01");
  assert.equal(harvest.currency, "ZAR");
  const milk = harvest.rows.filter((r) => r.item === MILK || r.item.startsWith(MILK + "."));
  assert.deepEqual(milk.map((r) => [r.item, r.median]).slice(0, 2), [[MILK, 20.46], [MILK + ".m1", 20.54]]);
  assert.equal(milk.length, 3);
  for (const r of harvest.rows) {
    assert.ok(Object.is(r.n, NO_COUNT));
    assert.equal(r.low, r.median);
    assert.equal(r.high, r.median);
  }
  assert.ok(harvest.rows.length >= 150);
});

test("harvest: too few rows is refused", () => {
  assert.throws(() => harvestFromSeries(new Map([[MILK, [{ month: "2026-09", value: 20 }]]])), /holds no usable|Only/);
});

test("candidate urls: this month's file first, then three earlier", () => {
  const u = candidateUrls(TODAY);
  assert.equal(u.length, 4);
  assert.equal(u[0], "https://www.statssa.gov.za/timeseriesdata/Excel/P0141%20-%20CPI%20Average%20Prices%20All%20urban%20(202610).zip");
  assert.ok(u[1].endsWith("(202609).zip"));
  assert.ok(u[3].endsWith("(202607).zip"));
});

test("collector: skips months with no file and takes the first that exists", async () => {
  const asked: string[] = [];
  const h = await zaHarvest({ today: TODAY, load: async (u) => (asked.push(u), u.includes("(202609)") ? ZIP : null) });
  assert.equal(asked.length, 2);
  assert.equal(h.date, "2026-09-01");
  await assert.rejects(zaHarvest({ today: TODAY, load: async () => null }), /No CPI average prices file/);
});

test("matching: everyday words reach the right default pack", () => {
  assert.equal(matchItem(ITEMS, "milk").primary!.code, MILK);
  assert.equal(matchItem(ITEMS, "2 litre milk").primary!.code, itemKey("01141101", "2 Litre"));
  assert.equal(matchItem(ITEMS, "eggs").primary!.code, itemKey("01148101", "For 18"));
  assert.equal(matchItem(ITEMS, "Bread").primary!.label, "White bread, 700 Gram");
  assert.equal(matchItem(ITEMS, "mealie meal").primary!.code, itemKey("01112601", "5 Kilogram"));
  assert.equal(matchItem(ITEMS, "spaceship").primary, null);
});

test("answer: milk is Stats SA's published average with the change on a year earlier", async () => {
  const m = matchItem(ITEMS, "milk");
  const a = zaAnswer(snap(), m.primary, m.related, { item: "milk", today: TODAY });
  assert.equal(a.status, "ok");
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.price?.currency, "ZAR");
  assert.equal(a.price?.value, 20.46);
  assert.equal(a.sample_size, null);
  assert.match(a.summary, /R20\.46 in September 2026/);
  assert.match(a.summary, /(higher|lower) than a year earlier/);
  const x = a.extra as Record<string, any>;
  assert.equal(x.reference_month, "2026-09");
  assert.equal(x.item.unit, "per 1 litre");
  assert.equal(x.change_on_previous_month.value, 20.54);
  assert.ok(JSON.stringify(a).includes("Statistics South Africa (Stats SA), Consumer Price Index"));
  assert.ok(JSON.stringify(a).includes("acknowledge Stats SA"));
  const viaLib = await zaGroceryPrices({ item: "milk", baseUrl: "https://proofprice.com" }, { snapshot: snap() });
  assert.equal(viaLib.price?.value, 20.46);
});

test("answer: a region is ignored and says so; national words are not", () => {
  const m = matchItem(ITEMS, "bread");
  const gp = zaAnswer(snap(), m.primary, m.related, { item: "bread", region: "Gauteng", today: TODAY });
  assert.match(String((gp.extra as any).region_note), /Gauteng/);
  const ok = zaAnswer(snap(), m.primary, m.related, { item: "bread", region: "South Africa", today: TODAY });
  assert.equal((ok.extra as any).region_note, undefined);
});

test("answer: an unknown item says which items exist; blank item is a 400", async () => {
  const a = zaAnswer(snap(), null, [], { item: "spaceship", today: TODAY });
  assert.equal(a.status, "no_matches");
  assert.match(a.summary, /no standard item for "spaceship"/);
  await assert.rejects(zaGroceryPrices({ item: "  " }, { snapshot: snap() }), /item is required/);
});

test("answer: old data is flagged", () => {
  const m = matchItem(ITEMS, "milk");
  const a = zaAnswer(snap(), m.primary, m.related, { item: "milk", today: new Date("2027-03-01T00:00:00Z") });
  assert.match(String(a.statistic?.note), /Old data/);
});

test("history key and manifest", () => {
  assert.deepEqual(zaHistoryKey({ item: "milk" }), { area: "ALL", item: MILK, label: "Full cream milk - fresh, 1 Litre" });
  assert.equal(zaHistoryKey({ item: "spaceship" }), null);
  assert.equal(manifest.info.id, INFO.id);
  assert.deepEqual(manifest.countries, ["ZA"]);
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(monthWords("2026-09"), "September 2026");
  assert.equal(change(10, 11)?.change_percent, 10);
});
