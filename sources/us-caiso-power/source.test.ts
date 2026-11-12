// Fixture in ./fixtures is the real CAISO OASIS answer (a ZIP with one CSV) for the day-ahead market, hub NP15,
// delivery days 2026-11-05 to 2026-11-12 (query 20261105T08:00 to 20261112T08:00), copied on 2026-11-12.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SourceError } from "../../lib/http";
import { SOURCE_PLUGINS } from "../../lib/registry";
import { INFO, answerFromHours, caisoHarvest, caisoHistoryKey, caisoSpot, dayRow, parseHub, parseLmp, queryUrl, summariseSigned, unzipFirst } from "./source";

const ZIP = readFileSync(new URL("./fixtures/prc-lmp-dam-np15-2026-11-05_12.zip", import.meta.url));
const NOW = new Date("2026-11-12T12:00:00Z");
const get = async () => ZIP;

test("us-caiso-power: unzips and parses the real file (LMP rows only)", () => {
  const csv = unzipFirst(ZIP).toString("utf8");
  assert.match(csv, /^INTERVALSTARTTIME_GMT,/);
  const rows = parseLmp(csv);
  assert.equal(rows.length, 168);
  assert.deepEqual(rows[0], { date: "2026-11-05", hour: 1, price: rows[0].price });
  assert.ok(rows.every((r) => r.price > -100 && r.price < 1000));
  assert.throws(() => parseLmp("<?xml version='1.0'?><error/>"), SourceError);
});

test("us-caiso-power: not a zip is a clear error", () => {
  assert.throws(() => unzipFirst(Buffer.from("<html>nope</html>")), SourceError);
});

test("us-caiso-power: answer is a plausible USD per MWh range with hours as the sample", async () => {
  const a = await caisoSpot({ days: 7 }, get, NOW);
  assert.equal(a.status, "ok");
  assert.equal(a.price!.currency, "USD");
  assert.equal(a.price!.unit, "per MWh");
  assert.equal(a.sample_size, 168);
  assert.ok(a.price!.typical_low! <= a.price!.median! && a.price!.median! <= a.price!.typical_high!);
  assert.ok(a.price!.median! > 10 && a.price!.median! < 200);
  const x = a.extra as any;
  assert.equal(x.hub, "NP15");
  assert.ok(Math.abs(x.cents_per_kwh.median - a.price!.median! / 10) < 0.01);
  assert.equal(x.latest_day, "2026-11-11");
  assert.match(a.source.attribution, /CAISO/);
  assert.match(a.source.attribution, /own calculations by ProofPrice/);
  assert.match(a.summary, /Not a household price/);
});

test("us-caiso-power: query url and hub names", () => {
  assert.equal(
    queryUrl("NP15", "2026-11-05", "2026-11-12"),
    "https://oasis.caiso.com/oasisapi/SingleZip?queryname=PRC_LMP&startdatetime=20261105T08:00-0000&enddatetime=20261112T08:00-0000&version=1&market_run_id=DAM&node=TH_NP15_GEN-APND&resultformat=6",
  );
  assert.equal(parseHub(undefined), "NP15");
  assert.equal(parseHub("south"), "SP15");
  assert.equal(parseHub("th_zp26_gen-apnd"), "ZP26");
  assert.throws(() => parseHub("Tokyo"), SourceError);
});

test("us-caiso-power: an outage is an error, not an empty answer", async () => {
  await assert.rejects(() => caisoSpot({}, async () => { throw new SourceError("Source timed out"); }, NOW), SourceError);
});

test("us-caiso-power: signed summary keeps negative prices", () => {
  assert.equal(summariseSigned([-10, -2, 0, 5, 20, 40])!.min, -10);
  assert.equal(summariseSigned([]), null);
});

test("us-caiso-power: harvest gives one row per hub for yesterday and needs 23 hours", async () => {
  const h = await caisoHarvest(get, NOW, 0);
  assert.equal(h.date, "2026-11-11");
  assert.equal(h.currency, "USD");
  assert.deepEqual(h.rows.map((r) => r.area), ["US-NP15", "US-SP15", "US-ZP26"]);
  const r = h.rows[0];
  assert.ok(r.n === 24 && r.low <= r.median && r.median <= r.high && r.item === "day-ahead");
  const rows = parseLmp(unzipFirst(ZIP).toString("utf8"));
  assert.equal(dayRow("NP15", rows.slice(0, 20), "2026-11-05"), null);
  await assert.rejects(() => caisoHarvest(async () => { throw new SourceError("Source returned HTTP 500", "", 500); }, NOW, 0), SourceError);
  assert.equal(caisoHistoryKey("sp15")!.area, "US-SP15");
  assert.equal(caisoHistoryKey("nowhere"), null);
  assert.ok(answerFromHours("NP15", rows, { days: 7 }).sample_size === 168);
});

test("us-caiso-power: registry routing", () => {
  const p = SOURCE_PLUGINS.find((s) => s.info.id === INFO.id)!;
  assert.equal(p.category, "wholesale-power");
  assert.deepEqual(p.countries, ["US"]);
});
