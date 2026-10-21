import { test } from "node:test";
import assert from "node:assert/strict";
import { InputError } from "../../lib/http";
import { runCategory, categoryById, exampleUrls, paramSchemas, SOURCE_PLUGINS, toolDescription } from "../../lib/registry";
import {
  AIRPORT_MARKET, ALIASES, cityAnswer, INFO, monthsSinceQuarterEnd, normaliseQuarters, pairAnswer, pairWhere, parsePairRows, parseSummaryRows, quarterLabel, quarterRange,
  resolvePlace, shortMarket, summaryWhere, TABLES, usAirfares,
} from "./source";
import { AIRPORTS_BY_MARKET, EXTRA_AIRPORTS_BY_MARKET, MARKETS, OUTSIDE_COVERAGE_AIRPORTS } from "./markets";
import { CHICAGO_MIAMI, JFK_LAX, TABLE2_ROWS } from "./fixtures";

// Fixtures: real responses captured 2026-10-14 (see fixtures.ts).
const TODAY = new Date("2026-10-14T12:00:00Z");

function fake(routes: Record<string, unknown>) {
  const urls: string[] = [];
  const fetcher = async (url: string) => {
    urls.push(url);
    for (const [id, body] of Object.entries(routes)) if (url.includes(`/resource/${id}.json`)) return body;
    return [];
  };
  return { urls, fetcher };
}

