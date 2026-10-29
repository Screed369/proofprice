// Tests for the US BLS average prices. The fixture lines are real BLS data captured on 2026-10-14 (see fixtures.ts).
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { exampleWords, matchItem } from "../../categories/groceries/items";
import { writeDaily, writeMeta } from "../../lib/library/store";
import { AP_DATA_SAMPLE, AP_ITEM_NAMES, AP_LIVE_NATIONAL, AP_LIVE_REGIONS } from "./fixtures";
import {
  AREAS, BLS_USER_AGENT, INFO, ITEMS, monthWords, parseApData, readUsReading, resolveArea, shiftMonth, usAnswer, usBlsPrices, usDailyRows, usHarvest,
} from "./source";
import manifest from "./index";

// The price library is read at call time from this folder, so the tests never touch the real library/.
process.env.PROOFPRICE_LIBRARY_DIR = mkdtempSync(path.join(tmpdir(), "pp-us-bls-"));

const TODAY = new Date("2026-10-14T12:00:00Z");
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const series = () => parseApData(AP_DATA_SAMPLE);

test("parseApData: real lines are read (padded ids and values), missing months ('-' with footnote X) are skipped", () => {
  const s = series();
  const eggs = s.get("0000|708111")!;
  assert.equal(eggs.get("2026-09"), 2.272);
  assert.equal(eggs.get("2025-09"), 3.488);
  assert.equal(eggs.has("2025-10"), false, "October 2025 is '-': no data was collected");
  assert.equal(eggs.size, 14);
  assert.equal(s.get("0000|717311")!.get("2026-09"), 9.332);
  assert.equal(s.get("0300|708111")!.get("2026-09"), 2.368);
  // the Northeast egg series stopped: its newest value is October 2024
  assert.equal([...s.get("0100|708111")!.keys()].sort().pop(), "2024-10");
  assert.deepEqual([...s.keys()].sort(), ["0000|708111", "0000|717311", "0100|708111", "0200|717311", "0300|708111"]);
});

test("parseApData: annual averages (M13), unwanted items and areas, junk lines and bad values are ignored", () => {
  const junk = [
    "series_id        \tyear\tperiod\t       value\tfootnote_codes",
    "APU0000708111    \t2025\tM13\t       3.100\t",
    "APU0000708111    \t2026\tM09\t       2.272\t",
    "APU0000999999    \t2026\tM09\t       1.000\t",
    "APU0500708111    \t2026\tM09\t       1.000\t",
    "APU0000717311    \t2026\tM09\t       0.000\t",
    "APU0000717311    \t2026\tM08\t       abc\t",
    "CUUR0000SA0      \t2026\tM09\t     300.000\t",
    "",
    "short",
  ].join("\n");
  const s = parseApData(junk);
  assert.deepEqual([...s.keys()], ["0000|708111"]);
  assert.deepEqual([...s.get("0000|708111")!.entries()], [["2026-09", 2.272]]);
});

test("shiftMonth and monthWords", () => {
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(shiftMonth("2026-09", -12), "2025-09");
  assert.equal(shiftMonth("2025-12", 1), "2026-01");
  assert.equal(monthWords("2026-09"), "September 2026");
});

test("usDailyRows: newest month only, with the same month a year before and the month before; low/high repeat the one average", () => {
  const d = usDailyRows(series())!;
  assert.equal(d.month, "2026-09");
  const get = (area: string, item: string) => d.rows.find((r) => r.area === area && r.item === item);
  assert.equal(get("0000", "708111")!.median, 2.272);
  assert.equal(get("0000", "708111@y1")!.median, 3.488);
  assert.equal(get("0000", "708111@m1")!.median, 2.272);
  assert.equal(get("0000", "717311@y1")!.median, 9.139);
  assert.equal(get("0000", "717311@m1")!.median, 9.299);
  assert.equal(get("0300", "708111")!.median, 2.368);
  assert.equal(get("0100", "708111"), undefined, "the Northeast egg series has no September 2026 price");
  assert.equal(get("0200", "717311"), undefined);
  for (const r of d.rows) {
    assert.ok(Number.isNaN(r.n), "BLS publishes no count: no n is stored");
    assert.equal(r.low, r.median);
    assert.equal(r.high, r.median);
  }
  assert.equal(usDailyRows(new Map()), null);
});

