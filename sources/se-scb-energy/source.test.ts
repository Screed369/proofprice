// Tests for SE household electricity (SCB table TAB4310). The real fixture is the proven 2026H1 reply; the synthetic one tests arithmetic only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { REAL_CSV, SYNTHETIC_CSV } from "./fixtures";
import { INFO, normaliseBand, parseTable, priceAt, seAnswer, url } from "./source";
import manifest from "./index";
import eu from "../eu-energy/index";
import { findSource } from "../../lib/registry";

test("parseTable reads the real SCB reply (csek/kWh -> SEK/kWh)", () => {
  const t = parseTable(REAL_CSV);
  assert.deepEqual([...t.keys()], ["2026-S1"]);
  assert.equal(t.get("2026-S1")!.get("DA")!.total, 6.3468);
  assert.equal(t.get("2026-S1")!.get("DE")!.energy, 0.9442);
});

test("default band DC: 3.3038 SEK per kWh for the first half of 2026, an official statistic with no sample size", () => {
  const a = seAnswer(parseTable(REAL_CSV), { band: normaliseBand(), taxes: "all" });
  assert.equal(a.status, "ok");
  assert.equal(a.price?.value, 3.3038);
  assert.equal(a.price?.currency, "SEK");
  assert.equal(a.price?.unit, "per kWh");
  assert.equal(a.price?.measure, "average");
  assert.equal(a.price?.typical_low, null);
  assert.equal(a.sample_size, null);
  assert.equal(a.price_type, "official_statistic");
  assert.deepEqual(a.period, { from: "2026-01-01", to: "2026-06-30" });
  assert.equal(a.statistic?.reference_period, "2026-S1");
  assert.match(a.summary, /first half of 2026/);
  assert.match(JSON.stringify(a), /Statistics Sweden/);
  assert.equal(INFO.price_type, "official_statistic");
});

test("excl_vat needs SCB's VAT part: with only the real columns it is not guessed", () => {
  assert.equal(priceAt({ total: 3.3038 }, "excl_vat"), null);
  const a = seAnswer(parseTable(REAL_CSV), { band: normaliseBand("DC"), taxes: "excl_vat" });
  assert.equal(a.status, "no_matches");
});

test("SYNTHETIC two half-years: tax levels, previous half-year change, a missing newest cell falls back", () => {
  const t = parseTable(SYNTHETIC_CSV);
  const dc = seAnswer(t, { band: normaliseBand("DC"), taxes: "excl_vat" });
  assert.equal(dc.price?.value, 2.6430); // 3.3038 - 0.6608
  assert.equal((dc.extra as any).price_by_tax_level_sek_per_kwh.excluding_all_taxes, 2.2230);
  assert.equal((dc.extra as any).previous_period.reference_period, "2025-S2");
  assert.match(dc.note ?? JSON.stringify(dc), /calculated by ProofPrice/);
  const de = seAnswer(t, { band: normaliseBand("DE"), taxes: "all" });
  assert.equal(de.statistic?.reference_period, "2025-S2"); // 2026H1 for DE is ".."
  assert.equal(de.price?.value, 2.3);
});

test("bands and errors", () => {
  assert.equal(normaliseBand("dd").code, "DD");
  assert.equal(normaliseBand("KWH2500-4999").code, "DC");
  assert.throws(() => normaliseBand("ZZ"), /must be one of/);
  assert.throws(() => parseTable('"Region","x"\n"a",1\n'), /unexpected format/);
  assert.match(url(), /valuecodes%5BTid%5D=\*/);
});

test("routing: SE household electricity goes here, SE gas and business stay with Eurostat", () => {
  const mine = (p: Record<string, unknown>) => manifest.serves!(p);
  const theirs = (p: Record<string, unknown>) => eu.serves!(p);
  assert.equal(mine({ country: "SE", energy: "electricity" }), true);
  assert.equal(theirs({ country: "SE", energy: "electricity" }), false);
  assert.equal(mine({ country: "SE", energy: "gas" }), false);
  assert.equal(theirs({ country: "SE", energy: "gas" }), true);
  assert.equal(theirs({ country: "DE", energy: "electricity" }), true);
  assert.equal(findSource("energy", "SE", { country: "SE", energy: "electricity" })?.info.id, "se-scb-energy");
  assert.equal(findSource("energy", "SE", { country: "SE", energy: "gas" })?.info.id, "eu-energy");
});
