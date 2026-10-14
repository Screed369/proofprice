// Fixtures below are copied from LIVE responses fetched through the Probe workflow on 2026-10-14 (price and date columns only,
// the same two columns the source asks for). Latest sale dates that day: Connecticut 2025-09-30, New York City 2026-08-31, Cook County 2026-08-12.
import { test } from "node:test";
import assert from "node:assert/strict";
import { socrataUrl } from "../../lib/adapters";
import { InputError } from "../../lib/http";
import { summarise } from "../../lib/stats";
import {
  buildOrder, buildSelect, buildWhere, clampMonths, clearLatestCache, DATASETS, INFO, MAX_ROWS, monthsBack, norm, PAGE_SIZE,
  parseLatest, parseSales, parseZip, routeUsPlace, stateCode, usHomeSales,
} from "./source";
import { CT_TOWNS, NYC_NEIGHBORHOODS } from "./places";

// https://data.ct.gov/resource/5mzw-sjtu.json?$select=saleamount,daterecorded&$where=... town = 'Hartford' ... &$limit=12   (530 matching sales)
const CT_HARTFORD = [
  { saleamount: "502000", daterecorded: "2025-09-30T00:00:00.000" }, { saleamount: "260000", daterecorded: "2025-09-30T00:00:00.000" },
  { saleamount: "370000", daterecorded: "2025-09-26T00:00:00.000" }, { saleamount: "310000", daterecorded: "2025-09-26T00:00:00.000" },
  { saleamount: "249900", daterecorded: "2025-09-23T00:00:00.000" }, { saleamount: "500000", daterecorded: "2025-09-22T00:00:00.000" },
  { saleamount: "440000", daterecorded: "2025-09-22T00:00:00.000" }, { saleamount: "330000", daterecorded: "2025-09-22T00:00:00.000" },
  { saleamount: "300000", daterecorded: "2025-09-22T00:00:00.000" }, { saleamount: "220000", daterecorded: "2025-09-22T00:00:00.000" },
  { saleamount: "415000", daterecorded: "2025-09-17T00:00:00.000" }, { saleamount: "381000", daterecorded: "2025-09-17T00:00:00.000" },
];
// https://data.cityofnewyork.us/resource/usep-8jbt.json?$select=sale_price,sale_date&$where=... borough = '3' ...&$limit=12   (11,063 matching sales)
const NYC_BROOKLYN = [
  { sale_price: "2007500", sale_date: "2026-08-31T00:00:00.000" }, { sale_price: "1750000", sale_date: "2026-08-31T00:00:00.000" },
  { sale_price: "1200000", sale_date: "2026-08-31T00:00:00.000" }, { sale_price: "1150000", sale_date: "2026-08-31T00:00:00.000" },
  { sale_price: "1090000", sale_date: "2026-08-31T00:00:00.000" }, { sale_price: "1017232", sale_date: "2026-08-31T00:00:00.000" },
  { sale_price: "815000", sale_date: "2026-08-31T00:00:00.000" }, { sale_price: "730000", sale_date: "2026-08-31T00:00:00.000" },
  { sale_price: "725000", sale_date: "2026-08-31T00:00:00.000" }, { sale_price: "680000", sale_date: "2026-08-31T00:00:00.000" },
  { sale_price: "600768", sale_date: "2026-08-31T00:00:00.000" }, { sale_price: "460000", sale_date: "2026-08-31T00:00:00.000" },
];
// https://datacatalog.cookcountyil.gov/resource/wvhk-k5uv.json?$select=sale_price,sale_date&$where=... township_code in ('70',...,'77') ...&$limit=12   (20,150 matching sales)
// Cook County sends prices as "1045000.0".
const COOK_CHICAGO = [
  { sale_price: "1045000.0", sale_date: "2026-08-12T00:00:00.000" }, { sale_price: "929000.0", sale_date: "2026-08-11T00:00:00.000" },
  { sale_price: "210000.0", sale_date: "2026-08-11T00:00:00.000" }, { sale_price: "1825000.0", sale_date: "2026-08-10T00:00:00.000" },
  { sale_price: "1311000.0", sale_date: "2026-08-10T00:00:00.000" }, { sale_price: "1153000.0", sale_date: "2026-08-10T00:00:00.000" },
  { sale_price: "625000.0", sale_date: "2026-08-10T00:00:00.000" }, { sale_price: "505000.0", sale_date: "2026-08-10T00:00:00.000" },
  { sale_price: "377000.0", sale_date: "2026-08-10T00:00:00.000" }, { sale_price: "375000.0", sale_date: "2026-08-10T00:00:00.000" },
  { sale_price: "365000.0", sale_date: "2026-08-10T00:00:00.000" }, { sale_price: "232000.0", sale_date: "2026-08-10T00:00:00.000" },
];
const LATEST = { ct: "2025-09-30T00:00:00.000", nyc: "2026-08-31T00:00:00.000", cook: "2026-08-12T00:00:00.000" };

