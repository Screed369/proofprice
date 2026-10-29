// Fixtures are the real RVD files https://www.rvd.gov.hk/datagovhk/{2.1A,2.2A,3.1A,4.1A}(from_99).csv captured through the GitHub-hosted probe on 2026-10-29
// (4 486, 5 720, 1 675 and 1 507 bytes, years 1999-2025, Last-Modified 4 Jun 2026).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { INFO, hkCommercial, newestUsable, parseYearly, plan, resolveDistrict, URL_FACTORY, URL_OFFICE_PRICE, URL_OFFICE_RENT, URL_RETAIL } from "./source";

const f = (n: string) => readFileSync(new URL(`./fixtures/${n}.csv`, import.meta.url), "utf8");
const FILES: Record<string, string> = { [URL_OFFICE_RENT]: f("2.1A"), [URL_OFFICE_PRICE]: f("2.2A"), [URL_RETAIL]: f("3.1A"), [URL_FACTORY]: f("4.1A") };
const fetcher = async (u: string) => FILES[u];

test("real files parse: years 1999-2025, flags and n/a kept apart", () => {
  const o = parseYearly(f("2.1A"));
  assert.equal(o[0].year, 1999);
  assert.equal(o[o.length - 1].year, 2025);
  assert.equal(o[0].cells["Grade A Central"].value, 406);
  assert.equal(o[0].cells["Grade A Kowloon Bay / Kwun Tong"].value, null); // n/a in 1999
  assert.equal(Object.keys(o[0].cells).length, 21);
  assert.equal(o[o.length - 1].cells["Grade C Kowloon Bay / Kwun Tong"].remark, "X");
  const r = parseYearly(f("3.1A"));
  assert.equal(r[r.length - 1].cells["Prices (Hong Kong)"].value, 284214);
  assert.equal(Object.keys(r[0].cells).length, 6);
});

test("cells with a remark are skipped for the headline", () => {
  const p = parseYearly(f("2.2A"));
  // 2025 Grade A Sheung Wan is 193597 with no remark; Grade A Wan Chai in 2025 carries X, so 2024 or earlier is used or none
  const hit = newestUsable(p, "Grade A Wan Chai / Causeway Bay");
  assert.ok(hit === null || hit.cell.remark === "");
});

test("answer: Grade A offices in Central, price, is an official average with source and no range", async () => {
  const a = await hkCommercial({ town: "Central", premises: "office", grade: "A" }, fetcher);
  assert.equal(a.status, "ok");
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.price!.currency, "HKD");
  assert.equal(a.price!.typical_low, null);
  assert.equal(a.sample_size, null);
  assert.equal(a.period.from!.slice(5), "01-01");
  assert.ok(a.source.attribution.includes("Rating and Valuation Department"));
  assert.equal((a.extra as any).grades.length, 3);
  assert.ok(a.price!.value > 100000 && a.price!.value < 1000000);
});

test("rent basis uses the rent file and a per-month unit", async () => {
  const seen: string[] = [];
  const a = await hkCommercial({ town: "Tsim Sha Tsui", basis: "rent" }, async (u) => { seen.push(u); return FILES[u]; });
  assert.deepEqual(seen, [URL_OFFICE_RENT]);
  assert.equal(a.price!.unit, "per m² per month");
  assert.ok(a.price!.value > 200 && a.price!.value < 2000);
});

test("retail in Kowloon: the 2025 figure with the change on 2024", async () => {
  const a = await hkCommercial({ town: "Kowloon", premises: "retail" }, fetcher);
  assert.equal(a.price!.value, 270029);
  assert.equal((a.extra as any).reference_year, 2025);
  assert.equal((a.extra as any).change_on_year_earlier.year, 2024);
  assert.match(a.summary, /270,029|270029/);
});

test("flatted factories by region; a district name in a region question gives its region with a note", async () => {
  const a = await hkCommercial({ town: "Sha Tin", premises: "factory", basis: "rent" }, fetcher);
  assert.equal(a.status, "ok");
  assert.match(a.statistic!.note!, /region only/);
  assert.equal((a.query as any).premises, "factory");
});

test("defaults: an office district means offices, a region means retail", () => {
  assert.equal(plan({ town: "Central" }).premises, "office");
  assert.equal(plan({ town: "Central" }).grade, "A");
  assert.equal(plan({ town: "Kowloon" }).premises, "retail");
  assert.equal(resolveDistrict("Mong Kok"), "Yau Ma Tei / Mong Kok");
});

test("bad input is refused before any download", async () => {
  const never = async () => { throw new Error("should not fetch"); };
  await assert.rejects(hkCommercial({}, never), /town is required/);
  await assert.rejects(hkCommercial({ town: "Kowloon", premises: "office" }, never), /by district only/);
  await assert.rejects(hkCommercial({ town: "Central", grade: "D" }, never), /grade must be/);
  await assert.rejects(hkCommercial({ town: "Central", basis: "x" }, never), /basis must be/);
  await assert.rejects(hkCommercial({ town: "Central", property_type: "land" }, never), /land prices are not available/);
  await assert.rejects(hkCommercial({ town: "Paris", premises: "retail" }, never), /not a Hong Kong region/);
});

test("a changed file layout is reported, not guessed", () => {
  assert.throws(() => parseYearly("a,b\n1,2\n"), /changed layout/);
});

test("licence and honesty fields", () => {
  assert.equal(INFO.price_type, "official_statistic");
  assert.match(INFO.licence, /DATA\.GOV\.HK/);
  assert.match(INFO.limits, /Not asking prices/);
});
