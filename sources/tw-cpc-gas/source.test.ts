// Tests for the Taiwan CPC gas source. fixtures/*.json are REAL copies of
// https://vipmbr.cpc.com.tw/opendata/naturalgaslistprice and .../lpglistprice checked on 2026-11-09.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { InputError, SourceError } from "../../lib/http";
import { SOURCE_PLUGINS, findSource } from "../../lib/registry";
import { INFO, LPG_URL, NATURAL_GAS_URL, normaliseBand, normaliseFuel, parseRows, rocToIso, twGas } from "./source";

const read = (f: string) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8"));
const NG = read("naturalgas.json");
const LPG = read("lpg.json");
const fake = async (url: string) => (url === NATURAL_GAS_URL ? NG : url === LPG_URL ? LPG : Promise.reject(new Error(url)));

test("licence and type", () => {
  assert.match(INFO.licence, /Open Government Data License/);
  assert.equal(INFO.price_type, "posted_price");
});

test("ROC dates", () => {
  assert.equal(rocToIso("1151101"), "2026-11-01");
  assert.equal(rocToIso("1150402"), "2026-04-02");
  assert.equal(rocToIso("x"), null);
});

test("parses the real lists", () => {
  assert.equal(parseRows(NG).length, 10);
  assert.equal(parseRows(LPG).length, 19);
  assert.throws(() => parseRows({}), SourceError);
  assert.throws(() => parseRows([{ foo: 1 }]), SourceError);
});

test("natural gas household answer: 16.32 TWD per m3 from 2026-11-01", async () => {
  const a = await twGas({ energy: "gas" }, fake);
  assert.equal(a.status, "ok");
  assert.equal(a.price!.currency, "TWD");
  assert.equal(a.price!.value, 16.32);
  assert.equal(a.sample_size, null);
  assert.equal(a.price_type, "posted_price");
  assert.equal(a.period!.from, "2026-11-01");
  assert.match(a.summary, /per cubic metre/);
});

test("natural gas customer types", async () => {
  assert.equal((await twGas({ energy: "gas", consumption_band: "industrial" }, fake)).price!.value, 15.1622);
  assert.equal((await twGas({ energy: "natural gas", consumption_band: "power" }, fake)).price!.value, 25.9059);
  assert.throws(() => normaliseBand("huge"), InputError);
});

test("LPG: median of household-use dealer list prices", async () => {
  const a = await twGas({ energy: "gas", consumption_band: "lpg" }, fake);
  assert.equal((await twGas({ energy: "lpg" }, fake)).price!.value, 20.01);
  assert.equal(a.price!.value, 20.01);
  assert.equal(a.period!.from, "2026-04-02");
  assert.match(a.summary, /per kg/);
});

test("input handling", async () => {
  assert.equal(normaliseFuel("Gas"), "natural_gas");
  assert.equal(normaliseFuel("LPG"), "lpg");
  await assert.rejects(() => twGas({ energy: "electricity" }, fake), InputError);
});

test("registered for TW energy and routed by energy", () => {
  const p = SOURCE_PLUGINS.find((x) => x.info.id === "tw-cpc-gas");
  assert.ok(p);
  assert.deepEqual(p!.countries, ["TW"]);
  assert.equal(findSource("energy", "TW", { country: "TW", energy: "gas" })?.info.id, "tw-cpc-gas");
  assert.equal(findSource("energy", "TW", { country: "TW", energy: "lpg" })?.info.id, "tw-cpc-gas");
  assert.equal(findSource("energy", "TW", { country: "TW", energy: "electricity" })?.info.id, "tw-taipower-tariffs");
});
