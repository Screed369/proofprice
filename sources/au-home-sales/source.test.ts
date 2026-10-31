import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { InputError, SourceError } from "../../lib/http";
import { categoryById, paramSchemas, runCategory, SOURCE_PLUGINS } from "../../lib/registry";
import { absAnswer, absHomePrices, ageNote, changePercent, changeSentence, dataUrl, parseAbs, periodWords, readAbs, yearEarlier } from "./abs";
import { INFO, routeAustralia } from "./source";
import { postcodeRegion, REGIONS, resolvePlace } from "./places";

// Fixture: a real ABS Data API response captured 2026-10-14 (dataflow RES_DWELL_ST, measures 4 and 5, all regions, 5 quarters 2025-Q2 to 2026-Q2).
const FIX = JSON.parse(readFileSync(new URL("./fixtures/abs-res-dwell-st.json", import.meta.url), "utf8"));
const NOW = new Date("2026-10-14T12:00:00Z");
const URL_VIC = "https://data.api.abs.gov.au/rest/data/ABS,RES_DWELL_ST/4+5.2+AUS.Q?lastNObservations=6&format=jsondata";
const URL_NSW = URL_VIC.replace("2+AUS", "1+AUS");
const URL_AUS = URL_VIC.replace("2+AUS", "AUS");

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

test("au-home-sales: licence, attribution and type are the ABS's (CC BY 4.0), and the NSW licence problem is stated", () => {
  assert.equal(INFO.id, "au-home-sales");
  assert.equal(INFO.price_type, "official_statistic");
  assert.equal(INFO.publisher, "Australian Bureau of Statistics (ABS)");
  assert.match(INFO.licence, /All material presented on this website is provided under a Creative Commons Attribution 4\.0 International licence/);
  assert.match(INFO.licence, /freely accessible without the need for an API key/);
  assert.equal(INFO.licence_url, "https://www.abs.gov.au/website-privacy-copyright-and-disclaimer#copyright-and-creative-commons");
  for (const k of ["Australian Bureau of Statistics", "RES_DWELL_ST", "Creative Commons Attribution 4.0", "own calculations"]) assert.ok(INFO.attribution.includes(k), k);
  assert.match(INFO.limits, /beta release/);
  assert.match(INFO.limits, /BY-NC-ND 4\.0/);
  assert.match(INFO.limits, /not the average price of the homes sold/);
});

test("au-home-sales: registered for AU on the home-sales tool, Victoria is the smoke test", () => {
  const plugin = SOURCE_PLUGINS.find((s) => s.info.id === "au-home-sales")!;
  assert.equal(plugin.category, "home-sales");
  assert.deepEqual(plugin.countries, ["AU"]);
  assert.deepEqual(plugin.examples[0].params, { country: "AU", town: "Victoria" });
  assert.equal(typeof plugin.harvest, "function"); // stale-if-error copy (Depth Builder, 31 Oct 2026)
  const types = (paramSchemas(categoryById("home-sales")!).property_type as any).unwrap().options as string[];
  assert.ok(types.includes("any"));
});

test("au-home-sales: the request is one GET with the exact dimension codes probed", () => {
  assert.equal(dataUrl("2"), URL_VIC);
  assert.equal(dataUrl("1"), URL_NSW);
  assert.equal(dataUrl("AUS"), URL_AUS);
});

test("au-home-sales: the region list matches the real dataflow (Australia and the 8 states and territories)", () => {
  const regions = FIX.data.structures[0].dimensions.series.find((d: any) => d.id === "REGION").values as Array<{ id: string; name: string }>;
  assert.equal(regions.length, 9);
  const name = new Map(regions.map((r) => [r.id, r.name]));
  for (const r of REGIONS) assert.equal(name.get(r.code), r.name, r.code);
  assert.equal(REGIONS.length, regions.length);
  const measures = FIX.data.structures[0].dimensions.series.find((d: any) => d.id === "MEASURE").values as Array<{ id: string; name: string }>;
  assert.equal(measures.find((m) => m.id === "5")!.name, "Mean price of residential dwellings");
  assert.equal(measures.find((m) => m.id === "4")!.name, "Number of residential dwellings");
});

