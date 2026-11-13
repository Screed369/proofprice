// Fixture copied from a LIVE response of the City of Detroit assessor_property_sales_view FeatureServer, checked 2026-11-13
// (where arm's-length + RESIDENTIAL + price>=10000, sale_date 2026-11-01..2026-11-13, newest first). 6,004 such sales in the 12 months before.
import { test } from "node:test";
import assert from "node:assert/strict";
import { InputError } from "../../lib/http";
import { buildWhere, clampMonths, detroitHarvest, detroitHistoryKey, detroitHomeSales, harvestFrom, isDetroitRequest, monthsBack, parseSales } from "./source";
import usHomeSales from "../us-home-sales";
import detroit from "./index";

const ROWS = [
  { sale_date: "2026-11-10", amt_sale_price: 105000, zip_code: "48221" }, { sale_date: "2026-11-10", amt_sale_price: 73000, zip_code: "48219" },
  { sale_date: "2026-11-10", amt_sale_price: 60000, zip_code: "48238" }, { sale_date: "2026-11-10", amt_sale_price: 105000, zip_code: "48223" },
  { sale_date: "2026-11-10", amt_sale_price: 62500, zip_code: "48214" }, { sale_date: "2026-11-10", amt_sale_price: 160000, zip_code: "48228" },
  { sale_date: "2026-11-06", amt_sale_price: 78000, zip_code: "48228" }, { sale_date: "2026-11-06", amt_sale_price: 40000, zip_code: "48227" },
];
const today = new Date("2026-11-13T12:00:00Z");

function fake() {
  const urls: string[] = [];
  const fetcher = async (url: string) => {
    urls.push(url);
    if (url.includes("returnCountOnly=true")) return { count: ROWS.length };
    const n = /resultRecordCount=(\d+)/.exec(url)?.[1];
    const out = n === "1" ? ROWS.slice(0, 1) : ROWS;
    return { features: out.map((attributes) => ({ attributes })), exceededTransferLimit: false };
  };
  return { fetcher, urls };
}

test("parseSales drops bad prices and dates", () => {
  const s = parseSales([...ROWS, { sale_date: "2206-01-28", amt_sale_price: 1 }, { sale_date: null, amt_sale_price: 50000 }, { sale_date: "2026-01-01", amt_sale_price: null }]);
  assert.equal(s.length, 8);
  assert.equal(s[0].zip, "48221");
});

test("where clause: arm's length, residential, $10k+, window with an upper bound", () => {
  const w = buildWhere({ from: "2025-11-10", to: "2026-11-10" }, "48207");
  assert.match(w, /term_of_sale='03-ARM''S LENGTH'/);
  assert.match(w, /property_class_description='RESIDENTIAL'/);
  assert.match(w, /sale_date > '2025-11-10' AND sale_date <= '2026-11-10'/);
  assert.match(w, /zip_code='48207'/);
});

test("isDetroitRequest", () => {
  assert.ok(isDetroitRequest({ town: "Detroit, MI" }));
  assert.ok(isDetroitRequest({ town: "Detroit" }));
  assert.ok(isDetroitRequest({ town: "Detroit", state: "Michigan" }));
  assert.ok(isDetroitRequest({ postcode: "48207" }));
  assert.ok(!isDetroitRequest({ town: "Detroit, MN" }));
  assert.ok(!isDetroitRequest({ town: "Hartford, CT" }));
  assert.ok(!isDetroitRequest({ postcode: "10001" }));
  assert.ok(!isDetroitRequest({ town: "Chicago" }));
});

test("months and monthsBack", () => {
  assert.equal(clampMonths(undefined), 12);
  assert.equal(clampMonths(99), 36);
  assert.equal(monthsBack("2026-11-10", 12), "2025-11-10");
});

test("detroitHomeSales answers a median with the 5-record rule and no addresses requested", async () => {
  const { fetcher, urls } = fake();
  const a: any = await detroitHomeSales({ town: "Detroit, MI" }, { fetcher, today });
  assert.equal(a.status, "ok");
  assert.equal(a.sample_size, 8);
  assert.equal(a.price?.median, 75500);
  assert.equal(a.period.to, "2026-11-10");
  for (const u of urls) { assert.ok(!/address|parcel|grantor|grantee/i.test(decodeURIComponent(u.split("outFields=")[1] ?? ""))); }
});

test("bad inputs", async () => {
  const { fetcher } = fake();
  await assert.rejects(detroitHomeSales({ property_type: "condo" }, { fetcher, today }), InputError);
  await assert.rejects(detroitHomeSales({ postcode: "10001" }, { fetcher, today }), InputError);
});

test("harvestFrom needs 5 sales; history key only for default window", async () => {
  assert.equal(harvestFrom(parseSales(ROWS.slice(0, 4)), "2026-11-13"), null);
  const h = harvestFrom(parseSales(ROWS), "2026-11-13");
  assert.equal(h?.rows[0].n, 8);
  assert.ok(detroitHistoryKey({ town: "Detroit, MI" }));
  assert.equal(detroitHistoryKey({ town: "Detroit, MI", months: 6 }), null);
  const { fetcher } = fake();
  assert.equal((await detroitHarvest({ fetcher, today })).rows.length, 1);
});

test("manifest sorts before us-home-sales and routes Detroit only to itself", () => {
  assert.ok("us-detroit-home-sales" < "us-home-sales");
  assert.equal(detroit.serves?.({ town: "Detroit, MI" }), true);
  assert.equal(usHomeSales.serves?.({ town: "Detroit, MI" }), true); // the earlier folder wins; see the header of index.ts
});
