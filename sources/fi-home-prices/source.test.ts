import { test } from "node:test";
import assert from "node:assert/strict";
import { parseJsonStat } from "../../lib/adapters";
import { InputError, SourceError } from "../../lib/http";
import { categoryById, paramSchemas, runCategory, SOURCE_PLUGINS } from "../../lib/registry";
import { confidenceLabel } from "../../lib/stats";
import {
  ageNote, buildQuery, changeSentence, classifyPostcodeTypes, finlandAnswer, finlandHomePrices, findVariable, fold, INFO, isoPeriod, normalisePostcode, normaliseType,
  periodWords, PLACES, readMeta, readPostcode, readQuarterly, readYearly, resolvePlace, roomsPhrase, STATFIN_API, unavailableAnswer, yearEarlier,
} from "./source";
import { FI_MUNICIPALITIES, FI_QUARTERLY_REGIONS } from "./places";
import { META_13MT, META_13MX, META_15IS } from "./fixtures";
import { POSTCODE_00100, POSTCODE_99990, QUARTERLY_CITIES, YEARLY_AKAA } from "./fixtures-data";

// Fixtures: real Statistics Finland PxWeb answers captured 2026-10-14 (see fixtures.ts and fixtures-data.ts).
const NOW = new Date("2026-10-14T12:00:00Z");
const U15 = `${STATFIN_API}/15is.px`;
const U13MT = `${STATFIN_API}/13mt.px`;
const U13MX = `${STATFIN_API}/13mx.px`;

const QV = { region: "alue_43_20260625", type: "talotyyppi_5_20111209", rooms: "huoneluku_1_20111212", time: "timeperiod_q", contents: "contentscode" };
const QC = { price: "ashivq_keskineliohinta", count: "ashivq_kauppamaara_vvero", qchange: "ashivq_indeksi_nmuutos_2025", ychange: "ashivq_indeksi_vmuutos_2025" };
const BC = { any: "0", terraced: "1", flat: "3" } as const;
const PV = { time: "timeperiod_q", postal: "postinumeroalue_4_20220101", type: "talotyyppi_6_20131021", contents: "contentscode" };
const PC = { price: "keskihinta_aritm_nw", count: "lkm_julk20" };
const YV = { time: "timeperiod_y", municipality: "kunta_1_20150101", type: "talotyyppi_5_20111209", contents: "contentscode" };

function rig(posts: Record<string, unknown>) {
  const log: Array<{ method: "GET" | "POST"; url: string; body?: any }> = [];
  const metas: Record<string, unknown> = { [U15]: META_15IS, [U13MT]: META_13MT, [U13MX]: META_13MX };
  return {
    log,
    fetcher: async (url: string) => {
      log.push({ method: "GET", url });
      if (url in metas) return metas[url];
      throw new SourceError(`unexpected GET ${url}`);
    },
    poster: async (url: string, body: unknown) => {
      log.push({ method: "POST", url, body });
      if (url in posts) return posts[url];
      throw new SourceError(`unexpected POST ${url}`);
    },
  };
}

test("fi-home-prices: licence, attribution and type are Statistics Finland's", () => {
  assert.equal(INFO.id, "fi-home-prices");
  assert.equal(INFO.price_type, "official_statistic");
  assert.equal(INFO.publisher, "Statistics Finland (Tilastokeskus)");
  assert.match(INFO.licence, /open data materials and public content of the web service are covered by the Creative Commons Attribution 4\.0 International licence/);
  assert.match(INFO.licence, /use the data for commercial purposes as well/);
  assert.equal(INFO.licence_url, "https://stat.fi/en/about-us/get-to-know-statistics-finland/legislation/terms-of-use");
  for (const k of ["Statistics Finland", "15is", "13mt", "13mx", "CC BY 4.0"]) assert.ok(INFO.attribution.includes(k), k);
  assert.match(INFO.limits, /should not be used to calculate price change/);
});

