import { test } from "node:test";
import assert from "node:assert/strict";
import { InputError, SourceError } from "../../lib/http";
import { SOURCE_PLUGINS, findSource } from "../../lib/registry";
import { parseCsv } from "../lv-vzd-home-sales/source";
import { BANDS, bandFor, clearCache, INFO, loadBand, lvHouseAnswer, lvHouseSales } from "./source";

// Fixture: header and rows copied from the live VZD files publish_statistika_ind_dz_{60,110,180}_gads.csv (houses by floor area,
// yearly), downloaded from data.gov.lv on 2026-11-04 (UTF-8 with BOM, comma separated, quoted text, empty cell = not published).
// Trimmed to Plaviņas, Adazi, Carnikavas, Jurmala and Riga.
const H60 = "Novads,Teritorija,Majas_platiba_no_60m_lidz_110m_Izmantotais_dar_sk_2024,Majas_platiba_no_60m_lidz_110m_Izmantotais_dar_sk_2025,Majas_platiba_no_60m_lidz_110m_Minimala_vert_2024,Majas_platiba_no_60m_lidz_110m_Minimala_vert_2025,Majas_platiba_no_60m_lidz_110m_Maksimala_vert_2024,Majas_platiba_no_60m_lidz_110m_Maksimala_vert_2025,Majas_platiba_no_60m_lidz_110m_Videja_vert_2024,Majas_platiba_no_60m_lidz_110m_Videja_vert_2025,Majas_platiba_no_60m_lidz_110m_Nogriezta_vid_vert_5_2024,Majas_platiba_no_60m_lidz_110m_Nogriezta_vid_vert_5_2025,Majas_platiba_no_60m_lidz_110m_Nogriezta_vid_vert_10_2024,Majas_platiba_no_60m_lidz_110m_Nogriezta_vid_vert_10_2025,Majas_platiba_no_60m_lidz_110m_Moda_2024,Majas_platiba_no_60m_lidz_110m_Moda_2025,Majas_platiba_no_60m_lidz_110m_Mediana_2024,Majas_platiba_no_60m_lidz_110m_Mediana_2025,Majas_platiba_no_60m_lidz_110m_Cenu_limenis_2024,Majas_platiba_no_60m_lidz_110m_Cenu_limenis_2025";
const R60 = [
  "\"Aizkraukles novads\",Pļaviņas,,3,,9200.00,,81000.00,,42700.00,,42700.00,,42700.00,,33133.33,,37900.00,,42700.00",
  "\"Ādažu novads\",\"Carnikavas pagasts\",51,27,3600.00,12000.00,147000.00,145000.00,61101.91,59865.81,59233.27,58375.08,58177.98,56001.43,49692.86,31703.70,52000.00,54000.00,58177.98,56001.43",
  "Jūrmala,Jūrmala,29,17,15000.00,10000.00,380000.00,600000.00,110419.31,155735.29,103968.89,135833.33,96878.26,138230.77,61519.61,128000.00,86000.00,155000.00,96878.26,138230.77",
  "Rīga,Rīga,56,29,500.00,11000.00,260000.00,260000.00,100846.43,101936.10,97638.00,99449.89,95361.36,99354.22,126542.86,52500.00,105000.00,100000.00,97638.00,99449.89"
];
const H110 = "Novads,Teritorija,Majas_platiba_no_110m_lidz_180m_Izmantotais_dar_sk_2024,Majas_platiba_no_110m_lidz_180m_Izmantotais_dar_sk_2025,Majas_platiba_no_110m_lidz_180m_Minimala_vert_2024,Majas_platiba_no_110m_lidz_180m_Minimala_vert_2025,Majas_platiba_no_110m_lidz_180m_Maksimala_vert_2024,Majas_platiba_no_110m_lidz_180m_Maksimala_vert_2025,Majas_platiba_no_110m_lidz_180m_Videja_vert_2024,Majas_platiba_no_110m_lidz_180m_Videja_vert_2025,Majas_platiba_no_110m_lidz_180m_Nogriezta_vid_vert_5_2024,Majas_platiba_no_110m_lidz_180m_Nogriezta_vid_vert_5_2025,Majas_platiba_no_110m_lidz_180m_Nogriezta_vid_vert_10_2024,Majas_platiba_no_110m_lidz_180m_Nogriezta_vid_vert_10_2025,Majas_platiba_no_110m_lidz_180m_Moda_2024,Majas_platiba_no_110m_lidz_180m_Moda_2025,Majas_platiba_no_110m_lidz_180m_Mediana_2024,Majas_platiba_no_110m_lidz_180m_Mediana_2025,Majas_platiba_no_110m_lidz_180m_Cenu_limenis_2024,Majas_platiba_no_110m_lidz_180m_Cenu_limenis_2025";
const R110 = [
  "\"Aizkraukles novads\",Pļaviņas,,3,,5350.00,,16000.00,,12116.67,,12116.67,,12116.67,,14225.00,,15000.00,,12116.67",
  "\"Ādažu novads\",Ādaži,,4,,145000.00,,288000.00,,211625.00,,211625.00,,211625.00,,176777.78,,206750.00,,211625.00",
  "\"Ādažu novads\",\"Carnikavas pagasts\",27,16,25800.00,50000.00,302000.00,248000.00,120922.22,117968.75,117484.00,113535.71,113635.71,108833.33,108660.00,79700.00,108000.00,111500.00,113635.71,111500.00",
  "\"Ādažu novads\",\"novada pilsētu teritorijas kopā\",,4,,145000.00,,288000.00,,211625.00,,211625.00,,211625.00,,176777.78,,206750.00,,211625.00",
  "Jūrmala,Jūrmala,28,22,300.00,17000.00,480000.00,550000.00,160814.29,170415.09,154711.54,159106.60,155113.64,152274.00,112230.00,88066.67,150000.00,128000.00,154711.54,152274.00",
  "Rīga,Rīga,52,48,500.00,14700.00,540000.00,345000.00,155082.69,141145.82,147419.57,138643.17,143935.71,138727.55,135375.00,177705.19,137500.00,154000.00,143935.71,138727.55"
];
const H180 = "Novads,Teritorija,Majas_platiba_no_180m_lidz_250m_Izmantotais_dar_sk_2024,Majas_platiba_no_180m_lidz_250m_Izmantotais_dar_sk_2025,Majas_platiba_no_180m_lidz_250m_Minimala_vert_2024,Majas_platiba_no_180m_lidz_250m_Minimala_vert_2025,Majas_platiba_no_180m_lidz_250m_Maksimala_vert_2024,Majas_platiba_no_180m_lidz_250m_Maksimala_vert_2025,Majas_platiba_no_180m_lidz_250m_Videja_vert_2024,Majas_platiba_no_180m_lidz_250m_Videja_vert_2025,Majas_platiba_no_180m_lidz_250m_Nogriezta_vid_vert_5_2024,Majas_platiba_no_180m_lidz_250m_Nogriezta_vid_vert_5_2025,Majas_platiba_no_180m_lidz_250m_Nogriezta_vid_vert_10_2024,Majas_platiba_no_180m_lidz_250m_Nogriezta_vid_vert_10_2025,Majas_platiba_no_180m_lidz_250m_Moda_2024,Majas_platiba_no_180m_lidz_250m_Moda_2025,Majas_platiba_no_180m_lidz_250m_Mediana_2024,Majas_platiba_no_180m_lidz_250m_Mediana_2025,Majas_platiba_no_180m_lidz_250m_Cenu_limenis_2024,Majas_platiba_no_180m_lidz_250m_Cenu_limenis_2025";
const R180 = [
  "\"Ādažu novads\",Ādaži,4,4,140000.00,70000.00,232000.00,295000.00,173750.00,192250.00,173750.00,192250.00,173750.00,192250.00,158400.00,245000.00,161500.00,202000.00,173750.00,192250.00",
  "\"Ādažu novads\",\"Carnikavas pagasts\",13,11,17000.00,49700.00,500000.00,300000.00,155423.08,168172.73,136681.82,166688.89,136681.82,166688.89,113600.00,112275.00,135000.00,155000.00,135000.00,168172.73",
  "\"Ādažu novads\",\"novada pilsētu teritorijas kopā\",4,4,140000.00,70000.00,232000.00,295000.00,173750.00,192250.00,173750.00,192250.00,173750.00,192250.00,158400.00,245000.00,161500.00,202000.00,173750.00,192250.00",
  "Jūrmala,Jūrmala,17,21,20950.00,35000.00,1400000.00,1450000.00,281742.49,276023.81,224578.16,226921.05,194436.33,219500.00,178555.71,184823.53,165000.00,240000.00,194436.33,226921.05",
  "Rīga,Rīga,45,35,1500.00,42000.00,485000.00,370000.00,186441.51,205705.71,185204.10,206474.19,189076.84,208877.78,267775.36,291037.04,195000.00,230000.00,186441.51,208877.78"
];
const csv = (h: string, rows: string[]) => "﻿" + h + "\r\n" + rows.join("\r\n") + "\r\n";
const t60 = () => parseCsv(csv(H60, R60), 60);
const t110 = () => parseCsv(csv(H110, R110), 110);
const t180 = () => parseCsv(csv(H180, R180), 180);
const all = () => [t60(), t110(), t180()];