test("us-dot-airfares: licence, attribution and type are the Department of Transportation's", () => {
  assert.equal(INFO.id, "us-dot-airfares");
  assert.equal(INFO.price_type, "official_statistic");
  assert.match(INFO.publisher, /Department of Transportation/);
  assert.match(INFO.licence, /Public Domain U\.S\. Government/);
  assert.equal(INFO.licence_url, "https://www.usa.gov/publicdomain/label/1.0/");
  for (const k of ["Department of Transportation", "Table 1a", "data.transportation.gov"]) assert.ok(INFO.attribution.includes(k), k);
  assert.match(INFO.limits, /not today's fare/);
  assert.match(INFO.limits, /Contiguous 48 states/);
});

test("us-dot-airfares: registered for flights / US with the three working examples", () => {
  const plugin = SOURCE_PLUGINS.find((s) => s.info.id === "us-dot-airfares")!;
  assert.equal(plugin.category, "flights");
  assert.deepEqual(plugin.countries, ["US"]);
  assert.deepEqual(plugin.examples.map((e) => e.params), [
    { country: "US", from: "JFK", to: "LAX" },
    { country: "US", from: "Chicago", to: "Miami" },
    { country: "US", from: "Boston" },
  ]);
  const cat = categoryById("flights")!;
  assert.equal(cat.tool, "pricepaid_airfare_prices");
  assert.equal(cat.restPath, "airfares");
  assert.equal(cat.cacheSeconds, 86400);
  assert.equal(cat.title, "Airfares paid");
  assert.deepEqual(Object.keys(paramSchemas(cat)).sort(), ["from", "quarters", "to"]);
  assert.deepEqual(cat.required, ["from"]);
  const first = exampleUrls().filter((e) => e.source === "us-dot-airfares");
  assert.equal(first[0].path, "/api/v1/airfares?country=US&from=JFK&to=LAX");
  assert.equal(first[0].smoke, true);
  const description = toolDescription(cat);
  assert.match(description, /^Use this when/);
  assert.match(description, /Do not use/);
});

test("us-dot-airfares: airport and market tables agree with each other", () => {
  const markets = new Set(MARKETS);
  assert.ok(MARKETS.length > 300);
  for (const table of [AIRPORTS_BY_MARKET, EXTRA_AIRPORTS_BY_MARKET]) {
    for (const market of Object.keys(table)) assert.ok(markets.has(market), `unknown market in the airport table: ${market}`);
  }
  for (const [market] of Object.entries(ALIASES)) assert.ok(market.length > 0);
  for (const market of Object.values(ALIASES)) assert.ok(markets.has(market), `alias points at an unknown market: ${market}`);
  for (const code of Object.keys(OUTSIDE_COVERAGE_AIRPORTS)) assert.ok(!AIRPORT_MARKET.has(code), `${code} is both inside and outside coverage`);
  for (const code of ["JFK", "LGA", "EWR", "LAX", "ORD", "MDW", "MIA", "FLL", "BOS", "SFO", "ATL", "DFW", "DEN", "SEA", "LAS", "PDX", "AUS", "MSP", "DTW", "BWI", "DCA", "IAD"]) {
    assert.ok(AIRPORT_MARKET.has(code), code);
  }
  for (const code of AIRPORT_MARKET.keys()) assert.match(code, /^[A-Z]{3}$/);
});

test("us-dot-airfares: airport codes and city names resolve to DOT markets", () => {
  const jfk = resolvePlace("jfk");
  assert.deepEqual([jfk.kind, jfk.market], ["airport", "New York City, NY (Metropolitan Area)"]);
  assert.equal(resolvePlace("EWR").market, "New York City, NY (Metropolitan Area)");
  assert.equal(resolvePlace("LAX").market, "Los Angeles, CA (Metropolitan Area)");
  assert.equal(resolvePlace("ORD").market, "Chicago, IL");
  assert.equal(resolvePlace("Chicago").market, "Chicago, IL");
  assert.equal(resolvePlace("Miami").market, "Miami, FL (Metropolitan Area)");
  assert.equal(resolvePlace("Fort Lauderdale").market, "Miami, FL (Metropolitan Area)");
  assert.equal(resolvePlace("New York").market, "New York City, NY (Metropolitan Area)");
  assert.equal(resolvePlace("NYC").market, "New York City, NY (Metropolitan Area)");
  assert.equal(resolvePlace("NYC").kind, "city");
  assert.equal(resolvePlace("Portland, OR").market, resolvePlace("portland oregon").market);
  assert.match(resolvePlace("Portland, OR").market, /Portland, OR/);
  assert.equal(resolvePlace("Dallas").market, "Dallas/Fort Worth, TX");
  assert.equal(resolvePlace("St. Louis").market, resolvePlace("Saint Louis, MO").market);
  assert.equal(shortMarket("Miami, FL (Metropolitan Area)"), "Miami, FL");
});

test("us-dot-airfares: ambiguous, unknown, missing and out-of-coverage places are refused in plain words", () => {
  assert.throws(() => resolvePlace("Portland"), (e: any) => e instanceof InputError && /more than one DOT market/.test(e.message) && /Portland, OR/.test(e.message) && /Portland, ME/.test(e.message));
  assert.throws(() => resolvePlace(""), (e: any) => e instanceof InputError && /from is required/.test(e.message));
  assert.throws(() => resolvePlace(undefined, "to"), (e: any) => e instanceof InputError && /to is required/.test(e.message));
  assert.throws(() => resolvePlace("HNL"), (e: any) => e instanceof InputError && /outside the DOT airfare tables/.test(e.message));
  assert.throws(() => resolvePlace("ANC"), (e: any) => e instanceof InputError && /Alaska, Hawaii/.test(e.message));
  assert.throws(() => resolvePlace("Honolulu"), (e: any) => e instanceof InputError && /outside the DOT airfare tables/.test(e.message));
  assert.throws(() => resolvePlace("Anchorage, AK"), InputError);
  assert.throws(() => resolvePlace("ZZZ"), (e: any) => e instanceof InputError && /not an airport code/.test(e.message));
  assert.throws(() => resolvePlace("Atlantis"), (e: any) => e instanceof InputError && /not a city market or airport/.test(e.message));
});

test("us-dot-airfares: quarters are clamped and dates are right", () => {
  assert.equal(normaliseQuarters(undefined), 4);
  assert.equal(normaliseQuarters(0), 1);
  assert.equal(normaliseQuarters(99), 20);
  assert.equal(normaliseQuarters(6.4), 6);
  assert.equal(quarterLabel(2026, 1), "2026-Q1");
  assert.deepEqual(quarterRange(2026, 1), { from: "2026-01-01", to: "2026-03-31" });
  assert.deepEqual(quarterRange(2025, 4), { from: "2025-10-01", to: "2025-12-31" });
  assert.equal(monthsSinceQuarterEnd(2026, 1, TODAY), 7);
  assert.equal(monthsSinceQuarterEnd(2027, 1, TODAY), 0);
});

test("us-dot-airfares: queries look at both directions and quote their values", () => {
  assert.equal(pairWhere("airport", "JFK", "LAX"), "airport_1 in ('JFK','LAX') AND airport_2 in ('JFK','LAX')");
  assert.equal(pairWhere("city", "Chicago, IL", "Miami, FL (Metropolitan Area)"), "city1 in ('Chicago, IL','Miami, FL (Metropolitan Area)') AND city2 in ('Chicago, IL','Miami, FL (Metropolitan Area)')");
  assert.equal(summaryWhere("Boston, MA (Metropolitan Area)"), "city = 'Boston, MA (Metropolitan Area)'");
  assert.equal(summaryWhere("O'Fallon"), "city = 'O''Fallon'");
});

test("us-dot-airfares: Table 1a rows are read newest first with numbers from strings", () => {
  const rows = parsePairRows(JFK_LAX);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((r) => quarterLabel(r.year, r.quarter)), ["2026-Q1", "2025-Q4", "2025-Q3", "2025-Q2"]);
  assert.equal(rows[0].fare, 508.3078641);
  assert.equal(rows[0].passengersPerDay, 5780.111111);
  assert.equal(rows[0].miles, 2510);
  assert.equal(rows[0].largestCarrier, "DL");
  assert.equal(rows[0].label, "Los Angeles, CA (Metropolitan Area) / New York City, NY (Metropolitan Area)");
  // order does not matter, a row without a fare is dropped, a repeated quarter keeps the busier record
  const shuffled = [JFK_LAX[3], { ...JFK_LAX[0], fare: "" }, JFK_LAX[0], { ...JFK_LAX[0], passengers: "10", fare: "1" }, JFK_LAX[1], JFK_LAX[2]];
  const again = parsePairRows(shuffled);
  assert.deepEqual(again.map((r) => r.fare), rows.map((r) => r.fare));
  assert.deepEqual(parsePairRows([{ year: "x", quarter: "1", fare: "5" }, { year: "2026", quarter: "5", fare: "5" }, {}]), []);
});

