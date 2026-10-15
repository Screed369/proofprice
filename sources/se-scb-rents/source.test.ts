// Fixtures: real SCB JSON-stat2 responses for TAB4618, captured 2026-10-15 via the GitHub-hosted probe (tab4618.json = our filtered request, tab4618-default.json = no filter).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { INFO, matchRegion, parseTable, pickLatest, seRent, URL_ALL_REGIONS } from "./source";

const FIX = JSON.parse(readFileSync(new URL("./fixtures/tab4618.json", import.meta.url), "utf8")); // all regions, 2026
const DEF = JSON.parse(readFileSync(new URL("./fixtures/tab4618-default.json", import.meta.url), "utf8")); // default selection (Sweden only)

test("parses the regional table", () => {
  const t = parseTable(FIX);
  assert.equal(t.rows.length, 72);
  assert.ok(INFO.licence.includes("CC0"));
});

test("pickLatest by region and rooms", () => {
  const t = parseTable(FIX);
  const se = pickLatest(t, "00", "2")!;
  assert.equal(se.annual, 95875);
  assert.equal(se.perM2, 1645);
  assert.equal(se.newMonthly, 8018);
  assert.equal(pickLatest(t, "0010", "2")!.annual, 110365);
  assert.equal(pickLatest(t, "0010", "2")!.year, "2026");
});

test("region matching", () => {
  const t = parseTable(FIX);
  assert.equal(matchRegion(t, "Stockholm").code, "0010");
  assert.equal(matchRegion(t, "Göteborg").code, "0020");
  assert.equal(matchRegion(t, undefined).label, "Sweden");
  assert.throws(() => matchRegion(t, "Atlantis"), /not a region group/);
});

test("fallback to the default table answers Sweden only, never a region", async () => {
  const d = parseTable(DEF);
  assert.equal(matchRegion(d, undefined).code, "00");
  assert.throws(() => matchRegion(d, "Stockholm"), /regional table/);
  const f = async (u: string) => { if (u === URL_ALL_REGIONS) throw new Error("refused"); return DEF; };
  const a = await seRent({ rooms: 3 }, f);
  assert.equal(a.price?.value, Math.round(117419 / 12));
  await assert.rejects(() => seRent({ town: "Stockholm", rooms: 3 }, f), /regional table/);
});

test("answer for Greater Stockholm, 2 rooms", async () => {
  const calls: string[] = [];
  const a = await seRent({ town: "Greater Stockholm", rooms: 2 }, async (u) => (calls.push(u), FIX));
  assert.deepEqual(calls, [URL_ALL_REGIONS]);
  assert.equal(a.status, "ok");
  assert.equal(a.price?.value, Math.round(110365 / 12));
  assert.equal(a.price?.currency, "SEK");
  assert.equal(a.price_type, "official_statistic");
});

test("rooms required", async () => {
  await assert.rejects(() => seRent({}, async () => FIX), /bedrooms=1/);
});
