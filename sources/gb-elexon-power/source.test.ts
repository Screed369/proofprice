// Fixture in ./fixtures is the real Elexon Market Index response for 2026-10-21 (96 rows: APXMIDP and an all-zero N2EXMIDP per half-hour),
// copied on 2026-10-22 from GitHub's servers (probe elexon-mi1).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SourceError } from "../../lib/http";
import { SOURCE_PLUGINS } from "../../lib/registry";
import { INFO, dayRow, dayUrl, elexonHarvest, elexonHistoryKey, elexonSpot, loadDay, parseMarketIndex, summariseSigned } from "./source";

const FILE = readFileSync(new URL("./fixtures/market-index-2026-10-21.json", import.meta.url), "utf8");
const NOW = new Date("2026-10-22T12:00:00Z");
// Any day: the same real prices moved to that date.
const shift = (date: string) => {
  const j = JSON.parse(FILE);
  for (const r of j.data) {
    r.startTime = r.startTime.replace("2026-10-21", date);
    r.settlementDate = date;
  }
  return JSON.stringify(j);
};
const get = async (url: string) => {
  const d = /from=(\d{4}-\d{2}-\d{2})T/.exec(url)![1];
  if (d === "2026-10-22") return JSON.stringify({ metadata: { datasets: ["MID"] }, data: [] });
  return shift(d);
};

test("gb-elexon-power: parses the real file and drops the all-zero N2EX rows", () => {
  const pts = parseMarketIndex(FILE);
  assert.equal(pts.length, 48);
  assert.ok(pts.every((p) => p.volume > 0 && p.price > 50 && p.price < 300));
  assert.equal(new Date(pts[0].ts).toISOString(), "2026-10-21T00:00:00.000Z");
  assert.throws(() => parseMarketIndex("<html>nope</html>"), SourceError);
  assert.throws(() => parseMarketIndex('{"nodata":1}'), SourceError);
  assert.throws(() => parseMarketIndex('{"data":[{"startTime":"x","price":"a","volume":1}]}'), SourceError);
});

test("gb-elexon-power: 2-day answer is a plausible GBP per MWh range with half-hours as the sample", async () => {
  const a = await elexonSpot({ days: 2 }, get, NOW);
  assert.equal(a.status, "ok");
  assert.equal(a.price!.currency, "GBP");
  assert.equal(a.price!.unit, "per MWh");
  assert.ok(a.sample_size! >= 48);
  assert.ok(a.price!.typical_low! <= a.price!.median! && a.price!.median! <= a.price!.typical_high!);
  assert.ok(a.price!.median! > 100 && a.price!.median! < 250);
  const x = a.extra as any;
  assert.ok(Math.abs(x.pence_per_kwh.median - a.price!.median! / 10) < 0.01);
  assert.match(a.source.attribution, /Contains BMRS data © Elexon Limited/);
  assert.match(a.source.attribution, /own calculations by ProofPrice/);
  assert.match(a.summary, /Not a household price/);
  assert.match(a.summary, /GBP/);
});

test("gb-elexon-power: never includes half-hours after now", async () => {
  const a = await elexonSpot({ days: 1 }, get, new Date("2026-10-21T06:00:00Z"));
  assert.equal(a.status, "ok");
  assert.ok(new Date((a.extra as any).latest_half_hour.time_utc).getTime() < Date.parse("2026-10-21T06:00:00Z"));
});

test("gb-elexon-power: an outage is an error, not an empty answer; fewer than 5 half-hours gives no range", async () => {
  await assert.rejects(() => elexonSpot({}, async () => { throw new SourceError("Source timed out"); }, NOW), SourceError);
  const tiny = async () => JSON.stringify({ data: [{ startTime: "2026-10-22T10:00:00Z", dataProvider: "APXMIDP", price: 100, volume: 5 }] });
  const a = await elexonSpot({ days: 1 }, tiny, NOW);
  assert.equal(a.status, "insufficient_data");
  assert.equal(a.price, null);
});

test("gb-elexon-power: signed summary keeps negative prices", () => {
  assert.equal(summariseSigned([-10, -2, 0, 5, 20, 40])!.min, -10);
  assert.equal(summariseSigned([]), null);
});

test("gb-elexon-power: harvest gives one GB row for yesterday", async () => {
  const h = await elexonHarvest(get, NOW);
  assert.equal(h.date, "2026-10-21");
  assert.equal(h.currency, "GBP");
  assert.equal(h.rows.length, 1);
  assert.ok(h.rows[0].n === 48 && h.rows[0].low <= h.rows[0].median && h.rows[0].median <= h.rows[0].high && h.rows[0].item === "spot");
  assert.equal(dayRow("GB", parseMarketIndex(FILE).slice(0, 10)), null);
  await assert.rejects(() => elexonHarvest(async () => { throw new SourceError("Source returned HTTP 500", "", 500); }, NOW), SourceError);
  assert.equal(elexonHistoryKey("gb")!.area, "GB");
  assert.equal(elexonHistoryKey("FR"), null);
});

test("gb-elexon-power: url and registry routing", async () => {
  assert.equal(dayUrl("2026-10-21"), "https://data.elexon.co.uk/bmrs/api/v1/balancing/pricing/market-index?from=2026-10-21T00:00Z&to=2026-10-21T23:59Z&format=json");
  assert.equal((await loadDay("2026-10-21", get)).length, 48);
  const p = SOURCE_PLUGINS.find((s) => s.info.id === INFO.id)!;
  assert.equal(p.category, "wholesale-power");
  assert.deepEqual(p.countries, ["GB"]);
});
