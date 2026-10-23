// Tests for FI household electricity (Statistics Finland table 13rb). Metadata is real (probe 2026-10-23); the data fixture is SYNTHETIC (see fixtures.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { SYNTHETIC_JSON } from "./fixtures";
import { INFO, fiAnswer, fiEnergy, fiHarvest, fiHistoryKey, harvestFromTable, normaliseBand, normaliseTaxes, parseTable, priceAt, query, API } from "./source";
import manifest from "./index";
import eu from "../eu-energy/index";
import { findSource } from "../../lib/registry";

test("query asks for the newest 14 months, four components, five household bands", () => {
  const q = query();
  assert.equal(q.query[0].code, "timeperiod_m");
  assert.deepEqual(q.query[0].selection, { filter: "top", values: ["14"] });
  assert.deepEqual(q.query[2].selection.values, ["A", "B", "C", "D", "E"]);
  assert.equal(q.response.format, "json-stat2");
  assert.match(API, /StatFin\/ehi\/13rb\.px$/);
});

test("parseTable converts c/kWh to EUR/kWh and leaves out missing cells", () => {
  const t = parseTable(SYNTHETIC_JSON);
  assert.deepEqual([...t.keys()], ["2025-05", "2025-06", "2026-05", "2026-06"]);
  assert.equal(t.get("2026-06")!.get("DC")!.total, 0.2025);
  assert.equal(t.get("2026-06")!.get("DC")!.energy, 0.09);
  assert.equal(t.get("2026-06")!.get("DE")!.total, undefined); // missing cell
});

test("default band DC: newest month, an official statistic with no sample size", () => {
  const a = fiAnswer(parseTable(SYNTHETIC_JSON), { band: normaliseBand(), taxes: "all" });
  assert.equal(a.status, "ok");
  assert.equal(a.price?.value, 0.2025);
  assert.equal(a.price?.currency, "EUR");
  assert.equal(a.price?.unit, "per kWh");
  assert.equal(a.price?.measure, "average");
  assert.equal(a.price?.typical_low, null);
  assert.equal(a.sample_size, null);
  assert.equal(a.price_type, "official_statistic");
  assert.deepEqual(a.period, { from: "2026-06-01", to: "2026-06-30" });
  assert.equal(a.statistic?.reference_period, "2026-06");
  assert.match(a.summary, /June 2026/);
  assert.match(a.summary, /higher than in June 2025/);
  assert.match(JSON.stringify(a), /Statistics Finland/);
  assert.equal(INFO.price_type, "official_statistic");
  assert.equal((a.extra as any).same_month_last_year.reference_period, "2025-06");
});

test("taxes none = energy + distribution; excl_vat is refused", () => {
  assert.equal(priceAt({ energy: 0.09, distribution: 0.075, taxes: 0.0375, total: 0.2025 }, "none"), 0.165);
  assert.equal(priceAt({ total: 0.2 }, "none"), null);
  const a = fiAnswer(parseTable(SYNTHETIC_JSON), { band: normaliseBand("DC"), taxes: "none" });
  assert.equal(a.price?.value, 0.165);
  assert.match(JSON.stringify(a), /calculated by ProofPrice/);
  assert.throws(() => normaliseTaxes("excl_vat"), /not available/);
});

test("a band whose newest month is missing falls back to its newest published month and says so", () => {
  const a = fiAnswer(parseTable(SYNTHETIC_JSON), { band: normaliseBand("DE"), taxes: "all" });
  assert.equal(a.statistic?.reference_period, "2026-05");
  assert.match(JSON.stringify(a), /has published June 2026, but not for this band/);
});

test("bands and errors", () => {
  assert.equal(normaliseBand("dd").code, "DD");
  assert.equal(normaliseBand("KWH2500-4999").code, "DC");
  assert.throws(() => normaliseBand("ZZ"), /must be one of/);
  assert.throws(() => parseTable({ class: "dataset", id: ["x"], size: [1], dimension: { x: { category: { index: { a: 0 } } } }, value: [1] }), /unexpected format/);
});

test("fiEnergy posts once to the 13rb table and returns the answer", async () => {
  const calls: Array<[string, any]> = [];
  const a = await fiEnergy({ consumption_band: "DB" }, async (u, b) => {
    calls.push([u, b]);
    return SYNTHETIC_JSON;
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], API);
  assert.equal(a.status, "ok");
  assert.equal(a.price?.value, 0.24);
});

test("harvest stores the newest month per band and tax level with no invented count, and equals the live answer", async () => {
  const table = parseTable(SYNTHETIC_JSON);
  const h = harvestFromTable(table);
  assert.equal(h.date, "2026-06-01");
  assert.equal(h.currency, "EUR");
  const row = h.rows.find((r) => r.item === "electricity/DC/all")!;
  assert.equal(row.area, "ALL");
  assert.equal(row.median, 0.2025);
  assert.ok(h.rows.every((r) => Number.isNaN(r.n))); // NO_COUNT for every row
  const live = fiAnswer(table, { band: normaliseBand("DC"), taxes: "all" });
  assert.equal(live.price?.value, row.median);
  assert.equal(h.rows.some((r) => r.item === "electricity/DE/all"), false); // newest month missing for DE
  const h2 = await fiHarvest(async () => SYNTHETIC_JSON);
  assert.equal(h2.rows.length, h.rows.length);
});

test("history key", () => {
  assert.deepEqual(fiHistoryKey({ consumption_band: "dd", taxes: "none" })?.item, "electricity/DD/none");
  assert.equal(fiHistoryKey({ consumption_band: "ZZ" }), null);
});

test("routing: FI household electricity goes here, FI gas and business stay with Eurostat", () => {
  const mine = (p: Record<string, unknown>) => manifest.serves!(p);
  const theirs = (p: Record<string, unknown>) => eu.serves!(p);
  assert.equal(mine({ country: "FI", energy: "electricity" }), true);
  assert.equal(theirs({ country: "FI", energy: "electricity" }), false);
  assert.equal(mine({ country: "FI", energy: "gas" }), false);
  assert.equal(theirs({ country: "FI", energy: "gas" }), true);
  assert.equal(mine({ country: "FI", energy: "electricity", sector: "business" }), false);
  assert.equal(theirs({ country: "DE", energy: "electricity" }), true);
  assert.equal(theirs({ country: "SE", energy: "electricity" }), false);
  assert.equal(findSource("energy", "FI", { country: "FI", energy: "electricity" })?.info.id, "fi-stat-energy");
  assert.equal(findSource("energy", "FI", { country: "FI", energy: "gas" })?.info.id, "eu-energy");
});
