import { test } from "node:test";
import assert from "node:assert/strict";
import { asciiKey, parseCatmat, awardRecords, medicineDailyRows, readAwards, matchIngredient, queryKey, medicineAnswer, parseItem, windowStart, AwardRecord } from "./source";

// Real compiled release (trimmed) from the Medicamentos Transparentes file, OCP publication 153, read 5 Nov 2026.
const RELEASE = {"id": "ocds-ye9ov3-10358190000177_2024_209-2024-09-25T12:29:05Z", "date": "2024-09-25T12:29:05Z", "ocid": "ocds-ye9ov3-10358190000177_2024_209", "tender": {"items": [{"id": "6", "unit": {"name": "Frasco", "value": {"amount": 10.74, "currency": "BRL"}}, "quantity": 1500, "attributes": [{"id": "1", "name": "Tipo", "value": "Hidratado"}], "dosageForm": "Líquido", "relatedLot": "lot-6", "description": "ÁLCOOL ETÍLICO   -   tipo:   hidratado,   teor   alcoólico:  70%_(70°gl). Apresentação: líquido. EMBALAGEM: Frasco 1000 ML", "classification": {"id": "269941", "uri": "https://cnbs.estaleiro.serpro.gov.br/cnbs-api/material/v1/recuperaDadosItemMaterialPorCodigo?codigo_item_material=269941", "scheme": "CATMAT", "description": "269941 - Álcool Etílico, Tipo:Hidratado, Teor Alcoólico:70%_(70°Gl), Apresentação:Líquido"}, "activeIngredients": [{"name": "Álcool Etílico", "strength": {"unit": {"id": "%", "scheme": "UNCEFACT"}, "value": 0.7}}]}]}, "awards": [{"id": "1", "date": "2024-10-18T03:00:00Z", "items": [{"id": "6", "unit": {"name": "Frasco", "value": {"amount": 4.98, "currency": "BRL"}}, "status": "Informado", "quantity": 1500, "relatedLot": "lot-6", "description": "ÁLCOOL ETÍLICO   -   tipo:   hidratado,   teor   alcoólico:  70%_(70°gl). Apresentação: líquido. EMBALAGEM: Frasco 1000 ML"}]}]};

test("br-medicamentos parses the CATMAT description", () => {
  assert.deepEqual(parseCatmat("269941 - Álcool Etílico, Tipo:Hidratado, Teor Alcoólico:70%_(70°Gl), Apresentação:Líquido"),
    { code: "269941", ingredient: "alcool etilico", detail: "Tipo Hidratado; Teor Alcoólico 70%_(70°Gl); Apresentação Líquido" });
  assert.equal(parseCatmat("no code here"), null);
  assert.equal(asciiKey("Ácido Acetilsalicílico"), "acido acetilsalicilico");
});
test("br-medicamentos reads the awarded unit price of a real release", () => {
  const r = awardRecords(RELEASE);
  assert.equal(r.length, 1);
  assert.equal(r[0].price, 4.98);
  assert.equal(r[0].catmat, "269941");
  assert.equal(r[0].unit, "frasco");
  assert.equal(r[0].date, "2024-10-18");
  assert.deepEqual(awardRecords({}), []);
  assert.deepEqual(awardRecords({ awards: [{ date: "2024-01-01", items: [{ id: "1", unit: { name: "x", value: { amount: 0 } } }] }] }), []);
});
function recs(n: number, price: (i: number) => number, date = "2026-03-01", unit = "comprimido", catmat = "1001"): AwardRecord[] {
  return Array.from({ length: n }, (_, i) => ({ ingredient: "dipirona sodica", catmat, detail: "Dosagem 500 MG", unit, price: price(i), date }));
}
test("br-medicamentos needs 5 awards, one unit per code, inside the 24 month window", () => {
  assert.equal(medicineDailyRows(recs(4, () => 1), "2026-05-01").length, 0);
  const rows = medicineDailyRows([...recs(6, (i) => 1 + i), ...recs(2, () => 900, "2026-03-01", "caixa"), ...recs(9, () => 5, "2023-01-01")], "2026-05-01");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].n, 6);
  assert.equal(rows[0].area, "ALL");
  assert.equal(rows[0].item, "dipirona sodica|1001|Dosagem 500 MG|comprimido");
  assert.equal(windowStart("2026-05-06"), "2024-05-06");
});
test("br-medicamentos matches by name, alias and word prefix, best ingredient first", async () => {
  const rows = [
    ...medicineDailyRows(recs(10, (i) => 1 + i), "2026-05-01"),
    ...medicineDailyRows(recs(7, (i) => 3 + i, "2026-03-01", "frasco", "2002").map((r) => ({ ...r, ingredient: "acido acetilsalicilico", detail: "Dosagem 100 MG" })), "2026-05-01"),
  ];
  assert.equal(matchIngredient(rows, "dipirona")[0].catmat, "1001");
  assert.equal(matchIngredient(rows, queryKey("Aspirin"))[0].catmat, "2002");
  assert.equal(matchIngredient(rows, "sodica")[0].ingredient, "dipirona sodica");
  assert.equal(matchIngredient(rows, "zzzz").length, 0);
  assert.throws(() => queryKey(""));
  assert.equal(parseItem(rows[0].item)?.unit, "comprimido");
  const a = medicineAnswer(matchIngredient(rows, "dipirona"), { key: "dipirona", date: "2026-11-05", newest: "2026-05-06", today: "2026-11-06" });
  assert.equal(a.status, "ok");
  assert.equal(a.sample_size, 10);
  assert.equal(a.price_type, "contract_price");
  assert.match(a.answer ?? JSON.stringify(a), /not pharmacy prices/);
  assert.equal(a.period.from, "2024-05-06");
});
test("br-medicamentos streams JSON lines and ignores broken ones", async () => {
  async function* lines() { yield JSON.stringify(RELEASE); yield "not json"; yield ""; }
  const out = await readAwards(lines());
  assert.equal(out.releases, 1);
  assert.equal(out.recs.length, 1);
  assert.equal(out.newest, "2024-10-18");
});
