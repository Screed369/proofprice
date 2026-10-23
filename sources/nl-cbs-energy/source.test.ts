// Tests for NL household electricity and gas (CBS table 85666NED). The real fixture is the proven 2026HJ01 reply (probe 2026-10-23); WITH_PREVIOUS adds SYNTHETIC rows for arithmetic only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { REAL_BODY, WITH_PREVIOUS } from "./fixtures";
import { INFO, nlAnswer, normaliseBand, normaliseTaxes, parseTable, url } from "./source";
import manifest from "./index";
import eu from "../eu-energy/index";
import { findSource } from "../../lib/registry";

test("parseTable reads the real CBS reply and keeps only half-years", () => {
  const t = parseTable(WITH_PREVIOUS);
  assert.deepEqual([...t.keys()].sort(), ["2025-H2", "2026-H1"]);
  assert.equal(t.get("2026-H1")!.get("all")!.total!.k_25Tot5MWh_11, 0.244);
  assert.equal(t.get("2026-H1")!.get("none")!.total!.k_569Tot5687M3_2, 0.709);
});

test("default electricity class DC: 0.244 euro per kWh in the first half of 2026, official statistic, no sample size", () => {
  const a = nlAnswer(parseTable(REAL_BODY), { energy: "electricity", band: normaliseBand("electricity"), taxes: "all" });
  assert.equal(a.status, "ok");
  assert.equal(a.price?.value, 0.244);
  assert.equal(a.price?.currency, "EUR");
  assert.equal(a.price?.unit, "per kWh");
  assert.equal(a.price?.typical_low, null);
  assert.equal(a.sample_size, null);
  assert.equal(a.price_type, "official_statistic");
  assert.deepEqual(a.period, { from: "2026-01-01", to: "2026-06-30" });
  assert.equal(a.statistic?.reference_period, "2026-H1");
  assert.match(a.summary, /first half of 2026/);
  assert.match(JSON.stringify(a), /Statistics Netherlands/);
  assert.match(JSON.stringify(a), /provisional/);
  assert.equal(INFO.price_type, "official_statistic");
  const x = a.extra as any;
  assert.equal(x.price_by_tax_level_eur.excluding_vat, 0.202);
  assert.equal(x.price_by_tax_level_eur.excluding_all_taxes, 0.268);
  assert.equal(x.cbs_parts_eur.supply, 0.104);
  assert.equal(x.cbs_parts_eur.network, 0.14);
});

test("default gas class D2: 1.585 euro per m3, with a calculated price per kWh", () => {
  const a = nlAnswer(parseTable(REAL_BODY), { energy: "gas", band: normaliseBand("gas"), taxes: "all" });
  assert.equal(a.price?.value, 1.585);
  assert.equal(a.price?.unit, "per m3");
  assert.equal((a.extra as any).price_per_kwh_eur_calculated, 0.1622);
  assert.equal((a.extra as any).all_bands.length, 3);
});

test("a class whose total is not positive is not offered as a price; the supply price may be negative", () => {
  const t = parseTable({ value: [{ Prijscomponenten: "A047656", Belastingen: "A047659", Perioden: "2026HJ01", MinderDan1MWh_9: -0.1, k_25Tot5MWh_11: 0.24 }] });
  const a = nlAnswer(t, { energy: "electricity", band: normaliseBand("electricity", "DA"), taxes: "all" });
  assert.equal(a.status, "no_matches");
  assert.match(a.summary, /no positive household electricity price/);
  const real = nlAnswer(parseTable(REAL_BODY), { energy: "electricity", band: normaliseBand("electricity", "DA"), taxes: "all" });
  assert.equal(real.price?.value, 0.08);
  assert.equal((real.extra as any).cbs_parts_eur.supply, -0.584);
});

test("SYNTHETIC previous half-year: change is calculated; the annual row is ignored", () => {
  const a = nlAnswer(parseTable(WITH_PREVIOUS), { energy: "electricity", band: normaliseBand("electricity", "DC"), taxes: "all" });
  assert.equal((a.extra as any).previous_period.reference_period, "2025-H2");
  assert.equal((a.extra as any).previous_period.change_percent, 10.9); // 0.22 -> 0.244
  assert.match(a.summary, /higher than in the second half of 2025/);
});

test("bands, taxes and errors", () => {
  assert.equal(normaliseBand("electricity", "dd").code, "DD");
  assert.equal(normaliseBand("electricity", "KWH2500-4999").code, "DC");
  assert.equal(normaliseBand("gas", "GJ20-199").code, "D2");
  assert.throws(() => normaliseBand("gas", "DC"), /must be one of/);
  assert.equal(normaliseTaxes("excl_vat"), "excl_vat");
  assert.throws(() => normaliseTaxes("x"), /taxes must be/);
  assert.throws(() => parseTable({ nope: 1 }), /unexpected format/);
  assert.throws(() => parseTable({ value: [] }), /no usable/);
  assert.match(url(), /Perioden/);
});

test("routing: NL household electricity and gas go here, other countries and NL business stay with Eurostat", () => {
  const mine = (p: Record<string, unknown>) => manifest.serves!(p);
  const theirs = (p: Record<string, unknown>) => eu.serves!(p);
  assert.equal(mine({ country: "NL", energy: "electricity" }), true);
  assert.equal(mine({ country: "NL", energy: "gas" }), true);
  assert.equal(theirs({ country: "NL", energy: "electricity" }), false);
  assert.equal(theirs({ country: "NL", energy: "gas" }), false);
  assert.equal(mine({ country: "NL", energy: "gas", sector: "business" }), false);
  assert.equal(mine({ country: "DE", energy: "gas" }), false);
  assert.equal(theirs({ country: "DE", energy: "gas" }), true);
  assert.equal(theirs({ country: "SE", energy: "electricity" }), false);
  assert.equal(findSource("energy", "NL", { country: "NL", energy: "gas" })?.info.id, "nl-cbs-energy");
});
