// Fixture: real rows copied on 2026-11-08 from IRW_2026_Polygon.dbf inside IRW_EPSG25832_Shape.zip
// (https://www.opengeodata.nrw.de/produkte/infrastruktur_bauen_wohnen/boris/IRW/, 19,388 rows, UTF-8, STAG 01.01.2026).
// Columns kept: GENA, IMRW, STAG, TEILMA, OBJGR, IRWTYP. Field widths are the live ones; the .dbf below is built to the dBase III layout of the live file.
// Extra rows marked SYNTH are added by the test (first sale, mixed type, municipality-wide) to prove they are left out.
import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import manifest from "./index";
import { InputError } from "../../lib/http";
import { NATIONAL } from "../../lib/library/aggregate";
import { INFO, MIN_ZONES, Row, findArea, fold, harvestFrom, kindOf, nrwHistoryKey, nrwHomePrices, parseDbf, reuseStored, unzipFind } from "./source";

const REAL: string[][] = [
  ["Bielefeld", "2380", "01.01.2026", "1", "3", "1"], ["Bielefeld", "2930", "01.01.2026", "1", "3", "1"], ["Bielefeld", "3060", "01.01.2026", "1", "3", "1"],
  ["Bielefeld", "2270", "01.01.2026", "1", "3", "1"], ["Bielefeld", "1900", "01.01.2026", "1", "3", "1"], ["Bielefeld", "2330", "01.01.2026", "1", "3", "1"],
  ["Köln", "4610", "01.01.2026", "1", "3", "1"], ["Köln", "4990", "01.01.2026", "1", "3", "1"], ["Köln", "10400", "01.01.2026", "1", "3", "1"],
  ["Köln", "5760", "01.01.2026", "1", "3", "1"], ["Köln", "5070", "01.01.2026", "1", "3", "1"], ["Köln", "5010", "01.01.2026", "1", "3", "1"],
  ["Köln", "11700", "01.01.2026", "2", "3", "1"], ["Köln", "4200", "01.01.2026", "2", "3", "1"], ["Köln", "6000", "01.01.2026", "2", "3", "1"],
  ["Köln", "5600", "01.01.2026", "2", "3", "1"], ["Köln", "8300", "01.01.2026", "2", "3", "1"], ["Köln", "5900", "01.01.2026", "2", "3", "1"],
  ["Düren", "1580", "01.01.2026", "1", "3", "2"],
  ["Münster", "2200", "01.01.2026", "1", "3", "1"], ["Münster", "3000", "01.01.2026", "1", "3", "1"], ["Münster", "2900", "01.01.2026", "1", "3", "1"],
  ["Münster", "2900", "01.01.2026", "1", "3", "1"], ["Münster", "2800", "01.01.2026", "1", "3", "1"],
];
const SYNTH: string[][] = [
  ["Köln", "9999", "01.01.2026", "1", "1", "1"], // first sale (new build): left out
  ["Köln", "8888", "01.01.2026", "4", "3", "1"], // multi-family: left out
  ["Münster", "7777", "01.01.2026", "1", "3", "1"], // this one makes Münster flats 6 zones
];

function dbf(rows: string[][]): Buffer {
  const spec: [string, number][] = [["GENA", 30], ["IMRW", 5], ["STAG", 10], ["TEILMA", 1], ["OBJGR", 1], ["IRWTYP", 1]];
  const recLen = 1 + spec.reduce((s, [, l]) => s + l, 0);
  const headerLen = 32 + spec.length * 32 + 1;
  const head = Buffer.alloc(headerLen);
  head.writeUInt8(3, 0);
  head.writeUInt32LE(rows.length, 4);
  head.writeUInt16LE(headerLen, 8);
  head.writeUInt16LE(recLen, 10);
  spec.forEach(([n, l], i) => { head.write(n, 32 + i * 32, "latin1"); head.write("C", 32 + i * 32 + 11, "latin1"); head.writeUInt8(l, 32 + i * 32 + 16); });
  head.writeUInt8(0x0d, headerLen - 1);
  const body = rows.map((r) => {
    const b = Buffer.alloc(recLen, 0x20);
    let off = 1;
    spec.forEach(([, l], i) => { const t = Buffer.from(r[i], "utf8"); t.copy(b, off, 0, Math.min(l, t.length)); off += l; });
    return b;
  });
  return Buffer.concat([head, ...body, Buffer.from([0x1a])]);
}

