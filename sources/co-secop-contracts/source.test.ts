import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { aggregateOne, coContracts, coContractsHarvest, contractsOf, INFO, PATTERNS, whereFor, windowStart } from "./source";
import { PURCHASES } from "../../categories/contracts/purchases";
import { writeDaily, writeMeta } from "../../lib/library/store";
import { InputError, SourceError } from "../../lib/http";

// Rows copied from the live format, checked 2026-10-22 (datos.gov.co jbjy-vk9h): every value is a string.
const LIVE = [
  { id_contrato: "CO1.PCCNTR.4323030", fecha_de_firma: "2025-12-16T00:00:00.000", valor_del_contrato: "58890006" },
  { id_contrato: "CO1.PCCNTR.7126479", fecha_de_firma: "2026-01-12T00:00:00.000", valor_del_contrato: "1316696626.2" },
  { id_contrato: "CO1.PCCNTR.1", fecha_de_firma: "2026-01-12T00:00:00.000", valor_del_contrato: "0" },
  { id_contrato: "CO1.PCCNTR.2", fecha_de_firma: "2026-01-12T00:00:00.000", valor_del_contrato: "99999999999999" },
  { id_contrato: "CO1.PCCNTR.3", fecha_de_firma: "", valor_del_contrato: "5000000" },
  { id_contrato: "CO1.PCCNTR.4", fecha_de_firma: "2026-02-01T00:00:00.000", valor_del_contrato: "abc" },
];

test("live rows become contracts; zero, huge, undated and non-numeric values are dropped", () => {
  const c = contractsOf(LIVE);
  assert.deepEqual(c.map((x) => [x.key, x.date, x.value]), [
    ["CO1.PCCNTR.4323030", "2025-12-16", 58890006],
    ["CO1.PCCNTR.7126479", "2026-01-12", 1316696626.2],
  ]);
});

test("every pattern belongs to a known shared purchase, and the where-clause is built safely", () => {
  const ids = new Set(PURCHASES.map((p) => p.id));
  for (const id of Object.keys(PATTERNS)) assert.ok(ids.has(id), id);
  const w = whereFor(["%PORT_TIL%", "%O'BRIEN%"], "2025-10-22");
  assert.match(w, /^fecha_de_firma >= '2025-10-22T00:00:00' AND \(upper\(descripcion_del_proceso\) like '%PORT_TIL%' OR .*'%O''BRIEN%'\)$/);
});

test("aggregateOne: 5 contracts needed, a contract counts once, window by signing date", () => {
  const mk = (n: number, v: number, date = "2026-03-01") => Array.from({ length: n }, (_, i) => ({ key: `k${v}-${i}`, date, value: v + i }));
  const five = mk(5, 1000000);
  const row = aggregateOne("catering", [...five, five[0], ...mk(1, 5000000, "2020-01-01")], "2025-10-22", "2026-10-22");
  assert.deepEqual(row && [row.item, row.area, row.n, row.median], ["catering", "ALL", 5, 1000002]);
  assert.equal(aggregateOne("catering", mk(4, 1000000), "2025-10-22", "2026-10-22"), null);
});

function sodaFetcher(perItem: Record<string, any[]>, calls: string[] = []) {
  return async (url: string) => {
    calls.push(url);
    const u = decodeURIComponent(url);
    for (const [needle, rows] of Object.entries(perItem)) if (u.includes(needle)) return rows;
    return [];
  };
}
const guards = Array.from({ length: 6 }, (_, i) => ({ id_contrato: `CO1.PCCNTR.9${i}`, fecha_de_firma: "2026-05-01T00:00:00.000", valor_del_contrato: String(120000000 + i * 1000000) }));

