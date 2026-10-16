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
