// Fixture fixtures/spot_2026_head.csv = the first 10 real data rows of https://www.jepx.jp/market/excel/spot_2026.csv (2026/04/01, slots 1-10),
// copied on 2026-10-21 from GitHub's servers (probe vjepx2). The header row is Shift-JIS Japanese and is skipped by the parser.
// The "full day" tests build 48 slots by repeating those ten real rows' prices (synthetic: only to exercise day aggregation).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SourceError } from "../../lib/http";
import { SOURCE_PLUGINS } from "../../lib/registry";
import type { LibraryRow } from "../../lib/library/store";
import { INFO, SERIES, answerFromRows, dayRows, fileYears, jepxDayAhead, jepxHarvest, jepxHistoryKey, parseSpotCsv, summariseSigned } from "./source";

const HEAD = readFileSync(new URL("./fixtures/spot_2026_head.csv", import.meta.url), "utf8");
const HEADER = "N,R[h,D(kWh),D(kWh),(kWh),VXevCX(~/kWh)\n"; // garbled Shift-JIS header, as read as latin1

function fullDay(date: string): string {
  const rows = HEAD.trim().split("\n");
  const out: string[] = [];
  for (let slot = 1; slot <= 48; slot++) {
    const f = rows[(slot - 1) % 10].split(",");
    f[0] = date.replace(/-/g, "/");
    f[1] = String(slot);
    out.push(f.join(","));
  }
  return HEADER + out.join("\n") + "\n";
}

test("jp-jepx-spot: parses the real rows (system price and nine areas)", () => {
  const days = parseSpotCsv(HEADER + HEAD);
  assert.equal(days.length, 1);
  assert.equal(days[0].date, "2026-04-01");
  assert.equal(days[0].slots, 10);
  assert.equal(days[0].prices["JP"][0], 17.75);
  assert.equal(days[0].prices["JP"][1], 14.83);
  assert.equal(days[0].prices["JP-TOKYO"][0], 20.15);
  assert.equal(days[0].prices["JP-KYUSHU"][0], 8.78);
  assert.equal(SERIES.length, 10);
});

test("jp-jepx-spot: an unexpected layout or an empty file is an error", () => {
  assert.throws(() => parseSpotCsv("<html>nope</html>"), SourceError);
  assert.throws(() => parseSpotCsv("2026/04/01,x,1,2,3\n"), SourceError);
  assert.throws(() => parseSpotCsv("2026/04/01,1,1,2\n"), SourceError);
});

test("jp-jepx-spot: a partial day gives no library rows, a full day gives 10 rows of 48 half-hours", () => {
  assert.deepEqual(dayRows(parseSpotCsv(HEADER + HEAD)[0]), []);
  const rows = dayRows(parseSpotCsv(fullDay("2026-04-02"))[0]);
  assert.equal(rows.length, 10);
  assert.ok(rows.every((r) => r.n === 48 && r.item === "day-ahead" && r.low <= r.median && r.median <= r.high));
  assert.equal(rows[0].area, "JP");
  assert.ok(rows[0].median > 10 && rows[0].median < 30); // yen per kWh, plausible for April 2026 in the file
});

test("jp-jepx-spot: harvest takes yesterday (Japan time) from the right fiscal-year file", async () => {
  const urls: string[] = [];
  const get = async (url: string) => {
    urls.push(url);
    return fullDay("2026-10-21") + fullDay("2026-10-20").split("\n").slice(1).join("\n");
  };
  const h = await jepxHarvest(get, new Date("2026-10-22T05:00:00Z")); // 14:00 JST on the 22nd
  assert.equal(h.date, "2026-10-21");
  assert.equal(h.currency, "JPY");
  assert.equal(h.unit, "per kWh");
  assert.equal(h.rows.length, 10);
  assert.deepEqual(urls, ["https://www.jepx.jp/market/excel/spot_2026.csv"]);
  // 23:30 UTC on the 21st is already the 22nd in Japan, so "yesterday" is still the 21st
  assert.equal((await jepxHarvest(get, new Date("2026-10-21T23:30:00Z"))).date, "2026-10-21");
  await assert.rejects(() => jepxHarvest(get, new Date("2026-10-25T05:00:00Z")), /not published/);
  await assert.rejects(() => jepxHarvest(async () => { throw new SourceError("Source timed out"); }), SourceError);
  await assert.rejects(() => jepxHarvest(async () => HEADER + HEAD, new Date("2026-04-02T05:00:00Z")), /incomplete/);
});

test("jp-jepx-spot: January to March days look in the fiscal-year file first", () => {
  assert.deepEqual(fileYears("2026-10-21"), [2026]);
  assert.deepEqual(fileYears("2027-02-10"), [2026, 2027]);
});

const mk = (date: string, area: string, median: number): LibraryRow => ({ date, area, item: "day-ahead", n: 48, median, low: median - 2, high: median + 3, min: median - 4, max: median + 6 });
const latest = { date: "2026-10-21", rows: [mk("2026-10-21", "JP", 14.5), mk("2026-10-21", "JP-TOKYO", 15.1), mk("2026-10-21", "JP-KYUSHU", 11.2)] };
const reader = {
  latest: () => latest,
  range: (from: string, to: string) => [mk("2026-10-19", "JP", 13.9), mk("2026-10-20", "JP", 14.2), mk("2026-10-21", "JP", 14.5)].filter((r) => r.date >= from && r.date <= to),
};

test("jp-jepx-spot: the answer is a plausible yen per kWh range with half-hours as the sample", async () => {
  const a = await jepxDayAhead({ country: "JP", days: 3 }, reader);
  assert.equal(a.status, "ok");
  assert.equal(a.price_type, "transaction");
  assert.equal(a.price!.currency, "JPY");
  assert.equal(a.price!.unit, "per kWh");
  assert.equal(a.sample_size, 48);
  assert.equal(a.price!.median, 14.5);
  assert.ok(a.price!.typical_low! <= a.price!.median! && a.price!.median! <= a.price!.typical_high!);
  const x = a.extra as any;
  assert.equal(x.daily.length, 3);
  assert.equal(x.areas.length, 2);
  assert.equal(x.areas[0].area, "Tokyo");
  assert.match(a.source.attribution, /JEPX/);
  assert.match(a.source.licence, /state the source|出所/);
  assert.match(a.summary, /Not a household price/);
  assert.equal((await jepxDayAhead({ country: "JP", days: 1 }, reader) as any).extra.daily.length, 1);
});

test("jp-jepx-spot: no data yet and a wrong country are errors, a short day gives no range", async () => {
  await assert.rejects(() => jepxDayAhead({ country: "JP" }, { latest: () => null, range: () => [] }), /Not yet available/);
  await assert.rejects(() => jepxDayAhead({ country: "DE" }, reader), /not available/);
  const few = answerFromRows({ date: "2026-10-21", rows: [{ ...mk("2026-10-21", "JP", 14.5), n: 3 }] }, [], { days: 1 });
  assert.equal(few.status, "insufficient_data");
  assert.equal(few.price, null);
});

test("jp-jepx-spot: summary, history key and registry routing", () => {
  assert.equal(summariseSigned([]), null);
  assert.equal(summariseSigned([3, 1, 2])!.median, 2);
  assert.equal(jepxHistoryKey("jp")!.area, "JP");
  assert.equal(jepxHistoryKey("DE"), null);
  const p = SOURCE_PLUGINS.find((s) => s.info.id === INFO.id)!;
  assert.equal(p.category, "wholesale-power");
  assert.deepEqual([...p.countries], ["JP"]);
});
