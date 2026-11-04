// Real format checked live on 2026-11-04 (Notion Source Pipeline, PL commercial property). fixtures/lokale-warszawa-handlowe.gml is a real
// WFS 2.0 GetFeature answer (3 retail/service premises in Warsaw, May 2026) with geometry, street, house number, deed id and notary replaced.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { INFO, monthsOf, parseSales, plCommercial, plausible, sliceUrl, slices } from "./source";
import plugin from "./index";

const GML = readFileSync(new URL("./fixtures/lokale-warszawa-handlowe.gml", import.meta.url), "utf8");

test("parseSales reads the real WFS answer: 3 retail premises, price, area, date; no address kept", () => {
  const { sales, returned } = parseSales(GML);
  assert.equal(returned, 3);
  assert.deepEqual(sales[0], { date: "2026-05-11", fn: "retail", price: 3413080, area: 197.63, msc: "warszawa" });
  assert.ok(!JSON.stringify(sales).includes("REDACTED"));
});

test("parseSales: other functions are skipped, exception and junk are errors", () => {
  assert.equal(parseSales(GML.replace(/handlowoUslugowa/g, "mieszkalna")).sales.length, 0);
  assert.throws(() => parseSales("<ows:ExceptionReport><ows:ExceptionText>bad</ows:ExceptionText></ows:ExceptionReport>"), /returned an error/);
  assert.throws(() => parseSales("<html/>"), /unexpected format/);
});

test("plausible drops tiny areas and absurd prices per m2", () => {
  assert.equal(plausible({ date: "d", fn: "retail", price: 3000000, area: 150, msc: "" }), true);
  assert.equal(plausible({ date: "d", fn: "retail", price: 100, area: 150, msc: "" }), false);
  assert.equal(plausible({ date: "d", fn: "retail", price: 3000000, area: 5, msc: "" }), false);
  assert.equal(plausible({ date: "d", fn: "office", price: 90000000, area: 100, msc: "" }), false);
});

test("slices and request url: 90-day slices, filter fields, both functions", () => {
  const s = slices("2026-11-04", 12);
  assert.equal(s.length, 4);
  assert.equal(s[0].to, "2026-11-05");
  assert.equal(s[0].from, "2026-08-07");
  assert.equal(slices("2026-11-04", 1).length, 1);
  const u = decodeURIComponent(sliceUrl("1465", "2026-01-01", "2026-04-01"));
  assert.match(u, /count=300/);
  assert.match(u, /<fes:Literal>1465</);
  assert.match(u, /handlowoUslugowa/);
  assert.match(u, /biurowa/);
  assert.match(u, /wolnyRynek/);
  assert.equal(monthsOf(undefined), 12);
  assert.equal(monthsOf(99), 24);
});

function member(price: number, area: number, fn = "handlowoUslugowa", msc = "Warszawa", date = "2026-05-11"): string {
  return `<wfs:member><ms:lokale><ms:TRAN_RODZAJ_TRANS>wolnyRynek</ms:TRAN_RODZAJ_TRANS><ms:DOK_DATA gml:id="x"><gml:timePosition>${date}</gml:timePosition></ms:DOK_DATA>` +
    `<ms:LOK_FUNKCJA>${fn}</ms:LOK_FUNKCJA><ms:LOK_POW_UZYT>${area}</ms:LOK_POW_UZYT><ms:LOK_CENA_BRUTTO>${price}</ms:LOK_CENA_BRUTTO><ms:LOK_ADRES>MSC:${msc};UL:x;NR_PORZ:1</ms:LOK_ADRES></ms:lokale></wfs:member>`;
}
const wrap = (m: string) => `<wfs:FeatureCollection>${m}</wfs:FeatureCollection>`;
const twelve = wrap(Array.from({ length: 12 }, (_, i) => member(1_000_000 + i * 100_000, 100, i < 8 ? "handlowoUslugowa" : "biurowa")).join(""));

test("plCommercial: 12 premises give a median per m2, by-function split and period ending at the newest sale", async () => {
  const a = await plCommercial({ town: "Warsaw", months: 3, today: "2026-11-04", fetchGml: async () => twelve });
  assert.equal(a.status, "ok");
  assert.equal(a.sample_size, 12);
  assert.equal(a.price?.unit, "per m²");
  assert.equal(a.price?.median, 15500);
  assert.equal((a.extra as any).by_function.retail.sample_size, 8);
  assert.equal((a.extra as any).by_function.office, undefined); // only 4 office sales
  assert.equal(a.period.to, "2026-05-11");
  assert.equal(a.source.id, INFO.id);
});

test("plCommercial: fewer than 5 sales gives no price; wrong city, plots, postcode and unknown city are refused", async () => {
  const few = wrap([member(1_000_000, 100), member(1_100_000, 100)].join(""));
  const a = await plCommercial({ town: "Warszawa", months: 3, today: "2026-11-04", fetchGml: async () => few });
  assert.notEqual(a.status, "ok");
  assert.equal(a.price, null);
  await assert.rejects(() => plCommercial({ town: "Warszawa", fetchGml: async () => wrap(member(1_000_000, 100, "biurowa", "Krakow")) }), /different city/);
  await assert.rejects(() => plCommercial({ town: "Warszawa", property_type: "land" }), /plots/);
  await assert.rejects(() => plCommercial({ town: "Warszawa", postcode: "00-001" }), /postcode/);
  await assert.rejects(() => plCommercial({ town: "Zakopane" }), /city from this list/);
  await assert.rejects(() => plCommercial({}), /Give a city/);
});

test("manifest: category, country, example, serves", () => {
  assert.equal(plugin.category, "commercial-property");
  assert.deepEqual(plugin.countries, ["PL"]);
  assert.equal(plugin.serves?.({ town: "Warszawa" } as any), true);
  assert.equal(plugin.serves?.({} as any), false);
});
