import { test } from "node:test";
import assert from "node:assert/strict";
import { InputError, SourceError } from "../../lib/http";
import { categoryById, countriesFor, runCategory, SOURCE_PLUGINS } from "../../lib/registry";
import {
  ageOf, COUNTRIES, euFarmPrices, farmAnswer, farmUrl, INFO, isFarmReading, parseDate, parsePrice, readFarm, stageShort, toQuotes, WINDOW_DAYS, withThe,
} from "./source";
import { CATALOGUE, kgPerUnit, productGroups, resolveProduct } from "./products";
import * as F from "./fixtures";

// Fixtures: real responses of the Agri-food data portal API captured 2026-10-14 (see fixtures.ts). "Today" in these tests is 2026-10-14.
const NOW = new Date("2026-10-14T12:00:00Z");
const API = "https://api.tech.ec.europa.eu/agrifood/api";

function answer(fixture: unknown, country: string, product: string, now = NOW) {
  const p = resolveProduct(product);
  const geo = country === "GR" ? "EL" : country;
  return farmAnswer(readFarm(fixture, { product: p, country, geo }), { country, product: p, now });
}
const extra = (a: { extra?: Record<string, any> }) => a.extra as Record<string, any>;
const near = (actual: number | null | undefined, expected: number, tol = 0.011) => assert.ok(actual != null && Math.abs(actual - expected) <= tol, `${actual} is not within ${tol} of ${expected}`);

function fake(body: unknown) {
  const urls: string[] = [];
  return { urls, fetcher: async (url: string) => (urls.push(url), body) };
}

test("eu-farm-prices: licence, attribution and type are the European Commission's", () => {
  assert.equal(INFO.id, "eu-farm-prices");
  assert.equal(INFO.price_type, "official_statistic");
  assert.match(INFO.publisher, /European Commission, DG Agriculture and Rural Development/);
  assert.match(INFO.licence, /Creative Commons Attribution 4\.0 International \(CC BY 4\.0\)/);
  assert.match(INFO.licence, /12 December 2011/);
  assert.match(INFO.licence, /appropriate credit is given and changes are indicated/);
  assert.equal(INFO.licence_url, "https://commission.europa.eu/legal-notice_en");
  for (const k of ["European Commission", "Agri-food data portal", "agridata.ec.europa.eu", "CC BY 4.0", "© European Union", "changes by ProofPrice"]) assert.ok(INFO.attribution.includes(k), k);
  assert.match(INFO.limits, /not what shoppers pay in a shop/);
  assert.match(INFO.limits, /Luxembourg/);
  assert.match(INFO.limits, /national currency/);
  assert.match(INFO.freshness, /Weekly/);
});

test("eu-farm-prices: covers 26 member states, Greece as GR, nothing else", () => {
  const codes = Object.keys(COUNTRIES);
  assert.equal(codes.length, 26);
  for (const c of ["GR", "IE", "FR", "ES", "PT", "IT", "DE", "NL", "BE", "AT", "PL", "DK", "SE", "CY", "MT", "HR"]) assert.ok(codes.includes(c), c);
  for (const c of ["LU", "NO", "GB", "UK", "EL", "CH", "EU", "US"]) assert.ok(!codes.includes(c), c);
  assert.deepEqual(countriesFor("farm-prices"), codes);
  const plugin = SOURCE_PLUGINS.find((s) => s.info.id === "eu-farm-prices")!;
  assert.equal(plugin.category, "farm-prices");
  assert.equal(plugin.status, "live");
  assert.deepEqual(plugin.examples[0].params, { country: "IE", product: "pig" });
  assert.ok(plugin.examples.length >= 4);
  for (const ex of plugin.examples) assert.ok(COUNTRIES[String(ex.params.country)], "example country is covered");
  const cat = categoryById("farm-prices")!;
  assert.equal(cat.tool, "pricepaid_farm_prices");
  assert.equal(cat.restPath, "farm-prices");
  assert.equal(cat.cacheSeconds, 86400);
  assert.equal(cat.title, "Farm and wholesale food prices");
});

test("eu-farm-prices: price text is parsed the way the portal writes it", () => {
  assert.equal(parsePrice("€168.20"), 168.2);
  assert.equal(parsePrice("€248,00"), 248); // cereals: decimal comma
  assert.equal(parsePrice("€1180.92"), 1180.92);
  assert.equal(parsePrice("€1.234,50"), 1234.5);
  assert.equal(parsePrice("€,00"), null); // the portal's zero
  assert.equal(parsePrice("€0.00"), null);
  assert.equal(parsePrice(null), null);
  assert.equal(parsePrice(""), null);
  assert.equal(parsePrice("n/a"), null);
  assert.equal(parsePrice(42.5), 42.5);
  assert.equal(parseDate("28/09/2026"), "2026-09-28");
  assert.equal(parseDate("1/2/2026"), "2026-02-01");
  assert.equal(parseDate("2026-09-28"), null);
  assert.equal(parseDate("31/13/2026"), null);
  assert.equal(parseDate(undefined), null);
});

