// The kit gate (lib/adapters/kits). Two parts:
//   1. every registered source built with a kit passes kitProblems() (licence, attribution, golden values, bands, labels) and its
//      own source.test.ts runs checkKitFixture() on a reply copied from the live service;
//   2. the readers and the stats-table kit, tested against REAL replies that live sources captured from publishers (re-used from
//      their fixture files, read only), and cross-checked against those sources' own hand-written parsers.
// Owner: the Adapter Steward.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { SOURCE_PLUGINS } from "../lib/registry";
import { NO_COUNT } from "../lib/stats";
import { parseJsonStat, rowsWhere } from "../lib/adapters";
import {
  buildRequest, cellsFromReply, checkKitFixture, defineStatsTableSource, harvestRows, kitConfigOf, kitProblems, normalisePeriod, parseCsvText, parseReply,
  parseSdmxCsv, periodBounds, previousOf, resolveArea, resolveItem, runStatsTable, StatsTableConfig, yearEarlier, KitFetcher, HttpRequest,
} from "../lib/adapters/kits";
import { CPM12 } from "../sources/ie-cso-prices/fixtures";
import { readItem } from "../sources/ie-cso-prices/source";
import { pickLatest, parseTable as parseSsbRents } from "../sources/no-ssb-rents/source";
import { QUARTERLY_CITIES } from "../sources/fi-home-prices/fixtures-data";
import { PPP_IRL_FOOD } from "../sources/oecd-price-levels/fixtures";
import { REAL_REPLY as CBS_REPLY } from "../sources/nl-cbs-fuel/fixtures";
import { CKAN_DATASTORE_SEARCH } from "./fixtures/portals";

const T09895 = JSON.parse(readFileSync("sources/no-ssb-rents/fixtures/t09895.json", "utf8"));
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

// ---------- 1. every kit source ----------

