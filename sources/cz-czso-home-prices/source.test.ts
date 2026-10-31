import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseJsonStat } from "../../lib/adapters";
import { InputError } from "../../lib/http";
import { SOURCE_PLUGINS, findSource } from "../../lib/registry";
import { INFO, czAnswer, czHomePrices, parseKind, readCz } from "./source";

// Fixture: real CZSO JSON-stat response captured 2026-10-31 (fixture.json), https://csu.gov.cz/prices-of-real-estate
const raw = () => JSON.parse(readFileSync(new URL("./fixture.json", import.meta.url), "utf8"));
const table = () => parseJsonStat(raw());

test("cz-czso-home-prices: licence, attribution and type are CZSO's", () => {
  assert.equal(INFO.price_type, "official_statistic");
  assert.match(INFO.licence, /CC BY 4\.0/);
  for (const k of ["Czech Statistical Office", "CC BY 4.0", "CEN04T01"]) assert.ok(INFO.attribution.includes(k), k);
});

test("cz-czso-home-prices: reads flats and houses from the real fixture", () => {
  const f = readCz(table(), "flat")!;
  assert.equal(f.latest.year, "2025");
  assert.equal(f.latest.value, 72410);
  assert.equal(f.previous!.year, "2024");
  assert.equal(f.previous!.change_percent, 14);
  assert.equal(f.series.length, 7);
  const h = readCz(table(), "house")!;
  assert.equal(h.latest.value, 56066);
  assert.equal(h.published, "2026-07-15");
});

test("cz-czso-home-prices: answer is an official statistic with no sample size", () => {
  const a = czAnswer(readCz(table(), "flat"), readCz(table(), "house"), { kind: "flat" });
  assert.equal(a.status, "ok");
  assert.equal(a.price?.value, 72410);
  assert.equal(a.price?.currency, "CZK");
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.sample_size, null);
  assert.match(a.summary, /72,410 CZK per square metre in 2025/);
  assert.equal((a.extra as any).other_type.value, 56066);
});

test("cz-czso-home-prices: a town is acknowledged, not answered", () => {
  const a = czAnswer(readCz(table(), "house"), null, { kind: "house", ignoredTown: "Brno" });
  assert.match(String(a.statistic?.note), /Brno/);
});

test("cz-czso-home-prices: property_type parsing", () => {
  assert.equal(parseKind(undefined).kind, "flat");
  assert.equal(parseKind("any").any, true);
  assert.equal(parseKind("House").kind, "house");
  assert.throws(() => parseKind("castle"), InputError);
});

test("cz-czso-home-prices: end to end with a stub fetcher", async () => {
  const a = await czHomePrices({ property_type: "house" }, { fetcher: async () => raw() });
  assert.equal(a.price?.value, 56066);
});

test("cz-czso-home-prices: routing shares CZ with the Eurostat index by measure", () => {
  const mine = SOURCE_PLUGINS.find((s) => s.info.id === "cz-czso-home-prices")!;
  assert.equal(mine.serves!({ country: "CZ" }), true);
  assert.equal(mine.serves!({ country: "CZ", measure: "index" }), false);
  assert.equal(findSource("home-sales", "CZ", { country: "CZ" })?.info.id, "cz-czso-home-prices");
  assert.equal(findSource("home-sales", "CZ", { country: "CZ", measure: "index" })?.info.id, "eu-home-price-index");
});
