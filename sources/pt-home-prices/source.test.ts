import { test } from "node:test";
import assert from "node:assert/strict";
import { InputError, SourceError } from "../../lib/http";
import { SOURCE_PLUGINS, countriesFor, categoryById, paramSchemas } from "../../lib/registry";
import { HARVEST_ITEM, INFO, apiUrl, coverageText, findPlace, foldName, harvestRows, harvestUrl, parseIne, ptAnswer, ptHarvest, ptHistoryKey, ptHomePrices, readPt, windowOf } from "./source";
import type { IneReply } from "./source";
import { PT_PLACES } from "./places";
import * as F from "./fixtures";

// Fixtures: real INE API responses captured 2026-10-14 (see fixtures.ts).
const NOW = new Date("2026-10-14T12:00:00Z");
const place = (name: string) => PT_PLACES.find((p) => p.name === name)!;
const LISBOA = place("Lisboa");

/** What one request returns, built from the real pieces: Lisboa's history plus the three-quarter pull with Portugal and the bedroom classes. */
function lisboaReply(): IneReply {
  const history = parseIne(F.LISBOA_HISTORY);
  const pull = parseIne(F.LISBOA_PT_THREE_QUARTERS);
  return { ...pull, rows: [...history.rows, ...pull.rows] };
}

function fake(responses: unknown[]) {
  const urls: string[] = [];
  let i = 0;
  return { urls, fetcher: async (url: string) => (urls.push(url), responses[i++]) };
}

test("pt-home-prices: licence, attribution and type are INE's", () => {
  assert.equal(INFO.id, "pt-home-prices");
  assert.equal(INFO.price_type, "official_statistic");
  assert.match(INFO.publisher, /Statistics Portugal/);
  assert.match(INFO.licence, /Creative Commons CC BY Attribuition 4\.0 license provided that the source is acknowledged/);
  assert.match(INFO.licence, /Users may download or copy documents for personal or commercial use/);
  assert.match(INFO.licence, /Should the user modify the original data, it must be explicitly mentioned/);
  assert.equal(INFO.licence_url, "https://www.ine.pt/xportal/xmain?xpid=INE&xpgid=ine_cont_inst&INST=3585857");
  for (const k of ["Instituto Nacional de Estatística", "0012241", "CC BY 4.0", "calculated by ProofPrice"]) assert.ok(INFO.attribution.includes(k), k);
  assert.match(INFO.limits, /not a price per home/);
});

test("pt-home-prices: registered as the PT source of the home-sales tool, Lisboa first", () => {
  const plugin = SOURCE_PLUGINS.find((s) => s.info.id === "pt-home-prices")!;
  assert.equal(plugin.category, "home-sales");
  assert.deepEqual(plugin.countries, ["PT"]);
  assert.equal(plugin.status, "live");
  assert.deepEqual(plugin.examples[0].params, { country: "PT", town: "Lisboa" });
  assert.ok(countriesFor("home-sales").includes("PT"));
  assert.match(String(paramSchemas(categoryById("home-sales")!).town.description), /PT: a municipality INE publishes/);
});

test("pt-home-prices: the place table is INE's own (codes and levels)", () => {
  assert.equal(PT_PLACES.length, 97);
  assert.deepEqual(place("Lisboa"), { code: "1A01106", name: "Lisboa", level: "municipality" });
  assert.deepEqual(place("Portugal"), { code: "PT", name: "Portugal", level: "country" });
  assert.equal(PT_PLACES.filter((p) => p.level === "municipality").length, 58);
  // The six codes of the real six-place pull resolve to the names INE printed for them.
  for (const r of parseIne(F.SIX_PLACES_Q1_2026).rows) {
    const p = PT_PLACES.find((x) => x.code === r.geo)!;
    assert.ok(p, r.geo);
    assert.equal(p.name, r.geoName);
  }
});

