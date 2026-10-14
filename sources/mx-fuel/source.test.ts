import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeDaily, writeMeta } from "../../lib/library/store";
import {
  MX_STATES, decodeShapes, mxAnswerFromRow, mxDailyRows, mxFuelNow, mxHarvest, mxHistoryKey, mxStations, mxToday, parseMxPlaces, parseMxPrices,
  resolveMxArea, stateOf,
} from "./source";
import { MX_STATES_RAW } from "./states";

// Excerpts of the CRE feeds as fetched on 14 Oct 2026 (the first entries of each file; the BOM and CRLF line ends are dropped):
//   https://publicacionexterna.azurewebsites.net/publicaciones/prices and .../places
const PRICES_XML = "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<places>\n  <place place_id=\"11703\">\n    <gas_price type=\"regular\">22.95</gas_price>\n    <gas_price type=\"premium\">27.9</gas_price>\n  </place>\n  <place place_id=\"11702\">\n    <gas_price type=\"regular\">24.5</gas_price>\n    <gas_price type=\"premium\">30.5</gas_price>\n    <gas_price type=\"diesel\">27</gas_price>\n  </place>\n  <place place_id=\"11701\">\n    <gas_price type=\"regular\">20.4</gas_price>\n    <gas_price type=\"diesel\">26.99</gas_price>\n  </place>\n  <place place_id=\"11700\">\n    <gas_price type=\"regular\">23.58</gas_price>\n    <gas_price type=\"premium\">27.84</gas_price>\n    <gas_price type=\"diesel\">26.95</gas_price>\n  </place>\n  <place place_id=\"11699\">\n    <gas_price type=\"regular\">21.99</gas_price>\n    <gas_price type=\"premium\">27.45</gas_price>\n  </place>\n  <place place_id=\"11697\">\n    <gas_price type=\"diesel\">27.29</gas_price>\n  </place>\n  <place place_id=\"11697\">\n    <gas_price type=\"regular\">23.69</gas_price>\n  </place>\n  <place place_id=\"11697\">\n    <gas_price type=\"premium\">27.79</gas_price>\n  </place>\n  <place place_id=\"11696\">\n    <gas_price type=\"premium\">27.41</gas_price>\n  </place>\n  <place place_id=\"11696\">\n    <gas_price type=\"regular\">21.99</gas_price>\n    <gas_price type=\"diesel\">25.39</gas_price>\n  </place>\n  <place place_id=\"11695\">\n    <gas_price type=\"regular\">23.99</gas_price>\n    <gas_price type=\"premium\">27.29</gas_price>\n    <gas_price type=\"diesel\">27.29</gas_price>\n  </place>\n  <place place_id=\"11694\">\n    <gas_price type=\"regular\">23.99</gas_price>\n    <gas_price type=\"premium\">27.79</gas_price>\n    <gas_price type=\"diesel\">27</gas_price>\n  </place>\n  <place place_id=\"3153\">\n    <gas_price type=\"regular\">20.99</gas_price>\n  </place>\n  <place place_id=\"3153\">\n    <gas_price type=\"premium\">28.59</gas_price>\n    <gas_price type=\"diesel\">26.99</gas_price>\n  </place>\n  <place place_id=\"11693\">\n    <gas_price type=\"regular\">23.95</gas_price>\n    <gas_price type=\"premium\">28.25</gas_price>\n    <gas_price type=\"diesel\">27</gas_price>\n  </place>\n  <place place_id=\"11692\">\n    <gas_price type=\"regular\">23.92</gas_price>\n    <gas_price type=\"premium\">27.99</gas_price>\n    <gas_price type=\"diesel\">27</gas_price>\n  </place>\n</places>\n";
const PLACES_XML = "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<places>\n  <place place_id=\"2039\">\n    <name>ESTACION HIPODROMO SA DE CV</name>\n    <cre_id>PL/658/EXP/ES/2015</cre_id>\n    <location>\n      <x>-116.9214</x>\n      <y>32.47641</y>\n    </location>\n  </place>\n  <place place_id=\"2040\">\n    <name>LAS MEJORES ESTACIONES SA DE CV</name>\n    <cre_id>PL/902/EXP/ES/2015</cre_id>\n    <location>\n      <x>-99.74484</x>\n      <y>20.3037</y>\n    </location>\n  </place>\n  <place place_id=\"2041\">\n    <name>DIAZ GAS SA DE CV</name>\n    <cre_id>PL/760/EXP/ES/2015</cre_id>\n    <location>\n      <x>-106.4514</x>\n      <y>31.71947</y>\n    </location>\n  </place>\n  <place place_id=\"2042\">\n    <name>COMBU-EXPRESS SA DE CV</name>\n    <cre_id>PL/825/EXP/ES/2015</cre_id>\n    <location>\n      <x>-103.3042</x>\n      <y>20.71413</y>\n    </location>\n  </place>\n  <place place_id=\"2043\">\n    <name>PETROMAX SA DE CV</name>\n    <cre_id>PL/585/EXP/ES/2015</cre_id>\n    <location>\n      <x>-98.29977</x>\n      <y>26.03787</y>\n    </location>\n  </place>\n  <place place_id=\"2044\">\n    <name>ESTACION RAEL S DE RL DE CV</name>\n    <cre_id>PL/842/EXP/ES/2015</cre_id>\n    <location>\n      <x>-117.0715</x>\n      <y>32.51342</y>\n    </location>\n  </place>\n  <place place_id=\"2045\">\n    <name>MULTISERVICIOS LA PILARICA SA DE CV</name>\n    <cre_id>PL/371/EXP/ES/2015</cre_id>\n    <location>\n      <x>-108.9685</x>\n      <y>25.7558</y>\n    </location>\n  </place>\n  <place place_id=\"2046\">\n    <name>PETROMAX SA DE CV</name>\n    <cre_id>PL/439/EXP/ES/2015</cre_id>\n    <location>\n      <x>-100.2918</x>\n      <y>25.77202</y>\n    </location>\n  </place>\n  <place place_id=\"2047\">\n    <name>ESTACION RAEL S DE RL DE CV</name>\n    <cre_id>PL/860/EXP/ES/2015</cre_id>\n    <location>\n      <x>-116.6079</x>\n      <y>31.86546</y>\n    </location>\n  </place>\n  <place place_id=\"2048\">\n    <name>ESTACION PIRU SA DE CV</name>\n    <cre_id>PL/897/EXP/ES/2015</cre_id>\n    <location>\n      <x>-117.0457</x>\n      <y>32.31202</y>\n    </location>\n  </place>\n</places>\n";

