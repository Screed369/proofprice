import { test } from "node:test";
import assert from "node:assert/strict";
import { parseItStations, parseItPrices, selectItPrices, extractionDate } from "./source";

// Shape copied from the live MIMIT files on 13 Oct 2026.
const itStationsCsv = [
  "Estrazione del 2026-10-12",
  "idImpianto|Gestore|Bandiera|Tipo Impianto|Nome Impianto|Indirizzo|Comune|Provincia|Latitudine|Longitudine",
  "59183|ENIMOOV S.P.A.|Agip Eni|Stradale|19829 AGRIGENTO|SS.189 KM. 64+649 - C.DA SAN MICHELE  S.N.C  |AGRIGENTO|AG|37.333935|13.595533",
  "63381|ENIMOOV S.P.A.|Agip Eni|Stradale|19834\tMONTALLEGRO|SS.115 | KM.158+302|AGRIGENTO|AG|37.38895|13.351206",
  "70000|ROSSI SRL|Q8|Stradale|Q8 MILANO|VIA ROMA 1|MILANO|MI|45.46|9.19",
].join("\n");
const itPricesCsv = [
  "Estrazione del 2026-10-12",
  "idImpianto|descCarburante|prezzo|isSelf|dtComu",
  "59183|Gasolio|1.899|1|10/10/2026 07:30:00",
  "59183|Gasolio|2.099|0|10/10/2026 07:30:00",
  "63381|Gasolio|1.879|1|11/10/2026 08:00:00",
  "63381|Gasolio|1.990|1|23/05/2013 01:03:09",
  "70000|Gasolio|1.950|1|12/10/2026 06:00:00",
  "70000|GPL|0.799|0|12/10/2026 06:00:00",
].join("\n");

test("IT: files parse, stray pipes survive, stale prices and other provinces excluded", () => {
  assert.equal(extractionDate(itPricesCsv), "2026-10-12");
  const st = parseItStations(itStationsCsv);
  assert.equal(st.size, 3);
  assert.equal(st.get("63381")!.town, "AGRIGENTO");
  assert.equal(st.get("63381")!.province, "AG");
  const pr = parseItPrices(itPricesCsv);
  assert.equal(pr.length, 6);
  const ag = selectItPrices(pr, st, { fuel: "diesel", service: "self", province: "AG", extracted: "2026-10-12" });
  assert.deepEqual(ag.map((r) => r.price).sort(), [1.879, 1.899]); // 2013 price dropped, attended price dropped
  const served = selectItPrices(pr, st, { fuel: "diesel", service: "served", province: "AG", extracted: "2026-10-12" });
  assert.deepEqual(served.map((r) => r.price), [2.099]);
  const lpg = selectItPrices(pr, st, { fuel: "lpg", service: "self", town: "Milano", extracted: "2026-10-12" });
  assert.deepEqual(lpg.map((r) => r.price), [0.799]); // LPG counted whatever the service type
});

test("IT: daily library rows by province, fuel and service", async () => {
  const { itDailyRows, itHistoryKey } = await import("./source");
  const day = itDailyRows(parseItPrices(itPricesCsv), parseItStations(itStationsCsv), "2026-10-12");
  const keys = day.rows.map((r) => `${r.area}/${r.item}/${r.n}`);
  for (const k of ["AG/diesel/2", "AG/diesel/served/1", "MI/diesel/1", "MI/lpg/1", "ALL/diesel/3"]) assert.ok(keys.includes(k), k);
  assert.deepEqual(itHistoryKey({ area: "mi", fuel: "diesel", service: "served" }), { area: "MI", item: "diesel/served", label: "province MI" });
  assert.equal(itHistoryKey({ fuel: "lpg", service: "served" })!.item, "lpg");
});

test("IT: placeholders (0, empty, 0.001, 9.999) are missing values, never prices", () => {
  const csv = [
    "Estrazione del 2026-10-12",
    "idImpianto|descCarburante|prezzo|isSelf|dtComu",
    "1|Gasolio|0|1|10/10/2026 07:30:00",
    "2|Gasolio||1|10/10/2026 07:30:00",
    "3|Gasolio|0.001|1|10/10/2026 07:30:00",
    "4|Gasolio|9.999|1|10/10/2026 07:30:00",
    "5|Gasolio|1.899|1|10/10/2026 07:30:00",
  ].join("\n");
  assert.deepEqual(parseItPrices(csv).map((p) => p.price), [1.899]);
});

test("IT: live answer says posted (not paid), names the 08:00 extraction day, tax and range definition", async () => {
  const { itFuelNow } = await import("./source");
  const ids = [80001, 80002, 80003, 80004, 80005, 80006];
  const stations = ["Estrazione del 2026-10-12", "idImpianto|Gestore|Bandiera|Tipo Impianto|Nome Impianto|Indirizzo|Comune|Provincia|Latitudine|Longitudine",
    ...ids.map((id) => `${id}|G|Q8|Stradale|N|VIA ROMA ${id}|MILANO|MI|45.46|9.19`)].join("\n");
  const prices = ["Estrazione del 2026-10-12", "idImpianto|descCarburante|prezzo|isSelf|dtComu",
    ...ids.map((id, i) => `${id}|Gasolio|${(2.2 + i / 100).toFixed(3)}|1|0${i + 4}/10/2026 07:30:00`)].join("\n");
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (u: any) => new Response(String(u).includes("anagrafica") ? stations : prices, { status: 200 })) as typeof fetch;
  try {
    const a = await itFuelNow({ area: "MI", fuel: "diesel" });
    assert.equal(a.status, "ok");
    assert.equal(a.price!.unit, "per litre");
    assert.match(a.summary, /Diesel \(self-service\) in province MI: posted pump prices in force at 08:00 on 2026-10-12 \(taxes included\) have a median of/);
    assert.match(a.summary, /typical range \(10th–90th percentile\)/);
    assert.doesNotMatch(a.summary, /\b(costs?|paid|pays?)\b/i);
  } finally {
    globalThis.fetch = realFetch;
  }
});