test("us-dot-airfares: an airport pair answer states the quarter, one-way fare, passengers and source; no airline fare", () => {
  const rows = parsePairRows(JFK_LAX);
  const from = resolvePlace("JFK");
  const to = resolvePlace("LAX", "to");
  const a = pairAnswer(rows, { table: "airport", from, to, quarters: 4, today: TODAY });
  assert.equal(a.status, "ok");
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.price!.value, 508.31);
  assert.equal(a.price!.measure, "average");
  assert.equal(a.price!.currency, "USD");
  assert.equal(a.price!.unit, "per passenger, each way");
  assert.equal(a.price!.median, null);
  assert.equal(a.price!.typical_low, null);
  assert.equal(a.price!.typical_high, null);
  assert.equal(a.sample_size, null);
  assert.equal(a.confidence, "high");
  assert.deepEqual(a.period, { from: "2026-01-01", to: "2026-03-31" });
  assert.equal(a.statistic!.reference_period, "2026-Q1");
  assert.equal(a.statistic!.measure, "average");
  assert.match(a.summary, /508/);
  assert.match(a.summary, /each way/);
  assert.match(a.summary, /first quarter of 2026/);
  assert.match(a.summary, /Official average published by U\.S\. Department of Transportation/);
  assert.equal(a.source.id, "us-dot-airfares");
  assert.equal(a.source.licence_url, INFO.licence_url);
  assert.match(a.source.url, /data\.transportation\.gov/);
  const extra = a.extra as any;
  assert.equal(extra.passengers_per_day, 5780.1);
  assert.deepEqual(extra.largest_carrier_share, { carrier: "DL", share_of_passengers: 0.432 });
  assert.equal(extra.market.type, "airport_pair");
  assert.equal(extra.trend.length, 4);
  assert.deepEqual(extra.trend[0], { reference_period: "2026-Q1", average_fare: 508.31, passengers_per_day: 5780.1 });
  assert.equal(extra.year_ago, null); // the fixture holds no 2025-Q1 row
  // never an individual airline's fare: the fixture's carrier fares (609.07 for DL, 357.69 for B6) must not appear anywhere
  const text = JSON.stringify(a);
  for (const bad of ["609.06", "609.07", "357.68", "357.69", "fare_lg", "fare_low"]) assert.ok(!text.includes(bad), bad);
});

