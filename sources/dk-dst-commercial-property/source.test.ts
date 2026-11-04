// Fixture: real Statistics Denmark StatBank response for EJEN77 (business 0301 and industrial 0401, ordinary free trade, 2024Q1-2026Q2,
// all regions and provinces), captured 2026-11-04 with curl from the build workspace (see fixtures/ejen77-commercial.json).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dataUrl, denmarkCommercialAnswer, denmarkCommercialProperty, dkCommercialHistoryKey, harvestRows, INFO, readCommercial } from "./source";
import { parseStatbank } from "../dk-home-prices/source";
import { resolvePlace } from "../dk-home-prices/source";
import manifest from "./index";

const FIX = JSON.parse(readFileSync(new URL("./fixtures/ejen77-commercial.json", import.meta.url), "utf8"));
const NOW = new Date("2026-11-04T08:00:00Z");

test("licence and manifest", () => {
  assert.ok(INFO.licence.includes("CC 4.0 BY"));
  assert.equal(manifest.info.id, "dk-dst-commercial-property");
  assert.equal(INFO.price_type, "official_statistic");
});

test("Denmark 2026Q2: sales-weighted mean of the two published averages", () => {
  const r = readCommercial(parseStatbank(FIX), resolvePlace(undefined))!;
  assert.equal(r.main.reference_period, "2026-Q2");
  assert.equal(r.main.sales, 172 + 108);
  const expected = (172 * 7440_000 + 108 * 7676_000) / 280;
  assert.ok(Math.abs(r.main.average - expected) < 1e-3);
  assert.equal(r.year_earlier?.reference_period, "2025-Q2");
  assert.equal(r.previous?.reference_period, "2026-Q1");
  assert.equal(r.national, null);
});

test("province answer carries the national figure and leaves out a group with under 5 sales", () => {
  const r = readCommercial(parseStatbank(FIX), resolvePlace("Fyn"))!;
  assert.ok(r.main.sales >= 5);
  assert.ok(r.national && r.national.sales === 280);
  // Bornholm 2026Q2: business 5 sales at 2,427k, industrial 0 -> only business is used
  const b = readCommercial(parseStatbank(FIX), resolvePlace("Bornholm"))!;
  assert.equal(b.main.reference_period, "2026-Q2");
  assert.equal(b.main.sales, 5);
  assert.equal(Math.round(b.main.average), 2_427_000);
  assert.deepEqual(b.main.hidden, ["industrial properties and warehouses"]);
});

test("København city 2026Q2: 6 business sales at 56,518k is published (>= 5), industrial hidden", () => {
  const r = readCommercial(parseStatbank(FIX), resolvePlace("København"))!;
  assert.equal(r.main.sales, 6);
  assert.equal(Math.round(r.main.average), 56_518_000);
});

test("answer: ok, official statistic, DKK per property, never fewer than 5 sales", async () => {
  const calls: string[] = [];
  const a = await denmarkCommercialProperty({ town: "Nordjylland", property_type: "commercial" }, { fetcher: async (u: string) => (calls.push(u), FIX), now: NOW } as any);
  assert.deepEqual(calls, [dataUrl(["11", "000"])]);
  assert.equal(a.status, "ok");
  assert.equal(a.price?.currency, "DKK");
  assert.equal(a.price_type, "official_statistic");
  assert.ok((a.sample_size ?? 0) >= 5);
  assert.match(String(a.summary), /per property/);
  assert.match(String(a.summary), /second quarter of 2026/);
  assert.equal((a.extra as any).preliminary, true);
});

test("a municipality is answered with its province and says so", () => {
  const r = readCommercial(parseStatbank(FIX), resolvePlace("Aarhus"))!;
  const a = denmarkCommercialAnswer(r, { place: resolvePlace("Aarhus"), now: NOW });
  assert.match(JSON.stringify(a), /where Aarhus lies|province where/);
});

test("land and postcode-only are refused with a plain reason", async () => {
  await assert.rejects(denmarkCommercialProperty({ property_type: "land" }, { fetcher: async () => FIX } as any), /building/);
  await assert.rejects(denmarkCommercialProperty({ postcode: "8000" }, { fetcher: async () => FIX } as any), /province/);
});

test("harvest rows: newest national quarter, one row per area with 5+ sales, n is NO_COUNT", () => {
  const h = harvestRows(parseStatbank(FIX));
  assert.equal(h.date, "2026-06-30");
  const all = h.rows.find((r) => r.area === "000")!;
  assert.equal(all.item, "commercial");
  assert.ok(h.rows.length >= 8);
  assert.ok(h.rows.every((r) => r.median === r.low && r.median! > 0));
});

test("history key: province code, no key for postcode or land", () => {
  assert.deepEqual(dkCommercialHistoryKey({ town: "Aarhus" }), { area: "09", item: "commercial", label: "Østjylland" });
  assert.equal(dkCommercialHistoryKey({ postcode: "8000" }), null);
  assert.equal(dkCommercialHistoryKey({ property_type: "land" }), null);
});
