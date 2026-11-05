import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseCsv, parseItbi, brNumber, dailyRows, lastCompleteMonth, servesFortaleza, resolveArea, fortalezaKey, monthsBack, ymToDate, INFO, type Rec } from "./source";

// Fixture: the first rows of the live ITBI CSV (dados.fortaleza.ce.gov.br, 41.8 MB, semicolon, ISO-8859-1 decoded), downloaded 5 Nov 2026.
const head = readFileSync(path.join(__dirname, "fixtures", "itbi-head.csv"), "utf8");

test("BR-FORTALEZA: Brazilian decimals", () => {
  assert.equal(brNumber("276666,66"), 276666.66);
  assert.equal(brNumber("0,02329547"), 0.02329547);
  assert.equal(brNumber("1.234,5"), 1234.5);
  assert.ok(Number.isNaN(brNumber("")));
});

test("BR-FORTALEZA: csv parser keeps quoted fields and empty fields", () => {
  const r = parseCsv('a;"b;c";;"d ""q"""\n1;2;3;4\n');
  assert.deepEqual(r, [["a", "b;c", "", 'd "q"'], ["1", "2", "3", "4"]]);
});

test("BR-FORTALEZA: parse the live head: commercial and 'Sem' use dropped, flat vs house by plot fraction, streets never kept", () => {
  const g = parseItbi(head);
  const kept = g.map((x) => [x.ym, x.area, x.kind, x.value]);
  assert.deepEqual(kept[0], [2022 * 12, "meireles", "apartment", 666730]);
  assert.deepEqual(kept[2], [2022 * 12, "granja-lisboa", "house", 180000.65]);
  assert.equal(g.length, 3); // fixture repeats the Meireles flat; the two commercial rows and the 'Sem' row are dropped
  assert.equal(g[0].m2, 666730 / 168.46);
  assert.ok(!JSON.stringify(g).match(/SILVA|JATAHY|DESCARTE|GURGEL/i));
});

test("BR-FORTALEZA: a changed file layout fails loudly", () => {
  assert.throws(() => parseItbi('"A";"B"\n1;2\n'), /unexpected format/);
});

function recs(): Rec[] {
  const out: Rec[] = [];
  const base = 2026 * 12 + 5; // June 2026
  for (let m = 0; m < 30; m++) {
    for (let i = 0; i < 20; i++) {
      out.push({ ym: base - m, area: "aldeota", kind: i % 4 === 0 ? "house" : "apartment", value: 400_000 + i * 10_000, m2: 8000 + i * 100 });
    }
    out.push({ ym: base - m, area: "tiny", kind: "apartment", value: 100_000, m2: null }); // 1 a month: never published under 5
  }
  return out;
}

test("BR-FORTALEZA: windows, never fewer than 5 records, whole city rows", () => {
  const { date, rows } = dailyRows(recs());
  assert.equal(date, "2026-06-30");
  const a = rows.find((r) => r.area === "aldeota" && r.item === "apartment:12m");
  assert.ok(a && a.n === 12 * 15);
  assert.ok(a.median >= 400_000 && a.median <= 600_000);
  assert.ok(rows.find((r) => r.area === "ALL" && r.item === "any:3m"));
  assert.ok(!rows.find((r) => r.area === "tiny" && r.item === "any:3m")); // 3 records < 5
  assert.ok(rows.find((r) => r.area === "tiny" && r.item === "any:12m")); // 12 records
  assert.ok(rows.every((r) => r.n >= 5));
  assert.ok(rows.find((r) => r.item === "any-m2:6m"));
});

test("BR-FORTALEZA: a half-filled newest month is left out", () => {
  const r = recs();
  const newest = 2026 * 12 + 6;
  for (let i = 0; i < 5; i++) r.push({ ym: newest, area: "aldeota", kind: "apartment", value: 1_000_000, m2: null });
  assert.equal(lastCompleteMonth(r), 2026 * 12 + 5);
  r.push(...Array.from({ length: 20 }, () => ({ ym: newest, area: "aldeota", kind: "apartment" as const, value: 500_000, m2: null })));
  assert.equal(lastCompleteMonth(r), newest);
});

test("BR-FORTALEZA: routing: Fortaleza places only, so Rio and Porto Alegre keep theirs", () => {
  assert.equal(servesFortaleza("Fortaleza"), true);
  assert.equal(servesFortaleza("Aldeota"), true);
  assert.equal(servesFortaleza("Meireles, Fortaleza - CE"), true);
  assert.equal(servesFortaleza(undefined, "60165-070"), true);
  assert.equal(servesFortaleza("Copacabana"), false);
  assert.equal(servesFortaleza("Petropolis"), false);
  assert.equal(servesFortaleza(undefined, "20000-000"), false);
  assert.equal(servesFortaleza(undefined), false);
});

test("BR-FORTALEZA: place and window resolution", () => {
  const known = ["aldeota", "praia-de-iracema", "meireles"];
  assert.deepEqual(resolveArea("Fortaleza", known), { area: "ALL", label: "Fortaleza" });
  assert.equal(resolveArea("Meireles, Fortaleza", known)?.area, "meireles");
  assert.equal(resolveArea("Praia Iracema", known)?.area, "praia-de-iracema");
  assert.equal(resolveArea("Atlantis", known), null);
  const k = fortalezaKey({ town: "Aldeota", property_type: "House", months: 10 }, known);
  assert.equal(k?.item, "house:12m");
  assert.equal(fortalezaKey({ town: "Aldeota", property_type: "castle" }, known), null);
});

test("BR-FORTALEZA: dates and licence label", () => {
  assert.equal(ymToDate(2026 * 12 + 1), "2026-02-28");
  assert.equal(monthsBack("2026-10-31", 12), "2025-11-01");
  assert.match(INFO.licence, /CC BY/);
  assert.match(INFO.limits, /not a verified price paid/);
});
