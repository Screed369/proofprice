// Tests for the Irish CSO average prices (table CPM12). The fixture is a real CSO response captured on 2026-10-14 (see fixtures.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseJsonStat } from "../../lib/adapters";
import { exampleWords, matchItem } from "../../categories/groceries/items";
import { CPM12, CPM12_ITEM_LABELS } from "./fixtures";
import {
  CPM12_URL, INFO, ITEMS, changeOver, csoAnswer, findDimensions, ieCsoPrices, monthFromCode, monthWords, monthsBehind, readItem, shiftMonth,
} from "./source";
import manifest from "./index";

const table = () => parseJsonStat(JSON.parse(JSON.stringify(CPM12)));
const TODAY = new Date("2026-10-14T12:00:00Z");

test("the CSO cube parses: dimensions are found by role, months become YYYY-MM", () => {
  const t = table();
  assert.equal(t.label, "National Average Price");
  assert.deepEqual(findDimensions(t), { time: "TLIST(M1)", item: "C02363V03422" });
  assert.equal(monthFromCode("202609"), "2026-09");
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(shiftMonth("2026-09", -12), "2025-09");
  assert.equal(monthWords("2026-09"), "September 2026");
  assert.equal(monthsBehind("2026-09", TODAY), 1);
  assert.equal(monthsBehind("2026-06", TODAY), 4);
});

test("readItem: latest month, a year before and the month before, all as published", () => {
  const r = readItem(table(), "10630")!;
  assert.equal(r.csoLabel, "Full fat milk per 2 litre");
  assert.deepEqual(r.latest, { month: "2026-09", value: 2.374 });
  assert.deepEqual(r.yearAgo, { month: "2025-09", value: 2.466 });
  assert.equal(r.previous?.month, "2026-08");
  assert.equal(r.tableLatestMonth, "2026-09");
  assert.equal(r.tableUpdated, "2026-10-08T11:00:00.000Z");
  assert.equal(r.series.length, 26);
  assert.equal(readItem(table(), "99999"), null);
});

test("changeOver: percent and amount against the earlier month", () => {
  const c = changeOver({ month: "2025-09", value: 2.466 }, { month: "2026-09", value: 2.374 })!;
  assert.equal(c.change_percent, -3.7);
  assert.equal(c.change_amount, -0.092);
  assert.equal(changeOver(null, { month: "2026-09", value: 1 }), null);
});

test("everyday words find the right CSO item", () => {
  const code = (w: string) => matchItem(ITEMS, w).primary?.code;
  assert.equal(code("milk"), "10630");
  assert.equal(code("Milk"), "10630");
  assert.equal(code("a litre of Whole Milk"), "10630");
  assert.equal(code("low fat milk"), "10640");
  assert.equal(code("white bread"), "10040");
  assert.equal(code("bread"), "10040");
  assert.equal(code("brown bread"), "10050");
  assert.equal(code("eggs"), "10730");
  assert.equal(code("butter"), "10750");
  assert.equal(code("cheese"), "10680");
  assert.equal(code("bananas"), "10850");
  assert.equal(code("potatoes"), "11090");
  assert.equal(code("tea"), "11570");
  assert.equal(code("beer"), "11760");
  assert.equal(code("pint of guinness"), "12160");
  assert.equal(code("pint"), "12170");
  assert.equal(code("whisky"), "11680");
  assert.equal(code("coffee"), undefined);
  assert.equal(code("mince"), undefined);
  assert.equal(code(""), undefined);
  // the same words also list the other definitions
  const milk = matchItem(ITEMS, "milk");
  assert.ok(milk.related.some((d) => d.code === "10640"), "low-fat milk is listed as related");
  assert.ok(matchItem(ITEMS, "beer").related.some((d) => d.code === "11780"));
});

test("the item table is consistent with the real table: every code exists, no code twice, units and words present", () => {
  const seen = new Set<string>();
  for (const d of ITEMS) {
    assert.ok(CPM12_ITEM_LABELS[d.code], `${d.code} (${d.label}) is not an item of CPM12`);
    assert.ok(!seen.has(d.code), `${d.code} listed twice`);
    seen.add(d.code);
    assert.ok(d.unit.startsWith("per "), `${d.code}: unit should start with "per "`);
    assert.ok(d.words.length > 0 && d.label.length > 3);
  }
  assert.ok(exampleWords(ITEMS).includes("milk"));
});

