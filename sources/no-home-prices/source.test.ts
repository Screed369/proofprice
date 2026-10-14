import { test } from "node:test";
import assert from "node:assert/strict";
import { parseJsonStat } from "../../lib/adapters";
import { InputError, SourceError } from "../../lib/http";
import { categoryById, paramSchemas, runCategory, SOURCE_PLUGINS } from "../../lib/registry";
import {
  ageNote, askedForHouse, changePercent, dataUrl, fold, INFO, isoQuarter, METHOD, norwayAnswer, norwayHomePrices, normaliseType, periodWords, readNorway, resolvePlace, TYPES, yearEarlier,
} from "./source";
import { NO_REGIONS } from "./places";
import * as F from "./fixtures";

// Fixtures: real Statistics Norway PxWebApi v2 responses captured 2026-10-14 (see fixtures.ts).
const oslo = () => parseJsonStat(F.OSLO);
const utsira = () => parseJsonStat(F.UTSIRA);
const OSLO = resolvePlace("Oslo");
const URL_OSLO =
  "https://data.ssb.no/api/pxwebapi/v2/tables/14310/data?lang=en&outputFormat=json-stat2&valueCodes%5BRegion%5D=0301,0&valueCodes%5BBoligtype%5D=00,01,02,03&valueCodes%5BContentsCode%5D=KvPris,Omsetninger&valueCodes%5BTid%5D=top(6)";

function fake(body: unknown) {
  const urls: string[] = [];
  return { urls, fetcher: async (url: string) => (urls.push(url), body) };
}

test("no-home-prices: licence, attribution and type are Statistics Norway's", () => {
  assert.equal(INFO.id, "no-home-prices");
  assert.equal(INFO.price_type, "official_statistic");
  assert.equal(INFO.publisher, "Statistics Norway (SSB)");
  assert.match(INFO.licence, /CC BY 4\.0/);
  assert.match(INFO.licence, /even commercially/);
  assert.equal(INFO.licence_url, "https://www.ssb.no/en/diverse/lisens");
  for (const k of ["Statistics Norway", "14310", "CC BY 4.0"]) assert.ok(INFO.attribution.includes(k), k);
  assert.match(INFO.limits, /not a valuation/);
});

test("no-home-prices: registered for NO on the home-sales tool, smoke test first, property types added", () => {
  const plugin = SOURCE_PLUGINS.find((s) => s.info.id === "no-home-prices")!;
  assert.equal(plugin.category, "home-sales");
  assert.deepEqual(plugin.countries, ["NO"]);
  assert.equal(plugin.status, "live");
  assert.deepEqual(plugin.examples[0].params, { country: "NO", town: "Oslo" });
  const types = (paramSchemas(categoryById("home-sales")!).property_type as any).unwrap().options as string[];
  for (const t of ["any", "house", "detached", "terraced", "flat"]) assert.ok(types.includes(t), t);
});

test("no-home-prices: names are matched without diacritics, with Sami double names and in either spelling", () => {
  assert.equal(fold("Tromsø"), "tromso");
  assert.equal(fold("Ålesund"), fold("Aalesund"));
  assert.equal(resolvePlace("Tromsø").code, "5501");
  assert.equal(resolvePlace("Tromso").code, "5501");
  assert.equal(resolvePlace("tromsø kommune").code, "5501");
  assert.equal(resolvePlace("Ålesund").code, "1508");
  assert.equal(resolvePlace("Aalesund").code, "1508");
  assert.equal(resolvePlace("Trondheim").code, "5001");
  assert.equal(resolvePlace("Tråante").code, "5001");
  assert.equal(resolvePlace("Kautokeino").code, "5612");
  assert.equal(resolvePlace("Guovdageaidnu").code, "5612");
  assert.equal(resolvePlace("Oslo").code, "0301");
  assert.equal(resolvePlace("Bergen").code, "4601");
  assert.equal(resolvePlace("Rogaland").level, "county");
  assert.equal(resolvePlace("Vestland").code, "46");
  assert.equal(resolvePlace("Trøndelag").code, "50");
  assert.equal(resolvePlace("Stavanger").level, "municipality");
});