test("fi-home-prices: registered for FI on the home-sales tool, smoke test first, property types added", () => {
  const plugin = SOURCE_PLUGINS.find((s) => s.info.id === "fi-home-prices")!;
  assert.equal(plugin.category, "home-sales");
  assert.deepEqual(plugin.countries, ["FI"]);
  assert.deepEqual(plugin.examples[0].params, { country: "FI", town: "Helsinki" });
  assert.deepEqual(plugin.examples[1].params, { country: "FI", postcode: "00100", property_type: "flat" });
  const types = (paramSchemas(categoryById("home-sales")!).property_type as any).unwrap().options as string[];
  for (const t of ["any", "house", "detached", "terraced", "flat"]) assert.ok(types.includes(t), t);
});

test("fi-home-prices: the place lists are the real tables' lists", () => {
  const regions = findVariable(readMeta(META_15IS), /^alue_/, "region");
  assert.deepEqual(regions.values, FI_QUARTERLY_REGIONS.map(([c]) => c));
  assert.equal(regions.values.length, 87);
  const munis = findVariable(readMeta(META_13MX), /^kunta_/, "municipality");
  assert.deepEqual(munis.values, FI_MUNICIPALITIES.map(([c]) => c));
  assert.equal(munis.values.length, 301);
  // every city of the quarterly table is a municipality of the yearly table
  for (const [code] of FI_QUARTERLY_REGIONS) if (/^\d{3}$/.test(code)) assert.ok(munis.values.includes(code), code);
  assert.equal(PLACES.filter((p) => p.level === "municipality").length, 301);
  assert.equal(PLACES.filter((p) => p.level === "region").length, 18); // the 18 mainland regions (the table has no Åland)
});

test("fi-home-prices: variable codes are found by their stem in the real metadata (they carry dates)", () => {
  const m15 = readMeta(META_15IS);
  assert.equal(findVariable(m15, /^alue_/, "region").code, "alue_43_20260625");
  assert.equal(findVariable(m15, /^talotyyppi_/, "building type").code, "talotyyppi_5_20111209");
  assert.equal(findVariable(m15, /^huoneluku_/, "rooms").code, "huoneluku_1_20111212");
  assert.equal(findVariable(m15, /^timeperiod_/, "time").code, "timeperiod_q");
  const contents = findVariable(m15, /^contentscode$/, "information").values;
  for (const c of Object.values(QC)) assert.ok(contents.includes(c), c);
  const m13 = readMeta(META_13MT);
  assert.equal(findVariable(m13, /^postinumeroalue_/, "postal code").code, "postinumeroalue_4_20220101");
  assert.equal(findVariable(m13, /^postinumeroalue_/, "postal code").values.length, 1724);
  assert.deepEqual(classifyPostcodeTypes(m13), { flats: ["1", "2", "3"], terraced: ["5"] });
  assert.equal(findVariable(readMeta(META_13MX), /^kunta_/, "municipality").code, "kunta_1_20150101");
  assert.throws(() => findVariable(m15, /^nonesuch_/, "nonesuch"), (e: any) => e instanceof SourceError && /has changed this table/.test(e.message));
  assert.throws(() => readMeta({ hello: 1 }), SourceError);
});

