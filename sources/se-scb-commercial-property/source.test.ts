// Fixture: real SCB JSON-stat2 response for TAB1158 (sold industrial real estate, latest 2 years), captured 2026-10-23 via the GitHub-hosted probe.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { INFO, matchRegion, parseTable, pickLatest, seCommercialProperty, URL_ALL } from "./source";
import manifest from "./index";

const FIX = JSON.parse(readFileSync(new URL("./fixtures/tab1158.json", import.meta.url), "utf8"));

test("parses the table and keeps the CC0 licence", () => {
  const t = parseTable(FIX);
  assert.ok(t.rows.length > 100);
  assert.ok(INFO.licence.includes("CC0"));
  assert.equal(manifest.info.id, "se-scb-commercial-property");
});

test("Sweden 2025: weighted average of the three types", () => {
  const t = parseTable(FIX);
  const p = pickLatest(t, "00")!;
  assert.equal(p.year, "2025");
  assert.equal(p.byType.length, 3);
  // Real cells (Sweden, 2024): 235 manufacturing sales at 7,171k SEK, 82 petrol/workshop at 7,105k, 192 warehouse at 3,859k; 2025 is the latest year
  assert.ok(p.sales >= 400);
  const expected = p.byType.reduce((s, x) => s + x.sales * x.average, 0) / p.sales;
  assert.ok(Math.abs(p.average - expected) < 1e-6);
  assert.ok(p.average > 3_000_000 && p.average < 10_000_000);
});

test("a county with fewer than 5 sales in total gives no figure for that year", () => {
  const t = parseTable(FIX);
  // Gotland (09) has only a handful of sales: whatever is returned must have >= 5 sales behind it
  const p = pickLatest(t, "09");
  if (p) assert.ok(p.sales >= 5);
});

test("county matching", () => {
  const t = parseTable(FIX);
  assert.equal(matchRegion(t, "Skåne").code, "12");
  assert.equal(matchRegion(t, "skane county").code, "12");
  assert.equal(matchRegion(t, "Västra Götaland").code, "14");
  assert.equal(matchRegion(t, "Stockholm").label, "Stockholm county");
  assert.equal(matchRegion(t, undefined).label, "Sweden");
  assert.throws(() => matchRegion(t, "Atlantis"), /not a county/);
});

test("answer for Skåne", async () => {
  const calls: string[] = [];
  const a = await seCommercialProperty({ town: "Skåne", property_type: "commercial" }, async (u) => (calls.push(u), FIX));
  assert.deepEqual(calls, [URL_ALL]);
  assert.equal(a.status, "ok");
  assert.equal(a.price?.currency, "SEK");
  assert.equal(a.price_type, "official_statistic");
  assert.ok((a.sample_size ?? 0) >= 5);
  assert.ok((a.price?.value ?? 0) > 1_000_000);
  assert.match(String(a.summary), /per property/);
});

test("whole Sweden when town is left out; no per-type cell under 5 sales is shown", async () => {
  const a = await seCommercialProperty({}, async () => FIX);
  assert.equal(a.status, "ok");
  const by = (a.extra as any).by_type as { sales: number }[];
  assert.ok(by.every((t) => t.sales >= 5));
});

test("land, postcode are refused with a plain reason", async () => {
  await assert.rejects(seCommercialProperty({ property_type: "land" }, async () => FIX), /no building-plot/);
  await assert.rejects(seCommercialProperty({ postcode: "11122" }, async () => FIX), /county/);
});
