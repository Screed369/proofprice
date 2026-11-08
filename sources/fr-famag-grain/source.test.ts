import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { InputError, SourceError } from "../../lib/http";
import { categoryById, SOURCE_PLUGINS } from "../../lib/registry";
import { NO_COUNT } from "../../lib/stats";
import type { Cell } from "../../categories/rent/xlsx";
import manifest from "./index";
import euManifest from "../eu-farm-prices/index";
import { resolveProduct } from "../eu-farm-prices/products";
import fixture from "./fixture.json";
import {
  campaignStart, clearCache, CROPS, EU_PORTAL_CROPS, famGrainPrices, famHarvest, famHistoryKey, harvestRows, INFO, lastYearOf, matchCrop, parseSheetRows,
  parseWorkbook, quarterEnd, readings,
} from "./source";

// fixture.json: the header and the first 69 data rows (2004/05 quarter 4 to 2021/22 quarter 4) of the sheet "Publication nationale" in the real
// FranceAgriMer workbook SCR-CER-HISTOPRIXTRIMESTRIELS-C25-26.xlsx, read through the GitHub probe fr-fam-grain on 2026-11-08 (cells joined with |,
// blank cell = null, euro per tonne). The sheet header is "Trimestre *", "Campagne **", then the crop names with accents.
const HEADER: Cell[] = fixture.header as Cell[];
const DATA: Cell[][] = fixture.rows as Cell[][];
const ROWS = () => parseSheetRows([["HISTORIQUE"], [], HEADER, ...DATA]);

beforeEach(() => clearCache());

test("INFO: official statistic, free tier wording, attribution names FranceAgriMer", () => {
  assert.equal(INFO.id, "fr-famag-grain");
  assert.equal(INFO.price_type, "official_statistic");
  assert.match(INFO.attribution, /FranceAgriMer/);
  assert.match(INFO.licence, /free tier only/);
});

test("sheet rows: quarters and campaigns, blanks left out, accents stripped from the header", () => {
  const rows = ROWS();
  assert.equal(rows.length, 69);
  assert.deepEqual([rows[0].campaign, rows[0].quarter], ["2004/05", 4]);
  assert.equal(Math.round(rows[0].prices["Colza"] * 100) / 100, 192.35);
  assert.equal(rows[0].prices["Feverole"], undefined); // not surveyed in 2004/05
  const last = rows[rows.length - 1];
  assert.deepEqual([last.campaign, last.quarter], ["2021/22", 4]);
  assert.equal(Math.round(last.prices["Ble tendre"] * 10) / 10, 216.7);
  assert.throws(() => parseSheetRows([["nothing"]]), SourceError);
  assert.throws(() => parseWorkbook(Buffer.from("not a workbook")), SourceError);
});

test("readings: newest first, only quarters with the crop", () => {
  const r = readings(ROWS(), "Colza");
  assert.deepEqual([r[0].campaign, r[0].quarter], ["2021/22", 4]);
  assert.ok(r[0].value > 400);
  assert.ok(r.every((x, i) => i === 0 || x.campaign <= r[i - 1].campaign));
});

test("campaign dates: July to June", () => {
  assert.equal(campaignStart("2025/26"), "2025-07-01");
  assert.equal(quarterEnd("2025/26", 1), "2025-09-30");
  assert.equal(quarterEnd("2025/26", 2), "2025-12-31");
  assert.equal(quarterEnd("2025/26", 3), "2026-03-31");
  assert.equal(quarterEnd("2025/26", 4), "2026-06-30");
  assert.equal(lastYearOf("2021/22"), "2020/21");
  assert.equal(lastYearOf("2000/01"), "1999/00");
});

test("matchCrop: everyday words and the main cereals are not ours", () => {
  assert.equal(matchCrop("canola")?.column, "Colza");
  assert.equal(matchCrop("Sunflower seeds")?.column, "Tournesol");
  assert.equal(matchCrop("soybeans")?.column, "Soja");
  assert.equal(matchCrop("peas prices")?.column, "Pois");
  assert.equal(matchCrop("wheat"), null);
  assert.equal(matchCrop(""), null);
});

test("no overlap with the EU portal: every crop of ours is unknown to eu-farm-prices, every EU crop of the file is known to it", () => {
  for (const c of CROPS) for (const w of c.words) assert.throws(() => resolveProduct(w), /not a product we cover/, `${w} must not be an eu-farm-prices product`);
  for (const w of ["wheat", "durum wheat", "barley", "maize", "rye", "oats", "triticale"]) assert.doesNotThrow(() => resolveProduct(w));
  assert.equal(EU_PORTAL_CROPS.length, 7);
  assert.equal(manifest.serves!({ country: "FR", product: "wheat" }), false);
  assert.equal(manifest.serves!({ country: "FR", product: "rapeseed" }), true);
  assert.equal(manifest.serves!({ country: "DE", product: "rapeseed" }), false);
  assert.equal(euManifest.serves!({ country: "FR", product: "rapeseed" }), false); // eu-farm-prices now declines FR crops it cannot resolve (platform fix 8 Nov), so only this source claims them
});

