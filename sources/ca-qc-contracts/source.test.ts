import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { REAL_RELEASES } from "./fixtures";
import { aggregate, awardsFromPackage, chooseFiles, INFO, isQuebecArea, purchaseOf, qcContracts, qcContractsHarvest, windowStart } from "./source";
import { writeDaily, writeMeta } from "../../lib/library/store";
import { InputError } from "../../lib/http";

test("real releases become awards by award id; the contract amendment total is not used", () => {
  const a = awardsFromPackage({ releases: REAL_RELEASES });
  assert.deepEqual(a.map((x) => [x.id, x.date, x.value, x.unspsc]), [
    ["20070068", "2025-02-03", 34487.16, "83000000"],
    ["20120951", "2025-10-27", 17850, "86000000"],
  ]);
});

test("inactive awards, other currencies, placeholder amounts and bad dates are dropped (derived from a real release)", () => {
  const base = REAL_RELEASES[0];
  const mod = (patch: any) => awardsFromPackage({ releases: [{ ...base, awards: [{ ...base.awards[0], ...patch }] }] });
  assert.equal(mod({}).length, 1);
  assert.equal(mod({ status: "cancelled" }).length, 0);
  assert.equal(mod({ value: { amount: 40, currency: "CAD" } }).length, 0);
  assert.equal(mod({ value: { amount: 5000, currency: "USD" } }).length, 0);
  assert.equal(mod({ date: "" }).length, 0);
  assert.equal(awardsFromPackage({}).length, 0);
});

function lap(id: string, value: number, released = "2026-10-01", date = "2026-05-01") {
  return { id, title: "Achat d'ordinateurs portables", date, value, unspsc: "", released };
}

test("aggregate: counts each award id once (newest release wins), needs 5 awards, honours the window", () => {
  const awards = [lap("1", 1000), lap("2", 1200), lap("3", 1400), lap("4", 1600), lap("5", 1800), lap("5", 2000, "2026-10-08"), lap("6", 999, "2026-10-01", "2024-01-01")];
  const rows = aggregate(awards, "2025-10-23", "2026-10-23");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].item, "laptops");
  assert.equal(rows[0].n, 5);
  assert.equal(rows[0].median, 1400);
  assert.equal(rows[0].max, 2000);
  assert.deepEqual(aggregate(awards.slice(0, 4), "2025-10-23", "2026-10-23"), []);
});

test("purchases: French words and the UNSPSC laptop code", () => {
  assert.equal(purchaseOf(lap("x", 1)), "laptops");
  assert.equal(purchaseOf({ ...lap("x", 1), title: "Matériel", unspsc: "43211503" }), "laptops");
  assert.equal(purchaseOf({ ...lap("x", 1), title: "Débroussaillage des bords de chemins" }), null);
});

test("chooseFiles: monthly files in the window, then only weekly files after the last monthly one", () => {
  const r = (name: string) => ({ name, url: `https://www.donneesquebec.ca/recherche/dataset/x/resource/y/download/${name}` });
  const record = { result: { resources: [r("mensuel_20250801_20250831.json"), r("mensuel_20260901_20260930.json"), r("hebdo_20260921_20260927.json"), r("hebdo_20261005_20261011.json"), r("hebdo_20261012_20261018.json"), { name: "notes.pdf", url: "https://x" }, { name: "hebdo_20261019_20261025.json", url: "https://evil.example/x" }] } };
  assert.deepEqual(chooseFiles(record, "2025-10-23").map((f) => f.name), ["mensuel_20260901_20260930.json", "hebdo_20261005_20261011.json", "hebdo_20261012_20261018.json"]);
});

test("Quebec area names", () => {
  for (const a of ["Quebec", "Québec", "QC", "province of Quebec"]) assert.ok(isQuebecArea(a), a);
  for (const a of ["Ontario", "", undefined, "Quebec City"]) assert.ok(!isQuebecArea(a), String(a));
  assert.equal(windowStart("2026-10-23"), "2025-10-23");
});

