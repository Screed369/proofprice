import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import {
  aggregateAll, columnsOf, contractOf, CsvReader, INFO, isoDate, newCounts, newestDenseDate, newestOf, ngContracts, ngHarvest, resolveItem, tarEntry, themesOf,
  windowStart,
} from "./source";
import { writeDaily, writeMeta } from "../../lib/library/store";
import { InputError, SourceError } from "../../lib/http";

// Header and rows copied from the live full/contracts.csv inside full.csv.tar.gz (Open Contracting Partnership publication 64, checked 2026-11-03).
const HEADER = "id,awardID,title,description,dateSigned,status,value_amount,value_currency,period_endDate,period_startDate,period_durationInDays,main_ocid,main_id";
const REAL = [
  "18632,18970,Award of contract for Supply and Installation of Street Light in Adamawa North Senatorial District,Supply and Installation of Street Light in Adamawa North Senatorial District,2024-06-28T00:00:00Z,active,48994296.75,NGN,,,,ocds-gyl66f-215011001-000112,ocds-gyl66f-215011001-000112-2025-07-17T13:42:00Z",
  "10059,10193,CONTRACT FOR THE SUPPLY AND INSTALLATION OF 11 (NOS.) X-RAY LUGGAGE SCANNERS FOR THE CORPORATION,CONTRACT FOR THE SUPPLY AND INSTALLATION OF 11 (NOS.) X-RAY LUGGAGE SCANNERS FOR THE CORPORATION,2024-06-06T00:00:00Z,active,210700000,NGN,,,,ocds-gyl66f-220001001-000271,ocds-gyl66f-220001001-000271-2024-09-04T10:35:00Z",
  '13777,14028,"PURCHASE OF PROPERTY LOCATED AT NO. 3/5 DANJUMA DRIVE, PORT HARCOURT, RIVERS STATE FOR THE PROPOSED CONSTRUCTION","PURCHASE OF PROPERTY LOCATED AT NO. 3/5 DANJUMA DRIVE, PORT HARCOURT",2024-06-05T00:00:00Z,active,1470000000,NGN,,,,ocds-gyl66f-220007049-002070,ocds-gyl66f-220007049-002070-2025-01-28T11:57:00Z',
];
const TODAY = "2026-11-03";
const line = (o: { id: string; title?: string; date?: string; status?: string; value?: string; cur?: string }) =>
  `${o.id},9${o.id},${o.title ?? "Supply of vehicles"},desc,${o.date ?? "2024-06-10T00:00:00Z"},${o.status ?? "active"},${o.value ?? "50000000"},${o.cur ?? "NGN"},,,,ocds-x-${o.id},main-${o.id}`;
const cols = columnsOf(HEADER.split(","));
function parse(csvLine: string) {
  const rows: string[][] = [];
  const r = new CsvReader((x) => rows.push(x));
  r.push(csvLine + "\n");
  r.end();
  return rows[0];
}

