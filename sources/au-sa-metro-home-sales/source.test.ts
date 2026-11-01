// Fixtures copied from the live data.sa.gov.au responses on 2026-10-24 (package_show trimmed to 3 resources; datastore_search trimmed to 10 of 482 rows).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { answerFor, parseTable, pickLatestResource, quarterBounds, saHomeSales, servesSuburb } from "./source";

const fx = (f: string) => JSON.parse(readFileSync(join(__dirname, "fixtures", f), "utf8"));
const pkg = fx("package-show.json");
const data = fx("datastore-2026-3q.json");

test("newest quarter's resource is picked", () => {
  assert.deepEqual(pickLatestResource(pkg), { id: "4245a13e-a972-431c-b446-e1e11c951836", quarter: "2026-Q3" });
});

test("table parses the quarter columns", () => {
  const t = parseTable(data);
  assert.equal(t.quarter, "2026-Q3");
  assert.equal(t.prevQuarter, "2025-Q3");
  const n = t.rows.find((r) => r.suburb === "NORWOOD")!;
  assert.equal(n.sales, 13);
  assert.equal(n.median, 2325000);
  assert.equal(t.rows.find((r) => r.suburb === "ASHTON")!.median, null);
  assert.deepEqual(quarterBounds("2026-Q3"), { from: "2026-07-01", to: "2026-09-30" });
});

test("Norwood: published median with its sales count", () => {
  const a = answerFor(parseTable(data), "Norwood");
  assert.equal(a.status, "ok");
  assert.equal(a.price?.median, 2325000);
  assert.equal(a.sample_size, 13);
  assert.deepEqual(a.period, { from: "2026-07-01", to: "2026-09-30" });
  assert.match(a.summary, /Norwood/);
  assert.match(a.summary, /13 sales/);
});

test("fewer than 5 sales is withheld (Glenelg 2 sales)", () => {
  const a = answerFor(parseTable(data), "Glenelg, SA");
  assert.equal(a.status, "no_matches");
  assert.equal(a.price, null);
  assert.match(String((a.extra as any).withheld), /only 2 house sales/);
});

test("a suburb in two councils answers with the part that has most sales and says so", () => {
  const t = parseTable(data);
  const a = answerFor(t, "Belair");
  const rows = t.rows.filter((r) => r.suburb === "BELAIR");
  assert.equal(rows.length, 2);
  assert.equal((a.extra as any).other_council_parts.length, 1);
});

test("unknown suburb is a clear input error", () => {
  assert.throws(() => answerFor(parseTable(data), "Sydney"), /not a metropolitan Adelaide suburb/);
});

test("routing: suburb yes, state/city/postcode no, ambiguous names need an SA hint", () => {
  assert.equal(servesSuburb("Norwood"), true);
  assert.equal(servesSuburb("norwood, south australia"), true);
  assert.equal(servesSuburb("Adelaide"), false);
  assert.equal(servesSuburb("South Australia"), false);
  assert.equal(servesSuburb("Melbourne"), false);
  assert.equal(servesSuburb("Norwood", "5067"), false);
  assert.equal(servesSuburb("Brighton"), false);
  assert.equal(servesSuburb("Brighton SA"), true);
});

test("saHomeSales reads package_show then datastore_search", async () => {
  const urls: string[] = [];
  const a = await saHomeSales({ town: "Norwood" }, async (u) => { urls.push(u); return u.includes("package_show") ? pkg : data; });
  assert.equal(a.status, "ok");
  assert.match(urls[0], /package_show\?id=metro-median-house-sales/);
  assert.match(urls[1], /datastore_search\?resource_id=4245a13e-a972-431c-b446-e1e11c951836/);
  await assert.rejects(() => saHomeSales({ postcode: "5067" }, async () => pkg), /by suburb/);
});

