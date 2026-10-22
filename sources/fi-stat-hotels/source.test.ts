// Fixture fixtures/t11ix.json: JSON-stat2 shaped exactly like a StatFin PxWeb answer for table 11ix (hotels, matk-keskihinta, 21 regions, 2025M07-2026M08).
// Variable codes, region codes and labels are the REAL metadata read on 2026-10-22 from GitHub's servers (probe fihot4); a POST cannot be probed,
// so the VALUES are illustrative. The first live preview/production answer is the proof of the values.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import manifest from "./index";
import { API, INFO, buildQuery, fiHotels, matchRegion, parseTable, pickLatest } from "./source";

const FIX = JSON.parse(readFileSync(new URL("./fixtures/t11ix.json", import.meta.url), "utf8"));
const poster = async () => FIX;

test("the POST asks for hotels, the average room price and the newest 14 months", () => {
  const q = buildQuery();
  assert.equal(q.response.format, "json-stat2");
  assert.deepEqual(q.query.map((x) => x.code), ["maakunta_26_20190101", "majoitus_3_20181130", "contentscode", "timeperiod_m"]);
  // region is an eliminable variable: without an explicit selection the answer has no region dimension (live preview 22 Oct)
  assert.deepEqual(q.query[0].selection, { filter: "all", values: ["*"] });
  assert.deepEqual(q.query[1].selection.values, ["02"]);
  assert.deepEqual(q.query[2].selection.values, ["matk-keskihinta"]);
  assert.deepEqual(q.query[3].selection, { filter: "top", values: ["14"] });
  assert.match(API, /^https:\/\/pxdata\.stat\.fi\/PxWeb\/api\/v1\/en\/StatFin\/matk\/11ix\.px$/);
});

test("parses 21 regions x 14 months", () => {
  const t = parseTable(FIX);
  assert.equal(t.rows.length, 294);
  assert.equal(t.codes.maakunta_26_20190101.length, 21);
});

test("region and city matching", () => {
  const t = parseTable(FIX);
  assert.equal(matchRegion(t).code, "SSS");
  assert.equal(matchRegion(t, "Uusimaa").code, "MK01");
  assert.equal(matchRegion(t, "Helsinki").code, "MK01");
  assert.equal(matchRegion(t, "Helsinki").viaCity, "Helsinki");
  assert.equal(matchRegion(t, "Lapland").code, "MK19");
  assert.equal(matchRegion(t, "Lapland").viaCity, null);
  assert.equal(matchRegion(t, "Åland").code, "MK21");
  assert.equal(matchRegion(t, "Pirkanmaa").code, "MK06");
  assert.equal(matchRegion(t, "Southwest Finland").code, "MK02");
  assert.equal(matchRegion(t, "north savo").code, "MK11");
  assert.throws(() => matchRegion(t, "Atlantis"), /not a region/);
});

test("latest month and year-on-year", () => {
  const t = parseTable(FIX);
  const p = pickLatest(t, "MK01")!;
  assert.equal(p.month, "2026M08");
  assert.equal(p.value, 140.3);
  assert.deepEqual(p.previous, { month: "2025M08", value: 134.4 });
});

test("national answer: official statistic, no range, no sample size, CC BY quoted", async () => {
  const a = await fiHotels({}, poster);
  assert.equal(a.status, "ok");
  assert.equal(a.price?.currency, "EUR");
  assert.equal(a.price?.unit, "per occupied room per night");
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.price?.value, 131.1);
  assert.equal(a.price?.median, null);
  assert.equal(a.sample_size, null);
  assert.equal(a.period.from, "2026-08-01");
  assert.equal(a.period.to, "2026-08-31");
  assert.equal((a.extra as any).change_on_year_earlier_percent, 1.5);
  assert.match(a.summary, /August 2026/);
  assert.match(a.source.licence, /CC BY 4\.0/);
});

test("Helsinki is answered with its region and says so", async () => {
  const a = await fiHotels({ area: "Helsinki" }, poster);
  assert.equal(a.price?.value, 140.3);
  assert.match(a.summary, /Uusimaa \(the region of Helsinki\)/);
  assert.equal((a.extra as any).city_asked, "Helsinki");
  assert.equal((a.extra as any).change_on_year_earlier_percent, 4.4);
});

test("a changed layout is reported plainly", async () => {
  await assert.rejects(() => fiHotels({}, async () => ({ ...FIX, id: ["x", "y"], size: [1, 1], dimension: { x: { category: { index: ["a"] } }, y: { category: { index: ["b"] } } }, value: [1] })), /changed the layout/);
});

test("manifest: hotels tool, FI only, national example is the smoke test", () => {
  assert.equal(manifest.category, "hotels");
  assert.deepEqual(manifest.countries, ["FI"]);
  assert.deepEqual(manifest.examples[0].params, { country: "FI" });
  assert.equal(INFO.price_type, "official_statistic");
});
