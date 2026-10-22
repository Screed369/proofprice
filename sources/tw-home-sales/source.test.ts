// Real formats, checked live on 2026-10-14 from GitHub's servers (see the Notion Source Pipeline for the probes):
//  - fixtures/a_lvr_land_a.csv: the real header rows (Chinese names, then English names) and real rows copied from the sales file of
//    Taipei (a_lvr_land_a.csv) with the address replaced; land-only rows, commercial and office use, a relatives' deal and a home sale.
//  - fixtures/Download_ajax_active.html and fixtures/DownloadHistory_ajax_list.html: the portal's own release lists, complete.
// The larger data sets in these tests are SYNTHETIC, in the same layout (the real header with made-up rows).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { makeZip } from "../../tests/helpers/make-zip";
import { writeDaily, writeMeta } from "../../lib/library/store";
import {
  anchorOf, cityFiles, decodeCsv, isResidentialUse, listZip, monthEnd, parseCurrent, parseDescription, parseSeasons, parseTable, parseTenDay, readZipEntry, rocToIso,
  selectReleases, windowStart, type Release,
} from "./moi";
import { TAIWAN_CITIES, districtKey, findPlace } from "./places";
import {
  INFO, LOGIC_VERSION, NATIONAL_AREA, TW_TYPES, buildingTypeOf, itemKey, itemTypesOf, newStats, normaliseType, parseSales, salesRows, snapshotFromRows, twBackfill, twHistoryKey, twHomeSales, twHomeSalesHarvest,
  type HarvestDeps, type Sale,
} from "./source";

const read = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8");
const SALES_CSV = read("a_lvr_land_a.csv");
const ACTIVE = read("Download_ajax_active.html");
const HISTORY = read("DownloadHistory_ajax_list.html");
const TODAY = "2026-10-14";

// ---------- dates ----------

test("ROC dates: year + 1911, impossible dates refused", () => {
  assert.equal(rocToIso("1150901"), "2026-09-01");
  assert.equal(rocToIso("990101"), "2010-01-01");
  assert.equal(rocToIso(" 1150228 "), "2026-02-28");
  assert.equal(rocToIso("1150229"), null); // 2026 is not a leap year
  assert.equal(rocToIso("1151301"), null);
  assert.equal(rocToIso("20260901"), null);
  assert.equal(rocToIso(""), null);
  assert.equal(rocToIso(undefined), null);
});

test("anchor and windows: whole months, ending at the last month that is at least 30 days old", () => {
  assert.equal(monthEnd("2026-02-10"), "2026-02-28");
  assert.equal(anchorOf("2026-09-18"), "2026-08-31");
  assert.equal(anchorOf("2026-09-30"), "2026-08-31");
  assert.equal(anchorOf("2026-10-05"), "2026-09-30");
  assert.equal(anchorOf("2026-10-30"), "2026-09-30");
  assert.equal(anchorOf("2026-10-31"), "2026-10-31"); // 30 days before is Oct 1: October is already 30 days old
  assert.equal(windowStart("2026-08-31", 12), "2025-09-01");
  assert.equal(windowStart("2026-08-31", 24), "2024-09-01");
  assert.equal(windowStart("2026-10-14", 26), "2024-09-01"); // 26 months ending October 2026 start in September 2024
});

// ---------- files ----------

test("CSV: UTF-8 with a BOM is read; Big5 is the fallback", () => {
  assert.equal(decodeCsv(Buffer.from("﻿鄉鎮市區,交易標的\n", "utf8")), "鄉鎮市區,交易標的\n");
  assert.equal(decodeCsv(Buffer.from([0xa4, 0xa4, 0xa4, 0xe5])), "中文"); // not valid UTF-8, valid Big5
});

test("real sales file: Chinese header, English header skipped, columns found by name", () => {
  const t = parseTable(decodeCsv(Buffer.from(SALES_CSV, "utf8")));
  assert.equal(t.header.length, 33);
  assert.equal(t.header[0], "鄉鎮市區");
  assert.equal(t.rows.length, 9);
  assert.equal(t.rows[0][0], "大同區");
  assert.ok(t.col("總價元") > 0 && t.col("單價元平方公尺") === t.col("總價元") + 1);
  assert.equal(t.col("no such column"), -1);
  assert.throws(() => parseTable(""), /empty/);
});

test("a quoted field with a comma or a line break stays in one cell", () => {
  const t = parseTable('鄉鎮市區,備註\nEnglish,note\n大安區,"含車位, 另有\n陽台"\n中山區,無\n');
  assert.deepEqual(t.rows, [["大安區", "含車位, 另有\n陽台"], ["中山區", "無"]]);
});

test("zip: city files of one kind only, detail tables and other letters left out", () => {
  const zip = makeZip(
    {
      "a_lvr_land_a.csv": "a-sales",
      "a_lvr_land_a_build.csv": "detail",
      "a_lvr_land_b.csv": "presales",
      "a_lvr_land_c.csv": "rentals",
      "f_lvr_land_a.csv": "new taipei",
      "y_lvr_land_a.csv": "not a city",
      "build_time.xml": "<x/>",
    },
    true,
  );
  const entries = listZip(zip);
  assert.equal(entries.length, 7);
  const sales = cityFiles(entries, "a");
  assert.deepEqual(sales.map((f) => f.code), ["A", "F"]);
  assert.equal(readZipEntry(zip, sales[1].entry).toString("utf8"), "new taipei");
  assert.deepEqual(cityFiles(entries, "c").map((f) => f.code), ["A"]);
  assert.throws(() => listZip(Buffer.from("not a zip")), /not a zip/);
});

