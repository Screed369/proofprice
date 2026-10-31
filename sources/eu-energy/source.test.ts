import { test } from "node:test";
import assert from "node:assert/strict";
import { parseJsonStat } from "../../lib/adapters";
import { InputError, SourceError } from "../../lib/http";
import { categoryById, countriesFor, paramSchemas, pickSource, runCategory, SOURCE_PLUGINS } from "../../lib/registry";
import {
  COUNTRIES, DATASETS, energyAnswer, energyFilters, euEnergy, INFO, nationalCurrency, normaliseBand, normaliseEnergy, normaliseTaxes, periodWords, readEnergy,
} from "./source";
import * as F from "./fixtures";

// Fixtures: real Eurostat responses captured 2026-10-14 (see fixtures.ts).
const DC = normaliseBand("electricity");
const D2 = normaliseBand("gas");
const ie = () => parseJsonStat(F.IE_ELECTRICITY);
const de = () => parseJsonStat(F.DE_GAS);

const EUROSTAT = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data";
const IE_URL = `${EUROSTAT}/nrg_pc_204?format=JSON&lang=EN&geo=IE&unit=KWH&currency=EUR&currency=NAC&tax=I_TAX&tax=X_VAT&tax=X_TAX&lastTimePeriod=4`;

function fakeEurostat(body: unknown) {
  const urls: string[] = [];
  return { urls, fetcher: async (url: string) => (urls.push(url), body) };
}

test("eu-energy: licence, attribution and type are Eurostat's", () => {
  assert.equal(INFO.id, "eu-energy");
  assert.equal(INFO.price_type, "official_statistic");
  assert.equal(INFO.publisher, "Eurostat (European Commission)");
  assert.match(INFO.licence, /CC BY 4\.0/);
  assert.equal(INFO.licence_url, "https://ec.europa.eu/eurostat/help/copyright-notice");
  for (const k of ["Eurostat", "nrg_pc_204", "nrg_pc_202", "CC BY 4.0"]) assert.ok(INFO.attribution.includes(k), k);
  assert.match(INFO.limits, /not a quote or offer/);
});

test("eu-energy: covers EU27 + NO + IS, with Greece as GR", () => {
  const codes = Object.keys(COUNTRIES);
  assert.equal(codes.length, 29);
  for (const c of ["GR", "IE", "DE", "FR", "ES", "IT", "NO", "IS", "SE", "PL"]) assert.ok(codes.includes(c), c);
  for (const c of ["GB", "UK", "EL", "CH", "US"]) assert.ok(!codes.includes(c), c);
  for (const c of codes) assert.ok(countriesFor("energy").includes(c), c); // other sources (e.g. US EIA) may add countries
  const plugin = SOURCE_PLUGINS.find((s) => s.info.id === "eu-energy")!;
  assert.equal(plugin.category, "energy");
  assert.equal(plugin.status, "live");
  assert.deepEqual(plugin.examples.map((e) => e.params), [{ country: "IE", energy: "electricity" }, { country: "DE", energy: "gas" }]);
});

test("eu-energy: parameters accept letters, Eurostat codes and plain words", () => {
  assert.equal(DC.code, "KWH2500-4999");
  assert.equal(D2.code, "GJ20-199");
  assert.equal(normaliseBand("electricity", "dd").code, "KWH5000-14999");
  assert.equal(normaliseBand("electricity", "kwh_lt1000").letter, "DA");
  assert.equal(normaliseBand("electricity", "all").code, "TOT_KWH");
  assert.equal(normaliseBand("gas", "D3").code, "GJ_GE200");
  assert.equal(normaliseBand("gas", "tot_gj").code, "TOT_GJ");
  assert.throws(() => normaliseBand("gas", "DC"), (e: any) => e instanceof InputError && /D1 \(GJ_LT20\)/.test(e.message));
  assert.throws(() => normaliseBand("electricity", "D2"), InputError);
  assert.equal(normaliseEnergy("Electricity"), "electricity");
  assert.equal(normaliseEnergy("natural gas"), "gas");
  assert.throws(() => normaliseEnergy("oil"), InputError);
  assert.equal(normaliseTaxes(undefined), "all");
  assert.equal(normaliseTaxes("excl-vat"), "excl_vat");
  assert.equal(normaliseTaxes("NONE"), "none");
  assert.throws(() => normaliseTaxes("some"), InputError);
});

