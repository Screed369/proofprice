import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { deflateRawSync } from "node:zlib";
import { aggregateAll, contractOf, INFO, isoDate, itemsOf, jsonStreamFromZip, ptContracts, ptContractsHarvest, RecordSplitter, windowStart, yearlyFiles } from "./source";
import { writeDaily, writeMeta } from "../../lib/library/store";
import { InputError, SourceError } from "../../lib/http";

// Shape copied from the live file Contratos2026.json (inside contratos2026.zip), checked 2026-10-23: a compact JSON array of contracts, dd/mm/yyyy dates.
const rec = (id: string, over: Record<string, unknown> = {}) => ({
  idcontrato: id,
  nAnuncio: "27585/2025",
  tipoContrato: ["Aquisição de bens móveis"],
  tipoprocedimento: "Concurso público",
  objectoContrato: "Aquisição de computadores portáteis",
  adjudicante: ["504595067 - Escola Profissional Amar Terra Verde, L.da"],
  adjudicatarios: ["514181435 - GROWSKILLS UNIPESSOAL, LDA", "504615947 - 1 - MEO - SERVIÇOS DE COMUNICAÇÕES E MULTIMÉDIA, S.A."],
  dataPublicacao: "09/12/2025",
  dataCelebracaoContrato: "03/02/2026",
  precoContratual: 100000 + Number(id.replace(/\D/g, "")) * 1000,
  cpv: ["30213100-6 - Computadores portáteis"],
  localExecucao: ["Portugal, Braga, Vila Verde"],
  numAcordoQuadro: "",
  Ano: 2026,
  ...over,
});
const fileText = (records: unknown[]) => JSON.stringify(records);

/** A real single-file zip (deflate) built in memory. */
function zipOf(name: string, text: string): Buffer {
  const data = Buffer.from(text, "utf8");
  const comp = deflateRawSync(data);
  const nm = Buffer.from(name);
  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0);
  lh.writeUInt16LE(20, 4);
  lh.writeUInt16LE(8, 8);
  lh.writeUInt32LE(comp.length, 18);
  lh.writeUInt32LE(data.length, 22);
  lh.writeUInt16LE(nm.length, 26);
  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0);
  cd.writeUInt16LE(20, 4);
  cd.writeUInt16LE(20, 6);
  cd.writeUInt16LE(8, 10);
  cd.writeUInt32LE(comp.length, 20);
  cd.writeUInt32LE(data.length, 24);
  cd.writeUInt16LE(nm.length, 28);
  cd.writeUInt32LE(0, 42);
  const local = Buffer.concat([lh, nm, comp]);
  const dir = Buffer.concat([cd, nm]);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(local.length, 16);
  return Buffer.concat([local, dir, end]);
}

// Listing shape copied from https://dados.gov.pt/api/1/datasets/<slug>/ (probe ptbase1, 2026-10-23).
const DATASET = {
  resources: [
    { title: "contratos2026.zip", latest: "https://dados.gov.pt/api/1/datasets/r/dc5d0543-6e01-4f7e-8709-bf3815812a08", format: "zip" },
    { title: "contratos2026.xlsx", latest: "https://dados.gov.pt/api/1/datasets/r/aaaa", format: "xlsx" },
    { title: "contratos2025.zip", latest: "https://dados.gov.pt/api/1/datasets/r/bbbb", format: "zip" },
    { title: "contratos2023.zip", latest: "https://dados.gov.pt/api/1/datasets/r/cccc", format: "zip" },
  ],
};
const Y26 = DATASET.resources[0].latest;
const Y25 = DATASET.resources[2].latest;

test("the dataset listing gives the yearly zip files only, newest first", () => {
  assert.deepEqual(yearlyFiles(DATASET).map((f) => f.year), [2026, 2025, 2023]);
  assert.deepEqual(yearlyFiles(null), []);
});

test("isoDate reads dd/mm/yyyy and refuses everything else", () => {
  assert.equal(isoDate("23/02/2026"), "2026-02-23");
  assert.equal(isoDate("31/02/2026"), "");
  assert.equal(isoDate(""), "");
  assert.equal(isoDate("2026-02-23"), "");
});

