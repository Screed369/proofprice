// Tests for the Taiwan Railway fare table. fixtures/tra_fares_sample.json holds 13 REAL records (exact field names and values) cut from the
// first 63 MB of the live file (https://ods.railway.gov.tw/tra-ods-web/ods/download/dataResource/b9acae0f5fbf4e689e6aaff2109241b0), fetched 2026-11-11.
// Figures below are copied from that file (cheapest and dearest of the nine class fares), not computed by the code.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { InputError, SourceError } from "../../lib/http";
import { INFO, ObjectSplitter, answerFromRows, findStation, normalRoute, parsePassenger, rowsFromRecords, toRecord, traHistoryKey } from "./source";

const TEXT = readFileSync(new URL("./fixtures/tra_fares_sample.json", import.meta.url), "utf8");
const RAW: any[] = JSON.parse(TEXT);
const RECORDS = RAW.map(toRecord).filter((r): r is NonNullable<ReturnType<typeof toRecord>> => !!r);

test("licence and type", () => {
  assert.match(INFO.licence, /Open Government Data License/);
  assert.equal(INFO.price_type, "posted_price");
  assert.equal(INFO.id, "tw-tra-fares");
});

test("splits the array into objects whatever the chunking, even a brace inside a string", () => {
  for (const size of [1, 7, 1000, 100000]) {
    const got: string[] = [];
    const sp = new ObjectSplitter((j) => got.push(j));
    for (let i = 0; i < TEXT.length; i += size) sp.push(TEXT.slice(i, i + size));
    sp.end();
    assert.equal(got.length, RAW.length, `chunk ${size}`);
    assert.deepEqual(JSON.parse(got[2]), RAW[2]);
  }
  const odd: string[] = [];
  const sp2 = new ObjectSplitter((j) => odd.push(j));
  sp2.push('[{"a":"x}{\\"y"},{"b":1}]');
  sp2.end();
  assert.equal(odd.length, 2);
  assert.throws(() => { const s = new ObjectSplitter(() => {}); s.push('[{"a":1'); s.end(); }, SourceError);
});

test("reads real records", () => {
  const first = RECORDS.find((r) => r.from === "基隆" && r.to === "三坑")!;
  assert.equal(first.km, 1.5);
  assert.equal(first.adult["7"], 11);
  assert.equal(first.adult["11"], 34);
  assert.equal(first.child["4"], 13);
  assert.equal(toRecord({ startStaName: "a", endStaName: "b", mileage: 1, details: [] }), null);
  assert.equal(toRecord(null), null);
});

test("each pair appears twice: the normal route is the shorter one, never the long way round", () => {
  const best = normalRoute(RECORDS);
  const tk = best.get("臺北>基隆")!;
  assert.equal(tk.km, 28.5);
  assert.equal(Math.min(...Object.values(tk.adult)), 30);
  const kt = best.get("基隆>臺北")!; // the file's direction codes are the other way round for this pair
  assert.equal(kt.km, 28.5);
  assert.equal(best.get("臺北>臺中")!.km, 164.6);
});

test("library rows: cheapest and dearest class, no record count", () => {
  const rows = rowsFromRecords(RECORDS);
  const r = rows.find((x) => x.area === "臺北>臺中" && x.item === "adult")!;
  assert.equal(r.median, 174);
  assert.equal(r.max, 500);
  const c = rows.find((x) => x.area === "臺北>臺中" && x.item === "child")!;
  assert.equal(c.median, 87);
  assert.equal(c.max, 250);
  assert.ok(Number.isNaN(r.n));
  assert.ok(!rows.some((x) => x.area.includes("三坑")), "non-key stations are not kept");
});

test("stations by Chinese and English names", () => {
  assert.equal(findStation("Taipei", "x"), "臺北");
  assert.equal(findStation("台北", "x"), "臺北");
  assert.equal(findStation("Taipei Main Station", "x"), "臺北");
  assert.equal(findStation("kaohsiung", "x"), "高雄");
  assert.throws(() => findStation("Atlantis", "origin_station"), (e: any) => e instanceof InputError && /Kaohsiung/.test(e.message));
  assert.throws(() => findStation("", "origin_station"), InputError);
});

test("real fares answer", () => {
  const rows = rowsFromRecords(RECORDS);
  const a = answerFromRows(rows, "2026-11-11", { from_station: "Taipei", to_station: "Taichung" });
  assert.equal(a.status, "ok");
  assert.equal(a.price!.currency, "TWD");
  assert.equal(a.price!.value, 174);
  assert.equal(a.price!.max, 500);
  assert.equal(a.sample_size, null);
  assert.equal(a.price_type, "posted_price");
  assert.equal(answerFromRows(rows, "2026-11-11", { from_station: "Taipei", to_station: "Taichung", passenger: "child" }).price!.value, 87);
  assert.throws(() => answerFromRows(rows, "2026-11-11", { from_station: "Taipei", to_station: "Taipei" }), InputError);
  assert.throws(() => answerFromRows(rows, "2026-11-11", { from_station: "Taipei" }), InputError);
  assert.throws(() => answerFromRows(rows, "2026-11-11", { from_station: "Taipei", to_station: "Kaohsiung" }), SourceError); // pair absent from fixture
  assert.throws(() => answerFromRows(rows, "2026-11-11", { from_station: "Taipei", to_station: "Taichung", fare_type: "senior" }), InputError);
});

test("passenger and history key", () => {
  assert.equal(parsePassenger(undefined), "adult");
  assert.equal(parsePassenger("Child"), "child");
  assert.throws(() => parsePassenger("dog"), InputError);
  assert.deepEqual(traHistoryKey({ from_station: "Taipei", to_station: "Kaohsiung" }), { area: "臺北>高雄", item: "adult", label: "station pair" });
  assert.equal(traHistoryKey({ from_station: "Taipei" }), null);
});
