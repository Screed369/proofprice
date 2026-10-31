import { test } from "node:test";
import assert from "node:assert/strict";
import { InputError, SourceError } from "../../lib/http";
import { categoryById, paramSchemas, runCategory, SOURCE_PLUGINS } from "../../lib/registry";
import {
  ageNote, changePercent, changeSentence, dataUrl, denmarkAnswer, denmarkHomePrices, fold, INFO, isoQuarter, isPreliminary, municipalitiesIn, normaliseType,
  parseStatbank, periodWords, PLACES, readDenmark, resolvePlace, unavailableAnswer, yearEarlier,
} from "./source";
import { DK_MUNICIPALITIES, DK_PROVINCES, DK_REGIONS, PROVINCE_REGION } from "./places";
import * as F from "./fixtures";

// Fixtures: real Statistics Denmark StatBank API v1 responses captured 2026-10-14 (see fixtures.ts).
const NOW = new Date("2026-10-14T12:00:00Z");
const URL_KBH = "https://api.statbank.dk/v1/data/EJEN77/JSONSTAT?lang=en&OMR%C3%85DE=01,000&EJENDOMSKATE=0111,2103&BN%C3%98GLE=2,3&OVERDRAG=1&Tid=*";
const URL_OST = URL_KBH.replace("01,000", "09,000");
const URL_BORN = URL_KBH.replace("01,000", "04,000");
const URL_DK = URL_KBH.replace("01,000", "000");

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

test("dk-home-prices: licence, attribution and type are Statistics Denmark's", () => {
  assert.equal(INFO.id, "dk-home-prices");
  assert.equal(INFO.price_type, "official_statistic");
  assert.equal(INFO.publisher, "Statistics Denmark (Danmarks Statistik)");
  assert.match(INFO.licence, /All statistics on Statistikbanken\.dk and the website dst\.dk can be used free of charge commercially as well as non-commercially\./);
  assert.match(INFO.licence, /It is, however, required to indicate the source\. This corresponds to the license known as Creative Commons, CC 4\.0 BY/);
  assert.equal(INFO.licence_url, "https://www.dst.dk/en/presse/kildeangivelse");
  for (const k of ["Statistics Denmark", "EJEN77", "own calculations"]) assert.ok(INFO.attribution.includes(k), k);
  assert.match(INFO.limits, /preliminary average prices are underestimated/);
});

test("dk-home-prices: registered for DK on the home-sales tool, smoke test first, property types added", () => {
  const plugin = SOURCE_PLUGINS.find((s) => s.info.id === "dk-home-prices")!;
  assert.equal(plugin.category, "home-sales");
  assert.deepEqual(plugin.countries, ["DK"]);
  assert.deepEqual(plugin.examples[0].params, { country: "DK", town: "København" });
  const types = (paramSchemas(categoryById("home-sales")!).property_type as any).unwrap().options as string[];
  for (const t of ["any", "house", "detached", "terraced", "flat"]) assert.ok(types.includes(t), t);
});

test("dk-home-prices: the region list matches the real table (All Denmark, 5 regions, 11 provinces, no municipalities)", () => {
  const regions = F.TABLEINFO.variables.find((v: any) => v.id === "OMRÅDE").values as Array<{ id: string; text: string }>;
  assert.equal(regions.length, 17);
  const text = new Map(regions.map((r) => [r.id, r.text]));
  for (const [code, name] of [...DK_REGIONS, ...DK_PROVINCES]) assert.equal(text.get(code), name, code);
  assert.equal(text.get("000"), "All Denmark");
  assert.equal(DK_REGIONS.length + DK_PROVINCES.length + 1, regions.length);
  // every municipality points at a province that exists, and every province at a region that exists
  for (const [, [, province]] of Object.entries(DK_MUNICIPALITIES)) assert.ok(text.has(province), province);
  for (const [province, region] of Object.entries(PROVINCE_REGION)) assert.ok(text.has(province) && text.has(region), province);
  assert.equal(Object.keys(DK_MUNICIPALITIES).length, 99); // 98 municipalities and Christiansø
  assert.equal(PLACES.filter((p) => p.level === "municipality").length, 99);
});

