// Fixture in ./fixtures is the real OMIE file marginalpdbc_20261019.1 copied on 2026-10-20 from GitHub's servers (96 quarter-hour periods, CRLF, closing "*" line).
// The clock-change test builds a 92-period day from the same real prices (synthetic: 2026-03-29 is the spring change in Spain).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SourceError } from "../../lib/http";
import { SOURCE_PLUGINS } from "../../lib/registry";
import { COUNTRIES, INFO, dayRow, fileUrl, hourlyPoints, loadDay, madridMidnightUtc, omieDayAhead, omieHarvest, omieHistoryKey, parseMarginal, summariseSigned } from "./source";

const FILE = readFileSync(new URL("./fixtures/marginalpdbc_20261019.1", import.meta.url), "utf8");
const NOW = new Date("2026-10-20T12:00:00Z");
const get = async (url: string) => {
  if (url.endsWith("20261019.1")) return FILE;
  if (url.endsWith("20261020.1")) return FILE.replace(/2026;10;19;/g, "2026;10;20;");
  if (url.endsWith("20261021.1")) throw new SourceError("Source returned HTTP 404", "", 404);
  return FILE.replace(/2026;10;19;/g, "2026;10;" + url.slice(-4, -2) + ";"); // older days: same prices, own date
};

test("es-omie: parses the real file (96 periods, header and closing star)", () => {
  const d = parseMarginal(FILE);
  assert.equal(d.date, "2026-10-19");
  assert.equal(d.periods.length, 96);
  assert.equal(d.periods[0].es, 179);
  assert.throws(() => parseMarginal("<html>nope</html>"), SourceError);
  assert.throws(() => parseMarginal("MARGINALPDBC;\r\n2026;10;19;x;1;2;\r\n*\r\n"), SourceError);
  assert.throws(() => parseMarginal("MARGINALPDBC;\r\n*\r\n"), SourceError);
});

test("es-omie: quarter-hours are averaged into 24 hours placed on the Madrid clock", () => {
  const pts = hourlyPoints(parseMarginal(FILE), "ES");
  assert.equal(pts.length, 24);
  assert.equal(new Date(pts[0].ts).toISOString(), "2026-10-18T22:00:00.000Z"); // 00:00 CEST = 22:00 UTC the day before
  assert.equal(Math.round(pts[0].price * 100) / 100, Math.round(((179 + 176.4 + 175.8 + 173.1) / 4) * 100) / 100);
  assert.throws(() => hourlyPoints(parseMarginal(FILE), "FR"), SourceError);
});

test("es-omie: clock-change days (92 and 100 periods, 23 and 25 hourly rows) still map to elapsed hours", () => {
  const mk = (date: string, n: number) =>
    parseMarginal("MARGINALPDBC;\r\n" + Array.from({ length: n }, (_, i) => `${date.replace(/-/g, ";").replace(/;0/g, ";")};${i + 1};${100 + i};${100 + i};`).join("\r\n") + "\r\n*\r\n");
  assert.equal(hourlyPoints(mk("2026-03-29", 92), "ES").length, 23);
  assert.equal(hourlyPoints(mk("2026-10-25", 100), "PT").length, 25);
  assert.equal(hourlyPoints(mk("2026-10-25", 25), "PT").length, 25);
  assert.equal(madridMidnightUtc("2026-03-29"), Date.parse("2026-03-28T23:00:00Z"));
  assert.equal(madridMidnightUtc("2026-01-15"), Date.parse("2026-01-14T23:00:00Z"));
});

test("es-omie: 1-day answer is a plausible EUR per MWh range with hours as the sample", async () => {
  const a = await omieDayAhead({ country: "ES", days: 1 }, get, NOW);
  assert.equal(a.status, "ok");
  assert.equal(a.price_type, "transaction");
  assert.equal(a.price!.currency, "EUR");
  assert.equal(a.price!.unit, "per MWh");
  assert.ok(a.sample_size! >= 24 && a.sample_size! <= 48);
  assert.ok(a.price!.typical_low! <= a.price!.median! && a.price!.median! <= a.price!.typical_high!);
  assert.ok(a.price!.median! > 20 && a.price!.median! < 400);
  const x = a.extra as any;
  assert.ok(Math.abs(x.cents_per_kwh.median - a.price!.median! / 10) < 0.01);
  assert.match(a.source.licence, /OMIE legal notice/);
  assert.match(a.source.attribution, /own calculations by ProofPrice/);
  assert.match(a.summary, /Not a household price/);
});

test("es-omie: never includes hours after now and skips an unpublished day", async () => {
  const a = await omieDayAhead({ country: "PT", days: 2 }, get, NOW);
  assert.equal(a.status, "ok");
  assert.ok(new Date((a.extra as any).latest_hour.time_utc).getTime() < NOW.getTime());
  assert.equal(await loadDay("2026-10-21", get), null);
  assert.equal(await loadDay("2026-10-22", async () => "<html>not found</html>"), null);
});

test("es-omie: a source outage is an error, not an empty answer", async () => {
  await assert.rejects(() => omieDayAhead({ country: "ES" }, async () => { throw new SourceError("Source timed out"); }, NOW), SourceError);
  await assert.rejects(() => omieDayAhead({ country: "FR" }, get, NOW), /not available/);
});

test("es-omie: fewer than 5 hours gives no range", async () => {
  const only19 = async (url: string) => {
    if (url.endsWith("20261019.1")) return FILE;
    throw new SourceError("Source returned HTTP 404", "", 404);
  };
  const a = await omieDayAhead({ country: "ES", days: 1 }, only19, new Date("2026-10-18T23:30:00Z")); // only 1 hour of the 19th has started
  assert.equal(a.status, "insufficient_data");
  assert.equal(a.price, null);
});

test("es-omie: signed summary keeps negative prices", () => {
  assert.equal(summariseSigned([-10, -2, 0, 5, 20, 40])!.min, -10);
  assert.equal(summariseSigned([]), null);
});

test("es-omie: harvest gives one row each for Spain and Portugal for yesterday", async () => {
  const h = await omieHarvest(get, NOW);
  assert.equal(h.date, "2026-10-19");
  assert.equal(h.rows.length, 2);
  assert.ok(h.rows.every((r) => r.n === 24 && r.low <= r.median && r.median <= r.high && r.item === "day-ahead"));
  assert.equal(dayRow("ES", hourlyPoints(parseMarginal(FILE), "ES").slice(0, 10)), null);
  await assert.rejects(() => omieHarvest(async () => { throw new SourceError("Source returned HTTP 404", "", 404); }, NOW), SourceError);
  assert.equal(omieHistoryKey("es")!.area, "ES");
  assert.equal(omieHistoryKey("FR"), null);
});

test("es-omie: file url and registry routing", () => {
  assert.match(fileUrl("2026-10-19"), /parents=marginalpdbc&filename=marginalpdbc_20261019\.1$/);
  const p = SOURCE_PLUGINS.find((s) => s.info.id === INFO.id)!;
  assert.equal(p.category, "wholesale-power");
  assert.deepEqual([...p.countries].sort(), Object.keys(COUNTRIES).sort());
});