test("harvest with a mocked Données Québec: reads the record, then the chosen files; answer comes from the stored copy", async () => {
  const real = globalThis.fetch;
  const rel = (n: number) => ({ date: "2026-10-05T10:00:00-04:00", tender: { title: "Achat d'ordinateurs portables", items: [{ classification: { id: "43211503" } }] },
    awards: [{ id: `A${n}`, status: "active", date: "2026-05-0" + n + "T00:00:00-04:00", value: { amount: 1000 + 200 * n, currency: "CAD" } }] });
  const urls: string[] = [];
  const base = "https://www.donneesquebec.ca/recherche/dataset/d/resource/r/download/";
  globalThis.fetch = (async (url: any) => {
    urls.push(String(url));
    if (String(url).includes("package_show")) return new Response(JSON.stringify({ result: { resources: [{ name: "mensuel_20261001_20261031.json", url: base + "mensuel_20261001_20261031.json" }, { name: "hebdo_20260921_20260927.json", url: base + "hebdo_20260921_20260927.json" }] } }));
    return new Response(JSON.stringify({ releases: [1, 2, 3, 4, 5].map(rel).concat([REAL_RELEASES[0] as any]) }));
  }) as typeof fetch;
  process.env.PROOFPRICE_LIBRARY_DIR = mkdtempSync(path.join(tmpdir(), "qc-"));
  try {
    await assert.rejects(qcContracts({ what: "laptops" }), /not been collected yet/);
    const h = await qcContractsHarvest(new Date("2026-10-23T03:17:00Z"));
    assert.equal(urls.length, 2); // the record, then one monthly file (the weekly file lies before the monthly end, so it is not read)
    assert.equal(h.currency, "CAD");
    assert.deepEqual(h.rows.map((r) => [r.item, r.n, r.median]), [["laptops", 5, 1600]]);
    writeDaily(INFO.id, h);
    writeMeta(INFO.id, { source: INFO.id, currency: "CAD", unit: h.unit, first_date: h.date, last_date: h.date, days: 1, last_harvest_at: "x", last_rows: 1, last_ok_at: "x", last_error: null });
    const a = await qcContracts({ what: "ordinateurs portables" });
    assert.equal(a.status, "ok");
    assert.equal(a.price?.median, 1600);
    assert.equal(a.price?.currency, "CAD");
    assert.equal(a.sample_size, 5);
    assert.deepEqual(a.period, { from: "2025-10-23", to: "2026-10-23" });
    assert.match(a.source.attribution, /CC BY 4.0/);
    await assert.rejects(qcContracts({ what: "xyzzy widgets" }), InputError);
    await assert.rejects(qcContracts({ what: "laptops", cpv: "30213100" }), InputError);
  } finally {
    globalThis.fetch = real;
    delete process.env.PROOFPRICE_LIBRARY_DIR;
  }
});

test("routing: buyer_area=Quebec goes to ca-qc-contracts, every other CA request stays with CanadaBuys", async () => {
  const { categoryById, pickSource } = await import("../../lib/registry");
  const cat = categoryById("contracts")!;
  assert.equal(pickSource(cat, { country: "CA", what: "laptops", buyer_area: "Quebec" }).src.info.id, "ca-qc-contracts");
  assert.equal(pickSource(cat, { country: "CA", what: "laptops", buyer_area: "Québec" }).src.info.id, "ca-qc-contracts");
  assert.equal(pickSource(cat, { country: "CA", what: "laptops" }).src.info.id, "ca-canadabuys-contracts");
  assert.equal(pickSource(cat, { country: "CA", what: "laptops", buyer_area: "Ontario" }).src.info.id, "ca-canadabuys-contracts");
  assert.equal(pickSource(cat, { country: "FR", what: "laptops" }).src.info.id, "fr-decp-contracts");
});
