import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { aggregate, chicagoContracts, chicagoHarvest, contractsFromRows, INFO, isChicagoArea, windowStart } from "./source";
import { writeDaily, writeMeta } from "../../lib/library/store";
import { InputError } from "../../lib/http";

// Rows copied from the live Socrata answer, checked 2026-10-31 (probe chicontracts32); all values are text.
const REAL = [
  { purchase_order_description: "Design for Artwork for 81 Club Artist by Damon Lamar Reed", revision_number: "0", contract_type: "COMPTROLLER-OTHER", approval_date: "2026-10-29T00:00:00.000", start_date: "2026-07-30T00:00:00.000", department: "DEPARTMENT OF CULTURAL AFFAIRS AND SPECIAL EVENTS", award_amount: "750" },
  { purchase_order_description: "UNITED AIRLINES - 2025 ORD REDETERINATION PROJECT PROJECT", revision_number: "0", contract_type: "COMPTROLLER-OTHER", approval_date: "2026-10-29T00:00:00.000", department: "CHICAGO DEPARTMENT OF AVIATION", award_amount: "5126000" },
  { purchase_order_description: "Grant Agreement for African Festival of the Arts", revision_number: "0", contract_type: "COMPTROLLER-OTHER", approval_date: "2026-10-29T00:00:00.000", department: "X", award_amount: "10000" },
  { purchase_order_description: "Change order", revision_number: "2", approval_date: "2026-10-29T00:00:00.000", award_amount: "50000" },
];

test("real rows: revision 0 only, US$1,000 floor, text amounts", () => {
  const c = contractsFromRows(REAL);
  assert.equal(c.length, 2);
  assert.deepEqual(c[0], { date: "2026-10-29", value: 5126000, text: "UNITED AIRLINES - 2025 ORD REDETERINATION PROJECT PROJECT" });
  assert.deepEqual(contractsFromRows([{ revision_number: "0", approval_date: "bad", award_amount: "5000" }, { revision_number: "0", approval_date: "2026-01-01T00:00:00.000", award_amount: "x" }]), []);
});

test("aggregate: 5-contract rule and window", () => {
  const mk = (n: number, text: string, date = "2026-03-01") => Array.from({ length: n }, (_, i) => ({ date, value: 2000 + i * 1000, text }));
  const out = aggregate([...mk(5, "Legal services for the Law Dept"), ...mk(3, "Software licences"), ...mk(2, "old", "2020-01-01")], "2024-10-31", "2026-10-31");
  assert.equal(out.find((r) => r.item === "all")!.n, 8);
  assert.equal(out.find((r) => r.item === "legal-services")!.median, 4000);
  assert.ok(!out.find((r) => r.item === "software"));
  assert.deepEqual(aggregate(mk(4, "x"), "2024-10-31", "2026-10-31"), []);
});

test("area names and window", () => {
  for (const a of ["Chicago", "city of chicago", "Chicago, IL"]) assert.ok(isChicagoArea(a), a);
  for (const a of ["Cook County", "", undefined, "Virginia"]) assert.ok(!isChicagoArea(a), String(a));
  assert.equal(windowStart("2026-10-31"), "2024-10-31");
});

test("harvest with a mocked portal; the answer comes from the stored copy", async () => {
  process.env.PROOFPRICE_LIBRARY_DIR = mkdtempSync(path.join(tmpdir(), "chi-"));
  await assert.rejects(chicagoContracts({ what: "all" }), /not been collected yet/);
  const rows = Array.from({ length: 6 }, (_, i) => ({ purchase_order_description: "Legal services", revision_number: "0", approval_date: "2026-05-0" + (i + 1) + "T00:00:00.000", award_amount: String(5000 + i * 1000) }));
  let calls = 0;
  const h = await chicagoHarvest(new Date("2026-10-31T10:00:00Z"), async () => (calls++ === 0 ? rows : []));
  assert.equal(h.date, "2026-10-31");
  assert.equal(h.currency, "USD");
  assert.ok(h.rows.find((r) => r.item === "all" && r.n === 6));
  writeDaily(INFO.id, h);
  writeMeta(INFO.id, { source: INFO.id, currency: "USD", unit: h.unit, first_date: h.date, last_date: h.date, days: 1, last_harvest_at: "x", last_rows: h.rows.length, last_ok_at: "x", last_error: null });
  const a = await chicagoContracts({ what: "all" });
  assert.equal(a.status, "ok");
  assert.equal(a.price?.currency, "USD");
  assert.equal(a.sample_size, 6);
  assert.equal(a.price?.median, 7500);
  await assert.rejects(chicagoContracts({ what: "unicorn feed" }), InputError);
  await assert.rejects(chicagoContracts({ what: "all", cpv: "1" }), InputError);
});
