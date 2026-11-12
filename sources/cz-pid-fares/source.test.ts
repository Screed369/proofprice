// Tests for the Prague PID fare table. fixtures/fare_attributes.txt is the REAL file read on 2026-11-12 from https://data.pid.cz/PID_GTFS.zip.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import { InputError, SourceError } from "../../lib/http";
import { INFO, answerFromFares, findEntry, parseFareAttributes, pidFares } from "./source";

const TEXT = readFileSync(new URL("./fixtures/fare_attributes.txt", import.meta.url), "utf8");

test("licence and type", () => {
  assert.match(INFO.licence, /CC BY 4\.0/);
  assert.equal(INFO.price_type, "posted_price");
});

test("parses the real fare table", () => {
  const f = parseFareAttributes(TEXT);
  assert.equal(f.length, 17);
  assert.equal(f.find((x) => x.id === "T90_P")!.price, 50);
  assert.equal(f.find((x) => x.id === "T30_P")!.validity_seconds, 1800);
  assert.equal(f.find((x) => x.id === "TAE")!.price, 200);
  assert.throws(() => parseFareAttributes("fare_id,price\nX,1"), SourceError);
  assert.throws(() => parseFareAttributes("fare_id,price,currency_type\nA,1,CZK"), SourceError);
});

test("adult: 90-minute ticket 50 CZK, posted, no sample size", () => {
  const a = answerFromFares(parseFareAttributes(TEXT), {}, "2026-11-12");
  assert.equal(a.status, "ok");
  assert.equal(a.price!.currency, "CZK");
  assert.equal(a.price!.value, 50);
  assert.equal(a.sample_size, null);
  assert.equal(a.price_type, "posted_price");
  const products = (a.extra as any).products as Array<{ product: string; price_czk: number }>;
  assert.ok(products.some((p) => p.product === "30-minute ticket" && p.price_czk === 39));
  assert.equal(products.filter((p) => p.product === "90-minute ticket").length, 1);
});

test("unsupported groups are clear input errors", () => {
  const f = parseFareAttributes(TEXT);
  assert.throws(() => answerFromFares(f, { fare_type: "student" }), InputError);
  assert.throws(() => answerFromFares(f, { travel_time: "early" }), InputError);
  assert.throws(() => answerFromFares(f, { distance_km: -1 }), InputError);
});

test("pidFares uses the injected reader", async () => {
  const a = await pidFares({ fare_type: "adult", distance_km: 7 }, async () => TEXT);
  assert.equal(a.price!.value, 50);
});

test("findEntry reads a zip central directory", () => {
  const name = Buffer.from("fare_attributes.txt");
  const data = deflateRawSync(Buffer.from(TEXT));
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(name.length, 26);
  const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(8, 10); cd.writeUInt32LE(data.length, 20);
  cd.writeUInt16LE(name.length, 28); cd.writeUInt32LE(0, 42);
  const cdOff = local.length + name.length + data.length;
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt32LE(cd.length + name.length, 12); eocd.writeUInt32LE(cdOff, 16);
  const zip = Buffer.concat([local, name, data, cd, name, eocd]);
  const hit = findEntry(zip, 0, "fare_attributes.txt")!;
  assert.deepEqual(hit, { offset: 0, csize: data.length, method: 8 });
  assert.equal(findEntry(zip, 0, "nope.txt"), null);
});
