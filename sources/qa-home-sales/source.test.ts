// Tests for Qatar home sales (Weekly Real Estates Sales Bulletin, data.gov.qa).
// Fixture: fixture.json holds the 8 newest rows of the real dataset, fields trimmed to those we read (probe qasales1, 2026-10-24).
// The aggregate rows used for counting are copies of those real rows with varied prices (illustrative, same layout).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildWhere, clampMonths, INFO, municipalityOf, monthsBack, norm, parseSales, qaHomeSales } from "./source";
import manifest from "./index";

const real = JSON.parse(readFileSync(new URL("./fixture.json", import.meta.url), "utf8"));

function fakeFetcher(rows: any[]) {
  const urls: string[] = [];
  const f = async (url: string) => {
    urls.push(url);
    if (url.includes("/records?")) return { total_count: rows.length, results: rows.slice(0, 1).map((r) => ({ registration_date: r.registration_date })) };
    return rows;
  };
  return { f, urls };
}

test("the real rows parse: date, place, value, price per square metre", () => {
  const s = parseSales(real.results);
  assert.equal(s.length, 8);
  assert.deepEqual(s[0], { date: "2025-12-31", municipality: "Umm Slal Municipality", district: "Al Kharaitiyat", type: "Residential Building", value: 3200000, perSqm: 6667 });
});

test("rows with no real price are dropped", () => {
  assert.equal(parseSales([{ registration_date: "2025-12-31", property_value: 0 }, { registration_date: "x", property_value: 500000 }]).length, 0);
});

test("municipality names and the where clause", () => {
  assert.equal(municipalityOf("Doha"), "Doha Municipality");
  assert.equal(municipalityOf("Al Khor"), "Al Khor and Al Thakhira Municipality");
  assert.equal(municipalityOf("Luaib"), null);
  assert.equal(norm("Al-Rayyan Municipality"), "al rayyan");
  const w = buildWhere({ from: "2024-12-31", municipality: "Doha Municipality", type: "building" });
  assert.match(w, /usage='villas or residential houses'/);
  assert.match(w, /registration_date>date'2024-12-31'/);
  assert.match(w, /municipality_name='Doha Municipality'/);
  assert.match(w, /property_type='Residential Building'/);
  assert.equal(monthsBack("2025-12-31", 12), "2024-12-31");
  assert.equal(clampMonths(99), 36);
  assert.equal(clampMonths(undefined), 12);
});

test("a municipality answer: median over the window, dated from the newest sale", async () => {
  const base = real.results[1];
  const rows = [3, 4, 5, 6, 7, 8].map((m) => ({ ...base, municipality_name: "Doha Municipality", property_value: m * 1_000_000, price_per_square_meter: m * 1000 }));
  const { f, urls } = fakeFetcher(rows);
  const a = await qaHomeSales({ town: "Doha" }, { fetcher: f });
  assert.equal(a.status, "ok");
  assert.equal(a.price?.currency, "QAR");
  assert.equal(a.price?.median, 5_500_000);
  assert.equal(a.sample_size, 6);
  assert.equal(a.period.to, "2025-12-31");
  assert.equal((a.extra as any).dataset_latest_sale, "2025-12-31");
  assert.match(a.summary, /2025-12-31/);
  assert.ok(urls.some((u) => u.includes("/exports/json") && u.includes("Doha%20Municipality")));
  assert.equal(a.source.licence.includes("CC BY 4.0"), true);
});

test("a district name filters the rows on the district", async () => {
  const base = real.results[3];
  const rows = [...Array(6)].map((_, i) => ({ ...base, district_name: "Luaib", property_value: 2_000_000 + i * 100_000 })).concat([{ ...base, district_name: "Other", property_value: 9_000_000 }]);
  const { f } = fakeFetcher(rows);
  const a = await qaHomeSales({ town: "Luaib" }, { fetcher: f });
  assert.equal(a.sample_size, 6);
  assert.equal(a.price?.median, 2_250_000);
});

test("fewer than 5 sales: no figure", async () => {
  const { f } = fakeFetcher(real.results.slice(0, 3));
  const a = await qaHomeSales({ town: "Doha" }, { fetcher: f });
  assert.equal(a.status, "insufficient_data");
  assert.equal(a.price, null);
});

test("bad input is a clear error", async () => {
  await assert.rejects(qaHomeSales({ property_type: "castle" }), /property_type must be one of/);
  await assert.rejects(qaHomeSales({ postcode: "1234" }), /no postcode/);
});

test("manifest: Qatar, home-sales, licensed CC BY", () => {
  assert.deepEqual(manifest.countries, ["QA"]);
  assert.equal(manifest.category, "home-sales");
  assert.match(INFO.licence, /CC BY 4.0/);
});
