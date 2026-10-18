// Fixture t11573.json: real SSB JSON-stat2 response for table 11573 (Oslo, whole country, Stavanger; 2025 and 2026), captured 2026-10-18 via the GitHub-hosted probe.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { INFO, matchRegion, noChildcare, parseTable, pickLatest, URL_ALL } from "./source";

const FIX = JSON.parse(readFileSync(new URL("./fixtures/t11573.json", import.meta.url), "utf8"));

test("parses the real cube and picks the newest January", () => {
  const t = parseTable(FIX);
  assert.equal(t.codes.Region.length, 3);
  const p = pickLatest(t, "0");
  assert.equal(p?.year, "2026");
  assert.equal(p?.total, 1425);
  assert.equal(p?.price, 997);
  assert.equal(p?.previous?.total, 2073);
});

test("region matching", () => {
  const t = parseTable(FIX);
  assert.equal(matchRegion(t, "Oslo").code, "0301");
  assert.equal(matchRegion(t, "stavanger").code, "1103");
  assert.equal(matchRegion(t, undefined).code, "0");
  assert.equal(matchRegion(t, "Norge").code, "0");
  assert.throws(() => matchRegion(t, "Atlantis"), /not a Norwegian municipality/);
});

test("answer for Oslo", async () => {
  const calls: string[] = [];
  const a = await noChildcare({ area: "Oslo" }, async (u) => (calls.push(u), FIX));
  assert.equal(a.status, "ok");
  assert.equal(a.price?.value, 1479);
  assert.equal(a.price?.currency, "NOK");
  assert.equal(a.price_type, "official_statistic");
  assert.equal(calls[0], URL_ALL);
});

test("whole country: 1,425 NOK in January 2026, down from 2,073", async () => {
  const a = await noChildcare({}, async () => FIX);
  assert.equal(a.price?.value, 1425);
  assert.match(a.summary, /January 2026/);
});

test("licence info", () => {
  assert.match(INFO.licence, /CC BY 4.0/);
});
