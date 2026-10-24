// Fixture copied from the live file (header and first row) on 2026-10-21, plus vehicle rows in the same format
// (values from the publisher's tabular API for the same file; dates are dd/mm/yyyy in the CSV).
import { test } from "node:test";
import assert from "node:assert/strict";
import { fold, parseRows, parseLots, matchLots, auctionPrices, auctionHarvest, auctionHarvestRows, auctionHistoryKey, INFO } from "./source";

const HEAD = "﻿ID du Lot;Description du lot;Catégorie;Marque;Modèle;Date de première mise en circulation;Numéro Hermès de la Vente;Date de vente;CAV organisateur;Nom de la vente;Prix adjudication";
const REAL = [
  HEAD,
  "205744;Environ 5ha sur une fraction de la parcelle cadastrée BC-0030 et sise sur le ban communal de BOUROGNE (90).;Herbage;;;;2024010321V2321;03/01/2024;DIJON ;Vente n°2024010321V2321 du CAV DIJON ;2500.00",
  '205782;"Droit de pacage d’une superficie ; B-0357&amp; B1115";Herbage;;;;2024010321V2320;03/01/2024;DIJON ;Vente n°2024010321V2320 du CAV DIJON ;500.00',
  "206256;;Véhicules de tourisme;RENAULT;CLIO IV;2013-02-27;2024010486V2311;09/01/2024;POITIERS;Vente n°2024010486V2311 du CAV POITIERS;6200",
  "206265;;Véhicules de tourisme;RENAULT.;MÉGANE 4 NOUVELLE;2016-06-12;2024010486V2311;09/01/2024;POITIERS;Vente n°2024010486V2311 du CAV POITIERS;7100",
  "206286;;Véhicules de tourisme;CITROEN;C3;2015-04-09;2024010486V2311;09/01/2024;POITIERS;Vente n°2024010486V2311 du CAV POITIERS;3650",
  "206304;;Véhicules de tourisme;CITROEN;C3;2014-04-04;2024010486V2311;09/01/2024;POITIERS;Vente n°2024010486V2311 du CAV POITIERS;2350",
  "206305;;Véhicules de tourisme;CITROEN;C3;2015-04-09;2024010486V2311;09/01/2024;POITIERS;Vente n°2024010486V2311 du CAV POITIERS;3650",
  "207076;;Véhicules de tourisme;*RENAULT;CLIO 3;2011-02-18;2024010486V2311;09/01/2024;LYON;Vente n°2024010486V2311 du CAV LYON;0.00",
  "207077;;Utilitaires;RENAULT;KANGOO;2013-05-22;2024010486V2311;15/03/2024;LYON;Vente n°2024010486V2311 du CAV LYON;4500",
].join("\r\n");

