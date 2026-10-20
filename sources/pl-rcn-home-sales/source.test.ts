// Real format checked live on 2026-10-20 from GitHub's servers (Notion Source Pipeline, PL home sales). fixtures/lokale-warszawa.gml is a real
// WFS 2.0 GetFeature answer (3 flat sales in Warsaw, July 2026) with street, house number, deed ids and the notary's name replaced.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { INFO, PLACES, findPlace, monthsOf, normaliseName, parseSales, plHomeSales, plausible, sliceUrl, slices } from "./source";
import plugin from "./index";

const GML = readFileSync(new URL("./fixtures/lokale-warszawa.gml", import.meta.url), "utf8");

test("parseSales reads the real WFS answer: 3 flats, market, price, area, city; no address kept", () => {
  const { sales, returned } = parseSales(GML);
  assert.equal(returned, 3);
  assert.equal(sales.length, 3);
  assert.deepEqual(sales[0], { date: "2026-07-03", market: "secondary", price: 800000, area: 63.21, msc: "warszawa" });
  assert.equal(sales[1].market, "primary");
  assert.equal(sales[1].price, 4400000);
  assert.ok(!JSON.stringify(sales).includes("REDACTED"));
});

test("parseSales: an OGC exception report is a source error, junk is a format error", () => {
  assert.throws(() => parseSales("<ows:ExceptionReport><ows:Exception><ows:ExceptionText>bad filter</ows:ExceptionText></ows:Exception></ows:ExceptionReport>"), /returned an error/);
  assert.throws(() => parseSales("<html>hello</html>"), /unexpected format/);
});

test("plausible drops tiny areas and absurd prices per m2", () => {
  assert.equal(plausible({ date: "d", market: "primary", price: 600000, area: 50, msc: "" }), true);
  assert.equal(plausible({ date: "d", market: "primary", price: 10000, area: 50, msc: "" }), false); // 200 PLN/m2
  assert.equal(plausible({ date: "d", market: "primary", price: 600000, area: 5, msc: "" }), false);
  assert.equal(plausible({ date: "d", market: "primary", price: 9000000, area: 60, msc: "" }), false); // 150,000 PLN/m2
});

test("place names: accents, English spellings, 'Poland' suffix; unknown city is null", () => {
  assert.equal(normaliseName("Łódź"), "lodz");
  assert.equal(findPlace("Łódź")?.teryt, "1061");
  assert.equal(findPlace("Kraków, Poland")?.label, "Krakow");
  assert.equal(findPlace("Warsaw")?.teryt, "1465");
  assert.equal(findPlace("Zakopane"), null);
  assert.equal(new Set(PLACES.map((p) => p.teryt)).size, PLACES.length);
});

test("slices and request url: dates, filter fields, cap", () => {
  const s = slices("2026-10-20", 3);
  assert.equal(s.length, 3);
  assert.equal(s[0].to, "2026-10-21");
  assert.equal(s[0].from, "2026-09-21");
  assert.equal(s[2].from, "2026-07-23");
  const u = decodeURIComponent(sliceUrl("1465", "2026-07-01", "2026-07-31"));
  assert.match(u, /typeNames=ms:lokale/);
  assert.match(u, /count=300/);
  assert.match(u, /<fes:ValueReference>TERYT<\/fes:ValueReference><fes:Literal>1465</);
  assert.match(u, /LOK_FUNKCJA/);
  assert.equal(monthsOf(undefined), 3);
  assert.equal(monthsOf(99), 6);
  assert.equal(monthsOf(0), 1);
});

