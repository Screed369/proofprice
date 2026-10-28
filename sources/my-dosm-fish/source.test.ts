// Tests for Malaysia fish prices (OpenDOSM fish_prices). Fixture = real rows of the live file copied on 2026-10-22 (see fixtures.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { FISH_CSV } from "./fixtures";
import { INFO, fishAnswer, fishHarvest, fishHarvestRows, fishHistoryKey, myFish, parseFishCsv, parseLevel, resolveSpecies } from "./source";
import manifest from "./index";
import { countriesFor } from "../../lib/registry";

const DEC09 = FISH_CSV.split("\n").filter((l, i) => i === 0 || l.startsWith("2009-12-01")).join("\n");
const lib09 = () => {
  const h = fishHarvestRows(parseFishCsv(DEC09));
  return { date: h.date, rows: h.rows };
};
const NOW = new Date("2010-12-20T00:00:00Z");

test("parses the real file format: header, levels, species, sorted months", () => {
  const s = parseFishCsv(FISH_CSV);
  assert.deepEqual(s.get("ex_vessel:kembong"), [{ month: "2009-12", price: 5.74 }]);
  assert.deepEqual(s.get("ex_vessel:kebasi_selangat")?.map((p) => p.month), ["2009-12", "2010-11", "2010-12"]);
  assert.throws(() => parseFishCsv("a,b,c\n1,2,3"), /unexpected header/);
  const junk = parseFishCsv("date,level,species,price\n2009-01-01,ex_vessel,x,0\n2009-01-01,other,x,1\nbad row\n2009-01-01,retail,y_z,3.5");
  assert.equal(junk.size, 1);
});

test("harvest keeps only the newest month, one NO_COUNT row per species and level, dated at month end", () => {
  const h = fishHarvestRows(parseFishCsv(FISH_CSV));
  assert.equal(h.date, "2010-12-31");
  assert.equal(h.currency, "MYR");
  assert.ok(h.rows.every((r) => r.item.startsWith("ex_vessel:") && Number.isNaN(r.n) && r.median === r.low && r.low === r.high));
  assert.equal(h.rows.find((r) => r.item === "ex_vessel:puput")?.median, 4.09);
  const h09 = fishHarvestRows(parseFishCsv(DEC09));
  assert.equal(h09.date, "2009-12-31");
  assert.ok(h09.rows.some((r) => r.item === "retail:kembong"));
  assert.throws(() => fishHarvestRows(parseFishCsv("date,level,species,price\n2009-01-01,retail,a,1")), /only 1 species/);
});

test("fishHarvest downloads through an injected getter", async () => {
  const h = await fishHarvest(async () => FISH_CSV);
  assert.equal(h.date, "2010-12-31");
});

test("mackerel in plain words lists the kinds; kembong answers at the landing level by default", () => {
  const list = fishAnswer(lib09(), { product: "mackerel" }, NOW);
  assert.equal(list.status, "no_matches");
  assert.match(list.summary, /Kembong/);
  assert.match(list.summary, /Tenggiri/);
  const a = fishAnswer(lib09(), { product: "kembong" }, NOW);
  assert.equal(a.status, "ok");
  assert.equal(a.price?.value, 5.74);
  assert.equal(a.price?.currency, "MYR");
  assert.equal(a.price?.unit, "per kg");
  assert.equal(a.price?.measure, "average");
  assert.equal(a.price?.median, null);
  assert.equal(a.price?.typical_low, null);
  assert.equal(a.sample_size, null);
  assert.equal(a.statistic?.reference_period, "2009-12");
  assert.match(a.summary, /fishers in Malaysia received on average/);
  assert.match(a.summary, /December 2009/);
  assert.deepEqual((a.extra as any).by_level, { ex_vessel: 5.74, wholesale: 6.17, retail: 8.94 });
  assert.equal(a.source.licence, INFO.licence);
});

test("retail level is labelled as not what fishers receive; bad level is refused", () => {
  const a = fishAnswer(lib09(), { product: "kembung", level: "shop" }, NOW);
  assert.equal(a.price?.value, 8.94);
  assert.match(a.summary, /retail price of Kembong/);
  assert.match(a.statistic?.note ?? "", /not what fishers receive/);
  assert.throws(() => parseLevel("moon"), /level must be/);
  assert.equal(parseLevel(undefined), "ex_vessel");
});

test("species resolution: exact, English alias, group, unknown", () => {
  const slugs = [...parseFishCsv(DEC09).keys()].map((k) => k.split(":")[1]);
  assert.equal(resolveSpecies("Tenggiri", slugs).primary, "tenggiri");
  assert.equal(resolveSpecies("ikan kembong", slugs).primary, "kembong");
  assert.equal(resolveSpecies("squid", slugs).primary, "sotong_katak");
  assert.ok(resolveSpecies("squid", slugs).candidates.includes("sotong_kereta"));
  assert.equal(resolveSpecies("mackerel", slugs).primary, null);
  assert.equal(resolveSpecies("bawal putih", slugs).primary, "bawal_putih");
  assert.equal(resolveSpecies("tiger prawn", slugs).primary, null);
  assert.equal(resolveSpecies("selar", slugs).primary, "selar");
  const none = fishAnswer(lib09(), { product: "unicorn" }, NOW);
  assert.equal(none.status, "no_matches");
  assert.match(none.summary, /no species "unicorn"/);
});

test("old data is flagged; empty library and empty product are explained", () => {
  const a = fishAnswer(lib09(), { product: "kembong" }, new Date("2026-10-22T00:00:00Z"));
  assert.match(a.summary, /Old data/);
  assert.throws(() => myFish({ product: "kembong" }, () => null), /Not yet available/);
  assert.throws(() => myFish({ product: " " }, lib09), /Give a product/);
});

test("history key points at level:species in the library", () => {
  const rows = lib09().rows;
  assert.deepEqual(fishHistoryKey({ product: "kembong" }, rows)?.item, "ex_vessel:kembong");
  assert.deepEqual(fishHistoryKey({ product: "kembong", level: "retail" }, rows)?.item, "retail:kembong");
  assert.equal(fishHistoryKey({ product: "squid" }, rows)?.item, "ex_vessel:sotong_katak");
  assert.equal(fishHistoryKey({ product: "kembong", level: "xx" }, rows), null);
});

test("manifest: Malaysia in wholesale-fresh-food with a harvest", () => {
  assert.equal(manifest.category, "wholesale-fresh-food");
  assert.deepEqual(manifest.countries, ["MY"]);
  assert.ok(manifest.harvest && manifest.historyKey && manifest.nominalCounts && manifest.referenceDates);
  assert.ok(countriesFor("wholesale-fresh-food").includes("MY"));
});

test("gap G20261023-1: product=squid (English, no level) answers with a named figure and lists the other kinds", () => {
  const a = fishAnswer(lib09(), { product: "squid" }, NOW);
  assert.equal(a.status, "ok");
  assert.equal(a.price?.value, 4.78);
  assert.match(a.summary, /Sotong Katak/);
  assert.match(a.statistic?.note ?? "", /several kinds/);
  const others = (a.extra as any).other_matches.map((m: any) => m.product);
  assert.ok(others.includes("sotong_kereta") && !others.includes("sotong_katak"));
  assert.equal(fishAnswer(lib09(), { product: "cuttlefish" }, NOW).status, "ok");
});

test("freshness text names the newest published month, not the catalogue's 'last updated' date", () => {
  assert.match(INFO.freshness, /December 2025/);
  assert.doesNotMatch(INFO.freshness, /last updated 10 October/);
});
