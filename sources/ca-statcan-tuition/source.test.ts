// Tests for Canada tuition fees (Statistics Canada table 37-10-0045-01). Rows are real, captured 2026-10-20 (see fixtures.ts).
import test from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { InputError, SourceError } from "../../lib/http";
import { TUITION_CSV } from "./fixtures";
import { INFO, caTuition, caTuitionHarvest, clearCache, csvFields, parseFeeCsv, resolveGeo, tuitionAnswer, tuitionHarvestRows, tuitionHistoryKey, unzipCsv } from "./source";
import manifest from "./index";

const rows = parseFeeCsv(TUITION_CSV);

/** A one-file zip archive (deflate) built in memory. */
function zipOf(name: string, content: string): Buffer {
  const data = deflateRawSync(Buffer.from(content, "utf8"));
  const nm = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt16LE(nm.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt16LE(nm.length, 28);
  central.writeUInt32LE(0, 42);
  const cdOffset = 30 + nm.length + data.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(46 + nm.length, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  return Buffer.concat([local, nm, data, central, nm, eocd]);
}

test("the CSV parser reads quoted fields and the BOM, and keeps only dollar rows", () => {
  assert.deepEqual(csvFields('"2026/2027","St. John\'s, NL","x"'), ["2026/2027", "St. John's, NL", "x"]);
  assert.equal(rows.length, 60);
  const yukon = rows.filter((r) => r.geo === "Yukon" && r.year === "2026/2027");
  assert.equal(yukon.length, 4);
  assert.equal(yukon.filter((r) => r.value === null).length, 3);
});

test("a header with missing columns is refused with a plain message", () => {
  assert.throws(() => parseFeeCsv('"REF_DATE","GEO"\n"2026/2027","Canada"'), /columns missing/);
});

test("Canada, undergraduate, home students: the 2026/2027 average, with the change on the year before", () => {
  const a = tuitionAnswer(rows, {});
  assert.equal(a.status, "ok");
  assert.equal(a.price?.value, 8021);
  assert.equal(a.price?.currency, "CAD");
  assert.equal(a.price?.unit, "per academic year");
  assert.equal(a.price?.measure, "average");
  assert.equal(a.price?.median, null);
  assert.equal(a.sample_size, null);
  assert.equal(a.price_type, "official_statistic");
  assert.deepEqual(a.period, { from: "2026-09-01", to: "2027-08-31" });
  assert.equal(a.statistic?.reference_period, "2026-2027");
  const x = a.extra as any;
  assert.equal(x.change_on_previous_year.value, 7772);
  assert.equal(x.change_on_previous_year.percent, 3.2);
  assert.match(a.summary, /2026\/2027 academic year/);
  assert.match(a.summary, /8,021 CAD/);
  assert.match(x.attribution_notice, /^Source: Statistics Canada, .*academic year 2026\/2027\. Reproduced and distributed on an "as is" basis/);
});

test("Ontario international graduate and Quebec graduate come from the right rows", () => {
  const on = tuitionAnswer(rows, { province: "ON", student_group: "international", cycle: "second" });
  assert.equal(on.price?.value, 28900);
  assert.equal((on.query as any).province, "Ontario");
  const qc = tuitionAnswer(rows, { province: "Quebec", cycle: "second" });
  assert.equal(qc.price?.value, 4395);
  const ca = tuitionAnswer(rows, { student_group: "international" });
  assert.equal(ca.price?.value, 42062);
});

test("Yukon has no published figure for most levels: no_matches with a reason, never a made-up number", () => {
  const a = tuitionAnswer(rows, { province: "Yukon", student_group: "international" });
  assert.equal(a.status, "no_matches");
  assert.equal(a.price, null);
  assert.match(a.summary + JSON.stringify(a.statistic), /no figure|try another province/i);
  const ok = tuitionAnswer(rows, { province: "Yukon" });
  assert.equal(ok.price?.value, 4560);
});

test("a wrong place or an unsupported group is a plain 400, not a wrong answer", () => {
  assert.throws(() => resolveGeo("Toronto", ["Canada", "Ontario"]), InputError);
  assert.throws(() => tuitionAnswer(rows, { province: "Nunavut" }), /not in Statistics Canada's tuition table/);
  assert.throws(() => tuitionAnswer(rows, { student_group: "foreign-language" }), /home.*international/);
  assert.throws(() => tuitionAnswer(rows, { study_mode: "part-time" }), /full-time/);
  assert.equal(resolveGeo("BC", ["Canada", "British Columbia"]), "British Columbia");
  assert.equal(resolveGeo(undefined, ["Canada"]), "Canada");
});

test("the zip is unpacked, and a non-zip reply (StatCan's 'site unavailable' page) is retried once", async () => {
  assert.equal(unzipCsv(zipOf("37100045.csv", TUITION_CSV)), TUITION_CSV);
  assert.throws(() => unzipCsv(Buffer.from("<html>The website is currently unavailable</html>")), SourceError);
  clearCache();
  let calls = 0;
  const load = async () => (++calls === 1 ? Buffer.from("<html>unavailable</html>") : zipOf("37100045.csv", TUITION_CSV));
  const a = await caTuition({}, load);
  assert.equal(calls, 2);
  assert.equal(a.price?.value, 8021);
  clearCache();
});

test("the manifest: Canada only, in the tuition category, with a province parameter and working examples", () => {
  assert.equal(manifest.category, "tuition");
  assert.deepEqual(manifest.countries, ["CA"]);
  assert.ok(manifest.extraParams && "province" in manifest.extraParams);
  assert.ok(manifest.examples.length >= 1);
  assert.match(INFO.attribution, /Statistics Canada/);
});

// ---------- daily copy (stale-if-error) ----------

test("harvest: one row per province and level for the newest year, the same figure as the live answer, no made-up count", async () => {
  const h = tuitionHarvestRows(rows);
  assert.equal(h.date, "2026-09-01");
  assert.equal(h.currency, "CAD");
  assert.equal(h.unit, "per academic year");
  const canada = h.rows.find((r) => r.area === "ALL" && r.item === "Canadian undergraduate")!;
  assert.equal(canada.median, tuitionAnswer(rows, {}).price?.value);
  assert.ok(Number.isNaN(canada.n), "official statistic: n is NO_COUNT");
  assert.equal(canada.low, canada.high);
  // Yukon has no usable 2026/2027 figure for most levels: only published figures become rows
  assert.ok(h.rows.every((r) => r.median > 0));
  assert.ok(h.rows.some((r) => r.area === "Ontario"));
  assert.throws(() => tuitionHarvestRows([]), /no usable tuition/);
});

test("harvest reads the zip the same way the live answer does", async () => {
  const h = await caTuitionHarvest(async () => zipOf("37100045.csv", TUITION_CSV));
  assert.ok(h.rows.length > 5);
});

test("history key: Canada is ALL, a province keeps its name, student group and level pick the item, a bad province gives null", () => {
  const areas = ["ALL", "Ontario", "Quebec"];
  assert.deepEqual(tuitionHistoryKey({}, areas), { area: "ALL", item: "Canadian undergraduate", label: "Canada, canadian undergraduate students" });
  assert.equal(tuitionHistoryKey({ province: "ON", student_group: "international", cycle: "second" }, areas)!.item, "International graduate");
  assert.equal(tuitionHistoryKey({ province: "ON" }, areas)!.area, "Ontario");
  assert.equal(tuitionHistoryKey({ province: "Atlantis" }, areas), null);
  assert.equal(tuitionHistoryKey({ cycle: "third" }, areas), null);
});

test("the manifest declares the daily copy for stale-if-error", () => {
  assert.ok(manifest.harvest && manifest.historyKey && manifest.referenceDates && manifest.nominalCounts);
});
