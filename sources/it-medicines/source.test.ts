import { test } from "node:test";
import assert from "node:assert/strict";
import { parseList, parseCsv, parseEuro, headerDate, nameKey, decodeCsv, itDailyRows, itAnswerFromRow, itKey, itHistoryKey } from "./source";

// First rows of the live Lista_farmaci_equivalenti.csv (semicolon, quoted fields, decimal comma), probed 15 Oct 2026.
const csv = `Principio attivo;Confezione di riferimento;ATC;AIC;Farmaco;Confezione;Ditta;Prezzo riferimento SSN;Prezzo Pubblico 15 ottobre 2026;Differenza;Nota;Codice gruppo equivalenza
Acarbosio;40 UNITA' 100 MG - USO ORALE;A10BF01;44155024;ACARBOSIO DOC GENERICI;"""100 MG COMPRESSE"" 40 COMPRESSE IN BLISTER PVC/PE/PVDC-AL";DOC GENERICI S.R.L.;5,63 ;5,63 ;0,00 ;;H1A
Acarbosio;40 UNITA' 100 MG - USO ORALE;A10BF01;39716182;ACARBOSIO TECNIGEN;"""100 MG COMPRESSE"" 40 COMPRESSE IN BLISTER PVC/PCTFE/PVC/AL";TECNIMEDE SOCIEDADE TECNICO-MEDICINAL S.A.;5,63 ;5,63 ;0,00 ;;H1A
Acarbosio;40 UNITA' 100 MG - USO ORALE;A10BF01;38835144;ACARPHAGE;"""100 MG COMPRESSE"" 40 COMPRESSE IN BLISTER AL/AL";BRUNO FARMACEUTICI S.P.A.;5,63 ;5,63 ;0,00 ;;H1A
Acarbosio;40 UNITA' 100 MG - USO ORALE;A10BF01;26851016;GLUCOBAY;"""100 MG COMPRESSE"" 40 COMPRESSE";BAYER S.P.A.;5,63 ;8,04 ;2,41 ;;H1A
Acarbosio;40 UNITA' 50 MG - USO ORALE;A10BF01;47612027;ACARBOSIO AUROBINDO;"""50 MG COMPRESSE"" 40 COMPRESSE IN BLISTER PVC/PE/PVDC/AL";AUROBINDO PHARMA ITALIA S.R.L.;5,63 ;5,63 ;0,00 ;;H1B
Acarbosio;40 UNITA' 50 MG - USO ORALE;A10BF01;44155012;ACARBOSIO DOC GENERICI;"""50 MG COMPRESSE"" 40 COMPRESSE IN BLISTER PVC/PE/PVDC-AL";DOC GENERICI S.R.L.;5,63 ;5,63 ;0,00 ;;H1B
Acarbosio;40 UNITA' 50 MG - USO ORALE;A10BF01;39716170;ACARBOSIO TECNIGEN;"""50 MG COMPRESSE"" 40 COMPRESSE IN BLISTER PVC/PCTFE/PVC/AL";TECNIMEDE SOCIEDADE TECNICO-MEDICINAL S.A.;5,63 ;5,63 ;0,00 ;;H1B
Acarbosio;40 UNITA' 50 MG - USO ORALE;A10BF01;38835043;ACARPHAGE;"""50 MG COMPRESSE"" 40 COMPRESSE IN BLISTER AL/AL";BRUNO FARMACEUTICI S.P.A.;5,63 ;5,63 ;0,00 ;;H1B
Acarbosio;40 UNITA' 50 MG - USO ORALE;A10BF01;45430016;GLUCOBAY;"""50 MG COMPRESSE"" 40 COMPRESSE";GMM FARMA S.R.L.;5,63 ;7,49 ;1,86 ;;H1B
Acarbosio;40 UNITA' 50 MG - USO ORALE;A10BF01;26851028;GLUCOBAY;"""50 MG COMPRESSE"" 40 COMPRESSE";BAYER S.P.A.;5,63 ;8,04 ;2,41 ;;H1B
Aceclofenac;30 UNITA' 100 MG - USO ORALE;M01AB16;32773032;AIRTAL;"""100 MG POLVERE PER SOSPENSIONE ORALE"" 30 BUSTINE";ALMIRALL S.A.;7,69 ;7,73 ;0,04 ;;B5A\n`.replace(/\n/g, "\r\n");