import { crc32 } from "node:zlib";

/** A real (stored, uncompressed) .xlsx built from rows, with inline strings, so the whole path file -> answer runs. */
function buildXlsx(sheetName: string, rows: Cell[][]): Buffer {
  const col = (i: number) => String.fromCharCode(65 + i);
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const sheetXml =
    `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>` +
    rows.map((r, ri) => `<row r="${ri + 1}">` + r.map((v, ci) => v === null ? "" : typeof v === "number" ? `<c r="${col(ci)}${ri + 1}"><v>${v}</v></c>` : `<c r="${col(ci)}${ri + 1}" t="inlineStr"><is><t>${esc(String(v))}</t></is></c>`).join("") + `</row>`).join("") +
    `</sheetData></worksheet>`;
  const files: [string, string][] = [
    ["xl/workbook.xml", `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Infos" sheetId="1" r:id="rId1"/><sheet name="${sheetName}" sheetId="2" r:id="rId2"/></sheets></workbook>`],
    ["xl/_rels/workbook.xml.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>`],
    ["xl/worksheets/sheet1.xml", `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Infos</t></is></c></row></sheetData></worksheet>`],
    ["xl/worksheets/sheet2.xml", sheetXml],
  ];
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of files) {
    const data = Buffer.from(text, "utf8");
    const nameB = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nameB.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nameB.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, nameB, data);
    central.push(ch, nameB);
    offset += 30 + nameB.length + data.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10); eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

const XLSX = () => buildXlsx("Publication nationale", [["HISTORIQUE_PRIX"], HEADER, ...DATA]);
const locate = async () => "https://example.test/file.xlsx";
const getFile = async () => XLSX();

test("workbook: a real zip with the sheet parses to the same rows", () => {
  const rows = parseWorkbook(XLSX());
  assert.equal(rows.length, 69);
  assert.throws(() => parseWorkbook(buildXlsx("Autre", [HEADER, ...DATA])), /no sheet/);
});

test("answer: newest quarter with a figure, official statistic, no sample size, change on the same point a year earlier", async () => {
  const a = await famGrainPrices({ product: "colza" }, locate, getFile);
  assert.equal(a.status, "ok");
  assert.equal(a.price?.median !== undefined || a.statistic !== undefined, true);
  assert.equal(a.statistic?.reference_period, "2021/22 Q4");
  assert.equal(a.sample_size ?? null, null);
  assert.match(a.summary, /rapeseed/);
  assert.match(a.summary, /2021\/22/);
  assert.match(a.summary, /up \d/); // 2021/22 Q4 is above 2020/21 Q4
  assert.equal((a.extra as any).same_point_previous_campaign.campaign, "2020/21");
  assert.equal((a.extra as any).complete_campaign_prices[0].campaign, "2021/22");
});

test("harvest: dated at the quarter end, one row per crop, no count", async () => {
  const h = await famHarvest(locate, getFile);
  assert.equal(h.date, "2022-06-30");
  assert.equal(h.currency, "EUR");
  assert.ok(h.rows.every((r) => Number.isNaN(r.n)));
  assert.ok(h.rows.some((r) => r.item === "rapeseed" && r.median > 400 && r.median < 700));
  assert.equal(harvestRows(ROWS()).rows.length, h.rows.length);
  void NO_COUNT;
});

test("answer path: unknown crop and empty crop give a helpful no_matches", async () => {
  const a = await famGrainPrices({ product: "dragonfruit" }, locate, getFile);
  assert.equal(a.status, "no_matches");
  assert.match(a.summary, /rapeseed/);
  await assert.rejects(() => famGrainPrices({ product: "" }, locate, getFile), InputError);
});

test("history key and manifest shape", () => {
  assert.deepEqual(famHistoryKey({ product: "colza" }), { area: "France", item: "rapeseed", label: "France, rapeseed" });
  assert.equal(famHistoryKey({ product: "wheat" }), null);
  assert.equal(manifest.info.id, "fr-famag-grain");
  assert.equal(categoryById("farm-prices")?.id, "farm-prices");
  assert.ok(SOURCE_PLUGINS.some((x) => x.info.id === "fr-famag-grain"));
  assert.equal(typeof famHarvest, "function");
});
