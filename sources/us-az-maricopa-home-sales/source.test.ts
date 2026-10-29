import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  parseSales, createSalesParser, kindOf, dailyRows, zipEntry, parseZip, resolveArea, maricopaKey, maricopaHistoryKey, maricopaHomeSales,
  isMaricopaRequest, monthIndex, idxEndDate, type Sale,
} from "./source";

// Fixture: the real header and first rows of Data/Sales_Affidavits.txt, probed from GitHub Actions on 29 Oct 2026 (probe maricopa-sales).
// Names, addresses and parcel numbers are blanked in the fixture; the columns we read are untouched.
const head = readFileSync(path.join(__dirname, "fixtures", "sales-head.txt"), "utf8");

test("US-AZ-Maricopa: property kinds (the file cuts the description at 20 characters)", () => {
  assert.equal(kindOf("Single Family Reside"), "house");
  assert.equal(kindOf("Condo/Townhouse"), "condo");
  assert.equal(kindOf("Vacant Land"), null);
  assert.equal(kindOf("Commercial/Industria"), null);
  assert.equal(kindOf(""), null);
});

test("US-AZ-Maricopa: parse the live head: houses and condos with a price only; no names, addresses or parcel numbers kept", () => {
  const s = parseSales(head);
  assert.deepEqual(s.map((x) => [x.idx, x.city, x.zip, x.kind, x.price]), [
    [monthIndex(1999, 12), "phoenix", "85009", "house", 71000],
    [monthIndex(1999, 12), "sun-city", "85373", "house", 127400],
    [monthIndex(2000, 1), "phoenix", "85014", "condo", 134500],
  ]);
  assert.ok(Object.keys(s[0]).every((k) => ["idx", "city", "zip", "kind", "price"].includes(k)));
});

test("US-AZ-Maricopa: related-party, partial-interest, multi-parcel, personal-property, quit-claim and out-of-range sales are dropped", () => {
  const h = "SALEDATE_MMYYYY|SALEPRICE|DEEDTYPE|PROPERTYTYPEDESCRIPTION|SITUSCITY|SITUSZIP|PARTIALINTERESTINDICATOR|MULTIPARCELINDICATOR|NUMBEROFPARCELS|BUY_SELLRELATIONSHIPINDICATOR|PERSONALPROPERTYINDICATOR\n";
  const row = (price: string, deed = "WD", partial = "N", multi = "N", n = "0", rel = "N", pp = "N") =>
    `092026|${price}|${deed}|Single Family Reside|MESA|85203|${partial}|${multi}|${n}|${rel}|${pp}\n`;
  const s = parseSales(h + row("400000") + row("400000", "WD", "N", "Y", "1") + row("400000", "QD") + row("400000", "WD", "Y") + row("400000", "WD", "N", "Y", "3") +
    row("400000", "WD", "N", "N", "0", "Y") + row("400000", "WD", "N", "N", "0", "N", "Y") + row("10") + row("") + row("12000000") + row("29999"));
  assert.deepEqual(s.map((x) => x.price), [400000, 400000]); // plain sale, and a multi-parcel flag with a single parcel
});

test("US-AZ-Maricopa: a changed header fails loudly; chunked input gives the same result as one piece", () => {
  assert.throws(() => parseSales("A|B|C\n1|2|3\n"), /unexpected layout/);
  const p = createSalesParser(0);
  for (let i = 0; i < head.length; i += 97) p.push(head.slice(i, i + 97));
  assert.equal(p.end().sales.length, 3);
  assert.equal(p.end ? parseSales(head, monthIndex(2000, 1)).length : 0, 1); // minIdx drops older months
});

const mk = (city: string, zip: string, n: number, price: number, idx: number, kind: "house" | "condo" = "house"): Sale[] =>
  Array.from({ length: n }, (_, i) => ({ idx, city, zip, kind, price: price + i * 1000 }));