test("the splitter reads a compact JSON array across tiny pieces, strings with braces and escaped quotes, and stops at the end", () => {
  const records = [rec("1", { objectoContrato: 'a } brace and a "quote" and \\ slash {' }), rec("2"), rec("3")];
  const text = fileText(records) + "\n// trailing text {";
  for (const size of [1, 7, 64, 100000]) {
    const got: any[] = [];
    const s = new RecordSplitter((r) => got.push(r));
    for (let i = 0; i < text.length; i += size) s.push(text.slice(i, i + size));
    assert.equal(got.length, 3, `size ${size}`);
    assert.equal(got[0].objectoContrato, 'a } brace and a "quote" and \\ slash {');
    assert.equal(got[2].idcontrato, "3");
    assert.equal(s.finished, true);
  }
});

test("the splitter refuses a file that is not a list", () => {
  const s = new RecordSplitter(() => {});
  assert.throws(() => s.push("<html>"), SourceError);
});

test("contractOf: keeps real contracts; drops placeholders, entry errors, undated and out-of-window ones", () => {
  const f = "2025-10-23";
  const t = "2026-10-23";
  assert.deepEqual(contractOf(rec("5"), f, t), { key: "5", date: "2026-02-03", value: 105000, cpv: "30213100" });
  assert.equal(contractOf(rec("5", { precoContratual: 1 }), f, t), null);
  assert.equal(contractOf(rec("5", { precoContratual: 5e9 }), f, t), null);
  assert.equal(contractOf(rec("5", { precoContratual: null }), f, t), null);
  assert.equal(contractOf(rec("5", { precoContratual: "12345,5" }), f, t)?.value, 12345.5);
  assert.equal(contractOf(rec("5", { dataCelebracaoContrato: "11/10/2021" }), f, t), null);
  assert.equal(contractOf(rec("5", { dataCelebracaoContrato: "01/01/2027" }), f, t), null);
  assert.equal(contractOf(rec("5", { dataCelebracaoContrato: "" }), f, t), null);
  assert.equal(contractOf(rec("5", { cpv: [] }), f, t), null);
  assert.equal(contractOf(rec("5", { cpv: ["NC"] }), f, t), null);
  assert.equal(contractOf(null, f, t), null);
});

test("itemsOf: shared purchase by CPV group plus the 2- and 4-digit CPV groups", () => {
  assert.deepEqual(itemsOf("30213100"), ["laptops", "cpv-30", "cpv-3021"]);
  assert.deepEqual(itemsOf("99999999"), ["cpv-99", "cpv-9999"]);
});

test("aggregateAll: 5 distinct contracts needed, a contract counts once, window by signing date", () => {
  const mk = (n: number, base: number) => Array.from({ length: n }, (_, i) => ({ key: `k${base}-${i}`, date: "2026-03-01", value: base + i, cpv: "30213100" }));
  const five = mk(5, 100000);
  const rows = aggregateAll([...five, five[0], { key: "old", date: "2020-01-01", value: 9e8, cpv: "30213100" }], "2025-10-23", "2026-10-23");
  const laptops = rows.find((r) => r.item === "laptops");
  assert.deepEqual(laptops && [laptops.area, laptops.n, laptops.median], ["ALL", 5, 100002]);
  assert.deepEqual(aggregateAll(mk(4, 100000), "2025-10-23", "2026-10-23"), []);
});

test("jsonStreamFromZip inflates the JSON file inside a real zip", async () => {
  const text = fileText([rec("1"), rec("2")]);
  const got: any[] = [];
  const s = new RecordSplitter((r) => got.push(r));
  const dec = new TextDecoder();
  for await (const piece of jsonStreamFromZip(zipOf("Contratos2026.json", text))) s.push(dec.decode(piece, { stream: true }));
  assert.deepEqual(got.map((r) => r.idcontrato), ["1", "2"]);
  assert.throws(() => jsonStreamFromZip(Buffer.from("not a zip at all, really not a zip file at all")), SourceError);
  assert.throws(() => jsonStreamFromZip(zipOf("readme.txt", "x")), /no JSON file/);
});

function opener(files: Record<string, string>, calls: string[] = [], chunk = 5000) {
  return async (url: string) => {
    calls.push(url);
    const text = files[url];
    if (text === undefined) throw new SourceError("HTTP 500");
    const bytes = new TextEncoder().encode(text);
    return (async function* () {
      for (let i = 0; i < bytes.length; i += chunk) yield bytes.slice(i, i + chunk); // splits multi-byte letters too
    })();
  };
}
const r26 = [...[1, 2, 3, 4].map((i) => rec(String(i), { objectoContrato: "Aquisição de equipamentos eletrónicos é" })), rec("20", { precoContratual: 5e9 })];
const r25 = [rec("5", { dataCelebracaoContrato: "15/11/2025" }), rec("6", { dataCelebracaoContrato: "15/11/2025" }), rec("1") /* same contract again: counted once */, rec("7", { dataCelebracaoContrato: "01/01/2020" })];

