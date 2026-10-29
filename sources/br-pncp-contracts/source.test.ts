import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { aggregate, brContracts, brContractsHarvest, contractsOf, INFO, PATTERNS, PT_ALIASES, pageUrl, purchaseFor, purchasesOf, readDay, stateOf, windowDays } from "./source";
import { PURCHASES, normaliseText } from "../../categories/contracts/purchases";
import { writeDaily, writeMeta } from "../../lib/library/store";
import { InputError, SourceError } from "../../lib/http";

// Rows copied from the live format, checked 2026-10-29 (pncp.gov.br /api/consulta/v1/contratos, probe brpncp-d1). Supplier fields trimmed: we never read them.
const LIVE = [
  { numeroControlePNCP: "80881915000192-2-000021/2026", objetoContrato: "Contratação de empresa especializada para prestação de serviços de suporte de manutenção preventiva e corretiva em notebooks, computadores e seus periféricos", valorGlobal: 76800.0, receita: false, tipoContrato: { id: 1, nome: "Contrato (termo inicial)" }, unidadeOrgao: { ufSigla: "PR", municipioNome: "Lindoeste" }, dataAssinatura: "2026-09-28" },
  { numeroControlePNCP: "00394460005887-2-005784/2026", objetoContrato: "Alienação de bens móveis inservíveis", valorGlobal: 5000.0, receita: true, tipoContrato: { id: 1, nome: "Contrato (termo inicial)" }, unidadeOrgao: { ufSigla: "SP" } },
  { numeroControlePNCP: "x-amend", objetoContrato: "Serviços de vigilância armada", valorGlobal: 90000, receita: false, tipoContrato: { id: 2, nome: "Termo aditivo" }, unidadeOrgao: { ufSigla: "SP" } },
  { numeroControlePNCP: "x-zero", objetoContrato: "Serviços de vigilância armada", valorGlobal: 0, receita: false, tipoContrato: { id: 1 }, unidadeOrgao: { ufSigla: "SP" } },
  { numeroControlePNCP: "x-huge", objetoContrato: "Serviços de vigilância armada", valorGlobal: 99999999999999, receita: false, tipoContrato: { id: 1 }, unidadeOrgao: { ufSigla: "SP" } },
  { numeroControlePNCP: "", objetoContrato: "Serviços de vigilância armada", valorGlobal: 90000, receita: false, tipoContrato: { id: 1 }, unidadeOrgao: { ufSigla: "SP" } },
  { numeroControlePNCP: "x-ok", objetoContrato: "AQUISIÇÃO de Merenda Escolar para a Rede Municipal", valorGlobal: "250000.50", receita: false, tipoContrato: { id: 1 }, unidadeOrgao: { ufSigla: "xx" } },
];

test("live rows: only initial, non-revenue, plausible contracts with a key survive; text is normalised; bad states are blanked", () => {
  const c = contractsOf(LIVE);
  assert.deepEqual(c.map((x) => [x.key, x.uf, x.value]), [
    ["80881915000192-2-000021/2026", "PR", 76800],
    ["x-ok", "", 250000.5],
  ]);
  assert.match(c[0].text, /notebooks/);
  assert.match(c[1].text, /aquisicao de merenda escolar/);
  // no supplier field is ever copied out
  assert.deepEqual(Object.keys(c[0]).sort(), ["key", "text", "uf", "value"]);
});

test("every pattern and alias belongs to a known shared purchase, and patterns match real wording", () => {
  const ids = new Set(PURCHASES.map((p) => p.id));
  for (const id of [...Object.keys(PATTERNS), ...Object.keys(PT_ALIASES)]) assert.ok(ids.has(id), id);
  assert.deepEqual(purchasesOf(normaliseText("Prestação de serviços de vigilância patrimonial armada")), ["security-guards"]);
  assert.deepEqual(purchasesOf(normaliseText("Aquisição de gêneros para MERENDA ESCOLAR")), ["school-meals"]);
  assert.deepEqual(purchasesOf(normaliseText("Aquisição de notebooks e impressoras")).sort(), ["laptops", "printers"]);
  assert.deepEqual(purchasesOf(normaliseText("Aquisição de material de escritório")), []);
});

test("purchaseFor understands English, Portuguese and the shared aliases; unknown things are refused", () => {
  assert.equal(purchaseFor("merenda escolar")?.id, "school-meals");
  assert.equal(purchaseFor("Vigilância")?.id, "security-guards");
  assert.equal(purchaseFor("security guard services")?.id, "security-guards");
  assert.equal(purchaseFor("laptops")?.id, "laptops");
  assert.equal(purchaseFor("office cleaning")?.id, "building-cleaning");
  assert.equal(purchaseFor("quantum widgets"), null);
  assert.equal(purchaseFor("road resurfacing"), null); // known purchase, no Portuguese pattern yet
});

