import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildQuery, findPlace, INFO, parseMonths, queryUrl, ukhpiAnswer } from "./source";
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