test("six floor-area bands map to the right file", () => {
  assert.equal(BANDS.length, 6);
  assert.equal(bandFor(140).key, 110);
  assert.equal(bandFor(110).key, 110);
  assert.equal(bandFor(39).key, 0);
  assert.equal(bandFor(900).key, 250);
});

test("parses the live house file shape: n, min, max, median per year", () => {
  const riga = t110().rows.find((r) => r.place === "Rīga")!;
  assert.equal(riga.byYear[2025].n, 48);
  assert.equal(riga.byYear[2025].median, 154000);
  assert.equal(riga.byYear[2024].median, 137500);
  assert.equal(riga.byYear[2025].min, 14700);
  assert.deepEqual(t110().years, [2024, 2025]);
});

test("Riga with no floor area: the band with most deals (110-180 m2), median 154,000 EUR from 48 deals in 2025", () => {
  const a = lvHouseAnswer(all(), { town: "Riga", property_type: "house", floor_area: null });
  assert.equal(a.status, "ok");
  assert.equal(a.price?.value, 154000);
  assert.equal(a.price?.currency, "EUR");
  assert.equal(a.price?.unit, "per house");
  assert.equal(a.sample_size, 48);
  assert.equal(a.source.licence.includes("CC BY 4.0"), true);
  const ex = a.extra as any;
  assert.equal(ex.floor_area_band, "110 to 180 m2");
  assert.equal(ex.previous_year.median, 137500);
  assert.equal(ex.by_floor_area.length, 3);
  assert.equal(ex.all_bands.deals, 29 + 48 + 35);
  assert.match(a.summary, /Riga/);
});

