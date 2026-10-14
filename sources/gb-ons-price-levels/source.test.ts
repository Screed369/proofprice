// Tests for the UK ONS price level distributions. The fixture rows are real ONS data captured on 2026-10-14 (see fixtures.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { exampleWords, matchItem } from "../../categories/groceries/items";
import { writeDaily } from "../../lib/library/store";
import type { LibraryRow } from "../../lib/library/store";
import type { HarvestResult } from "../../lib/plugin";
import { ONS_SEARCH_JSON, PLD_EGGS_REGIONS, PLD_NATIONAL, PLD_PRODUCTS, PLD_WITHHELD, pldSheets } from "./fixtures";
import {
  CURATED, HarvestIo, INFO, MIN_OBSERVATIONS, REGIONS, contentUrlFromPage, defsFor, fileUrl, gbHarvest, gbOnsPriceLevels, indexDay, monthWords, monthsBehind, parsePriceLevels,
  prettyName, releasesFromSearch, resolveRegion, sizeWords, unitFor,
} from "./source";
import manifest from "./index";

// The price library is read at call time from this folder, so the tests never touch the real library/.
process.env.PROOFPRICE_LIBRARY_DIR = mkdtempSync(path.join(tmpdir(), "pp-gb-ons-"));

const TODAY = new Date("2026-10-14T12:00:00Z");
const ALL_ROWS = [...PLD_NATIONAL, ...PLD_EGGS_REGIONS, ...PLD_WITHHELD];
const parsed = () => parsePriceLevels(pldSheets(ALL_ROWS));
const AUGUST_URL = "https://www.ons.gov.uk/file?uri=/economy/inflationandpriceindices/adhocs/3607consumerpricespriceleveldistributionsmicrodataaugust2026/consumerpricespriceleveldistributionsmicrodata202608.xlsx";

test("search: the real ONS response lists three monthly releases, newest first, with the workbook address", () => {
  const rel = releasesFromSearch(JSON.parse(ONS_SEARCH_JSON));
  assert.deepEqual(rel.map((r) => r.month), ["2026-08", "2026-07", "2026-06"]);
  assert.equal(rel[0].uri, "/economy/inflationandpriceindices/adhocs/3607consumerpricespriceleveldistributionsmicrodataaugust2026");
  assert.equal(rel[0].title, "Consumer Prices Price Level Distributions Microdata: August 2026");
  assert.equal(rel[0].released, "2026-09-22T23:00:00.000Z");
  assert.equal(fileUrl(rel[0]), AUGUST_URL);
  // other pages and malformed answers are ignored
  assert.deepEqual(releasesFromSearch({ items: [{ uri: "/economy/other/adhocs/12cpiaveragefoodpricedatafordecember2020", title: "x" }, { title: "no uri" }, null] }), []);
  assert.deepEqual(releasesFromSearch(null), []);
  assert.deepEqual(releasesFromSearch({ items: "nope" }), []);
});

test("search: a page's structured data can name the download when the usual file name changes", () => {
  const html = `"distribution":[ { "@type":"DataDownload", "encodingFormat":"xlsx", "contentUrl": "${AUGUST_URL}" } ], "license": "http://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/"`;
  assert.equal(contentUrlFromPage(html), AUGUST_URL);
  assert.equal(contentUrlFromPage("<html>nothing</html>"), null);
});

test("parsePriceLevels: medians with quartiles and extremes, the mean as a second row, withheld rows skipped, other tabs ignored", () => {
  const p = parsed();
  assert.equal(p.month, "2026-08");
  assert.equal(p.products, 17);
  assert.equal(p.withheld, 5, "3 eggs areas plus 2 bread rows are [x]");
  assert.equal(p.rows.length, 17 * 2 + 9 * 2, "17 national products and 9 published egg regions, each as median and mean");
  const get = (area: string, item: string) => p.rows.find((r) => r.area === area && r.item === item);
  assert.deepEqual(get("ALL", "EGGS - FREE-RANGE|12 pack"), { area: "ALL", item: "EGGS - FREE-RANGE|12 pack", n: MIN_OBSERVATIONS, median: 3.4, low: 2.98, high: 4.2, min: 2.49, max: 7.3 });
  assert.equal(get("ALL", "EGGS - FREE-RANGE|12 pack@mean")!.median, 3.5331);
  assert.equal(get("E12000007", "EGGS - FREE-RANGE|12 pack")!.median, 3.38);
  assert.equal(get("S99999999", "EGGS - FREE-RANGE|12 pack")!.max, 6);
  assert.equal(get("W99999999", "EGGS - FREE-RANGE|12 pack"), undefined, "Wales is [x]");
  assert.equal(get("E12000001", "EGGS - FREE-RANGE|12 pack"), undefined, "North East is [x]");
  assert.equal(get("E12000007", "BREAD - GLUTEN-FREE OR PREMIUM (E.G. SOURDOUGH)|400 g"), undefined);
  assert.equal(get("ALL", "MILK - COW'S (WHOLE, FRESH)|2272 ml")!.median, 1.75);
  assert.ok(p.rows.every((r) => r.n >= 5), "rows must clear the library minimum or writeDaily drops them");
  assert.ok(p.rows.every((r) => r.low <= r.median + 1e-9 || r.item.endsWith("@mean")));
});

