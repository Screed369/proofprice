import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePtStations, parsePtPrice, ptDistrictId, ptNationalUrl, ptFuelNow, ptDailyRecords, ptHistoryKey, PT_FUEL_ID } from "./source";

// Copied from the live DGEG service on 2 Nov 2026: GET /api/PrecoComb/PesquisarPostos?idsTiposComb=2101&idDistrito=11&qtdPorPagina=5&pagina=1&orderDesc=
const live = {
 "status": true,
 "mensagem": "sucesso",
 "resultado": [
  {
   "Id": 65399,
   "Nome": "PETROPÓVOA LDA",
   "TipoPosto": "Outro",
   "Municipio": "Mafra",
   "Preco": "2,257 €",
   "Marca": "GALP",
   "Combustivel": "Gasóleo simples",
   "DataAtualizacao": "2026-10-24 00:00",
   "Distrito": "Lisboa",
   "Morada": "EN 247 (Rua Dr. Burnay nº 2) Km 51,7",
   "Localidade": "Ericeira",
   "CodPostal": "2655-319",
   "Latitude": 38.958479,
   "Longitude": -9.414707,
   "Quantidade": 359
  },
  {
   "Id": 65667,
   "Nome": "PETROPÓVOA - COMÉRCIO DE COMBUSTÍVEIS, LDA.",
   "TipoPosto": "Outro",
   "Municipio": "Sintra",
   "Preco": "2,287 €",
   "Marca": "GALP",
   "Combustivel": "Gasóleo simples",
   "DataAtualizacao": "2026-10-24 00:00",
   "Distrito": "Lisboa",
   "Morada": "Arneiro dos Marinheiros",
   "Localidade": "São João das Lampas",
   "CodPostal": "2710-343",
   "Latitude": 38.86304,
   "Longitude": -9.41773,
   "Quantidade": 359
  },
  {
   "Id": 66615,
   "Nome": "E.S. LOURINHA",
   "TipoPosto": "Outro",
   "Municipio": "Lourinhã",
   "Preco": "2,269 €",
   "Marca": "REPSOL",
   "Combustivel": "Gasóleo simples",
   "DataAtualizacao": "2026-10-26 00:00",
   "Distrito": "Lisboa",
   "Morada": "EN 24 Km 12,2",
   "Localidade": "Lourinhã",
   "CodPostal": "2530-000",
   "Latitude": 39.24994,
   "Longitude": -9.31278,
   "Quantidade": 359
  },
  {
   "Id": 66619,
   "Nome": "E.S. ALCOITAO",
   "TipoPosto": "Outro",
   "Municipio": "Cascais",
   "Preco": "2,319 €",
   "Marca": "REPSOL",
   "Combustivel": "Gasóleo simples",
   "DataAtualizacao": "2026-10-26 00:00",
   "Distrito": "Lisboa",
   "Morada": "Av. Bombeiros Voluntários nº 61",
   "Localidade": "Alto do Estoril",
   "CodPostal": "2765-202",
   "Latitude": 38.71275,
   "Longitude": -9.39388,
   "Quantidade": 359
  },
  {
   "Id": 66623,
   "Nome": "E.S. MASSAMÁ",
   "TipoPosto": "Outro",
   "Municipio": "Sintra",
   "Preco": "2,319 €",
   "Marca": "REPSOL",
   "Combustivel": "Gasóleo simples",
   "DataAtualizacao": "2026-10-26 00:00",
   "Distrito": "Lisboa",
   "Morada": "Av. General Humberto Delgado Lt.6\r\n\r\nMonte Abraão",
   "Localidade": "Massamá",
   "CodPostal": "2745-280",
   "Latitude": 38.763733,
   "Longitude": -9.258619,
   "Quantidade": 359
  }
 ],
 "token": null
};

test("PT: live format parses (decimal comma, euro sign, district names)", () => {
  assert.equal(parsePtPrice("2,257 €"), 2.257);
  assert.ok(Number.isNaN(parsePtPrice("0,000 €")));
  assert.ok(Number.isNaN(parsePtPrice("")));
  assert.ok(Number.isNaN(parsePtPrice(null)));
  const st = parsePtStations(live);
  assert.equal(st.length, 5);
  assert.equal(st[0].price, 2.257);
  assert.equal(st[0].district, "11");
  assert.equal(st[0].town, "Mafra");
  assert.throws(() => parsePtStations({ status: false }), /Unexpected/);
});

