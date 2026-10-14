// Tests for the government-contracts category: the shared purchase table, the answer wrapper and the tool's parameters.
// The sources have their own tests (sources/eu-ted, sources/us-usaspending, sources/gb-contracts-finder) with fixtures from the live APIs.
import { test } from "node:test";
import assert from "node:assert/strict";
import contracts from "../categories/contracts/index";
import { contractAnswer, unitPriceFrom, VALUE_BASIS } from "../categories/contracts/answer";
import { cleanCpv, cpvInGroups, cpvStem, daysSince, matchPurchase, monthsWindow, normaliseText, PURCHASES, sliceWindow } from "../categories/contracts/purchases";
import { InputError } from "../lib/http";
import type { SourceInfo } from "../lib/plugin";

const SRC: SourceInfo = {
  id: "test-source", country: "XX", category: "government contracts", name: "Test notices", publisher: "Test Publisher",
  what_is_recorded: "x", price_type: "contract_price", freshness: "Daily", licence: "Test licence", licence_url: "https://example.org/licence",
  attribution: "Source: Test Publisher", homepage: "https://example.org/", limits: "x",
};

test("tool: the public name, path and title are the agreed ones", () => {
  assert.equal(contracts.id, "contracts");
  assert.equal(contracts.tool, "pricepaid_contract_prices");
  assert.equal(contracts.restPath, "contracts");
  assert.equal(contracts.cacheSeconds, 21600);
  assert.equal(contracts.title, "Government contract prices (what public buyers paid)");
  assert.deepEqual(contracts.required, ["what"]);
  assert.ok(Object.keys(contracts.params).includes("cpv") && Object.keys(contracts.params).includes("buyer_area") && Object.keys(contracts.params).includes("months"));
});

test("tool: what is required, months defaults to 24 and must be 1 to 60", () => {
  const prep = (p: Record<string, unknown>) => contracts.prepare!(p as any) as any;
  assert.equal(prep({ what: "  school   meals " }).what, "school meals");
  assert.equal(prep({ what: "laptops" }).months, 24);
  assert.equal(prep({ what: "laptops", months: 6 }).months, 6);
  assert.equal(prep({ what: "laptops", cpv: "30213100", buyer_area: "Lyon" }).cpv, "30213100");
  assert.throws(() => prep({}), InputError);
  assert.throws(() => prep({ what: " x " }), InputError);
  assert.throws(() => prep({ what: "laptops", months: 0 }), InputError);
  assert.throws(() => prep({ what: "laptops", months: 61 }), InputError);
});

test("tool: the description says what it is for, what it is not for, and that values are totals", () => {
  const text = contracts.description([
    { place: "the EU", freshness: "Daily" } as any,
    { place: "the US", freshness: "Daily" } as any,
  ]);
  assert.match(text, /^Use this when/);
  assert.match(text, /Do not use/);
  assert.match(text, /TOTAL values per contract/);
  assert.match(text, /fewer than 5 awards/);
});

test("purchases: every entry is complete, codes are 8 digits, and no alias belongs to two purchases", () => {
  const owner = new Map<string, string>();
  for (const p of PURCHASES) {
    assert.ok(p.id && p.label && p.keyword, p.id);
    assert.ok(p.cpv.length >= 1, p.id);
    for (const c of p.cpv) assert.match(c, /^\d{8}$/, `${p.id} ${c}`);
    assert.ok(p.aliases.length >= 2, p.id);
    for (const a of p.aliases) {
      const n = normaliseText(a);
      assert.ok(n, `${p.id}: empty alias`);
      const other = owner.get(n);
      assert.ok(!other || other === p.id, `alias "${a}" is in both ${other} and ${p.id}`);
      owner.set(n, p.id);
    }
  }
  assert.equal(new Set(PURCHASES.map((p) => p.id)).size, PURCHASES.length);
});

