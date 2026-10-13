import { test } from "node:test";
import assert from "node:assert/strict";
import { normaliseFuel, stripAccents } from "../lib/fuels";
import { parseEsStations, parseEsPrice, esProvinceFromPostcode } from "../lib/sources/esfuel";
import { parseItStations, parseItPrices, selectItPrices, extractionDate } from "../lib/sources/itfuel";
import { parseCsv, dvfSales, windowSales } from "../lib/sources/frdvf";

test("fuel names normalise across countries", () => {
  assert.equal(normaliseFuel("gazole"), "diesel");
  assert.equal(normaliseFuel("Diesel"), "diesel");
  assert.equal(normaliseFuel("SP95"), "petrol95");
  assert.equal(normaliseFuel("gplc"), "lpg");
  assert.equal(normaliseFuel("metano"), "methane");
  assert.equal(normaliseFuel("kerosene"), null);
  assert.equal(stripAccents("Ágreda"), "AGREDA");
});

// Shape copied from the live Spanish service on 13 Oct 2026 (Soria, province 42).
const esSample = {
  Fecha: "13/10/2026 16:12:37",
  ResultadoConsulta: "OK",
  ListaEESSPrecio: [
    { "C.P.": "42146", "Dirección": "CARRERA N-234, 376,5", IDEESS: "6230", Municipio: "Abejar", "Precio Gasoleo A": "1,945", "Precio Gasolina 95 E5": "1,795", "Rótulo": "REPSOL", "Tipo Venta": "P" },
    { "C.P.": "42100", "Dirección": "POL. INDUSTRIAL LA DEHESA S/N", IDEESS: "8928", Municipio: "Ágreda", "Precio Gasoleo A": "", "Precio Gasolina 95 E5": "1,789", "Rótulo": "EL MAYORIA", "Tipo Venta": "P" },
    { "C.P.": "42100", "Dirección": "COOP", IDEESS: "9999", Municipio: "Ágreda", "Precio Gasoleo A": "1,500", "Rótulo": "COOP", "Tipo Venta": "R" },
  ],
};

test("ES: stations parse, comma decimals, restricted stations excluded", () => {
  assert.equal(parseEsPrice("1,945"), 1.945);
  assert.ok(Number.isNaN(parseEsPrice("")));
  assert.equal(esProvinceFromPostcode("28001"), "28");
  assert.equal(esProvinceFromPostcode("99001"), null);
  const { stations, fecha } = parseEsStations(esSample, "diesel");
  assert.equal(fecha, "13/10/2026 16:12:37");
  assert.equal(stations.length, 1); // empty price dropped, restricted 'R' dropped
  assert.equal(stations[0].price, 1.945);
  assert.equal(parseEsStations(esSample, "petrol95").stations.length, 2);
  assert.throws(() => parseEsStations({}, "diesel"));
});

// Shape copied from the live MIMIT files on 13 Oct 2026.
const itStationsCsv = [
  "Estrazione del 2026-10-12",
  "idImpianto|Gestore|Bandiera|Tipo Impianto|Nome Impianto|Indirizzo|Comune|Provincia|Latitudine|Longitudine",
  "59183|ENIMOOV S.P.A.|Agip Eni|Stradale|19829 AGRIGENTO|SS.189 KM. 64+649 - C.DA SAN MICHELE  S.N.C  |AGRIGENTO|AG|37.333935|13.595533",
  "63381|ENIMOOV S.P.A.|Agip Eni|Stradale|19834\tMONTALLEGRO|SS.115 | KM.158+302|AGRIGENTO|AG|37.38895|13.351206",
  "70000|ROSSI SRL|Q8|Stradale|Q8 MILANO|VIA ROMA 1|MILANO|MI|45.46|9.19",
].join("\n");
const itPricesCsv = [
  "Estrazione del 2026-10-12",
  "idImpianto|descCarburante|prezzo|isSelf|dtComu",
  "59183|Gasolio|1.899|1|10/10/2026 07:30:00",
  "59183|Gasolio|2.099|0|10/10/2026 07:30:00",
  "63381|Gasolio|1.879|1|11/10/2026 08:00:00",
  "63381|Gasolio|1.990|1|23/05/2013 01:03:09",
  "70000|Gasolio|1.950|1|12/10/2026 06:00:00",
  "70000|GPL|0.799|0|12/10/2026 06:00:00",
].join("\n");

