import { test } from "node:test";
import assert from "node:assert/strict";
import { parseJsonStat } from "../../lib/adapters";
import { InputError, SourceError } from "../../lib/http";
import { categoryById, paramSchemas, runCategory, SOURCE_PLUGINS } from "../../lib/registry";
import {
  ageNote, changePercent, changeSentence, countyOf, flatPlace, flatsYearlyUrl, fold, housesQuarterlyUrl, housesYearlyUrl, INFO, isoPeriod, normaliseType, PLACES,
  periodWords, preliminaryNote, readFigure, readSeries, resolvePlace, swedenAnswer, swedenHomePrices, unavailableAnswer,
} from "./source";
import { SE_REGIONS } from "./places";
import * as F from "./fixtures";

// Fixtures: real Statistics Sweden PxWebApi v2 responses captured 2026-10-14 (see fixtures.ts).
const STOCKHOLM = resolvePlace("Stockholm");
const NOW = new Date("2026-10-14T12:00:00Z");
const HY = { price: "BO0501C2", count: "BO0501C1", where: { Fastighetstyp: "220" } };
const HQ = { price: "BO0501L3", count: "BO0501L2" };
const FY = { price: "BO0501R7", count: "BO0501R6", median: "BO0501R8" };
const SCB = "https://statistikdatabasen.scb.se/api/v2/tables";
const URL_HY = `${SCB}/TAB1169/data?lang=en&outputFormat=json-stat2&valueCodes%5BRegion%5D=0180,00&valueCodes%5BFastighetstyp%5D=220&valueCodes%5BContentsCode%5D=BO0501C1,BO0501C2&valueCodes%5BTid%5D=top(3)`;
const URL_HQ = `${SCB}/TAB1167/data?lang=en&outputFormat=json-stat2&valueCodes%5BRegion%5D=01,00&valueCodes%5BContentsCode%5D=BO0501L2,BO0501L3&valueCodes%5BTid%5D=top(6)`;
const URL_FY = `${SCB}/TAB1151/data?lang=en&outputFormat=json-stat2&valueCodes%5BRegion%5D=0020,00&valueCodes%5BContentsCode%5D=BO0501R6,BO0501R7,BO0501R8&valueCodes%5BTid%5D=top(3)`;

function router(map: Record<string, unknown>) {
  const urls: string[] = [];
  return {
    urls,
    fetcher: async (url: string) => {
      urls.push(url);
      if (url in map) return map[url];
      throw new SourceError(`unexpected request ${url}`);
    },
  };
}

test("se-home-prices: licence, attribution and type are Statistics Sweden's", () => {
  assert.equal(INFO.id, "se-home-prices");
  assert.equal(INFO.price_type, "official_statistic");
  assert.equal(INFO.publisher, "Statistics Sweden (SCB)");
  assert.match(INFO.licence, /^CC0\./);
  assert.match(INFO.licence, /without any requirement to state the source/);
  assert.equal(INFO.licence_url, "https://www.scb.se/en/services/open-data-api/");
  for (const k of ["Statistics Sweden", "CC0", "BO0501"]) assert.ok(INFO.attribution.includes(k), k);
  assert.match(INFO.limits, /not a valuation/);
});

test("se-home-prices: registered for SE on the home-sales tool, smoke test first, property types added", () => {
  const plugin = SOURCE_PLUGINS.find((s) => s.info.id === "se-home-prices")!;
  assert.equal(plugin.category, "home-sales");
  assert.deepEqual(plugin.countries, ["SE"]);
  assert.deepEqual(plugin.examples[0].params, { country: "SE", town: "Stockholm" });
  const types = (paramSchemas(categoryById("home-sales")!).property_type as any).unwrap().options as string[];
  for (const t of ["any", "house", "detached", "terraced", "flat"]) assert.ok(types.includes(t), t);
});

test("se-home-prices: the region list is the real table list (Sweden, 21 counties, 290 municipalities)", () => {
  assert.equal(SE_REGIONS.length, 312);
  assert.equal(SE_REGIONS.filter(([c]) => c.length === 2 && c !== "00").length, 21);
  assert.equal(SE_REGIONS.filter(([c]) => c.length === 4).length, 290);
  assert.ok(SE_REGIONS.some(([c, n]) => c === "0180" && n === "Stockholm"));
  assert.equal(PLACES.filter((p) => p.level === "metro").length, 3);
});

