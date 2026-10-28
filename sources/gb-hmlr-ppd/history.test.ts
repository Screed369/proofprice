import { test } from "node:test";
import assert from "node:assert/strict";
import { GbYearAccumulator, feedChunks, gbBackfill, gbHistoryKey, districtSlug, GB_MIN_PRICE } from "./history";
import { categoryById, runHistory } from "../../lib/registry";
import { applyBackfill } from "../../lib/library/backfill";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// First row copied from the live file pp-2025.csv (probed 23 Oct 2026, 169,648,191 bytes); the others follow its 16-field layout.
const live = '"{402A3A66-B9C5-A7DF-E063-4804A8C0B80D}","115000","2025-08-29 00:00","S42 5JL","T","N","F","4","","NORTH STREET","NORTH WINGFIELD","CHESTERFIELD","NORTH EAST DERBYSHIRE","DERBYSHIRE","B","A"';
const row = (price: number, date: string, type: string, district: string, cat = "A", status = "A") =>
  `"{X}","${price}","${date} 00:00","AB1 2CD","${type}","N","F","1, FLAT 2","","SOME STREET","","TOWN","${district}","COUNTY","${cat}","${status}"`;

test("GB history: category B and deleted records are not counted; address fields never stored", () => {
  const a = new GbYearAccumulator();
  a.addLine(live); // category B -> ignored
  a.addLine(row(200000, "2024-03-05", "D", "CAMDEN"));
  a.addLine(row(210000, "2024-03-06", "D", "CAMDEN", "A", "D")); // deleted
  a.addLine(row(5000, "2024-03-07", "D", "CAMDEN")); // under the floor
  a.addLine("garbage");
  assert.equal(a.kept, 1);
  assert.equal(a.rejected, 2);
  const json = JSON.stringify([...a.periods()]);
  assert.ok(!/SOME STREET|AB1|TOWN/.test(json));
});

test("GB history: monthly medians per district and E&W, groups under 5 dropped, chunk boundaries safe", async () => {
  const lines: string[] = [];
  for (let i = 0; i < 6; i++) lines.push(row(100000 + i * 10000, "2024-03-10", i % 2 ? "T" : "F", "LEEDS"));
  for (let i = 0; i < 4; i++) lines.push(row(300000, "2024-03-11", "D", "CAMDEN")); // only 4 -> dropped
  lines.push(row(120000, "2024-04-01", "S", "LEEDS"));
  const text = lines.join("\n") + "\n";
  async function* chunks() { for (let i = 0; i < text.length; i += 37) yield text.slice(i, i + 37); }
  const a = new GbYearAccumulator();
  await feedChunks(chunks(), a);
  const p = a.periods();
  const march = p.get("2024-03")!;
  const leedsAny = march.find((r) => r.area === "leeds" && r.item === "any/month")!;
  assert.equal(leedsAny.n, 6);
  assert.equal(leedsAny.median, 125000);
  assert.ok(march.find((r) => r.area === "ALL" && r.item === "any/month" && r.n === 10));
  assert.ok(!march.some((r) => r.area === "camden")); // 4 sales
  assert.ok(!march.some((r) => r.area === "leeds" && r.item !== "any/month")); // councils: all homes only
  assert.ok(march.find((r) => r.area === "ALL" && r.item === "terraced/month" && r.n === 3 + 0) === undefined); // 3 terraced -> under 5
  assert.ok(!p.has("2024-04")); // 1 sale
});