test("kit sources: every source built with a kit passes the kit gate and tests its golden value against a live fixture", () => {
  for (const s of SOURCE_PLUGINS) {
    const cfg = kitConfigOf(s);
    if (!cfg) continue;
    assert.deepEqual(kitProblems(cfg), [], `sources/${s.info.id}`);
    const testFile = `sources/${s.info.id}/source.test.ts`;
    assert.ok(existsSync(testFile), `sources/${s.info.id}: add source.test.ts with a fixture copied from the live reply`);
    assert.match(readFileSync(testFile, "utf8"), /checkKitFixture\(/, `sources/${s.info.id}/source.test.ts must call checkKitFixture(config, fixture)`);
    assert.equal(s.nominalCounts, true);
    assert.equal(s.referenceDates, true);
  }
});

// ---------- 2a. periods ----------

test("periods: every publisher spelling becomes one kit period", () => {
  const cases: Array<[string, string | null]> = [
    ["2026M09", "2026-09"], ["2026M9", "2026-09"], ["202609", "2026-09"], ["2026MM09", "2026-09"], ["2026-09", "2026-09"],
    ["2026K3", "2026-Q3"], ["2026Q3", "2026-Q3"], ["2026-Q3", "2026-Q3"], ["2026KW03", "2026-Q3"],
    ["2026S1", "2026-S1"], ["2026-S2", "2026-S2"], ["2026", "2026"], ["2026JJ00", "2026"],
    ["20261012", "2026-10-12"], ["2026-10-12", "2026-10-12"], ["2026-10-12T00:00:00", "2026-10-12"],
    ["2026 August", null], ["", null], ["2026M13", null],
  ];
  for (const [raw, want] of cases) assert.equal(normalisePeriod(raw), want, raw);
  assert.deepEqual(periodBounds("2026-Q3"), { from: "2026-07-01", to: "2026-09-30" });
  assert.deepEqual(periodBounds("2024-02"), { from: "2024-02-01", to: "2024-02-29" });
  assert.equal(yearEarlier("2026-09"), "2025-09");
  assert.equal(previousOf("2026-01"), "2025-12");
  assert.equal(previousOf("2026-Q1"), "2025-Q4");
});

// ---------- 2b. readers: requests ----------

test("readers: one request per selection, in each service's own syntax", () => {
  const sel = { dims: { AntRom: ["2"], Soner2: ["01"], ContentsCode: ["Husleie"] }, time: "Tid", lastN: 3 };
  assert.equal(
    buildRequest({ kind: "pxweb-v2", url: "https://data.ssb.no/api/pxwebapi/v2/tables/09895/data" }, sel).url,
    "https://data.ssb.no/api/pxwebapi/v2/tables/09895/data?lang=en&outputFormat=json-stat2&valueCodes%5BAntRom%5D=2&valueCodes%5BSoner2%5D=01&valueCodes%5BContentsCode%5D=Husleie&valueCodes%5BTid%5D=top(3)",
  );
  const v1 = buildRequest({ kind: "pxweb-v1", url: "https://data.stat.gov.lv/api/v1/en/OSP_PUB/START/VEK/PC/PCC/PCC010m" }, { dims: { GOODS_SERVICES: ["01.1.1.1.2.101"], ContentsCode: ["PCC010m"] }, time: "TIME", lastN: 13 });
  assert.equal(v1.method, "POST");
  assert.deepEqual(v1.body, {
    query: [
      { code: "GOODS_SERVICES", selection: { filter: "item", values: ["01.1.1.1.2.101"] } },
      { code: "ContentsCode", selection: { filter: "item", values: ["PCC010m"] } },
      { code: "TIME", selection: { filter: "top", values: ["13"] } },
    ],
    response: { format: "json-stat2" },
  });
  assert.equal(
    buildRequest({ kind: "sdmx-csv", base: "https://sdmx.oecd.org/public/rest/", flow: "OECD.SDD.TPS,DSD_PPP@DF_PPP,1.1", keyOrder: ["REF_AREA", "FREQ", "MEASURE", "ANALYTICAL_CATEGORIES", "UNIT_MEASURE", "BASE_REF_AREA"] }, { dims: { REF_AREA: ["IRL"], FREQ: ["A"], MEASURE: ["PL", "PPP"], ANALYTICAL_CATEGORIES: ["A0101"], BASE_REF_AREA: ["OECD"] }, time: "TIME_PERIOD", lastN: 5 }).url,
    "https://sdmx.oecd.org/public/rest/data/OECD.SDD.TPS,DSD_PPP@DF_PPP,1.1/IRL.A.PL+PPP.A0101..OECD?lastNObservations=5&format=csvfilewithlabels",
  );
  assert.match(buildRequest({ kind: "eurostat", dataset: "prc_dap15" }, { dims: { geo: ["LV"] }, time: "time", lastN: 2 }).url, /prc_dap15\?format=JSON&lang=EN&geo=LV&lastTimePeriod=2$/);
  assert.equal(buildRequest({ kind: "odata", url: "https://opendata.cbs.nl/ODataApi/odata/80416ned/TypedDataSet", filter: "Perioden gt '20261005'" }, { dims: {}, time: "Perioden", lastN: 1 }).url,
    "https://opendata.cbs.nl/ODataApi/odata/80416ned/TypedDataSet?$filter=Perioden%20gt%20'20261005'");
  assert.match(buildRequest({ kind: "ckan-datastore", site: "https://www.data.qld.gov.au", resourceId: "abc" }, { dims: { Fuel_Type: ["Diesel"] }, time: "TransactionDateutc", lastN: 1 }).url, /datastore_search\?resource_id=abc&filters=/);
});

// ---------- 2c. readers: real replies ----------

test("sdmx-csv: OECD's labelled CSV (real reply 2026-10-20) gives rows with codes and labels", () => {
  const t = parseSdmxCsv(PPP_IRL_FOOD);
  assert.ok(t.rows.length >= 3);
  const r = t.rows.find((x) => x.MEASURE === "PL" && x.TIME_PERIOD === "2024")!;
  assert.equal(r.value, 105);
  assert.equal(r.REF_AREA, "IRL");
  assert.equal(t.labels.REF_AREA.IRL, "Ireland");
  assert.equal(t.labels.ANALYTICAL_CATEGORIES.A0101, "Food and non-alcoholic beverages");
  assert.deepEqual(parseCsvText('a,"b,""c"""\r\n1,2\n'), [["a", 'b,"c"'], ["1", "2"]]);
});

// A fake fetcher that serves one stored reply and records the request.
function serve(body: unknown): { fetcher: KitFetcher; seen: HttpRequest[] } {
  const seen: HttpRequest[] = [];
  return { seen, fetcher: async (req) => (seen.push(req), clone(body)) };
}

const BASE_INFO = {
  country: "XX (test)", category: "test", name: "Kit test table", publisher: "Statistics Norway (SSB)", what_is_recorded: "Test.", price_type: "official_statistic" as const,
  freshness: "Annual", licence: "Creative Commons Attribution 4.0 (CC BY 4.0)", licence_url: "https://www.ssb.no/en/diverse/lisens", homepage: "https://www.ssb.no/en/statbank/table/09895", limits: "Test only.",
};

// SSB rent survey 09895 (PxWebApi v2, JSON-stat2), the same reply sources/no-ssb-rents tests with (captured 2026-10-14).
const SSB_RENTS: StatsTableConfig = {
  info: { ...BASE_INFO, id: "kit-test-ssb", attribution: "Source: Statistics Norway (SSB), table 09895. CC BY 4.0." },
  licenceCheck: { checked: "2026-10-14", quote: "Creative Commons Attribution 4.0 International", url: "https://www.ssb.no/en/diverse/lisens", commercial: "yes" },
  table: { id: "09895", title: "Rental market survey" },
  category: "rent", countryHelp: "NO = Norway", placeName: "Norway",
  reader: { kind: "pxweb-v2", url: "https://data.ssb.no/api/pxwebapi/v2/tables/09895/data" },
  dims: { time: "Tid", item: "AntRom", area: "Soner2" },
  fixed: { ContentsCode: "Husleie" },
  items: {
    "rooms-1": { code: "1", label: "1 room", unit: "per month", words: ["1 room", "studio"], labelMustContain: "1 room", plausible: [3000, 30000] },
    "rooms-2": { code: "2", label: "2 rooms", unit: "per month", words: ["2 rooms", "two rooms"], labelMustContain: "2 rooms", plausible: [3000, 40000] },
  },
  itemParam: "rooms_kit",
  areas: {
    ALL: { code: "00", iso: "NO", label: "Norway", words: ["whole country"] },
    oslo: { code: "01", iso: "NO", label: "Oslo and Bærum", words: ["Oslo"] },
  },
  areaParam: "town",
  currency: "NOK", measure: "average",
  golden: [{ item: "rooms-2", area: "oslo", period: "2025", value: 15260, seenAt: "https://www.ssb.no/en/statbank/table/09895", seenOn: "2026-10-22" }],
  whatThisIs: "Weighted survey average of monthly rents.",
  method: "Test.",
  examples: [{ params: { country: "NO", rooms_kit: "2 rooms", town: "Oslo" } }],
};

test("stats-table kit on SSB 09895 (PxWebApi v2): same figure as the hand-written no-ssb-rents parser", async () => {
  assert.deepEqual(kitProblems(SSB_RENTS), []);
  assert.deepEqual(checkKitFixture(SSB_RENTS, clone(T09895)), []);
  const own = pickLatest(parseSsbRents(clone(T09895)), "01", "2")!;
  const { fetcher, seen } = serve(T09895);
  const a = await runStatsTable(SSB_RENTS, { country: "NO", rooms_kit: "two rooms", town: "oslo" }, {}, { fetcher });
  assert.equal(a.status, "ok");
  assert.equal(a.price!.value, own.value); // 15260, two implementations agree
  assert.equal(a.price!.measure, "average");
  assert.equal(a.sample_size, null); // never a made-up count
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.statistic?.reference_period, "2025");
  assert.deepEqual(a.period, { from: "2025-01-01", to: "2025-12-31" });
  assert.match(a.source.attribution, /09895/);
  assert.match(String(a.source.licence), /CC BY 4.0/);
  assert.equal((a.extra as any).item.publisher_label, "2 rooms");
  assert.match(seen[0].url, /valueCodes%5BAntRom%5D=2&valueCodes%5BSoner2%5D=01&valueCodes%5BContentsCode%5D=Husleie&valueCodes%5BTid%5D=top\(13\)/);
});

