// Tests for the Taiwan rice prices (Agriculture and Food Agency, Ministry of Agriculture).
// Fixture: fixtures/ricepriceavg-2026-11-03.json holds 14 REAL day objects copied on 2026-11-03 from
// https://data.moa.gov.tw/Service/OpenData/Ricepriceavg.aspx?IsTransData=1&UnitId=E69&$top=400 (HTTP 200 from the cloud workspace).
// They are the newest 8 days (3 Nov to 27 Oct 2026) plus 3 Oct, 3 Sep 2026 and 2-4 Nov 2025 and 3 Oct 2025. Nothing is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { InputError, SourceError } from "../../lib/http";
import { NO_COUNT } from "../../lib/stats";
import { matchItem } from "../../categories/groceries/items";
import manifest from "./index";
import { INFO, ITEMS, dateWords, fetchDays, harvestFromDays, minguoToIso, parseDays, readField, riceAnswer, shiftMonths, twHarvest, twHistoryKey, twRicePrices } from "./source";

const RAW = JSON.parse(readFileSync(new URL("./fixtures/ricepriceavg-2026-11-03.json", import.meta.url), "utf8"));
const TODAY = new Date("2026-11-03T12:00:00Z");
const load = async () => RAW;

test("dates: Minguo years convert and impossible dates are refused", () => {
  assert.equal(minguoToIso("1151103"), "2026-11-03");
  assert.equal(minguoToIso("0781201"), "1989-12-01");
  assert.equal(minguoToIso("1150231"), null);
  assert.equal(minguoToIso("2026-11-03"), null);
  assert.equal(shiftMonths("2026-03-31", -1), "2026-02-28");
  assert.equal(shiftMonths("2026-11-03", -12), "2025-11-03");
  assert.equal(dateWords("2026-11-03"), "3 November 2026");
});

test("items: 15 unique fields; 'rice' is retail japonica", () => {
  assert.equal(ITEMS.length, 15);
  assert.equal(new Set(ITEMS.map((i) => i.code)).size, 15);
  assert.equal(matchItem(ITEMS, "rice").primary?.code, "pt_1japt_price");
  assert.equal(matchItem(ITEMS, "Wholesale rice").primary?.code, "pt_2japt_price");
  assert.equal(matchItem(ITEMS, "glutinous rice").primary?.code, "pt_1glutrt_price");
  assert.equal(matchItem(ITEMS, "paddy").primary?.code, "pt_4japt_price");
  assert.equal(matchItem(ITEMS, "soft indica paddy").primary?.code, "pt_4sangt_price");
  assert.equal(matchItem(ITEMS, "long glutinous rice").primary?.code, "pt_1glutlt_price");
  assert.equal(matchItem(ITEMS, "milk").primary, null);
});

test("parse: real days, newest first, zero means no price", () => {
  const days = parseDays(RAW);
  assert.equal(days.length, 14);
  assert.equal(days[0].date, "2026-11-03");
  assert.equal(days[0].values.pt_1japt_price, 47.86);
  assert.equal(days[0].values.pt_1tsait_price, 52.4);
  assert.equal(days[0].values.pt_2japt_price, 4096);
  const withZero = parseDays([{ pt_date: "1151103", pt_1japt_price: 0, pt_1tsait_price: 50 }]);
  assert.deepEqual(withZero[0].values, { pt_1tsait_price: 50 });
});

test("parse: a changed file is a SourceError", () => {
  assert.throws(() => parseDays({ error: "moved" }), SourceError);
  assert.throws(() => parseDays([{ foo: 1, pt_date: "1151103" }]), SourceError);
  assert.deepEqual(parseDays([]), []);
});

