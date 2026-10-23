import { test } from "node:test";
import assert from "node:assert/strict";
import { InputError, SourceError } from "../../lib/http";
import { categoryById, findSource, pickSource, runCategory, SOURCE_PLUGINS } from "../../lib/registry";
import {
  BANDS, cclBasis, gbAnswer, gbBusinessEnergy, INFO, normaliseGbBand, parsePriceSheet, parseWorkbook, previousQuarter, quarterWords, readGb, workbookUrl, yearAgoQuarter,
} from "./source";
import { CONTENT_PAGE, SHEETS } from "./fixtures";

// Fixtures: real DESNZ values captured 2026-10-21 (see fixtures.ts).
const book = () => parseWorkbook(SHEETS);
const load = async () => book();

test("gb-desnz-energy-business: Open Government Licence, DESNZ attribution, official statistic", () => {
  assert.equal(INFO.id, "gb-desnz-energy-business");
  assert.equal(INFO.price_type, "official_statistic");
  assert.match(INFO.licence, /Open Government Licence v3\.0/);
  assert.equal(INFO.licence_url, "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/");
  assert.match(INFO.attribution, /Contains public sector information licensed under the Open Government Licence v3\.0/);
  assert.match(INFO.attribution, /Department for Energy Security and Net Zero/);
  assert.match(INFO.limits, /not a quote, tariff or offer/);
  const plugin = SOURCE_PLUGINS.find((s) => s.info.id === "gb-desnz-energy-business")!;
  assert.equal(plugin.category, "energy");
  assert.deepEqual(plugin.countries, ["GB"]);
  assert.ok(plugin.placeName.endsWith("(business)"));
  assert.deepEqual(plugin.examples.map((e) => e.params), [{ country: "GB", sector: "business", energy: "electricity" }, { country: "GB", sector: "business", energy: "gas" }]);
});

test("gb-desnz-energy-business: the real content-API record gives the workbook URL", () => {
  assert.equal(workbookUrl(CONTENT_PAGE), "https://assets.publishing.service.gov.uk/media/6ab543da997a4b2950cceedc/table_341.xlsx");
  assert.throws(() => workbookUrl({ details: { attachments: [] } }), SourceError);
});

test("gb-desnz-energy-business: parses the four real sheets (quarterly and annual, excl and incl CCL)", () => {
  const b = book();
  const lastQ = (rows: { period: string }[]) => rows[rows.length - 1].period;
  assert.equal(lastQ(b.excl_ccl.quarterly), "2026-Q2");
  assert.equal(lastQ(b.incl_ccl.quarterly), "2026-Q2");
  assert.equal(lastQ(b.excl_ccl.annual), "2025");
  assert.equal(b.incl_ccl.quarterly[b.incl_ccl.quarterly.length - 1].values["electricity/small/medium"], 27.666571001748441);
  assert.equal(b.excl_ccl.quarterly[b.excl_ccl.quarterly.length - 1].values["gas/average"], 4.9373922479904513);
  // a sheet without the header is rejected, in words
  assert.throws(() => parsePriceSheet({ name: "x", rows: [["nothing"]] }, true), /no 'Year' header/);
  assert.throws(() => parseWorkbook([SHEETS[0]]), /needs updating/);
});

test("gb-desnz-energy-business: bands accept DESNZ names, Eurostat letters and 'average'; defaults match Eurostat IC and I3", () => {
  assert.equal(normaliseGbBand("electricity").name, "Small/Medium");
  assert.equal(normaliseGbBand("gas").name, "Medium");
  assert.equal(normaliseGbBand("electricity", "IC").name, "Small/Medium");
  assert.equal(normaliseGbBand("electricity", "ig").name, "Extra Large");
  assert.equal(normaliseGbBand("gas", "I5").name, "Very Large");
  assert.equal(normaliseGbBand("electricity", "small medium").name, "Small/Medium");
  assert.equal(normaliseGbBand("electricity", "Small_Medium").name, "Small/Medium");
  assert.equal(normaliseGbBand("electricity", "very-large").name, "Very Large");
  assert.equal(normaliseGbBand("gas", "Average").key, "average");
  assert.throws(() => normaliseGbBand("gas", "I6"), (e: any) => e instanceof InputError && /no UK figure for Eurostat band I6/.test(e.message));
  assert.throws(() => normaliseGbBand("gas", "Extra Large"), InputError);
  assert.throws(() => normaliseGbBand("electricity", "DC"), InputError);
  assert.equal(BANDS.electricity.length, 7);
  assert.equal(BANDS.gas.length, 5);
});

test("gb-desnz-energy-business: tax words map onto the two DESNZ tables (VAT is never in the figures)", () => {
  assert.deepEqual(cclBasis("none"), { basis: "excl_ccl", note: null });
  assert.equal(cclBasis("excl_vat").basis, "incl_ccl");
  assert.equal(cclBasis("excl_vat").note, null);
  assert.equal(cclBasis("all").basis, "incl_ccl");
  assert.match(cclBasis("all").note!, /never include VAT/);
  assert.equal(previousQuarter("2026-Q1"), "2025-Q4");
  assert.equal(previousQuarter("2026-Q3"), "2026-Q2");
  assert.equal(yearAgoQuarter("2026-Q2"), "2025-Q2");
  assert.equal(quarterWords("2026-Q2"), "the second quarter of 2026");
});