test("stats-table kit refuses rather than answers wrongly: changed label, out-of-band value, unknown place or item", async () => {
  const relabelled = clone(T09895);
  relabelled.dimension.AntRom.category.label["2"] = "2 rooms incl. kitchen";
  const changedLabel = { ...SSB_RENTS, items: { ...SSB_RENTS.items, "rooms-2": { ...SSB_RENTS.items["rooms-2"], labelMustContain: "2 bedrooms" } } };
  await assert.rejects(runStatsTable(changedLabel, { country: "NO", rooms_kit: "2 rooms", town: "Oslo" }, {}, serve(relabelled)), /no longer says "2 bedrooms"/);
  const tightBand = { ...SSB_RENTS, items: { ...SSB_RENTS.items, "rooms-2": { ...SSB_RENTS.items["rooms-2"], plausible: [100, 1000] as [number, number] } } };
  await assert.rejects(runStatsTable(tightBand, { country: "NO", rooms_kit: "2 rooms", town: "Oslo" }, {}, serve(T09895)), /outside the believable range/);
  await assert.rejects(runStatsTable(SSB_RENTS, { country: "NO", rooms_kit: "2 rooms", town: "Tromsø" }, {}, serve(T09895)), /not a place .* Use one of: Norway, Oslo and Bærum/);
  await assert.rejects(runStatsTable(SSB_RENTS, { country: "NO", rooms_kit: "castle", town: "Oslo" }, {}, serve(T09895)), /no standard item for "castle"/);
  // a golden value that does not match the table is caught by the fixture check (wrong code, unit or dimension)
  const wrongGolden = { ...SSB_RENTS, golden: [{ ...SSB_RENTS.golden[0], value: 15000 }] };
  assert.match(checkKitFixture(wrongGolden, clone(T09895)).join(" "), /page says 15000, the table reads 15260/);
});

