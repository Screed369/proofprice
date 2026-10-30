import { test } from "node:test";
import assert from "node:assert/strict";
import { InputError } from "../../lib/http";
import { SOURCE_PLUGINS, countriesFor, categoryById, paramSchemas } from "../../lib/registry";
import {
  INFO, ODATA_BASE, nlHarvest, nlHarvestRows, nlHistoryKey, NATIONAL_KEY, cleanPlace, dataUrl, foldName, nlAnswer, nlHomePrices, parseRegions, parseValues, pickRegion, plainTitle, readNl, regionLookupUrl, searchToken,
} from "./source";
import type { Region } from "./source";
import * as F from "./fixtures";

// Fixtures: real CBS OData responses captured 2026-10-14 (see fixtures.ts).
const AMSTERDAM: Region = { key: "GM0363", title: "Amsterdam", kind: "GM", dissolved: false };
const NOW = new Date("2026-10-14T12:00:00Z");

function fake(responses: unknown[]) {
  const urls: string[] = [];
  let i = 0;
  return { urls, fetcher: async (url: string) => (urls.push(url), responses[i++]) };
}

test("nl-home-prices: licence, attribution and type are CBS's", () => {
  assert.equal(INFO.id, "nl-home-prices");
  assert.equal(INFO.price_type, "official_statistic");
  assert.match(INFO.publisher, /Statistics Netherlands \(CBS\)/);
  assert.match(INFO.licence, /CC BY 4\.0/);
  assert.match(INFO.licence, /re-use of the content of this site is permitted, provided Statistics Netherlands is cited as the source/);
  assert.equal(INFO.licence_url, "https://www.cbs.nl/en-gb/about-us/website/copyright");
  for (const k of ["83625NED", "CBS", "Kadaster", "CC BY 4.0"]) assert.ok(INFO.attribution.includes(k), k);
  assert.match(INFO.limits, /not a price index/);
});

test("nl-home-prices: registered as the NL source of the home-sales tool, Amsterdam first", () => {
  const plugin = SOURCE_PLUGINS.find((s) => s.info.id === "nl-home-prices")!;
  assert.equal(plugin.category, "home-sales");
  assert.deepEqual(plugin.countries, ["NL"]);
  assert.equal(plugin.status, "live");
  assert.deepEqual(plugin.examples[0].params, { country: "NL", town: "Amsterdam" });
  assert.ok(countriesFor("home-sales").includes("NL"));
  assert.match(String(paramSchemas(categoryById("home-sales")!).town.description), /NL: a municipality/);
});

test("nl-home-prices: place names fold accents and map the common alternatives", () => {
  assert.equal(foldName("  ’s-Gravenhage "), "'s-gravenhage");
  assert.equal(foldName("Fryslân"), "fryslan");
  assert.equal(cleanPlace("Amsterdam, Netherlands"), "amsterdam");
  assert.equal(cleanPlace("Gemeente Utrecht"), "utrecht");
  assert.equal(cleanPlace("Groningen (gemeente)"), "groningen");
  for (const n of ["Den Haag", "The Hague", "'s-Gravenhage", "s-Gravenhage", "Den-Haag"]) assert.equal(searchToken(n), "gravenhage", n);
  for (const n of ["Den Bosch", "'s-Hertogenbosch", "s-Hertogenbosch"]) assert.equal(searchToken(n), "hertogenbosch", n);
  assert.equal(searchToken("Amsterdam"), "amsterdam");
  assert.equal(searchToken("Noord-Holland"), "noord-holland");
  assert.equal(searchToken("North Holland"), "noord-holland");
  assert.equal(searchToken("Friesland"), "frysl");
  for (const n of ["Netherlands", "Nederland", "Holland", "the Netherlands"]) assert.equal(searchToken(n), "national", n);
  assert.throws(() => searchToken("a'); drop"), InputError);
  assert.throws(() => searchToken("x"), InputError);
});

