import { test } from "node:test";
import assert from "node:assert/strict";
import { parseJsonStat } from "../../lib/adapters";
import { InputError } from "../../lib/http";
import { categoryById, countriesFor, runCategory, SOURCE_PLUGINS } from "../../lib/registry";
import {
  ageOf, COUNTRIES, euLandPrices, INFO, isReading, landAnswer, landFilters, nationalCurrency, normaliseLandType, normaliseMeasure,
  normaliseRegion, readLand, regionsOf, withThe,
} from "./source";
import * as F from "./fixtures";

// Fixtures: real Eurostat responses captured 2026-10-14 (see fixtures.ts). "Today" in these tests is 2026-10-14.
const NOW = new Date("2026-10-14T12:00:00Z");
const EUROSTAT = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data";

function reading(fixture: unknown, q: { country: string; measure: "price" | "rent"; geo?: string; land_type?: string }) {
  const landType = normaliseLandType(q.measure, q.land_type);
  const geo = q.geo ?? (q.country === "GR" ? "EL" : q.country);
  return { result: readLand(parseJsonStat(fixture), { country: q.country, measure: q.measure, geo, landType }), landType };
}
function answer(fixture: unknown, q: { country: string; measure: "price" | "rent"; geo?: string; land_type?: string; region?: string }) {
  const { result, landType } = reading(fixture, q);
  return landAnswer(result, { country: q.country, measure: q.measure, landType, region: q.region ?? null, now: NOW });
}
const extra = (a: { extra?: Record<string, any> }) => a.extra as Record<string, any>;

function fakeEurostat(body: unknown) {
  const urls: string[] = [];
  return { urls, fetcher: async (url: string) => (urls.push(url), body) };
}

test("eu-land-prices: licence, attribution and type are Eurostat's", () => {
  assert.equal(INFO.id, "eu-land-prices");
  assert.equal(INFO.price_type, "official_statistic");
  assert.equal(INFO.publisher, "Eurostat (European Commission)");
  assert.match(INFO.licence, /CC BY 4\.0/);
  assert.equal(INFO.licence_url, "https://ec.europa.eu/eurostat/help/copyright-notice");
  for (const k of ["Eurostat", "apri_lprc", "apri_lrnt", "CC BY 4.0", "10.2908/APRI_LPRC", "10.2908/APRI_LRNT"]) assert.ok(INFO.attribution.includes(k), k);
  assert.match(INFO.limits, /not a valuation/);
  assert.match(INFO.freshness, /two years/);
});

test("eu-land-prices: covers 26 countries, Greece as GR, no Germany", () => {
  const codes = Object.keys(COUNTRIES);
  assert.equal(codes.length, 26);
  for (const c of ["GR", "IE", "FR", "ES", "PT", "NL", "AT", "PL", "DK", "SE", "NO", "BE", "IT"]) assert.ok(codes.includes(c), c);
  for (const c of ["DE", "CY", "GB", "UK", "EL", "CH", "US", "IS"]) assert.ok(!codes.includes(c), c);
  assert.deepEqual(countriesFor("land-prices"), codes);
  const plugin = SOURCE_PLUGINS.find((s) => s.info.id === "eu-land-prices")!;
  assert.equal(plugin.category, "land-prices");
  assert.equal(plugin.status, "live");
  assert.deepEqual(plugin.examples[0].params, { country: "IE", measure: "price" });
  assert.ok(plugin.examples.length >= 2);
  const cat = categoryById("land-prices")!;
  assert.equal(cat.tool, "pricepaid_land_prices");
  assert.equal(cat.restPath, "land-prices");
  assert.equal(cat.cacheSeconds, 86400);
  assert.equal(cat.title, "Farmland prices and rents");
});

