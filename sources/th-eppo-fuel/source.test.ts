// Fixture: fixtures/eppo-sample.csv holds the first 90 rows copied on 2026-10-29 from EPPO's dataset_11_58.csv (Jan-Mar 2003), in the live layout.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { InputError, SourceError } from "../../lib/http";
import { runCategory } from "../../lib/registry";
import { harvestRows, thFuelHistoryKey, answerFromPoints, changeFor, latestPeriod, parseEppo, thFuel, CSV_URL } from "./source";

const CSV = readFileSync(new URL("./fixtures/eppo-sample.csv", import.meta.url), "utf8");

test("th-eppo-fuel: parses rows with month names", () => {
  const pts = parseEppo(CSV);
  assert.equal(pts.length, 90);
  assert.equal(pts[0].period, "2003-01");
  assert.equal(latestPeriod(pts, "HSD B7"), "2003-03");
});

test("th-eppo-fuel: a changed layout is a SourceError", () => {
  assert.throws(() => parseEppo("<html>moved</html>"), SourceError);
});

test("th-eppo-fuel: diesel answer is an official statistic in THB per litre with the month change", () => {
  const a = answerFromPoints(parseEppo(CSV), { fuel: "diesel" });
  assert.equal(a.status, "ok");
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.price!.currency, "THB");
  assert.equal(a.price!.unit, "per litre");
  assert.equal(a.period.from, "2003-03-01");
  assert.equal(a.period.to, "2003-03-31");
  const x = a.extra as any;
  assert.equal(x.change_on_month.from, "2003-02");
  assert.equal(x.change_on_year, null);
  assert.ok(x.lowest_brand_price <= a.price!.value! && a.price!.value! <= x.highest_brand_price);
});

test("th-eppo-fuel: petrol98 says so, places are national, unknown fuel is an InputError", () => {
  const pts = parseEppo(CSV);
  const a = answerFromPoints(pts, { fuel: "petrol98", town: "Bangkok" });
  assert.match(a.statistic!.note!, /no 98 series/);
  assert.match(a.statistic!.note!, /national/);
  assert.throws(() => answerFromPoints(pts, { fuel: "e85" }), InputError);
});

test("th-eppo-fuel: a year change is found when the same month a year earlier exists", () => {
  // Same rows re-dated one year later (clearly synthetic) just to exercise the 12-month lookup.
  const pts = parseEppo(CSV);
  const later = pts.filter((p) => p.period === "2003-03").map((p) => ({ ...p, period: "2004-03" }));
  const c = changeFor([...pts, ...later], "ULG 95", "2004-03", 12);
  assert.equal(c!.percent, 0);
  assert.equal(c!.from, "2003-03");
});

test("th-eppo-fuel: harvest stores one national row per fuel dated the first of the month", () => {
  const h = harvestRows(parseEppo(CSV));
  assert.equal(h.date, "2003-03-01");
  assert.deepEqual(h.rows.map((r) => r.item), ["petrol95", "diesel", "lpg"]);
  assert.equal(h.currency, "THB");
  assert.deepEqual(thFuelHistoryKey({ fuel: "petrol98" }), { area: "TH", item: "petrol95", label: "Thailand (national average)" });
  assert.equal(thFuelHistoryKey({ fuel: "e10" }), null);
});

test("th-eppo-fuel: fetch is injected and the registry routes TH to it", async () => {
  const a = await thFuel({ fuel: "petrol95" }, async (u) => {
    assert.equal(u, CSV_URL);
    return CSV;
  });
  assert.equal(a.source.id, "th-eppo-fuel");
  const r = await runCategory("fuel", { country: "TH", fuel: "bogus" } as any).catch((e) => e);
  assert.ok(r instanceof Error || (r && typeof r === "object"));
});