test("usHarvest: one download with BLS's required User-Agent, the newest month as a library day", async () => {
  const seen: { url: string; ua: string }[] = [];
  globalThis.fetch = (async (url: string, init?: { headers?: Record<string, string> }) => {
    seen.push({ url: String(url), ua: init?.headers?.["user-agent"] ?? "" });
    return new Response(AP_DATA_SAMPLE, { status: 200 });
  }) as typeof fetch;
  const h = await usHarvest();
  assert.equal(h.date, "2026-09-01");
  assert.equal(h.currency, "USD");
  assert.equal(h.rows.length, 9, "three series with a September 2026 price, each as the average, a year earlier and a month earlier");
  assert.match(h.note ?? "", /September|2026-09/);
  assert.deepEqual(seen, [{ url: "https://download.bls.gov/pub/time.series/ap/ap.data.0.Current", ua: BLS_USER_AGENT }]);
  assert.equal(BLS_USER_AGENT, "ProofPrice/1.0 (hello@proofprice.com)");

  globalThis.fetch = (async () => new Response("Forbidden", { status: 403 })) as typeof fetch;
  await assert.rejects(usHarvest(), /HTTP 403/);
  globalThis.fetch = (async () => new Response("nothing useful here\n", { status: 200 })) as typeof fetch;
  await assert.rejects(usHarvest(), /no usable monthly prices/);
});

test("the item table matches the real BLS lists: every code is an item, priced nationally this month; words find the right item", () => {
  const seen = new Set<string>();
  for (const d of ITEMS) {
    assert.ok(AP_ITEM_NAMES[d.code] && AP_ITEM_NAMES[d.code] !== "?", `${d.code} (${d.label}) is not in ap.item`);
    assert.ok(AP_LIVE_NATIONAL.includes(d.code), `${d.code} (${d.label}) has no U.S. city average price for September 2026`);
    assert.ok(!seen.has(d.code), `${d.code} listed twice`);
    seen.add(d.code);
    assert.ok(d.unit.startsWith("per "), `${d.code}: unit should start with "per "`);
    assert.ok(d.words.length > 0);
    assert.ok(Array.isArray(AP_LIVE_REGIONS[d.code]));
  }
  const code = (w: string) => matchItem(ITEMS, w).primary?.code;
  assert.equal(code("eggs"), "708111");
  assert.equal(code("a dozen eggs"), "708111");
  assert.equal(code("milk"), "709112");
  assert.equal(code("low fat milk"), "FJ1101");
  assert.equal(code("bread"), "702111");
  assert.equal(code("coffee"), "717311");
  assert.equal(code("butter"), "FS1101");
  assert.equal(code("cheese"), "710212");
  assert.equal(code("chicken"), "706111");
  assert.equal(code("beef mince"), "703112");
  assert.equal(code("bananas"), "711211");
  assert.equal(code("potatoes"), "712112");
  assert.equal(code("rice"), "701312");
  assert.equal(code("pasta"), "701322");
  assert.equal(code("sugar"), "715211");
  assert.equal(code("beer"), "720111");
  assert.equal(code("wine"), "720311");
  assert.equal(code("tea"), undefined, "BLS no longer prices tea");
  assert.equal(code("apples"), undefined, "BLS no longer prices apples");
  assert.equal(code("gasoline"), undefined, "fuel belongs to the fuel tool");
  assert.ok(exampleWords(ITEMS).includes("eggs"));
});

