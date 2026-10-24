// Tests for the Singapore SingStat average retail prices (table M213761).
// Fixture: rows copied from the real response fetched through the GitHub probe on 2026-10-24
// (GET https://tablebuilder.singstat.gov.sg/api/table/tabledata/M213761?limit=2000&offset=0&timeFilter=2026%20Sep, dataLastUpdated 23/10/2026).
// The August 2026 and September 2025 values are illustrative numbers in the same layout.
import { test } from "node:test";
import assert from "node:assert/strict";
import { matchItem } from "../../categories/groceries/items";
import { ITEMS, INFO, changeOver, isoFromSgDate, keyFromMonth, monthFromKey, monthUrl, monthWords, monthsBehind, parseMonth, readLatest, sgAnswer, sgSingstatPrices, shiftMonth } from "./source";
import manifest from "./index";

const FOOTNOTE = "Prices of items starting from January 2024 are based on the 2024-based CPI basket.";
function table(key: string, rows: Array<[string, string]>, updated = "23/10/2026"): any {
  return {
    Data: {
      id: "M213761", title: "Average Retail Prices Of Selected Consumer Items, Monthly", dataLastUpdated: updated, footnote: FOOTNOTE,
      row: rows.map(([rowText, value], i) => ({ seriesNo: String(i + 1), rowText, uoM: "Dollar", footnote: "", columns: value === "" ? [] : [{ key, value }] })),
    },
  };
}
const SEP = table("2026 Sep", [["Hen Eggs (Per 10)", "3.29"], ["Chicken Rice (Per Plate)", "4.25"], ["Fresh Milk (Per Litre)", "3.73"], ["Petrol, 95 Octane (Per Litre)", "2.92"]]);
const AUG = table("2026 Aug", [["Hen Eggs (Per 10)", "3.27"], ["Chicken Rice (Per Plate)", "4.2"]]);
const SEP25 = table("2025 Sep", [["Hen Eggs (Per 10)", "3.1"], ["Chicken Rice (Per Plate)", "4.0"]]);
const OCT = table("2026 Oct", [["Hen Eggs (Per 10)", ""]]);
const TODAY = new Date("2026-10-24T12:00:00Z");

function getter(): (url: string) => Promise<unknown> {
  return async (url) => {
    const f = decodeURIComponent(new URL(url).searchParams.get("timeFilter") ?? "");
    if (f === "2026 Sep") return SEP;
    if (f === "2026 Aug") return AUG;
    if (f === "2025 Sep") return SEP25;
    return table(f, []);
  };
}

test("months: keys, codes, words, dates", () => {
  assert.equal(monthFromKey("2026 Sep"), "2026-09");
  assert.equal(monthFromKey("garbage"), null);
  assert.equal(keyFromMonth("2026-01"), "2026 Jan");
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(monthWords("2026-09"), "September 2026");
  assert.equal(monthsBehind("2026-09", TODAY), 1);
  assert.equal(isoFromSgDate("23/10/2026"), "2026-10-23");
  assert.match(monthUrl("2026-09"), /timeFilter=2026%20Sep$/);
});

test("parseMonth reads the real layout and skips empty cells", () => {
  const m = parseMonth(SEP, "2026-09");
  assert.equal(m.rows.get("hen eggs (per 10)")?.value, 3.29);
  assert.equal(m.dataLastUpdated, "2026-10-23");
  assert.equal(parseMonth(OCT, "2026-10").rows.size, 0);
  assert.throws(() => parseMonth({ nope: 1 }, "2026-09"), /unexpected shape/);
});

test("every item word resolves, and the item codes are unique", () => {
  assert.equal(new Set(ITEMS.map((i) => i.code.toLowerCase())).size, ITEMS.length);
  assert.equal(matchItem(ITEMS, "eggs").primary?.code, "Hen Eggs (Per 10)");
  assert.equal(matchItem(ITEMS, "chicken rice").primary?.code, "Chicken Rice (Per Plate)");
  assert.equal(matchItem(ITEMS, "milk").primary?.code, "Fresh Milk (Per Litre)");
  assert.equal(matchItem(ITEMS, "petrol").primary, null);
});

test("changeOver", () => {
  assert.deepEqual(changeOver(3.1, "2025-09", 3.29), { from_month: "2025-09", from_value: 3.1, change_percent: 6.1, change_amount: 0.19 });
  assert.equal(changeOver(null, "2025-09", 3), null);
});

test("answer: eggs, official average with change on a year earlier", async () => {
  const a = await sgSingstatPrices({ item: "eggs", today: TODAY }, { getter: getter() });
  assert.equal(a.status, "ok");
  assert.equal(a.price?.value, 3.29);
  assert.equal(a.price?.currency, "SGD");
  assert.equal(a.price?.unit, "per 10 eggs");
  assert.equal(a.sample_size, null);
  assert.equal(a.price_type, "official_statistic");
  assert.deepEqual(a.period, { from: "2026-09-01", to: "2026-09-30" });
  assert.match(a.summary, /S\$3\.29 in September 2026/);
  assert.match(a.summary, /6\.1% higher than a year earlier/);
  const ex = a.extra as any;
  assert.equal(ex.change_on_previous_month.value, 3.27);
  assert.equal(ex.reference_month, "2026-09");
});

test("answer: newest month empty falls back to the month with prices", async () => {
  const g = async (url: string) => (decodeURIComponent(new URL(url).searchParams.get("timeFilter") ?? "") === "2026 Oct" ? OCT : getter()(url));
  const r = await readLatest(new Date("2026-11-03T00:00:00Z"), { getter: g });
  assert.equal(r.latest.month, "2026-09");
});

test("answer: unknown item and fuel give no_matches with a hint; missing item is an input error; region is ignored with a note", async () => {
  const none = await sgSingstatPrices({ item: "petrol", today: TODAY }, { getter: getter() });
  assert.equal(none.status, "no_matches");
  assert.match(none.summary, /no standard item/);
  await assert.rejects(() => sgSingstatPrices({ item: " ", today: TODAY }, { getter: getter() }), /item is required/);
  const r = await sgSingstatPrices({ item: "chicken rice", region: "Tampines", today: TODAY }, { getter: getter() });
  assert.match(String((r.extra as any).region_note), /national averages only/);
});

test("answer: old data is flagged", async () => {
  const reading = { latest: parseMonth(SEP, "2026-09"), previous: null, yearAgo: null };
  const a = sgAnswer(reading, matchItem(ITEMS, "eggs").primary, [], { item: "eggs", today: new Date("2027-03-01T00:00:00Z") });
  assert.match(a.summary, /Old data/);
});

test("manifest and licence", () => {
  assert.equal(manifest.category, "groceries");
  assert.deepEqual(manifest.countries, ["SG"]);
  assert.match(INFO.licence, /Singapore Open Data Licence/);
  assert.ok(manifest.examples!.length >= 1);
});
