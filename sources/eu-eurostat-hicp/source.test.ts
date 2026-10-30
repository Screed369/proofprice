import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseJsonStat } from "../../lib/adapters";
import { InputError } from "../../lib/http";
import { findSource, runCategory, paramSchemas, categoryById } from "../../lib/registry";
import { COUNTRIES, euHicp, hicpAnswer, hicpFilters, INFO, monthWords, normaliseSpend, readHicp } from "./source";
import oecd from "../oecd-price-levels/index";

// Fixture: real Eurostat response captured 2026-10-30 through the GitHub probe (Ireland, food/housing/transport/personal care,
// units I25, RCH_M, RCH_A, last 3 months). Only the "extension" block was cut.
const IE = JSON.parse(readFileSync(new URL("./ie-multi.json", import.meta.url), "utf8"));
const FOOD = normaliseSpend("food");

test("eu-eurostat-hicp: licence, attribution and type are Eurostat's", () => {
  assert.equal(INFO.id, "eu-eurostat-hicp");
  assert.equal(INFO.price_type, "official_statistic");
  assert.match(INFO.attribution, /Eurostat/);
  assert.equal(INFO.licence_url, "https://ec.europa.eu/eurostat/help/copyright-notice");
  assert.ok(COUNTRIES.IE && COUNTRIES.GR && !COUNTRIES.GB && !COUNTRIES.US);
});

test("spend words map to the ECOICOP-2 codes; unknown words are a clear error", () => {
  assert.equal(normaliseSpend("").code, "TOTAL");
  assert.equal(normaliseSpend("Food").code, "CP01");
  assert.equal(normaliseSpend("restaurants and hotels").code, "CP11");
  assert.equal(normaliseSpend("housing").code, "CP04");
  assert.throws(() => normaliseSpend("spaceships"), InputError);
});

test("readHicp: newest month, index and both rates, from the real Irish food series", () => {
  const r = readHicp(parseJsonStat(IE), { country: "IE", spend: FOOD })!;
  assert.equal(r.latest.period, "2026-09");
  assert.equal(r.latest.index, 101.21);
  assert.equal(r.latest.annual_rate_percent, 0.3);
  assert.equal(r.latest.monthly_rate_percent, 0);
  assert.deepEqual(r.history.map((h) => h.period), ["2026-09", "2026-08", "2026-07"]);
  assert.equal(r.history[2].index, 101.26);
  assert.equal(r.datasetLatest, "2026-09");
});

test("readHicp: another division of the same cube (transport) and a division that is not in the slice", () => {
  const t = readHicp(parseJsonStat(IE), { country: "IE", spend: normaliseSpend("transport") })!;
  assert.equal(t.latest.index, 106.95);
  assert.equal(t.latest.annual_rate_percent, 7.9);
  assert.equal(t.latest.monthly_rate_percent, 0.5);
  assert.equal(readHicp(parseJsonStat(IE), { country: "IE", spend: normaliseSpend("clothing") }), null);
  assert.equal(readHicp(parseJsonStat(IE), { country: "FR", spend: FOOD }), null);
});

test("hicpAnswer: an official statistic labelled as an index, never a price in money", () => {
  const r = readHicp(parseJsonStat(IE), { country: "IE", spend: FOOD });
  const a = hicpAnswer(r, { country: "IE", spend: FOOD });
  assert.equal(a.status, "ok");
  assert.equal(a.price!.value, 101.21);
  assert.equal(a.price!.currency, "INDEX");
  assert.match(a.price!.unit, /index \(2025 = 100\)/);
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.sample_size, null);
  assert.equal(a.price!.typical_low, null);
  assert.deepEqual(a.period, { from: "2026-09-01", to: "2026-09-30" });
  assert.match(a.summary, /index of 101.21 in September 2026/);
  assert.match(a.summary, /0.3% higher than a year earlier/);
  assert.match(a.summary, /unchanged on the month before/);
  const x = a.extra as any;
  assert.equal(x.annual_rate_percent, 0.3);
  assert.equal(x.history.length, 3);
  assert.equal(x.coicop18_code, "CP01");
});

test("hicpAnswer: a fall is worded as lower (personal care, monthly -0.1)", () => {
  const spend = normaliseSpend("personal care");
  const a = hicpAnswer(readHicp(parseJsonStat(IE), { country: "IE", spend }), { country: "IE", spend });
  assert.match(a.summary, /1.8% higher than a year earlier and 0.1% lower than the month before/);
});

test("hicpAnswer: personal care annual rate read; no reading is an honest no_matches", () => {
  const r = readHicp(parseJsonStat(IE), { country: "IE", spend: normaliseSpend("personal care") })!;
  assert.equal(r.latest.index, 102.38);
  assert.equal(r.latest.annual_rate_percent, 1.8);
  assert.equal(r.latest.monthly_rate_percent, -0.1);
  const none = hicpAnswer(null, { country: "IE", spend: FOOD });
  assert.equal(none.status, "no_matches");
  assert.equal(none.price, null);
  assert.match(none.summary, /holds no consumer price index/);
});

test("euHicp asks Eurostat for one country and one division, three units, 13 months (URL checked)", async () => {
  const urls: string[] = [];
  const a = await euHicp({ country: "ie", spend: "food" }, { fetcher: async (u: string) => (urls.push(u), IE) } as any);
  assert.equal(a.status, "ok");
  assert.equal(urls.length, 1);
  assert.equal(
    urls[0],
    "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/prc_hicp_minr?format=JSON&lang=EN&geo=IE&coicop18=CP01&unit=I25&unit=RCH_M&unit=RCH_A&lastTimePeriod=13",
  );
  assert.equal(hicpFilters("GR", FOOD).geo, "EL");
});

test("euHicp: a country outside the list is a clear error that points to the price level", async () => {
  await assert.rejects(() => euHicp({ country: "US" }), (e: any) => e instanceof InputError && /measure out/.test(e.message));
});

test("monthWords", () => {
  assert.equal(monthWords("2026-01"), "January 2026");
  assert.equal(monthWords("x"), "x");
});

test("routing: measure=inflation reaches this source, anything else keeps the OECD price level (both shared countries)", () => {
  assert.equal(findSource("price-levels", "IE", { country: "IE", measure: "inflation" })?.info.id, "eu-eurostat-hicp");
  assert.equal(findSource("price-levels", "IE", { country: "IE", spend: "food" })?.info.id, "oecd-price-levels");
  assert.equal(findSource("price-levels", "DE", { country: "DE" })?.info.id, "oecd-price-levels");
});

test("the price-levels tool accepts measure and the OECD source refuses inflation for other countries instead of answering the wrong thing", async () => {
  const schemas = paramSchemas(categoryById("price-levels")!);
  assert.ok("measure" in schemas);
  await assert.rejects(
    async () => oecd.handle({ country: "US", measure: "inflation" }, {}),
    (e: any) => e instanceof InputError && /EU, Norway and Iceland only/.test(e.message),
  );
});
