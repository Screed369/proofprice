import { test } from "node:test";
import assert from "node:assert/strict";
import { MUNICIPAL_ROWS, MUNICIPAL_SHEET, PROVINCE_ROWS } from "./fixtures";
import {
  esAppraisedHomes, esHarvest, esHistoryKey, findPlace, foldName, harvestRows, nameKeys, parseMunicipalSheet, parseProvinceSheet, qLabel,
} from "./source";
import index from "./index";

const province = () => parseProvinceSheet(PROVINCE_ROWS);
const municipal = () => parseMunicipalSheet(MUNICIPAL_SHEET, MUNICIPAL_ROWS);
const opts = { province: async () => province(), municipal: async () => municipal() };

test("province table: periods, latest quarter and levels", () => {
  const t = province();
  assert.equal(qLabel(t.periods[t.latest]), "2026-Q2");
  assert.equal(t.periods.length, 14);
  const nat = t.places.find((p) => p.level === "national")!;
  assert.equal(nat.values[t.latest], 2355);
  assert.equal(nat.values[t.latest - 4], 2093.5);
  assert.equal(t.places.find((p) => p.name === "Andalucía")!.level, "region");
  assert.equal(t.places.find((p) => p.name === "Málaga")!.level, "province");
  assert.equal(t.places.find((p) => p.name === "Málaga")!.region, "Andalucía");
  assert.equal(t.places.find((p) => p.name.startsWith("Madrid"))!.level, "region and province");
});

test("place names: accents, articles and bilingual names", () => {
  assert.ok(nameKeys("Coruña (A)").includes("a coruna"));
  assert.ok(nameKeys("Alicante/Alacant").includes("alicante"));
  assert.equal(foldName("Málaga"), "malaga");
  const t = province();
  assert.equal(findPlace(t, "Málaga")?.name, "Málaga");
  assert.equal(findPlace(t, "malaga")?.name, "Málaga");
  assert.equal(findPlace(t, "A Coruña")?.name, "Coruña (A)");
  assert.equal(findPlace(t, "Las Palmas")?.name, "Palmas (Las)");
  assert.equal(findPlace(t, "Alicante")?.name, "Alicante/Alacant");
  assert.equal(findPlace(t, "Valencia")?.name, "Valencia/València");
  assert.equal(findPlace(t, "Madrid")?.name, "Madrid (Comunidad de)");
  assert.equal(findPlace(t, "Baleares")?.name, "Balears (Illes)");
  assert.equal(findPlace(t, "Spain")?.level, "national");
  assert.equal(findPlace(t, "Marbella"), null);
});

test("Spain as a whole is an official statistic labelled as an appraisal", async () => {
  const a = await esAppraisedHomes({ ...opts });
  assert.equal(a.status, "ok");
  assert.equal(a.price?.value, 2355);
  assert.equal(a.price?.unit, "per m² (appraised value)");
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.sample_size, null);
  assert.equal(a.statistic?.reference_period, "2026-Q2");
  assert.deepEqual(a.period, { from: "2026-04-01", to: "2026-06-30" });
  assert.match(a.summary, /appraised value, not a price paid/);
  const x: any = a.extra;
  assert.equal(x.price_basis, "appraised");
  assert.equal(x.change_on_year_earlier_pct, 12.5); // the ministry's own annual change for the national row is 12.5
  assert.equal(x.change_on_previous_quarter_pct, 1.7); // and 1.7 on the quarter
  assert.equal(x.year_earlier.value, 2093.5);
});

test("Madrid answers with the region and province row, Málaga with its province and the Spain comparison", async () => {
  const m = await esAppraisedHomes({ ...opts, town: "Madrid" });
  assert.equal(m.price?.value, 4089.6);
  const g = await esAppraisedHomes({ ...opts, town: "Málaga" });
  assert.equal(g.price?.value, 3083.5);
  assert.equal((g.extra as any).versus_spain_pct, 30.9);
  assert.equal((g.extra as any).region, "Andalucía");
});

test("a municipality over 25,000: value, appraisal count, age split", async () => {
  const a = await esAppraisedHomes({ ...opts, town: "Marbella" });
  assert.equal(a.status, "ok");
  assert.equal(a.price?.value, 4528.3);
  assert.equal(a.sample_size, 748);
  assert.equal((a.extra as any).level, "municipality");
  assert.equal((a.extra as any).up_to_5_years_old.value, 5954.8);
});

test("level=municipality finds the city of Madrid, a province hint narrows a municipality", async () => {
  const city = await esAppraisedHomes({ ...opts, town: "Madrid", level: "municipality" });
  assert.equal(city.price?.value, 5418.4);
  assert.equal(city.sample_size, 11686);
  const alc = await esAppraisedHomes({ ...opts, town: "Alcalá de Henares, Madrid" });
  assert.equal(alc.price?.value, 2942.2);
});

test("fewer than 5 appraisals gives no figure", async () => {
  const rows = MUNICIPAL_ROWS.map((r) => (r[2] === "Getafe" ? [r[0], r[1], r[2], r[3], r[4], r[5], null, 2, 2, 4] : r));
  const t = parseMunicipalSheet(MUNICIPAL_SHEET, rows);
  const a = await esAppraisedHomes({ province: async () => province(), municipal: async () => t, town: "Getafe" });
  assert.equal(a.status, "no_matches");
  assert.equal(a.price, null);
});

test("unknown town, postcode and house type are clear 400s", async () => {
  await assert.rejects(esAppraisedHomes({ ...opts, town: "Nowhereville" }), /not a province, region or municipality/);
  await assert.rejects(esAppraisedHomes({ ...opts, postcode: "28001" }), /not by postcode/);
  await assert.rejects(esAppraisedHomes({ ...opts, property_type: "house" }), /property_type/);
});

test("harvest: one row per place for the newest quarter, no made-up counts, key matches", async () => {
  const h = harvestRows(province());
  assert.equal(h.date, "2026-06-30");
  assert.ok(h.rows.every((r) => Number.isNaN(r.n)));
  const spain = h.rows.find((r) => r.area === "ES")!;
  assert.equal(spain.median, 2355);
  const r2 = await esHarvest({ province: async () => province() });
  assert.equal(r2.rows.length, h.rows.length);
  for (const [town, label] of [["Málaga", "Málaga"], ["Madrid", "Madrid (Comunidad de)"], ["A Coruña", "Coruña (A)"], ["Alicante", "Alicante/Alacant"], ["Barcelona", "Barcelona"], ["Baleares", "Balears (Illes)"]]) {
    const key = esHistoryKey({ town })!;
    assert.ok(key, town);
    assert.equal(key.label, label);
    assert.ok(h.rows.some((r) => r.area === key.area), `${town} -> ${key.area}`);
  }
  assert.equal(esHistoryKey({})?.area, "ES");
  assert.equal(esHistoryKey({ town: "Marbella" }), null);
  assert.equal(esHistoryKey({ town: "Madrid", level: "municipality" }), null);
});

test("manifest", () => {
  assert.equal(index.info.id, "es-appraised-homes");
  assert.equal(index.category, "home-sales");
  assert.deepEqual(index.countries, ["ES"]);
});