/** A tiny ustar archive: one 512-byte header per file, data padded to 512, two empty blocks at the end. */
function tar(files: { name: string; data: string }[]): Buffer {
  const parts: Buffer[] = [];
  for (const f of files) {
    const data = Buffer.from(f.data, "utf8");
    const h = Buffer.alloc(512);
    h.write(f.name, 0, "utf8");
    h.write("0000644\0", 100);
    h.write(data.length.toString(8).padStart(11, "0") + "\0", 124);
    h.write("0", 156);
    h.write("ustar\0", 257);
    parts.push(h, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}
const pieces = (b: Buffer, chunk = 700) => async () =>
  (async function* () {
    for (let i = 0; i < b.length; i += chunk) yield b.subarray(i, i + chunk);
  })();

test("CsvReader: quotes with commas, doubled quotes, line breaks inside quotes, tiny pieces", () => {
  const text = 'a,"b, c","say ""hi""",d\r\n1,"line1\nline2",,\r\n\r\nlast,row';
  for (const size of [1, 3, 1000]) {
    const rows: string[][] = [];
    const r = new CsvReader((x) => rows.push(x));
    for (let i = 0; i < text.length; i += size) r.push(text.slice(i, i + size));
    r.end();
    assert.deepEqual(rows, [["a", "b, c", 'say "hi"', "d"], ["1", "line1\nline2", "", ""], ["last", "row"]], `size ${size}`);
  }
});

test("live rows (checked 2026-11-03): street light, X-ray scanners, a quoted title with commas", () => {
  const [a, b, c] = REAL.map((l) => contractOf(parse(l), cols, TODAY));
  assert.deepEqual(a, { id: "18632", date: "2024-06-28", value: 48994296.75, themes: ["power"] });
  assert.deepEqual(b?.themes, ["security"]);
  assert.equal(c?.value, 1470000000);
  assert.deepEqual(c?.themes, ["buildings"]);
});

test("columnsOf finds the needed columns and complains when one is missing", () => {
  assert.equal(cols.value_amount, 6);
  assert.throws(() => columnsOf(["id", "title"]), /no column/);
});

test("contractOf: keeps active naira contracts; drops cancelled, other currency, placeholder values, future and missing dates", () => {
  assert.ok(contractOf(parse(line({ id: "1" })), cols, TODAY));
  assert.equal(contractOf(parse(line({ id: "2", status: "cancelled" })), cols, TODAY), null);
  assert.equal(contractOf(parse(line({ id: "3", cur: "USD" })), cols, TODAY), null);
  assert.equal(contractOf(parse(line({ id: "4", value: "0" })), cols, TODAY), null);
  assert.equal(contractOf(parse(line({ id: "5", value: "9999" })), cols, TODAY), null);
  assert.equal(contractOf(parse(line({ id: "6", value: "abc" })), cols, TODAY), null);
  assert.equal(contractOf(parse(line({ id: "7", date: "2028-03-01T00:00:00Z" })), cols, TODAY), null);
  assert.equal(contractOf(parse(line({ id: "8", date: "" })), cols, TODAY), null);
  assert.equal(contractOf(parse(line({ id: "9", date: "1949-01-01T00:00:00Z" })), cols, TODAY), null);
  assert.equal(isoDate("2024-02-31T00:00:00Z"), "");
  assert.equal(isoDate("2024-06-27T00:00:00Z"), "2024-06-27");
});

test("themesOf: whole words in the title; one contract can sit in several themes", () => {
  assert.deepEqual(themesOf("SUPPLY OF AGO"), ["fuel"]);
  assert.deepEqual(themesOf("Limited Rehabilitation of Challenge Interchange - Molete Road"), ["roads", "rehabilitation"]);
  assert.deepEqual(themesOf("PURCHASE OF A 200TB NETAPP STORAGE FOR DATA CENTRE"), ["ict"]);
  assert.deepEqual(themesOf("Supply of 2 Units of Operational Vehicles (30 seater coaster Bus)"), ["vehicles"]);
  assert.deepEqual(themesOf("Supply of stationery"), []);
  assert.ok(!themesOf("District council office").includes("ict"), "'ict' must not match inside 'District'");
});

test("newestDenseDate: ignores stray later contracts and thin months", () => {
  const mk = (n: number, month: string) => Array.from({ length: n }, (_, i) => ({ id: month + i, date: `${month}-${String(10 + (i % 15)).padStart(2, "0")}`, value: 1e6, themes: [] as string[] }));
  const all = [...mk(30, "2024-10"), ...mk(25, "2024-11"), ...mk(3, "2025-04"), ...mk(1, "2026-08")];
  assert.equal(newestDenseDate(all), "2024-11-24");
  assert.equal(newestDenseDate(mk(3, "2024-01")), null);
  assert.equal(windowStart("2024-11-24"), "2022-11-25");
});

test("aggregateAll: all plus every theme with 5 distinct contracts; a contract counts once, and in each of its themes", () => {
  const mk = (n: number, themes: string[], base: number) => Array.from({ length: n }, (_, i) => ({ id: `${themes.join("")}${i}`, date: "2024-06-01", value: base + i, themes }));
  const five = mk(5, ["power", "security"], 1_000_000);
  const rows = aggregateAll([...five, five[0], ...mk(4, ["fuel"], 5000), { id: "old", date: "2019-01-01", value: 9e9, themes: ["power"] }], "2022-11-25", "2024-11-24");
  assert.deepEqual(rows.map((r) => [r.item, r.n]), [["all", 9], ["t:power", 5], ["t:security", 5]]);
  assert.equal(rows.find((r) => r.item === "t:power")!.median, 1000002);
});

test("tarEntry: finds the named file among others, across tiny chunks, and stops reading others", async () => {
  const big = "x".repeat(1300);
  const archive = tar([{ name: "full/awards.csv", data: big }, { name: "full/contracts.csv", data: "a,b\n1,2\n" }, { name: "full/main.csv", data: big }]);
  for (const size of [1, 100, 511, 512, 513, 5000]) {
    let got = "";
    const found = await tarEntry(await pieces(archive, size)(), "contracts.csv", (c) => (got += Buffer.from(c).toString("utf8")));
    assert.equal(found, true, `size ${size}`);
    assert.equal(got, "a,b\n1,2\n", `size ${size}`);
  }
  assert.equal(await tarEntry(await pieces(archive)(), "nothing.csv", () => {}), false);
});

function csvWith(lines: string[]): string {
  return "﻿" + HEADER + "\n" + lines.join("\n") + "\n";
}

test("harvest: gunzips the tar, reads contracts.csv only, keeps aggregates; answers then come from the library", async () => {
  const lines = [
    ...REAL,
    ...Array.from({ length: 24 }, (_, i) => line({ id: `v${i}`, title: "Supply of vehicles", date: `2024-11-${String(1 + (i % 28)).padStart(2, "0")}T00:00:00Z`, value: String(40_000_000 + i * 1_000_000) })),
    ...Array.from({ length: 6 }, (_, i) => line({ id: `r${i}`, title: "Construction of road", date: "2024-03-10T00:00:00Z", value: String(200_000_000 + i) })),
    line({ id: "v0", value: "999999999999" }), // same contract again: counted once
    line({ id: "c1", status: "cancelled" }),
    line({ id: "usd", cur: "USD" }),
    line({ id: "future", date: "2028-01-01T00:00:00Z" }),
    line({ id: "old", date: "2016-01-01T00:00:00Z" }),
  ];
  const archive = gzipSync(tar([{ name: "full/awards.csv", data: "id,x\n1,2\n" }, { name: "full/contracts.csv", data: csvWith(lines) }]));
  const dir = mkdtempSync(path.join(tmpdir(), "ngbpp-"));
  process.env.PROOFPRICE_LIBRARY_DIR = dir;
  try {
    const h = await ngHarvest(new Date("2026-11-03T03:17:00Z"), { open: pieces(archive, 900) });
    assert.equal(h.currency, "NGN");
    assert.equal(h.date, "2026-11-03");
    assert.equal(newestOf(h.rows), "2024-11-24");
    const veh = h.rows.find((r) => r.item === "t:vehicles")!;
    assert.equal(veh.n, 24);
    assert.equal(h.rows.find((r) => r.item === "all")!.n, 3 + 24 + 6 + 1 - 1 + 0); // 3 live rows + 24 + 6 roads; 'old' is outside the window, repeat is one contract
    assert.ok(h.rows.some((r) => r.item === "newest:2024-11-24" && Number.isNaN(r.n)), "marker row carries the newest date and no count");
    assert.match(h.note ?? "", /Contracts signed 2022-11-25 to 2024-11-24/);
    assert.match(h.note ?? "", /cancelled 1/);
    writeDaily(INFO.id, h);
    writeMeta(INFO.id, { source: INFO.id, currency: "NGN", unit: h.unit, first_date: h.date, last_date: h.date, days: 1, last_harvest_at: "x", last_rows: h.rows.length, last_ok_at: "x", last_error: null });

    const a = await ngContracts({ what: "vehicles" });
    assert.equal(a.status, "ok");
    assert.equal(a.price_type, "contract_price");
    assert.equal(a.price?.currency, "NGN");
    assert.equal(a.sample_size, 24);
    assert.deepEqual(a.period, { from: "2022-11-25", to: "2024-11-24" });
    assert.match(a.summary, /not unit prices/);
    assert.equal((await ngContracts({ what: "Roads" })).sample_size, 6);
    assert.equal((await ngContracts({ what: "all" })).status, "ok");
    await assert.rejects(ngContracts({ what: "ships" }), (e: any) => e instanceof InputError && /vehicles/.test(e.message));
    await assert.rejects(ngContracts({ what: "all", cpv: "30" }), InputError);
    await assert.rejects(ngContracts({ what: "all", buyer_area: "Lagos" }), InputError);
    // fewer than 5 contracts in a theme: no row, so no figure
    assert.ok(!h.rows.some((r) => r.item === "t:fuel"));
  } finally {
    delete process.env.PROOFPRICE_LIBRARY_DIR;
  }
});

test("harvest errors: no contracts.csv in the archive, format change, nothing dense, unreadable file", async () => {
  const now = new Date("2026-11-03T03:17:00Z");
  const noEntry = gzipSync(tar([{ name: "full/awards.csv", data: "a\n1\n" }]));
  await assert.rejects(ngHarvest(now, { open: pieces(noEntry) }), /no contracts\.csv/);
  const badCols = gzipSync(tar([{ name: "full/contracts.csv", data: "a,b\n1,2\n" }]));
  await assert.rejects(ngHarvest(now, { open: pieces(badCols) }), /no column/);
  const thin = gzipSync(tar([{ name: "full/contracts.csv", data: csvWith([line({ id: "1" }), line({ id: "2" })]) }]));
  await assert.rejects(ngHarvest(now, { open: pieces(thin) }), /no month with 20/);
  await assert.rejects(ngHarvest(now, { open: async () => Promise.reject(new Error("socket hang up")) }), (e: any) => e instanceof SourceError && /Could not read the Nigeria contracts file/.test(e.message));
});

test("resolveItem: ids, labels, common words, partial words, 'all' and unknown words", () => {
  const items = ["all", "t:vehicles", "t:roads", "t:ict", "t:fuel", "t:power"];
  assert.equal(resolveItem("Vehicles", items).item, "t:vehicles");
  assert.equal(resolveItem("road", items).item, "t:roads");
  assert.equal(resolveItem("laptops", items).item, "t:ict");
  assert.equal(resolveItem("diesel", items).item, "t:fuel");
  assert.equal(resolveItem("solar", items).item, "t:power");
  assert.equal(resolveItem("ALL", items).item, "all");
  assert.throws(() => resolveItem("quantum widgets", items), (e: any) => e instanceof InputError && /vehicles, fuel/.test(e.message));
});

test("no library yet gives a readable error", async () => {
  process.env.PROOFPRICE_LIBRARY_DIR = mkdtempSync(path.join(tmpdir(), "ngbpp-empty-"));
  try {
    await assert.rejects(ngContracts({ what: "all" }), /not been collected yet/);
  } finally {
    delete process.env.PROOFPRICE_LIBRARY_DIR;
  }
  assert.equal(newCounts().rows, 0);
});

test("INFO: public-domain licence read on the publisher's page, contract prices, no suppliers", () => {
  assert.match(INFO.licence, /ODC Public Domain Dedication/);
  assert.match(INFO.licence_url, /^https:\/\//);
  assert.match(INFO.licence, /nocopo\.bpp\.gov\.ng\/license/);
  assert.equal(INFO.price_type, "contract_price");
  assert.match(INFO.limits, /suppliers in the open file are never read/);
  assert.match(INFO.attribution, /NOCOPO/);
});