// 12 synthetic Warsaw flats (same layout as the real record, made-up prices) so a figure can be published.
function member(i: number, price: number, area: number, market = "rynekWtorny", msc = "Warszawa"): string {
  return `<wfs:member><ms:lokale><ms:TERYT>1465</ms:TERYT><ms:TRAN_RODZAJ_TRANS>wolnyRynek</ms:TRAN_RODZAJ_TRANS><ms:TRAN_RODZAJ_RYNKU>${market}</ms:TRAN_RODZAJ_RYNKU>` +
    `<ms:DOK_DATA gml:id="x${i}"><gml:timePosition>2026-10-0${1 + (i % 9)}</gml:timePosition></ms:DOK_DATA><ms:LOK_FUNKCJA>mieszkalna</ms:LOK_FUNKCJA>` +
    `<ms:LOK_POW_UZYT>${area}</ms:LOK_POW_UZYT><ms:LOK_CENA_BRUTTO>${price}</ms:LOK_CENA_BRUTTO><ms:LOK_ADRES>MSC:${msc};UL:x;NR_PORZ:1</ms:LOK_ADRES></ms:lokale></wfs:member>`;
}
const wrap = (members: string[]) => `<?xml version='1.0'?><wfs:FeatureCollection xmlns:wfs="w" numberReturned="${members.length}">${members.join("")}</wfs:FeatureCollection>`;

test("plHomeSales: median, range, per m2, market split, period; calls one request per slice", async () => {
  const calls: string[] = [];
  const secondary = Array.from({ length: 8 }, (_, i) => member(i, 700000 + i * 20000, 50));
  const primary = Array.from({ length: 6 }, (_, i) => member(10 + i, 900000 + i * 10000, 60, "rynekPierwotny"));
  const junk = [member(30, 1000, 50), member(31, 600000, 4)];
  const a = await plHomeSales({ town: "Warszawa", months: 1, today: "2026-10-20", fetchGml: async (u) => { calls.push(u); return wrap([...secondary, ...primary, ...junk]); } });
  assert.equal(calls.length, 1);
  assert.equal(a.status, "ok");
  assert.equal(a.sample_size, 14);
  assert.equal(a.price?.currency, "PLN");
  assert.equal(a.price?.unit, "per flat");
  assert.equal(a.price_type, "transaction");
  assert.deepEqual(a.period, { from: "2026-09-21", to: "2026-10-20" });
  const x = a.extra as any;
  assert.equal(x.records_dropped, 2);
  assert.equal(x.sampled, false);
  assert.ok(x.per_m2.median > 10000 && x.per_m2.median < 20000);
  assert.equal(x.by_market.primary.sample_size, 6);
  assert.equal(x.by_market.secondary.sample_size, 8);
  assert.ok(!JSON.stringify(a).includes("MSC:"));
});

test("plHomeSales: fewer than 5 flats gives no figure; a full slice is flagged as a sample", async () => {
  const few = await plHomeSales({ town: "Lodz", months: 1, today: "2026-10-20", fetchGml: async () => wrap([member(1, 500000, 50, "rynekWtorny", "Łódź"), member(2, 520000, 50, "rynekWtorny", "Łódź")]) });
  assert.equal(few.status, "insufficient_data");
  assert.equal(few.price, null);
  const full = await plHomeSales({ town: "Warszawa", months: 1, today: "2026-10-20", fetchGml: async () => wrap(Array.from({ length: 300 }, (_, i) => member(i, 700000 + i * 1000, 50))) });
  assert.equal((full.extra as any).sampled, true);
  assert.match(full.method, /sample of the period/);
});

test("plHomeSales: records of another city (wrong county code) are refused, not answered", async () => {
  await assert.rejects(
    plHomeSales({ town: "Krakow", months: 1, today: "2026-10-20", fetchGml: async () => wrap(Array.from({ length: 10 }, (_, i) => member(i, 700000, 50, "rynekWtorny", "Warszawa"))) }),
    /different city/,
  );
});

test("plHomeSales: input errors say what to give", async () => {
  await assert.rejects(plHomeSales({}), /Give a city/);
  await assert.rejects(plHomeSales({ town: "Zakopane" }), /Give a city from this list/);
  await assert.rejects(plHomeSales({ town: "Warszawa", postcode: "00-001" }), /postcode is not supported/);
  await assert.rejects(plHomeSales({ town: "Warszawa", property_type: "house" }), /only flats/);
});

test("manifest: PL, home-sales, working first example, licence line mentions the unclear status", () => {
  assert.deepEqual(plugin.countries, ["PL"]);
  assert.equal(plugin.category, "home-sales");
  assert.equal(plugin.examples[0].params.town, "Warszawa");
  assert.match(INFO.limits, /unclear/);
});