test("MX: the boundary file decodes to 32 states and puts known points in the right state", () => {
  const shapes = decodeShapes(MX_STATES_RAW);
  assert.equal(shapes.length, 32);
  assert.equal(MX_STATES.CMX, "Ciudad de México");
  assert.equal(MX_STATES.MEX, "Estado de México");
  assert.equal(MX_STATES.JAL, "Jalisco");
  // landmarks
  assert.equal(stateOf(-99.1332, 19.4326), "CMX"); // Zócalo, Mexico City
  assert.equal(stateOf(-99.6557, 19.2826), "MEX"); // Toluca
  assert.equal(stateOf(-99.2216, 18.9242), "MOR"); // Cuernavaca
  assert.equal(stateOf(-86.8515, 21.1619), "ROO"); // Cancún
  assert.equal(stateOf(-89.6237, 20.9674), "YUC"); // Mérida
  assert.equal(stateOf(-110.3109, 24.1426), "BCS"); // La Paz
  assert.equal(stateOf(-98.2063, 19.0414), "PUE"); // Puebla
  // station coordinates from the real places feed
  assert.equal(stateOf(-116.9214, 32.47641), "BCN"); // Tijuana
  assert.equal(stateOf(-106.4514, 31.71947), "CHH"); // Ciudad Juárez
  assert.equal(stateOf(-103.3042, 20.71413), "JAL"); // Guadalajara area
  assert.equal(stateOf(-100.2918, 25.77202), "NLE"); // Monterrey area
  assert.equal(stateOf(-108.9685, 25.7558), "SIN");
  // outside Mexico, and bad input
  assert.equal(stateOf(-95.37, 29.76), null); // Houston
  assert.equal(stateOf(NaN, 20), null);
});

