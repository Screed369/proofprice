// Tests for Spain high-speed rail fares. fixtures/precio-medio-mensual.json is the REAL answer of
// https://catalogodatos.cnmc.es/api/3/action/datastore_search?resource_id=69671e28-b299-4e45-8cf9-24d04f7e5117&limit=32000 read on 2026-10-31 (1001 records, Nov 2022 to Jun 2026).
// fixtures/precio-medio-trimestral.json is CNMC's quarterly twin (resource 5e1057b2-a760-4423-bff4-2ded88a25030, 344 records) read the same day: the outside check.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { InputError, SourceError } from "../../lib/http";
import { parseDatastoreSearch } from "../../lib/adapters";
import {
  INFO, answerFromObservations, esRailFares, esRailHistoryKey, harvestRows, newestMonth, parseObservations, resolveOperator, resolveRoute,
} from "./source";

const load = (f: string) => parseDatastoreSearch(JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8")));
const MONTHLY = load("precio-medio-mensual.json").records;
const QUARTERLY = load("precio-medio-trimestral.json").records;
const OBS = parseObservations(MONTHLY);

test("licence and type", () => {
  assert.match(INFO.licence, /CC BY-SA 4\.0/);
  assert.equal(INFO.price_type, "posted_price");
});

test("parses the real table", () => {
  assert.equal(OBS.length, 1001);
  assert.equal(newestMonth(OBS), "2026-06");
  assert.throws(() => parseObservations(MONTHLY.slice(0, 10)), SourceError);
});

test("route and operator names", () => {
  assert.equal(resolveRoute(undefined), "barcelona");
  assert.equal(resolveRoute("Madrid-Málaga"), "malaga");
  assert.equal(resolveRoute("Madrid to Seville"), "sevilla");
  assert.equal(resolveRoute("alicante"), "alicante");
  assert.throws(() => resolveRoute("Madrid-Bilbao"), InputError);
  assert.throws(() => resolveRoute("Madrid-Barcelona-Valencia"), InputError);
  assert.equal(resolveOperator(undefined), "total");
  assert.equal(resolveOperator("AVLO"), "renfe-avlo");
  assert.equal(resolveOperator("Renfe-AVE"), "renfe-ave");
  assert.equal(resolveOperator("renfe_ave"), "renfe-ave");
  assert.throws(() => resolveOperator("alsa"), InputError);
});

test("default: Madrid-Barcelona, all operators, June 2026 = 69.38 EUR (real table)", () => {
  const a = answerFromObservations(OBS, {});
  assert.equal(a.status, "ok");
  assert.equal(a.price?.value, 69.38);
  assert.equal(a.price?.currency, "EUR");
  assert.equal(a.price?.measure, "average");
  assert.equal(a.sample_size, null);
  assert.equal(a.price_type, "posted_price");
  assert.equal(a.statistic?.reference_period, "2026-06");
  assert.deepEqual(a.period, { from: "2026-06-01", to: "2026-06-30" });
  assert.equal(a.price?.min, 55.47); // OUIGO
  assert.equal(a.price?.max, 74.22); // Renfe-AVE
  const x = a.extra as any;
  assert.equal(x.previous_month_eur, 62.65);
  assert.equal(x.last_12_months.length, 12);
  assert.equal(x.same_month_last_year_eur, OBS.find((o) => o.month === "2025-06" && o.route === "Madrid-Barcelona" && o.operator === "Total")!.price);
  assert.match(a.summary, /69\.38/);
  assert.match(String(a.extra?.operators_in_month ? a.summary : ""), /posted web fare/);
});

test("an operator and route: OUIGO Madrid-Valencia", () => {
  const a = answerFromObservations(OBS, { route: "Valencia", operator: "ouigo" });
  assert.equal(a.query.route, "Madrid-Valencia");
  assert.equal(a.price?.value, OBS.find((o) => o.month === "2026-06" && o.route === "Madrid-Valencia" && o.operator === "OUIGO")!.price);
  assert.equal(a.price?.min, null);
});

test("an operator not seen in the newest month is a clear error, not a stale figure", () => {
  const gone = OBS.filter((o) => o.operator === "Renfe-AVLO" && o.route === "Madrid-Barcelona").every((o) => o.month !== "2026-06");
  assert.ok(gone, "fixture: AVLO has no Madrid-Barcelona fare in 2026-06");
  assert.throws(() => answerFromObservations(OBS, { operator: "avlo" }), (e: any) => e instanceof InputError && /Renfe-AVE/.test(e.message));
});

test("fare groups and times are refused, not ignored", () => {
  assert.throws(() => answerFromObservations(OBS, { fare_type: "student" }), InputError);
  assert.throws(() => answerFromObservations(OBS, { travel_time: "early" }), InputError);
  assert.doesNotThrow(() => answerFromObservations(OBS, { fare_type: "adult", distance_km: 300 }));
});

// OUTSIDE CHECK: CNMC publishes its own quarterly average next to the monthly one. The mean of our three monthly figures must agree with
// CNMC's quarterly "Total" within 1% for every route and every quarter in the table. Read 2026-10-31: e.g. Madrid-Barcelona 2026T2 66.06 vs mean(66.25, 62.65, 69.38) = 66.09.
test("outside check: monthly figures agree with CNMC's own quarterly average", () => {
  let checked = 0;
  for (const q of QUARTERLY) {
    if (q.empresa !== "Total") continue;
    const [y, t] = String(q.trimestre).split("T").map(Number);
    const months = [0, 1, 2].map((i) => `${y}-${String((t - 1) * 3 + 1 + i).padStart(2, "0")}`);
    const vals = months.map((m) => OBS.find((o) => o.month === m && o.operator === "Total" && o.route === q.trayecto)?.price);
    if (vals.some((v) => v === undefined)) continue; // quarter not fully covered by the monthly table
    const mean = (vals as number[]).reduce((a, b) => a + b, 0) / 3;
    assert.ok(Math.abs(mean - q.precio) / q.precio < 0.01, `${q.trayecto} ${q.trimestre}: monthly mean ${mean.toFixed(2)} vs quarterly ${q.precio}`);
    checked++;
  }
  assert.ok(checked >= 40, `checked ${checked} route-quarters`);
});

test("harvest: newest month, every route, a total for each, no record count", () => {
  const h = harvestRows(OBS);
  assert.equal(h.date, "2026-06-30");
  assert.equal(h.currency, "EUR");
  for (const area of ["barcelona", "valencia", "alicante", "malaga", "sevilla"]) assert.ok(h.rows.some((r) => r.area === area && r.item === "total"), area);
  const r = h.rows.find((x) => x.area === "barcelona" && x.item === "total")!;
  assert.equal(r.median, 69.38);
  assert.ok(Number.isNaN(r.n));
  assert.throws(() => harvestRows(OBS.filter((o) => o.operator !== "Total")), SourceError);
});

test("history key", () => {
  assert.deepEqual(esRailHistoryKey({}), { area: "barcelona", item: "total", label: "Madrid-Barcelona (Total)" });
  assert.equal(esRailHistoryKey({ route: "Madrid-Málaga", operator: "iryo" })?.area, "malaga");
  assert.equal(esRailHistoryKey({ route: "Bilbao" }), null);
});

test("live reader with an injected fetcher", async () => {
  const a = await esRailFares({}, { fetcher: async () => JSON.parse(readFileSync(new URL("./fixtures/precio-medio-mensual.json", import.meta.url), "utf8")) });
  assert.equal(a.price?.value, 69.38);
  const incomplete = JSON.parse(readFileSync(new URL("./fixtures/precio-medio-mensual.json", import.meta.url), "utf8"));
  incomplete.result.records = incomplete.result.records.slice(0, 500);
  await assert.rejects(esRailFares({}, { fetcher: async () => incomplete }), SourceError);
});