test("PT: districts accept names, numbers and accents", () => {
  assert.equal(ptDistrictId("Lisboa"), "11");
  assert.equal(ptDistrictId("lisboa"), "11");
  assert.equal(ptDistrictId("13"), "13");
  assert.equal(ptDistrictId("Évora"), "07");
  assert.equal(ptDistrictId("Braganca"), "04");
  assert.equal(ptDistrictId("Madrid"), null);
});

test("PT: the request carries every parameter, including the empty ones (a missing orderDesc= gives HTTP 500)", () => {
  const u = ptNationalUrl("diesel");
  assert.match(u, /idsTiposComb=2101&idMarca=&idTipoPosto=&idDistrito=&idsMunicipios=&qtdPorPagina=\d+&pagina=1&orderDesc=$/);
  assert.equal(PT_FUEL_ID.petrol95, 3201);
});

// Twelve stations: 7 in Lisboa (Cascais 2), 5 in Porto, spread of prices.
function fake(n: number, district: string, town: string, base: number, postcode: string) {
  return Array.from({ length: n }, (_, i) => ({
    Id: i, Nome: `S ${town} ${i}`, TipoPosto: "Outro", Municipio: town, Preco: `${(base + i * 0.01).toFixed(3).replace(".", ",")} €`, Marca: "X",
    Combustivel: "Gasóleo simples", DataAtualizacao: "2026-10-2" + (i % 9) + " 00:00", Distrito: district, CodPostal: postcode, Localidade: town,
  }));
}
const national = { status: true, mensagem: "sucesso", resultado: [...fake(5, "Lisboa", "Sintra", 1.9, "2710-343"), ...fake(2, "Lisboa", "Cascais", 1.95, "2750-001"), ...fake(5, "Porto", "Porto", 1.85, "4000-001")] };

async function withFetch<T>(run: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify(national), { status: 200, headers: { "content-type": "application/json" } })) as any;
  try {
    return await run();
  } finally {
    globalThis.fetch = real;
  }
}

test("PT: country-only, district, town and thin-town widening all answer", async () => {
  await withFetch(async () => {
    const nat = await ptFuelNow({ fuel: "diesel" });
    assert.equal(nat.status, "ok");
    assert.equal(nat.sample_size, 12);
    const por = await ptFuelNow({ area: "Porto", fuel: "diesel" });
    assert.equal(por.status, "ok");
    assert.equal(por.sample_size, 5);
    assert.equal(por.price?.currency, "EUR");
    const sin = await ptFuelNow({ town: "Sintra", fuel: "diesel" });
    assert.equal(sin.sample_size, 5);
    // Cascais has 2 stations: widened to the Lisboa district (7), and says so
    const cas = await ptFuelNow({ town: "Cascais", fuel: "diesel" });
    assert.equal(cas.sample_size, 7);
    assert.match(cas.summary, /Fewer than 5 stations/);
    assert.match(cas.summary, /Lisboa district/);
    // postcode prefix
    const pc = await ptFuelNow({ postcode: "4000-123", fuel: "diesel" });
    assert.equal(pc.sample_size, 5);
    await assert.rejects(ptFuelNow({ town: "Atlantis", fuel: "diesel" }), /no station found/);
    await assert.rejects(ptFuelNow({ area: "Madrid", fuel: "diesel" }), /district name/);
    await assert.rejects(ptFuelNow({ fuel: "e85" }), /not published for Portugal/);
  });
});

test("PT: daily library rows per district and country; history key", () => {
  const rows = ptDailyRecords({ diesel: parsePtStations(national) });
  const get = (a: string) => rows.find((r) => r.area === a && r.item === "diesel");
  assert.equal(get("ALL")?.n, 12);
  assert.equal(get("11")?.n, 7);
  assert.equal(get("13")?.n, 5);
  assert.deepEqual(ptHistoryKey({ area: "Porto", fuel: "diesel" }), { area: "13", item: "diesel", label: "Porto district" });
  assert.deepEqual(ptHistoryKey({ fuel: "diesel" }), { area: "ALL", item: "diesel", label: "mainland Portugal" });
  assert.equal(ptHistoryKey({ area: "Nowhere", fuel: "diesel" }), null);
  assert.equal(ptHistoryKey({ fuel: "e85" }), null);
});