test("gb-desnz-energy-business: UK business electricity (Small/Medium, IC) from the real tables", () => {
  const band = normaliseGbBand("electricity");
  const r = readGb(book(), { energy: "electricity", band, taxes: "excl_vat" })!;
  assert.equal(r.period, "2026-Q2");
  assert.equal(r.pence, 27.666571001748441);
  assert.deepEqual(r.previous, { period: "2026-Q1", pence: 28.08280969834578, change_percent: -1.5 });
  assert.equal(r.yearAgo!.period, "2025-Q2");
  assert.deepEqual(r.allBands.map((b) => [b.band, b.eu_band]), [["Very Small", "IA"], ["Small", "IB"], ["Small/Medium", "IC"], ["Medium", "ID"], ["Large", "IE"], ["Very Large", "IF"], ["Extra Large", "IG"], ["Average", null]]);
  assert.equal(r.annual!.year, "2025");
  // excluding the Climate Change Levy is the other table
  const ex = readGb(book(), { energy: "electricity", band, taxes: "none" })!;
  assert.equal(ex.pence, 27.090644331030724);
  assert.ok(ex.pence < r.pence);
});

test("gb-desnz-energy-business: the answer is an official average in GBP per kWh, no invented range, band and business named in the summary", () => {
  const band = normaliseGbBand("electricity");
  const q = { energy: "electricity" as const, band, taxes: "excl_vat" as const, baseUrl: "https://proofprice.com" };
  const a = gbAnswer(readGb(book(), q), q);
  assert.equal(a.status, "ok");
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.price!.measure, "average");
  assert.equal(a.price!.currency, "GBP");
  assert.equal(a.price!.unit, "per kWh");
  assert.ok(Math.abs(a.price!.value - 0.276666) < 1e-6);
  assert.equal(a.price!.median, null);
  assert.equal(a.price!.typical_low, null);
  assert.equal(a.price!.typical_high, null);
  assert.equal(a.sample_size, null);
  assert.deepEqual(a.period, { from: "2026-04-01", to: "2026-06-30" });
  assert.equal(a.statistic!.reference_period, "2026-Q2");
  assert.match(a.summary, /official average price paid by businesses \(non-domestic consumers\) for electricity in size band Small\/Medium \(Eurostat band IC\), 500 to 1,999 MWh a year/);
  assert.match(a.summary, /27\.67 pence per kWh \(£0\.2767\) in the second quarter of 2026, excluding VAT, including the Climate Change Levy/);
  assert.match(a.summary, /1\.5% lower than in the first quarter of 2026/);
  assert.match(a.statistic!.note!, /provisional/);
  assert.deepEqual(a.query, { country: "GB", sector: "business", energy: "electricity", consumption_band: "Small/Medium", taxes: "excl_vat" });
  const x = a.extra as any;
  assert.equal(x.sector, "business");
  assert.equal(x.pence_per_kwh, 27.667);
  assert.equal(x.all_bands_pence_per_kwh.length, 8);
  assert.deepEqual(x.consumption_band, { name: "Small/Medium", eu_equivalent_band: "IC", annual_consumption: "500 to 1,999 MWh a year" });
  assert.ok(a.price!.value > 0.15 && a.price!.value < 0.5); // sanity: UK business electricity is 15-50p/kWh
});

test("gb-desnz-energy-business: UK business gas (Medium, I3), all-taxes request carries the VAT note", async () => {
  const gas = await gbBusinessEnergy({ energy: "Natural Gas" }, load);
  assert.equal(gas.status, "ok");
  assert.ok(Math.abs(gas.price!.value - 0.0420482) < 1e-6);
  assert.match(gas.summary, /for gas in size band Medium \(Eurostat band I3\), 2,778 to 27,777 MWh a year, was 4\.20 pence per kWh/);
  assert.ok(gas.price!.value > 0.02 && gas.price!.value < 0.12);
  const all = await gbBusinessEnergy({ energy: "gas", taxes: "all", consumption_band: "Average" }, load);
  assert.match(all.statistic!.note!, /never include VAT/);
  assert.ok(Math.abs(all.price!.value - 0.052768927) < 1e-6);
  const noLevy = await gbBusinessEnergy({ energy: "electricity", consumption_band: "IG", taxes: "none" }, load);
  assert.match(noLevy.summary, /Extra Large/);
  assert.match(noLevy.summary, /excluding VAT and the Climate Change Levy/);
});

test("gb-desnz-energy-business: bad input is refused before the workbook is read; an unreachable site is reported", async () => {
  let reads = 0;
  const counting = async () => (reads++, book());
  await assert.rejects(gbBusinessEnergy({ energy: "oil" }, counting), /energy must be/);
  await assert.rejects(gbBusinessEnergy({ energy: "gas", consumption_band: "I6" }, counting), /no UK figure/);
  await assert.rejects(gbBusinessEnergy({ energy: "gas", taxes: "lots" }, counting), /taxes must be/);
  assert.equal(reads, 0);
  await assert.rejects(gbBusinessEnergy({ energy: "gas" }, async () => { throw new SourceError("The publisher answered 503 for assets.publishing.service.gov.uk."); }), /503/);
});

test("energy category: GB business goes to DESNZ, GB household to Ofgem (gb-ofgem-energy)", async () => {
  const cat = categoryById("energy")!;
  assert.equal(pickSource(cat, { country: "GB", energy: "gas", sector: "business" }).src.info.id, "gb-desnz-energy-business");
  assert.equal(findSource("energy", "GB")!.info.id, "gb-desnz-energy-business");
  assert.equal(pickSource(cat, { country: "GB", energy: "gas" }).src.info.id, "gb-ofgem-energy");
  assert.deepEqual(cat.prepare!({ country: "GB", sector: "business", energy: "gas" }), { country: "GB", sector: "business", energy: "gas", taxes: "excl_vat" });
});