test("resolveArea: none is the national average, regions by name, states map to their region, anything else is an error", () => {
  assert.equal(resolveArea().area.code, "0000");
  assert.equal(resolveArea("US").area.code, "0000");
  assert.equal(resolveArea("United States").area.code, "0000");
  assert.equal(resolveArea("South").area.code, "0300");
  assert.equal(resolveArea("Northeast region").area.code, "0100");
  assert.equal(resolveArea("mid-west").area.code, "0200");
  const tx = resolveArea("Texas");
  assert.equal(tx.area.code, "0300");
  assert.match(tx.note ?? "", /four regions, not states: "Texas" is in the South region/);
  assert.equal(resolveArea("California").area.code, "0400");
  assert.equal(resolveArea("New York").area.code, "0100");
  assert.equal(resolveArea("Ohio").area.code, "0200");
  assert.throws(() => resolveArea("Narnia"), /region must be one of/);
  assert.equal(AREAS.length, 5);
});

/** A library holding the harvest of the real sample. */
function fillLibrary() {
  const d = usDailyRows(series())!;
  writeDaily(INFO.id, { date: `${d.month}-01`, currency: "USD", unit: "x", rows: d.rows });
  writeMeta(INFO.id, { source: INFO.id, currency: "USD", unit: "x", first_date: `${d.month}-01`, last_date: `${d.month}-01`, days: 1, last_harvest_at: null, last_rows: d.rows.length, last_ok_at: null, last_error: null });
}

test("answer: US eggs is an official average with the item definition, month and year-on-year change", async () => {
  fillLibrary();
  const a = await usBlsPrices({ item: "eggs", today: TODAY });
  assert.equal(a.status, "ok");
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.price?.currency, "USD");
  assert.equal(a.price?.value, 2.272);
  assert.equal(a.price?.measure, "average");
  assert.equal(a.price?.median, null);
  assert.equal(a.price?.typical_low, null);
  assert.equal(a.sample_size, null, "BLS publishes no count of quotes; the library placeholder must never leak");
  assert.equal(a.price?.unit, "per dozen");
  assert.deepEqual(a.period, { from: "2026-09-01", to: "2026-09-30" });
  assert.equal(a.statistic?.reference_period, "2026-09");
  assert.equal(a.statistic?.note, undefined);
  assert.equal(a.source.id, "us-bls-average-prices");
  assert.match(a.source.licence, /public domain/i);
  assert.match(a.source.licence_url, /^https:\/\/www\.bls\.gov\//);
  assert.match(a.summary, /"Eggs, grade A, large, per dozen"/);
  assert.match(a.summary, /\$2\.27 in September 2026/);
  assert.match(a.summary, /34\.9% lower than a year earlier \(\$3\.49 in September 2025\)/);
  assert.match(a.summary, /not receipts/);
  const x = a.extra as any;
  assert.equal(x.item.series_id, "APU0000708111");
  assert.equal(x.change_on_year_earlier.change_percent, -34.9);
  assert.equal(x.change_on_year_earlier.change_amount, -1.216);
  assert.equal(x.change_on_previous_month.change_percent, 0);
  assert.deepEqual(x.other_areas.map((o: any) => [o.code, o.value]), [["0300", 2.368]], "only areas with a current price are listed");
});

test("answer: US coffee (national only) and a region that has no current price for it", async () => {
  fillLibrary();
  const a = await usBlsPrices({ item: "coffee", today: TODAY });
  assert.equal(a.status, "ok");
  assert.equal(a.price?.value, 9.332);
  assert.equal(a.price?.unit, "per lb (453.6 g)");
  assert.match(a.summary, /\$9\.33 in September 2026/);
  assert.match(a.summary, /2\.1% higher than a year earlier \(\$9\.14 in September 2025\)/);
  const mw = await usBlsPrices({ item: "coffee", region: "Midwest", today: TODAY });
  assert.equal(mw.status, "no_matches");
  assert.equal(mw.price, null);
  assert.match(mw.summary, /no recent "Coffee, 100% ground roast, all sizes, per lb \(453\.6 g\)" price for the Midwest region; try the U\.S\. city average/);
});

