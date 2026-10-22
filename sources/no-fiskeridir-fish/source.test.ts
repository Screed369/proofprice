// Tests for Norway first-hand fish sales (Fiskeridirektoratet). The header is the real one (probe of 2026-10-22, see fixtures.ts);
// rows are built from it with only the columns the source reads.
import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { HEADER } from "./fixtures";
import {
  INFO, aggregateSales, fishAnswerFromRows, fishHarvest, forEachZipLine, isoFromNo, matchDefs, defsFor, num, parseSale, readHeader, resolveCounty, skipLocalHeader, splitSemi, wanted,
} from "./source";
import type { Sale } from "./source";
import manifest from "./manifest.offline";

const COLS = HEADER.split(";");
const col = (name: string) => COLS.indexOf(name);

function row(v: { doc: string; date: string; nation?: string; county?: string; species: string; form?: string; weight?: string; price: string }): string {
  const cells = new Array(COLS.length).fill("");
  cells[col("Dokumentnummer")] = v.doc;
  cells[col("Landingsdato")] = v.date;
  cells[col("Landingsnasjon (kode)")] = v.nation ?? "NOR";
  cells[col("Landingsfylke")] = v.county ?? "Troms";
  cells[col("Art")] = v.species;
  cells[col("Produkttilstand")] = v.form ?? "Sløyd uten hode, rundsnitt";
  cells[col("Produktvekt")] = v.weight ?? "320";
  cells[col("Enhetspris for fisker")] = v.price;
  return cells.join(";");
}

/** A real-shaped zip: local header, raw deflate, then a fake central directory after the data. */
function zip(text: string): Buffer {
  const name = Buffer.from("fangstdata_2026.csv");
  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0);
  lh.writeUInt16LE(20, 4);
  lh.writeUInt16LE(8, 6); // flag bit 3: sizes follow the data
  lh.writeUInt16LE(8, 8);
  lh.writeUInt16LE(name.length, 26);
  const data = deflateRawSync(Buffer.from("﻿" + text, "utf8"));
  const tail = Buffer.concat([Buffer.from("PK\x07\x08"), Buffer.alloc(12), Buffer.from("PK\x01\x02central-directory-bytes")]);
  return Buffer.concat([lh, name, data, tail]);
}
async function* chunks(buf: Buffer, size: number) {
  for (let i = 0; i < buf.length; i += size) yield buf.subarray(i, i + size);
}

test("the real header maps every column the source needs", () => {
  const c = readHeader(HEADER);
  assert.equal(c.date, col("Landingsdato"));
  assert.equal(c.price, col("Enhetspris for fisker"));
  assert.equal(c.species, col("Art"));
  assert.throws(() => readHeader("a;b;c"), /column\(s\) .* not found/);
});

test("parses a sale: decimal comma, dd.mm.yyyy, Norwegian landings only, no price or weight dropped", () => {
  const c = readHeader(HEADER);
  const s = parseSale(row({ doc: "1145812", date: "08.05.2000", species: "Torsk", price: "19,6" }), c);
  assert.deepEqual(s, { doc: "1145812", date: "2000-05-08", county: "Troms", species: "Torsk", form: "Sløyd uten hode, rundsnitt", price: 19.6 });
  assert.equal(parseSale(row({ doc: "1", date: "08.05.2000", nation: "DNK", species: "Lange", price: "17,42" }), c), null);
  assert.equal(parseSale(row({ doc: "1", date: "08.05.2000", species: "Torsk", price: "0" }), c), null);
  assert.equal(parseSale(row({ doc: "1", date: "08.05.2000", species: "Torsk", price: "10", weight: "0" }), c), null);
  assert.equal(parseSale(row({ doc: "1", date: "bad", species: "Torsk", price: "10" }), c), null);
  assert.equal(isoFromNo("22.05.2000"), "2000-05-22");
  assert.equal(num("1 234,5"), 1234.5);
  assert.deepEqual(splitSemi('a;"b;c";d'), ["a", "b;c", "d"]);
});

const mk = (n: number, date: string, species: string, price: (i: number) => number, county = "Troms", form = "Rund"): Sale[] =>
  Array.from({ length: n }, (_, i) => ({ doc: `${species}${date}${i}`, date, county, species, form, price: price(i) }));