test("eu-land-prices: parameters accept plain words, Eurostat codes and aliases", () => {
  assert.equal(normaliseMeasure("price"), "price");
  assert.equal(normaliseMeasure("Rent"), "rent");
  assert.equal(normaliseMeasure("lease"), "rent");
  assert.equal(normaliseMeasure("sale price"), "price");
  assert.throws(() => normaliseMeasure("tax"), InputError);
  assert.equal(normaliseLandType("price", undefined), null);
  assert.equal(normaliseLandType("price", "")?.code, undefined);
  assert.equal(normaliseLandType("price", "Arable")!.code, "ARA");
  assert.equal(normaliseLandType("price", "grassland")!.code, "J0000");
  assert.equal(normaliseLandType("price", "permanent_grassland")!.code, "J0000");
  assert.equal(normaliseLandType("price", "J0000")!.code, "J0000");
  assert.equal(normaliseLandType("price", "irrigated")!.code, "ARAIB");
  assert.equal(normaliseLandType("price", "non-irrigable arable")!.code, "ARAXIB");
  assert.equal(normaliseLandType("rent", "arable or grassland")!.code, "ARA_J0000");
  assert.equal(normaliseLandType("rent", "ARA_J0000")!.code, "ARA_J0000");
  assert.throws(() => normaliseLandType("price", "forest"), (e: any) => e instanceof InputError && /must be one of/.test(e.message) && /"arable"/.test(e.message));
  // A land type that only the other dataset has gives a clear message
  assert.throws(() => normaliseLandType("price", "arable or grassland"), (e: any) => e instanceof InputError && /no "arable or grassland" figure for price/.test(e.message));
  assert.throws(() => normaliseLandType("rent", "irrigable arable"), (e: any) => e instanceof InputError && /no "irrigable arable" figure for rent/.test(e.message));
});

test("eu-land-prices: a region must be a NUTS code inside the country; GR is asked for as EL", () => {
  assert.equal(normaliseRegion("ES", undefined), null);
  assert.equal(normaliseRegion("ES", "es51"), "ES51");
  assert.equal(normaliseRegion("ES", "ES"), null);
  assert.equal(normaliseRegion("GR", "GR43"), "EL43");
  assert.equal(normaliseRegion("GR", "el43"), "EL43");
  assert.throws(() => normaliseRegion("IE", "ES51"), (e: any) => e instanceof InputError && /must start with IE/.test(e.message));
  assert.throws(() => normaliseRegion("ES", "Catalonia"), (e: any) => e instanceof InputError && /NUTS code/.test(e.message));
  const es = regionsOf("ES");
  assert.ok(es.length >= 20);
  assert.deepEqual(es.find((r) => r.code === "ES51"), { code: "ES51", name: "Cataluña" });
  assert.deepEqual(regionsOf("IE").map((r) => r.code), ["IE0", "IE04", "IE05", "IE06"]);
  assert.ok(regionsOf("GR").length > 5, "Greece regions are found under EL");
  assert.deepEqual(regionsOf("DE"), []);
});

test("eu-land-prices: the Eurostat request is one small slice (country or region, both units), 15 years, with GR sent as EL", () => {
  assert.deepEqual(landFilters("IE"), { geo: "IE", unit: ["EUR_HA", "NAC_HA"] });
});

test("eu-land-prices: national currency labels follow the euro, including Bulgaria (2026) and Croatia (2023)", () => {
  assert.equal(nationalCurrency("SE", 2024), "SEK");
  assert.equal(nationalCurrency("PL", 2024), "PLN");
  assert.equal(nationalCurrency("NO", 2024), "NOK");
  assert.equal(nationalCurrency("IE", 2024), "EUR");
  assert.equal(nationalCurrency("BG", 2025), "BGN");
  assert.equal(nationalCurrency("BG", 2026), "EUR");
  assert.equal(nationalCurrency("HR", 2022), "HRK");
  assert.equal(nationalCurrency("HR", 2023), "EUR");
});

