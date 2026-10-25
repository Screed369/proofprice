import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildQuery, findPlace, harvestOptions, INFO, parseMonths, placeRows, queryUrl, ukHpiHarvest, ukHpiHistoryKey, ukhpiAnswer } from "./source";
import { SCOTLAND_JSON } from "./fixtures";
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
      harvestOptions.retryDelayMs = 2000;
    }
  });
  it("fails loudly when most places do not answer", async () => {
    const original = globalThis.fetch;
    harvestOptions.retryDelayMs = 0;
    globalThis.fetch = (async () => new Response("down", { status: 503 })) as any;
    try {
      await assert.rejects(ukHpiHarvest());
    } finally {
      globalThis.fetch = original;
      harvestOptions.retryDelayMs = 2000;
    }
  });
});
