// Tests for the Austria grocery prices (STATISTIK AUSTRIA Preisradar).
// Fixtures: the real item files https://www.statistik.at/preisradar/data/ep/{001900,005661,006500}.json, downloaded from GitHub's servers on
// 2026-10-28 (only productId, the two titles and "price" are kept; the "indices" block is left out). The newest month in them is 2026-09.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { NO_COUNT } from "../../lib/stats";
import { matchItem } from "../../categories/groceries/items";
import { INFO, ITEMS, atAnswer, atGroceryPrices, atHarvest, atHistoryKey, harvestFromProducts, monthOf, monthWords, parseProduct, shiftMonth, splitTitle } from "./source";
import manifest from "./index";

const fx = (id: string) => JSON.parse(readFileSync(path.join(__dirname, "fixtures", `${id}.json`), "utf8"));
const TODAY = new Date("2026-10-28T12:00:00Z");
const milk = parseProduct(fx("005661"));
const rice = parseProduct(fx("001900"));
const eggs = parseProduct(fx("006500"));

test("items: 100 unique ids, milk is the default for 'milk'", () => {
  assert.equal(ITEMS.length, 100);
  assert.equal(new Set(ITEMS.map((i) => i.code)).size, 100);
  assert.equal(matchItem(ITEMS, "milk").primary?.code, "005661");
  assert.equal(matchItem(ITEMS, "eggs").primary?.code, "006500");
  assert.equal(matchItem(ITEMS, "bread").primary?.code, "000800");
  assert.equal(matchItem(ITEMS, "chicken").primary?.code, "005000");
  assert.equal(matchItem(ITEMS, "spaceship").primary, null);
});

test("parse: the real files give the published monthly medians", () => {
  assert.equal(monthOf(1788220800000), "2026-09");
  assert.equal(milk.id, "005661");
  assert.equal(milk.title_en, "Fresh milk (1000 milliliter)");
  const last = milk.points[milk.points.length - 1];
  assert.equal(last.month, "2026-09");
  assert.equal(last.median, 1.59);
  assert.equal(milk.points.find((p) => p.month === "2026-08")!.median, 1.57);
  assert.equal(milk.points.find((p) => p.month === "2025-09")!.median, 1.69);
  assert.equal(milk.points.length, 45);
  assert.ok(last.p25 !== null && last.p75 !== null && last.p25 < last.p75);
  assert.equal(rice.points[rice.points.length - 1].median, 2.46);
  assert.equal(eggs.points[eggs.points.length - 1].median, 1.99);
});

test("parse: 'NA' months are dropped and a changed file is refused", () => {
  const p = parseProduct({ productId: "x", productTitle_en: "X (1 piece)", price: { medianData: [[1785542400000, "NA"], [1788220800000, 2]], meanData: [], rangeData: [] } });
  assert.deepEqual(p.points.map((x) => x.month), ["2026-09"]);
  assert.throws(() => parseProduct({ foo: 1 }), /changed shape/);
});

test("title and months", () => {
  assert.deepEqual(splitTitle("Fresh milk (1000 milliliter)"), { name: "Fresh milk", pack: "1000 milliliter" });
  assert.deepEqual(splitTitle("Cola"), { name: "Cola", pack: null });
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(monthWords("2026-09"), "September 2026");
});

test("harvest: median, previous month and year earlier per item, NO_COUNT, dated to the reference month", () => {
  const h = harvestFromProducts([milk, rice, eggs, ...Array.from({ length: 60 }, (_, i) => ({ ...milk, id: `x${i}` }))]);
  assert.equal(h.date, "2026-09-01");
  assert.equal(h.currency, "EUR");
  assert.deepEqual(h.rows.filter((r) => r.item.startsWith("005661")).map((r) => [r.item, r.median]), [["005661", 1.59], ["005661.m1", 1.57], ["005661.y1", 1.69]]);
  for (const r of h.rows) {
    assert.ok(Object.is(r.n, NO_COUNT));
    assert.equal(r.area, "ALL");
  }
  assert.throws(() => harvestFromProducts([milk]), /refusing to store/);
});

test("harvest: reads every item through the loader and survives a few failures", async () => {
  const load = async (url: string) => {
    const id = /ep\/(\d+)\.json$/.exec(url)![1];
    if (id === "000100") throw new Error("boom");
    return { ...fx("005661"), productId: id };
  };
  const h = await atHarvest({ load, concurrency: 4 });
  assert.equal(new Set(h.rows.filter((r) => !r.item.includes(".")).map((r) => r.item)).size, 99);
  await assert.rejects(() => atHarvest({ load: async () => { throw new Error("down"); } }), /could be read/);
});

test("answer: milk is EUR 1.59 per 1000 ml, official statistic, no count, p25-p75 only in extra", () => {
  const m = matchItem(ITEMS, "milk");
  const a = atAnswer(milk, m.primary, m.related, { item: "milk", today: TODAY });
  assert.equal(a.status, "ok");
  assert.equal(a.price?.currency, "EUR");
  assert.equal(a.price?.value, 1.59);
  assert.equal(a.price?.median, 1.59);
  assert.equal(a.price?.unit, "per 1000 milliliter");
  assert.equal(a.price?.typical_low, null);
  assert.equal(a.price?.typical_high, null);
  assert.equal(a.sample_size, null);
  assert.equal(a.price_type, "official_statistic");
  assert.deepEqual(a.period, { from: "2026-09-01", to: "2026-09-30" });
  const x = a.extra as any;
  assert.equal(x.reference_month, "2026-09");
  assert.equal(x.change_on_year_earlier.value, 1.69);
  assert.equal(x.change_on_year_earlier.change_percent, -5.9);
  assert.ok(x.interquartile_range.p25 < x.interquartile_range.p75);
  assert.match(a.summary, /lower than a year earlier/);
  assert.match(a.source.attribution, /STATISTIK AUSTRIA/);
});

test("answer: a region is ignored and said so; an unknown item is no_matches with suggestions", () => {
  const m = matchItem(ITEMS, "eggs");
  const a = atAnswer(eggs, m.primary, m.related, { item: "eggs", region: "Tirol", today: TODAY });
  assert.match(String((a.extra as any).region_note), /national figures only/);
  assert.equal(a.price?.unit, "per 6 piece");
  const none = atAnswer(null, null, [], { item: "spaceship" });
  assert.equal(none.status, "no_matches");
  assert.match(none.summary, /no standard item/);
});

test("request: fetches the item file, rejects an empty item", async () => {
  const seen: string[] = [];
  const a = await atGroceryPrices({ item: "rice", today: TODAY }, { load: async (u) => (seen.push(u), fx("001900")) });
  assert.deepEqual(seen, ["https://www.statistik.at/preisradar/data/ep/001900.json"]);
  assert.equal(a.price?.value, 2.46);
  await assert.rejects(() => atGroceryPrices({ item: " " }), /item is required/);
  assert.deepEqual(atHistoryKey({ item: "milk" }), { area: "ALL", item: "005661", label: "Fresh milk" });
  assert.equal(atHistoryKey({ item: "spaceship" }), null);
});

test("manifest", () => {
  assert.equal(manifest.info.id, INFO.id);
  assert.deepEqual(manifest.countries, ["AT"]);
  assert.equal(manifest.category, "groceries");
});
