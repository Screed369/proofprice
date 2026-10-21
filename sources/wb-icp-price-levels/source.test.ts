// Tests for the World Bank ICP 2021 price level source. Fixtures are real replies captured on 2026-10-21 (see fixtures.ts).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ICP_IRL_BREAD, ICP_SGP_HOUSEHOLD, ICP_USA_BREAD } from "./fixtures";
import { COUNTRIES, INFO, SPENDS, cached, checkCompare, clearCache, countryUrl, icpPriceLevel, matchSpend, parseIcp } from "./source";
import oecd from "../oecd-price-levels/index";
import manifest from "./index";
import { categoryById, countriesFor } from "../../lib/registry";

const urls: string[] = [];
const fake = async (url: string): Promise<any> => {
  urls.push(url);
  if (url.includes("/country/USA/series/1101110/")) return JSON.parse(ICP_USA_BREAD);
  if (url.includes("/country/IRL/series/1101110/")) return JSON.parse(ICP_IRL_BREAD);
  if (url.includes("/country/SGP/series/9100000/")) return JSON.parse(ICP_SGP_HOUSEHOLD);
  if (url.includes("/country/USA/series/9100000/")) return JSON.parse(ICP_USA_BREAD); // only used for the shape in the gap test below
  throw new Error("unexpected url " + url);
};
beforeEach(() => { clearCache(); urls.length = 0; });

test("parseIcp reads the real reply: Ireland bread and cereals 2021", () => {
  const f = parseIcp(JSON.parse(ICP_IRL_BREAD));
  assert.ok(Math.abs((f.index ?? 0) - 148.3727) < 0.001);
  assert.ok(Math.abs((f.ppp ?? 0) - 1.06821) < 0.0001);
  assert.ok(Math.abs((f.perHeadPpp ?? 0) - 278.08) < 0.01);
});

test("parseIcp: null values stay null, other shapes are refused", () => {
  const f = parseIcp({ source: { data: [{ variable: [{ concept: "Classification", id: "PX.WL" }], value: null }] } });
  assert.equal(f.index, null);
  assert.throws(() => parseIcp({ message: [{ id: "175" }] }), /shape we do not know/);
});

test("request URL: one country, one heading, 2021, JSON", () => {
  assert.equal(countryUrl("IND", "1101100"), "https://api.worldbank.org/v2/sources/90/country/IND/series/1101100/time/YR2021?format=json");
});

test("everyday words map to ICP series; unknown words list the choices", () => {
  assert.equal(matchSpend("").series, "9100000");
  assert.equal(matchSpend("Bread").series, "1101110");
  assert.equal(matchSpend("rent").series, "9060000");
  assert.equal(matchSpend("Restaurants and hotels").series, "1111000");
  assert.equal(matchSpend("cars").series, "1107100");
  assert.throws(() => matchSpend("spaceships"), /spend must be one of/);
  assert.equal(new Set(SPENDS.map((s) => s.series)).size, SPENDS.length);
});

test("compare_to: only the world average is allowed", () => {
  checkCompare(undefined); checkCompare("World");
  assert.throws(() => checkCompare("OECD"), /compare_to must be/);
});

test("replies are kept for a day, then fetched again", async () => {
  let n = 0;
  const f = async () => { n++; return {}; };
  await cached("u1", f, 1000); await cached("u1", f, 2000);
  assert.equal(n, 1);
  await cached("u1", f, 1000 + 24 * 3600 * 1000 + 1);
  assert.equal(n, 2);
});

test("Singapore, all household consumption: index 119.8, official statistic, confidence medium", async () => {
  // The USA reply for this heading is the bread capture (index 117.4): enough to check the gap arithmetic.
  const a = await icpPriceLevel({ country: "SG" }, fake);
  assert.equal(a.status, "ok");
  assert.equal(a.price?.currency, "INDEX");
  assert.equal(a.price?.value, 119.77443207286);
  assert.equal(a.price?.median, null);
  assert.equal(a.price?.typical_low, null);
  assert.equal(a.sample_size, null);
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.confidence, "medium");
  assert.equal(a.statistic?.reference_period, "2021");
  const x = a.extra as any;
  assert.equal(x.price_level_index, 119.8);
  assert.equal(x.ppp_national_currency_per_us_dollar, 1.06);
  assert.equal(x.expenditure_per_head_ppp_usd, 29336);
  assert.equal(x.percent_vs_united_states, 2);
  assert.match(a.summary, /Singapore/);
  assert.match(a.summary, /world average = 100/);
});

test("the United States reply is shared between questions through the cache", async () => {
  await icpPriceLevel({ country: "SG" }, fake);
  await icpPriceLevel({ country: "SG" }, fake);
  assert.equal(urls.length, 2);
});

test("a country with no figure answers no_matches, not a wrong number", async () => {
  const empty = { source: { data: [{ variable: [{ concept: "Classification", id: "PX.WL" }], value: null }] } };
  const a = await icpPriceLevel({ country: "SG" }, async () => empty);
  assert.equal(a.status, "no_matches");
  assert.equal(a.price, null);
});

test("an unknown country is a 400 with the list; OECD members belong to the OECD source", async () => {
  await assert.rejects(() => icpPriceLevel({ country: "ZZ" }, fake), /Not yet available/);
  await assert.rejects(() => icpPriceLevel({ country: "IE" }, fake), /Not yet available/);
  const overlap = oecd.countries.filter((c: string) => c in COUNTRIES);
  assert.deepEqual(overlap, []);
});

test("manifest: category, licence, countries, no country shared with another price-levels source", () => {
  assert.equal(manifest.category, "price-levels");
  assert.equal(categoryById("price-levels")?.tool, "pricepaid_price_levels");
  const all = countriesFor("price-levels");
  for (const c of ["IN", "SG", "AE", "BR", "TW", "CN", "ZA"]) assert.ok(all.includes(c), c);
  assert.equal(INFO.price_type, "official_statistic");
  assert.ok(Object.keys(COUNTRIES).length >= 125);
  assert.match(INFO.attribution, /World Bank/);
  assert.match(INFO.licence, /CC BY 4\.0/);
});