test("eu-energy: the national-currency label follows the euro, including Bulgaria (2026) and Croatia (2023)", () => {
  assert.equal(nationalCurrency("SE", "2026-S1"), "SEK");
  assert.equal(nationalCurrency("PL", "2026-S1"), "PLN");
  assert.equal(nationalCurrency("DE", "2026-S1"), "EUR");
  assert.equal(nationalCurrency("BG", "2025-S2"), "BGN");
  assert.equal(nationalCurrency("BG", "2026-S1"), "EUR");
  assert.equal(nationalCurrency("HR", "2022-S2"), "HRK");
  assert.equal(nationalCurrency("HR", "2023-S1"), "EUR");
  assert.equal(periodWords("2026-S1"), "the first half of 2026");
  assert.equal(periodWords("2025-S2"), "the second half of 2025");
  assert.equal(periodWords("2025"), "2025");
});

test("eu-energy: the Eurostat request is one slice, with GR sent as EL", () => {
  assert.deepEqual(energyFilters("IE"), { geo: "IE", unit: "KWH", currency: ["EUR", "NAC"], tax: ["I_TAX", "X_VAT", "X_TAX"] });
  assert.equal(energyFilters("GR").geo, "EL");
});

test("eu-energy: reads Ireland electricity from the real cube (latest half-year, tax levels, bands, change)", () => {
  const r = readEnergy(ie(), { country: "IE", energy: "electricity", band: DC, taxes: "all" })!;
  assert.equal(r.reference_period, "2026-S1");
  assert.equal(r.value, 0.3871);
  assert.equal(r.flag, null);
  assert.deepEqual(r.priceByTaxLevel, { all: 0.3871, excl_vat: 0.3552, none: 0.3506 });
  assert.equal(r.national, null); // Ireland's national currency is the euro
  assert.deepEqual(r.previous, { reference_period: "2025-S2", value: 0.4042, change_percent: -4.2 });
  assert.deepEqual(r.allBands.map((b) => [b.band, b.value]), [["ALL", 0.3921], ["DA", 0.5823], ["DB", 0.4817], ["DC", 0.3871], ["DD", 0.3392], ["DE", 0.2933]]);
  assert.equal(r.allBands[3].label, "Consumption from 2 500 kWh to 4 999 kWh - band DC");
  assert.equal(r.datasetLatest, "2026-S1");
  assert.equal(r.datasetTitle, "Electricity prices for household consumers - bi-annual data");
  // Another tax level and band on the same cube
  assert.equal(readEnergy(ie(), { country: "IE", energy: "electricity", band: DC, taxes: "excl_vat" })!.value, 0.3552);
  assert.equal(readEnergy(ie(), { country: "IE", energy: "electricity", band: DC, taxes: "none" })!.value, 0.3506);
  assert.equal(readEnergy(ie(), { country: "IE", energy: "electricity", band: normaliseBand("electricity", "DA"), taxes: "all" })!.value, 0.5823);
  // The cube holds Irish prices only
  assert.equal(readEnergy(ie(), { country: "FR", energy: "electricity", band: DC, taxes: "all" }), null);
});