// ---------- the portal's release lists ----------

test("current release and previous 10-day release from the real portal fragments", () => {
  const cur = parseCurrent(ACTIVE)!;
  assert.equal(cur.id, "current");
  assert.equal(cur.url, "https://plvr.land.moi.gov.tw/Download?type=zip&fileName=lvr_landcsv.zip");
  assert.deepEqual([cur.salesFrom, cur.salesTo, cur.rentFrom, cur.rentTo], ["2026-09-21", "2026-09-30", "2026-08-21", "2026-08-31"]);
  const ten = parseTenDay(HISTORY);
  assert.equal(ten.length, 1);
  assert.equal(ten[0].id, "20261001");
  assert.equal(ten[0].url, "https://plvr.land.moi.gov.tw/DownloadHistory?type=history&fileName=20261001");
  assert.deepEqual([ten[0].salesFrom, ten[0].salesTo, ten[0].rentFrom, ten[0].rentTo], ["2026-09-11", "2026-09-20", "2026-08-11", "2026-08-20"]);
  assert.equal(parseCurrent("<p>nothing</p>"), null);
});

test("quarterly releases: both description styles of the portal are read", () => {
  const seasons = parseSeasons(HISTORY);
  assert.equal(seasons.length, 59); // 101S1 .. 115S3
  const s = (id: string) => seasons.find((x) => x.id === id)!;
  assert.equal(s("115S3").url, "https://plvr.land.moi.gov.tw/DownloadSeason?season=115S3&type=zip&fileName=lvr_landcsv.zip");
  assert.deepEqual([s("115S3").salesFrom, s("115S3").salesTo, s("115S3").rentFrom, s("115S3").rentTo], ["2026-06-11", "2026-09-10", "2026-05-11", "2026-08-10"]);
  assert.deepEqual([s("113S3").salesFrom, s("113S3").salesTo], ["2024-06-11", "2024-09-10"]);
  // an older description reads "自 100年11月1 至 101年1月31日" (no 日 after the first day)
  assert.deepEqual([s("101S1").salesFrom, s("101S1").salesTo], ["2011-11-01", "2012-01-31"]);
  assert.deepEqual(parseDescription("nothing here"), { salesFrom: null, salesTo: null, rentFrom: null, rentTo: null });
});

test("which releases are read: those that can hold the last 26 months, newest first", () => {
  const all = [parseCurrent(ACTIVE)!, ...parseTenDay(HISTORY), ...parseSeasons(HISTORY)];
  const sales = selectReleases(all, "sales", windowStart(TODAY, 26)).map((r) => r.id);
  assert.deepEqual(sales, ["current", "20261001", "115S3", "115S2", "115S1", "114S4", "114S3", "114S2", "114S1", "113S4", "113S3"]);
  const rents = selectReleases(all, "rents", windowStart(TODAY, 26)).map((r) => r.id);
  assert.deepEqual(rents, ["current", "20261001", "115S3", "115S2", "115S1", "114S4", "114S3", "114S2", "114S1", "113S4"]);
});

// ---------- the sales file ----------

test("real rows: only the home sale counts, and every other row says why not", () => {
  const stats = newStats();
  const sales = parseSales(parseTable(SALES_CSV), "A", { stats, today: TODAY });
  assert.equal(sales.length, 1);
  assert.deepEqual(sales[0], { city: "A", district: "北投區", date: "2026-09-03", type: "high-rise", total: 25000000, unit: 122965 });
  assert.equal(stats.rows, 9);
  assert.equal(stats.kept, 1);
  assert.deepEqual(stats.dropped, {
    "not a land-and-building sale": 3, // the land-only rows
    "main use not residential": 4, // commercial and office use
    "special relationship": 1, // 親友、員工、共有人或其他特殊關係間之交易
  });
});

const HEADER = parseTable(SALES_CSV).header;
const ENGLISH_LINE = SALES_CSV.split("\n")[1];
interface Fake {
  district: string;
  date: string; // ROC
  type?: string;
  use?: string;
  total: number;
  unit?: number;
  note?: string;
  serial: string;
  object?: string;
  address?: string;
  area?: string;
}
function fakeRow(f: Fake): string {
  const cells: Record<string, string> = {
    鄉鎮市區: f.district,
    交易標的: f.object ?? "房地(土地+建物)",
    土地位置建物門牌: f.address ?? `某市${f.district}某路${f.serial}號`,
    交易年月日: f.date,
    建物型態: f.type ?? "住宅大樓(11層含以上有電梯)",
    主要用途: f.use ?? "住家用",
    建物移轉總面積平方公尺: f.area ?? "80.5",
    總價元: String(f.total),
    單價元平方公尺: String(f.unit ?? Math.round(f.total / 80.5)),
    備註: f.note ?? "",
    編號: f.serial,
  };
  return HEADER.map((h) => cells[h] ?? "").join(",");
}
const csvOf = (rows: Fake[]) => `﻿${HEADER.join(",")}\n${ENGLISH_LINE}\n${rows.map(fakeRow).join("\n")}\n`;
const one = (f: Partial<Fake>, opts: Parameters<typeof parseSales>[2] = { today: TODAY }) =>
  parseSales(parseTable(csvOf([{ district: "大安區", date: "1150801", total: 30000000, serial: "RP1", ...f }])), "A", opts);