test("au-home-sales: the SDMX-JSON message is read into series, with the thousands multiplier applied and the status kept", () => {
  const series = parseAbs(FIX);
  assert.equal(series.length, 18); // 2 measures x 9 regions
  const vic = series.find((s) => s.measure === "5" && s.region === "2")!;
  assert.equal(vic.unit, "AUD");
  assert.deepEqual(vic.points.map((p) => p.period), ["2025-Q2", "2025-Q3", "2025-Q4", "2026-Q1", "2026-Q2"]);
  assert.deepEqual(vic.points.map((p) => p.value), [918200, 926900, 952800, 938000, 918400]);
  assert.deepEqual(vic.points.map((p) => p.status), [null, null, "r", "r", "p"]);
  const n = series.find((s) => s.measure === "4" && s.region === "2")!;
  assert.equal(n.unit, "NUM");
  assert.equal(n.points[n.points.length - 1].value, 3043000);
  const aus = series.find((s) => s.measure === "5" && s.region === "AUS")!;
  assert.equal(aus.points[aus.points.length - 1].value, 1100400);
});

test("au-home-sales: anything that is not an SDMX-JSON data message is a SourceError", () => {
  assert.throws(() => parseAbs(null), SourceError);
  assert.throws(() => parseAbs({ hello: 1 }), SourceError);
  assert.throws(() => parseAbs({ errors: [{ message: "Bad key" }] }), (e: any) => e instanceof SourceError && /refused the request: Bad key/.test(e.message));
  assert.throws(() => parseAbs({ data: { dataSets: [{ series: {} }], structures: [{ dimensions: { series: [], observation: [] } }] } }), SourceError);
  const empty = JSON.parse(JSON.stringify(FIX));
  empty.data.dataSets[0].series = {};
  assert.throws(() => parseAbs(empty), (e: any) => e instanceof SourceError && /no series/.test(e.message));
});

test("au-home-sales: reads Victoria: newest quarter preliminary, previous quarter, year earlier, dwellings, Australia", () => {
  const r = readAbs(parseAbs(FIX), "2")!;
  assert.equal(r.reference_period, "2026-Q2");
  assert.equal(r.mean_price, 918400);
  assert.equal(r.preliminary, true);
  assert.deepEqual(r.previous, { reference_period: "2026-Q1", mean_price: 938000, change_percent: -2.1 });
  assert.deepEqual(r.year_earlier, { reference_period: "2025-Q2", mean_price: 918200, change_percent: 0 });
  assert.deepEqual(r.latest_revised, { reference_period: "2026-Q1", mean_price: 938000 });
  assert.deepEqual(r.dwellings, { number: 3043000, reference_period: "2026-Q2" });
  assert.deepEqual(r.national, { mean_price: 1100400, reference_period: "2026-Q2" });
  assert.equal(r.datasetLatest, "2026-Q2");
});

test("au-home-sales: Australia as a whole has no national comparison; a region the data lacks gives null", () => {
  const aus = readAbs(parseAbs(FIX), "AUS")!;
  assert.equal(aus.mean_price, 1100400);
  assert.equal(aus.national, null);
  assert.equal(aus.year_earlier!.mean_price, 1029900);
  assert.equal(aus.year_earlier!.change_percent, 6.8);
  assert.equal(readAbs(parseAbs(FIX), "9"), null);
});

test("au-home-sales: periods, changes and old data", () => {
  assert.equal(periodWords("2026-Q2"), "the second quarter of 2026");
  assert.equal(yearEarlier("2026-Q2"), "2025-Q2");
  assert.equal(changePercent(1130600, 979800), 15.4);
  assert.equal(ageNote("2026-06-30", NOW), null); // about 3.5 months
  assert.match(ageNote("2025-12-31", NOW)!, /old: its quarter ended about 10 months ago/);
  assert.equal(
    changeSentence({ reference_period: "2026-Q1", mean_price: 1, change_percent: -0.5 }, { reference_period: "2025-Q2", mean_price: 1, change_percent: 0 }),
    " That is 0.5% lower than in the first quarter of 2026 and unchanged from a year earlier (the second quarter of 2025).",
  );
});

test("au-home-sales: postcodes map to the state or territory by Australia Post ranges", () => {
  const code = (pc: string) => postcodeRegion(pc)?.abbr ?? null;
  assert.equal(code("2000"), "NSW");
  assert.equal(code("2150"), "NSW"); // Parramatta
  assert.equal(code("2620"), "NSW"); // Queanbeyan
  assert.equal(code("2600"), "ACT"); // Canberra
  assert.equal(code("2911"), "ACT");
  assert.equal(code("0200"), "ACT"); // ANU
  assert.equal(code("3000"), "VIC");
  assert.equal(code("8001"), "VIC"); // Melbourne PO boxes
  assert.equal(code("4000"), "QLD");
  assert.equal(code("5000"), "SA");
  assert.equal(code("6000"), "WA");
  assert.equal(code("7000"), "TAS");
  assert.equal(code("0800"), "NT");
  assert.equal(code("1001"), "NSW"); // Sydney large-volume receivers
  assert.equal(code("0100"), null);
  assert.equal(code("12345"), null);
  assert.equal(code("abcd"), null);
});