test("stats-table kit: harvest writes one published figure per item and area, n NO_COUNT, dated by the reference period", () => {
  const read = cellsFromReply(SSB_RENTS, parseReply(SSB_RENTS.reader, clone(T09895)), { items: ["rooms-1", "rooms-2"], areas: ["ALL", "oslo"] });
  const h = harvestRows(SSB_RENTS, read);
  assert.equal(h.date, "2025-12-31");
  assert.equal(h.currency, "NOK");
  assert.equal(h.rows.length, 4);
  for (const r of h.rows) assert.ok(Number.isNaN(r.n) && Object.is(r.n, NO_COUNT) === Number.isNaN(NO_COUNT));
  const oslo2 = h.rows.find((r) => r.area === "oslo" && r.item === "rooms-2")!;
  assert.equal(oslo2.median, 15260);
  assert.equal(oslo2.low, 15260);
  const national2 = h.rows.find((r) => r.area === "ALL" && r.item === "rooms-2")!;
  assert.equal(national2.median, 11790);
  const plugin = defineStatsTableSource({ ...SSB_RENTS, info: { ...SSB_RENTS.info, id: "kit-test-ssb-plugin" } });
  assert.deepEqual(plugin.historyKey!({ country: "NO", rooms_kit: "2 rooms", town: "Oslo" }), { area: "oslo", item: "rooms-2", label: "2 rooms, Oslo and Bærum" });
  assert.deepEqual(plugin.historyKey!({ country: "NO", rooms_kit: "2 rooms" }), { area: "ALL", item: "rooms-2", label: "2 rooms, Norway" });
  assert.equal(plugin.historyKey!({ country: "NO", rooms_kit: "2 rooms", town: "Narnia" }), null);
  assert.deepEqual(plugin.countries, ["NO"]);
  assert.equal(plugin.info.method_version, "stats-table-1");
  assert.equal(kitConfigOf(plugin)?.table.id, "09895");
});