test("market sales only: the Ministry's own remarks decide", () => {
  assert.equal(one({}).length, 1);
  assert.equal(one({ note: "親友、員工、共有人或其他特殊關係間之交易；" }).length, 0);
  assert.equal(one({ note: "預售屋、或土地及建物分件登記案件" }).length, 0);
  assert.equal(one({ note: "轉讓日期民國115年3月1日。預售屋、或土地及建物分件登記案件" }).length, 0);
  assert.equal(one({ note: "急買急賣；" }).length, 0);
  assert.equal(one({ note: "政府機關標讓售；" }).length, 0);
  assert.equal(one({ note: "毛胚屋；" }).length, 0);
  assert.equal(one({ note: "受債權債務關係影響之交易；" }).length, 0);
  assert.equal(one({ note: "具重建或重劃、都更等效益；" }).length, 0);
  // remarks about the building or what the price includes do not make a sale non-market
  for (const note of ["其他增建；", "陽台外推；", "頂樓加蓋；", "含傢俱設備費；", "含裝潢費；", "含租約；", "夾層；", "含土地增值稅或其他稅費；"]) {
    assert.equal(one({ note }).length, 1, note);
  }
});

test("only homes: land, parking, shops, offices, factories and mixed use are left out; rentals-style use words count", () => {
  assert.equal(one({ object: "土地" }).length, 0);
  assert.equal(one({ object: "車位" }).length, 0);
  assert.equal(one({ object: "建物" }).length, 0);
  assert.equal(one({ object: "房地(土地+建物)+車位" }).length, 1);
  assert.equal(one({ use: "商業用" }).length, 0);
  assert.equal(one({ use: "辦公用" }).length, 0);
  assert.equal(one({ use: "住商用" }).length, 0);
  assert.equal(one({ use: "" }).length, 0);
  assert.equal(one({ type: "辦公商業大樓" }).length, 0);
  assert.equal(one({ type: "店面(店鋪)" }).length, 0);
  assert.equal(one({ type: "工廠" }).length, 0);
  assert.equal(one({ type: "農舍" }).length, 0);
  assert.equal(one({ type: "其他" }).length, 0);
  for (const [zh, t] of [["住宅大樓(11層含以上有電梯)", "high-rise"], ["華廈(10層含以下有電梯)", "mid-rise"], ["公寓(5樓含以下無電梯)", "walk-up"], ["透天厝", "house"], ["套房(1房1廳1衛)", "studio"]] as const) {
    assert.equal(one({ type: zh })[0].type, t, zh);
  }
  for (const u of ["住家用", "住宅", "集合住宅", "公寓", "國民住宅", "住宅、停車空間"]) assert.ok(isResidentialUse(u), u);
  for (const u of ["住商用", "住工用", "店舖、住宅", "工業社區（社區住宅）", "商業用", "辦公用", "見使用執照", "", "農業用", "停車空間"]) assert.ok(!isResidentialUse(u), u);
});

test("prices: ROC dates, future dates, absurd prices and a missing unit price", () => {
  assert.equal(one({ date: "1990101" }).length, 0); // not a date
  assert.equal(one({ date: "1151231" }, { today: TODAY }).length, 0); // after today: a typing error
  assert.equal(one({ total: 5000 }).length, 0);
  assert.equal(one({ total: 9_000_000_000 }).length, 0);
  assert.equal(one({ total: 30000000 })[0].unit, Math.round(30000000 / 80.5));
  // no unit price in the register: price over area
  const noUnit = parseSales(parseTable(csvOf([{ district: "大安區", date: "1150801", total: 20000000, serial: "RP9", unit: 0, area: "50" }])), "A", { today: TODAY });
  assert.equal(noUnit[0].unit, 400000);
  assert.throws(() => parseSales(parseTable("鄉鎮市區,交易標的\nEnglish,x\n大安區,土地\n"), "A"), /new layout/);
});

test("the same deal in two releases counts once: by record number, or by address, day, price and area", () => {
  const seen = new Set<string>();
  const stats = newStats();
  const rows: Fake[] = [{ district: "大安區", date: "1150801", total: 30000000, serial: "RP1", address: "某市大安區同路1號" }];
  assert.equal(parseSales(parseTable(csvOf(rows)), "A", { seen, stats, today: TODAY }).length, 1);
  assert.equal(parseSales(parseTable(csvOf(rows)), "A", { seen, stats, today: TODAY }).length, 0); // the next release holds it again
  const again = [{ ...rows[0], serial: "RP2" }]; // another record number, same address, day, price, area
  assert.equal(parseSales(parseTable(csvOf(again)), "A", { seen, stats, today: TODAY }).length, 0);
  const other = [{ ...rows[0], serial: "RP3", address: "某市大安區別路1號" }];
  assert.equal(parseSales(parseTable(csvOf(other)), "A", { seen, stats, today: TODAY }).length, 1);
  assert.equal(stats.dropped["duplicate record"], 2);
});

test("building types", () => {
  assert.equal(buildingTypeOf("住宅大樓(11層含以上有電梯)"), "high-rise");
  assert.equal(buildingTypeOf("華廈(10層含以下有電梯)"), "mid-rise");
  assert.equal(buildingTypeOf("店面(店鋪)"), null);
  assert.deepEqual(itemTypesOf("high-rise"), ["any", "apartment", "high-rise"]);
  assert.deepEqual(itemTypesOf("house"), ["any", "house"]);
  assert.deepEqual(itemTypesOf("studio"), ["any", "apartment"]);
});

// ---------- aggregation ----------

