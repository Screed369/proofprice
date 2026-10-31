// Tests for UK farm-gate milk (Defra). Fixtures are real: content.xml excerpt and API attachment list captured on 2026-10-31.
import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { MILK_API, MILK_CONTENT_XML } from "./fixtures";
import { INFO, gbMilkHarvest, gbMilkPrices, isMilk, milkAnswer, milkHarvestRows, milkHistoryKey, odsUrlFrom, parseMilkSheet, zipEntry } from "./source";
import manifest from "./index";
import { categoryById, countriesFor } from "../../lib/registry";

const series = () => ({ ...parseMilkSheet(MILK_CONTENT_XML), published: "2026-10-29" });

/** A tiny zip with one entry, built here so zipEntry is tested without a binary fixture. */
function makeZip(name: string, data: Buffer, method: 0 | 8): Buffer {
  const body = method === 8 ? deflateRawSync(data) : data;
  const n = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(n.length, 26);
  const cen = Buffer.alloc(46);
  cen.writeUInt32LE(0x02014b50, 0);
  cen.writeUInt16LE(method, 10);
  cen.writeUInt32LE(body.length, 20);
  cen.writeUInt32LE(data.length, 24);
  cen.writeUInt16LE(n.length, 28);
  cen.writeUInt32LE(0, 42);
  const cenOffset = 30 + n.length + body.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(46 + n.length, 12);
  end.writeUInt32LE(cenOffset, 16);
  return Buffer.concat([local, n, body, cen, n, end]);
}

test("zipEntry reads stored and deflated entries and rejects other files", () => {
  const data = Buffer.from("<office:document-content>hello</office:document-content>");
  assert.equal(zipEntry(makeZip("content.xml", data, 8), "content.xml").toString(), data.toString());
  assert.equal(zipEntry(makeZip("content.xml", data, 0), "content.xml").toString(), data.toString());
  assert.throws(() => zipEntry(makeZip("meta.xml", data, 8), "content.xml"), /no content\.xml/);
  assert.throws(() => zipEntry(Buffer.from("not a zip at all, just text"), "content.xml"), /not a zip/);
});

test("parseMilkSheet reads the real Prices_Monthly rows (checked 2026-10-31)", () => {
  const s = parseMilkSheet(MILK_CONTENT_XML);
  const last = s.points[s.points.length - 1];
  assert.equal(last.month, "2026-09");
  assert.ok(Math.abs(last.pence - 38.454022601934902) < 1e-9);
  assert.ok(Math.abs(last.volume! - 1197.8952504911879) < 1e-9);
  assert.ok(Math.abs(last.butterfat! - 4.4121176981562522) < 1e-9);
  assert.ok(Math.abs(last.protein! - 3.5420682787106279) < 1e-9);
  assert.equal(s.points[0].month, "1970-01");
  assert.equal(s.points[0].pence, 4.08);
  assert.equal(s.points[0].volume, null);
  assert.equal(s.provisional, true);
  assert.equal(s.points.find((p) => p.month === "2025-09")!.pence > 30, true);
  // oldest first, one point per month
  assert.deepEqual(s.points.map((p) => p.month), [...s.points.map((p) => p.month)].sort());
});

test("parseMilkSheet says plainly when the layout changes", () => {
  assert.throws(() => parseMilkSheet("<x/>"), /Prices_Monthly/);
  assert.throws(() => parseMilkSheet(MILK_CONTENT_XML.replace("pence per litre", "dollars")), /format has changed/);
});

test("odsUrlFrom picks the dataset spreadsheet and refuses another host", () => {
  assert.equal(odsUrlFrom(MILK_API), "https://assets.publishing.service.gov.uk/media/6ae1e486460c1346f7be77f7/milkprice_dataset_20261029.ods");
  const evil = { details: { attachments: [{ title: "x dataset", content_type: "application/vnd.oasis.opendocument.spreadsheet", url: "https://example.com/a.ods" }] } };
  assert.throws(() => odsUrlFrom(evil), /refusing/);
  assert.throws(() => odsUrlFrom({ details: { attachments: [] } }), /no spreadsheet/);
});

