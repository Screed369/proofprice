import { test } from "node:test";
import assert from "node:assert/strict";
import { InputError, SourceError } from "../../lib/http";
import { SOURCE_PLUGINS } from "../../lib/registry";
import { clearCache, findPlace, INFO, loadTable, lvAnswer, lvHomeSales, parseCsv, splitLine } from "./source";

// Fixture: rows copied from the live VZD file publish_statistika_dzivokli_2_gads.csv (2-room apartments, yearly), read from
// GitHub Actions on 2026-10-24 (UTF-8 with BOM, comma separated, quoted text, empty cell = not published). Trimmed to the rows used.
const HEAD = "Novads,Teritorija,2_istabu_dzivokli_Izmantotais_dar_sk_2024,2_istabu_dzivokli_Izmantotais_dar_sk_2025,2_istabu_dzivokli_Minimala_vert_2024,2_istabu_dzivokli_Minimala_vert_2025,2_istabu_dzivokli_Maksimala_vert_2024,2_istabu_dzivokli_Maksimala_vert_2025,2_istabu_dzivokli_Videja_vert_2024,2_istabu_dzivokli_Videja_vert_2025,2_istabu_dzivokli_Nogriezta_vid_vert_5_2024,2_istabu_dzivokli_Nogriezta_vid_vert_5_2025,2_istabu_dzivokli_Nogriezta_vid_vert_10_2024,2_istabu_dzivokli_Nogriezta_vid_vert_10_2025,2_istabu_dzivokli_Moda_2024,2_istabu_dzivokli_Moda_2025,2_istabu_dzivokli_Mediana_2024,2_istabu_dzivokli_Mediana_2025,2_istabu_dzivokli_Cenu_Limenis_2024,2_istabu_dzivokli_Cenu_Limenis_2025";
const ROWS = [
  '"Aizkraukles novads","Aiviekstes pagasts",5,,1500.00,,2200.00,,1861.20,,1861.20,,1868.67,,2083.33,,2000.00,,1861.20,',
  '"Aizkraukles novads",Aizkraukle,55,67,4000.00,2700.00,35000.00,36000.00,14640.76,16664.97,14178.41,16423.82,14052.14,16213.38,10642.86,19167.03,13693.00,17300.00,14052.14,16423.82',
  '"Aizkraukles novads","Bebru pagasts",5,4,1507.00,1000.00,35000.00,7000.00,13401.40,4050.00,13401.40,4050.00,10166.67,4050.00,8205.60,5666.67,7500.00,4100.00,8205.60,4050.00',
  '"Aizkraukles novads","Daudzeses pagasts",3,4,2935.00,3593.00,12000.00,4318.00,6311.67,4086.75,6311.67,4086.75,6311.67,4086.75,4949.44,3955.50,4000.00,4218.00,6311.67,4086.75',
  '"Aizkraukles novads","novada pilsētu teritorijas kopā",96,105,1400.00,1500.00,35000.00,36000.00,12916.42,13740.96,12530.53,13292.64,12277.51,13055.43,11550.00,4734.38,11667.50,12500.00,12277.51,13055.43',
  '"Valmieras novads",Valmiera,103,98,5000.00,7300.00,107743.00,94000.00,45268.41,46968.71,44578.55,47015.97,44497.37,47223.59,47257.20,49024.38,45000.00,48500.00,44578.55,47223.59',
  '"Valmieras novads","novada pilsētu teritorijas kopā",146,161,700.00,950.00,107743.00,94000.00,34209.03,30570.05,32892.04,29803.45,32591.20,29498.68,8992.06,7529.29,37550.00,32000.00,32892.04,29803.45',
  'Rīga,"Rīga kopā",4375,4985,10.00,200.00,1150000.00,475000.00,60030.91,64565.34,56868.31,61842.58,55075.15,60061.44,50988.91,50286.53,48000.00,51700.00,55075.15,60061.44',
  'Jūrmala,Jūrmala,204,246,500.00,1000.00,270000.00,560000.00,55788.47,60197.00,50829.35,53369.16,48263.27,49469.16,40678.62,35548.13,42500.00,45000.00,48263.27,49469.16',
];

const csv = (rows: string[]) => "\uFEFF" + HEAD + "\r\n" + rows.join("\r\n") + "\r\n";
const two = parseCsv(csv(ROWS), 2);
// Synthetic 3-room table (same shape, made-up numbers, only for the room-count logic): Riga 3-room has more deals than 2-room.
const threeHead = HEAD.replace(/2_istabu/g, "3_istabu");
const three = parseCsv("\uFEFF" + threeHead + "\r\n" + '\'Rīga,"Rīga kopā",5000,5200,100.00,100.00,500000.00,500000.00,80000.00,90000.00,75000.00,85000.00,70000.00,80000.00,60000.00,70000.00,72000.00,81000.00,70000.00,80000.00\''.slice(1, -1), 3);

test("splitLine handles quoted fields and empty cells", () => {
  assert.deepEqual(splitLine('"Aizkraukles novads",Aizkraukle,55,,1'), ["Aizkraukles novads", "Aizkraukle", "55", "", "1"]);
});

test("parses n, min, max, mean and median per year; empty cells give no year", () => {
  const aiz = two.rows.find((r) => r.place === "Aizkraukle")!;
  assert.equal(aiz.byYear[2025].n, 67);
  assert.equal(aiz.byYear[2025].median, 17300);
  assert.equal(aiz.byYear[2024].median, 13693);
  assert.equal(aiz.byYear[2025].min, 2700);
  const parish = two.rows.find((r) => r.place === "Aiviekstes pagasts")!;
  assert.equal(parish.byYear[2025], undefined);
  assert.equal(parish.byYear[2024].n, 5);
  assert.deepEqual(two.years, [2024, 2025]);
});

