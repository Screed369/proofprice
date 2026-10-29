// Tests for the WFP food prices source. Fixtures are real rows from the HDX 2026 file and the real package listing, fetched 2026-10-18 (see fixtures.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { HDX_PACKAGE, WFP_2026_SAMPLE } from "./fixtures";
import {
  ASOF_ITEM, COUNTRIES, INFO, LISTED, Newest, Obs, asOfDate, buildRows, defsFor, itemKey, matchItems, parseWfp, splitLine, wfpAnswerFromRows, yearlyFiles,
} from "./source";
import manifest from "./index";
import { categoryById, countriesFor } from "../../lib/registry";

function sampleObs(): Obs[] {
  const n = new Newest();
  parseWfp(WFP_2026_SAMPLE, (o) => n.add(o));
  return n.all();
}

test("parseWfp reads the real rows: food only, actual only, USD price", () => {
  const seen: Obs[] = [];
  const r = parseWfp(WFP_2026_SAMPLE, (o) => seen.push(o));
  assert.ok(r.rows > 250 && r.kept < r.rows, "wages, fuel and exchange rates are dropped");
  const wheat = seen.filter((o) => o.item === "Wheat|KG|Retail");
  assert.equal(wheat.length, 19);
  assert.equal(wheat[0].iso3, "AFG");
  assert.equal(wheat[0].date, "2026-05-15");
  assert.equal(wheat[0].usd, 0.42);
  assert.ok(!seen.some((o) => /wage|exchange|diesel/i.test(o.item)), "non-food rows never reach the library");
});

test("splitLine handles quoted names with commas; item keys are one CSV cell", () => {
  assert.deepEqual(splitLine('AFG,2026-05-15,"Wage (non-qualified labour, non-agricultural)",465'), ["AFG", "2026-05-15", "Wage (non-qualified labour, non-agricultural)", "465"]);
  assert.equal(itemKey("Meat (chicken, whole)", "KG", "Retail"), "Meat (chicken/whole)|KG|Retail");
});

test("a wrong header is refused with a plain message", () => {
  assert.throws(() => parseWfp("a,b,c\n1,2,3\n", () => {}), /new layout/);
});

test("buildRows: one aggregate per food across markets, 5-market rule, and an as-of row", () => {
  const b = buildRows(sampleObs());
  assert.deepEqual(b.countries, ["AFG"]);
  const wheat = b.rows.find((r) => r.area === "AFG" && r.item === "Wheat|KG|Retail")!;
  assert.equal(wheat.n, 19);
  assert.equal(wheat.median, 0.42);
  assert.equal(wheat.min, 0.34);
  assert.equal(wheat.max, 0.54);
  assert.ok(b.rows.every((r) => (r.item === ASOF_ITEM ? Number.isNaN(r.n) : r.n >= 5)), "food rows rest on 5+ markets; the as-of marker row carries no count");
  assert.equal(asOfDate(b.rows, "AFG"), "2026-05-15");
  assert.ok(b.rows.some((r) => r.item === ASOF_ITEM));
});

test("a newer price from the same market replaces an older one; fewer than 5 markets are never published", () => {
  const mk = (market: string, date: string, usd: number): Obs => ({ iso3: "KEN", date, market, item: "Maize|KG|Retail", usd });
  const n = new Newest();
  for (const m of ["a", "b", "c", "d"]) n.add(mk(m, "2026-05-15", 0.5));
  n.add(mk("a", "2026-06-15", 0.9));
  n.add(mk("a", "2026-04-15", 0.1)); // older: ignored
  assert.equal(n.size, 4);
  assert.ok(buildRows(n.all()).rows.length === 0, "4 markets is below the 5-record rule");
  n.add(mk("e", "2026-06-15", 0.7));
  const b = buildRows(n.all());
  const r = b.rows.find((x) => x.item === "Maize|KG|Retail")!;
  assert.equal(r.n, 5);
  assert.equal(r.max, 0.9);
});

test("markets surveyed long before the country's latest survey are left out, and stale countries are dropped", () => {
  const items: Obs[] = [];
  for (const m of ["a", "b", "c", "d", "e"]) items.push({ iso3: "KEN", date: "2026-05-15", market: m, item: "Rice|KG|Retail", usd: 1 });
  items.push({ iso3: "KEN", date: "2026-01-15", market: "old", item: "Rice|KG|Retail", usd: 99 });
  for (const m of ["a", "b", "c", "d", "e"]) items.push({ iso3: "TCD", date: "2025-01-15", market: m, item: "Rice|KG|Retail", usd: 1 });
  const b = buildRows(items);
  assert.deepEqual(b.countries, ["KEN"]);
  assert.deepEqual(b.dropped.tooOld, ["TCD"]);
  assert.equal(b.rows.find((r) => r.item === "Rice|KG|Retail")!.max, 1);
});