test("GB history: labels are short, two councils never share one, long names shortened", () => {
  assert.equal(districtSlug("Kensington & Chelsea"), "kensington-and-chelsea");
  assert.equal(districtSlug("KINGSTON UPON HULL, CITY OF"), "kingston-hull-city");
  assert.equal(districtSlug("BOURNEMOUTH, CHRISTCHURCH AND POOLE"), "bournemouth-christchurch");
  assert.equal(districtSlug("Westminster"), "city-of-westminster");
  const a = new GbYearAccumulator();
  for (let i = 0; i < 5; i++) a.addLine(row(150000, "2024-01-02", "D", "KINGSTON UPON HULL, CITY OF"));
  for (let i = 0; i < 5; i++) a.addLine(row(150000, "2024-01-02", "D", "KINGSTON HULL CITY"));
  for (let i = 0; i < 6; i++) { a.addLine(row(150000, "2024-01-02", "D", "BRISTOL")); a.addLine(row(150000, "2024-01-02", "D", "CITY OF BRISTOL")); }
  assert.ok(a.collisions.has("kingston-hull-city"));
  assert.ok(!a.collisions.has("city-of-bristol")); // same council under two spellings
  assert.equal(a.periods().get("2024-01")!.find((r) => r.area === "city-of-bristol")!.n, 12);
  assert.ok(![...a.periods().get("2024-01")!].some((r) => r.area === "kingston-hull-city"));
});

test("GB history: backfill loads whole months only, holds back the newest two, and passes the platform rules", async () => {
  const mk = (month: string, n: number) => Array.from({ length: n }, (_v, i) => row(150000 + i * 1000, `${month}-0${1 + (i % 8)}`, "T", "LEEDS")).join("\n") + "\n";
  const files: Record<number, string> = { 2023: mk("2023-11", 6) + mk("2023-12", 6), 2024: mk("2024-01", 6) + mk("2024-02", 6) + mk("2024-03", 6) };
  const res = await gbBackfill("2023-01-01", "2024-12-31", {
    openYear: async function* (y) { yield files[y] ?? ""; },
    log: () => {},
    pauseMs: 0,
  });
  // newest sale is in 2024-03; two months held back -> 2024-01 is the last month loaded
  assert.deepEqual(res.periods.map((p) => p.period), ["2023-11", "2023-12", "2024-01"]);
  assert.ok(res.periods.every((p) => p.rows.every((r) => r.n >= 5)));
  const dir = mkdtempSync(path.join(tmpdir(), "gbhist-"));
  process.env.PROOFPRICE_LIBRARY_DIR = dir;
  const rep = applyBackfill("gb-hmlr-ppd", res, { dryRun: false, today: new Date("2026-10-23T00:00:00Z") });
  assert.equal(rep.dropped_invalid, 0);
  assert.equal(rep.monthly_rows, res.periods.reduce((n, p) => n + p.rows.length, 0));
  assert.ok(readdirSync(path.join(dir, "gb-hmlr-ppd", "history")).length >= 1);
  const csv = readFileSync(path.join(dir, "gb-hmlr-ppd", "history", "2023.csv"), "utf8");
  assert.ok(!/STREET|AB1/.test(csv));
  assert.equal(GB_MIN_PRICE, 10000);
  // and the history answer reads it (a source with a backfill but no daily collector)
  const h = runHistory(categoryById("home-sales")!, { country: "GB", district: "Leeds", months: 36 }, {}, new Date("2026-10-23T00:00:00Z"));
  assert.equal(h.status, "ok");
  assert.deepEqual(h.series.map((x) => x.date), ["2023-11", "2023-12", "2024-01"]);
  assert.equal(h.source.id, "gb-hmlr-ppd");
  assert.equal(h.currency, "GBP");
  assert.equal(h.unit, "per home");
  assert.throws(() => runHistory(categoryById("home-sales")!, { country: "GB", district: "Leeds" }, {}, new Date()), /months/);
});

test("GB history: keys", () => {
  assert.deepEqual(gbHistoryKey({ district: "Camden" }, { monthly: true }), { area: "camden", item: "any/month", label: "Camden (local authority), England & Wales" });
  assert.deepEqual(gbHistoryKey({}, { monthly: true }), { area: "ALL", item: "any/month", label: "England & Wales" });
  assert.equal(gbHistoryKey({ property_type: "castle" }, { monthly: true }), null);
  assert.throws(() => gbHistoryKey({ district: "Camden", property_type: "terraced" }, { monthly: true }), /whole of England/);
  assert.deepEqual(gbHistoryKey({ property_type: "terraced" }, { monthly: true }), { area: "ALL", item: "terraced/month", label: "England & Wales" });
  assert.throws(() => gbHistoryKey({ district: "Camden" }, { monthly: false }), /months/);
});