test("eu-farm-prices: products resolve by name and alias, and unknown ones list the choices", () => {
  assert.equal(resolveProduct("Wheat").key, "wheat");
  assert.equal(resolveProduct("  PORK ").key, "pig");
  assert.equal(resolveProduct("pig meat").key, "pig");
  assert.equal(resolveProduct("corn").key, "maize");
  assert.equal(resolveProduct("tomato").key, "tomatoes");
  assert.equal(resolveProduct("Tomatoes").key, "tomatoes");
  assert.equal(resolveProduct("olive_oil").key, "olive oil");
  assert.equal(resolveProduct("free-range eggs").key, "free range eggs");
  assert.equal(resolveProduct("egg").key, "eggs");
  assert.equal(resolveProduct("aubergine").key, "egg plants");
  assert.equal(resolveProduct("butter prices").key, "butter");
  assert.throws(() => resolveProduct("uranium"), (e: any) => e instanceof InputError && /"uranium" is not a product we cover\. Choose one of: Cereals \(per tonne\): wheat/.test(e.message));
  assert.throws(() => resolveProduct(""), (e: any) => e instanceof InputError && /product is required/.test(e.message));
  assert.throws(() => resolveProduct(undefined), InputError);
  assert.equal(kgPerUnit("tonne"), 1000);
  assert.equal(kgPerUnit("100kg"), 100);
  assert.equal(kgPerUnit("head"), null);
  // every product is listed in a group, has a variant, and filter values never contain a comma (they are joined with commas)
  const listed = productGroups().flatMap((g) => g.keys);
  assert.equal(listed.length, CATALOGUE.length);
  for (const p of CATALOGUE) {
    assert.ok(p.variants.length >= 1, p.key);
    for (const f of p.filter ?? []) assert.ok(!f.includes(","), `${p.key}: ${f}`);
    if (p.family !== "fruitveg") for (const v of p.variants) assert.ok(v.label.length > 0, `${p.key}/${v.id} needs a label`);
  }
});

test("eu-farm-prices: the request is one filtered call on the sector's endpoint, Greece as EL", () => {
  assert.equal(WINDOW_DAYS, 460);
  const win = "beginDate=11/07/2025&endDate=14/10/2026";
  assert.equal(farmUrl(resolveProduct("pig"), "IE", NOW), `${API}/pigmeat/prices?memberStateCodes=IE&pigClasses=S,E,R,SE&${win}`);
  assert.equal(farmUrl(resolveProduct("wheat"), "FR", NOW), `${API}/cereal/prices?memberStateCodes=FR&productCodes=BLTPAN,BLTFOUR&${win}`);
  assert.equal(farmUrl(resolveProduct("olive oil"), "ES", NOW), `${API}/oliveOil/prices?memberStateCodes=ES&products=Extra%20virgin%20olive%20oil%20(up%20to%200.8%25),Virgin%20olive%20oil%20(up%20to%202%25)&${win}`);
  assert.equal(farmUrl(resolveProduct("milk"), "EL", NOW), `${API}/rawMilk/prices?memberStateCodes=EL&products=Raw%20milk&${win}`);
  assert.equal(farmUrl(resolveProduct("eggs"), "IE", NOW), `${API}/poultry/egg/prices?memberStateCodes=IE&farmingMethods=Barn,Cage,Free%20range,Organic&${win}`);
  assert.equal(farmUrl(resolveProduct("aubergines"), "IT", NOW), `${API}/fruitAndVegetable/pricesSupplyChain?memberStateCodes=IT&products=Egg%20Plants&${win}`);
  assert.equal(farmUrl(resolveProduct("drinking milk"), "IE", NOW), `${API}/dairy/prices?memberStateCodes=IE&products=DRINKING%20MILK&${win}`);
  assert.equal(farmUrl(resolveProduct("beef"), "FR", NOW), `${API}/beef/prices?memberStateCodes=FR&productCodes=ACZURO,AR3,AO3,AU3,AR2,AO2,AU2&${win}`);
  // sheep and poultry have no filter we rely on: the response for one country is small
  assert.equal(farmUrl(resolveProduct("lamb"), "IE", NOW), `${API}/sheepAndGoat/prices?memberStateCodes=IE&${win}`);
  assert.equal(farmUrl(resolveProduct("chicken"), "PL", NOW), `${API}/poultry/prices?memberStateCodes=PL&${win}`);
});

