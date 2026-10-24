// Tests for the France grocery prices (INSEE Prix moyens de vente au détail, BDM SDMX).
// Fixture: the real SDMX answers of bdm.insee.fr for the 18 series we list (8 monthly + 10 annual, lastNObservations=14), fetched from GitHub's
// servers on 2026-10-24 (probes inseem1 + inseea1) and joined into one message; attributes and order exactly as published.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { matchItem } from "../../categories/groceries/items";
import { NO_COUNT } from "../../lib/stats";
import { INFO, ITEMS, SERIES_URL, frAnswer, frGroceryPrices, frHarvest, frHistoryKey, harvestFromSeries, monthWords, newestMonth, parseSdmx, shiftMonth, snapshotFromRows } from "./source";
import manifest from "./index";

const XML = readFileSync(path.join(__dirname, "fixtures", "bdm-prix-moyens-2026-10-24.xml"), "utf8");
const TODAY = new Date("2026-10-24T12:00:00Z");
const series = parseSdmx(XML);
const harvest = harvestFromSeries(series, TODAY);
const snap = () => snapshotFromRows(harvest.date, harvest.rows.map((r) => ({ ...r, date: harvest.date })));

test("parse: series, gaps and the shape check", () => {
  assert.equal(series.size, 16); // the answer holds 18 series; common dabs (discontinued) and annual carrots are not items
  const apples = series.get("000641367")!;
  assert.equal(apples.freq, "M");
  assert.equal(apples.lastUpdate, "2026-10-15");
  assert.deepEqual(apples.points[apples.points.length - 1], { period: "2026-09", value: 3.15 });
  const monk = series.get("000641405")!;
  assert.equal(monk.points.find((p) => p.period === "2025-08"), undefined); // NaN gap dropped
  assert.equal(series.get("000641376")!.points.find((p) => p.period === "2020"), undefined);
  assert.throws(() => parseSdmx("<html>Maintenance</html>"), /not the SDMX data message/);
  assert.equal(ITEMS.length, 16);
  assert.equal(SERIES_URL.split("+").length, 16);
});

test("harvest: monthly rows with previous month and year ago, annual rows, NO_COUNT, last-update row", () => {
  assert.equal(newestMonth(series), "2026-09");
  assert.equal(harvest.date, "2026-09-01");
  assert.equal(harvest.currency, "EUR");
  const apples = harvest.rows.filter((r) => r.item.startsWith("000641367"));
  assert.deepEqual(apples.map((r) => [r.item, r.median]), [["000641367", 3.15], ["000641367.m1", 3.19], ["000641367.y1", 3.14]]);
  const oysters = harvest.rows.filter((r) => r.item.startsWith("000641376"));
  assert.deepEqual(oysters.map((r) => [r.item, r.median]), [["000641376.A2025", 10.5], ["000641376.A2024", 10.53]]);
  assert.ok(!harvest.rows.some((r) => r.item.startsWith("000641374"))); // dabs (2021) not an item and stale
  for (const r of harvest.rows) {
    assert.ok(Number.isNaN(r.n) && Object.is(r.n, NO_COUNT));
    assert.equal(r.low, r.median);
    assert.equal(r.max, r.median);
  }
  assert.equal(harvest.rows.find((r) => r.item === "_last_update")!.median, 20261015);
  assert.equal(harvest.rows.filter((r) => /^\d+$/.test(r.item)).length, 8);
});

test("harvest: an annual series more than two years old is skipped", () => {
  const h = harvestFromSeries(series, new Date("2028-03-01T00:00:00Z"));
  assert.ok(!h.rows.some((r) => r.item.includes(".A")));
  assert.throws(() => harvestFromSeries(new Map(), TODAY), /no usable monthly/);
});