test("purchases: plain words in several languages find the purchase", () => {
  const id = (s: string) => matchPurchase(s)?.id ?? null;
  assert.equal(id("laptops"), "laptops");
  assert.equal(id("Laptop"), "laptops");
  assert.equal(id("Ordinateurs portables"), "laptops");
  assert.equal(id("ordenadores portátiles"), "laptops");
  assert.equal(id("school meals"), "school-meals");
  assert.equal(id("Schulessen"), "school-meals");
  assert.equal(id("restauration scolaire"), "school-meals");
  assert.equal(id("road resurfacing"), "road-resurfacing");
  assert.equal(id("réfection de chaussée"), "road-resurfacing");
  assert.equal(id("Straßensanierung"), "road-resurfacing");
  assert.equal(id("nettoyage de bureaux"), "office-cleaning");
  assert.equal(id("office cleaning"), "office-cleaning");
});

test("purchases: a purchase is found inside a longer request, but generic one-word aliases only match on their own", () => {
  assert.equal(matchPurchase("ordenadores portátiles para colegios")?.id, "laptops");
  assert.equal(matchPurchase("cost of school meals in county councils")?.id, "school-meals");
  assert.equal(matchPurchase("tablet")?.id, "tablets");
  assert.equal(matchPurchase("tablet formulation"), null);
  assert.equal(matchPurchase("cleaning")?.id, "building-cleaning");
  assert.equal(matchPurchase("cleaning of windows"), null);
  assert.equal(matchPurchase("something unheard of"), null);
  assert.equal(matchPurchase("   "), null);
});

test("purchases: the search words for the US and the UK", () => {
  assert.equal(matchPurchase("laptops")?.keyword, "laptop");
  const road = matchPurchase("road resurfacing")!;
  assert.equal(road.gb, "resurfacing");
  assert.equal(road.usPsc, "Z2LB");
});

test("CPV helpers: typed codes are cleaned, stems cover the group below a code", () => {
  assert.equal(cleanCpv("30213100"), "30213100");
  assert.equal(cleanCpv(" 30213100-5 "), "30213100");
  assert.equal(cleanCpv("3021"), "3021");
  assert.equal(cleanCpv("3"), null);
  assert.equal(cleanCpv("laptops"), null);
  assert.equal(cleanCpv("123456789"), null);
  assert.equal(cleanCpv(undefined), null);
  assert.equal(cpvStem("30213100"), "302131");
  assert.equal(cpvStem("55524000"), "55524");
  assert.equal(cpvStem("3021"), "3021");
  assert.equal(cpvStem("30000000"), "30"); // a stem is never shorter than the two-digit division
  assert.ok(cpvInGroups("30213100", ["302131"]));
  assert.ok(cpvInGroups("30213100-5", ["3021"]));
  assert.ok(!cpvInGroups("30200000", ["302131"])); // the parent code is not inside the child group
  assert.ok(!cpvInGroups("55523000", ["55524", "555231"])); // 55523000 is the parent of 55523100
  assert.ok(cpvInGroups("55523100", ["55524", "555231"]));
  assert.ok(cpvInGroups("55524000", ["55524", "555231"]));
});

test("dates: the window ends today and starts N months earlier; slices cover it without gaps or overlap", () => {
  const now = new Date("2026-10-14T12:00:00Z");
  assert.deepEqual(monthsWindow(24, now), { from: "2024-10-14", to: "2026-10-14" });
  assert.deepEqual(monthsWindow(3, now), { from: "2026-07-14", to: "2026-10-14" });
  const slices = sliceWindow("2024-10-14", "2026-10-14", 12);
  assert.equal(slices.length, 12);
  assert.equal(slices[0].from, "2024-10-14");
  assert.equal(slices[slices.length - 1].to, "2026-10-14");
  for (let i = 1; i < slices.length; i++) {
    const gap = (Date.parse(slices[i].from) - Date.parse(slices[i - 1].to)) / 86400000;
    assert.equal(gap, 1, `slice ${i}`);
  }
  assert.deepEqual(sliceWindow("2026-09-14", "2026-10-14", 1), [{ from: "2026-09-14", to: "2026-10-14" }]);
  assert.equal(daysSince("2026-10-04", new Date("2026-10-14T00:00:00Z")), 10);
  assert.equal(daysSince("2030-01-01", now), 0);
});

