// Tests for Indonesia PIHPS (Bank Indonesia) daily staple-food prices.
// Fixture: rows copied from the real responses fetched through the GitHub probe on 2026-10-29
// (GetGridDataDaerah, national, 27-28/10/2026 and 27-28/10/2025; GetRefProvince). The week-earlier column is illustrative, in the same layout.
import { test } from "node:test";
import assert from "node:assert/strict";
import { matchItem } from "../../categories/groceries/items";
import { INFO, ITEMS, PROVINCES, biFromIso, changeOver, gridUrl, idAnswer, idBiPihps, isoFromBi, jakartaToday, matchProvince, parseGrid, parseRupiah, readGrids } from "./source";
import manifest from "./index";

const NOW = {
  data: [
    { no: "I", name: "Beras", level: 1, "21/10/2026": "16,300", "27/10/2026": "16,450", "28/10/2026": "16,500" },
    { no: 1, name: "Beras Kualitas Medium I", level: 2, "27/10/2026": "16,650", "28/10/2026": "16,650" },
    { no: "IV", name: "Telur Ayam", level: 1, "27/10/2026": "25,700", "28/10/2026": "25,700" },
    { no: "VII", name: "Cabai Merah", level: 1, "27/10/2026": "69,850", "28/10/2026": "67,450" },
    { no: 2, name: "Cabai Merah Keriting ", level: 2, "27/10/2026": "70,700", "28/10/2026": "67,600" },
    { no: "IX", name: "Minyak Goreng", level: 1, "27/10/2026": "-", "28/10/2026": "" },
  ],
};
const YEAR = {
  data: [
    { no: "I", name: "Beras", level: 1, "27/10/2025": "15,800", "28/10/2025": "15,800" },
    { no: "IV", name: "Telur Ayam", level: 1, "27/10/2025": "31,550", "28/10/2025": "31,500" },
  ],
};
const TODAY = new Date("2026-10-29T05:00:00Z"); // 12:00 in Jakarta; yesterday = 2026-10-28

function getter(calls: string[] = []): (url: string) => Promise<unknown> {
  return async (url) => {
    calls.push(url);
    return new URL(url).searchParams.get("start_date")!.startsWith("2025") ? YEAR : NOW;
  };
}

test("dates, rupiah and the Jakarta day", () => {
  assert.equal(isoFromBi("28/10/2026"), "2026-10-28");
  assert.equal(isoFromBi("garbage"), null);
  assert.equal(biFromIso("2026-10-28"), "2026-10-28");
  assert.equal(parseRupiah("16,450"), 16450);
  assert.equal(parseRupiah("-"), null);
  assert.equal(parseRupiah(""), null);
  assert.equal(jakartaToday(new Date("2026-10-28T20:00:00Z")), "2026-10-29");
  assert.match(gridUrl("2026-10-19", "2026-10-28", 13), /province_id=13&.*start_date=2026-10-19&end_date=2026-10-28$/);
  assert.match(gridUrl("2026-10-19", "2026-10-28"), /province_id=&/);
});

test("parseGrid reads the real layout and skips empty or dash cells", () => {
  const g = parseGrid(NOW);
  assert.equal(g.get("beras")?.days.get("2026-10-28"), 16500);
  assert.equal(g.get("cabai merah keriting")?.name, "Cabai Merah Keriting"); // BI's trailing space is trimmed
  assert.equal(g.get("minyak goreng")?.days.size, 0);
  assert.throws(() => parseGrid({ nope: 1 }), /unexpected shape/);
});

test("items: every word resolves, codes are unique, plain words default to the food, not a variety", () => {
  assert.equal(new Set(ITEMS.map((i) => i.code.toLowerCase())).size, ITEMS.length);
  assert.equal(matchItem(ITEMS, "rice").primary?.code, "Beras");
  assert.equal(matchItem(ITEMS, "eggs").primary?.code, "Telur Ayam");
  assert.equal(matchItem(ITEMS, "cabai").primary?.code, "Cabai Merah");
  assert.equal(matchItem(ITEMS, "curly chilli").primary?.code, "Cabai Merah Keriting");
  assert.equal(matchItem(ITEMS, "premium sugar").primary?.code, "Gula Pasir Kualitas Premium");
  assert.equal(matchItem(ITEMS, "petrol").primary, null);
});

test("provinces: names, aliases, unknowns", () => {
  assert.equal(PROVINCES.length, 34);
  assert.equal(matchProvince("jakarta")?.id, 13);
  assert.equal(matchProvince("West Java")?.id, 12);
  assert.equal(matchProvince("Jawa Barat")?.name, "Jawa Barat");
  assert.equal(matchProvince("Atlantis"), null);
});