test("eu-energy: reads Germany gas in kWh (the GJ rows of the same cube are ignored)", () => {
  const t = de();
  assert.ok(t.rows.some((r) => r.unit === "GJ_GCV"), "fixture has per-GJ rows too");
  const r = readEnergy(t, { country: "DE", energy: "gas", band: D2, taxes: "all" })!;
  assert.equal(r.value, 0.1156);
  assert.equal(r.reference_period, "2026-S1");
  assert.deepEqual(r.priceByTaxLevel, { all: 0.1156, excl_vat: 0.0971, none: 0.0794 });
  assert.deepEqual(r.previous, { reference_period: "2025-S2", value: 0.1223, change_percent: -5.5 });
  assert.deepEqual(r.allBands.map((b) => [b.band, b.value]), [["D1", 0.1517], ["D2", 0.1156], ["D3", 0.1092]]);
  assert.equal(readEnergy(t, { country: "DE", energy: "gas", band: normaliseBand("gas", "D1"), taxes: "none" })!.value, 0.109);
  // Germany publishes no all-bands gas figure, so asking for it finds nothing
  assert.equal(readEnergy(t, { country: "DE", energy: "gas", band: normaliseBand("gas", "all"), taxes: "all" }), null);
});

test("eu-energy: Sweden has a national-currency price (SEK) at the same tax level", () => {
  const t = parseJsonStat(F.SE_ELECTRICITY);
  const all = readEnergy(t, { country: "SE", energy: "electricity", band: DC, taxes: "all" })!;
  assert.equal(all.value, 0.3062);
  assert.deepEqual(all.national, { currency: "SEK", price: 3.3038 });
  const exVat = readEnergy(t, { country: "SE", energy: "electricity", band: DC, taxes: "excl_vat" })!;
  assert.equal(exVat.value, 0.2449);
  assert.deepEqual(exVat.national, { currency: "SEK", price: 2.643 });
  assert.equal(exVat.previous!.change_percent, 12.9);
});

test("eu-energy: Greece is asked for as EL and answered as GR, over four half-years", () => {
  const t = parseJsonStat(F.GR_ELECTRICITY);
  assert.deepEqual(t.codes.time, ["2024-S2", "2025-S1", "2025-S2", "2026-S1"]);
  const r = readEnergy(t, { country: "GR", energy: "electricity", band: DC, taxes: "all" })!;
  assert.equal(r.country, "GR");
  assert.equal(r.countryName, "Greece");
  assert.equal(r.reference_period, "2026-S1");
  assert.equal(r.value, 0.2401);
  assert.deepEqual(r.previous, { reference_period: "2025-S2", value: 0.2381, change_percent: 0.8 });
  assert.equal(r.national, null);
});

test("eu-energy: a country behind the rest (Iceland: 2025-S1, Latvia: 2025-S2) gets its own latest half-year and a note", () => {
  const t = parseJsonStat(F.IS_LV_ELECTRICITY);
  assert.equal(t.codes.time.at(-1), "2026-S1");
  const q = (country: string) => ({ country, energy: "electricity" as const, band: DC, taxes: "all" as const });
  const is = readEnergy(t, q("IS"))!;
  assert.equal(is.reference_period, "2025-S1");
  assert.equal(is.value, 0.2019);
  assert.equal(is.previous!.reference_period, "2024-S2");
  const lv = readEnergy(t, q("LV"))!;
  assert.equal(lv.reference_period, "2025-S2");
  assert.equal(lv.value, 0.2452);
  assert.equal(lv.previous!.change_percent, 0.5);
  const a = energyAnswer(is, { ...q("IS") });
  assert.equal(a.status, "ok");
  assert.deepEqual(a.period, { from: "2025-01-01", to: "2025-06-30" });
  assert.equal(a.statistic!.reference_period, "2025-S1");
  assert.match(a.statistic!.note!, /latest figure Eurostat holds for Iceland; 2026-S1 has been published for other countries but not yet for it/);
});