test("au-home-sales: places: states, abbreviations, cities, suburbs with a state, postcodes, and the whole country", () => {
  const at = (t?: string, pc?: string) => {
    const p = resolvePlace(t, pc);
    return [p.region.abbr, p.level];
  };
  assert.deepEqual(at(undefined, undefined), ["AUS", "country"]);
  assert.deepEqual(at("Australia"), ["AUS", "country"]);
  assert.deepEqual(at("whole country"), ["AUS", "country"]);
  assert.deepEqual(at("Victoria"), ["VIC", "state"]);
  assert.deepEqual(at("VIC"), ["VIC", "state"]);
  assert.deepEqual(at("new south wales"), ["NSW", "state"]);
  assert.deepEqual(at("NSW"), ["NSW", "state"]);
  assert.deepEqual(at("SA"), ["SA", "state"]);
  assert.deepEqual(at("Australian Capital Territory"), ["ACT", "state"]);
  assert.deepEqual(at("Parramatta"), ["NSW", "city"]);
  assert.deepEqual(at("  melbourne "), ["VIC", "city"]);
  assert.deepEqual(at("Gold Coast"), ["QLD", "city"]);
  assert.deepEqual(at("Perth"), ["WA", "city"]);
  assert.deepEqual(at("Hobart"), ["TAS", "city"]);
  assert.deepEqual(at("Alice Springs"), ["NT", "city"]);
  assert.deepEqual(at("Canberra"), ["ACT", "city"]);
  assert.deepEqual(at("Parramatta NSW"), ["NSW", "city"]);
  assert.deepEqual(at("Kensington, Victoria"), ["VIC", "city"]);
  assert.deepEqual(at("Surry Hills NSW 2010"), ["NSW", "city"]);
  assert.deepEqual(at("Sydney 2000"), ["NSW", "city"]);
  assert.deepEqual(at("4000"), ["QLD", "postcode"]);
  assert.deepEqual(at("Somewhere 4000"), ["QLD", "postcode"]);
  assert.deepEqual(at(undefined, "2150"), ["NSW", "postcode"]);
});

test("au-home-sales: an unknown place or a bad postcode is a clear input error that says what is available", () => {
  assert.throws(() => resolvePlace("Atlantis"), (e: any) => e instanceof InputError && /called "Atlantis"/.test(e.message) && /state or territory/.test(e.message));
  assert.throws(() => resolvePlace(undefined, "99"), (e: any) => e instanceof InputError && /not an Australian postcode/.test(e.message));
  assert.throws(() => resolvePlace(undefined, "0100"), InputError);
});

test("au-home-sales: a town and a postcode together: the town wins, a conflict or a bad postcode is noted, an unknown town falls back to the postcode", () => {
  const same = resolvePlace("Parramatta", "2150");
  assert.equal(same.region.abbr, "NSW");
  assert.match(same.notes.join(" "), /postcode 2150 was not needed/);
  const clash = resolvePlace("Parramatta", "3000");
  assert.equal(clash.region.abbr, "NSW");
  assert.match(clash.notes.join(" "), /postcode 3000 lies in Victoria, but "Parramatta" lies in New South Wales; the answer follows the town name/);
  const fall = resolvePlace("Nowheresville", "3000");
  assert.deepEqual([fall.region.abbr, fall.level, fall.asked], ["VIC", "postcode", "3000"]);
  assert.match(fall.notes.join(" "), /"Nowheresville" was not recognised/);
  const bad = resolvePlace("Perth", "12");
  assert.equal(bad.region.abbr, "WA");
  assert.match(bad.notes.join(" "), /"12" was not recognised as an Australian postcode/);
});