test("pt-home-prices: place names fold accents and map English spellings", () => {
  assert.equal(foldName("  São João da Madeira "), "sao joao da madeira");
  assert.equal(foldName("Sant'Ana"), "santana");
  const name = (s: string) => {
    const f = findPlace(s);
    return f.kind === "found" ? f.place.name : f.kind;
  };
  for (const n of ["Lisboa", "Lisbon", "lisbon", "LISBOA", "Lisboa, Portugal", "Municipality of Lisbon", "Lisboa (Portugal)"]) assert.equal(name(n), "Lisboa", n);
  for (const n of ["Porto", "Oporto", "oporto"]) assert.equal(name(n), "Porto", n);
  assert.equal(name("Setubal"), "Setúbal");
  assert.equal(name("Gaia"), "Vila Nova de Gaia");
  assert.equal(name("S. João da Madeira"), "São João da Madeira");
  assert.equal(name("Madeira"), "Região Autónoma da Madeira");
  assert.equal(name("Azores"), "Região Autónoma dos Açores");
  assert.equal(name("Açores"), "Região Autónoma dos Açores");
  assert.equal(name("Algarve"), "Algarve");
  assert.equal(name("Greater Lisbon"), "Grande Lisboa");
  for (const n of ["Portugal", "national", "PT"]) assert.equal(name(n), "Portugal", n);
  // Where two levels share a name the finer one is used: the Algarve is both a NUTS II and a NUTS III region.
  const algarve = findPlace("Algarve");
  assert.ok(algarve.kind === "found" && algarve.place.level === "nuts3" && algarve.place.code === "150");
});

test("pt-home-prices: a name that is only the start of another is suggested, never answered", () => {
  const vr = findPlace("Vila Real");
  assert.equal(vr.kind, "similar");
  assert.ok(vr.kind === "similar" && vr.options.some((p) => p.name === "Vila Real de Santo António"));
  const vn = findPlace("Vila Nova");
  assert.ok(vn.kind === "similar" && vn.options.map((p) => p.name).join("|") === "Vila Nova de Famalicão|Vila Nova de Gaia");
  assert.equal(findPlace("Évora").kind, "none");
  assert.equal(findPlace("Ponta Delgada").kind, "none");
  assert.equal(findPlace("x").kind, "none");
  assert.equal(findPlace("   ").kind, "none");
});

test("pt-home-prices: the request asks for every quarter, the place and Portugal, never a period code", () => {
  assert.equal(
    apiUrl(LISBOA),
    "https://www.ine.pt/ine/json_indicador/pindica.jsp?op=2&varcd=0012241&Dim1=T&Dim2=1A01106,PT&Dim3=T,1,2,3,4&lang=EN",
  );
  assert.equal(apiUrl(place("Portugal")), "https://www.ine.pt/ine/json_indicador/pindica.jsp?op=2&varcd=0012241&Dim1=T&Dim2=PT&Dim3=T,1,2,3,4&lang=EN");
});

test("pt-home-prices: parseIne reads the real reply (labels to quarters, text numbers to numbers)", () => {
  const r = parseIne(F.LISBOA_PT_THREE_QUARTERS);
  assert.equal(r.latestLabel, "1st Quarter 2026");
  assert.equal(r.updated, "2026-07-17");
  assert.equal(r.rows.length, 30); // 3 quarters x 2 places x 5 typologies
  const lisboaQ1 = r.rows.find((x) => x.geo === "1A01106" && x.typology === "T" && x.year === 2026)!;
  assert.deepEqual([lisboaQ1.quarter, lisboaQ1.value, lisboaQ1.geoName, lisboaQ1.typologyName], [1, 5082, "Lisboa", "Total"]);
  const pt = r.rows.find((x) => x.geo === "PT" && x.typology === "T" && x.year === 2026)!;
  assert.equal(pt.value, 2168); // "2 168" is printed with a space; the valor field has none
  assert.equal(parseIne(F.LISBOA_HISTORY).rows.length, 26);
});

test("pt-home-prices: an INE error message is a SourceError carrying INE's words; a non-reply is too", () => {
  assert.throws(() => parseIne(F.INVALID_PERIOD), (e: any) => e instanceof SourceError && /Code\(s\) in Dim1 not valid for the indicator/.test(e.message));
  assert.throws(() => parseIne({}), SourceError);
  assert.throws(() => parseIne(null), SourceError);
  assert.throws(() => parseIne([{ IndicadorCod: "0012241" }]), /no data/);
});

test("pt-home-prices: rows without a usable number are dropped", () => {
  const r = parseIne([
    {
      UltimoPref: "1st Quarter 2026",
      Dados: {
        "1st Quarter 2026": [
          { geocod: "A", geodsg: "A", dim_3: "T", dim_3_t: "Total", valor: "" },
          { geocod: "B", geodsg: "B", dim_3: "T", dim_3_t: "Total", valor: "x" },
          { geocod: "C", geodsg: "C", dim_3: "T", dim_3_t: "Total", valor: "0" },
          { geocod: "D", geodsg: "D", dim_3: "T", dim_3_t: "Total", valor: "1234" },
        ],
        "Annual 2026": [{ geocod: "E", geodsg: "E", dim_3: "T", dim_3_t: "Total", valor: "999" }],
      },
    },
  ]);
  assert.deepEqual(r.rows.map((x) => x.geo), ["D"]);
});

