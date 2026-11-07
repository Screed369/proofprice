// Tests for Japan rice negotiated trade prices (MAFF). Fixtures are real formats captured on 2026-11-07 (see fixtures.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { MAFF_CSV, MAFF_PAGE } from "./fixtures";
import { INFO, csvRows, figureFor, jpRiceHarvest, jpRicePrices, newestCsv, parseRiceCsv, prefectureOf, riceHistoryKey, varietyOf } from "./source";
import manifest from "./index";
import { categoryById, countriesFor } from "../../lib/registry";

const get = async (url: string): Promise<string> => {
  if (url.endsWith("aitaikakaku.html")) return MAFF_PAGE;
  if (url.endsWith("aitaikakaku-297.csv")) return MAFF_CSV;
  throw new Error(`unexpected url ${url}`);
};

test("the newest monthly CSV is picked from the page, not a reference or stock file", () => {
  const n = newestCsv(MAFF_PAGE);
  assert.equal(n.url, "https://www.maff.go.jp/j/seisan/keikaku/soukatu/attach/other/aitaikakaku-297.csv");
  assert.deepEqual(n.month, { year: 2026, month: 9 });
});

test("a page with no price CSV is a source error, not a wrong file", () => {
  assert.throws(() => newestCsv("<ul><li>nothing</li></ul>"), /lists no monthly/);
});

test("csvRows reads quoted thousands separators", () => {
  assert.deepEqual(csvRows('a,"18,702",-\nb,1,2\n')[0], ["a", "18,702", "-"]);
});

test("the CSV parses: month from the header, dashes are no price", () => {
  const t = parseRiceCsv(MAFF_CSV);
  assert.deepEqual(t.month, { year: 2026, month: 9 });
  const nat = t.rows.find((r) => r.prefecture.startsWith("全銘柄"))!;
  assert.equal(nat.price, 21293);
  assert.equal(nat.volume, 53814);
  assert.equal(nat.lastYearPrice, 36895);
  const kirara = t.rows.find((r) => r.variety === "きらら３９７")!;
  assert.equal(kirara.price, null);
  assert.throws(() => parseRiceCsv("a,b\n1,2\n"), /unexpected header/);
});

test("names: prefectures and varieties in English and Japanese", () => {
  assert.equal(prefectureOf("Niigata"), "新潟");
  assert.equal(prefectureOf("niigata-ken"), "新潟");
  assert.equal(prefectureOf("新潟県"), "新潟");
  assert.equal(prefectureOf(undefined), null);
  assert.throws(() => prefectureOf("Atlantis"), /prefecture/);
  assert.equal(varietyOf("rice").variety, null);
  assert.equal(varietyOf("Japanese rice").variety, null);
  assert.equal(varietyOf("Koshihikari").variety, "コシヒカリ");
  assert.equal(varietyOf("コシヒカリ").variety, "コシヒカリ");
  assert.throws(() => varietyOf("wheat"), /Give 'rice'/);
});

test("figures: national as published, a single row as published, several rows weighted", () => {
  const t = parseRiceCsv(MAFF_CSV);
  assert.equal(figureFor(t, null, null)!.price, 21293);
  const akita = figureFor(t, "秋田", "あきたこまち")!;
  assert.equal(akita.price, 23309);
  assert.equal(akita.basis, "published");
  const niigata = figureFor(t, "新潟", "コシヒカリ")!;
  assert.equal(niigata.basis, "weighted");
  assert.ok(niigata.price > 22261 && niigata.price < 25218);
  assert.equal(niigata.min, 22261);
  assert.equal(niigata.max, 25218);
  const hokkaido = figureFor(t, "北海道", null)!; // きらら has no price and is left out
  assert.ok(hokkaido.price > 18702 && hokkaido.price < 21196);
  assert.equal(figureFor(t, "岩手", "あきたこまち"), null);
});

test("the national answer is an official statistic with no sample size and no range", async () => {
  const a = await jpRicePrices({ product: "rice" }, get);
  assert.equal(a.status, "ok");
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.price!.value, 21293);
  assert.equal(a.price!.currency, "JPY");
  assert.equal(a.price!.typical_low, null);
  assert.equal(a.sample_size, null);
  assert.equal(a.statistic!.reference_period, "2026-09");
  assert.deepEqual(a.period, { from: "2026-09-01", to: "2026-09-30" });
  assert.match(a.summary, /¥21,293/);
  assert.match(a.summary, /¥36,895/);
  assert.match(a.summary, /-42%/);
  assert.match(a.source.licence, /PDL1\.0/);
});

test("variety in a prefecture; a variety with no price yet is no_matches", async () => {
  const a = await jpRicePrices({ product: "akitakomachi", region: "Akita" }, get);
  assert.equal(a.price!.value, 23309);
  const none = await jpRicePrices({ product: "akitakomachi", region: "Iwate" }, get);
  assert.equal(none.status, "no_matches");
});

test("a bad request fails before any download", async () => {
  let calls = 0;
  const counting = async (u: string) => (calls++, get(u));
  await assert.rejects(() => jpRicePrices({ product: "wheat" }, counting), /Give 'rice'/);
  await assert.rejects(() => jpRicePrices({ product: "rice", region: "Atlantis" }, counting), /prefecture/);
  assert.equal(calls, 0);
});

test("harvest: one row per published figure, dated the last day of the month, no made-up counts", async () => {
  const h = await jpRiceHarvest(get);
  assert.equal(h.date, "2026-09-30");
  assert.equal(h.currency, "JPY");
  const key = (area: string, item: string) => h.rows.find((r) => r.area === area && r.item === item);
  assert.equal(key("ALL", "rice")!.median, 21293);
  assert.equal(key("Akita", "rice/akitakomachi")!.median, 23309);
  assert.ok(key("Niigata", "rice/koshihikari"));
  assert.ok(key("Hokkaido", "rice"));
  assert.ok(h.rows.every((r) => Number.isNaN(r.n)));
});

test("history keys match the harvest rows", async () => {
  const h = await jpRiceHarvest(get);
  for (const p of [{ product: "rice" }, { product: "koshihikari", region: "Niigata" }, { product: "rice", region: "Hokkaido" }]) {
    const k = riceHistoryKey(p)!;
    assert.ok(h.rows.some((r) => r.area === k.area && r.item === k.item), `${JSON.stringify(p)} -> ${k.area}/${k.item}`);
  }
  assert.equal(riceHistoryKey({ product: "koshihikari" }), null);
});

test("manifest: farm-gate-prices tool, JP, licence and examples", () => {
  assert.equal(manifest.category, "farm-gate-prices");
  assert.deepEqual(manifest.countries, ["JP"]);
  assert.equal(INFO.price_type, "official_statistic");
  assert.ok(categoryById("farm-gate-prices"));
  assert.ok(countriesFor("farm-gate-prices").includes("JP"));
});
