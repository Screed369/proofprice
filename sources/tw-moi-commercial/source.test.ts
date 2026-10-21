// Tests for tw-moi-commercial. The fixture is a real slice of the Taipei sales file (a_lvr_land_a.csv) from the MOI portal.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeZip } from "../../tests/helpers/make-zip";
import { parseTable, decodeCsv } from "../tw-home-sales/moi";
import type { Release } from "../tw-home-sales/moi";
import { InputError } from "../../lib/http";
import {
  INFO, isBuildingLand, isCommercialUse, newStats, normaliseKind, parseCommercialSales, salesRows, snapshotFromRows, twCommercialAnswer, twCommercial,
  twCommercialHarvest, type CSale, type HarvestDeps,
} from "./source";
import plugin from "./index";

const SALES_CSV = readFileSync(new URL("./fixtures/a_lvr_land_a.csv", import.meta.url), "utf8");
const TODAY = "2026-10-14";
const HEADER = parseTable(SALES_CSV).header;
const ENGLISH_LINE = SALES_CSV.split("\n")[1];

test("uses: commercial, office, industrial yes; homes, mixed use and empty no", () => {
  for (const u of ["商業用", "辦公用", "工業用", "工商用"]) assert.equal(isCommercialUse(u), true, u);
  for (const u of ["住家用", "住商用", "住工用", "農業用", "", undefined]) assert.equal(isCommercialUse(u), false, String(u));
});

test("building land: urban residential/commercial/industrial zones and non-urban building land yes; roads, farmland, protected no", () => {
  assert.equal(isBuildingLand("都市：其他:第三種住宅區。", "", ""), true);
  assert.equal(isBuildingLand("都市：其他:第四種商業區。", "", ""), true);
  assert.equal(isBuildingLand("都市：其他:乙種工業區。", "", ""), true);
  assert.equal(isBuildingLand("都市：其他:道路用地(公共設施用地)。45/5/4", "", ""), false);
  assert.equal(isBuildingLand("都市：其他:農業區。", "", ""), false);
  assert.equal(isBuildingLand("", "山坡地保育區", "丁種建築用地"), true);
  assert.equal(isBuildingLand("", "一般農業區", "農牧用地"), false);
  assert.equal(isBuildingLand("", "", ""), false);
});

test("real Taipei slice: three commercial sales kept; public-facility land, the relatives' deal and the home dropped", () => {
  const stats = newStats();
  const sales = parseCommercialSales(parseTable(decodeCsv(Buffer.from(SALES_CSV))), "A", { stats, today: TODAY });
  assert.equal(sales.length, 3);
  assert.deepEqual(sales.map((s) => [s.district, s.kind, s.total, s.unit]).sort(), [
    ["中山區", "commercial", 3800000, 132312],
    ["中正區", "commercial", 15485000, 287398],
    ["大同區", "commercial", 33500000, 263665],
  ]);
  assert.equal(stats.rows, 9);
  assert.equal(stats.dropped["land not building land"], 3);
  assert.equal(stats.dropped["non-market remark"], 1);
  assert.equal(stats.dropped["not commercial or industrial use"], 2);
});

function csvOf(rows: Record<string, string>[]): string {
  return `﻿${HEADER.join(",")}\n${ENGLISH_LINE}\n${rows.map((r) => HEADER.map((h) => r[h] ?? "").join(",")).join("\n")}\n`;
}
const row = (o: Record<string, string>) => ({ 鄉鎮市區: "信義區", 交易標的: "房地(土地+建物)", 交易年月日: "1150910", 主要用途: "商業用", 總價元: "20000000", 單價元平方公尺: "250000", 備註: "", 編號: "X1", 土地位置建物門牌: "某市信義區某路1號", ...o });
const parse = (rows: Record<string, string>[], seen?: Set<string>) => parseCommercialSales(parseTable(csvOf(rows)), "A", { today: TODAY, seen });