test("pt-home-prices: reads Lisboa from the real response (latest quarter, changes, national, bedrooms)", () => {
  const r = readPt(lisboaReply(), LISBOA)!;
  assert.equal(r.label, "1st Quarter 2026");
  assert.equal(r.value, 5082);
  assert.deepEqual(r.previousQuarter, { year: 2025, quarter: 4, value: 4875, change_percent: 4.2 });
  assert.deepEqual(r.yearEarlier, { year: 2025, quarter: 1, value: 4412, change_percent: 15.2 });
  assert.deepEqual(r.national, { year: 2026, quarter: 1, value: 2168, difference_percent: 134.4 });
  assert.deepEqual(r.bedrooms.map((b) => [b.name, b.value]), [
    ["0 or 1 bedroom", 5826],
    ["2 bedrooms", 5102],
    ["3 bedrooms", 4750],
    ["4 or more bedrooms", 4554],
  ]);
  assert.equal(r.series.length, 12);
  assert.deepEqual(r.series[r.series.length - 1], { year: 2026, quarter: 1, value: 5082 });
  assert.deepEqual(r.series[0], { year: 2023, quarter: 2, value: 4080 });
  assert.equal(readPt(lisboaReply(), place("Faro")), null); // no row for Faro in this reply
});

test("pt-home-prices: Portugal itself has no national comparison", () => {
  const pull = parseIne(F.LISBOA_PT_THREE_QUARTERS);
  const r = readPt(pull, place("Portugal"))!;
  assert.equal(r.value, 2168);
  assert.equal(r.national, null);
  assert.deepEqual(r.yearEarlier, { year: 2025, quarter: 1, value: 1845, change_percent: 17.5 });
});

test("pt-home-prices: the 12 months a quarter covers", () => {
  assert.deepEqual(windowOf({ year: 2026, quarter: 1 }), { from: "2025-04-01", to: "2026-03-31" });
  assert.deepEqual(windowOf({ year: 2025, quarter: 4 }), { from: "2025-01-01", to: "2025-12-31" });
  assert.deepEqual(windowOf({ year: 2025, quarter: 2 }), { from: "2024-07-01", to: "2025-06-30" });
});

test("pt-home-prices: the full answer for Lisboa", () => {
  const a = ptAnswer(readPt(lisboaReply(), LISBOA), { place: "Lisbon", property_type: "any", now: NOW });
  assert.equal(a.status, "ok");
  assert.deepEqual(a.query, { country: "PT", town: "Lisboa", property_type: "any" });
  assert.equal(a.price_type, "official_statistic");
  assert.deepEqual(a.price, { currency: "EUR", unit: "per m²", value: 5082, measure: "median", median: 5082, typical_low: null, typical_high: null, min: null, max: null });
  assert.equal(a.sample_size, null);
  assert.deepEqual(a.period, { from: "2025-04-01", to: "2026-03-31" });
  assert.deepEqual(a.statistic, { measure: "median", reference_period: "2026-Q1" });
  assert.equal(
    a.summary,
    "In Lisboa the median sale price of dwellings sold in the 12 months to March 2026 was €5,082 per m². " +
      "That is 15.2% higher than a year earlier (2025-Q1: €4,412 per m²). That is 4.2% higher than the previous quarter (2025-Q4: €4,875 per m²). " +
      "The national median for the same period was €2,168 per m² (134.4% above). Official median published by Statistics Portugal (Instituto Nacional de Estatística, INE) for 2026-Q1.",
  );
  assert.equal(a.source.licence_url, INFO.licence_url);
  const x = a.extra as any;
  assert.deepEqual(x.region, { code: "1A01106", name: "Lisboa", level: "municipality" });
  assert.equal(x.reference_period_label, "1st Quarter 2026");
  assert.equal(x.published, "2026-07-17");
  assert.equal(x.by_bedrooms.length, 4);
  assert.equal(x.series.length, 12);
  assert.equal(x.window, "the 12 months to the end of March 2026");
  assert.equal(a.statistic?.note, undefined); // fresh figure, nothing to flag
});

