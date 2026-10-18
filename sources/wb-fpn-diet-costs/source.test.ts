// Tests for the World Bank healthy-diet cost source. Fixtures are real replies captured on 2026-10-18 (see fixtures.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { FPN_IRL_GROUPS, FPN_MULTI, FPN_TWN } from "./fixtures";
import { COUNTRIES, GROUPS, INFO, byYear, changePct, matchGroup, parseFpn, requestUrl, seriesFor, wbDietCost } from "./source";
import manifest from "./index";
import { categoryById, countriesFor } from "../../lib/registry";

const urls: string[] = [];
const fake = async (url: string): Promise<unknown> => {
  urls.push(url);
  if (url.includes("/country/TWN/")) return FPN_TWN;
  if (url.includes("/country/IRL/") && url.includes("_f_")) return FPN_IRL_GROUPS;
  if (url.includes("/country/IRL/") && url.includes("_asf_")) return FPN_IRL_GROUPS;
  if (url.includes("/country/")) return FPN_MULTI; // the multi-country capture holds IRL, USA, SGP, ARE and KOR
  throw new Error("unexpected url " + url);
};

test("parseFpn reads the real reply: ids, years and numbers", () => {
  const { cells, lastUpdated } = parseFpn(FPN_MULTI);
  assert.equal(lastUpdated, "2026-07-21");
  const irl = cells.find((c) => c.iso3 === "IRL" && c.series === "CoHD_LCU" && c.year === 2025);
  assert.equal(irl?.value, 2.75);
  assert.equal(irl?.country, "Ireland");
});

test("parseFpn keeps null cells and rejects an error reply", () => {
  const { cells } = parseFpn(FPN_IRL_GROUPS);
  assert.ok(cells.some((c) => c.series === "CoHD_asf_LCU" && c.value === null));
  assert.throws(() => parseFpn([{ message: [{ id: "120", key: "Invalid value", value: "The provided parameter value is not valid" }] }]), /refused/);
  assert.throws(() => parseFpn({ nothing: true }), /no data section/);
});

test("request URL uses the /sources/88/ form with both series", () => {
  assert.equal(
    requestUrl("IRL", GROUPS[0]),
    "https://api.worldbank.org/v2/sources/88/country/IRL/series/CoHD_LCU;CoHD_PPP/time/all?format=json&per_page=500",
  );
  assert.deepEqual(seriesFor(matchGroup("fruit")), { lcu: "CoHD_f_LCU", ppp: "CoHD_f_PPP" });
});

test("food group words map to series; unknown words list the choices", () => {
  assert.equal(matchGroup("").key, "");
  assert.equal(matchGroup("Meat").key, "asf");
  assert.equal(matchGroup("legumes and nuts").key, "lns");
  assert.equal(matchGroup("cooking oil").key, "of");
  assert.equal(matchGroup("grains").key, "ss");
  assert.throws(() => matchGroup("chocolate"), /food_group must be one of/);
});

test("Ireland 2025: 2.75 EUR per person per day, 3.14 PPP dollars, up on 2024, confidence low", async () => {
  const a = await wbDietCost({ country: "IE" }, fake);
  assert.equal(a.status, "ok");
  assert.equal(a.price?.value, 2.75);
  assert.equal(a.price?.currency, "EUR");
  assert.equal(a.price?.unit, "per person per day");
  assert.equal(a.price?.median, null);
  assert.equal(a.price?.typical_low, null);
  assert.equal(a.sample_size, null);
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.confidence, "low");
  assert.deepEqual(a.period, { from: "2025-01-01", to: "2025-12-31" });
  assert.equal(a.statistic?.reference_period, "2025");
  assert.equal((a.extra as any).ppp_dollars_per_person_per_day, 3.14);
  assert.equal((a.extra as any).change_on_previous_year_percent, 3.8); // 2.65 -> 2.75
  assert.equal((a.extra as any).history.length, 9);
  assert.match(a.summary, /modelled at about/);
  assert.match(a.source.attribution, /CC BY 4\.0/);
});

test("a given year, and a year with no data", async () => {
  const a = await wbDietCost({ country: "US", year: 2023 }, fake);
  assert.equal(a.status, "ok");
  assert.equal(a.statistic?.reference_period, "2023");
  assert.equal(a.price?.currency, "USD");
  const none = await wbDietCost({ country: "US", year: 2030 }, fake);
  assert.equal(none.status, "no_matches");
  assert.ok(Array.isArray((none.extra as any).available_years));
});

test("local currency differs from PPP: Korea in won, UAE in dirhams", async () => {
  const kr = await wbDietCost({ country: "KR" }, fake);
  assert.equal(kr.price?.currency, "KRW");
  assert.equal(kr.price?.value, 6389.97);
  assert.equal((kr.extra as any).ppp_dollars_per_person_per_day, 7.37);
  const ae = await wbDietCost({ country: "AE" }, fake);
  assert.equal(ae.price?.currency, "AED");
  assert.equal(ae.price?.value, 8.18);
});

test("Taiwan is answered (World Bank calls it 'Taiwan, China')", async () => {
  const a = await wbDietCost({ country: "TW" }, fake);
  assert.equal(a.status, "ok");
  assert.equal(a.price?.currency, "TWD");
  assert.equal((a.extra as any).ppp_dollars_per_person_per_day, 5.48);
});

test("a food group with blank cells uses the newest year that has a figure and says so; a blank year answers no_matches, never zero", async () => {
  const asf = await wbDietCost({ country: "IE", food_group: "meat" }, fake);
  assert.equal(asf.status, "ok");
  assert.equal(asf.statistic?.reference_period, "2021"); // 2022-2025 are null for animal-source foods in the capture
  assert.equal(asf.price?.value, 0.45);
  const blank = await wbDietCost({ country: "IE", food_group: "meat", year: 2025 }, fake);
  assert.equal(blank.status, "no_matches");
  assert.ok((blank.extra as any).available_years.includes(2021));
  const fruit = await wbDietCost({ country: "IE", food_group: "fruit" }, fake);
  assert.equal(fruit.status, "ok");
  assert.equal((fruit.extra as any).food_group, "fruit");
});

test("bad input is a 400-style InputError", async () => {
  await assert.rejects(wbDietCost({ country: "XX" }, fake), /Not yet available for XX/);
  await assert.rejects(wbDietCost({ country: "IE", year: 1999 }, fake), /year must be/);
  await assert.rejects(wbDietCost({ country: "IE", food_group: "candy" }, fake), /food_group must be one of/);
});

test("changePct and byYear", () => {
  assert.equal(changePct(110, 100), 10);
  assert.equal(changePct(1, 0), null);
  const rows = byYear(parseFpn(FPN_MULTI).cells, "IRL", seriesFor(GROUPS[0]));
  assert.equal(rows[0].year, 2025);
  assert.equal(rows.length, 9);
});

test("manifest: category, countries and examples", () => {
  assert.equal(manifest.category, "diet-costs");
  assert.ok(categoryById("diet-costs"));
  assert.equal(manifest.info.id, "wb-fpn-diet-costs");
  assert.equal(INFO.price_type, "official_statistic");
  assert.ok(countriesFor("diet-costs").includes("IE"));
  assert.ok(Object.keys(COUNTRIES).length >= 60);
  assert.equal(manifest.examples[0].params.country, "IE");
});
