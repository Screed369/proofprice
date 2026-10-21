import { test } from "node:test";
import assert from "node:assert/strict";
import { CANTONS, INFO, parsePremiumLine, premiumAnswer, premiumRows, premiumsHarvest, resolveCanton, streamTariffs } from "./source";

// The first three lines are REAL rows copied from Prämien_CH.csv (BAG, checked 2026-10-21 by the Verifier probe), with the real header.
const HEADER = "﻿Versicherer,Kanton,Hoheitsgebiet,Geschäftsjahr,Erhebungsjahr,Region,Altersklasse,Unfalleinschluss,Tarif,Tariftyp,Altersuntergruppe,Franchisestufe,Franchise,Prämie,isBaseP,isBaseF,Tarifbezeichnung";
const REAL = [
  "8,AG,P_OKPCH,2027,2026,PR_REG_0,AKA_03_ERW,MIT_UNF,01_016,PRAXIS,E1,FRASTU_01,FRA_01_E_0300,549.5,0,1,Gesundheitspraxisversicherung",
  "8,AG,P_OKPCH,2027,2026,PR_REG_0,AKA_03_ERW,MIT_UNF,01_016,PRAXIS,E1,FRASTU_03,FRA_03_E_1000,508.7,0,0,Gesundheitspraxisversicherung",
  "8,AG,P_OKPCH,2027,2026,PR_REG_0,AKA_02_JUG,MIT_UNF,01_016,PRAXIS,J1,FRASTU_01,FRA_01_J_0300,412.1,0,1,Gesundheitspraxisversicherung",
];
// SYNTHETIC lines in the same format (insurer ids 1..6) so a cell reaches 5 tariffs.
const synth = (ins: number, canton: string, prem: number, type = "BASE", unf = "OHN_UNF") =>
  `${ins},${canton},P_OKPCH,2027,2026,PR_REG_0,AKA_03_ERW,${unf},01_001,${type},E1,FRASTU_01,FRA_01_E_0300,${prem},1,1,Grundversicherung`;

test("real rows parse", () => {
  const t = REAL.map(parsePremiumLine);
  assert.deepEqual(t[0], { canton: "AG", age: "adult", accident: "with", franchise: 300, model: "alternative", premium: 549.5, businessYear: 2027, collectionYear: 2026 });
  assert.equal(t[1]!.franchise, 1000);
  assert.equal(t[2]!.age, "young_adult");
});

test("lines that are not usable premiums are skipped", () => {
  assert.equal(parsePremiumLine("Versicherer,Kanton"), null);
  assert.equal(parsePremiumLine(synth(1, "XX", 400)), null); // not a canton
  assert.equal(parsePremiumLine(synth(1, "ZH", 0)), null);
  assert.equal(parsePremiumLine(synth(1, "ZH", 400).replace("P_OKPCH", "P_OKPEU")), null);
});

test("stream reads the BOM header, splits across chunks and aggregates", async () => {
  const lines = [HEADER, ...REAL, ...[1, 2, 3, 4, 5, 6].map((i) => synth(i, "ZH", 400 + i * 10))].join("\r\n") + "\r\n";
  const bytes = new TextEncoder().encode(lines);
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (let i = 0; i < bytes.length; i += 37) c.enqueue(bytes.slice(i, i + 37)); // odd chunk size: lines and UTF-8 characters are cut
      c.close();
    },
  });
  const tariffs = await streamTariffs(body);
  assert.equal(tariffs.length, 9);
  const rows = premiumRows(tariffs);
  const zh = rows.find((r) => r.area === "ZH" && r.item === "adult/without/300/standard")!;
  assert.equal(zh.n, 6);
  assert.equal(zh.median, 435);
  assert.ok(rows.find((r) => r.area === "ALL" && r.item === "adult/without/300/standard"));
  assert.equal(rows.find((r) => r.area === "AG" && r.item === "adult/with/300/alternative")!.n, 1); // thin cells are kept here; the library (writeDaily) drops n < 5
});

test("harvest uses the collection year as the library date and one fetch", async () => {
  const text = [HEADER, ...Array.from({ length: 1200 }, (_, i) => synth((i % 6) + 1, "BE", 380 + (i % 40)))].join("\n");
  let calls = 0;
  const fake = (async () => { calls++; return new Response(text, { status: 200 }); }) as unknown as typeof fetch;
  const h = await premiumsHarvest(fake);
  assert.equal(calls, 1);
  assert.equal(h.date, "2026-09-30");
  assert.equal(h.currency, "CHF");
  assert.ok(h.rows.some((r) => r.area === "BE"));
});

const LIB = {
  date: "2026-09-30",
  rows: [
    { area: "ZH", item: "adult/without/300/standard", n: 120, median: 480.2, low: 410.1, high: 560.9, min: 390, max: 640 },
    { area: "ZH", item: "adult/without/2500/standard", n: 118, median: 330.5, low: 270.3, high: 395, min: 250, max: 450 },
    { area: "ALL", item: "adult/without/300/standard", n: 3000, median: 470, low: 400, high: 560, min: 360, max: 700 },
    { area: "ZH", item: "child/with/0/standard", n: 90, median: 120, low: 105, high: 140, min: 90, max: 160 },
  ],
};

test("answer: default adult, canton ZH", () => {
  const a = premiumAnswer(LIB, { area: "zh" });
  assert.equal(a.status, "ok");
  assert.equal(a.price!.median, 480.2);
  assert.equal(a.price!.currency, "CHF");
  assert.equal(a.price!.unit, "per month");
  assert.equal(a.sample_size, 120);
  assert.deepEqual(a.period, { from: "2027-01-01", to: "2027-12-31" });
  assert.equal(a.price_type, "posted_price");
  assert.match(a.summary, /not amounts paid/);
  assert.match(a.summary, /120 approved insurer tariffs/);
  assert.equal((a.extra as any).available_franchises.join(), "300,2500");
});

test("answer: whole country, other deductible, child default", () => {
  assert.equal(premiumAnswer(LIB, {}).price!.median, 470);
  assert.equal(premiumAnswer(LIB, { area: "ZH", franchise: 2500 }).price!.median, 330.5);
  assert.equal(premiumAnswer(LIB, { area: "ZH", age_group: "child" }).price!.median, 120);
});

test("answer: unknown deductible says which exist; unknown canton is the caller's mistake", () => {
  const a = premiumAnswer(LIB, { area: "ZH", franchise: 1234 });
  assert.equal(a.status, "no_matches");
  assert.match(a.summary, /Deductibles available: 300, 2500/);
  assert.throws(() => resolveCanton("Zurich"), /not a Swiss canton code/);
  assert.equal(resolveCanton("CH"), "ALL");
  assert.equal(CANTONS.length, 26);
});

test("licence and label are stated", () => {
  assert.match(INFO.licence, /commercial use is permitted/);
  assert.equal(INFO.price_type, "posted_price");
});