test("harvest: streams the yearly files, counts a contract once, keeps aggregates only, then answers come from the library", async () => {
  const calls: string[] = [];
  const dir = mkdtempSync(path.join(tmpdir(), "ptbase-"));
  process.env.PROOFPRICE_LIBRARY_DIR = dir;
  try {
    const h = await ptContractsHarvest(new Date("2026-10-23T03:17:00Z"), {
      dataset: DATASET,
      open: opener({ [Y26]: fileText(r26), [Y25]: fileText(r25) }, calls),
    });
    assert.equal(h.currency, "EUR");
    assert.equal(h.date, "2026-10-23");
    assert.deepEqual(calls, [Y26, Y25]); // 2023 is outside the window
    const laptops = h.rows.find((r) => r.item === "laptops")!;
    assert.deepEqual([laptops.n, laptops.median], [6, 103500]); // 1..6 -> 101000..106000
    assert.match(h.note ?? "", /2 yearly files/);
    assert.doesNotMatch(JSON.stringify(h), /514181435|504595067|GROWSKILLS|MEO/);
    writeDaily(INFO.id, h);
    writeMeta(INFO.id, { source: INFO.id, currency: "EUR", unit: h.unit, first_date: h.date, last_date: h.date, days: 1, last_harvest_at: "x", last_rows: h.rows.length, last_ok_at: "x", last_error: null });

    const a = await ptContracts({ what: "computadores portáteis" });
    assert.equal(a.status, "ok");
    assert.equal(a.price_type, "contract_price");
    assert.equal(a.price?.currency, "EUR");
    assert.equal(a.price?.median, 103500);
    assert.equal(a.sample_size, 6);
    assert.deepEqual(a.period, { from: "2025-10-23", to: "2026-10-23" });
    assert.match(a.summary, /not unit prices/);

    const g = await ptContracts({ what: "anything", cpv: "30213100-6" });
    assert.equal(g.status, "ok");
    assert.equal(g.extra?.cpv_group, "3021");
    assert.equal((await ptContracts({ what: "x", cpv: "30" })).sample_size, 6);
    assert.equal((await ptContracts({ what: "ambulances" })).status, "no_matches");
    await assert.rejects(ptContracts({ what: "quantum widgets" }), InputError);
    await assert.rejects(ptContracts({ what: "laptops", cpv: "302" }), InputError);
    await assert.rejects(ptContracts({ what: "laptops", buyer_area: "Lisboa" }), InputError);
  } finally {
    delete process.env.PROOFPRICE_LIBRARY_DIR;
  }
});

test("harvest: one unreadable year is noted, all unreadable is an error, empty data is an error, the time budget stops new files", async () => {
  const now = new Date("2026-10-23T03:17:00Z");
  const some = await ptContractsHarvest(now, { dataset: DATASET, open: opener({ [Y26]: fileText([1, 2, 3, 4, 5].map((i) => rec(String(i)))) }) });
  assert.match(some.note ?? "", /Not read this day: 2025/);
  await assert.rejects(ptContractsHarvest(now, { dataset: DATASET, open: opener({}) }), /Could not read the Portal BASE files/);
  await assert.rejects(ptContractsHarvest(now, { dataset: DATASET, open: opener({ [Y26]: fileText([]), [Y25]: fileText([]) }) }), /no usable contracts/);
  await assert.rejects(ptContractsHarvest(now, { dataset: { resources: [] } }), /no yearly zip files/);
  const timed = await ptContractsHarvest(now, { dataset: DATASET, budgetMs: -1, open: opener({ [Y26]: fileText([]) }) }).catch((e) => e);
  assert.ok(timed instanceof SourceError);
});

test("no library yet gives a readable error; window is 12 months", async () => {
  process.env.PROOFPRICE_LIBRARY_DIR = mkdtempSync(path.join(tmpdir(), "ptbase-empty-"));
  try {
    await assert.rejects(ptContracts({ what: "laptops" }), /not been collected yet/);
  } finally {
    delete process.env.PROOFPRICE_LIBRARY_DIR;
  }
  assert.equal(windowStart("2026-10-23"), "2025-10-23");
});

test("INFO: public domain, contract prices, no buyers or suppliers", () => {
  assert.match(INFO.licence, /Public domain/);
  assert.equal(INFO.price_type, "contract_price");
  assert.match(INFO.limits, /tax numbers in the open files are never read/);
  assert.match(INFO.attribution, /IMPIC - Portal BASE/);
});
