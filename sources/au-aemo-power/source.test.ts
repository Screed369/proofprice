// Fixture ./fixtures/public_prices_sample.csv = the first 75 "D,DREGION" rows (plus the C and I lines) of the real AEMO file
// PUBLIC_PRICES_202610210000_20261022040503.zip, copied on 2026-10-22 from GitHub's servers (probe aemo-zip2).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import { SourceError, InputError } from "../../lib/http";
import { SOURCE_PLUGINS } from "../../lib/registry";
import { INFO, aemoBackfill, aemoHarvest, aemoHistoryKey, aemoSpot, dayRows, parseListing, parsePublicPrices, resolveRegion, summariseSigned, unzipFirst, type Fetcher } from "./source";

const CSV = readFileSync(new URL("./fixtures/public_prices_sample.csv", import.meta.url), "utf8");

/** A minimal one-file zip (deflate), like the ones AEMO publishes. */
function makeZip(name: string, content: string): Buffer {
  const data = Buffer.from(content, "utf8");
  const comp = deflateRawSync(data);
  const nm = Buffer.from(name);
  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8);
  lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nm.length, 26);
  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(8, 10);
  cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(data.length, 24); cd.writeUInt16LE(nm.length, 28); cd.writeUInt32LE(0, 42);
  const body = Buffer.concat([lh, nm, comp]);
  const cdFull = Buffer.concat([cd, nm]);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cdFull.length, 12); eocd.writeUInt32LE(body.length, 16);
  return Buffer.concat([body, cdFull, eocd]);
}

const LISTING = `<html><body><pre>
<A HREF="/Reports/CURRENT/Public_Prices/PUBLIC_PRICES_202610190000_20261020040503.zip">PUBLIC_PRICES_202610190000_20261020040503.zip</A><br>
<A HREF="/Reports/CURRENT/Public_Prices/PUBLIC_PRICES_202610200000_20261021040504.zip">PUBLIC_PRICES_202610200000_20261021040504.zip</A><br>
<A HREF="/Reports/CURRENT/Public_Prices/PUBLIC_PRICES_202610210000_20261022040503.zip">PUBLIC_PRICES_202610210000_20261022040503.zip</A><br>
</pre></body></html>`;

/** A full synthetic day: 288 intervals x 5 regions, prices around the fixture's real levels. */
function fullDayCsv(base: number): string {
  const head = CSV.split("\n").filter((l) => l.startsWith("I,DREGION"))[0];
  const lines = ["C,NEMP.WORLD,PRICES,AEMO,PUBLIC,2026/10/22,04:05:03,1,,1", head];
  const regs = ["NSW1", "QLD1", "SA1", "TAS1", "VIC1"];
  for (let k = 0; k < 288; k++) {
    const mins = 4 * 60 + 5 + k * 5;
    const hh = String(Math.floor(mins / 60) % 24).padStart(2, "0");
    const mm = String(mins % 60).padStart(2, "0");
    for (const r of regs) {
      const f = head.split(",").map(() => "");
      f[0] = "D"; f[1] = "DREGION"; f[3] = "2"; f[4] = `"2026/10/21 ${hh}:${mm}:00"`; f[5] = "1"; f[6] = r; f[7] = "0"; f[8] = String(base + (k % 10));
      lines.push(f.join(","));
    }
  }
  return lines.join("\n");
}

const fetcher = (days: Record<string, string>): Fetcher => ({
  text: async () => LISTING,
  bytes: async (url) => {
    const key = Object.keys(days).find((k) => url.includes(k));
    if (!key) throw new SourceError("not found", url, 404);
    return makeZip("PUBLIC_PRICES.CSV", days[key]);
  },
});

test("au-aemo-power: the real AEMO csv parses to five-minute regional prices", () => {
  const ivs = parsePublicPrices(CSV);
  assert.equal(ivs.length, 75);
  assert.deepEqual([...new Set(ivs.map((i) => i.region))].sort(), ["NSW1", "QLD1", "SA1", "TAS1", "VIC1"]);
  const nsw = ivs.find((i) => i.region === "NSW1" && i.at === "2026-10-21 08:00");
  assert.equal(nsw?.price, 99.01); // value copied from the real row
  assert.ok(ivs.every((i) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(i.at)));
  assert.ok(ivs.every((i, k) => k === 0 || ivs[k - 1].at <= i.at), "sorted by time");
});

test("au-aemo-power: intervention rows are ignored and the newest run wins", () => {
  const head = CSV.split("\n").filter((l) => l.startsWith("I,DREGION"))[0];
  const row = (run: string, iv: string, rrp: string) => {
    const f = head.split(",").map(() => "");
    f[0] = "D"; f[1] = "DREGION"; f[4] = '"2026/10/21 08:00:00"'; f[5] = run; f[6] = "SA1"; f[7] = iv; f[8] = rrp;
    return f.join(",");
  };
  const ivs = parsePublicPrices([head, row("1", "0", "50"), row("2", "0", "60"), row("2", "1", "9999")].join("\n"));
  assert.equal(ivs.length, 1);
  assert.equal(ivs[0].price, 60);
});

