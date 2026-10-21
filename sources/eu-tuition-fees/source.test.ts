// Tests for the Eurydice tuition-fee source. Rows are copied from the real workbook (sheet "Fees_sub-topic 5" and "Eurostat data"),
// checked through the GitHub Actions probe on 2026-10-16 (Open data_2023-2024.xlsx, 224 KB).
import test from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { feeCell, parseFeeTable, readWorkbook, tuitionAnswer, FEES_SHEET, RATES_SHEET } from "./source";
import { InputError } from "../../lib/http";

const HEADER = "Annual fee amount (national currency)|Education cycle|Student category|Student status|BE-FR|BE-DE|BE-NL|BG|CZ|DK|DE|EE|IE|EL|ES|FR|HR|IT|CY|LV|LT|LU|HU|MT|NL|AT|PL|PT|RO|SI|SK|FI|SE|AL|BA|CH|IS|LI|ME|MK|NO|RS|TR";
const FEE_LINES = [
  "Minimum|First cycle|Home students|Full-time|0|100|1116|400|:|0|0|0|:|0|518|170|30|200|0|:|50|400|230000|0|1157|0|36|495|:|31|5|0|0|:|200|600|75000|100|0|:|510|0|0",
  "Maximum – standard performance /length of study|First cycle|Home students|Full-time|835|470|1116|3752|310|0|150|0|:|0|1361|170|100|2956|0|:|:|800|2700000|0|2314|0|:|697|:|:|105|0|0|:|2000|2200|1250000|950|0|:|888|300000|0",
  "Maximum – insufficient credits/extended length of studies|First cycle|Home students|Full-time|N/A|250|1944|N/A|58000|0|1000|750|:|0|8461|N/A|1300|:|0|:|:|N/A|:|0|2314|727|:|697|:|:|2700|0|0|:|:|:|1250000|N/A|0|:|888|:|3146",
  "Most common|First cycle|Home students|Full-time|N/A|450|1116|:|250|0|100|0|3000|0|929|170|:|1629|0|:|50|400|600000|0|2314|0|36|697|:|31|14|0|0|:|1000|1500|75000|1050|:|:|:|:|N/A",
  "Minimum|Second cycle|International students|Full-time|0|N/A|1116|1662|:|:|0|0|:|:|591|:|:|200|5125|:|50|400|300000|322.2|:|0|54|495|11000|31|5|1500|:|:|1500|1400|75000|100|0|:|:|:|:",
  "Maximum – standard performance /length of study|Second cycle|International students|Full-time|4175|N/A|:|19558|466|:|150|0|:|:|2818|3770|:|3031|5125|:|:|400|6442000|22500|:|1453|:|:|47500|:|105|:|:|:|7000|10000|2248000|1250|0|:|:|842400|:",
  "Most common|Second cycle|International students|Full-time|4175|N/A|:|:|375|:|100|0|:|:|1802|:|:|1761|5125|:|:|400|750000|5000|:|1453|54|:|40000|31|14|:|:|:|3000|:|75000|1350|:|:|:|:|:",
];
// padding rows so the sheet passes the "at least 40 rows" guard: the same shape for other groups
const PAD: string[] = [];
for (const g of ["Students on non-state subsidised places", "Students studying in specific discipline", "Students studying in foreign language programmes"])
  for (const c of ["First cycle", "Second cycle"])
    for (const m of ["Full-time", "Part-time"])
      for (const l of ["Minimum", "Maximum – standard performance /length of study", "Most common"])
        PAD.push(`${l}|${c}|${g}|${m}|` + HEADER.split("|").slice(4).map(() => ":").join("|"));
const RATES = [["", "", "Euro/ECU exchange rates"], ["", "Source: Eurostat", "2023"], ["", "BE fr", "1"], ["", "IE", "1"], ["", "NL", "1"], ["", "HU", "381.85"], ["", "SE", "11.4788"], ["", "NO", "11.4248"], ["", "PL", "4.5419999999999998"]];

function sheets(): Map<string, string[][]> {
  const fees: string[][] = [["MINIMUM, MAXIMUM AND MOST COMMON ANNUAL FEE AMOUNTS (in national currency and in euro)"], ["Reference academic year: 2023/2024"], ["Code:", "Non-existing - N/A"], HEADER.split("|"), ...[...FEE_LINES, ...PAD].map((l) => l.split("|"))];
  return new Map([[FEES_SHEET, fees], [RATES_SHEET, RATES]]);
}
const table = () => parseFeeTable(sheets());

test("feeCell reads numbers and treats publisher codes as missing", () => {
  assert.equal(feeCell("3000"), 3000);
  assert.equal(feeCell("322.2"), 322.2);
  assert.equal(feeCell("0"), 0);
  for (const s of [":", "N/A", "na", "nd", "", undefined]) assert.equal(feeCell(s as any), null);
});

test("parseFeeTable keeps the standard maximum, not the extended-length row", () => {
  const t = table();
  assert.equal(t.academicYear, "2023/2024");
  const ie = t.rows.filter((r) => r.cycle === "first" && r.group === "home" && r.mode === "full-time");
  assert.equal(ie.length, 3);
  assert.deepEqual(ie.map((r) => r.measure).sort(), ["common", "maximum", "minimum"]);
  assert.equal(ie.find((r) => r.measure === "maximum")!.values["DE"], "150");
  assert.equal(t.rates["BEFR"], 1);
  assert.equal(t.rates["SE"], 11.4788);
});

