import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { InputError, SourceError } from "../../lib/http";
import { SOURCE_PLUGINS, categoryById, countriesFor, paramSchemas } from "../../lib/registry";
import {
  ABOUT_URL, INFO, MAX_RECONCILE_GAP_PERCENT, findPlace, findWorkbookUrl, fold, monthEnd, nzAnswer, nzHarvest, parseSalesSheet, periodOf, placesOf,
  reconcile, snapshotFromRows, snapshotRows, windowFor, windowStart, windowWords,
} from "./source";
import type { SaleRow } from "./source";
import { readSheetNamed } from "./xlsx";
import type { Cell } from "./xlsx";
import * as F from "./fixtures";

const snap = () => snapshotFromRows("2026-07-31", F.LIBRARY_ROWS);
const sales = (): SaleRow[] => parseSalesSheet(F.SALES_ROWS);

// ---- a small real-shaped .xlsx: zip with workbook.xml, rels and two sheets (inline strings, numbers) ----
function zipOf(entries: [string, string][]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const data = Buffer.from(text);
    const body = deflateRawSync(data);
    const nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt32LE(body.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, body);
    centrals.push(cd, nameBuf);
    offset += local.length + nameBuf.length + body.length;
  }
  const cdBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cdBuf, eocd]);
}
const COLS = "ABCDEFGH";
function sheetXml(rows: Cell[][]): string {
  const rs = rows.map((r, i) => {
    const cells = r.map((c, j) => {
      if (c === null || c === undefined) return "";
      const ref = `${COLS[j]}${i + 1}`;
      return typeof c === "number" ? `<c r="${ref}"><v>${c}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t>${String(c).replace(/&/g, "&amp;")}</t></is></c>`;
    });
    return `<row r="${i + 1}">${cells.join("")}</row>`;
  });
  return `<?xml version="1.0"?><worksheet><sheetData>${rs.join("")}</sheetData></worksheet>`;
}
function workbook(salesRows: Cell[][]): Buffer {
  return zipOf([
    ["xl/workbook.xml", '<workbook><sheets><sheet name="Instructions" sheetId="1" r:id="rId1"/><sheet name="Sales" sheetId="2" r:id="rId2"/></sheets></workbook>'],
    ["xl/_rels/workbook.xml.rels", '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>'],
    ["xl/worksheets/sheet1.xml", sheetXml([[null, "Property and Sales Statistics data extract"]])],
    ["xl/worksheets/sheet2.xml", sheetXml(salesRows)],
  ]);
}

test("nz-hud-home-sales: licence, attribution and type are the Ministry's", () => {
  assert.equal(INFO.id, "nz-hud-home-sales");
  assert.equal(INFO.price_type, "official_statistic");
  assert.match(INFO.licence, /Creative Commons Attribution 4\.0 International/);
  assert.match(INFO.licence, /licensed for re-use under a Creative Commons Attribution 4\.0 International Licence/);
  assert.equal(INFO.licence_url, "https://www.hud.govt.nz/about-us/copyright-and-disclaimer");
  for (const k of ["Ministry of Housing and Urban Development", "CC BY 4.0", "not an endorsement"]) assert.ok(INFO.attribution.includes(k), k);
  assert.match(INFO.limits, /interquartile/);
  assert.match(INFO.limits, /fewer than 5 sales/);
});

test("registry: NZ is a home-sales country, harvest + referenceDates are declared, no history", () => {
  const p = SOURCE_PLUGINS.find((s) => s.info.id === "nz-hud-home-sales")!;
  assert.ok(p);
  assert.equal(p.category, "home-sales");
  assert.ok(p.harvest && p.referenceDates);
  assert.equal(p.historyKey!({ town: "Wellington" }), null);
  assert.match(p.noHistory!, /newest month/);
  assert.ok(countriesFor("home-sales").includes("NZ"));
  assert.ok("town" in paramSchemas(categoryById("home-sales")!));
  const mbie = SOURCE_PLUGINS.filter((s) => s.category === "home-sales" && s.countries.includes("NZ"));
  assert.equal(mbie.length, 1, "no other NZ home-sales source, so no serves() is needed");
});