test("reading: latest, month and year earlier come from the real days", () => {
  const r = readField(parseDays(RAW), "pt_1japt_price")!;
  assert.deepEqual(r.latest, { date: "2026-11-03", value: 47.86 });
  assert.equal(r.yearAgo?.date, "2025-11-03");
  assert.ok(r.yearAgo!.value > 0);
  assert.ok(r.monthAgo && r.monthAgo.date <= "2026-10-03" && r.monthAgo.date >= "2026-09-26");
  assert.equal(r.monthly[r.monthly.length - 1].month, "2026-11");
  assert.equal(readField(parseDays(RAW), "pt_9nothing"), null);
});

test("answer: retail japonica rice is an official statistic with no sample size", async () => {
  const a = await twRicePrices({ item: "rice", today: TODAY } as any, { load });
  assert.equal(a.status, "ok");
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.price?.currency, "TWD");
  assert.equal(a.price?.unit, "per kg");
  assert.equal(a.price?.value, 47.86);
  assert.equal(a.sample_size, null);
  assert.equal(a.price?.typical_low, null);
  assert.deepEqual(a.period, { from: "2026-11-03", to: "2026-11-03" });
  assert.match(a.summary, /47\.86/);
  assert.match(a.summary, /3 November 2026/);
  assert.equal((a.extra as any).change_on_year_earlier.reference_date, "2025-11-03");
});

test("answer: wholesale is per 100 kg and shows the per-kg equivalent", async () => {
  const a = await twRicePrices({ item: "wholesale rice", today: TODAY } as any, { load });
  assert.equal(a.price?.value, 4096);
  assert.equal(a.price?.unit, "per 100 kg");
  assert.equal((a.extra as any).per_kg_equivalent, 40.96);
});

test("answer: old data is flagged, region is ignored with a note, unknown item lists choices", () => {
  const days = parseDays(RAW);
  const old = riceAnswer(readField(days, "pt_1japt_price"), ITEMS[0], [], { item: "rice", today: new Date("2026-12-30T00:00:00Z") });
  assert.match(old.statistic?.note ?? "", /Old data/);
  const reg = riceAnswer(readField(days, "pt_1japt_price"), ITEMS[0], [], { item: "rice", region: "Taipei", today: TODAY });
  assert.match(reg.statistic?.note ?? "", /Taipei/);
  const none = riceAnswer(null, null, [], { item: "milk" });
  assert.equal(none.status, "no_matches");
  assert.match(none.summary, /rice/);
});

test("request: empty item is an InputError", async () => {
  await assert.rejects(() => twRicePrices({ item: " " }, { load }), InputError);
});

test("fetch: asks for the newest days only", async () => {
  let seen = "";
  await fetchDays({ load: async (u) => ((seen = u), RAW) });
  assert.match(seen, /\$top=400/);
});

test("harvest: one NO_COUNT row per item for the newest day", async () => {
  const h = harvestFromDays(parseDays(RAW));
  assert.equal(h.date, "2026-11-03");
  assert.equal(h.currency, "TWD");
  assert.equal(h.rows.length, 15);
  assert.ok(h.rows.every((r) => Number.isNaN(r.n) && r.area === "ALL" && r.low === r.median));
  assert.equal(h.rows.find((r) => r.item === "pt_1japt_price")!.median, 47.86);
  assert.ok(Number.isNaN(NO_COUNT));
  const via = await twHarvest({ load });
  assert.equal(via.rows.length, 15);
  assert.throws(() => harvestFromDays([]), SourceError);
});

test("history key and manifest", () => {
  assert.deepEqual(twHistoryKey({ item: "rice" }), { area: "ALL", item: "pt_1japt_price", label: "Retail price of japonica white rice, per kg" });
  assert.equal(twHistoryKey({ item: "milk" }), null);
  assert.equal(manifest.info.id, "tw-moa-rice");
  assert.equal(manifest.category, "groceries");
  assert.deepEqual(manifest.countries, ["TW"]);
  assert.equal(INFO.price_type, "official_statistic");
  assert.ok(manifest.nominalCounts && manifest.referenceDates);
});