test("eu-energy: Finland gas has a cube but no values, so there is no answer", () => {
  const t = parseJsonStat(F.FI_GAS_EMPTY);
  assert.deepEqual(t.rows, []);
  const q = { country: "FI", energy: "gas" as const, band: D2, taxes: "all" as const };
  assert.equal(readEnergy(t, q), null);
  const a = energyAnswer(null, q);
  assert.equal(a.status, "no_matches");
  assert.equal(a.price, null);
  assert.equal(a.sample_size, null);
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.confidence, "insufficient");
  assert.match(a.summary, /^Eurostat publishes no natural gas price for households in Finland for consumption band D2 \(20 to 199 GJ a year/);
  assert.deepEqual(a.query, { country: "FI", energy: "gas", consumption_band: "GJ20-199", taxes: "all" });
});

test("eu-energy: the full answer for Ireland", () => {
  const q = { country: "IE", energy: "electricity" as const, band: DC, taxes: "all" as const, baseUrl: "https://proofprice.com", apiUrl: IE_URL };
  const a = energyAnswer(readEnergy(ie(), q), q);
  assert.equal(a.status, "ok");
  assert.deepEqual(a.query, { country: "IE", energy: "electricity", consumption_band: "KWH2500-4999", taxes: "all" });
  assert.deepEqual(a.price, {
    currency: "EUR", unit: "per kWh", value: 0.3871, measure: "average", median: null, typical_low: null, typical_high: null, min: null, max: null,
  });
  assert.equal(a.sample_size, null);
  assert.deepEqual(a.period, { from: "2026-01-01", to: "2026-06-30" });
  assert.equal(a.confidence, "high");
  assert.equal(a.price_type, "official_statistic");
  assert.deepEqual(a.statistic, { measure: "average", reference_period: "2026-S1" });
  assert.equal(a.method_url, "https://proofprice.com/method");
  assert.equal(
    a.summary,
    "In Ireland the average household price of electricity was €0.3871 per kWh in the first half of 2026 " +
      "(all taxes and levies included; annual consumption band DC, 2,500 to 4,999 kWh a year). " +
      "That is 4.2% lower than in the second half of 2025. Official average published by Eurostat (European Commission) for 2026-S1.",
  );
  assert.equal(a.source.id, "eu-energy");
  assert.equal(a.source.licence_url, "https://ec.europa.eu/eurostat/help/copyright-notice");
  const x: any = a.extra;
  assert.equal(x.country_name, "Ireland");
  assert.deepEqual(x.consumption_band, { code: "KWH2500-4999", band: "DC", label: "Consumption from 2 500 kWh to 4 999 kWh - band DC", annual_consumption: "2,500 to 4,999 kWh a year" });
  assert.deepEqual(x.taxes, { level: "all", code: "I_TAX", label: "All taxes and levies included" });
  assert.equal(x.reference_period_label, "the first half of 2026");
  assert.deepEqual(x.price_by_tax_level_eur_per_kwh, { all_taxes_included: 0.3871, excluding_vat: 0.3552, excluding_all_taxes: 0.3506 });
  assert.deepEqual(x.previous_period, { reference_period: "2025-S2", value: 0.4042, change_percent: -4.2 });
  assert.equal(x.all_bands_eur_per_kwh.length, 6);
  assert.deepEqual(x.all_bands_eur_per_kwh[1], { band: "DA", code: "KWH_LT1000", label: "Consumption less than 1 000 kWh - band DA", value: 0.5823 });
  assert.ok(!("national_currency" in x));
  assert.ok(!("data_flag" in x));
  assert.deepEqual(x.dataset, {
    code: "nrg_pc_204", title: "Electricity prices for household consumers - bi-annual data", updated: "2026-10-13T23:00:00+0200",
    doi: "https://doi.org/10.2908/NRG_PC_204", latest_period_in_dataset: "2026-S1",
  });
  assert.equal(x.eurostat_api_url, IE_URL);
  // Sanity: Irish household electricity is among the dearest in the EU
  assert.ok(a.price!.value > 0.3 && a.price!.value < 0.5);
});

