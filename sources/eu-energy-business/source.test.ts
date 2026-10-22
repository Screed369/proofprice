import { test } from "node:test";
import assert from "node:assert/strict";
import { parseJsonStat } from "../../lib/adapters";
import { InputError, SourceError } from "../../lib/http";
import { categoryById, countriesFor, findSource, paramSchemas, pickSource, runCategory, SOURCE_PLUGINS } from "../../lib/registry";
import { BUSINESS_COUNTRIES, normaliseSector } from "../../categories/energy/business";
import {
  businessAnswer, businessCurrency, businessFilters, COUNTRIES, DATASETS, euBusinessEnergy, INFO, normaliseBusinessBand, readBusinessEnergy,
} from "./source";
import * as F from "./fixtures";

// Fixtures: real Eurostat responses captured 2026-10-21 (see fixtures.ts).
const IC = normaliseBusinessBand("electricity");
const I3 = normaliseBusinessBand("gas");
const ie = () => parseJsonStat(F.IE_ELECTRICITY);
const de = () => parseJsonStat(F.DE_GAS);

const EUROSTAT = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data";
const IE_URL = `${EUROSTAT}/nrg_pc_205?format=JSON&lang=EN&geo=IE&unit=KWH&currency=EUR&currency=NAC&tax=I_TAX&tax=X_VAT&tax=X_TAX&lastTimePeriod=4`;

function fakeEurostat(body: unknown) {
  const urls: string[] = [];
  return { urls, fetcher: async (url: string) => (urls.push(url), body) };
}

test("eu-energy-business: licence, attribution and type are Eurostat's, with the commercial-reuse limit", () => {
  assert.equal(INFO.id, "eu-energy-business");
  assert.equal(INFO.price_type, "official_statistic");
  assert.equal(INFO.publisher, "Eurostat (European Commission)");
  assert.match(INFO.licence, /commercial or non-commercial purposes is authorised provided the source is acknowledged/);
  assert.match(INFO.licence, /EU Member States, EFTA Member States and official EU acceding and candidate countries/);
  assert.equal(INFO.licence_url, "https://ec.europa.eu/eurostat/help/copyright-notice");
  for (const k of ["Eurostat", "nrg_pc_205", "nrg_pc_203"]) assert.ok(INFO.attribution.includes(k), k);
  assert.match(INFO.limits, /not a quote, tariff or offer/);
});

test("eu-energy-business: only EU, EFTA (with data) and candidate countries; nobody else (commercial reuse)", () => {
  const codes = Object.keys(COUNTRIES);
  for (const c of ["GR", "IE", "DE", "FR", "ES", "IT", "NO", "IS", "UA", "RS", "TR"]) assert.ok(codes.includes(c), c);
  for (const c of ["GB", "UK", "EL", "CH", "US", "JP", "CN", "BR", "XK", "LI"]) assert.ok(!codes.includes(c), c);
  assert.equal(codes.length, 38); // 27 member states + NO, IS + 9 candidate countries
  const plugin = SOURCE_PLUGINS.find((s) => s.info.id === "eu-energy-business")!;
  assert.equal(plugin.category, "energy");
  assert.deepEqual(plugin.examples.map((e) => e.params), [{ country: "IE", sector: "business", energy: "electricity" }, { country: "DE", sector: "business", energy: "gas" }]);
  assert.ok(plugin.placeName.endsWith("(business)"));
  for (const c of codes) assert.ok(BUSINESS_COUNTRIES.includes(c), c);
  assert.ok(BUSINESS_COUNTRIES.includes("GB") && BUSINESS_COUNTRIES.includes("US"));
});

