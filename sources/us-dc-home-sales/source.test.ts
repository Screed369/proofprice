// Fixtures copied from LIVE responses fetched through the Probe workflow on 2026-10-23 (SALEDATE and PRICE columns of the DC GIS server):
//   .../Property_and_Land_WebMercator/MapServer/25/query?where=SALEDATE>=date '2026-09-15' AND QUALIFIED='Q' AND PRICE>=10000&outFields=SALEDATE,PRICE,QUALIFIED&orderByFields=SALEDATE DESC&resultRecordCount=8   (RESIDENTIAL)
//   .../MapServer/24/query?...same...   (CONDOMINIUM)
// Newest qualified sale in both tables that day: 2026-10-15 (epoch 1792036800000, noon UTC). 3,047 qualified residential sales in the 12 months before.
import { test } from "node:test";
import assert from "node:assert/strict";
import { InputError } from "../../lib/http";
import { buildWhere, clampMonths, dcHomeSales, INFO, isDcRequest, LAYERS, monthsBack, OUT_FIELDS, parseSales } from "./source";
import usHomeSales from "../us-home-sales";
import dcSource from "./index";
import { findSource } from "../../lib/registry";

const RES = [490000, 177842, 525000, 511130, 203500, 950000, 1300000, 809000].map((PRICE) => ({ SALEDATE: 1792036800000, PRICE, QUALIFIED: "Q" }));
const CONDO = [
  { SALEDATE: 1792036800000, PRICE: 322000 }, { SALEDATE: 1792036800000, PRICE: 228535 }, { SALEDATE: 1792036800000, PRICE: 405000 },
  { SALEDATE: 1791950400000, PRICE: 625000 }, { SALEDATE: 1791950400000, PRICE: 290000 }, { SALEDATE: 1791864000000, PRICE: 980000 },
  { SALEDATE: 1791864000000, PRICE: 203000 }, { SALEDATE: 1791864000000, PRICE: 527500 },
];

/** A fake ArcGIS server: layer 25 holds RES, layer 24 holds CONDO; records every URL. */
function fakeDc() {
  const urls: string[] = [];
  const fetcher = async (url: string) => {
    urls.push(url);
    const rows = url.includes("/MapServer/25/") ? RES : CONDO;
    const n = /resultRecordCount=(\d+)/.exec(url)?.[1];
    const out = n === "1" ? rows.slice(0, 1) : rows;
    return { features: out.map((attributes) => ({ attributes })), exceededTransferLimit: false };
  };
  return { fetcher, urls };
}

test("parseSales reads epoch milliseconds and drops unusable rows", () => {
  const s = parseSales([...RES, { SALEDATE: null, PRICE: 5 }, { SALEDATE: 1792036800000, PRICE: null }, { SALEDATE: 1792036800000, PRICE: 0 }]);
  assert.equal(s.length, 8);
  assert.equal(s[0].date, "2026-10-15");
  assert.equal(s[6].price, 1300000);
});

test("query: qualified sales of at least $10,000 in the window, date and price only", () => {
  assert.equal(buildWhere({ from: "2025-10-15", to: "2026-10-15" }), "QUALIFIED='Q' AND PRICE>=10000 AND SALEDATE>date '2025-10-15' AND SALEDATE<date '2026-10-16'");
  assert.deepEqual(OUT_FIELDS, ["SALEDATE", "PRICE"]);
  assert.equal(monthsBack("2026-10-15", 12), "2025-10-15");
  assert.deepEqual([clampMonths(undefined), clampMonths(0), clampMonths(99), clampMonths(6)], [12, 1, 36, 6]);
});