test("pt-home-prices: a region is named with its level; Portugal as a whole reads 'Portugal'", () => {
  const found = findPlace("Algarve");
  const algarve = found.kind === "found" ? found.place : place("Algarve");
  const reply: IneReply = {
    rows: [
      { year: 2026, quarter: 1, label: "1st Quarter 2026", geo: "150", geoName: "Algarve", typology: "T", typologyName: "Total", value: 3000 },
      { year: 2026, quarter: 1, label: "1st Quarter 2026", geo: "PT", geoName: "Portugal", typology: "T", typologyName: "Total", value: 2168 },
    ],
    latestLabel: "1st Quarter 2026",
    updated: "2026-07-17",
  };
  const a = ptAnswer(readPt(reply, algarve), { place: "Algarve", property_type: "any", now: NOW });
  assert.match(a.summary, /^In Algarve \(NUTS III sub-region\) the median sale price/);
  const n = ptAnswer(readPt(reply, place("Portugal")), { place: null, property_type: "any", now: NOW });
  assert.match(n.summary, /^In Portugal the median sale price/);
  assert.deepEqual(n.query, { country: "PT", town: "Portugal", property_type: "any" });
});

test("pt-home-prices: an out-of-date figure, or one behind the national one, is flagged in plain words", () => {
  const old = ptAnswer(readPt(lisboaReply(), LISBOA), { place: "Lisboa", property_type: "any", now: new Date("2027-03-01T12:00:00Z") });
  assert.match(old.statistic!.note!, /more than ten months ago/);
  const behind = lisboaReply();
  behind.rows = behind.rows.filter((r) => !(r.geo === "1A01106" && r.year === 2026));
  const a = ptAnswer(readPt(behind, LISBOA), { place: "Lisboa", property_type: "any", now: NOW });
  assert.match(a.statistic!.note!, /latest figure INE holds for Lisboa is for 4th Quarter 2025; the national figure runs to 2026-Q1/);
  assert.equal(a.statistic!.reference_period, "2025-Q4");
});

test("pt-home-prices: no reading means no_matches, with what INE does cover, never a made-up number", () => {
  const a = ptAnswer(null, { place: "Évora", property_type: "any" });
  assert.equal(a.status, "no_matches");
  assert.equal(a.price, null);
  assert.match(a.summary, /INE publishes no median price per m² for Évora/);
  assert.match(a.summary, /58 municipalities/);
  assert.match(coverageText(), /Lisboa, Porto/);
  const b = ptAnswer(null, { place: "Vila Real", property_type: "any", similar: [place("Vila Real de Santo António")] });
  assert.match(b.summary, /Did you mean Vila Real de Santo António \(municipality\)\?/);
});

test("pt-home-prices: a request is one INE call; an unknown place makes none", async () => {
  const f = fake([F.LISBOA_HISTORY]);
  // The history fixture alone has no national or bedroom rows; the answer still works from the place's own total.
  const a = await ptHomePrices({ town: "Lisbon" }, { fetcher: f.fetcher, now: NOW });
  assert.equal(f.urls.length, 1);
  assert.equal(f.urls[0], apiUrl(LISBOA));
  assert.equal(a.status, "ok");
  assert.equal(a.price!.value, 5082);
  assert.equal((a.extra as any).national_median, null);
  assert.equal((a.extra as any).ine_api_url, f.urls[0]);

  const g = fake([]);
  const none = await ptHomePrices({ town: "Évora" }, { fetcher: g.fetcher, now: NOW });
  assert.equal(none.status, "no_matches");
  assert.equal(g.urls.length, 0);

  const h = fake([F.LISBOA_PT_THREE_QUARTERS]);
  const nat = await ptHomePrices({}, { fetcher: h.fetcher, now: NOW });
  assert.match(h.urls[0], /Dim2=PT&/);
  assert.equal(nat.price!.value, 2168);
  assert.deepEqual(nat.query, { country: "PT", town: "Portugal", property_type: "any" });
});

test("pt-home-prices: an INE error reaches the caller as a source error", async () => {
  const f = fake([F.INVALID_PERIOD]);
  await assert.rejects(ptHomePrices({ town: "Lisboa" }, { fetcher: f.fetcher, now: NOW }), SourceError);
});