/** A fake Socrata: answers the "latest sale" query and the rows query; records every URL it was asked for. */
function fakePortal(rows: Record<string, any>[], latest: string) {
  const urls: string[] = [];
  const fetcher = async (url: string) => {
    urls.push(url);
    return url.includes("max(") ? [{ latest }] : rows;
  };
  return { fetcher, urls };
}

test("places lists match the live datasets", () => {
  assert.equal(CT_TOWNS.length, 169);
  assert.equal(new Set(CT_TOWNS).size, 169);
  assert.equal(NYC_NEIGHBORHOODS.length, 254);
});

test("norm, state and ZIP parsing", () => {
  assert.equal(norm("St. Albans"), "st albans");
  assert.equal(norm("  Hell's  Kitchen "), "hells kitchen");
  assert.equal(stateCode("Connecticut"), "CT");
  assert.equal(stateCode("ny"), "NY");
  assert.equal(stateCode("Illinois"), "IL");
  assert.throws(() => stateCode("TX"), /not a nationwide source\. Not yet: TX/);
  assert.equal(parseZip("11201-4321"), "11201");
  assert.equal(parseZip(undefined), undefined);
  assert.throws(() => parseZip("1120"), InputError);
});

test("routing: Connecticut towns", () => {
  assert.deepEqual(routeUsPlace({ town: "Hartford" }), { dataset: "ct", state: "CT", ctTown: "Hartford", label: "Hartford, CT" });
  assert.equal(routeUsPlace({ town: "hartford, CT" }).ctTown, "Hartford");
  assert.equal(routeUsPlace({ town: "West Hartford CT" }).ctTown, "West Hartford");
  assert.equal(routeUsPlace({ town: "Town of Greenwich" }).ctTown, "Greenwich");
  assert.equal(routeUsPlace({ town: "Connecticut" }).ctTown, undefined);
  assert.equal(routeUsPlace({ town: "Madison" }).dataset, "ct"); // also a Brooklyn neighborhood: the town wins unless the borough is named
  assert.equal(routeUsPlace({ town: "Brooklyn", state: "CT" }).ctTown, "Brooklyn"); // Brooklyn, CT is a real town; without a state Brooklyn means New York City
  assert.throws(() => routeUsPlace({ town: "Chicago", state: "CT" }), /is not a Connecticut town/);
});

