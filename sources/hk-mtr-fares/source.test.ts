// Tests for the Hong Kong MTR fare table. fixtures/mtr_lines_fares.csv holds the REAL header and the real rows for 7 stations
// (Central, Admiralty, Tsim Sha Tsui, Hong Kong, Tung Chung, Sheung Shui, Lo Wu) of https://opendata.mtr.com.hk/data/mtr_lines_fares.csv,
// downloaded 2026-11-05 (Last-Modified 2 Apr 2026). Figures below are copied from that file, not computed by the code.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { InputError, SourceError } from "../../lib/http";
import { INFO, answerFromFares, findStation, hkFares, parseFares, splitLine } from "./source";

const TEXT = readFileSync(new URL("./fixtures/mtr_lines_fares.csv", import.meta.url), "utf8");
// the fixture is small; parseFares wants a full-size file, so pad with copies of real rows under unused ids for the size guard only
const PAD = Array.from({ length: 1100 }, (_, i) => `"Pad ${i}",${1000 + i},"Pad ${i + 1}",${2000 + i},1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0`).join("\n");
const FULL = TEXT.trimEnd() + "\n" + PAD + "\n";
const PAIRS = parseFares(FULL);

test("licence and type", () => {
  assert.match(INFO.licence, /DATA\.GOV\.HK/);
  assert.equal(INFO.price_type, "posted_price");
});

test("csv line splitting", () => {
  assert.deepEqual(splitLine('"Central",1,"Admiralty",2,4.90'), ["Central", "1", "Admiralty", "2", "4.90"]);
  assert.deepEqual(splitLine('"A, B",3'), ["A, B", "3"]);
});

test("parses the real columns and rejects a changed or truncated file", () => {
  assert.ok(PAIRS.length > 1000);
  assert.throws(() => parseFares(TEXT), SourceError); // too few pairs
  assert.throws(() => parseFares('"X","Y"\n"a","b"\n'), SourceError); // wrong columns
});

test("real fares: Central to Tsim Sha Tsui", () => {
  const a = answerFromFares(PAIRS, { from_station: "Central", to_station: "Tsim Sha Tsui" });
  assert.equal(a.status, "ok");
  assert.equal(a.price!.currency, "HKD");
  assert.equal(a.price!.value, 10.6);
  assert.equal(a.sample_size, null);
  assert.equal(a.price_type, "posted_price");
  assert.equal(answerFromFares(PAIRS, { from_station: "central", to_station: "tsim sha tsui", ticket: "single" }).price!.value, 12.5);
  assert.equal(answerFromFares(PAIRS, { from_station: "Central", to_station: "Tsim Sha Tsui", fare_type: "senior" }).price!.value, 2.1);
  assert.equal(answerFromFares(PAIRS, { from_station: "Central", to_station: "Tsim Sha Tsui", fare_type: "senior", ticket: "single" }).price!.value, 5.5);
  assert.equal(answerFromFares(PAIRS, { from_station: "Central", to_station: "Admiralty" }).price!.value, 4.9);
  assert.equal(answerFromFares(PAIRS, { from_station: "Admiralty", to_station: "Tung Chung", fare_type: "disability" }).price!.value, 4.9);
  assert.equal(answerFromFares(PAIRS, { from_station: "Admiralty", to_station: "Tung Chung" }).price!.value, 24.3);
});

test("station by id and by near name", () => {
  assert.equal(findStation(PAIRS, "43", "to_station").name, "Tung Chung");
  assert.equal(findStation(PAIRS, "Tsim Sha Tsui", "x").id, 3);
  assert.throws(() => findStation(PAIRS, "Tsim", "from_station"), (e: any) => e instanceof InputError && /Tsim Sha Tsui/.test(e.message));
  assert.throws(() => findStation(PAIRS, "Atlantis", "from_station"), InputError);
});

test("input errors list what to give", () => {
  assert.throws(() => answerFromFares(PAIRS, {}), (e: any) => e instanceof InputError && /from_station and to_station/.test(e.message));
  assert.throws(() => answerFromFares(PAIRS, { from_station: "Central", to_station: "Central" }), InputError);
  assert.throws(() => answerFromFares(PAIRS, { from_station: "Central", to_station: "Admiralty", fare_type: "student" }), InputError);
  assert.throws(() => answerFromFares(PAIRS, { from_station: "Central", to_station: "Admiralty", ticket: "bus" }), InputError);
  assert.throws(() => answerFromFares(PAIRS, { from_station: "Central", to_station: "Admiralty", fare_type: "disability", ticket: "single" }), InputError);
});

test("hkFares with an injected loader carries the file date", async () => {
  const a = await hkFares({ from_station: "Central", to_station: "Admiralty" }, async () => ({ text: FULL, modified: "2026-04-02" }));
  assert.equal(a.status, "ok");
  assert.equal(a.period?.from, "2026-04-02");
});
