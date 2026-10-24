import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv, dvfCommercialSales, windowSales, frCommercialDescribe, INFO, knownCommunes, frHistoryKey, frHarvest } from "./source";

// Header exactly as published in geo-dvf (checked 17 Oct 2026 from files.data.gouv.fr/geo-dvf/latest/csv/2025/communes/33/33063.csv).
// Rows 2025-384850, -384860 and -384892 are real Bordeaux rows copied from that file (addresses shortened); the rest are invented for the test.
const H =
  "id_mutation,date_mutation,numero_disposition,nature_mutation,valeur_fonciere,adresse_numero,adresse_suffixe,adresse_nom_voie,adresse_code_voie,code_postal,code_commune,nom_commune,code_departement,ancien_code_commune,ancien_nom_commune,id_parcelle,ancien_id_parcelle,numero_volume,lot1_numero,lot1_surface_carrez,lot2_numero,lot2_surface_carrez,lot3_numero,lot3_surface_carrez,lot4_numero,lot4_surface_carrez,lot5_numero,lot5_surface_carrez,nombre_lots,code_type_local,type_local,surface_reelle_bati,nombre_pieces_principales,code_nature_culture,nature_culture,code_nature_culture_speciale,nature_culture_speciale,surface_terrain,longitude,latitude";
// Build a row from the fields we use; everything else stays empty.
const row = (id: string, date: string, nature: string, val: string, code: string, bati: string, nc = "", terrain = "") =>
  [id, date, "000001", nature, val, "1", "", "RUE X", "0001", "33000", "33063", "Bordeaux", "33", "", "", "33063000AB0001", "", "", "", "", "", "", "", "", "", "", "", "", "0", code, "", bati, "0", nc, "", "", "", terrain, "-0.55", "44.87"].join(",");
const csv = [
  H,
  row("2025-384850", "2025-01-08", "Vente", "180000", "4", "240"), // 750 EUR/m2
  row("2025-384860", "2025-01-09", "Vente", "480000", "4", "102", "S", ""), // 4706 EUR/m2, land row on the same line
  row("2025-384892", "2025-01-08", "Vente", "32000", "4", "21"), // 1524 EUR/m2
  row("c-4", "2025-02-01", "Vente", "300000", "4", "100"),
  row("c-4", "2025-02-01", "Vente", "300000", "3", "20"), // dependance allowed
  row("c-5", "2025-02-02", "Vente", "400000", "4", "50"),
  row("c-5", "2025-02-02", "Vente", "400000", "4", "50"), // two commercial units: left out
  row("c-6", "2025-02-03", "Vente", "500000", "4", "100"),
  row("c-6", "2025-02-03", "Vente", "500000", "2", "60"), // with a flat: left out
  row("c-7", "2025-02-04", "Echange", "500000", "4", "100"), // not a sale
  row("c-8", "2025-02-05", "Vente", "5000", "4", "100"), // under 10k
  row("c-9", "2025-02-06", "Vente", "200000", "4", "5"), // under 10 m2
  row("c-10", "2025-02-07", "Vente", "90000000", "4", "5000"), // over the ceiling
  row("l-1", "2025-03-01", "Vente", "120000", "", "", "S", "400"), // 300 EUR/m2
  row("l-2", "2025-03-02", "Vente", "200000", "", "", "S", "300"),
  row("l-2", "2025-03-02", "Vente", "200000", "", "", "S", "200"), // two plots summed: 400 EUR/m2
  row("l-3", "2025-03-03", "Vente", "90000", "", "", "T", "9000"), // farmland: left out
  row("l-4", "2025-03-04", "Vente", "150000", "", "", "S", "500"),
  row("l-4", "2025-03-04", "Vente", "150000", "", "", "T", "5000"), // mixed with farmland: left out
  row("l-5", "2025-03-05", "Vente", "100000", "3", "15", "S", "300"), // has a building: left out
  row("l-5", "2025-03-05", "Vente", "100000", "", "", "S", "300"),
  row("2024-1", "2023-01-10", "Vente", "100000", "4", "100"), // outside a 24-month window of 2025-03
].join("\n");