test("fi-home-prices: names are matched without diacritics, in Swedish and English; the table that holds the place is chosen", () => {
  assert.equal(fold("Hämeenlinna"), "hameenlinna");
  assert.deepEqual([resolvePlace("Helsinki").quarterly, resolvePlace("Helsinki").municipality], ["091", "091"]);
  assert.equal(resolvePlace("Helsingfors").quarterly, "091");
  assert.equal(resolvePlace("Hameenlinna").quarterly, "109");
  assert.equal(resolvePlace("Hämeenlinna").quarterly, "109");
  assert.equal(resolvePlace("Åbo").short, "Turku");
  assert.equal(resolvePlace("Tammerfors").short, "Tampere");
  assert.equal(resolvePlace("Uleåborg").short, "Oulu");
  assert.equal(resolvePlace("Oulu kaupunki").short, "Oulu");
  const espoo = resolvePlace("Espoo");
  assert.deepEqual([espoo.quarterly, espoo.municipality], ["049", "049"]); // the quarterly table holds Espoo and Kauniainen together
  assert.equal(resolvePlace("Esbo").short, "Espoo");
  const kauniainen = resolvePlace("Kauniainen");
  assert.deepEqual([kauniainen.quarterly, kauniainen.municipality], [null, "235"]);
  assert.equal(resolvePlace("Grankulla").short, "Kauniainen");
  const akaa = resolvePlace("Akaa");
  assert.deepEqual([akaa.quarterly, akaa.municipality], [null, "020"]);
  assert.deepEqual([resolvePlace("Uusimaa").level, resolvePlace("Uusimaa").quarterly], ["region", "MK01"]);
  assert.equal(resolvePlace("Nyland").quarterly, "MK01");
  assert.equal(resolvePlace("Lapland").quarterly, "MK19");
  assert.equal(resolvePlace("Lappi").quarterly, "MK19");
  assert.equal(resolvePlace("Pohjois-Pohjanmaa").quarterly, "MK17");
  assert.equal(resolvePlace("Keski-Suomi").quarterly, "MK13");
  assert.equal(resolvePlace("Päijät-Häme").quarterly, "MK07");
  assert.deepEqual([resolvePlace("Greater Helsinki").level, resolvePlace("Greater Helsinki").quarterly], ["area", "pks"]);
  assert.equal(resolvePlace("Capital region").quarterly, "pks");
  for (const t of [undefined, "", "Finland", "Suomi"]) assert.deepEqual([resolvePlace(t).level, resolvePlace(t).quarterly], ["country", "SSS"]);
  assert.throws(() => resolvePlace("Atlantis"), (e: any) => e instanceof InputError && /no place called "Atlantis"/.test(e.message));
  assert.throws(() => resolvePlace("Helsinki 1"), InputError);
});

test("fi-home-prices: property types: flat, terraced, any by default; house and detached are known but not covered", () => {
  assert.equal(normaliseType(undefined), "any");
  assert.equal(normaliseType("flat"), "flat");
  assert.equal(normaliseType("Kerrostalo"), "flat");
  assert.equal(normaliseType("apartment"), "flat");
  assert.equal(normaliseType("terraced"), "terraced");
  assert.equal(normaliseType("Rivitalo"), "terraced");
  assert.equal(normaliseType("house"), "house");
  assert.equal(normaliseType("omakotitalo"), "house");
  assert.equal(normaliseType("detached"), "detached");
  assert.throws(() => normaliseType("castle"), (e: any) => e instanceof InputError && /must be one of/.test(e.message));
});

test("fi-home-prices: a postcode is five digits", () => {
  assert.equal(normalisePostcode(undefined), null);
  assert.equal(normalisePostcode(""), null);
  assert.equal(normalisePostcode("00100"), "00100");
  assert.equal(normalisePostcode(" FI-00100 "), "00100");
  assert.throws(() => normalisePostcode("1234"), (e: any) => e instanceof InputError && /five digits/.test(e.message));
  assert.throws(() => normalisePostcode("SW1A 1AA"), InputError);
});

test("fi-home-prices: periods and the old-figure caveat", () => {
  assert.equal(isoPeriod("2026Q2"), "2026-Q2");
  assert.equal(isoPeriod("2026Q2*"), "2026-Q2");
  assert.equal(isoPeriod("2025"), "2025");
  assert.equal(yearEarlier("2026-Q2"), "2025-Q2");
  assert.equal(periodWords("2026-Q2"), "the second quarter of 2026");
  assert.equal(ageNote("2026-06-30", NOW), null);
  assert.match(ageNote("2024-12-31", NOW)!, /old: its period ended about 22 months ago/);
  assert.equal(
    changeSentence({ previous: { reference_period: "2026-Q1", change_percent: 0 }, year_earlier: { reference_period: "2025-Q2", change_percent: 2.5 } }),
    " Statistics Finland's price index for these dwellings (a quality-adjusted measure, not this average) is unchanged from the first quarter of 2026 and 2.5% higher than a year earlier (the second quarter of 2025).",
  );
  assert.equal(changeSentence(null), "");
  assert.equal(roomsPhrase("Blocks of flats, two-room flat"), "two-room flats");
  assert.equal(roomsPhrase("Blocks of flats, three-room flat+"), "flats with three or more rooms");
  assert.equal(roomsPhrase("Terraced houses total"), "terraced houses");
});