test("parsePriceLevels: the newest month wins, missing columns are an error, an empty workbook gives no rows", () => {
  const sheets = pldSheets(PLD_NATIONAL);
  const older = PLD_NATIONAL[0].replace("|202608|", "|202607|");
  const mixed = parsePriceLevels(pldSheets([older, ...PLD_NATIONAL]));
  assert.equal(mixed.month, "2026-08");
  assert.equal(mixed.products, 17);
  const broken = pldSheets(PLD_NATIONAL);
  broken[3].rows[2] = broken[3].rows[2].map((c) => (c === "Q3" ? "Q3_RENAMED" : c));
  assert.throws(() => parsePriceLevels(broken), /lacks columns: Q3/);
  assert.equal(parsePriceLevels([{ name: "Notes", rows: [["Notes"]] }]).rows.length, 0);
  assert.equal(sheets.length, 8);
});

test("harvest: finds the newest release, downloads its workbook, returns one library month", async () => {
  const asked: string[] = [];
  const io: HarvestIo = {
    search: async () => JSON.parse(ONS_SEARCH_JSON),
    workbook: async (url) => (asked.push(url), pldSheets(ALL_ROWS)),
    page: async () => {
      throw new Error("page must not be needed");
    },
  };
  const h = await gbHarvest(io);
  assert.deepEqual(asked, [AUGUST_URL]);
  assert.equal(h.date, "2026-08-01");
  assert.equal(h.currency, "GBP");
  assert.equal(h.rows.length, 52);
  assert.match(h.note ?? "", /17 product types/);
  assert.match(h.note ?? "", /5 product-area rows were withheld/);
});

test("harvest: if the usual file name fails it uses the address in the page; if the newest month fails it falls back to the one before", async () => {
  const asked: string[] = [];
  const julyOnly: HarvestIo = {
    search: async () => JSON.parse(ONS_SEARCH_JSON),
    workbook: async (url) => (asked.push(url), url.includes("202607") ? pldSheets(ALL_ROWS.map((r) => r.replace("|202608|", "|202607|"))) : null),
    page: async () => "no structured data here",
  };
  const h = await gbHarvest(julyOnly);
  assert.equal(h.date, "2026-07-01");
  assert.ok(asked[0].includes("202608") && asked[asked.length - 1].includes("202607"));

  const viaPage: HarvestIo = {
    search: async () => JSON.parse(ONS_SEARCH_JSON),
    workbook: async (url) => (url === AUGUST_URL ? null : url === "https://www.ons.gov.uk/file?uri=/moved/new-name.xlsx" ? pldSheets(ALL_ROWS) : null),
    page: async () => `"contentUrl": "https://www.ons.gov.uk/file?uri=/moved/new-name.xlsx"`,
  };
  assert.equal((await gbHarvest(viaPage)).date, "2026-08-01");

  const none: HarvestIo = { search: async () => JSON.parse(ONS_SEARCH_JSON), workbook: async () => null, page: async () => "" };
  await assert.rejects(gbHarvest(none), /Could not read an ONS price level distributions workbook/);
  await assert.rejects(gbHarvest({ ...none, search: async () => ({ items: [] }) }), /lists no price level distributions release/);
});