test("nl-home-prices: the region lookup is one OData request, with quotes doubled", () => {
  assert.equal(
    regionLookupUrl("amsterdam"),
    `${ODATA_BASE}/RegioS?$filter=substringof('amsterdam',tolower(Title))&$select=Key,Title,Description`.replace(/\$filter=.*&\$select/, `$filter=${encodeURIComponent("substringof('amsterdam',tolower(Title))")}&$select`),
  );
  assert.ok(regionLookupUrl("o'brien").includes(encodeURIComponent("substringof('o''brien',tolower(Title))")));
  assert.equal(
    dataUrl(["GM0363", NATIONAL_KEY], 2020),
    `${ODATA_BASE}/TypedDataSet?$filter=${encodeURIComponent("(RegioS eq 'GM0363' or RegioS eq 'NL01  ') and Perioden ge '2020JJ00'")}`,
  );
});

test("nl-home-prices: picks the municipality the caller meant from real CBS matches", () => {
  const utrecht = parseRegions(F.REGIONS_UTRECHT);
  assert.deepEqual(utrecht.map((r) => [r.key, r.kind]), [["PV26  ", "PV"], ["GM0344", "GM"], ["GM1581", "GM"]]);
  assert.equal(pickRegion(utrecht, "Utrecht").key, "GM0344"); // the municipality beats the province of the same name
  assert.equal(pickRegion(utrecht, "utrechtse heuvelrug").key, "GM1581");
  const grav = parseRegions(F.REGIONS_GRAVENHAGE);
  assert.equal(pickRegion(grav, "Den Haag").key, "GM0518");
  assert.equal(pickRegion(grav, "The Hague").key, "GM0518");
  assert.equal(plainTitle("'s-Gravenhage (gemeente)"), "'s-Gravenhage");
  const mixed = parseRegions(F.REGIONS_MIXED);
  assert.equal(pickRegion(mixed, "Groningen").key, "GM0014");
  assert.equal(pickRegion(mixed, "Haarlem").key, "GM0392");
  assert.throws(() => pickRegion(mixed, "Haar"), (e: any) => e instanceof InputError && /matches several Dutch places: .*Haarlem.*Haarlemmermeer/.test(e.message));
});

test("nl-home-prices: dissolved municipalities and unknown names are refused plainly", () => {
  // An excerpt of the real answer to substringof('bergen', ...): two live Bergens, Bergen op Zoom, and a municipality dissolved in 2005.
  const bergen = parseRegions({
    value: [
      { Key: "GM0893", Title: "Bergen (L.)", Description: "Begindatum 02-01-1839" },
      { Key: "GM0373", Title: "Bergen (NH.)", Description: "Gemeentelijke herindeling per 01-01-2001\r\nBegindatum voor 1830" },
      { Key: "GM0748", Title: "Bergen op Zoom", Description: "Gemeentelijke herindeling per 01-01-1997\r\nBegindatum voor 1830" },
      { Key: "GM0229", Title: "Eibergen", Description: "Opgeheven per 01-01-2005\r\nBegindatum voor 1830" },
    ],
  });
  assert.equal(bergen.find((r) => r.key === "GM0229")!.dissolved, true);
  assert.throws(() => pickRegion(bergen, "Bergen"), (e: any) => e instanceof InputError && /Bergen \(L\.\).*Bergen \(NH\.\).*Bergen op Zoom/.test(e.message) && !/Eibergen/.test(e.message));
  assert.equal(pickRegion(bergen, "Bergen op Zoom").key, "GM0748");
  assert.throws(() => pickRegion(bergen, "Eibergen"), /no longer exists as a Dutch municipality/);
  assert.throws(() => pickRegion(bergen.filter((r) => r.dissolved), "Haaksbergen"), /No current Dutch municipality/);
  assert.throws(() => pickRegion([], "Atlantis"), /No current Dutch municipality, province or region called 'Atlantis'/);
});

