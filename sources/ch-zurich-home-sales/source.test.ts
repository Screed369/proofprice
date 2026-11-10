import { test } from "node:test";
import assert from "node:assert/strict";
import { InputError } from "../../lib/http";
import { SOURCE_PLUGINS } from "../../lib/registry";
import { INFO, normaliseType, parseRows, resolveArea, zurichAnswer, zurichHarvest, zurichHarvestRows, zurichHistoryKey, zurichHomeSales } from "./source";
import { SAMPLE } from "./fixtures";

// Fixture: real rows fetched from data.stadt-zuerich.ch on 2026-10-31.
const recs = SAMPLE.result.records as unknown as Array<Record<string, any>>;

test("ch-zurich-home-sales: registered on home-sales for CH with the CC0 licence", () => {
  const p = SOURCE_PLUGINS.find((s) => s.info.id === "ch-zurich-home-sales")!;
  assert.equal(p.category, "home-sales");
  assert.deepEqual(p.countries, ["CH"]);
  assert.match(INFO.licence, /CC0/);
  assert.deepEqual(p.examples[0].params, { country: "CH", town: "Zürich" });
});

test("parseRows drops ranges, K and counts under 5", () => {
  const { rows } = parseRows(recs);
  assert.ok(rows.length > 0);
  assert.ok(rows.every((r) => r.sales >= 5 && r.medianFlat > 0));
  assert.ok(!rows.some((r) => r.name === "Hirzenbach" && r.year === 2025)); // "2-6"
  assert.ok(!rows.some((r) => r.name === "Rathaus" && r.year === 2025)); // "1–3" and median K
  assert.ok(!rows.some((r) => r.name === "Werd" && r.year === 2025)); // 0 sales
  assert.ok(rows.some((r) => r.code === "0" && r.year === 2025 && r.sales === 720 && r.medianFlat === 1681598 && r.perM2 === 17646));
});

test("whole city answer", () => {
  const a = zurichAnswer(recs, { town: "Zürich" });
  assert.equal(a.status, "ok");
  assert.equal(a.price!.value, 1681598);
  assert.equal(a.price!.median, 1681598);
  assert.equal(a.price!.currency, "CHF");
  assert.equal(a.price!.typical_low, null);
  assert.equal(a.sample_size, 720);
  assert.deepEqual(a.period, { from: "2025-01-01", to: "2025-12-31" });
  assert.equal((a.extra as any).median_price_per_m2_living_area_chf, 17646);
  assert.equal((a.extra as any).previous_year.year, 2024);
  assert.match(a.summary, /1[,.]?681[,.]?598/);
});

test("district and quarter names resolve; Kreis 7 and Seebach work", () => {
  const { areas } = parseRows(recs);
  assert.equal(resolveArea("Kreis 7", areas).code, "7");
  assert.equal(resolveArea("7", areas).code, "7");
  assert.equal(resolveArea("seebach", areas).code, "119");
  assert.equal(resolveArea(undefined, areas).code, "0");
  const a = zurichAnswer(recs, { town: "Kreis 7" });
  assert.equal(a.price!.value, 2370000);
  assert.equal(a.sample_size, 142);
  assert.ok((a.extra as any).whole_city);
});

test("a suppressed area falls back to nothing when no year in five has a figure; unknown place is an input error", () => {
  const a = zurichAnswer(recs, { town: "Rathaus" });
  assert.equal(a.status, "no_matches");
  assert.throws(() => zurichAnswer(recs, { town: "Bern" }), InputError);
});

test("property type: only flats", () => {
  assert.equal(normaliseType("apartment"), "flat");
  assert.throws(() => normaliseType("house"), InputError);
});

test("fetch wrapper asks the CKAN datastore and answers", async () => {
  const urls: string[] = [];
  const a = await zurichHomeSales({ town: "Zürich", fetcher: async (u: string) => { urls.push(u); return SAMPLE; } } as any);
  assert.equal(a.status, "ok");
  assert.match(urls[0], /data\.stadt-zuerich\.ch\/api\/3\/action\/datastore_search\?/);
  assert.match(urls[0], /d9d471e9-11fc-4cca-8242-bc63e8d6ac92/);
});

test("harvest: one row per publishable area for the newest year, published medians without a count", () => {
  const h = zurichHarvestRows(recs);
  assert.equal(h.date, "2025-12-31");
  assert.equal(h.currency, "CHF");
  const city = h.rows.find((r) => r.area === "0")!;
  assert.equal(city.median, 1681598);
  assert.ok(Number.isNaN(city.n));
  assert.equal(h.rows.find((r) => r.area === "7")!.median, 2370000);
  assert.ok(!h.rows.some((r) => r.area === "119" && false));
  assert.equal(new Set(h.rows.map((r) => r.area)).size, h.rows.length);
  assert.throws(() => zurichHarvestRows([]), /no publishable/);
  const suppressed = parseRows(recs).areas; // Rathaus has no publishable 2025 row, so no library row either
  const rathaus = [...suppressed].find(([, n]) => n === "Rathaus")![0];
  assert.ok(!h.rows.some((r) => r.area === rathaus));
});

test("harvest fetch wrapper uses the same CKAN request", async () => {
  const h = await zurichHarvest({ fetcher: async () => SAMPLE } as any);
  assert.ok(h.rows.length > 1);
});

test("historyKey: city and districts only; houses and quarters have no copy", () => {
  assert.deepEqual(zurichHistoryKey({ town: "Zürich" }), { area: "0", item: "flat", label: "Zürich" });
  assert.deepEqual(zurichHistoryKey({}), { area: "0", item: "flat", label: "Zürich" });
  assert.equal(zurichHistoryKey({ town: "Kreis 7" })!.area, "7");
  assert.equal(zurichHistoryKey({ town: "11" })!.area, "11");
  assert.equal(zurichHistoryKey({ town: "Altstetten" }), null);
  assert.equal(zurichHistoryKey({ town: "Kreis 13" }), null);
  assert.equal(zurichHistoryKey({ town: "Zürich", property_type: "house" }), null);
});

import { servesBl as __servesBl } from "../ch-zz-bl-home-sales/source";
import zurichManifest from "./index";
import blManifest from "../ch-zz-bl-home-sales/index";
test("CH routing: Zürich keeps country-only and Zürich asks, Basel-Landschaft places go to the BL source", () => {
  const ask = (town?: string) => ({ country: "CH", ...(town ? { town } : {}) });
  for (const t of [undefined, "Zürich", "Kreis 7", "Altstetten"]) {
    assert.equal(zurichManifest.serves!(ask(t)), true, `Zürich serves ${t}`);
    assert.equal(blManifest.serves!(ask(t)), false, `BL does not serve ${t}`);
  }
  for (const t of ["Liestal", "Arlesheim", "Muttenz"]) {
    assert.equal(zurichManifest.serves!(ask(t)), false, `Zürich does not serve ${t}`);
    assert.equal(blManifest.serves!(ask(t)), true, `BL serves ${t}`);
  }
  assert.equal(__servesBl({ country: "CH", town: "Liestal" }), true);
});
