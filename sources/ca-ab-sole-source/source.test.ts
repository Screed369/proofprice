import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { REAL_CSV } from "./fixtures";
import { abSoleSource, abSoleSourceHarvest, aggregate, contractsFromCsv, INFO, isAlbertaArea, isoDate, parseCsv, windowStart } from "./source";
import { writeDaily, writeMeta } from "../../lib/library/store";
import { InputError } from "../../lib/http";

test("real CSV rows: trailing comma, quoted commas and ampersands, vendors never read", () => {
  const c = contractsFromCsv(REAL_CSV);
  assert.equal(c.length, 6);
  assert.deepEqual(c[0], { date: "2015-04-01", value: 19495, services: "Hwy 2 & Berwyn Access Lighting Project" });
  assert.equal(c[5].services, "Foster care, youth and family support");
  assert.ok(!JSON.stringify(c).includes("Engineering Ltd"), "no vendor names");
  assert.equal(parseCsv(REAL_CSV)[0].length, 23); // 22 columns plus the trailing empty one
});

test("bad dates, amounts under the CA$10,000 floor and missing columns", () => {
  assert.equal(isoDate("4/1/2015 12:00:00 AM"), "2015-04-01");
  assert.equal(isoDate("12/31/2025"), "2025-12-31");
  assert.equal(isoDate("x"), "");
  const head = '"startDate","contractAmount","contractServices"\n';
  assert.equal(contractsFromCsv(head + '"1/2/2026 12:00:00 AM","9999.00","a"\n"1/2/2026","not a number","b"\n"","20000","c"\n').length, 0);
  assert.equal(contractsFromCsv(head + '"1/2/2026 12:00:00 AM","10000.00","a"\r\n').length, 1);
  assert.throws(() => contractsFromCsv('"a","b"\n"1","2"\n'), /expected columns/);
});

function rows(n: number, services: string, value = 10000, date = "2026-03-01") {
  return Array.from({ length: n }, (_, i) => ({ date, value: value + i * 1000, services }));
}

test("aggregate: all sole-source contracts plus each recognised service, 5-contract rule, window honoured", () => {
  const c = [...rows(5, "Legal services for the Crown"), ...rows(3, "Translation services"), ...rows(2, "Old legal services", 5000, "2020-01-01")];
  const out = aggregate(c, "2024-10-24", "2026-10-24");
  const all = out.find((r) => r.item === "all")!;
  assert.equal(all.n, 8);
  const legal = out.find((r) => r.item === "legal-services")!;
  assert.equal(legal.n, 5);
  assert.equal(legal.median, 12000);
  assert.ok(!out.find((r) => r.item === "translation"), "3 contracts is not enough");
  assert.deepEqual(aggregate(rows(4, "x"), "2024-10-24", "2026-10-24"), []);
});

test("Alberta area names", () => {
  for (const a of ["Alberta", "AB", "province of Alberta"]) assert.ok(isAlbertaArea(a), a);
  for (const a of ["Calgary", "", undefined, "Quebec"]) assert.ok(!isAlbertaArea(a), String(a));
  assert.equal(windowStart("2026-10-24"), "2024-10-24");
});

test("harvest with a mocked data service; the answer comes from the stored copy", async () => {
  const real = globalThis.fetch;
  const line = (i: number, svc: string, amt: number) => `"Energy","s","","Edmonton","Alberta","T5K","Canada","Vendor ${i}","s","","c","Alberta","p","Canada","3/1/2026 12:00:00 AM","3/1/2027 12:00:00 AM","${amt}.00","N${i}","${svc}","z","2025","False",\n`;
  let csv = REAL_CSV.split("\n")[0] + "\n";
  for (let i = 0; i < 5; i++) csv += line(i, "Legal services for the Crown", 10000 + i * 1000);
  globalThis.fetch = (async () => new Response(csv)) as typeof fetch;
  process.env.PROOFPRICE_LIBRARY_DIR = mkdtempSync(path.join(tmpdir(), "abss-"));
  try {
    await assert.rejects(abSoleSource({ what: "all" }), /not been collected yet/);
    const h = await abSoleSourceHarvest(new Date("2026-10-24T03:17:00Z"));
    assert.equal(h.currency, "CAD");
    assert.deepEqual(h.rows.map((r) => [r.item, r.n, r.median]), [["all", 5, 12000], ["legal-services", 5, 12000]]);
    writeDaily(INFO.id, h);
    writeMeta(INFO.id, { source: INFO.id, currency: "CAD", unit: h.unit, first_date: h.date, last_date: h.date, days: 1, last_harvest_at: "x", last_rows: 2, last_ok_at: "x", last_error: null });
    const a = await abSoleSource({ what: "all" });
    assert.equal(a.status, "ok");
    assert.equal(a.price?.median, 12000);
    assert.equal(a.price?.currency, "CAD");
    assert.equal(a.sample_size, 5);
    assert.deepEqual(a.period, { from: "2024-10-24", to: "2026-10-24" });
    assert.match(a.source.attribution, /Open Government Licence - Alberta/);
    assert.equal((await abSoleSource({ what: "legal services" })).price?.median, 12000);
    // gap G20261028-1: country=CA&buyer_area=Alberta with no 'what' answers with all contracts and says so
    const contracts = (await import("../../categories/contracts/index")).default;
    const prepared = contracts.prepare!({ country: "CA", buyer_area: "Alberta" } as any) as any;
    assert.equal(prepared.what, "all");
    assert.equal(prepared.what_defaulted, true);
    const d = await abSoleSource({ what: prepared.what, buyer_area: "Alberta", whatDefaulted: prepared.what_defaulted === true });
    assert.equal(d.status, "ok");
    assert.equal(d.price?.median, 12000);
    assert.match(d.summary, /No purchase was named/);
    assert.equal(((contracts.prepare!({ country: "CA", buyer_area: "Alberta", what: "legal services" } as any)) as any).what_defaulted, undefined);
    assert.throws(() => contracts.prepare!({ country: "CA" } as any), InputError);
    assert.throws(() => contracts.prepare!({ country: "CA", buyer_area: "Quebec" } as any), InputError);
    await assert.rejects(abSoleSource({ what: "xyzzy widgets" }), InputError);
    await assert.rejects(abSoleSource({ what: "all", cpv: "1" }), InputError);
  } finally {
    globalThis.fetch = real;
    delete process.env.PROOFPRICE_LIBRARY_DIR;
  }
});

test("routing: buyer_area=Alberta goes to ca-ab-sole-source; Quebec and the rest of CA keep their sources", async () => {
  const { categoryById, pickSource } = await import("../../lib/registry");
  const cat = categoryById("contracts")!;
  const id = (p: any) => pickSource(cat, { country: "CA", what: "laptops", ...p }).src.info.id;
  assert.equal(id({ buyer_area: "Alberta" }), "ca-ab-sole-source");
  assert.equal(id({ buyer_area: "AB" }), "ca-ab-sole-source");
  assert.equal(id({ buyer_area: "Quebec" }), "ca-qc-contracts");
  assert.equal(id({}), "ca-canadabuys-contracts");
  assert.equal(id({ buyer_area: "Ontario" }), "ca-canadabuys-contracts");
});
