// Fixture in ./fixtures is the real OPCOM Day-Ahead Market results file for delivery day 2026-11-03 (96 intervals),
// copied on 2026-11-04 from GitHub's servers (probe opcom-csv).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SourceError } from "../../lib/http";
import { SOURCE_PLUGINS } from "../../lib/registry";
import { INFO, dayRow, dayUrl, loadDay, opcomHarvest, opcomHistoryKey, opcomSpot, parseMarketResults, summariseSigned } from "./source";

const FILE = readFileSync(new URL("./fixtures/market-coupling-2026-11-03.csv", import.meta.url), "utf8");
const NOW = new Date("2026-11-04T12:00:00Z");
// Any day: the same real file with its title moved to that date (title is month/day/year).
const shift = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return FILE.replace("11/3/2026", `${m}/${d}/${y}`);
};
const dateOf = (url: string) => {
  const [, d, m, y] = /\/(\d+)\/(\d+)\/(\d{4})\/en$/.exec(url)!;
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
};
const get = async (url: string) => {
  const d = dateOf(url);
  if (d > "2026-11-04") throw new SourceError("Source returned HTTP 404", "", 404); // tomorrow not published yet
  return shift(d);
};

test("ro-opcom-power: parses the real file (96 intervals, ROPEX index)", () => {
  const d = parseMarketResults(FILE, "2026-11-03");
  assert.equal(d.prices.length, 96);
  assert.equal(d.prices[0], 228.95);
  assert.equal(d.prices[95], 237.83);
  assert.deepEqual(d.ropex, { base: 297, peak: 322.22, offPeak: 278.09 });
  assert.ok(d.prices.every((p) => p > 100 && p < 500));
  assert.throws(() => parseMarketResults("<html>nope</html>", "2026-11-03"), SourceError);
  assert.throws(() => parseMarketResults(FILE, "2026-11-04"), SourceError); // wrong day
  assert.throws(() => parseMarketResults(FILE.split("\n").slice(0, 40).join("\n"), "2026-11-03"), SourceError); // cut short
  assert.throws(() => parseMarketResults(FILE.replace("\n2,245.22", "\n2,abc"), "2026-11-03"), SourceError);
});

test("ro-opcom-power: 2-day answer is a plausible EUR per MWh range with intervals as the sample", async () => {
  const a = await opcomSpot({ days: 2 }, get, NOW);
  assert.equal(a.status, "ok");
  assert.equal(a.price!.currency, "EUR");
  assert.equal(a.price!.unit, "per MWh");
  assert.ok(a.sample_size! >= 96);
  assert.ok(a.price!.typical_low! <= a.price!.median! && a.price!.median! <= a.price!.typical_high!);
  assert.ok(a.price!.median! > 200 && a.price!.median! < 350);
  const x = a.extra as any;
  assert.ok(Math.abs(x.cents_per_kwh.median - a.price!.median! / 10) < 0.01);
  assert.equal(x.latest_day, "2026-11-04");
  assert.equal(x.ropex_latest_day_eur_per_mwh.peak, 322.22);
  assert.match(a.source.attribution, /OPCOM/);
  assert.match(a.source.attribution, /own calculations by ProofPrice/);
  assert.match(a.summary, /Not a household price/);
});

test("ro-opcom-power: tomorrow is used when published, and a missing tomorrow is not an error", async () => {
  const withTomorrow = async (url: string) => shift(dateOf(url));
  const a = await opcomSpot({ days: 1 }, withTomorrow, NOW);
  assert.equal((a.extra as any).latest_day, "2026-11-05");
  const b = await opcomSpot({ days: 1 }, get, NOW);
  assert.equal((b.extra as any).latest_day, "2026-11-04");
});

test("ro-opcom-power: an outage is an error, not an empty answer", async () => {
  await assert.rejects(() => opcomSpot({}, async () => { throw new SourceError("Source timed out"); }, NOW), SourceError);
});

test("ro-opcom-power: signed summary keeps negative prices", () => {
  assert.equal(summariseSigned([-10, -2, 0, 5, 20, 40])!.min, -10);
  assert.equal(summariseSigned([]), null);
});

test("ro-opcom-power: harvest gives one RO row for yesterday", async () => {
  const h = await opcomHarvest(get, NOW);
  assert.equal(h.date, "2026-11-03");
  assert.equal(h.currency, "EUR");
  assert.equal(h.rows.length, 1);
  const r = h.rows[0];
  assert.ok(r.n === 96 && r.low <= r.median && r.median <= r.high && r.item === "day-ahead" && r.area === "RO");
  const short = parseMarketResults(FILE, "2026-11-03");
  assert.equal(dayRow("RO", { ...short, prices: short.prices.slice(0, 50) }), null);
  await assert.rejects(() => opcomHarvest(async () => { throw new SourceError("Source returned HTTP 500", "", 500); }, NOW), SourceError);
  assert.equal(opcomHistoryKey("ro")!.area, "RO");
  assert.equal(opcomHistoryKey("BG"), null);
});

test("ro-opcom-power: url (day/month/year, no zero padding) and registry routing", async () => {
  assert.equal(dayUrl("2026-11-03"), "https://www.opcom.ro/rapoarte-pzu-raportMarketResults-export-csv/3/11/2026/en");
  assert.equal(dayUrl("2026-01-09"), "https://www.opcom.ro/rapoarte-pzu-raportMarketResults-export-csv/9/1/2026/en");
  assert.equal((await loadDay("2026-11-03", get)).prices.length, 96);
  const p = SOURCE_PLUGINS.find((s) => s.info.id === INFO.id)!;
  assert.equal(p.category, "wholesale-power");
  assert.deepEqual(p.countries, ["RO"]);
});
