// Fixture t14168.json: real SSB JSON-stat2 response for table 14168 (PrisRom, 17 regions, 2025M08-2026M08), captured 2026-10-20 via the GitHub-hosted probe.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { INFO, matchRegion, noHotels, parseTable, pickLatest, URL_DATA } from "./source";

const FIX = JSON.parse(readFileSync(new URL("./fixtures/t14168.json", import.meta.url), "utf8"));
const VAL_OSLO = 1873;

test("parses 17 regions x 13 months", () => {
  const t = parseTable(FIX);
  assert.equal(t.rows.length, 221);
  assert.equal(t.codes.Region.length, 17);
});

test("region matching", () => {
  const t = parseTable(FIX);
  assert.equal(matchRegion(t).code, "0N");
  assert.equal(matchRegion(t, "Oslo").code, "03");
  assert.equal(matchRegion(t, "Bergen").code, "46");
  assert.equal(matchRegion(t, "Møre og Romsdal").code, "15");
  assert.equal(matchRegion(t, "Troms").code, "55");
  assert.equal(matchRegion(t, "Svalbard").code, "21");
  assert.throws(() => matchRegion(t, "Atlantis"), /not a county/);
});

test("latest month and year-on-year", () => {
  const t = parseTable(FIX);
  const p = pickLatest(t, "03")!;
  assert.equal(p.month, "2026M08");
  assert.equal(p.value, VAL_OSLO);
  assert.ok(p.previous && p.previous.month === "2025M08");
});

test("answer for Oslo", async () => {
  const calls: string[] = [];
  const a = await noHotels({ area: "Oslo" }, async (u) => (calls.push(u), FIX));
  assert.equal(a.status, "ok");
  assert.equal(a.price?.currency, "NOK");
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.price?.median, null);
  assert.equal(a.statistic?.reference_period, "2026-08");
  assert.equal(a.period.to, "2026-08-31");
  assert.equal(calls[0], URL_DATA);
  assert.ok(a.price!.value > 1000 && a.price!.value < 4000);
});

test("whole country answer and licence", async () => {
  const a = await noHotels({}, async () => FIX);
  assert.equal(a.status, "ok");
  assert.match(INFO.licence, /CC BY 4.0/);
  assert.match(a.summary ?? "", /Norway/);
});
