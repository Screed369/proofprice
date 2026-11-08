import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildQuery, findPlace, harvestOptions, INFO, liveOptions, ukHpi, parseMonths, parseRestMonths, placeRows, queryUrl, restUrl, ukHpiHarvest, ukHpiHistoryKey, ukhpiAnswer } from "./source";
import { NI_REST_JSON, SCOTLAND_JSON } from "./fixtures";
import source from "./index";

describe("gb-ukhpi places", () => {
  it("knows Scottish and Northern Irish places and their usual names", () => {
    assert.equal(findPlace("Edinburgh")?.slug, "city-of-edinburgh");
    assert.equal(findPlace("City of Glasgow")?.slug, "city-of-glasgow");
    assert.equal(findPlace("belfast")?.slug, "belfast");
    assert.equal(findPlace("Londonderry")?.slug, "derry-and-strabane");
    assert.equal(findPlace("Lisburn and Castlereagh")?.slug, "lisburn-and-castlereagh");
    assert.equal(findPlace("Northern Ireland")?.slug, "northern-ireland");
    assert.equal(findPlace("Edinburgh, Scotland")?.slug, "city-of-edinburgh");
    assert.equal(findPlace("Scotland")?.level, "nation");
  });
  it("leaves England and Wales to gb-hmlr-ppd", () => {
    assert.equal(findPlace("Bristol"), null);
    assert.equal(findPlace("Cardiff"), null);
    assert.equal(findPlace(undefined), null);
    assert.equal(source.serves!({ country: "GB", town: "Bristol" }), false);
    assert.equal(source.serves!({ country: "GB", town: "Edinburgh" }), true);
  });
  it("builds a query only for a plain slug", () => {
    assert.ok(String(queryUrl("scotland")).includes("landregistry.data.gov.uk/landregistry/query?output=json&query="));
    assert.ok(String(buildQuery("scotland")).includes("id/region/scotland>"));
    assert.throws(() => buildQuery("x> } #"));
  });
});

describe("gb-ukhpi answer (real response, checked 2026-10-22)", () => {
  const months = parseMonths(SCOTLAND_JSON);
  const scotland = findPlace("Scotland")!;
  it("parses 14 months newest first", () => {
    assert.equal(months.length, 14);
    assert.equal(months[0].month, "2026-07");
    assert.equal(months[0].values.a, 196349);
    assert.equal(months[0].values.af, 136950);
    assert.equal(months[0].salesVolume, null);
    assert.equal(months.find((m) => m.month === "2026-05")?.salesVolume, 8469);
  });
  it("answers as an official average with no sample size", () => {
    const a = ukhpiAnswer(scotland, "any", months);
    assert.equal(a.status, "ok");
    assert.equal(a.price?.value, 196349);
    assert.equal(a.price?.currency, "GBP");
    assert.equal(a.sample_size, null);
    assert.equal(a.source.id, "gb-ukhpi");
    assert.equal(a.price_type, "official_statistic");
    assert.deepEqual(Object.fromEntries(Object.keys({ from: "2026-07-01", to: "2026-07-31" }).map((k) => [k, (a.period as any)[k]])), { from: "2026-07-01", to: "2026-07-31" });
    assert.ok(String(a.summary).includes("Scotland"));
    assert.deepEqual(Object.fromEntries(Object.keys({ month: "2026-05", sales: 8469 }).map((k) => [k, ((a.extra as any).sales_volume as any)[k]])), { month: "2026-05", sales: 8469 });
    assert.notEqual((a.extra as any).change_on_year_percent, null);
  });
  it("picks the property type's own figure", () => {
    const a = ukhpiAnswer(scotland, "flat-maisonette", months);
    assert.equal(a.price?.value, 136950);
    const d = ukhpiAnswer(scotland, "detached", months);
    assert.equal(d.price?.value, 362765);
  });
  it("says so when there is nothing", () => {
    const a = ukhpiAnswer(scotland, "terraced", months.map((m) => ({ ...m, values: { ...m.values, at: null } })));
    assert.equal(a.status, "no_matches");
    assert.equal(a.price, null);
  });
  it("rejects a response that is not SPARQL JSON", () => {
    assert.throws(() => parseMonths({ nope: 1 }));
  });
  it("carries the Open Government Licence", () => {
    assert.ok(String(INFO.licence).includes("Open Government Licence v3.0"));
  });
});

