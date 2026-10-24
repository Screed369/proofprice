import { test } from "node:test";
import assert from "node:assert/strict";
import { InputError, SourceError } from "../../lib/http";
import { SOURCE_PLUGINS, countriesFor, categoryById } from "../../lib/registry";
import { HARVEST_ITEM, INFO, apiUrl, coverageText, findPlace, chunkCodes, harvestRows, harvestUrl, parseIne, periodCandidates, ptAnswer, ptHarvest, ptHistoryKey, ptRents, readPt, windowOf } from "./source";
import { PT_PLACES } from "./places";
import * as F from "./fixtures";

// Fixtures: real INE API responses captured 2026-10-20 (see fixtures.ts).
const NOW = new Date("2026-10-20T12:00:00Z");
const place = (name: string) => PT_PLACES.find((p) => p.name === name && p.level === "municipality")!;
const fake = (response: unknown) => {
  const urls: string[] = [];
  return { urls, fetcher: async (url: string) => (urls.push(url), response) };
};

test("pt-ine-rents: licence, attribution and type are INE's", () => {
  assert.equal(INFO.id, "pt-ine-rents");
  assert.equal(INFO.price_type, "official_statistic");
  assert.ok(INFO.licence.includes("Creative Commons Attribution 4.0"));
  assert.ok(INFO.licence_url.startsWith("https://"));
  for (const k of ["Instituto Nacional de Estatística", "0014696", "CC BY 4.0", "calculated by ProofPrice"]) assert.ok(INFO.attribution.includes(k), k);
});

test("pt-ine-rents: registered for PT in the rent category", () => {
  assert.ok(SOURCE_PLUGINS.some((s) => s.info.id === "pt-ine-rents"));
  assert.ok(countriesFor("rent").includes("PT"));
  assert.ok(categoryById("rent"));
});

test("pt-ine-rents: all 308 municipalities are listed", () => {
  assert.equal(PT_PLACES.filter((p) => p.level === "municipality").length, 308);
  assert.equal(PT_PLACES[0].code, "PT");
});

test("parseIne reads the history of Lisboa and Portugal", () => {
  const r = parseIne(F.LISBOA_PT_HISTORY);
  assert.equal(r.latestLabel, "2nd Quarter 2026");
  assert.equal(r.updated, "2026-09-29");
  assert.ok(r.rows.length >= 50);
  const lis = r.rows.filter((x) => x.geo === "1A01106" && x.year === 2026 && x.quarter === 2);
  assert.equal(lis[0].value, 17.43);
});

test("parseIne rejects an error reply and an empty reply", () => {
  assert.throws(() => parseIne([{ Sucesso: { Falso: [{ Msg: "Invalid" }] } }]), SourceError);
  assert.throws(() => parseIne([{ IndicadorCod: "0014696" }]), /no data/);
  assert.throws(() => parseIne(null), SourceError);
});

test("apiUrl asks for every quarter, the place and Portugal", () => {
  assert.equal(apiUrl(place("Lisboa")), "https://www.ine.pt/ine/json_indicador/pindica.jsp?op=2&varcd=0014696&Dim1=T&Dim2=1A01106,PT&lang=EN");
  assert.equal(apiUrl(PT_PLACES[0]), "https://www.ine.pt/ine/json_indicador/pindica.jsp?op=2&varcd=0014696&Dim1=T&Dim2=PT&lang=EN");
});

test("readPt: Lisboa latest, year earlier, previous quarter and national", () => {
  const r = readPt(parseIne(F.LISBOA_PT_HISTORY), place("Lisboa"))!;
  assert.equal(r.label, "2nd Quarter 2026");
  assert.equal(r.value, 17.43);
  assert.equal(r.previousQuarter?.value, 17.22);
  assert.equal(r.national?.value, 9.76);
  assert.ok(r.yearEarlier && r.yearEarlier.year === 2025 && r.yearEarlier.quarter === 2);
  assert.equal(r.series.length, 12);
});

test("windowOf is the 12 months to the quarter end", () => {
  assert.deepEqual(windowOf({ year: 2026, quarter: 2 }), { from: "2025-07-01", to: "2026-06-30" });
});

test("findPlace: names, aliases, suggestions and nonsense", () => {
  assert.equal((findPlace("Lisbon") as any).place.name, "Lisboa");
  assert.equal((findPlace("Oporto") as any).place.name, "Porto");
  assert.equal((findPlace("Portugal") as any).place.code, "PT");
  assert.equal(findPlace("Vila Real").kind, "found");
  assert.equal(findPlace("zzzzqq").kind, "none");
  assert.ok(coverageText().includes("308"));
});