test("answer: apples is a published average with the year-on-year change and INSEE's update date", () => {
  const m = matchItem(ITEMS, "apples");
  const a = frAnswer(snap(), m.primary as any, m.related as any, { item: "apples", today: TODAY });
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.status, "ok");
  assert.equal(a.price?.currency, "EUR");
  assert.equal(a.price?.value, 3.15);
  assert.equal(a.price?.typical_low, null);
  assert.equal(a.sample_size, null);
  assert.equal(a.period.from, "2026-09-01");
  assert.equal(a.period.to, "2026-09-30");
  assert.match(a.summary, /€3\.15 in September 2026/);
  assert.match(a.summary, /0\.3% higher than a year earlier \(€3\.14 in September 2025\)/);
  const x = a.extra as any;
  assert.equal(x.insee_last_update, "2026-10-15");
  assert.equal(x.change_on_previous_month.reference_month, "2026-08");
  assert.match(String(a.statistic?.note), /INSEE last updated the data on 2026-10-15/);
});

test("answer: an annual item states its year and compares with the year before", async () => {
  const a = await frGroceryPrices({ item: "huîtres", today: TODAY }, { snapshot: snap() });
  assert.equal(a.price?.value, 10.5);
  assert.equal(a.period.from, "2025-01-01");
  assert.equal(a.period.to, "2025-12-31");
  assert.match(a.summary, /in 2025/);
  assert.match(a.summary, /0\.3% lower than the year before \(€10\.53 in 2024\)/);
  assert.equal((a.extra as any).frequency, "annual");
});

test("items: everyday words (English and French) reach the right series", async () => {
  for (const [word, code] of [["apples", "000641367"], ["pommes", "000641367"], ["potatoes", "000641360"], ["carottes", "000641422"], ["beef", "000442435"], ["entrecôte", "000442435"], ["shrimp", "000641417"], ["oranges", "000641386"], ["pork", "000442640"]]) {
    assert.equal(matchItem(ITEMS, word).primary?.code, code, word);
  }
  const a = await frGroceryPrices({ item: "carrots", today: TODAY }, { snapshot: snap() });
  assert.equal(a.price?.value, 2.21);
});

test("answer: unknown item, ignored region, old data, empty library", async () => {
  const none = await frGroceryPrices({ item: "unobtainium" }, { snapshot: snap() });
  assert.equal(none.price, null);
  assert.equal(none.status, "no_matches");
  assert.match(none.summary, /no standard item/);
  const r = await frGroceryPrices({ item: "apples", region: "Bretagne", today: new Date("2027-02-10T00:00:00Z") }, { snapshot: snap() });
  assert.match(r.summary, /3\.15/);
  assert.match(String((r.extra as any).region_note), /ignored/);
  assert.match(String(r.statistic?.note), /Old data/);
  const national = await frGroceryPrices({ item: "apples", region: "France", today: TODAY }, { snapshot: snap() });
  assert.equal((national.extra as any).region_note, undefined);
  await assert.rejects(() => frGroceryPrices({ item: "apples" }, { snapshot: null }), /after the next collection/);
  await assert.rejects(() => frGroceryPrices({ item: " " }, { snapshot: snap() }), /item is required/);
});

test("collector: asks INSEE once and fails loudly on an error page", async () => {
  const urls: string[] = [];
  const h = await frHarvest({ today: TODAY, load: async (u) => { urls.push(u); return XML; } });
  assert.deepEqual(urls, [SERIES_URL]);
  assert.equal(h.date, "2026-09-01");
  await assert.rejects(() => frHarvest({ today: TODAY, load: async () => "<html>erreur</html>" }), /not the SDMX data message/);
});

test("months, history keys and manifest", () => {
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(monthWords("2026-09"), "September 2026");
  assert.deepEqual(frHistoryKey({ item: "apples" }), { area: "ALL", item: "000641367", label: "Apples (1 kg)" });
  assert.equal(frHistoryKey({ item: "oysters" }), null); // annual: no daily series
  assert.equal(frHistoryKey({ item: "zzz" }), null);
  assert.equal(manifest.category, "groceries");
  assert.deepEqual(manifest.countries, ["FR"]);
  assert.match(INFO.licence, /commercial/);
  assert.match(INFO.attribution, /Insee/);
});