test("aggregates the newest week, needs 5 different sales notes per cell, adds the national row", () => {
  const sales = [
    ...mk(30, "2026-10-21", "Torsk", (i) => 30 + i),
    ...mk(10, "2026-10-18", "Torsk", (i) => 35 + i, "Nordland"),
    ...mk(4, "2026-10-20", "Hyse", () => 25), // only 4 sales notes: dropped
    ...mk(40, "2026-09-01", "Sei", () => 12), // older than the week
    ...mk(25, "2026-10-30", "Torsk", () => 99), // future landing date: ignored
  ];
  const a = aggregateSales(sales, "2026-10-22")!;
  assert.equal(a.date, "2026-10-21");
  const cod = a.rows.filter((r) => r.item === "Torsk, Rund");
  assert.deepEqual(cod.map((r) => r.area).sort(), ["ALL", "Nordland", "Troms"]);
  assert.equal(cod.find((r) => r.area === "ALL")!.n, 40);
  assert.equal(cod.find((r) => r.area === "Nordland")!.n, 10);
  assert.ok(!a.rows.some((r) => r.item.startsWith("Hyse") || r.item.startsWith("Sei")));
  assert.equal(aggregateSales(mk(5, "2026-10-21", "Torsk", () => 30), "2026-10-22"), null); // fewer than 20 lines on any day
});

test("a repeated sales note counts once towards the 5-note rule", () => {
  const one: Sale[] = Array.from({ length: 30 }, () => ({ doc: "same", date: "2026-10-21", county: "Troms", species: "Torsk", form: "Rund", price: 30 }));
  assert.deepEqual(aggregateSales(one, "2026-10-22")!.rows, []);
});

test("streams a zip in odd-sized pieces: header skipped, BOM removed, bytes after the deflate end ignored", async () => {
  const text = `${HEADER}\r\n${row({ doc: "1", date: "21.10.2026", species: "Torsk", price: "31,5" })}\n${row({ doc: "2", date: "21.10.2026", species: "Sei", price: "12" })}`;
  const z = zip(text);
  for (const size of [1, 7, 64, 100000]) {
    const lines: string[] = [];
    const n = await forEachZipLine(chunks(z, size), (l) => lines.push(l));
    assert.equal(n, 3, `size ${size}`);
    assert.ok(lines[0].startsWith("Dokumentnummer;"), "BOM removed");
    assert.ok(lines[1].includes("31,5"));
  }
  await assert.rejects(async () => { for await (const _ of skipLocalHeader(chunks(Buffer.from("not a zip file at all, really not one"), 5))) { /* drain */ } }, /not a zip/);
});

test("fishHarvest streams the current year through an injected opener and returns one library day", async () => {
  const lines = [HEADER];
  for (let i = 0; i < 30; i++) lines.push(row({ doc: `d${i}`, date: "21.10.2026", species: "Torsk", price: String(30 + i).replace(".", ",") }));
  for (let i = 0; i < 6; i++) lines.push(row({ doc: `s${i}`, date: "20.10.2026", species: "Sei", price: "12,5", county: "Nordland" }));
  for (let i = 0; i < 25; i++) lines.push(row({ doc: `x${i}`, date: "15.03.2026", species: "Sild", price: "8" })); // outside the 30-day window
  const opened: number[] = [];
  const h = await fishHarvest(new Date("2026-10-22T03:17:00Z"), async (year) => { opened.push(year); return chunks(zip(lines.join("\n")), 4096); });
  assert.deepEqual(opened, [2026]);
  assert.equal(h.date, "2026-10-21");
  assert.equal(h.currency, "NOK");
  assert.ok(h.rows.some((r) => r.area === "ALL" && r.item === "Torsk, Sløyd uten hode, rundsnitt" && r.n === 30));
  assert.ok(h.rows.some((r) => r.area === "Nordland" && r.item.startsWith("Sei")));
  assert.ok(!h.rows.some((r) => r.item.startsWith("Sild")));
  // early January also reads the previous year's file
  const early: number[] = [];
  await fishHarvest(new Date("2027-01-05T03:17:00Z"), async (year) => { early.push(year); return chunks(zip(lines.join("\n").replace(/2026/g, year === 2026 ? "2026" : "2027")), 4096); }).catch(() => undefined);
  assert.deepEqual(early, [2026, 2027]);
  await assert.rejects(fishHarvest(new Date("2026-10-22T03:17:00Z"), async () => chunks(zip(HEADER), 100)), /no landings with enough sales.*read 0 lines/);
});

