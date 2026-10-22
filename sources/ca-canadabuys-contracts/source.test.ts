import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { AWARD_CSV } from "./fixtures";
import { aggregate, awardFromRow, caContracts, caContractsHarvest, CaAward, CsvReader, decodeEntities, fileNames, headerIndex, INFO, purchaseOf, windowStart } from "./source";
import { writeDaily, writeMeta } from "../../lib/library/store";
import { InputError, SourceError } from "../../lib/http";

function parse(text: string, chunk = text.length): string[][] {
  const rows: string[][] = [];
  const r = new CsvReader((x) => rows.push(x));
  for (let i = 0; i < text.length; i += chunk) r.push(text.slice(i, i + chunk));
  r.end();
  return rows;
}

test("CSV reader: quoted cells with line breaks and doubled quotes, any chunk size, BOM and CRLF", () => {
  const text = '﻿"a","b","c"\r\n"x","*SRV\n*GD","say ""hi"""\r\n"1","2","3"';
  for (const size of [1, 2, 5, 1000]) {
    assert.deepEqual(parse(text, size), [["a", "b", "c"], ["x", "*SRV\n*GD", 'say "hi"'], ["1", "2", "3"]]);
  }
});

test("real file (2026-10-22 probe): header columns found, 14 rows read, multi-line category cell kept in one row", () => {
  const rows = parse(AWARD_CSV, 7);
  assert.equal(rows.length, 15);
  assert.ok(rows.every((r) => r.length === rows[0].length), "every row has the 80 header columns");
  const idx = headerIndex(rows[0]);
  assert.ok(idx.title === 0 && idx.amount > 0);
  assert.equal(rows[3][rows[0].indexOf("procurementCategory-categorieApprovisionnement")], "*SRV\n*GD");
});

test("real rows become awards; the 1.00 supply-arrangement lines are dropped as placeholders", () => {
  const rows = parse(AWARD_CSV);
  const idx = headerIndex(rows[0]);
  const awards = rows.slice(1).map((r) => awardFromRow(r, idx)).filter((a): a is CaAward => !!a);
  assert.equal(awards.length, 11);
  assert.deepEqual(
    { title: awards[0].title, date: awards[0].date, value: awards[0].value, ref: awards[0].ref },
    { title: "Outplacement Career Transition Services", date: "2026-09-01", value: 500000, ref: "MX-444148990616" },
  );
  assert.equal(awards[1].value, 68000);
  assert.ok(awards.every((a) => a.value > 100));
});

test("amendments, other currencies, cancelled notices and bad dates are not awards (derived from a real row)", () => {
  const rows = parse(AWARD_CSV);
  const idx = headerIndex(rows[0]);
  const base = rows[1];
  const mod = (at: number, v: string) => base.map((c, i) => (i === at ? v : c));
  assert.ok(awardFromRow(base, idx));
  assert.equal(awardFromRow(mod(idx.amendment, "001"), idx), null);
  assert.equal(awardFromRow(mod(idx.currency, "USD"), idx), null);
  assert.equal(awardFromRow(mod(idx.status, "Cancelled"), idx), null);
  assert.equal(awardFromRow(mod(idx.awarded, ""), idx), null);
  assert.equal(awardFromRow(mod(idx.amount, "50"), idx), null);
});

test("a file without the columns we rely on is a source error", () => {
  assert.throws(() => headerIndex(["title-titre-eng", "other"]), SourceError);
});

test("entities in titles are decoded", () => {
  assert.equal(decodeEntities("Award&nbsp;of&nbsp;one&rsquo;s &amp; two"), "Award of one's & two");
});

const award = (n: number, title: string, value: number, date = "2026-06-01", unspsc = ""): CaAward => ({ ref: `R${n}`, title, date, value, unspsc });

test("purchases are recognised from the title words or the UNSPSC code", () => {
  assert.equal(purchaseOf(award(1, "Translation services for the Board", 1000)), "translation");
  assert.equal(purchaseOf(award(2, "Notebook purchase", 1000, "2026-06-01", "43211503")), "laptops");
  assert.equal(purchaseOf(award(3, "Enterprise portfolio and resource management", 1000)), null);
});

test("aggregate: median and range per purchase, nothing under 5 awards, repeated notices counted once, window respected", () => {
  const six = [100000, 120000, 90000, 150000, 110000, 95000].map((v, i) => award(i, "Translation services", v));
  const rows = aggregate(
    [...six, award(0, "Translation services", 100000), award(50, "Legal services", 5000), award(51, "Legal services", 6000), award(60, "Translation services", 1e9, "2020-01-01")],
    "2024-10-22",
    "2026-10-22",
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].item, "translation");
  assert.equal(rows[0].area, "ALL");
  assert.equal(rows[0].n, 6);
  assert.equal(rows[0].median, 105000);
});

