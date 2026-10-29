// Tests for the Île-de-France fare list. fixtures/titres-et-tarifs.json is the REAL answer of
// https://data.iledefrance-mobilites.fr/api/explore/v2.1/catalog/datasets/titres-et-tarifs/records?limit=100 read on 2026-10-29 (30 products).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { InputError, SourceError } from "../../lib/http";
import { parseOdsRecords } from "../../lib/adapters";
import { INFO, answerFromProducts, idfmFares, parsePriceText, parseProducts } from "./source";

const RECORDS = parseOdsRecords(JSON.parse(readFileSync(new URL("./fixtures/titres-et-tarifs.json", import.meta.url), "utf8"))).results;

test("licence and type", () => {
  assert.match(INFO.licence, /Licence Ouverte/);
  assert.equal(INFO.price_type, "posted_price");
});

test("price texts", () => {
  assert.deepEqual(parsePriceText("2,55€"), { kind: "amount", value: 2.55 });
  assert.deepEqual(parsePriceText("86,40 €"), { kind: "amount", value: 86.4 });
  assert.deepEqual(parsePriceText("14€"), { kind: "amount", value: 14 });
  assert.deepEqual(parsePriceText("dès 30,60€"), { kind: "from", value: 30.6 });
  assert.deepEqual(parsePriceText("-50%"), { kind: "percent", value: 50 });
  assert.deepEqual(parsePriceText("Gratuité"), { kind: "free", value: 0 });
  assert.deepEqual(parsePriceText("Gratuit"), { kind: "free", value: 0 });
  assert.deepEqual(parsePriceText("Prix variable"), { kind: "variable", value: null });
});

test("parses the real list, drops the test row, flags tickets no longer sold", () => {
  const products = parseProducts(RECORDS);
  assert.equal(products.length, 29);
  assert.ok(!products.some((p) => /^test/i.test(p.name)));
  const tplus = products.find((p) => p.name === "Ticket t+")!;
  assert.equal(tplus.discontinued, true);
  assert.equal(products.find((p) => p.name === "Billet Origine-Destination")!.discontinued, true);
  assert.equal(products.find((p) => p.name === "Ticket Métro-Train-RER")!.discontinued, false);
  assert.throws(() => parseProducts(RECORDS.slice(0, 3)), SourceError);
});

test("adult: single Métro-Train-RER ticket 2.55 EUR (real list), not the discontinued t+ at 2.50", () => {
  const a = answerFromProducts(parseProducts(RECORDS), {}, "2026-10-29");
  assert.equal(a.status, "ok");
  assert.equal(a.price!.currency, "EUR");
  assert.equal(a.price!.value, 2.55);
  assert.equal(a.sample_size, null);
  assert.equal(a.price_type, "posted_price");
  const products = (a.extra as any).products as Array<{ product: string; price_eur: number }>;
  assert.ok(products.some((p) => p.product === "Forfait Navigo Mois" && p.price_eur === 90.8));
  assert.ok(!products.some((p) => p.product === "Ticket t+"));
  assert.ok(!products.some((p) => /^Test/.test(p.product)));
});

test("student: annual Imagine R student pass 401.30 EUR", () => {
  const a = answerFromProducts(parseProducts(RECORDS), { fare_type: "student" }, "2026-10-29");
  assert.equal(a.price!.value, 401.3);
  assert.match(a.price!.unit, /per year/);
});

test("distance does not change the fare and is said so", () => {
  const near = answerFromProducts(parseProducts(RECORDS), { distance_km: 2 }, "2026-10-29");
  const far = answerFromProducts(parseProducts(RECORDS), { distance_km: 40 }, "2026-10-29");
  assert.equal(near.price!.value, far.price!.value);
  assert.match(JSON.stringify(near), /does not change it/);
});

test("input handling", async () => {
  const products = parseProducts(RECORDS);
  assert.throws(() => answerFromProducts(products, { fare_type: "senior" }), InputError);
  assert.throws(() => answerFromProducts(products, { fare_type: "vip" }), InputError);
  assert.throws(() => answerFromProducts(products, { travel_time: "early" }), InputError);
  assert.throws(() => answerFromProducts(products, { distance_km: -1 }), InputError);
  const a = await idfmFares({}, async () => RECORDS);
  assert.equal(a.price!.value, 2.55);
});