test("periodOf: Excel serials and text dates", () => {
  assert.equal(periodOf(46204), "2026-07");
  assert.equal(periodOf(29221), "1980-01");
  assert.equal(periodOf("2026-07-01"), "2026-07");
  assert.equal(periodOf(null), null);
  assert.equal(periodOf("July"), null);
  for (const [p, serial] of Object.entries(F.SERIAL)) assert.equal(periodOf(serial), p);
});

test("month helpers", () => {
  assert.equal(monthEnd("2026-07"), "2026-07-31");
  assert.equal(monthEnd("2026-02"), "2026-02-28");
  assert.equal(windowStart("2026-07", 1), "2026-07-01");
  assert.equal(windowStart("2026-07", 3), "2026-05-01");
  assert.equal(windowStart("2026-07", 12), "2025-08-01");
  assert.equal(windowWords("2026-07", "1m"), "July 2026");
  assert.equal(windowWords("2026-07", "12m"), "the 12 months to July 2026");
  assert.equal(windowFor(undefined), "12m");
  assert.equal(windowFor(1), "1m");
  assert.equal(windowFor(3), "3m");
  assert.equal(windowFor(6), "3m");
  assert.equal(windowFor(36), "12m");
});

test("parseSalesSheet: header gate, dates, levels, blanks", () => {
  const rows = sales();
  const nat = rows.find((r) => r.level === "national" && r.stat === "1m" && r.period === "2026-07")!;
  assert.deepEqual([nat.sales, nat.q1, nat.median, nat.q3], [5654, 569000, 738000, 950000]);
  const early = rows.find((r) => r.area === "Far North District" && r.period === "1980-01")!;
  assert.equal(early.sales, 2);
  assert.equal(early.median, null, "counts without prices stay blank");
  assert.equal(rows.find((r) => r.area === "Chatham Islands")!.median, null);
  assert.equal(rows.find((r) => r.area === "Wellington City" && r.stat === "12m")!.median, 847000);
  assert.throws(() => parseSalesSheet([["stat_type", "area", "area_type"]]), SourceError);
  assert.throws(() => parseSalesSheet([]), /new layout/);
  const bad = parseSalesSheet([F.HEADER, ["Weekly", "National", "New Zealand", 46204, 5, 1, 2, 3], ["Monthly", "Planet", "Mars", 46204, 5, 1, 2, 3], ["Monthly", "National", "", 46204, 5, 1, 2, 3], ["Monthly", "National", "New Zealand", "x", 5, 1, 2, 3]]);
  assert.equal(bad.length, 0, "unknown window, area type, empty area and bad date are skipped");
});

test("snapshotRows: newest period, 5-sale gate, quartile order, aggregate rows only", () => {
  const out = snapshotRows(sales());
  assert.equal(out.date, "2026-07-31");
  assert.deepEqual(out.periods, { "1m": "2026-07", "3m": "2026-07", "12m": "2026-07" });
  const keys = out.rows.map((r) => `${r.area}|${r.item}`);
  assert.ok(keys.includes("national|1m/2026-07"));
  assert.ok(keys.includes("ta|Wellington City|12m/2026-07"));
  assert.ok(!keys.some((k) => k.includes("Kawerau")), "4 sales: not published");
  assert.ok(!keys.some((k) => k.includes("Chatham")), "no prices: not published");
  assert.ok(!keys.some((k) => k.includes("2026-06")), "only the newest period is kept");
  assert.ok(!keys.some((k) => k.includes("Far North")), "1980 rows are not the newest period");
  for (const r of out.rows) {
    assert.ok(r.n >= 5);
    assert.ok(r.low <= r.median && r.median <= r.high);
    assert.equal(r.min, r.low);
    assert.equal(r.max, r.high);
  }
  // a median outside its quartiles is a broken cell: dropped
  const odd = parseSalesSheet([F.HEADER, ...F.SALES_ROWS.slice(1), ["Monthly", "Territorial Authority", "Odd District", 46204, 50, 900000, 100000, 950000]]);
  assert.ok(!snapshotRows(odd).rows.some((r) => r.area.includes("Odd")));
  assert.throws(() => snapshotRows(parseSalesSheet([F.HEADER, ["Monthly", "Region", "Auckland", 46204, 50, 1, 2, 3]])), /no national/);
});

