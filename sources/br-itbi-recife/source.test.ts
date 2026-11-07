import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseCsv, parseItbi, brNumber, csvUrls, dailyRows, lastCompleteMonth, servesRecife, resolveArea, recifeKey, monthsBack, ymToDate, INFO, type Rec } from "./source";

// Fixtures: the first rows of the live yearly CSVs (dados.recife.pe.gov.br, semicolon, UTF-8): the 2026 file has no quotes, the 2025 file quotes
// every field. Plus a trimmed CKAN package_show. All downloaded 7 Nov 2026. One exact duplicate line, one commercial house and one room are mixed in.
const f26 = readFileSync(path.join(__dirname, "fixtures", "itbi-2026-head.csv"), "utf8");
const f25 = readFileSync(path.join(__dirname, "fixtures", "itbi-2025-head.csv"), "utf8");
const pkg = JSON.parse(readFileSync(path.join(__dirname, "fixtures", "package-show.json"), "utf8"));

test("BR-RECIFE: Brazilian decimals", () => {
  assert.equal(brNumber("448283,29"), 448283.29);
  assert.equal(brNumber("1.234,5"), 1234.5);
  assert.ok(Number.isNaN(brNumber("")));
});

test("BR-RECIFE: unquoted 2026 file: residential apartments and houses only, duplicate dropped, streets never kept", () => {
  const g = parseItbi(f26);
  assert.deepEqual(g.map((x) => [x.ym, x.area, x.kind, x.value]), [
    [2026 * 12 + 7, "encruzilhada", "apartment", 448283.29],
    [2026 * 12 + 0, "rosarinho", "house", 490000],
    [2026 * 12 + 9, "boa-viagem", "apartment", 1300000],
  ]); // the repeated flat, the room (Sala, commercial) and the commercial house are dropped
  assert.equal(g[0].m2, 448283.29 / 118.64);
  assert.ok(!JSON.stringify(g).match(/caio pereira|regueira|aderval|luar do rosarinho/i));
});

test("BR-RECIFE: quoted 2025 file parses the same way", () => {
  const g = parseItbi(f25);
  assert.deepEqual(g.map((x) => [x.ym, x.area, x.kind, x.value]), [
    [2025 * 12 + 10, "encruzilhada", "house", 1882395],
    [2025 * 12 + 4, "boa-viagem", "apartment", 1283000],
  ]); // the warehouse, the room and the commercial house are dropped
});

test("BR-RECIFE: a changed file layout fails loudly", () => {
  assert.throws(() => parseItbi("a;b\n1;2\n"), /unexpected format/);
});

test("BR-RECIFE: accents merge: Graças and Gracas are one bairro, Indefinido is dropped", () => {
  const head = f26.split("\n")[0];
  const row = (b: string, v: string) => `rua x;1;;${v};${b};Recife;PE;2000;100;80;1;Simples;Casa;RESIDENCIAL;2026-03-03;Bom;Casa;0,00;1;;;2026`;
  const g = parseItbi([head, row("Graças", "300000,00"), row("Gracas", "310000,00"), row("Indefinido", "320000,00")].join("\n"));
  assert.deepEqual(g.map((x) => x.area), ["gracas", "gracas"]); // two lines (different values), one bairro; Indefinido is gone
});

test("BR-RECIFE: yearly files are found by the 'ITBI <year>' resource name, newest first", () => {
  const u = csvUrls(pkg);
  assert.equal(u[0].year, 2026);
  assert.match(u[0].url, /itbi_2026\.csv$/);
  assert.equal(u.length, 3); // the data dictionary JSON is skipped
});

function recs(): Rec[] {
  const out: Rec[] = [];
  const base = 2026 * 12 + 5; // June 2026
  for (let m = 0; m < 30; m++) {
    for (let i = 0; i < 20; i++) {
      out.push({ ym: base - m, area: "boa-viagem", kind: i % 4 === 0 ? "house" : "apartment", value: 400_000 + i * 10_000, m2: 8000 + i * 100 });
    }
    out.push({ ym: base - m, area: "tiny", kind: "apartment", value: 100_000, m2: null }); // 1 a month: never published under 5
  }
  return out;
}

test("BR-RECIFE: windows, never fewer than 5 records, whole city rows", () => {
  const { date, rows } = dailyRows(recs());
  assert.equal(date, "2026-06-30");
  const a = rows.find((r) => r.area === "boa-viagem" && r.item === "apartment:12m");
  assert.ok(a && a.n === 12 * 15);
  assert.ok(a.median >= 400_000 && a.median <= 600_000);
  assert.ok(rows.find((r) => r.area === "ALL" && r.item === "any:3m"));
  assert.ok(!rows.find((r) => r.area === "tiny" && r.item === "any:3m")); // 3 records < 5
  assert.ok(rows.find((r) => r.area === "tiny" && r.item === "any:12m")); // 12 records
  assert.ok(rows.every((r) => r.n >= 5));
  assert.ok(rows.find((r) => r.item === "any-m2:6m"));
});

test("BR-RECIFE: a half-filled newest month is left out", () => {
  const r = recs();
  const newest = 2026 * 12 + 6;
  for (let i = 0; i < 5; i++) r.push({ ym: newest, area: "boa-viagem", kind: "apartment", value: 1_000_000, m2: null });
  assert.equal(lastCompleteMonth(r), 2026 * 12 + 5);
  r.push(...Array.from({ length: 20 }, () => ({ ym: newest, area: "boa-viagem", kind: "apartment" as const, value: 500_000, m2: null })));
  assert.equal(lastCompleteMonth(r), newest);
});

test("BR-RECIFE: routing: Recife places only, so Fortaleza, Rio and Porto Alegre keep theirs", () => {
  assert.equal(servesRecife("Recife"), true);
  assert.equal(servesRecife("Boa Viagem"), true);
  assert.equal(servesRecife("Pina, Recife - PE"), true);
  assert.equal(servesRecife(undefined, "51021-040"), true);
  assert.equal(servesRecife("Copacabana"), false);
  assert.equal(servesRecife("Aldeota"), false);
  assert.equal(servesRecife("Campo Grande"), false);
  assert.equal(servesRecife("Petropolis"), false);
  assert.equal(servesRecife(undefined, "60165-070"), false);
  assert.equal(servesRecife(undefined), false);
});

test("BR-RECIFE: place and window resolution", () => {
  const known = ["boa-viagem", "ilha-do-leite", "pina"];
  assert.deepEqual(resolveArea("Recife", known), { area: "ALL", label: "Recife" });
  assert.equal(resolveArea("Pina, Recife", known)?.area, "pina");
  assert.equal(resolveArea("Ilha Leite", known)?.area, "ilha-do-leite");
  assert.equal(resolveArea("Atlantis", known), null);
  const k = recifeKey({ town: "Boa Viagem", property_type: "House", months: 10 }, known);
  assert.equal(k?.item, "house:12m");
  assert.equal(recifeKey({ town: "Boa Viagem", property_type: "castle" }, known), null);
});

test("BR-RECIFE: dates and licence label", () => {
  assert.equal(ymToDate(2026 * 12 + 1), "2026-02-28");
  assert.equal(monthsBack("2026-10-31", 12), "2025-11-01");
  assert.match(INFO.licence, /ODbL/);
  assert.match(INFO.limits, /not a verified price paid/);
});
