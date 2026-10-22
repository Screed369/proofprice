// Tests for the Latvian CSB average retail prices (table PCC010m).
// Fixture: the dimension ids, item codes, labels and month codes are exactly those of the real table metadata captured through the
// GitHub probe on 2026-10-22 (GET https://data.stat.gov.lv/api/v1/en/OSP_PUB/START/VEK/PC/PCC/PCC010m). The data call is a PxWeb POST
// that the probe cannot make, so the VALUES below are illustrative numbers in the standard PxWeb json-stat2 layout; the live answer was
// checked on a Vercel preview (see the Notion row).
import { test } from "node:test";
import assert from "node:assert/strict";
import { exampleWords, matchItem } from "../../categories/groceries/items";
import { parseJsonStat } from "../../lib/adapters";
import { INFO, ITEMS, buildQuery, changeOver, csbAnswer, findDimensions, lvCsbPrices, monthFromCode, monthWords, monthsBehind, readItem, shiftMonth } from "./source";
import manifest from "./index";

const MONTHS = ["2025M09", "2025M10", "2025M11", "2025M12", "2026M01", "2026M02", "2026M03", "2026M04", "2026M05", "2026M06", "2026M07", "2026M08", "2026M09"];
function cube(code: string, label: string, values: Array<number | null>): any {
  return {
    class: "dataset",
    label: "Average retail prices of selected commodity (euro per 1 kg, if other - specified) by Goods and services and Time period",
    source: "Central Statistical Bureau of Latvia",
    updated: "2026-10-08T06:00:00Z",
    id: ["GOODS_SERVICES", "ContentsCode", "TIME"],
    size: [1, 1, MONTHS.length],
    dimension: {
      GOODS_SERVICES: { label: "Goods and services", category: { index: { [code]: 0 }, label: { [code]: label } } },
      ContentsCode: { label: "Indicator", category: { index: { PCC010m: 0 }, label: { PCC010m: "Average retail prices of selected commodity" } } },
      TIME: { label: "Time period", category: { index: Object.fromEntries(MONTHS.map((m, i) => [m, i])), label: Object.fromEntries(MONTHS.map((m) => [m, m])) } },
    },
    value: values,
  };
}
const MILK = cube("01.1.4.2.0.203", "Milk, 1 l", [1.12, 1.13, 1.13, 1.14, 1.15, 1.15, 1.16, 1.17, 1.17, 1.18, 1.18, 1.19, 1.2]);
const TODAY = new Date("2026-10-22T12:00:00Z");

test("months: PxWeb codes become YYYY-MM, shifting and words", () => {
  assert.equal(monthFromCode("2026M09"), "2026-09");
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(shiftMonth("2026-09", -12), "2025-09");
  assert.equal(monthWords("2026-09"), "September 2026");
  assert.equal(monthsBehind("2026-09", TODAY), 1);
});

test("the query asks for one item, the table's indicator and the newest 14 months", () => {
  const q = buildQuery("01.1.4.2.0.203");
  assert.deepEqual(q.query[0], { code: "GOODS_SERVICES", selection: { filter: "item", values: ["01.1.4.2.0.203"] } });
  assert.deepEqual(q.query[2], { code: "TIME", selection: { filter: "top", values: ["14"] } });
  assert.equal(q.response.format, "json-stat2");
});

test("readItem: latest month, the same month a year earlier and the month before", () => {
  const t = parseJsonStat(JSON.parse(JSON.stringify(MILK)));
  assert.deepEqual(findDimensions(t), { time: "TIME", item: "GOODS_SERVICES" });
  const r = readItem(t, "01.1.4.2.0.203")!;
  assert.deepEqual(r.latest, { month: "2026-09", value: 1.2 });
  assert.deepEqual(r.yearAgo, { month: "2025-09", value: 1.12 });
  assert.equal(r.previous?.month, "2026-08");
  assert.equal(r.series.length, 13);
  assert.equal(readItem(t, "99.9.9"), null);
});

test("changeOver: percent and amount", () => {
  const c = changeOver({ month: "2025-09", value: 1.12 }, { month: "2026-09", value: 1.2 })!;
  assert.equal(c.change_percent, 7.1);
  assert.equal(c.change_amount, 0.08);
  assert.equal(changeOver(null, { month: "2026-09", value: 1 }), null);
});

test("everyday words find the right CSB item", () => {
  const code = (w: string) => matchItem(ITEMS, w).primary?.code;
  assert.equal(code("milk"), "01.1.4.2.0.203");
  assert.equal(code("Milk"), "01.1.4.2.0.203");
  assert.equal(code("bread"), "01.1.1.3.1.304");
  assert.equal(code("white bread"), "01.1.1.3.1.304");
  assert.equal(code("rye bread"), "01.1.1.3.1.307");
  assert.equal(code("eggs"), "01.1.4.8.1.701");
  assert.equal(code("butter"), "01.1.5.2.1.101");
  assert.equal(code("potatoes"), "01.1.7.5.1.403");
  assert.equal(code("sugar"), "01.1.8.1.2.101");
  assert.equal(code("coffee"), "01.2.2.0.1.101");
  assert.equal(code("beer"), "02.1.3.0.0.101");
  assert.equal(code("diesel"), undefined);
  assert.equal(code("haircut"), undefined);
  assert.ok(exampleWords(ITEMS, 10).length > 5);
});

