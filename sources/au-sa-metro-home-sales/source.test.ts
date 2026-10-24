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
