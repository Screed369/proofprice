// Tests for the JP official land prices. fixtures/tokyo-sample.geojson = 21 REAL features (7 each in Chiyoda, Setagaya and Shibuya) copied from
// https://nlftp.mlit.go.jp/ksj/gml/data/L01/L01-26/L01-26_13_GML.zip (L01-26_13.geojson, 2,560 features) on 2026-11-01, keeping only the
// properties the source reads (L01_001, 004, 007, 008, 009, 024, 028, 051) and one dummy point geometry. Medians below were computed
// independently in Python from the same values (Chiyoda 4,070,000; Setagaya 814,000; Shibuya 1,750,000 yen/m²).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { InputError, SourceError } from "../../lib/http";
import { INFO, answerFromPlots, jpLandPrices, parsePlots, resolvePlace, unzipEntry, editionYears } from "./source";

const TEXT = readFileSync(new URL("./fixtures/tokyo-sample.geojson", import.meta.url), "utf8");
const PARSED = parsePlots(TEXT, 2026);

test("licence and honest type", () => {
  assert.match(INFO.licence, /PDL1\.0/);
  assert.equal(INFO.price_type, "posted_price");
  assert.match(INFO.attribution, /国土交通省/);
});

test("parse: 21 plots, price in yen per m²", () => {
  assert.equal(PARSED.plots.length, 21);
  assert.equal(PARSED.dropped, 0);
  assert.equal(PARSED.plots[0].price, 4410000);
  assert.equal(PARSED.plots[0].municipality, "千代田");
});

test("parse: a layout we do not know is refused, never answered", () => {
  assert.throws(() => parsePlots(TEXT, 2025), SourceError); // year field says 2026
  assert.throws(() => parsePlots("not json", 2026), SourceError);
});

test("places: Tokyo ward in English or Japanese, prefecture names, errors tell what to give", () => {
  assert.equal(resolvePlace(undefined, "Shibuya").municipality, "渋谷");
  assert.equal(resolvePlace(undefined, "Shibuya-ku").municipality, "渋谷");
  assert.equal(resolvePlace(undefined, "渋谷区").municipality, "渋谷");
  assert.equal(resolvePlace(undefined, "Osaka").prefecture.code, "27");
  assert.equal(resolvePlace("Osaka").municipality, null);
  assert.equal(resolvePlace("27", "北").municipality, "北");
  assert.equal(resolvePlace("東京都").prefecture.en, "Tokyo");
  assert.throws(() => resolvePlace(undefined, undefined), InputError);
  assert.throws(() => resolvePlace(undefined, "梅田"), /add the prefecture/);
  assert.throws(() => resolvePlace("Atlantis"), /not recognised/);
});

test("answer: Shibuya median 1,750,000 yen/m² from 7 plots, labelled as appraisals", () => {
  const a = answerFromPlots(PARSED, resolvePlace(undefined, "Shibuya"), { town: "Shibuya" });
  assert.equal(a.status, "ok");
  assert.equal(a.sample_size, 7);
  assert.equal(a.price?.currency, "JPY");
  assert.equal(a.price?.median, 1750000);
  assert.deepEqual(a.period, { from: "2026-01-01", to: "2026-01-01" });
  assert.match(a.evidence?.label ?? "", /appraisal/i);
  assert.match(a.summary, /not recorded sales/);
});

test("answer: whole prefecture and Chiyoda", () => {
  const all = answerFromPlots(PARSED, resolvePlace("Tokyo"), {});
  assert.equal(all.sample_size, 21);
  const c = answerFromPlots(PARSED, resolvePlace(undefined, "Chiyoda"), {});
  assert.equal(c.price?.median, 4070000);
});

test("answer: fewer than 5 plots gives no range; commercial filter uses zoning", () => {
  const few = { ...PARSED, plots: PARSED.plots.filter((p) => p.municipality === "渋谷").slice(0, 4) };
  const a = answerFromPlots(few, resolvePlace(undefined, "Shibuya"), {});
  assert.equal(a.status, "insufficient_data");
  assert.equal(a.price, null);
  // the sample has only residential zones, so commercial finds nothing
  assert.equal(answerFromPlots(PARSED, resolvePlace(undefined, "Shibuya"), { property_type: "commercial" }).status, "no_matches");
  // test variant: mark the six cheapest Shibuya plots as 商業 zone
  const mod = { ...PARSED, plots: PARSED.plots.map((p) => (p.municipality === "渋谷" && p.price < 3000000 ? { ...p, zoning: "商業" } : p)) };
  const c = answerFromPlots(mod, resolvePlace(undefined, "Shibuya"), { property_type: "commercial" });
  assert.equal(c.sample_size, 6);
  assert.equal(c.price?.median, 1675000);
});

test("answer: postcode and bad property_type are input errors", () => {
  assert.throws(() => answerFromPlots(PARSED, resolvePlace("Tokyo"), { postcode: "150-0002" }), InputError);
  assert.throws(() => answerFromPlots(PARSED, resolvePlace("Tokyo"), { property_type: "farmland" }), InputError);
});

test("zip: reads the .geojson entry from a stored-method zip", () => {
  const name = Buffer.from("L01-26_13_GML/L01-26_13.geojson");
  const other = Buffer.from("KS-META.xml");
  const body = Buffer.from(TEXT);
  const lh = (n: Buffer, d: Buffer) => {
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt32LE(d.length, 18); h.writeUInt32LE(d.length, 22); h.writeUInt16LE(n.length, 26);
    return Buffer.concat([h, n, d]);
  };
  const e1 = lh(other, Buffer.from("<x/>"));
  const e2 = lh(name, body);
  const ch = (n: Buffer, d: Buffer, off: number) => {
    const h = Buffer.alloc(46);
    h.writeUInt32LE(0x02014b50, 0); h.writeUInt32LE(d.length, 20); h.writeUInt32LE(d.length, 24); h.writeUInt16LE(n.length, 28); h.writeUInt32LE(off, 42);
    return Buffer.concat([h, n]);
  };
  const c1 = ch(other, Buffer.from("<x/>"), 0);
  const c2 = ch(name, body, e1.length);
  const cdOff = e1.length + e2.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(2, 8); eocd.writeUInt16LE(2, 10); eocd.writeUInt32LE(c1.length + c2.length, 12); eocd.writeUInt32LE(cdOff, 16);
  const zip = Buffer.concat([e1, e2, c1, c2, eocd]);
  assert.equal(unzipEntry(zip, ".geojson").toString("utf8"), TEXT);
  assert.throws(() => unzipEntry(zip, ".shp"), SourceError);
  assert.throws(() => unzipEntry(Buffer.from("nope nope nope nope nope nope"), ".geojson"), SourceError);
});

test("editions are tried newest first", () => {
  assert.deepEqual(editionYears(new Date("2026-11-01T00:00:00Z")), [2026, 2025, 2024]);
});

test("end to end with a fetcher: asks the Tokyo file for a ward", async () => {
  let asked = "";
  const a = await jpLandPrices({ town: "Setagaya" }, async (code) => ((asked = code), PARSED));
  assert.equal(asked, "13");
  assert.equal(a.price?.median, 814000);
});
