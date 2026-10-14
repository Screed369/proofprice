import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv, dvfSales, windowSales, frDescribe, INFO } from "./source";

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

test("FR DVF: a missing or tiny valeur_fonciere is never a price (audit 2026-10-14)", () => {
  const h = dvfCsv.split("\n")[0];
  const rows = parseCsv([
    h,
    "2025-7,2025-05-01,000001,Vente,,1,RUE A,69003,69383,Lyon 3e Arrondissement,Appartement,30,1",
    "2025-8,2025-05-02,000001,Vente,0,1,RUE B,69003,69383,Lyon 3e Arrondissement,Appartement,30,1",
    "2025-9,2025-05-03,000001,Vente,9500,1,RUE C,69003,69383,Lyon 3e Arrondissement,Maison,30,1",
  ].join("\n"));
  assert.deepEqual(dvfSales(rows), []);
});

test("FR DVF: summary says per home, single-home sales, the percentile range and the publication delay (audit 2026-10-14)", () => {
  const t = frDescribe("apartment", "postcode 69003", { median: 250000, low: 127000, high: 466085 }, "2025-12-31");
  assert.match(t, /^Apartments in postcode 69003 sold for a median of €250,000 per home \(single-home sales only\)/);
  assert.match(t, /typical range \(10th–90th percentile\) €127,000–€466,085/);
  assert.match(t, /delay of several months, so the latest sale included is from 2025-12-31/);
  assert.match(INFO.limits, /several homes in one deed \(multi-lot sales\)/);
  assert.match(INFO.limits, /price per m² .* built floor area/);
});