test("eu-energy-business: bands are the Eurostat IA-IG and I1-I6 bands, defaults IC and I3", () => {
  assert.equal(IC.code, "MWH500-1999");
  assert.equal(I3.code, "GJ10000-99999");
  assert.deepEqual(DATASETS.electricity.bands.map((b) => b.letter), ["ALL", "IA", "IB", "IC", "ID", "IE", "IF", "IG"]);
  assert.deepEqual(DATASETS.gas.bands.map((b) => b.letter), ["I1", "I2", "I3", "I4", "I5", "I6"]);
  assert.equal(DATASETS.electricity.code, "nrg_pc_205");
  assert.equal(DATASETS.gas.code, "nrg_pc_203");
  assert.equal(normaliseBusinessBand("electricity", "id").code, "MWH2000-19999");
  assert.equal(normaliseBusinessBand("electricity", "mwh_lt20").letter, "IA");
  assert.equal(normaliseBusinessBand("electricity", "all").code, "TOT_KWH");
  assert.equal(normaliseBusinessBand("gas", "I6").code, "GJ_GE4000000");
  assert.throws(() => normaliseBusinessBand("gas", "all"), (e: any) => e instanceof InputError && /I1 \(GJ_LT1000\)/.test(e.message)); // Eurostat has no all-bands gas total
  assert.throws(() => normaliseBusinessBand("gas", "DC"), InputError); // a household band
  assert.throws(() => normaliseBusinessBand("electricity", "I3"), InputError);
});

test("eu-energy-business: the Eurostat request is one slice, with GR sent as EL; candidate currencies", () => {
  assert.deepEqual(businessFilters("IE"), { geo: "IE", unit: "KWH", currency: ["EUR", "NAC"], tax: ["I_TAX", "X_VAT", "X_TAX"] });
  assert.equal(businessFilters("GR").geo, "EL");
  assert.equal(businessCurrency("RS", "2026-S1"), "RSD");
  assert.equal(businessCurrency("TR", "2026-S1"), "TRY");
  assert.equal(businessCurrency("SE", "2026-S1"), "SEK");
  assert.equal(businessCurrency("DE", "2026-S1"), "EUR");
});

test("eu-energy-business: reads Ireland business electricity from the real cube (band IC, tax levels, bands, change)", () => {
  const r = readBusinessEnergy(ie(), { country: "IE", energy: "electricity", band: IC, taxes: "excl_vat" })!;
  assert.equal(r.reference_period, "2026-S1");
  assert.equal(r.value, 0.2666);
  assert.deepEqual(r.priceByTaxLevel, { all: 0.2902, excl_vat: 0.2666, none: 0.2636 });
  assert.equal(r.national, null);
  assert.deepEqual(r.previous, { reference_period: "2025-S2", value: 0.2552, change_percent: 4.5 });
  assert.deepEqual(r.allBands.map((b) => [b.band, b.value]), [["ALL", 0.239], ["IA", 0.3557], ["IB", 0.3071], ["IC", 0.2666], ["ID", 0.2284], ["IE", 0.206], ["IF", 0.1799], ["IG", 0.1654]]);
  assert.equal(r.datasetTitle, "Electricity prices for non-household consumers - bi-annual data");
  assert.equal(readBusinessEnergy(ie(), { country: "IE", energy: "electricity", band: IC, taxes: "all" })!.value, 0.2902);
  assert.equal(readBusinessEnergy(ie(), { country: "IE", energy: "electricity", band: IC, taxes: "none" })!.value, 0.2636);
  assert.equal(readBusinessEnergy(ie(), { country: "IE", energy: "electricity", band: normaliseBusinessBand("electricity", "IA"), taxes: "excl_vat" })!.value, 0.3557);
  assert.equal(readBusinessEnergy(ie(), { country: "FR", energy: "electricity", band: IC, taxes: "excl_vat" }), null); // the cube holds Irish prices only
});

test("eu-energy-business: reads Germany business gas in kWh (the GJ rows of the same cube are ignored)", () => {
  const t = de();
  assert.ok(t.rows.some((r) => r.unit === "GJ_GCV"), "fixture has per-GJ rows too");
  const r = readBusinessEnergy(t, { country: "DE", energy: "gas", band: I3, taxes: "excl_vat" })!;
  assert.equal(r.value, 0.0682);
  assert.equal(r.reference_period, "2026-S1");
  assert.deepEqual(r.priceByTaxLevel, { all: 0.0824, excl_vat: 0.0682, none: 0.0529 });
  assert.deepEqual(r.previous, { reference_period: "2025-S2", value: 0.0713, change_percent: -4.3 });
  assert.deepEqual(r.allBands.map((b) => [b.band, b.value]), [["I1", 0.0915], ["I2", 0.0811], ["I3", 0.0682], ["I4", 0.0544], ["I5", 0.0458], ["I6", 0.0461]]);
});

