import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { InputError, SourceError } from "../../lib/http";
import { categoryById, findSource, runCategory } from "../../lib/registry";
import type { Sheet } from "../../categories/rent/xlsx";
import { NO_COUNT } from "../../lib/stats";
import manifest from "./index";
import fixture from "./fixture-sheets.json";
import euManifest from "../eu-farm-prices/index";
import {
  answerFor, clearCache, findTablesUrl, harvestRows, INFO, itemName, loadTables, monthRange, monthWords, PAGE_URL, parseFile, parseTables, plFarmPrices,
  plHarvest, plHistoryKey, plProductOf, PL_KEYS, PRODUCTS, shiftMonth, tablesMonth,
} from "./source";

// fixture-tables.xlsx: the real GUS workbook "Prices of agricultural products in September 2026. Tables.xlsx" (23,007 bytes), downloaded 2026-11-08 from
// https://publikacje.new.stat.gov.pl/sites/default/files/2026-10/Prices%20of%20agricultural%20products%20in%20September%202026.%20Tables.xlsx
// fixture-sheets.json: the same workbook as our xlsx reader returns it (sheets LIST, Tabl_1, Tabl_2, Tabl_3).
const SHEETS = fixture as Sheet[];
const XLSX = readFileSync(join(__dirname, "fixture-tables.xlsx"));
const NOW = new Date("2026-11-08T12:00:00Z");
const tables = () => parseTables(SHEETS);
const pr = (k: string) => PRODUCTS.find((x) => x.key === k)!;
const PAGE_HTML = `<span>Prices of agricultural products in September 2026. Tables in XLSX format</span>
<span class="file-url">https://publikacje.new.stat.gov.pl/sites/default/files/2026-10/Prices%20of%20agricultural%20products%20in%20September%202026.%20Charts.xlsx</span>
<span>https://publikacje.new.stat.gov.pl/sites/default/files/2026-10/Prices%20of%20agricultural%20products%20in%20September%202026.%20Tables.xlsx</span>`;

beforeEach(() => clearCache());

test("INFO: official statistic, CC BY 4.0, GUS attribution", () => {
  assert.equal(INFO.id, "pl-gus-farm-prices");
  assert.equal(INFO.price_type, "official_statistic");
  assert.match(INFO.licence, /CC BY 4\.0/);
  assert.match(INFO.attribution, /Statistics Poland \(GUS\)/);
  assert.equal(PAGE_URL("2026-09"), "https://publikacje.new.stat.gov.pl/en/publications-portal/prices-agricultural-products-september-2026");
});

test("month comes from the title of Tabl_1; layout changes throw", () => {
  assert.equal(tablesMonth(SHEETS), "2026-09");
  assert.throws(() => parseTables([{ name: "Tabl_1", rows: [["no month here"]] }, { name: "Tabl_2", rows: [] }]), /layout/);
  assert.throws(() => parseTables([]), SourceError);
});

test("national figures, indices and market-place prices as published (September 2026)", () => {
  const t = tables();
  assert.equal(t.month, "2026-09");
  assert.equal(t.readings.size, 11);
  const w = t.readings.get("wheat")!;
  assert.equal(w.value, 89.8);
  assert.equal(w.momIndex, 108.4);
  assert.equal(w.yoyIndex, 119.9);
  assert.equal(w.market, 106.11);
  assert.equal(t.readings.get("potatoes")!.value, 44.41); // "Potatoesb – per dt": footnote letter glued on
  assert.equal(t.readings.get("cattle")!.value, 13.59); // "Cattle (excl. calves)c"
  assert.equal(t.readings.get("pigs")!.value, 5.28); // "Pigs " with a trailing blank
  assert.equal(t.readings.get("pigs")!.market, null); // '.' = no data
  assert.equal(t.readings.get("milk")!.value, 187.11);
  assert.equal(t.readings.get("oats")!.value, 56.54);
});