test("dk-home-prices: the table has the categories, key figures and quarters the code asks for", () => {
  const v = (id: string) => F.TABLEINFO.variables.find((x: any) => x.id === id).values as Array<{ id: string; text: string }>;
  assert.equal(v("EJENDOMSKATE").find((x) => x.id === "0111")!.text, "One-family houses");
  assert.equal(v("EJENDOMSKATE").find((x) => x.id === "2103")!.text, "Owner-occupied flats, total");
  assert.equal(v("BNØGLE").find((x) => x.id === "2")!.text, "Sales in the price calculation (number)");
  assert.equal(v("BNØGLE").find((x) => x.id === "3")!.text, "Average price per property (dkk 1000)");
  assert.equal(v("OVERDRAG").find((x) => x.id === "1")!.text, "Ordinary free trade");
  assert.equal(v("Tid")[v("Tid").length - 1].id, "2026K2");
});

test("dk-home-prices: every province has the municipalities that Statistics Denmark lists under it", () => {
  assert.deepEqual(municipalitiesIn("01"), ["Copenhagen", "Frederiksberg"]);
  assert.equal(municipalitiesIn("02").length, 15);
  assert.equal(municipalitiesIn("03").length, 11);
  assert.deepEqual(municipalitiesIn("04"), ["Bornholm", "Christiansø"]);
  assert.equal(municipalitiesIn("05").length, 5);
  assert.equal(municipalitiesIn("06").length, 12);
  assert.equal(municipalitiesIn("07").length, 10);
  assert.equal(municipalitiesIn("08").length, 12);
  assert.equal(municipalitiesIn("09").length, 11);
  assert.equal(municipalitiesIn("10").length, 8);
  assert.equal(municipalitiesIn("11").length, 11);
});

test("dk-home-prices: names are matched without diacritics, in English, and a town is answered with its province", () => {
  assert.equal(fold("København"), "kobenhavn");
  for (const t of ["København", "Kobenhavn", "Copenhagen", "KBH", "Københavns Kommune"]) {
    const p = resolvePlace(t);
    assert.deepEqual([p.level, p.code, p.dataCode], ["municipality", "101", "01"], t);
  }
  for (const t of ["Aarhus", "Århus", "aarhus kommune"]) assert.deepEqual([resolvePlace(t).code, resolvePlace(t).dataCode], ["751", "09"], t);
  for (const t of ["Aalborg", "Ålborg", "Alborg"]) assert.deepEqual([resolvePlace(t).code, resolvePlace(t).dataCode], ["851", "11"], t);
  assert.equal(resolvePlace("Odense").dataCode, "07");
  assert.equal(resolvePlace("Høje-Taastrup").code, "169");
  assert.equal(resolvePlace("Hoeje-Taastrup").code, "169");
  assert.equal(resolvePlace("Koege").code, "259");
  assert.equal(resolvePlace("Ærø").code, "492");
  assert.equal(resolvePlace("Helsingør").code, "217");
  assert.equal(resolvePlace("Elsinore").code, "217");
  assert.equal(resolvePlace("Taastrup").code, "169");
  assert.deepEqual([resolvePlace("Fyn").level, resolvePlace("Fyn").code], ["province", "07"]);
  assert.equal(resolvePlace("Funen").code, "07");
  assert.equal(resolvePlace("Østjylland").code, "09");
  assert.equal(resolvePlace("Province Østjylland").code, "09");
  assert.equal(resolvePlace("Bornholm").level, "municipality"); // a municipality and a province of that name: the municipality
  assert.equal(resolvePlace("Bornholm").dataCode, "04");
  assert.equal(resolvePlace("Nordjylland").level, "province");
  assert.equal(resolvePlace("Region Nordjylland").code, "081");
  assert.equal(resolvePlace("Hovedstaden").code, "084");
  assert.equal(resolvePlace("Capital Region").code, "084");
  assert.equal(resolvePlace("Zealand").code, "085");
  assert.equal(resolvePlace("Syddanmark").code, "083");
  assert.equal(resolvePlace("Midtjylland").code, "082");
  for (const t of [undefined, "", "Denmark", "Danmark"]) assert.equal(resolvePlace(t).code, "000");
  assert.throws(() => resolvePlace("Jutland"), (e: any) => e instanceof InputError && /separate provinces/.test(e.message));
  assert.throws(() => resolvePlace("Atlantis"), (e: any) => e instanceof InputError && /no place called "Atlantis"/.test(e.message));
});

