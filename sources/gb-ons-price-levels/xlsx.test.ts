// Tests for the small .xlsx reader. The workbook is built here from a hand-made zip (stored and deflated entries), in the layout Excel and ONS use.
import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { columnIndex, decodeXml, readSharedStrings, readSheet, readWorkbook, unzip } from "./xlsx";

/** A minimal zip writer for tests: the checksum is not read by unzip(), so it is left at zero. */
function makeZip(files: Record<string, string>, comment = "", stored: string[] = []): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text, "utf8");
    const isStored = stored.includes(name) || name.endsWith("/");
    const body = isStored ? data : deflateRawSync(data);
    const nameBuf = Buffer.from(name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(isStored ? 0 : 8, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    parts.push(local, nameBuf, body);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(isStored ? 0 : 8, 10);
    dir.writeUInt32LE(body.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, nameBuf);
    offset += 30 + nameBuf.length + body.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(Buffer.byteLength(comment), 20);
  return Buffer.concat([...parts, cd, end, Buffer.from(comment)]);
}

const WORKBOOK = `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Notes &amp; Cover" sheetId="1" r:id="rId1"/><sheet name="3a" sheetId="2" r:id="rId2"/></sheets></workbook>`;
const RELS = `<Relationships><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="x" Target="/xl/worksheets/sheet2.xml"/></Relationships>`;
const SHARED = `<sst><si><t>INDEX_DATE</t></si><si><t>ID_DESC</t></si><si><r><t>EGGS - </t></r><r><t xml:space="preserve">FREE-RANGE</t></r></si><si/><si><t>Tom &amp; Jerry&#x27;s &#163;</t></si></sst>`;
const SHEET1 = `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Cover</t></is></c></row></sheetData></worksheet>`;
const SHEET2 = `<worksheet><sheetData>
<row r="2"><c r="A2" t="s"><v>0</v></c><c r="B2" t="s"><v>1</v></c><c r="D2" t="str"><v>x &lt; y</v></c></row>
<row r="3"><c r="A3"><v>202608</v></c><c r="B3" t="s"><v>2</v></c><c r="C3"><v>3.4</v></c><c r="D3" t="b"><v>1</v></c><c r="E3"/><c r="AA3"><v>7</v></c></row>
<row r="5"><c r="A5" t="s"><v>4</v></c><c r="B5" t="e"><v>#N/A</v></c><c r="C5"><v></v></c></row>
<row r="6"/>
</sheetData></worksheet>`;

test("columns: letters count like a spreadsheet", () => {
  assert.equal(columnIndex("A"), 0);
  assert.equal(columnIndex("Z"), 25);
  assert.equal(columnIndex("AA"), 26);
  assert.equal(columnIndex("ab"), 27);
});

test("xml: the five named entities and numeric references are decoded, unknown ones are left alone", () => {
  assert.equal(decodeXml("Tom &amp; Jerry&apos;s &lt;b&gt; &quot;x&quot; &#163; &#x27; &nbsp;"), `Tom & Jerry's <b> "x" £ ' &nbsp;`);
});

test("unzip: reads deflated and stored entries, skips folders, copes with an archive comment", () => {
  const zip = makeZip({ "a/": "", "a/one.txt": "hello hello hello hello", "two.txt": "stored text" }, "a trailing comment", ["two.txt"]);
  const files = unzip(zip);
  assert.deepEqual([...files.keys()].sort(), ["a/one.txt", "two.txt"]);
  assert.equal(files.get("a/one.txt")!.toString(), "hello hello hello hello");
  assert.equal(files.get("two.txt")!.toString(), "stored text");
});

test("unzip: refuses what is not a zip, a corrupt directory, and compression methods it does not know", () => {
  assert.throws(() => unzip(Buffer.from("this is not a zip file at all, it is just text")), /Not a zip file/);
  assert.throws(() => unzip(Buffer.alloc(5)), /Not a zip file/);
  const zip = makeZip({ "x.txt": "abc" });
  const bad = Buffer.from(zip);
  bad.writeUInt32LE(0, bad.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])));
  assert.throws(() => unzip(bad), /Corrupt zip/);
  const odd = Buffer.from(zip);
  odd.writeUInt16LE(14, odd.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 10);
  assert.throws(() => unzip(odd), /Unsupported zip compression method 14/);
});

test("shared strings: runs are joined, empty entries stay in place so indexes line up, entities are decoded", () => {
  assert.deepEqual(readSharedStrings(SHARED), ["INDEX_DATE", "ID_DESC", "EGGS - FREE-RANGE", "", "Tom & Jerry's £"]);
});

test("worksheet: numbers stay numbers, shared and inline strings become text, gaps are null, empty rows are empty", () => {
  const rows = readSheet(SHEET2, readSharedStrings(SHARED));
  assert.deepEqual(rows[0], []);
  assert.deepEqual(rows[1], ["INDEX_DATE", "ID_DESC", null, "x < y"]);
  assert.deepEqual(rows[2], [202608, "EGGS - FREE-RANGE", 3.4, "TRUE", null, ...Array(21).fill(null), 7]);
  assert.deepEqual(rows[3], []);
  assert.deepEqual(rows[4], ["Tom & Jerry's £", "#N/A", null]);
  assert.deepEqual(rows[5], []);
  assert.deepEqual(readSheet(SHEET1, []), [["Cover"]]);
});

test("workbook: sheets come back in order with their (decoded) names, relative and absolute targets both work", () => {
  const zip = makeZip({
    "xl/workbook.xml": WORKBOOK,
    "xl/_rels/workbook.xml.rels": RELS,
    "xl/sharedStrings.xml": SHARED,
    "xl/worksheets/sheet1.xml": SHEET1,
    "xl/worksheets/sheet2.xml": SHEET2,
  });
  const sheets = readWorkbook(zip);
  assert.deepEqual(sheets.map((s) => s.name), ["Notes & Cover", "3a"]);
  assert.deepEqual(sheets[0].rows, [["Cover"]]);
  assert.equal(sheets[1].rows[2][1], "EGGS - FREE-RANGE");
  assert.throws(() => readWorkbook(makeZip({ "readme.txt": "no workbook here" })), /Not an \.xlsx workbook/);
});