test("Ireland: most common 3000 EUR, posted fee, no sample size", () => {
  const a = tuitionAnswer(table(), { country: "IE" });
  assert.equal(a.status, "ok");
  assert.equal(a.price!.value, 3000);
  assert.equal(a.price!.currency, "EUR");
  assert.equal(a.price!.unit, "per academic year");
  assert.equal(a.price_type, "posted_price");
  assert.equal(a.sample_size, null);
  assert.match(a.summary, /3,000 EUR/);
  assert.equal(a.period.from, "2023-09-01");
});

test("Hungary converts to euro with the sheet's rate", () => {
  const a = tuitionAnswer(table(), { country: "HU", cycle: "second", student_group: "international" });
  assert.equal(a.status, "ok");
  assert.equal(a.price!.currency, "HUF");
  assert.equal(a.price!.value, 750000);
  assert.equal(a.price!.min, 300000);
  assert.equal(a.price!.max, 6442000);
  assert.equal((a.extra as any).euro_equivalent.most_common, Math.round((750000 / 381.85) * 100) / 100);
});

test("a most-common fee of zero is a real answer (free tuition), not 'no match'", () => {
  const a = tuitionAnswer(table(), { country: "DK" });
  assert.equal(a.status, "ok");
  assert.equal(a.price!.value, 0);
  assert.match(a.summary, /no tuition fee/);
});

test("a range without a most-common figure still answers", () => {
  const a = tuitionAnswer(table(), { country: "BG" });
  assert.equal(a.status, "ok");
  assert.equal(a.price!.min, 400);
  assert.equal(a.price!.max, 3752);
  assert.match(a.summary, /no single most-common fee/);
});

test("nothing published gives no_matches with an explanation", () => {
  const a = tuitionAnswer(table(), { country: "IE", student_group: "specific-discipline" });
  assert.equal(a.status, "no_matches");
  assert.match(String((a.statistic as any)?.note), /no fee/);
});

test("Belgium needs a community; with one it answers", () => {
  assert.throws(() => tuitionAnswer(table(), { country: "BE" }), InputError);
  const a = tuitionAnswer(table(), { country: "BE", community: "nl" });
  assert.equal(a.status, "ok");
  assert.equal(a.price!.value, 1116);
});

test("unknown country is an input error", () => {
  assert.throws(() => tuitionAnswer(table(), { country: "US" }), InputError);
});

// ---- the xlsx reader, on a tiny workbook built here (zip with deflate and stored entries, shared strings, inline strings, blanks) ----

function zip(files: Record<string, string>): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  Object.entries(files).forEach(([name, text], i) => {
    const data = Buffer.from(text);
    const stored = i % 2 === 1; // mix both methods
    const body = stored ? data : deflateRawSync(data);
    const nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    parts.push(local, nameBuf, body);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(stored ? 0 : 8, 10);
    cd.writeUInt32LE(body.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);
    offset += 30 + nameBuf.length + body.length;
  });
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cdBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cdBuf, end]);
}

test("readWorkbook reads sheets, shared strings, inline strings and blank cells", () => {
  const buf = zip({
    "xl/workbook.xml": '<workbook><sheets><sheet name="Fees_sub-topic 5" sheetId="9" r:id="rId9"/><sheet name="Eurostat &amp; data" sheetId="2" r:id="rId2"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="rId9" Type="x" Target="worksheets/sheet8.xml"/><Relationship Id="rId2" Type="x" Target="/xl/worksheets/sheet2.xml"/></Relationships>',
    "xl/sharedStrings.xml": '<sst><si><t>Most common</t></si><si><r><t>First </t></r><r><t>cycle</t></r></si></sst>',
    "xl/worksheets/sheet8.xml": '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="D1"><v>3000</v></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>x &amp; y</t></is></c><c r="B3" s="4"/><c r="C3" t="str"><v>:</v></c></row></sheetData></worksheet>',
    "xl/worksheets/sheet2.xml": '<worksheet><sheetData><row r="1"><c r="B1" t="inlineStr"><is><t>SE</t></is></c><c r="C1"><v>11.4788</v></c></row></sheetData></worksheet>',
  });
  const wb = readWorkbook(buf);
  assert.deepEqual([...wb.keys()], ["Fees_sub-topic 5", "Eurostat & data"]);
  assert.deepEqual(wb.get("Fees_sub-topic 5")![0], ["Most common", "First cycle", "", "3000"]);
  assert.deepEqual(wb.get("Fees_sub-topic 5")![1], []);
  assert.deepEqual(wb.get("Fees_sub-topic 5")![2], ["x & y", "", ":"]);
  assert.deepEqual(wb.get("Eurostat & data")![0], ["", "SE", "11.4788"]);
});

test("minimum and maximum fees are min and max (not percentiles), and a published fee is not a thin range", () => {
  const a = tuitionAnswer(table(), { country: "IE" });
  assert.equal(a.price!.typical_low, null);
  assert.equal(a.price!.typical_high, null);
  assert.notEqual(a.reliability, "thin");
  assert.doesNotMatch(a.summary, /Official average/);
});