test("fi-home-prices: the POST body is an item selection with json-stat2", () => {
  assert.deepEqual(buildQuery([["a", ["1", "2"]], ["b", ["x"]]]), {
    query: [{ code: "a", selection: { filter: "item", values: ["1", "2"] } }, { code: "b", selection: { filter: "item", values: ["x"] } }],
    response: { format: "json-stat2" },
  });
});

test("fi-home-prices: the real answers are complete JSON-stat 2.0 cubes", () => {
  const q = parseJsonStat(QUARTERLY_CITIES);
  assert.deepEqual(q.sizes, [3, 3, 1, 6, 4]);
  assert.equal(QUARTERLY_CITIES.value.length, 216);
  assert.equal(parseJsonStat(POSTCODE_00100).rows.length, 30); // 40 cells, 10 confidential
  assert.equal(parseJsonStat(POSTCODE_99990).rows.length, 0);
  assert.equal(parseJsonStat(YEARLY_AKAA).rows.length, 18);
});

test("fi-home-prices: reads Helsinki from table 15is: price, transactions, provisional, the official index changes, the country and every building type", () => {
  const t = parseJsonStat(QUARTERLY_CITIES);
  const f = readQuarterly(t, QV, QC, { region: "091", building: "any", buildingCodes: BC })!;
  assert.equal(f.mode, "quarterly");
  assert.equal(f.reference_period, "2026-Q2");
  assert.equal(f.provisional, true);
  assert.equal(f.price, 4916);
  assert.equal(f.sales, 1986);
  assert.equal(f.areaLabel, "Helsinki");
  assert.deepEqual(f.index_change, { previous: { reference_period: "2026-Q1", change_percent: -0.3 }, year_earlier: { reference_period: "2025-Q2", change_percent: -4.3 } });
  assert.deepEqual(f.national, { price: 2465, sales: 14392 });
  assert.deepEqual(f.groups.map((g) => [g.key, g.price, g.sales]), [["any", 4916, 1986], ["terraced", 3708, 223], ["flat", 5112, 1763]]);
  assert.equal(f.olderThanTable, false);
  assert.equal(f.latestInTable, "2026-Q2");
  const flat = readQuarterly(t, QV, QC, { region: "091", building: "flat", buildingCodes: BC })!;
  assert.deepEqual([flat.price, flat.sales, flat.groupLabel], [5112, 1763, "blocks of flats"]);
  assert.equal(flat.index_change!.previous!.change_percent, -0.1);
  assert.equal(flat.index_change!.year_earlier!.change_percent, -4.5);
  assert.deepEqual(flat.national, { price: 2693, sales: 8251 });
  const terraced = readQuarterly(t, QV, QC, { region: "091", building: "terraced", buildingCodes: BC })!;
  assert.deepEqual([terraced.price, terraced.sales], [3708, 223]);
  assert.equal(terraced.index_change!.year_earlier!.change_percent, -2.8);
  // the whole country has no national comparison
  const fi = readQuarterly(t, QV, QC, { region: "SSS", building: "any", buildingCodes: BC })!;
  assert.deepEqual([fi.price, fi.sales, fi.national], [2465, 14392, null]);
  assert.equal(fi.areaLabel, "WHOLE COUNTRY");
});

test("fi-home-prices: a withheld latest price falls back to the newest quarter that has one (Kajaani terraced houses)", () => {
  const t = parseJsonStat(QUARTERLY_CITIES);
  const f = readQuarterly(t, QV, QC, { region: "205", building: "terraced", buildingCodes: BC })!;
  assert.equal(f.reference_period, "2025-Q4");
  assert.equal(f.provisional, false);
  assert.deepEqual([f.price, f.sales], [1337, 30]);
  assert.deepEqual(f.index_change, { previous: { reference_period: "2025-Q3", change_percent: 12.5 }, year_earlier: null });
  assert.equal(f.olderThanTable, true);
  const a = finlandAnswer(f, { place: resolvePlace("Kajaani"), type: "terraced", now: NOW });
  assert.equal(a.status, "ok");
  assert.match(a.statistic!.note!, /newest period in the table is the second quarter of 2026, but Statistics Finland has no usable price for Kajaani then/);
  assert.doesNotMatch(a.summary, /provisional/);
});