// CSO PxStat CPM12 (whole-dataset JSON-stat, no area dimension), captured 2026-10-14 by sources/ie-cso-prices.
const CSO: StatsTableConfig = {
  info: { ...BASE_INFO, id: "kit-test-cso", publisher: "Central Statistics Office (CSO), Ireland", attribution: "Source: Central Statistics Office, Ireland, table CPM12. CC BY 4.0.", licence_url: "https://www.cso.ie/en/aboutus/whoweare/copyrightpolicy/", homepage: "https://data.cso.ie/table/CPM12" },
  licenceCheck: { checked: "2026-10-14", quote: "licensed under Creative Commons Attribution (CC BY 4.0)", url: "https://www.cso.ie/en/aboutus/whoweare/copyrightpolicy/", commercial: "yes" },
  table: { id: "CPM12", title: "National Average Price" },
  category: "groceries", countryHelp: "IE = Ireland", placeName: "Ireland",
  reader: { kind: "jsonstat", url: "https://ws.cso.ie/public/api.restful/PxStat.Data.Cube_API.ReadDataset/CPM12/JSON-stat/2.0/en" },
  dims: { time: "TLIST(M1)", item: "C02363V03422" },
  fixed: { STATISTIC: "CPM12" },
  items: {
    "milk-2l": { code: "10630", label: "Full-fat milk, per 2 litres", unit: "per 2 litres", words: ["milk"], labelMustContain: "2 litre", plausible: [1, 6] },
    "bread-white": { code: "10040", label: "White sliced pan, 800 g", unit: "per 800 g loaf", words: ["bread", "white bread"], labelMustContain: "800g", plausible: [0.8, 5] },
  },
  itemParam: "item",
  areas: { ALL: { code: null, iso: "IE", label: "Ireland" } },
  currency: "EUR", measure: "average",
  golden: [{ item: "milk-2l", period: "2026-09", value: 0, seenAt: "https://data.cso.ie/table/CPM12", seenOn: "2026-10-22" }],
  whatThisIs: "Average shelf price recorded by CSO price collectors for the CPI; not a receipt.",
  method: "Test.",
  examples: [{ params: { country: "IE", item: "milk" } }],
};

test("stats-table kit on CSO CPM12 (PxStat JSON-stat, national only): same figure and year-ago change as ie-cso-prices", async () => {
  const own = readItem(parseJsonStat(clone(CPM12)), "10630")!;
  const cfg = { ...CSO, golden: [{ ...CSO.golden[0], period: own.latest.month, value: own.latest.value }] };
  assert.deepEqual(kitProblems(cfg), []);
  assert.deepEqual(checkKitFixture(cfg, clone(CPM12)), []);
  const a = await runStatsTable(cfg, { country: "IE", item: "milk" }, {}, serve(CPM12));
  assert.equal(a.status, "ok");
  assert.equal(a.price!.value, own.latest.value);
  assert.equal(a.statistic?.reference_period, own.latest.month);
  const yoy = (a.extra as any).change_on_year_earlier;
  if (own.yearAgo) assert.equal(yoy.value, own.yearAgo.value);
  assert.equal((a.extra as any).recent_periods.length, 13);
  assert.match(a.summary, /In Ireland the average price of "Full-fat milk, per 2 litres" was/);
  // a region is not a place in a national-only table
  assert.throws(() => resolveArea(cfg, "Cork", "IE"), /national figures only/);
});