test("eu-energy-business: the answer is an official average with no invented range, and says business + band in the summary", () => {
  const q = { country: "IE", energy: "electricity" as const, band: IC, taxes: "excl_vat" as const, baseUrl: "https://proofprice.com", apiUrl: IE_URL };
  const a = businessAnswer(readBusinessEnergy(ie(), q), q);
  assert.equal(a.status, "ok");
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.price!.measure, "average");
  assert.equal(a.price!.value, 0.2666);
  assert.equal(a.price!.currency, "EUR");
  assert.equal(a.price!.unit, "per kWh");
  assert.equal(a.price!.median, null);
  assert.equal(a.price!.typical_low, null);
  assert.equal(a.price!.typical_high, null);
  assert.equal(a.sample_size, null);
  assert.deepEqual(a.period, { from: "2026-01-01", to: "2026-06-30" });
  assert.equal(a.statistic!.reference_period, "2026-S1");
  assert.match(a.summary, /official average price paid by businesses/);
  assert.match(a.summary, /band IC \(500 to 1,999 MWh a year\)/);
  assert.match(a.summary, /€0\.2666 per kWh/);
  assert.match(a.summary, /excluding VAT/);
  assert.match(a.summary, /4\.5% higher than in the second half of 2025/);
  assert.deepEqual(a.query, { country: "IE", sector: "business", energy: "electricity", consumption_band: "MWH500-1999", taxes: "excl_vat" });
  const x = a.extra as any;
  assert.equal(x.sector, "business");
  assert.deepEqual(x.consumption_band, { code: "MWH500-1999", band: "IC", label: "Consumption from 500 MWh to 1 999 MWh - band IC", annual_consumption: "500 to 1,999 MWh a year" });
  assert.deepEqual(x.price_by_tax_level_eur_per_kwh, { all_taxes_included: 0.2902, excluding_vat: 0.2666, excluding_all_taxes: 0.2636 });
  assert.equal(x.dataset.code, "nrg_pc_205");
  assert.equal(x.dataset.doi, "https://doi.org/10.2908/NRG_PC_205");
  assert.equal(x.eurostat_api_url, IE_URL);
  // Business electricity is cheaper than the household price: sanity range for Irish business electricity
  assert.ok(a.price!.value > 0.15 && a.price!.value < 0.45);
  // asking with all taxes included adds the VAT reminder
  const q2 = { ...q, taxes: "all" as const };
  assert.match(businessAnswer(readBusinessEnergy(ie(), q2), q2).statistic!.note!, /VAT, which businesses can normally reclaim/);
});

test("eu-energy-business: no figure gives no_matches and a plain sentence (never a price of 0)", () => {
  const q = { country: "FR", energy: "electricity" as const, band: IC, taxes: "excl_vat" as const };
  const a = businessAnswer(readBusinessEnergy(ie(), q), q);
  assert.equal(a.status, "no_matches");
  assert.equal(a.price, null);
  assert.match(a.summary, /Eurostat publishes no electricity price for businesses in France/);
});

test("eu-energy-business: euBusinessEnergy sends one Eurostat request, defaults to excluding VAT, and answers from it", async () => {
  const net = fakeEurostat(F.IE_ELECTRICITY);
  const a = await euBusinessEnergy({ country: "ie", energy: "Electricity", baseUrl: "https://proofprice.com" }, { fetcher: net.fetcher });
  assert.deepEqual(net.urls, [IE_URL]);
  assert.equal(a.status, "ok");
  assert.equal(a.price!.value, 0.2666);
  assert.equal(a.query.taxes, "excl_vat");

  const withVat = await euBusinessEnergy({ country: "IE", energy: "electricity", taxes: "all", consumption_band: "ID" }, { fetcher: net.fetcher });
  assert.equal(withVat.price!.value, (withVat.extra as any).price_by_tax_level_eur_per_kwh.all_taxes_included); // taxes=all returns the all-taxes figure
  assert.equal((withVat.extra as any).consumption_band.band, "ID");
  assert.deepEqual(withVat.query, { country: "IE", sector: "business", energy: "electricity", consumption_band: "MWH2000-19999", taxes: "all" });

  const gas = fakeEurostat(F.DE_GAS);
  const d = await euBusinessEnergy({ country: "DE", energy: "gas" }, { fetcher: gas.fetcher });
  assert.match(gas.urls[0], /nrg_pc_203\?format=JSON&lang=EN&geo=DE&unit=KWH&/);
  assert.equal(d.price!.value, 0.0682);
  assert.match(d.summary, /official average price paid by businesses/);
  assert.match(d.summary, /band I3/);
});

