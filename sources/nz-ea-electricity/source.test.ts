// Tests for the NZ Electricity Authority source. fixtures/sample.csv: the first four rows are REAL (copied 2026-10-20 from the
// probe of 20260531_AveragePowerUseAndCosts.csv); the 2026 rows are SYNTHETIC rows in the same layout to exercise the logic.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { InputError, SourceError } from "../../lib/http";
import { SOURCE_PLUGINS } from "../../lib/registry";
import { INFO, answerFromRows, candidateStamps, fileUrl, matchRegion, nzElectricity, parseFileLinks, parsePowerCsv, regionsIn } from "./source";

const f = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8");
const CSV = f("sample.csv");
const PAGE = f("page.html");
const ROWS = parsePowerCsv(CSV);

test("licence and type", () => {
  assert.match(INFO.licence, /CC BY 4\.0/);
  assert.equal(INFO.price_type, "official_statistic");
});

test("parses the BOM csv and the real rows", () => {
  const r = ROWS.find((x) => x.code === "3" && x.month === "2025-01-31")!;
  assert.deepEqual([r.region, r.load, r.fixedPerDay, r.variablePerKwh, r.kwh, r.bill], ["Waitemata (Vector)", "Standard user", 2.5734, 0.2266, 692, 236.69]);
  assert.throws(() => parsePowerCsv("<html>moved</html>"), SourceError);
});

test("finds the newest file on the dataset page, falls back to month ends", () => {
  assert.deepEqual(parseFileLinks(PAGE), ["20260531", "20260430"]);
  assert.equal(fileUrl("20260531"), "https://www.emi.ea.govt.nz/Retail/Datasets/RegionalPowerPrices/20260531_AveragePowerUseAndCosts.csv");
  assert.equal(candidateStamps(new Date("2026-10-20T00:00:00Z"))[0], "20260930");
  assert.equal(candidateStamps(new Date("2026-03-05T00:00:00Z"))[0], "20260228");
});

test("region matching", () => {
  const names = regionsIn(ROWS);
  assert.equal(matchRegion("Auckland", names), "Auckland (Vector)");
  assert.equal(matchRegion("hawkes bay", names), "Hawke's Bay (Unison Networks)");
  assert.throws(() => matchRegion("Northland", names), InputError); // two synthetic Northland regions
  assert.throws(() => matchRegion("Atlantis", names), InputError);
});

test("one region, newest month, price per kWh", () => {
  const a = answerFromRows(ROWS, { region: "Auckland" });
  assert.equal(a.status, "ok");
  assert.equal(a.price!.value, 0.4286); // 300 / 700
  assert.equal(a.sample_size, null);
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.statistic!.reference_period, "2026-05");
  assert.equal((a.extra as any).monthly_bill_nzd, 300);
  const low = answerFromRows(ROWS, { region: "Auckland", consumption_band: "low" });
  assert.equal(low.price!.value, 0.4444); // 160 / 360
});

test("without a region: unweighted median of regions; fewer than 5 gives no_matches", () => {
  const a = answerFromRows(ROWS, {});
  assert.equal(a.status, "ok");
  assert.equal((a.extra as any).regions_counted, 6);
  assert.ok(a.price!.typical_low! <= a.price!.value && a.price!.value <= a.price!.typical_high!);
  assert.equal(answerFromRows(ROWS, { consumption_band: "low" }).status, "no_matches");
});

test("bad input is an InputError", () => {
  assert.throws(() => answerFromRows(ROWS, { taxes: "none" }), InputError);
  assert.throws(() => answerFromRows(ROWS, { consumption_band: "huge" }), InputError);
});

test("end to end with a fake fetcher; gas is refused", async () => {
  const fetcher = async (u: string) => (u.endsWith("RegionalPowerPrices") ? PAGE : u.includes("20260531_") ? CSV : Promise.reject(new SourceError("x")));
  const a = await nzElectricity({ energy: "electricity", region: "Auckland" }, fetcher);
  assert.equal(a.price!.currency, "NZD");
  await assert.rejects(nzElectricity({ energy: "gas" }, fetcher), InputError);
  const broken = async (u: string) => (u.endsWith("RegionalPowerPrices") ? "<html/>" : u.includes("20260930_") ? CSV : Promise.reject(new SourceError("404")));
  assert.equal((await nzElectricity({ energy: "electricity", region: "Auckland" }, broken, new Date("2026-10-20T00:00:00Z"))).status, "ok");
});

test("registered", () => {
  assert.ok(SOURCE_PLUGINS.some((s) => s.info.id === "nz-ea-electricity" && s.countries.includes("NZ")));
});
