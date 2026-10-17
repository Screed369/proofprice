// Tests for the FAOSTAT producer prices source. The header and the shape of every row are copied from the live file
// (Prices_E_All_Data.csv, checked 2026-10-17 through the GitHub probe); the numbers in the US/BR/IN rows are small illustrative values in that format.
import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeDaily, readLatestDay } from "../../lib/library/store";
import manifest from "./index";
import { ALIASES, CSV_NAME, COUNTRIES, INFO, faoAnswer, faoHarvest, indexCountry, matchProduct, parseProducerPrices, splitCsvLine, toLibraryRows, unzip } from "./source";

process.env.PROOFPRICE_LIBRARY_DIR = mkdtempSync(path.join(tmpdir(), "pp-fao-"));

const YEARS = Array.from({ length: 35 }, (_, i) => 1991 + i);
const HEADER =
  `"Area Code","Area Code (M49)","Area","Item Code","Item Code (CPC)","Item","Element Code","Element","Months Code","Months","Unit",` +
  YEARS.map((y) => `"Y${y}","Y${y}F"`).join(",");

/** One data line as FAO writes it: quoted text, quoted numbers with six decimals and a flag, empty cells for no data. */
function line(m49: string, area: string, itemCode: string, item: string, el: string, elName: string, unit: string, byYear: Record<number, [number, string]>): string {
  const cells = YEARS.map((y) => (byYear[y] ? `"${byYear[y][0].toFixed(6)}","${byYear[y][1]}"` : ","));
  return [`"1"`, `"'${m49}"`, `"${area}"`, `"${itemCode}"`, `"'0111"`, `"${item.replace(/"/g, '""')}"`, `"${el}"`, `"${elName}"`, `"7021"`, `"Annual value"`, `"${unit}"`].join(",") + "," + cells.join(",");
}
const LCU = (m: string, a: string, c: string, i: string, s: Record<number, [number, string]>) => line(m, a, c, i, "5530", "Producer Price (LCU/tonne)", "LCU", s);
const USD = (m: string, a: string, c: string, i: string, s: Record<number, [number, string]>) => line(m, a, c, i, "5532", "Producer Price (USD/tonne)", "USD", s);

// 25 extra US products so the 2025 release passes the "at least 20 figures" rule
const FILLER = Array.from({ length: 25 }, (_, n) => LCU("840", "United States of America", String(900 + n), `Filler crop ${n}`, { 2024: [100 + n, "A"], 2025: [110 + n, "A"] }));
const CSV = [
  HEADER,
  // not an enabled country: must be ignored
  LCU("004", "Afghanistan", "221", "Almonds, in shell", { 2023: [213810, "A"], 2024: [240500, "A"] }),
  LCU("840", "United States of America", "15", "Wheat", { 2023: [270, "A"], 2024: [250, "A"], 2025: [230, "A"] }),
  USD("840", "United States of America", "15", "Wheat", { 2023: [270, "A"], 2024: [250, "A"], 2025: [230, "A"] }),
  LCU("840", "United States of America", "56", "Maize (corn)", { 2024: [190, "A"], 2025: [175, "A"] }),
  LCU("840", "United States of America", "1099", 'Sheep "dolly", fresh', { 2025: [4000, "A"] }),
  LCU("840", "United States of America", "1100", "Old crop", { 2019: [50, "A"] }),
  LCU("076", "Brazil", "236", "Soya beans", { 2024: [2400, "A"], 2025: [2200, "E"] }),
  USD("076", "Brazil", "236", "Soya beans", { 2024: [440, "A"], 2025: [400, "E"] }),
  LCU("392", "Japan", "27", "Rice", { 2024: [24000, "A"] }),
  // other element (the price index) must be ignored
  line("840", "United States of America", "15", "Wheat", "5539", "Producer Price Index (2014-2016 = 100)", "", { 2025: [99, "E"] }),
  ...FILLER,
].join("\n");

test("splitCsvLine keeps commas and doubled quotes inside quoted fields", () => {
  assert.deepEqual(splitCsvLine('"2","\'004","Almonds, in shell",,"x"'), ["2", "'004", "Almonds, in shell", "", "x"]);
  assert.deepEqual(splitCsvLine('"a ""b"" c","d"'), ['a "b" c', "d"]);
});

test("parse: newest figure per enabled country and item, with the previous year, dollars and the estimate flag", () => {
  const p = parseProducerPrices(CSV);
  assert.equal(p.year, 2025);
  const get = (iso: string, item: string) => p.figures.find((f) => f.iso === iso && f.item === item);
  assert.deepEqual(get("US", "Wheat"), { iso: "US", item: "Wheat", year: 2025, lcu: 230, usd: 230, prev: 250, estimated: false });
  assert.equal(get("US", "Maize (corn)")!.prev, 190);
  assert.equal(get("BR", "Soya beans")!.estimated, true);
  assert.equal(get("BR", "Soya beans")!.usd, 400);
  assert.equal(get("JP", "Rice")!.year, 2024, "Japan's newest figure is 2024: within two years of 2025, so kept");
  assert.equal(get("US", "Old crop"), undefined, "a figure older than two years before the release is dropped");
  assert.equal(p.figures.some((f) => f.iso === "AF" || f.item.startsWith("Almonds")), false);
  assert.equal(get("US", 'Sheep "dolly", fresh')!.lcu, 4000);
});

test("parse: a changed layout gives a diagnosis, not a silent empty answer", () => {
  assert.throws(() => parseProducerPrices('"Foo","Bar"\n"1","2"'), /layout this source does not know/);
  assert.throws(() => parseProducerPrices(HEADER + "\n"), /No usable FAOSTAT/);
});