test("land sale on residential zone kept with the land unit price; farmland and absurd prices dropped; duplicates counted once", () => {
  const land = row({ 交易標的: "土地", 都市土地使用分區: "都市：其他:第三種住宅區。", 主要用途: "", 單價元平方公尺: "500000", 編號: "L1", 土地位置建物門牌: "a" });
  const farm = row({ 交易標的: "土地", 都市土地使用分區: "", 非都市土地使用分區: "一般農業區", 非都市土地使用編定: "農牧用地", 編號: "L2", 土地位置建物門牌: "b" });
  const cheap = row({ 總價元: "100000", 編號: "C1", 土地位置建物門牌: "c" });
  const odd = row({ 單價元平方公尺: "90000000", 編號: "C2", 土地位置建物門牌: "d" });
  const dupA = row({ 編號: "D1", 土地位置建物門牌: "e" });
  const seen = new Set<string>();
  const out = parse([land, farm, cheap, odd, dupA, dupA], seen);
  assert.deepEqual(out.map((s) => [s.kind, s.unit]), [["land", 500000], ["commercial", 250000]]);
});

test("a missing unit price is rebuilt from the building area less parking", () => {
  const r = row({ 單價元平方公尺: "", 建物移轉總面積平方公尺: "100", 車位移轉總面積平方公尺: "20", 車位總價元: "2000000", 總價元: "18000000" });
  const out = parse([r]);
  assert.equal(out[0].unit, 200000); // (18m - 2m) / (100 - 20)
});

const sale = (i: number, kind: CSale["kind"], date: string, district = "信義區", city = "A"): CSale => ({ city, district, date, kind, total: 20_000_000 + i * 1_000_000, unit: 200_000 + i * 10_000 });

test("rows: windows, three levels, total price only for commercial, cells under 5 dropped", () => {
  const sales: CSale[] = [
    ...Array.from({ length: 6 }, (_, i) => sale(i, "commercial", "2026-08-15")),
    ...Array.from({ length: 5 }, (_, i) => sale(i, "land", "2026-03-15", "大安區")),
    ...Array.from({ length: 4 }, (_, i) => sale(i, "land", "2026-07-15", "中山區")),
    sale(0, "commercial", "2024-11-15"), // inside 24 but not 12 months of 2026-09-30 -> 24m only
    sale(0, "commercial", "2026-10-02"), // after the anchor: ignored
  ];
  const rows = salesRows(sales, "2026-09-30");
  const get = (area: string, item: string) => rows.find((r) => r.area === area && r.item === item);
  assert.equal(get("A|信義區", "commercial:m2:12m")!.n, 6);
  assert.equal(get("A|信義區", "commercial:total:12m")!.n, 6);
  assert.equal(get("A|信義區", "commercial:m2:24m")!.n, 7);
  assert.equal(get("A", "commercial:m2:12m")!.n, 6);
  assert.equal(get("ALL", "land:m2:12m")!.n, 9);
  assert.equal(get("A|大安區", "land:m2:12m")!.n, 5);
  assert.equal(get("A|大安區", "land:total:12m"), undefined, "no total price for land");
  assert.equal(get("A|中山區", "land:m2:12m"), undefined, "4 sales: no figure");
  assert.ok(rows.every((r) => r.n >= 5));
});

const snap = () => snapshotFromRows("2026-09-30", salesRows([
  ...Array.from({ length: 6 }, (_, i) => sale(i, "commercial", "2026-08-15")),
  ...Array.from({ length: 5 }, (_, i) => sale(i, "land", "2026-03-15", "大安區")),
  ...Array.from({ length: 6 }, (_, i) => sale(i, "commercial", "2026-08-15", "板橋區", "F")),
], "2026-09-30"));

test("answer: Taipei commercial, a district, all of Taiwan; honest label and source", () => {
  const a = twCommercialAnswer(snap(), { town: "Taipei", property_type: "commercial", now: new Date("2026-10-14") });
  assert.equal(a.status, "ok");
  assert.equal(a.sample_size, 6);
  assert.equal(a.price!.currency, "TWD");
  assert.match(a.price!.unit, /m²/);
  assert.ok(a.price!.median! > 200_000 && a.price!.median! < 300_000);
  assert.match(a.source.licence_url, /data\.gov\.tw/);
  assert.ok((a.extra as any).total_price.median > 20_000_000);
  const d = twCommercialAnswer(snap(), { town: "Xinyi, Taipei", property_type: "commercial" });
  assert.equal(d.sample_size, 6);
  const nat = twCommercialAnswer(snap(), { town: "", property_type: "commercial" });
  assert.equal(nat.sample_size, 12);
});