/** SYNTHETIC sales: n high-rise flats and k houses in Da'an (Taipei), a few in Xinyi, one New Taipei district. */
function synthetic(): Sale[] {
  const out: Sale[] = [];
  for (let i = 0; i < 12; i++) out.push({ city: "A", district: "大安區", date: `2026-0${(i % 8) + 1}-15`, type: "high-rise", total: 30_000_000 + i * 1_000_000, unit: 300_000 + i * 1000 });
  for (let i = 0; i < 6; i++) out.push({ city: "A", district: "大安區", date: "2025-12-01", type: "house", total: 50_000_000 + i * 2_000_000, unit: 400_000 });
  for (let i = 0; i < 4; i++) out.push({ city: "A", district: "信義區", date: "2026-05-05", type: "mid-rise", total: 20_000_000 + i, unit: null });
  for (let i = 0; i < 7; i++) out.push({ city: "F", district: "板橋區", date: "2025-01-10", type: "walk-up", total: 8_000_000 + i * 100_000, unit: 90_000 }); // only in the 24 month windows
  out.push({ city: "A", district: "大安區", date: "2026-09-10", type: "high-rise", total: 99_000_000, unit: 999_000 }); // after the anchor: not counted
  return out;
}

test("rows: windows, levels, types and measures; fewer than 5 never published", () => {
  const rows = salesRows(synthetic(), "2026-08-31");
  const get = (area: string, item: string) => rows.find((r) => r.area === area && r.item === item);
  const daan = districtKey({ code: "A" } as any, { zh: "大安區" } as any);
  assert.equal(daan, "A|大安區");
  assert.equal(get(daan, itemKey("any", "total", 12))!.n, 18);
  assert.equal(get(daan, itemKey("apartment", "total", 12))!.n, 12);
  assert.equal(get(daan, itemKey("high-rise", "total", 12))!.n, 12);
  assert.equal(get(daan, itemKey("house", "total", 12))!.n, 6);
  assert.equal(get(daan, itemKey("mid-rise", "total", 12)), undefined);
  assert.equal(get("A", itemKey("any", "total", 12))!.n, 22); // Xinyi's four are too few for a district row, but count for the city
  assert.equal(get("A|信義區", itemKey("any", "total", 12)), undefined);
  assert.equal(get("A", itemKey("mid-rise", "total", 12)), undefined); // 4 only
  assert.equal(get("A", itemKey("apartment", "total", 12))!.n, 12 + 4);
  assert.equal(get("A", itemKey("apartment", "m2", 12))!.n, 12); // the four mid-rise have no unit price
  assert.equal(get(NATIONAL_AREA, itemKey("any", "total", 12))!.n, 22);
  assert.equal(get(NATIONAL_AREA, itemKey("any", "total", 24))!.n, 29); // the 2025-01 sales are inside the 24 month window only
  assert.equal(get("F|板橋區", itemKey("walk-up", "total", 12)), undefined);
  assert.equal(get("F|板橋區", itemKey("walk-up", "total", 24))!.n, 7);
  const r = get(daan, itemKey("high-rise", "total", 12))!;
  assert.ok(r.low <= r.median && r.median <= r.high && r.min <= r.low && r.high <= r.max);
  assert.equal(r.max, 41_000_000); // the 99 million sale after the anchor is not in
  assert.ok(rows.every((x) => x.n >= 5));
  // sorted, so the stored file is stable
  const order = (x: { area: string; item: string }) => `${x.area}\u0000${x.item}`;
  assert.deepEqual(rows.map(order), [...rows].sort((a, b) => a.area.localeCompare(b.area) || a.item.localeCompare(b.item)).map(order));
});

// ---------- places ----------

test("place names: English and Chinese, with or without District / City, 台 or 臺", () => {
  const key = (s: string) => {
    const f = findPlace(s);
    return f.kind === "found" ? f.place.key : f.kind;
  };
  for (const s of ["Taipei", "Taipei City", "台北市", "臺北市", "台北", "taipei city, taiwan"]) assert.equal(key(s), "A", s);
  for (const s of ["New Taipei", "New Taipei City", "新北市", "新北"]) assert.equal(key(s), "F", s);
  assert.equal(key("Taichung"), "B");
  assert.equal(key("臺中市"), "B");
  assert.equal(key("台中"), "B");
  assert.equal(key("Kaohsiung"), "E");
  assert.equal(key("Tainan"), "D");
  assert.equal(key("台南市"), "D");
  assert.equal(key("Taoyuan"), "H"); // the city, not Taoyuan District of Kaohsiung
  assert.equal(key("桃園市"), "H");
  assert.equal(key("Hsinchu City"), "O");
  assert.equal(key("Hsinchu County"), "J");
  assert.equal(key("新竹縣"), "J");
  assert.equal(key("Hsinchu"), "ambiguous");
  assert.equal(key("Chiayi"), "ambiguous");
  for (const s of ["Da'an, Taipei", "Daan, Taipei", "Da'an District, Taipei City", "Taipei Da'an", "臺北市大安區", "台北市大安區", "台北大安", "大安區, 臺北市", "Ta-an, Taipei"]) assert.equal(key(s), "A|大安區", s);
  assert.equal(key("Da'an, Taichung"), "B|大安區");
  assert.equal(key("Banqiao, New Taipei"), "F|板橋區");
  assert.equal(key("板橋區"), "F|板橋區");
  assert.equal(key("Banqiao"), "F|板橋區");
  assert.equal(key("Xinyi, Taipei"), "A|信義區");
  assert.equal(key("Xinyi"), "ambiguous"); // Taipei, Keelung and Nantou all have one
  assert.equal(key("Da'an"), "ambiguous"); // Taipei and Taichung
  assert.equal(key("Taiwan"), "national");
  assert.equal(key(""), "national");
  assert.equal(key("Atlantis"), "none");
  const bad = findPlace("Taipei, Nowhere");
  assert.equal(bad.kind, "city_only_district_missing");
});