test("a Washington, DC request is recognised; a bare 'Washington' stays Connecticut", () => {
  for (const p of [{ town: "Washington, DC" }, { town: "Washington DC" }, { town: "Washington, D.C." }, { town: "washington, district of columbia" }, { town: "DC" }, { town: "District of Columbia" }, { state: "DC" }, { state: "dc", town: "Georgetown" }, { postcode: "20001" }]) {
    assert.equal(isDcRequest(p), true, JSON.stringify(p));
  }
  for (const p of [{ town: "Washington" }, { town: "Washington, CT" }, { town: "Hartford" }, { town: "Brooklyn" }, { postcode: "11201" }, { state: "CT", town: "Washington" }, { town: "Chicago" }, {}]) {
    assert.equal(isDcRequest(p), false, JSON.stringify(p));
  }
});

test("routing: Washington, DC goes to us-dc-home-sales, everything else stays with us-home-sales", () => {
  assert.equal(findSource("home-sales", "US", { town: "Washington, DC" })?.info.id, "us-dc-home-sales");
  assert.equal(findSource("home-sales", "US", { state: "DC" })?.info.id, "us-dc-home-sales");
  for (const town of ["Hartford", "Brooklyn", "Chicago", "Washington", "Washington, CT"]) {
    assert.equal(findSource("home-sales", "US", { town })?.info.id, "us-home-sales", town);
  }
  assert.equal(findSource("home-sales", "US", {})?.info.id, "us-home-sales");
  assert.equal(usHomeSales.serves!({ town: "Washington, DC" }), false);
  assert.equal(dcSource.serves!({ town: "Hartford" }), false);
});

test("whole-District answer for homes: both tables, medians from the live-format rows", async () => {
  const { fetcher, urls } = fakeDc();
  const a = await dcHomeSales({ town: "Washington, DC" }, { fetcher, today: new Date("2026-10-23T12:00:00Z") });
  assert.equal(a.status, "ok");
  assert.equal(a.price?.currency, "USD");
  assert.equal(a.sample_size, 16);
  assert.equal(a.price?.median, 500565); // median of the 16 prices above
  assert.equal(a.period.to, "2026-10-15");
  assert.ok(urls.some((u) => u.includes("/MapServer/25/query")) && urls.some((u) => u.includes("/MapServer/24/query")));
  assert.ok(urls.every((u) => !/outFields=[^&]*(SSL|OWNER)/i.test(u)), "never asks for the parcel number or an owner");
  assert.match(a.source.licence, /CC BY 4\.0/);
  assert.match(a.source.attribution, /Office of the Chief Financial Officer/);
});

test("house only reads the residential table; condo only the condominium table", async () => {
  const h = fakeDc();
  const a = await dcHomeSales({ town: "Washington, DC", property_type: "house" }, { fetcher: h.fetcher, today: new Date("2026-10-23T12:00:00Z") });
  assert.equal(a.sample_size, 8);
  assert.ok(h.urls.every((u) => u.startsWith(LAYERS.house)));
  const c = fakeDc();
  const b = await dcHomeSales({ town: "Washington, DC", property_type: "condo" }, { fetcher: c.fetcher, today: new Date("2026-10-23T12:00:00Z") });
  assert.equal(b.sample_size, 8);
  assert.ok(c.urls.every((u) => u.startsWith(LAYERS.condo)));
});

test("honest refusals: coop, ZIP codes, and fewer than five sales", async () => {
  const { fetcher } = fakeDc();
  await assert.rejects(dcHomeSales({ town: "Washington, DC", property_type: "coop" }, { fetcher }), InputError);
  await assert.rejects(dcHomeSales({ town: "Washington, DC", postcode: "20001" }, { fetcher }), /whole District/);
  const few = async (url: string) => ({ features: RES.slice(0, 3).map((attributes) => ({ attributes })), exceededTransferLimit: false });
  const a = await dcHomeSales({ town: "Washington, DC", property_type: "house" }, { fetcher: few, today: new Date("2026-10-23T12:00:00Z") });
  assert.notEqual(a.status, "ok");
  assert.equal(a.price, null);
});

test("INFO names the licence and ships no personal fields", () => {
  assert.equal(INFO.id, "us-dc-home-sales");
  assert.match(INFO.limits, /never addresses/);
});