test("the word table matches the real workbook: every ONS name exists, no name twice; units come from the pack size", () => {
  const real = new Set(PLD_PRODUCTS.map((p) => p.split("|")[1]));
  assert.equal(real.size, 203);
  const seen = new Set<string>();
  for (const d of CURATED) {
    assert.ok(real.has(d.code), `${d.code} (${d.label}) is not a product of the ONS workbook`);
    assert.ok(!seen.has(d.code), `${d.code} listed twice`);
    seen.add(d.code);
    assert.ok(d.words.length > 0 && d.label.length > 2);
  }
  assert.ok(CURATED.length >= 90);
  assert.equal(sizeWords("12 pack"), "pack of 12");
  assert.equal(sizeWords("1000 g"), "1 kg");
  assert.equal(sizeWords("1500 g"), "1500 g");
  assert.equal(sizeWords("750 g"), "750 g");
  assert.equal(sizeWords("2272 ml"), "2272 ml (4 pints)");
  assert.equal(sizeWords("1136 ml"), "1136 ml (2 pints)");
  assert.equal(sizeWords("1000 ml"), "1 litre");
  assert.equal(sizeWords("2000 ml"), "2 litres");
  assert.equal(sizeWords("5000 ml"), "5 litres");
  assert.equal(sizeWords("375 ml"), "375 ml");
  assert.equal(sizeWords("each"), "each");
  assert.equal(unitFor("each"), "each");
  assert.equal(unitFor("6 pack"), "per pack of 6");
  assert.equal(unitFor("1000 g"), "per kg");
  assert.equal(prettyName("OIL - RAPESEED"), "Oil, rapeseed");
  assert.equal(prettyName("BEER - MILD (E.G. BITTER, PALE ALE, IPAS)"), "Beer, mild (e.g. bitter, pale ale, IPAs)");
});

test("everyday words find the right ONS product; products without an everyday-word entry are found by their ONS names", () => {
  const held = indexDay({
    date: "2026-08-01",
    rows: [
      ...CURATED.map((d) => ({ date: "2026-08-01", area: "ALL", item: `${d.code}|1000 g`, n: 10, median: 1, low: 1, high: 1, min: 1, max: 1 })),
      { date: "2026-08-01", area: "ALL", item: "RICE CAKES|150 g", n: 10, median: 1.65, low: 1.4, high: 1.9, min: 0.59, max: 5.11 }, // synthetic: only to test the fallback
    ] as LibraryRow[],
  });
  const defs = defsFor(held);
  const code = (w: string) => matchItem(defs, w).primary?.code;
  assert.equal(code("eggs"), "EGGS - FREE-RANGE");
  assert.equal(code("a dozen eggs"), "EGGS - FREE-RANGE");
  assert.equal(code("milk"), "MILK - COW'S (WHOLE, FRESH)");
  assert.equal(code("semi-skimmed milk"), "MILK - COW'S (SEMI-SKIMMED, FRESH)");
  assert.equal(code("skimmed milk"), "MILK - COW'S (SEMI-SKIMMED, FRESH)");
  assert.equal(code("bread"), "BREAD - SLICED WHITE");
  assert.equal(code("brown bread"), "BREAD - SLICED WHOLEMEAL OR BROWN");
  assert.equal(code("butter"), "BUTTER - DAIRY (BLOCK OR TUB)");
  assert.equal(code("cheese"), "CHEESE - CHEDDAR");
  assert.equal(code("chicken"), "CHICKEN - WHOLE");
  assert.equal(code("chicken breast"), "CHICKEN - FILLET OR STEAK");
  assert.equal(code("beef mince"), "BEEF - MINCED OR DICED");
  assert.equal(code("bananas"), "BANANAS");
  assert.equal(code("apples"), "APPLES - NOT COOKING");
  assert.equal(code("potatoes"), "POTATOES - WHITE");
  assert.equal(code("rice"), "RICE - BASMATI OR JASMINE");
  assert.equal(code("pasta"), "PASTA - DRY");
  assert.equal(code("coffee"), "COFFEE - INSTANT");
  assert.equal(code("tea"), "TEA - UNFLAVOURED, BAGS");
  assert.equal(code("sugar"), "SUGAR - WHITE");
  assert.equal(code("beer"), "BEER - LAGER");
  assert.equal(code("wine"), "WINE - RED");
  assert.equal(code("white wine"), "WINE - WHITE");
  assert.equal(code("rice cakes"), "RICE CAKES", "a product without an everyday-word entry is found by its ONS name");
  assert.equal(code("caviar"), undefined);
  assert.ok(matchItem(defs, "milk").related.some((d) => d.code === "MILK - OAT"));
  assert.ok(exampleWords(defs).includes("eggs"));
});