describe("gb-ukhpi collector and library key", () => {
  const months = parseMonths(SCOTLAND_JSON);
  const scotland = findPlace("Scotland")!;
  it("stores one row per property type for the chosen month, as a published figure (no count)", () => {
    const rows = placeRows(scotland, months, "2026-07");
    assert.equal(rows.length, 5);
    const any = rows.find((r) => r.item === "any")!;
    assert.equal(any.area, "scotland");
    assert.equal(any.median, 196349);
    assert.equal(any.low, 196349);
    assert.ok(Number.isNaN(any.n));
    assert.equal(rows.find((r) => r.item === "flat-maisonette")!.median, 136950);
    assert.deepEqual(placeRows(scotland, months, "2030-01"), []);
  });
  it("keys a request to the place slug and property type, and refuses a request with no Scottish or NI place", () => {
    assert.deepEqual(ukHpiHistoryKey({ town: "Edinburgh", property_type: "flat-maisonette" }), { area: "city-of-edinburgh", item: "flat-maisonette", label: "City of Edinburgh (flats and maisonettes)" });
    assert.equal(ukHpiHistoryKey({ town: "Belfast" })?.item, "any");
    assert.equal(ukHpiHistoryKey({ town: "Bristol" }), null);
    assert.equal(ukHpiHistoryKey({}), null);
    assert.equal(ukHpiHistoryKey({ town: "Belfast", property_type: "castle" }), null);
    const key = source.historyKey!({ country: "GB", town: "Glasgow" });
    assert.equal(key?.item, "any");
  });
  it("harvests every place from the real response shape", async () => {
    const original = globalThis.fetch;
    harvestOptions.retryDelayMs = 0;
    harvestOptions.pauseMs = 0;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response(JSON.stringify(SCOTLAND_JSON), { status: 200, headers: { "content-type": "application/json" } });
    }) as any;
    try {
      const r = await ukHpiHarvest();
      assert.equal(r.date, "2026-07-31");
      assert.equal(r.currency, "GBP");
      assert.equal(r.unit, "per home");
      assert.equal(calls, 45);
      assert.equal(r.rows.length, 45 * 5);
    } finally {
      globalThis.fetch = original;
      harvestOptions.retryDelayMs = 3000;
      harvestOptions.pauseMs = 400;
    }
  });
  it("sends an identified client name (the Land Registry nginx 403s the generic one)", async () => {
    const original = globalThis.fetch;
    let ua = "";
    globalThis.fetch = (async (_u: any, init: any) => {
      ua = String(init?.headers?.["user-agent"] ?? "");
      return new Response(JSON.stringify(SCOTLAND_JSON), { status: 200, headers: { "content-type": "application/json" } });
    }) as any;
    try {
      await ukHpi({ town: "Scotland" });
      assert.match(ua, /^ProofPrice-collector\/1\.0 \(\+https:\/\/proofprice\.com/);
    } finally {
      globalThis.fetch = original;
    }
  });
  it("fails loudly when most places do not answer", async () => {
    const original = globalThis.fetch;
    harvestOptions.retryDelayMs = 0;
    harvestOptions.pauseMs = 0;
    globalThis.fetch = (async () => new Response("down", { status: 503 })) as any;
    try {
      await assert.rejects(ukHpiHarvest(), /first error: Source returned HTTP 503/);
    } finally {
      globalThis.fetch = original;
      harvestOptions.retryDelayMs = 3000;
      harvestOptions.pauseMs = 400;
    }
  });
  it("live call falls back to the REST JSON of the same publisher when SPARQL fails", async () => {
    const original = globalThis.fetch;
    liveOptions.pauseMs = 0;
    const urls: string[] = [];
    globalThis.fetch = (async (u: any) => {
      urls.push(String(u));
      if (String(u).includes("/landregistry/query")) return new Response("busy", { status: 503 });
      return new Response(JSON.stringify(NI_REST_JSON), { status: 200, headers: { "content-type": "application/json" } });
    }) as any;
    try {
      const a = await ukHpi({ town: "Northern Ireland" });
      assert.equal(urls.length, 2);
      assert.match(urls[1], /\/data\/ukhpi\/region\/northern-ireland\.json/);
      assert.equal(a.status, "ok");
      assert.equal(a.price?.value, NI_REST_JSON.result.items[0].averagePrice);
    } finally {
      globalThis.fetch = original;
      liveOptions.pauseMs = 1000;
    }
  });
  it("parses the REST JSON like the SPARQL answer (newest first, per-type figures)", () => {
    const months = parseRestMonths(NI_REST_JSON);
    assert.equal(months[0].month, NI_REST_JSON.result.items[0].refMonth);
    assert.equal(months[0].values.a, NI_REST_JSON.result.items[0].averagePrice);
    assert.ok(months.length >= 13);
    assert.match(restUrl("scotland"), /region\/scotland\.json\?_sort=-refMonth/);
    assert.throws(() => parseRestMonths({}), /Unexpected answer/);
  });
  it("live call retries once after a failed first call (Edinburgh flat, smoke showed STALE while a later call was ok)", async () => {
    const original = globalThis.fetch;
    liveOptions.pauseMs = 0;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      if (calls === 1) return new Response("busy", { status: 503 });
      return new Response(JSON.stringify(SCOTLAND_JSON), { status: 200, headers: { "content-type": "application/json" } });
    }) as any;
    try {
      const a = await ukHpi({ town: "Edinburgh", property_type: "flat-maisonette" });
      assert.equal(calls, 3);
      assert.equal(a.status, "ok");
      assert.equal(a.price?.value, 136950);
    } finally {
      globalThis.fetch = original;
      liveOptions.pauseMs = 1000;
    }
  });
  it("live call still fails (so the library copy can answer) when both calls fail", async () => {
    const original = globalThis.fetch;
    liveOptions.pauseMs = 0;
    let calls = 0;
    globalThis.fetch = (async () => { calls++; return new Response("down", { status: 503 }); }) as any;
    try {
      await assert.rejects(ukHpi({ town: "Edinburgh" }), /HTTP 503/);
      assert.equal(calls, 3);
    } finally {
      globalThis.fetch = original;
      liveOptions.pauseMs = 1000;
    }
  });
});