test("no-home-prices: no place is the whole country; unknown and ambiguous names say what to do", () => {
  for (const t of [undefined, "", "  ", "Norway", "Norge", "whole country"]) {
    const p = resolvePlace(t);
    assert.equal(p.code, "0");
    assert.equal(p.level, "country");
  }
  assert.throws(() => resolvePlace("Våler"), (e: any) => e instanceof InputError && /Våler \(Østfold\)/.test(e.message) && /Våler \(Innlandet\)/.test(e.message));
  assert.equal(resolvePlace("Våler (Østfold)").code, "3114");
  assert.throws(() => resolvePlace("Atlantis"), (e: any) => e instanceof InputError && /no region called "Atlantis"/.test(e.message));
  assert.throws(() => resolvePlace("Viken"), InputError);
});

test("no-home-prices: the region list is the real table list (country, counties, municipalities, Oslo once)", () => {
  assert.equal(NO_REGIONS.length, 374);
  assert.ok(NO_REGIONS.some(([c, n]) => c === "0301" && n === "Oslo - Oslove"));
  assert.ok(!NO_REGIONS.some(([c]) => c === "03"));
  assert.equal(new Set(NO_REGIONS.map(([c]) => c)).size, NO_REGIONS.length);
});

test("no-home-prices: dwelling types accept plain words; house means detached houses", () => {
  assert.equal(normaliseType(undefined), "any");
  assert.equal(normaliseType("any"), "any");
  assert.equal(normaliseType("Detached"), "detached");
  assert.equal(normaliseType("house"), "detached");
  assert.equal(askedForHouse("house"), true);
  assert.equal(askedForHouse("detached"), false);
  assert.equal(normaliseType("terraced"), "terraced");
  assert.equal(normaliseType("row house"), "terraced");
  assert.equal(normaliseType("flat"), "flat");
  assert.equal(normaliseType("Apartment"), "flat");
  assert.equal(normaliseType("condo"), "flat");
  assert.throws(() => normaliseType("castle"), (e: any) => e instanceof InputError && /must be one of/.test(e.message));
  assert.throws(() => normaliseType("new"), InputError);
});

test("no-home-prices: periods", () => {
  assert.equal(isoQuarter("2026K3"), "2026-Q3");
  assert.equal(isoQuarter("2025"), "2025");
  assert.equal(periodWords("2026-Q3"), "the third quarter of 2026");
  assert.equal(yearEarlier("2026-Q3"), "2025-Q3");
  assert.equal(yearEarlier("2025"), null);
  assert.equal(changePercent(110, 100), 10);
  assert.equal(changePercent(99, 100), -1);
});

test("no-home-prices: the request is one GET for the place and the whole country, every dwelling type, last six quarters", () => {
  assert.equal(dataUrl(["0301", "0"]), URL_OSLO);
  assert.equal(dataUrl(["0"]).includes("valueCodes%5BRegion%5D=0&"), true);
});

test("no-home-prices: reads Oslo from the real cube (latest quarter, change, national average, every type)", () => {
  const t = oslo();
  assert.deepEqual(t.codes.Tid, ["2025K2", "2025K3", "2025K4", "2026K1", "2026K2", "2026K3"]);
  const r = readNorway(t, { place: OSLO, type: "any" })!;
  assert.equal(r.reference_period, "2026-Q3");
  assert.equal(r.price, 98802);
  assert.equal(r.sales, 5066);
  assert.deepEqual(r.previous, { reference_period: "2026-Q2", price: 99096, change_percent: -0.3 });
  assert.deepEqual(r.year_earlier, { reference_period: "2025-Q3", price: 98780, change_percent: 0 });
  assert.deepEqual(r.national, { price: 55627, sales: 24662 });
  assert.deepEqual(r.by_type.map((b) => [b.type, b.price, b.sales]), [["any", 98802, 5066], ["detached", 71030, 209], ["terraced", 74976, 287], ["flat", 101568, 4570]]);
  assert.equal(r.datasetLatest, "2026-Q3");
  assert.match(r.datasetTitle!, /Average price per square meter/);
  // Other dwelling types on the same cube
  const flat = readNorway(t, { place: OSLO, type: "flat" })!;
  assert.equal(flat.price, 101568);
  assert.equal(flat.sales, 4570);
  assert.deepEqual(flat.previous, { reference_period: "2026-Q2", price: 102372, change_percent: -0.8 });
  assert.deepEqual(flat.year_earlier, { reference_period: "2025-Q3", price: 102047, change_percent: -0.5 });
  assert.equal(readNorway(t, { place: OSLO, type: "detached" })!.price, 71030);
  // The whole country: no national comparison against itself
  const country = readNorway(t, { place: resolvePlace(), type: "any" })!;
  assert.equal(country.price, 55627);
  assert.equal(country.national, null);
  // A place the cube does not hold
  assert.equal(readNorway(t, { place: resolvePlace("Bergen"), type: "any" }), null);
});

