// Fixture: the first rows of Zensus2022_Durchschn_Nettokaltmiete_100m-Gitter.csv, captured 2026-10-23 through the GitHub-hosted probe
// (semicolon csv, decimal comma, fifth column holds KLAMMERN for unreliable cells). The 1 km file has the same layout with 1km in the names;
// its rows below are built to that layout.
import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { CITIES } from "./cities";
import manifest from "./index";
import { InputError } from "../../lib/http";
import { INFO, ITEM, cityFigure, deRent, reuseStored, figureFromRows, findCity, fold, harvestFrom, parseGrid, toLaea, unzipEntry } from "./source";

const REAL_100M = `GITTER_ID_100m;x_mp_100m;y_mp_100m;durchschnMieteQM;werterlaeuternde_Zeichen
CRS3035RES100mN2691700E4341100;4341150;2691750;6,26;
CRS3035RES100mN2694800E4343900;4343950;2694850;4,45;KLAMMERN
CRS3035RES100mN2698300E4342000;4342050;2698350;6,79;
`;

test("parses the real layout: decimal comma, midpoint from the id, flagged rows skipped", () => {
  const g = parseGrid(REAL_100M);
  assert.equal(g.cells.length, 2);
  assert.equal(g.skippedFlagged, 1);
  assert.deepEqual(g.cells[0], { x: 4341150, y: 2691750, rent: 6.26 });
});

test("a new layout is reported, not guessed", () => {
  assert.throws(() => parseGrid("a;b;c\n1;2;3\n"), /needs updating/);
});

test("projection: the origin of EPSG:3035 and Berlin", () => {
  const o = toLaea(52, 10);
  assert.ok(Math.abs(o.x - 4321000) < 1 && Math.abs(o.y - 3210000) < 1);
  const b = toLaea(52.52, 13.405);
  assert.ok(Math.abs(b.x - 4552000) < 4000, `x ${b.x}`);
  assert.ok(Math.abs(b.y - 3270000) < 4000, `y ${b.y}`);
});

/** A 1 km grid of 20 x 20 squares round a point, rent rising 0.1 EUR per square to the east. */
function gridAround(lat: number, lon: number): string {
  const c = toLaea(lat, lon);
  const x0 = Math.round(c.x / 1000) * 1000 - 10000;
  const y0 = Math.round(c.y / 1000) * 1000 - 10000;
  const lines = ["GITTER_ID_1km;x_mp_1km;y_mp_1km;durchschnMieteQM;werterlaeuternde_Zeichen"];
  for (let i = 0; i < 20; i++)
    for (let j = 0; j < 20; j++) {
      const e = x0 + i * 1000;
      const n = y0 + j * 1000;
      lines.push(`CRS3035RES1000mN${n}E${e};${e + 500};${n + 500};${(8 + i * 0.1).toFixed(2).replace(".", ",")};`);
    }
  return lines.join("\n");
}

test("city figure: median and percentiles of the squares in the radius, too few squares give null", () => {
  const berlin = findCity("Berlin")!;
  const grid = parseGrid(gridAround(berlin.lat, berlin.lon));
  const f = cityFigure(grid.cells, berlin)!;
  assert.ok(f.cells > 100 && f.median > 8.9 && f.median < 9.1, JSON.stringify(f));
  assert.ok(f.low < f.median && f.median < f.high);
  assert.equal(cityFigure(grid.cells, findCity("Hamburg")!), null);
});

test("harvest needs many cities: a file with one city is refused", () => {
  const g = parseGrid(gridAround(52.52, 13.405));
  assert.throws(() => harvestFrom(g), /too few|Only 1 cities|Only 2 cities|Only \d+ cities/);
});