test("floor area picks its band; Jurmala 110-180 m2 is 128,000 EUR from 22 deals", () => {
  const a = lvHouseAnswer([t110()], { town: "Jurmala", property_type: "house", floor_area: 150 });
  assert.equal(a.price?.value, 128000);
  assert.equal(a.sample_size, 22);
});

test("a place with fewer than 5 deals in every band gets no figure (Adazi town: 4 and 4 deals)", () => {
  const a = lvHouseAnswer(all(), { town: "Adazi", property_type: "house", floor_area: null });
  assert.equal(a.status, "no_matches");
  assert.equal(a.price, null);
  assert.match(a.summary, /fewer than 5/);
});

test("a wanted band with too few deals lists the other bands instead of guessing", () => {
  const a = lvHouseAnswer(all(), { town: "Carnikavas pagasts", property_type: "house", floor_area: 30 });
  assert.equal(a.price, null);
  assert.equal(a.status, "no_matches");
});

test("Carnikavas parish answers from the 110-180 m2 band (16 deals in 2025)", () => {
  const a = lvHouseAnswer([t60(), t110(), t180()], { town: "Carnikavas pagasts", property_type: "house", floor_area: 120 });
  assert.equal(a.status, "ok");
  assert.equal(a.sample_size, 16);
});

test("unknown town says what VZD publishes; missing town is an input error", () => {
  const a = lvHouseAnswer(all(), { town: "Atlantis", property_type: "house", floor_area: null });
  assert.equal(a.status, "no_matches");
  assert.throws(() => lvHouseAnswer(all(), { town: null, property_type: "house", floor_area: null }), InputError);
  assert.throws(() => lvHouseAnswer(all(), { town: "Riga", property_type: "house", floor_area: -3 }), InputError);
});

test("apartments are refused here: property_type must be house", async () => {
  await assert.rejects(lvHouseSales({ town: "Riga", property_type: "flat" }), InputError);
});

test("a changed file is a source error, not a wrong answer", async () => {
  clearCache();
  await assert.rejects(loadBand(BANDS[3], { fetcher: async () => "<html>maintenance</html>", now: 1 }), SourceError);
});

test("fetch path: floor_area 150 reads one file, no area reads six (cached after)", async () => {
  clearCache();
  let calls = 0;
  const fetcher = async (b: { key: number }) => {
    calls++;
    return b.key === 110 ? csv(H110, R110) : csv(H60, R60);
  };
  const a = await lvHouseSales({ town: "Riga", property_type: "house", floor_area: 150 }, { fetcher: fetcher as any, now: 10 });
  assert.equal(a.price?.value, 154000);
  assert.equal(calls, 1);
  await lvHouseSales({ town: "Riga", property_type: "house", floor_area: 150 }, { fetcher: fetcher as any, now: 20 });
  assert.equal(calls, 1);
});

test("routing: house requests with a town go to this source, apartments stay with lv-vzd-home-sales", () => {
  const house = findSource("home-sales", "LV", { country: "LV", town: "Riga", property_type: "house" });
  assert.equal(house?.info.id, INFO.id);
  const flat = findSource("home-sales", "LV", { country: "LV", town: "Riga" });
  assert.equal(flat?.info.id, "lv-vzd-home-sales");
  const none = findSource("home-sales", "LV", { country: "LV" });
  assert.equal(none?.info.id, "eu-home-price-index");
  assert.ok(SOURCE_PLUGINS.some((s) => s.info.id === INFO.id));
});