test("answer: fewer than 5 sales gives no_matches; unknown place and postcode-only are 400s", async () => {
  const none = twCommercialAnswer(snap(), { town: "Banqiao, New Taipei", property_type: "land" });
  assert.equal(none.status, "no_matches");
  assert.match(none.summary, /Fewer than 5/);
  assert.throws(() => twCommercialAnswer(snap(), { town: "Atlantis", property_type: "commercial" }), InputError);
  await assert.rejects(twCommercial({ postcode: "100", property_type: "commercial" }, { snapshot: snap() }), /no postcodes/);
  await assert.rejects(twCommercial({ town: "Taipei" }, { snapshot: null }), /Not yet available/);
  assert.equal(normaliseKind("Shops"), "commercial");
  assert.equal(normaliseKind("building plot"), "land");
  assert.throws(() => normaliseKind("farm"), InputError);
});

test("answer: a place with sales only on land can be asked for land (3-level fallback to 24 months)", () => {
  const a = twCommercialAnswer(snap(), { town: "Da'an, Taipei", property_type: "land", months: 12 });
  assert.equal(a.status, "ok");
  assert.equal(a.sample_size, 5);
});

test("harvest end to end (fake portal): commercial and land rows from the zip, deals counted once, other files untouched", async () => {
  const rows = [
    ...Array.from({ length: 6 }, (_, i) => row({ 編號: `Z${i}`, 交易年月日: "1150615", 土地位置建物門牌: `x${i}`, 總價元: String(20_000_000 + i * 1_000_000) })),
    row({ 編號: "Z0", 交易年月日: "1150615", 土地位置建物門牌: "x0" }), // same deal again
    row({ 編號: "H1", 主要用途: "住家用", 土地位置建物門牌: "h" }),
    row({ 編號: "NEW", 交易年月日: "1150910", 土地位置建物門牌: "n" }), // the newest deal sets the window end
  ];
  const zip = makeZip({ "a_lvr_land_a.csv": csvOf(rows), "a_lvr_land_a_build.csv": "must not be read", "a_lvr_land_c.csv": "rentals" }, true);
  const rel: Release = { id: "current", kind: "current", url: "https://example.test/current.zip", salesFrom: "2026-09-21", salesTo: "2026-09-30", rentFrom: null, rentTo: null };
  const deps: HarvestDeps = { fetchReleases: async () => [rel], download: async () => zip, stored: () => null, now: () => new Date(`${TODAY}T03:17:00Z`) };
  const h = await twCommercialHarvest(deps);
  assert.equal(h.currency, "TWD");
  assert.equal(h.unit, "per m²");
  assert.equal(h.date, "2026-08-31");
  const r = h.rows.find((x) => x.area === "ALL" && x.item === "commercial:m2:12m")!;
  assert.equal(r.n, 6);
  assert.match(h.note!, /\[releases 1:2026-09\]/);
  // nothing new -> the stored rows are reused without downloading
  let downloads = 0;
  const again = await twCommercialHarvest({ ...deps, download: async () => { downloads++; return zip; }, stored: () => ({ note: h.note!, date: h.date, rows: h.rows }) });
  assert.equal(downloads, 0);
  assert.deepEqual(again.rows, h.rows);
  await assert.rejects(twCommercialHarvest({ ...deps, download: async () => makeZip({ "readme.txt": "x" }) }), /no sales files/);
});

test("manifest: category, country, examples, licence and attribution are in place", () => {
  assert.equal(plugin.category, "commercial-property");
  assert.deepEqual(plugin.countries, ["TW"]);
  assert.ok(plugin.examples.length >= 1);
  assert.match(INFO.attribution, /Ministry of the Interior/);
  assert.match(INFO.licence, /Licence checked: 2026-10-21/);
});