test("FR DVF commercial: one sale per mutation, single commercial unit, artefacts dropped", () => {
  const rows = parseCsv(csv);
  const sales = dvfCommercialSales(rows, "commercial");
  assert.deepEqual(sales.map((s) => s.id).sort(), ["2024-1", "2025-384850", "2025-384860", "2025-384892", "c-4"]);
  const b = sales.find((s) => s.id === "2025-384850")!;
  assert.equal(b.surface, 240);
  assert.equal(b.perSqm, 750);
  assert.equal(sales.find((s) => s.id === "c-4")!.surface, 100); // dependance surface not added
  const w = windowSales(sales, 24);
  assert.equal(w.to, "2025-02-01");
  assert.ok(!w.kept.some((s) => s.id === "2024-1"));
});

test("FR DVF land: ground only, type S only, parcels summed", () => {
  const sales = dvfCommercialSales(parseCsv(csv), "land");
  assert.deepEqual(sales.map((s) => s.id).sort(), ["l-1", "l-2"]);
  assert.equal(sales.find((s) => s.id === "l-2")!.surface, 500);
  assert.equal(sales.find((s) => s.id === "l-2")!.perSqm, 400);
});

test("FR DVF commercial: unexpected layout is refused", () => {
  assert.throws(() => dvfCommercialSales([["a", "b"], ["1", "2"]], "commercial"), /layout/);
});

test("FR DVF commercial: sentence and licence", () => {
  const t = frCommercialDescribe("commercial", "Bordeaux", { median: 2500, low: 900, high: 4700 }, "2025-06-30");
  assert.match(t, /Bordeaux/);
  assert.match(t, /per m²/);
  assert.match(INFO.attribution, /DGFiP/);
  assert.match(INFO.licence, /Etalab/);
});

test("FR commercial: known places resolve without the geo API; history key only for places and windows the copy holds", () => {
  assert.deepEqual(knownCommunes({ postcode: "69003" }), [{ code: "69383", nom: "Lyon 3e arrondissement", codeDepartement: "69" }]);
  assert.equal(knownCommunes({ town: "Toulouse" })![0].code, "31555");
  assert.equal(knownCommunes({ postcode: "33000" }), null);
  assert.deepEqual(frHistoryKey({ postcode: "69003" }), { area: "69383", item: "commercial:24m", label: "Lyon 3e arrondissement" });
  assert.deepEqual(frHistoryKey({ town: "Toulouse", property_type: "land", months: 24 }), { area: "31555", item: "land:24m", label: "Toulouse" });
  assert.equal(frHistoryKey({ town: "Toulouse", months: 12 }), null);
  assert.equal(frHistoryKey({ town: "Carcassonne" }), null);
  assert.equal(frHistoryKey({ town: "Toulouse", property_type: "castle" }), null);
});

test("FR commercial: harvest writes 24-month medians per m2 per place and type, 5+ sales only, wrong commune names skipped", async () => {
  const mk = (nom: string, n: number) =>
    [H, ...Array.from({ length: n }, (_, i) => row(`${nom}-c${i}`, `2026-0${(i % 6) + 1}-15`, "Vente", String(100000 + i * 10000), "4", "100")), ...Array.from({ length: n }, (_, i) => row(`${nom}-l${i}`, `2026-0${(i % 6) + 1}-16`, "Vente", String(50000 + i * 5000), "", "", "S", "500"))]
      .join("\n")
      .replaceAll("Bordeaux", nom);
  const fetchCsv = async (_y: number, c: { code: string }) => {
    if (c.code === "33063") return parseCsv(mk("Bordeaux", 6));
    if (c.code === "31555") return parseCsv(mk("Autre ville", 8)); // wrong name for Toulouse: skipped
    if (c.code === "59350") return parseCsv(mk("Lille", 2)); // 2+2 sales: no row
    return [];
  };
  const r = await frHarvest({ fetchCsv, years: [2025, 2026] });
  const b = r.rows.filter((x) => x.area === "33063");
  assert.deepEqual(b.map((x) => x.item).sort(), ["commercial:24m", "land:24m"]);
  assert.equal(b[0].n, 12);
  assert.ok(!r.rows.some((x) => x.area === "31555" || x.area === "59350"));
  assert.match(r.note!, /31555/);
  assert.equal(r.unit, "per m²");
  assert.match(r.date, /^2026-0\d-1[56]$/);
});