test("the table: 22 cities and counties, every district has a name and a unique key", () => {
  assert.equal(TAIWAN_CITIES.length, 22);
  const keys = new Set<string>();
  let n = 0;
  for (const c of TAIWAN_CITIES) {
    assert.match(c.zh, /[市縣]$/);
    for (const d of c.districts) {
      assert.match(d.zh, /[區市鎮鄉]$/);
      keys.add(districtKey(c, d));
      n++;
    }
  }
  assert.equal(keys.size, n);
  assert.ok(n >= 360 && n <= 380, String(n));
});

// ---------- harvest ----------

const ZERO = { rentFrom: null, rentTo: null };
function release(id: string, kind: Release["kind"], salesFrom: string, salesTo: string): Release {
  return { id, kind, url: `https://example.test/${id}.zip`, salesFrom, salesTo, ...ZERO };
}
/** Fake the portal: two releases that hold Da'an and New Taipei sales; an old season that must not be fetched. */
function fakeDeps(o: { stored?: HarvestDeps["stored"]; failOn?: string } = {}) {
  const calls: string[] = [];
  const mk = (rows: Fake[], other: Fake[] = []) =>
    makeZip(
      {
        "a_lvr_land_a.csv": csvOf(rows),
        "a_lvr_land_a_build.csv": "garbage that must not be read",
        "f_lvr_land_a.csv": csvOf(other),
        "a_lvr_land_c.csv": "rentals that must not be read",
      },
      true,
    );
  const daan = (i: number, date: string, extra: Partial<Fake> = {}): Fake => ({ district: "大安區", date, total: 30_000_000 + i * 500_000, serial: `S${date}-${i}`, ...extra });
  const newer: Fake[] = [daan(0, "1150910"), daan(1, "1150918"), daan(2, "1150703")]; // the newest deal is 2026-09-18
  const older: Fake[] = [
    ...Array.from({ length: 10 }, (_, i) => daan(i, "1150615")),
    daan(11, "1150615", { note: "親友、員工、共有人或其他特殊關係間之交易；" }),
    daan(12, "1150615", { note: "預售屋、或土地及建物分件登記案件" }),
    daan(13, "1150615", { use: "商業用" }),
    daan(0, "1150910"), // the same deal as in the newer release
  ];
  const ntp: Fake[] = Array.from({ length: 6 }, (_, i) => ({ district: "板橋區", date: "1150520", total: 12_000_000 + i * 100_000, serial: `N${i}`, type: "華廈(10層含以下有電梯)" }));
  const zips: Record<string, Buffer> = { current: mk(newer), "115S3": mk(older, ntp) };
  const deps: HarvestDeps = {
    fetchReleases: async () => [
      release("current", "current", "2026-09-21", "2026-09-30"),
      release("115S3", "season", "2026-06-11", "2026-09-10"),
      release("101S1", "season", "2011-11-01", "2012-01-31"),
    ],
    download: async (url) => {
      calls.push(url);
      const id = url.split("/").pop()!.replace(".zip", "");
      if (o.failOn === id) throw new Error(`Could not download ${url}: HTTP 500`);
      return zips[id];
    },
    stored: o.stored ?? (() => null),
    now: () => new Date(`${TODAY}T03:17:00Z`),
  };
  return { deps, calls };
}

test("harvest end to end (fake portal): releases chosen, files read, deals counted once, rows for the 12 and 24 month windows", async () => {
  const { deps, calls } = fakeDeps();
  const h = await twHomeSalesHarvest(deps);
  assert.deepEqual(calls, ["https://example.test/current.zip", "https://example.test/115S3.zip"]); // 101S1 is too old
  assert.equal(h.date, "2026-08-31");
  assert.equal(h.currency, "TWD");
  assert.equal(h.unit, "per home");
  const get = (area: string, item: string) => h.rows.find((r) => r.area === area && r.item === item);
  // 2026-09 deals are after the anchor; Da'an: 10 sales on 2026-06-15 + 1 on 2026-07-03 = 11 (relatives, presale, shop and the repeat are out)
  assert.equal(get("A|大安區", itemKey("any", "total", 12))!.n, 11);
  assert.equal(get("A|大安區", itemKey("high-rise", "total", 12))!.n, 11);
  assert.equal(get("F|板橋區", itemKey("mid-rise", "total", 12))!.n, 6);
  assert.equal(get(NATIONAL_AREA, itemKey("any", "total", 12))!.n, 17);
  assert.match(h.note ?? "", /^\[releases 1:2026-09\] 2 MOI releases \(current, 115S3\)/);
  assert.match(h.note ?? "", /newest deal 2026-09-18/);
  assert.match(h.note ?? "", /special relationship 1/);
  assert.match(h.note ?? "", /presale or separate registration 1/);
  assert.match(h.note ?? "", /duplicate record 1/);
  assert.ok(h.rows.every((r) => r.n >= 5));
});

test("harvest: nothing new in the register since the stored day means no download", async () => {
  const first = await twHomeSalesHarvest(fakeDeps().deps);
  const { deps, calls } = fakeDeps({ stored: () => ({ note: first.note ?? null, date: first.date, rows: first.rows }) });
  const again = await twHomeSalesHarvest(deps);
  assert.equal(calls.length, 0);
  assert.equal(again.date, first.date);
  assert.deepEqual(again.rows, first.rows);
  // a new month in the register, or new filter logic, is read afresh
  const staleMonth = fakeDeps({ stored: () => ({ note: `[releases ${LOGIC_VERSION}:2026-08] old`, date: "2026-07-31", rows: first.rows }) });
  assert.equal((await twHomeSalesHarvest(staleMonth.deps)).date, "2026-08-31");
  assert.equal(staleMonth.calls.length, 2);
  const oldLogic = fakeDeps({ stored: () => ({ note: `[releases 0:2026-09] old`, date: "2026-08-31", rows: first.rows }) });
  await twHomeSalesHarvest(oldLogic.deps);
  assert.equal(oldLogic.calls.length, 2);
});