test("fi-home-prices: reads postal code 00100 from table 13mt: the room size with most transactions leads, the others are listed, confidential cells are absent", () => {
  const t = parseJsonStat(POSTCODE_00100);
  const any = readPostcode(t, PV, PC, { postcode: "00100", codes: ["1", "2", "3", "5"] }) as any;
  assert.equal(any.mode, "postcode");
  assert.equal(any.reference_period, "2026-Q1");
  assert.equal(any.provisional, true);
  assert.deepEqual([any.price, any.sales, any.groupLabel], [7167, 35, "Blocks of flats, two-room flat"]);
  assert.equal(any.areaLabel, "00100 Helsinki keskusta - Etu-Töölö (Helsinki)");
  assert.deepEqual(any.groups.map((g: any) => [g.key, g.price, g.sales]), [["1", 7735, 21], ["2", 7167, 35], ["3", 6533, 19]]);
  assert.equal(any.index_change, null);
  const terraced = readPostcode(t, PV, PC, { postcode: "00100", codes: ["5"] });
  assert.equal(terraced, null); // confidential in every quarter
  assert.equal(readPostcode(parseJsonStat(POSTCODE_99990), PV, PC, { postcode: "99990", codes: ["1", "2", "3", "5"] }), null);
});

test("fi-home-prices: a postal code with prices from fewer than 5 transactions everywhere never gives a figure", () => {
  const thin = JSON.parse(JSON.stringify(POSTCODE_00100));
  for (let i = 1; i < thin.value.length; i += 2) if (thin.value[i] !== null) thin.value[i] = 3; // every count becomes 3
  const r = readPostcode(parseJsonStat(thin), PV, PC, { postcode: "00100", codes: ["1", "2", "3"] }) as any;
  assert.deepEqual(r.insufficient.sales, 3);
  const a = finlandAnswer(r, { place: null, postcode: "00100", type: "flat", now: NOW });
  assert.equal(a.status, "insufficient_data");
  assert.equal(a.price, null);
  assert.match(a.summary, /reports only 3 transaction\(s\)/);
  // one quarter thin, an earlier one fine: the earlier quarter is used and said so
  const mixed = JSON.parse(JSON.stringify(POSTCODE_00100));
  for (const i of [33, 35, 37]) mixed.value[i] = 2; // 2026Q1 counts of the three flat sizes
  const m = readPostcode(parseJsonStat(mixed), PV, PC, { postcode: "00100", codes: ["1", "2", "3"] }) as any;
  assert.equal(m.reference_period, "2025-Q4");
  assert.equal(m.olderThanTable, true);
  assert.deepEqual([m.price, m.sales], [7561, 62]);
});

test("fi-home-prices: reads Akaa from the yearly table 13mx", () => {
  const t = parseJsonStat(YEARLY_AKAA);
  const f = readYearly(t, YV, PC, { municipality: "020", building: "any", buildingCodes: BC })!;
  assert.deepEqual([f.mode, f.reference_period, f.provisional, f.price, f.sales, f.areaLabel], ["yearly", "2025", false, 1243, 153, "Akaa"]);
  assert.deepEqual(f.groups.map((g) => [g.key, g.price, g.sales]), [["any", 1243, 153], ["terraced", 1289, 67], ["flat", 1194, 86]]);
  assert.equal(f.index_change, null);
  const flat = readYearly(t, YV, PC, { municipality: "020", building: "flat", buildingCodes: BC })!;
  assert.deepEqual([flat.price, flat.sales], [1194, 86]);
});