test("library rows: price, year, dollars, previous year and the estimate marker; all with the placeholder count", () => {
  const rows = toLibraryRows(parseProducerPrices(CSV).figures);
  const br = rows.filter((r) => r.area === "BR");
  assert.deepEqual(br.map((r) => r.item).sort(), ["Soya beans", "Soya beans@est", "Soya beans@prev", "Soya beans@usd", "Soya beans@year"]);
  assert.ok(rows.every((r) => r.n >= 5 && r.median > 0));
  assert.equal(rows.find((r) => r.area === "BR" && r.item === "Soya beans@year")!.median, 2025);
});

test("match: everyday words find the FAO item names", () => {
  const items = ["Wheat", "Wheat flour", "Maize (corn)", "Meat of cattle with the bone, fresh or chilled", "Raw milk of cattle", "Hen eggs in shell, fresh", "Soya beans", "Tomatoes", "Rice"];
  assert.equal(matchProduct(items, "wheat").primary, "Wheat");
  assert.equal(matchProduct(items, "corn").primary, "Maize (corn)");
  assert.equal(matchProduct(items, "beef").primary, "Meat of cattle with the bone, fresh or chilled");
  assert.equal(matchProduct(items, "milk").primary, "Raw milk of cattle");
  assert.equal(matchProduct(items, "eggs").primary, "Hen eggs in shell, fresh");
  assert.equal(matchProduct(items, "soybeans").primary, "Soya beans");
  assert.equal(matchProduct(items, "tomato").primary, "Tomatoes");
  assert.equal(matchProduct(items, "unobtainium").primary, null);
  assert.ok(Object.keys(ALIASES).length > 10);
});

test("answer: an official statistic in local currency per tonne, with dollars, per-kg, change and source", () => {
  const rows = toLibraryRows(parseProducerPrices(CSV).figures).map((r) => ({ ...r }));
  const a = faoAnswer({ date: "2025-12-31", rows }, { country: "us", product: "wheat" }, 2026);
  assert.equal(a.status, "ok");
  assert.equal(a.price!.value, 230);
  assert.equal(a.price!.currency, "USD");
  assert.equal(a.price!.unit, "per tonne");
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.sample_size, null);
  assert.equal(a.price!.typical_low, null);
  assert.equal(a.statistic!.reference_period, "2025");
  assert.equal(a.extra!.price_per_kg, 0.23);
  assert.equal(a.extra!.change_on_previous_year_pct, -8);
  assert.match(a.summary, /Farmers in the United States received about 230 USD per tonne/);
  assert.match(a.summary, /down 8% on 2024/);
  assert.equal(a.source.licence.includes("CC BY 4.0"), true);
  const br = faoAnswer({ date: "2025-12-31", rows }, { country: "BR", product: "soybeans" }, 2026);
  assert.equal(br.price!.currency, "BRL");
  assert.equal(br.extra!.usd_per_tonne, 400);
  assert.match(br.statistic!.note ?? "", /estimated/);
});

test("answer: unknown product lists what is available; unknown country and missing product are input errors", () => {
  const rows = toLibraryRows(parseProducerPrices(CSV).figures);
  const none = faoAnswer({ date: "2025-12-31", rows }, { country: "US", product: "unobtainium" });
  assert.equal(none.status, "no_matches");
  assert.ok((none.extra!.products_available as string[]).includes("Wheat"));
  assert.throws(() => faoAnswer({ date: "2025-12-31", rows }, { country: "FR", product: "wheat" }), /country must be one of/);
  assert.throws(() => faoAnswer({ date: "2025-12-31", rows }, { country: "US" }), /product is required/);
  const old = faoAnswer({ date: "2025-12-31", rows }, { country: "JP", product: "rice" }, 2030);
  assert.match(old.statistic!.note ?? "", /Old data/);
});

test("harvest: reads the zip, finds the CSV and returns the newest reference year", async () => {
  const csv = Buffer.from(CSV, "utf8");
  const name = Buffer.from(CSV_NAME);
  const comp = deflateRawSync(csv);
  // a minimal zip with one deflated entry
  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(csv.length, 22); lh.writeUInt16LE(name.length, 26);
  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(8, 10); cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(csv.length, 24); cd.writeUInt16LE(name.length, 28); cd.writeUInt32LE(0, 42);
  const cdOffset = lh.length + name.length + comp.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10); eocd.writeUInt32LE(cd.length + name.length, 12); eocd.writeUInt32LE(cdOffset, 16);
  const zip = Buffer.concat([lh, name, comp, cd, name, eocd]);
  assert.equal(unzip(zip, (n) => n === CSV_NAME).get(CSV_NAME)!.toString("utf8").length, CSV.length);
  const h = await faoHarvest(async () => zip);
  assert.equal(h.date, "2025-12-31");
  assert.equal(h.currency, "LCU");
  assert.ok(h.rows.length > 30);
  await assert.rejects(() => faoHarvest(async () => Buffer.from("not a zip at all, definitely not a zip file")), /not a zip/);
  // the written day can be read back and answered from
  writeDaily(INFO.id, h);
  const day = readLatestDay(INFO.id)!;
  assert.equal(day.date, "2025-12-31");
  assert.equal(faoAnswer(day, { country: "US", product: "maize" }).price!.value, 175);
  assert.equal(indexCountry(day.rows, "US").get("Wheat")!.prev, 250);
});

test("manifest: the nine countries, a working example and the collector are declared", () => {
  assert.equal(manifest.category, "producer-prices");
  assert.equal(manifest.countries.length, 9);
  assert.deepEqual([...manifest.countries].sort(), Object.keys(COUNTRIES).sort());
  assert.equal(typeof manifest.harvest, "function");
  assert.equal(manifest.nominalCounts, true);
  assert.equal(manifest.examples[0].params.country, "US");
});
