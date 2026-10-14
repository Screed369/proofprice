import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAtStations, flattenAtRegions, resolveAtRegion, atNameKey, atAnswer, atDailyRows, atHistoryKey } from "./source";

// Rows copied from the live E-Control service on 14 Oct 2026 (by-region?code=9&type=BL&fuelType=DIE&includeClosed=true),
// trimmed to the fields we read (contact details and opening hours dropped).
const st = (id: number, name: string, address: string, postalCode: string, city: string, amount: number, open = true) => ({
  id, name, location: { address, postalCode, city, latitude: 48.2, longitude: 16.3 }, open, position: 1,
  prices: [{ fuelType: "DIE", amount, label: "Diesel" }],
});
const wien = [
  st(1475831, "boesch energy,  turmöl", "Brünnerstr. 64", "1210", "Wien", 2.074, true),
  st(1494440, "TMC Werkstatt & Tankstelle", "Rechte Wienzeile 43", "1050", "Wien", 2.079, true),
  st(1135, "NNB BRUNNENTANKSTELLE", "Brunnengasse 4", "1160", "WIEN", 2.086, true),
  st(36271, "AVANTI - Wien Simmeringer Hauptstraße 5", "Simmeringer Hauptstrasse 5", "1110", "Wien", 2.089, true),
  st(41286, "Maroltinger Tankstelle", "Maroltingergasse 66", "1160", "Wien", 2.089, false),
  st(1354935, "AVANTI - Wien Simmeringer Hauptstraße 489", "Simmeringer Hauptstrasse 489", "1110", "Wien", 2.089, true),
  st(1469546, "AVANTI - Wien Jedletzbergerstraße 7", "Jedletzbergerstrasse 7", "1110", "Wien", 2.089, true),
  st(1474472, "Diskont Tankstelle", "Donaufelderstrasse 137 (am HOFER Parkplatz)", "1210", "Wien", 2.089, true),
  st(1474608, "Turmöl Quick", "Gadnergasse 1", "1110", "Wien", 2.089, true),
  st(1469126, "Turmöl Quick", "Breitenfurterstraße 473", "1230", "Wien", 2.09, true),
  st(1472147, "Turmöl Quick", "Altmannsdorfer Straße 96", "1120", "Wien", 2.09, true),
];
// District 901 (same day): one real price and a closed station listed at a placeholder 4.000 EUR.
const district = [
  st(35567, "BP", "Franz Josefskai/Morzinpl", "1010", "Wien", 2.299, true),
  st(45247, "Meine Marke", "Rudolfsplatz 13a", "1010", "Wien", 4, false),
];

// Entries copied from the live /regions tree (14 Oct 2026).
const regionsJson = [
  { code: 6, type: "BL", name: "Steiermark", postalCodes: ["8010", "8020", "8700"], subRegions: [
    { code: 601, type: "PB", name: "Graz(Stadt)", subRegions: [], postalCodes: ["8010", "8020", "8036", "8041", "8042", "8043", "8053", "8045", "8047", "8052", "8055"] },
    { code: 606, type: "PB", name: "Graz-Umgebung", subRegions: [], postalCodes: ["8051", "8054"] },
  ] },
  { code: 4, type: "BL", name: "Oberösterreich", postalCodes: ["4020"], subRegions: [
    { code: 401, type: "PB", name: "Stadt Linz", subRegions: [], postalCodes: ["4020", "4030", "4052"] },
    { code: 410, type: "PB", name: "Linz-Land", subRegions: [], postalCodes: ["4053"] },
  ] },
  { code: 2, type: "BL", name: "Kärnten", postalCodes: ["9020"], subRegions: [
    { code: 201, type: "PB", name: "Klagenfurt Stadt", subRegions: [], postalCodes: ["9073", "9020", "9061"] },
  ] },
];

test("AT: stations parse; placeholder prices and stations without the fuel are dropped", () => {
  const s = parseAtStations(wien, "DIE");
  assert.equal(s.length, 11);
  assert.equal(s[0].price, 2.074);
  assert.equal(s[0].brand, "boesch energy, turmöl");
  assert.equal(parseAtStations(district, "DIE").length, 1);
  assert.equal(parseAtStations(wien, "SUP").length, 0);
  assert.throws(() => parseAtStations({ error: 1 }, "DIE"));
});

