// Fixtures in ./fixtures are real CSO responses captured through the GitHub-hosted probe on 2026-10-14:
//  - riq02-meta.json: ReadMetadata for table RIQ02 (RTB Average Monthly Rent Report, updated 2026-05-14, quarters 2007Q4-2025Q4)
//  - riq02-rpc.json: the JSON-RPC GET query for quarters 2024Q4, 2025Q3, 2025Q4 and locations Dublin and "Swords, Dublin"
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseJsonStat } from "../../lib/adapters";
import { INFO, buildRpcUrl, ieRent, matchLocation, parseRiqMeta, parseRpc, pickLatest } from "./source";

const read = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const META = read("riq02-meta.json");
const RPC = read("riq02-rpc.json");

test("metadata: quarters, locations and labels", () => {
  const m = parseRiqMeta(META);
  assert.equal(m.quarters[m.quarters.length - 1], "20254");
  assert.equal(m.quarters[0], "20074");
  assert.equal(m.locations.length, 446);
  assert.equal(m.updated, "2026-05-14T11:00:00.000Z");
  assert.equal(m.bedLabels["08"], "Four plus bed");
  assert.equal(m.typeLabels["04"], "Apartment");
});

test("place matching: exact, town in county, Dublin district, ambiguity, unknown", () => {
  const m = parseRiqMeta(META);
  assert.deepEqual(matchLocation(m, "Dublin"), { code: "120500", label: "Dublin" });
  assert.deepEqual(matchLocation(m, "dublin"), { code: "120500", label: "Dublin" });
  assert.deepEqual(matchLocation(m, "County Dublin"), { code: "120500", label: "Dublin" });
  assert.equal(matchLocation(m, "Swords").code, "123300");
  assert.equal(matchLocation(m, "Swords, Dublin").label, "Swords, Dublin");
  assert.equal(matchLocation(m, "Dublin 6").label, "Dublin 6");
  assert.equal(matchLocation(m, "D6W").label, "Dublin 6W");
  assert.equal(matchLocation(m, "Cork City").code, "115200");
  assert.equal(matchLocation(m, "Dún Laoghaire").label, "Dun Laoghaire, Dublin");
  assert.throws(() => matchLocation(m, "Drumcondra"), /several places.*Drumcondra, Dublin 3.*Drumcondra, Dublin 9/s);
  assert.throws(() => matchLocation(m, "Atlantis"), /not a place in the RTB rent data/);
  assert.equal(matchLocation(m, "Ballyfermot").label, "Ballyfermot, Dublin 10");
});

test("query URL asks only for the cells needed", () => {
  const url = new URL(buildRpcUrl(["20253", "20254"], "120500", "04"));
  assert.equal(url.origin + url.pathname, "https://ws.cso.ie/public/api.jsonrpc");
  const q = JSON.parse(url.searchParams.get("data")!);
  assert.equal(q.method, "PxStat.Data.Cube_API.ReadDataset");
  assert.equal(q.params.extension.matrix, "RIQ02");
  assert.deepEqual(q.params.dimension["TLIST(Q1)"].category.index, ["20253", "20254"]);
  assert.deepEqual(q.params.dimension["C03004V03625"].category.index, ["120500"]);
  assert.deepEqual(q.params.dimension["C02969V03591"].category.index, ["04"]);
});

test("real response: latest quarter, previous quarter and year-ago values", () => {
  const t = parseRpc(RPC);
  const dublin = pickLatest(t, { bed: "-", type: "-", loc: "120500" })!;
  assert.equal(dublin.quarter, "2025Q4");
  assert.ok(dublin.value > 1500 && dublin.value < 3500, `Dublin average rent looks implausible: ${dublin.value}`);
  assert.equal(dublin.previous?.quarter, "2025Q3");
  assert.equal(dublin.yearAgo, null); // 2024Q4 is four quarters back but 2025Q1 and 2025Q2 are not in this slice
  const swords = pickLatest(t, { bed: "-", type: "-", loc: "123300" })!;
  assert.ok(swords.value > 1200 && swords.value < dublin.value);
  // a cell the publisher leaves blank gives null
  assert.equal(pickLatest(t, { bed: "-", type: "01", loc: "123300" }), null);
});