test("ptRents: Lisboa answer is an official statistic in EUR per m² per month", async () => {
  const f = fake(F.LISBOA_PT_HISTORY);
  const a = await ptRents({ town: "Lisboa" }, { fetcher: f.fetcher, now: NOW });
  assert.equal(f.urls.length, 1);
  assert.equal(a.status, "ok");
  assert.equal(a.price!.value, 17.43);
  assert.equal(a.price!.currency, "EUR");
  assert.equal(a.price!.unit, "per m² per month");
  assert.equal(a.sample_size, null);
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.period.to, "2026-06-30");
  assert.ok(a.summary.includes("Lisboa"));
});

test("ptRents: national answer, no town", async () => {
  const f = fake(F.LISBOA_PT_HISTORY);
  const a = await ptRents({}, { fetcher: f.fetcher, now: NOW });
  assert.equal(a.price!.value, 9.76);
});

test("ptRents: property_type or bedrooms give no figure and no fetch", async () => {
  const f = fake(F.LISBOA_PT_HISTORY);
  const a = await ptRents({ town: "Lisboa", property_type: "apartment" }, { fetcher: f.fetcher, now: NOW });
  assert.equal(f.urls.length, 0);
  assert.equal(a.price, null);
  const b = await ptRents({ town: "Lisboa", bedrooms: 2 }, { fetcher: f.fetcher, now: NOW });
  assert.equal(b.price, null);
  assert.equal(f.urls.length, 0);
});

test("ptRents: unknown place is not ok and offers nothing wrong; postcode alone is a clear error", async () => {
  const f = fake(F.LISBOA_PT_HISTORY);
  const a = await ptRents({ town: "Atlantis" }, { fetcher: f.fetcher, now: NOW });
  assert.equal(a.price, null);
  assert.equal(a.status, "no_matches");
  await assert.rejects(() => ptRents({ postcode: "1000-001" }, { fetcher: f.fetcher, now: NOW }), InputError);
});

test("ptAnswer: five-places fixture parses and a small municipality has a figure", () => {
  const r = parseIne(F.FIVE_PLACES);
  const arcos = PT_PLACES.find((p) => p.code === "1111601")!;
  const reading = readPt(r, arcos)!;
  assert.equal(reading.value, 5.29);
  const a = ptAnswer(reading, { place: "Arcos de Valdevez", property_type: "any", now: NOW });
  assert.equal(a.price!.value, 5.29);
});

// ---------- stale-if-error copy (harvest) ----------

test("pt-ine-rents: harvest asks INE in groups it accepts (all 347 codes in one request fail with a buffer error)", () => {
  const groups = chunkCodes(PT_PLACES.map((p) => p.code));
  assert.ok(groups.length > 1);
  assert.equal(groups.flat().length, PT_PLACES.length);
  for (const g of groups) assert.ok(g.length <= 40, "INE answered 45 codes and failed on 120");
  assert.equal(harvestUrl("S5A20262", ["PT"]), "https://www.ine.pt/ine/json_indicador/pindica.jsp?op=2&varcd=0014696&Dim1=S5A20262&Dim2=PT&lang=EN");
});

test("pt-ine-rents: candidate quarters run newest first across a year end", () => {
  assert.deepEqual(periodCandidates(new Date("2026-10-23T00:00:00Z"), 3).map((c) => c.code), ["S5A20264", "S5A20263", "S5A20262"]);
  assert.deepEqual(periodCandidates(new Date("2026-01-05T00:00:00Z"), 3).map((c) => c.code), ["S5A20261", "S5A20254", "S5A20253"]);
});

test("pt-ine-rents: harvestRows keeps the newest quarter of the real INE reply, dated by the quarter's end, with no made-up count", () => {
  const out = harvestRows(parseIne(F.FIVE_PLACES));
  assert.equal(out.date, windowOf({ year: 2026, quarter: 2 }).to);
  assert.equal(out.currency, "EUR");
  assert.equal(out.unit, "per m² per month");
  const pt = out.rows.find((r) => r.area === "PT");
  assert.ok(pt);
  assert.equal(pt.item, HARVEST_ITEM);
  assert.ok(Number.isNaN(pt.n), "n must be NO_COUNT, never a made-up number");
  assert.equal(pt.median, pt.low);
  assert.equal(new Set(out.rows.map((r) => r.area)).size, out.rows.length, "one row per place");
  assert.ok(out.rows.length >= 2);
});

