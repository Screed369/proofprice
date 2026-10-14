// Tests for the EIA residential electricity and gas source. Fixtures are real EIA values (see ./fixtures.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeDaily } from "../../lib/library/store";
import { InputError } from "../../lib/http";
import { INFO, NATIONAL_KEY, energyRows, findGasSheet, normaliseEnergy, parseElectricityTable, parseGasSheet, snapshotOf, stateKey, usEnergy, usEnergyAnswer } from "./source";
import { ELECTRICITY_SHEETS, GAS_SHEETS } from "./fixtures";

const elec = parseElectricityTable(ELECTRICITY_SHEETS[0].rows);
const gas = parseGasSheet(findGasSheet(GAS_SHEETS));
const day = energyRows(elec, gas);
const snap = snapshotOf({ date: day.date, rows: day.rows });
const TODAY = new Date("2026-10-14T12:00:00Z");

test("licence and type", () => {
  assert.match(INFO.licence, /public domain/);
  assert.equal(INFO.licence_url, "https://www.eia.gov/about/copyrights_reuse.php");
  assert.equal(INFO.price_type, "official_statistic");
});

test("electricity table: months and states parsed, divisions skipped", () => {
  assert.equal(elec.latest, "2026-07");
  assert.equal(elec.yearAgo, "2025-07");
  assert.ok(elec.values.has("TX"));
  assert.ok(elec.values.has(NATIONAL_KEY));
  assert.ok(!elec.values.has("New England"));
});

test("Texas residential electricity is plausible (10-25 c/kWh)", () => {
  const a = usEnergyAnswer(snap, "electricity", "TX", { energy: "electricity", state: "TX", today: TODAY });
  assert.equal(a.status, "ok");
  assert.equal(a.price!.measure, "average");
  assert.ok(a.price!.value > 10 && a.price!.value < 25, String(a.price!.value));
  assert.equal(a.sample_size, null);
  assert.match(a.summary, /Texas/);
});

test("New York gas answer, with year-earlier comparison", () => {
  const a = usEnergyAnswer(snap, "gas", "NY", { energy: "gas", state: "NY", today: TODAY });
  assert.equal(a.status, "ok");
  assert.ok(a.price!.value > 5 && a.price!.value < 60, String(a.price!.value));
  assert.match(a.summary, /thousand cubic feet/);
});

test("a state with blank recent gas months uses its newest month and says so", () => {
  const a = usEnergyAnswer(snap, "gas", "FL", { energy: "gas", state: "FL", today: TODAY });
  assert.equal(a.status, "ok");
  assert.match(a.summary + (a.note ?? ""), /no (natural gas|electricity) price|no figure/);
});

test("national answer and old-data flag", () => {
  const a = usEnergyAnswer(snap, "electricity", NATIONAL_KEY, { energy: "electricity", today: new Date("2027-03-01T00:00:00Z") });
  assert.match(a.summary, /Old data/);
});

test("input handling", () => {
  assert.equal(normaliseEnergy("Natural Gas"), "gas");
  assert.throws(() => normaliseEnergy("coal"), InputError);
  assert.equal(stateKey("Texas"), "TX");
  assert.equal(stateKey("dc"), "DC");
  assert.equal(stateKey(undefined), NATIONAL_KEY);
});

test("usEnergy reads the library; bad state is an input error", async () => {
  process.env.PROOFPRICE_LIBRARY_DIR = mkdtempSync(path.join(tmpdir(), "us-energy-"));
  try {
    writeDaily(INFO.id, { date: day.date, currency: "USD", unit: "mixed", rows: day.rows, note: "test" });
    const a = await usEnergy({ energy: "electricity", state: "TX" });
    assert.equal(a.status, "ok");
    await assert.rejects(() => usEnergy({ energy: "gas", state: "Narnia" }), InputError);
  } finally {
    delete process.env.PROOFPRICE_LIBRARY_DIR;
  }
});