test("changeOver", () => {
  assert.deepEqual(changeOver(100, "2026-10-21", 110), { from_date: "2026-10-21", from_value: 100, change_percent: 10, change_amount: 10 });
  assert.equal(changeOver(undefined, "x", 5), null);
});

test("answer: rice nationally, newest full day with week and year changes", async () => {
  const calls: string[] = [];
  const a = await idBiPihps({ item: "rice", today: TODAY }, { getter: getter(calls) });
  assert.equal(a.status, "ok");
  assert.equal(a.price?.value, 16500);
  assert.equal(a.price?.currency, "IDR");
  assert.equal(a.price?.unit, "per kg");
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.sample_size, null);
  assert.deepEqual(a.period, { from: "2026-10-28", to: "2026-10-28" });
  assert.equal((a.extra as any).change_on_week_earlier.value, 16300); // 2026-10-21 is in the fixture
  assert.equal((a.extra as any).change_on_year_earlier.value, 15800);
  assert.equal((a.extra as any).change_on_year_earlier.change_percent, 4.4);
  assert.match(a.summary, /Indonesia the average market price/);
  assert.match(a.summary, /not receipts/);
  assert.equal(calls.length, 2);
  assert.match(calls[0], /end_date=2026-10-28/); // yesterday in Jakarta, never the partial current day
  assert.match(calls[1], /start_date=2025-/);
});

test("answer: a week-earlier change when that day exists", () => {
  const rows = parseGrid({ data: [{ name: "Beras", "21/10/2026": "16,300", "28/10/2026": "16,500" }] });
  const a = idAnswer({ current: rows, yearAgo: null, provinceName: null }, ITEMS[0], [], { item: "rice", today: TODAY });
  assert.equal((a.extra as any).change_on_week_earlier.change_percent, 1.2);
  assert.equal((a.extra as any).change_on_year_earlier, null);
  assert.match(a.summary, /higher than on 2026-10-21/);
});

test("answer: a province is passed to the feed and named", async () => {
  const calls: string[] = [];
  const a = await idBiPihps({ item: "eggs", region: "West Java", today: TODAY }, { getter: getter(calls) });
  assert.equal(a.status, "ok");
  assert.match(a.summary, /In Jawa Barat/);
  assert.match(calls[0], /province_id=12&/);
});

test("answer: national words keep the national feed", async () => {
  const calls: string[] = [];
  await idBiPihps({ item: "rice", region: "Indonesia", today: TODAY }, { getter: getter(calls) });
  assert.match(calls[0], /province_id=&/);
});

test("an unknown province is a 400 that lists the valid ones; a blank item is a 400", async () => {
  await assert.rejects(idBiPihps({ item: "rice", region: "Atlantis", today: TODAY }, { getter: getter() }), /not an Indonesian province/);
  await assert.rejects(idBiPihps({ item: "  ", today: TODAY }, { getter: getter() }), /item is required/);
});

test("a food with no recent price and an item PIHPS does not hold both say so", async () => {
  const none = await idBiPihps({ item: "cooking oil", today: TODAY }, { getter: getter() });
  assert.equal(none.status, "no_matches");
  assert.equal(none.price, null);
  assert.match(none.summary, /holds no price/);
  const nope = await idBiPihps({ item: "petrol", today: TODAY }, { getter: getter() });
  assert.equal(nope.status, "no_matches");
  assert.match(nope.summary, /covers rice, chicken/);
});

test("a stale series is flagged as old data", () => {
  const rows = parseGrid({ data: [{ name: "Beras", "01/10/2026": "16,000" }] });
  const a = idAnswer({ current: rows, yearAgo: null, provinceName: null }, ITEMS[0], [], { item: "rice", today: TODAY });
  assert.match(a.statistic?.note ?? "", /Old data/);
});

test("readGrids tolerates a failing year-ago call", async () => {
  const g = await readGrids(TODAY, undefined, { getter: async (u) => { if (u.includes("start_date=2025")) throw new Error("down"); return NOW; } });
  assert.equal(g.yearAgo, null);
});

test("INFO and manifest are consistent and free-tier only", () => {
  assert.equal(INFO.id, "id-bi-pihps");
  assert.equal(manifest.info.id, INFO.id);
  assert.deepEqual(manifest.countries, ["ID"]);
  assert.equal(manifest.category, "groceries");
  assert.match(INFO.licence, /free of charge only/);
});
