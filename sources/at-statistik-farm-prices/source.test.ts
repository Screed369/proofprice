import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { InputError, SourceError } from "../../lib/http";
import { categoryById, findSource, runCategory, SOURCE_PLUGINS } from "../../lib/registry";
import type { OdsSheet } from "../at-home-prices/ods";
import { NO_COUNT } from "../../lib/stats";
import manifest from "./index";
import fixture from "./fixture-sheets.json";
import euManifest from "../eu-farm-prices/index";
import { resolveProduct } from "../eu-farm-prices/products";
import {
  answerFor, atFarmPrices, atHarvest, atHistoryKey, atProductOf, AT_KEYS, clearCache, FILE_URL, harvestRows, INFO, itemName, loadWorkbook, monthRange, monthWords,
  parseFile, parseWorkbook, PRODUCTS, seriesFor, shiftMonth, sheetMonth, stripFootnote, unitOf,
} from "./source";

// fixture-sheets.json: rows copied on 2026-11-06 from the real https://www.statistik.at/fileadmin/pages/142/Erzeugerpreise2026EN.ods
// (sheets July, Aug, Sep and Jan_annualAVG; only the title, header and 16 product rows are kept).
const SHEETS = fixture as OdsSheet[];
const NOW = new Date("2026-11-06T12:00:00Z");
const wb = () => parseWorkbook(SHEETS);
const pr = (key: string) => PRODUCTS.find((x) => x.key === key)!;

beforeEach(() => clearCache());

test("INFO: official statistic, STATISTIK AUSTRIA terms with the edited-note condition", () => {
  assert.equal(INFO.id, "at-statistik-farm-prices");
  assert.equal(INFO.price_type, "official_statistic");
  assert.match(INFO.licence, /commercial and non-commercial/);
  assert.match(INFO.attribution, /STATISTIK AUSTRIA/);
  assert.match(INFO.attribution, /edited/);
  assert.equal(FILE_URL(2026), "https://www.statistik.at/fileadmin/pages/142/Erzeugerpreise2026EN.ods");
});

test("sheet months come from the title; the annual-average sheet is skipped", () => {
  assert.equal(sheetMonth(SHEETS[0]), "2026-07");
  assert.equal(sheetMonth(SHEETS[2]), "2026-09");
  assert.equal(sheetMonth(SHEETS[3]), null);
  const w = wb();
  assert.deepEqual(w.months.map((m) => m.month), ["2026-07", "2026-08", "2026-09"]);
});

test("workbook: figures, the publisher's year-on-year, provinces (point decimals; '.' and '-' left out)", () => {
  const w = wb();
  const sep = w.months[2].readings;
  assert.equal(sep.get("529")!.value, 481.73);
  assert.equal(sep.get("529")!.yoyPercent, 8.8);
  assert.deepEqual(sep.get("529")!.provinces, { "Lower Austria": 465.61 });
  assert.equal(sep.get("488")!.provinces.Styria, 0.86);
  assert.equal(sep.has("811"), true);
  assert.equal(w.months[0].readings.has("811"), false); // grapes only exist from September
  assert.equal(w.rows.get("426")!.unit, "100 kg");
  assert.throws(() => parseWorkbook([{ name: "x", rows: [["no title"]] }]), SourceError);
  assert.throws(() => parseWorkbook([{ name: "Sep", rows: [["Producer prices, September 2026"], ["Foo", "Bar"]] }]), /layout/);
});

test("every product's headline row that the fixture keeps has the unit we state", () => {
  const w = wb();
  for (const [key, text] of [["rapeseed", "per tonne"], ["potatoes", "per tonne"], ["turkey", "per 100 kg"], ["carp", "per kg"], ["wild boar", "per kg"], ["white grapes", "per 100 kg"], ["hay", "per tonne"], ["straw", "per tonne"]] as const) {
    const row = w.rows.get(pr(key).codes[0]);
    assert.ok(row, `${key}: row ${pr(key).codes[0]} in the fixture`);
    assert.equal(unitOf(row!).text, text, key);
  }
});

test("series: oldest first, gaps left out", () => {
  const s = seriesFor(wb(), "529");
  assert.deepEqual(s.map((x) => x.month), ["2026-07", "2026-08", "2026-09"]);
  assert.equal(s[2].value, 481.73);
  assert.deepEqual(seriesFor(wb(), "811").map((x) => x.month), ["2026-09"]);
});

test("answer: rapeseed, September 2026 (real figures)", () => {
  const a = answerFor(pr("rapeseed"), wb(), { product: "canola" }, NOW);
  assert.equal(a.status, "ok");
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.price.value, 481.73);
  assert.equal(a.price.unit, "per tonne");
  assert.equal(a.price.median, null);
  assert.equal(a.sample_size, null);
  assert.deepEqual(a.period, { from: "2026-09-01", to: "2026-09-30" });
  assert.match(a.summary, /September 2026/);
  assert.match(a.summary, /net of VAT/);
  const x = a.extra as any;
  assert.equal(x.product.asked_for, "canola");
  assert.equal(x.price_per_kg, 0.4817);
  assert.equal(x.change_on_previous_month.reference_month, "2026-08");
  assert.equal(x.change_on_year_earlier_published.change_percent, 8.8);
  assert.equal(x.net_of_vat, true);
  assert.match(x.edited_note, /edited/);
  assert.equal(x.last_months.length, 3);
});

