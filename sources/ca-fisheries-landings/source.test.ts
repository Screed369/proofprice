// Tests for Canada sea fish landed value (Fisheries and Oceans Canada). The fixture is a trimmed copy of the real file read on 2026-11-04.
import { test } from "node:test";
import assert from "node:assert/strict";
import { LANDINGS_CSV, PACKAGE_SHOW } from "./fixtures";
import { INFO, caFisheriesHarvest, caFisheriesHistoryKey, caFisheriesPrices, harvestRows, matchSpecies, parseLandings, parseNumber, priceSeries, resolveArea, splitCsvLine } from "./source";
import { parsePackageShow } from "../../lib/adapters";
import manifest from "./index";
import { categoryById, countriesFor, findSource, sourcesFor } from "../../lib/registry";

const pkg = async () => parsePackageShow(PACKAGE_SHOW);
const file = async () => new TextEncoder().encode(LANDINGS_CSV).buffer as ArrayBuffer;
const ask = (o: { species: string; region?: string }) => caFisheriesPrices(o, pkg, file);

test("parser: thousands commas, plain numbers, footer rows dropped", () => {
  assert.deepEqual(splitCsvLine('2024,Atlantic,Shellfish,Lobster,"105,249,198","1,971,588,760"'), ["2024", "Atlantic", "Shellfish", "Lobster", "105,249,198", "1,971,588,760"]);
  assert.equal(parseNumber("105,249,198"), 105249198);
  assert.equal(parseNumber("821261725.4"), 821261725.4);
  assert.equal(parseNumber("x"), null);
  assert.equal(parseNumber(""), null);
  const rows = parseLandings(LANDINGS_CSV);
  assert.ok(rows.every((r) => r.year >= 1990 && r.year <= 2100));
  assert.equal(rows.find((r) => r.year === 2023 && r.area === "Nova Scotia" && r.species === "Lobster")?.cad, 821261725.4);
});

test("lobster in Canada: 2024, 1,971,588,760 CAD over 105,249,198 kg = 18.73 CAD per kg", async () => {
  const a = await ask({ species: "lobster" });
  assert.equal(a.status, "ok");
  assert.equal(a.price?.value, 18.73);
  assert.equal(a.price?.currency, "CAD");
  assert.equal(a.price?.unit, "per kg");
  assert.equal(a.price?.measure, "average");
  assert.equal(a.price?.median, null);
  assert.equal(a.price?.typical_low, null);
  assert.equal(a.sample_size, null);
  assert.equal(a.price_type, "official_statistic");
  assert.deepEqual(a.period, { from: "2024-01-01", to: "2024-12-31" });
  assert.equal(a.statistic?.reference_period, "2024");
  const x = a.extra as any;
  assert.equal(x.change_on_previous_year.reference_year, 2023);
  assert.equal(x.change_on_previous_year.value, 18.1);
  assert.equal(x.species_group, "Shellfish");
  assert.match(a.summary, /fishers were paid on average .*18\.73.* per kg for lobster in 2024/);
  assert.match(a.source.attribution, /Open Government Licence – Canada/);
});

test("snow crab in the Atlantic is the DFO regional figure; salmon in British Columbia is 3.60", async () => {
  const crab = await ask({ species: "Snow crab", region: "Atlantic" });
  assert.equal(crab.price?.value, 7.89);
  const salmon = await ask({ species: "salmon", region: "BC" });
  assert.equal(salmon.price?.value, 3.6);
  assert.equal((salmon.extra as any).area, "British Columbia");
});

test("a species with no landings in the area says so instead of a price", async () => {
  const a = await ask({ species: "lobster", region: "British Columbia" });
  assert.equal(a.status, "no_matches");
  assert.equal(a.price, null);
  assert.match(a.summary, /no landed value for lobster in British Columbia/);
});

test("a city is answered with its province and says so; a place outside the file is refused with the valid areas", async () => {
  const a = await ask({ species: "cod", region: "Halifax, Nova Scotia" });
  assert.equal(a.status, "ok");
  assert.equal((a.extra as any).area, "Nova Scotia");
  assert.match(String((a.extra as any).region_note ?? a.summary), /./);
  await assert.rejects(() => ask({ species: "cod", region: "Ontario" }), /Give one of: Canada, Atlantic/);
  await assert.rejects(() => ask({ species: "" }), /species is required/);
});

test("an unknown species lists the ones we know", async () => {
  const a = await ask({ species: "unicorn" });
  assert.equal(a.status, "no_matches");
  assert.match(a.summary, /lobster/);
});