test("AT: region resolution by code, Bundesland name, district name and postcode", () => {
  const regions = flattenAtRegions(regionsJson);
  assert.equal(regions.length, 8);
  assert.deepEqual(resolveAtRegion({ area: "9" }, null), { code: "9", type: "BL", label: "Wien", parentCode: null, parentLabel: null });
  assert.equal((resolveAtRegion({ area: "Wien" }, null) as any).code, "9");
  assert.equal((resolveAtRegion({ town: "Tyrol" }, null) as any).code, "7");
  assert.equal((resolveAtRegion({ area: "901" }, null) as any).parentCode, "9");
  assert.equal(resolveAtRegion({ town: "Graz" }, null), "need-regions");
  assert.equal((resolveAtRegion({ town: "Graz" }, regions) as any).code, "601");
  assert.equal((resolveAtRegion({ town: "Linz" }, regions) as any).code, "401"); // 'Stadt Linz', not 'Linz-Land'
  assert.equal((resolveAtRegion({ town: "klagenfurt" }, regions) as any).code, "201");
  const byCp = resolveAtRegion({ postcode: "8010" }, regions) as any;
  assert.equal(byCp.code, "601"); // the district, not the whole Bundesland
  assert.equal(byCp.parentLabel, "Steiermark");
  assert.throws(() => resolveAtRegion({ town: "Atlantis" }, regions), /Unknown Austrian place/);
  assert.throws(() => resolveAtRegion({ postcode: "12" }, regions), /4 digits/);
  assert.throws(() => resolveAtRegion({}, regions), /Give an Austrian/);
  assert.equal(atNameKey("Graz(Stadt)"), "GRAZ");
  assert.equal(atNameKey("Stadt Linz"), "LINZ");
  assert.equal(atNameKey("Klagenfurt Stadt"), "KLAGENFURT");
});

test("AT: the answer says plainly that only the cheapest stations are listed", () => {
  const a = atAnswer(parseAtStations(wien, "DIE"), { fuel: "diesel", where: "Wien", query: { area: "9" }, today: "2026-10-14" });
  assert.equal(a.status, "ok");
  assert.equal(a.price_type, "posted_pump_price");
  assert.equal(a.sample_size, 11);
  assert.equal(a.price!.currency, "EUR");
  assert.equal(a.price!.unit, "per litre");
  assert.equal(a.price!.median, 2.089);
  assert.equal(a.price!.min, 2.074);
  assert.deepEqual(a.period, { from: "2026-10-14", to: "2026-10-14" });
  assert.match(a.summary, /cheapest stations/);
  assert.match(a.summary, /not every station/);
  assert.match(a.method, /cheap end of the market/);
  assert.equal((a.extra as any).coverage, "cheapest_stations_only");
  assert.equal((a.extra as any).cheapest_stations.length, 3);
  assert.deepEqual(Object.keys((a.extra as any).cheapest_stations[0]).sort(), ["address", "brand", "id", "postcode", "price", "town"]);
  assert.match(a.source.licence, /No reuse licence/);
  // fewer than 5 stations: no figure
  const few = atAnswer(parseAtStations(district, "DIE"), { fuel: "diesel", where: "district 901", query: { area: "901" }, today: "2026-10-14" });
  assert.equal(few.status, "insufficient_data");
  assert.equal(few.price, null);
});

test("AT: library rows per Bundesland and fuel, and history keys only for Bundesländer", () => {
  const day = atDailyRows(
    [
      { state: "9", fuel: "diesel", prices: [2.07, 2.08, 2.09, 2.09, 2.1, 2.1] },
      { state: "9", fuel: "petrol95", prices: [1.9, 1.9, 1.9] },
      { state: "7", fuel: "diesel", prices: [2.0, 2.0, 2.0, 2.0, 2.0] },
    ],
    "2026-10-14",
  );
  const keys = day.rows.map((r) => `${r.area}/${r.item}/${r.n}`);
  assert.deepEqual(keys, ["7/diesel/5", "9/diesel/6", "9/petrol95/3"]);
  assert.match(day.note ?? "", /Cheapest stations only/);
  assert.deepEqual(atHistoryKey({ area: "Wien", fuel: "diesel" }), { area: "9", item: "diesel", label: "the cheapest stations in Wien (E-Control lists only the cheapest)" });
  assert.equal(atHistoryKey({ area: "9", fuel: "petrol95" })!.area, "9");
  assert.equal(atHistoryKey({ town: "Graz", fuel: "diesel" }), null);
  assert.equal(atHistoryKey({ fuel: "diesel" }), null);
  assert.equal(atHistoryKey({ area: "9", fuel: "lpg" }), null);
});

test("AT: live answer end to end with a stubbed service, widening a thin district to its Bundesland", async () => {
  const { atFuelNow } = await import("./source");
  const realFetch = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (u: any) => {
    const url = String(u);
    urls.push(url);
    return new Response(JSON.stringify(url.includes("code=901") ? district : wien), { status: 200 });
  }) as typeof fetch;
  try {
    const a = await atFuelNow({ area: "901", fuel: "diesel" });
    assert.equal(a.status, "ok");
    assert.equal(urls.length, 2);
    assert.match(urls[0], /code=901&type=PB&fuelType=DIE/);
    assert.match(urls[1], /code=9&type=BL/);
    assert.match(String((a.extra as any).note), /widened to the whole Bundesland Wien/);
    await assert.rejects(atFuelNow({ area: "9", fuel: "lpg" }), /not published for Austria/);
  } finally {
    globalThis.fetch = realFetch;
  }
});
