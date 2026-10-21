// Tests for Canada farm-gate prices (Statistics Canada table 32-10-0077-01). Fixtures are real WDS replies captured on 2026-10-18.
import { test } from "node:test";
import assert from "node:assert/strict";
import { FARM_CODE_SETS, FARM_DATA, FARM_META, FARM_SERIES_INFO } from "./fixtures";
import {
  INFO, PRODUCTS, caFarmHarvest, caFarmMethod, caFarmPrices, exampleProducts, farmHarvestRows, farmHistoryKey, matchProduct, parseSeriesUoms, parseUomNames, perSmallUnit, readFarm, unitFrom,
} from "./source";
import type { Poster } from "../_ca-statcan/wds";
import type { DataSeries } from "../_ca-statcan/wds";
import manifest from "./index";
import { categoryById, countriesFor } from "../../lib/registry";

const TODAY = new Date("2026-10-18T12:00:00Z");
const calls: { path: string; body: unknown }[] = [];

const post: Poster = async (path, body) => {
  calls.push({ path, body });
  if (path === "getCubeMetadata") return FARM_META;
  if (path === "getDataFromCubePidCoordAndLatestNPeriods") {
    return (body as { productId: number; coordinate: string }[]).map(
      (r) =>
        (FARM_DATA as any[]).find((s) => s.object.coordinate === r.coordinate) ?? {
          status: "FAILED",
          object: { responseStatusCode: 2, productId: r.productId, coordinate: r.coordinate, vectorId: 0, vectorDataPoint: [] },
        },
    );
  }
  if (path === "getSeriesInfoFromVector") {
    const want = new Set((body as { vectorId: number }[]).map((v) => v.vectorId));
    return (FARM_SERIES_INFO as any[]).filter((s) => want.has(s.object.vectorId));
  }
  throw new Error(`unexpected WDS method ${path}`);
};
const get = async (path: string) => {
  if (path === "getCodeSets") return FARM_CODE_SETS;
  throw new Error(`unexpected WDS GET ${path}`);
};
const ask = (o: { product: string; region?: string }, today = TODAY) => caFarmPrices({ ...o, today }, post, get);

test("wheat in Saskatchewan: August 2026, per metric tonne, with the kilogram price and the change on the previous month", async () => {
  calls.length = 0;
  const a = await ask({ product: "wheat", region: "Saskatchewan" });
  assert.equal(a.status, "ok");
  assert.equal(a.price?.value, 302.26);
  assert.equal(a.price?.currency, "CAD");
  assert.equal(a.price?.unit, "per metric tonne");
  assert.equal(a.price?.measure, "average");
  assert.equal(a.price?.median, null);
  assert.equal(a.price?.typical_low, null);
  assert.equal(a.sample_size, null);
  assert.equal(a.price_type, "official_statistic");
  assert.deepEqual(a.period, { from: "2026-08-01", to: "2026-08-31" });
  assert.equal(a.statistic?.reference_period, "2026-08");
  const x = a.extra as any;
  assert.equal(x.change_on_previous_month.reference_month, "2026-07");
  assert.equal(x.change_on_previous_month.value, 298);
  assert.equal(x.change_on_year_earlier, null);
  assert.match(x.change_on_year_earlier_unavailable, /same month a year earlier/);
  assert.deepEqual(x.unit.converted, { unit: "per kilogram", value: 0.302 });
  assert.match(a.summary, /In Saskatchewan farmers received on average .*302\.26.* per metric tonne for wheat \(except durum wheat\) in August 2026/);
  assert.match(x.attribution_notice, /^Source: Statistics Canada, .*, August 2026\. Reproduced and distributed on an "as is" basis with the permission of Statistics Canada\./);
  const dataCall = calls.find((c) => c.path === "getDataFromCubePidCoordAndLatestNPeriods")!;
  assert.equal((dataCall.body as any[]).length, 10);
  assert.ok((dataCall.body as any[]).every((b) => b.latestN === 14 && b.productId === 32100077));
});