test("au-aemo-power: a changed layout is reported, not guessed", () => {
  assert.throws(() => parsePublicPrices("C,nothing\n"), SourceError);
  assert.throws(() => parsePublicPrices("I,DREGION,,2,SETTLEMENTDATE,RUNNO\nD,DREGION,,2,x,1\n"), /columns/);
  assert.throws(() => parsePublicPrices(CSV.split("\n").filter((l) => !l.startsWith("D,")).join("\n")), /no regional prices/);
});

test("au-aemo-power: the zip is unpacked", () => {
  const z = makeZip("X.CSV", CSV);
  const u = unzipFirst(z);
  assert.equal(u.name, "X.CSV");
  assert.equal(u.data.toString("utf8"), CSV);
  assert.throws(() => unzipFirst(Buffer.from("not a zip at all, just text padding".repeat(3))), SourceError);
});

test("au-aemo-power: the directory listing gives one file per trading day", () => {
  const l = parseListing(LISTING);
  assert.deepEqual(l.map((x) => x.date), ["2026-10-19", "2026-10-20", "2026-10-21"]);
  assert.match(l[2].path, /^\/Reports\/CURRENT\/Public_Prices\/PUBLIC_PRICES_202610210000_/);
  assert.throws(() => parseListing("<html></html>"), SourceError);
});

test("au-aemo-power: regions and aliases", () => {
  assert.equal(resolveRegion().code, "NSW1");
  assert.equal(resolveRegion("vic").code, "VIC1");
  assert.equal(resolveRegion("South Australia").code, "SA1");
  assert.equal(resolveRegion("tas1").code, "TAS1");
  assert.throws(() => resolveRegion("WA"), InputError);
  assert.throws(() => resolveRegion("Perth"), /not in the National Electricity Market/);
});

test("au-aemo-power: negative prices are kept in the statistics", () => {
  const s = summariseSigned([-30, -10, 0, 20, 40, 60, 80])!;
  assert.equal(s.min, -30);
  assert.equal(s.count, 7);
  assert.equal(s.median, 20);
});

test("au-aemo-power: a 3-day answer for the real fixture region is AUD per MWh with five-minute intervals as sample", async () => {
  const f = fetcher({ "202610190000": fullDayCsv(80), "202610200000": fullDayCsv(100), "202610210000": fullDayCsv(120) });
  const a = await aemoSpot({}, f);
  assert.equal(a.status, "ok");
  assert.equal(a.price_type, "transaction");
  assert.equal(a.price!.currency, "AUD");
  assert.equal(a.price!.unit, "per MWh");
  assert.equal(a.sample_size, 3 * 288);
  assert.ok(a.price!.median! >= 80 && a.price!.median! <= 130);
  assert.ok(a.price!.typical_low! <= a.price!.median! && a.price!.median! <= a.price!.typical_high!);
  const x = a.extra as any;
  assert.equal(x.nem_region, "NSW1");
  assert.equal(x.default_region_used, true);
  assert.ok(Math.abs(x.cents_per_kwh.median - a.price!.median! / 10) < 0.01);
  assert.match(x.latest_interval.nem_time, /^2026-10-2\d \d{2}:\d{2}$/);
  assert.match(a.source.licence, /any purpose/);
  assert.match(a.summary, /Not a household price/);
  const one = await aemoSpot({ region: "sa", days: 1 }, f);
  assert.equal(one.sample_size, 288);
  assert.equal((one.extra as any).nem_region, "SA1");
});

test("au-aemo-power: the 15 real fixture intervals of one region give a figure", async () => {
  const f = fetcher({ "202610210000": CSV });
  const a = await aemoSpot({ region: "VIC1", days: 1 }, f);
  assert.equal(a.sample_size, 15); // the fixture holds 15 real VIC1 intervals
  assert.equal(a.status, "ok");
  assert.ok(a.price!.median! > 0 && a.price!.median! < 1000);
});

test("au-aemo-power: the collector writes one row per region for the newest complete trading day", async () => {
  const f = fetcher({ "202610210000": fullDayCsv(100) });
  const h = await aemoHarvest(f);
  assert.equal(h.date, "2026-10-21");
  assert.equal(h.currency, "AUD");
  assert.equal(h.rows.length, 5);
  assert.ok(h.rows.every((r) => r.item === "spot-5min" && r.n === 288));
  assert.equal(dayRows(parsePublicPrices(CSV)).length, 0, "a partial day (15 intervals) is not stored");
  await assert.rejects(() => aemoHarvest(fetcher({ "202610210000": CSV })), SourceError);
});

test("au-aemo-power: backfill covers the days still on the server", async () => {
  const f = fetcher({ "202610190000": fullDayCsv(80), "202610200000": fullDayCsv(100), "202610210000": fullDayCsv(120) });
  const b = await aemoBackfill("2026-10-20", "2026-10-21", f);
  assert.deepEqual(b.periods.map((p) => p.period), ["2026-10-20", "2026-10-21"]);
});

test("au-aemo-power: history key and manifest", () => {
  assert.deepEqual(aemoHistoryKey("QLD"), { area: "QLD1", item: "spot-5min", label: "Queensland (QLD1) wholesale spot power" });
  assert.equal(aemoHistoryKey("Perth"), null);
  const p = SOURCE_PLUGINS.find((s) => s.info.id === "au-aemo-power")!;
  assert.deepEqual(p.countries, ["AU"]);
  assert.equal(p.category, "wholesale-power");
  assert.equal(INFO.id, "au-aemo-power");
});
