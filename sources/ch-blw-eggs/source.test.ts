// Tests for the BLW Switzerland egg producer price source. Fixture = the real LINDAS answer captured 2026-11-10 (see fixtures.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { InputError } from "../../lib/http";
import { NO_COUNT } from "../../lib/stats";
import { INFO, answerFor, buildQuery, chEggHarvest, chEggHistoryKey, chEggPrices, eggProductOf, harvestRows, parseCsv, parsePoints, PRODUCTS, shiftMonth } from "./source";
import { LIVE_CSV } from "./fixtures";

const NOW = new Date("2026-11-10T12:00:00Z");
const F = "https://agriculture.ld.admin.ch/foag/";

test("parsePoints reads 4 products x 14 months, oldest first", () => {
  const m = parsePoints(LIVE_CSV);
  assert.deepEqual([...m.keys()].sort(), ["224", "229", "234", "235"]);
  for (const pts of m.values()) {
    assert.equal(pts.length, 14);
    assert.equal(pts[0].month, "2025-08");
    assert.equal(pts[13].month, "2026-09");
  }
  assert.equal(m.get("235")!.at(-1)!.rappen, 32.53);
  assert.equal(m.get("224")!.at(-1)!.rappen, 49.42);
  assert.equal(m.get("229")!.at(-1)!.rappen, 25.33);
  assert.equal(m.get("234")!.at(-1)!.rappen, 23.52);
});

test("parsePoints drops rows that are not Swiss centimes per piece incl. VAT, realised price, or are junk", () => {
  const head = "product,month,price,unit,currency,cost,method,region";
  const ok = `${F}product/235,https://ld.admin.ch/time/month/2026-09,32.53,${F}unit/2,${F}currency/1,${F}cost-component/1,${F}data-method/25,${F}sales-region/1`;
  const eur = ok.replace("currency/1", "currency/2");
  const kg = ok.replace("unit/2", "unit/1");
  const foreign = ok.replace("sales-region/1", "sales-region/0");
  const bad = `${F}product/235,https://ld.admin.ch/time/month/2026-08,abc,${F}unit/2,${F}currency/1,${F}cost-component/1,${F}data-method/25,${F}sales-region/1`;
  const zero = ok.replace("32.53", "0");
  const m = parsePoints([head, ok, eur, kg, foreign, bad, zero].join("\n"));
  assert.equal(m.get("235")!.length, 1);
});

test("parsePoints refuses a changed layout", () => {
  assert.throws(() => parsePoints("product,month,price\nx,y,1"), /unexpected layout/);
  assert.equal(parsePoints("").size, 0);
});

test("parseCsv handles quotes and CRLF", () => {
  assert.deepEqual(parseCsv('a,"b,c"\r\n1,"x""y"\r\n'), [["a", "b,c"], ["1", 'x"y']]);
});

test("query asks for the four Swiss series from the given month", () => {
  const q = buildQuery("2025-08");
  assert.match(q, /product\/235/);
  assert.match(q, /time\/month\/2025-08/);
  assert.match(q, /cube\/Eggs\/Production_Price_Month/);
});

test("eggProductOf: everyday words", () => {
  assert.equal(eggProductOf("eggs")?.code, "235");
  assert.equal(eggProductOf("Eggs")?.code, "235");
  assert.equal(eggProductOf("organic eggs")?.code, "224");
  assert.equal(eggProductOf("free-range eggs")?.code, "229");
  assert.equal(eggProductOf("barn eggs")?.code, "234");
  assert.equal(eggProductOf("a dozen eggs")?.code, "235");
  assert.equal(eggProductOf("milk"), null);
  assert.equal(eggProductOf(undefined), null);
});

test("shiftMonth crosses year ends", () => {
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(shiftMonth("2026-09", -12), "2025-09");
});

test("answerFor: all-forms eggs, September 2026", () => {
  const pr = PRODUCTS[0];
  const a = answerFor(pr, parsePoints(LIVE_CSV).get(pr.code)!, { product: "eggs" }, NOW);
  assert.equal(a.status, "ok");
  assert.equal(a.price?.value, 0.3253);
  assert.equal(a.price?.currency, "CHF");
  assert.equal(a.price?.unit, "per egg");
  assert.equal(a.sample_size ?? null, null);
  assert.equal(a.source.id, "ch-blw-eggs");
  assert.equal(a.price_type, "official_statistic");
  const x: any = a.extra;
  assert.equal(x.reference_month, "2026-09");
  assert.equal(x.published_value, 32.53);
  assert.equal(x.price_per_dozen_chf, 3.9);
  assert.equal(x.change_on_year_earlier.value_rappen, 31.21);
  assert.equal(x.change_on_year_earlier.change_percent, 4.2);
  assert.equal(x.change_on_previous_month.change_percent, 1.8);
  assert.equal(x.last_12_months.length, 12);
  assert.match(a.summary, /September 2026/);
  assert.match(a.summary, /not a shop price/);
  assert.match(a.summary, /Federal Office for Agriculture/);
});

test("answerFor: no data gives no_matches, old data is flagged", () => {
  const pr = PRODUCTS[3];
  assert.equal(answerFor(pr, [], { product: "organic eggs" }, NOW).status, "no_matches");
  const old = answerFor(pr, [{ month: "2026-01", rappen: 48 }], { product: "organic eggs" }, new Date("2026-11-10T00:00:00Z"));
  assert.match(old.statistic?.note ?? "", /Old data/);
});

test("chEggPrices uses the injected fetcher, and refuses non-egg products", async () => {
  let asked = "";
  const a = await chEggPrices({ product: "organic eggs" }, { now: NOW, post: async (q) => { asked = q; return LIVE_CSV; } });
  assert.equal(a.status, "ok");
  assert.equal(a.price?.value, 0.4942);
  assert.match(asked, /product\/224/);
  assert.match(asked, /month\/2025-06/);
  await assert.rejects(() => chEggPrices({ product: "wheat" }, { now: NOW, post: async () => LIVE_CSV }), InputError);
});

test("harvest: one row per product for the newest month, n is NO_COUNT", async () => {
  const h = await chEggHarvest({ now: NOW, post: async () => LIVE_CSV });
  assert.equal(h.date, "2026-09-30");
  assert.equal(h.currency, "CHF");
  assert.equal(h.rows.length, 4);
  for (const r of h.rows) { assert.equal(r.n, NO_COUNT); assert.equal(r.area, "CH"); assert.equal(r.low, r.median); }
  assert.equal(h.rows.find((r) => /all forms/.test(r.item))!.median, 0.3253);
  assert.throws(() => harvestRows(new Map()), /no usable/);
});

test("historyKey matches the harvest item name", async () => {
  const h = await chEggHarvest({ now: NOW, post: async () => LIVE_CSV });
  const k = chEggHistoryKey({ product: "eggs" })!;
  assert.equal(k.area, "CH");
  assert.ok(h.rows.some((r) => r.item === k.item));
  assert.equal(chEggHistoryKey({ product: "milk" }), null);
});

test("INFO states licence, attribution and the limits", () => {
  assert.match(INFO.licence, /Open use/);
  assert.match(INFO.attribution, /Federal Office for Agriculture/);
  assert.match(INFO.limits, /no range and no sample size/);
});