test("MX: the price feed parses; a place that appears several times is merged; implausible prices are dropped", () => {
  const prices = parseMxPrices(PRICES_XML);
  assert.equal(prices.size, 12);
  assert.deepEqual(prices.get("11703"), { regular: 22.95, premium: 27.9 });
  assert.deepEqual(prices.get("11697"), { diesel: 27.29, regular: 23.69, premium: 27.79 }); // three <place> elements, one place_id
  assert.deepEqual(prices.get("3153"), { regular: 20.99, premium: 28.59, diesel: 26.99 });
  const odd = '<places><place place_id="1"><gas_price type="regular">2.35</gas_price><gas_price type="diesel">265</gas_price></place><place place_id="2"><gas_price type="regular">23.9</gas_price></place></places>';
  const p = parseMxPrices(odd);
  assert.equal(p.has("1"), false); // both prices out of range: the place is dropped
  assert.deepEqual(p.get("2"), { regular: 23.9 });
});

test("MX: the places feed parses to coordinates only; coordinates outside Mexico are dropped", () => {
  const places = parseMxPlaces(PLACES_XML);
  assert.equal(places.size, 10);
  assert.deepEqual(places.get("2039"), { lon: -116.9214, lat: 32.47641 });
  const bad = '<places><place place_id="9"><name>X</name><location><x>-3.7</x><y>40.4</y></location></place><place place_id="10"><name>Y</name></place></places>';
  assert.equal(parseMxPlaces(bad).size, 0);
});

test("MX: the two feeds join by place_id and each station lands in its state", () => {
  const prices = parseMxPrices(PRICES_XML);
  const real = [...parseMxPlaces(PLACES_XML).values()];
  // The two excerpts come from opposite ends of the files (ids 11692-11703 and 2039-2048), so line the ten real coordinates up with ten real price ids.
  const places = new Map([...prices.keys()].slice(0, 10).map((id, i) => [id, real[i]] as const));
  const { records, located } = mxStations(prices, places);
  assert.equal(located, 10);
  const byState = new Map<string, number>();
  for (const r of records) if (r.fuel === "petrol95") byState.set(r.state, (byState.get(r.state) ?? 0) + 1);
  // ids in feed order: 11703 BCN, 11702 Querétaro/Hidalgo area, 11701 CHH, 11700 JAL, 11699 TAM, 11697 BCN, 11696 SIN, 11695 NLE, 11694 BCN, 3153 BCN
  assert.equal(byState.get("BCN"), 4);
  assert.equal(byState.get("CHH"), 1);
  assert.equal(byState.get("JAL"), 1);
  assert.equal(byState.get("TAM"), 1);
  assert.equal(byState.get("SIN"), 1);
  assert.equal(byState.get("NLE"), 1);
  assert.ok(records.every((r) => r.price >= 8 && r.price <= 50));
  // a price whose place has no location is not counted
  assert.equal(mxStations(prices, new Map()).located, 0);
});