test("parseDbf: keeps resale zone values of flats, detached and terraced houses; leaves out first sales, mixed types and municipality-wide values", () => {
  const p = parseDbf(dbf([...REAL, ...SYNTH]));
  assert.equal(p.records, REAL.length + SYNTH.length);
  assert.equal(p.zones.length, REAL.length + SYNTH.length - 3); // Köln first sale, Köln mixed, Düren IRWTYP 2 left out
  assert.ok(p.zones.every((z) => z.stichtag === "2026-01-01"));
  assert.ok(!p.zones.some((z) => z.value === 9999 || z.value === 8888 || z.value === 1580));
  assert.equal(p.zones.filter((z) => z.committee === "Köln" && z.kind === "house").length, 6);
});

test("parseDbf: refuses a table with a new layout", () => {
  const b = dbf(REAL);
  b.write("IMXX", 32 + 1 * 32, "latin1"); // rename the IMRW column
  assert.throws(() => parseDbf(b), /new layout \(no IMRW column\)/);
});

function manyAreas(): ReturnType<typeof parseDbf> {
  const p = parseDbf(dbf([...REAL, ...SYNTH]));
  // SYNTH2: 60 invented towns built from Bielefeld's real values so the file looks like the whole state (the real file has 244 areas)
  for (let i = 0; i < 60; i++) for (const r of REAL.slice(0, 6)) p.zones.push({ committee: `Testort ${i}`, kind: "apartment", value: Number(r[1]), stichtag: "2026-01-01" });
  return p;
}

test("harvest: one row per committee area and type with at least MIN_ZONES zones, plus the NRW-wide ALL row; n is NO_COUNT", () => {
  const h = harvestFrom(manyAreas());
  assert.equal(h.date, "2026-01-01");
  assert.equal(h.currency, "EUR");
  assert.equal(h.unit, "per m2 of living area");
  for (const r of h.rows) {
    assert.ok(Number.isNaN(r.n));
    assert.ok(r.low <= r.median && r.median <= r.high && r.min <= r.low && r.high <= r.max);
  }
  const bi = h.rows.find((r) => r.area === "Bielefeld" && r.item === "apartment")!;
  assert.equal(bi.median, 2355); // real values 1900 2270 2330 2380 2930 3060
  assert.ok(!h.rows.some((r) => r.area === "Düren"), "one zone is not published");
  assert.ok(h.rows.some((r) => r.area === NATIONAL && r.item === "apartment"));
  assert.ok(!h.rows.some((r) => r.area === "Köln" && r.item === "terraced"), "no terraced zones in the fixture");
  assert.ok(MIN_ZONES >= 5);
});

test("harvest: a file with only a few committee areas is refused", () => {
  assert.throws(() => harvestFrom(parseDbf(dbf(REAL))), /Only \d+ committee areas/);
});