test("reads the semicolon file with BOM and CRLF, drops land leases and zero prices", () => {
  const lots = parseLots(REAL);
  assert.equal(lots.length, 6);
  assert.equal(lots[0].price, 6200);
  assert.equal(lots[0].soldAt, "2024-01-09"); // dd/mm/yyyy, not mm/dd
  assert.equal(lots[5].soldAt, "2024-03-15");
  assert.equal(parseRows(REAL)[2][1], "Droit de pacage d’une superficie ; B-0357&amp; B1115");
});
test("rejects a file with a different header", () => {
  assert.throws(() => parseLots("a;b\n1;2"));
});
test("folds accents, dots and stars in brands", () => {
  assert.equal(fold("*RENAULT."), "renault");
  assert.equal(fold("MÉGANE 4 NOUVELLE"), "megane 4 nouvelle");
});
test("matches group names, brand and model words and the auction city", () => {
  const lots = parseLots(REAL);
  assert.equal(matchLots(lots, "cars").length, 5 - 0);
  assert.equal(matchLots(lots, "vehicles").length, 6);
  assert.equal(matchLots(lots, "renault").length, 3);
  assert.equal(matchLots(lots, "citroen c3").length, 3);
  assert.equal(matchLots(lots, "vehicules de tourisme").length, 5);
  assert.equal(matchLots(lots, "vehicles", "lyon").length, 1);
});
test("gives a range for five matching lots and labels it a hammer price", async () => {
  const a = await auctionPrices({ what: "cars", months: 12 }, parseLots(REAL));
  assert.equal(a.status, "ok");
  assert.equal(a.sample_size, 5);
  assert.equal(a.price?.median, 3650);
  assert.equal(a.price?.currency, "EUR");
  assert.equal(a.price?.unit, "per lot");
  assert.equal(a.source.licence, "Licence Ouverte 2.0 (Etalab)");
  assert.match(a.summary, /hammer price/);
  assert.match(a.summary, /not a retail price/);
  assert.match(a.evidence!.meaning, /not a confirmed receipt/);
});
test("refuses a figure under 5 lots", async () => {
  const a = await auctionPrices({ what: "renault", months: 12 }, parseLots(REAL));
  assert.equal(a.status, "insufficient_data");
  assert.equal(a.price, null);
});
test("attribution names the publisher, the licence and the change", () => {
  assert.match(INFO.attribution, /Direction Nationale d'Interventions Domaniales/);
  assert.match(INFO.attribution, /Licence Ouverte 2\.0/);
  assert.match(INFO.attribution, /changed/);
});

// ---------- daily copy ----------
const lotRow = (id: number, cat: string, city: string, date: string, price: number) =>
  `${id};;${cat};RENAULT;CLIO;2013-02-27;V${id};${date};${city};Vente du CAV ${city};${price}`;
const MANY = [
  HEAD,
  ...[3000, 3200, 3400, 3600, 3800, 4000].map((p, i) => lotRow(1000 + i, "Véhicules de tourisme", "LYON", "09/01/2024", p)),
  ...[1000, 1100, 1200, 1300, 1400].map((p, i) => lotRow(2000 + i, "Véhicules de tourisme", "LYON SUD", "10/02/2024", p)),
  ...[5000, 5100, 5200].map((p, i) => lotRow(3000 + i, "Véhicules de tourisme", "DIJON", "11/03/2024", p)),
  ...[800, 900, 1000, 1100, 1200].map((p, i) => lotRow(4000 + i, "Utilitaires", "DIJON", "12/03/2024", p)),
  lotRow(5000, "Véhicules de tourisme", "DIJON", "01/01/2023", 99999), // older than 12 months before the newest sale
].join("\r\n");

test("harvest rows: per lot group, France-wide and per city, only 5 lots or more", () => {
  const { date, rows } = auctionHarvestRows(parseLots(MANY));
  assert.equal(date, "2024-03-12");
  const get = (area: string, item: string) => rows.find((r) => r.area === area && r.item === item);
  assert.equal(get("ALL", "cars")!.n, 14); // 6 + 5 + 3, the 2023 lot is outside the 12 months
  assert.equal(get("lyon", "cars")!.n, 11); // "lyon" also matches "lyon sud", as matchLots does
  assert.equal(get("lyon sud", "cars")!.n, 5);
  assert.equal(get("dijon", "cars"), undefined); // only 3 cars at Dijon
  assert.equal(get("dijon", "vans")!.median, 1000);
  assert.ok(rows.every((r) => r.n >= 5));
});

test("a stored figure equals the live answer for the same question", async () => {
  const lots = parseLots(MANY);
  const live = await auctionPrices({ what: "cars", city: "lyon", months: 12 }, lots);
  const row = auctionHarvestRows(lots).rows.find((r) => r.area === "lyon" && r.item === "cars")!;
  assert.equal(row.median, live.price!.median);
  assert.equal(row.n, live.sample_size);
});

test("history key: group names and stored cities only", () => {
  const cities = ["ALL", "lyon", "dijon"];
  assert.deepEqual(auctionHistoryKey({ what: "cars" }, cities), { area: "ALL", item: "cars", label: "France (state auctions)" });
  assert.equal(auctionHistoryKey({ what: "Cars", state: "Lyon" }, cities)!.area, "lyon");
  assert.equal(auctionHistoryKey({ what: "renault clio", state: "Lyon" }, cities), null); // free words have no stored key
  assert.equal(auctionHistoryKey({ what: "cars", state: "Toulouse" }, cities), null);
  assert.equal(auctionHistoryKey({ what: "cars", months: 6 }, cities), null);
  assert.equal(auctionHistoryKey({ what: "cars", months: 12 }, cities)!.item, "cars");
  assert.equal(auctionHistoryKey({}, cities), null);
});

test("harvest reads the file once and reports EUR per lot", async () => {
  const h = await auctionHarvest(parseLots(MANY));
  assert.equal(h.currency, "EUR");
  assert.equal(h.unit, "per lot");
  assert.equal(h.date, "2024-03-12");
  await assert.rejects(() => auctionHarvest(parseLots(HEAD)), /no sold lots/);
});
