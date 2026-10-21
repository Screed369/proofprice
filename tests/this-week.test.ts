import test from "node:test";
import assert from "node:assert/strict";
import { PUBLIC_PATHS, buildLlmsFullTxt } from "../lib/open-book";
import { buildLlmsTxt } from "../lib/openapi";
import type { LibraryRow } from "../lib/library/store";
import type { SourceInfo } from "../lib/plugin";
import { MOVE_GROUPS, cleanUnit, itemLabel, shortLicence, kindLabel, loadThisWeek, movesOf, pickBaseline, topMoves, type Move } from "../lib/site/this-week";

const info = {
  id: "xx-fuel", country: "ES", category: "fuel", name: "Test fuel", publisher: "Test office", what_is_recorded: "x",
  price_type: "posted_pump_price", freshness: "daily", licence: "CC BY 4.0", licence_url: "https://example.org/l", attribution: "Test attribution",
  homepage: "https://example.org", limits: "none",
} as SourceInfo;

const row = (date: string, area: string, item: string, n: number, median: number): LibraryRow => ({ date, area, item, n, median, low: median, high: median, min: median, max: median });
const input = (baseRows: LibraryRow[], latestRows: LibraryRow[]) => ({
  group: "fuel" as const, info, country: "ES", currency: "EUR", unit: "per litre", baseDate: "2026-10-13", latestDate: "2026-10-20", baseRows, latestRows,
});

test("baseline is the day closest to a week earlier, within 5 to 35 days", () => {
  assert.equal(pickBaseline(["2026-10-13", "2026-10-15", "2026-10-19", "2026-10-20"], "2026-10-20"), "2026-10-13");
  assert.equal(pickBaseline(["2026-10-17", "2026-10-19", "2026-10-20"], "2026-10-20"), null); // too close
  assert.equal(pickBaseline(["2026-08-01", "2026-10-20"], "2026-10-20"), null); // too far
  assert.equal(pickBaseline(["2026-10-12", "2026-10-14", "2026-10-20"], "2026-10-20"), "2026-10-14"); // 6 days beats 8
});

test("a move needs at least 5 records on both days and a known item", () => {
  const ok = movesOf(input([row("2026-10-13", "ALL", "diesel", 900, 1.5)], [row("2026-10-20", "ALL", "diesel", 880, 1.65)]));
  assert.equal(ok.length, 1);
  assert.equal(ok[0].pct, 10);
  assert.equal(ok[0].kind, "Posted price");
  assert.equal(ok[0].placeName, "Spain");
  assert.equal(movesOf(input([row("2026-10-13", "ALL", "diesel", 4, 1.5)], [row("2026-10-20", "ALL", "diesel", 880, 1.65)])).length, 0);
  assert.equal(movesOf(input([row("2026-10-13", "ALL", "diesel", 900, 1.5)], [row("2026-10-20", "ALL", "diesel", 3, 1.65)])).length, 0);
  assert.equal(movesOf(input([row("2026-10-13", "ALL", "diesel:duty", 900, 1.5)], [row("2026-10-20", "ALL", "diesel:duty", 900, 1.6)])).length, 0);
  assert.equal(movesOf(input([row("2026-10-13", "28", "diesel", 90, 1.5)], [row("2026-10-20", "28", "diesel", 90, 1.6)])).length, 0); // not national
  assert.equal(movesOf(input([row("2026-10-13", "ALL", "diesel", 900, 1.5)], [row("2026-10-20", "ALL", "diesel", 900, 1.5)])).length, 0); // no change
});

test("kinds are labelled in plain words and homes only compare the 12-month median", () => {
  assert.equal(kindLabel("transaction"), "Real sale");
  assert.equal(kindLabel("official_statistic"), "Official statistic");
  assert.equal(kindLabel("posted_pump_price"), "Posted price");
  assert.ok(itemLabel("homes", "any:12m"));
  assert.equal(itemLabel("homes", "any:3m"), null);
  assert.equal(itemLabel("fuel", "diesel@2026-10-05"), null);
});

test("topMoves keeps the biggest, at most 2 per source", () => {
  const mk = (sourceId: string, itemName: string, pct: number) => ({ sourceId, itemName, pct }) as Move;
  const top = topMoves([mk("a", "1", 1), mk("a", "2", -9), mk("a", "3", 5), mk("b", "1", 2)], 3);
  assert.deepEqual(top.map((m) => `${m.sourceId}${m.itemName}`), ["a2", "a3", "b1"]);
});

test("the real page data only holds honest moves", () => {
  const t = loadThisWeek();
  assert.equal(t.groups.length, MOVE_GROUPS.length);
  for (const g of t.groups) {
    for (const m of g.moves) {
      assert.ok(m.baseN >= 5 && m.latestN >= 5, `${m.sourceId} thin row`);
      assert.ok(m.licence && m.licenceUrl && m.publisher && m.kind, `${m.sourceId} missing source details`);
      assert.ok(m.latestDate > m.baseDate);
      assert.notEqual(m.pct, 0);
    }
  }
});

test("/this-week is in the sitemap, llms.txt and llms-full.txt", () => {
  assert.ok(PUBLIC_PATHS.includes("/this-week"));
  assert.match(buildLlmsTxt("https://proofprice.com"), /https:\/\/proofprice\.com\/this-week/);
  assert.match(buildLlmsFullTxt("https://proofprice.com"), /https:\/\/proofprice\.com\/this-week/);
});

test("licence and unit are shortened without changing their meaning", () => {
  assert.equal(shortLicence("Licence Ouverte / Etalab 2.0"), "Licence Ouverte / Etalab 2.0");
  assert.equal(shortLicence("Reuse allowed, including commercial, under Spain's law (Ley 37/2007)."), "Reuse allowed, including commercial,");
  assert.equal(shortLicence("Public domain. EIA states: x"), "Public domain");
  assert.equal(cleanUnit("fuel", "EUR per litre (CNG per kg)"), "EUR per litre");
  assert.equal(cleanUnit("energy", "per kWh"), "per kWh");
});

test("official statistics do not claim a count of records", () => {
  const m = movesOf({ ...input([row("2026-10-13", "ALL", "diesel", 5, 1.5)], [row("2026-10-20", "ALL", "diesel", 5, 1.65)]), info: { ...info, price_type: "official_statistic" } as SourceInfo });
  assert.equal(m[0].countsRecords, false);
  assert.equal(m[0].kind, "Official statistic");
});