test("zip: finds the Polygon .dbf among several files, stored and deflated", () => {
  const files = [
    { name: "info.txt", data: Buffer.from("x"), method: 0 },
    { name: "IRW_2026_Polygon.dbf", data: dbf(REAL), method: 8 },
  ].map((f) => ({ ...f, comp: f.method === 8 ? deflateRawSync(f.data) : f.data }));
  const parts: Buffer[] = [];
  const cd: Buffer[] = [];
  let off = 0;
  for (const f of files) {
    const nb = Buffer.from(f.name);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(f.method, 8); lh.writeUInt32LE(f.comp.length, 18); lh.writeUInt32LE(f.data.length, 22); lh.writeUInt16LE(nb.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(f.method, 10); c.writeUInt32LE(f.comp.length, 20); c.writeUInt32LE(f.data.length, 24); c.writeUInt16LE(nb.length, 28); c.writeUInt32LE(off, 42);
    parts.push(lh, nb, f.comp);
    cd.push(c, nb);
    off += 30 + nb.length + f.comp.length;
  }
  const cdBuf = Buffer.concat(cd);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(2, 10); end.writeUInt32LE(cdBuf.length, 12); end.writeUInt32LE(off, 16);
  const zip = Buffer.concat([...parts, cdBuf, end]);
  const got = unzipFind(zip, (n) => /polygon\.dbf$/i.test(n));
  assert.equal(got.name, "IRW_2026_Polygon.dbf");
  assert.equal(parseDbf(got.data).zones.length, REAL.length - 1);
  assert.throws(() => unzipFind(zip, (n) => n.endsWith(".shp")), /no Polygon/);
});

const rows: Row[] = harvestFrom(manyAreas()).rows.map((r) => ({ ...r, date: "2026-01-01" }));

test("answer: official statistic, no sample size, reference date, labelled as a valuation guideline", () => {
  const a = nrwHomePrices({ town: "Bielefeld" }, { rows });
  assert.equal(a.status, "ok");
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.sample_size, null);
  assert.equal(a.price!.currency, "EUR");
  assert.equal(a.price!.unit, "per m2 of living area");
  assert.equal(a.price!.value, 2355);
  assert.equal(a.period.to, "2026-01-01");
  assert.match(a.summary, /guideline value/);
  assert.match(a.summary, /not an asking price/);
  assert.match(a.source.attribution, /BORIS\.NRW/);
  assert.match(String((a.statistic as any).note), /No property_type was given, so flats are shown/);
});

test("answer: umlauts, English names, state suffix and property types", () => {
  assert.equal(findArea("muenster", rows), "Münster");
  assert.equal(findArea("Köln, NRW", rows), "Köln");
  assert.equal(findArea("Cologne", rows), "Köln");
  assert.equal(findArea("Berlin", rows), null);
  assert.equal(fold("Düsseldorf"), fold("Duesseldorf"));
  const h = nrwHomePrices({ town: "Köln", property_type: "house" }, { rows });
  assert.equal(h.price!.value, Math.round(((5900 + 6000) / 2) * 100) / 100);
  assert.equal(nrwHomePrices({ town: "Köln", property_type: "flat" }, { rows }).price!.value, 5040);
});

test("country only: answers the NRW-wide figure and says it is one state", () => {
  const a = nrwHomePrices({}, { rows });
  assert.equal(a.status, "ok");
  assert.match(a.summary, /North Rhine-Westphalia \(not all of Germany\)/);
  assert.match(String((a.statistic as any).note), /one German state/);
});

test("honesty: unsupported or unknown input is refused with a way forward, never ignored", () => {
  assert.throws(() => nrwHomePrices({ postcode: "50667" }, { rows }), /no postcode level/);
  assert.throws(() => nrwHomePrices({ town: "Berlin" }, { rows }), /only North Rhine-Westphalia is covered/);
  assert.throws(() => nrwHomePrices({ town: "Köln", property_type: "castle" }, { rows }), InputError);
  assert.throws(() => nrwHomePrices({ town: "Köln", property_type: "terraced" }, { rows }), /too few guideline-value zones/);
  assert.throws(() => nrwHomePrices({ town: "Köln" }, { rows: null }), /next collection/);
  assert.equal(kindOf(undefined).defaulted, true);
});

test("history key and manifest", () => {
  assert.deepEqual(nrwHistoryKey({ town: "Münster", property_type: "house" }, rows), { area: "Münster", item: "house", label: "Münster, detached one- and two-family houses" });
  assert.equal(nrwHistoryKey({}, rows)!.area, NATIONAL);
  assert.equal(nrwHistoryKey({ town: "Berlin" }, rows), null);
  assert.deepEqual(manifest.countries, ["DE"]);
  assert.equal(manifest.category, "home-sales");
  assert.ok(manifest.harvest && manifest.nominalCounts && manifest.referenceDates);
  assert.ok(INFO.licence.includes("dl-de/zero-2-0"));
  assert.equal(INFO.price_type, "official_statistic");
});

test("reuseStored: nothing stored means a real error, not an empty copy", () => {
  assert.equal(reuseStored("HTTP 403"), null);
});
