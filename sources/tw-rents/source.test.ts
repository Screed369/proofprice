// Real format, checked live on 2026-10-14 from GitHub's servers:
//  - fixtures/a_lvr_land_c.csv: the real header rows (Chinese names, then English names) and 24 real rows copied from the rentals file of
//    Taipei (a_lvr_land_c.csv) with the address replaced: whole homes, studios, rooms, social-housing lettings, a shop, an office.
// The release lists and the zip layout are shared with tw-home-sales (see its tests). The larger data sets in these tests are
// SYNTHETIC, in the same layout (the real header with made-up rows).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { makeZip } from "../../tests/helpers/make-zip";
import { writeDaily, writeMeta } from "../../lib/library/store";
import { parseTable, type Release } from "../tw-home-sales/moi";
import { NATIONAL_AREA, newStats, snapshotFromRows, INFO as SALES_INFO, type HarvestDeps } from "../tw-home-sales/source";
import {
  INFO, LOGIC_VERSION, RENT_TYPES, buildingOf, kindOf, normaliseRentType, parseRentals, rentItemKey, rentRows, twRents, twRentsHarvest, typesOf, type Rental,
} from "./source";

const CSV = readFileSync(new URL("./fixtures/a_lvr_land_c.csv", import.meta.url), "utf8");
const TODAY = "2026-10-14";

test("real rows: market lettings of homes only, and every other row says why not", () => {
  const stats = newStats();
  const t = parseTable(CSV);
  assert.equal(t.header.length, 35);
  assert.equal(t.rows.length, 24);
  const rentals = parseRentals(t, "A", { stats, today: TODAY });
  assert.equal(rentals.length, 7);
  assert.deepEqual(stats.dropped, {
    "social housing programme": 9, // 社會住宅代管, 社會住宅包租轉租
    "not a home building type": 2, // a shop, an office building
    "main use not residential": 4, // commercial, office, 見使用執照
    "room on a joint contract": 2, // 分租 with 多人共同承租
  });
  // 獨立套房 in a mid-rise: a studio, 21,000 a month, 458 per m²
  assert.deepEqual(rentals[1], { city: "A", district: "南港區", date: "2026-08-21", kind: "studio", building: "apartment", bedrooms: 0, rent: 21000, unit: 458 });
  // 整棟(戶)出租, 3 bedrooms, with a parking space let with it (the rent is the total declared)
  assert.deepEqual(rentals[3], { city: "A", district: "北投區", date: "2026-08-22", kind: "whole", building: "apartment", bedrooms: 3, rent: 56000, unit: 319 });
  // 分租套房: a room in a shared home
  assert.equal(rentals[0].kind, "room");
  assert.equal(rentals[0].rent, 15500);
});

test("kinds and buildings", () => {
  assert.equal(kindOf("整棟(戶)出租", 3), "whole");
  assert.equal(kindOf("獨立套房", 1), "studio");
  assert.equal(kindOf("分租套房", 4), "room");
  assert.equal(kindOf("分租雅房", 4), "room");
  assert.equal(kindOf("分層出租", 2), "whole");
  assert.equal(kindOf("", 2), "whole"); // older records have no kind
  assert.equal(kindOf("", 0), "studio");
  assert.equal(buildingOf("住宅大樓(11層含以上有電梯)"), "apartment");
  assert.equal(buildingOf("華廈(10層含以下有電梯)"), "apartment");
  assert.equal(buildingOf("公寓(5樓含以下無電梯)"), "apartment");
  assert.equal(buildingOf("套房(1房1廳1衛)"), "apartment");
  assert.equal(buildingOf("透天厝"), "house");
  assert.equal(buildingOf("店面(店鋪)"), null);
  assert.equal(buildingOf("辦公商業大樓"), null);
  assert.deepEqual(typesOf({ kind: "room", building: "apartment" }), ["room"]);
  assert.deepEqual(typesOf({ kind: "whole", building: "house" }), ["any", "house"]);
  assert.deepEqual(typesOf({ kind: "studio", building: "apartment" }), ["any", "apartment"]);
});