test("fi-home-prices: the quarterly answer is an official average with its quarter, transactions, provisional flag, the official index changes, source and licence", () => {
  const place = resolvePlace("Helsinki");
  const f = readQuarterly(parseJsonStat(QUARTERLY_CITIES), QV, QC, { region: "091", building: "any", buildingCodes: BC });
  const a = finlandAnswer(f, { place, type: "any", now: NOW, baseUrl: "https://proofprice.com" });
  assert.equal(a.status, "ok");
  assert.deepEqual(a.price, { currency: "EUR", unit: "per m²", value: 4916, measure: "average", median: null, typical_low: null, typical_high: null, min: null, max: null });
  assert.equal(a.sample_size, 1986);
  assert.equal(a.confidence, confidenceLabel(1986));
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.statistic!.measure, "average");
  assert.equal(a.statistic!.reference_period, "2026-Q2");
  assert.deepEqual(a.period, { from: "2026-04-01", to: "2026-06-30" });
  assert.equal(a.source.licence_url, "https://stat.fi/en/about-us/get-to-know-statistics-finland/legislation/terms-of-use");
  assert.match(a.summary, /In Helsinki the average price per m² of old dwellings in housing companies \(all building types\) was €4,916 in the second quarter of 2026 \(provisional\), from 1,986 transactions\./);
  assert.match(a.summary, /price index for these dwellings \(a quality-adjusted measure, not this average\) is 0\.3% lower than in the first quarter of 2026 and 4\.3% lower than a year earlier \(the second quarter of 2025\)\./);
  assert.match(a.summary, /Official average published by Statistics Finland \(Tilastokeskus\) for 2026-Q2\./);
  assert.match(a.statistic!.note!, /Provisional: Statistics Finland marks the newest periods with \*/);
  assert.match(a.statistic!.note!, /shows the price level, not price change/);
  const x = a.extra as any;
  assert.equal(x.provisional, true);
  assert.equal(x.table, "15is");
  assert.deepEqual(x.price_index_change.previous, { reference_period: "2026-Q1", change_percent: -0.3 });
  assert.equal(x.national_average.price_per_m2, 2465);
  assert.deepEqual(x.groups.map((g: any) => g.label), ["all building types", "terraced houses", "blocks of flats"]);
});

test("fi-home-prices: the postal code answer says which room size it is and lists the others", () => {
  const f = readPostcode(parseJsonStat(POSTCODE_00100), PV, PC, { postcode: "00100", codes: ["1", "2", "3", "5"] });
  const a = finlandAnswer(f, { place: null, postcode: "00100", type: "flat", now: NOW });
  assert.equal(a.status, "ok");
  assert.equal(a.price!.value, 7167);
  assert.equal(a.price!.unit, "per m²");
  assert.equal(a.sample_size, 35);
  assert.deepEqual(a.query, { country: "FI", postcode: "00100", property_type: "flat" });
  assert.match(a.summary, /In postal code area 00100 Helsinki keskusta - Etu-Töölö \(Helsinki\) the average price per m² of two-room flats in blocks of flats was €7,167 in the first quarter of 2026 \(provisional\), from 35 transactions\./);
  assert.match(a.summary, /Other sizes: one-room flats €7,735 \(21 transactions\); flats with three or more rooms €6,533 \(19 transactions\)\./);
  assert.doesNotMatch(a.summary, /price index/); // no change figure exists for postal codes
  assert.match(a.statistic!.note!, /by number of rooms, with no total/);
  assert.match(a.statistic!.note!, /runs one period behind the city table/);
  assert.equal((a.extra as any).groups.length, 3);
  assert.equal((a.extra as any).price_index_change, undefined);
});

test("fi-home-prices: the yearly answer for a municipality says it is yearly and carries no change figure", () => {
  const place = resolvePlace("Akaa");
  const f = readYearly(parseJsonStat(YEARLY_AKAA), YV, PC, { municipality: "020", building: "any", buildingCodes: BC });
  const a = finlandAnswer(f, { place, type: "any", now: NOW });
  assert.equal(a.status, "ok");
  assert.equal(a.price!.value, 1243);
  assert.deepEqual(a.period, { from: "2025-01-01", to: "2025-12-31" });
  assert.match(a.summary, /In Akaa the average price per m² of old dwellings in housing companies \(all building types\) was €1,243 in 2025, from 153 transactions\./);
  assert.doesNotMatch(a.summary, /provisional|price index/);
  assert.match(a.statistic!.note!, /quarterly figures only for the whole country, regions and larger cities; for Akaa the yearly municipality figure is used/);
});