test("IT: files parse, stray pipes survive, stale prices and other provinces excluded", () => {
  assert.equal(extractionDate(itPricesCsv), "2026-10-12");
  const st = parseItStations(itStationsCsv);
  assert.equal(st.size, 3);
  assert.equal(st.get("63381")!.town, "AGRIGENTO");
  assert.equal(st.get("63381")!.province, "AG");
  const pr = parseItPrices(itPricesCsv);
  assert.equal(pr.length, 6);
  const ag = selectItPrices(pr, st, { fuel: "diesel", service: "self", province: "AG", extracted: "2026-10-12" });
  assert.deepEqual(ag.map((r) => r.price).sort(), [1.879, 1.899]); // 2013 price dropped, attended price dropped
  const served = selectItPrices(pr, st, { fuel: "diesel", service: "served", province: "AG", extracted: "2026-10-12" });
  assert.deepEqual(served.map((r) => r.price), [2.099]);
  const lpg = selectItPrices(pr, st, { fuel: "lpg", service: "self", town: "Milano", extracted: "2026-10-12" });
  assert.deepEqual(lpg.map((r) => r.price), [0.799]); // LPG counted whatever the service type
});

// Columns as published in geo-dvf; values invented for the test.
const dvfCsv = [
  "id_mutation,date_mutation,numero_disposition,nature_mutation,valeur_fonciere,adresse_numero,adresse_nom_voie,code_postal,code_commune,nom_commune,type_local,surface_reelle_bati,nombre_pieces_principales",
  '2025-1,2025-03-01,000001,Vente,250000,12,"RUE DE LA PAIX, BAT A",69003,69383,Lyon 3e Arrondissement,Appartement,50,2',
  "2025-1,2025-03-01,000001,Vente,250000,12,RUE DE LA PAIX,69003,69383,Lyon 3e Arrondissement,Dépendance,,0",
  "2025-2,2025-06-10,000001,Vente,480000,3,RUE X,69003,69383,Lyon 3e Arrondissement,Maison,110,5",
  "2025-3,2025-07-01,000001,Vente,900000,5,RUE Y,69003,69383,Lyon 3e Arrondissement,Appartement,40,2",
  "2025-3,2025-07-01,000001,Vente,900000,5,RUE Y,69003,69383,Lyon 3e Arrondissement,Appartement,45,2",
  "2025-4,2025-08-01,000001,Vente,600000,7,RUE Z,69003,69383,Lyon 3e Arrondissement,Local industriel. commercial ou assimilé,80,0",
  "2025-4,2025-08-01,000001,Vente,600000,7,RUE Z,69003,69383,Lyon 3e Arrondissement,Appartement,60,3",
  "2025-5,2025-09-01,000001,Echange,300000,9,RUE W,69003,69383,Lyon 3e Arrondissement,Appartement,70,3",
  "2024-9,2024-01-15,000001,Vente,200000,1,RUE V,69003,69383,Lyon 3e Arrondissement,Appartement,45,2",
].join("\n");

test("FR DVF: one sale per mutation, single homes only, quoted commas handled", () => {
  const rows = parseCsv(dvfCsv);
  assert.equal(rows[1][6], "RUE DE LA PAIX, BAT A");
  const sales = dvfSales(rows);
  const ids = sales.map((s) => s.id).sort();
  // 2025-3 (two flats), 2025-4 (with commercial unit) and 2025-5 (exchange) are excluded
  assert.deepEqual(ids, ["2024-9", "2025-1", "2025-2"]);
  assert.equal(sales.find((s) => s.id === "2025-1")!.type, "apartment");
  assert.equal(sales.find((s) => s.id === "2025-2")!.type, "house");
  const w = windowSales(sales, 12);
  assert.equal(w.to, "2025-06-10");
  assert.deepEqual(w.kept.map((s) => s.id).sort(), ["2025-1", "2025-2"]); // Jan 2024 falls outside 12 months
});