test("resolveRegion: UK by default, regions and nations by name, cities map to their region with a note, England as a whole is refused", () => {
  assert.equal(resolveRegion().region.code, "ALL");
  assert.equal(resolveRegion("UK").region.code, "ALL");
  assert.equal(resolveRegion("United Kingdom").region.code, "ALL");
  assert.equal(resolveRegion("Wales").region.code, "W99999999");
  assert.equal(resolveRegion("scotland").region.code, "S99999999");
  assert.equal(resolveRegion("Northern Ireland").region.code, "N99999999");
  assert.equal(resolveRegion("London").region.code, "E12000007");
  assert.equal(resolveRegion("North West").region.code, "E12000002");
  assert.equal(resolveRegion("Yorkshire and the Humber").region.code, "E12000003");
  assert.equal(resolveRegion("North East").note, undefined);
  const m = resolveRegion("Manchester");
  assert.equal(m.region.code, "E12000002");
  assert.match(m.note ?? "", /regions and nations, not cities or counties: "Manchester" is in North West England/);
  assert.throws(() => resolveRegion("England"), /not for England as a whole/);
  assert.throws(() => resolveRegion("Narnia"), /region must be one of/);
  assert.equal(REGIONS.length, 13);
});

test("dates: month names and the lag behind today", () => {
  assert.equal(monthWords("2026-08"), "August 2026");
  assert.equal(monthsBehind("2026-08", TODAY), 2);
  assert.equal(monthsBehind("2026-01", TODAY), 9);
});

/** A library holding the harvest of the real rows. */
function fillLibrary() {
  const p = parsed();
  const result: HarvestResult = { date: `${p.month}-01`, currency: "GBP", unit: "x", rows: p.rows };
  writeDaily(INFO.id, result);
}

test("answer: UK eggs is the official median with the product definition, month, quartiles and no year-on-year change", async () => {
  fillLibrary();
  const a = await gbOnsPriceLevels({ item: "eggs", today: TODAY });
  assert.equal(a.status, "ok");
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.price?.currency, "GBP");
  assert.equal(a.price?.value, 3.4);
  assert.equal(a.price?.measure, "median");
  assert.equal(a.price?.median, 3.4);
  assert.equal(a.price?.typical_low, null, "quartiles are not the 10th/90th percentile: they stay in extra");
  assert.equal(a.price?.typical_high, null);
  assert.equal(a.sample_size, null, "ONS publishes no count; the library placeholder must never leak");
  assert.equal(a.price?.unit, "per pack of 12");
  assert.deepEqual(a.period, { from: "2026-08-01", to: "2026-08-31" });
  assert.equal(a.statistic?.reference_period, "2026-08");
  assert.equal(a.statistic?.measure, "median");
  assert.match(a.statistic?.note ?? "", /official statistics in development/);
  assert.doesNotMatch(a.statistic?.note ?? "", /Old data/);
  assert.equal(a.source.id, "gb-ons-price-levels");
  assert.match(a.source.licence, /Open Government Licence v3\.0/);
  assert.equal(a.source.licence_url, "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/");
  assert.match(a.source.attribution, /Contains public sector information licensed under the Open Government Licence v3\.0\./);
  assert.match(a.summary, /In the United Kingdom the median shop price of "Free-range eggs, pack of 12" was £3\.40 in August 2026/);
  assert.match(a.summary, /£2\.98 to £4\.20; mean £3\.53/);
  assert.match(a.summary, /not receipts/);
  assert.match(a.summary, /no change on a year earlier is given/);
  const x = a.extra as any;
  assert.equal(x.item.ons_product_type, "EGGS - FREE-RANGE");
  assert.equal(x.item.definition, "Free-range eggs, pack of 12");
  assert.deepEqual(x.statistics, { median: 3.4, mean: 3.5331, lower_quartile: 2.98, upper_quartile: 4.2, lowest: 2.49, highest: 7.3, note: x.statistics.note });
  assert.equal(x.change_on_year_earlier, null);
  assert.match(x.change_on_year_earlier_unavailable, /should not be used for direct comparisons between months/);
  assert.equal(x.area.code, "ALL");
  assert.equal(x.other_areas.length, 9, "the nine regions and nations with a published figure");
  assert.ok(x.other_areas.some((o: any) => o.area === "London" && o.median === 3.38));
  assert.ok(!x.other_areas.some((o: any) => o.area === "Wales"));
});

