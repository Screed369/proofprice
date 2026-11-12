import { test } from "node:test";
import assert from "node:assert/strict";
import { InputError } from "../../lib/http";
import { SOURCE_PLUGINS } from "../../lib/registry";
import { servesBl } from "../ch-zz-bl-home-sales/source";
import { FLAT_REGIONS_CSV, HOUSE_TOWNS_JSON } from "./fixtures";
import { INFO, matchTown, normaliseKind, parseRegionCsv, parseTownJson, regionAnswer, servesZh, splitCsvLine, townAnswer, zhHomeSales } from "./source";

// Fixtures: real rows fetched from daten.statistik.zh.ch on 2026-11-12.
test("registered on home-sales for CH, open licence", () => {
  const p = SOURCE_PLUGINS.find((s) => s.info.id === "ch-zh-canton-home-sales")!;
  assert.equal(p.category, "home-sales");
  assert.deepEqual(p.countries, ["CH"]);
  assert.match(INFO.licence, /commercial use allowed/);
});

test("splitCsvLine keeps quoted commas", () => {
  assert.deepEqual(splitCsvLine('2025,1,"ZH","Seegemeinden",751,"Kanton Zürich, Stand 2025 / Q4"'), ["2025", "1", "ZH", "Seegemeinden", "751", "Kanton Zürich, Stand 2025 / Q4"]);
});

test("parseRegionCsv reads scientific notation", () => {
  const rows = parseRegionCsv(FLAT_REGIONS_CSV);
  const lake = rows.find((r) => r.region === "Seegemeinden" && r.year === 2025)!;
  assert.equal(lake.median, 2000000); // written 2e+06
  assert.equal(lake.q10, 920000);
  assert.equal(lake.sales, 751);
  assert.throws(() => parseRegionCsv("a,b\n1,2"), /changed its price file/);
});

test("region answer: Seegemeinden flats 2025", () => {
  const a = regionAnswer(parseRegionCsv(FLAT_REGIONS_CSV), "flat", "Seegemeinden", "Seegemeinden");
  assert.equal(a.status, "ok");
  assert.equal(a.price!.currency, "CHF");
  assert.equal(a.price!.median, 2000000);
  assert.equal(a.price!.typical_low, 920000);
  assert.equal(a.price!.typical_high, 3610000);
  assert.equal(a.sample_size, 751);
  assert.deepEqual(a.period, { from: "2025-01-01", to: "2025-12-31" });
  assert.equal((a.extra as any).previous_year.year, 2024);
  assert.equal((a.extra as any).whole_canton.median_chf, 1200000);
  assert.match(a.summary, /Seegemeinden/);
});

test("municipality answer picks the shortest pool with a median", () => {
  const parsed = parseTownJson(HOUSE_TOWNS_JSON);
  const ae = parsed.rows.find((r) => r.name === "Aeugst a.A.")!; // one-year row has a null median in the fixture: a longer pool is used
  assert.ok(ae.pooling > 1);
  const a = townAnswer(parsed, "house", "Winterthur", "Winterthur");
  assert.equal(a.status, "ok");
  assert.ok((a.price!.median as number) > 500000);
  assert.ok(a.sample_size! >= 5);
  const none = townAnswer(parsed, "house", "Wald", "Wald"); // not in the fixture
  assert.equal(none.status, "no_matches");
});

test("place and type matching", () => {
  assert.equal(matchTown("Winterthur").name, "Winterthur");
  assert.equal(matchTown("Affoltern").name, "Affoltern a.A.");
  assert.equal(matchTown("Oetwil").name, null); // two municipalities
  assert.equal(matchTown("Küsnacht").name, "Küsnacht");
  assert.equal(normaliseKind("Einfamilienhaus"), "house");
  assert.equal(normaliseKind(undefined), null);
  assert.throws(() => normaliseKind("castle"), InputError);
});

test("serves: canton places and houses yes; city flats and Basel-Landschaft no", () => {
  const s = (town?: string, property_type?: string, country = "CH") => servesZh({ country, town, property_type }, servesBl);
  assert.equal(s("Winterthur", "flat"), true);
  assert.equal(s("Uster"), true);
  assert.equal(s("Seegemeinden", "house"), true);
  assert.equal(s("Kanton Zürich"), true);
  assert.equal(s("Zürich", "house"), true);
  assert.equal(s("Zürich", "flat"), false);
  assert.equal(s(undefined, "flat"), false);
  assert.equal(s("Zürich"), false);
  assert.equal(s("Liestal", "house"), false);
  assert.equal(s("Winterthur", "flat", "DE"), false);
  assert.equal(s("Bern", "house"), true); // answers with the list of places we have
});

test("zhHomeSales end to end with a stub fetch", async () => {
  const get = async (u: string) => (u.endsWith(".csv") ? FLAT_REGIONS_CSV : JSON.stringify(HOUSE_TOWNS_JSON));
  const r = await zhHomeSales({ town: "Seegemeinden", property_type: "flat" }, get);
  assert.equal(r.price!.median, 2000000);
  const t = await zhHomeSales({ town: "Winterthur", property_type: "house" }, get);
  assert.equal(t.status, "ok");
  await assert.rejects(() => zhHomeSales({ town: "Bern", property_type: "house" }, get), /No canton Zürich place/);
  await assert.rejects(() => zhHomeSales({ town: "Zürich", property_type: "flat" }, get), InputError);
});