test("routing: New York City boroughs, neighborhoods and ZIP codes", () => {
  assert.equal(routeUsPlace({ town: "Brooklyn" }).nycBorough, "3");
  assert.equal(routeUsPlace({ town: "The Bronx" }).nycBorough, "2");
  assert.equal(routeUsPlace({ town: "Staten Island, NY" }).nycBorough, "5");
  assert.equal(routeUsPlace({ town: "New York" }).nycBorough, undefined);
  assert.equal(routeUsPlace({ town: "NYC" }).label, "New York City");
  const w = routeUsPlace({ town: "Williamsburg" });
  assert.equal(w.nycBorough, "3");
  assert.deepEqual(w.nycNeighborhoods, ["WILLIAMSBURG-CENTRAL", "WILLIAMSBURG-EAST", "WILLIAMSBURG-NORTH", "WILLIAMSBURG-SOUTH"]);
  assert.equal(routeUsPlace({ town: "Upper East Side" }).nycNeighborhoods?.length, 3);
  assert.deepEqual(routeUsPlace({ town: "Park Slope" }).nycNeighborhoods, ["PARK SLOPE"]); // an exact name wins over longer names that start with it
  assert.deepEqual(routeUsPlace({ town: "Park Slope South" }).nycNeighborhoods, ["PARK SLOPE SOUTH"]);
  assert.deepEqual(routeUsPlace({ town: "St. Albans" }).nycNeighborhoods, ["ST. ALBANS"]);
  assert.throws(() => routeUsPlace({ town: "Sunnyside" }), /more than one borough \(Queens, Staten Island\)/);
  assert.deepEqual(routeUsPlace({ town: "Sunnyside, Queens" }).nycNeighborhoods, ["SUNNYSIDE"]);
  assert.equal(routeUsPlace({ town: "Sunnyside, Queens" }).nycBorough, "4");
  assert.equal(routeUsPlace({ town: "Madison, Brooklyn" }).dataset, "nyc");
  const z = routeUsPlace({ postcode: "11201" });
  assert.equal(z.dataset, "nyc");
  assert.equal(z.zip, "11201");
  assert.equal(routeUsPlace({ town: "Brooklyn", postcode: "11215" }).label, "Brooklyn, New York City, ZIP 11215");
});

test("routing: Cook County", () => {
  const c = routeUsPlace({ town: "Chicago" });
  assert.equal(c.dataset, "cook");
  assert.deepEqual(c.cookTownships, ["70", "71", "72", "73", "74", "75", "76", "77"]);
  assert.equal(routeUsPlace({ town: "Chicago, IL" }).dataset, "cook");
  assert.deepEqual(routeUsPlace({ town: "Evanston" }).cookTownships, ["17"]);
  assert.deepEqual(routeUsPlace({ town: "Oak Park, IL" }).cookTownships, ["27"]);
  assert.deepEqual(routeUsPlace({ town: "New Trier township" }).cookTownships, ["23"]);
  assert.equal(routeUsPlace({ town: "Cook County" }).cookTownships, undefined);
  assert.equal(routeUsPlace({ state: "IL" }).label, "Cook County, IL");
});

test("routing: places we do not cover get a clear message", () => {
  assert.throws(() => routeUsPlace({ town: "Dallas" }), /not a place we cover yet.*Connecticut.*New York City.*Cook County.*not a nationwide source/s);
  assert.throws(() => routeUsPlace({}), /A town is required/);
  assert.throws(() => routeUsPlace({ postcode: "06103" }), /A ZIP code alone only works for New York City/);
  assert.throws(() => routeUsPlace({ town: "Hartford", postcode: "06103" }), /can only narrow New York City sales/);
  assert.throws(() => routeUsPlace({ town: "Chicago", state: "NY" }), /is not a New York City borough or neighborhood/);
});

test("queries: Connecticut", () => {
  const place = routeUsPlace({ town: "Hartford" });
  const w = buildWhere(place, "any", { from: "2024-09-30", to: "2025-09-30" });
  assert.equal(
    w,
    "daterecorded > '2024-09-30T00:00:00' AND daterecorded < '2025-10-01T00:00:00' AND saleamount >= 10000 AND town = 'Hartford' AND propertytype = 'Residential' AND residentialtype in ('Single Family','Two Family','Three Family','Four Family','Condo') AND nonusecode IS NULL",
  );
  assert.match(buildWhere(place, "house", { from: "2024-09-30", to: "2025-09-30" }), /residentialtype in \('Single Family','Two Family','Three Family'\)/);
  assert.match(buildWhere(routeUsPlace({ town: "Connecticut" }), "condo", { from: "a", to: "2025-09-30" }), /^(?!.*town =).*residentialtype in \('Condo'\)/);
  assert.throws(() => buildWhere(place, "coop", { from: "2024-09-30", to: "2025-09-30" }), /only available for New York City/);
});