test("dk-home-prices: property types: house and flat, any by default, detached and terraced known but not split", () => {
  assert.equal(normaliseType(undefined), "any");
  assert.equal(normaliseType("house"), "house");
  assert.equal(normaliseType("Parcelhus"), "house");
  assert.equal(normaliseType("flat"), "flat");
  assert.equal(normaliseType("Ejerlejlighed"), "flat");
  assert.equal(normaliseType("apartment"), "flat");
  assert.equal(normaliseType("detached"), "detached");
  assert.equal(normaliseType("Rækkehus"), "terraced");
  assert.equal(normaliseType("terraced"), "terraced");
  assert.throws(() => normaliseType("castle"), (e: any) => e instanceof InputError && /must be one of/.test(e.message));
});

test("dk-home-prices: periods, preliminary and changes", () => {
  assert.equal(isoQuarter("2026K2"), "2026-Q2");
  assert.equal(yearEarlier("2026-Q2"), "2025-Q2");
  assert.equal(periodWords("2026-Q2"), "the second quarter of 2026");
  assert.equal(changePercent(8345, 7998), 4.3);
  assert.equal(isPreliminary("2026-06-30", NOW), true); // ended 3.5 months ago
  assert.equal(isPreliminary("2025-12-31", NOW), true); // 9.5 months: final only after 13
  assert.equal(isPreliminary("2025-06-30", NOW), false);
  assert.equal(ageNote("2026-06-30", NOW), null);
  assert.match(ageNote("2024-12-31", NOW)!, /old: its period ended about 22 months ago/);
  assert.equal(
    changeSentence({ reference_period: "2026-Q1", average: 1, sales: 9, change_percent: -0.5 }, { reference_period: "2025-Q2", average: 1, sales: 9, change_percent: 0 }),
    " That is 0.5% lower than in the first quarter of 2026 and unchanged from a year earlier (the second quarter of 2025).",
  );
});

test("dk-home-prices: the request is one GET with the exact variable codes probed", () => {
  assert.equal(dataUrl(["01", "000"]), URL_KBH);
  assert.equal(dataUrl(["000"]), URL_DK);
});

test("dk-home-prices: the StatBank v1 cube is read through the shared JSON-stat parser; errors are errors", () => {
  const t = parseStatbank(F.COPENHAGEN);
  assert.deepEqual(t.ids, ["OMRÅDE", "EJENDOMSKATE", "BNØGLE", "OVERDRAG", "ContentsCode", "Tid"]);
  assert.equal(t.rows.length, 1104);
  assert.equal(t.updated, "2026-09-29T06:00:00Z");
  assert.throws(() => parseStatbank({ errorTypeCode: "EXTRACT-EMPTY", message: "Variable supplied without any values." }), (e: any) => e instanceof SourceError && /refused the request: Variable supplied without any values/.test(e.message));
  assert.throws(() => parseStatbank({ hello: 1 }), SourceError);
  assert.throws(() => parseStatbank(null), SourceError);
});

test("dk-home-prices: reads Copenhagen (the province Byen København) from the real cube, prices in DKK 1000 converted to DKK", () => {
  const t = parseStatbank(F.COPENHAGEN);
  const place = resolvePlace("København");
  const flat = readDenmark(t, { place, type: "flat" })!;
  assert.equal(flat.figure.type, "flat");
  assert.equal(flat.figure.reference_period, "2026-Q2");
  assert.equal(flat.figure.average, 6168000);
  assert.equal(flat.figure.sales, 1384);
  assert.deepEqual(flat.figure.previous, { reference_period: "2026-Q1", average: 6198000, sales: 1613, change_percent: -0.5 });
  assert.deepEqual(flat.figure.year_earlier, { reference_period: "2025-Q2", average: 5285000, sales: 1926, change_percent: 16.7 });
  assert.deepEqual(flat.figure.national, { average: 3966000, sales: 3928 });
  assert.deepEqual(flat.other, { type: "house", reference_period: "2026-Q2", average: 8345000, sales: 321 });
  assert.equal(flat.datasetLatest, "2026-Q2");
  const house = readDenmark(t, { place, type: "house" })!;
  assert.equal(house.figure.average, 8345000);
  assert.equal(house.figure.sales, 321);
  assert.equal(house.figure.previous!.change_percent, 4.3);
  assert.equal(house.figure.year_earlier!.change_percent, 6.1);
  assert.deepEqual(house.figure.national, { average: 3129000, sales: 12549 });
  // no type: the group with more sales (flats in Copenhagen)
  assert.equal(readDenmark(t, { place, type: "any" })!.figure.type, "flat");
});

