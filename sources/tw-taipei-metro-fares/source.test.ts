// Tests for the Taipei Metro fare table. fixtures/taipei_metro_fares.csv holds the REAL header and the real rows (Big5 bytes, duplicates kept)
// for 6 stations (台北車站, 台北101/世貿, 松山機場, 淡水, 西門, 南港展覽館) of the data.taipei download, fetched 2026-11-05.
// Figures below are copied from that file, not computed by the code.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { InputError, SourceError } from "../../lib/http";
import { INFO, answerFromFares, dateFromContentDisposition, decodeBig5, findStation, parseFares, twFares } from "./source";

const BYTES = readFileSync(new URL("./fixtures/taipei_metro_fares.csv", import.meta.url));
const TEXT = decodeBig5(BYTES);
const PAD = Array.from({ length: 1100 }, (_, i) => `Pad${i},Pad${i + 1},20,8,1.0`).join("\n");
const FULL = TEXT.trimEnd() + "\n" + PAD + "\n";
const PAIRS = parseFares(FULL);

test("licence and type", () => {
  assert.match(INFO.licence, /Open Government Data License/);
  assert.equal(INFO.price_type, "posted_price");
});

test("decodes Big5 and dedupes the repeated rows", () => {
  assert.ok(TEXT.includes("台北車站"));
  assert.equal(PAIRS.filter((p) => p.from === "台北車站" && p.to === "淡水").length, 1);
  assert.throws(() => parseFares(TEXT), SourceError); // too few pairs
  assert.throws(() => parseFares("a,b\n1,2\n"), SourceError); // wrong columns
});

test("real fares", () => {
  const a = answerFromFares(PAIRS, { from_station: "Taipei Main Station", to_station: "Taipei 101" });
  assert.equal(a.status, "ok");
  assert.equal(a.price!.currency, "TWD");
  assert.equal(a.price!.value, 25);
  assert.equal(a.sample_size, null);
  assert.equal(a.price_type, "posted_price");
  assert.equal(answerFromFares(PAIRS, { from_station: "台北車站", to_station: "淡水" }).price!.value, 50);
  assert.equal(answerFromFares(PAIRS, { from_station: "台北車站", to_station: "淡水", fare_type: "senior" }).price!.value, 20);
  assert.equal(answerFromFares(PAIRS, { from_station: "taipei main station", to_station: "ximen", fare_type: "disability" }).price!.value, 8);
  assert.equal(answerFromFares(PAIRS, { from_station: "Taipei Main Station", to_station: "Nangang Exhibition Center" }).price!.value, 30);
  assert.equal(answerFromFares(PAIRS, { from_station: "Taipei Main Station", to_station: "Songshan Airport" }).price!.value, 25);
});

test("station lookup", () => {
  assert.equal(findStation(PAIRS, "Tamsui", "x"), "淡水");
  assert.equal(findStation(PAIRS, "西門", "x"), "西門");
  assert.throws(() => findStation(PAIRS, "Atlantis", "from_station"), InputError);
});

test("input errors", () => {
  assert.throws(() => answerFromFares(PAIRS, {}), (e: any) => e instanceof InputError && /origin_station and destination_station/.test(e.message));
  assert.throws(() => answerFromFares(PAIRS, { from_station: "西門", to_station: "西門" }), InputError);
  assert.throws(() => answerFromFares(PAIRS, { from_station: "西門", to_station: "淡水", fare_type: "student" }), InputError);
});

test("file date from the download name", () => {
  const cd = `attachment; filename*=UTF-8''%E8%87%BA%E5%8C%97%E6%8D%B7%E9%81%8B%E7%B3%BB%E7%B5%B1%E7%A5%A8%E5%83%B9%E8%B3%87%E6%96%99%281150929%29.csv`;
  assert.equal(dateFromContentDisposition(cd), "2026-09-29");
  assert.equal(dateFromContentDisposition(null), null);
});

test("twFares with an injected loader", async () => {
  const a = await twFares({ from_station: "台北車站", to_station: "西門" }, async () => ({ bytes: new Uint8Array(Buffer.from(Buffer.concat([BYTES, Buffer.from(PAD + "\n", "latin1")]))), published: "2026-09-29" }));
  assert.equal(a.status, "ok");
  assert.equal(a.price!.value, 20);
  assert.equal(a.period?.from, "2026-09-29");
});