const mk = (n: number, uf: string, text: string, base: number, prefix = "k") =>
  Array.from({ length: n }, (_, i) => ({ key: `${prefix}${uf}${i}`, uf, value: base + i * 1000, text: normaliseText(text) }));

test("aggregate: national and state rows, a contract counts once, 5-contract rule, a bundle counts under each purchase", () => {
  const sp = mk(5, "SP", "Serviços de vigilância armada", 100000);
  const rj = mk(4, "RJ", "Serviços de vigilância armada", 200000);
  const rows = aggregate([...sp, sp[0], ...rj]);
  assert.deepEqual(rows.map((r) => [r.item, r.area, r.n, r.median]), [
    ["security-guards", "ALL", 9, 104000],
    ["security-guards", "SP", 5, 102000],
  ]);
  const bundle = mk(5, "MG", "Aquisição de notebooks e impressoras", 5000);
  assert.deepEqual(aggregate(bundle).map((r) => r.item).sort(), ["laptops", "laptops", "printers", "printers"]);
});

test("windowDays: seven complete days before now, oldest first; pageUrl uses one publication day", () => {
  assert.deepEqual(windowDays(new Date("2026-10-29T03:17:00Z")), ["2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28"]);
  assert.equal(pageUrl("2026-10-27", 2), "https://pncp.gov.br/api/consulta/v1/contratos?dataInicial=20261027&dataFinal=20261027&pagina=2&tamanhoPagina=500");
});

function fakePncp(perDay: Record<string, any[]>, calls: string[] = [], pagesPerDay = 1) {
  return async (url: string) => {
    calls.push(url);
    const day = /dataInicial=(\d{4})(\d{2})(\d{2})/.exec(url)!;
    const page = Number(/pagina=(\d+)/.exec(url)![1]);
    const rows = perDay[`${day[1]}-${day[2]}-${day[3]}`] ?? [];
    return { data: page === 1 || pagesPerDay > 1 ? rows : [], totalRegistros: rows.length, totalPaginas: pagesPerDay, numeroPagina: page, empty: rows.length === 0 };
  };
}
const guards = (n: number, tag: string) =>
  Array.from({ length: n }, (_, i) => ({ numeroControlePNCP: `${tag}-${i}`, objetoContrato: "Serviços de vigilância armada", valorGlobal: 120000 + i * 1000, receita: false, tipoContrato: { id: 1 }, unidadeOrgao: { ufSigla: "SP" } }));

test("readDay pages through a day and retries nothing on a good answer; an unexpected format is an error", async () => {
  const calls: string[] = [];
  const d = await readDay("2026-10-27", { fetcher: fakePncp({ "2026-10-27": guards(6, "a") }, calls, 3) });
  assert.equal(calls.length, 3);
  assert.equal(d.complete, true);
  assert.equal(d.contracts.length, 18);
  await assert.rejects(readDay("2026-10-27", { fetcher: async () => ({ nothing: true }) }), /unexpected format/);
  const capped = await readDay("2026-10-27", { fetcher: fakePncp({ "2026-10-27": guards(6, "a") }, [], 5), maxPages: 2 });
  assert.equal(capped.complete, false);
});

test("harvest: aggregates the window, reads only allowed fields, then answers come from the library", async () => {
  const calls: string[] = [];
  const dir = mkdtempSync(path.join(tmpdir(), "brpncp-"));
  process.env.PROOFPRICE_LIBRARY_DIR = dir;
  try {
    const perDay: Record<string, any[]> = {};
    windowDays(new Date("2026-10-29T03:17:00Z")).forEach((d, i) => (perDay[d] = guards(2, `d${i}`)));
    const h = await brContractsHarvest(new Date("2026-10-29T03:17:00Z"), { fetcher: fakePncp(perDay, calls) });
    assert.equal(h.currency, "BRL");
    assert.equal(h.date, "2026-10-28");
    assert.deepEqual(h.rows.map((r) => [r.item, r.area, r.n]), [["security-guards", "ALL", 14], ["security-guards", "SP", 14]]);
    assert.equal(calls.length, 7);
    writeDaily(INFO.id, h);
    writeMeta(INFO.id, { source: INFO.id, currency: "BRL", unit: h.unit, first_date: h.date, last_date: h.date, days: 1, last_harvest_at: "x", last_rows: 2, last_ok_at: "x", last_error: null });
    const a = await brContracts({ what: "vigilância" });
    assert.equal(a.status, "ok");
    assert.equal(a.price_type, "contract_price");
    assert.equal(a.price?.currency, "BRL");
    assert.equal(a.sample_size, 14);
    assert.deepEqual(a.period, { from: "2026-10-22", to: "2026-10-28" });
    assert.match(a.summary, /not unit prices/);
    assert.equal((await brContracts({ what: "security guard services", buyer_area: "sp" })).sample_size, 14);
    assert.equal((await brContracts({ what: "security guard services", buyer_area: "RJ" })).status, "no_matches");
    assert.equal((await brContracts({ what: "ambulances" })).status, "no_matches");
    await assert.rejects(brContracts({ what: "quantum widgets" }), InputError);
    await assert.rejects(brContracts({ what: "laptops", cpv: "30213100" }), InputError);
    await assert.rejects(brContracts({ what: "laptops", buyer_area: "Sao Paulo" }), InputError);
  } finally {
    delete process.env.PROOFPRICE_LIBRARY_DIR;
  }
});

