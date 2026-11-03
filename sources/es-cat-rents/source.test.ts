// Fixtures: real Socrata rows from analisi.transparenciacatalunya.cat dataset qww9-bvhh, captured 2026-10-16 via the GitHub-hosted probe.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { INFO, buildUrl, esCatRent, latestQuarter, nameKey, parseRows, pickMunicipality, quarterDates } from "./source";

const BCN = JSON.parse(readFileSync(new URL("./fixtures/barcelona.json", import.meta.url), "utf8"));
const SAB = JSON.parse(readFileSync(new URL("./fixtures/sabadell.json", import.meta.url), "utf8"));

test("parses rows and keeps numbers", () => {
  const r = parseRows(BCN);
  assert.equal(r.length, 1);
  assert.equal(r[0].name, "Barcelona");
  assert.equal(r[0].contracts, 8156);
  assert.ok(Math.abs(r[0].rent - 1137.35) < 0.01);
  assert.ok(INFO.attribution.includes("Generalitat"));
});

test("latest single quarter ignores cumulative periods", () => {
  const l = latestQuarter(parseRows(SAB))!;
  assert.equal(l.year, 2026);
  assert.equal(l.period, "gener-març");
  assert.equal(quarterDates(2026, "gener-març")!.label, "2026-Q1");
  assert.equal(quarterDates(2026, "gener-març")!.to, "2026-03-31");
  assert.equal(quarterDates(2025, "gener-juny"), null);
});

test("name matching handles Catalan articles", () => {
  assert.equal(nameKey("Canonja, la"), nameKey("La Canonja"));
  assert.equal(nameKey("Ampolla, l'"), nameKey("l'Ampolla"));
});

test("several matches are refused", () => {
  const rows = parseRows([
    { ambit_territorial: "Municipi", codi_territorial: "1", nom_territori: "Sant Cugat del Vallès", any: "2026", periode: "gener-març", habitatges: "50", renda: "900" },
    { ambit_territorial: "Municipi", codi_territorial: "2", nom_territori: "Sant Cugat Sesgarrigues", any: "2026", periode: "gener-març", habitatges: "10", renda: "600" },
  ]);
  assert.throws(() => pickMunicipality(rows, "Sant Cugat"), /several/);
  assert.equal(pickMunicipality(rows, "Sant Cugat del Valles").length, 1);
});

test("url asks only for municipalities", () => {
  const u = new URL(buildUrl("Sabadell"));
  assert.equal(u.hostname, "analisi.transparenciacatalunya.cat");
  assert.match(u.searchParams.get("$where")!, /SABADELL/);
});

test("answer for Sabadell", async () => {
  const a = await esCatRent({ town: "Sabadell" }, async () => SAB);
  assert.equal(a.status, "ok");
  assert.equal(a.price?.value, 869);
  assert.equal(a.price?.currency, "EUR");
  assert.equal(a.price?.measure, "average");
  assert.equal(a.sample_size, 708);
  assert.equal(a.period.from, "2026-01-01");
  assert.equal(a.price_type, "official_statistic");
});

test("unknown town and missing town", async () => {
  await assert.rejects(() => esCatRent({ town: "Atlantis" }, async () => []), /No published rent/);
  await assert.rejects(() => esCatRent({}, async () => []), /Give a Catalan/);
});

import { esCatHarvestRows, esCatHistoryKey, harvestUrl } from "./source";

function fakeRows(n: number, period = "gener-març", year = 2026) {
  return Array.from({ length: n }, (_, i) => ({ ambit_territorial: "Municipi", codi_territorial: String(i), nom_territori: `Poble ${i}`, any: String(year), periode: period, habitatges: String(10 + i), renda: String(700 + i) }));
}

test("harvest keeps the newest quarter, one row per municipality, with real counts", () => {
  const rows = parseRows([...fakeRows(25), ...fakeRows(25, "octubre-desembre", 2025), ...BCN, ...SAB]);
  const h = esCatHarvestRows(rows);
  assert.equal(h.date, "2026-03-31");
  assert.equal(h.currency, "EUR");
  assert.equal(h.rows.length, 25 + 2);
  const bcn = h.rows.find((r) => r.area === "barcelona")!;
  assert.equal(bcn.n, 8156);
  assert.equal(bcn.median, 1137);
  assert.ok(h.rows.every((r) => r.item === "new-leases" && r.low === r.median));
});

test("harvest refuses a thin file", () => {
  assert.throws(() => esCatHarvestRows(parseRows(fakeRows(3))), /only 3/);
  assert.throws(() => esCatHarvestRows([]), /no single-quarter/);
});

test("history key matches the harvest area, article order does not matter", () => {
  assert.equal(esCatHistoryKey({ town: "Barcelona" })!.area, "barcelona");
  assert.equal(esCatHistoryKey({ town: "La Canonja" })!.area, esCatHistoryKey({ town: "Canonja, la" })!.area);
  assert.equal(esCatHistoryKey({}), null);
});

test("harvest URL asks for municipalities of the last two years", () => {
  const u = decodeURIComponent(harvestUrl(new Date("2026-11-03T00:00:00Z")));
  assert.ok(u.includes("any >= 2025") && u.includes("Municipi"));
});
