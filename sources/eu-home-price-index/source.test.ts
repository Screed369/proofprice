import { test } from "node:test";
import assert from "node:assert/strict";
import { parseJsonStat } from "../../lib/adapters";
import { InputError } from "../../lib/http";
import { countriesFor, SOURCE_PLUGINS } from "../../lib/registry";
import { COUNTRIES, euHomePriceIndex, hpiAnswer, HPI_FILTERS, INFO, quarterWords, readHpi, sameQuarterLastYear } from "./source";
import * as F from "./fixtures";

// Fixture: real Eurostat response captured 2026-10-20 (see fixtures.ts).
const table = () => parseJsonStat(F.HPI_ALL);

test("eu-home-price-index: licence, attribution and type are Eurostat's", () => {
  assert.equal(INFO.id, "eu-home-price-index");
  assert.equal(INFO.price_type, "official_statistic");
  assert.match(INFO.licence, /CC BY 4\.0/);
  assert.equal(INFO.licence_url, "https://ec.europa.eu/eurostat/help/copyright-notice");
  for (const k of ["Eurostat", "prc_hpi_q", "CC BY 4.0"]) assert.ok(INFO.attribution.includes(k), k);
  assert.match(INFO.limits, /not a price in euros/);
});

test("eu-home-price-index: registered for home-sales, no country shared with a national source", () => {
  const plugin = SOURCE_PLUGINS.find((s) => s.info.id === "eu-home-price-index")!;
  assert.equal(plugin.category, "home-sales");
  for (const c of ["ES", "DE", "IT", "PL"]) assert.ok(Object.keys(COUNTRIES).includes(c), c);
  for (const c of ["IE", "FR", "NL", "BE", "AT", "PT", "SE", "DK", "FI", "NO", "GB", "UK", "EL", "GR"]) assert.ok(!Object.keys(COUNTRIES).includes(c), c);
  for (const c of Object.keys(COUNTRIES)) assert.ok(countriesFor("home-sales").includes(c), c);
});

test("eu-home-price-index: reads Spain from the real fixture", () => {
  const r = readHpi(table(), "ES")!;
  assert.equal(r.latest.period, "2026-Q2");
  assert.ok(r.latest.value > 100 && r.latest.value < 400, String(r.latest.value));
  assert.equal(r.previous!.period, "2026-Q1");
  assert.equal(r.yearAgo!.period, "2025-Q2");
  assert.ok(Math.abs(r.yearAgo!.change_percent) < 40);
  assert.equal(r.datasetLatest, "2026-Q2");
});

test("eu-home-price-index: every listed country has a figure (Eurostat holds none for Greece)", () => {
  assert.equal(readHpi(table(), "GR"), null);
  for (const c of Object.keys(COUNTRIES)) assert.ok(readHpi(table(), c), c);
  assert.equal(readHpi(table(), "US"), null);
});

test("eu-home-price-index: answer is an index, labelled as such, with no range or sample size", () => {
  const a = hpiAnswer(readHpi(table(), "DE"), { country: "DE" });
  assert.equal(a.status, "ok");
  assert.equal(a.price!.currency, "INDEX");
  assert.equal(a.price!.median, null);
  assert.equal(a.price!.typical_low, null);
  assert.equal(a.sample_size, null);
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.statistic!.reference_period, "2026-Q2");
  assert.deepEqual(a.period, { from: "2026-04-01", to: "2026-06-30" });
  assert.match(a.summary, /not a price in money/);
  assert.match(a.summary, /second quarter of 2026/);
});

test("eu-home-price-index: no figure gives no_matches", () => {
  const a = hpiAnswer(null, { country: "ES" });
  assert.equal(a.status, "no_matches");
  assert.equal(a.price, null);
});

test("eu-home-price-index: period helpers", () => {
  assert.equal(sameQuarterLastYear("2026-Q2"), "2025-Q2");
  assert.equal(sameQuarterLastYear("2026"), null);
  assert.equal(quarterWords("2026-Q4"), "the fourth quarter of 2026");
});

test("eu-home-price-index: one request for the country, last 6 quarters, and bad countries are refused", async () => {
  const urls: string[] = [];
  const a = await euHomePriceIndex({ country: "es" }, { fetcher: async (u: string) => (urls.push(u), F.HPI_ALL) });
  assert.equal(a.status, "ok");
  assert.equal(urls.length, 1);
  assert.ok(urls[0].includes("prc_hpi_q?") && urls[0].includes("geo=ES") && urls[0].includes("unit=I15_Q") && urls[0].includes("lastTimePeriod=6"), urls[0]);
  assert.equal(HPI_FILTERS.purchase, "TOTAL");
  await assert.rejects(() => euHomePriceIndex({ country: "IE" }, { fetcher: async () => F.HPI_ALL }), InputError);
});