test("reconcile: the regions' sales add up to New Zealand", () => {
  const r = reconcile(sales(), "2026-07");
  assert.deepEqual(r, { national: 5654, regions: 5654, gapPercent: 0 });
  const off = sales().map((s) => (s.level === "region" && s.area === "Auckland" ? { ...s, sales: s.sales + 300 } : s));
  assert.ok(Math.abs(reconcile(off, "2026-07").gapPercent) > MAX_RECONCILE_GAP_PERCENT);
  assert.throws(() => reconcile(sales(), "2024-01"), SourceError);
});

test("findWorkbookUrl: relative, absolute and missing links", () => {
  assert.equal(
    findWorkbookUrl(F.ABOUT_HTML),
    "https://www.hud.govt.nz/assets/Property-and-Sales-data-download-July-2026.xlsx?m=e141007c9ceaea6c61ca3f7d76ad900682f583d8",
  );
  assert.equal(findWorkbookUrl('<a href="https://x.example/Property-and-Sales-data-download-Aug-2026.xlsx?a=1&amp;b=2">'), "https://x.example/Property-and-Sales-data-download-Aug-2026.xlsx?a=1&b=2");
  assert.equal(findWorkbookUrl("<a href='/assets/other.xlsx'>"), null);
  assert.equal(findWorkbookUrl("<html></html>"), null);
});

test("readSheetNamed: reads only the Sales sheet of a workbook", () => {
  const sheet = readSheetNamed(workbook(F.SALES_ROWS), "Sales")!;
  assert.equal(sheet.rows.length, F.SALES_ROWS.length);
  assert.deepEqual(sheet.rows[0], F.HEADER);
  assert.equal(parseSalesSheet(sheet.rows).length, sales().length);
  assert.equal(readSheetNamed(workbook(F.SALES_ROWS), "Nope"), null);
});

function stubFetch(responses: Record<string, () => Response>): () => void {
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const hit = Object.entries(responses).find(([k]) => url.startsWith(k));
    if (!hit) return new Response("not found", { status: 404 });
    return hit[1]();
  }) as typeof fetch;
  return () => {
    globalThis.fetch = real;
  };
}

