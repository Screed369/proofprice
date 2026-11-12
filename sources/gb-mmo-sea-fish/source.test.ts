// Tests for UK sea fish landed prices (MMO). The fixture is a trimmed copy of the real Table 3 read on 2026-11-12.
import { test } from "node:test";
import assert from "node:assert/strict";
import { RELEASE_PAGE, SHEETS } from "./fixtures";
import { INFO, gbSeaFishHarvest, gbSeaFishHistoryKey, gbSeaFishPrices, harvestRows, matchSpecies, monthEnd, parseTable, speciesPrice, workbookUrl } from "./source";
import manifest from "./index";
import { findSource, sourcesFor } from "../../lib/registry";

const table = parseTable(SHEETS);
const get = async () => table;
const ask = (o: { species: string; region?: string }) => gbSeaFishPrices(o, get);

test("parser: month from the Excel serial, species rows, blank price kept as null, notes dropped", () => {
  assert.equal(table.month, "2026-09-01");
  assert.equal(monthEnd(table.month), "2026-09-30");
  const cod = table.rows.find((r) => r.label === "Cod")!;
  assert.equal(Math.round(cod.valueGbp), 7557170);
  assert.equal(table.rows.find((r) => r.label === "Sand Eels")?.perTonne, null);
  assert.ok(!table.rows.some((r) => /usage notes|see below|bream:/i.test(r.label)));
  assert.throws(() => parseTable([{ name: "Intro", rows: [] }]), /Table 3/);
  assert.throws(() => parseTable([{ name: "Table 3", rows: [["x"]] }]), /Live weight/);
});

test("cod: 5,884 GBP/tonne = 5.88 GBP per kg for September 2026", async () => {
  const a = await ask({ species: "cod" });
  assert.equal(a.status, "ok");
  assert.equal(a.price?.value, 5.88);
  assert.equal(a.price?.currency, "GBP");
  assert.equal(a.price?.unit, "per kg");
  assert.equal(a.price?.measure, "average");
  assert.equal(a.price?.median, null);
  assert.equal(a.price?.typical_low, null);
  assert.equal(a.sample_size, null);
  assert.equal(a.price_type, "official_statistic");
  assert.deepEqual(a.period, { from: "2026-09-01", to: "2026-09-30" });
  assert.equal(a.statistic?.reference_period, "2026-09");
  assert.match(a.summary, /UK fishers were paid on average .*5\.88.* per kg for cod in September 2026/);
  assert.match(a.source.attribution, /Open Government Licence v3\.0/);
  assert.equal((a.extra as any).price_per_tonne_gbp, 5884);
});

test("everyday words: monkfish, coley-less names, lemon sole beats sole, groups, nephrops/scampi", async () => {
  assert.equal(matchSpecies("monkfish")?.label, "Monks or Anglers");
  assert.equal(matchSpecies("Lemon sole")?.label, "Lemon Sole");
  assert.equal(matchSpecies("dover sole")?.label, "Sole");
  assert.equal(matchSpecies("scampi")?.label, "Nephrops");
  assert.equal(matchSpecies("fresh lobster tails")?.label, "Lobsters");
  assert.equal(matchSpecies("fish and chips"), null);
  assert.equal(matchSpecies("milk"), null);
  assert.equal(matchSpecies("shellfish")?.label, "Shellfish");
  const lob = await ask({ species: "lobster" });
  assert.equal(lob.price?.value, 14.07);
  const all = await ask({ species: "all fish" });
  assert.equal(all.price?.value, 1.67);
});

test("no landings: Sand Eels has no price and says so; unknown species lists the options", async () => {
  const none = await ask({ species: "sand eels" });
  assert.equal(none.status, "no_matches");
  assert.match(none.summary, /no landed price for sand eels in September 2026/);
  const unknown = await ask({ species: "dragonfruit" });
  assert.equal(unknown.status, "no_matches");
  assert.match(unknown.summary, /cod/);
  await assert.rejects(() => ask({ species: " " }), /species is required/);
});

test("a region is answered with the UK figure and a note", async () => {
  const a = await ask({ species: "haddock", region: "Scotland" });
  assert.equal(a.price?.value, 1.12);
  assert.match(JSON.stringify(a), /Scotland.* answered with the UK figure/);
});

test("speciesPrice falls back to value / weight when the price cell is blank", () => {
  const t = { month: "2026-09-01", rows: [{ label: "Cod", tonnes: 10, valueGbp: 50000, perTonne: null }] };
  assert.equal(speciesPrice(t, "Cod")?.perKg, 5);
  assert.equal(speciesPrice({ ...t, rows: [{ label: "Cod", tonnes: 0, valueGbp: 0, perTonne: null }] }, "Cod"), null);
});

test("workbook link is read from the release page (hash in the URL changes every month)", () => {
  assert.equal(workbookUrl(RELEASE_PAGE), "https://assets.publishing.service.gov.uk/media/6ae34536d22fc5fecb3eb7a7/UK_Sea_Fisheries_Statistics_September_2026.xlsx");
  assert.equal(workbookUrl({ details: { attachments: [] } }), null);
});

test("harvest: one NO_COUNT row per species with a price; sand eels and mussels left out; history key", async () => {
  const h = harvestRows(table);
  assert.equal(h.date, "2026-09-30");
  assert.equal(h.currency, "GBP");
  assert.equal(h.unit, "per kg");
  assert.ok(h.rows.every((r) => r.area === "ALL" && r.median === r.low && r.median === r.high));
  assert.ok(!h.rows.some((r) => r.item === "Sand Eels" || r.item === "Mussels"));
  assert.equal(h.rows.find((r) => r.item === "Cod")?.median, 5.88);
  assert.equal((await gbSeaFishHarvest(get)).rows.length, h.rows.length);
  assert.deepEqual(gbSeaFishHistoryKey({ product: "cod" }), { area: "ALL", item: "Cod", label: "United Kingdom, cod (landed price)" });
  assert.equal(gbSeaFishHistoryKey({ product: "milk" }), null);
});

test("manifest: fish go to this source, milk stays with Defra", () => {
  assert.equal(manifest.info.id, INFO.id);
  assert.ok(sourcesFor("farm-gate-prices").some((s) => s.info.id === "gb-mmo-sea-fish"));
  assert.equal(findSource("farm-gate-prices", "GB", { country: "GB", product: "haddock" })?.info.id, "gb-mmo-sea-fish");
  assert.equal(findSource("farm-gate-prices", "GB", { country: "GB", product: "milk" })?.info.id, "gb-defra-milk");
});