test("eu-energy-business: bad input never reaches Eurostat", async () => {
  const net = fakeEurostat(F.IE_ELECTRICITY);
  await assert.rejects(euBusinessEnergy({ country: "US", energy: "gas" }, { fetcher: net.fetcher }), /Not yet: US/);
  await assert.rejects(euBusinessEnergy({ country: "GB", energy: "gas" }, { fetcher: net.fetcher }), /Not yet: GB/);
  await assert.rejects(euBusinessEnergy({ country: "IE", energy: "oil" }, { fetcher: net.fetcher }), /energy must be/);
  await assert.rejects(euBusinessEnergy({ country: "IE", energy: "gas", consumption_band: "DC" }, { fetcher: net.fetcher }), /consumption_band for business gas/);
  await assert.rejects(euBusinessEnergy({ country: "IE", energy: "gas", taxes: "lots" }, { fetcher: net.fetcher }), /taxes must be/);
  assert.equal(net.urls.length, 0);
});

test("eu-energy-business: an unreachable Eurostat is reported, not hidden", async () => {
  await assert.rejects(
    euBusinessEnergy({ country: "IE", energy: "gas" }, { fetcher: async () => { throw new SourceError("Source timed out", "url"); } }),
    /timed out/,
  );
  await assert.rejects(euBusinessEnergy({ country: "IE", energy: "gas" }, { fetcher: async () => ({ not: "json-stat" }) }), SourceError);
});

test("energy category: sector=business routes to the business source, household stays on the household source", () => {
  const cat = categoryById("energy")!;
  assert.equal(cat.tool, "pricepaid_energy_prices"); // no new tool, no new category
  const schemas = paramSchemas(cat);
  assert.ok("sector" in schemas);
  assert.match(schemas.sector.description!, /business/);
  assert.match(schemas.consumption_band.description!, /IA = under 20 MWh a year/);
  assert.match(schemas.consumption_band.description!, /I3 = 10,000 to 99,999 GJ a year/);
  // household requests are prepared exactly as before (no sector key)
  assert.deepEqual(cat.prepare!({ country: "IE", energy: "power" }), { country: "IE", energy: "electricity", taxes: "all" });
  // business requests carry sector and default to excluding VAT
  assert.deepEqual(cat.prepare!({ country: "IE", sector: "non-household", energy: "power" }), { country: "IE", sector: "business", energy: "electricity", taxes: "excl_vat" });
  assert.deepEqual(cat.prepare!({ country: "IE", sector: "Business", energy: "gas", taxes: "all" }), { country: "IE", sector: "business", energy: "gas", taxes: "all" });
  assert.throws(() => cat.prepare!({ country: "IE", sector: "farm", energy: "gas" }), /sector must be/);
  assert.equal(normaliseSector(undefined), "household");
  assert.equal(normaliseSector("commercial"), "business");
  // routing: same country, two sources, the request decides
  const hh = pickSource(cat, { country: "IE", energy: "gas" });
  assert.equal(hh.src.info.id, "eu-energy");
  const biz = pickSource(cat, { country: "IE", energy: "gas", sector: "business" });
  assert.equal(biz.src.info.id, "eu-energy-business");
  assert.equal(findSource("energy", "IE")!.info.id, "eu-energy");
  // candidate countries have business figures only
  assert.equal(pickSource(cat, { country: "RS", energy: "gas", sector: "business" }).src.info.id, "eu-energy-business");
  assert.ok(countriesFor("energy").includes("RS"));
});

test("energy category: business requests for uncovered countries and household requests for business-only countries are plain errors", async () => {
  const cat = categoryById("energy")!;
  await assert.rejects(runCategory(cat, { country: "JP", energy: "gas", sector: "business" }), /Not yet: JP/);
  await assert.rejects(runCategory(cat, { country: "BR", energy: "electricity", sector: "business" }), /Business energy prices \(sector=business\) are available for .*Not yet: BR/); // BR has household only
  await assert.rejects(runCategory(cat, { country: "RS", energy: "gas" }), /Household energy prices are not available for RS/);
});