test("isMilk matches everyday words and nothing else", () => {
  for (const w of ["milk", "Milk", "raw milk", "cow's milk", "cows milk", "dairy", "UK milk", "milk price"]) assert.ok(isMilk(w), w);
  for (const w of ["wheat", "eggs", "butter", "milk powder", ""]) assert.ok(!isMilk(w), w);
});

test("milkAnswer: the exact question 'what do UK farmers get for milk' gives September 2026, 38.45 p/litre", () => {
  const a = milkAnswer(series(), { product: "milk" });
  assert.equal(a.status, "ok");
  assert.equal(a.price!.currency, "GBP");
  assert.equal(a.price!.unit, "per litre");
  assert.ok(Math.abs(a.price!.value - 0.384540) < 1e-6);
  assert.equal(a.price!.typical_low, null);
  assert.equal(a.price!.median, null);
  assert.equal(a.sample_size, null);
  assert.equal(a.price_type, "official_statistic");
  assert.deepEqual(a.period, { from: "2026-09-01", to: "2026-09-30" });
  assert.equal(a.statistic!.reference_period, "2026-09");
  assert.match(a.summary, /38\.45 pence per litre/);
  assert.match(a.summary, /September 2026/);
  assert.match(a.summary, /provisional/);
  const ex: any = a.extra;
  assert.equal(ex.change_on_previous_month.reference_month, "2026-08");
  assert.equal(ex.change_on_previous_month.pence_per_litre, 36.68);
  assert.equal(ex.change_on_previous_month.change_percent, 4.84);
  assert.equal(ex.change_on_year_earlier.reference_month, "2025-09");
  assert.equal(ex.last_12_months.length, 12);
  assert.equal(ex.last_12_months[11].month, "2026-09");
  assert.equal(ex.composition.butterfat_percent, 4.41);
  assert.equal(a.source.licence, "Open Government Licence v3.0");
  assert.match(a.source.attribution, /Open Government Licence v3\.0/);
});

test("milkAnswer: a nation is answered with the UK figure and a note; other products say no_matches", () => {
  const s = milkAnswer(series(), { product: "milk", region: "Scotland" });
  assert.equal(s.status, "ok");
  assert.match((s.extra as any).region_note, /whole United Kingdom/);
  const w = milkAnswer(null, { product: "wheat" });
  assert.equal(w.status, "no_matches");
  assert.deepEqual((w.extra as any).available_products, ["milk"]);
});

test("gbMilkPrices: empty product is a plain input error; the getter is only called for milk", async () => {
  await assert.rejects(() => gbMilkPrices({ product: " " }), /product is required/);
  let calls = 0;
  const get = async () => (calls++, series());
  assert.equal((await gbMilkPrices({ product: "eggs" }, get)).status, "no_matches");
  assert.equal(calls, 0);
  assert.equal((await gbMilkPrices({ product: "milk" }, get)).status, "ok");
  assert.equal(calls, 1);
});

test("harvest row: one UK row, n is NO_COUNT, dated at the end of the reference month", async () => {
  const h = milkHarvestRows(series());
  assert.equal(h.date, "2026-09-30");
  assert.equal(h.currency, "GBP");
  assert.equal(h.rows.length, 1);
  assert.equal(h.rows[0].area, "ALL");
  assert.ok(Number.isNaN(h.rows[0].n));
  assert.ok(Math.abs(h.rows[0].median - 0.38454) < 1e-5);
  assert.equal(h.rows[0].low, h.rows[0].high);
  assert.equal((await gbMilkHarvest(async () => series())).date, "2026-09-30");
  assert.throws(() => milkHarvestRows({ points: [], provisional: false }), /no monthly price/);
});

test("historyKey maps milk to the harvested row and nothing else", () => {
  assert.deepEqual(milkHistoryKey({ product: "milk" }), { area: "ALL", item: "Milk (per litre)", label: "United Kingdom (farm-gate milk)" });
  assert.equal(milkHistoryKey({ product: "wheat" }), null);
  assert.equal(milkHistoryKey({}), null);
});

test("manifest: farm-gate-prices, GB, and the first example is a smoke test", () => {
  assert.equal(manifest.info.id, INFO.id);
  assert.equal(manifest.category, "farm-gate-prices");
  assert.deepEqual(manifest.countries, ["GB"]);
  assert.ok(categoryById("farm-gate-prices"));
  assert.ok(countriesFor("farm-gate-prices").includes("GB"));
});