test("answer: per head / per 100 kg / per kg units and price per kg", () => {
  const turkey = answerFor(pr("turkey"), wb(), { product: "turkey" }, NOW);
  assert.equal(turkey.price.unit, "per 100 kg");
  assert.equal((turkey.extra as any).price_per_kg, 1.7002);
  const boar = answerFor(pr("wild boar"), wb(), { product: "wild boar" }, NOW);
  assert.equal(boar.price.unit, "per kg");
  assert.equal(boar.price.value, 1.06);
  assert.equal((boar.extra as any).provinces.Carinthia, 1.75);
});

test("answer: a product with no figure in the newest month shows its latest month and says so; two rows give other_series", () => {
  const hay = answerFor(pr("hay"), wb(), { product: "hay" }, NOW);
  assert.equal(hay.status, "ok");
  assert.equal(hay.period.to, "2026-08-31");
  assert.match(String(hay.statistic?.note), /no figure for September 2026/);
  const pot = answerFor(pr("potatoes"), wb(), { product: "potatoes" }, NOW);
  assert.equal(pot.price.value, 331.35);
  assert.equal(((pot.extra as any).other_series ?? []).length, 1);
});

test("answer: nothing published at all gives no_matches, not a made-up number", () => {
  const empty = parseWorkbook(SHEETS.map((s) => ({ ...s, rows: s.rows.map((r) => (r[0] === "811" ? [r[0], r[1], r[2], ".", ".", ...r.slice(5)] : r)) })));
  const a = answerFor(pr("white grapes"), empty, { product: "wine grapes" }, NOW);
  assert.equal(a.status, "no_matches");
  assert.equal((a.price as any)?.value ?? null, null);
});

test("answer: old data is flagged", () => {
  const a = answerFor(pr("rapeseed"), wb(), { product: "rapeseed" }, new Date("2027-03-10T00:00:00Z"));
  assert.match(String(a.statistic?.note), /Old data/);
});

test("product names and aliases", () => {
  assert.equal(atProductOf("Canola")?.key, "rapeseed");
  assert.equal(atProductOf("soya beans")?.key, "soybeans");
  assert.equal(atProductOf("potato")?.key, "potatoes");
  assert.equal(atProductOf("wine grapes prices")?.key, "white grapes");
  assert.equal(atProductOf("venison")?.key, "red deer");
  assert.equal(atProductOf("pig"), null); // EU portal
  assert.equal(atProductOf(undefined), null);
  assert.ok(AT_KEYS.includes("rapeseed"));
});

test("our products are exactly the ones the EU portal does not hold (no overlap)", () => {
  for (const p of PRODUCTS) {
    for (const n of [p.key, ...p.aliases]) {
      assert.throws(() => resolveProduct(n), InputError, `eu-farm-prices also knows "${n}" (${p.key})`);
    }
  }
});

test("month helpers", () => {
  assert.deepEqual(monthRange("2026-02"), { from: "2026-02-01", to: "2026-02-28" });
  assert.equal(monthWords("2026-09"), "September 2026");
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.throws(() => monthRange("2026-13"), SourceError);
});

test("atFarmPrices: unknown product lists ours and points to the EU portal", async () => {
  await assert.rejects(() => atFarmPrices({ product: "pig" }, { workbook: wb() }), (e: any) => e instanceof InputError && /rapeseed/.test(e.message) && /European Commission/.test(e.message));
  await assert.rejects(() => atFarmPrices({}, { workbook: wb() }), InputError);
});

test("loadWorkbook: reads a real .ods container end to end, reuses the copy, falls back to last year in January", async () => {
  const buf = makeOds(SHEETS);
  const calls: number[] = [];
  const fetcher = async (year: number) => {
    calls.push(year);
    return year === 2026 ? buf : null;
  };
  const w = await loadWorkbook({ fetcher, now: NOW });
  assert.equal(w.months.length, 3);
  assert.equal(w.months[2].readings.get("529")!.value, 481.73);
  await loadWorkbook({ fetcher, now: NOW });
  assert.deepEqual(calls, [2026]); // second call from the copy
  clearCache();
  calls.length = 0;
  const jan = await loadWorkbook({ fetcher: async (y) => (calls.push(y), y === 2026 ? buf : null), now: new Date("2027-01-05T00:00:00Z") });
  assert.deepEqual(calls, [2027, 2026]); // 2027 not published yet -> last year's file
  assert.equal(jan.months.length, 3);
});

test("loadWorkbook: a broken file is a source error; an older copy survives a failed refresh", async () => {
  await assert.rejects(() => loadWorkbook({ fetcher: async () => Buffer.from("not a zip"), now: NOW }), SourceError);
  clearCache();
  const buf = makeOds(SHEETS);
  await loadWorkbook({ fetcher: async () => buf, now: NOW });
  const later = new Date(NOW.getTime() + 7 * 3600 * 1000);
  const w = await loadWorkbook({ fetcher: async () => { throw new SourceError("down"); }, now: later });
  assert.equal(w.months.length, 3);
});