// Look-back for a thin suburb. Rows copied from the live Q3 and Q2 2026 files (data.sa.gov.au, read 2026-11-01): Glenelg had 2 house sales in Q3 and 3 in Q2.
const mk = (q: number, rows: [string, string, string, string, string, string][]) => {
  const y = 2026;
  return {
    success: true,
    result: {
      records: rows.map(([city, suburb, s, m, ps, pm]) => ({
        City: city, Suburb: suburb,
        [`Sales ${q}Q ${y - 1}`]: ps, [`Median ${q}Q ${y - 1}`]: pm,
        [`Sales ${q}Q ${y}`]: s, [`Median ${q}Q ${y}`]: m,
      })),
    },
  };
};
const q3 = parseTable(mk(3, [["HOLDFAST BAY", "GLENELG", "2", "1870000", "3", "2000000"], ["HOLDFAST BAY", "GLENELG NORTH", "9", "1485000", "16", "1410000"]]));
const q2 = parseTable(mk(2, [["HOLDFAST BAY", "GLENELG", "3", "2775000", "2", "2465000"], ["HOLDFAST BAY", "GLENELG NORTH", "14", "1593000", "19", "1550000"]]));
const q1 = parseTable(mk(1, [["HOLDFAST BAY", "GLENELG", "6", "2100000", "5", "1900000"], ["HOLDFAST BAY", "GLENELG NORTH", "10", "1500000", "12", "1400000"]]));

test("thin suburb: still withheld when no earlier quarter was given", () => {
  const a = answerFor(q3, "Glenelg");
  assert.equal(a.price, null);
  assert.equal(a.extra.withheld, "only 2 house sales in the quarter (minimum 5)");
});

test("thin suburb: looks back to the newest earlier quarter with 5+ sales and says so", () => {
  const a = answerFor(q3, "Glenelg", undefined, [q2, q1]);
  assert.equal(a.status, "ok");
  assert.equal(a.price?.median, 2100000);
  assert.equal(a.sample_size, 6);
  assert.equal(a.period.from, "2026-01-01");
  assert.equal(a.period.to, "2026-03-31");
  assert.deepEqual(a.extra.looked_back_from, { latest_quarter: "2026-Q3", latest_sales: 2 });
  assert.match(a.summary, /2026-Q1/);
  assert.match(a.summary, /had only 2 house sales in 2026-Q3/);
});

test("a suburb with enough sales now is never looked back", () => {
  const a = answerFor(q3, "Glenelg North", undefined, [q2, q1]);
  assert.equal(a.price?.median, 1485000);
  assert.equal(a.extra.looked_back_from, undefined);
});

test("saHomeSales fetches earlier quarters only for a thin suburb", async () => {
  const calls: string[] = [];
  const pk = {
    success: true,
    result: { resources: ["Q3", "Q2", "Q1", "Q4"].map((q, i) => ({ id: `r${i}`, name: `Metropolitan Median House Sales ${q} ${q === "Q4" ? 2025 : 2026}`, datastore_active: true })) },
  };
  const fetcher = async (u: string) => {
    calls.push(u);
    if (u.includes("package_show")) return pk;
    if (u.includes("resource_id=r0")) return mk(3, [["HOLDFAST BAY", "GLENELG", "2", "1870000", "3", "2000000"], ["HOLDFAST BAY", "GLENELG NORTH", "9", "1485000", "16", "1410000"]]);
    if (u.includes("resource_id=r1")) return mk(2, [["HOLDFAST BAY", "GLENELG", "3", "2775000", "2", "2465000"]]);
    if (u.includes("resource_id=r2")) return mk(1, [["HOLDFAST BAY", "GLENELG", "6", "2100000", "5", "1900000"]]);
    throw new Error("unexpected " + u);
  };
  const thin = await saHomeSales({ town: "Glenelg" }, fetcher);
  assert.equal(thin.price?.median, 2100000);
  assert.equal(calls.length, 4); // package + Q3 + Q2 + Q1 (stops at Q1)
  calls.length = 0;
  const ok = await saHomeSales({ town: "Glenelg North" }, fetcher);
  assert.equal(ok.price?.median, 1485000);
  assert.equal(calls.length, 2);
});