test("queries: New York City", () => {
  const w = buildWhere(routeUsPlace({ town: "Williamsburg", postcode: "11211" }), "condo", { from: "2025-08-31", to: "2026-08-31" });
  assert.equal(
    w,
    "sale_date > '2025-08-31T00:00:00' AND sale_date < '2026-09-01T00:00:00' AND sale_price >= 10000 AND borough = '3' AND neighborhood in ('WILLIAMSBURG-CENTRAL','WILLIAMSBURG-EAST','WILLIAMSBURG-NORTH','WILLIAMSBURG-SOUTH') AND zip_code = '11211' AND (building_class_category like '04 %' OR building_class_category like '12 %' OR building_class_category like '13 %' OR building_class_category like '15 %')",
  );
  const any = buildWhere(routeUsPlace({ town: "New York" }), "any", { from: "2025-08-31", to: "2026-08-31" });
  assert.doesNotMatch(any, /borough =/);
  assert.match(any, /like '01 %'.*like '17 %'/);
  assert.doesNotMatch(any, /like '07 %'|like '08 %'|like '14 %'/); // rental buildings are not homes
  assert.match(buildWhere(routeUsPlace({ town: "Brooklyn" }), "coop", { from: "a", to: "2026-08-31" }), /like '09 %' OR .*like '10 %' OR .*like '17 %'/);
});

test("queries: Cook County", () => {
  const w = buildWhere(routeUsPlace({ town: "Chicago" }), "house", { from: "2025-08-12", to: "2026-08-12" });
  assert.equal(
    w,
    "sale_date > '2025-08-12T00:00:00' AND sale_date < '2026-08-13T00:00:00' AND sale_price >= 10000 AND township_code in ('70','71','72','73','74','75','76','77') AND class in ('202','203','204','205','206','207','208','209','210','234','278','295') AND is_multisale = false AND sale_filter_same_sale_within_365 = false AND sale_filter_less_than_10k = false AND sale_filter_deed_type = false",
  );
  assert.match(buildWhere(routeUsPlace({ town: "Cook County" }), "condo", { from: "a", to: "2026-08-12" }), /^(?!.*township_code).*class in \('299'\)/);
});

test("select asks for price and date only, never an address, a parcel number or a name", () => {
  for (const d of ["ct", "nyc", "cook"] as const) {
    const sel = buildSelect(d);
    assert.equal(sel.length, 2);
    assert.deepEqual(sel, [DATASETS[d].priceField, DATASETS[d].dateField]);
    assert.doesNotMatch(sel.join(","), /address|pin|name|owner|apartment/i);
    assert.deepEqual(buildOrder(d), [`${DATASETS[d].dateField} DESC`, `${DATASETS[d].priceField} DESC`]);
  }
  // The whole URL for a Hartford request, as the portal receives it.
  const place = routeUsPlace({ town: "Hartford" });
  const url = socrataUrl(DATASETS.ct.domain, DATASETS.ct.id, {
    select: buildSelect("ct"), where: buildWhere(place, "any", { from: "2024-09-30", to: "2025-09-30" }), order: buildOrder("ct"), limit: 12,
  });
  assert.match(url, /^https:\/\/data\.ct\.gov\/resource\/5mzw-sjtu\.json\?\$select=saleamount%2Cdaterecorded&\$where=daterecorded%20%3E%20'2024-09-30T00%3A00%3A00'/);
});

