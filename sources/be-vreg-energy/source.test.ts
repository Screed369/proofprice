// Tests for be-vreg-energy. Rows are REAL (copied 2026-10-24 from the VREG V-test workbook, see fixtures.ts); rows marked SYNTHETIC are made up in this file only to test edges.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ELEC_SEP, GAS_SEP, HEADER, PAGE_HTML, makeXlsx } from "./fixtures";
import { INFO, beHarvest, beHistoryKey, beOffers, harvestFromOffers, latestMonth, normaliseEnergy, offersAnswer, parseOffers, readFixedSheets, workbookUrl } from "./source";
import manifest from "./index";
import { InputError, SourceError } from "../../lib/http";
import { findSource } from "../../lib/registry";

const VAR_SHEET = { name: "Var-dyn (excl. btw) (2026)", rows: [["Jaar", "Maand", "SYNTHETIC wider layout"] as (string | number)[]] };
const book = (rows: (string | number)[][]) => makeXlsx([VAR_SHEET, { name: "Vast (excl. btw) (2026)", rows: [HEADER, ...rows] }]);

test("licence, type and attribution are the Flemish regulator's", () => {
  assert.equal(INFO.id, "be-vreg-energy");
  assert.equal(INFO.price_type, "posted_price");
  assert.match(INFO.licence, /gratis hergebruik Vlaanderen/);
  assert.match(INFO.attribution, /Vlaamse Nutsregulator/);
  assert.match(INFO.limits, /not prices customers paid/);
});

test("the workbook link is read from the real page lines (not the price-curve file)", () => {
  assert.equal(
    workbookUrl(PAGE_HTML),
    "https://assets.vlaamsenutsregulator.be/2026-10/202610-v-test-data-exclbtw%20v2_0.xlsx?VersionId=ufWqr3DPEaKhTD0JCL1DMWDmRaM7q1PZ",
  );
  assert.throws(() => workbookUrl("<html></html>"), SourceError);
});

test("the reader takes only the fixed-price sheets and parses real rows", () => {
  const sheets = readFixedSheets(book(ELEC_SEP));
  assert.deepEqual(sheets.map((s) => s.name), ["Vast (excl. btw) (2026)"]);
  const offers = parseOffers(sheets);
  assert.equal(offers.length, 14);
  assert.deepEqual(offers[2], { year: 2026, month: 9, energy: "electricity", supplier: "Elegant", product: "Zeker & Vast", component: "day", price: 15.92 });
  assert.equal(offers[5].product, "Goedkope Stroom 3 jaar vast"); // trailing space trimmed
});

test("business rows, feed-in rows and variable products are left out (SYNTHETIC edge rows)", () => {
  const extra = [
    [2026, "sep", "Onderneming", "Elektriciteit", "Afname", "X", "Business", "Vast", "Enkelvoudige meter dagtarief (c€/kWh)", 11],
    [2026, "sep", "Woning", "Elektriciteit", "Teruglevering", "X", "Feed-in", "Vast", "Enkelvoudige meter dagtarief (c€/kWh)", 5],
    [2026, "sep", "Woning", "Elektriciteit", "Afname", "X", "Dynamic", "Dynamisch", "Enkelvoudige meter dagtarief (c€/kWh)", 9],
    [2026, "sep", "Woning", "Elektriciteit", "Afname", "X", "Two meters", "Vast", "Tweevoudige meter dagtarief (c€/kWh)", 9],
  ];
  assert.equal(parseOffers(readFixedSheets(book([...ELEC_SEP, ...extra]))).length, 14);
});

test("a changed column layout fails loudly, and a workbook without a fixed sheet too", () => {
  const bad = makeXlsx([{ name: "Vast (excl. btw) (2026)", rows: [["Jaar", "Maand", "SYNTHETIC changed"], ...ELEC_SEP] }]);
  assert.throws(() => parseOffers(readFixedSheets(bad)), /changed/);
  assert.throws(() => parseOffers([]), /no fixed-price/);
});