test("item table: unique codes, only food and drink codes, plain units", () => {
  const codes = ITEMS.map((i) => i.code);
  assert.equal(new Set(codes).size, codes.length);
  assert.ok(codes.every((c) => c.startsWith("01.") || c.startsWith("02.1.")));
  assert.ok(ITEMS.every((i) => i.unit.startsWith("per ")));
  assert.equal(ITEMS.find((i) => i.code === "01.1.4.8.1.701")!.unit, "per 10 eggs");
});

test("an answer is an official statistic: average, no range, no sample size, EUR, CC BY 4.0", async () => {
  const a = await lvCsbPrices({ item: "milk", today: TODAY }, { poster: async () => JSON.parse(JSON.stringify(MILK)) });
  assert.equal(a.status, "ok");
  assert.equal(a.price?.value, 1.2);
  assert.equal(a.price?.measure, "average");
  assert.equal(a.price?.currency, "EUR");
  assert.equal(a.price?.unit, "per litre");
  assert.equal(a.price?.typical_low, null);
  assert.equal(a.price?.typical_high, null);
  assert.equal(a.sample_size, null);
  assert.equal(a.price_type, "official_statistic");
  assert.deepEqual(a.period, { from: "2026-09-01", to: "2026-09-30" });
  assert.equal(a.statistic?.reference_period, "2026-09");
  assert.match(a.summary, /7\.1% higher than a year earlier/);
  assert.match(a.summary, /not receipts/);
  assert.match(a.source.licence, /CC BY 4\.0/);
  assert.equal((a.extra as any).last_13_months.length, 13);
  assert.equal((a.extra as any).change_on_previous_month.reference_month, "2026-08");
});

test("a region is ignored and said so; Latvia as the region is not", async () => {
  const p = async () => JSON.parse(JSON.stringify(MILK));
  const a = await lvCsbPrices({ item: "milk", region: "Riga" }, { poster: p });
  assert.match(a.statistic?.note ?? "", /national averages only/);
  const b = await lvCsbPrices({ item: "milk", region: "Latvia" }, { poster: p });
  assert.doesNotMatch(b.statistic?.note ?? "", /national averages only/);
});

test("an item missing in the newest months uses its latest price and says so; one with no price at all gives no_matches", () => {
  const cake = cube("01.1.1.3.9.404", "Cake, 1 kg", [5, 5.1, 5.2, 5.2, 5.3, 5.3, 5.4, 5.4, 5.5, 5.5, 5.6, null, null]);
  const r = readItem(parseJsonStat(cake), "01.1.1.3.9.404")!;
  const def = ITEMS.find((i) => i.code === "01.1.1.3.9.404")!;
  const a = csbAnswer(r, def, [], { item: "cake", today: TODAY });
  assert.equal(a.price?.value, 5.6);
  assert.match(a.statistic?.note ?? "", /no price for this item in September 2026/);
  const empty = cube("01.1.1.3.9.404", "Cake, 1 kg", MONTHS.map(() => null));
  assert.equal(readItem(parseJsonStat(empty), "01.1.1.3.9.404"), null);
  const n = csbAnswer(null, def, [], { item: "cake" });
  assert.equal(n.status, "no_matches");
  assert.match(n.summary, /no price for/);
});

test("an unknown item lists what can be asked; no network is touched", async () => {
  const a = await lvCsbPrices({ item: "diesel" }, { poster: async () => { throw new Error("must not call"); } });
  assert.equal(a.status, "no_matches");
  assert.match(a.summary, /Try one of/);
  await assert.rejects(() => lvCsbPrices({ item: " " }), /item is required/);
});

test("a table that changes shape fails loudly", () => {
  const bad = JSON.parse(JSON.stringify(MILK));
  bad.id = ["X", "ContentsCode", "TIME"];
  bad.dimension.X = bad.dimension.GOODS_SERVICES;
  delete bad.dimension.GOODS_SERVICES;
  assert.throws(() => readItem(parseJsonStat(bad), "01.1.4.2.0.203"), /changed shape/);
});

test("manifest: LV groceries, first example is a smoke test, licence and attribution present", () => {
  assert.deepEqual(manifest.countries, ["LV"]);
  assert.equal(manifest.category, "groceries");
  assert.equal(manifest.examples[0].params.item, "milk");
  assert.match(INFO.attribution, /CC BY 4\.0/);
  assert.equal(INFO.price_type, "official_statistic");
});