test("a changed file is a source error, not a wrong answer", () => {
  assert.throws(() => parseCsv("<html>maintenance</html>", 2), SourceError);
  assert.throws(() => parseCsv("", 2), SourceError);
});

test("Riga with a room count: median 51,700 EUR from 4,985 deals in 2025, official statistic", () => {
  const a = lvAnswer([two], { town: "Riga", property_type: null, rooms: 2 });
  assert.equal(a.status, "ok");
  assert.equal(a.price?.value, 51700);
  assert.equal(a.price?.currency, "EUR");
  assert.equal(a.price?.unit, "per apartment");
  assert.equal(a.sample_size, 4985);
  assert.match(a.summary, /Riga/);
  assert.match(a.summary, /2025/);
  const ex = a.extra as any;
  assert.equal(ex.previous_year.median, 48000);
  assert.equal(ex.previous_year.change_percent, 7.7);
});

test("accents and country suffix: 'Rīga, Latvia' and 'jurmala' find their rows", () => {
  assert.equal(lvAnswer([two], { town: "Rīga, Latvia", property_type: null, rooms: 2 }).price?.value, 51700);
  assert.equal(lvAnswer([two], { town: "jurmala", property_type: "flat", rooms: 2 }).status, "ok");
});

test("a town answered in the latest year; the older year is used when the newest is under 5 deals", () => {
  const a = lvAnswer([two], { town: "Aizkraukle", property_type: null, rooms: 2 });
  assert.equal(a.price?.value, 17300);
  const b = lvAnswer([two], { town: "Bebru pagasts", property_type: null, rooms: 2 });
  assert.equal(b.status, "ok");
  assert.equal(b.price?.value, 7500); // 2024: 5 deals; 2025 has 4
  assert.equal(b.sample_size, 5);
  assert.match(String(b.statistic?.note ?? ""), /2025/);
});

test("fewer than 5 deals in both years: no figure, said in words", () => {
  const a = lvAnswer([two], { town: "Daudzeses pagasts", property_type: null, rooms: 2 });
  assert.equal(a.status, "no_matches");
  assert.equal(a.price, null);
  assert.match(a.summary, /fewer than 5/);
});

test("a municipality name answers with the totals of its towns", () => {
  const a = lvAnswer([two], { town: "Valmieras novads", property_type: null, rooms: 2 });
  assert.equal(a.status, "ok");
  assert.match(a.summary, /towns of Valmieras novads/);
  assert.equal(findPlace(two.rows, "Valmiera")!.row.place, "Valmiera");
});

test("an unknown place names where to look instead of an empty ok", () => {
  const a = lvAnswer([two], { town: "Atlantis", property_type: null, rooms: 2 });
  assert.equal(a.status, "no_matches");
  assert.match(a.summary, /Riga/);
});

test("no room count: the size with the most deals is the headline and the others are listed", () => {
  const a = lvAnswer([two, three], { town: "Riga", property_type: null, rooms: null });
  assert.equal(a.status, "ok");
  assert.equal((a.extra as any).rooms, 3);
  assert.equal(a.price?.value, 81000);
  assert.equal((a.extra as any).by_rooms.length, 2);
  assert.match(String(a.statistic?.note ?? ""), /No room count was given/);
});

test("bad input is a clear 400, not a silent answer", () => {
  assert.throws(() => lvAnswer([two], { town: "Riga", property_type: "castle", rooms: null }), InputError);
  assert.throws(() => lvAnswer([two], { town: null, property_type: null, rooms: 2 }), InputError);
  assert.throws(() => lvAnswer([two], { town: "Riga", property_type: null, rooms: 7 }), InputError);
});

test("lvHomeSales fetches only the asked room file and caches it", async () => {
  clearCache();
  const asked: number[] = [];
  const fetcher = async (r: number) => {
    asked.push(r);
    return csv(ROWS);
  };
  const a = await lvHomeSales({ town: "Riga", rooms: 2 }, { fetcher, now: 1 });
  assert.equal(a.price?.value, 51700);
  await lvHomeSales({ town: "Riga", rooms: 2 }, { fetcher, now: 2 });
  assert.deepEqual(asked, [2]);
  clearCache();
});

test("an outage keeps the cached copy; without one it is a source error", async () => {
  clearCache();
  await assert.rejects(lvHomeSales({ town: "Riga", rooms: 2 }, { fetcher: async () => { throw new SourceError("Source timed out", "x"); }, now: 1 }), SourceError);
  await loadTable(2, { fetcher: async () => csv(ROWS), now: 1 });
  const a = await lvHomeSales({ town: "Riga", rooms: 2 }, { fetcher: async () => { throw new SourceError("Source timed out", "x"); }, now: 1e12 });
  assert.equal(a.status, "ok");
  clearCache();
});

test("INFO states the licence and the attribution", () => {
  assert.match(INFO.licence, /CC BY 4\.0/);
  assert.match(INFO.attribution, /Valsts zemes dienests/);
});

test("manifest: serves a Latvian request only when a town is named, so the Eurostat index keeps the national question", () => {
  const s = SOURCE_PLUGINS.find((p) => p.info.id === "lv-vzd-home-sales")!;
  const idx = SOURCE_PLUGINS.find((p) => p.info.id === "eu-home-price-index")!;
  assert.equal(s.serves!({ country: "LV", town: "Riga" }), true);
  assert.equal(s.serves!({ country: "LV" }), false);
  assert.equal(idx.serves!({ country: "LV" }), true);
  assert.equal(idx.serves!({ country: "LV", town: "Riga" }), false);
});