test("MX: library rows for Mexico and each state, per fuel (regular = petrol95, premium = petrol98)", () => {
  const records = [
    ...[22.95, 24.5, 20.4, 23.58, 21.99].map((price) => ({ state: "CMX", fuel: "petrol95" as const, price })),
    ...[27.9, 30.5, 27.84].map((price) => ({ state: "CMX", fuel: "petrol98" as const, price })),
    ...[27, 26.99, 26.95, 25.39, 27.29, 27].map((price) => ({ state: "JAL", fuel: "diesel" as const, price })),
  ];
  const day = mxDailyRows(records, "2026-10-14");
  assert.equal(day.currency, "MXN");
  assert.equal(day.unit, "per litre");
  assert.deepEqual(day.rows.map((r) => `${r.area}/${r.item}/${r.n}`), ["ALL/diesel/6", "ALL/petrol95/5", "ALL/petrol98/3", "CMX/petrol95/5", "CMX/petrol98/3", "JAL/diesel/6"]);
  const cmx = day.rows.find((r) => r.area === "CMX" && r.item === "petrol95")!;
  assert.deepEqual([cmx.median, cmx.min, cmx.max], [22.95, 20.4, 24.5]);
  assert.equal(mxToday(new Date("2026-10-14T03:17:00Z")), "2026-10-13"); // 21:17 on the 13th in Mexico City
  assert.equal(mxToday(new Date("2026-10-14T15:00:00Z")), "2026-10-14");
});

test("MX: states resolve from names, codes and nicknames; cities are refused with a pointer to the state", () => {
  assert.deepEqual(resolveMxArea({}), { area: "ALL", label: "Mexico" });
  assert.deepEqual(resolveMxArea({ area: "México" }), { area: "ALL", label: "Mexico" });
  assert.deepEqual(resolveMxArea({ area: "Ciudad de México" }), { area: "CMX", label: "Ciudad de México" });
  assert.equal(resolveMxArea({ area: "CDMX" }).area, "CMX");
  assert.equal(resolveMxArea({ area: "Distrito Federal" }).area, "CMX");
  assert.equal(resolveMxArea({ area: "Estado de México" }).area, "MEX");
  assert.equal(resolveMxArea({ area: "Edomex" }).area, "MEX");
  assert.equal(resolveMxArea({ area: "nuevo leon" }).area, "NLE");
  assert.equal(resolveMxArea({ area: "Michoacán de Ocampo" }).area, "MIC");
  assert.equal(resolveMxArea({ town: "Jalisco" }).area, "JAL");
  assert.equal(resolveMxArea({ area: "JAL" }).area, "JAL");
  assert.throws(() => resolveMxArea({ area: "Guadalajara" }), /published by state, not by city/);
  assert.throws(() => resolveMxArea({ postcode: "06000" }), /postcodes are not used/);
  assert.deepEqual(mxHistoryKey({ area: "Jalisco", fuel: "diesel" }), { area: "JAL", item: "diesel", label: "Jalisco, Mexico" });
  assert.equal(mxHistoryKey({ area: "Jalisco", fuel: "lpg" }), null);
  assert.equal(mxHistoryKey({ area: "Atlantis", fuel: "diesel" }), null);
});