const HEADER = parseTable(CSV).header;
const ENGLISH_LINE = CSV.split("\n")[1];
interface Fake {
  district: string;
  date: string; // ROC
  type?: string;
  use?: string;
  rooms?: number;
  rent: number;
  unit?: number;
  note?: string;
  serial: string;
  object?: string;
  kind?: string;
  service?: string;
  address?: string;
}
function fakeRow(f: Fake): string {
  const cells: Record<string, string> = {
    鄉鎮市區: f.district,
    交易標的: f.object ?? "租賃房屋",
    土地位置建物門牌: f.address ?? `某市${f.district}某路${f.serial}號`,
    租賃年月日: f.date,
    建物型態: f.type ?? "華廈(10層含以下有電梯)",
    主要用途: f.use ?? "住家用",
    建物總面積平方公尺: "60",
    "建物現況格局-房": String(f.rooms ?? 2),
    總額元: String(f.rent),
    單價元平方公尺: String(f.unit ?? Math.round(f.rent / 60)),
    備註: f.note ?? "",
    編號: f.serial,
    出租型態: f.kind ?? "整棟(戶)出租",
    租賃住宅服務: f.service ?? "",
  };
  return HEADER.map((h) => cells[h] ?? "").join(",");
}
const csvOf = (rows: Fake[]) => `﻿${HEADER.join(",")}\n${ENGLISH_LINE}\n${rows.map(fakeRow).join("\n")}\n`;
const one = (f: Partial<Fake>, opts: Parameters<typeof parseRentals>[2] = { today: TODAY }) =>
  parseRentals(parseTable(csvOf([{ district: "大安區", date: "1150801", rent: 30000, serial: "RC1", ...f }])), "A", opts);

test("market lettings only: social housing, relatives and joint contracts are left out", () => {
  assert.equal(one({}).length, 1);
  assert.equal(one({ service: "社會住宅代管" }).length, 0);
  assert.equal(one({ service: "社會住宅包租轉租" }).length, 0);
  for (const service of ["一般轉租", "一般代管", "一般包租", ""]) assert.equal(one({ service }).length, 1, service);
  assert.equal(one({ note: "親友、員工或其他特殊關係間之租賃；" }).length, 0);
  assert.equal(one({ kind: "分租套房", note: "多人共同承租3；" }).length, 0);
  assert.equal(one({ kind: "整棟(戶)出租", note: "多人共同承租3；" }).length, 1); // the contract is for the whole home
  for (const note of ["續租案件；", "租金總額含管理費；", "租金總額含網路費；", "租賃建物部分範圍，且未計入共有部分面積；", "含增建或未登記建物；"]) assert.equal(one({ note }).length, 1, note);
});

test("only homes: land, parking, shops, offices and mixed use are left out; the other words for a home count", () => {
  assert.equal(one({ object: "租賃土地" }).length, 0);
  assert.equal(one({ object: "租賃車位" }).length, 0);
  assert.equal(one({ object: "租賃房屋+車位" }).length, 1); // the rent includes the parking space
  assert.equal(one({ use: "商業用" }).length, 0);
  assert.equal(one({ use: "住商用" }).length, 0);
  assert.equal(one({ use: "辦公室" }).length, 0);
  assert.equal(one({ use: "見使用執照" }).length, 0);
  for (const use of ["住家用", "集合住宅", "住宅", "公寓", "國民住宅"]) assert.equal(one({ use }).length, 1, use);
  assert.equal(one({ type: "店面(店鋪)" }).length, 0);
  assert.equal(one({ type: "辦公商業大樓" }).length, 0);
  assert.equal(one({ type: "透天厝" })[0].building, "house");
});

test("rents and bedrooms: ROC dates, absurd rents, studios are 0 bedrooms, 5 means five or more", () => {
  assert.equal(one({ date: "1151231" }).length, 0); // after today
  assert.equal(one({ rent: 500 }).length, 0);
  assert.equal(one({ rent: 5_000_000 }).length, 0);
  assert.equal(one({ rooms: 0 })[0].bedrooms, 0);
  assert.equal(one({ rooms: 0 })[0].kind, "studio");
  assert.equal(one({ kind: "獨立套房", rooms: 1 })[0].bedrooms, 0);
  assert.equal(one({ rooms: 3 })[0].bedrooms, 3);
  assert.equal(one({ rooms: 9 })[0].bedrooms, 5);
  assert.equal(one({ rent: 25000 })[0].unit, Math.round(25000 / 60));
  assert.equal(one({ rent: 25000, unit: 0 })[0].unit, null);
  assert.throws(() => parseRentals(parseTable("鄉鎮市區,交易標的\nEnglish,x\n大安區,租賃房屋\n"), "A"), /new layout/);
});