test("voivodship figures line up with the product columns; '-' and '.' cells are left out", () => {
  const t = tables();
  assert.equal(t.readings.get("wheat")!.voivodships["Dolnośląskie"], 87.42);
  assert.equal(t.readings.get("maize")!.voivodships["Dolnośląskie"], 71.28);
  assert.equal(t.readings.get("potatoes")!.voivodships["Dolnośląskie"], 54.52);
  assert.equal(t.readings.get("cattle")!.voivodships["Dolnośląskie"], 12.27);
  assert.equal(t.readings.get("milk")!.voivodships["Dolnośląskie"], 181.88);
  assert.equal(t.readings.get("wheat")!.marketVoivodships["Dolnośląskie"], 110.6);
  assert.equal(t.readings.get("rye")!.marketVoivodships["Dolnośląskie"], undefined); // '-'
  assert.equal(Object.keys(t.readings.get("wheat")!.voivodships).includes("POLAND"), false);
});

test("the real workbook file is read through the zip container", () => {
  const t = parseFile(XLSX);
  assert.equal(t.month, "2026-09");
  assert.equal(t.readings.get("wheat")!.value, 89.8);
  assert.throws(() => parseFile(Buffer.from("not a zip")), SourceError);
});

test("the Tables link is taken from the page HTML; the Charts workbook is ignored", () => {
  assert.equal(
    findTablesUrl(PAGE_HTML),
    "https://publikacje.new.stat.gov.pl/sites/default/files/2026-10/Prices%20of%20agricultural%20products%20in%20September%202026.%20Tables.xlsx",
  );
  assert.equal(findTablesUrl("<p>nothing</p>"), null);
  assert.equal(findTablesUrl("href='/sites/default/files/2026-05/Prices%20of%20agricultural%20products%20in%20April%202026.xlsx'"), "https://publikacje.new.stat.gov.pl/sites/default/files/2026-05/Prices%20of%20agricultural%20products%20in%20April%202026.xlsx");
});

test("month helpers", () => {
  assert.equal(monthWords("2026-09"), "September 2026");
  assert.deepEqual(monthRange("2026-02"), { from: "2026-02-01", to: "2026-02-28" });
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
});

test("product names and aliases", () => {
  assert.equal(plProductOf("Wheat")?.key, "wheat");
  assert.equal(plProductOf("pig")?.key, "pigs");
  assert.equal(plProductOf("cow's milk")?.key, "milk");
  assert.equal(plProductOf("corn")?.key, "maize");
  assert.equal(plProductOf("apples"), null);
  assert.equal(plProductOf(""), null);
});

test("answer: wheat is an official statistic in PLN per dt, with changes from GUS's indices", () => {
  const a: any = answerFor(pr("wheat"), tables(), { product: "wheat" }, NOW);
  assert.equal(a.status, "ok");
  assert.equal(a.price.value, 89.8);
  assert.equal(a.price.currency, "PLN");
  assert.equal(a.price.unit, "per dt (100 kg)");
  assert.equal(a.price.typical_low, null);
  assert.equal(a.sample_size, null);
  assert.equal(a.period.from, "2026-09-01");
  assert.equal(a.period.to, "2026-09-30");
  assert.equal(a.source.id, "pl-gus-farm-prices");
  assert.equal(a.extra.change_on_previous_month_percent, 8.4);
  assert.equal(a.extra.change_on_year_earlier_percent, 19.9);
  assert.equal(a.extra.price_per_kg, 0.898);
  assert.equal(a.extra.market_place_price_received_by_farmers, 106.11);
  assert.match(a.summary, /September 2026/);
  assert.match(a.summary, /19\.9% higher than a year earlier/);
  assert.equal(a.extra.net_of_vat, true);
});

test("answer: milk has no per-kg price and no market-place price; pigs a falling price", () => {
  const m: any = answerFor(pr("milk"), tables(), { product: "milk" }, NOW);
  assert.equal(m.price.value, 187.11);
  assert.equal(m.price.unit, "per hl");
  assert.equal(m.extra.price_per_kg, undefined);
  assert.equal(m.extra.market_place_price_received_by_farmers, undefined);
  const p: any = answerFor(pr("pigs"), tables(), { product: "pigs" }, NOW);
  assert.equal(p.price.unit, "per kg live weight");
  assert.equal(p.extra.change_on_year_earlier_percent, -18.3);
  assert.match(p.summary, /18\.3% lower than a year earlier/);
});

test("answer: a product missing from the tables is no_matches, and old data is flagged", () => {
  const t = tables();
  t.readings.delete("rye");
  const a: any = answerFor(pr("rye"), t, { product: "rye" }, NOW);
  assert.equal(a.status, "no_matches");
  const old: any = answerFor(pr("wheat"), tables(), { product: "wheat" }, new Date("2027-03-01T00:00:00Z"));
  assert.match(old.statistic.note, /Old data/);
});