test("answer: the median per contract with the 10th to 90th percentile, and the statement that these are totals", () => {
  const values = [10000, 20000, 30000, 40000, 50000, 60000, 70000, 80000, 90000, 100000];
  const a = contractAnswer({
    source: SRC, query: { country: "FR", what: "laptops" }, values, currency: "EUR", what: "laptops", where: "France",
    period: { from: "2024-10-14", to: "2026-10-14" }, newest: new Date(Date.now() - 20 * 86400000).toISOString().slice(0, 10), method: "Method text.",
  });
  assert.equal(a.status, "ok");
  assert.equal(a.price_type, "contract_price");
  assert.equal(a.sample_size, 10);
  assert.equal(a.price?.median, 55000);
  assert.equal(a.price?.currency, "EUR");
  assert.equal(a.price?.unit, "per contract (lot), total awarded value");
  assert.ok(a.price!.typical_low! < 55000 && a.price!.typical_high! > 55000);
  assert.match(a.summary, /^Public buyers in France awarded laptops contracts with a median total value of/);
  assert.match(a.summary, /These are totals per contract \(lot\), not unit prices\./);
  assert.match(a.summary, /Newest award used: \d{4}-\d{2}-\d{2}\./);
  assert.match(a.summary, /Based on 10 records from Test Publisher \(2024-10-14 to 2026-10-14\)/);
  assert.equal(a.extra?.value_basis, VALUE_BASIS);
  assert.equal(a.source.licence_url, "https://example.org/licence");
});

test("answer: fewer than five awards publishes no figure", () => {
  const a = contractAnswer({
    source: SRC, query: {}, values: [1000, 2000, 3000, 4000], currency: "GBP", what: "laptops", where: "the UK",
    period: { from: "2024-10-14", to: "2026-10-14" }, newest: "2026-09-01", method: "m",
  });
  assert.equal(a.status, "insufficient_data");
  assert.equal(a.price, null);
  assert.match(a.summary, /at least 5 are needed/);
  const none = contractAnswer({ source: SRC, query: {}, values: [], currency: "GBP", what: "x", where: "y", period: { from: null as any, to: null as any }, method: "m" });
  assert.equal(none.status, "no_matches");
});

test("answer: old awards are flagged plainly, notes are appended, and a unit price is stated when given", () => {
  const values = [100, 200, 300, 400, 500, 600];
  const old = contractAnswer({
    source: SRC, query: {}, values, currency: "EUR", what: "school meals", where: "Germany", period: { from: "2020-01-01", to: "2021-01-01" },
    newest: "2021-01-01", method: "m", notes: ["A framework note."],
    unitPrice: { unit: "per piece", currency: "EUR", median: 615, typical_low: 500, typical_high: 700, sample_size: 6 },
  });
  assert.match(old.summary, /more than six months ago, so this may not reflect today's prices/);
  assert.match(old.summary, /A framework note\./);
  assert.match(old.summary, /where notices also state a quantity, the median works out at .*615.* per piece \(6 contracts\)/);
  assert.equal((old.extra?.unit_price as any).unit, "per piece");
  assert.equal(old.extra?.newest_award_used, "2021-01-01");
});

test("unit price: needs five contracts in one unit, uses the unit with most contracts, ignores empty quantities", () => {
  const rows = (unit: string, n: number, value = 1000, quantity = 10) => Array.from({ length: n }, () => ({ value, quantity, unit }));
  assert.equal(unitPriceFrom(rows("piece", 4), "EUR"), null);
  const five = unitPriceFrom(rows("piece", 5), "EUR");
  assert.deepEqual(five && [five.unit, five.currency, five.median, five.sample_size], ["per piece", "EUR", 100, 5]);
  const mixed = unitPriceFrom([...rows("kWh", 6, 500, 1000), ...rows("piece", 5)], "EUR")!;
  assert.equal(mixed.unit, "per kWh");
  assert.equal(mixed.median, 0.5);
  assert.equal(unitPriceFrom([...rows("piece", 5, 1000, 0), ...rows("piece", 4)], "EUR"), null);
  assert.equal(unitPriceFrom([], "EUR"), null);
});
