import { test } from "node:test";
import assert from "node:assert/strict";
import { parseJsonStat } from "../../lib/adapters";
import { categoryById, runCategory } from "../../lib/registry";
import { InputError, SourceError } from "../../lib/http";
import {
  answerFor, buildQuery, finlandRent, INFO, nonSubsidisedCode, placesOf, quarterRange, quarterWords, readFigure, readMeta, readVars, requestFor, resolvePlace, roomsCode, STATFIN_API, tableUrl,
} from "./source";
import { HELSINKI, HELSINKI_THIN, META_15FA } from "./fixtures";

// META_15FA: real table metadata, GET checked 2026-10-22. HELSINKI*: hand-built JSON-stat2 in PxWeb's layout (see fixtures.ts).
const meta = readMeta(META_15FA);
const v = readVars(meta);
const places = placesOf(v.area);
const URL = tableUrl();

function rig(data: unknown) {
  const log: Array<{ method: string; url: string; body?: any }> = [];
  return {
    log,
    fetcher: async (url: string) => { log.push({ method: "GET", url }); return META_15FA; },
    poster: async (url: string, body: unknown) => { log.push({ method: "POST", url, body }); return data; },
  };
}

test("INFO: official statistic, CC BY 4.0, attribution to Statistics Finland", () => {
  assert.equal(INFO.id, "fi-stat-rents");
  assert.equal(INFO.price_type, "official_statistic");
  assert.match(INFO.licence, /Creative Commons Attribution 4\.0/);
  assert.match(INFO.attribution, /Statistics Finland/);
  assert.equal(URL, `${STATFIN_API}/15fa.px`);
});

test("metadata: variables are found by code stem and the places are read from it", () => {
  assert.equal(v.area.code, "alue_44_20260101");
  assert.equal(v.time.code, "timeperiod_q");
  assert.equal(places.length, 85);
  assert.equal(nonSubsidisedCode(v.funding), "1");
  assert.equal(places.find((p) => p.code === "MK06")!.name, "Pirkanmaa");
});

test("places: towns, districts, aliases, the whole country by default, and a clear error", () => {
  assert.equal(resolvePlace(places).code, "SSS");
  assert.equal(resolvePlace(places, "Helsinki").code, "091");
  assert.equal(resolvePlace(places, "helsingfors").code, "091");
  assert.equal(resolvePlace(places, "Jyvaskyla").code, "179");
  assert.equal(resolvePlace(places, "Helsinki 2").code, "091_2");
  assert.equal(resolvePlace(places, "Espoo").code, "049");
  assert.equal(resolvePlace(places, "Greater Helsinki").code, "pks");
  assert.equal(resolvePlace(places, "Uusimaa").code, "MK01");
  assert.throws(() => resolvePlace(places, "Nurmes"), (e: unknown) => e instanceof InputError && /Helsinki/.test((e as Error).message));
});

test("rooms: Finnish room count, 3 means three or more, bad input is explained", () => {
  assert.equal(roomsCode(v.rooms, undefined), null);
  assert.equal(roomsCode(v.rooms, 2), "2");
  assert.equal(roomsCode(v.rooms, 5), "3");
  assert.throws(() => roomsCode(v.rooms, 0), InputError);
});

test("request: the four newest quarters, one area, non-subsidised, price and count contents", () => {
  const q = requestFor(v, "091", "1", "SSS");
  assert.equal(q.response.format, "json-stat2");
  const by = Object.fromEntries(q.query.map((x) => [x.code, x.selection.values]));
  assert.deepEqual(by["alue_44_20260101"], ["091"]);
  assert.deepEqual(by["rahoitus_2_20260101"], ["1"]);
  assert.deepEqual(by["timeperiod_q"], ["2025Q4", "2026Q1", "2026Q2", "2026Q3"]);
  assert.deepEqual(by["contentscode"], ["asvu_keskineliovuokra", "asvu_keskineliovuokra_lkm", "asvu_keskineliovuokra_u", "asvu_keskineliovuokra_u_lkm"]);
  assert.deepEqual(buildQuery([["a", ["b"]]]).query[0], { code: "a", selection: { filter: "item", values: ["b"] } });
});

test("quarters become dates and words", () => {
  assert.deepEqual(quarterRange("2026Q3"), { from: "2026-07-01", to: "2026-09-30" });
  assert.deepEqual(quarterRange("2026Q1"), { from: "2026-01-01", to: "2026-03-31" });
  assert.equal(quarterWords("2026Q3"), "Q3 2026");
  assert.throws(() => quarterRange("2026"), SourceError);
});