test("answer: whole milk is priced per four pints; other fixture products answer too", async () => {
  fillLibrary();
  const milk = await gbOnsPriceLevels({ item: "milk", today: TODAY });
  assert.equal(milk.status, "ok");
  assert.equal(milk.price?.value, 1.75);
  assert.equal(milk.price?.unit, "per 2272 ml (4 pints)");
  assert.match(milk.summary, /"Whole milk, fresh, 2272 ml \(4 pints\)"/);
  const cheese = await gbOnsPriceLevels({ item: "cheese", today: TODAY });
  assert.equal(cheese.price?.value, 7.92);
  assert.equal(cheese.price?.unit, "per kg");
  const mince = await gbOnsPriceLevels({ item: "beef mince", today: TODAY });
  assert.equal(mince.price?.value, 10.38);
  const coffee = await gbOnsPriceLevels({ item: "coffee", today: TODAY });
  assert.equal(coffee.price?.value, 3.75);
  assert.equal(coffee.price?.unit, "per 100 g");
});

test("answer: a region gets its own figure, a city maps to its region and says so, a withheld region is explained", async () => {
  fillLibrary();
  const london = await gbOnsPriceLevels({ item: "eggs", region: "London", today: TODAY });
  assert.equal(london.status, "ok");
  assert.equal(london.price?.value, 3.38);
  assert.match(london.summary, /In London the median shop price/);
  assert.equal((london.extra as any).area.code, "E12000007");
  const leeds = await gbOnsPriceLevels({ item: "eggs", region: "Leeds", today: TODAY });
  assert.equal(leeds.price?.value, 3.3);
  assert.match(leeds.statistic?.note ?? "", /"Leeds" is in Yorkshire and the Humber/);
  const wales = await gbOnsPriceLevels({ item: "eggs", region: "Wales", today: TODAY });
  assert.equal(wales.status, "no_matches");
  assert.equal(wales.price, null);
  assert.match(wales.summary, /ONS publishes no figure for August 2026 for "Free-range eggs, pack of 12" in Wales \(it withholds figures with fewer than ten observations\); try the UK figure by leaving region out/);
  assert.ok(((wales.extra as any).available_regions as string[]).includes("London"));
  await assert.rejects(gbOnsPriceLevels({ item: "eggs", region: "Narnia" }), /region must be one of/);
});

test("answer: an item ONS does not price is no_matches with a list of what it does; an empty item is an error", async () => {
  fillLibrary();
  const a = await gbOnsPriceLevels({ item: "caviar", today: TODAY });
  assert.equal(a.status, "no_matches");
  assert.equal(a.price, null);
  assert.match(a.summary, /no product type for "caviar"/);
  assert.ok(((a.extra as any).available_items as string[]).includes("eggs"));
  await assert.rejects(gbOnsPriceLevels({ item: "   " }), /item is required/);
});

test("answer: old data is flagged plainly", async () => {
  fillLibrary();
  const old = await gbOnsPriceLevels({ item: "eggs", today: new Date("2027-03-01T00:00:00Z") });
  assert.match(old.statistic?.note ?? "", /Old data: the newest ONS file we hold is for August 2026, 7 months ago/);
  assert.match(old.summary, /Old data/);
});

test("answer: before the first collection there is an honest error, not a guess", async () => {
  const previous = process.env.PROOFPRICE_LIBRARY_DIR;
  process.env.PROOFPRICE_LIBRARY_DIR = mkdtempSync(path.join(tmpdir(), "pp-gb-ons-empty-"));
  try {
    await assert.rejects(gbOnsPriceLevels({ item: "eggs" }), /collects the ONS price level data daily/);
  } finally {
    process.env.PROOFPRICE_LIBRARY_DIR = previous;
  }
});

test("manifest: United Kingdom, category groceries, harvest present, first example is the eggs smoke test", () => {
  assert.equal(manifest.category, "groceries");
  assert.deepEqual(manifest.countries, ["GB"]);
  assert.deepEqual(manifest.examples[0].params, { country: "GB", item: "eggs" });
  assert.equal(manifest.info, INFO);
  assert.equal(typeof manifest.harvest, "function");
  assert.equal(INFO.id, "gb-ons-price-levels");
  assert.equal(INFO.price_type, "official_statistic");
  assert.match(INFO.licence, /exploit the Information commercially and non-commercially/);
});
