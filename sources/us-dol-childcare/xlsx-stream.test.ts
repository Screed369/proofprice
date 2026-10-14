// The streaming reader must give exactly the rows the in-memory reader gives, however the compressed bytes are cut into pieces.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeXlsx } from "../../tests/helpers/make-zip";
import { readXlsx } from "../../categories/rent/xlsx";
import { openWorkbook, parseRowCells, streamSheet, zipDirectory } from "./xlsx-stream";

const ROWS: (string | number | null)[][] = [["State_Name", "County_Name", "FIPS", "Price"]];
for (let i = 0; i < 400; i++) ROWS.push(["Alabama", `County ${i} & <Co>`, 1000 + i, i % 7 === 0 ? null : 100.5 + i]);

test("stream: same rows as the whole-sheet reader, with a tiny chunk size", async () => {
  const buf = makeXlsx({ First: [["x"]], Second: ROWS });
  const wb = openWorkbook(buf, "Second");
  assert.equal(wb.sheetTitle, "Second");
  const streamed: (string | number | boolean | null)[][] = [];
  const seen = await streamSheet(buf, wb.dir.get(wb.sheetPath)!, wb.shared, (cells) => void streamed.push(cells), 37);
  const whole = readXlsx(buf).find((s) => s.name === "Second")!.rows;
  assert.equal(seen, whole.length);
  assert.deepEqual(streamed, whole);
});

test("stream: the first sheet is the default, early stop works, a missing sheet is refused", async () => {
  const buf = makeXlsx({ Only: ROWS });
  const wb = openWorkbook(buf);
  assert.equal(wb.sheetTitle, "Only");
  let n = 0;
  await streamSheet(buf, wb.dir.get(wb.sheetPath)!, wb.shared, () => (++n >= 5 ? false : undefined), 64);
  assert.equal(n, 5);
  assert.throws(() => openWorkbook(buf, "Nope"), /no sheet called "Nope"/);
  assert.throws(() => zipDirectory(Buffer.from("not a zip file at all, just text")), /Not a zip file/);
});

test("row cells: shared strings, inline strings, numbers, booleans and empty styled cells", () => {
  const body = '<c r="A1" t="s"><v>1</v></c><c r="B1" s="3"/><c r="C1"><v>12.5</v></c><c r="E1" t="inlineStr"><is><t>a &amp; b</t></is></c><c r="F1" t="b"><v>1</v></c><c r="G1" s="2"></c>';
  assert.deepEqual(parseRowCells(body, ["zero", "one"]), ["one", null, 12.5, null, "a & b", true]);
});