test("units come from Statistics Canada per series: hogs per hundredweight (not converted), milk per kilolitre (also per litre), eggs per dozen", async () => {
  const hogs = await ask({ product: "hogs", region: "Ontario" });
  assert.equal(hogs.price?.value, 119.98);
  assert.equal(hogs.price?.unit, "per hundredweight");
  assert.equal((hogs.extra as any).unit.converted, undefined);
  assert.match(hogs.statistic?.note ?? "", /not converted here because the table does not define its weight/);
  const milk = await ask({ product: "milk", region: "Ontario" });
  assert.equal(milk.price?.value, 918.2);
  assert.equal(milk.price?.unit, "per kilolitre");
  assert.deepEqual((milk.extra as any).unit.converted, { unit: "per litre", value: 0.918 });
  const eggs = await ask({ product: "eggs", region: "Ontario" });
  assert.equal(eggs.price?.value, 2.19);
  assert.equal(eggs.price?.unit, "per dozen");
});

test("the newest month with a figure is used, and other provinces with the same unit and month are listed", async () => {
  const soy = await ask({ product: "soybeans", region: "Saskatchewan" });
  assert.equal(soy.price?.value, 497.77);
  assert.equal(soy.statistic?.reference_period, "2026-06");
  assert.match(soy.statistic?.note ?? "", /newest month is August 2026/);
  const ont = await ask({ product: "soybeans", region: "Ontario" });
  assert.equal(ont.price?.value, 634.52);
  assert.deepEqual((ont.extra as any).other_provinces_same_month, []);
});

test("a city is answered with its province and says so; a product with no figure is no_matches; an unknown product lists the products", async () => {
  const city = await ask({ product: "wheat", region: "Saskatoon" });
  assert.equal(city.price?.value, 302.26);
  assert.equal((city.query as any).region, "Saskatchewan");
  assert.match(city.statistic?.note ?? "", /provincial averages, not local ones/);
  const none = await ask({ product: "potatoes", region: "Ontario" });
  assert.equal(none.status, "no_matches");
  assert.match(none.summary, /no recent price received by farmers for "Fresh potatoes" in Ontario/);
  const unknown = await ask({ product: "unicorn horn", region: "Ontario" });
  assert.equal(unknown.status, "no_matches");
  assert.match(unknown.summary, /no product "unicorn horn"/);
});

test("no region is a clear InputError that lists the provinces and what they got; a wrong region or empty product is refused", async () => {
  await assert.rejects(ask({ product: "wheat" }), /no Canada total\. Give region, one of: Newfoundland and Labrador; .*Latest published for Wheat \(except durum wheat\): Saskatchewan 302\.26 \(August 2026\)/);
  await assert.rejects(ask({ product: "wheat", region: "Atlantis" }), /is not a region in this table/);
  await assert.rejects(ask({ product: "" }), /product is required/);
});

test("old data is flagged plainly when the newest month is 4 or more months behind", async () => {
  const a = await ask({ product: "wheat", region: "Saskatchewan" }, new Date("2027-01-18T12:00:00Z"));
  assert.match(a.statistic?.note ?? "", /Old data: .* 5 months ago/);
  assert.match(a.summary, /Old data: 5 months old/);
});

test("year-on-year and the last 12 months from a full 14-month series (synthetic series, only to exercise the arithmetic)", () => {
  const months = Array.from({ length: 14 }, (_, i) => {
    const m = 7 + i; // 2025-07 .. 2026-08
    const y = 2025 + Math.floor((m - 1) / 12);
    const mm = ((m - 1) % 12) + 1;
    return { period: `${y}-${String(mm).padStart(2, "0")}-01`, survey: "", value: 200 + i * 10, decimals: 2, status: 0, releaseTime: null };
  });
  const s: DataSeries = { coordinate: "8.3.0.0.0.0.0.0.0.0", vectorId: 1, ok: true, points: months };
  const units = new Map([[1, { code: 117, unit: "per metric tonne", published: "Dollars per metric tonne" }]]);
  const r = readFarm([s], [{ id: 8, name: "Saskatchewan" }], 8, units, "2026-08-01")!;
  assert.equal(r.month, "2026-08");
  assert.equal(r.value, 330);
  assert.deepEqual(r.yearAgo, { month: "2025-08", value: 210 });
  assert.deepEqual(r.previous, { month: "2026-07", value: 320 });
  assert.equal(r.last12.length, 12);
  assert.equal(r.last12[0].month, "2025-09");
});

