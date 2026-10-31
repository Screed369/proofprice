import { test } from "node:test";
import assert from "node:assert/strict";
import { InputError } from "../../lib/http";
import { SOURCE_PLUGINS } from "../../lib/registry";
import { INFO, normaliseType, parseRows, resolveArea, zurichAnswer, zurichHomeSales } from "./source";
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