test("eu-farm-prices: Irish pig carcasses (class E), the smoke-test example", () => {
  const a = answer(F.PIG_IE_YEAR, "IE", "pig");
  assert.equal(a.status, "ok");
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.price!.currency, "EUR");
  assert.equal(a.price!.unit, "per 100 kg");
  assert.equal(a.price!.value, 168.2);
  assert.equal(a.price!.measure, "average");
  assert.equal(a.price!.median, null);
  assert.equal(a.price!.typical_low, null);
  assert.equal(a.price!.typical_high, null);
  assert.equal(a.sample_size, null);
  assert.deepEqual(a.period, { from: "2026-09-28", to: "2026-10-04" });
  assert.equal(a.statistic!.reference_period, "2026-09-28 to 2026-10-04");
  assert.equal(a.confidence, "high");
  assert.equal(a.source.id, "eu-farm-prices");
  assert.equal(a.source.licence_url, "https://commission.europa.eu/legal-notice_en");
  assert.match(a.summary, /^In Ireland the latest published price for pig carcasses \(class E\) was €168\.20 per 100 kg \(€1\.68 per kg\) for the week 28 Sep 2026 to 4 Oct 2026\./);
  assert.match(a.summary, /10\.8% lower than a year earlier/);
  assert.match(a.summary, /Official average published by European Commission, DG Agriculture and Rural Development/);
  const x = extra(a);
  near(x.price_per_kg, 1.682, 0.0001);
  assert.equal(x.published_unit, "per 100 kg");
  assert.equal(x.product.series.id, "E");
  assert.deepEqual(x.previous_period, { begin: "2026-09-21", end: "2026-09-27", value: 168.15, change_percent: 0 });
  assert.deepEqual(x.year_earlier, { begin: "2025-09-29", end: "2025-10-05", value: 188.59, change_percent: -10.8 });
  assert.equal(x.last_12_months.periods, 53);
  assert.equal(x.last_12_months.min, 166.73);
  assert.equal(x.last_12_months.max, 188.88);
  assert.equal(x.recent_series.length, 12);
  assert.equal(x.recent_series[11].value, 168.2);
  assert.equal(x.data_age.level, "current");
  assert.equal(x.basis.markets.mode, "none");
});

test("eu-farm-prices: the same fixture reads for other countries and classes, and EU aggregate rows are never used", () => {
  const se = answer(F.PIG_MIX, "SE", "pork");
  assert.equal(se.price!.value, 218.49);
  assert.match(se.summary, /^In Sweden /);
  assert.match(se.summary, /1\.2% lower than the previous week/);
  assert.doesNotMatch(se.summary, /a year earlier/); // the capture holds only a few weeks: no year-earlier figure is invented
  assert.equal(extra(se).year_earlier, null);
  assert.equal(answer(F.PIG_MIX, "DK", "pig").price!.value, 114.51);
  assert.equal(answer(F.PIG_MIX, "ES", "pig").price!.value, 166.78);
  const piglet = answer(F.PIG_MIX, "DK", "piglets");
  assert.equal(piglet.price!.unit, "per head");
  assert.equal(piglet.price!.value, 31.17);
  assert.equal(extra(piglet).price_per_kg, undefined);
  assert.doesNotMatch(piglet.summary, /per kg/);
  // the EU row is not a country: asking for it finds nothing
  const p = resolveProduct("pig");
  assert.equal(toQuotes(F.PIG_MIX, p, "EU").length > 0, true); // the rows exist in the capture...
  assert.equal(Object.keys(COUNTRIES).includes("EU"), false); // ...but EU is never a country we answer for
  assert.deepEqual(toQuotes(F.PIG_MIX, p, "IE"), []);
});

test("eu-farm-prices: beef shows the national indicative price first and lists the classes", () => {
  const a = answer(F.BEEF_FR_YEAR, "FR", "beef");
  assert.equal(a.price!.value, 623.97);
  assert.match(a.summary, /adult male cattle carcasses \(national indicative price\) was €623\.97 per 100 kg \(€6\.24 per kg\)/);
  assert.match(a.summary, /0\.1% lower than the previous week and 11\.7% lower than a year earlier/);
  const x = extra(a);
  assert.equal(x.year_earlier.value, 706.39);
  assert.deepEqual(x.other_series, [{ series: "AR3", label: "young bull carcasses (class AR3)", period_to: "2026-10-11", value: 625 }]);
  assert.match(a.statistic!.note!, /beef has several series/);
  const cow = answer(F.BEEF_FR_YEAR, "FR", "cow");
  assert.equal(cow.price!.value, 573);
  assert.match(cow.summary, /cow carcasses \(class DO3\)/);
  const ie = answer(F.BEEF_IE, "IE", "beef");
  assert.equal(ie.price!.value, 690.14);
  assert.ok(extra(ie).other_series.length >= 5, "Ireland reports the classes too");
  const heifer = answer(F.BEEF_IE, "IE", "heifer");
  assert.match(heifer.summary, /heifer carcasses \(class ER3\)/);
});