test("readFigure: newest quarter, with the count and the new-contract figure", () => {
  const f = readFigure(parseJsonStat(HELSINKI), v)!;
  assert.equal(f.quarter, "2026Q3");
  assert.equal(f.price, 23.1);
  assert.equal(f.count, 3380);
  assert.equal(f.newPrice, 25.9);
  assert.deepEqual(f.skipped, []);
});

test("readFigure: a quarter with fewer than 5 observations is skipped, never published", () => {
  const f = readFigure(parseJsonStat(HELSINKI_THIN), v)!;
  assert.equal(f.quarter, "2026Q2");
  assert.equal(f.price, 23);
  assert.deepEqual(f.skipped, ["2026Q3"]);
});

test("finlandRent: the exact request, answer fields and honesty fields", async () => {
  const r = rig(HELSINKI);
  const a = await finlandRent({ town: "Helsinki" }, { fetcher: r.fetcher, poster: r.poster });
  assert.deepEqual(r.log.map((x) => x.method), ["GET", "POST"]);
  assert.equal(r.log[0].url, URL);
  const sel = Object.fromEntries(r.log[1].body.query.map((x: any) => [x.code, x.selection.values]));
  assert.deepEqual(sel["alue_44_20260101"], ["091"]);
  assert.deepEqual(sel["huoneluku_5_20260101"], ["SSS"]);
  assert.equal(a.status, "ok");
  assert.equal(a.price!.currency, "EUR");
  assert.equal(a.price!.unit, "per m²");
  assert.equal(a.price!.value, 23.1);
  assert.equal(a.price!.measure, "average");
  assert.equal(a.price!.median, null);
  assert.equal(a.sample_size, 3380);
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.period.from, "2026-07-01");
  assert.equal(a.period.to, "2026-09-30");
  assert.match(a.summary, /Helsinki/);
  assert.match(a.summary, /Q3 2026/);
  assert.equal((a.extra as any).average_rent_per_m2_new_contracts, 25.9);
});

test("finlandRent: rooms are passed through and named", async () => {
  const r = rig(HELSINKI);
  const a = await finlandRent({ town: "Helsinki", bedrooms: 2 }, { fetcher: r.fetcher, poster: r.poster });
  const sel = Object.fromEntries(r.log[1].body.query.map((x: any) => [x.code, x.selection.values]));
  assert.deepEqual(sel["huoneluku_5_20260101"], ["2"]);
  assert.match(a.summary, /two-room flat/);
});

test("finlandRent: thin newest quarter is explained in the note", async () => {
  const r = rig(HELSINKI_THIN);
  const a = await finlandRent({ town: "Helsinki" }, { fetcher: r.fetcher, poster: r.poster });
  assert.equal(a.price!.value, 23);
  assert.match(JSON.stringify(a), /Q3 2026/);
  assert.match(JSON.stringify(a), /at least 5 observations/);
});

test("answerFor: no usable figure is no_matches with the reason, not a number", () => {
  const p = places.find((x) => x.code === "091_1")!;
  const a = answerFor({}, p, "one-room flat", null, null);
  assert.equal(a.status, "no_matches");
  assert.equal(a.price, null);
});

test("finlandRent: a changed table layout is a source error, an unknown town an input error", async () => {
  const r = rig({ version: "2.0", class: "dataset", id: [], size: [], dimension: {}, value: [] });
  await assert.rejects(finlandRent({ town: "Helsinki" }, { fetcher: r.fetcher, poster: r.poster }), SourceError);
  await assert.rejects(finlandRent({ town: "Nurmes" }, { fetcher: r.fetcher, poster: r.poster }), InputError);
  await assert.rejects(finlandRent({}, { fetcher: async () => ({ nope: 1 }), poster: r.poster }), SourceError);
});

test("fi-stat-rents: routed by country through the shared rent tool (network stubbed, GET and POST)", async () => {
  const realFetch = globalThis.fetch;
  const seen: string[] = [];
  globalThis.fetch = (async (url: any, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    seen.push(`${method} ${String(url)}`);
    return new Response(JSON.stringify(method === "POST" ? HELSINKI : META_15FA), { status: 200, headers: { "content-type": "application/json; charset=utf-8" } });
  }) as typeof fetch;
  try {
    const a = await runCategory(categoryById("rent")!, { country: "fi", town: "Helsinki" });
    assert.equal(a.status, "ok");
    assert.equal(a.source.id, "fi-stat-rents");
    assert.equal(a.price!.value, 23.1);
    assert.deepEqual(seen, [`GET ${URL}`, `POST ${URL}`]);
  } finally {
    globalThis.fetch = realFetch;
  }
});