test("pt-home-prices: a home type INE does not publish gets no_matches, not the all-dwellings figure", async () => {
  const f = fake([]);
  const a = await ptHomePrices({ town: "Porto", property_type: "apartment" }, { fetcher: f.fetcher, now: NOW });
  assert.equal(a.status, "no_matches");
  assert.equal(a.price, null);
  assert.deepEqual(a.query, { country: "PT", town: "Porto", property_type: "apartment" });
  assert.match(a.summary, /not by house or apartment/);
  assert.equal(f.urls.length, 0);
});

test("pt-home-prices: a postcode alone is refused with the reason", async () => {
  await assert.rejects(ptHomePrices({ postcode: "1000-001" }, { fetcher: fake([]).fetcher }), (e: any) => e instanceof InputError && /not by postcode/.test(e.message));
});

// ---------- stale-if-error copy (harvest) ----------

test("pt-home-prices: harvest url asks for every place in ONE request (INE rejects Dim2=T)", () => {
  const u = harvestUrl();
  assert.ok(u.includes("Dim3=T") && !u.includes("Dim2=T&"));
  for (const p of PT_PLACES) assert.ok(u.includes(p.code), p.code);
  assert.equal(u.split("pindica.jsp").length, 2);
});

test("pt-home-prices: harvestRows keeps the newest quarter of the real INE reply, dated by the quarter's end, with no made-up count", () => {
  const reply = lisboaReply();
  const out = harvestRows(reply);
  const newest = reply.rows.filter((r) => r.typology === "T").reduce((a, r) => (r.year * 4 + r.quarter > a ? r.year * 4 + r.quarter : a), 0);
  const q = ((newest - 1) % 4) + 1;
  const y = Math.floor((newest - 1) / 4);
  assert.equal(out.date, windowOf({ year: y, quarter: q }).to);
  assert.equal(out.currency, "EUR");
  assert.equal(out.unit, "per m²");
  const lis = out.rows.find((r) => r.area === LISBOA.code);
  const pt = out.rows.find((r) => r.area === "PT");
  assert.ok(lis && pt);
  assert.equal(lis.item, HARVEST_ITEM);
  assert.ok(Number.isNaN(lis.n), "n must be NO_COUNT, never a made-up number");
  assert.equal(lis.median, lis.low);
  const want = reply.rows.find((r) => r.geo === LISBOA.code && r.typology === "T" && r.year === y && r.quarter === q)!;
  assert.equal(lis.median, Math.round(want.value));
  assert.equal(new Set(out.rows.map((r) => r.area)).size, out.rows.length, "one row per place");
});

test("pt-home-prices: harvestRows refuses a reply with no national figure", () => {
  const reply = lisboaReply();
  assert.throws(() => harvestRows({ ...reply, rows: reply.rows.filter((r) => r.geo !== "PT") }), SourceError);
  assert.throws(() => harvestRows({ ...reply, rows: [] }), SourceError);
});

test("pt-home-prices: ptHarvest uses the one-request URL", async () => {
  const f = fake([F.LISBOA_PT_THREE_QUARTERS]);
  const out = await ptHarvest({ fetcher: f.fetcher });
  assert.equal(f.urls.length, 1);
  assert.equal(f.urls[0], harvestUrl());
  assert.ok(out.rows.length >= 1);
});

test("pt-home-prices: historyKey maps the request to INE's place code; a type split or postcode-only request has no copy", () => {
  assert.deepEqual(ptHistoryKey({ town: "Lisbon" }), { area: LISBOA.code, item: HARVEST_ITEM, label: "Lisboa" });
  assert.deepEqual(ptHistoryKey({}), { area: "PT", item: HARVEST_ITEM, label: "Portugal" });
  assert.equal(ptHistoryKey({ town: "Lisboa", property_type: "apartment" }), null);
  assert.equal(ptHistoryKey({ postcode: "1000-001" }), null);
  assert.equal(ptHistoryKey({ town: "Nowhereville" }), null);
});

test("pt-home-prices: manifest collects daily with reference dates and no record count", () => {
  const s = SOURCE_PLUGINS.find((x) => x.info.id === "pt-home-prices")!;
  assert.equal(typeof s.harvest, "function");
  assert.equal(s.referenceDates, true);
  assert.equal(s.nominalCounts, true);
  assert.deepEqual(s.historyKey!({ town: "Porto" }), { area: place("Porto").code, item: HARVEST_ITEM, label: "Porto" });
});