test("pt-ine-rents: harvestRows refuses a reply with no national figure or no rows", () => {
  const reply = parseIne(F.FIVE_PLACES);
  assert.throws(() => harvestRows({ ...reply, rows: reply.rows.filter((r) => r.geo !== "PT") }), SourceError);
  assert.throws(() => harvestRows({ ...reply, rows: [] }), SourceError);
});

const INE_BAD_CODE = [{ Sucesso: { Falso: [{ IndicadorCod: "0014696", Msg: "(EN) Code(s) in Dim1 not valid for the indicator.", Cod: "4" }] } }];

test("pt-ine-rents: ptHarvest skips quarters INE does not hold yet, then reads every group for the newest one", async () => {
  const urls: string[] = [];
  const fetcher = async (url: string) => {
    urls.push(url);
    return url.includes("Dim1=S5A20262") ? F.FIVE_PLACES : INE_BAD_CODE;
  };
  const out = await ptHarvest({ fetcher, now: new Date("2026-10-23T00:00:00Z") });
  assert.ok(urls[0].includes("Dim1=S5A20264") && urls[1].includes("Dim1=S5A20263") && urls[2].includes("Dim1=S5A20262"));
  assert.equal(urls.length, 3 + chunkCodes(PT_PLACES.map((p) => p.code)).length);
  assert.equal(out.date, windowOf({ year: 2026, quarter: 2 }).to);
  assert.ok(out.rows.some((r) => r.area === "PT"));
});

test("pt-ine-rents: ptHarvest fails loudly when INE holds none of the last four quarters, and on a network error", async () => {
  await assert.rejects(ptHarvest({ fetcher: async () => INE_BAD_CODE, now: new Date("2026-10-23T00:00:00Z") }), SourceError);
  await assert.rejects(ptHarvest({ fetcher: async () => { throw new Error("socket hang up"); }, now: new Date("2026-10-23T00:00:00Z") }), /socket hang up/);
});

test("pt-ine-rents: ptHarvest reports a dropped connection as that, not as 'no rent medians for the last four quarters'", async () => {
  const urls: string[] = [];
  const fetcher = async (url: string) => { urls.push(url); throw new SourceError("Could not reach the official source", "UND_ERR_CONNECT_TIMEOUT"); };
  await assert.rejects(ptHarvest({ fetcher, now: new Date("2026-10-23T00:00:00Z") }), /Could not reach the official source/);
  assert.equal(urls.length, 1, "stops at the first failure instead of trying older quarters");
});

test("pt-ine-rents: historyKey maps the request to INE's place code; a type/bedroom split or postcode-only request has no copy", () => {
  assert.deepEqual(ptHistoryKey({ town: "Porto" }), { area: place("Porto").code, item: HARVEST_ITEM, label: "Porto" });
  assert.deepEqual(ptHistoryKey({}), { area: "PT", item: HARVEST_ITEM, label: "Portugal" });
  assert.equal(ptHistoryKey({ town: "Porto", property_type: "apartment" }), null);
  assert.equal(ptHistoryKey({ town: "Porto", bedrooms: 2 }), null);
  assert.equal(ptHistoryKey({ postcode: "1000-001" }), null);
  assert.equal(ptHistoryKey({ town: "Nowhereville" }), null);
});

test("pt-ine-rents: manifest collects daily with reference dates and no record count", () => {
  const s = SOURCE_PLUGINS.find((x) => x.info.id === "pt-ine-rents")!;
  assert.equal(typeof s.harvest, "function");
  assert.equal(s.referenceDates, true);
  assert.equal(s.nominalCounts, true);
});

test("pt-ine-rents: the live request is tried twice when INE drops the first connection", async () => {
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    if (calls === 1) throw Object.assign(new TypeError("fetch failed"), { cause: { code: "UND_ERR_CONNECT_TIMEOUT" } });
    return new Response(JSON.stringify(F.LISBOA_PT_HISTORY), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const a = await ptRents({ town: "Lisboa" }, { now: NOW });
    assert.equal(calls, 2);
    assert.equal(a.status, "ok");
  } finally {
    globalThis.fetch = real;
  }
});

test("pt-ine-rents: a source that fails twice still ends in the source error (the library copy takes over in runCategory)", async () => {
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    throw new TypeError("fetch failed");
  }) as typeof fetch;
  try {
    await assert.rejects(() => ptRents({ town: "Porto" }, { now: NOW }), SourceError);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = real;
  }
});