test("eu-energy: a Eurostat flag (provisional) is passed on as a note and in extra", () => {
  const t = ie();
  const row = t.rows.find((r) => r.nrg_cons === "KWH2500-4999" && r.tax === "I_TAX" && r.currency === "EUR" && r.time === "2026-S1")!;
  row.status = "p";
  const q = { country: "IE", energy: "electricity" as const, band: DC, taxes: "all" as const };
  const a = energyAnswer(readEnergy(t, q), q);
  assert.equal(a.statistic!.note, "Eurostat flags this figure as provisional.");
  assert.deepEqual((a.extra as any).data_flag, { code: "p", meaning: "provisional" });
});

test("eu-energy: euEnergy sends one Eurostat request and answers from it", async () => {
  const net = fakeEurostat(F.IE_ELECTRICITY);
  const a = await euEnergy({ country: "ie", energy: "Electricity", baseUrl: "https://proofprice.com" }, { fetcher: net.fetcher });
  assert.deepEqual(net.urls, [IE_URL]);
  assert.equal(a.status, "ok");
  assert.equal(a.price!.value, 0.3871);
  assert.equal((a.extra as any).eurostat_api_url, IE_URL);

  const exVat = await euEnergy({ country: "IE", energy: "electricity", taxes: "excl_vat", consumption_band: "DB" }, { fetcher: net.fetcher });
  assert.equal(exVat.price!.value, 0.442);
  assert.deepEqual(exVat.query, { country: "IE", energy: "electricity", consumption_band: "KWH1000-2499", taxes: "excl_vat" });

  const gr = fakeEurostat(F.GR_ELECTRICITY);
  const g = await euEnergy({ country: "GR", energy: "electricity" }, { fetcher: gr.fetcher });
  assert.match(gr.urls[0], /nrg_pc_204\?format=JSON&lang=EN&geo=EL&/);
  assert.equal(g.price!.value, 0.2401);
  assert.equal(g.query.country, "GR");

  const gas = fakeEurostat(F.DE_GAS);
  const d = await euEnergy({ country: "DE", energy: "gas" }, { fetcher: gas.fetcher });
  assert.match(gas.urls[0], /nrg_pc_202\?format=JSON&lang=EN&geo=DE&unit=KWH&/);
  assert.equal(d.price!.value, 0.1156);
  assert.equal(d.price!.unit, "per kWh");
});

test("eu-energy: bad input never reaches Eurostat", async () => {
  const net = fakeEurostat(F.IE_ELECTRICITY);
  await assert.rejects(euEnergy({ country: "US", energy: "gas" }, { fetcher: net.fetcher }), /Not yet: US/);
  await assert.rejects(euEnergy({ country: "IE", energy: "oil" }, { fetcher: net.fetcher }), /energy must be/);
  await assert.rejects(euEnergy({ country: "IE", energy: "gas", consumption_band: "DC" }, { fetcher: net.fetcher }), /consumption_band for gas/);
  await assert.rejects(euEnergy({ country: "IE", energy: "gas", taxes: "lots" }, { fetcher: net.fetcher }), /taxes must be/);
  assert.equal(net.urls.length, 0);
});

test("eu-energy: an unreachable Eurostat is reported, not hidden", async () => {
  await assert.rejects(
    euEnergy({ country: "IE", energy: "gas" }, { fetcher: async () => { throw new SourceError("Source timed out", "url"); } }),
    /timed out/,
  );
  await assert.rejects(euEnergy({ country: "IE", energy: "gas" }, { fetcher: async () => ({ not: "json-stat" }) }), SourceError);
});