test("months, dates and parsing", () => {
  assert.equal(monthsBack("2025-09-30", 12), "2024-09-30");
  assert.deepEqual(clampMonths(undefined, "ct"), { requested: 12, applied: 12 });
  assert.deepEqual(clampMonths(24, "nyc"), { requested: 24, applied: 12 }); // NYC publishes a rolling 12 months
  assert.deepEqual(clampMonths(99, "cook"), { requested: 36, applied: 36 });
  assert.equal(parseLatest([{ latest: "2025-09-30T00:00:00.000" }]), "2025-09-30");
  assert.equal(parseLatest([{}]), null);
  assert.equal(parseLatest([]), null);
  const cook = parseSales("cook", COOK_CHICAGO);
  assert.equal(cook.length, 12);
  assert.deepEqual(cook[0], { price: 1045000, date: "2026-08-12" });
  assert.deepEqual(parseSales("ct", [{ saleamount: "abc", daterecorded: "2025-01-01T00:00:00.000" }, { saleamount: "5", daterecorded: "" }, { saleamount: "9", daterecorded: "2025-01-01T00:00:00.000" }]), [{ price: 9, date: "2025-01-01" }]);
});

test("Hartford: a full answer from Connecticut's live format", async () => {
  const { fetcher, urls } = fakePortal(CT_HARTFORD, LATEST.ct);
  const a = await usHomeSales({ town: "Hartford", baseUrl: "https://x.test" }, { fetcher, today: new Date("2026-10-14T12:00:00Z") });
  assert.equal(a.status, "ok");
  assert.equal(a.price?.currency, "USD");
  assert.equal(a.price?.unit, "per sale");
  assert.equal(a.price?.median, 350000);
  const s = summarise(CT_HARTFORD.map((r) => Number(r.saleamount)))!;
  assert.equal(a.price?.typical_low, s.low);
  assert.equal(a.price?.typical_high, s.high);
  assert.equal(a.sample_size, 12);
  assert.equal(a.price_type, "transaction");
  assert.deepEqual(a.period, { from: "2025-09-17", to: "2025-09-30" });
  assert.equal(a.source.id, "us-home-sales");
  assert.equal(a.source.licence, "Public Domain (as labelled on the data.ct.gov dataset page)");
  assert.equal(a.source.publisher, "State of Connecticut, Office of Policy and Management (OPM)");
  assert.match(a.summary, /^Homes in Hartford, CT sold for a median of US\$350,000; typical range US\$\d/);
  assert.equal(a.method_url, "https://x.test/method");
  assert.equal((a.extra as any).dataset_latest_sale, "2025-09-30");
  assert.deepEqual((a.extra as any).window, { months: 12, from_exclusive: "2024-09-30", to: "2025-09-30" });
  assert.match(JSON.stringify(a.extra), /once a year/);
  // Two requests: the latest sale date, then the sales; neither reads anything but price and date.
  assert.equal(urls.length, 2);
  assert.match(urls[0], /\$select=max\(daterecorded\)%20as%20latest/);
  assert.match(urls[1], /\$select=saleamount%2Cdaterecorded/);
  assert.match(urls[1], /town%20%3D%20'Hartford'/);
  assert.doesNotMatch(JSON.stringify(a), /address|serialnumber/i);
});

test("Brooklyn: house/condo/co-op sales, 24 months is cut to the 12 the city publishes", async () => {
  const { fetcher, urls } = fakePortal(NYC_BROOKLYN, LATEST.nyc);
  const a = await usHomeSales({ town: "Brooklyn", months: 24 }, { fetcher, today: new Date("2026-10-14T12:00:00Z") });
  assert.equal(a.status, "ok");
  assert.equal(a.price?.median, 916116); // middle pair of the 12 prices: 815,000 and 1,017,232
  assert.equal(a.sample_size, 12);
  assert.deepEqual((a.query as any).months, 12);
  assert.match(a.summary, /^Homes \(houses, condos and co-ops\) in Brooklyn, New York City sold for a median of US\$/);
  assert.match(JSON.stringify((a.extra as any).notes), /asked for 24, used 12/);
  assert.match(urls[1], /borough%20%3D%20'3'/);
  assert.equal(a.source.licence_url, "https://www.nyc.gov/html/data/terms.html");
});