test("se-home-prices: names are matched without diacritics, in English, and a bare name is the municipality", () => {
  assert.equal(fold("Göteborg"), "goteborg");
  assert.equal(resolvePlace("Göteborg").code, "1480");
  assert.equal(resolvePlace("Goteborg").code, "1480");
  assert.equal(resolvePlace("Gothenburg").code, "1480");
  assert.equal(resolvePlace("Malmö").code, "1280");
  assert.equal(resolvePlace("Malmo").code, "1280");
  assert.equal(resolvePlace("Stockholm").code, "0180"); // municipality, not the county of the same name
  assert.equal(resolvePlace("Stockholm county").code, "01");
  assert.equal(resolvePlace("Stockholms län").code, "01");
  assert.equal(resolvePlace("Uppsala").level, "municipality");
  assert.equal(resolvePlace("Uppsala län").code, "03");
  assert.equal(resolvePlace("Skåne").code, "12");
  assert.equal(resolvePlace("Skane").level, "county");
  assert.equal(resolvePlace("Västra Götaland").code, "14");
  assert.equal(resolvePlace("Greater Gothenburg").code, "0020");
  assert.equal(resolvePlace("Malmö kommun").code, "1280");
  for (const t of [undefined, "", "Sweden", "Sverige"]) assert.equal(resolvePlace(t).code, "00");
  assert.throws(() => resolvePlace("Atlantis"), (e: any) => e instanceof InputError && /no region called "Atlantis"/.test(e.message));
  assert.equal(countyOf("0180"), "01");
});

test("se-home-prices: property types: house is the default, flat is tenant-owned, detached and terraced are known but not split", () => {
  assert.equal(normaliseType(undefined), "any");
  assert.equal(normaliseType("house"), "house");
  assert.equal(normaliseType("Villa"), "house");
  assert.equal(normaliseType("flat"), "flat");
  assert.equal(normaliseType("apartment"), "flat");
  assert.equal(normaliseType("coop"), "flat");
  assert.equal(normaliseType("detached"), "detached");
  assert.equal(normaliseType("terraced"), "terraced");
  assert.throws(() => normaliseType("castle"), (e: any) => e instanceof InputError && /must be one of/.test(e.message));
});

test("se-home-prices: periods and changes", () => {
  assert.equal(isoPeriod("2026K2"), "2026-Q2");
  assert.equal(isoPeriod("2025"), "2025");
  assert.equal(periodWords("2026-Q2"), "the second quarter of 2026");
  assert.equal(changePercent(110, 100), 10);
  assert.equal(
    changeSentence({ reference_period: "2024", value: 1, change_percent: 2.9 }, null),
    " That is 2.9% higher than in 2024.",
  );
  assert.equal(
    changeSentence({ reference_period: "2026-Q1", value: 1, change_percent: -3.3 }, { reference_period: "2025-Q2", value: 1, change_percent: 0 }),
    " That is 3.3% lower than in the first quarter of 2026 and unchanged from a year earlier (the second quarter of 2025).",
  );
  assert.equal(ageNote("2025-12-31", NOW), null);
  assert.match(ageNote("2024-12-31", NOW)!, /old: its period ended about 22 months ago/);
});

test("se-home-prices: the requests are one GET per table with the exact codes probed", () => {
  assert.equal(housesYearlyUrl(["0180", "00"]), URL_HY);
  assert.equal(housesQuarterlyUrl(["01", "00"]), URL_HQ);
  assert.equal(flatsYearlyUrl(["0020", "00"]), URL_FY);
});

test("se-home-prices: reads Stockholm houses from the real yearly cube (SEK thousand converted to SEK)", () => {
  const t = parseJsonStat(F.STOCKHOLM);
  const series = readSeries(t, { region: "0180", ...HY });
  assert.deepEqual(series.map((p) => [p.reference_period, p.average, p.sales]), [["2023", 8285000, 1061], ["2024", 8597000, 1278], ["2025", 8850000, 1380]]);
  const f = readFigure(t, { kind: "house", asked: STOCKHOLM, place: STOCKHOLM, cadence: "yearly", tableId: "TAB1169", codes: HY })!;
  assert.equal(f.reference_period, "2025");
  assert.equal(f.measure, "average");
  assert.equal(f.value, 8850000);
  assert.equal(f.sales, 1380);
  assert.deepEqual(f.previous, { reference_period: "2024", value: 8597000, change_percent: 2.9 });
  assert.equal(f.year_earlier, null); // yearly: the previous year is the year earlier
  assert.deepEqual(f.national, { average: 3913000, median: null, sales: 57184 });
  assert.equal(f.datasetLatest, "2025");
  assert.match(f.datasetTitle!, /Sold one- and two-dwelling buildings/);
});