test("eu-land-prices: Ireland price from the real cube (arable by default, provisional 2024, change, other land types)", () => {
  const a = answer(F.PRICE_IE, { country: "IE", measure: "price" });
  assert.equal(a.status, "ok");
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.price!.value, 50375);
  assert.equal(a.price!.currency, "EUR");
  assert.equal(a.price!.unit, "per hectare");
  assert.equal(a.price!.measure, "average");
  assert.equal(a.price!.median, null);
  assert.equal(a.price!.typical_low, null);
  assert.equal(a.sample_size, null);
  assert.equal(a.statistic!.reference_period, "2024");
  assert.deepEqual(a.period, { from: "2024-01-01", to: "2024-12-31" });
  assert.equal(a.confidence, "high");
  assert.match(a.summary, /^In Ireland the average price of arable land was €50,375 per hectare in 2024 \(provisional\)\. That is 43\.3% higher than in 2023\./);
  assert.match(a.summary, /Official average published by Eurostat \(European Commission\) for 2024\.$/);
  assert.match(a.statistic!.note!, /provisional/);
  assert.match(a.statistic!.note!, /No land_type was asked for/);
  assert.deepEqual(extra(a).previous_year, { year: 2023, value: 35162, change_percent: 43.3 });
  assert.equal(extra(a).land_type.key, "arable");
  assert.equal(extra(a).land_type.chosen_by, "default");
  assert.deepEqual(extra(a).other_land_types, [{ land_type: "permanent grassland", label: "Permanent grassland", year: 2024, value_eur_per_hectare: 22698, flag: "p" }]);
  assert.equal(extra(a).history_eur_per_hectare.at(-1).value, 50375);
  assert.equal(extra(a).history_eur_per_hectare[0].year, 2013, "Ireland's series starts in 2013");
  assert.equal(extra(a).national_currency, undefined); // Ireland's national currency is the euro
  assert.equal(extra(a).data_age.level, "usual");
  assert.equal(extra(a).dataset.code, "apri_lprc");
  assert.equal(extra(a).dataset.latest_period_in_dataset, "2024");
  assert.deepEqual(extra(a).regions_available.map((r: any) => r.code).sort(), regionsOf("IE").map((r) => r.code).sort());
  assert.equal(a.source.id, "eu-land-prices");
  assert.match(a.source.licence, /CC BY 4\.0/);
});

test("eu-land-prices: Ireland grassland is asked for by name; a land type Ireland does not have lists the ones it does", () => {
  const g = answer(F.PRICE_IE, { country: "IE", measure: "price", land_type: "grassland" });
  assert.equal(g.status, "ok");
  assert.equal(g.price!.value, 22698);
  assert.match(g.summary, /^In Ireland the average price of permanent grassland was €22,698 per hectare in 2024 \(provisional\)\. That is 6\.5% higher than in 2023\./);
  assert.equal(extra(g).land_type.chosen_by, "request");
  assert.doesNotMatch(g.statistic!.note ?? "", /No land_type was asked for/);
  const miss = answer(F.PRICE_IE, { country: "IE", measure: "price", land_type: "irrigable arable" });
  assert.equal(miss.status, "no_matches");
  assert.equal(miss.price, null);
  assert.equal(miss.confidence, "insufficient");
  assert.match(miss.summary, /Eurostat holds no irrigable arable land price for Ireland\. It does hold: arable \(2024\), permanent grassland \(2024\)\./);
  assert.equal(extra(miss).available_land_types.length, 2);
});

test("eu-land-prices: a Spanish region (Cataluña, ES51) and the whole of Spain, including irrigable and non-irrigable arable land", () => {
  const cat = answer(F.PRICE_ES_ES51, { country: "ES", measure: "price", geo: "ES51", region: "ES51" });
  assert.equal(cat.price!.value, 15278);
  assert.match(cat.summary, /^In Cataluña \(ES51\), Spain the average price of arable land was €15,278 per hectare in 2024\. That is 3\.6% higher than in 2023\./);
  assert.deepEqual(extra(cat).region, { code: "ES51", name: "Cataluña" });
  assert.equal(extra(cat).regions_available, undefined, "a regional answer does not repeat the region list");
  assert.deepEqual(cat.query, { country: "ES", measure: "price", region: "ES51" });
  assert.deepEqual(extra(cat).other_land_types.map((o: any) => [o.land_type, o.value_eur_per_hectare]), [["permanent grassland", 3580], ["irrigable arable", 22410], ["non-irrigable arable", 11804]]);
  const es = answer(F.PRICE_ES_ES51, { country: "ES", measure: "price" });
  assert.equal(es.price!.value, 12778);
  assert.equal(extra(es).region, undefined);
  assert.ok(extra(es).regions_available.some((r: any) => r.code === "ES51" && r.name === "Cataluña"));
  const irr = answer(F.PRICE_ES_ES51, { country: "ES", measure: "price", land_type: "irrigable arable" });
  assert.equal(irr.price!.value, 26895);
});