test("the same tenancy in two releases counts once", () => {
  const seen = new Set<string>();
  const stats = newStats();
  const rows: Fake[] = [{ district: "大安區", date: "1150801", rent: 30000, serial: "RC1", address: "某市大安區同路1號" }];
  assert.equal(parseRentals(parseTable(csvOf(rows)), "A", { seen, stats, today: TODAY }).length, 1);
  assert.equal(parseRentals(parseTable(csvOf(rows)), "A", { seen, stats, today: TODAY }).length, 0);
  assert.equal(parseRentals(parseTable(csvOf([{ ...rows[0], serial: "RC2" }])), "A", { seen, stats, today: TODAY }).length, 0);
  assert.equal(stats.dropped["duplicate record"], 2);
});

// ---------- aggregation ----------

/** SYNTHETIC lettings in Da'an (Taipei): whole 2-bedroom flats, studios, houses and rooms. */
function synthetic(): Rental[] {
  const out: Rental[] = [];
  const base = { city: "A", district: "大安區" };
  for (let i = 0; i < 8; i++) out.push({ ...base, date: `2026-0${(i % 8) + 1}-15`, kind: "whole", building: "apartment", bedrooms: 2, rent: 30000 + i * 500, unit: 500 });
  for (let i = 0; i < 6; i++) out.push({ ...base, date: "2026-03-01", kind: "studio", building: "apartment", bedrooms: 0, rent: 15000 + i * 100, unit: null });
  for (let i = 0; i < 6; i++) out.push({ ...base, date: "2025-12-01", kind: "whole", building: "house", bedrooms: 3, rent: 50000 + i * 1000, unit: 400 });
  for (let i = 0; i < 5; i++) out.push({ ...base, date: "2026-02-02", kind: "room", building: "apartment", bedrooms: 4, rent: 9000 + i * 100, unit: 300 });
  for (let i = 0; i < 7; i++) out.push({ city: "F", district: "板橋區", date: "2025-01-10", kind: "whole", building: "apartment", bedrooms: 1, rent: 18000 + i * 100, unit: 300 }); // 24 month windows only
  out.push({ ...base, date: "2026-09-10", kind: "whole", building: "apartment", bedrooms: 2, rent: 99000, unit: 900 }); // after the anchor
  return out;
}

test("rows: windows, levels, kinds, bedrooms and measures; rooms are only rooms; fewer than 5 never published", () => {
  const rows = rentRows(synthetic(), "2026-08-31");
  const get = (area: string, item: string) => rows.find((r) => r.area === area && r.item === item);
  const D = "A|大安區";
  assert.equal(rentItemKey("any", "all", "rent", 12), "any:all:rent:12m");
  assert.equal(get(D, rentItemKey("any", "all", "rent", 12))!.n, 8 + 6 + 6); // rooms are not in 'any'
  assert.equal(get(D, rentItemKey("apartment", "all", "rent", 12))!.n, 14);
  assert.equal(get(D, rentItemKey("house", "all", "rent", 12))!.n, 6);
  assert.equal(get(D, rentItemKey("room", "all", "rent", 12))!.n, 5);
  assert.equal(get(D, rentItemKey("room", "4", "rent", 12)), undefined); // no bedroom counts for rooms
  assert.equal(get(D, rentItemKey("any", "2", "rent", 12))!.n, 8);
  assert.equal(get(D, rentItemKey("any", "0", "rent", 12))!.n, 6);
  assert.equal(get(D, rentItemKey("house", "3", "rent", 12))!.n, 6);
  assert.equal(get(D, rentItemKey("any", "1", "rent", 12)), undefined);
  assert.equal(get(D, rentItemKey("any", "all", "m2", 12))!.n, 14); // the studios have no unit rent
  assert.equal(get(D, rentItemKey("any", "2", "m2", 12)), undefined); // per m² only for all sizes
  assert.equal(get("A", rentItemKey("any", "all", "rent", 12))!.n, 20);
  assert.equal(get(NATIONAL_AREA, rentItemKey("any", "all", "rent", 12))!.n, 20);
  assert.equal(get(NATIONAL_AREA, rentItemKey("any", "all", "rent", 24))!.n, 27);
  assert.equal(get("F|板橋區", rentItemKey("any", "all", "rent", 12)), undefined);
  assert.equal(get("F|板橋區", rentItemKey("any", "1", "rent", 24))!.n, 7);
  const r = get(D, rentItemKey("any", "2", "rent", 12))!;
  assert.equal(r.max, 33500); // the 99,000 after the anchor is not in
  assert.ok(r.low <= r.median && r.median <= r.high);
  assert.ok(rows.every((x) => x.n >= 5));
});