test("au-home-sales: the answer for a state is an official mean with its quarter, preliminary flag, change figures, source and licence", () => {
  const place = resolvePlace("Victoria");
  const a = absAnswer(readAbs(parseAbs(FIX), "2"), { place, now: NOW, baseUrl: "https://proofprice.com", apiUrl: URL_VIC });
  assert.equal(a.status, "ok");
  assert.deepEqual(a.price, { currency: "AUD", unit: "per dwelling", value: 918400, measure: "average", median: null, typical_low: null, typical_high: null, min: null, max: null });
  assert.equal(a.sample_size, null);
  assert.equal(a.confidence, "medium");
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.statistic!.measure, "average");
  assert.equal(a.statistic!.reference_period, "2026-Q2");
  assert.deepEqual(a.period, { from: "2026-04-01", to: "2026-06-30" });
  assert.equal(a.source.id, "au-home-sales");
  assert.equal(a.source.licence_url, "https://www.abs.gov.au/website-privacy-copyright-and-disclaimer#copyright-and-creative-commons");
  assert.match(a.summary, /In Victoria the mean price of a residential dwelling was A\$918,400 in the second quarter of 2026 \(preliminary\)/);
  assert.match(a.summary, /not the price of homes sold/);
  assert.match(a.summary, /2\.1% lower than in the first quarter of 2026 and unchanged from a year earlier \(the second quarter of 2025\)\./);
  assert.match(a.summary, /Official average published by Australian Bureau of Statistics \(ABS\) for 2026-Q2\./);
  const note = a.statistic!.note!;
  assert.match(note, /Preliminary: the ABS marks the newest quarter as a preliminary figure subject to revision\. The latest revised quarter is 2026-Q1: A\$938,000\./);
  assert.match(note, /not the average price of the homes sold in the quarter, not a median and not a valuation/);
  assert.doesNotMatch(note, /states and territories only/); // a state asked by name needs no such note
  const x = a.extra as any;
  assert.equal(x.preliminary, true);
  assert.equal(x.place.area_resolution, "as asked");
  assert.deepEqual(x.place.figure_is_for, { code: "2", name: "Victoria", abbreviation: "VIC" });
  assert.deepEqual(x.number_of_residential_dwellings, { number: 3043000, reference_period: "2026-Q2" });
  assert.deepEqual(x.australia_mean_price, { mean_price: 1100400, reference_period: "2026-Q2" });
  assert.equal(x.abs_api_url, URL_VIC);
  assert.equal(x.dataset.dataflow, "RES_DWELL_ST");
  assert.deepEqual(a.query, { country: "AU", town: "Victoria" });
});

test("au-home-sales: a suburb is answered with its state and the answer says so plainly (NSW suburb data is not licensed for use)", () => {
  const place = resolvePlace("Parramatta");
  const a = absAnswer(readAbs(parseAbs(FIX), "1"), { place, now: NOW });
  assert.equal(a.status, "ok");
  assert.equal(a.price!.value, 1304900);
  assert.match(a.summary, /In Parramatta \(the ABS publishes by state, so this is the figure for New South Wales\) the mean price of a residential dwelling was A\$1,304,900/);
  assert.match(a.statistic!.note!, /for states and territories only, not for a city or suburb: the figure is for New South Wales, the state or territory where Parramatta lies\. It is not a price for that area\./);
  const x = a.extra as any;
  assert.equal(x.place.area_resolution, "state_or_territory");
  assert.equal(x.place.level, "city");
  assert.deepEqual(a.query, { country: "AU", town: "Parramatta" });
});

test("au-home-sales: a postcode is answered with its state; a property type is accepted and noted as not applied", () => {
  const place = resolvePlace(undefined, "4000");
  const a = absAnswer(readAbs(parseAbs(FIX), "3"), { place, property_type: "house", now: NOW });
  assert.equal(a.price!.value, 1130600);
  assert.match(a.summary, /In postcode 4000 \(the ABS publishes by state, so this is the figure for Queensland\)/);
  assert.match(a.statistic!.note!, /not for a postcode/);
  assert.match(a.statistic!.note!, /does not split this figure by property type, so "house" was not applied/);
  assert.deepEqual(a.query, { country: "AU", postcode: "4000", property_type: "house" });
  const any = absAnswer(readAbs(parseAbs(FIX), "3"), { place, property_type: "any", now: NOW });
  assert.doesNotMatch(any.statistic!.note!, /property type/);
});

test("au-home-sales: Australia as a whole, and an old figure is flagged in plain words", () => {
  const place = resolvePlace();
  const a = absAnswer(readAbs(parseAbs(FIX), "AUS"), { place, now: new Date("2027-06-01T00:00:00Z") });
  assert.match(a.summary, /^In Australia the mean price of a residential dwelling was A\$1,100,400/);
  assert.match(a.statistic!.note!, /This figure is old: its quarter ended about 11 months ago\./);
  assert.deepEqual(a.query, { country: "AU" });
  assert.equal((a.extra as any).australia_mean_price, undefined);
});

test("au-home-sales: a final (not preliminary) newest quarter has no preliminary note", () => {
  const fin = JSON.parse(JSON.stringify(FIX));
  for (const s of Object.values<any>(fin.data.dataSets[0].series)) s.observations["0"] = s.observations["0"].slice(0, 1); // drop the status of the newest quarter
  const a = absAnswer(readAbs(parseAbs(fin), "2"), { place: resolvePlace("Victoria"), now: NOW });
  assert.doesNotMatch(a.summary, /preliminary/);
  assert.doesNotMatch(a.statistic!.note!, /Preliminary/);
  assert.equal((a.extra as any).latest_revised, undefined);
});