test("dk-home-prices: with no type, the group with more sales wins (houses in Østjylland and Bornholm)", () => {
  const ost = readDenmark(parseStatbank(F.OSTJYLLAND), { place: resolvePlace("Aarhus"), type: "any" })!;
  assert.equal(ost.figure.type, "house");
  assert.equal(ost.figure.average, 3128000);
  assert.equal(ost.figure.sales, 2069);
  assert.equal(ost.other!.type, "flat");
  const born = readDenmark(parseStatbank(F.BORNHOLM), { place: resolvePlace("Bornholm"), type: "any" })!;
  assert.equal(born.figure.type, "house");
  assert.equal(born.figure.average, 1483000);
  assert.equal(born.figure.previous!.change_percent, -3.1);
  assert.equal(born.figure.year_earlier!.change_percent, 1.5);
});

test("dk-home-prices: all of Denmark has no national comparison line", () => {
  const r = readDenmark(parseStatbank(F.COPENHAGEN), { place: resolvePlace("Denmark"), type: "house" })!;
  assert.equal(r.figure.average, 3129000);
  assert.equal(r.figure.sales, 12549);
  assert.equal(r.figure.national, null);
});

test("dk-home-prices: the answer is an official average with its quarter, sales, preliminary flag, source and licence", () => {
  const place = resolvePlace("København");
  const reading = readDenmark(parseStatbank(F.COPENHAGEN), { place, type: "any" });
  const a = denmarkAnswer(reading, { place, type: "any", now: NOW, baseUrl: "https://proofprice.com", apiUrl: URL_KBH });
  assert.equal(a.status, "ok");
  assert.deepEqual(a.price, { currency: "DKK", unit: "per home", value: 6168000, measure: "average", median: null, typical_low: null, typical_high: null, min: null, max: null });
  assert.equal(a.sample_size, 1384);
  assert.equal(a.confidence, "high");
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.statistic!.measure, "average");
  assert.equal(a.statistic!.reference_period, "2026-Q2");
  assert.deepEqual(a.period, { from: "2026-04-01", to: "2026-06-30" });
  assert.equal(a.source.licence_url, "https://www.dst.dk/en/presse/kildeangivelse");
  assert.match(a.summary, /In Copenhagen \(province Byen København\) the average price of an owner-occupied flat \(ordinary free-trade sales\) was DKK\s6,168,000 in the second quarter of 2026 \(preliminary; Statistics Denmark says preliminary averages are underestimated\), from 1,384 sales\./);
  assert.match(a.summary, /That is 0\.5% lower than in the first quarter of 2026 and 16\.7% higher than a year earlier \(the second quarter of 2025\)\./);
  assert.match(a.summary, /Official average published by Statistics Denmark \(Danmarks Statistik\) for 2026-Q2\./);
  const note = a.statistic!.note!;
  assert.match(note, /table by province, not by municipality: the figure is for Byen København, the province where Copenhagen lies \(Copenhagen, Frederiksberg\)\./);
  assert.match(note, /No property type was given, so the answer is for owner-occupied flats/);
  assert.match(note, /Preliminary: Statistics Denmark says preliminary average prices are underestimated/);
  const x = a.extra as any;
  assert.equal(x.preliminary, true);
  assert.deepEqual(x.place.figure_is_for, { code: "01", name: "Byen København" });
  assert.deepEqual(x.province_covers_municipalities, ["Copenhagen", "Frederiksberg"]);
  assert.equal(x.region_code, "084");
  assert.equal(x.other_type.type, "house");
  assert.equal(x.other_type.average_price, 8345000);
  assert.equal(x.national_average.average, 3966000);
  assert.equal(x.statbank_api_url, URL_KBH);
  assert.equal(x.dataset.table, "EJEN77");
});