test("nl-home-prices: reads Amsterdam from the real response (latest year, change, national average)", () => {
  const values = parseValues(F.DATA_AMSTERDAM_NATIONAL);
  assert.equal(values.length, 12);
  const r = readNl(values, AMSTERDAM)!;
  assert.equal(r.year, 2025);
  assert.equal(r.value, 630621);
  assert.deepEqual(r.previous, { year: 2024, value: 617647, change_percent: 2.1 });
  assert.deepEqual(r.national, { year: 2025, value: 479527, difference_percent: 31.5 });
  assert.deepEqual(r.series.map((s) => s.year), [2020, 2021, 2022, 2023, 2024, 2025]);
  const nat = readNl(values, { key: NATIONAL_KEY, title: "Nederland", kind: "NL", dissolved: false })!;
  assert.equal(nat.value, 479527);
  assert.equal(nat.national, null); // no comparison of the country with itself
  assert.equal(nat.previous!.change_percent, 6.3);
  assert.equal(readNl(values, { key: "GM9999", title: "Nowhere", kind: "GM", dissolved: false }), null);
});

test("nl-home-prices: parseValues ignores rows without a figure", () => {
  const rows = parseValues({ value: [
    { RegioS: "GM0001", Perioden: "2025JJ00", GemiddeldeVerkoopprijs_1: null },
    { RegioS: "GM0001", Perioden: "2024JJ00", GemiddeldeVerkoopprijs_1: 300000 },
    { RegioS: "GM0001", Perioden: "2025KW01", GemiddeldeVerkoopprijs_1: 310000 },
  ] });
  assert.deepEqual(rows, [{ key: "GM0001", year: 2024, value: 300000 }]);
  assert.throws(() => parseValues({}), /Unexpected response from CBS/);
});

test("nl-home-prices: the full answer for Amsterdam", () => {
  const url = dataUrl(["GM0363", NATIONAL_KEY], 2020);
  const reading = readNl(parseValues(F.DATA_AMSTERDAM_NATIONAL), AMSTERDAM);
  const a = nlAnswer(reading, { place: "Amsterdam", property_type: "any", baseUrl: "https://proofprice.com", apiUrl: url, now: NOW });
  assert.equal(a.status, "ok");
  assert.deepEqual(a.query, { country: "NL", town: "Amsterdam", property_type: "any" });
  assert.deepEqual(a.price, { currency: "EUR", unit: "per home", value: 630621, measure: "average", median: null, typical_low: null, typical_high: null, min: null, max: null });
  assert.equal(a.sample_size, null);
  assert.deepEqual(a.period, { from: "2025-01-01", to: "2025-12-31" });
  assert.deepEqual(a.statistic, { measure: "average", reference_period: "2025" });
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.confidence, "high");
  assert.equal(a.method_url, "https://proofprice.com/method");
  assert.equal(
    a.summary,
    "In Amsterdam the average sale price of existing owner-occupied homes was €630,621 in 2025. " +
      "That is 2.1% higher than in 2024 (€617,647). The national average for 2025 was €479,527 (31.5% above). " +
      "Official average published by Statistics Netherlands (CBS), based on Kadaster notarial transactions for 2025.",
  );
  const x: any = a.extra;
  assert.deepEqual(x.region, { code: "GM0363", name: "Amsterdam", level: "municipality", cbs_title: "Amsterdam" });
  assert.deepEqual(x.previous_period, { reference_period: "2024", value: 617647, change_percent: 2.1 });
  assert.deepEqual(x.national_average, { reference_period: "2025", value: 479527, region_vs_national_percent: 31.5 });
  assert.equal(x.series.length, 6);
  assert.equal(x.cbs_api_url, url);
  assert.equal(a.source.id, "nl-home-prices");
});

test("nl-home-prices: an out-of-date figure is flagged in plain words", () => {
  const reading = readNl(parseValues(F.DATA_AMSTERDAM_NATIONAL), AMSTERDAM);
  const a = nlAnswer(reading, { place: "Amsterdam", property_type: "any", now: new Date("2028-03-01T00:00:00Z") });
  assert.match(a.statistic!.note!, /This figure is for 2025, more than a year old/);
  const fresh = nlAnswer(reading, { place: "Amsterdam", property_type: "any", now: NOW });
  assert.equal(fresh.statistic!.note, undefined);
  // A municipality whose newest figure is older than the national one says so
  const old = readNl(parseValues({ value: [
    { RegioS: "GM0001", Perioden: "2023JJ00", GemiddeldeVerkoopprijs_1: 300000 },
    { RegioS: "NL01  ", Perioden: "2025JJ00", GemiddeldeVerkoopprijs_1: 479527 },
  ] }), { key: "GM0001", title: "Testdorp", kind: "GM", dissolved: false });
  assert.match(nlAnswer(old, { place: "Testdorp", property_type: "any", now: NOW }).statistic!.note!, /latest figure CBS holds for Testdorp is for 2023; national figures run to 2025/);
});

