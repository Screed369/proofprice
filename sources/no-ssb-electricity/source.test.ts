// Tests for NO household electricity by contract type (SSB table 14491). Fixture = REAL reply fetched 2026-10-31 (3 newest quarters, 2025K4..2026K2).
import { test } from "node:test";
import assert from "node:assert/strict";
import { REAL_JSON } from "./fixtures";
import { INFO, URL_RECENT, harvestFromTable, noElAnswer, noElectricity, noElHarvest, noElHistoryKey, normaliseContract, normaliseTaxes, parseTable, quarterRange } from "./source";
import manifest from "./index";
import eu from "../eu-energy/index";
import { findSource } from "../../lib/registry";

test("URL passes all three mandatory variables and asks for the newest 5 quarters", () => {
  assert.match(URL_RECENT, /tables\/14491\/data/);
  assert.match(URL_RECENT, /Kraftpriser%5D=1,1\.1,1\.2,1\.3/);
  assert.match(URL_RECENT, /ContentsCode%5D=KraftprisEA,KraftprisIA/);
  assert.match(URL_RECENT, /Tid%5D=top\(5\)/);
});

test("parseTable converts øre/kWh to NOK/kWh (real reply)", () => {
  const t = parseTable(REAL_JSON);
  assert.deepEqual([...t.keys()].sort(), ["2025K4", "2026K1", "2026K2"]);
  assert.deepEqual(t.get("2026K2")!.get("total"), { none: 1.001, all: 1.223 });
  assert.deepEqual(t.get("2026K2")!.get("fixed"), { none: 0.499, all: 0.61 });
  assert.deepEqual(t.get("2026K2")!.get("spot"), { none: 1.004, all: 1.227 });
  assert.deepEqual(t.get("2026K2")!.get("variable"), { none: 1.121, all: 1.37 });
});

test("default: households total, including VAT, newest quarter, an official statistic with no sample size", () => {
  const a = noElAnswer(parseTable(REAL_JSON), { contract: normaliseContract(), taxes: normaliseTaxes() });
  assert.equal(a.status, "ok");
  assert.equal(a.price?.value, 1.223);
  assert.equal(a.price?.currency, "NOK");
  assert.equal(a.price?.unit, "per kWh");
  assert.equal(a.price?.measure, "average");
  assert.equal(a.price?.typical_low, null);
  assert.equal(a.sample_size, null);
  assert.equal(a.price_type, "official_statistic");
  assert.deepEqual(a.period, { from: "2026-04-01", to: "2026-06-30" });
  assert.equal(a.statistic?.reference_period, "2026K2");
  assert.match(a.summary, /April to June 2026/);
  assert.match(JSON.stringify(a), /Statistics Norway/);
  assert.match(JSON.stringify(a), /grid rent/);
  const x = a.extra as any;
  assert.equal(x.previous_quarter.reference_period, "2026K1");
  assert.equal(x.previous_quarter.change_percent, -16.1); // 1.223 vs 1.458
  assert.equal(x.same_quarter_last_year, null); // the real 3-quarter reply holds no year-earlier quarter
  assert.equal(x.all_contract_types_nok_per_kwh.length, 4);
  assert.deepEqual(x.price_by_tax_level_nok_per_kwh, { including_vat: 1.223, excluding_taxes: 1.001 });
  assert.match(a.summary, /lower than in/);
});

test("spot contract excluding taxes", () => {
  const a = noElAnswer(parseTable(REAL_JSON), { contract: normaliseContract("spot"), taxes: normaliseTaxes("excl_vat") });
  assert.equal(a.price?.value, 1.004);
  assert.match(a.summary, /tied to the spot price/);
  assert.match(a.summary, /excluding taxes/);
});

test("year-on-year change when the year-earlier quarter is in the table", () => {
  const t = parseTable(REAL_JSON);
  t.set("2025K2", new Map([["total", { all: 0.9, none: 0.7 }]]));
  const a = noElAnswer(t, { contract: normaliseContract("total"), taxes: "all" });
  assert.equal((a.extra as any).same_quarter_last_year.change_percent, 35.9);
  assert.match(a.summary, /higher than in April to June 2025/);
});

test("a contract/tax cell missing in the newest quarter falls back to its newest quarter and says so", () => {
  const t = parseTable(REAL_JSON);
  delete (t.get("2026K2")!.get("fixed") as any).all;
  const a = noElAnswer(t, { contract: normaliseContract("fixed"), taxes: "all" });
  assert.equal(a.statistic?.reference_period, "2026K1");
  assert.match(JSON.stringify(a), /has published April to June 2026.*but not for this contract/);
});

test("inputs: aliases, errors", () => {
  assert.equal(normaliseContract("Fixed price").key, "fixed");
  assert.equal(normaliseContract("variable").code, "1.3");
  assert.throws(() => normaliseContract("green"), /contract for Norway/);
  assert.equal(normaliseTaxes("none"), "none");
  assert.throws(() => normaliseTaxes("some"), /taxes for Norway/);
  assert.deepEqual(quarterRange("2025K4"), { from: "2025-10-01", to: "2025-12-31" });
});

test("bad format raises a source error", () => {
  assert.throws(() => parseTable({ class: "dataset", id: ["x"], size: [1], dimension: { x: { category: { index: { a: 0 } } } }, value: [1] }), /unexpected format/);
});

test("noElectricity reads through an injected getter", async () => {
  let asked = "";
  const a = await noElectricity({ contract: "fixed" }, async (u) => ((asked = u), REAL_JSON));
  assert.equal(asked, URL_RECENT);
  assert.equal(a.price?.value, 0.61);
});

test("harvest: newest quarter, 8 rows (4 contracts x 2 tax levels), dated by the quarter's last day, n is NO_COUNT", async () => {
  const h = harvestFromTable(parseTable(REAL_JSON));
  assert.equal(h.date, "2026-06-30");
  assert.equal(h.currency, "NOK");
  assert.equal(h.rows.length, 8);
  const r = h.rows.find((x) => x.item === "electricity/spot/none")!;
  assert.equal(r.median, 1.004);
  const h2 = await noElHarvest(async () => REAL_JSON);
  assert.equal(h2.rows.length, 8);
});

test("history key", () => {
  assert.deepEqual(noElHistoryKey({ contract: "fixed", taxes: "none" }), { area: "NO", item: "electricity/fixed/none", label: "Norway, fixed-price contracts, excluding taxes" });
  assert.equal(noElHistoryKey({ contract: "bogus" }), null);
});

test("routing: NO household electricity goes here, NO gas and business stay with Eurostat", () => {
  assert.equal(manifest.serves!({ country: "NO", energy: "electricity" }), true);
  assert.equal(manifest.serves!({ country: "NO", energy: "gas" }), false);
  assert.equal(manifest.serves!({ country: "NO", energy: "electricity", sector: "business" }), false);
  assert.equal(eu.serves!({ country: "NO", energy: "electricity" }), false);
  assert.equal(findSource("energy", "NO", { country: "NO", energy: "electricity" })?.info.id, "no-ssb-electricity");
  assert.equal(INFO.price_type, "official_statistic");
});
