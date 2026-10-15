import { test } from "node:test";
import assert from "node:assert/strict";
import { parseJsonStat } from "../../lib/adapters";
import { InputError } from "../../lib/http";
import { categoryById, countriesFor, paramSchemas } from "../../lib/registry";
import { broadbandAnswer, broadbandFilters, COUNTRIES, euBroadband, INFO, normaliseOffer, readBroadband } from "./source";
import * as F from "./fixtures";

// Fixture: real Eurostat response captured 2026-10-15 (IE and ES, 2023 and 2024).
const table = () => parseJsonStat(F.IE_ES_BROADBAND);
const URL_IE = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/isoc_pbo?format=JSON&lang=EN&geo=IE&unit=PPP_EUR&lastTimePeriod=3";

test("eu-broadband: licence, attribution and type are Eurostat's", () => {
  assert.equal(INFO.id, "eu-broadband");
  assert.equal(INFO.price_type, "official_statistic");
  assert.equal(INFO.licence_url, "https://ec.europa.eu/eurostat/help/copyright-notice");
  for (const k of ["Eurostat", "isoc_pbo"]) assert.ok(INFO.attribution.includes(k), k);
  assert.match(INFO.limits, /never what customers paid/);
});

test("eu-broadband: covers the EU27 with Greece as GR", () => {
  assert.equal(Object.keys(COUNTRIES).length, 27);
  for (const c of ["GR", "IE", "DE", "FR", "ES", "IT", "SE", "PL"]) assert.ok(countriesFor("broadband").includes(c), c);
  for (const c of ["GB", "EL", "NO"]) assert.ok(!COUNTRIES[c], c);
});

test("eu-broadband: offer names and codes", () => {
  assert.equal(normaliseOffer(undefined), "FI_MBPS100-200");
  assert.equal(normaliseOffer("Fixed 1Gbps"), "FI_GBPS_GE1");
  assert.equal(normaliseOffer("mobile-10GB"), "MI_GB10_NC");
  assert.equal(normaliseOffer("fi_mbps30-100_ptv"), "FI_MBPS30-100_PTV");
  assert.throws(() => normaliseOffer("satellite"), InputError);
});

test("eu-broadband: the request is one country slice, GR sent as EL", () => {
  assert.deepEqual(broadbandFilters("IE"), { geo: "IE", unit: "PPP_EUR" });
  assert.equal(broadbandFilters("GR").geo, "EL");
});

test("eu-broadband: reads the real cube (flat index decoding, latest year, change)", () => {
  const ie = readBroadband(table(), { country: "IE", offer: "FI_GBPS_GE1" })!;
  assert.equal(ie.reference_period, "2024");
  assert.equal(ie.value, 33.88);
  assert.deepEqual(ie.previous, { reference_period: "2023", value: 37.84, change_percent: -10.5 });
  assert.equal(ie.offerLabel, "Fixed internet ≥ 1 Gbps");
  const es = readBroadband(table(), { country: "ES", offer: "FI_GBPS_GE1" })!;
  assert.equal(es.value, 27.45);
  assert.equal(readBroadband(table(), { country: "IE", offer: "FI_MBPS10-30" })!.value, 28.43);
  assert.equal(readBroadband(table(), { country: "ES", offer: "FI_MBPS10-30" })!.value, 23.55);
  assert.ok(ie.otherOffers.length > 10);
  assert.ok(!ie.otherOffers.some((o) => o.code === "FI_GBPS_GE1"));
  assert.equal(readBroadband(table(), { country: "FR", offer: "FI_GBPS_GE1" }), null);
});

test("eu-broadband: no figure gives a clear no_matches answer", () => {
  const a = broadbandAnswer(null, { country: "FR", offer: "FI_GBPS_GE1" });
  assert.equal(a.status, "no_matches");
  assert.equal(a.price, null);
  assert.equal(a.sample_size, null);
  assert.match(a.summary, /^Eurostat publishes no price for offer FI_GBPS_GE1 in France/);
});

test("eu-broadband: the full answer for Ireland says posted, PPP euro, per month", () => {
  const q = { country: "IE", offer: "FI_GBPS_GE1", baseUrl: "https://proofprice.com", apiUrl: URL_IE };
  const a = broadbandAnswer(readBroadband(table(), q), q);
  assert.equal(a.status, "ok");
  assert.deepEqual(a.price, { currency: "PPP_EUR", unit: "per month", value: 33.88, measure: "average", median: null, typical_low: null, typical_high: null, min: null, max: null });
  assert.equal(a.sample_size, null);
  assert.deepEqual(a.period, { from: "2024-01-01", to: "2024-12-31" });
  assert.equal(a.price_type, "official_statistic");
  assert.deepEqual(a.statistic!.reference_period, "2024");
  assert.match(a.statistic!.note!, /Posted price/);
  assert.match(a.summary, /^In Ireland the cheapest posted offer of the largest operators for "Fixed internet ≥ 1 Gbps" was 33\.88 PPP euro per month in 2024\. That is 10\.5% lower than in 2023\./);
  assert.equal(a.source.id, "eu-broadband");
  const x: any = a.extra;
  assert.equal(x.offer.code, "FI_GBPS_GE1");
  assert.equal(x.dataset.code, "isoc_pbo");
  assert.equal(x.eurostat_api_url, URL_IE);
});

test("eu-broadband: euBroadband fetches one slice and rejects other countries", async () => {
  const urls: string[] = [];
  const a = await euBroadband({ country: "ie", offer: "fixed_1gbps" }, { fetcher: async (u: string) => (urls.push(u), F.IE_ES_BROADBAND) } as any);
  assert.deepEqual(urls, [URL_IE]);
  assert.equal(a.price!.value, 33.88);
  await assert.rejects(() => euBroadband({ country: "GB" }), InputError);
});

test("eu-broadband: the broadband tool lists the offer parameter", () => {
  const cat = categoryById("broadband")!;
  assert.ok(cat);
  assert.ok("offer" in paramSchemas(cat));
});