test("se-home-prices: reads Stockholm county houses from the real quarterly cube (previous quarter and a year earlier)", () => {
  const t = parseJsonStat(F.STOCKHOLM_COUNTY_Q);
  const county = resolvePlace("Stockholms län");
  const f = readFigure(t, { kind: "house", asked: county, place: county, cadence: "quarterly", tableId: "TAB1167", codes: HQ })!;
  assert.equal(f.reference_period, "2026-Q2");
  assert.equal(f.value, 6991000);
  assert.equal(f.sales, 2348);
  assert.deepEqual(f.previous, { reference_period: "2026-Q1", value: 7232000, change_percent: -3.3 });
  assert.deepEqual(f.year_earlier, { reference_period: "2025-Q2", value: 7000000, change_percent: -0.1 });
  assert.deepEqual(f.national, { average: 3989000, median: null, sales: 14046 });
});

test("se-home-prices: reads Greater Gothenburg tenant-owned flats (median is the headline, average kept)", () => {
  const t = parseJsonStat(F.FLATS_GOTHENBURG);
  const gbg = resolvePlace("Greater Gothenburg");
  const f = readFigure(t, { kind: "flat", asked: resolvePlace("Göteborg"), place: gbg, cadence: "yearly", tableId: "TAB1151", codes: FY })!;
  assert.equal(f.measure, "median");
  assert.equal(f.value, 2750000);
  assert.equal(f.average, 3104000);
  assert.equal(f.median, 2750000);
  assert.equal(f.sales, 10957);
  assert.equal(f.reference_period, "2025");
  assert.deepEqual(f.previous, { reference_period: "2024", value: 2750000, change_percent: 0 });
  assert.deepEqual(f.national, { average: 2888000, median: 2295000, sales: 102062 });
});

test("se-home-prices: where a flat is answered: counties and metro areas only", () => {
  assert.equal(flatPlace(resolvePlace("Göteborg")).code, "0020");
  assert.equal(flatPlace(resolvePlace("Malmö")).code, "0030");
  assert.equal(flatPlace(resolvePlace("Stockholm")).code, "01");
  assert.equal(flatPlace(resolvePlace("Uppsala")).code, "03");
  assert.equal(flatPlace(resolvePlace("Skåne")).code, "12");
  assert.equal(flatPlace(resolvePlace()).code, "00");
});

test("se-home-prices: the answer is an official average with its year, sales, source and licence", () => {
  const f = readFigure(parseJsonStat(F.STOCKHOLM), { kind: "house", asked: STOCKHOLM, place: STOCKHOLM, cadence: "yearly", tableId: "TAB1169", codes: HY })!;
  const a = swedenAnswer(f, { type: "house", asked: STOCKHOLM, now: NOW, baseUrl: "https://proofprice.com", apiUrls: [URL_HY] });
  assert.equal(a.status, "ok");
  assert.deepEqual(a.price, { currency: "SEK", unit: "per home", value: 8850000, measure: "average", median: null, typical_low: null, typical_high: null, min: null, max: null });
  assert.equal(a.sample_size, 1380);
  assert.equal(a.confidence, "high");
  assert.equal(a.price_type, "official_statistic");
  assert.deepEqual(a.statistic!.measure, "average");
  assert.equal(a.statistic!.reference_period, "2025");
  assert.match(a.statistic!.note!, /once a year/);
  assert.deepEqual(a.period, { from: "2025-01-01", to: "2025-12-31" });
  assert.equal(a.source.licence_url, "https://www.scb.se/en/services/open-data-api/");
  assert.match(a.summary, /In Stockholm the average purchase price of a house \(one- or two-dwelling building\) was SEK\s8,850,000 in 2025, from 1,380 sales\./);
  assert.match(a.summary, /That is 2\.9% higher than in 2024\./);
  assert.match(a.summary, /Official average published by Statistics Sweden \(SCB\) for 2025\./);
  const x = a.extra as any;
  assert.equal(x.place.name, "Stockholm");
  assert.equal(x.sweden.average_price, 3913000);
  assert.equal(x.scb_api_urls[0], URL_HY);
});