test("service errors become readable source errors", () => {
  assert.throws(() => parseRpc({ jsonrpc: "2.0", error: { code: -32000, message: "Matrix not found" } }), /The CSO refused the request: Matrix not found/);
  assert.throws(() => parseRpc({}), /no result/);
  assert.throws(() => parseJsonStat("NotFound"), /Unexpected response/);
});

test("ieRent: a full answer for Dublin, with the period, source and the actual-average caveat", async () => {
  // Reuse the real metadata, and answer the query from the real response (it holds a superset of the cells asked).
  const fetcher = async (url: string) => (url.includes("ReadMetadata") ? META : RPC);
  const a = await ieRent({ town: "Dublin" }, fetcher, new Date("2026-10-14T00:00:00Z"));
  assert.equal(a.status, "ok");
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.price?.measure, "average");
  assert.equal(a.price?.currency, "EUR");
  assert.equal(a.price?.unit, "per month");
  assert.equal(a.price?.median, null);
  assert.equal(a.price?.typical_low, null);
  assert.equal(a.sample_size, null);
  assert.deepEqual(a.period, { from: "2025-10-01", to: "2025-12-31" });
  assert.equal(a.statistic?.reference_period, "2025-Q4");
  assert.match(a.statistic?.note ?? "", /not standardised/);
  assert.match(a.statistic?.note ?? "", /ended about 9 months ago/);
  assert.match(a.summary, /registered with the RTB in Dublin was €[\d,]+ \(one published average, not a range; not mix-adjusted\)/);
  assert.match(a.summary, /That quarter ended about 9 months ago, so rents today may differ\./); // audit 2026-10-14: lag in the sentence itself
  assert.doesNotMatch(a.summary, /paid|typical range/);
  assert.equal(a.source.id, "ie-rtb-rents");
  assert.equal((a.extra as any).previous_quarter.quarter, "2025Q3");
  assert.ok(Object.keys((a.extra as any).by_bedrooms).includes("Two bed"));
});

test("ieRent: input checks", async () => {
  const fetcher = async (url: string) => (url.includes("ReadMetadata") ? META : RPC);
  await assert.rejects(ieRent({}, fetcher), /A place is required/);
  await assert.rejects(ieRent({ town: "Dublin", property_type: "house" }, fetcher), /add house_type/);
  await assert.rejects(ieRent({ town: "Dublin", property_type: "room" }, fetcher), /room rentals/);
  await assert.rejects(ieRent({ town: "Dublin", bedrooms: 0 }, fetcher), /starts at one bedroom/);
  await assert.rejects(ieRent({ town: "Dublin", house_type: "castle" }, fetcher), /house_type must be/);
});

test("INFO states the licence and the kind of figure", () => {
  assert.match(INFO.licence, /CC BY 4\.0/);
  assert.equal(INFO.price_type, "official_statistic");
  assert.match(INFO.limits, /not the standardised/);
});

test("ieRent: a recent quarter carries no age warning in the summary", async () => {
  const fetcher = async (url: string) => (url.includes("ReadMetadata") ? META : RPC);
  const a = await ieRent({ town: "Dublin" }, fetcher, new Date("2026-03-01T00:00:00Z"));
  assert.doesNotMatch(a.summary, /quarter ended about/);
});

test("ieRent: G20261018-3 Dublin 8, 2 bedrooms (the district is empty in the table, its parts carry the figure)", async () => {
  const D8 = read("riq02-rpc-dublin8.json");
  const fetcher = async (url: string) => {
    if (url.includes("ReadMetadata")) return META;
    const q = JSON.parse(new URL(url).searchParams.get("data")!);
    const locs: string[] = q.params.dimension["C03004V03625"].category.index;
    return locs.length > 1 ? D8 : { ...D8, result: { ...D8.result, dimension: { ...D8.result.dimension, C03004V03625: { ...D8.result.dimension.C03004V03625, category: { index: ["129900"], label: { "129900": "Dublin 8" } } } }, size: [1, 5, 7, 1, 1], value: new Array(35).fill(null) } };
  };
  const two = await ieRent({ town: "Dublin 8", bedrooms: 2 }, fetcher, new Date("2026-10-18T00:00:00Z"));
  assert.equal(two.status, "ok");
  assert.equal(two.price?.value, 1912.06); // only Rialto has a two-bed figure in 2025Q4
  assert.match(two.summary, /Rialto, Dublin 8/);
  assert.match(String(two.statistic?.note), /only part of it with one is Rialto, Dublin 8/);
  const all = await ieRent({ town: "Dublin 8" }, fetcher, new Date("2026-10-18T00:00:00Z"));
  assert.equal(all.status, "ok");
  assert.equal(all.price?.value, Math.round(((1797.64 + 1821.96) / 2) * 100) / 100); // plain mean of the two parts
  assert.match(String(all.statistic?.note), /plain mean/);
});