test("harvest: one aggregate per purchase, selects only non-personal columns, then answers come from the library", async () => {
  const calls: string[] = [];
  const dir = mkdtempSync(path.join(tmpdir(), "cosecop-"));
  process.env.PROOFPRICE_LIBRARY_DIR = dir;
  try {
    const h = await coContractsHarvest(new Date("2026-10-22T03:17:00Z"), { fetcher: sodaFetcher({ "VIGILANCIA": guards }, calls) });
    assert.equal(h.currency, "COP");
    assert.deepEqual(h.rows.map((r) => [r.item, r.n, r.median]), [["security-guards", 6, 122500000]]);
    assert.equal(calls.length, Object.keys(PATTERNS).length);
    for (const u of calls) {
      const d = decodeURIComponent(u);
      assert.match(d, /\$select=id_contrato,fecha_de_firma,valor_del_contrato/);
      assert.doesNotMatch(d, /nombre|documento|proveedor|n_mero_de_cuenta|banco/i);
    }
    writeDaily(INFO.id, h);
    writeMeta(INFO.id, { source: INFO.id, currency: "COP", unit: h.unit, first_date: h.date, last_date: h.date, days: 1, last_harvest_at: "x", last_rows: 1, last_ok_at: "x", last_error: null });
    const b = await coContracts({ what: "security guard services" });
    assert.equal(b.status, "ok");
    assert.equal(b.price_type, "contract_price");
    assert.equal(b.price?.currency, "COP");
    assert.equal(b.price?.median, 122500000);
    assert.equal(b.sample_size, 6);
    assert.deepEqual(b.period, { from: "2025-10-22", to: "2026-10-22" });
    assert.match(b.summary, /not unit prices/);
    assert.equal((await coContracts({ what: "ambulances" })).status, "no_matches");
    await assert.rejects(coContracts({ what: "quantum widgets" }), InputError);
    await assert.rejects(coContracts({ what: "pharmaceuticals" }), InputError); // known purchase, but no Spanish pattern yet
    await assert.rejects(coContracts({ what: "catering", cpv: "1234" }), InputError);
    await assert.rejects(coContracts({ what: "catering", buyer_area: "Bogota" }), InputError);
  } finally {
    delete process.env.PROOFPRICE_LIBRARY_DIR;
  }
});

test("harvest guards: too many contracts skips the item; all requests failing is an error; empty data is an error", async () => {
  const big = Array.from({ length: 5000 }, (_, i) => ({ id_contrato: `c${i}`, fecha_de_firma: "2026-05-01T00:00:00.000", valor_del_contrato: "1000000" }));
  const patterns = { catering: ["%CATERING%"] };
  // every page returns 5000 rows, so 20,001 rows are collected: over the limit
  const h = await coContractsHarvest(new Date("2026-10-22T03:17:00Z"), { fetcher: async (u) => (decodeURIComponent(u).includes("CATERING") ? big : guards), patterns: { ...patterns, "security-guards": ["%VIGILANCIA%"] } });
  assert.deepEqual(h.rows.map((r) => r.item), ["security-guards"]);
  assert.match(h.note ?? "", /no figure: catering/);
  await assert.rejects(coContractsHarvest(new Date("2026-10-22T03:17:00Z"), { fetcher: async () => { throw new SourceError("down"); } }), SourceError);
  await assert.rejects(coContractsHarvest(new Date("2026-10-22T03:17:00Z"), { fetcher: async () => [] }), /no usable contracts/);
});

test("no library yet gives a readable error; window is 12 months", async () => {
  process.env.PROOFPRICE_LIBRARY_DIR = mkdtempSync(path.join(tmpdir(), "cosecop-empty-"));
  try {
    await assert.rejects(coContracts({ what: "catering" }), /not been collected yet/);
  } finally {
    delete process.env.PROOFPRICE_LIBRARY_DIR;
  }
  assert.equal(windowStart("2026-10-22"), "2025-10-22");
});

test("INFO: CC BY-SA licence, contract prices, no suppliers or bank details", () => {
  assert.match(INFO.licence, /ShareAlike/);
  assert.equal(INFO.price_type, "contract_price");
  assert.match(INFO.limits, /bank details in the open file are never read/);
  assert.match(INFO.attribution, /Colombia Compra Eficiente/);
});
