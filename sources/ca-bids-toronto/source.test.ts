import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { REAL_CSV } from "./fixtures";
import { aggregate, awardsFromCsv, INFO, isTorontoArea, parseCsv, torontoContracts, torontoHarvest, whatToItem, windowStart } from "./source";
import { writeDaily, writeMeta } from "../../lib/library/store";
import { InputError } from "../../lib/http";

test("real rows: quoted thousands commas stripped; None, blank date, zero-value RFSQ placeholders and blank amounts dropped", () => {
  const a = awardsFromCsv(REAL_CSV);
  assert.deepEqual(a.map((x) => [x.date, x.value, x.category]), [
    ["2012-10-04", 26773.58, "goods and services"],
    ["2012-10-04", 771931.57, "goods and services"],
  ]);
});

test("the CSV reader keeps quoted commas, doubled quotes and the ward list in one field", () => {
  const rows = parseCsv(REAL_CSV);
  assert.equal(rows.length, 11);
  assert.equal(rows[0].length, 14);
  assert.ok(rows.every((r) => r.length === 14));
  assert.match(rows[7][11], /\("RFSQ"\)/);
});

test("buyer name, e-mail and phone columns are never read into an award", () => {
  const csv = "Document Number,High Level Category,Successful Supplier,Award,Award Authority Obtained Date,Buyer Email\n1,Construction Services,ACME,5000,2026-01-02,someone@toronto.ca\n";
  const [a] = awardsFromCsv(csv);
  assert.ok(!JSON.stringify(a).includes("someone@"));
  assert.throws(() => awardsFromCsv("a,b\n1,2\n"), /expected column is missing/);
});

function aw(n: number, value: number, category = "construction services", date = "2026-03-01", doc = String(n)) {
  return { key: `${doc}|s${n}`, date, value, category, description: "" };
}

test("aggregate: all + category rows, one award per document+supplier, window honoured, 5-award rule", () => {
  const awards = [aw(1, 100000), aw(2, 200000), aw(3, 300000), aw(4, 400000), aw(5, 500000), aw(5, 500000), aw(6, 999, "goods and services", "2020-01-01"), aw(7, 1000, "goods and services")];
  const rows = aggregate(awards, "2024-11-09", "2026-11-09");
  assert.deepEqual(rows.map((r) => [r.item, r.n, r.median]), [["all", 6, 250000], ["category/construction-services", 5, 300000]]);
});

test("aggregate: fewer than 5 awards gives no row", () => {
  assert.deepEqual(aggregate([aw(1, 1000), aw(2, 2000), aw(3, 3000), aw(4, 4000)], "2024-11-09", "2026-11-09"), []);
});

test("what words, area names and window", () => {
  assert.equal(whatToItem("Construction")?.item, "category/construction-services");
  assert.equal(whatToItem("professional services")?.item, "category/professional-services");
  assert.equal(whatToItem("all")?.item, "all");
  assert.equal(whatToItem("laptops")?.item, "laptops");
  assert.equal(whatToItem("xyzzy widgets"), null);
  for (const a of ["Toronto", "city of Toronto", "TORONTO"]) assert.ok(isTorontoArea(a), a);
  for (const a of ["Ontario", "", undefined, "Quebec", "North York"]) assert.ok(!isTorontoArea(a), String(a));
  assert.equal(windowStart("2026-11-09"), "2024-11-09");
});

test("harvest with a mocked CSV; answer comes from the stored copy, with attribution and no personal data", async () => {
  const real = globalThis.fetch;
  const head = "_id,Document Number,RFx (Solicitation) Type,High Level Category,Successful Supplier,Award,Award Authority Obtained Date,Division,Buyer Name,Buyer Email,Buyer Phone Number,Solicitation Document Description,Supplier Address,Wards";
  const line = (n: number, amt: string) => `${n},D${n},RFT,Construction Services,Supplier ${n},${amt},2026-0${n}-05,Toronto Water,Some Buyer,b@toronto.ca,416-000-0000,Watermain work,,`;
  const csv = [head, line(1, "100000"), line(2, '"200,000.50"'), line(3, "300000"), line(4, "400000"), line(5, "500000"), line(6, "None")].join("\n");
  globalThis.fetch = (async () => new Response(csv)) as typeof fetch;
  process.env.PROOFPRICE_LIBRARY_DIR = mkdtempSync(path.join(tmpdir(), "tor-"));
  try {
    await assert.rejects(torontoContracts({ what: "all" }), /not been collected yet/);
    const h = await torontoHarvest(new Date("2026-11-09T03:17:00Z"));
    assert.equal(h.currency, "CAD");
    assert.deepEqual(h.rows.map((r) => [r.item, r.n, r.median]), [["all", 5, 300000], ["category/construction-services", 5, 300000]]);
    writeDaily(INFO.id, h);
    writeMeta(INFO.id, { source: INFO.id, currency: "CAD", unit: h.unit, first_date: h.date, last_date: h.date, days: 1, last_harvest_at: "x", last_rows: 2, last_ok_at: "x", last_error: null });
    const a = await torontoContracts({ what: "construction services" });
    assert.equal(a.status, "ok");
    assert.equal(a.price?.median, 300000);
    assert.equal(a.price?.currency, "CAD");
    assert.equal(a.sample_size, 5);
    assert.deepEqual(a.period, { from: "2024-11-09", to: "2026-11-09" });
    assert.match(a.source.attribution, /Open Government Licence – Toronto/);
    assert.ok(!JSON.stringify(a).includes("Supplier 1") && !JSON.stringify(a).includes("b@toronto.ca"));
    const none = await torontoContracts({ what: "laptops" });
    assert.notEqual(none.status, "ok");
    await assert.rejects(torontoContracts({ what: "xyzzy widgets" }), InputError);
    await assert.rejects(torontoContracts({ what: "all", cpv: "30213100" }), InputError);
  } finally {
    globalThis.fetch = real;
    delete process.env.PROOFPRICE_LIBRARY_DIR;
  }
});

test("routing: buyer_area=Toronto goes to ca-bids-toronto; Quebec, Alberta and every other CA request stay where they were", async () => {
  const { categoryById, pickSource } = await import("../../lib/registry");
  const cat = categoryById("contracts")!;
  assert.equal(pickSource(cat, { country: "CA", what: "all", buyer_area: "Toronto" }).src.info.id, "ca-bids-toronto");
  assert.equal(pickSource(cat, { country: "CA", what: "laptops", buyer_area: "Quebec" }).src.info.id, "ca-qc-contracts");
  assert.equal(pickSource(cat, { country: "CA", what: "all", buyer_area: "Alberta" }).src.info.id, "ca-ab-sole-source");
  assert.equal(pickSource(cat, { country: "CA", what: "laptops" }).src.info.id, "ca-canadabuys-contracts");
  assert.equal(pickSource(cat, { country: "CA", what: "laptops", buyer_area: "Ontario" }).src.info.id, "ca-canadabuys-contracts");
});
