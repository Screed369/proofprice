// Fixtures in ./fixtures are real Energy-Charts answers copied on 2026-10-17 from GitHub's servers:
// fr.json = /price?bzn=FR&start=2026-10-16&end=2026-10-17 (CC BY 4.0, 192 quarter-hour prices); restricted.json = the same call for SE3 (private-use licence).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SourceError } from "../../lib/http";
import { SOURCE_PLUGINS } from "../../lib/registry";
import { COUNTRIES, INFO, checkLicence, dayRow, energyChartsDayAhead, energyChartsHarvest, energyChartsHistoryKey, loadPoints, parseHourly, priceUrl, resolveZone, summariseSigned } from "./source";

const fx = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8"));
const FR = fx("fr.json");
const RESTRICTED = fx("restricted.json");
const NOW = new Date("2026-10-17T12:00:00Z");
const get = async (url: string) => {
  if (url.includes("bzn=SE3")) return RESTRICTED;
  return FR;
};

test("eu-energy-charts: quarter-hours are averaged to hours and nulls are dropped", () => {
  const pts = parseHourly(FR);
  assert.equal(pts.length, 48);
  assert.ok(pts.every((p) => Number.isFinite(p.price)));
  const withNull = parseHourly({ unix_seconds: [0, 900, 1800, 2700, 3600], price: [10, 20, null, 30, 5] });
  assert.equal(withNull.length, 2);
  assert.equal(withNull[0].price, 20);
  assert.throws(() => parseHourly({ nope: 1 }), SourceError);
  assert.throws(() => parseHourly({ unix_seconds: [1], price: [] }), SourceError);
});

test("eu-energy-charts: only a CC BY licence is accepted", () => {
  checkLicence(FR, "FR");
  assert.throws(() => checkLicence(RESTRICTED, "SE3"), /no longer publishes/);
  assert.throws(() => checkLicence({}, "FR"), SourceError);
});

test("eu-energy-charts: zone resolution", () => {
  assert.equal(resolveZone("dk").code, "DK1");
  assert.equal(resolveZone("DK", "dk2").code, "DK2");
  assert.equal(resolveZone("IT").code, "IT-North");
  assert.throws(() => resolveZone("ES"), SourceError);
  assert.throws(() => resolveZone("FR", "FR2"), SourceError);
  assert.match(priceUrl("IT-North", Date.parse("2026-10-10T00:00:00Z"), Date.parse("2026-10-17T00:00:00Z")), /bzn=IT-North&start=2026-10-10&end=2026-10-17$/);
});

test("eu-energy-charts: 1-day answer is a plausible EUR per MWh range with hours as the sample", async () => {
  const a = await energyChartsDayAhead({ country: "FR", days: 1 }, get, NOW);
  assert.equal(a.status, "ok");
  assert.equal(a.price_type, "transaction");
  assert.equal(a.price!.currency, "EUR");
  assert.equal(a.price!.unit, "per MWh");
  assert.equal(a.sample_size, 24);
  assert.ok(a.price!.typical_low! <= a.price!.median! && a.price!.median! <= a.price!.typical_high!);
  assert.ok(a.price!.median! > 20 && a.price!.median! < 400, "wholesale power is tens to a few hundred EUR/MWh");
  const x = a.extra as any;
  assert.equal(x.bidding_zone, "FR");
  assert.ok(Math.abs(x.cents_per_kwh.median - a.price!.median! / 10) < 0.01);
  assert.ok(x.latest_hour.time_utc.endsWith("Z"));
  assert.match(a.source.licence, /CC BY 4\.0/);
  assert.match(a.summary, /Not a household price/);
});

test("eu-energy-charts: never includes hours after now", async () => {
  const pts = await loadPoints("FR", NOW.getTime() - 86400000, NOW.getTime(), get);
  assert.ok(pts.every((p) => p.ts < NOW.getTime()));
});

test("eu-energy-charts: a restricted-licence response is refused, not served", async () => {
  await assert.rejects(() => loadPoints("SE3", 0, 1e13, get), /no longer publishes/);
});

test("eu-energy-charts: fewer than 5 hours gives no range", async () => {
  const a = await energyChartsDayAhead({ country: "FR", days: 1 }, get, new Date("2026-10-16T01:00:00Z"));
  assert.equal(a.status, "insufficient_data");
  assert.equal(a.price, null);
});

test("eu-energy-charts: signed summary keeps negative prices", () => {
  const s = summariseSigned([-10, -2, 0, 5, 20, 40]);
  assert.equal(s!.min, -10);
  assert.equal(summariseSigned([]), null);
});

test("eu-energy-charts: harvest returns one aggregate row per country for yesterday", async () => {
  const h = await energyChartsHarvest(get, NOW);
  assert.equal(h.date, "2026-10-16");
  assert.equal(h.rows.length, Object.keys(COUNTRIES).length);
  assert.ok(h.rows.every((r) => r.n === 24 && r.low <= r.median && r.median <= r.high && r.item === "day-ahead"));
  assert.equal(dayRow("FR", parseHourly(FR).slice(0, 10)), null);
  await assert.rejects(() => energyChartsHarvest(async () => RESTRICTED, NOW), SourceError);
  assert.deepEqual(energyChartsHistoryKey("fr")!.area, "FR");
  assert.equal(energyChartsHistoryKey("ES"), null);
});

test("eu-energy-charts: registry routes the wholesale-power countries to this source", () => {
  const p = SOURCE_PLUGINS.find((s) => s.info.id === INFO.id)!;
  assert.equal(p.category, "wholesale-power");
  assert.ok(p.countries.includes("FR") && !p.countries.includes("DE") && !p.countries.includes("ES"));
});