test("harvest guards: all days failing, too many days failing, and empty data are errors; one failed day is tolerated and noted", async () => {
  const now = new Date("2026-10-29T03:17:00Z");
  const days = windowDays(now);
  const down = async () => { throw new SourceError("down", "x", 400); };
  await assert.rejects(brContractsHarvest(now, { fetcher: down }), SourceError);
  const perDay: Record<string, any[]> = {};
  days.forEach((d, i) => (perDay[d] = guards(3, `d${i}`)));
  const good = fakePncp(perDay);
  const failDays = (bad: string[]) => async (url: string) => {
    if (bad.some((d) => url.includes(`dataInicial=${d.replace(/-/g, "")}`))) throw new SourceError("down", "x", 400);
    return good(url);
  };
  await assert.rejects(brContractsHarvest(now, { fetcher: failDays(days.slice(0, 3)) }), /not publishing a thin window/);
  const one = await brContractsHarvest(now, { fetcher: failDays([days[2]]) });
  assert.match(one.note ?? "", /Days not read: 2026-10-24/);
  await assert.rejects(brContractsHarvest(now, { fetcher: fakePncp({}) }), /no usable initial contracts/);
});

test("no library yet gives a readable error; bad state codes are refused", async () => {
  process.env.PROOFPRICE_LIBRARY_DIR = mkdtempSync(path.join(tmpdir(), "brpncp-empty-"));
  try {
    await assert.rejects(brContracts({ what: "laptops" }), /not been collected yet/);
  } finally {
    delete process.env.PROOFPRICE_LIBRARY_DIR;
  }
  assert.equal(stateOf(undefined), "ALL");
  assert.equal(stateOf(" rj "), "RJ");
  assert.throws(() => stateOf("ZZ"), InputError);
});

test("INFO: contract prices, free-tier wording, no suppliers", () => {
  assert.equal(INFO.price_type, "contract_price");
  assert.match(INFO.licence, /free of charge only/);
  assert.match(INFO.limits, /suppliers and their tax ids in the open file are never read/);
  assert.match(INFO.attribution, /Portal Nacional de Contratacoes Publicas/);
});

test("harvest keeps inside its time budget: no budget left means no day is read, newest days are read first, pages load in parallel", async () => {
  const now = new Date("2026-10-29T03:17:00Z");
  const days = windowDays(now);
  const perDay: Record<string, any[]> = {};
  days.forEach((d, i) => (perDay[d] = guards(3, `d${i}`)));
  await assert.rejects(brContractsHarvest(now, { fetcher: fakePncp(perDay), budgetMs: -1 }), /Could not read/);
  // parallel pages: 6 pages of one day are all requested, in at most two batches of 4
  let inFlight = 0, peak = 0;
  const base = fakePncp({ "2026-10-27": guards(6, "p") }, [], 3);
  const slow = async (url: string) => { inFlight++; peak = Math.max(peak, inFlight); await new Promise((r) => setTimeout(r, 5)); inFlight--; return base(url); };
  const d = await readDay("2026-10-27", { fetcher: slow, concurrency: 4 });
  assert.equal(d.contracts.length, 18); // the fake repeats 6 rows on each of its 3 pages
  assert.ok(peak > 1 && peak <= 4, `peak ${peak}`);
  // a deadline in the past stops after page 1 and marks the day incomplete
  const cut = await readDay("2026-10-27", { fetcher: base, deadline: 0 });
  assert.equal(cut.complete, false);
});

test("HTTP 429 is waited out and retried; a 400 is not; no time left means no retry", async () => {
  const base = fakePncp({ "2026-10-27": guards(6, "r") });
  let n = 0;
  const flaky = async (url: string) => { if (n++ < 2) throw new SourceError("PNCP returned HTTP 429", url, 429); return base(url); };
  const d = await readDay("2026-10-27", { fetcher: flaky, backoffMs: [1] });
  assert.equal(d.contracts.length, 6);
  assert.equal(n, 3);
  let m = 0;
  const bad = async (url: string) => { m++; throw new SourceError("HTTP 400", url, 400); };
  await assert.rejects(readDay("2026-10-27", { fetcher: bad, backoffMs: [1] }), /400/);
  assert.equal(m, 1);
  let k = 0;
  const always = async (url: string) => { k++; throw new SourceError("HTTP 429", url, 429); };
  await assert.rejects(readDay("2026-10-27", { fetcher: always, backoffMs: [1], deadline: 0 }), /429/);
  assert.equal(k, 1);
});