test("harvest: a release that cannot be downloaded fails the whole run (never a half-filled window)", async () => {
  await assert.rejects(twHomeSalesHarvest(fakeDeps({ failOn: "115S3" }).deps), /Could not download/);
  const empty: HarvestDeps = { ...fakeDeps().deps, fetchReleases: async () => [release("101S1", "season", "2011-11-01", "2012-01-31")] };
  await assert.rejects(twHomeSalesHarvest(empty), /No MOI releases/);
  const noFiles: HarvestDeps = { ...fakeDeps().deps, download: async () => makeZip({ "readme.txt": "x" }) };
  await assert.rejects(twHomeSalesHarvest(noFiles), /no sales files/);
});

// ---------- answers ----------

async function snapshot() {
  const h = await twHomeSalesHarvest(fakeDeps().deps);
  return snapshotFromRows(h.date, h.rows);
}

test("answer: median and range in TWD, count, period, source and licence; price per m² and per ping", async () => {
  const snap = await snapshot();
  const a = await twHomeSales({ town: "Da'an, Taipei" }, { snapshot: snap, now: new Date(`${TODAY}T10:00:00Z`) });
  assert.equal(a.status, "ok");
  assert.equal(a.price_type, "transaction");
  assert.equal(a.price?.currency, "TWD");
  assert.equal(a.price?.unit, "per home");
  assert.equal(a.price?.measure, "median");
  assert.equal(a.sample_size, 11);
  assert.ok(a.price!.typical_low! <= a.price!.median! && a.price!.median! <= a.price!.typical_high!);
  assert.deepEqual(a.period, { from: "2025-09-01", to: "2026-08-31" });
  assert.equal(a.confidence, "low");
  assert.match(a.summary, /Residential market sales \(presales excluded\) of homes \(apartments and houses\) in Da'an District, Taipei City \(大安區, 臺北市\) over the last 12 months had a median registered price of NT\$3\d,\d{3},\d{3}/);
  assert.match(a.summary, /per ping/);
  assert.match(a.summary, /Ministry of the Interior/);
  assert.equal(a.source.id, "tw-home-sales");
  assert.equal(a.source.licence_url, "https://data.gov.tw/license");
  assert.match(a.source.attribution, /Ministry of the Interior/);
  const ex = a.extra as any;
  assert.equal(ex.window_months, 12);
  assert.equal(ex.price_per_m2.unit, "per m² of registered building area (parking excluded)");
  assert.equal(ex.price_per_ping.median, Math.round(ex.price_per_m2.median * 3.3058));
  assert.equal(ex.place.level, "district");
  assert.equal(ex.city_comparison.place, "Taipei City (臺北市)"); // here the city has the same 11 sales
  assert.equal(ex.city_comparison.this_place_vs_it_percent, 0);
  assert.equal(ex.taiwan_comparison.place, "Taiwan");
  assert.equal(ex.data_age_note, undefined);
});

test("answer: city, county, Chinese names, all of Taiwan, property types and months", async () => {
  const snap = await snapshot();
  const taipei = await twHomeSales({ town: "台北市" }, { snapshot: snap });
  assert.equal(taipei.status, "ok");
  assert.equal(taipei.sample_size, 11);
  assert.equal((taipei.extra as any).place.level, "city or county");
  const all = await twHomeSales({}, { snapshot: snap });
  assert.equal(all.sample_size, 17);
  assert.equal((all.extra as any).place.level, "country");
  const hi = await twHomeSales({ town: "臺北市大安區", property_type: "high-rise" }, { snapshot: snap });
  assert.equal(hi.sample_size, 11);
  assert.match(hi.summary, /high-rise apartments \(住宅大樓/);
  const apt = await twHomeSales({ town: "New Taipei", property_type: "flat" }, { snapshot: snap });
  assert.equal(apt.sample_size, 6);
  const dist = await twHomeSales({ town: "Banqiao" }, { snapshot: snap });
  assert.equal(dist.sample_size, 6);
  assert.equal((dist.extra as any).city_comparison.place, "New Taipei City (新北市)");
  // months over 18 asks for the 24 month window
  const m24 = await twHomeSales({ town: "Taipei", months: 24 }, { snapshot: snap });
  assert.equal((m24.extra as any).window_months, 24);
  assert.deepEqual(m24.period, { from: "2024-09-01", to: "2026-08-31" });
});

test("answer: fewer than 5 sales gives no figure and says so; unknown, ambiguous and unsupported requests are refused plainly", async () => {
  const snap = await snapshot();
  const thin = await twHomeSales({ town: "Taipei", property_type: "house" }, { snapshot: snap });
  assert.equal(thin.status, "no_matches");
  assert.equal(thin.price, null);
  assert.match(thin.summary, /Fewer than 5 qualifying sales of houses/);
  await assert.rejects(twHomeSales({ town: "Atlantis" }, { snapshot: snap }), /Unknown place 'Atlantis'/);
  await assert.rejects(twHomeSales({ town: "Da'an" }, { snapshot: snap }), /names several places in Taiwan: .*Taipei.*Taichung/);
  await assert.rejects(twHomeSales({ town: "Hsinchu" }, { snapshot: snap }), /Hsinchu City.*Hsinchu County|Hsinchu County.*Hsinchu City/);
  await assert.rejects(twHomeSales({ town: "Taipei, Nowhere" }, { snapshot: snap }), /No district called 'nowhere' in Taipei City.*Da'an/);
  await assert.rejects(twHomeSales({ town: "Taipei", property_type: "castle" }, { snapshot: snap }), /property_type must be one of/);
  await assert.rejects(twHomeSales({ postcode: "106" }, { snapshot: snap }), /no postcodes/);
  assert.deepEqual([...TW_TYPES], ["any", "apartment", "house", "high-rise", "mid-rise", "walk-up"]);
  assert.equal(normaliseType("Condo"), "apartment");
  assert.equal(normaliseType("透天厝"), "house");
  assert.equal(normaliseType(undefined), "any");
});

test("answer: a copy of the register that is far behind is flagged plainly", async () => {
  const snap = await snapshot();
  const late = await twHomeSales({ town: "Taipei" }, { snapshot: snap, now: new Date("2027-03-01T00:00:00Z") });
  assert.equal(late.status, "ok");
  assert.match(String((late.extra as any).data_age_note), /ended 2026-08-31, 182 days ago/);
  assert.match(late.summary, /Note: The newest month in this range ended 2026-08-31, 182 days ago/);
});

test("answer from the stored library: harvest, store, read back; empty library says it is not yet available", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "tw-sales-lib-"));
  const previous = process.env.PROOFPRICE_LIBRARY_DIR;
  process.env.PROOFPRICE_LIBRARY_DIR = dir;
  try {
    await assert.rejects(twHomeSales({ town: "Taipei" }), /Not yet available/);
    const h = await twHomeSalesHarvest(fakeDeps().deps);
    writeDaily(INFO.id, h);
    writeMeta(INFO.id, { source: INFO.id, currency: "TWD", unit: "per home", first_date: h.date, last_date: h.date, days: 1, last_harvest_at: "t1", last_rows: h.rows.length, last_ok_at: "t1", last_error: null, note: h.note });
    const a = await twHomeSales({ town: "Da'an, Taipei" });
    assert.equal(a.status, "ok");
    assert.equal(a.sample_size, 11);
  } finally {
    if (previous === undefined) delete process.env.PROOFPRICE_LIBRARY_DIR;
    else process.env.PROOFPRICE_LIBRARY_DIR = previous;
  }
});