test("au-home-sales: no price for the region is a clear no_matches, never a made-up number", () => {
  const a = absAnswer(null, { place: resolvePlace("Tasmania"), now: NOW });
  assert.equal(a.status, "no_matches");
  assert.equal(a.price, null);
  assert.equal(a.confidence, "insufficient");
  assert.match(a.summary, /holds no mean price of residential dwellings for Tasmania/);
});

test("au-home-sales: end to end, Victoria is one request; a suburb asks for its state; Australia asks for Australia only", async () => {
  const r = router({ [URL_VIC]: FIX, [URL_NSW]: FIX, [URL_AUS]: FIX });
  const a = await routeAustralia({ town: "Victoria" }, { fetcher: r.fetcher, now: NOW });
  assert.deepEqual(r.urls, [URL_VIC]);
  assert.equal(a.status, "ok");
  assert.equal(a.price!.value, 918400);
  assert.equal(a.source.id, "au-home-sales");
  const p = await routeAustralia({ town: "Parramatta" }, { fetcher: r.fetcher, now: NOW });
  assert.equal(r.urls[1], URL_NSW);
  assert.equal(p.price!.value, 1304900);
  const n = await routeAustralia({}, { fetcher: r.fetcher, now: NOW });
  assert.equal(r.urls[2], URL_AUS);
  assert.equal(n.price!.value, 1100400);
  await assert.rejects(absHomePrices(resolvePlace("Victoria"), { fetcher: async () => { throw new SourceError("Source returned HTTP 503"); } }), SourceError);
  await assert.rejects(routeAustralia({ town: "Atlantis" }, { fetcher: async () => ({}) }), InputError);
});

test("au-home-sales: routed by country through the shared home-sales tool (network stubbed)", async () => {
  const realFetch = globalThis.fetch;
  const seen: string[] = [];
  globalThis.fetch = (async (url: any) => {
    seen.push(String(url));
    return new Response(JSON.stringify(FIX), { status: 200, headers: { "content-type": "application/vnd.sdmx.data+json; charset=utf-8; version=2" } });
  }) as typeof fetch;
  try {
    const a = await runCategory(categoryById("home-sales")!, { country: "au", town: "Victoria" });
    assert.equal(a.status, "ok");
    assert.equal(a.source.id, "au-home-sales");
    assert.equal(a.price!.value, 918400);
    assert.deepEqual(seen, [URL_VIC]);
  } finally {
    globalThis.fetch = realFetch;
  }
});

import { absHarvestFrom, absHarvest, absHistoryKey, harvestUrl, LIBRARY_ITEM } from "./abs";
import { NO_COUNT } from "../../lib/stats";

test("au-home-sales harvest: one row per region from the newest quarter, no count, dated by the quarter end", async () => {
  const day = absHarvestFrom(parseAbs(FIX));
  assert.equal(day.rows.length, 9);
  assert.deepEqual(day.rows.map((r) => r.area).sort(), ["1", "2", "3", "4", "5", "6", "7", "8", "AUS"]);
  for (const r of day.rows) {
    assert.equal(r.item, LIBRARY_ITEM);
    assert.equal(r.n, NO_COUNT);
    assert.ok(r.median > 100000 && r.median === r.low && r.median === r.high);
  }
  assert.match(day.date, /^\d{4}-(03-31|06-30|09-30|12-31)$/);
  assert.equal(day.currency, "AUD");
  const urls: string[] = [];
  await absHarvest({ fetcher: async (u) => (urls.push(u), FIX) });
  assert.equal(urls[0], harvestUrl());
  assert.match(urls[0], /\/5\.AUS\+1\+2\+3\+4\+5\+6\+7\+8\.Q\?lastNObservations=1/);
});

test("au-home-sales harvest: fewer than 9 regions is an error, not a partial day", () => {
  const some = parseAbs(FIX).filter((s) => s.region === "AUS" || s.region === "1");
  assert.throws(() => absHarvestFrom(some), /only/);
});

test("au-home-sales historyKey: the region of the place, null for an unknown place", () => {
  assert.deepEqual(absHistoryKey({ town: "Parramatta" }), { area: "1", item: LIBRARY_ITEM, label: "New South Wales" });
  assert.equal(absHistoryKey({ postcode: "4000" })?.area, "3");
  assert.equal(absHistoryKey({})?.area, "AUS");
  assert.equal(absHistoryKey({ town: "Nowheresville" }), null);
});