test("nzHarvest: About page -> workbook -> library rows, with the sales check in the note", async () => {
  // enough areas to pass the completeness check: 100 synthetic districts with 10+ sales each, in the three windows
  const filler: Cell[][] = [];
  for (let i = 0; i < 100; i++) for (const stat of ["Monthly", "3-Month rolling", "12-Month rolling"]) filler.push([stat, "Territorial Authority", `Place ${i} District`, 46204, 20, 300000, 400000, 500000]);
  const restore = stubFetch({
    [ABOUT_URL]: () => new Response(F.ABOUT_HTML),
    "https://www.hud.govt.nz/assets/Property-and-Sales": () => new Response(workbook([...F.SALES_ROWS, ...filler])),
  });
  try {
    const out = await nzHarvest();
    assert.equal(out.date, "2026-07-31");
    assert.equal(out.currency, "NZD");
    assert.equal(out.unit, "per home");
    assert.ok(out.rows.length > 300);
    assert.match(out.note!, /QUARTILE/);
    assert.match(out.note!, /regions' sales sum to 5654 against 5654/);
    assert.match(out.note!, /Property-and-Sales-data-download-July-2026\.xlsx/);
  } finally {
    restore();
  }
});

test("nzHarvest: stops on a changed page, a changed sheet, a sum that does not add up and an incomplete file", async () => {
  const run = async (responses: Record<string, () => Response>) => {
    const restore = stubFetch(responses);
    try {
      await nzHarvest();
    } finally {
      restore();
    }
  };
  await assert.rejects(run({ [ABOUT_URL]: () => new Response("<html></html>") }), /no longer links/);
  await assert.rejects(run({ [ABOUT_URL]: () => new Response("x", { status: 503 }) }), /HTTP 503/);
  await assert.rejects(run({ [ABOUT_URL]: () => new Response(F.ABOUT_HTML), "https://www.hud.govt.nz/assets": () => new Response("x", { status: 404 }) }), /HTTP 404/);
  await assert.rejects(
    run({ [ABOUT_URL]: () => new Response(F.ABOUT_HTML), "https://www.hud.govt.nz/assets": () => new Response(workbook([["a", "b"]])) }),
    /new layout/,
  );
  const off = F.SALES_ROWS.map((r) => (r[1] === "Region" && r[2] === "Auckland" ? [...r.slice(0, 4), 1962, ...r.slice(5)] : r));
  await assert.rejects(run({ [ABOUT_URL]: () => new Response(F.ABOUT_HTML), "https://www.hud.govt.nz/assets": () => new Response(workbook(off)) }), /does not add up/);
  await assert.rejects(run({ [ABOUT_URL]: () => new Response(F.ABOUT_HTML), "https://www.hud.govt.nz/assets": () => new Response(workbook(F.SALES_ROWS)) }), /Only \d+ HUD areas/);
});

test("fold and findPlace: macrons, City/District, regions, boards, national", () => {
  assert.equal(fold("Taupō District"), "taupo district");
  assert.equal(fold("Kāpiti Coast"), "kapiti coast");
  const places = placesOf(snap());
  const name = (q: string | undefined) => findPlace(q, places)?.place.name;
  assert.equal(name("Wellington"), "Wellington City", "a city beats the region with the same name");
  assert.equal(name("wellington city"), "Wellington City");
  assert.equal(findPlace("Wellington", places)!.alsoAvailable.map((p) => p.name).join(), "Wellington");
  assert.equal(findPlace("Wellington region", places)!.place.level, "region");
  assert.equal(name("Taupo"), "Taupō District");
  assert.equal(name("Christchurch"), "Christchurch City");
  assert.equal(name("Queenstown"), "Queenstown-Lakes District", "a unique start of a name");
  assert.equal(name("Queenstown Lakes"), "Queenstown-Lakes District");
  assert.equal(findPlace("Howick", places)!.place.level, "board");
  assert.equal(name("Tasman"), "Tasman District");
  assert.equal(name("Auckland"), "Auckland City");
  for (const q of [undefined, "", "New Zealand", "NZ", "Aotearoa", "all"]) assert.equal(findPlace(q, places)!.place.level, "national", String(q));
  assert.equal(name("Wellington, New Zealand"), "Wellington City");
  assert.equal(name("Atlantis"), undefined);
  assert.equal(name("Kaw"), undefined, "three letters is too short to guess");
});

test("answer: Wellington defaults to the 12-month figure with the publisher's count and quartiles", () => {
  const a = nzAnswer({ town: "Wellington" }, snap());
  assert.equal(a.status, "ok");
  assert.equal(a.price!.currency, "NZD");
  assert.equal(a.price!.unit, "per home");
  assert.equal(a.price!.median, 847000);
  assert.equal(a.price!.value, 847000);
  assert.equal(a.sample_size, 2432);
  assert.equal(a.confidence, "high");
  assert.deepEqual(a.period, { from: "2025-08-01", to: "2026-07-31" });
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.statistic!.measure, "median");
  assert.equal(a.price!.typical_low, null, "quartiles are not passed off as a 10th-90th range");
  assert.equal(a.price!.typical_high, null);
  const x = a.extra as any;
  assert.deepEqual(x.interquartile_range, { lower_quartile: 700500, upper_quartile: 1070000, note: x.interquartile_range.note });
  assert.match(x.interquartile_range.note, /not a 10th-90th range/);
  assert.equal(x.window_months, 12);
  assert.equal(x.new_zealand_comparison.median, 755000);
  assert.equal(x.new_zealand_comparison.difference_percent, 12.2);
  assert.deepEqual(x.other_windows.map((w: any) => w.median), [810000, 825000]);
  assert.match(a.summary, /Wellington City the median price of residential sales/);
  assert.match(a.summary, /\$847,000/);
  assert.match(a.summary, /the 12 months to July 2026/);
  assert.match(a.summary, /2,432 sales/);
  assert.match(a.summary, /12\.2% above/);
  assert.match(a.summary, /Ministry of Housing and Urban Development/);
  assert.match(a.notice ?? "", /Information, not a valuation/);
  assert.match(a.source.licence, /CC BY 4\.0|Creative Commons/);
  assert.match(a.extra && (a.statistic!.note ?? ""), /also names Wellington \(region\)/);
});

