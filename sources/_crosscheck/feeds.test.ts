// Tests for the outside-check publisher readers, on fixtures copied from the live formats (probe, 22 Oct 2026).
import { test } from "node:test";
import assert from "node:assert/strict";
import { csoHpm07Headlines, fetchUkHpi, parseEia56aHtml, parseUkHpiAverages, parseUkHpiSales, recentReleases, ukHpiUrl, wobHeadlines } from "./feeds";
import { EIA_56A_HTML, WOB_ROWS } from "./fixtures";
import type { CrossCheckContext } from "../../lib/plugin";

test("Oil Bulletin: Spain, France and the Netherlands on Monday 19 Oct 2026, euro per litre", () => {
  const h = wobHeadlines(WOB_ROWS, ["ES", "FR", "NL"], ["diesel", "petrol95"]);
  const by = Object.fromEntries(h.map((x) => [x.key, x]));
  assert.equal(by["ES/diesel"].period, "2026-10-19");
  assert.equal(by["ES/diesel"].value, 1.88922); // published 1889.22125 per 1000 l (pilot: 1.889)
  assert.equal(by["ES/petrol95"].value, 1.78047);
  assert.equal(by["FR/diesel"].value, 2.34584);
  assert.equal(by["FR/petrol95"].value, 2.22888);
  assert.equal(by["NL/diesel"].value, 2.45626); // CBS 19 Oct: 2.456
  assert.equal(by["NL/petrol95"].value, 2.39074);
});

test("Oil Bulletin: a changed unit row is an error, not a number", () => {
  const rows = WOB_ROWS.map((r) => [...r]);
  const unit = rows.findIndex((r) => r[0] === "Date");
  rows[unit] = rows[unit].map((c) => (c === "1000 l" ? "1 l" : c));
  assert.throws(() => wobHeadlines(rows, ["ES"], ["diesel"]), /not '1000 l'/);
});

test("EIA 5.6.A web page: newest month and the residential and commercial columns", () => {
  const t = parseEia56aHtml(EIA_56A_HTML);
  assert.equal(t.month, "2026-07");
  // Pilot (22 Oct 2026, July 2026): TX 15.88, CA 33.61, NY 29.90, CT 24.16 residential.
  assert.equal(t.residential.get("TX"), 15.88);
  assert.equal(t.residential.get("CA"), 33.61);
  assert.equal(t.residential.get("NY"), 29.9);
  assert.equal(t.residential.get("CT"), 24.16);
  assert.equal(t.commercial.get("TX"), 8.47);
  assert.equal(t.industrial.get("TX"), 7.07);
  assert.ok(!t.residential.has("ALL"), "census divisions and the U.S. total are not states");
  assert.ok(t.residential.size >= 50);
});

test("EIA 5.6.A web page: a reordered column group is an error", () => {
  assert.throws(() => parseEia56aHtml(EIA_56A_HTML.replace(">Residential<", ">Industrial<")), /new column groups/);
});

// HPM07 in the live layout (dimension ids, codes and labels as probed), cut to 2 statistics x 2 months x 3 statuses x 1 event x
// 3 regions x 1 buyer type. Values for Aug 2026 are the ones the pilot read from the same table (Dublin existing 493,000 ...).
function hpm07(): unknown {
  const regions = ["40", "51", "22"];
  const months = ["202607", "202608"];
  const value: number[] = [];
  // order: STATISTIC, TLIST(M1), status, event, region, buyer (last fastest)
  const median: Record<string, Record<string, number[]>> = {
    "202607": { "-": [498000, 448000, 198000], "01": [520000, 480000, 230000], "02": [490000, 425000, 199000] },
    "202608": { "-": [500000, 450000, 199000], "01": [525000, 482000, 231000], "02": [493000, 428000, 200000] },
  };
  for (const stat of ["HPM07C01", "HPM07C02"]) {
    for (const m of months) for (const st of ["-", "01", "02"]) for (const r of [0, 1, 2]) value.push(stat === "HPM07C02" ? median[m][st][r] : median[m][st][r] * 1.2);
  }
  return {
    class: "dataset",
    id: ["STATISTIC", "TLIST(M1)", "C03346V04033", "C03341V04028", "C03348V04035", "C03344V04031"],
    size: [2, 2, 3, 1, 3, 1],
    dimension: {
      STATISTIC: { label: "Statistic", category: { index: ["HPM07C01", "HPM07C02"], label: { HPM07C01: "Moving 12 Month Mean Sale Price", HPM07C02: "Moving 12 Month Median Sale Price" } } },
      "TLIST(M1)": { label: "Month", category: { index: months, label: { "202607": "2026 July", "202608": "2026 August" } } },
      C03346V04033: { label: "Dwelling Status", category: { index: ["-", "01", "02"], label: { "-": "All Dwelling Statuses", "01": "New", "02": "Existing" } } },
      C03341V04028: { label: "Stamp Duty Event", category: { index: ["01"], label: { "01": "Filings" } } },
      C03348V04035: { label: "RPPI Region", category: { index: regions, label: { "40": "Dublin", "51": "Kildare", "22": "Longford" } } },
      C03344V04031: { label: "Type of Buyer", category: { index: ["-"], label: { "-": "All Buyer Types" } } },
    },
    value,
  };
}

