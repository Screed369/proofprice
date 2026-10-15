// Fixture tab4618.json: real SCB JSON-stat2 response for table TAB4618 (default selection, 2026), captured 2026-10-15 via the GitHub-hosted probe.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { INFO, matchRegion, parseTable, pickLatest, seRent, URL_ALL_REGIONS, URL_DEFAULT } from "./source";

const FIX = JSON.parse(readFileSync(new URL("./fixtures/tab4618.json", import.meta.url), "utf8"));

test("parses the default selection", () => {
  const t = parseTable(FIX);
  assert.equal(t.rows.length, 24);
  assert.ok(INFO.licence.includes("CC0"));
});

test("pickLatest reads annual, per m2 and new rent for 2 rooms", () => {
  const p = pickLatest(parseTable(FIX), "00", "2")!;
  assert.equal(p.year, "2026");
  assert.equal(p.annual, 95875);
  assert.equal(p.perM2, 1645);
  assert.equal(p.newMonthly, 8018);
});

test("region matching falls back to Sweden when the table has no region dimension", () => {
  const t = parseTable(FIX);
  assert.equal(matchRegion(t, "Stockholm").code, "00");
  assert.equal(matchRegion(t, undefined).label, "Sweden");
});

test("answer: 3 rooms, falls back to default URL when filtered URL fails", async () => {
  const calls: string[] = [];
  const a = await seRent({ rooms: 3 }, async (u) => { calls.push(u); if (u === URL_ALL_REGIONS) throw new Error("refused"); return FIX; });
  assert.deepEqual(calls, [URL_ALL_REGIONS, URL_DEFAULT]);
  assert.equal(a.status, "ok");
  assert.equal(a.price?.value, Math.round(117419 / 12));
  assert.equal(a.price?.currency, "SEK");
  assert.equal(a.price_type, "official_statistic");
});

test("rooms required", async () => {
  await assert.rejects(() => seRent({}, async () => FIX), /bedrooms=1/);
});