test("harvest rows: every city has NO_COUNT n, census date, EUR per m2", () => {
  // squares everywhere for the whole of the city list
  const lines = ["GITTER_ID_1km;x_mp_1km;y_mp_1km;durchschnMieteQM;werterlaeuternde_Zeichen"];
  const seen = new Set<string>();
  for (const c of CITIES) {
    const p = toLaea(c.lat, c.lon);
    const x0 = Math.round(p.x / 1000) * 1000;
    const y0 = Math.round(p.y / 1000) * 1000;
    for (let i = -3; i <= 3; i++)
      for (let j = -3; j <= 3; j++) {
        const id = `CRS3035RES1000mN${y0 + j * 1000}E${x0 + i * 1000}`;
        if (seen.has(id)) continue;
        seen.add(id);
        lines.push(`${id};0;0;${(7 + ((i + 3) % 4) * 0.5).toFixed(2).replace(".", ",")};`);
      }
  }
  const h = harvestFrom(parseGrid(lines.join("\n")));
  assert.equal(h.date, "2022-05-15");
  assert.equal(h.unit, "per m2 per month");
  assert.ok(h.rows.length >= CITIES.length - 2);
  for (const r of h.rows) {
    assert.ok(Number.isNaN(r.n));
    assert.equal(r.item, ITEM);
    assert.ok(r.low <= r.median && r.median <= r.high);
  }
});

test("zip entry: finds the named file among several, stored and deflated", () => {
  const mk = (name: string, data: Buffer, method: number) => ({ name, data, method, comp: method === 8 ? deflateRawSync(data) : data });
  const files = [mk("a.xlsx", Buffer.from("xx"), 0), mk("b/1km.csv", Buffer.from("GITTER_ID;1\nhello"), 8)];
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
  assert.equal(unzipEntry(zip, "b/1km.csv").toString(), "GITTER_ID;1\nhello");
  assert.throws(() => unzipEntry(zip, "missing.csv"), /no file/);
});

test("place names: umlauts, English names, 'Frankfurt'", () => {
  assert.equal(findCity("Munich")?.name, "München");
  assert.equal(findCity("muenchen")?.name, "München");
  assert.equal(findCity("München, Germany")?.name, "München");
  assert.equal(findCity("Cologne")?.name, "Köln");
  assert.equal(findCity("Frankfurt")?.name, "Frankfurt am Main");
  assert.equal(findCity("Atlantis"), null);
  assert.equal(fold("Düsseldorf"), fold("Duesseldorf"));
  assert.equal(new Set(CITIES.map((c) => fold(c.name))).size, CITIES.length);
});

const rows = [
  { date: "2022-05-15", area: "Berlin", item: ITEM, n: Number.NaN, median: 8.9, low: 6.5, high: 12.4, min: 4.1, max: 19.2 },
];

test("answer: official statistic, no sample size, census date, attribution", () => {
  const a = deRent({ town: "Berlin" }, { rows });
  assert.equal(a.status, "ok");
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.sample_size, null);
  assert.equal(a.price!.currency, "EUR");
  assert.equal(a.price!.unit, "per m2 per month");
  assert.equal(a.price!.value, 8.9);
  assert.equal(a.price!.typical_low, 6.5);
  assert.equal(a.price!.typical_high, 12.4);
  assert.equal(a.period.to, "2022-05-15");
  assert.match(a.summary, /Berlin/);
  assert.match(a.summary, /not an asking rent/);
  assert.match(a.source.attribution, /Destatis/);
});

test("honesty: parameters the file cannot honour are refused, not ignored", () => {
  assert.throws(() => deRent({ town: "Berlin", bedrooms: 2 }, { rows }), InputError);
  assert.throws(() => deRent({ town: "Berlin", postcode: "10115" }, { rows }), /postcode/);
  assert.throws(() => deRent({ town: "Berlin", property_type: "room" }, { rows }), InputError);
  assert.throws(() => deRent({}, { rows }), /town is required/);
  assert.throws(() => deRent({ town: "Atlantis" }, { rows }), /town must be one of/);
});

test("no library yet: a clear source error", () => {
  assert.throws(() => deRent({ town: "Berlin" }, { rows: null }), /next collection/);
  assert.equal(figureFromRows(rows, "Hamburg"), null);
});

test("manifest: licence is the Destatis wording, DE rent, harvest with no history", () => {
  assert.ok(INFO.licence.includes("gewerbliche"));
  assert.deepEqual(manifest.countries, ["DE"]);
  assert.equal(manifest.category, "rent");
  assert.equal(manifest.historyKey!({}), null);
  assert.ok(manifest.harvest);
});

test("reuseStored keeps the stored census day when the download is refused", () => {
  const kept = reuseStored("HTTP 403");
  assert.ok(kept !== null);
  assert.equal(kept!.date, "2022-05-15");
  assert.ok(kept!.rows.length >= 20);
  assert.match(kept!.note ?? "", /HTTP 403/);
});
