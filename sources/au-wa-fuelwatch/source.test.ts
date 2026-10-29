import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeDaily, writeMeta } from "../../lib/library/store";
import { findSource } from "../../lib/registry";
import {
  fileUrl, newestDay, parseFuelWatchCsv, resolveWaPlace, servesWa, splitCsvLine, waDailyRows, waFuelNow, waHistoryKey,
} from "./source";

// The first rows of FuelWatch's real September 2026 file, seen 29 Oct 2026 from GitHub Actions (probe dep-wafw4):
//   https://warsydprdstafuelwatch.blob.core.windows.net/historical-reports/FuelWatchRetail-09-2026.csv
// (comma separated, dd/mm/yyyy, price in cents per litre).
const HEADER = "PUBLISH_DATE,TRADING_NAME,BRAND_DESCRIPTION,PRODUCT_DESCRIPTION,PRODUCT_PRICE,ADDRESS,LOCATION,POSTCODE,AREA_DESCRIPTION,REGION_DESCRIPTION";
const REAL = [
  "01/09/2026,53 Mile Roadhouse,United,ULP,206.90,5713 South Western Hwy,PINJARRA,6208,Murray,Peel",
  "01/09/2026,53 Mile Roadhouse,United,Diesel,246.90,5713 South Western Hwy,PINJARRA,6208,Murray,Peel",
  "01/09/2026,53 Mile Roadhouse,United,98 RON,230.90,5713 South Western Hwy,PINJARRA,6208,Murray,Peel",
  "01/09/2026,7-Eleven Alkimos,7-Eleven,ULP,195.90,10 Carlsbad Prom,ALKIMOS,6038,North of River,Metro",
  "01/09/2026,7-Eleven Alkimos,7-Eleven,PULP,212.90,10 Carlsbad Prom,ALKIMOS,6038,North of River,Metro",
  "01/09/2026,7-Eleven Alkimos,7-Eleven,Brand Diesel,245.90,10 Carlsbad Prom,ALKIMOS,6038,North of River,Metro",
  "01/09/2026,7-Eleven Alkimos,7-Eleven,98 RON,221.90,10 Carlsbad Prom,ALKIMOS,6038,North of River,Metro",
  "01/09/2026,7-Eleven Ascot,7-Eleven,ULP,195.90,194 Great Eastern Hwy,ASCOT,6104,South of River,Metro",
  "01/09/2026,7-Eleven Ascot,7-Eleven,Brand Diesel,258.90,194 Great Eastern Hwy,ASCOT,6104,South of River,Metro",
  "01/09/2026,7-Eleven Balcatta,7-Eleven,ULP,195.90,174 Balcatta Rd,BALCATTA,6021,North of River,Metro",
  "01/09/2026,7-Eleven Balcatta,7-Eleven,Brand Diesel,255.90,174 Balcatta Rd,BALCATTA,6021,North of River,Metro",
  "01/09/2026,7-Eleven Baldivis,7-Eleven,ULP,193.90,370 Baldivis Rd,BALDIVIS,6171,South of River,Metro",
  "01/09/2026,7-Eleven Baldivis,7-Eleven,Brand Diesel,250.90,370 Baldivis Rd,BALDIVIS,6171,South of River,Metro",
];
// Written for the test, in the same format: a second day (02/09/2026) with six more Metro stations, one quoted trading name with a comma,
// one slip (price 0) and one product we do not offer.
const DAY2 = [
  "02/09/2026,7-Eleven Alkimos,7-Eleven,ULP,190.90,10 Carlsbad Prom,ALKIMOS,6038,North of River,Metro",
  "02/09/2026,7-Eleven Ascot,7-Eleven,ULP,191.90,194 Great Eastern Hwy,ASCOT,6104,South of River,Metro",
  "02/09/2026,7-Eleven Balcatta,7-Eleven,ULP,192.90,174 Balcatta Rd,BALCATTA,6021,North of River,Metro",
  "02/09/2026,7-Eleven Baldivis,7-Eleven,ULP,189.90,370 Baldivis Rd,BALDIVIS,6171,South of River,Metro",
  '02/09/2026,"Caltex, Rockingham",Ampol,ULP,194.90,1 Read St,ROCKINGHAM,6168,South of River,Metro',
  "02/09/2026,BP Cannington,BP,ULP,193.90,2 Albany Hwy,CANNINGTON,6107,South of River,Metro",
  "02/09/2026,BP Cannington,BP,Diesel,240.90,2 Albany Hwy,CANNINGTON,6107,South of River,Metro",
  "02/09/2026,BP Cannington,BP,Brand Diesel,260.90,2 Albany Hwy,CANNINGTON,6107,South of River,Metro",
  "02/09/2026,7-Eleven Alkimos,7-Eleven,Brand Diesel,246.90,10 Carlsbad Prom,ALKIMOS,6038,North of River,Metro",
  "02/09/2026,7-Eleven Ascot,7-Eleven,Brand Diesel,247.90,194 Great Eastern Hwy,ASCOT,6104,South of River,Metro",
  "02/09/2026,7-Eleven Balcatta,7-Eleven,Brand Diesel,248.90,174 Balcatta Rd,BALCATTA,6021,North of River,Metro",
  "02/09/2026,7-Eleven Baldivis,7-Eleven,Brand Diesel,249.90,370 Baldivis Rd,BALDIVIS,6171,South of River,Metro",
  "02/09/2026,Free Pump,Indep,ULP,0.00,3 Nowhere Rd,NOWHERE,6999,Murray,Peel",
  "02/09/2026,53 Mile Roadhouse,United,ULP,200.90,5713 South Western Hwy,PINJARRA,6208,Murray,Peel",
];
const CSV = [HEADER, ...REAL, ...DAY2].join("\n") + "\n";

