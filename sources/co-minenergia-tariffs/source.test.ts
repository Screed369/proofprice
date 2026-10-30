// Tests for the Colombia electricity unit-cost source. fixtures/rows.json is a trimmed copy of the real rows of
// https://www.datos.gov.co/resource/ytme-6qnu.json (format checked 2026-10-30 through the GitHub probe: the first row is the real
// 2025 January ENEL Bogotá Nivel 1 row; the other rows keep the real spellings of operator and level labels with shortened values).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { InputError, SourceError } from "../../lib/http";
import { SOURCE_PLUGINS } from "../../lib/registry";
import { INFO, answerFromRows, coElectricity, normaliseLevel, normaliseOperator, operatorKey, parseLevel, parseRows } from "./source";

const JSON_FIXTURE = JSON.parse(readFileSync(new URL("./fixtures/rows.json", import.meta.url), "utf8"));
const ROWS = parseRows(JSON_FIXTURE);

test("licence and type", () => {
  assert.match(INFO.licence, /CC BY-SA 4\.0/);
  assert.equal(INFO.price_type, "posted_price");
});

test("operator and level labels, with the dataset's odd spellings", () => {
  assert.equal(operatorKey("CELSIA Colombia - Tolima"), "tolima");
  assert.equal(operatorKey("CELSIA - Valle del Cauca"), "valle");
  assert.equal(operatorKey("EMCALI - Cali"), "cali");
  assert.equal(operatorKey("ENEL Bogotá - Cundinamarca"), "bogota");
  assert.equal(operatorKey("Other"), null);
  assert.deepEqual(parseLevel("Nivel 1 ( Propiedad OR )"), { level: "1", ownership: "or" });
  assert.deepEqual(parseLevel("Nivel 1  (Propiedad Cliente)"), { level: "1", ownership: "customer" });
  assert.deepEqual(parseLevel("Nivel 1 (Propiedad Compartida)"), { level: "1", ownership: "shared" });
  assert.deepEqual(parseLevel("NIVEL II"), { level: "2", ownership: null });
  assert.equal(parseLevel("NIVEL IV"), null);
});

test("parses the rows and drops zero costs", () => {
  assert.equal(ROWS.length, 9);
  assert.deepEqual(ROWS[0], { year: 2025, month: 1, operator: "bogota", level: "1", ownership: "or", cu: 810.46 });
  assert.throws(() => parseRows({ error: true }), SourceError);
});

test("newest month for the default area (ENEL Bogotá, level 1)", () => {
  const a = answerFromRows(ROWS, { energy: "electricity" });
  assert.equal(a.status, "ok");
  assert.equal(a.price?.value, 850.25);
  assert.equal(a.price?.currency, "COP");
  assert.equal(a.sample_size, null);
  assert.equal(a.period.from, "2025-09-01");
  assert.equal(a.period.to, "2025-09-30");
  assert.equal((a.extra as any).previous_month, "2025-01");
  assert.equal((a.extra as any).previous_cu_cop_per_kwh, 810.46);
  assert.equal(a.price_type, "posted_price");
});

test("other areas and levels", () => {
  assert.equal(answerFromRows(ROWS, { operator: "cali" }).price?.value, 900.5);
  assert.equal(answerFromRows(ROWS, { operator: "Cali" }).period.from, "2025-08-01");
  assert.equal(answerFromRows(ROWS, { operator: "tolima" }).price?.value, 870);
  assert.equal(answerFromRows(ROWS, { operator: "bogota", consumption_band: "2" }).price?.value, 700.1);
  assert.throws(() => answerFromRows(ROWS, { operator: "bogota", consumption_band: "3" }), SourceError);
});

test("input errors say what is valid", () => {
  assert.throws(() => normaliseOperator("medellin"), InputError);
  assert.throws(() => normaliseLevel("7"), InputError);
  assert.throws(() => answerFromRows(ROWS, { energy: "gas" }), InputError);
  assert.equal(normaliseOperator(""), "bogota");
  assert.equal(normaliseLevel("Nivel 2"), "2");
});

test("live path with an injected fetcher", async () => {
  const urls: string[] = [];
  const a = await coElectricity({ energy: "electricity", operator: "valle" }, async (u) => { urls.push(u); return JSON_FIXTURE; });
  assert.equal(a.price?.value, 880.1);
  assert.match(urls[0], /^https:\/\/www\.datos\.gov\.co\/resource\/ytme-6qnu\.json\?/);
  await assert.rejects(coElectricity({ energy: "gas" }, async () => JSON_FIXTURE), InputError);
});

test("registered in the energy category for CO", () => {
  const p = SOURCE_PLUGINS.find((s) => s.info.id === "co-minenergia-tariffs");
  assert.ok(p);
  assert.equal(p!.category, "energy");
  assert.deepEqual(p!.countries, ["CO"]);
});