test("electricity answer: median, range and 14 products in September 2026", () => {
  const offers = parseOffers(readFixedSheets(book(ELEC_SEP)));
  const a = offersAnswer(offers, { energy: "electricity" });
  assert.equal(a.status, "ok");
  assert.equal(a.sample_size, 14);
  assert.equal(a.price_type, "posted_price");
  assert.equal(a.price!.currency, "EUR");
  // sorted euro values: median of 14 = mean of the 7th and 8th (0.18498/0.18498 with ties) = 0.18498...
  assert.ok(a.price!.median! > 0.18 && a.price!.median! < 0.19, String(a.price!.median));
  assert.equal(a.price!.min, 0.128);
  assert.equal(a.price!.max, 0.225065);
  assert.ok(a.price!.typical_low! < a.price!.median! && a.price!.typical_high! > a.price!.median!);
  assert.deepEqual(a.period, { from: "2026-09-01", to: "2026-09-30" });
  const x: any = a.extra;
  assert.equal(x.products_listed, 14);
  assert.equal(x.suppliers_listed, 8);
  assert.equal(x.cheapest_suppliers[0].supplier, "EnergyVision");
  assert.equal(x.cheapest_suppliers[0].cheapest_eur_per_kwh, 0.128);
  assert.match(a.summary, /not|excluding VAT/);
  assert.match(a.source.attribution, /Vlaamse Nutsregulator/);
});

test("fewer than 5 products: no range (the 4 real gas products of the sample)", () => {
  const offers = parseOffers(readFixedSheets(book([...ELEC_SEP, ...GAS_SEP])));
  const a = offersAnswer(offers, { energy: "gas" });
  assert.equal(a.status, "insufficient_data");
  assert.equal(a.price, null);
  assert.equal(a.sample_size, 4);
});

test("newest month is chosen in calendar order, not alphabetically, and the previous month gives the change (SYNTHETIC August and October rows)", () => {
  const aug = ELEC_SEP.map((r) => [r[0], "aug", ...r.slice(2, 9), Number(r[9]) - 1]);
  const okt = ELEC_SEP.map((r) => [r[0], "okt", ...r.slice(2, 9), Number(r[9]) + 1]);
  const offers = parseOffers(readFixedSheets(book([...aug, ...ELEC_SEP, ...okt])));
  assert.deepEqual(latestMonth(offers, "electricity"), { year: 2026, month: 10 });
  const a = offersAnswer(offers, { energy: "electricity" });
  assert.deepEqual(a.period, { from: "2026-10-01", to: "2026-10-31" });
  const x: any = a.extra;
  assert.equal(x.previous_period.reference_period, "September 2026");
  assert.ok(x.previous_period.median_change_percent > 0);
});

test("a source with no data for the energy answers no_matches", () => {
  const a = offersAnswer([], { energy: "electricity" });
  assert.equal(a.status, "no_matches");
});

test("harvest: one aggregate row per energy with at least 5 products, dated the first of the month", () => {
  const offers = parseOffers(readFixedSheets(book([...ELEC_SEP, ...GAS_SEP])));
  const h = harvestFromOffers(offers);
  assert.equal(h.date, "2026-09-01");
  assert.equal(h.currency, "EUR");
  assert.deepEqual(h.rows.map((r) => [r.area, r.item, r.n]), [["ALL", "electricity", 14]]); // gas has 4 products: not stored
  assert.ok(h.rows[0].low <= h.rows[0].median && h.rows[0].median <= h.rows[0].high);
  assert.throws(() => harvestFromOffers([]), SourceError);
});

test("history key and energy parsing", () => {
  assert.deepEqual(beHistoryKey({ energy: "electricity" }), { area: "ALL", item: "electricity", label: "Flanders, fixed-price home offers" });
  assert.equal(beHistoryKey({ energy: "oil" }), null);
  assert.throws(() => normaliseEnergy("oil"), InputError);
});

test("beOffers and beHarvest use the loader they are given", async () => {
  const loader = async () => parseOffers(readFixedSheets(book(ELEC_SEP)));
  assert.equal((await beOffers({ energy: "electricity" }, loader)).sample_size, 14);
  assert.equal((await beHarvest(loader)).rows.length, 1);
});

test("routing: BE requests with supplier_offers use this source, every other BE request stays with Eurostat", () => {
  assert.equal(manifest.serves!({ country: "BE", energy: "electricity", supplier_offers: true }), true);
  assert.equal(manifest.serves!({ country: "BE", energy: "electricity", supplier_offers: "true" }), true);
  assert.equal(manifest.serves!({ country: "BE", energy: "electricity" }), false);
  assert.equal(manifest.serves!({ country: "BE", energy: "electricity", supplier_offers: true, sector: "business" }), false);
  assert.equal(findSource("energy", "BE", { country: "BE", energy: "electricity", supplier_offers: "true" })?.info.id, "be-vreg-energy");
  assert.equal(findSource("energy", "BE", { country: "BE", energy: "electricity" })?.info.id, "eu-energy");
});