test("US-AZ-Maricopa: daily rows: windows end at the newest month, under 5 sales never published, county ALL row, ZIPs only 12/24", () => {
  const last = monthIndex(2026, 9);
  const sales = [...mk("scottsdale", "85251", 6, 600000, last), ...mk("tempe", "85281", 4, 400000, last), ...mk("mesa", "85203", 5, 300000, last - 14), ...mk("mesa", "85203", 5, 310000, last - 1, "condo")];
  const { date, rows } = dailyRows(sales, "2026-10-29");
  assert.equal(date, "2026-09-30");
  const get = (a: string, i: string) => rows.find((r) => r.area === a && r.item === i);
  assert.equal(get("scottsdale", "any:12m")?.n, 6);
  assert.equal(get("scottsdale", "house:3m")?.median, 602500);
  assert.equal(get("scottsdale", "condo:12m"), undefined);
  assert.equal(get("tempe", "any:12m"), undefined); // 4 sales
  assert.equal(get("mesa", "any:12m")?.n, 5); // only the condos from last month
  assert.equal(get("mesa", "any:24m")?.n, 10);
  assert.equal(get("ALL", "any:12m")?.n, 15);
  assert.equal(get("zip-85251", "any:12m")?.n, 6);
  assert.equal(get("zip-85251", "any:3m"), undefined);
  assert.equal(rows.filter((r) => r.n < 5).length, 0);
  assert.equal(idxEndDate(monthIndex(2026, 2)), "2026-02-28");
  assert.throws(() => dailyRows([], "2026-10-29"), /no usable/);
});

test("US-AZ-Maricopa: request routing: Arizona requests come here, Connecticut / Chicago / New York / Washington DC do not", () => {
  assert.equal(isMaricopaRequest({ town: "Phoenix" }), true);
  assert.equal(isMaricopaRequest({ town: "Scottsdale, AZ" }), true);
  assert.equal(isMaricopaRequest({ town: "Sun City West" }), true);
  assert.equal(isMaricopaRequest({ town: "Maricopa County" }), true);
  assert.equal(isMaricopaRequest({ state: "AZ" }), true);
  assert.equal(isMaricopaRequest({ postcode: "85016" }), true);
  assert.equal(isMaricopaRequest({ town: "Hartford" }), false);
  assert.equal(isMaricopaRequest({ town: "Chicago" }), false);
  assert.equal(isMaricopaRequest({ town: "Brooklyn" }), false);
  assert.equal(isMaricopaRequest({ postcode: "11201" }), false);
  assert.equal(isMaricopaRequest({ town: "Washington, DC" }), false);
  assert.equal(isMaricopaRequest({ state: "CT", town: "Phoenix" }), false);
  assert.equal(isMaricopaRequest({}), false);
});

test("US-AZ-Maricopa: place names: city with state, ZIP, county, unknown", () => {
  const known = ["phoenix", "scottsdale", "sun-city", "zip-85016", "zip-85251"];
  assert.deepEqual(resolveArea({ town: "Phoenix, AZ" }, known), { area: "phoenix", label: "Phoenix, AZ" });
  assert.equal(resolveArea({ town: "Sun City" }, known)?.area, "sun-city");
  assert.deepEqual(resolveArea({ postcode: "85016" }, known), { area: "zip-85016", label: "ZIP 85016" });
  assert.equal(resolveArea({ postcode: "85999" }, known), null);
  assert.equal(resolveArea({}, known)?.area, "ALL");
  assert.equal(resolveArea({ town: "Narnia" }, known), null);
  assert.equal(maricopaKey({ town: "Phoenix", months: 5, property_type: "condo" }, known)?.item, "condo:6m");
  assert.equal(maricopaKey({ postcode: "85016", months: 5 }, known)?.item, "any:12m");
  assert.equal(maricopaKey({ town: "Phoenix", property_type: "castle" }, known), null);
});