test("pure helpers: product words, unit names, conversions", () => {
  assert.equal(matchProduct("Wheat")?.primary?.label, "Wheat (except durum wheat)");
  assert.equal(matchProduct("durum")?.primary?.label, "Durum wheat");
  assert.equal(matchProduct("hog")?.primary?.label, "Hogs");
  assert.equal(matchProduct("price of canola seed in alberta")?.primary?.label, "Canola (including rapeseed)");
  assert.equal(matchProduct("unicorn horn").primary, null);
  assert.ok(matchProduct("wheat").related.some((d) => d.label === "Durum wheat") === false);
  assert.ok(matchProduct("wheat").related.some((d) => d.label === "Wheat (except durum wheat), milling"));
  const names = parseUomNames(FARM_CODE_SETS);
  assert.deepEqual(unitFrom(117, names), { code: 117, unit: "per metric tonne", published: "Dollars per metric tonne" });
  assert.equal(unitFrom(999, names), null);
  assert.equal(parseSeriesUoms(FARM_SERIES_INFO).get(31212164), 114);
  assert.deepEqual(perSmallUnit(300, "per metric tonne"), { unit: "per kilogram", value: 0.3 });
  assert.equal(perSmallUnit(100, "per hundredweight"), null);
  assert.equal(PRODUCTS.length, 35);
  assert.match(exampleProducts(5), /wheat/);
  assert.match(caFarmMethod(), /no range is calculated/);
});

test("manifest: farm-gate-prices tool, CA only, the wheat example is the smoke test, Open Licence quoted with its URL", () => {
  assert.equal(manifest.category, "farm-gate-prices");
  assert.deepEqual(manifest.countries, ["CA"]);
  assert.equal(manifest.examples[0].params.product, "wheat");
  assert.equal(manifest.examples[0].params.region, "Saskatchewan");
  assert.equal(INFO.licence_url, "https://www.statcan.gc.ca/en/terms-conditions/open-licence");
  assert.match(INFO.licence, /use, reproduce, publish, freely distribute, or sell the Information/);
  assert.equal(INFO.price_type, "official_statistic");
  assert.deepEqual(countriesFor("farm-gate-prices"), ["CA"]);
  assert.equal(categoryById("farm-gate-prices")?.tool, "pricepaid_farm_gate_prices");
});

// ---------- daily copy (stale-if-error) ----------

test("harvest: the newest month's averages by province and product with the unit in the item, the same figure as the live answer, no made-up count", async () => {
  const h = await caFarmHarvest(post, get);
  assert.ok(h.rows.length > 0);
  assert.equal(h.currency, "CAD");
  const live = await ask({ product: "wheat", region: "Saskatchewan" });
  const row = h.rows.find((r) => r.area === "Saskatchewan" && r.item === "Wheat (except durum wheat) (per metric tonne)")!;
  assert.ok(row, "Saskatchewan wheat row");
  assert.equal(row.median, live.price?.value);
  assert.ok(Number.isNaN(row.n), "official statistic: n is NO_COUNT");
  assert.equal(row.low, row.high);
  assert.equal(h.date, live.period.to);
  assert.throws(() => farmHarvestRows([]), /no usable farm price/);
});

test("history key: the province and the product's unit come from the stored rows; a missing province or an unknown product gives null", async () => {
  const h = await caFarmHarvest(post, get);
  const k = farmHistoryKey({ product: "wheat", region: "Saskatchewan" }, h.rows)!;
  assert.equal(k.area, "Saskatchewan");
  assert.equal(k.item, "Wheat (except durum wheat) (per metric tonne)");
  assert.equal(farmHistoryKey({ product: "wheat" }, h.rows), null); // no Canada total exists
  assert.equal(farmHistoryKey({ product: "unobtainium", region: "Saskatchewan" }, h.rows), null);
  assert.equal(farmHistoryKey({ product: "wheat", region: "Saskatchewan" }, []), null);
});

test("the manifest declares the daily copy for stale-if-error", () => {
  assert.ok(manifest.harvest && manifest.historyKey && manifest.referenceDates && manifest.nominalCounts);
});