test("energy category: tool, REST path, parameters and routing", async () => {
  const cat = categoryById("energy")!;
  assert.equal(cat.tool, "pricepaid_energy_prices");
  assert.equal(cat.restPath, "energy");
  assert.equal(cat.cacheSeconds, 86400);
  assert.equal(cat.title, "Household electricity and gas prices");
  assert.deepEqual(cat.required, ["energy"]);
  const schemas = paramSchemas(cat);
  for (const k of ["energy", "consumption_band", "taxes"]) assert.ok(k in schemas, k); // sources may add extra params (e.g. US state)
  assert.match(schemas.consumption_band.description!, /Electricity: ALL = all consumption bands together; DA = under 1,000 kWh a year/);
  assert.match(schemas.consumption_band.description!, /D2 = 20 to 199 GJ a year/);
  assert.match(schemas.energy.description!, /CY, FI, IS, MT or NO/);
  // prepare() normalises what REST callers send
  assert.deepEqual(cat.prepare!({ country: "IE", energy: "Natural Gas", taxes: "ex-vat" }), { country: "IE", energy: "gas", taxes: "excl_vat" });
  assert.deepEqual(cat.prepare!({ country: "IE", energy: "power" }), { country: "IE", energy: "electricity", taxes: "all" });
  assert.throws(() => cat.prepare!({ energy: "kerosene" }), /energy must be/);
  assert.throws(() => cat.prepare!({ energy: "gas", taxes: "some" }), /taxes must be/);
  // routing errors are plain 400s
  await assert.rejects(runCategory(cat, { country: "JP", energy: "gas" }), /Not yet: JP/);
  // GB household requests go to gb-ofgem-energy (Ofgem price cap, declared serves() pair with gb-desnz-energy-business, 23 Oct 2026)
  assert.equal(pickSource(cat, { country: "UK", energy: "gas" }).src.info.id, "gb-ofgem-energy");
  await assert.rejects(runCategory(cat, { country: "IE", energy: "diesel" }), /energy must be/);
  await assert.rejects(runCategory(cat, { energy: "gas" }), /country is required/);
});

test("energy category: DATASETS describe the standard bands", () => {
  assert.equal(DATASETS.electricity.code, "nrg_pc_204");
  assert.equal(DATASETS.gas.code, "nrg_pc_202");
  assert.deepEqual(DATASETS.electricity.bands.map((b) => b.letter), ["ALL", "DA", "DB", "DC", "DD", "DE"]);
  assert.deepEqual(DATASETS.gas.bands.map((b) => b.letter), ["ALL", "D1", "D2", "D3"]);
});

test("eu-energy: a missing (':') or zero latest cell is no figure: the previous half-year is returned, never a price of 0", () => {
  const isMain = (r: any, t: string) => r.geo === "IE" && r.unit === "KWH" && r.nrg_cons === "KWH2500-4999" && r.tax === "I_TAX" && r.currency === "EUR" && r.time === t;
  // zero placeholder in the newest half-year
  const zero = ie();
  zero.rows = zero.rows.map((r) => (isMain(r, "2026-S1") ? { ...r, value: 0 } : r));
  const rz = readEnergy(zero, { country: "IE", energy: "electricity", band: DC, taxes: "all" })!;
  assert.equal(rz.reference_period, "2025-S2");
  assert.equal(rz.value, 0.4042);
  // the cell missing altogether (Eurostat ":")
  const gone = ie();
  gone.rows = gone.rows.filter((r) => !isMain(r, "2026-S1"));
  assert.equal(readEnergy(gone, { country: "IE", energy: "electricity", band: DC, taxes: "all" })!.reference_period, "2025-S2");
  // nothing left at all: no_matches, not a 0 price
  const none = ie();
  none.rows = none.rows.map((r) => ({ ...r, value: 0 }));
  const a = energyAnswer(readEnergy(none, { country: "IE", energy: "electricity", band: DC, taxes: "all" }), { country: "IE", energy: "electricity", band: DC, taxes: "all" });
  assert.equal(a.status, "no_matches");
  assert.equal(a.price, null);
});

test("eu-energy: serves() hands NO household electricity to a national source, keeps NO gas and other countries", async () => {
  const { default: m } = await import("./index");
  assert.equal(m.serves!({ country: "NO", energy: "electricity" }), false);
  assert.equal(m.serves!({ country: "NO", energy: "gas" }), true);
  assert.equal(m.serves!({ country: "IE", energy: "electricity" }), true);
});