test("eu-farm-prices: cereals use the stage most markets quote and average the markets, flagged as such", () => {
  const ie = answer(F.CEREAL_IE, "IE", "wheat");
  // Ireland reports only feed wheat: the usual milling series is skipped and the answer says so
  assert.equal(ie.price!.unit, "per tonne");
  near(ie.price!.value, 260.67);
  assert.match(ie.summary, /feed wheat \(delivered to the first buyer, simple average of 3 markets\) was €260\.67 per tonne \(€0\.261 per kg\)/);
  assert.match(ie.statistic!.note!, /has no recent price in Ireland, so feed wheat is shown/);
  assert.match(ie.statistic!.note!, /simple, unweighted average/);
  assert.equal(extra(ie).basis.markets.mode, "average");
  assert.deepEqual(extra(ie).basis.markets.names.sort(), ["Cork", "Dublin/North East/Midlands", "Wexford"]);
  assert.equal(extra(ie).product.series.chosen_by, "fallback");
  // the national average the portal also publishes for Ireland stopped on 2 Aug: it is not used for a figure dated 11 Oct
  const barley = answer(F.CEREAL_IE, "IE", "barley");
  assert.equal(extra(barley).basis.markets.mode, "average");
  assert.equal(barley.price!.value, 246);

  const fr = answer(F.CEREAL_MIX, "FR", "wheat");
  assert.match(fr.summary, /milling \(bread-making\) wheat \(delivered to port, simple average of 2 markets\) was €251\.44 per tonne/);
  assert.deepEqual(extra(fr).basis.markets.names.sort(), ["La Pallice", "Rouen"]);
  assert.equal(extra(fr).basis.stage_short, "delivered to port");

  const gr = answer(F.CEREAL_MIX, "GR", "wheat");
  assert.equal(gr.price!.value, 245);
  assert.match(gr.summary, /^In Greece .*milling \(bread-making\) wheat \(farm-gate\) was €245\.00 per tonne/);

  // the count is of the markets in the newest week's figure, not of every market that reported in the 15 months
  assert.match(answer(F.CEREAL_MIX, "DE", "wheat").summary, /ex-silo, simple average of 5 markets/);
  assert.match(answer(F.CEREAL_MIX, "ES", "wheat").summary, /^In Spain /);
  assert.match(answer(F.CEREAL_MIX, "IT", "durum").summary, /durum wheat \(delivered to the first buyer, simple average of 3 markets\)/);
  assert.match(answer(F.CEREAL_MIX, "DE", "corn").summary, /feed maize \(ex-silo, simple average of 3 markets\)/);
});