// ---------- daily collector + stale-if-error key (Depth Builder, 28 Oct 2026) ----------
import { gbHarvest } from "./history";

test("GB harvest: the newest WHOLE month (two held back), councils all homes, E&W by type, dated by the month's last day", async () => {
  const lines: string[] = [];
  for (let i = 0; i < 6; i++) lines.push(row(200000 + i * 10000, "2026-08-10", "T", "LEEDS")); // the month to keep
  for (let i = 0; i < 6; i++) lines.push(row(300000, "2026-09-10", "D", "LEEDS")); // too new: held back
  for (let i = 0; i < 6; i++) lines.push(row(310000, "2026-10-20", "D", "LEEDS")); // newest sale -> holds back Sep, Oct
  for (let i = 0; i < 3; i++) lines.push(row(150000, "2026-08-11", "F", "CAMDEN")); // under 5
  const text = lines.join("\n") + "\n";
  const asked: number[] = [];
  const r = await gbHarvest({
    today: new Date("2026-10-28T03:17:00Z"),
    log: () => {},
    openYear: async function* (y) { asked.push(y); yield text; },
  });
  assert.deepEqual(asked, [2026]);
  assert.equal(r.date, "2026-08-31");
  assert.equal(r.currency, "GBP");
  const leeds = r.rows.find((x) => x.area === "leeds" && x.item === "any/month")!;
  assert.equal(leeds.n, 6);
  assert.equal(leeds.median, 225000);
  assert.ok(r.rows.find((x) => x.area === "ALL" && x.item === "terraced/month" && x.n === 6));
  assert.ok(!r.rows.some((x) => x.area === "camden"));
  assert.ok(!JSON.stringify(r).includes("SOME STREET"));
});

test("GB harvest: in January the held-back month lies in the previous year's file", async () => {
  const text = [...Array(6)].map(() => row(250000, "2025-11-05", "S", "LEEDS")).join("\n") + "\n" + row(260000, "2026-01-03", "S", "LEEDS") + "\n";
  const tail = row(1, "2026-01-03", "S", "LEEDS");
  const asked: number[] = [];
  const r = await gbHarvest({
    today: new Date("2026-01-15T03:17:00Z"),
    log: () => {},
    pauseMs: 0,
    openYear: async function* (y) { asked.push(y); yield y === 2026 ? [...Array(6)].map(() => row(260000, "2026-01-03", "S", "LEEDS")).join("\n") + "\n" : text + tail; },
  });
  assert.deepEqual(asked, [2026, 2025]);
  assert.equal(r.date, "2025-11-30");
});

test("GB harvest: nothing usable is an error, never an empty day", async () => {
  await assert.rejects(gbHarvest({ today: new Date("2026-10-28T00:00:00Z"), log: () => {}, pauseMs: 0, openYear: async function* () { yield "garbage\n"; } }));
});

test("GB history key: stale-if-error accepts the daily copy; a postcode district or a type for a council gets none; /history stays monthly-only", () => {
  assert.deepEqual(gbHistoryKey({ town: "Bristol" }, { stale: true }), { area: "city-of-bristol", item: "any/month", label: "City Of Bristol (local authority), England & Wales" });
  assert.equal(gbHistoryKey({ town: "Bristol", postcode_district: "BS8" }, { stale: true }), null);
  assert.throws(() => gbHistoryKey({ town: "Bristol", property_type: "terraced" }, { stale: true }));
  assert.equal(gbHistoryKey({ property_type: "terraced" }, { stale: true })!.item, "terraced/month");
  assert.throws(() => gbHistoryKey({ town: "Bristol" }, { monthly: false }), /monthly figures/);
});