test("answer: months picks the window; a thin small area falls back and says so", () => {
  assert.equal(nzAnswer({ town: "Wellington", months: 1 }, snap()).price!.median, 810000);
  assert.equal(nzAnswer({ town: "Wellington", months: 3 }, snap()).price!.median, 825000);
  assert.deepEqual(nzAnswer({ town: "Wellington", months: 1 }, snap()).period, { from: "2026-07-01", to: "2026-07-31" });
  const odd = nzAnswer({ town: "Wellington", months: 24 }, snap());
  assert.equal(odd.price!.median, 847000);
  assert.match(odd.statistic!.note!, /months=24 is answered with the 12-month figure/);
  const k = nzAnswer({ town: "Kawerau", months: 1 }, snap());
  assert.equal(k.price!.median, 410000);
  assert.equal(k.sample_size, 61);
  assert.match(k.statistic!.note!, /no monthly price for Kawerau District \(too few sales\).*12 months to July 2026/);
  const t = nzAnswer({ town: "Taupo", months: 1 }, snap());
  assert.equal(t.price!.median, 650000);
  assert.match(t.statistic!.note!, /3 months to July 2026/);
  assert.equal(nzAnswer({ town: "Tasman" }, snap()).price!.median, 800000);
});

test("answer: New Zealand, Auckland (same figures as its region, no 'also' note), an Auckland board and a region", () => {
  const nz = nzAnswer({}, snap());
  assert.equal(nz.price!.median, 755000);
  assert.equal(nz.sample_size, 80128);
  assert.equal((nz.extra as any).new_zealand_comparison, undefined);
  assert.equal((nz.query as any).town, "New Zealand");
  const akl = nzAnswer({ town: "Auckland" }, snap());
  assert.equal(akl.price!.median, 948000);
  assert.equal(akl.statistic!.note, undefined);
  assert.equal((nzAnswer({ town: "Howick" }, snap()).extra as any).area.level, "Auckland local board");
  const reg = nzAnswer({ town: "Wellington region" }, snap());
  assert.equal(reg.price!.median, 753000);
  assert.equal((reg.extra as any).area.level, "region");
});

test("answer: an area with no published price is no_matches, not a figure; bad input is refused", () => {
  const s = snapshotFromRows("2026-07-31", [...F.LIBRARY_ROWS.filter((r) => r.area !== "ta|Kawerau District")]);
  s.areas.set("ta|Kawerau District", { level: "ta", name: "Kawerau District", figs: {} });
  const none = nzAnswer({ town: "Kawerau" }, s);
  assert.equal(none.status, "no_matches");
  assert.equal(none.price, null);
  assert.equal(none.confidence, "insufficient");
  assert.throws(() => nzAnswer({ town: "Atlantis" }, snap()), InputError);
  assert.throws(() => nzAnswer({ town: "Atlantis" }, snap()), /not an area in HUD's New Zealand sale statistics/);
  assert.throws(() => nzAnswer({ postcode: "6011" }, snap()), /postcodes are not supported/);
  assert.throws(() => nzAnswer({ town: "Wellington", property_type: "apartment" }, snap()), /one figure for all residential sales/);
  assert.equal(nzAnswer({ town: "Wellington", property_type: "any" }, snap()).status, "ok");
  assert.equal(nzAnswer({ town: "Wellington", postcode: "6011" }, snap()).status, "ok");
});

test("library rows carry no personal data and every published row has 5+ sales", () => {
  for (const r of F.LIBRARY_ROWS) assert.ok(r.n >= 5, `${r.area} ${r.item}`);
  const out = snapshotRows(sales());
  for (const r of out.rows) assert.match(r.area, /^(national|region\||ta\||board\|)/);
});
