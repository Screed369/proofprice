import { test } from "node:test";
import assert from "node:assert/strict";
import { parseList, parseCsv, parsePrice, nameKey, fileDate, esDailyRows, esAnswerFromRow, esKey, esHistoryKey } from "./source";

// Rows copied from the live Nomenclator CSV (comma, quoted fields, decimal point), probed 18 Oct 2026 with especialidad=PARACETAMOL,
// plus the device row seen in the unfiltered file (code 400058, not a medicine).
const csv = `Código Nacional,Nombre del producto farmacéutico,Tipo de fármaco,Nombre genérico efecto y accesorio,Código del laboratorio ofertante,Nombre del laboratorio ofertante,Estado,Fecha de alta en el nomenclátor,Fecha de baja en el nomenclátor,Aportación del beneficiario,Principio activo o asociación de principios activos,Precio venta al público con IVA,Precio de referencia,Menor precio de la agrupación homogénea del producto sanitario,Código de la agrupación homogénea del producto sanitario,Nombre de la agrupación homogénea del producto sanitario,Diagnóstico hospitalario,Tratamiento de larga duración,Especial control médico,Medicamento huérfano
400058,FLEXIMA KEY CERRADA TR 40MM 30+7U,,BOLSAS COLOSTOMIA,378,B. BRAUN MEDICAL S.A.,ALTA,22/01/2007,,ESPECIAL,,55.15,,,,,,,,NO
655871,PARACETAMOL CINFA 1G 20 SOBR POLVO EFERVESCENT EFG,Medicamento Generico,,111,CINFA S.A.,BAJA GENERAL,11/12/2006,01/05/2024,NORMAL,PARACETAMOL,1.9,1.9,,2406,PARACETAMOL 1000 MG 20 SOBRES SOLUCION/SUSPENSION ORAL EFERVESCENTE,NO,NO,NO,NO
655905,"PARACETAMOL KERN PHARMA 650 mg comprimidos, 40 comprimidos",Medicamento Generico,,863,"KERN PHARMA, S.L.",ALTA,12/12/2006,,NORMAL,PARACETAMOL,1.31,1.31,1.31,3336,PARACETAMOL 650 MG 40 COMPRIMIDOS,NO,NO,NO,NO
656128,PARACETAMOL CINFA 650MG 20 COMPRIM RECUB PELIC EFG,Medicamento Generico,,111,CINFA S.A.,ALTA,15/01/2007,,NORMAL,PARACETAMOL,0.86,0.86,.86,3335,PARACETAMOL 650 MG 20 COMPRIMIDOS,NO,NO,NO,NO
656129,PARACETAMOL CINFA 650MG 40 COMPRIM RECUB PELIC EFG,Medicamento Generico,,111,CINFA S.A.,ALTA,15/01/2007,,NORMAL,PARACETAMOL,1.31,1.31,1.31,3336,PARACETAMOL 650 MG 40 COMPRIMIDOS,NO,NO,NO,NO
658228,"PARACETAMOL LEVEL 100 mg/ml solucion oral , 1 frasco de 30 ml",Medicamento Generico,,178,LABORATORIOS ERN S.A.,ALTA,01/09/2010,,NORMAL,PARACETAMOL,1.75,1.75,1.75,3330,PARACETAMOL 100 MG 30 ML SOLUCION/SUSPENSION ORAL,NO,NO,NO,NO
658230,"PARACETAMOL LEVEL 100 mg/ml solucion oral , 1 frasco de 60 ml",Medicamento Generico,,178,LABORATORIOS ERN S.A.,ALTA,01/09/2010,,NORMAL,PARACETAMOL,3.12,3.12,3.12,3331,PARACETAMOL 100 MG 60 ML SOLUCION/SUSPENSION ORAL,NO,NO,NO,NO
658244,"PARACETAMOL NORMON 500 mg Comprimidos, 20 comprimidos",Medicamento Generico,,426,NORMON S.A.,ALTA,21/05/2007,,NORMAL,PARACETAMOL,0.67,0.67,.67,2429,PARACETAMOL 500 MG 20 COMPRIMIDOS,NO,NO,NO,NO
`;

test("es-medicines parses the live layout and keeps only priced medicines on sale", () => {
  const packs = parseList(csv);
  assert.equal(packs.length, 6); // device row (400058) and BAJA row (655871) dropped
  assert.deepEqual(packs[1], { cn: "656128", substance: "PARACETAMOL", product: "PARACETAMOL CINFA 650MG 20 COMPRIM RECUB PELIC EFG", price: 0.86, reference: 0.86 });
  assert.throws(() => parseList("A,B\n1,2"));
});
test("es-medicines helpers", () => {
  assert.equal(parsePrice("1.9"), 1.9);
  assert.equal(parsePrice(".86"), 0.86);
  assert.equal(parsePrice(""), null);
  assert.equal(parsePrice("0"), null);
  assert.equal(nameKey("Ácido acetilsalicílico"), "acetilsalicilico");
  assert.equal(nameKey("PARACETAMOL CINFA 1G"), "paracetamol");
  assert.equal(nameKey("10 mg"), null);
  assert.deepEqual(parseCsv('a,"b ""q"", c",d\r\ne,f,g'), [["a", 'b "q", c', "d"], ["e", "f", "g"]]);
  assert.equal(fileDate('attachment; filename="20261018_Nomenclator_de_Facturacion.csv"'), "2026-10-18");
  assert.equal(fileDate(null), null);
});
test("es-medicines daily rows need 5 packs per name and count a pack once per key", () => {
  const rows = esDailyRows(parseList(csv));
  const p = rows.find((r) => r.item === "name:paracetamol");
  assert.equal(p?.n, 6); // ingredient and product name give the same key: counted once
  assert.ok(rows.every((r) => r.area === "ALL" && r.n >= 5));
  const few = parseList(csv.split("\n").slice(0, 5).join("\n"));
  assert.equal(esDailyRows(few).length, 0);
});
test("es-medicines keys and answer", () => {
  assert.equal(esKey("Dolocatil 1g").item, "name:dolocatil");
  assert.throws(() => esKey(""));
  assert.equal(esHistoryKey({})?.item, undefined);
  assert.equal(esHistoryKey({ medicine: "paracetamol" })?.item, "name:paracetamol");
  const row = { date: "2026-10-18", area: "ALL", item: "name:paracetamol", n: 40, median: 1.31, low: 0.67, high: 2.5, min: 0.5, max: 3.12 };
  const a = esAnswerFromRow(row, { key: "paracetamol", today: "2026-10-18" });
  assert.equal(a.status, "ok");
  assert.equal(a.price_type, "posted_price");
  assert.equal(a.price?.median, 1.31);
  assert.match(a.summary, /legally fixed public price/);
  assert.match(a.summary, /not market transactions/);
  assert.doesNotMatch(a.summary, /paid|sold for/);
  assert.equal((esAnswerFromRow(row, { key: "paracetamol", today: "2026-11-01" }).extra as any).stale, true);
  assert.equal(esAnswerFromRow({ ...row, n: 4 }, { key: "paracetamol", today: "2026-10-18" }).status, "insufficient_data");
});