test("pxweb-v1 reply (Statistics Finland 15is, captured 2026-10-14): cube with area, item and fixed contents", () => {
  const cfg: StatsTableConfig = {
    ...CSO,
    info: { ...CSO.info, id: "kit-test-fi", publisher: "Statistics Finland", attribution: "Source: Statistics Finland, table 15is." },
    table: { id: "15is", title: "Prices of dwellings" },
    countryHelp: "FI = Finland",
    reader: { kind: "pxweb-v1", url: "https://pxdata.stat.fi/PxWeb/api/v1/en/StatFin/ashi/15is.px" },
    dims: { time: "timeperiod_q", item: "talotyyppi_5_20111209", area: "alue_43_20260625" },
    fixed: { contentscode: "ashivq_keskineliohinta", huoneluku_1_20111212: "00" },
    items: { flats: { code: "3", label: "Blocks of flats, price per m²", unit: "per m²", words: ["flats"], labelMustContain: "Blocks of flats", plausible: [800, 15000] } },
    areas: { ALL: { code: "SSS", iso: "FI", label: "Finland" }, helsinki: { code: "091", iso: "FI", label: "Helsinki" } },
    areaParam: "region",
    golden: [{ item: "flats", area: "helsinki", period: "2026-Q2", value: 1, seenAt: "https://stat.fi/en/statistics/ashi", seenOn: "2026-10-22" }],
    examples: [{ params: { country: "FI", item: "flats" } }],
  };
  const t = parseJsonStat(clone(QUARTERLY_CITIES));
  const expected = rowsWhere(t, { alue_43_20260625: "091", talotyyppi_5_20111209: "3", timeperiod_q: "2026Q2", contentscode: "ashivq_keskineliohinta" })[0].value!;
  const read = cellsFromReply(cfg, parseReply(cfg.reader, clone(QUARTERLY_CITIES)), { items: ["flats"], areas: ["ALL", "helsinki"] });
  const hel = read.cells.find((c) => c.areaKey === "helsinki")!;
  assert.deepEqual(hel.points.at(-1), { period: "2026-Q2", value: expected });
  assert.equal(hel.points.length, 6);
  assert.deepEqual(checkKitFixture({ ...cfg, golden: [{ ...cfg.golden[0], value: expected }] }, clone(QUARTERLY_CITIES)), []);
});

test("odata wide layout (CBS 80416ned fuel, captured 2026-10-21): one column per product", async () => {
  const cfg: StatsTableConfig = {
    ...CSO,
    info: { ...CSO.info, id: "kit-test-cbs", publisher: "Statistics Netherlands (CBS)", attribution: "Source: Statistics Netherlands (CBS), table 80416ned. CC BY 4.0." },
    table: { id: "80416ned", title: "Pompprijzen motorbrandstoffen" },
    countryHelp: "NL = Netherlands",
    reader: { kind: "odata", url: "https://opendata.cbs.nl/ODataApi/odata/80416ned/TypedDataSet", filter: "Perioden gt '20261005'" },
    dims: { time: "Perioden" },
    fixed: {},
    itemParam: "fuel",
    items: {
      petrol: { code: "BenzineEuro95_1", label: "Euro 95 petrol", unit: "per litre", words: ["petrol", "euro95"], plausible: [1, 4] },
      diesel: { code: "Diesel_2", label: "Diesel", unit: "per litre", words: ["diesel"], plausible: [1, 4] },
    },
    areas: { ALL: { code: null, iso: "NL", label: "the Netherlands" } },
    golden: [{ item: "petrol", period: "2026-10-12", value: 2.462, seenAt: "https://opendata.cbs.nl/statline/#/CBS/nl/dataset/80416ned/table", seenOn: "2026-10-22" }],
    examples: [{ params: { country: "NL", fuel: "petrol" } }],
  };
  assert.deepEqual(kitProblems(cfg), []);
  assert.deepEqual(checkKitFixture(cfg, clone(CBS_REPLY)), []);
  const a = await runStatsTable(cfg, { country: "NL", fuel: "diesel" }, {}, serve(CBS_REPLY));
  assert.equal(a.price!.value, 2.482);
  assert.equal(a.statistic?.reference_period, "2026-10-12");
  assert.equal((a.extra as any).change_on_previous_period, null); // days are not stepped
});