test("nl-home-prices: no reading means no_matches, never a made-up number", () => {
  const a = nlAnswer(null, { place: "Testdorp", property_type: "any" });
  assert.equal(a.status, "no_matches");
  assert.equal(a.price, null);
  assert.equal(a.confidence, "insufficient");
  assert.match(a.summary, /CBS publishes no average sale price for Testdorp/);
});

test("nl-home-prices: a request is two CBS calls (region, then figures); the national average is one", async () => {
  const f = fake([F.REGIONS_GRAVENHAGE, F.DATA_GRAVENHAGE]);
  const a = await nlHomePrices({ town: "The Hague", baseUrl: "https://proofprice.com" }, { fetcher: f.fetcher, now: NOW });
  assert.equal(f.urls.length, 2);
  assert.equal(f.urls[0], regionLookupUrl("gravenhage"));
  assert.ok(f.urls[1].startsWith(`${ODATA_BASE}/TypedDataSet?$filter=`));
  assert.ok(decodeURIComponent(f.urls[1]).includes("RegioS eq 'GM0518' or RegioS eq 'NL01  '"));
  assert.ok(decodeURIComponent(f.urls[1]).includes("Perioden ge '2020JJ00'"));
  assert.equal(a.status, "ok");
  assert.deepEqual(a.query, { country: "NL", town: "'s-Gravenhage", property_type: "any" });
  assert.equal(a.price!.value, 465418);
  assert.match(a.summary, /^In 's-Gravenhage the average sale price of existing owner-occupied homes was €465,418 in 2025\. That is 4% higher than in 2024 \(€447,417\)\./);

  const g = fake([F.DATA_AMSTERDAM_NATIONAL]);
  const nat = await nlHomePrices({}, { fetcher: g.fetcher, now: NOW });
  assert.equal(g.urls.length, 1);
  assert.equal(nat.status, "ok");
  assert.equal(nat.price!.value, 479527);
  assert.match(nat.summary, /^In the Netherlands the average sale price/);
  assert.equal((nat.extra as any).region.level, "country");
  const h = fake([F.DATA_AMSTERDAM_NATIONAL]);
  assert.equal((await nlHomePrices({ town: "Netherlands" }, { fetcher: h.fetcher, now: NOW })).price!.value, 479527);
});

test("nl-home-prices: a home type CBS does not publish gets no_matches, not the all-homes figure", async () => {
  const f = fake([F.REGIONS_GRAVENHAGE]);
  const a = await nlHomePrices({ town: "Den Haag", property_type: "apartment" }, { fetcher: f.fetcher, now: NOW });
  assert.equal(f.urls.length, 1); // no figures fetched
  assert.equal(a.status, "no_matches");
  assert.equal(a.price, null);
  assert.match(a.summary, /not by home type, so there is no official figure for property_type 'apartment'/);
  const any = fake([F.DATA_AMSTERDAM_NATIONAL]);
  assert.equal((await nlHomePrices({ property_type: "any" }, { fetcher: any.fetcher, now: NOW })).status, "ok");
});

test("nl-home-prices: a postcode alone is refused with the reason", async () => {
  await assert.rejects(nlHomePrices({ postcode: "1011 AB" }, { fetcher: async () => ({}) }), (e: any) => e instanceof InputError && /not by postcode/.test(e.message));
});

// ---------- daily copy (checked live 2026-10-30: RegioS list and TypedDataSet rows have the shapes below) ----------
const REG_ALL = {
  value: [
    { Key: "NL01  ", Title: "Nederland", Description: "" },
    { Key: "PV27  ", Title: "Noord-Holland (PV)", Description: "" },
    { Key: "GM0363", Title: "Amsterdam", Description: "" },
    { Key: "GM0518", Title: "'s-Gravenhage (gemeente)", Description: "" },
    { Key: "GM0999", Title: "Oudgemeente", Description: "Opgeheven per 1 januari 2020" },
  ],
};
const VAL_ALL = {
  value: [
    { ID: 30, RegioS: "NL01  ", Perioden: "2025JJ00", GemiddeldeVerkoopprijs_1: 479527 },
    { ID: 31, RegioS: "NL01  ", Perioden: "2024JJ00", GemiddeldeVerkoopprijs_1: 450000 },
    { ID: 32, RegioS: "PV27  ", Perioden: "2025JJ00", GemiddeldeVerkoopprijs_1: 560000 },
    { ID: 33, RegioS: "GM0363", Perioden: "2025JJ00", GemiddeldeVerkoopprijs_1: 640000.4 },
    { ID: 34, RegioS: "GM0518", Perioden: "2025JJ00", GemiddeldeVerkoopprijs_1: 430000 },
    { ID: 35, RegioS: "GM0999", Perioden: "2025JJ00", GemiddeldeVerkoopprijs_1: 300000 },
  ],
};

test("nl harvest rows: newest year, current regions only, published figures with no count", () => {
  const { year, rows } = nlHarvestRows(parseRegions(REG_ALL), parseValues(VAL_ALL), 1);
  assert.equal(year, 2025);
  assert.deepEqual(rows.map((r) => r.area), ["NL01 Nederland", "PV27 Noord-Holland", "GM0363 Amsterdam", "GM0518 's-Gravenhage"]);
  assert.equal(rows[2].median, 640000);
  assert.ok(rows.every((r) => r.item === "any" && r.low === r.median && !(r.n >= 5)), "n is NO_COUNT, not a made-up count");
  assert.throws(() => nlHarvestRows(parseRegions(REG_ALL), parseValues(VAL_ALL)), /Only 4 Dutch regions/);
});

test("nl harvest: two requests, dated by the end of the year", async () => {
  const f = fake([REG_ALL, VAL_ALL]);
  const orig = nlHarvestRows;
  assert.ok(orig);
  await assert.rejects(nlHarvest({ fetcher: f.fetcher, now: NOW }), /Only 4 Dutch regions/);
  assert.match(f.urls[0], /RegioS\?\$select=Key,Title,Description/);
  assert.match(decodeURIComponent(f.urls[1]), /Perioden ge '2023JJ00'/);
});

test("nl history key: finds the stored area by name, alias, province and national; refuses postcode and home type", () => {
  const areas = ["NL01 Nederland", "PV27 Noord-Holland", "GM0363 Amsterdam", "GM0518 's-Gravenhage"];
  assert.equal(nlHistoryKey({ town: "Amsterdam" }, areas)?.area, "GM0363 Amsterdam");
  assert.equal(nlHistoryKey({ town: "Den Haag" }, areas)?.area, "GM0518 's-Gravenhage");
  assert.equal(nlHistoryKey({ town: "Noord-Holland" }, areas)?.area, "PV27 Noord-Holland");
  assert.equal(nlHistoryKey({}, areas)?.area, "NL01 Nederland");
  assert.equal(nlHistoryKey({ postcode: "1011" }, areas), null);
  assert.equal(nlHistoryKey({ town: "Amsterdam", property_type: "house" }, areas), null);
  assert.equal(nlHistoryKey({ town: "Atlantis" }, areas), null);
  assert.equal(nlHistoryKey({ town: "Amsterdam" }, []), null);
});

test("nl manifest: has a collector and key (stale-if-error) and no separate history tool entry", () => {
  const src = SOURCE_PLUGINS.find((s) => s.info.id === "nl-home-prices")!;
  assert.ok(src.harvest && src.historyKey && src.referenceDates);
  assert.match(String(src.noHistory), /one average per year/);
});
