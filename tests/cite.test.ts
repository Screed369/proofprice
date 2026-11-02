import { test } from "node:test";
import assert from "node:assert/strict";
import { citationText, type CiteInput } from "../lib/site/cite";

const BASE: CiteInput = {
  title: "Diesel price in Madrid",
  headline: "€1.52",
  unit: "per litre",
  measure: "median",
  statistic: false,
  n: 212,
  basis: "Posted pump prices, not receipts.",
  period: null,
  asOf: "2026-11-01",
  publisher: "Ministerio para la Transición Ecológica",
  licence: "CC BY 4.0",
  path: "/prices/es/fuel/madrid",
};

test("cite: names figure, label, date, source, licence and link", () => {
  const t = citationText(BASE);
  for (const part of ["Diesel price in Madrid", "€1.52 per litre", "median", "212 records", "1 November 2026", "Ministerio", "CC BY 4.0", "https://proofprice.com/prices/es/fuel/madrid"]) {
    assert.ok(t.includes(part), `missing ${part} in: ${t}`);
  }
  assert.ok(!t.includes(".."), "no doubled full stops");
});

test("cite: a count under 5 is never printed, and an official statistic never claims records", () => {
  assert.ok(!/records/.test(citationText({ ...BASE, n: 4 })));
  const stat = citationText({ ...BASE, statistic: true, n: 500, period: "2026-Q2", measure: "average" });
  assert.ok(!/records/.test(stat));
  assert.ok(stat.includes("official average") && stat.includes("period 2026-Q2"));
});