test("answer: a region (or a state) gets its own figure and the note says which region", async () => {
  fillLibrary();
  const south = await usBlsPrices({ item: "eggs", region: "South", today: TODAY });
  assert.equal(south.status, "ok");
  assert.equal(south.price?.value, 2.368);
  assert.match(south.summary, /In the South region of the United States/);
  assert.match(south.summary, /\$2\.37 in September 2026/);
  assert.equal((south.extra as any).area.code, "0300");
  assert.equal((south.extra as any).change_on_year_earlier.change_percent, -25.3);
  const texas = await usBlsPrices({ item: "eggs", region: "Texas", today: TODAY });
  assert.equal(texas.price?.value, 2.368);
  assert.match(texas.statistic?.note ?? "", /Texas" is in the South region/);
  await assert.rejects(usBlsPrices({ item: "eggs", region: "Narnia" }), /region must be one of/);
});

test("answer: an item BLS does not price is no_matches with a list of what it does; an empty item is an error", async () => {
  fillLibrary();
  const a = await usBlsPrices({ item: "caviar", today: TODAY });
  assert.equal(a.status, "no_matches");
  assert.match(a.summary, /no standard item for "caviar"/);
  assert.ok(((a.extra as any).available_items as string[]).includes("eggs"));
  const tea = await usBlsPrices({ item: "tea", today: TODAY });
  assert.equal(tea.status, "no_matches");
  await assert.rejects(usBlsPrices({ item: "  " }), /item is required/);
});

test("answer: old data is flagged plainly", () => {
  fillLibrary();
  const m = matchItem(ITEMS, "eggs");
  const reading = readUsReading("708111", AREAS[0], "2026-09-01")!;
  assert.ok(reading);
  const old = usAnswer(reading, m.primary, m.related, { item: "eggs", today: new Date("2027-03-01T00:00:00Z") });
  assert.match(old.statistic?.note ?? "", /Old data/);
  assert.match(old.summary, /Old data/);
  const fresh = usAnswer(reading, m.primary, m.related, { item: "eggs", today: TODAY });
  assert.equal(fresh.statistic?.note, undefined);
});

test("answer: before the first collection there is an honest error, not a guess", async () => {
  const empty = mkdtempSync(path.join(tmpdir(), "pp-us-bls-empty-"));
  const previous = process.env.PROOFPRICE_LIBRARY_DIR;
  process.env.PROOFPRICE_LIBRARY_DIR = empty;
  try {
    await assert.rejects(usBlsPrices({ item: "eggs" }), /collects the BLS average prices daily/);
  } finally {
    process.env.PROOFPRICE_LIBRARY_DIR = previous;
  }
});

test("manifest: United States, category groceries, harvest present, first example is the eggs smoke test", () => {
  assert.equal(manifest.category, "groceries");
  assert.deepEqual(manifest.countries, ["US"]);
  assert.deepEqual(manifest.examples[0].params, { country: "US", item: "eggs" });
  assert.deepEqual(manifest.examples[1].params, { country: "US", item: "coffee" });
  assert.equal(manifest.info, INFO);
  assert.equal(typeof manifest.harvest, "function");
  assert.equal(INFO.price_type, "official_statistic");
  assert.match(INFO.licence, /public domain/i);
});

import { usMonthly, usHistoryKey } from "./source";
import { test as histTest } from "node:test";
import histAssert from "node:assert/strict";

histTest("history: monthly rows per series within the range, no record count", () => {
  const s = new Map([
    ["0000|708111", new Map([["2020-01", 1.5], ["2020-02", 1.6], ["2020-03", 1.7]])],
    ["0100|708111", new Map([["2020-02", 1.8]])],
  ]);
  const p = usMonthly(s as never, "2020-02", "2020-03");
  histAssert.deepEqual(p.map((x) => x.period), ["2020-02", "2020-03"]);
  histAssert.equal(p[0].rows.length, 2);
  histAssert.equal(p[0].rows[0].median, 1.6);
  histAssert.equal(p[0].rows[0].low, 1.6);
});

histTest("history key: item code and area, null for unknown", () => {
  histAssert.equal(usHistoryKey({ item: "eggs" })?.item, "708111");
  histAssert.equal(usHistoryKey({ item: "eggs" })?.area, "0000");
  histAssert.equal(usHistoryKey({ item: "eggs", region: "Texas" })?.area, "0300");
  histAssert.equal(usHistoryKey({ item: "unobtainium" }), null);
  histAssert.equal(usHistoryKey({ item: "eggs", region: "Narnia" }), null);
});