test("yearlyFiles lists the yearly CSVs of the real package reply, newest first", () => {
  const f = yearlyFiles(HDX_PACKAGE);
  assert.deepEqual(f.map((x) => x.year), [2026, 2025, 2024]);
  assert.ok(f[0].url.endsWith("wfp_food_prices_global_2026.csv"));
  assert.throws(() => yearlyFiles({ result: {} }), /no resources/);
});

const day = () => ({ date: "2026-10-18", rows: buildRows(sampleObs()).rows });

test("Afghanistan wheat: median 0.42 USD per KG over 19 markets, posted market-survey price", () => {
  const a = wfpAnswerFromRows(day(), { country: "AF", item: "wheat", today: "2026-10-18" });
  assert.equal(a.status, "ok");
  assert.equal(a.price?.value, 0.42);
  assert.equal(a.price?.currency, "USD");
  assert.equal(a.price?.unit, "per KG");
  assert.equal(a.sample_size, 19);
  assert.equal(a.period.to, "2026-05-15");
  assert.equal(a.price_type, "posted_price");
  assert.match(a.summary, /not receipts/);
  assert.equal(a.source.licence, INFO.licence);
});

test("item matching: plural, wholesale word, and related definitions listed", () => {
  const defs = defsFor(day().rows, "AFG");
  assert.equal(matchItems(defs, "rice")[0].name.startsWith("Rice"), true);
  assert.ok(matchItems(defs, "Rice").length >= 2, "high and low quality rice both match");
  assert.equal(matchItems(defs, "oil")[0].name, "Oil (cooking)");
  assert.equal(matchItems(defs, "wheat flours")[0].name.startsWith("Wheat flour"), true);
  assert.equal(matchItems(defs, "caviar").length, 0);
  const a = wfpAnswerFromRows(day(), { country: "AF", item: "rice" });
  assert.ok(Array.isArray((a.extra as any).other_definitions));
});

test("an unknown food lists what is held; a country with no data says so; a region is refused", () => {
  const a = wfpAnswerFromRows(day(), { country: "AF", item: "caviar" });
  assert.equal(a.status, "no_matches");
  assert.match(String((a.extra as any).hint), /Foods held:/);
  const b = wfpAnswerFromRows(day(), { country: "KE", item: "maize" });
  assert.equal(b.status, "no_matches");
  assert.throws(() => wfpAnswerFromRows(day(), { country: "AF", item: "wheat", region: "Kabul" }), /region must be left out/);
  assert.throws(() => wfpAnswerFromRows(day(), { country: "AF", item: "" }), /item is required/);
  assert.throws(() => wfpAnswerFromRows(day(), { country: "FR", item: "wheat" }), /country must be one of/);
});

test("our copy older than a week is flagged stale", () => {
  const a = wfpAnswerFromRows(day(), { country: "AF", item: "wheat", today: "2026-11-01" });
  assert.equal((a.extra as any).stale, true);
});

test("manifest: groceries tool, listed countries, harvest, a smoke example for Afghanistan", () => {
  assert.equal(manifest.category, "groceries");
  assert.ok(manifest.harvest && manifest.historyKey);
  assert.ok(manifest.countries.includes("IN") && manifest.countries.includes("AF"));
  assert.deepEqual([...manifest.countries].sort(), [...LISTED].sort());
  assert.ok(LISTED.every((c) => COUNTRIES[c]), "every listed country has a mapping");
  assert.equal(manifest.examples[0].params.country, "AF");
  assert.ok(categoryById("groceries"));
  assert.ok(countriesFor("groceries").includes("AF"));
});

import manifestWfp from "./index";
test("serves(): Indonesia PIHPS staples go to id-bi-pihps, other ID items and other countries stay with WFP", () => {
  const s = manifestWfp.serves!;
  assert.equal(s({ country: "ID", item: "rice" }), false);
  assert.equal(s({ country: "ID", item: "wheat flour" }), true);
  assert.equal(s({ country: "AF", item: "rice" }), true);
});
