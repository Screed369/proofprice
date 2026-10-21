// Tests for Singapore hospital bills (MOH). Rows are real, captured 2026-10-20 (see fixtures.ts).
import test from "node:test";
import assert from "node:assert/strict";
import { InputError } from "../../lib/http";
import { DRG_SHEET_ROWS } from "./fixtures";
import { INFO, billAnswer, findConditions, parseDrgRows } from "./source";
import manifest from "./index";

const cells = DRG_SHEET_ROWS.map((l) => l.split("|").map((c) => (/^-?\d+(\.\d+)?$/.test(c) ? Number(c) : c)));
const rows = parseDrgRows([["Information on total bill amount"], [], ...cells]);

test("the parser keeps DRG rows, maps wards and turns n/a into null", () => {
  assert.ok(rows.length >= 40);
  const b66 = rows.find((r) => r.drg === "B66A" && r.ward === "private")!;
  assert.equal(b66.p50, 22711.83984375);
  const b61 = rows.find((r) => r.drg === "B61A" && r.ward === "b1")!;
  assert.equal(b61.setting, "Public Hospitals/ Centres (Unsubsidised)");
  assert.throws(() => parseDrgRows([["x"]]), /layout has changed/);
});

test("finding conditions by code and by words", () => {
  assert.deepEqual(findConditions(rows, "b70a").map((m) => m.drg), ["B70A"]);
  assert.ok(findConditions(rows, "B70").length >= 2);
  assert.ok(findConditions(rows, "stroke").some((m) => m.drg === "B70A"));
  assert.deepEqual(findConditions(rows, "spaceship"), []);
  assert.throws(() => findConditions(rows, " "), InputError);
});

test("answer: Ward C median and the middle half, as published", () => {
  const a = billAnswer(rows, { service: "B70A" });
  assert.equal(a.status, "ok");
  assert.equal(a.price!.currency, "SGD");
  assert.equal(a.price!.median, 4428.39);
  assert.equal(a.price!.typical_low, 2800.16);
  assert.equal(a.price!.typical_high, 7445.03);
  assert.equal(a.sample_size, null);
  assert.equal(a.price_type, "official_statistic");
  assert.match(a.summary, /4,428 SGD/);
  assert.match(String(a.source.licence), /Singapore Open Data Licence/);
});

test("answer: ward choice, fallback and honest empty answers", () => {
  const priv = billAnswer(rows, { service: "B66A", ward: "private" });
  assert.equal(priv.price!.median, 22711.84);
  const fallback = billAnswer(rows, { service: "B61B" }); // Ward C exists; B66A has Ward B2 first
  assert.equal(fallback.status, "ok");
  const none = billAnswer(rows, { service: "B64B", ward: "a" });
  assert.equal(none.status, "no_matches");
  assert.equal(billAnswer(rows, { service: "spaceship" }).status, "no_matches");
});

test("answer: wrong inputs are 400s, never a wrong figure", () => {
  assert.throws(() => billAnswer(rows, { service: "stroke", ward: "z" }), InputError);
  assert.throws(() => billAnswer(rows, { service: "stroke", setting: "office" }), InputError);
});

test("manifest: Singapore medical, first example is a smoke test", () => {
  assert.equal(INFO.id, "sg-moh-bills");
  assert.equal(manifest.category, "medical");
  assert.deepEqual(manifest.countries, ["SG"]);
  assert.ok(manifest.examples[0].smoke !== false);
});

test("the parser also works when the table starts in a later column", () => {
  const shifted = [[null, ...["Info"]], ...cells.map((r) => [null, ...r])];
  assert.equal(parseDrgRows(shifted as any).length, rows.length);
});

test("a ward that the closest condition lacks moves to the closest condition that has it", () => {
  const a = billAnswer(rows, { service: "delirium", ward: "private" });
  assert.equal(a.status, "ok");
  assert.equal((a.query as any).drg, "B64B");
});