test("file names follow the April-March fiscal year", () => {
  assert.deepEqual(fileNames("2024-10-22", "2026-10-22"), [
    "2024-2025-awardNotice-avisAttribution.csv",
    "2025-2026-awardNotice-avisAttribution.csv",
    "2026-2027-awardNotice-avisAttribution.csv",
  ]);
  assert.deepEqual(fileNames("2025-01-10", "2025-02-01"), ["2024-2025-awardNotice-avisAttribution.csv"]);
  assert.equal(windowStart("2026-10-22"), "2024-10-22");
});

function csvOf(titles: [string, number][]): string {
  const rows = parse(AWARD_CSV);
  const idx = headerIndex(rows[0]);
  const lines = [rows[0].map((h) => `"${h}"`).join(",")];
  titles.forEach(([t, v], i) => {
    const r = rows[1].map(() => "");
    r[idx.title] = t; r[idx.ref] = `T${i}`; r[idx.amendment] = "000"; r[idx.awarded] = "2026-08-01"; r[idx.amount] = String(v); r[idx.currency] = "CAD"; r[idx.status] = "Active";
    lines.push(r.map((c) => `"${c.replace(/"/g, '""')}"`).join(","));
  });
  return "﻿" + lines.join("\n");
}

test("harvest streams the files, answers come from the library, and the guards say what is wrong", async () => {
  const body = csvOf([["Translation services", 100000], ["Translation services", 120000], ["Translation services", 90000], ["Translation services", 150000], ["Translation services", 110000], ["Legal services", 9000]]);
  const urls: string[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: any) => {
    urls.push(String(url));
    if (/2024-2025/.test(String(url))) return new Response("", { status: 404 });
    return new Response(body, { status: 200, headers: { "content-type": "application/octet-stream" } });
  }) as typeof fetch;
  const dir = mkdtempSync(path.join(tmpdir(), "cabuys-"));
  process.env.PROOFPRICE_LIBRARY_DIR = dir;
  try {
    const h = await caContractsHarvest(new Date("2026-10-22T03:17:00Z"));
    assert.equal(urls.length, 3);
    assert.ok(urls[0].startsWith("https://canadabuys.canada.ca/opendata/pub/2024-2025-"));
    assert.equal(h.currency, "CAD");
    // the same 6 awards appear in two fiscal-year files here, but each notice reference is counted once
    assert.deepEqual(h.rows.map((r) => [r.item, r.n, r.median]), [["translation", 5, 110000]]);
    writeDaily(INFO.id, h);
    writeMeta(INFO.id, { source: INFO.id, currency: "CAD", unit: h.unit, first_date: h.date, last_date: h.date, days: 1, last_harvest_at: "x", last_rows: 1, last_ok_at: "x", last_error: null });
    const a = await caContracts({ what: "translation services" });
    assert.equal(a.status, "ok");
    assert.equal(a.price_type, "contract_price");
    assert.equal(a.price?.currency, "CAD");
    assert.equal(a.price?.median, 110000);
    assert.equal(a.sample_size, 5);
    assert.deepEqual(a.period, { from: "2024-10-22", to: "2026-10-22" });
    assert.match(a.summary, /not unit prices/);
    const none = await caContracts({ what: "legal services" });
    assert.equal(none.status, "no_matches");
    await assert.rejects(caContracts({ what: "quantum widgets" }), InputError);
    await assert.rejects(caContracts({ what: "translation", cpv: "1234" }), InputError);
    await assert.rejects(caContracts({ what: "translation", buyer_area: "Defence" }), InputError);
  } finally {
    globalThis.fetch = real;
    delete process.env.PROOFPRICE_LIBRARY_DIR;
  }
});

test("no library yet gives a readable error", async () => {
  process.env.PROOFPRICE_LIBRARY_DIR = mkdtempSync(path.join(tmpdir(), "cabuys-empty-"));
  try {
    await assert.rejects(caContracts({ what: "catering" }), /not been collected yet/);
  } finally {
    delete process.env.PROOFPRICE_LIBRARY_DIR;
  }
});

test("INFO: licence quoted from the Open Government Licence - Canada, contract prices, no suppliers", () => {
  assert.equal(INFO.licence, "Open Government Licence - Canada");
  assert.match(INFO.attribution, /Contains information licensed under the Open Government Licence - Canada/);
  assert.equal(INFO.price_type, "contract_price");
  assert.match(INFO.limits, /suppliers and officials are never named/);
});
