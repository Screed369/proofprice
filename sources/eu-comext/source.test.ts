// Format: Eurostat Comext DS-045409 JSON-stat answers, checked live on 2026-10-30 (see ./fixtures.ts). Unit values are value / (quantity x 100 kg).
import { test } from "node:test";
import assert from "node:assert/strict";
import { InputError } from "../../lib/http";
import { CHEESE_FR_EXPORTS, EMPTY_CELL, WHEAT_DE_JUN } from "./fixtures";
import def from "./index";
import { INFO, ITEMS, REPORTERS, addMonths, comextBorderPrice, comextUrl, parseMonths, resolvePartner, resolveProduct, summarise } from "./source";

const NOW = new Date("2026-10-30T12:00:00Z");

function ioWith(json: unknown) {
  const urls: string[] = [];
  return { urls, io: { async get(url: string) { urls.push(url); return json; } } };
}

test("licence is Eurostat's, source acknowledged, free tier only, price type official statistic", () => {
  assert.match(INFO.licence, /authorised provided the source is acknowledged/);
  assert.match(INFO.licence, /free tier only/);
  assert.match(INFO.attribution, /^Source: Eurostat \(Comext, DS-045409\)/);
  assert.equal(INFO.price_type, "official_statistic");
  assert.equal(def.category, "border-prices");
  assert.ok(!Object.keys(REPORTERS).includes("AT"), "Austrian 8-digit CN data cannot be sold: Austria is not served");
});

test("parseMonths: German wheat imports June 2026 = EUR 71,425,923 over 3,342,854.64 x 100 kg", () => {
  const m = parseMonths(WHEAT_DE_JUN);
  assert.deepEqual(m, [{ month: "2026-06", eur: 71425923, kg: 334285464 }]);
  assert.ok(Math.abs(71425923 / 334285464 - 0.2137) < 0.0001);
});

test("parseMonths: a month with a value but no quantity is dropped; an empty cell gives nothing", () => {
  const m = parseMonths(CHEESE_FR_EXPORTS);
  assert.deepEqual(m.map((x) => x.month), ["2026-05", "2026-06", "2026-07"]); // 2026-08 is not published yet
  assert.deepEqual(parseMonths(EMPTY_CELL), []);
  assert.throws(() => parseMonths({ nothing: true }), /not a JSON-stat dataset/);
});

test("summarise: weighted unit value with the cheapest and dearest month", () => {
  const s = summarise(parseMonths(CHEESE_FR_EXPORTS))!;
  const eur = 295205013 + 317466314 + 315514092;
  const kg = (547633.91 + 573291.43 + 585777.63) * 100;
  assert.ok(Math.abs(s.unit - eur / kg) < 1e-9);
  assert.ok(s.low <= s.unit && s.unit <= s.high && s.low < s.high);
  assert.equal(summarise([]), null);
});

test("products: everyday words and 4, 6 or 8 digit codes; 5 digits and unknown words are refused", () => {
  assert.equal(resolveProduct("wheat").code, "1001");
  assert.equal(resolveProduct("Cheese").code, "0406");
  assert.equal(resolveProduct("10.01").code, "1001");
  assert.equal(resolveProduct("0406 10 30").code, "04061030");
  assert.equal(resolveProduct("271019").code, "271019");
  assert.throws(() => resolveProduct("10019"), InputError);
  assert.throws(() => resolveProduct("unobtainium"), /not recognised/);
  assert.ok(ITEMS.length >= 30);
});

test("partners: ISO codes and common names", () => {
  assert.equal(resolvePartner("de"), "DE");
  assert.equal(resolvePartner("United States"), "US");
  assert.equal(resolvePartner("UK"), "GB");
  assert.throws(() => resolvePartner("Atlantis"), InputError);
});

test("url: the exact Comext request, months repeated, indicators repeated", () => {
  const u = comextUrl({ reporter: "DE", partner: "WORLD", code: "1001", flow: 1, months: ["2026-06"] });
  assert.equal(
    u,
    "https://ec.europa.eu/eurostat/api/comext/dissemination/statistics/1.0/data/ds-045409?format=JSON&lang=en&freq=M&reporter=DE&partner=WORLD&product=1001&flow=1&indicators=VALUE_IN_EUROS&indicators=QUANTITY_IN_100KG&time=2026-06",
  );
  assert.equal(addMonths("2026-01", -1), "2025-12");
});

test("answer: German wheat imports, period given, exact example", async () => {
  const { io, urls } = ioWith(WHEAT_DE_JUN);
  const a = await comextBorderPrice({ country: "DE", product: "wheat", direction: "imports", period: "2026-06" }, io, NOW);
  assert.equal(a.status, "ok");
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.price?.currency, "EUR");
  assert.equal(a.price?.unit, "per kg");
  assert.ok(Math.abs(a.price!.value - 0.2137) < 0.001);
  assert.equal(a.sample_size, null);
  assert.deepEqual(a.period, { from: "2026-06", to: "2026-06" });
  assert.match(a.summary, /Germany imported wheat/);
  assert.match(a.summary, /not a shelf price/);
  assert.match(urls[0], /reporter=DE&partner=WORLD&product=1001&flow=1/);
  assert.match(urls[0], /time=2026-06$/);
});

test("answer: no period asks for the lookback window and keeps the newest published months", async () => {
  const { io, urls } = ioWith(CHEESE_FR_EXPORTS);
  const a = await comextBorderPrice({ country: "FR", product: "cheese", direction: "exports", months: 3 }, io, NOW);
  assert.equal(a.status, "ok");
  assert.deepEqual(a.period, { from: "2026-05", to: "2026-07" });
  assert.ok(a.price!.min! < a.price!.value && a.price!.value < a.price!.max!);
  assert.match(urls[0], /flow=2/);
  assert.match(urls[0], /time=2026-08&time=2026-07/); // newest month Eurostat could have published first
  assert.match(a.summary, /France exported cheese and curd/);
});

test("answer: nothing published -> no_matches, never a made-up figure", async () => {
  const { io } = ioWith(EMPTY_CELL);
  const a = await comextBorderPrice({ country: "DE", product: "wheat", direction: "imports", partner: "FR" }, io, NOW);
  assert.equal(a.status, "no_matches");
  assert.equal(a.price, null);
  assert.match(a.summary, /records no imported trade/);
});

test("input errors: unknown country, period in the future, partner equal to the reporter", async () => {
  const { io } = ioWith(WHEAT_DE_JUN);
  await assert.rejects(comextBorderPrice({ country: "AT", product: "wheat", direction: "imports" }, io, NOW), InputError);
  await assert.rejects(comextBorderPrice({ country: "DE", product: "wheat", direction: "imports", period: "2026-10" }, io, NOW), /already published/);
  await assert.rejects(comextBorderPrice({ country: "DE", product: "wheat", direction: "imports", partner: "DE" }, io, NOW), /same country/);
});

test("manifest: first example is DE wheat and works through the category", () => {
  assert.deepEqual(def.examples[0].params, { country: "DE", product: "wheat", direction: "imports" });
  assert.ok(def.countries.includes("FR") && def.countries.includes("SE"));
});