// ---------- the licence ----------

test("licence: the Open Government Data License v1.0 is quoted with its URL and its attribution obligation", () => {
  assert.equal(INFO.licence_url, "https://data.gov.tw/license");
  assert.match(INFO.licence, /Open Government Data License, version 1\.0/);
  assert.match(INFO.licence, /non-exclusive, irrevocable, royalty-free copyright license/);
  assert.match(INFO.licence, /explicit notice of statement as attribution/);
  assert.match(INFO.licence, /compatible with the Creative Commons Attribution License 4\.0 International/);
  assert.match(INFO.attribution, /Ministry of the Interior/);
  assert.match(INFO.attribution, /https:\/\/data\.gov\.tw\/license/);
  assert.equal(INFO.price_type, "transaction");
  assert.equal(INFO.id, "tw-home-sales");
});

test("history key: the 12-month total-price row the collector stores for the place and type; monthly history is refused", async () => {
  const snap = await snapshot();
  const k = twHistoryKey({ town: "Da'an, Taipei" }, {}, { snapshot: snap })!;
  assert.equal(k.item, itemKey("any", "total", 12));
  assert.ok(snap.rows.has(`${k.area}\u0000${k.item}`), "the key must match a stored row");
  assert.equal(twHistoryKey({}, {}, { snapshot: snap })!.area, NATIONAL_AREA);
  assert.equal(twHistoryKey({ town: "Taipei", property_type: "apartment" }, {}, { snapshot: snap })!.item, itemKey("apartment", "total", 12));
  // monthly history: city / county / Taiwan and three types only, not districts
  const m = twHistoryKey({ town: "Taipei", property_type: "apartment" }, { monthly: true }, { snapshot: snap })!;
  assert.deepEqual([m.area, m.item], ["A", "apartment/month"]);
  assert.equal(twHistoryKey({}, { monthly: true }, { snapshot: snap })!.area, NATIONAL_AREA);
  assert.throws(() => twHistoryKey({ town: "Da'an, Taipei" }, { monthly: true }, { snapshot: snap }), /not districts/);
  assert.throws(() => twHistoryKey({ town: "Taipei", property_type: "high-rise" }, { monthly: true }, { snapshot: snap }), /any, apartment or house/);
  assert.equal(twHistoryKey({ town: "Taipei" }, {}, { snapshot: null }), null);
});

// ---------- backfill (monthly history) ----------

