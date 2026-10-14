import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCip, parseNames, parseEuro, parseRate, nameKey, frDailyRows, frAnswerFromRow, frKey, frHistoryKey } from "./source";

// Rows copied from the live CIS_CIP_bdpm.txt (UTF-8, tab separated, no header), probed 14 Oct 2026.
const cip = [
  "60002283\t4949729\tplaquette(s) PVC PVDC aluminium de 30 comprimé(s)\tPrésentation active\tDéclaration de commercialisation\t16/03/2011\t3400949497294\toui\t100%\t24,34\t25,36\t1,02\t",
  "60002283\t4949770\tplaquette(s) PVC PVDC aluminium de 90 comprimé(s)\tPrésentation active\tDéclaration de commercialisation\t19/09/2011\t3400949497706\toui\t100%\t68,68\t71,44\t2,76\t",
  "60004277\t3614582\tplaquette(s) thermoformée(s) PVC aluminium de 30 gélule(s)\tPrésentation active\tDéclaration de commercialisation\t11/06/2003\t3400936145825\toui\t65%\t1,54\t2,56\t1,02\t",
  "60007565\t3032373\t1 seringue préremplie\tPrésentation active\tDéclaration de commercialisation\t12/08/2026\t3400930323731\tnon\t65 %\t36,13\t37,15\t1,02\t",
  "60009999\t1111111\tflacon\tPrésentation active\tDéclaration d'arrêt de commercialisation\t01/01/2010\t3400911111111\toui\t\t\t\t\t",
  "60008888\t2222222\tboîte\tPrésentation active\tDéclaration de commercialisation\t01/01/2010\t3400922222222\tnon\t\t\t\t\t",
].join("\n");

// Rows in the style of the live CIS_bdpm.txt (latin-1, tab separated, no header): CIS, name, form, ...
const names = [
  "60002283\tDOLIPRANE 1000 mg, comprimé\tcomprimé\torale\tAutorisation active",
  "60004277\tDOLIPRANE 500 mg, gélule\tgélule\torale\tAutorisation active",
  "60007565\tÉNOXAPARINE TEVA 4000 UI, solution injectable\tsolution\tsous-cutanée\tAutorisation active",
  "bad line",
].join("\n");

test("fr-medicines parses priced, on-sale packs only", () => {
  const p = parseCip(cip);
  assert.equal(p.length, 4);
  assert.deepEqual({ cis: p[0].cis, cip13: p[0].cip13, rate: p[0].rate, incl: p[0].priceIncl, excl: p[0].priceExcl }, { cis: "60002283", cip13: "3400949497294", rate: 100, incl: 25.36, excl: 24.34 });
  assert.equal(p[3].rate, 65); // "65 %" with a space
});
test("fr-medicines number and name helpers", () => {
  assert.equal(parseEuro("1 234,56"), 1234.56);
  assert.equal(parseEuro("1,234,56"), 1234.56); // thousands comma: the last comma is the decimal mark, the pack is not dropped
  assert.equal(parseEuro("0,00"), null); // a 0 placeholder is missing, never a price of 0
  assert.equal(parseEuro(""), null);
  assert.equal(parseRate("15 %"), 15);
  assert.equal(nameKey("ÉNOXAPARINE TEVA 4000 UI"), "enoxaparine");
  assert.equal(nameKey("1000 mg"), null);
  assert.equal(parseNames(names).size, 3);
});
test("fr-medicines daily rows need 5 packs per name", () => {
  const p = parseCip(cip);
  assert.equal(frDailyRows(p, parseNames(names)).length, 0); // only 3 DOLIPRANE packs
  const many = Array.from({ length: 6 }, (_, i) => ({ cis: "60002283", cip13: String(i), rate: 65, priceIncl: 2 + i, priceExcl: 1 + i }));
  const rows = frDailyRows(many, parseNames(names));
  assert.equal(rows.length, 1);
  assert.deepEqual({ area: rows[0].area, item: rows[0].item, n: rows[0].n, min: rows[0].min, max: rows[0].max }, { area: "ALL", item: "name:doliprane", n: 6, min: 2, max: 7 });
});
test("fr-medicines keys and answer", () => {
  assert.equal(frKey("Doliprane 1000").item, "name:doliprane");
  assert.throws(() => frKey(""));
  assert.equal(frHistoryKey({})?.item, undefined);
  assert.equal(frHistoryKey({ medicine: "doliprane" })?.item, "name:doliprane");
  const row = { date: "2026-10-14", area: "ALL", item: "name:doliprane", n: 12, median: 2.5, low: 1.8, high: 4.2, min: 1.5, max: 5 };
  const a = frAnswerFromRow(row, { key: "doliprane", today: "2026-10-14" });
  assert.equal(a.status, "ok");
  assert.equal(a.price_type, "posted_price");
  assert.equal(a.price?.median, 2.5);
  assert.equal(a.price?.unit, "per box (incl. dispensing fee)");
  assert.match(a.summary, /legally fixed public price \(per box, incl\. VAT and the dispensing fee; also the base Assurance Maladie reimburses from\)/);
  assert.match(a.summary, /10th–90th percentile €1\.80–€4\.20 across the packs listed, which mix pack sizes and strengths/);
  assert.match(a.summary, /not market transactions; the patient pays this minus the reimbursement/);
  assert.doesNotMatch(a.summary, /paid|sold for/);
  assert.equal(a.extra, undefined);
  const old = frAnswerFromRow(row, { key: "doliprane", today: "2026-10-30" });
  assert.match(old.summary, /Our copy of the database is 16 days old \(collected 2026-10-14\)/);
  assert.equal((old.extra as any).stale, true);
  const few = frAnswerFromRow({ ...row, n: 4 }, { key: "doliprane", today: "2026-10-14" });
  assert.equal(few.status, "insufficient_data");
  assert.equal(few.price, null);
});