test("Chicago: Cook County prices arrive as '1045000.0'", async () => {
  const { fetcher } = fakePortal(COOK_CHICAGO, LATEST.cook);
  const a = await usHomeSales({ town: "Chicago", property_type: "house" }, { fetcher, today: new Date("2026-10-14T12:00:00Z") });
  assert.equal(a.status, "ok");
  assert.equal(a.price?.unit, "per home");
  assert.equal(a.price?.median, 565000); // middle pair 505000 and 625000
  assert.equal(a.price?.max, 1825000);
  assert.deepEqual(a.period, { from: "2026-08-10", to: "2026-08-12" });
  assert.match(a.summary, /^Houses and townhomes in Chicago, IL sold for a median of US\$565,000/);
  assert.match(a.source.licence, /^Cook County Terms of Use/);
  assert.match(JSON.stringify((a.extra as any).notes), /reported on a lag/);
});

test("fewer than 5 sales are never published", async () => {
  const { fetcher } = fakePortal(CT_HARTFORD.slice(0, 4), LATEST.ct);
  const a = await usHomeSales({ town: "Hartford" }, { fetcher, today: new Date("2026-10-14T12:00:00Z") });
  assert.equal(a.status, "insufficient_data");
  assert.equal(a.price, null);
  assert.match(a.summary, /at least 5 are needed/);
  const none = await usHomeSales({ town: "Hartford" }, { fetcher: fakePortal([], LATEST.ct).fetcher, today: new Date("2026-10-14T12:00:00Z") });
  assert.equal(none.status, "no_matches");
});

test("paging stops at the row cap and says so", async () => {
  const offsets: number[] = [];
  const fetcher = async (url: string) => {
    if (url.includes("max(")) return [{ latest: LATEST.ct }];
    const limit = Number(/\$limit=(\d+)/.exec(url)![1]);
    offsets.push(Number(/\$offset=(\d+)/.exec(url)?.[1] ?? 0));
    return Array.from({ length: limit }, (_, i) => ({ saleamount: String(200000 + i), daterecorded: "2025-06-01T00:00:00.000" }));
  };
  const a = await usHomeSales({ town: "Connecticut" }, { fetcher, today: new Date("2026-10-14T12:00:00Z") });
  assert.equal(a.sample_size, MAX_ROWS);
  assert.equal(offsets.length, Math.ceil(MAX_ROWS / PAGE_SIZE));
  assert.deepEqual(offsets, [0, PAGE_SIZE, 2 * PAGE_SIZE].slice(0, offsets.length));
  assert.match(JSON.stringify((a.extra as any).notes), /capped at the 30,000 most recent/);
  assert.match(a.method, /uses the 30,000 most recent ones: the period field shows the dates actually covered/);
  const small = await usHomeSales({ town: "Hartford" }, { fetcher: fakePortal(CT_HARTFORD, LATEST.ct).fetcher, today: new Date("2026-10-14T12:00:00Z") });
  assert.doesNotMatch(small.method, /most recent ones/);
});

test("bad input is a clear error before any request is made", async () => {
  const { fetcher, urls } = fakePortal([], LATEST.ct);
  await assert.rejects(usHomeSales({ town: "Hartford", property_type: "detached" }, { fetcher }), /property_type must be one of: any, house, condo, coop/);
  await assert.rejects(usHomeSales({ town: "Austin" }, { fetcher }), /not a nationwide source/);
  await assert.rejects(usHomeSales({ town: "Hartford", property_type: "coop" }, { fetcher }), /only available for New York City/);
  assert.equal(urls.length, 0);
});

test("the combined record says plainly that this is not nationwide", () => {
  clearLatestCache();
  assert.match(INFO.limits, /Not nationwide/);
  assert.match(INFO.country, /Connecticut.*New York City.*Cook County/);
  for (const d of Object.values(DATASETS)) {
    assert.match(d.info.licence_url, /^https:\/\//);
    assert.match(d.info.homepage, /^https:\/\//);
    assert.ok(d.info.attribution.startsWith("Source: "));
  }
});