test("harvest rows: one published average per product with a figure in the newest month (n = NO_COUNT)", () => {
  const h = harvestRows(wb());
  assert.equal(h.date, "2026-09-30");
  assert.equal(h.currency, "EUR");
  const rape = h.rows.find((r) => r.item === "rapeseed (EUR per tonne)")!;
  assert.equal(rape.area, "AT");
  assert.equal(rape.median, 481.73);
  assert.equal(rape.n, NO_COUNT, "no made-up count");
  assert.ok(!h.rows.some((r) => /hay/.test(r.item)), "hay has no September figure");
  assert.ok(h.rows.every((r) => r.item.includes("(EUR per")));
});

test("history key matches the library item name for every product", () => {
  const w = wb();
  for (const p of PRODUCTS) {
    const row = w.rows.get(p.codes[0]);
    if (!row) continue;
    assert.equal(atHistoryKey({ product: p.key })!.item, itemName(p, row), p.key);
  }
  assert.equal(atHistoryKey({ product: "pig" }), null);
});

test("footnote digits are dropped from row names (Gap G20261112-AUDIT-ATRAPE)", async () => {
  assert.equal(stripFootnote("Rape seed4"), "Rape seed");
  assert.equal(stripFootnote("Potatoes for starch industry5"), "Potatoes for starch industry");
  assert.equal(stripFootnote("Beech, class B 3"), "Beech, class B 3");
  const a: any = await atFarmPrices({ product: "rapeseed" }, { workbook: parseWorkbook(SHEETS), now: new Date("2026-11-12T00:00:00Z") });
  assert.equal(a.extra.product.statistik_name, "Rape seed");
});

test("manifest: category farm-prices, AT, examples, harvest and history key", () => {
  assert.equal(manifest.category, "farm-prices");
  assert.deepEqual(manifest.countries, ["AT"]);
  assert.equal(manifest.examples[0].params.product, "rapeseed");
  assert.ok(manifest.harvest && manifest.historyKey);
  assert.equal(typeof atHarvest, "function");
});

test("routing: AT products we hold go here, everything else for AT stays with the EU portal", () => {
  assert.equal(findSource("farm-prices", "AT", { country: "AT", product: "rapeseed" })?.info.id, "at-statistik-farm-prices");
  assert.equal(findSource("farm-prices", "AT", { country: "AT", product: "potatoes" })?.info.id, "at-statistik-farm-prices");
  assert.equal(findSource("farm-prices", "AT", { country: "AT", product: "pig" })?.info.id, "eu-farm-prices");
  assert.equal(findSource("farm-prices", "AT", { country: "AT", product: "milk" })?.info.id, "eu-farm-prices");
  assert.equal(findSource("farm-prices", "DE", { country: "DE", product: "rapeseed" })?.info.id, "eu-farm-prices");
  assert.ok(manifest.serves!({ country: "at", product: "Rapeseed" }));
  assert.ok(!manifest.serves!({ country: "AT", product: "wheat" }));
  assert.ok(euManifest.serves!({ country: "AT", product: "wheat" }));
  assert.ok(SOURCE_PLUGINS.some((s) => s.info.id === "at-statistik-farm-prices"));
});

test("runCategory with the file stubbed: AT rapeseed answers through the registry", async () => {
  const buf = makeOds(SHEETS);
  clearCache();
  await loadWorkbook({ fetcher: async () => buf, now: new Date() }); // fills the copy used by handle()
  const a: any = await runCategory(categoryById("farm-prices")!, { country: "AT", product: "rapeseed" }, { baseUrl: "https://proofprice.com" });
  assert.equal(a.status, "ok");
  assert.equal(a.source.id, "at-statistik-farm-prices");
  assert.equal(a.price.value, 481.73);
});

// ---------- a minimal .ods writer (stored zip) so parseFile is tested through the real container ----------

function makeOds(sheets: OdsSheet[]): Buffer {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const cell = (v: string) => (/^-?\d+(\.\d+)?$/.test(v) ? `<table:table-cell office:value-type="float" office:value="${v}"><text:p>${v}</text:p></table:table-cell>` : `<table:table-cell office:value-type="string"><text:p>${esc(v)}</text:p></table:table-cell>`);
  const body = sheets
    .map((s) => `<table:table table:name="${s.name}">${s.rows.map((r) => `<table:table-row>${r.map(cell).join("")}</table:table-row>`).join("")}</table:table>`)
    .join("");
  const xml = `<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="o" xmlns:table="t" xmlns:text="x"><office:body><office:spreadsheet>${body}</office:spreadsheet></office:body></office:document-content>`;
  const name = Buffer.from("content.xml");
  const data = Buffer.from(xml, "utf8");
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(0, 42);
  const localPart = Buffer.concat([local, name, data]);
  const centralPart = Buffer.concat([central, name]);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralPart.length, 12);
  eocd.writeUInt32LE(localPart.length, 16);
  return Buffer.concat([localPart, centralPart, eocd]);
}
