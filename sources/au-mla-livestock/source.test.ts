// Tests for Australia saleyard livestock indicators (MLA NLRS). Fixture: real /report/5?indicatorID=0 reply captured via the GitHub probe on 2026-10-22.
import { test } from "node:test";
import assert from "node:assert/strict";
import { INDICATORS, INFO, auLivestock, lastServedDay, livestockHarvest, livestockHarvestRows, livestockHistoryKey, matchIndicator, parseReport, readIndicator } from "./source";
import manifest from "./index";

const row = (d: string, id: number, desc: string, units: string, head: number, v: number) => ({ calendar_date: d, species_id: "Cattle", indicator_id: id, indicator_desc: desc, indicator_units: units, head_count: head, indicator_value: v });
const EYCI = "Eastern Young Cattle Indicator";
const REPORT0 = {
  message: "Data returned",
  "total number rows": 8,
  data: [
    row("2026-10-14", 0, EYCI, "c/kg cwt", 15827.0, 968.69436451),
    row("2026-10-15", 0, EYCI, "c/kg cwt", 16074.0, 970.6179073722),
    row("2026-10-16", 0, EYCI, "c/kg cwt", 16074.0, 970.6179073722),
    row("2026-10-17", 0, EYCI, "c/kg cwt", 16074.0, 970.6179073722),
    row("2026-10-18", 0, EYCI, "c/kg cwt", 16074.0, 970.6179073722),
    row("2026-10-19", 0, EYCI, "c/kg cwt", 11719.0, 967.3391175783),
    row("2026-10-20", 0, EYCI, "c/kg cwt", 5456.0, 962.2489068365),
    row("2026-10-21", 0, EYCI, "c/kg cwt", 2140.0, 987.8960978505),
  ],
  Disclaimer: "All use of MLA publications ...",
};
const TODAY = new Date("2026-10-22T12:00:00Z");
const get = async () => REPORT0;

test("parseReport skips weekend carry-forward days and keeps real trading days", () => {
  const r = parseReport(REPORT0);
  assert.deepEqual(r.map((x) => x.date), ["2026-10-14", "2026-10-15", "2026-10-19", "2026-10-20", "2026-10-21"]);
});

test("parseReport drops days with under 5 animals and rejects a reply without data", () => {
  const r = parseReport({ data: [row("2026-10-20", 0, EYCI, "c/kg cwt", 3, 900), row("2026-10-21", 0, EYCI, "c/kg cwt", 50, 910)] });
  assert.equal(r.length, 1);
  assert.throws(() => parseReport({ message: "x" }), /unexpected reply/);
});

test("cattle: newest trading day, head count as sample size, attribution, kg price", async () => {
  const a = await auLivestock({ product: "cattle", today: TODAY }, get);
  assert.equal(a.status, "ok");
  assert.equal(a.price?.currency, "AUD");
  assert.equal(a.price?.value, 9.879, "AUD per kg, not cents");
  assert.equal(a.price?.measure, "average");
  assert.equal(a.sample_size, 2140);
  assert.equal(a.price_type, "transaction");
  assert.deepEqual(a.period, { from: "2026-10-21", to: "2026-10-21" });
  assert.match(a.summary, /A\$9\.879 \(987\.9 cents\) per kg carcase weight at Australian saleyards on 21 October 2026 \(2,140 animals sold\)/);
  assert.match(a.source.attribution, /Reproduced courtesy of Meat & Livestock Australia Limited - www\.mla\.com\.au/);
  const x = a.extra as any;
  assert.equal(x.aud_per_kg, 9.88);
  assert.equal(Math.round(x.published_value * 10) / 10, 987.9, "MLA cents kept in extra");
  assert.ok(x.last_trading_days.every((d: any) => d.value < 100), "history list in AUD too");
  assert.equal(x.indicator.id, 0);
  assert.equal(x.last_trading_days.length, 5);
});

test("an unknown product lists the choices", async () => {
  await assert.rejects(() => auLivestock({ product: "kangaroo", today: TODAY }, get), /no MLA saleyard indicator matches/);
});

test("product words map to indicators", () => {
  assert.equal(matchIndicator("lamb").primary?.id, 7);
  assert.equal(matchIndicator("Mutton").primary?.id, 11);
  assert.equal(matchIndicator("feeder steers").primary?.id, 3);
  assert.equal(matchIndicator("cows").primary?.id, 13);
  assert.equal(matchIndicator("cattle price in queensland").primary?.id, 0);
  assert.equal(matchIndicator("").primary, null);
  assert.equal(new Set(INDICATORS.map((i) => i.id)).size, 19);
});

test("harvest keeps only indicators with the newest day; n is the head count", async () => {
  const h = livestockHarvestRows([
    { ind: INDICATORS[0], readings: parseReport(REPORT0) },
    { ind: INDICATORS[16], readings: [{ date: "2026-10-20", value: 150, head: 40, desc: "Online Lamb Indicator", units: "$/head" }] },
  ]);
  assert.equal(h.date, "2026-10-21");
  assert.equal(h.rows.length, 1);
  assert.equal(h.rows[0].item, "Eastern Young Cattle Indicator (AUD per kg carcase weight)");
  assert.equal(h.rows[0].median, 9.879, "library rows in AUD, not cents");
  assert.equal(h.rows[0].n, 2140);
  const full = await livestockHarvest(TODAY, get);
  assert.equal(full.rows.length, 19 > 0 ? full.rows.length : 0);
});

test("history key matches the harvest item", () => {
  assert.deepEqual(livestockHistoryKey({ product: "cattle" }), { area: "Australia", item: "Eastern Young Cattle Indicator (AUD per kg carcase weight)", label: "Eastern Young Cattle" });
  assert.equal(livestockHistoryKey({ product: "zzz" }), null);
});

test("manifest is for AU in wholesale-fresh-food with a smoke example", () => {
  assert.equal(manifest.category, "wholesale-fresh-food");
  assert.deepEqual(manifest.countries, ["AU"]);
  assert.equal(INFO.id, "au-mla-livestock");
  assert.equal(typeof readIndicator, "function");
});

test("MLA date range ends yesterday in Australia (MLA refuses toDate = today: 'Please provide date range before today!')", async () => {
  // 12:06 UTC on 23 Oct is 22:06 on 23 Oct in AEST: the last day MLA serves is 22 Oct (the UTC date would be refused).
  assert.equal(lastServedDay(new Date("2026-10-23T12:06:00Z")), "2026-10-22");
  // 16:00 UTC on 23 Oct is 02:00 on 24 Oct in AEST: 23 Oct is already served.
  assert.equal(lastServedDay(new Date("2026-10-23T16:00:00Z")), "2026-10-23");
  let asked = "";
  await readIndicator(INDICATORS[0], new Date("2026-10-23T08:30:00Z"), 10, async (url) => { asked = url; return { data: [] }; });
  assert.match(asked, /fromDate=2026-10-13&toDate=2026-10-22$/);
});