test("species and area matching", () => {
  assert.equal(matchSpecies("Atlantic cod fillets")?.label, "Cod");
  assert.equal(matchSpecies("wheat"), null);
  assert.equal(matchSpecies("milk"), null);
  assert.equal(resolveArea(undefined).area, "Canada");
  assert.equal(resolveArea("pei").area, "Prince Edward Island");
  const s = priceSeries(parseLandings(LANDINGS_CSV), "Salmon", "Atlantic");
  assert.equal(s.series.length, 0);
  assert.deepEqual(s.unpublished, [2024, 2023, 2022]);
});

test("manifest: category, routing (fish here, crops and livestock stay with Statistics Canada), licence", () => {
  assert.equal(manifest.info.id, "ca-fisheries-landings");
  assert.equal(manifest.category, "farm-gate-prices");
  assert.ok(categoryById("farm-gate-prices"));
  assert.ok(countriesFor("farm-gate-prices").includes("CA"));
  assert.equal(manifest.serves?.({ country: "CA", product: "lobster" }), true);
  assert.equal(manifest.serves?.({ country: "CA", product: "wheat" }), false);
  assert.equal(manifest.serves?.({ country: "CA", product: "milk", region: "Ontario" }), false);
  assert.match(INFO.licence, /Open Government Licence/);
  assert.equal(INFO.price_type, "official_statistic");
});

test("routing: the registry picks this source for fish and ca-farm-prices for everything else", () => {
  const here = sourcesFor("farm-gate-prices").filter((s) => s.countries.includes("CA"));
  assert.equal(here[0].info.id, "ca-farm-prices");
  const pick = (product: string) => (here.find((s) => s.serves?.({ country: "CA", product })) ?? here[0]).info.id;
  assert.equal(findSource("farm-gate-prices", "CA", { country: "CA", product: "lobster" })?.info.id, "ca-fisheries-landings");
  assert.equal(findSource("farm-gate-prices", "CA", { country: "CA", product: "wheat" })?.info.id, "ca-farm-prices");
  assert.equal(pick("lobster"), "ca-fisheries-landings");
  assert.equal(pick("wheat"), "ca-farm-prices");
  assert.equal(pick("hogs"), "ca-farm-prices");
});

test("harvest: one row per species and area for the newest year only, n is NO_COUNT, values match the live answer", async () => {
  const h = await caFisheriesHarvest(pkg, file);
  assert.equal(h.date, "2024-12-31");
  assert.equal(h.currency, "CAD");
  assert.equal(h.unit, "per kg");
  const lobster = h.rows.find((r) => r.area === "Canada" && r.item === "Lobster");
  assert.equal(lobster?.median, 18.73);
  assert.ok(Number.isNaN(lobster?.n));
  assert.equal(lobster?.low, lobster?.high);
  // zero-landing rows (BC lobster, Atlantic salmon) have no price and are left out
  assert.equal(h.rows.find((r) => r.area === "British Columbia" && r.item === "Lobster"), undefined);
  assert.equal(h.rows.find((r) => r.area === "Atlantic" && r.item === "Salmon"), undefined);
  assert.ok(h.rows.every((r) => r.median > 0));
});

test("harvest: a species whose newest price is an older year is not copied as if it were current", () => {
  const rows = parseLandings(LANDINGS_CSV).filter((r) => !(r.year === 2024 && r.species === "Cod" && r.area === "Canada"));
  const h = harvestRows(rows);
  assert.equal(h.rows.find((r) => r.area === "Canada" && r.item === "Cod"), undefined);
  assert.ok(h.rows.find((r) => r.area === "Canada" && r.item === "Lobster"));
});

test("historyKey: matches the harvest keys for species words and regions, null for unknowns", () => {
  assert.deepEqual(caFisheriesHistoryKey({ product: "crab" }), { area: "Canada", item: "Snow crab", label: "Canada, snow crab" });
  assert.deepEqual(caFisheriesHistoryKey({ product: "salmon", region: "BC" }), { area: "British Columbia", item: "Salmon", label: "British Columbia, salmon" });
  assert.equal(caFisheriesHistoryKey({ product: "unicorn" }), null);
  assert.equal(caFisheriesHistoryKey({ product: "cod", region: "Ontario" }), null);
  assert.equal(typeof manifest.harvest, "function");
  assert.equal(manifest.referenceDates, true);
});
