import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { parseIePpr, ieDailyRows, unzipFirstFile, normaliseCounty, ieAnswerFromRow, ieHistoryKey } from "./source";

// Header and first rows copied from the live file PPR-ALL.csv, probed 13 Oct 2026 (latin-1; euro sign lost in header).
const header = 'Date of Sale (dd/mm/yyyy),Address,County,Eircode,Price (),Not Full Market Price,VAT Exclusive,Description of Property,Property Size Description';
const live = [
  header,
  '"01/01/2010","5 Braemor Drive, Churchtown, Co.Dublin","Dublin","","343,000.00","No","No","Second-Hand Dwelling house /Apartment",""',
  '"03/01/2010","134 Ashewood Walk, Summerhill Lane, Portlaoise","Laois","","185,000.00","No","Yes","New Dwelling house /Apartment","greater than or equal to 38 sq metres and less than 125 sq metres"',
  '"04/01/2010","1 Meadow Avenue, Dundrum, Dublin 14","Dublin","","438,500.00","Yes","No","Second-Hand Dwelling house /Apartment",""',
].join("\n");

test("IE: parse by position, drop VAT-exclusive and not-full-market rows", () => {
  const s = parseIePpr(live);
  assert.equal(s.length, 1);
  assert.deepEqual(s[0], { date: "2010-01-01", county: "Dublin", price: 343000, kind: "second-hand" });
});

test("IE: county names", () => {
  assert.equal(normaliseCounty("co. cork"), "Cork");
  assert.equal(normaliseCounty("County Dublin"), "Dublin");
  assert.equal(normaliseCounty("Narnia"), null);
});

function csvFor(n: number) {
  const rows = [header];
  for (let i = 0; i < n; i++) {
    const day = String(1 + (i % 28)).padStart(2, "0");
    rows.push(`"${day}/09/2026","${i} Road","Cork","","${300000 + i * 10000}.00","No","No","${i % 2 ? "New" : "Second-Hand"} Dwelling house /Apartment",""`);
  }
  rows.push('"01/01/2025","Old","Cork","","100,000.00","No","No","Second-Hand Dwelling house /Apartment",""'); // outside window
  return rows.join("\n");
}

test("IE: trailing-12-month rows per county, kind and Ireland; small groups kept for the store to drop", () => {
  const { date, rows, from } = ieDailyRows(parseIePpr(csvFor(10)));
  assert.equal(date, "2026-09-10");
  assert.equal(from, "2025-09-10");
  const cork = rows.find((r) => r.area === "Cork" && r.item === "any")!;
  assert.equal(cork.n, 10);
  assert.equal(cork.median, 345000);
  assert.ok(rows.find((r) => r.area === "ALL" && r.item === "new")!.n === 5);
});

test("IE: zip reader", () => {
  const body = Buffer.from(live, "latin1");
  const comp = deflateRawSync(body);
  const name = Buffer.from("PPR-ALL.csv");
  const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(8, 8); lh.writeUInt16LE(name.length, 26);
  const local = Buffer.concat([lh, name, comp]);
  const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(comp.length, 20); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(0, 42);
  const cdir = Buffer.concat([ch, name]);
  const ee = Buffer.alloc(22); ee.writeUInt32LE(0x06054b50, 0); ee.writeUInt16LE(1, 10); ee.writeUInt32LE(cdir.length, 12); ee.writeUInt32LE(local.length, 16);
  assert.equal(unzipFirstFile(Buffer.concat([local, cdir, ee])).toString("latin1"), live);
  assert.throws(() => unzipFirstFile(Buffer.from("nope")));
});

test("IE: answer from a library row", () => {
  const a = ieAnswerFromRow({ date: "2026-09-30", area: "Dublin", item: "any", n: 9000, median: 450000, low: 280000, high: 750000, min: 50000, max: 5000000 }, { county: "Dublin", type: "any" });
  assert.equal(a.status, "ok");
  assert.equal(a.price?.currency, "EUR");
  assert.equal(a.period.from, "2025-09-30");
  assert.equal(ieHistoryKey({ county: "dublin" })?.area, "Dublin");
});