test("eu-farm-prices: raw milk is monthly, with the month as its period", () => {
  const ie = answer(F.MILK_IE, "IE", "milk");
  assert.equal(ie.price!.value, 40.79);
  assert.deepEqual(ie.period, { from: "2026-09-01", to: "2026-09-30" });
  assert.equal(ie.statistic!.reference_period, "2026-09");
  assert.match(ie.summary, /raw cow's milk was €40\.79 per 100 kg \(€0\.408 per kg\) for September 2026\. That is unchanged from the previous month\./);
  assert.equal(extra(ie).reference.kind, "month");
  assert.equal(ie.confidence, "high");
  // the organic series stops a month earlier: still current for a monthly series
  const org = answer(F.MILK_IE, "IE", "organic milk");
  assert.equal(org.price!.value, 62.66);
  assert.match(org.summary, /for August 2026/);
  assert.equal(org.confidence, "high");
  const gr = answer(F.MILK_GR, "GR", "milk");
  assert.equal(gr.price!.value, 55.3);
  assert.match(gr.summary, /^In Greece /);
});

test("eu-farm-prices: eggs by farming method, dairy by product, poultry in euro", () => {
  const eggs = answer(F.EGG_IE, "IE", "eggs");
  assert.match(eggs.summary, /barn eggs was €312\.71 per 100 kg \(€3\.13 per kg\) for the week 5 Oct 2026 to 11 Oct 2026/);
  assert.equal(extra(eggs).other_series.length, 3);
  assert.match(answer(F.EGG_IE, "IE", "free range eggs").summary, /free-range eggs was €307\.09/);
  assert.match(answer(F.EGG_IE, "IE", "organic eggs").summary, /organic eggs was €/);

  const butter = answer(F.DAIRY_MIX, "IE", "butter");
  assert.equal(butter.price!.value, 393.57);
  assert.match(butter.summary, /^In Ireland the latest published price for butter was €393\.57 per 100 kg \(€3\.94 per kg\)/);
  assert.equal(answer(F.DAIRY_MIX, "DE", "butter").price!.value, 419);

  const chicken = answer(F.POULTRY_MIX, "PL", "chicken");
  assert.equal(chicken.price!.value, 160.68);
  assert.equal(chicken.price!.currency, "EUR");
  assert.match(chicken.statistic!.note!, /labels poultry prices 'national currency\/100kg' but the figures are euro-scale/);
  assert.match(chicken.summary, /whole chicken \(broiler, 65% carcass\)/);
  // each country has its own latest week: Sweden has 11 Oct, Poland 4 Oct
  assert.equal(answer(F.POULTRY_MIX, "SE", "chicken breast").price!.value, 921.53);
  assert.match(answer(F.POULTRY_MIX, "SE", "chicken breast").summary, /5 Oct 2026 to 11 Oct 2026/);
  assert.match(answer(F.POULTRY_MIX, "IE", "chicken legs").summary, /^In Ireland .* chicken legs was €184\.14/);
});

test("eu-farm-prices: olive oil uses the national average line and counts a week listed under two marketing years once", () => {
  const es = answer(F.OLIVE_ES, "ES", "olive oil");
  assert.equal(es.price!.value, 343.19);
  assert.match(es.summary, /extra virgin olive oil \(national average\) was €343\.19 per 100 kg \(€3\.43 per kg\)/);
  assert.equal(extra(es).basis.markets.mode, "national");
  assert.deepEqual(extra(es).basis.markets.names, ["Average national price"]);
  // week 53 of 2025/2026 and week 1 of 2026/2027 are the same week: one value, and the previous week is the one before it
  assert.deepEqual(extra(es).previous_period, { begin: "2026-09-21", end: "2026-09-27", value: 344.84, change_percent: -0.5 });
  assert.equal(extra(es).basis.quotes_averaged, 1);
  assert.match(answer(F.OLIVE_MIX, "IT", "olive oil").summary, /^In Italy .* €464\.00 per 100 kg/);
  assert.match(answer(F.OLIVE_MIX, "GR", "olive oil").summary, /^In Greece .*national average/);
  const hr = answer(F.OLIVE_MIX, "HR", "olive oil");
  assert.equal(hr.price!.value, 1180.92);
  assert.deepEqual(hr.period, { from: "2026-09-21", to: "2026-09-27" });
  assert.equal(answer(F.OLIVE_MIX, "IT", "lampante").price!.value, 277);
});

test("eu-farm-prices: lamb prefers heavy lamb and falls back to light lamb where that is all a country reports", () => {
  const ie = answer(F.SHEEP_MIX, "IE", "lamb");
  assert.equal(ie.price!.value, 790.21);
  assert.match(ie.summary, /heavy lamb was €790\.21 per 100 kg/);
  assert.match(answer(F.SHEEP_MIX, "ES", "lamb").summary, /heavy lamb was €1,052\.50/);
  const gr = answer(F.SHEEP_MIX, "GR", "lamb");
  assert.match(gr.summary, /^In Greece .* light lamb was €1,005\.67/);
  assert.match(gr.statistic!.note!, /has no recent price in Greece, so light lamb is shown/);
});

test("eu-farm-prices: fruit and vegetables use the national line at the first stage that has one and say what they averaged", () => {
  const fr = answer(F.FV_FR, "FR", "apples");
  assert.equal(fr.price!.value, 150.85);
  assert.match(fr.summary, /apples \(ex-packaging station, national average\) was €150\.85 per 100 kg/);
  assert.deepEqual(extra(fr).other_stages.map((s: any) => [s.stage, s.value]), [["Farmgate price", 62.67]]);
  assert.equal(extra(fr).basis.varieties[0], "Apples - All types and varieties");
  assert.equal(fr.statistic!.note, undefined);

  const bananas = answer(F.FV_FR, "FR", "banana");
  assert.match(bananas.summary, /bananas \(price retailers pay, national average\) was €125\.00/);

  // Spain publishes tomato varieties but no all-varieties line: the answer is their simple average, and says so
  const es = answer(F.FV_ES_TOMATO, "ES", "tomato");
  near(es.price!.value, 183.47);
  assert.match(es.statistic!.note!, /no all-varieties figure at this stage, so the figure is the simple average of 3 varieties/);
  assert.equal(extra(es).basis.varieties.length, 3);
  assert.equal(extra(es).other_stages[0].stage, "Farmgate price");

  assert.match(answer(F.FV_FR, "FR", "tomatoes").summary, /tomatoes \(ex-packaging station, national average\)/);
  assert.match(answer(F.FV_FR, "FR", "grapes").summary, /table grapes /);
});

test("eu-farm-prices: old quotes are flagged and lose confidence", () => {
  // weekly: 3 weeks is normal, up to 8 weeks is "older", beyond that a warning
  assert.equal(ageOf("2026-10-04", NOW, false).level, "current");
  assert.equal(ageOf("2026-09-23", NOW, false).level, "current"); // 21 days
  assert.equal(ageOf("2026-09-22", NOW, false).level, "older");
  assert.equal(ageOf("2026-08-19", NOW, false).level, "older"); // 56 days
  assert.equal(ageOf("2026-08-18", NOW, false).level, "old");
  // monthly: raw milk arrives about two weeks after the month
  assert.equal(ageOf("2026-09-30", NOW, true).level, "current");
  assert.equal(ageOf("2026-07-31", NOW, true).level, "current"); // 75 days is the edge
  assert.equal(ageOf("2026-07-30", NOW, true).level, "older");
  assert.equal(ageOf("2026-06-30", NOW, true).level, "older");
  assert.equal(ageOf("2026-05-31", NOW, true).level, "old");

  const older = answer(F.PIG_IE_YEAR, "IE", "pig", new Date("2026-11-20T12:00:00Z"));
  assert.equal(older.status, "ok");
  assert.equal(older.confidence, "medium");
  assert.match(older.summary, /The latest quote is 47 days old, older than usual for this series\./);
  assert.equal(extra(older).data_age.level, "older");

  const old = answer(F.PIG_IE_YEAR, "IE", "pig", new Date("2027-02-01T12:00:00Z"));
  assert.equal(old.confidence, "low");
  assert.match(old.summary, /WARNING: the newest quote the portal holds is from 4 Oct 2026, about 17 weeks ago\./);
  assert.match(old.summary, /do not use it as a current price/);
  assert.match(old.statistic!.note!, /WARNING/);
  assert.equal(extra(old).data_age.level, "old");
  assert.equal(old.price!.value, 168.2, "the figure is still returned, with the warning");

  const stale = answer(F.MILK_IE, "IE", "milk", new Date("2027-03-01T12:00:00Z"));
  assert.match(stale.summary, /about 5 months ago/);
  assert.equal(stale.confidence, "low");
});

test("eu-farm-prices: rows without a price, from other countries, or for other products are ignored", () => {
  const p = resolveProduct("pig");
  const row = (over: Record<string, unknown>) => ({
    memberStateCode: "IE", memberStateName: "Ireland", beginDate: "28/09/2026", endDate: "04/10/2026", price: "€168.20", unit: "100 KG", weekNumber: 40, pigClass: "E", ...over,
  });
  const rows = [
    row({}),
    row({ price: null }),
    row({ price: "€,00", endDate: "27/09/2026", beginDate: "21/09/2026" }),
    row({ memberStateCode: "DK" }),
    row({ pigClass: "Z-unknown" }),
    row({ endDate: "not a date" }),
    row({}), // repeated row
    null,
    "junk",
  ];
  const q = toQuotes(rows, p, "IE");
  assert.equal(q.length, 1);
  assert.equal(q[0].value, 168.2);
  assert.deepEqual(toQuotes({ error: "x" }, p, "IE"), []);
  const r = readFarm(rows, { product: p, country: "IE", geo: "IE" });
  assert.ok(isFarmReading(r));
  assert.equal((r as any).previous, null); // the zero-price week is not a previous week
});

test("eu-farm-prices: a series that mixes weekly and monthly quotes (Poland's apples) uses the weeks while they are fresh, else the months", () => {
  const row = (beginDate: string, endDate: string, price: string, periodType: string) => ({
    memberStateCode: "PL", memberStateName: "Poland", beginDate, endDate, price, unit: "€/100Kg", periodType, period: 40, year: 2026,
    variety: "Apples - National weighted average of all types and varieties", productStage: "Ex-packaging station price", market: "National average (PL)",
  });
  const fresh = [row("01/09/2026", "30/09/2026", "€70.00", "Month"), row("21/09/2026", "27/09/2026", "€71.00", "Week"), row("28/09/2026", "04/10/2026", "€73.00", "Week")];
  const a = answer(fresh, "PL", "apples");
  assert.equal(a.price!.value, 73);
  assert.match(a.summary, /for the week 28 Sep 2026 to 4 Oct 2026\. That is 2\.8% higher than the previous week\./);
  assert.equal(extra(a).reference.kind, "week");
  assert.equal(extra(a).previous_period.value, 71, "the month is not the previous week");
  assert.equal(extra(a).recent_series.length, 2);

  const stopped = [row("01/08/2026", "31/08/2026", "€70.00", "Month"), row("01/09/2026", "30/09/2026", "€72.00", "Month"), row("03/08/2026", "09/08/2026", "€69.00", "Week")];
  const m = answer(stopped, "PL", "apples");
  assert.equal(m.price!.value, 72);
  assert.match(m.summary, /for September 2026\. That is 2\.9% higher than the previous month\./);
  assert.equal(extra(m).reference.kind, "month");
  assert.equal(m.confidence, "high", "monthly data 14 days after the month ends is current");
});

test("eu-farm-prices: a market or variety that came or went is not read as a price move (changes compare what both periods report)", () => {
  // Germany's wheat: 4 markets in the previous week, 5 in the latest, 3 in both. Averaging all would give +5.7%; like for like is +3.2%.
  const de = answer(F.CEREAL_MIX, "DE", "wheat");
  assert.equal(de.price!.value, 240.8);
  assert.match(de.summary, /That is 3\.2% higher than the previous week\./);
  assert.deepEqual(extra(de).previous_period.like_for_like, { compared: 3, in_latest: 5, in_other: 4 });
  assert.equal(extra(de).previous_period.value, 227.88, "the other period's own figure is still the one published/averaged for it");
  assert.match(de.statistic!.note!, /markets reported differ between periods: the change from the previous week uses only the 3 of the 5 reported in both/);
  assert.equal(extra(de).last_12_months.same_basis_throughout, false);
  assert.match(de.statistic!.note!, /last 12 months mix periods that average different markets/);

  // Spain's tomatoes: the newest week has a third variety (vine tomatoes) that the week before did not
  const es = answer(F.FV_ES_TOMATO, "ES", "tomato");
  assert.deepEqual(extra(es).previous_period.like_for_like, { compared: 2, in_latest: 3, in_other: 2 });
  near(extra(es).previous_period.change_percent, 15.8, 0.05); // (225.78+140.26)/2 against (211.22+104.86)/2, not 183.47 against 158.04
  assert.match(es.statistic!.note!, /varieties reported differ between periods: the change from the previous week uses only the 2 of the 3/);

  // the same markets in both periods: nothing to say, and no like_for_like key
  const ie = answer(F.CEREAL_IE, "IE", "wheat");
  assert.equal(extra(ie).previous_period.like_for_like, undefined);
  assert.equal(extra(ie).last_12_months.same_basis_throughout, true);
  assert.doesNotMatch(ie.statistic!.note!, /differ between periods|like-for-like/);

  // a figure the portal publishes whole (a national average) has one part, so nothing differs
  const pig = answer(F.PIG_IE_YEAR, "IE", "pig");
  assert.equal(extra(pig).previous_period.like_for_like, undefined);
  assert.equal(extra(pig).last_12_months.same_basis_throughout, true);

  // nothing in common: no change is claimed
  const row = (end: string, begin: string, market: string, price: string) => ({
    memberStateCode: "IE", memberStateName: "Ireland", beginDate: begin, endDate: end, price, unit: "€/100Kg", periodType: "Week", period: 40, year: 2026,
    variety: "Tomatoes - Round", productStage: "Ex-packaging station price", market,
  });
  const apart = answer([row("27/09/2026", "21/09/2026", "Market A", "€100.00"), row("04/10/2026", "28/09/2026", "Market B", "€120.00")], "IE", "tomatoes");
  assert.equal(apart.price!.value, 120);
  assert.equal(extra(apart).previous_period, null);
  assert.doesNotMatch(apart.summary, /previous week/);
});

test("eu-farm-prices: the Netherlands is 'the Netherlands' in a sentence, other countries are not", () => {
  const nl = F.EGG_IE.map((r: any) => ({ ...r, memberStateCode: "NL", memberStateName: "Netherlands" }));
  const a = answer(nl, "NL", "eggs");
  assert.match(a.summary, /^In the Netherlands the latest published price for /);
  assert.equal(extra(a).country_name, "Netherlands", "the data keeps the plain name");
  assert.match(answer(F.CEREAL_IE, "IE", "wheat").summary, /^In Ireland /);
  const none = answer([], "NL", "tomatoes");
  assert.match(none.summary, /holds no tomatoes price for the Netherlands in the last/);
  assert.equal(withThe("Netherlands"), "the Netherlands");
  assert.equal(withThe("Netherlands", true), "The Netherlands");
  assert.equal(withThe("Czechia"), "Czechia");
  assert.equal(withThe("Ireland", true), "Ireland");
});

test("eu-farm-prices: no data is a clear no_matches, never an invented price", () => {
  const empty = answer([], "IE", "tomatoes");
  assert.equal(empty.status, "no_matches");
  assert.equal(empty.price, null);
  assert.equal(empty.confidence, "insufficient");
  assert.match(empty.summary, /holds no tomatoes price for Ireland in the last 15 months/);
  const other = answer(F.DAIRY_MIX, "DE", "cheddar");
  assert.equal(other.status, "no_matches");
  assert.match(other.summary, /has milk and dairy prices for Germany but none for cheddar cheese: it holds .*BUTTER/);
  assert.ok(extra(other).reported_series.includes("GOUDA"));
  assert.equal(answer(F.PIG_MIX, "DK", "beef").status, "no_matches");
});

test("eu-farm-prices: euFarmPrices makes one request, treats 404 as no data and explains rate limits", async () => {
  const f = fake(F.PIG_IE_YEAR);
  const a = await euFarmPrices({ country: " ie ", product: "Pigs", baseUrl: "https://example.test", now: NOW }, { fetcher: f.fetcher });
  assert.deepEqual(f.urls, [`${API}/pigmeat/prices?memberStateCodes=IE&pigClasses=S,E,R,SE&beginDate=11/07/2025&endDate=14/10/2026`]);
  assert.equal(a.price!.value, 168.2);
  assert.equal(extra(a).portal_api_url, f.urls[0]);
  assert.equal(a.method_url, "https://example.test/method");
  assert.deepEqual(a.query, { country: "IE", product: "pig" });

  const g = fake(F.MILK_GR);
  const gr = await euFarmPrices({ country: "GR", product: "milk", now: NOW }, { fetcher: g.fetcher });
  assert.match(g.urls[0], /memberStateCodes=EL&/);
  assert.equal(gr.price!.value, 55.3);
  assert.equal(gr.query.country, "GR");

  const notFound = async () => {
    throw new SourceError("Source returned HTTP 404", JSON.stringify(F.NOT_FOUND));
  };
  const none = await euFarmPrices({ country: "IE", product: "tomatoes", now: NOW }, { fetcher: notFound });
  assert.equal(none.status, "no_matches");

  const other404 = async () => {
    throw new SourceError("Source returned HTTP 404", "<html>Not here</html>");
  };
  await assert.rejects(euFarmPrices({ country: "IE", product: "pig", now: NOW }, { fetcher: other404 }), /HTTP 404/);
  const limited = async () => {
    throw new SourceError("Source returned HTTP 429", "Too Many Requests");
  };
  await assert.rejects(euFarmPrices({ country: "IE", product: "pig", now: NOW }, { fetcher: limited }), /limiting requests at the moment/);
  const down = async () => {
    throw new SourceError("Source returned HTTP 503", "");
  };
  await assert.rejects(euFarmPrices({ country: "IE", product: "pig", now: NOW }, { fetcher: down }), /HTTP 503/);
  await assert.rejects(euFarmPrices({ country: "IE", product: "pig", now: NOW }, { fetcher: async () => ({ message: "weird" }) }), /unexpected answer/);
});

test("eu-farm-prices: a momentary gateway error (HTTP 500 'endpoint SUSPENDED', seen live on a cold call) is retried once", async () => {
  const suspended = JSON.stringify({ code: "303001", type: "Status report", message: "Runtime Error", description: "Currently , Address endpoint : [ Name : AgrifoodPublicData--vprod_APIproductionEndpoint ] [ State : SUSPENDED ]" });
  let calls = 0;
  const flaky = async () => {
    calls++;
    if (calls === 1) throw new SourceError("Source returned HTTP 500", suspended);
    return F.PIG_IE_YEAR;
  };
  const ok = await euFarmPrices({ country: "IE", product: "pig", now: NOW }, { fetcher: flaky });
  assert.equal(calls, 2);
  assert.equal(ok.status, "ok");
  assert.equal(ok.price!.value, 168.2);

  // still failing on the second try: the error is passed on (after exactly two tries), never an invented price
  let tries = 0;
  const dead = async () => {
    tries++;
    throw new SourceError("Source returned HTTP 500", suspended);
  };
  await assert.rejects(euFarmPrices({ country: "IE", product: "pig", now: NOW }, { fetcher: dead }), /HTTP 500/);
  assert.equal(tries, 2);

  // a 404 or 429 is an answer, not a hiccup: no retry
  let once = 0;
  const limited = async () => {
    once++;
    throw new SourceError("Source returned HTTP 429", "Too Many Requests");
  };
  await assert.rejects(euFarmPrices({ country: "IE", product: "pig", now: NOW }, { fetcher: limited }), /limiting requests/);
  assert.equal(once, 1);
});

test("eu-farm-prices: bad input gets a clear InputError before any request", async () => {
  const f = fake([]);
  await assert.rejects(euFarmPrices({ country: "LU", product: "pig" }, { fetcher: f.fetcher }), (e: any) => e instanceof InputError && /Not yet: LU/.test(e.message));
  await assert.rejects(euFarmPrices({ country: "NO", product: "pig" }, { fetcher: f.fetcher }), InputError);
  await assert.rejects(euFarmPrices({ country: "IE", product: "plutonium" }, { fetcher: f.fetcher }), (e: any) => e instanceof InputError && /Choose one of/.test(e.message));
  await assert.rejects(euFarmPrices({ country: "IE" }, { fetcher: f.fetcher }), /product is required/);
  assert.equal(f.urls.length, 0);
});

test("eu-farm-prices: the shared tool routes by country and needs a product", async () => {
  const cat = categoryById("farm-prices")!;
  await assert.rejects(runCategory(cat, { country: "LU", product: "pig" }), /Farm and wholesale food prices are available for .* so far\. Not yet: LU\./);
  await assert.rejects(runCategory(cat, { country: "IE" }), /product is required/);
  await assert.rejects(runCategory(cat, { product: "pig" }), /country is required/);
  assert.equal((cat.prepare!({ country: "IE", product: "  Pig " }) as any).product, "Pig");
  assert.throws(() => cat.prepare!({ country: "IE", product: "   " }), InputError);
});

test("eu-farm-prices: stage words are plain", () => {
  assert.equal(stageShort("Price at farm gate"), "farm-gate");
  assert.equal(stageShort("Farmgate price"), "farm-gate");
  assert.equal(stageShort("Departure from silo - after some storage - on truck or other transport means"), "ex-silo");
  assert.equal(stageShort("Deliver to first customer - silo or processing plant - on truck or other transport means"), "delivered to the first buyer");
  assert.equal(stageShort("Delivered to port - grain delivered to a port silo by train or truck or barge"), "delivered to port");
  assert.equal(stageShort("Something else entirely"), "something else entirely");
});