test("eu-land-prices: old data is flagged loudly (Belgium 2014, Italy 2020 with a series break) and confidence drops", () => {
  const be = answer(F.PRICE_BE_IT_UK_FI_MT, { country: "BE", measure: "price" });
  assert.equal(be.status, "ok");
  assert.equal(be.price!.value, 38496);
  assert.equal(be.statistic!.reference_period, "2014");
  assert.equal(be.confidence, "low");
  assert.match(be.summary, /WARNING: this figure is 12 years old/);
  assert.match(be.summary, /Do not use it as a current price/);
  assert.match(be.statistic!.note!, /estimated/);
  assert.equal(extra(be).data_age.level, "very_old");
  assert.equal(extra(be).data_age.years_behind, 12);

  const it = answer(F.PRICE_BE_IT_UK_FI_MT, { country: "IT", measure: "price" });
  assert.equal(it.price!.value, 35447);
  assert.equal(it.statistic!.reference_period, "2020");
  assert.equal(it.confidence, "low");
  assert.match(it.summary, /6 years old/);
  assert.match(it.statistic!.note!, /Eurostat flags 2019 as a break in the series/);
  assert.deepEqual(extra(it).previous_year, { year: 2019, value: 36307, change_percent: -2.4 });
  assert.deepEqual(extra(it).other_land_types.map((o: any) => o.land_type), ["permanent grassland", "irrigable arable", "non-irrigable arable"]);
});

test("eu-land-prices: ageOf grades the lag (usual up to 2 years, older to 5, very old beyond)", () => {
  assert.equal(ageOf(2024, NOW).level, "usual");
  assert.equal(ageOf(2024, NOW).years, 2);
  assert.equal(ageOf(2023, NOW).level, "older");
  assert.equal(ageOf(2021, NOW).level, "older");
  assert.equal(ageOf(2020, NOW).level, "very_old");
  assert.equal(ageOf(2030, NOW).years, 0);
});

test("eu-land-prices: Malta's 2024 euro column is empty, so its national (euro) figure is used and said so", () => {
  const mt = answer(F.PRICE_BE_IT_UK_FI_MT, { country: "MT", measure: "price" });
  assert.equal(mt.price!.value, 201263);
  assert.equal(mt.statistic!.reference_period, "2024");
  assert.match(mt.statistic!.note!, /euro column is empty for 2024/);
  assert.deepEqual(extra(mt).previous_year, { year: 2023, value: 268649, change_percent: -25.1 });
});

test("eu-land-prices: a land type some countries lack (Finland has no grassland price) is a clear no_matches", () => {
  const fi = answer(F.PRICE_BE_IT_UK_FI_MT, { country: "FI", measure: "price", land_type: "grassland" });
  assert.equal(fi.status, "no_matches");
  assert.match(fi.summary, /Eurostat holds no permanent grassland price for Finland\. It does hold: arable \(2024\)\./);
  const ok = answer(F.PRICE_BE_IT_UK_FI_MT, { country: "FI", measure: "price" });
  assert.equal(ok.status, "ok");
  assert.equal(ok.price!.value, 8670);
});

