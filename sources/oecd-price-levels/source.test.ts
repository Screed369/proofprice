// Tests for the OECD price level source. Fixtures are real replies captured on 2026-10-20 (see fixtures.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { PPP_FOOD_ALL, PPP_IRL_CATS, PPP_IRL_FOOD } from "./fixtures";
import { BASES, COUNTRIES, INFO, SPENDS, allCountriesUrl, byYear, countryUrl, matchBase, matchSpend, oecdPriceLevel, parseCsv, parseObs, rankTable } from "./source";
import manifest from "./index";
import { categoryById, countriesFor } from "../../lib/registry";

const urls: string[] = [];
const fake = async (url: string): Promise<string> => {
  urls.push(url);
  if (url.includes("/IRL.A.PL+PPP.A0101..OECD")) return PPP_IRL_FOOD;
  if (url.includes("/.A.PL.A0101.IX.OECD")) return PPP_FOOD_ALL;
  throw new Error("unexpected url " + url);
};

test("parseCsv handles quoted commas", () => {
  assert.deepEqual(parseCsv('a,"b, c",d\n1,2,3\n'), [["a", "b, c", "d"], ["1", "2", "3"]]);
});

test("parseObs reads the real reply: Ireland food, three years, index and PPP", () => {
  const obs = parseObs(PPP_IRL_FOOD);
  assert.equal(obs.length, 6);
  const pl = obs.find((o) => o.measure === "PL" && o.year === 2024);
  assert.equal(pl?.value, 105);
  assert.equal(pl?.unit, "IX");
  assert.equal(pl?.base, "OECD");
  assert.equal(pl?.categoryName, "Food and non-alcoholic beverages");
  const ppp = obs.find((o) => o.measure === "PPP" && o.year === 2023);
  assert.equal(ppp?.value, 0.969);
});

test("parseObs rejects a reply with other columns", () => {
  assert.throws(() => parseObs("a,b\n1,2\n"), /columns we do not know/);
  assert.deepEqual(parseObs(""), []);
});

test("byYear lines the index and the PPP rate up, newest first", () => {
  const rows = byYear(parseObs(PPP_IRL_FOOD), "IRL", matchSpend("food"), BASES.OECD);
  assert.deepEqual(rows.map((r) => r.year), [2024, 2023, 2022]);
  assert.deepEqual(rows[0], { year: 2024, index: 105, ppp: 0.974 });
});

test("rankTable keeps countries only, dearest first", () => {
  const { year, table } = rankTable(parseObs(PPP_FOOD_ALL));
  assert.equal(year, 2024);
  assert.equal(table[0].name, "Switzerland");
  assert.equal(table[0].index, 147);
  assert.equal(table[table.length - 1].index, 67.3); // North Macedonia is the cheapest in the capture
  assert.ok(!table.some((t) => ["OECD", "EA20", "EU27_2020", "HRV"].includes(t.iso3)));
});

test("everyday words map to OECD codes; unknown words list the choices", () => {
  assert.equal(matchSpend("").code, "A01");
  assert.equal(matchSpend("Groceries").code, "A0101");
  assert.equal(matchSpend("rent").code, "A0104");
  assert.equal(matchSpend("Restaurants and hotels").code, "A0111");
  assert.equal(matchSpend("cars").code, "A010701");
  assert.throws(() => matchSpend("spaceships"), /spend must be one of/);
  assert.equal(new Set(SPENDS.map((s) => s.code)).size, SPENDS.length);
});

test("comparison area words", () => {
  assert.equal(matchBase("").code, "OECD");
  assert.equal(matchBase("US").code, "USA");
  assert.equal(matchBase("EU-27").code, "EU27_2020");
  assert.throws(() => matchBase("moon"), /compare_to must be/);
});

test("request URLs use the dataflow key form", () => {
  assert.equal(
    countryUrl("IRL", matchSpend("food"), BASES.OECD),
    "https://sdmx.oecd.org/public/rest/data/OECD.SDD.TPS,DSD_PPP@DF_PPP,1.1/IRL.A.PL+PPP.A0101..OECD?lastNObservations=5&format=csvfilewithlabels",
  );
  assert.ok(allCountriesUrl(matchSpend("food"), BASES.EU).includes("/.A.PL.A0101.IX.EU27_2020?"));
});

test("Ireland food 2024: index 105, 5% above the OECD average, official statistic, confidence medium", async () => {
  const a = await oecdPriceLevel({ country: "IE", spend: "food" }, fake);
  assert.equal(a.status, "ok");
  assert.equal(a.price?.value, 105);
  assert.equal(a.price?.currency, "INDEX");
  assert.equal(a.price?.median, null);
  assert.equal(a.price?.typical_low, null);
  assert.equal(a.sample_size, null);
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.confidence, "medium");
  assert.equal(a.statistic?.reference_period, "2024");
  const x = a.extra as any;
  assert.equal(x.percent_above_comparison, 5);
  assert.equal(x.ppp_national_currency_per_unit, 0.974);
  assert.equal(x.history.length, 3);
  assert.equal(x.rank.of > 30, true);
  assert.match(a.summary, /Ireland/);
  assert.match(a.summary, /5% above the OECD average/);
});

test("a country with no figure answers no_matches, not a wrong number", async () => {
  const a = await oecdPriceLevel({ country: "ES", spend: "food" }, async () => PPP_IRL_FOOD.split("\n")[0] + "\n");
  assert.equal(a.status, "no_matches");
  assert.equal(a.price, null);
});

test("an unknown country is a 400 with the list", async () => {
  await assert.rejects(() => oecdPriceLevel({ country: "ZZ" }, fake), /Not yet available/);
});

test("a failing rank request does not stop the answer", async () => {
  const a = await oecdPriceLevel({ country: "IE", spend: "food" }, async (u) => { if (u.includes("/.A.PL.")) throw new Error("boom"); return PPP_IRL_FOOD; });
  assert.equal(a.status, "ok");
  assert.equal((a.extra as any).rank, null);
});

test("manifest: category, licence, countries", () => {
  assert.equal(manifest.category, "price-levels");
  assert.equal(categoryById("price-levels")?.tool, "pricepaid_price_levels");
  assert.ok(countriesFor("price-levels").includes("IE"));
  assert.equal(INFO.price_type, "official_statistic");
  assert.ok(Object.keys(COUNTRIES).length >= 45);
  assert.match(INFO.attribution, /OECD/);
  assert.ok(PPP_IRL_CATS.includes("Actual individual consumption"));
});
