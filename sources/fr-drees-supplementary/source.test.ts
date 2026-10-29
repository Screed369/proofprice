// Tests for France supplementary health insurance (DREES survey, data.drees.solidarites-sante.gouv.fr).
// Fixture: fixture.json is the real OpenDataSoft answer for theme = "Primes" (75 rows), fetched through the GitHub probe on 2026-10-29.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { InputError } from "../../lib/http";
import { categoryById, runCategory } from "../../lib/registry";
import { INFO, PROFILES, availableProfiles, clearCache, frAnswer, frDreesSupplementary, parsePremiums, profileKey } from "./source";
import manifest from "./index";

const real = JSON.parse(readFileSync(new URL("./fixture.json", import.meta.url), "utf8"));
const rows = parsePremiums(real.results);
const fetcher = async (url: string) => {
  assert.match(url, /enquete-oc-depuis-2019\/records/);
  assert.match(url, /theme/);
  return real;
};

test("the real fixture parses: 75 average-premium rows", () => {
  assert.equal(real.total_count, 75);
  assert.equal(rows.length, 75);
  assert.deepEqual(rows.find((r) => r.year === 2023 && r.contract === "individual" && r.modalite === "À 60 ans"), { year: 2023, contract: "individual", modalite: "À 60 ans", value: 93.97 });
});

test("rows that are not average premiums in euros are dropped", () => {
  const bad = [
    { ...real.results[0], indicateur: "Taux de remboursement" },
    { ...real.results[0], unite: "pourcentage" },
    { ...real.results[0], valeur: null },
    { ...real.results[0], famille_d_organisme: "Mutuelles" },
    { ...real.results[0], type_de_contrat: "Autre" },
  ];
  assert.equal(parsePremiums(bad).length, 0);
});

test("profile words map to the survey's wording", () => {
  assert.equal(profileKey(undefined), "single");
  assert.equal(profileKey("age 60"), "age_60");
  assert.equal(profileKey("60"), "age_60");
  assert.equal(profileKey("85 years"), "age_85");
  assert.equal(profileKey("Couple with 2 kids"), "couple_2_children");
  assert.equal(profileKey("couple"), "couple");
  assert.equal(profileKey("couple_3_children"), "couple_3_children");
  assert.equal(profileKey("seul"), "single");
  assert.equal(profileKey("lowest income"), "lowest_income");
  assert.equal(profileKey("dearest area"), "dearest_area");
  assert.equal(profileKey("any age"), "any_age");
  assert.equal(profileKey("age 33"), null);
  assert.equal(profileKey("goldfish"), null);
  for (const key of Object.keys(PROFILES)) assert.equal(profileKey(key), key);
});

test("default: the newest survey (2023), single reference insured, individual contract", () => {
  const a = frAnswer(rows, {});
  assert.equal(a.status, "ok");
  assert.equal(a.price?.value, 61.67);
  assert.equal(a.price?.currency, "EUR");
  assert.equal(a.price?.unit, "per month");
  assert.equal(a.price?.measure, "average");
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.sample_size, null);
  assert.equal(a.statistic?.reference_period, "2023");
  assert.deepEqual(a.period, { from: "2023-01-01", to: "2023-12-31" });
  assert.match(a.summary, /2023/);
  assert.match(a.summary, /58/); // the 2021 survey figure, 58.46
  assert.match(a.summary, /not a quote/);
  assert.match(a.source.licence, /Licence Ouverte/);
});

test("age 60, 2021 and a group contract", () => {
  const age = frAnswer(rows, { profile: "age 60", year: 2021 });
  assert.equal(age.price?.value, 92.04);
  assert.equal(age.statistic?.reference_period, "2021");
  const group = frAnswer(rows, { profile: "couple 2 children", contract: "group" });
  assert.equal(group.price?.value, 137.15);
  assert.match(group.summary, /group/);
});

test("asking for something the survey does not publish is no_matches, listing what exists", () => {
  const a = frAnswer(rows, { profile: "age 60", contract: "group" });
  assert.equal(a.status, "no_matches");
  assert.ok((a.extra as any).available_profiles.includes("any_age"));
  assert.ok(!(a.extra as any).available_profiles.includes("age_60"));
  const y = frAnswer(rows, { profile: "single", year: 2022 });
  assert.equal(y.status, "no_matches");
  assert.match(y.summary, /2019, 2021, 2023/);
  assert.ok(availableProfiles(rows, "individual").includes("age_85"));
});

test("an unknown profile is a 400 with the valid names", () => {
  assert.throws(() => frAnswer(rows, { profile: "goldfish" }), (e: unknown) => e instanceof InputError && /age_60/.test((e as Error).message));
});

test("live path through the fetcher", async () => {
  clearCache();
  const a = await frDreesSupplementary({ profile: "age 20" }, { fetcher });
  assert.equal(a.price?.value, 36.31);
});

test("the manifest: category, country, a working example, licence text", async () => {
  assert.equal(manifest.category, "supplementary-health-insurance");
  assert.deepEqual(manifest.countries, ["FR"]);
  assert.equal(INFO.price_type, "official_statistic");
  assert.ok(manifest.examples && manifest.examples.length >= 1);
  assert.ok(INFO.attribution.includes("DREES"));
});

test("the tool rejects a bad contract and a bad year in plain words", async () => {
  await assert.rejects(runCategory(categoryById("supplementary-health-insurance")!, { country: "FR", contract: "weird" }), /individual|group/);
  await assert.rejects(runCategory(categoryById("supplementary-health-insurance")!, { country: "FR", year: "abc" }), /year/);
});