test("dk-home-prices: a final (not preliminary) quarter has no preliminary note; an old one is flagged", () => {
  const place = resolvePlace("Fyn");
  const reading = readDenmark(parseStatbank(F.COPENHAGEN), { place: resolvePlace("København"), type: "house" });
  const later = denmarkAnswer(reading, { place, type: "house", now: new Date("2027-09-01T00:00:00Z") });
  assert.doesNotMatch(later.statistic!.note ?? "", /Preliminary/);
  assert.doesNotMatch(later.summary, /preliminary/);
  const old = denmarkAnswer(reading, { place, type: "house", now: new Date("2028-06-01T00:00:00Z") });
  assert.match(old.statistic!.note!, /This figure is old: its period ended about 23 months ago/);
});

test("dk-home-prices: a flat in Aarhus is the Østjylland flat figure, and a province asked by name has no town note", () => {
  const aarhus = resolvePlace("Aarhus");
  const a = denmarkAnswer(readDenmark(parseStatbank(F.OSTJYLLAND), { place: aarhus, type: "flat" }), { place: aarhus, type: "flat", now: NOW });
  assert.equal(a.price!.value, 3010000);
  assert.equal(a.sample_size, 660);
  assert.match(a.summary, /In Aarhus \(province Østjylland\) the average price of an owner-occupied flat/);
  assert.match(a.summary, /1\.2% higher than in the first quarter of 2026 and 12\.1% higher than a year earlier/);
  assert.match(a.statistic!.note!, /the figure is for Østjylland, the province where Aarhus lies\./);
  assert.doesNotMatch(a.statistic!.note!, /\(Aarhus/); // the long list of municipalities is in extra, not in the note
  const fyn = resolvePlace("Fyn");
  const f = denmarkAnswer(readDenmark(parseStatbank(F.OSTJYLLAND), { place: { ...fyn, dataCode: "09", dataShort: "Østjylland" }, type: "house" }), { place: fyn, type: "house", now: NOW });
  assert.doesNotMatch(f.statistic!.note ?? "", /by province, not by municipality/);
});

test("dk-home-prices: fewer than 5 sales never gives a figure (Bornholm flats)", () => {
  const place = resolvePlace("Bornholm");
  const reading = readDenmark(parseStatbank(F.BORNHOLM), { place, type: "flat" })!;
  assert.equal(reading.figure.sales, 1);
  assert.equal(reading.figure.average, 865000);
  assert.equal(reading.figure.previous, null); // the quarter before has no sales at all
  const a = denmarkAnswer(reading, { place, type: "flat", now: NOW });
  assert.equal(a.status, "insufficient_data");
  assert.equal(a.price, null);
  assert.equal(a.confidence, "insufficient");
  assert.match(a.summary, /reports only 1 sale\(s\) of owner-occupied flats behind the latest average for Bornholm/);
});

test("dk-home-prices: a few sales still allow a figure but not a comparison with a thin quarter, and say it is volatile", () => {
  const place = resolvePlace("Bornholm");
  const t = parseStatbank(F.BORNHOLM);
  const house = denmarkAnswer(readDenmark(t, { place, type: "house" }), { place, type: "house", now: NOW });
  assert.equal(house.status, "ok");
  assert.equal(house.sample_size, 144);
  assert.equal(house.confidence, "high");
  // a modified copy where the latest house quarter has 12 sales
  const thin = JSON.parse(JSON.stringify(F.BORNHOLM));
  const n = 138;
  thin.dataset.value[n - 1] = 12; // 04 / 0111 / sales / 2026K2
  const small = denmarkAnswer(readDenmark(parseStatbank(thin), { place, type: "house" }), { place, type: "house", now: NOW });
  assert.equal(small.sample_size, 12);
  assert.equal(small.confidence, "low");
  assert.match(small.statistic!.note!, /Only 12 sales stand behind this average, so it is volatile\./);
});

test("dk-home-prices: no data for the place is a clear no_matches; detached and terraced are explained", () => {
  const place = resolvePlace("København");
  const none = denmarkAnswer(null, { place, type: "flat" });
  assert.equal(none.status, "no_matches");
  assert.equal(none.price, null);
  assert.match(none.summary, /publishes no average price for owner-occupied flats in Copenhagen \(province Byen København\)/);
  const un = unavailableAnswer("detached", place);
  assert.equal(un.status, "no_matches");
  assert.match(un.summary, /does not publish a price for detached houses separately/);
  assert.equal(un.price_type, "official_statistic");
});

test("dk-home-prices: end to end, København with no type is one request and the flat figure", async () => {
  const r = router({ [URL_KBH]: F.COPENHAGEN });
  const a = await denmarkHomePrices({ town: "København" }, { fetcher: r.fetcher, now: NOW });
  assert.deepEqual(r.urls, [URL_KBH]);
  assert.equal(a.status, "ok");
  assert.equal(a.price!.value, 6168000);
  assert.equal(a.source.id, "dk-home-prices");
});

test("dk-home-prices: end to end, Aarhus flat, Fyn house with the right region, all of Denmark with one region", async () => {
  const r = router({ [URL_OST]: F.OSTJYLLAND, [URL_DK]: F.COPENHAGEN });
  const a = await denmarkHomePrices({ town: "Aarhus", property_type: "flat" }, { fetcher: r.fetcher, now: NOW });
  assert.deepEqual(r.urls, [URL_OST]);
  assert.equal(a.price!.value, 3010000);
  const d = await denmarkHomePrices({ property_type: "house" }, { fetcher: r.fetcher, now: NOW });
  assert.equal(r.urls[1], URL_DK);
  assert.equal(d.price!.value, 3129000);
  assert.match(d.summary, /In Denmark the average price of a one-family house/);
  assert.equal((d.extra as any).national_average, undefined);
});

test("dk-home-prices: postcode alone is not supported, with a town it is ignored; detached needs no request; a failing source is a SourceError", async () => {
  await assert.rejects(denmarkHomePrices({ postcode: "8000" }, { fetcher: async () => ({}) }), (e: any) => e instanceof InputError && /not by postcode/.test(e.message));
  const r = router({ [URL_OST]: F.OSTJYLLAND });
  const a = await denmarkHomePrices({ town: "Aarhus", postcode: "8000", property_type: "house" }, { fetcher: r.fetcher, now: NOW });
  assert.match(a.statistic!.note!, /The postcode 8000 was ignored/);
  let calls = 0;
  const u = await denmarkHomePrices({ town: "Odense", property_type: "terraced" }, { fetcher: async () => (calls++, {}) });
  assert.equal(calls, 0);
  assert.equal(u.status, "no_matches");
  await assert.rejects(denmarkHomePrices({ town: "Odense" }, { fetcher: async () => { throw new SourceError("Source returned HTTP 503"); } }), SourceError);
});

test("dk-home-prices: routed by country through the shared home-sales tool (network stubbed)", async () => {
  const realFetch = globalThis.fetch;
  const seen: string[] = [];
  globalThis.fetch = (async (url: any) => {
    seen.push(String(url));
    return new Response(JSON.stringify(F.COPENHAGEN), { status: 200, headers: { "content-type": "text/json; charset=utf-8" } });
  }) as typeof fetch;
  try {
    const a = await runCategory(categoryById("home-sales")!, { country: "dk", town: "København" });
    assert.equal(a.status, "ok");
    assert.equal(a.source.id, "dk-home-prices");
    assert.equal(a.price!.value, 6168000);
    assert.deepEqual(seen, [URL_KBH]);
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ---------- stale-if-error copy (harvest) ----------
import { dkHarvest, dkHistoryKey, harvestRows, harvestUrl, quarterEnd } from "./source";
import { NO_COUNT } from "../../lib/stats";

test("dk-home-prices: harvest asks for Denmark, every region and every province in ONE request", () => {
  const u = harvestUrl();
  assert.ok(u.startsWith("https://api.statbank.dk/v1/data/EJEN77/JSONSTAT?lang=en&OMR%C3%85DE=000,"));
  for (const [c] of [...DK_REGIONS, ...DK_PROVINCES]) assert.ok(u.includes(`,${c}`), c);
});

test("dk-home-prices: quarterEnd gives the last day of the quarter", () => {
  assert.equal(quarterEnd("2026K1"), "2026-03-31");
  assert.equal(quarterEnd("2026K2"), "2026-06-30");
  assert.equal(quarterEnd("2026K3"), "2026-09-30");
  assert.equal(quarterEnd("2026K4"), "2026-12-31");
  assert.throws(() => quarterEnd("2026"), SourceError);
});

test("dk-home-prices: harvestRows keeps the newest national quarter of the real reply, with no made-up count", () => {
  const out = harvestRows(parseStatbank(F.ALL_AREAS));
  assert.equal(out.currency, "DKK");
  assert.equal(out.unit, "per property");
  assert.match(out.date, /^\d{4}-(03-31|06-30|09-30|12-31)$/);
  const national = out.rows.find((r) => r.area === "000" && r.item === "house")!;
  assert.ok(national && national.median > 500000 && national.median < 10000000, `national house ${national?.median}`);
  assert.ok(Number.isNaN(national.n) && national.n === NO_COUNT || Number.isNaN(national.n));
  assert.equal(national.low, national.median);
  assert.equal(national.high, national.median);
  // every row is whole kroner, positive, and the three items are consistent: "any" equals one of house/flat in the same area
  for (const r of out.rows) {
    assert.ok(Number.isInteger(r.median) && r.median > 0, `${r.area}/${r.item}`);
    if (r.item === "any") {
      const h = out.rows.find((x) => x.area === r.area && x.item === "house");
      const f = out.rows.find((x) => x.area === r.area && x.item === "flat");
      assert.ok(r.median === h?.median || r.median === f?.median, `any in ${r.area}`);
    }
  }
  // areas the live answer can name: Denmark, the five regions and the provinces that have enough sales
  const areas = new Set(out.rows.map((r) => r.area));
  for (const c of ["000", "084", "085", "083", "082", "081"]) assert.ok(areas.has(c), c);
  assert.ok(areas.size >= 12, `areas ${areas.size}`);
});

test("dk-home-prices: harvestRows agrees with the live reader for the same area, quarter and type", () => {
  const table = parseStatbank(F.ALL_AREAS);
  const out = harvestRows(table);
  const kbh = readDenmark(table, { place: resolvePlace("København"), type: "house" })!;
  const row = out.rows.find((r) => r.area === "01" && r.item === "house")!;
  assert.equal(row.median, Math.round(kbh.figure.average!));
  assert.equal(out.date, quarterEnd(kbh.datasetLatest!.replace(/^(\d{4})-Q([1-4])$/, "$1K$2")));
});

test("dk-home-prices: harvestRows leaves out a place whose newest quarter has fewer than 5 sales", () => {
  const table = parseStatbank(F.ALL_AREAS);
  const out = harvestRows(table);
  for (const r of out.rows.filter((x) => x.item !== "any")) {
    const place = [...DK_REGIONS, ...DK_PROVINCES].find(([c]) => c === r.area) ? PLACES.find((p) => p.dataCode === r.area && p.level !== "municipality")! : PLACES[0];
    const reading = readDenmark(table, { place, type: r.item as "house" | "flat" })!;
    assert.ok((reading.figure.sales ?? 0) >= 5, `${r.area}/${r.item} has ${reading.figure.sales} sales`);
  }
});

test("dk-home-prices: harvestRows refuses a cube with no national house price", () => {
  const t = parseStatbank(F.ALL_AREAS);
  assert.throws(() => harvestRows({ ...t, rows: t.rows.filter((r) => r["OMRÅDE"] !== "000") }), SourceError);
});

test("dk-home-prices: dkHarvest uses the injected fetcher and the one URL", async () => {
  const seen: string[] = [];
  const out = await dkHarvest({ fetcher: async (u: string) => (seen.push(u), F.ALL_AREAS) });
  assert.deepEqual(seen, [harvestUrl()]);
  assert.ok(out.rows.length > 30);
});

test("dk-home-prices: historyKey maps a municipality to its province and the type to the item", () => {
  assert.deepEqual(dkHistoryKey({ town: "København" }), { area: "01", item: "any", label: "Byen København" });
  assert.deepEqual(dkHistoryKey({ town: "Aarhus", property_type: "flat" })?.item, "flat");
  assert.equal(dkHistoryKey({ town: "Aarhus", property_type: "flat" })?.area, resolvePlace("Aarhus").dataCode);
  assert.equal(dkHistoryKey({ property_type: "house" })?.area, "000");
  assert.equal(dkHistoryKey({ postcode: "8000" }), null);
  assert.equal(dkHistoryKey({ town: "Aarhus", property_type: "detached" }), null);
  assert.equal(dkHistoryKey({ town: "Atlantis" }), null);
});

test("dk-home-prices: manifest declares the copy: harvest, historyKey, reference dates, no record count, 35-day window", async () => {
  const src = SOURCE_PLUGINS.find((s) => s.info.id === "dk-home-prices")!;
  assert.ok(src.harvest && src.historyKey && src.referenceDates && src.nominalCounts);
  assert.equal(src.staleMaxDays, 35);
});