test("no-home-prices: Utsira has no published figure (Statistics Norway marks every cell with '.')", () => {
  const t = utsira();
  assert.equal(readNorway(t, { place: resolvePlace("Utsira"), type: "any" }), null);
  const a = norwayAnswer(null, { place: resolvePlace("Utsira"), type: "any" });
  assert.equal(a.status, "no_matches");
  assert.equal(a.price, null);
  assert.match(a.summary, /publishes no price per m² for all dwellings in Utsira/);
  assert.equal(a.price_type, "official_statistic");
  // the whole country is still in the same cube
  assert.equal(readNorway(t, { place: resolvePlace(), type: "any" })!.price, 55627);
});

test("no-home-prices: the answer is an official average with its quarter, sales, source and licence", () => {
  const r = readNorway(oslo(), { place: OSLO, type: "any" })!;
  const a = norwayAnswer(r, { place: OSLO, type: "any", now: new Date("2026-10-14T12:00:00Z"), baseUrl: "https://proofprice.com", apiUrl: URL_OSLO });
  assert.equal(a.status, "ok");
  assert.deepEqual(a.price, { currency: "NOK", unit: "per m²", value: 98802, measure: "average", median: null, typical_low: null, typical_high: null, min: null, max: null });
  assert.equal(a.sample_size, 5066);
  assert.equal(a.confidence, "high");
  assert.equal(a.price_type, "official_statistic");
  assert.deepEqual(a.statistic, { measure: "average", reference_period: "2026-Q3" });
  assert.deepEqual(a.period, { from: "2026-07-01", to: "2026-09-30" });
  assert.equal(a.source.id, "no-home-prices");
  assert.equal(a.source.licence_url, "https://www.ssb.no/en/diverse/lisens");
  assert.equal(a.method_url, "https://proofprice.com/method");
  assert.match(a.summary, /In Oslo the average price paid per m² for all dwellings \(existing dwellings\) was NOK\s98,802 in the third quarter of 2026, from 5,066 sales\./);
  assert.match(a.summary, /That is 0\.3% lower than in the second quarter of 2026 and unchanged from a year earlier \(the third quarter of 2025\)\./);
  assert.match(a.summary, /Official average published by Statistics Norway \(SSB\) for 2026-Q3\./);
  const x = a.extra as any;
  assert.deepEqual(x.place, { code: "0301", name: "Oslo", ssb_name: "Oslo - Oslove", level: "municipality" });
  assert.equal(x.property_type.label, "all dwellings");
  assert.equal(x.national_average.price, 55627);
  assert.equal(x.price_per_m2_by_type.length, 4);
  assert.equal(x.dataset.table, "14310");
  assert.equal(x.ssb_api_url, URL_OSLO);
  assert.equal(a.statistic!.note, undefined);
  assert.match(METHOD, /not a price index/);
});

test("no-home-prices: house is answered with detached houses and says so; few sales lower the confidence", () => {
  const r = readNorway(oslo(), { place: OSLO, type: "detached" })!;
  const a = norwayAnswer(r, { place: OSLO, type: "detached", requestedType: "house", now: new Date("2026-10-14T12:00:00Z") });
  assert.equal(a.price!.value, 71030);
  assert.equal(a.sample_size, 209);
  assert.equal(a.confidence, "high");
  assert.match(a.statistic!.note!, /house is answered with detached houses/);
  assert.match(a.summary, /for detached houses/);
  // 12 sales: a figure, but low confidence and a warning
  const few = { ...r, sales: 12 };
  const b = norwayAnswer(few, { place: OSLO, type: "detached", now: new Date("2026-10-14T12:00:00Z") });
  assert.equal(b.status, "ok");
  assert.equal(b.confidence, "low");
  assert.match(b.statistic!.note!, /Only 12 sales/);
});

