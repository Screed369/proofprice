// Tests for NL fuel (CBS table 80416NED). Fixtures: real rows (see fixtures.ts). The week-on-week and year-on-year tests use
// SYNTHETIC extra days (marked below) because only the real rows above were proven; they test the arithmetic, not CBS values.
import { test } from "node:test";
import assert from "node:assert/strict";
import { REAL_REPLY, FIRST_ROW } from "./fixtures";
import { INFO, harvestRows, nlFuelAnswer, nlFuelHistoryKey, nlFuelNow, parseDays, url } from "./source";
import manifest from "./index";
import eu from "../eu-oil-bulletin/index";
import { findSource } from "../../lib/registry";
import { NO_COUNT } from "../../lib/stats";

const TODAY = new Date("2026-10-22T12:00:00Z");

test("parseDays reads the real reply, newest first", () => {
  const d = parseDays(REAL_REPLY);
  assert.deepEqual(d.map((x) => x.date), ["2026-10-12", "2026-10-09"]);
  assert.equal(d[0].petrol95, 2.462);
  assert.equal(d[0].diesel, 2.482);
  assert.equal(d[0].lpg, 0.961);
  assert.equal(parseDays({ value: [FIRST_ROW] })[0].date, "2006-01-01");
  assert.throws(() => parseDays({}), /unexpected format/);
});

test("diesel: the national average of 12 October 2026 as an official statistic with no sample size", () => {
  const a = nlFuelAnswer(parseDays(REAL_REPLY), { fuel: "diesel" }, TODAY);
  assert.equal(a.status, "ok");
  assert.equal(a.price?.value, 2.482);
  assert.equal(a.price?.currency, "EUR");
  assert.equal(a.price?.unit, "per litre");
  assert.equal(a.price?.measure, "average");
  assert.equal(a.price?.typical_low, null);
  assert.equal(a.price?.typical_high, null);
  assert.equal(a.sample_size, null);
  assert.equal(a.price_type, "official_statistic");
  assert.deepEqual(a.period, { from: "2026-10-12", to: "2026-10-12" });
  assert.equal(a.statistic?.reference_period, "2026-10-12");
  assert.match(a.summary, /€2\.48 per litre|2\.482/);
  assert.match(a.summary, /not a live pump price/);
  assert.match(a.attribution ?? JSON.stringify(a), /Statistics Netherlands \(CBS\)/);
  const x = a.extra as any;
  assert.equal(x.other_fuels_same_day.length, 2);
  assert.equal(x.change_on_previous_week, null); // the real reply holds no day exactly 7 days earlier
});

test("cross-check: CBS equals the EU Weekly Oil Bulletin NL figure for 12 Oct 2026 (euro per 1000 l / 1000)", () => {
  const d = parseDays(REAL_REPLY)[0];
  assert.equal(Math.round(2461.96) / 1000, Math.round(d.petrol95! * 1000) / 1000);
  assert.equal(Math.round(2481.86) / 1000, d.diesel);
  assert.equal(Math.round(960.92) / 1000, d.lpg);
});

test("week and year changes (SYNTHETIC earlier days, arithmetic only)", () => {
  const days = parseDays({
    value: [
      ...REAL_REPLY.value,
      { Perioden: "20261005", BenzineEuro95_1: 2.4, Diesel_2: 2.4, Lpg_3: 0.9 },
      { Perioden: "20251013", BenzineEuro95_1: 2.0, Diesel_2: 2.0, Lpg_3: 0.8 },
    ],
  });
  const a = nlFuelAnswer(days, { fuel: "diesel" }, TODAY);
  const x = a.extra as any;
  assert.equal(x.change_on_previous_week.reference_date, "2026-10-05");
  assert.equal(x.change_on_previous_week.change_percent, 3.4);
  assert.equal(x.change_on_year_earlier.reference_date, "2025-10-13");
  assert.equal(x.change_on_year_earlier.change_percent, 24.1);
  assert.match(a.summary, /24\.1% higher than a year earlier/);
});

test("an area or postcode gets the national figure and a note, never a made-up local one", () => {
  const a = nlFuelAnswer(parseDays(REAL_REPLY), { fuel: "petrol95", town: "Utrecht", postcode: "3511" }, TODAY);
  assert.equal(a.status, "ok");
  assert.equal(a.price?.value, 2.462);
  assert.match(a.statistic?.note ?? "", /national average for the Netherlands/);
});

test("fuels CBS does not publish are refused in plain words", () => {
  assert.throws(() => nlFuelAnswer(parseDays(REAL_REPLY), { fuel: "e10" }), /Euro95 petrol \(petrol95\), diesel and lpg only/);
});

test("old data is flagged", () => {
  const a = nlFuelAnswer(parseDays(REAL_REPLY), { fuel: "diesel" }, new Date("2026-12-31T00:00:00Z"));
  assert.match(a.statistic?.note ?? "", /Old data/);
});

test("request URL uses the proven filter form; nlFuelNow fetches one reply", async () => {
  assert.equal(url("2026-10-05"), "https://opendata.cbs.nl/ODataApi/odata/80416ned/TypedDataSet?$filter=Perioden%20gt%20'20261005'");
  const real = globalThis.fetch;
  let seen = "";
  globalThis.fetch = (async (u: any) => {
    seen = String(u);
    return new Response(JSON.stringify(REAL_REPLY), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const a = await nlFuelNow({ fuel: "lpg" }, TODAY);
    assert.equal(a.price?.value, 0.961);
    assert.match(seen, /Perioden%20gt%20'2025/);
  } finally {
    globalThis.fetch = real;
  }
});

test("harvest keeps three rows for the newest day with no record count", () => {
  const h = harvestRows(parseDays(REAL_REPLY));
  assert.equal(h.date, "2026-10-12");
  assert.deepEqual(h.rows.map((r) => [r.area, r.item, r.median]), [["NL", "petrol95", 2.462], ["NL", "diesel", 2.482], ["NL", "lpg", 0.961]]);
  assert.ok(h.rows.every((r) => Object.is(r.n, NO_COUNT)));
  assert.throws(() => harvestRows([]), /no days/);
  assert.deepEqual(nlFuelHistoryKey({ fuel: "diesel" }), { area: "NL", item: "diesel", label: "Netherlands (national average)" });
  assert.equal(nlFuelHistoryKey({ fuel: "e10" }), null);
});

test("routing: NL requests go to the CBS source, other countries stay with the bulletin", () => {
  assert.equal(manifest.info.id, "nl-cbs-fuel");
  assert.equal(INFO.price_type, "official_statistic");
  assert.equal(findSource("fuel", "NL", { country: "NL", fuel: "diesel" })?.info.id, "nl-cbs-fuel");
  assert.equal(findSource("fuel", "IE", { country: "IE", fuel: "diesel" })?.info.id, "eu-oil-bulletin");
  assert.equal(eu.serves?.({ country: "NL" }), false);
});