test("WA: file url for a month", () => {
  assert.equal(fileUrl(2026, 9), "https://warsydprdstafuelwatch.blob.core.windows.net/historical-reports/FuelWatchRetail-09-2026.csv");
});

test("WA: quoted commas split correctly", () => {
  assert.deepEqual(splitCsvLine('a,"Caltex, Rockingham",b'), ["a", "Caltex, Rockingham", "b"]);
});

test("WA: rows parse (dd/mm/yyyy, cents per litre); PULP is not offered and a 0 price is dropped", () => {
  const { records, unknown } = parseFuelWatchCsv(CSV);
  assert.deepEqual(unknown, ["PULP"]);
  assert.ok(!records.some((r) => r.cents === 0));
  const first = records[0];
  assert.deepEqual([first.date, first.station, first.fuel, first.cents, first.suburb, first.postcode, first.region, first.area], ["2026-09-01", "53 Mile Roadhouse", "petrol95", 206.9, "PINJARRA", "6208", "PEEL", "MURRAY"]);
  assert.throws(() => parseFuelWatchCsv("a,b\n1,2"), /expected columns/);
});

test("WA: the newest day keeps one price per station and fuel; standard Diesel beats Brand Diesel", () => {
  const { date, stations } = newestDay(parseFuelWatchCsv(CSV).records);
  assert.equal(date, "2026-09-02");
  const cann = stations.filter((s) => s.station === "BP Cannington" && s.fuel === "diesel");
  assert.equal(cann.length, 1);
  assert.equal(cann[0].cents, 240.9);
  assert.equal(stations.filter((s) => s.station === "7-Eleven Alkimos" && s.fuel === "diesel")[0].cents, 246.9); // Brand Diesel where there is no plain Diesel
});

test("WA: library rows for the state, Perth, region, area, postcode and suburb", () => {
  const day = waDailyRows(parseFuelWatchCsv(CSV).records, ["PULP"]);
  assert.equal(day.date, "2026-09-02");
  const get = (area: string, item: string) => day.rows.find((r) => r.area === area && r.item === item);
  assert.equal(get("WA", "petrol95")!.n, 7);
  assert.equal(get("PERTH", "petrol95")!.n, 6);
  assert.equal(get("R:PEEL", "petrol95")!.n, 1);
  assert.equal(get("A:SOUTH OF RIVER", "petrol95")!.n, 4);
  assert.equal(get("6168", "petrol95")!.n, 1);
  assert.equal(get("ROCKINGHAM", "petrol95")!.median, 1.949);
  assert.match(day.note!, /Products not offered: PULP/);
});

test("WA: places", () => {
  const keys = () => new Set(["R:PEEL", "A:SOUTH OF RIVER", "ROCKINGHAM"]);
  assert.equal(resolveWaPlace({ area: "WA" }, keys).area, "WA");
  assert.equal(resolveWaPlace({ area: "Perth" }, keys).area, "PERTH");
  assert.equal(resolveWaPlace({ town: "Perth" }, keys).area, "PERTH");
  assert.equal(resolveWaPlace({ area: "Peel" }, keys).area, "R:PEEL");
  assert.equal(resolveWaPlace({ postcode: "6168" }, keys).area, "6168");
  assert.equal(resolveWaPlace({ town: "Rockingham" }, keys).area, "ROCKINGHAM");
  assert.equal(resolveWaPlace({ area: "WA", town: "Rockingham" }, keys).area, "ROCKINGHAM");
  assert.throws(() => resolveWaPlace({ postcode: "4000" }, keys), /starting with 6/);
  assert.throws(() => resolveWaPlace({}, keys), /suburb/);
});

