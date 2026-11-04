// Fixtures: fixtures/res88.json = the real StatBank JSONSTAT answer for table RES88 (all areas, five arrangements, all years), captured 2026-11-04;
// fixtures/res88.csv = the same table for four areas fetched as CSV through the POST endpoint the same day (the outside check below);
// fixtures/tableinfo.json = the table metadata (updated 2026-04-08).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { INFO, KINDS, dataUrl, dkChildcare, dkChildcareHarvest, dkChildcareHistoryKey, harvestRows, matchArea, norm, parseTable, pickKind, pickLatest, HARVEST_AREAS } from "./source";
import { NO_COUNT } from "../../lib/stats";

const FIX = JSON.parse(readFileSync(new URL("./fixtures/res88.json", import.meta.url), "utf8"));
const CSV = readFileSync(new URL("./fixtures/res88.csv", import.meta.url), "utf8");
const fetcher = async () => FIX;

test("parses the real cube", () => {
  const t = parseTable(FIX);
  assert.equal(t.codes["OMRÅDE"].length, 99);
  assert.equal(t.codes["INSTITUTION"].length, 5);
  assert.equal(t.codes["Tid"].length, 20);
  assert.equal(pickLatest(t, "000", "F03")?.year, "2026");
});

test("All Denmark nursery 2026 is 47,191 DKK per year, up from 45,548", async () => {
  const a = await dkChildcare({}, { fetcher });
  assert.equal(a.status, "ok");
  assert.equal(a.price?.value, 47191);
  assert.equal(a.price?.currency, "DKK");
  assert.equal(a.price_type, "official_statistic");
  assert.match(a.summary, /2026/);
  assert.equal((a.extra as any).previous_year.value, 45548);
  assert.equal((a.extra as any).previous_year.change_percent, 3.6);
  assert.equal(a.sample_size ?? null, null);
});

test("Copenhagen by Danish and English name, kindergarten and school-care", async () => {
  const n = await dkChildcare({ area: "København" }, { fetcher });
  assert.equal(n.price?.value, 50064);
  const k = await dkChildcare({ area: "Copenhagen", age_group: "preschool" }, { fetcher });
  assert.equal(k.price?.value, 27996);
  const s = await dkChildcare({ area: "copenhagen", age_group: "school-age" }, { fetcher });
  assert.equal(s.price?.value, 22462);
  const h = await dkChildcare({ area: "Copenhagen", care_type: "home-based" }, { fetcher });
  assert.equal(h.price?.value, 49140);
});

test("suppressed cell: Copenhagen childminder 3-5 is not published, says so and does not invent a figure", async () => {
  const a = await dkChildcare({ area: "Copenhagen", age_group: "preschool", care_type: "home-based" }, { fetcher });
  assert.equal(a.status, "no_matches");
  assert.equal(a.price, null);
  assert.match(a.summary + JSON.stringify(a.statistic), /suppressed|publishes no rate/);
});

test("area matching: spelling, aliases, errors", () => {
  const t = parseTable(FIX);
  assert.equal(matchArea(t, "Aarhus").code, "751");
  assert.equal(matchArea(t, "Århus").code, "751");
  assert.equal(matchArea(t, "Aalborg kommune").code, "851");
  assert.equal(matchArea(t, "Høje-Taastrup").code, "169");
  assert.equal(matchArea(t, "Odense").code, "461");
  assert.equal(matchArea(t, undefined).code, "000");
  assert.equal(matchArea(t, "Denmark").code, "000");
  assert.throws(() => matchArea(t, "Atlantis"), /Give a Danish municipality/);
});

test("age and care mapping", () => {
  assert.equal(pickKind().code, "F03");
  assert.equal(pickKind("toddler").code, "F03");
  assert.equal(pickKind("preschool").code, "F50");
  assert.equal(pickKind("school-age").code, "F55");
  assert.equal(pickKind("infant", "home-based").code, "F47");
  assert.equal(pickKind("preschool", "childminder").code, "F48");
  assert.throws(() => pickKind("school-age", "home-based"), /no childminder rate/);
});

test("request URL asks all areas, the five arrangements, every year", () => {
  const u = dataUrl();
  assert.match(u, /^https:\/\/api\.statbank\.dk\/v1\/data\/RES88\/JSONSTAT\?lang=en&OMR%C3%85DE=\*&INSTITUTION=F03,F47,F48,F50,F55&Tid=\*$/);
});

test("OUTSIDE CHECK: every cell we read from the JSONSTAT answer equals the same cell of the separately fetched CSV", () => {
  const t = parseTable(FIX);
  const lines = CSV.replace(/^﻿/, "").trim().split(/\r?\n/).slice(1);
  const nameToCode = new Map(t.codes["OMRÅDE"].map((c) => [t.labels["OMRÅDE"][c], c]));
  const kindByLabel = new Map(t.codes["INSTITUTION"].map((c) => [t.labels["INSTITUTION"][c], c]));
  let compared = 0, suppressed = 0;
  for (const l of lines) {
    const [area, kind, year, val] = l.split(";");
    const code = nameToCode.get(area)!, k = kindByLabel.get(kind)!;
    assert.ok(code && k, `unknown labels in CSV: ${area} / ${kind}`);
    const row = t.rows.find((r) => r["OMRÅDE"] === code && r["INSTITUTION"] === k && String(r["Tid"]) === year);
    if (val === "..") { assert.ok(!row || row.value === null, `${l}: CSV says suppressed`); suppressed++; continue; }
    assert.equal(row?.value, Number(val), l);
    compared++;
  }
  assert.ok(compared > 300, `compared ${compared}`);
  assert.ok(suppressed > 0);
});

test("harvest: newest year, national first, NO_COUNT, no suppressed cells", async () => {
  const h = harvestRows(parseTable(FIX));
  assert.equal(h.date, "2026-01-01");
  assert.equal(h.unit, "per year");
  assert.ok(h.rows.every((r) => Number.isNaN(r.n) && r.n === NO_COUNT || Number.isNaN(r.n)));
  assert.ok(h.rows.every((r) => r.median > 0));
  const nat = h.rows.find((r) => r.area === "000" && r.item === "nursery");
  assert.equal(nat?.median, 47191);
  assert.ok(!h.rows.some((r) => r.area === "101" && r.item === "home-3-5"));
  assert.ok(h.rows.length > 80 && h.rows.length <= HARVEST_AREAS.length * KINDS.length);
  const viaFetch = await dkChildcareHarvest({ fetcher });
  assert.equal(viaFetch.rows.length, h.rows.length);
});

test("history key", () => {
  assert.deepEqual(dkChildcareHistoryKey({}), { area: "000", item: "nursery", label: "Denmark" });
  assert.equal(dkChildcareHistoryKey({ area: "København", age_group: "preschool" })?.area, "101");
  assert.equal(dkChildcareHistoryKey({ area: "Samsø" }), null);
  assert.equal(dkChildcareHistoryKey({ age_group: "school-age", care_type: "home-based" }), null);
});

test("licence info and name folding", () => {
  assert.match(INFO.licence, /commercial/);
  assert.match(INFO.attribution, /Statistics Denmark/);
  assert.equal(norm("Århus"), "aarhus");
});
