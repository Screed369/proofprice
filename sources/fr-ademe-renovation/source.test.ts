// Fixture rows copied from the live ADEME Data Fair API on 2026-11-12 (/datasets/chauffage/lines and /datasets/isolation/lines, select=...).
import { test } from "node:test";
import assert from "node:assert/strict";
import { InputError } from "../../lib/http";
import { priceAnswerSchema } from "../../lib/schemas";
import { INFO, Line, frRenovation, norm, pickCosts, planFor } from "./source";

const PAC: Line[] = [
  { generateur: "PAC", cout_total_ht: 13032, annee_travaux: 2018, departement: "AIN", region: "ARA" },
  { generateur: "PAC", cout_total_ht: 10405, annee_travaux: 2017, departement: "AIN", region: "ARA" },
  { generateur: "PAC", cout_total_ht: 9000, annee_travaux: 2016, departement: "GIRONDE", region: "NAQ" },
  { generateur: "PAC", cout_total_ht: 11000, annee_travaux: 2017, departement: "GIRONDE", region: "NAQ" },
  { generateur: "PAC", cout_total_ht: 15000, annee_travaux: 216, departement: "GIRONDE", region: "NAQ" },
  { generateur: "PAC", annee_travaux: 2015, departement: "AIN", region: "ARA" },
  { generateur: "POELE", cout_total_ht: 4500, annee_travaux: 2016, departement: "AIN", region: "ARA" },
];
const ISO: Line[] = [
  { poste_isolation: "ITE", cout_total_ht: 12000, annee_travaux: 2016, departement: "MORBIHAN", region: "BRE" },
  { poste_isolation: "ITI", cout_total_ht: 9000, annee_travaux: 2016, departement: "MORBIHAN", region: "BRE" },
  { poste_isolation: "COMBLES PERDUES", cout_total_ht: 3000, annee_travaux: 2016, departement: "MORBIHAN", region: "BRE" },
];

test("planFor maps measures and rejects bad job types", () => {
  assert.equal(planFor("heat_pump")?.dataset, "chauffage");
  assert.deepEqual(planFor("wall_insulation", "external")?.values, ["ITE"]);
  assert.deepEqual(planFor("attic_insulation")?.values, ["COMBLES PERDUES"]);
  assert.equal(planFor("renovation"), null);
  assert.throws(() => planFor("attic_insulation", "garage"), InputError);
});

test("norm drops accents and punctuation", () => {
  assert.equal(norm("Côtes-d'Armor"), "cotes d armor");
});

test("pickCosts filters by kind, skips empty costs, ignores bad years", () => {
  const p = planFor("heat_pump")!;
  const all = pickCosts(PAC, p);
  assert.deepEqual(all.costs, [13032, 10405, 9000, 11000, 15000]);
  assert.deepEqual(all.years, [2018, 2017, 2016, 2017]); // 216 dropped
  assert.equal(pickCosts(PAC, p, "gironde").costs.length, 3);
  assert.equal(pickCosts(PAC, p, "ARA").costs.length, 2);
  assert.deepEqual(pickCosts(ISO, planFor("wall_insulation")!).costs, [12000, 9000]);
});

function fakeApi(rows: Line[]): typeof globalThis.fetch {
  return (async () => new Response(JSON.stringify({ total: rows.length, results: rows }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
}

test("heat pump answer: range, period, historical labels, schema-valid", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = fakeApi(PAC);
  try {
    const a = await frRenovation("heat_pump");
    assert.equal(a.status, "ok");
    assert.equal(a.sample_size, 5);
    assert.equal(a.price?.median, 11000);
    assert.equal(a.price?.currency, "EUR");
    assert.equal(a.period.from, "2016-01-01");
    assert.equal(a.period.to, "2018-12-31");
    assert.equal(a.source.id ?? INFO.id, INFO.id);
    assert.equal(a.extra?.historical, true);
    priceAnswerSchema.parse(a);
  } finally { globalThis.fetch = orig; }
});

test("fewer than 5 jobs gives insufficient_data and no figure", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = fakeApi(PAC);
  try {
    const a = await frRenovation("heat_pump", { area: "AIN" }); // 2 usable jobs
    assert.equal(a.status, "insufficient_data");
    assert.equal(a.price, null);
  } finally { globalThis.fetch = orig; }
});

test("general renovation returns no_matches without a download", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error("must not fetch"); }) as typeof fetch;
  try {
    const a = await frRenovation("renovation");
    assert.equal(a.status, "no_matches");
    assert.equal(a.price, null);
  } finally { globalThis.fetch = orig; }
});
