// Format: HMRC UK Trade Info OData API, OTS lines, checked live on 2026-10-22 (see ./fixtures.ts). Unit values are value / net mass.
import { test } from "node:test";
import assert from "node:assert/strict";
import { InputError } from "../../lib/http";
import { COUNTRIES, OTS_LINES } from "./fixtures";
import def from "./index";
import {
  INFO, ITEMS, addMonths, commodityRange, filterFor, hmrcBorderPrice, hmrcHarvest, latestMonth, libraryKey, otsUrl, parseCountries, parseLines, resolvePartner, resolveProduct,
  summarise, weightedPercentile,
} from "./source";

const NOW = new Date("2026-10-22T12:00:00Z");
const urls: string[] = [];
const io = {
  async get(url: string): Promise<unknown> {
    urls.push(url);
    if (url.includes("/Country")) return COUNTRIES;
    if (url.includes("%24top=1") || url.includes("$top=1&") || /\$top=1$/.test(url)) return { value: url.includes("202609") ? [] : [{ MonthId: 202608 }] };
    return OTS_LINES;
  },
};

test("licence and attribution are the OGL v3.0 wording", () => {
  assert.match(INFO.licence, /Open Government Licence v3\.0/);
  assert.match(INFO.attribution, /^Contains public sector information licensed under the Open Government Licence v3\.0\./);
  assert.equal(INFO.price_type, "official_statistic");
  assert.equal(def.category, "border-prices");
});

test("parseLines keeps only lines with a value and a weight", () => {
  const { lines, rows } = parseLines({ value: [...OTS_LINES.value, { MonthId: 202506, FlowTypeId: 1, CommodityId: 1, CountryId: 4, Value: 10, NetMass: null }, { CommodityId: 1, CountryId: 4, Value: 0, NetMass: 5 }] });
  assert.equal(rows, 14);
  assert.equal(lines.length, 12);
  assert.deepEqual(lines[0], { month: 202506, flow: 1, commodity: 76151080, country: 4, value: 41502, kg: 1768 });
  assert.throws(() => parseLines({ nothing: true }), /unexpected answer/);
});

test("summarise: value / kg, weighted range, partners, and the 5-line rule", () => {
  const s = summarise(parseLines(OTS_LINES).lines)!;
  const value = OTS_LINES.value.reduce((a, r) => a + r.Value, 0);
  const kg = OTS_LINES.value.reduce((a, r) => a + r.NetMass, 0);
  assert.equal(s.lines, 12);
  assert.ok(Math.abs(s.unit - value / kg) < 1e-9);
  assert.ok(s.low <= s.unit + 20 && s.low < s.high);
  assert.equal(s.partners[0].id, 5); // China carries most of the value
  assert.equal(summarise(parseLines(OTS_LINES).lines.slice(0, 4)), null);
  assert.equal(weightedPercentile([{ v: 1, w: 1 }, { v: 2, w: 1 }, { v: 3, w: 8 }], 0.1), 1);
  assert.equal(weightedPercentile([{ v: 1, w: 1 }, { v: 2, w: 1 }, { v: 3, w: 8 }], 0.5), 3);
});

test("products: words and codes", () => {
  assert.equal(resolveProduct("Wheat").code, "1001");
  assert.equal(resolveProduct("diesel").code, "271019");
  assert.equal(resolveProduct("10.01").key, "wheat");
  assert.equal(resolveProduct("0808 10").code, "080810");
  assert.equal(resolveProduct("08081050").key, null);
  assert.throws(() => resolveProduct("27"), InputError);
  assert.throws(() => resolveProduct("unicorn meat"), /not recognised/);
  assert.equal(new Set(ITEMS.map((i) => i.key)).size, ITEMS.length);
  assert.deepEqual(commodityRange("0808"), { low: 8080000, high: 8089999 }); // CommodityId drops the leading zero
  assert.deepEqual(commodityRange("76151080"), { low: 76151080, high: 76151080 });
});

test("filter and URL", () => {
  const f = filterFor({ from: "2026-06", to: "2026-08", direction: "exports", code: "220830", partnerId: 10 });
  assert.equal(f, "MonthId ge 202606 and MonthId le 202608 and (FlowTypeId eq 2 or FlowTypeId eq 4) and CommodityId ge 22083000 and CommodityId le 22083099 and CountryId eq 10");
  assert.match(otsUrl(f, 40000), /^https:\/\/api\.uktradeinfo\.com\/OTS\?\$filter=MonthId%20ge%20202606.*&\$select=MonthId,FlowTypeId,CommodityId,CountryId,Value,NetMass&\$top=40000&\$skip=40000$/);
  assert.equal(addMonths("2026-01", -1), "2025-12");
  assert.equal(addMonths("2026-08", -2), "2026-06");
});