test("answer: Irish milk is an official average with the item definition, month and year-on-year change", () => {
  const m = matchItem(ITEMS, "milk");
  const a = csoAnswer(readItem(table(), m.primary!.code), m.primary, m.related, { item: "milk", today: TODAY });
  assert.equal(a.status, "ok");
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.price?.currency, "EUR");
  assert.equal(a.price?.value, 2.374);
  assert.equal(a.price?.measure, "average");
  assert.equal(a.price?.median, null);
  assert.equal(a.price?.typical_low, null);
  assert.equal(a.sample_size, null);
  assert.equal(a.price?.unit, "per 2 litres");
  assert.deepEqual(a.period, { from: "2026-09-01", to: "2026-09-30" });
  assert.equal(a.statistic?.reference_period, "2026-09");
  assert.equal(a.source.id, "ie-cso-prices");
  assert.match(a.source.licence, /CC BY 4\.0/);
  assert.match(a.source.licence_url, /^https:\/\/www\.cso\.ie\//);
  assert.match(a.summary, /"Full-fat milk, per 2 litres"/);
  assert.match(a.summary, /€2\.37 in September 2026/);
  assert.match(a.summary, /3\.7% lower than a year earlier \(€2\.47 in September 2025\)/);
  assert.match(a.summary, /not receipts/);
  const x = a.extra as any;
  assert.equal(x.item.cso_label, "Full fat milk per 2 litre");
  assert.equal(x.change_on_year_earlier.change_percent, -3.7);
  assert.equal(x.last_13_months.length, 13);
  assert.equal(x.last_13_months[12].month, "2026-09");
  assert.ok(x.other_definitions.some((d: any) => d.definition.startsWith("Low-fat milk")));
  assert.equal(a.statistic?.note, undefined);
});

test("answer: a region is ignored and said so; 'Ireland' is accepted silently", () => {
  const m = matchItem(ITEMS, "white bread");
  const r = readItem(table(), m.primary!.code);
  const a = csoAnswer(r, m.primary, m.related, { item: "white bread", region: "Cork", today: TODAY });
  assert.equal(a.status, "ok");
  assert.match(a.statistic?.note ?? "", /national averages only/);
  assert.match(String((a.extra as any).region_note), /Cork/);
  const b = csoAnswer(r, m.primary, m.related, { item: "white bread", region: "Ireland", today: TODAY });
  assert.equal(b.statistic?.note, undefined);
});

test("answer: old data is flagged plainly, and a missing newest month is explained", () => {
  const m = matchItem(ITEMS, "eggs");
  const r = readItem(table(), m.primary!.code);
  const old = csoAnswer(r, m.primary, m.related, { item: "eggs", today: new Date("2027-03-01T00:00:00Z") });
  assert.match(old.statistic?.note ?? "", /Old data/);
  assert.match(old.summary, /Old data/);

  const json = JSON.parse(JSON.stringify(CPM12));
  const items: string[] = json.dimension["C02363V03422"].category.index;
  const times: string[] = json.dimension["TLIST(M1)"].category.index;
  const at = (ti: number, code: string) => ti * items.length + items.indexOf(code);
  json.value[at(times.length - 1, "10730")] = null; // no egg price in the newest month
  const gap = readItem(parseJsonStat(json), "10730")!;
  assert.equal(gap.latest.month, "2026-08");
  const a = csoAnswer(gap, m.primary, m.related, { item: "eggs", today: TODAY });
  assert.equal(a.status, "ok");
  assert.match(a.statistic?.note ?? "", /no price for this item in September 2026/);
});

test("answer: an item the CSO does not measure is no_matches with a list of what it does", () => {
  const a = csoAnswer(null, null, [], { item: "coffee" });
  assert.equal(a.status, "no_matches");
  assert.equal(a.price, null);
  assert.match(a.summary, /no standard item for "coffee"/);
  assert.ok(((a.extra as any).available_items as string[]).includes("milk"));
});

test("ieCsoPrices: one request to the CSO cube, no request for a word it cannot match", async () => {
  const urls: string[] = [];
  const fetcher = async (url: string) => (urls.push(url), JSON.parse(JSON.stringify(CPM12)));
  const a = await ieCsoPrices({ item: "eggs", today: TODAY }, { fetcher });
  assert.equal(a.status, "ok");
  assert.equal(a.price?.value, 2.471);
  assert.deepEqual(urls, [CPM12_URL]);
  const none = await ieCsoPrices({ item: "caviar", today: TODAY }, { fetcher });
  assert.equal(none.status, "no_matches");
  assert.equal(urls.length, 1);
  await assert.rejects(ieCsoPrices({ item: "  " }, { fetcher }), /item is required/);
});

test("manifest: Ireland, category groceries, first example is the milk smoke test", () => {
  assert.equal(manifest.category, "groceries");
  assert.deepEqual(manifest.countries, ["IE"]);
  assert.deepEqual(manifest.examples[0].params, { country: "IE", item: "milk" });
  assert.deepEqual(manifest.examples[1].params, { country: "IE", item: "white bread" });
  assert.equal(manifest.info, INFO);
  assert.equal(manifest.harvest, undefined);
});