// ---------- daily copy (harvest, history key, stale-if-error) ----------
import { ieHarvest, ieHarvestRows, ieHistoryKey } from "./source";

test("ieHarvest: rows for the newest quarter from the real response, one published average each, no count", async () => {
  // The real fixture holds every property type and bedroom size for Dublin and Swords; the same slice answers each per-type query.
  const fetcher = async (url: string) => (url.includes("ReadMetadata") ? META : RPC);
  const h = await ieHarvest(fetcher);
  assert.equal(h.date, "2025-12-31"); // end of 2025Q4
  assert.equal(h.currency, "EUR");
  assert.equal(h.unit, "per month");
  assert.ok(h.rows.every((r) => Number.isNaN(r.n) && r.low === r.median && r.high === r.median && r.median > 0));
  const dub = h.rows.find((r) => r.area === "Dublin" && r.item === "all/all")!;
  assert.ok(dub.median > 1500 && dub.median < 3500);
  assert.ok(h.rows.some((r) => r.area === "Dublin" && r.item === "apartment/2"));
  // no row twice, and none from an older quarter than the newest
  const keys = h.rows.map((r) => `${r.area}|${r.item}`);
  assert.equal(new Set(keys).size, keys.length);
  assert.match(h.note ?? "", /2025-Q4/);
});

test("ieHarvestRows: an empty table is an error, not an empty day", () => {
  const t = parseRpc(RPC);
  const empty = { ...t, rows: t.rows.map((r) => ({ ...r, value: null })) };
  assert.throws(() => ieHarvestRows([{ type: { name: "all", code: "-" }, table: empty }], []), /no usable average rent/);
});

test("ieHistoryKey: the request maps to the library keys without asking the CSO", () => {
  const areas = ["Dublin", "Swords, Dublin", "Cork City", "Rialto, Dublin 8", "Drumcondra, Dublin 3", "Drumcondra, Dublin 9"];
  assert.deepEqual(ieHistoryKey({ town: "Dublin" }, areas), { area: "Dublin", item: "all/all", label: "Dublin" });
  assert.deepEqual(ieHistoryKey({ town: "swords", property_type: "apartment", bedrooms: 2 }, areas), { area: "Swords, Dublin", item: "apartment/2", label: "Swords, Dublin" });
  assert.deepEqual(ieHistoryKey({ town: "Cork City", property_type: "house", house_type: "semi", bedrooms: 5 }, areas), { area: "Cork City", item: "semi-detached/4plus", label: "Cork City" });
  assert.equal(ieHistoryKey({ town: "Drumcondra" }, areas), null); // ambiguous: the live path explains, the copy never guesses
  assert.equal(ieHistoryKey({ town: "Atlantis" }, areas), null);
  assert.equal(ieHistoryKey({ town: "Dublin", property_type: "house" }, areas), null); // houses need a type
  assert.equal(ieHistoryKey({ town: "Dublin", property_type: "room" }, areas), null);
  assert.equal(ieHistoryKey({ town: "Dublin", bedrooms: 0 }, areas), null);
  assert.equal(ieHistoryKey({}, areas), null);
  assert.equal(ieHistoryKey({ town: "Dublin" }, []), null);
});

test("manifest: area, city and place are read as the town (G20261025-1: area=Dublin 8 was refused)", async () => {
  const { default: manifest } = await import("./index");
  const seen: unknown[] = [];
  const orig = (manifest as any).handle;
  assert.equal(typeof orig, "function");
  for (const key of ["area", "city", "place"]) {
    await assert.rejects(
      (manifest as any).handle({ country: "IE", [key]: "Atlantis" }, { baseUrl: "http://127.0.0.1:9" }),
      (e: Error) => !/A place is required/.test(e.message),
    );
    seen.push(key);
  }
  assert.equal(seen.length, 3);
});