test("fi-home-prices: fewer than 5 transactions behind an average never gives a figure; nothing at all is a clear no_matches", () => {
  const f = readYearly(parseJsonStat(YEARLY_AKAA), YV, PC, { municipality: "020", building: "any", buildingCodes: BC })!;
  const a = finlandAnswer({ ...f, sales: 4 }, { place: resolvePlace("Akaa"), type: "any", now: NOW });
  assert.equal(a.status, "insufficient_data");
  assert.equal(a.price, null);
  assert.match(a.summary, /reports only 4 transaction\(s\)/);
  const none = finlandAnswer(null, { place: null, postcode: "99990", type: "any" });
  assert.equal(none.status, "no_matches");
  assert.match(none.summary, /publishes no price per m² of old dwellings in housing companies for postal code 99990/);
});

test("fi-home-prices: house and detached are explained, not guessed", () => {
  const un = unavailableAnswer("detached", { place: resolvePlace("Helsinki") });
  assert.equal(un.status, "no_matches");
  assert.match(un.summary, /cover old dwellings in housing companies \(flats in blocks of flats and terraced houses\)/);
  assert.equal(un.price_type, "official_statistic");
});

test("fi-home-prices: end to end, Helsinki: one metadata GET, one POST built from the real variable codes", async () => {
  const r = rig({ [U15]: QUARTERLY_CITIES });
  const a = await finlandHomePrices({ town: "Helsinki" }, { fetcher: r.fetcher, poster: r.poster, now: NOW });
  assert.deepEqual(r.log.map((l) => [l.method, l.url]), [["GET", U15], ["POST", U15]]);
  const body = r.log[1].body;
  assert.deepEqual(body.response, { format: "json-stat2" });
  assert.deepEqual(body.query.map((q: any) => [q.code, q.selection.values]), [
    ["alue_43_20260625", ["091", "SSS"]],
    ["talotyyppi_5_20111209", ["0", "1", "3"]],
    ["huoneluku_1_20111212", ["00"]],
    ["timeperiod_q", ["2025Q1", "2025Q2", "2025Q3", "2025Q4", "2026Q1", "2026Q2"]],
    ["contentscode", ["ashivq_keskineliohinta", "ashivq_kauppamaara_vvero", "ashivq_indeksi_nmuutos_2025", "ashivq_indeksi_vmuutos_2025"]],
  ]);
  assert.equal(a.status, "ok");
  assert.equal(a.price!.value, 4916);
  assert.equal(a.source.id, "fi-home-prices");
  assert.equal((a.extra as any).statfin_api.method, "POST");
  const flat = await finlandHomePrices({ town: "Helsinki", property_type: "flat" }, { fetcher: r.fetcher, poster: r.poster, now: NOW });
  assert.equal(flat.price!.value, 5112);
  const country = await finlandHomePrices({}, { fetcher: r.fetcher, poster: r.poster, now: NOW });
  assert.equal(country.price!.value, 2465);
  assert.deepEqual(r.log[r.log.length - 1].body.query[0].selection.values, ["SSS"]);
});

test("fi-home-prices: end to end, a postcode uses table 13mt and the metadata to check the postcode and the codes", async () => {
  const r = rig({ [U13MT]: POSTCODE_00100 });
  const a = await finlandHomePrices({ postcode: "00100", property_type: "flat" }, { fetcher: r.fetcher, poster: r.poster, now: NOW });
  assert.deepEqual(r.log.map((l) => [l.method, l.url]), [["GET", U13MT], ["POST", U13MT]]);
  const q = r.log[1].body.query as Array<{ code: string; selection: { values: string[] } }>;
  assert.deepEqual(q.map((x) => x.code), ["timeperiod_q", "postinumeroalue_4_20220101", "talotyyppi_6_20131021", "contentscode"]);
  assert.deepEqual(q[0].selection.values, ["2025Q1", "2025Q2", "2025Q3", "2025Q4", "2026Q1"]);
  assert.deepEqual(q[1].selection.values, ["00100"]);
  assert.deepEqual(q[2].selection.values, ["1", "2", "3"]);
  assert.deepEqual(q[3].selection.values, ["keskihinta_aritm_nw", "lkm_julk20"]);
  assert.equal(a.price!.value, 7167);
  // an unknown postcode is answered from the metadata alone
  const known = new Set(findVariable(readMeta(META_13MT), /^postinumeroalue_/, "postal code").values);
  const unknown = Array.from({ length: 99999 }, (_, i) => String(i).padStart(5, "0")).find((p) => !known.has(p))!;
  const r2 = rig({});
  const u = await finlandHomePrices({ postcode: unknown }, { fetcher: r2.fetcher, poster: r2.poster, now: NOW });
  assert.deepEqual(r2.log.map((l) => l.method), ["GET"]);
  assert.equal(u.status, "no_matches");
  assert.match(u.summary, new RegExp(`no area with the postcode ${unknown}`));
  // a town given with a postcode is ignored and said so
  const r3 = rig({ [U13MT]: POSTCODE_00100 });
  const t = await finlandHomePrices({ town: "Tampere", postcode: "00100" }, { fetcher: r3.fetcher, poster: r3.poster, now: NOW });
  assert.match(t.statistic!.note!, /The town "Tampere" was ignored: the postcode 00100 is more precise\./);
});

