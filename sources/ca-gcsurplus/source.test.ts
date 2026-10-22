// Fixture: header and first row copied from the live file (probe cagcs-b1, 2026-10-22), plus synthetic goods lots.
import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { cleanTitle, classify, parseSales, dailyRows, englishZipUrls, normaliseProvince, groupFor, caKey, caHistoryKey, caAnswerFromRow, unzipFirstFile, forEachCsvRow } from "./source";

const HEAD = "SOLD_AMT,LOT_DESC,MIN_BID_AMT,CLOSING_DT,LOT_ITEMS,LOT_CMNTS,ADDITIONAL_CMNTS,ASSET_LOC_ADDR_1,ASSET_LOC_ADDR_2,ASSET_LOC_CITY,ASSET_LOC_PROV,ASSET_LOC_POSTAL_CD,CUSTODIAN_PERSON_NM,CUSTODIAN_PERSON_PHN,CUSTODIAN_EMAIL,SALES_PERSON_NM,SALES_EMAIL_ADDRS_ID,SALES_PERSON_PHN,SALE_CNTRCT_REG_ID,PAYMENT_DAY_QTY,REMOVAL_DAY_QTY,VEHICLE_FEATURES,CLAUSES";
const T = "Period Contract - Scrap Tires - DND Longue-Pointe and St-Hubert";
const REAL =
  `﻿${HEAD}\r\n` +
  `1125,${T}${T},0,2025-07-09,Quantity: 1(EA) :JEWELRY,,"THE GENERAL TERMS AND CONDITIONS B DATED JULY 2, 2024, APPLY TO THIS SALE.\n\n- SECURITY REQUIREMENT\n\n- There is no security requirement.",1 Main St,,MONTREAL,QC,H1N 1X9,Jane Doe,555-0100,jane@example.invalid,Sales Person,s@example.invalid,555-0101,REG-1,10,10,,clauses\r\n`;

function row(amt: number, desc: string, date: string, prov: string, id: string, feat = ""): string {
  return `${amt},${desc}${desc},0,${date},Quantity: 1(EA),,,addr,,CITY,${prov},X1X1X1,Name,555,e@x.invalid,Name,s@x.invalid,555,${id},10,10,${feat},c\r\n`;
}