test("backfill (fake portal): seasons then the newer 10-day file, deals counted once, monthly city and Taiwan rows, thin groups dropped, newest month left out", async () => {
  const mkRows = (n: number, date: string, tag: string, o: Partial<Fake> = {}): Fake[] =>
    Array.from({ length: n }, (_, i) => ({ district: "大安區", date, total: 20_000_000 + i * 1_000_000, serial: `${tag}-${i}`, ...o }));
  const zipOf = (rows: Fake[]) => makeZip({ "a_lvr_land_a.csv": csvOf(rows), "a_lvr_land_a_build.csv": "must not be read" }, true);
  const zips: Record<string, Buffer> = {
    "101S3": zipOf([...mkRows(7, "1010815", "a"), ...mkRows(4, "1010820", "b")]), // Aug 2012: 7 sales; Aug 2012 second group has the same dates -> 11 total
    "115S3": zipOf([...mkRows(6, "1150615", "c"), ...mkRows(6, "1150715", "d", { district: "中山區", type: "華廈(10層含以下有電梯)" }), mkRows(1, "1150615", "c")[0]]), // duplicate of c-0
    "20260921": zipOf(mkRows(5, "1150915", "e")),
  };
  const calls: string[] = [];
  const logs: string[] = [];
  const rel = (id: string, kind: Release["kind"], f: string, t: string): Release => ({ id, kind, url: `https://example.test/${id}.zip`, salesFrom: f, salesTo: t, ...ZERO });
  const deps = {
    fetchReleases: async () => [rel("20260921", "ten-day", "2026-09-11", "2026-09-20"), rel("115S3", "season", "2026-06-11", "2026-09-10"), rel("101S3", "season", "2012-06-11", "2012-09-10"), rel("20260801", "ten-day", "2026-07-21", "2026-07-31")],
    download: async (url: string) => {
      calls.push(url);
      return zips[url.split("/").pop()!.replace(".zip", "")];
    },
    now: () => new Date("2026-10-22T10:00:00Z"),
    log: (m: string) => logs.push(m),
  };
  const r = await twBackfill("2012-01-01", "2026-12-31", deps);
  assert.deepEqual(calls.map((c) => c.split("/").pop()), ["101S3.zip", "115S3.zip", "20260921.zip"], "seasons oldest first, only the 10-day file after the last season");
  assert.equal(r.currency, "TWD");
  assert.equal(r.unit, "per home");
  const months = r.periods.map((p) => p.period);
  assert.deepEqual(months, ["2012-08", "2026-06", "2026-07"], "2026-09 is within 30 days of the newest deal, and 5 sales in a month is fine but the month is too recent");
  const aug = r.periods[0].rows.find((x) => x.area === "ALL" && x.item === "any/month")!;
  assert.equal(aug.n, 11);
  const jun = r.periods[1].rows;
  assert.equal(jun.find((x) => x.area === "A" && x.item === "any/month")!.n, 6, "the duplicate record counts once");
  assert.ok(jun.every((x) => x.n >= 5));
  const jul = r.periods[2].rows;
  assert.ok(jul.find((x) => x.area === "A" && x.item === "apartment/month"), "mid-rise counts as apartment");
  assert.ok(!jul.find((x) => x.item === "house/month"));
  // aggregates only: no row carries anything but a short area code and a short item
  for (const p of r.periods) for (const x of p.rows) assert.match(`${x.area} ${x.item}`, /^([A-Z]|ALL) (any|apartment|house)\/month$/);
  // range respected
  const narrow = await twBackfill("2026-06-01", "2026-06-30", { ...deps, download: async (u: string) => zips[u.split("/").pop()!.replace(".zip", "")] });
  assert.deepEqual(narrow.periods.map((p) => p.period), ["2026-06"]);
});

test("backfill: a quarter that cannot be downloaded stops the run instead of leaving a hole", async () => {
  const rel = (id: string): Release => ({ id, kind: "season", url: `https://example.test/${id}.zip`, salesFrom: "2012-06-11", salesTo: "2012-09-10", ...ZERO });
  await assert.rejects(
    twBackfill("2012-01-01", "2012-12-31", { fetchReleases: async () => [rel("101S3")], download: async () => { throw new Error("HTTP 500"); }, now: () => new Date("2026-10-22T00:00:00Z"), log: () => {} }),
    /HTTP 500/,
  );
});

test("backfill: the portal's placeholder zips for the earliest quarters (manifest only, 367 bytes on 22 Oct 2026) are skipped; a big zip with no sales files still stops the run", async () => {
  const stub = makeZip({ "manifest.csv": "name,schema,description\n", "build.ttt": "x".repeat(118) }, true);
  assert.ok(stub.length < 2000);
  const rel = (id: string, f: string, t: string): Release => ({ id, kind: "season", url: `https://example.test/${id}.zip`, salesFrom: f, salesTo: t, ...ZERO });
  const rows: Fake[] = Array.from({ length: 6 }, (_, i) => ({ district: "大安區", date: "1010815", total: 20_000_000 + i * 1_000_000, serial: `s-${i}` }));
  rows.push({ district: "大安區", date: "1011215", total: 25_000_000, serial: "late" }); // a later deal so that August is not a "too recent" month
  const good = makeZip({ "a_lvr_land_a.csv": csvOf(rows) }, true);
  const logs: string[] = [];
  const zips: Record<string, Buffer> = { "101S1": stub, "101S3": good };
  const deps = {
    fetchReleases: async () => [rel("101S1", "2011-11-01", "2012-01-31"), rel("101S3", "2012-06-11", "2012-09-10")],
    download: async (u: string) => zips[u.split("/").pop()!.replace(".zip", "")],
    now: () => new Date("2026-10-22T00:00:00Z"),
    log: (m: string) => logs.push(m),
  };
  const r = await twBackfill("2012-01-01", "2012-12-31", deps);
  assert.deepEqual(r.periods.map((p) => p.period), ["2012-08"]);
  assert.ok(logs.some((l) => l.startsWith("skip 101S1: placeholder")));
  const bigNoSales = makeZip({ "manifest.csv": "x".repeat(5000) }, false);
  assert.ok(bigNoSales.length >= 2000);
  await assert.rejects(twBackfill("2012-01-01", "2012-12-31", { ...deps, download: async () => bigNoSales }), /holds no sales files/);
});
