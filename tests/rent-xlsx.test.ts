// Tests for the small .xlsx reader shared by the rent sources (categories/rent/xlsx.ts).
// The workbook is built here from the part layout Excel writes (workbook.xml, relationships, shared strings, sheets).
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeXlsx, makeZip } from "./helpers/make-zip";
import { columnIndex, excelDate, parseSharedStrings, parseSheetXml, readXlsx, unzipAll, xmlText } from "../categories/rent/xlsx";
const WORKBOOK = `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Legend" sheetId="1" r:id="rId1"/><sheet name="Data &amp; more" sheetId="2" r:id="rId2"/></sheets></workbook>`;
const RELS = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="x" Target="/xl/worksheets/sheet2.xml"/><Relationship Id="rId3" Type="x" Target="sharedStrings.xml"/></Relationships>`;
const SHARED = `<?xml version="1.0"?><sst count="4" uniqueCount="4"><si><t>Postcode</t></si><si><t xml:space="preserve">Weekly Rent</t></si><si><r><t>Rich </t></r><r><t>text &amp; more</t></r></si><si/></sst>`;
const SHEET1 = `<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>2</v></c></row></sheetData></worksheet>`;
const SHEET2 = `<worksheet><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="D1" t="inlineStr"><is><t>Note</t></is></c></row>
<row r="2" spans="1:4"><c r="A2"><v>2000</v></c><c r="B2" s="3"><v>650.5</v></c><c r="C2" t="b"><v>1</v></c><c r="D2" t="str"><v>x &lt; y</v></c></row>
<row r="3"/>
<row r="4"><c r="B4"><v>45000</v></c><c r="C4"/></row>
</sheetData></worksheet>`;

const FILES = {
  "[Content_Types].xml": "<Types/>",
  "xl/workbook.xml": WORKBOOK,
  "xl/_rels/workbook.xml.rels": RELS,
  "xl/sharedStrings.xml": SHARED,
  "xl/worksheets/sheet1.xml": SHEET1,
  "xl/worksheets/sheet2.xml": SHEET2,
};

test("unzipAll reads stored and deflated entries", () => {
  for (const deflate of [false, true]) {
    const files = unzipAll(makeZip(FILES, deflate));
    assert.equal(files.size, 6);
    assert.equal(files.get("xl/workbook.xml")?.toString("utf8"), WORKBOOK);
  }
  assert.throws(() => unzipAll(Buffer.from("not a zip")), /Not a zip file/);
});

test("xml entities, column letters, shared strings", () => {
  assert.equal(xmlText("a &amp; b &lt;c&gt; &#65;&#x42; &unknown;"), "a & b <c> AB &unknown;");
  assert.equal(columnIndex("A"), 0);
  assert.equal(columnIndex("Z"), 25);
  assert.equal(columnIndex("AA"), 26);
  assert.deepEqual(parseSharedStrings(SHARED), ["Postcode", "Weekly Rent", "Rich text & more", ""]);
});

test("readXlsx: sheet names, relationships, sparse and typed cells", () => {
  for (const deflate of [false, true]) {
    const sheets = readXlsx(makeZip(FILES, deflate));
    assert.deepEqual(sheets.map((s) => s.name), ["Legend", "Data & more"]);
    assert.deepEqual(sheets[0].rows, [["Rich text & more"]]);
    const rows = sheets[1].rows;
    assert.deepEqual(rows[0], ["Postcode", "Weekly Rent", null, "Note"]);
    assert.deepEqual(rows[1], [2000, 650.5, true, "x < y"]);
    assert.deepEqual(rows[2], []);
    assert.deepEqual(rows[3], [null, 45000]);
  }
});

test("readXlsx: maxRows stops early, and a non-workbook zip is refused", () => {
  const rows = readXlsx(makeZip(FILES), { maxRows: 2 })[1].rows;
  assert.equal(rows.length, 2);
  assert.throws(() => readXlsx(makeZip({ "a.txt": "x" })), /Not an Excel workbook/);
});

test("parseSheetXml keeps rows aligned when a row number is skipped", () => {
  const rows = parseSheetXml(`<sheetData><row r="1"><c r="A1"><v>1</v></c></row><row r="3"><c r="A3"><v>3</v></c></row></sheetData>`, []);
  assert.deepEqual(rows, [[1], [], [3]]);
});

test("makeXlsx round trip: strings stay strings, numbers stay numbers, several sheets", () => {
  const sheets = readXlsx(makeXlsx({ Data: [["Title & more"], [], ["Postcode", "Rent"], [2000, "680"]], Definitions: [["a", 1]] }));
  assert.deepEqual(sheets.map((s) => s.name), ["Data", "Definitions"]);
  assert.deepEqual(sheets[0].rows, [["Title & more"], [], ["Postcode", "Rent"], [2000, "680"]]);
  assert.deepEqual(sheets[1].rows, [["a", 1]]);
});

test("makeXlsx round trip with more than 26 columns (AA, AB, ...)", () => {
  const wide = Array.from({ length: 80 }, (_, i) => (i % 3 === 0 ? i : `c${i}`));
  const sheets = readXlsx(makeXlsx({ Wide: [wide] }));
  assert.deepEqual(sheets[0].rows[0], wide);
});

test("excelDate converts serial numbers and rejects other numbers", () => {
  assert.equal(excelDate(45000), "2023-03-15");
  assert.equal(excelDate(46000), "2025-12-09");
  assert.equal(excelDate(650), null);
  assert.equal(excelDate("2023-03-15"), null);
});
