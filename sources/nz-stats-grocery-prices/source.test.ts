// Tests for the New Zealand grocery prices (Stats NZ Selected price indexes).
// Fixture: real rows of the September 2026 release file (selected-price-indexes-september-2026.csv), downloaded from GitHub's servers on
// 2026-10-24: all 74 CPIM.SAPnnnn series for the periods 2025.09, 2026.07, 2026.08 and 2026.09, header and quoting exactly as published.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { matchItem } from "../../categories/groceries/items";
import { NO_COUNT } from "../../lib/stats";
import { INFO, ITEMS, candidateUrls, harvestFromSeries, monthWords, newestMonth, nzAnswer, nzGroceryPrices, nzHarvest, nzHistoryKey, parseSeries, shiftMonth, snapshotFromRows, splitCsvLine } from "./source";
import manifest from "./index";

const CSV = readFileSync(path.join(__dirname, "fixtures", "selected-price-indexes-2026-09-subset.csv"), "utf8");
const TODAY = new Date("2026-10-24T12:00:00Z");
const series = parseSeries(CSV);
const harvest = harvestFromSeries(series);
const snap = () => snapshotFromRows(harvest.date, harvest.rows.map((r) => ({ ...r, date: harvest.date })));

test("csv: quoted fields, header check", () => {
  assert.deepEqual(splitCsvLine('"CPIM.SAP0100","2026.09",4.45,"FINAL","Dollars","a, b",NA'), ["CPIM.SAP0100", "2026.09", "4.45", "FINAL", "Dollars", "a, b", "NA"]);
  assert.throws(() => parseSeries("a,b\n1,2\n"), /changed shape/);
});

test("parse: all 74 items, milk 2 l figures are the published ones", () => {
  assert.equal(ITEMS.length, 74);
  assert.equal(series.size, 74);
  const milk = series.get("SAP0127")!;
  assert.deepEqual(milk.find((p) => p.month === "2026-09"), { month: "2026-09", value: 5.05 });
  assert.equal(milk.find((p) => p.month === "2026-08")!.value, 5.09);
  assert.equal(milk.find((p) => p.month === "2025-09")!.value, 4.72);
  assert.equal(newestMonth(series), "2026-09");
});

test("harvest: one row per item and month, NO_COUNT, dated to the reference month", () => {
  assert.equal(harvest.date, "2026-09-01");
  assert.equal(harvest.currency, "NZD");
  const milk = harvest.rows.filter((r) => r.item.startsWith("SAP0127"));
  assert.deepEqual(milk.map((r) => [r.item, r.median]), [["SAP0127", 5.05], ["SAP0127.m1", 5.09], ["SAP0127.y1", 4.72]]);
  for (const r of harvest.rows) {
    assert.ok(Number.isNaN(r.n) && Object.is(r.n, NO_COUNT));
    assert.equal(r.low, r.median);
    assert.equal(r.max, r.median);
  }
  assert.equal(harvest.rows.filter((r) => !r.item.includes(".")).length, 74);
});

test("answer: milk is a published average with the year-on-year change", () => {
  const a = nzAnswer(snap(), ...(() => { const m = matchItem(ITEMS, "milk"); return [m.primary, m.related] as const; })(), { item: "milk", today: TODAY });
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.status, "ok");
  assert.equal(a.price?.currency, "NZD");
  assert.equal(a.price?.typical_low, null);
  assert.equal(a.sample_size, null);
  assert.equal(a.price?.value, 5.05);
  assert.equal(a.period.from, "2026-09-01");
  assert.equal(a.period.to, "2026-09-30");
  assert.match(a.summary, /5\.05/);
  assert.match(a.summary, /7% higher than a year earlier \(NZ\$4\.72 in September 2025\)/);
  const x = a.extra as any;
  assert.equal(x.change_on_year_earlier.change_percent, 7);
  assert.equal(x.change_on_previous_month.reference_month, "2026-08");
  assert.ok(x.other_definitions.some((d: any) => /Soy milk/.test(d.definition)));
});

test("items: everyday words reach the right series", async () => {
  for (const [word, code] of [["eggs", "SAP0130"], ["butter", "SAP0131"], ["bread", "SAP0149"], ["bananas", "SAP0101"], ["beef mince", "SAP0116"], ["milk", "SAP0127"]]) {
    assert.equal(matchItem(ITEMS, word).primary?.code, code, word);
  }
  const a = await nzGroceryPrices({ item: "eggs", today: TODAY }, { snapshot: snap() });
  assert.equal(a.price?.value, 8.37);
});

test("answer: unknown item, ignored region, old data, empty library", async () => {
  const none = await nzGroceryPrices({ item: "unobtainium" }, { snapshot: snap() });
  assert.equal(none.price, null);
  assert.equal(none.status, "no_matches");
  assert.match(none.summary, /no standard item/);
  const r = await nzGroceryPrices({ item: "milk", region: "Auckland", today: new Date("2027-02-10T00:00:00Z") }, { snapshot: snap() });
  assert.match(r.summary, /5\.05/);
  assert.match(String((r.extra as any).region_note), /ignored/);
  assert.match(String(r.statistic?.note), /Old data/);
  await assert.rejects(() => nzGroceryPrices({ item: "milk" }, { snapshot: null }), /after the next collection/);
  await assert.rejects(() => nzGroceryPrices({ item: " " }, { snapshot: snap() }), /item is required/);
});

test("collector: tries this month's release first, falls back, and fails loudly", async () => {
  const urls = candidateUrls(TODAY);
  assert.match(urls[0], /Selected-price-indexes-October-2026\/Download-data\/selected-price-indexes-october-2026\.csv$/);
  assert.match(urls[1], /September-2026.*september-2026\.csv$/);
  const tried: string[] = [];
  const h = await nzHarvest({ today: TODAY, load: async (u) => { tried.push(u); return u.includes("september-2026") ? CSV : null; } });
  assert.equal(tried.length, 2);
  assert.equal(h.date, "2026-09-01");
  await assert.rejects(() => nzHarvest({ today: TODAY, load: async () => null }), /No Selected price indexes file/);
});

test("months and manifest", () => {
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(monthWords("2026-09"), "September 2026");
  assert.deepEqual(nzHistoryKey({ item: "eggs" }), { area: "ALL", item: "SAP0130", label: "Eggs, dozen" });
  assert.equal(nzHistoryKey({ item: "zzz" }), null);
  assert.equal(manifest.category, "groceries");
  assert.deepEqual(manifest.countries, ["NZ"]);
  assert.match(INFO.licence, /CC BY 4\.0/);
});