const day = () => {
  const sales = [
    ...mk(40, "2026-10-21", "Torsk", (i) => 30 + (i % 10), "Troms", "Sløyd uten hode, rundsnitt"),
    ...mk(12, "2026-10-21", "Torsk", (i) => 18 + (i % 5), "Troms", "Rund"),
    ...mk(10, "2026-10-21", "Makrell", (i) => 10 + (i % 3), "Møre og Romsdal", "Rund"),
    ...mk(8, "2026-10-21", "Rødspette", () => 22, "Nordland", "Rund"),
    ...mk(10, "2026-10-21", "Blålange", () => 20, "Nordland", "Rund"),
  ];
  const a = aggregateSales(sales, "2026-10-22")!;
  return { date: a.date, rows: a.rows };
};

test("answers from the library: English or Norwegian names, best-supported product form, county", () => {
  const d = day();
  const a = fishAnswerFromRows(d, { product: "cod", today: "2026-10-23" });
  assert.equal(a.status, "ok");
  assert.equal(a.price_type, "transaction");
  assert.equal(a.sample_size, 40);
  assert.equal(a.price?.currency, "NOK");
  assert.ok(a.price!.median! >= 30 && a.price!.median! <= 40);
  assert.equal(a.period.to, "2026-10-21");
  assert.match(a.summary, /first-hand price paid to the fisher/);
  assert.deepEqual((a.extra as any).other_matches, ["Torsk, Rund"]);
  const n = fishAnswerFromRows(d, { product: "torsk", region: "troms", today: "2026-10-23" });
  assert.equal((n.extra as any).area, "Troms");
  assert.equal(fishAnswerFromRows(d, { product: "mackerel", region: "Møre og Romsdal" }).sample_size, 10);
  assert.equal(fishAnswerFromRows(d, { product: "plaice" }).status, "ok");
  assert.equal(fishAnswerFromRows(d, { product: "greenland halibut" }).status, "ok");
  assert.equal(fishAnswerFromRows(d, { product: "cod", today: "2026-12-01" }).extra && (fishAnswerFromRows(d, { product: "cod", today: "2026-12-01" }).extra as any).stale, true);
});

test("fewer than 5 sales notes, unknown fish or county are said plainly, never invented", () => {
  const d = day();
  const nm = fishAnswerFromRows(d, { product: "unicorn" });
  assert.equal(nm.status, "no_matches");
  assert.match(String((nm.extra as any).hint), /Species held include/);
  const thin = fishAnswerFromRows(d, { product: "makrell", region: "Troms" });
  assert.equal(thin.status, "no_matches");
  assert.throws(() => fishAnswerFromRows(d, { product: "cod", region: "Bavaria" }), /Counties with figures/);
  assert.throws(() => fishAnswerFromRows(d, { product: " " }), /product is required/);
});

test("helpers: word mapping and county matching", () => {
  assert.deepEqual(wanted("Atlantic cod"), ["torsk"]);
  assert.deepEqual(wanted("Rødspette"), ["rodspette"]);
  assert.equal(matchDefs(defsFor(day().rows, "ALL"), "sei").length, 0);
  assert.equal(resolveCounty(day().rows, "more og romsdal"), "Møre og Romsdal");
});

test("manifest: Norway only, licence and attribution stated, wholesale fresh food tool", () => {
  assert.deepEqual(manifest.countries, ["NO"]);
  assert.equal(manifest.category, "wholesale-fresh-food");
  assert.match(INFO.licence, /NLOD/);
  assert.match(INFO.attribution, /Fiskeridirektoratet/);
});

test("a file that lags behind today still gives its own newest week", async () => {
  const lines = [HEADER];
  for (let i = 0; i < 25; i++) lines.push(row({ doc: `a${i}`, date: "10.07.2026", species: "Torsk", price: "30" }));
  for (let i = 0; i < 25; i++) lines.push(row({ doc: `b${i}`, date: "01.03.2026", species: "Torsk", price: "50" }));
  const h = await fishHarvest(new Date("2026-10-22T03:17:00Z"), async () => chunks(zip(lines.join("\n")), 4096));
  assert.equal(h.date, "2026-07-10");
  assert.equal(h.rows.find((r) => r.area === "ALL")!.median, 30);
  assert.match(h.note!, /newest landing date in the file 2026-07-10/);
});