test("MX: the answer names the place, the day, the unit and flags an old copy", () => {
  const row = { date: "2026-10-14", area: "CMX", item: "petrol95", n: 412, median: 23.45, low: 22.5, high: 24.4, min: 20.9, max: 26.2 };
  const place = { area: "CMX", label: "Ciudad de México" };
  const a = mxAnswerFromRow(row, { fuel: "petrol95", place, query: { country: "MX", area: "Ciudad de México", fuel: "petrol95" }, now: "2026-10-14" });
  assert.equal(a.status, "ok");
  assert.equal(a.price_type, "posted_pump_price");
  assert.equal(a.price!.currency, "MXN");
  assert.equal(a.price!.unit, "per litre");
  assert.equal(a.price!.median, 23.45);
  assert.equal(a.sample_size, 412);
  assert.equal(a.confidence, "high");
  assert.deepEqual(a.period, { from: "2026-10-14", to: "2026-10-14" });
  assert.match(a.summary, /Regular petrol \(gasolina regular, Magna\) in Ciudad de México: median .*23\.45 per litre on 2026-10-14/);
  assert.doesNotMatch(a.summary, /old data/);
  // posted prices are never described as what people pay; tax status and range definition are stated
  assert.match(a.summary, /typical range \(10th–90th percentile\) .* across stations \(posted pump prices, taxes included\)\./);
  assert.doesNotMatch(a.summary, /\b(costs?|paid|pays?)\b/i);
  assert.match(a.source.licence, /Libre Uso MX/);
  const old = mxAnswerFromRow(row, { fuel: "petrol95", place, query: {}, now: "2026-10-20" });
  assert.match(old.summary, /This is old data: our copy of the regulator's feeds is 6 days old/);
  assert.equal((old.extra as any).data_age_days, 6);
});

test("MX: end to end from a library: found, a fuel with too few stations, and a fuel Mexico does not publish", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "mx-lib-"));
  const saved = process.env.PROOFPRICE_LIBRARY_DIR;
  process.env.PROOFPRICE_LIBRARY_DIR = dir;
  try {
    const records = [
      ...[22.95, 24.5, 20.4, 23.58, 21.99, 23.69].map((price) => ({ state: "CMX", fuel: "petrol95" as const, price })),
      ...[27.9, 30.5].map((price) => ({ state: "CMX", fuel: "petrol98" as const, price })),
    ];
    const day = mxDailyRows(records, "2026-10-14");
    const { rows } = writeDaily("mx-fuel", day);
    writeMeta("mx-fuel", {
      source: "mx-fuel", currency: "MXN", unit: "per litre", first_date: day.date, last_date: day.date, days: 1,
      last_harvest_at: "2026-10-14T15:00:00.000Z", last_rows: rows, last_ok_at: "2026-10-14T15:00:00.000Z", last_error: null, note: day.note,
    });
    const ok = await mxFuelNow({ area: "Ciudad de México", fuel: "petrol95" });
    assert.equal(ok.status, "ok");
    assert.equal(ok.sample_size, 6);
    assert.match(ok.summary, /Ciudad de México/);
    const all = await mxFuelNow({ fuel: "petrol95" });
    assert.equal(all.sample_size, 6);
    const thin = await mxFuelNow({ area: "CDMX", fuel: "petrol98" }); // 2 stations: nothing is published
    assert.equal(thin.status, "no_matches");
    assert.equal(thin.price, null);
    await assert.rejects(mxFuelNow({ area: "CDMX", fuel: "lpg" }), /petrol95/);
    await assert.rejects(mxFuelNow({ area: "Guadalajara", fuel: "diesel" }), /by state/);
  } finally {
    if (saved === undefined) delete process.env.PROOFPRICE_LIBRARY_DIR;
    else process.env.PROOFPRICE_LIBRARY_DIR = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("MX: the collector joins both feeds and refuses a feed that looks truncated", async () => {
  const realFetch = globalThis.fetch;
  // A full-size pair of feeds built by repeating the real excerpts under new ids.
  const priceBlocks = [...PRICES_XML.matchAll(/<place place_id="\d+">[\s\S]*?<\/place>/g)].map((m) => m[0]);
  const placeBlocks = [...PLACES_XML.matchAll(/<place place_id="\d+">[\s\S]*?<\/place>/g)].map((m) => m[0]);
  const big = (blocks: string[], n: number) =>
    "<?xml version=\"1.0\"?><places>" + Array.from({ length: n }, (_, i) => blocks[i % blocks.length].replace(/place_id="\d+"/, `place_id="${100000 + i}"`)).join("") + "</places>";
  const serve = (n: number) =>
    (async (u: any) => new Response(String(u).endsWith("/prices") ? big(priceBlocks, n) : big(placeBlocks, n), { status: 200 })) as typeof fetch;
  try {
    globalThis.fetch = serve(6000);
    const day = await mxHarvest(new Date("2026-10-14T15:00:00Z"));
    assert.equal(day.date, "2026-10-14");
    assert.ok(day.rows.some((r) => r.area === "ALL" && r.item === "petrol95" && r.n > 3000));
    globalThis.fetch = serve(40);
    await assert.rejects(mxHarvest(new Date("2026-10-14T15:00:00Z")), /expected over 5,000/);
    globalThis.fetch = (async () => new Response("down", { status: 503 })) as typeof fetch;
    await assert.rejects(mxHarvest(), /HTTP 503/);
  } finally {
    globalThis.fetch = realFetch;
  }
});
