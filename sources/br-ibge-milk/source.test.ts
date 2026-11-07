import { test } from "node:test";
import assert from "node:assert/strict";
import { InputError, SourceError } from "../../lib/http";
import { findSource, runCategory, SOURCE_PLUGINS } from "../../lib/registry";
import manifest from "./index";
import { SIDRA_FIXTURE } from "./fixtures";
import {
  answerFor, harvestRows, ibgeMilkHarvest, ibgeMilkHistoryKey, ibgeMilkPrices, INFO, isMilk, quarterRange, quarterWords, readSidra, resolveTerritory,
  shiftQuarter, sidraUrl, STATES, BRAZIL,
} from "./source";

const fetcher = async (_url: string) => SIDRA_FIXTURE;

test("INFO: official statistic, IBGE, free tier wording", () => {
  assert.equal(INFO.id, "br-ibge-milk");
  assert.equal(INFO.price_type, "official_statistic");
  assert.match(INFO.attribution, /IBGE/);
  assert.match(INFO.licence, /free tier only/);
});

test("request URL: Brazil + states, price and informants, newest quarters (format checked 2026-11-07)", () => {
  assert.equal(sidraUrl(), "https://apisidra.ibge.gov.br/values/t/1086/n1/all/n3/all/v/2522,396/p/last%206/c12716/115236?formato=json");
});

test("readSidra: real fixture, prices per territory, suppressed X cells left out, informants joined", () => {
  const m = readSidra(SIDRA_FIXTURE);
  const br = m.get("1")!;
  assert.equal(br.length, 6);
  assert.deepEqual(br[br.length - 1], { quarter: "202602", price: 2.7, informants: 1970 });
  assert.equal(m.get("53"), undefined, "DF is all X");
  const rr = m.get("14")!;
  assert.equal(rr.length, 4, "Roraima: X in 2025 Q1 and 2026 Q2");
  assert.equal(rr[rr.length - 1].quarter, "202601");
  assert.throws(() => readSidra([]), SourceError);
  assert.throws(() => readSidra([{ D2N: "Other", D3N: "x" }, {}]), SourceError);
});

test("quarters", () => {
  assert.deepEqual(quarterRange("202602"), { from: "2026-04-01", to: "2026-06-30" });
  assert.deepEqual(quarterRange("202601"), { from: "2026-01-01", to: "2026-03-31" });
  assert.equal(quarterWords("202604"), "Q4 2026");
  assert.equal(shiftQuarter("202601", -1), "202504");
  assert.equal(shiftQuarter("202602", -4), "202502");
  assert.throws(() => quarterRange("2026"), SourceError);
});

test("territory and product matching", () => {
  assert.equal(resolveTerritory(undefined), BRAZIL);
  assert.equal(resolveTerritory("Brasil"), BRAZIL);
  assert.equal(resolveTerritory("sao paulo").uf, "SP");
  assert.equal(resolveTerritory("São Paulo").code, "35");
  assert.equal(resolveTerritory("rs").name, "Rio Grande do Sul");
  assert.equal(resolveTerritory("Estado de Minas Gerais").uf, "MG");
  assert.equal(STATES.length, 27);
  assert.throws(() => resolveTerritory("Atlantis"), InputError);
  assert.ok(isMilk("Leite") && isMilk("raw milk") && !isMilk("wheat"));
});

test("national answer: Q2 2026, BRL 2.70 per litre, year-on-year, no range, no sample size", async () => {
  const a = await ibgeMilkPrices({ product: "milk", baseUrl: "" }, { fetcher });
  assert.equal(a.status, "ok");
  assert.equal(a.price!.value, 2.7);
  assert.equal(a.price!.currency, "BRL");
  assert.equal(a.price!.unit, "per litre");
  assert.equal(a.price!.typical_low, null);
  assert.equal(a.sample_size, null);
  assert.equal(a.price_type, "official_statistic");
  assert.deepEqual(a.period, { from: "2026-04-01", to: "2026-06-30" });
  const x = a.extra as any;
  assert.equal(x.dairies_reporting_a_price, 1970);
  assert.equal(x.change_on_year_earlier.reference_quarter, "202502");
  assert.equal(x.change_on_year_earlier.change_percent, -1.5);
  assert.equal(x.change_on_previous_quarter.value, 2.24);
  assert.match(a.summary, /Q2 2026/);
  assert.match(a.summary, /not a sale/);
});

test("state answer (São Paulo) and a state with a withheld latest quarter (Roraima)", async () => {
  const sp = await ibgeMilkPrices({ product: "leite", region: "SP" }, { fetcher });
  assert.equal(sp.price!.value, 2.84);
  assert.equal((sp.extra as any).region, "São Paulo");
  const rr = await ibgeMilkPrices({ product: "milk", region: "Roraima" }, { fetcher });
  assert.equal(rr.price!.value, 2.51);
  assert.deepEqual(rr.period, { from: "2026-01-01", to: "2026-03-31" });
  assert.match(rr.statistic!.note ?? "", /withheld the figure for Roraima in Q2 2026/);
});

test("a state IBGE publishes nothing for answers no_matches, not a made-up number", async () => {
  const df = await ibgeMilkPrices({ product: "milk", region: "DF" }, { fetcher });
  assert.equal(df.status, "no_matches");
  assert.equal(df.price, null);
  assert.equal(answerFor(BRAZIL, [], null, {}).status, "no_matches");
});

test("wrong product or state is an input error that says what to ask", async () => {
  await assert.rejects(ibgeMilkPrices({ product: "wheat" }, { fetcher }), (e: any) => e instanceof InputError && /milk/.test(e.message));
  await assert.rejects(ibgeMilkPrices({ product: "milk", region: "Narnia" }, { fetcher }), InputError);
});

test("harvest: newest quarter, one row per territory with a price, NO_COUNT, dated at quarter end", async () => {
  const h = await ibgeMilkHarvest({ fetcher });
  assert.equal(h.date, "2026-06-30");
  assert.equal(h.currency, "BRL");
  const areas = h.rows.map((r) => r.area).sort();
  assert.deepEqual(areas, ["BR", "RS", "SP"], "RR and DF have no Q2 2026 price");
  assert.ok(h.rows.every((r) => Number.isNaN(r.n)));
  assert.equal(h.rows.find((r) => r.area === "BR")!.median, 2.7);
  assert.throws(() => harvestRows(new Map()), SourceError);
});

test("historyKey matches the harvest keys", async () => {
  const h = await ibgeMilkHarvest({ fetcher });
  const k = ibgeMilkHistoryKey({ product: "milk", region: "São Paulo" })!;
  assert.ok(h.rows.some((r) => r.area === k.area && r.item === k.item));
  const n = ibgeMilkHistoryKey({ product: "milk" })!;
  assert.ok(h.rows.some((r) => r.area === n.area && r.item === n.item));
  assert.equal(ibgeMilkHistoryKey({ product: "wheat" }), null);
  assert.equal(ibgeMilkHistoryKey({ product: "milk", region: "Narnia" }), null);
});

test("manifest: registered in farm-gate-prices for BR with a first example", () => {
  assert.equal(manifest.info.id, "br-ibge-milk");
  assert.equal(manifest.category, "farm-gate-prices");
  assert.deepEqual(manifest.countries, ["BR"]);
  assert.deepEqual(manifest.examples![0].params, { country: "BR", product: "milk" });
  assert.ok(SOURCE_PLUGINS.some((s) => s.info.id === "br-ibge-milk"));
  assert.equal(findSource("farm-gate-prices", "BR")?.info.id, "br-ibge-milk");
});