test("it-medicines parses the live layout", () => {
  const l = parseList(csv);
  assert.equal(l.asOf, "2026-10-15");
  assert.equal(l.packs.length, 11);
  assert.deepEqual(l.packs[3], { aic: "26851016", substance: "Acarbosio", brand: "GLUCOBAY", reference: 5.63, price: 8.04 });
});
test("it-medicines helpers", () => {
  assert.equal(parseEuro("5,63 "), 5.63);
  assert.equal(parseEuro("1.234,50"), 1234.5);
  assert.equal(parseEuro("0,00 "), null);
  assert.equal(headerDate("Prezzo Pubblico 15 ottobre 2026"), "2026-10-15");
  assert.equal(headerDate("Prezzo Pubblico"), null);
  assert.equal(nameKey("Acido acetilsalicilico"), "acetilsalicilico");
  assert.equal(nameKey("Paracetamolo/codeina"), "paracetamolo");
  assert.equal(nameKey("10 mg"), null);
  assert.deepEqual(parseCsv('a;"b ""q"" c";d\r\ne;f;g'), [["a", 'b "q" c', "d"], ["e", "f", "g"]]);
  assert.equal(decodeCsv(Buffer.from([0x50, 0xe0])), "Pà"); // windows-1252 fallback
  assert.equal(decodeCsv(Buffer.from("Pà", "utf8")), "Pà");
  assert.throws(() => parseList("A;B\n1;2"));
});
test("it-medicines daily rows need 5 packs per name and count a pack once per key", () => {
  const l = parseList(csv);
  const rows = itDailyRows(l.packs);
  const acarb = rows.find((r) => r.item === "name:acarbosio");
  assert.equal(acarb?.n, 10); // 10 acarbosio packs (the brand GLUCOBAY has only 3 -> hidden)
  assert.equal(rows.find((r) => r.item === "name:glucobay"), undefined);
  assert.equal(rows.find((r) => r.item === "name:aceclofenac"), undefined);
  assert.ok(rows.every((r) => r.area === "ALL" && r.n >= 5));
  // a brand named like its substance is not double counted
  const dup = Array.from({ length: 5 }, (_, i) => ({ aic: String(i), substance: "Foo", brand: "FOO GENERICI", reference: 1, price: 2 + i }));
  assert.equal(itDailyRows(dup)[0].n, 5);
});
test("it-medicines keys and answer", () => {
  assert.equal(itKey("Tachipirina 1000").item, "name:tachipirina");
  assert.throws(() => itKey(""));
  assert.equal(itHistoryKey({})?.item, undefined);
  assert.equal(itHistoryKey({ medicine: "paracetamolo" })?.item, "name:paracetamolo");
  const row = { date: "2026-10-15", area: "ALL", item: "name:paracetamolo", n: 40, median: 3.2, low: 2.1, high: 6.5, min: 1.9, max: 9 };
  const a = itAnswerFromRow(row, { key: "paracetamolo", today: "2026-10-15" });
  assert.equal(a.status, "ok");
  assert.equal(a.price_type, "posted_price");
  assert.equal(a.price?.median, 3.2);
  assert.match(a.summary, /public shelf price \(per pack, incl\. VAT\)/);
  assert.match(a.summary, /not market transactions/);
  assert.doesNotMatch(a.summary, /paid|sold for/);
  assert.equal(a.extra, undefined);
  assert.equal((itAnswerFromRow(row, { key: "paracetamolo", today: "2026-10-30" }).extra as any).stale, true);
  assert.equal(itAnswerFromRow({ ...row, n: 4 }, { key: "paracetamolo", today: "2026-10-15" }).status, "insufficient_data");
});