test("se-home-prices: a flat is answered with the median and says which area the figure is for", () => {
  const gbg = resolvePlace("Greater Gothenburg");
  const asked = resolvePlace("Göteborg");
  const f = readFigure(parseJsonStat(F.FLATS_GOTHENBURG), { kind: "flat", asked, place: gbg, cadence: "yearly", tableId: "TAB1151", codes: FY })!;
  const a = swedenAnswer(f, { type: "flat", asked, now: NOW });
  assert.equal(a.status, "ok");
  assert.equal(a.price!.measure, "median");
  assert.equal(a.price!.median, 2750000);
  assert.equal(a.price!.value, 2750000);
  assert.equal(a.statistic!.measure, "median");
  assert.match(a.summary, /In Göteborg the median purchase price of a tenant-owned flat in Greater Gothenburg was SEK\s2,750,000 in 2025, from 10,957 sales\./);
  assert.match(a.statistic!.note!, /not for municipalities: the figure is for Greater Gothenburg, where Göteborg lies/);
  assert.equal((a.extra as any).average_price, 3104000);
});

test("se-home-prices: a small municipality still has its figure; fewer than 5 sales never do", () => {
  const arj = resolvePlace("Arjeplog");
  const f = readFigure(parseJsonStat(F.ARJEPLOG), { kind: "house", asked: arj, place: arj, cadence: "yearly", tableId: "TAB1169", codes: HY })!;
  assert.equal(f.value, 1434000);
  assert.equal(f.sales, 14);
  const a = swedenAnswer(f, { type: "house", asked: arj, now: NOW });
  assert.equal(a.status, "ok");
  assert.equal(a.confidence, "low");
  assert.match(a.statistic!.note!, /Only 14 sales/);
  const b = swedenAnswer({ ...f, sales: 3 }, { type: "house", asked: arj, now: NOW });
  assert.equal(b.status, "insufficient_data");
  assert.equal(b.price, null);
  assert.match(b.summary, /only 3 sale\(s\)/);
});

test("se-home-prices: no figure is a clear no_matches, and detached or terraced are explained", () => {
  const none = swedenAnswer(null, { type: "flat", asked: STOCKHOLM });
  assert.equal(none.status, "no_matches");
  assert.equal(none.price, null);
  assert.match(none.summary, /publishes no median purchase price of a tenant-owned flat for Stockholm/);
  const un = unavailableAnswer("detached", STOCKHOLM);
  assert.equal(un.status, "no_matches");
  assert.match(un.summary, /does not publish a price for detached houses separately/);
  assert.equal(un.price_type, "official_statistic");
});

test("se-home-prices: the preliminary notes of the publisher are passed on", () => {
  assert.equal(preliminaryNote(F.STOCKHOLM_COUNTY_Q), "Statistics Sweden notes: The figures from 2026 are preliminary.");
  assert.match(preliminaryNote(F.FLATS_GOTHENBURG)!, /Most recent year’s figures are preliminary/);
  assert.equal(preliminaryNote(F.STOCKHOLM), null);
});

test("se-home-prices: end to end, a municipality's houses with the county's latest quarter alongside (two requests)", async () => {
  const r = router({ [URL_HY]: F.STOCKHOLM, [URL_HQ]: F.STOCKHOLM_COUNTY_Q });
  const a = await swedenHomePrices({ town: "Stockholm", property_type: "house" }, { fetcher: r.fetcher, now: NOW });
  assert.deepEqual([...r.urls].sort(), [URL_HQ, URL_HY].sort());
  assert.equal(a.price!.value, 8850000);
  const ctx = (a.extra as any).county_latest_quarter;
  assert.equal(ctx.county, "Stockholm county");
  assert.equal(ctx.reference_period, "2026-Q2");
  assert.equal(ctx.average_price, 6991000);
  assert.equal(ctx.sales, 2348);
  assert.equal(ctx.year_earlier.change_percent, -0.1);
  assert.equal((a.extra as any).other_types, undefined);
});