test("no-home-prices: a figure from fewer than 5 sales is never published", () => {
  const r = readNorway(oslo(), { place: OSLO, type: "any" })!;
  const a = norwayAnswer({ ...r, sales: 4 }, { place: OSLO, type: "any", now: new Date("2026-10-14T12:00:00Z") });
  assert.equal(a.status, "insufficient_data");
  assert.equal(a.price, null);
  assert.equal(a.confidence, "insufficient");
  assert.match(a.summary, /only 4 sale\(s\)/);
});

test("no-home-prices: a place behind the newest quarter is flagged, and very old data is called old", () => {
  const r = readNorway(oslo(), { place: OSLO, type: "any" })!;
  const behind = norwayAnswer({ ...r, reference_period: "2026-Q2", datasetLatest: "2026-Q3" }, { place: OSLO, type: "any", now: new Date("2026-10-14T12:00:00Z") });
  assert.match(behind.statistic!.note!, /latest quarter Statistics Norway holds for Oslo; the third quarter of 2026 has been published for other places/);
  assert.equal(ageNote("2026-09-30", new Date("2026-10-14T12:00:00Z")), null);
  assert.match(ageNote("2024-12-31", new Date("2026-10-14T12:00:00Z"))!, /This figure is old: its period ended about 22 months ago/);
});

test("no-home-prices: end to end with a fake fetcher (one request) and through the shared home-sales tool", async () => {
  const f = fake(F.OSLO);
  const a = await norwayHomePrices({ town: "Oslo", property_type: "flat" }, { fetcher: f.fetcher, now: new Date("2026-10-14T12:00:00Z") });
  assert.deepEqual(f.urls, [URL_OSLO]);
  assert.equal(a.price!.value, 101568);
  assert.equal(a.sample_size, 4570);
  // postcode alone is not supported, with town it is ignored and said so
  await assert.rejects(norwayHomePrices({ postcode: "0150" }, { fetcher: f.fetcher }), (e: any) => e instanceof InputError && /not by postcode/.test(e.message));
  const withPostcode = await norwayHomePrices({ town: "Oslo", postcode: "0150" }, { fetcher: f.fetcher, now: new Date("2026-10-14T12:00:00Z") });
  assert.match(withPostcode.statistic!.note!, /postcode 0150 was ignored/);
  // the whole country asks for region 0 only
  const g = fake(F.OSLO);
  await norwayHomePrices({}, { fetcher: g.fetcher }).catch(() => undefined);
  assert.match(g.urls[0], /valueCodes%5BRegion%5D=0&/);
  // an unreachable source is a SourceError, not a wrong answer
  await assert.rejects(norwayHomePrices({ town: "Oslo" }, { fetcher: async () => { throw new SourceError("Source returned HTTP 503"); } }), SourceError);
  // an error body from the service is not mistaken for data
  await assert.rejects(norwayHomePrices({ town: "Oslo" }, { fetcher: async () => ({ error: [{ label: "bad request" }] }) }), SourceError);
  assert.equal(TYPES.flat.code, "03");
});

test("no-home-prices: routed by country through the shared home-sales tool (network stubbed)", async () => {
  const realFetch = globalThis.fetch;
  const seen: string[] = [];
  globalThis.fetch = (async (url: any) => (seen.push(String(url)), new Response(JSON.stringify(F.OSLO), { status: 200, headers: { "content-type": "application/json" } }))) as typeof fetch;
  try {
    const a = await runCategory(categoryById("home-sales")!, { country: "norway", town: "Oslo", property_type: "any" });
    assert.equal(a.status, "ok");
    assert.equal(a.source.id, "no-home-prices");
    assert.equal(a.price!.value, 98802);
    assert.deepEqual(seen, [URL_OSLO]);
  } finally {
    globalThis.fetch = realFetch;
  }
});
