import { test } from "node:test";
import assert from "node:assert/strict";
import { brFurniture, buildUrl, INFO, parseAwards, PRODUCTS, resolveProduct, ufOf } from "./source";
import { InputError, SourceError } from "../../lib/http";

// Rows copied from the live format (Compras.gov.br 1_consultarMaterial, PDM 310 filing cabinets), checked 2026-10-22; only the fields we read are kept.
const LIVE = {
  resultado: [
    { idCompra: "92001905000012026", codigoItemCatalogo: 309427, codigoPdm: 310, quantidade: 5, precoUnitario: 960.0, dataCompra: "2026-09-27", estado: "SP", municipio: "SÃO PAULO", esfera: "M" },
    { idCompra: "92001905000022026", codigoItemCatalogo: 383413, codigoPdm: 310, quantidade: 1, precoUnitario: 678.0, dataCompra: "2026-09-24", estado: "MT", municipio: "CUIABÁ", esfera: "F" },
    { idCompra: "x", codigoItemCatalogo: 1, quantidade: 1, precoUnitario: 0, dataCompra: "2026-09-01" },
    { idCompra: "y", codigoItemCatalogo: 1, quantidade: 1, precoUnitario: 900, dataCompra: "" },
  ],
  totalRegistros: 4,
  totalPaginas: 1,
};

test("live rows become awards; zero prices and undated rows are dropped", () => {
  const r = parseAwards(LIVE);
  assert.deepEqual(r.awards.map((a) => [a.unitPrice, a.date]), [[960, "2026-09-27"], [678, "2026-09-24"]]);
  assert.equal(r.pages, 1);
  assert.throws(() => parseAwards({ nope: 1 }), SourceError);
});

test("products resolve from English or Portuguese words and from pdm:", () => {
  assert.equal(resolveProduct("Office chair").pdm, 313);
  assert.equal(resolveProduct("cadeira").pdm, 313);
  assert.equal(resolveProduct("filing cabinet").pdm, 310);
  assert.equal(resolveProduct("anything", "pdm:310").pdm, 310);
  assert.equal(resolveProduct("x", "pdm:99999").pdm, 99999);
  assert.throws(() => resolveProduct("laptop"), InputError);
  assert.throws(() => resolveProduct("chair", "310"), InputError);
  assert.equal(new Set(PRODUCTS.map((p) => p.pdm)).size, PRODUCTS.length);
});

test("state code and request URL", () => {
  assert.equal(ufOf("sp"), "SP");
  assert.equal(ufOf(undefined), undefined);
  assert.throws(() => ufOf("São Paulo"), InputError);
  const u = buildUrl(310, 2, "2025-10-29", "2026-10-29", "SP");
  assert.match(u, /tipo=codigoPdm&codigo=310&dataCompraInicio=2025-10-29&dataCompraFim=2026-10-29&estado=SP$/);
  assert.match(u, /tamanhoPagina=500/);
});

function rows(n: number, base: number) {
  return Array.from({ length: n }, (_, i) => ({ idCompra: `c${base}-${i}`, codigoItemCatalogo: 1, precoUnitario: base + i * 10, dataCompra: "2026-09-10" }));
}

test("answer: median unit price of at least 5 awards, deduplicated, paged, supplier-free", async () => {
  const urls: string[] = [];
  const pages = [{ resultado: [...rows(4, 500), ...rows(1, 500)], totalPaginas: 2 }, { resultado: rows(3, 700), totalPaginas: 2 }];
  const a = await brFurniture({ what: "office chair", fetcher: async (u) => { urls.push(u); return pages[urls.length - 1]; }, now: new Date("2026-10-29T00:00:00Z") });
  assert.equal(urls.length, 2);
  assert.equal(a.status, "ok");
  assert.equal(a.price?.currency, "BRL");
  assert.equal(a.sample_size, 7); // 4 + (duplicate of c500-0 dropped) + 3
  assert.equal(a.source.id, INFO.id);
  assert.match(a.summary, /not what a household pays in a shop/);
  assert.ok(!JSON.stringify(a).match(/nomeFornecedor|niFornecedor/));
});

test("answer: fewer than 5 awards gives no figure", async () => {
  const a = await brFurniture({ what: "safe", buyer_area: "DF", fetcher: async () => ({ resultado: rows(4, 800), totalPaginas: 1 }), now: new Date("2026-10-29T00:00:00Z") });
  assert.notEqual(a.status, "ok");
});

test("a slow later page keeps the awards already read; a failing first page is a failure", async () => {
  let n = 0;
  const a = await brFurniture({ what: "safe", fetcher: async () => { n++; if (n === 1) return { resultado: rows(6, 900), totalPaginas: 3 }; throw new SourceError("Source timed out", "x"); }, now: new Date("2026-10-29T00:00:00Z") });
  assert.equal(a.status, "ok");
  assert.equal(a.sample_size, 6);
  assert.match(String((a.extra as any).partial), /slow/);
  await assert.rejects(() => brFurniture({ what: "safe", fetcher: async () => { throw new SourceError("Source timed out", "x"); } }), SourceError);
});