test("ckan-datastore long layout (Queensland datastore, captured 2026-10-14): rows with an item column and a value column", () => {
  const reply = parseReply({ kind: "ckan-datastore", site: "https://www.data.qld.gov.au", resourceId: "x" }, clone(CKAN_DATASTORE_SEARCH));
  assert.ok("records" in reply);
  const cfg = {
    ...CSO,
    reader: { kind: "ckan-datastore" as const, site: "https://www.data.qld.gov.au", resourceId: "x" },
    dims: { time: "TransactionDateutc", item: "Fuel_Type" },
    valueColumn: "Price",
    fixed: {},
    items: { diesel: { code: "Diesel", label: "Diesel", unit: "per litre (tenths of a cent)", words: ["diesel"], plausible: [1000, 4000] as [number, number] } },
  };
  const read = cellsFromReply(cfg, reply, { items: ["diesel"], areas: ["ALL"] });
  assert.deepEqual(read.cells[0].points.map((p) => p.period), ["2026-08-04", "2026-08-21", "2026-08-28"]);
  assert.equal(read.cells[0].points[0].value, 2499);
});

test("kit gate: each kind of mistake gets a plain message", () => {
  const msg = (patch: Partial<StatsTableConfig>) => kitProblems({ ...SSB_RENTS, ...patch }, new Date("2026-10-22T12:00:00Z")).join(" | ");
  assert.equal(msg({}), "");
  assert.match(msg({ licenceCheck: { ...SSB_RENTS.licenceCheck, commercial: "no" } }), /may not be used/);
  assert.match(msg({ licenceCheck: { ...SSB_RENTS.licenceCheck, commercial: "unclear" } }), /'Simon is needed' decision/);
  assert.match(msg({ licenceCheck: { ...SSB_RENTS.licenceCheck, quote: "Terms of use: OPEN-BY-ASK" } }), /restricted terms \(OPEN-BY-ASK\)/);
  assert.match(msg({ licenceCheck: { ...SSB_RENTS.licenceCheck, checked: "2026-11-01" } }), /checked must be the YYYY-MM-DD/);
  assert.match(msg({ info: { ...SSB_RENTS.info, attribution: "Source: SSB." } }), /must name the table id "09895"/);
  assert.match(msg({ info: { ...SSB_RENTS.info, price_type: "posted_price" as any } }), /official_statistic/);
  assert.match(msg({ golden: [] }), /golden is empty/);
  assert.match(msg({ golden: [{ ...SSB_RENTS.golden[0], seenAt: "https://proofprice.com/prices" }] }), /publisher's own https page/);
  assert.match(msg({ items: { a: { ...SSB_RENTS.items["rooms-2"], labelMustContain: undefined } } }), /labelMustContain is required/);
  assert.match(msg({ items: { a: { ...SSB_RENTS.items["rooms-2"], plausible: [1, 100000] } } }), /too wide/);
  assert.match(msg({ countryHelp: "Norway" }), /countryHelp should mention NO/);
  assert.match(msg({ areas: { ALL: { code: null, iso: "NO", label: "Norway" } } }), /code is null but the table has an area dimension/);
});

test("item and area words: plain words, codes and keys all resolve; nothing is guessed", () => {
  assert.equal(resolveItem(SSB_RENTS, "Two Rooms").key, "rooms-2");
  assert.equal(resolveItem(SSB_RENTS, "rooms-1").key, "rooms-1");
  assert.equal(resolveItem(SSB_RENTS, "garage").key, null);
  assert.equal(resolveArea(SSB_RENTS, "OSLO", "NO"), "oslo");
  assert.equal(resolveArea(SSB_RENTS, "01", "NO"), "oslo");
  assert.equal(resolveArea(SSB_RENTS, undefined, "NO"), "ALL");
});