test("US-AZ-Maricopa: zip reading: the named entry is found among several and inflated in a stream", async () => {
  const entries: { name: string; raw: Buffer; data: Buffer }[] = [
    { name: "File Spec/Sales Affidavits - File Spec.pdf", raw: Buffer.from("%PDF-1.4 not the data"), data: Buffer.alloc(0) },
    { name: "Data/Sales_Affidavits.txt", raw: Buffer.from(head, "utf8"), data: Buffer.alloc(0) },
  ];
  const parts: Buffer[] = [];
  const cds: Buffer[] = [];
  let off = 0;
  for (const e of entries) {
    e.data = deflateRawSync(e.raw);
    const name = Buffer.from(e.name);
    const lfh = Buffer.alloc(30); lfh.writeUInt32LE(0x04034b50, 0); lfh.writeUInt16LE(8, 8); lfh.writeUInt32LE(e.data.length, 18); lfh.writeUInt32LE(e.raw.length, 22); lfh.writeUInt16LE(name.length, 26);
    const cdh = Buffer.alloc(46); cdh.writeUInt32LE(0x02014b50, 0); cdh.writeUInt16LE(8, 10); cdh.writeUInt32LE(e.data.length, 20); cdh.writeUInt32LE(e.raw.length, 24); cdh.writeUInt16LE(name.length, 28); cdh.writeUInt32LE(off, 42);
    parts.push(lfh, name, e.data);
    cds.push(cdh, name);
    off += 30 + name.length + e.data.length;
  }
  const cd = Buffer.concat(cds);
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(2, 10); eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(off, 16);
  const zip = Buffer.concat([...parts, cd, eocd]);
  assert.equal(zipEntry(zip, /Sales_Affidavits\.txt$/).method, 8);
  assert.throws(() => zipEntry(zip, /nothing\.txt$/), /does not contain/);
  const { sales, rows } = await parseZip(zip, 0);
  assert.equal(rows, 7);
  assert.equal(sales.length, 3);
});

test("US-AZ-Maricopa: answer from the library: free, labelled, widened window, thin area, ZIP, unknown place", async () => {
  const id = "us-az-maricopa-home-sales";
  const dir = mkdtempSync(path.join(tmpdir(), "maricopa-lib-"));
  mkdirSync(path.join(dir, id, "daily"), { recursive: true });
  writeFileSync(path.join(dir, id, "meta.json"), JSON.stringify({ last_date: "2026-09-30" }));
  writeFileSync(path.join(dir, id, "daily", "2026-09.csv"), [
    "date,area,item,n,median,low,high,min,max",
    "2026-09-30,phoenix,house:12m,5200,430000,290000,700000,100000,5000000",
    "2026-09-30,phoenix,condo:12m,900,300000,180000,520000,60000,2000000",
    "2026-09-30,sun-city,any:24m,7,250000,180000,320000,150000,400000",
    "2026-09-30,zip-85016,any:12m,300,380000,220000,800000,80000,3000000",
    "2026-09-30,ALL,any:12m,60000,445000,270000,800000,35000,9000000",
  ].join("\n") + "\n");
  const prev = process.env.PROOFPRICE_LIBRARY_DIR;
  process.env.PROOFPRICE_LIBRARY_DIR = dir;
  try {
    const a = await maricopaHomeSales({ town: "Phoenix, AZ", property_type: "house" });
    assert.equal(a.status, "ok");
    assert.equal(a.sample_size, 5200);
    assert.match(a.summary, /median recorded sale price of US\$430,000/);
    assert.equal(a.source.id ?? (a as any).source_id ?? id, id);
    const w = await maricopaHomeSales({ town: "Sun City" });
    assert.equal((w.extra as any).window_widened, true);
    assert.equal(w.sample_size, 7);
    const z = await maricopaHomeSales({ postcode: "85016" });
    assert.equal(z.sample_size, 300);
    assert.equal((await maricopaHomeSales({ state: "AZ" } as any)).sample_size, 60000);
    await assert.rejects(maricopaHomeSales({ town: "Narnia" }), /No figure for/);
    await assert.rejects(maricopaHomeSales({ town: "Phoenix", property_type: "castle" }), /property_type must be/);
    assert.deepEqual(maricopaHistoryKey({ town: "Phoenix", property_type: "house" }), { area: "phoenix", item: "house:12m", label: "Phoenix, AZ, Maricopa County" });
    const thin = await maricopaHomeSales({ town: "Phoenix", property_type: "condo", months: 3 });
    assert.equal(thin.sample_size, 900); // widened to 12m
    const none = await maricopaHomeSales({ town: "Sun City", property_type: "house" });
    assert.notEqual(none.status, "ok");
    assert.equal(none.price, null);
  } finally {
    if (prev === undefined) delete process.env.PROOFPRICE_LIBRARY_DIR; else process.env.PROOFPRICE_LIBRARY_DIR = prev;
  }
});