test("us-dot-airfares: the year-on-year change is calculated from the same quarter a year earlier", () => {
  const rows = parsePairRows([...JFK_LAX, { ...JFK_LAX[0], year: "2025", quarter: "1", fare: "400" }]);
  const a = pairAnswer(rows, { table: "airport", from: resolvePlace("JFK"), to: resolvePlace("LAX"), quarters: 5, today: TODAY });
  const extra = a.extra as any;
  assert.deepEqual(extra.year_ago, { reference_period: "2025-Q1", average_fare: 400, change_percent: 27.1 });
  assert.match(a.summary, /27\.1% higher than a year earlier/);
  assert.equal(extra.trend.length, 5);
});

test("us-dot-airfares: a city pair answer (Table 6) reads the same way", () => {
  const rows = parsePairRows(CHICAGO_MIAMI);
  const a = pairAnswer(rows, { table: "city", from: resolvePlace("Chicago"), to: resolvePlace("Miami", "to"), quarters: 4, today: TODAY });
  assert.equal(a.status, "ok");
  assert.equal(a.price!.value, 228.78);
  assert.match(a.summary, /Chicago, IL and Miami, FL/);
  assert.equal((a.extra as any).market.type, "city_pair");
  assert.equal((a.extra as any).passengers_per_day, 5588.7);
  assert.equal((a.extra as any).trend.length, 3);
});

test("us-dot-airfares: an old quarter is flagged and too few passengers are not published", () => {
  const rows = parsePairRows(JFK_LAX);
  const old = pairAnswer(rows, { table: "airport", from: resolvePlace("JFK"), to: resolvePlace("LAX"), quarters: 4, today: new Date("2027-06-01T00:00:00Z") });
  assert.match(old.statistic!.note!, /ended more than a year ago/);
  const fresh = pairAnswer(rows, { table: "airport", from: resolvePlace("JFK"), to: resolvePlace("LAX"), quarters: 4, today: TODAY });
  assert.ok(!/ended more than/.test(fresh.statistic!.note!));
  const thin = pairAnswer(parsePairRows([{ ...JFK_LAX[0], passengers: "0.4" }]), { table: "airport", from: resolvePlace("JFK"), to: resolvePlace("LAX"), quarters: 1, today: TODAY });
  assert.equal(thin.status, "insufficient_data");
  assert.equal(thin.price, null);
  assert.match(thin.summary, /too few to publish/);
  const none = pairAnswer([], { table: "city", from: resolvePlace("Chicago"), to: resolvePlace("Miami", "to"), quarters: 4, today: TODAY });
  assert.equal(none.status, "no_matches");
  assert.equal(none.price, null);
  assert.match(none.summary, /holds no average fare/);
});

test("us-dot-airfares: Table 2 rows give a city answer with the year-ago comparison", () => {
  // one city has one row per quarter: the three fixture rows are three cities in the same quarter, so only the first is kept
  assert.equal(parseSummaryRows(TABLE2_ROWS).length, 1);
  const knox = parseSummaryRows([TABLE2_ROWS[0]]);
  assert.equal(knox[0].fare, 224.1574449);
  assert.equal(knox[0].markets, 11);
  const a = cityAnswer(knox, { from: resolvePlace("Knoxville, TN"), quarters: 4, today: TODAY });
  assert.equal(a.status, "ok");
  assert.equal(a.price!.value, 224.16);
  assert.equal(a.statistic!.reference_period, "2026-Q1");
  assert.match(a.summary, /Knoxville, TN/);
  assert.match(a.summary, /5\.9% higher than a year earlier/);
  assert.equal((a.extra as any).market.type, "city_summary");
  assert.equal(cityAnswer([], { from: resolvePlace("Knoxville, TN"), quarters: 4, today: TODAY }).status, "no_matches");
});