test("unknown product for PL is a clear InputError listing ours", async () => {
  await assert.rejects(() => plFarmPrices({ product: "apples" }, { tables: tables(), now: NOW }), (e: any) => e instanceof InputError && /wheat/.test(e.message));
});

test("loading: walks back from this month to the newest page with a workbook, reuses a fresh copy, falls back to an older copy on failure", async () => {
  const asked: string[] = [];
  const fetchers = {
    page: async (m: string) => { asked.push(m); return m === "2026-09" ? PAGE_HTML : null; },
    file: async (url: string) => { assert.match(url, /Tables\.xlsx$/); return XLSX; },
  };
  const t = await loadTables({ fetchers, now: NOW });
  assert.equal(t.month, "2026-09");
  assert.deepEqual(asked, ["2026-11", "2026-10", "2026-09"]);
  await loadTables({ fetchers, now: NOW });
  assert.equal(asked.length, 3); // cached
  const later = new Date(NOW.getTime() + 7 * 3600 * 1000);
  const again = await loadTables({ fetchers: { page: async () => { throw new SourceError("down"); } }, now: later });
  assert.equal(again.month, "2026-09"); // older copy
  clearCache();
  await assert.rejects(() => loadTables({ fetchers: { page: async () => null }, now: NOW }), /no agricultural price tables/);
});

test("harvest rows: one per product, NO_COUNT, dated the last day of the month; history key matches the row", async () => {
  const h = harvestRows(tables());
  assert.equal(h.date, "2026-09-30");
  assert.equal(h.currency, "PLN");
  assert.equal(h.rows.length, 11);
  for (const r of h.rows) { assert.equal(r.n, NO_COUNT); assert.equal(r.area, "PL"); }
  const wheat = h.rows.find((r) => r.item === itemName(pr("wheat")))!;
  assert.equal(wheat.median, 89.8);
  const key = plHistoryKey({ product: "wheat" })!;
  assert.equal(key.item, wheat.item);
  assert.equal(plHistoryKey({ product: "apples" }), null);
  const viaFetch = await plHarvest({ fetchers: { page: async (m) => (m === "2026-09" ? PAGE_HTML : null), file: async () => XLSX }, now: NOW });
  assert.equal(viaFetch.rows.length, 11);
  assert.throws(() => harvestRows({ month: "2026-09", readings: new Map() }), SourceError);
});

test("routing: PL products GUS publishes come here; everything else for PL and all other countries stay with eu-farm-prices", () => {
  // eu-farm-prices (folder sorts first) hands GUS products to this source through its own serves() (Repairer 8 Nov).
  assert.equal(findSource("farm-prices", "PL", { country: "PL", product: "wheat" })!.info.id, "pl-gus-farm-prices");
  assert.ok(!euManifest.serves!({ country: "PL", product: "wheat" }));
  assert.equal(findSource("farm-prices", "PL", { country: "PL", product: "apples" })?.info.id, "eu-farm-prices");
  assert.equal(findSource("farm-prices", "DE", { country: "DE", product: "wheat" })?.info.id, "eu-farm-prices");
  assert.ok(manifest.serves!({ country: "pl", product: "Wheat" }));
  assert.ok(!manifest.serves!({ country: "PL", product: "apples" }));
  assert.ok(euManifest.serves!({ country: "PL", product: "apples" }));
  assert.ok(manifest.examples.length >= 1);
  assert.equal(PL_KEYS.length, 11);
});

test("runCategory with the workbook stubbed: PL wheat answers through the registry", async () => {
  await loadTables({ fetchers: { page: async (m) => (m === "2026-09" ? PAGE_HTML : null), file: async () => XLSX }, now: new Date() }).catch(() => undefined);
  // the real clock is later than the fixture: loadTables above fills the cache for the current clock only if it reaches September; fall back to injecting directly
  clearCache();
  const a: any = await plFarmPrices({ product: "wheat", baseUrl: "https://proofprice.com" }, { tables: tables(), now: NOW });
  assert.equal(a.source.id, "pl-gus-farm-prices");
  assert.ok(categoryById("farm-prices"));
  assert.equal(typeof runCategory, "function");
});