test("eu-land-prices: Sweden, Poland and Croatia carry the national-currency figure when it differs from euro", () => {
  const se = answer(F.PRICE_SE, { country: "SE", measure: "price" });
  assert.equal(se.price!.value, 10706);
  assert.deepEqual(extra(se).national_currency, { currency: "SEK", price: 122400, unit: "per hectare" });
  assert.match(se.summary, /0\.7% lower than in 2023/);
  const pl = answer(F.PRICE_PL, { country: "PL", measure: "price" });
  assert.equal(pl.price!.value, 16118);
  assert.equal(extra(pl).national_currency.currency, "PLN");
  assert.match(pl.summary, /\(estimated\)/);
  const hr = answer(F.PRICE_HR, { country: "HR", measure: "price" });
  assert.equal(hr.price!.value, 5965);
  assert.equal(extra(hr).national_currency, undefined, "Croatia used the euro in 2024");
  assert.match(hr.summary, /32\.8% higher than in 2023/);
});

test("eu-land-prices: France's single national figure is flagged as defined differently, in plain words", () => {
  const fr = answer(F.PRICE_FR, { country: "FR", measure: "price" });
  assert.equal(fr.price!.value, 6400);
  assert.match(fr.summary, /\(defined differently\)/);
  assert.match(fr.statistic!.note!, /defined differently from other figures \(see Eurostat's metadata\)/);
  assert.equal(extra(fr).other_land_types[0].value_eur_per_hectare, 6400, "France publishes the same figure for grassland");
});

test("eu-land-prices: rents (Ireland, Sweden, Belgium with a gap year, Norway with a break) read the same way", () => {
  const ie = answer(F.RENT_IE, { country: "IE", measure: "rent" });
  assert.equal(ie.price!.value, 426);
  assert.equal(ie.price!.unit, "per hectare per year");
  assert.match(ie.summary, /^In Ireland the average rent for arable land and\/or permanent grassland was €426 per hectare per year in 2024\. That is 2\.2% higher than in 2023\./);
  assert.deepEqual(extra(ie).other_land_types.map((o: any) => [o.land_type, o.value_eur_per_hectare]), [["arable", 540], ["permanent grassland", 407]]);
  assert.equal(extra(ie).dataset.code, "apri_lrnt");
  const arable = answer(F.RENT_IE, { country: "IE", measure: "rent", land_type: "arable" });
  assert.equal(arable.price!.value, 540);
  assert.match(arable.summary, /3\.6% lower than in 2023/);
  const se = answer(F.RENT_SE, { country: "SE", measure: "rent" });
  assert.equal(se.price!.value, 162);
  assert.deepEqual(extra(se).national_currency, { currency: "SEK", price: 1854, unit: "per hectare per year" });
  // Belgium has no 2023 figure for the combined type: a gap is not a change
  const be = answer(F.RENT_BE, { country: "BE", measure: "rent" });
  assert.equal(be.price!.value, 340);
  assert.equal(extra(be).previous_year, null);
  assert.doesNotMatch(be.summary, /higher|lower/);
  // Norway: only 2024 after a long gap; the 2019 figure is not compared with it
  const no = answer(F.RENT_NO, { country: "NO", measure: "rent" });
  assert.equal(no.price!.value, 284);
  assert.equal(extra(no).previous_year, null);
  assert.deepEqual(extra(no).national_currency, { currency: "NOK", price: 3302, unit: "per hectare per year" });
});

test("eu-land-prices: a region Eurostat does not hold is a plain no_matches that points to the regions that exist", () => {
  const a = answer(F.PRICE_UNKNOWN_REGION, { country: "ES", measure: "price", geo: "ZZ99", region: "ES99" });
  assert.equal(a.status, "no_matches");
  assert.equal(a.price, null);
  assert.equal(a.confidence, "insufficient");
  assert.match(a.summary, /Eurostat holds no land price for region ES99 of Spain/);
  assert.match(a.summary, /extra\.regions_available/);
  assert.ok(extra(a).regions_available.length > 20);
  const parsed = parseJsonStat(F.PRICE_UNKNOWN_REGION);
  assert.equal(parsed.rows.length, 0);
  assert.equal(isReading(readLand(parsed, { country: "ES", measure: "price", geo: "ZZ99", landType: null })), false);
});

test("eu-land-prices: the Netherlands is 'the Netherlands' in a sentence, other countries are not", () => {
  // wording only: the Irish figures relabelled as the Netherlands, to see the sentence it would produce
  const asNl = JSON.parse(JSON.stringify(F.PRICE_IE).replaceAll('"IE"', '"NL"').replaceAll('"Ireland"', '"Netherlands"'));
  const nl = answer(asNl, { country: "NL", measure: "price" });
  assert.match(nl.summary, /^In the Netherlands the average price of /);
  assert.equal(extra(nl).country_name, "Netherlands", "the data keeps the plain name");
  const region = answer(F.PRICE_UNKNOWN_REGION, { country: "NL", measure: "price", geo: "ZZ99", region: "NL99" });
  assert.match(region.summary, /for region NL99 of the Netherlands \(apri_lprc\)/);
  assert.match(answer(F.PRICE_IE, { country: "IE", measure: "price" }).summary, /^In Ireland the average price of /);
  assert.equal(withThe("Netherlands"), "the Netherlands");
  assert.equal(withThe("Czechia"), "Czechia");
});

test("eu-land-prices: euLandPrices asks Eurostat for one country (GR as EL), reads the answer and echoes the API link", async () => {
  const f = fakeEurostat(F.PRICE_IE);
  const a = await euLandPrices({ country: "ie", measure: "price", baseUrl: "https://example.test", now: NOW }, { fetcher: f.fetcher });
  assert.deepEqual(f.urls, [`${EUROSTAT}/apri_lprc?format=JSON&lang=EN&geo=IE&unit=EUR_HA&unit=NAC_HA&lastTimePeriod=15`]);
  assert.equal(a.price!.value, 50375);
  assert.equal(extra(a).eurostat_api_url, f.urls[0]);
  assert.equal(a.method_url, "https://example.test/method");
  assert.match(a.method, /dataset apri_lprc/);

  const r = fakeEurostat(F.RENT_IE);
  await euLandPrices({ country: "GR", measure: "rent", region: "GR43", land_type: "arable" }, { fetcher: r.fetcher });
  assert.deepEqual(r.urls, [`${EUROSTAT}/apri_lrnt?format=JSON&lang=EN&geo=EL43&unit=EUR_HA&unit=NAC_HA&lastTimePeriod=15`]);

  const g = fakeEurostat(F.PRICE_ES_ES51);
  const cat = await euLandPrices({ country: "ES", measure: "price", region: "es51", now: NOW }, { fetcher: g.fetcher });
  assert.match(g.urls[0], /geo=ES51&/);
  assert.equal(cat.price!.value, 15278);
});

test("eu-land-prices: bad input gets a clear InputError before any request", async () => {
  const f = fakeEurostat(F.PRICE_IE);
  await assert.rejects(euLandPrices({ country: "DE", measure: "price" }, { fetcher: f.fetcher }), (e: any) => e instanceof InputError && /Not yet: DE/.test(e.message));
  await assert.rejects(euLandPrices({ country: "IE", measure: "tax" }, { fetcher: f.fetcher }), InputError);
  await assert.rejects(euLandPrices({ country: "IE", measure: "price", land_type: "forest" }, { fetcher: f.fetcher }), InputError);
  await assert.rejects(euLandPrices({ country: "IE", measure: "price", region: "ES51" }, { fetcher: f.fetcher }), InputError);
  assert.equal(f.urls.length, 0);
});

test("eu-land-prices: the shared tool routes by country, normalises measure aliases and rejects the rest", async () => {
  const cat = categoryById("land-prices")!;
  await assert.rejects(runCategory(cat, { country: "DE", measure: "price" }), /Farmland prices and rents are available for .* so far\. Not yet: DE\./);
  await assert.rejects(runCategory(cat, { country: "IE", measure: "weather" }), /measure must be "price"/);
  await assert.rejects(runCategory(cat, { measure: "price" }), /country is required/);
  assert.equal((cat.prepare!({ country: "IE", measure: "Leasing" }) as any).measure, "rent");
  assert.equal((cat.prepare!({ country: "IE", measure: "sale price" }) as any).measure, "price");
});
