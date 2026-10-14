import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { parseIePpr, ieDailyRows, unzipFirstFile, normaliseCounty, ieAnswerFromRow, ieHistoryKey, dublinDistrict, snapMonths, ieKey } from "./source";

// Header and first rows copied from the live file PPR-ALL.csv, probed 13 Oct 2026 (latin-1; euro sign lost in header).
const header = 'Date of Sale (dd/mm/yyyy),Address,County,Eircode,Price (),Not Full Market Price,VAT Exclusive,Description of Property,Property Size Description';
const live = [
  header,
  '"01/01/2010","5 Braemor Drive, Churchtown, Co.Dublin","Dublin","","343,000.00","No","No","Second-Hand Dwelling house /Apartment",""',
  '"03/01/2010","134 Ashewood Walk, Summerhill Lane, Portlaoise","Laois","","185,000.00","No","Yes","New Dwelling house /Apartment","greater than or equal to 38 sq metres and less than 125 sq metres"',
  '"04/01/2010","1 Meadow Avenue, Dundrum, Dublin 14","Dublin","","438,500.00","Yes","No","Second-Hand Dwelling house /Apartment",""',
].join("\n");

test("IE: parse by position; NFMP dropped, VAT-exclusive kept but flagged, Dublin district read", () => {
  const s = parseIePpr(live + '\n"05/01/2010","3 Foo Road, Ranelagh, Dublin 6","Dublin","","500,000.00","No","No","Teach/Árasán Cónaithe Atháimhe",""\n"06/01/2010","9 Bar, Dublin 6W","Dublin","","9,000.00","No","No","Second-Hand Dwelling house /Apartment",""');
  assert.equal(s.length, 3); // NFMP row and the under-10,000 row dropped; the Laois VAT-exclusive new home kept
  assert.deepEqual(s[0], { date: "2010-01-01", county: "Dublin", price: 343000, kind: "second-hand", district: null, vatExcl: false });
  assert.equal(s[1].kind, "new");
  assert.equal(s[1].vatExcl, true);
  assert.equal(s[2].district, "dublin-6");
  assert.equal(s[2].kind, "second-hand"); // Irish-language description
});

test("IE: county names, districts, months", () => {
  assert.equal(normaliseCounty("co. cork"), "Cork");
  assert.equal(normaliseCounty("County Dublin"), "Dublin");
  assert.equal(normaliseCounty("Narnia"), null);
  assert.equal(dublinDistrict("Dublin 6"), "dublin-6");
  assert.equal(dublinDistrict("d6w"), "dublin-6w");
  assert.equal(dublinDistrict("Dublin"), null);
  assert.equal(snapMonths(undefined), 12);
  assert.equal(snapMonths(5), 6);
  assert.equal(snapMonths(18), 12);
  assert.equal(snapMonths(100), 36);
  assert.deepEqual(ieKey({ town: "Dublin 6", property_type: "new", months: 33 }), { area: "dublin-6", item: "new:36m", label: "Dublin 6", type: "new", months: 36 });
  assert.equal(ieKey({})?.area, "ALL");
  assert.equal(ieKey({ town: "Narnia" }), null);
});

function csvFor(n: number) {
  const rows = [header];
  for (let i = 0; i < n; i++) {
    const day = String(1 + (i % 28)).padStart(2, "0");
    rows.push(`"${day}/09/2026","${i} Road, Dublin 6","Dublin","","${300000 + i * 10000}.00","No","${i % 2 ? "Yes" : "No"}","${i % 2 ? "New" : "Second-Hand"} Dwelling house /Apartment",""`);
  }
  rows.push('"01/01/2025","Old","Cork","","100,000.00","No","No","Second-Hand Dwelling house /Apartment",""'); // outside the 12-month window
  return rows.join("\n");
}

test("IE: rolling windows per county, district and Ireland", () => {
  const { date, rows } = ieDailyRows(parseIePpr(csvFor(10)));
  assert.equal(date, "2026-09-10");
  const get = (a: string, i: string) => rows.find((r) => r.area === a && r.item === i);
  assert.equal(get("dublin", "second-hand:12m")!.n, 5);
  assert.equal(get("dublin-6", "new:3m")!.n, 5);
  assert.equal(get("dublin", "any:12m")!.n, 5); // VAT-exclusive rows are left out of 'any'
  assert.equal(get("ALL", "any:36m")!.n, 6); // 5 Dublin + the Jan 2025 Cork sale, inside 36 months
  assert.equal(get("cork", "any:12m"), undefined);
  assert.equal(get("cork", "any:24m")!.n, 1); // emitted, but the store drops groups under 5
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
  const a = ieAnswerFromRow({ date: "2026-09-30", area: "dublin", item: "any:12m", n: 9000, median: 450000, low: 280000, high: 750000, min: 50000, max: 5000000 }, { label: "Dublin", type: "any", months: 12 });
  assert.equal(a.status, "ok");
  assert.equal(a.price?.currency, "EUR");
  assert.equal(a.period.from, "2025-09-30");
  assert.equal(ieHistoryKey({ town: "dublin 6", months: 24 })?.item, "any:24m");
});

test("IE: bulk or portfolio records above 10 million are dropped (14 Oct 2026: a Dublin max of 217,488,769 was seen live)", () => {
  const s = parseIePpr(
    header + '\n"01/09/2026","Block A, Dublin 2","Dublin","","217,488,769.00","No","No","New Dwelling house /Apartment",""\n"02/09/2026","1 Road, Dublin 4","Dublin","","10,000,000.00","No","No","Second-Hand Dwelling house /Apartment",""\n"02/09/2026","2 Road, Dublin 4","Dublin","","10,000,001.00","No","No","Second-Hand Dwelling house /Apartment",""',
  );
  assert.equal(s.length, 1);
  assert.equal(s[0].price, 10000000);
});

test("IE: the answer echoes the town parameter as 'town'", () => {
  const a = ieAnswerFromRow({ date: "2026-09-30", n: 50, median: 400000, low: 300000, high: 600000, min: 200000, max: 900000 } as never, { label: "Dublin", type: "any", months: 12 });
  assert.equal((a.query as Record<string, unknown>).town, "Dublin");
  assert.equal((a.query as Record<string, unknown>).place, undefined);
});