test("fi-home-prices: end to end, a municipality outside the quarterly table uses the yearly table 13mx", async () => {
  const r = rig({ [U13MX]: YEARLY_AKAA });
  const a = await finlandHomePrices({ town: "Akaa" }, { fetcher: r.fetcher, poster: r.poster, now: NOW });
  assert.deepEqual(r.log.map((l) => [l.method, l.url]), [["GET", U13MX], ["POST", U13MX]]);
  assert.deepEqual(r.log[1].body.query.map((q: any) => [q.code, q.selection.values]), [
    ["timeperiod_y", ["2023", "2024", "2025"]],
    ["kunta_1_20150101", ["020"]],
    ["talotyyppi_5_20111209", ["0", "1", "3"]],
    ["contentscode", ["keskihinta_aritm_nw", "lkm_julk20"]],
  ]);
  assert.equal(a.price!.value, 1243);
  // Kauniainen has no quarterly figure either; Espoo is asked in the quarterly table under its combined code
  const k = rig({ [U13MX]: YEARLY_AKAA });
  await finlandHomePrices({ town: "Kauniainen" }, { fetcher: k.fetcher, poster: k.poster, now: NOW });
  assert.equal(k.log[0].url, U13MX);
  const e = rig({ [U15]: QUARTERLY_CITIES });
  await finlandHomePrices({ town: "Espoo" }, { fetcher: e.fetcher, poster: e.poster, now: NOW });
  assert.deepEqual(e.log[1].body.query[0].selection.values, ["049", "SSS"]);
});

test("fi-home-prices: house and detached need no request; a bad postcode is an input error; a failing source is a SourceError; a changed table is named", async () => {
  const r = rig({});
  const u = await finlandHomePrices({ town: "Helsinki", property_type: "house" }, { fetcher: r.fetcher, poster: r.poster });
  assert.equal(r.log.length, 0);
  assert.equal(u.status, "no_matches");
  await assert.rejects(finlandHomePrices({ postcode: "123" }, { fetcher: r.fetcher, poster: r.poster }), InputError);
  await assert.rejects(finlandHomePrices({ town: "Helsinki" }, { fetcher: async () => { throw new SourceError("Source returned HTTP 503"); }, poster: r.poster }), SourceError);
  const changed = { ...META_15IS, variables: META_15IS.variables.filter((v: any) => !/^huoneluku_/.test(v.code)) };
  await assert.rejects(
    finlandHomePrices({ town: "Helsinki" }, { fetcher: async () => changed, poster: r.poster }),
    (e: any) => e instanceof SourceError && /has changed this table: no number of rooms variable/.test(e.message),
  );
});

test("fi-home-prices: routed by country through the shared home-sales tool (network stubbed, GET and POST)", async () => {
  const realFetch = globalThis.fetch;
  const seen: string[] = [];
  globalThis.fetch = (async (url: any, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    seen.push(`${method} ${String(url)}`);
    const body = method === "POST" ? QUARTERLY_CITIES : META_15IS;
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json; charset=utf-8" } });
  }) as typeof fetch;
  try {
    const a = await runCategory(categoryById("home-sales")!, { country: "fi", town: "Helsinki" });
    assert.equal(a.status, "ok");
    assert.equal(a.source.id, "fi-home-prices");
    assert.equal(a.price!.value, 4916);
    assert.deepEqual(seen, [`GET ${U15}`, `POST ${U15}`]);
  } finally {
    globalThis.fetch = realFetch;
  }
});