test("a quoted cell with line breaks stays in one row and the real contract row is dropped", () => {
  let rows = 0;
  forEachCsvRow(REAL, () => rows++);
  assert.equal(rows, 2);
  assert.deepEqual(parseSales(REAL), []);
});
test("title stored twice is cleaned", () => {
  assert.equal(cleanTitle(T + T), T);
  assert.equal(cleanTitle("2010 Ford F150 truck"), "2010 Ford F150 truck");
});
test("classify: goods get a group, contracts and unknowns do not", () => {
  assert.equal(classify("2012 Ford F150 pickup truck", false), "vehicles");
  assert.equal(classify("John Deere tractor with loader", false), "heavy-equipment");
  assert.equal(classify("Dell laptop lot", false), "electronics");
  assert.equal(classify("Steel office desk", false), "office-furniture");
  assert.equal(classify("Term Contract - Removal of used oil", false), null);
  assert.equal(classify("Pallet of widgets", false), null);
  assert.equal(classify("Mystery item", true), "vehicles");
});
test("parseSales keeps priced goods in known provinces and counts a repeated sale id once", () => {
  const text = HEAD + "\r\n" + REAL.split("\r\n").slice(1).join("") +
    row(5000, "2011 Ford F150 pickup", "2025-09-01", "ON", "A1") +
    row(5000, "2011 Ford F150 pickup", "2025-09-01", "ON", "A1") +
    row(0, "2011 Ford F150 pickup", "2025-09-02", "ON", "A2") +
    row(7000, "2012 Chevrolet Silverado truck", "2025-09-03", "Quebec", "A3") +
    row(7000, "2012 Chevrolet Silverado truck", "2025-09-03", "ZZ", "A4");
  const s = parseSales(text);
  assert.deepEqual(s.map((x) => [x.group, x.prov, x.price]), [["vehicles", "ON", 5000], ["vehicles", "QC", 7000]]);
});
test("dailyRows: windows, province and national rows, nothing under 5 lots", () => {
  const sales = [1000, 2000, 3000, 4000, 5000, 6000].map((price, i) => ({ group: "vehicles" as const, prov: i < 5 ? "ON" : "AB", date: `2025-12-0${i + 1}`, price }))
    .concat([{ group: "vehicles" as const, prov: "ON", date: "2024-01-05", price: 99999 }]);
  const { date, rows } = dailyRows(sales);
  assert.equal(date, "2025-12-06");
  const on12 = rows.find((r) => r.area === "ON" && r.item === "vehicles:12m")!;
  assert.equal(on12.n, 5);
  assert.equal(on12.median, 3000);
  assert.equal(rows.find((r) => r.area === "ALL" && r.item === "vehicles:12m")!.n, 6);
  assert.equal(rows.find((r) => r.area === "ALL" && r.item === "vehicles:24m")!.n, 7); // the 2024-01 sale is inside 24 months, outside 12
  assert.ok(!rows.some((r) => r.area === "AB"));
});
test("zip reader and package listing", () => {
  const body = Buffer.from("a,b\n1,2");
  const comp = deflateRawSync(body);
  const lfh = Buffer.alloc(30); lfh.writeUInt32LE(0x04034b50, 0); lfh.writeUInt16LE(8, 8);
  const cdh = Buffer.alloc(46); cdh.writeUInt32LE(0x02014b50, 0); cdh.writeUInt16LE(8, 10); cdh.writeUInt32LE(comp.length, 20); cdh.writeUInt32LE(0, 42);
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt32LE(30 + comp.length, 16);
  assert.equal(unzipFirstFile(Buffer.concat([lfh, comp, cdh, eocd])).toString(), "a,b\n1,2");
  const pkg = { result: { resources: [
    { url: "https://donnees-data.tpsgc-pwgsc.gc.ca/bi1/gcsurplus/gcsurplus-2025-01-01--2025-06-30-eng.zip" },
    { url: "https://donnees-data.tpsgc-pwgsc.gc.ca/bi1/gcsurplus/gcsurplus-2025-07-01--2025-12-31-fra.zip" },
    { url: "https://donnees-data.tpsgc-pwgsc.gc.ca/bi1/gcsurplus/gcsurplus-2025-07-01--2025-12-31-eng.zip" },
  ] } };
  assert.equal(englishZipUrls(pkg).length, 2);
  assert.match(englishZipUrls(pkg)[0], /2025-07-01--2025-12-31-eng\.zip$/);
});
test("requests map to library keys", () => {
  assert.equal(normaliseProvince("Quebec"), "QC");
  assert.equal(normaliseProvince("on"), "ON");
  assert.equal(normaliseProvince("Atlantis"), null);
  assert.equal(groupFor("heavy equipment"), "heavy-equipment");
  assert.equal(groupFor("forklift"), "heavy-equipment");
  assert.equal(groupFor("banana"), null);
  assert.deepEqual(caKey({ what: "vehicles", state: "Ontario", months: 20 }), { area: "ON", item: "vehicles:24m", group: "vehicles", months: 24, label: "Ontario" });
  assert.equal(caKey({ what: "vehicles", state: "Atlantis" }), null);
  assert.equal(caHistoryKey({ what: "laptop" })!.area, "ALL");
});
test("answer from a library row says what it is", () => {
  const a = caAnswerFromRow({ date: "2025-12-31", area: "ALL", item: "vehicles:12m", n: 40, median: 5200, low: 900, high: 18000, min: 100, max: 40000 }, { label: "Canada", group: "vehicles", months: 12 });
  assert.equal(a.price?.currency, "CAD");
  assert.equal(a.price?.median, 5200);
  assert.match(a.summary, /not retail prices/);
  assert.match(JSON.stringify(a), /Open Government Licence/);
});