test("AU fuel routing: Queensland and Western Australia share the country by postcode and place", () => {
  const none = () => new Set<string>();
  const wa = () => new Set(["ROCKINGHAM", "R:PEEL"]);
  const qld = () => new Set(["MOUNT GRAVATT", "ROCKINGHAM"]);
  assert.equal(servesWa({ postcode: "6000" }, wa, qld), true);
  assert.equal(servesWa({ postcode: "4000" }, wa, qld), false);
  assert.equal(servesWa({ area: "Perth" }, none, none), true);
  assert.equal(servesWa({ area: "WA" }, none, none), true);
  assert.equal(servesWa({ area: "Brisbane" }, none, none), false);
  assert.equal(servesWa({ town: "Rockingham" }, wa, qld), false); // a suburb in both states stays with the default (Queensland)
  assert.equal(servesWa({ area: "Peel" }, wa, qld), true);
  assert.equal(findSource("fuel", "AU", { country: "AU", postcode: "6000" })!.info.id, "au-wa-fuelwatch");
  assert.equal(findSource("fuel", "AU", { country: "AU", area: "Perth" })!.info.id, "au-wa-fuelwatch");
  assert.equal(findSource("fuel", "AU", { country: "AU", area: "Brisbane" })!.info.id, "au-qld-fuel");
  assert.equal(findSource("fuel", "AU", { country: "AU", postcode: "4122" })!.info.id, "au-qld-fuel");
  assert.equal(findSource("fuel", "AU", { country: "AU", area: "QLD" })!.info.id, "au-qld-fuel");
  assert.equal(findSource("fuel", "AU", { country: "AU", town: "Mount Gravatt" })!.info.id, "au-qld-fuel");
});

test("WA: end to end from a library", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wa-lib-"));
  const saved = process.env.PROOFPRICE_LIBRARY_DIR;
  process.env.PROOFPRICE_LIBRARY_DIR = dir;
  try {
    const day = waDailyRows(parseFuelWatchCsv(CSV).records);
    const { rows } = writeDaily("au-wa-fuelwatch", day);
    writeMeta("au-wa-fuelwatch", {
      source: "au-wa-fuelwatch", currency: "AUD", unit: "per litre", first_date: day.date, last_date: day.date, days: 1,
      last_harvest_at: "2026-09-02T03:30:00.000Z", last_rows: rows, last_ok_at: "2026-09-02T03:30:00.000Z", last_error: null, note: day.note,
    });
    const perth = await waFuelNow({ area: "Perth", fuel: "petrol95" });
    assert.equal(perth.status, "ok");
    assert.equal(perth.sample_size, 6);
    assert.match(perth.summary, /Perth \(the FuelWatch Metro region\), Western Australia/);
    assert.match(perth.summary, /2026-09-02/);
    assert.equal(perth.source.id, "au-wa-fuelwatch");
    const wa = await waFuelNow({ area: "WA", fuel: "diesel" });
    assert.equal(wa.sample_size, 5);
    const small = await waFuelNow({ postcode: "6168", fuel: "petrol95" }); // 1 station: below the minimum
    assert.equal(small.status, "no_matches");
    assert.equal(small.price, null);
    await assert.rejects(waFuelNow({ area: "Perth", fuel: "methane" }), /diesel, petrol95/);
    assert.deepEqual(waHistoryKey({ area: "Perth", fuel: "diesel" }), { area: "PERTH", item: "diesel", label: "Perth (the FuelWatch Metro region), Western Australia" });
    assert.equal(waHistoryKey({ area: "Perth", fuel: "methane" }), null);
  } finally {
    if (saved === undefined) delete process.env.PROOFPRICE_LIBRARY_DIR;
    else process.env.PROOFPRICE_LIBRARY_DIR = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("WA: before the first collection the source says so", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wa-empty-"));
  const saved = process.env.PROOFPRICE_LIBRARY_DIR;
  process.env.PROOFPRICE_LIBRARY_DIR = dir;
  try {
    await assert.rejects(waFuelNow({ area: "Perth", fuel: "diesel" }), /Not yet available/);
  } finally {
    if (saved === undefined) delete process.env.PROOFPRICE_LIBRARY_DIR;
    else process.env.PROOFPRICE_LIBRARY_DIR = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});
