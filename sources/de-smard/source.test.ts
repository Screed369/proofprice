// Fixtures in ./fixtures are real SMARD files copied on 2026-10-17 (index_hour.json trimmed to its last 4 weeks; the two newest week files whole).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SourceError } from "../../lib/http";
import { runCategory, SOURCE_PLUGINS } from "../../lib/registry";
import { INFO, INDEX_URL, answerFromPoints, dayRow, loadPoints, parseIndex, parseSeries, smardDayAhead, smardHarvest, summariseSigned, weekUrl, weeksFor } from "./source";

const fx = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8"));
const INDEX = fx("index_hour.json");
const W1 = fx("week-1791151200000.json");
const W2 = fx("week-1791756000000.json");
const get = async (url: string) => {
  if (url === INDEX_URL) return INDEX;
  if (url === weekUrl(1791151200000)) return W1;
  if (url === weekUrl(1791756000000)) return W2;
  if (url === weekUrl(1790546400000)) return { series: [] };
  throw new Error("unexpected url " + url);
};
const NOW = new Date("2026-10-17T12:00:00Z");

test("de-smard: index parses and a changed layout is a SourceError", () => {
  assert.equal(parseIndex(INDEX).length, 4);
  assert.throws(() => parseIndex({ nope: 1 }), SourceError);
  assert.throws(() => parseSeries({ nope: 1 }), SourceError);
});

test("de-smard: series drops the null (not yet published) hours", () => {
  assert.equal(W2.series.length, 168);
  const pts = parseSeries(W2);
  assert.ok(pts.length < 168 && pts.length > 100);
  assert.ok(pts.every((p) => typeof p.price === "number"));
});

test("de-smard: weeksFor picks the week files that overlap the window", () => {
  const starts = parseIndex(INDEX);
  assert.deepEqual(weeksFor(starts, NOW.getTime() - 3 * 86400000, NOW.getTime()), [1791756000000]);
  assert.deepEqual(weeksFor(starts, NOW.getTime() - 8 * 86400000, NOW.getTime()), [1791151200000, 1791756000000]);
});

test("de-smard: summariseSigned keeps negative prices", () => {
  const s = summariseSigned([-10, -2, 0, 5, 20, 40]);
  assert.equal(s!.count, 6);
  assert.equal(s!.min, -10);
  assert.equal(s!.max, 40);
  assert.equal(summariseSigned([]), null);
});

test("de-smard: 7-day answer is a plausible range in EUR per MWh with hours as the sample", async () => {
  const a = await smardDayAhead({ days: 7 }, get, NOW);
  assert.equal(a.status, "ok");
  assert.equal(a.price_type, "transaction");
  assert.equal(a.price!.currency, "EUR");
  assert.equal(a.price!.unit, "per MWh");
  assert.ok(a.sample_size! > 100 && a.sample_size! <= 168);
  assert.ok(a.price!.typical_low! <= a.price!.median! && a.price!.median! <= a.price!.typical_high!);
  assert.ok(a.price!.median! > 20 && a.price!.median! < 400, "German wholesale power is tens to a few hundred EUR/MWh");
  const x = a.extra as any;
  assert.equal(x.bidding_zone, "DE-LU");
  assert.ok(Math.abs(x.cents_per_kwh.median - a.price!.median! / 10) < 0.01);
  assert.ok(x.latest_hour.time_utc.endsWith("Z"));
  assert.match(a.source.licence, /CC BY 4\.0/);
  assert.match(a.summary, /Not a household price/);
});

test("de-smard: days window limits the hours and never includes future hours", async () => {
  const pts = await loadPoints(NOW.getTime() - 86400000, NOW.getTime(), get);
  assert.ok(pts.length <= 24 && pts.length >= 20);
  assert.ok(pts.every((p) => p.ts < NOW.getTime()));
  const a = answerFromPoints(pts, { days: 1 });
  assert.equal(a.status, "ok");
});

test("de-smard: fewer than 5 hours gives no range", () => {
  const a = answerFromPoints(parseSeries(W2).slice(0, 3), { days: 1 });
  assert.equal(a.status, "insufficient_data");
  assert.equal(a.price, null);
});

test("de-smard: harvest returns one aggregate row for yesterday", async () => {
  const h = await smardHarvest(get, NOW);
  assert.equal(h.date, "2026-10-16");
  assert.equal(h.rows.length, 1);
  assert.equal(h.rows[0].n, 24);
  assert.equal(h.rows[0].area, "DE");
  assert.ok(h.rows[0].low <= h.rows[0].median && h.rows[0].median <= h.rows[0].high);
  assert.equal(dayRow(parseSeries(W2).slice(0, 10)), null);
});

test("de-smard: registry routes DE wholesale power to this source", () => {
  const p = SOURCE_PLUGINS.find((s) => s.info.id === INFO.id)!;
  assert.equal(p.category, "wholesale-power");
  assert.deepEqual(p.countries, ["DE"]);
  assert.ok(typeof runCategory === "function");
});

test("de-smard: monthly periods aggregate hourly prices, keep negatives, drop thin months", async () => {
  const { monthlyPeriods, smardBackfill } = await import("./source");
  const H = 3600000;
  const start = Date.UTC(2024, 0, 1);
  const jan = Array.from({ length: 744 }, (_, i) => ({ ts: start + i * H, price: i % 10 === 0 ? -5 : 50 + (i % 7) }));
  const feb = Array.from({ length: 100 }, (_, i) => ({ ts: Date.UTC(2024, 1, 1) + i * H, price: 60 }));
  const p = monthlyPeriods([...jan, ...feb, ...jan.slice(0, 5)], "2024-01", "2024-02");
  assert.equal(p.length, 1, "February has only 100 hours and is dropped");
  assert.equal(p[0].period, "2024-01");
  const r = p[0].rows[0];
  assert.equal(r.n, 744);
  assert.equal(r.area, "DE");
  assert.equal(r.item, "day-ahead");
  assert.equal(r.min, -5);
  assert.ok(r.low <= r.median && r.median <= r.high);
  assert.equal(monthlyPeriods(jan, "2024-02", "2024-03").length, 0);
  // end to end with a fake getter: unknown weeks fail softly
  const idx = { timestamps: [start] };
  const wk = { series: jan.slice(0, 168).map((x) => [x.ts, x.price]) };
  const res = await smardBackfill("2024-01-01", "2024-01-31", async (u) => (u.endsWith("index_hour.json") ? idx : wk), 0);
  assert.equal(res.currency, "EUR");
  assert.equal(res.periods.length, 0, "one week of hours is far below 90% of January");
});