test("partners by code and by name", () => {
  const c = parseCountries(COUNTRIES);
  assert.equal(c.length, 5);
  assert.equal(resolvePartner("de", c).id, 4);
  assert.equal(resolvePartner("IE", c).name, "Irish Republic");
  assert.equal(resolvePartner("united states", c).id, 10);
  assert.equal(resolvePartner("USA", c).id, 10);
  assert.throws(() => resolvePartner("FR", c), InputError);
  assert.throws(() => resolvePartner("Atlantis", c), InputError);
  const withCodes = parseCountries({ value: [{ CountryId: 99, CountryName: "Freedonia", CountryCodeAlpha: "FD" }] });
  assert.equal(resolvePartner("fd", withCodes).id, 99);
});

test("latestMonth counts back to the newest month with lines", async () => {
  assert.equal(await latestMonth(io, NOW), "2026-08"); // 2026-09 has no lines in the mock, 2026-08 has
});

test("answer: customs value per kg, labelled, no sample size, notice says not a shelf price", async () => {
  const a = await hmrcBorderPrice({ product: "76151080", direction: "imports", months: 1 }, io, NOW);
  assert.equal(a.status, "ok");
  assert.equal(a.price!.currency, "GBP");
  assert.equal(a.price!.unit, "per kg");
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.sample_size, null);
  assert.equal(a.period.to, "2026-08");
  assert.ok(a.price!.typical_low! < a.price!.typical_high!);
  assert.match(a.notice, /Customs value, not a shelf price/);
  assert.match(a.summary, /customs value of £\d+(\.\d+)? per kg over 2026-08/);
  assert.match(a.source.attribution, /Open Government Licence v3\.0/);
  assert.equal((a.extra as any).customs_lines, 12);
  assert.equal((a.extra as any).top_partners[0].partner, "China");
  const p = await hmrcBorderPrice({ product: "76151080", direction: "imports", partner: "DE", period: "2026-06", months: 3 }, io, NOW);
  assert.equal(p.period.from, "2026-04");
  assert.equal((p.extra as any).partner.name, "Germany");
  assert.ok(urls.some((u) => u.includes("CountryId%20eq%204")));
  await assert.rejects(hmrcBorderPrice({ product: "76151080", direction: "imports", period: "2026-10" }, io, NOW), /already published/);
});

test("answer: fewer than 5 lines gives no figure", async () => {
  const few = { async get(u: string) { return u.includes("/Country") ? COUNTRIES : { value: OTS_LINES.value.slice(0, 3) }; } };
  const a = await hmrcBorderPrice({ product: "76151080", direction: "imports", period: "2026-06" }, few, NOW);
  assert.equal(a.status, "no_matches");
  assert.equal(a.price, null);
  assert.match(a.summary, /no figure from fewer than 5/);
});

test("a question that needs too many lines is refused with advice", async () => {
  const big = { async get(u: string) { return u.includes("/Country") ? COUNTRIES : { value: new Array(40000).fill({ MonthId: 202606, FlowTypeId: 1, CommodityId: 1, CountryId: 4, Value: 1, NetMass: 1 }) }; } };
  await assert.rejects(hmrcBorderPrice({ product: "2710", direction: "imports", period: "2026-06" }, big, NOW), /more than 160000 customs lines/);
});

test("harvest: one row per item and direction with a label-free key, and the library key matches", async () => {
  const h = await hmrcHarvest(io, 0, NOW);
  assert.equal(h.date, "2026-08-01");
  assert.equal(h.currency, "GBP");
  assert.equal(h.unit, "per kg");
  assert.equal(h.rows.length, ITEMS.length * 2);
  const r = h.rows.find((x) => x.item === "wheat" && x.area === "imports")!;
  assert.ok(Number.isNaN(r.n)); // official aggregate: NO_COUNT
  assert.ok(r.median > 0 && r.low <= r.high);
  assert.deepEqual(libraryKey({ product: "wheat", direction: "imports" })?.item, "wheat");
  assert.equal(libraryKey({ product: "08081050", direction: "imports" }), null);
  assert.equal(def.historyKey!({ country: "GB", product: "wheat", direction: "exports" }, undefined)?.area, "exports");
  assert.equal(def.historyKey!({ country: "GB", product: "wheat", direction: "exports", partner: "DE" }, undefined), null);
  assert.equal(def.historyKey!({ country: "GB", product: "wheat", direction: "exports", months: 3 }, undefined), null);
});