// ---------- harvest ----------

function release(id: string, kind: Release["kind"], rentFrom: string, rentTo: string): Release {
  return { id, kind, url: `https://example.test/${id}.zip`, salesFrom: null, salesTo: null, rentFrom, rentTo };
}
function fakeDeps(o: { stored?: HarvestDeps["stored"]; failOn?: string } = {}) {
  const calls: string[] = [];
  const daan = (i: number, date: string, extra: Partial<Fake> = {}): Fake => ({ district: "大安區", date, rent: 30000 + i * 500, serial: `C${date}-${i}-${extra.kind ?? ""}${extra.rooms ?? ""}${extra.service ?? ""}`, ...extra });
  const newer: Fake[] = [daan(0, "1150820"), daan(1, "1150831"), daan(2, "1150715")]; // the newest contract is 2026-08-31
  const older: Fake[] = [
    ...Array.from({ length: 8 }, (_, i) => daan(i, "1150615")),
    ...Array.from({ length: 6 }, (_, i) => daan(i, "1150610", { kind: "獨立套房", rooms: 1, type: "住宅大樓(11層含以上有電梯)" })),
    ...Array.from({ length: 6 }, (_, i) => daan(i, "1150605", { type: "透天厝", rooms: 3, rent: 50000 + i * 1000 })),
    ...Array.from({ length: 5 }, (_, i) => daan(i, "1150602", { kind: "分租套房", rooms: 4, rent: 9000 + i * 100 })),
    ...Array.from({ length: 5 }, (_, i) => daan(i, "1150601", { service: "社會住宅代管", rent: 20000 })),
    daan(0, "1150820"), // the same tenancy as in the newer release
  ];
  const mk = (rows: Fake[]) =>
    makeZip({ "a_lvr_land_c.csv": csvOf(rows), "a_lvr_land_c_build.csv": "garbage that must not be read", "a_lvr_land_a.csv": "sales that must not be read" }, true);
  const zips: Record<string, Buffer> = { current: mk(newer), "115S3": mk(older) };
  const deps: HarvestDeps = {
    fetchReleases: async () => [release("current", "current", "2026-08-21", "2026-08-31"), release("115S3", "season", "2026-05-11", "2026-08-10"), release("101S1", "season", "2011-11-01", "2012-01-31")],
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

test("harvest end to end (fake portal): rentals files only, social housing out, tenancies counted once", async () => {
  const { deps, calls } = fakeDeps();
  const h = await twRentsHarvest(deps);
  assert.deepEqual(calls, ["https://example.test/current.zip", "https://example.test/115S3.zip"]);
  assert.equal(h.date, "2026-08-31");
  assert.equal(h.currency, "TWD");
  assert.equal(h.unit, "per month");
  const get = (area: string, item: string) => h.rows.find((r) => r.area === area && r.item === item);
  // whole 2-bedroom flats: 8 on 2026-06-15 + 3 in the newer release = 11 (the repeat of one of them in the older release is dropped)
  assert.equal(get("A|大安區", rentItemKey("any", "2", "rent", 12))!.n, 11);
  assert.equal(get("A|大安區", rentItemKey("any", "0", "rent", 12))!.n, 6);
  assert.equal(get("A|大安區", rentItemKey("house", "all", "rent", 12))!.n, 6);
  assert.equal(get("A|大安區", rentItemKey("room", "all", "rent", 12))!.n, 5);
  assert.equal(get("A|大安區", rentItemKey("any", "all", "rent", 12))!.n, 11 + 6 + 6);
  assert.match(h.note ?? "", /^\[releases 1:2026-08\] 2 MOI releases \(current, 115S3\)/);
  assert.match(h.note ?? "", /newest contract 2026-08-31/);
  assert.match(h.note ?? "", /social housing programme 5/);
  assert.match(h.note ?? "", /duplicate record 1/);
  assert.ok(h.rows.every((r) => r.n >= 5));
});

test("harvest: nothing new in the register means no download; a new month or new logic is read afresh; a failed download fails the run", async () => {
  const first = await twRentsHarvest(fakeDeps().deps);
  const same = fakeDeps({ stored: () => ({ note: first.note ?? null, date: first.date, rows: first.rows }) });
  const again = await twRentsHarvest(same.deps);
  assert.equal(same.calls.length, 0);
  assert.deepEqual(again.rows, first.rows);
  const month = fakeDeps({ stored: () => ({ note: `[releases ${LOGIC_VERSION}:2026-07] old`, date: "2026-06-30", rows: first.rows }) });
  assert.equal((await twRentsHarvest(month.deps)).date, "2026-08-31");
  assert.equal(month.calls.length, 2);
  await assert.rejects(twRentsHarvest(fakeDeps({ failOn: "115S3" }).deps), /Could not download/);
  const noFiles: HarvestDeps = { ...fakeDeps().deps, download: async () => makeZip({ "a_lvr_land_a.csv": "sales only" }) };
  await assert.rejects(twRentsHarvest(noFiles), /no rentals files/);
});

// ---------- answers ----------

async function snapshot() {
  const h = await twRentsHarvest(fakeDeps().deps);
  return snapshotFromRows(h.date, h.rows);
}
const NOW = new Date(`${TODAY}T10:00:00Z`);

test("answer: median monthly rent and range in TWD, count, period, source and licence; per m² and per ping", async () => {
  const snap = await snapshot();
  const a = await twRents({ town: "Da'an, Taipei" }, { snapshot: snap, now: NOW });
  assert.equal(a.status, "ok");
  assert.equal(a.price_type, "transaction");
  assert.equal(a.price?.currency, "TWD");
  assert.equal(a.price?.unit, "per month");
  assert.equal(a.price?.measure, "median");
  assert.equal(a.sample_size, 23);
  assert.ok(a.price!.typical_low! <= a.price!.median! && a.price!.median! <= a.price!.typical_high!);
  assert.deepEqual(a.period, { from: "2025-09-01", to: "2026-08-31" });
  assert.equal(a.confidence, "medium");
  assert.match(a.summary, /Tenancies of homes \(whole apartments, houses and self-contained studios\) declared in Da'an District, Taipei City \(大安區, 臺北市\) over the last 12 months had a median monthly rent of NT\$\d\d,\d{3}/);
  assert.match(a.summary, /per ping/);
  assert.equal(a.source.id, "tw-rents");
  assert.equal(a.source.licence_url, "https://data.gov.tw/license");
  assert.match(a.source.attribution, /Ministry of the Interior/);
  const ex = a.extra as any;
  assert.equal(ex.window_months, 12);
  assert.equal(ex.bedrooms, "all sizes");
  assert.equal(ex.rent_per_ping_per_month.median, Math.round(ex.rent_per_m2_per_month.median * 3.3058));
  assert.equal(ex.place.level, "district");
  assert.equal(ex.data_age_note, undefined);
});

test("answer: bedrooms, kinds, city and Taiwan, Chinese names, months", async () => {
  const snap = await snapshot();
  const two = await twRents({ town: "臺北市大安區", bedrooms: 2 }, { snapshot: snap });
  assert.equal(two.sample_size, 11);
  assert.match(two.summary, /2-bedroom homes/);
  assert.equal((two.extra as any).rent_per_m2_per_month, null); // per m² only for all sizes
  assert.equal((two.extra as any).bedrooms, 2);
  const studio = await twRents({ town: "Taipei", bedrooms: 0 }, { snapshot: snap });
  assert.equal(studio.sample_size, 6);
  assert.match(studio.summary, /studio and open-plan homes/);
  const room = await twRents({ town: "台北市", property_type: "room" }, { snapshot: snap });
  assert.equal(room.sample_size, 5);
  assert.match(room.summary, /rooms let separately in a shared home/);
  assert.equal((room.extra as any).bedrooms, null);
  const house = await twRents({ town: "Taipei", property_type: "house" }, { snapshot: snap });
  assert.equal(house.sample_size, 6);
  const apt = await twRents({ town: "Taipei", property_type: "flat" }, { snapshot: snap });
  assert.equal(apt.sample_size, 17);
  const all = await twRents({}, { snapshot: snap });
  assert.equal(all.sample_size, 23);
  assert.equal((all.extra as any).place.level, "country");
  const m24 = await twRents({ town: "Taipei", months: 24 }, { snapshot: snap });
  assert.equal((m24.extra as any).window_months, 24);
  assert.deepEqual(m24.period, { from: "2024-09-01", to: "2026-08-31" });
  const city = await twRents({ town: "Da'an, Taipei" }, { snapshot: snap });
  assert.equal((city.extra as any).city_comparison.place, "Taipei City (臺北市)");
});

test("answer: fewer than 5 tenancies gives no figure and says so; bad requests are refused plainly", async () => {
  const snap = await snapshot();
  const thin = await twRents({ town: "Taipei", bedrooms: 5 }, { snapshot: snap });
  assert.equal(thin.status, "no_matches");
  assert.equal(thin.price, null);
  assert.match(thin.summary, /Fewer than 5 qualifying tenancies of five-bedroom or larger homes/);
  await assert.rejects(twRents({ town: "Atlantis" }, { snapshot: snap }), /Unknown place 'Atlantis'/);
  await assert.rejects(twRents({ town: "Da'an" }, { snapshot: snap }), /names several places in Taiwan/);
  await assert.rejects(twRents({ town: "Taipei", property_type: "room", bedrooms: 2 }, { snapshot: snap }), /bedrooms does not apply to rooms/);
  await assert.rejects(twRents({ town: "Taipei", house_type: "terraced" }, { snapshot: snap }), /house_type .* not available for Taiwan/);
  await assert.rejects(twRents({ town: "Taipei", property_type: "castle" }, { snapshot: snap }), /property_type must be one of/);
  await assert.rejects(twRents({ postcode: "106" }, { snapshot: snap }), /no postcodes/);
  assert.deepEqual([...RENT_TYPES], ["any", "apartment", "house", "room"]);
  assert.equal(normaliseRentType("Flat"), "apartment");
  assert.equal(normaliseRentType("room only"), "room");
  assert.equal(normaliseRentType(undefined), "any");
});

test("answer: a copy of the register that is far behind is flagged plainly", async () => {
  const snap = await snapshot();
  const late = await twRents({ town: "Taipei" }, { snapshot: snap, now: new Date("2027-03-01T00:00:00Z") });
  assert.match(String((late.extra as any).data_age_note), /ended 2026-08-31, 182 days ago/);
  assert.match(late.summary, /Note: The newest month in this range ended 2026-08-31, 182 days ago/);
});

test("answer from the stored library; an empty library says it is not yet available", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "tw-rents-lib-"));
  const previous = process.env.PROOFPRICE_LIBRARY_DIR;
  process.env.PROOFPRICE_LIBRARY_DIR = dir;
  try {
    await assert.rejects(twRents({ town: "Taipei" }), /Not yet available/);
    const h = await twRentsHarvest(fakeDeps().deps);
    writeDaily(INFO.id, h);
    writeMeta(INFO.id, { source: INFO.id, currency: "TWD", unit: "per month", first_date: h.date, last_date: h.date, days: 1, last_harvest_at: "t1", last_rows: h.rows.length, last_ok_at: "t1", last_error: null, note: h.note });
    const a = await twRents({ town: "Da'an, Taipei", bedrooms: 2 });
    assert.equal(a.status, "ok");
    assert.equal(a.sample_size, 11);
  } finally {
    if (previous === undefined) delete process.env.PROOFPRICE_LIBRARY_DIR;
    else process.env.PROOFPRICE_LIBRARY_DIR = previous;
  }
});

test("licence and facts: same Ministry licence as the sales source, quoted with its URL", () => {
  assert.equal(INFO.id, "tw-rents");
  assert.equal(INFO.price_type, "transaction");
  assert.equal(INFO.licence, SALES_INFO.licence);
  assert.equal(INFO.licence_url, "https://data.gov.tw/license");
  assert.match(INFO.licence, /Open Government Data License, version 1\.0/);
  assert.match(INFO.attribution, /Ministry of the Interior/);
  assert.match(INFO.limits, /social-housing/);
});