test("CSO HPM07: the newest moving 12-month median for EXISTING dwellings, filings, all buyers", () => {
  const h = csoHpm07Headlines(hpm07(), ["40", "51", "22"]);
  assert.deepEqual(h, [
    { key: "40", value: 493000, period: "2026-08" },
    { key: "51", value: 428000, period: "2026-08" },
    { key: "22", value: 200000, period: "2026-08" },
  ]);
});

test("CSO HPM07: relabelled codes are an error, not a silent switch to another series", () => {
  const j = hpm07() as any;
  j.dimension.C03346V04033.category.label["02"] = "New";
  assert.throws(() => csoHpm07Headlines(j, ["40"]), /Existing or Filings changed/);
});

const AVG = [
  "Date,Region_Name,Area_Code,Average_Price,Monthly_Change,Annual_Change,Average_Price_SA",
  "2026-07-01,Leeds,E08000035,245900,0.4,2.1,",
  "2026-07-01,City of Bristol,E06000023,352100,0.1,1.0,",
  "2026-08-01,Leeds,E08000035,246385,0.2,2.3,",
  "2026-08-01,City of Bristol,E06000023,353596,0.4,1.4,",
  "2026-08-01,England,E92000001,293525,0.1,1.9,",
].join("\n");
const SALES = ["Date,Region_Name,Area_Code,Sales_Volume", "2026-04-01,City of Bristol,E06000023,350", "2026-05-01,City of Bristol,E06000023,370", "2026-06-01,City of Bristol,E06000023,372", "2026-07-01,City of Bristol,E06000023,", "2026-06-01,Leeds,E08000035,800"].join("\n");

test("UK HPI CSVs: newest average price per area code; sales per month from the newest months that have a volume", () => {
  const a = parseUkHpiAverages(AVG, ["E08000035", "E06000023"]);
  assert.deepEqual(a.get("E08000035"), { value: 246385, period: "2026-08" });
  assert.deepEqual(a.get("E06000023"), { value: 353596, period: "2026-08" });
  const s = parseUkHpiSales(SALES, ["E08000035", "E06000023"]);
  assert.equal(s.get("E06000023"), 364); // (350 + 370 + 372) / 3; the empty July is skipped
  assert.equal(s.get("E08000035"), 800);
});

test("UK HPI: the newest release is found by trying recent months; a missing month is not an error", async () => {
  assert.deepEqual(recentReleases(new Date("2026-10-22T06:00:00Z")), ["2026-09", "2026-08", "2026-07", "2026-06"]);
  const asked: string[] = [];
  const ctx = {
    now: new Date("2026-10-22T06:00:00Z"),
    get: async (url: string) => {
      asked.push(url);
      if (url === ukHpiUrl("Average-prices", "2026-08")) return AVG;
      if (url === ukHpiUrl("Sales", "2026-08")) return SALES;
      return null; // 404 with optional
    },
  } as unknown as CrossCheckContext;
  const h = await fetchUkHpi(ctx, ["E08000035", "E06000023"]);
  assert.deepEqual(asked.slice(0, 2), [ukHpiUrl("Average-prices", "2026-09"), ukHpiUrl("Average-prices", "2026-08")]);
  assert.deepEqual(h.find((x) => x.key === "E06000023"), { key: "E06000023", value: 353596, period: "2026-08", n: 364 });
});