test("se-home-prices: end to end, no type given shows houses and puts the flats alongside; a failing side request does not break the answer", async () => {
  // Göteborg municipality: houses yearly (1480), county context (14), flats for Greater Gothenburg (0020)
  const urlHyGbg = housesYearlyUrl(["1480", "00"]);
  const urlHqCounty = housesQuarterlyUrl(["14", "00"]);
  const r = router({ [urlHyGbg]: F.STOCKHOLM, [urlHqCounty]: F.STOCKHOLM_COUNTY_Q, [URL_FY]: F.FLATS_GOTHENBURG });
  // the fixture holds Stockholm's code, so the house read for Göteborg finds nothing: that is an honest no_matches
  const a = await swedenHomePrices({ town: "Göteborg" }, { fetcher: r.fetcher, now: NOW });
  assert.equal(a.status, "no_matches");
  assert.ok(r.urls.includes(URL_FY));
  // county context failing is ignored
  const r2 = router({ [housesYearlyUrl(["0180", "00"])]: F.STOCKHOLM, [URL_FY.replace("0020", "01")]: F.FLATS_GOTHENBURG });
  const b = await swedenHomePrices({ town: "Stockholm", property_type: "house" }, { fetcher: r2.fetcher, now: NOW });
  assert.equal(b.status, "ok");
  assert.equal((b.extra as any).county_latest_quarter, undefined);
  // flats alone: one request, for the place's metropolitan area
  const r3 = router({ [URL_FY]: F.FLATS_GOTHENBURG });
  const c = await swedenHomePrices({ town: "Göteborg", property_type: "flat" }, { fetcher: r3.fetcher, now: NOW });
  assert.deepEqual(r3.urls, [URL_FY]);
  assert.equal(c.price!.value, 2750000);
  assert.equal(c.statistic!.measure, "median");
});

test("se-home-prices: a county or Sweden is answered from the quarterly table, one request", async () => {
  const r = router({ [URL_HQ]: F.STOCKHOLM_COUNTY_Q });
  const a = await swedenHomePrices({ town: "Stockholm county", property_type: "house" }, { fetcher: r.fetcher, now: NOW });
  assert.deepEqual(r.urls, [URL_HQ]);
  assert.equal(a.statistic!.reference_period, "2026-Q2");
  assert.deepEqual(a.period, { from: "2026-04-01", to: "2026-06-30" });
  assert.match(a.summary, /in the second quarter of 2026/);
  assert.match(a.statistic!.note!, /Statistics Sweden notes: The figures from 2026 are preliminary\./);
  assert.match(a.summary, /3\.3% lower than in the first quarter of 2026 and 0\.1% lower than a year earlier \(the second quarter of 2025\)/);
});

test("se-home-prices: postcode alone is not supported; detached needs no request", async () => {
  await assert.rejects(swedenHomePrices({ postcode: "11122" }, { fetcher: async () => ({}) }), (e: any) => e instanceof InputError && /not by postcode/.test(e.message));
  let calls = 0;
  const a = await swedenHomePrices({ town: "Stockholm", property_type: "detached" }, { fetcher: async () => (calls++, {}) });
  assert.equal(calls, 0);
  assert.equal(a.status, "no_matches");
  await assert.rejects(swedenHomePrices({ town: "Stockholm" }, { fetcher: async () => { throw new SourceError("Source returned HTTP 503"); } }), SourceError);
});

test("se-home-prices: routed by country through the shared home-sales tool (network stubbed)", async () => {
  const realFetch = globalThis.fetch;
  const seen: string[] = [];
  globalThis.fetch = (async (url: any) => {
    seen.push(String(url));
    const body = String(url) === URL_HY ? F.STOCKHOLM : F.STOCKHOLM_COUNTY_Q;
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const a = await runCategory(categoryById("home-sales")!, { country: "se", town: "Stockholm", property_type: "house" });
    assert.equal(a.status, "ok");
    assert.equal(a.source.id, "se-home-prices");
    assert.equal(a.price!.value, 8850000);
    assert.ok(seen.includes(URL_HY));
  } finally {
    globalThis.fetch = realFetch;
  }
});