test("us-dot-airfares: JFK to LAX asks the airport-pair table once and answers from it", async () => {
  const f = fake({ [TABLES.airport.id]: JFK_LAX });
  const a = await usAirfares({ from: "JFK", to: "LAX" }, { fetcher: f.fetcher, today: TODAY });
  assert.equal(f.urls.length, 1);
  assert.ok(f.urls[0].startsWith("https://data.transportation.gov/resource/tfrh-tu9e.json?"));
  assert.ok(decodeURIComponent(f.urls[0]).includes("airport_1 in ('JFK','LAX') AND airport_2 in ('JFK','LAX')"));
  assert.equal(a.status, "ok");
  assert.equal(a.price!.value, 508.31);
  assert.equal((a.query as any).from, "JFK");
});

test("us-dot-airfares: two cities use the city-pair table", async () => {
  const f = fake({ [TABLES.city.id]: CHICAGO_MIAMI });
  const a = await usAirfares({ from: "Chicago", to: "Miami" }, { fetcher: f.fetcher, today: TODAY });
  assert.equal(f.urls.length, 1);
  assert.ok(f.urls[0].includes("/resource/yj5y-b2ir.json"));
  assert.equal(a.status, "ok");
  assert.equal(a.price!.value, 228.78);
});

test("us-dot-airfares: an airport pair with no row falls back to the city pair and says so", async () => {
  const f = fake({ [TABLES.city.id]: CHICAGO_MIAMI });
  const a = await usAirfares({ from: "ORD", to: "MIA" }, { fetcher: f.fetcher, today: TODAY });
  assert.equal(f.urls.length, 2);
  assert.ok(f.urls[0].includes("tfrh-tu9e"));
  assert.ok(f.urls[1].includes("yj5y-b2ir"));
  assert.equal(a.status, "ok");
  assert.match((a.statistic!.note as string), /no row for ORD to MIA/);
  // an airport against a city is answered at city level, with a note
  const g = fake({ [TABLES.city.id]: CHICAGO_MIAMI });
  const b = await usAirfares({ from: "ORD", to: "Miami" }, { fetcher: g.fetcher, today: TODAY });
  assert.equal(g.urls.length, 1);
  assert.match(b.statistic!.note as string, /ORD is treated as its whole city market/);
});

test("us-dot-airfares: from alone uses the city summary", async () => {
  const f = fake({ [TABLES.summary.id]: [TABLE2_ROWS[0]] });
  const a = await usAirfares({ from: "Knoxville, TN" }, { fetcher: f.fetcher, today: TODAY });
  assert.equal(f.urls.length, 1);
  assert.ok(f.urls[0].includes("/resource/wqw2-rjgd.json"));
  assert.equal(a.status, "ok");
  assert.equal(a.price!.value, 224.16);
  const g = fake({ [TABLES.summary.id]: [TABLE2_ROWS[0]] });
  const b = await usAirfares({ from: "TYS" }, { fetcher: g.fetcher, today: TODAY });
  assert.match(b.statistic!.note as string, /TYS is part of the DOT city market Knoxville, TN/);
});

test("us-dot-airfares: bad requests fail with plain InputError messages before any call", async () => {
  const f = fake({});
  await assert.rejects(usAirfares({ from: "JFK", to: "EWR" }, { fetcher: f.fetcher }), (e: any) => e instanceof InputError && /same DOT city market/.test(e.message));
  await assert.rejects(usAirfares({ from: "JFK", to: "HNL" }, { fetcher: f.fetcher }), (e: any) => e instanceof InputError && /outside the DOT airfare tables/.test(e.message));
  await assert.rejects(usAirfares({ from: "Portland", to: "Boston" }, { fetcher: f.fetcher }), (e: any) => e instanceof InputError && /more than one/.test(e.message));
  await assert.rejects(usAirfares({}, { fetcher: f.fetcher }), (e: any) => e instanceof InputError && /from is required/.test(e.message));
  assert.equal(f.urls.length, 0);
});

test("us-dot-airfares: the REST/MCP entry point runs through the registry", async () => {
  const cat = categoryById("flights")!;
  await assert.rejects(runCategory(cat, { country: "US" }), (e: any) => e instanceof InputError);
  await assert.rejects(runCategory(cat, { country: "GB", from: "JFK", to: "LAX" }), (e: any) => e instanceof InputError && /Airfares paid are available for/.test(e.message));
});
