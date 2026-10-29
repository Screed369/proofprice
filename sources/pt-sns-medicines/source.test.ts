import { test } from "node:test";
import assert from "node:assert/strict";
import { InputError, SourceError } from "../../lib/http";
import { categoryById, countriesFor, pickSource, SOURCE_PLUGINS } from "../../lib/registry";
import { FIXTURE } from "./fixture";
import { INFO, newestMonth, nationalAverage, normaliseBasket, ptAnswer, ptMedicines } from "./source";

const rows = FIXTURE.results as Record<string, any>[];

test("pt-sns-medicines: info is the SNS portal's, posted price", () => {
  assert.equal(INFO.id, "pt-sns-medicines");
  assert.equal(INFO.price_type, "posted_price");
  assert.match(INFO.attribution, /INFARMED/);
  assert.match(INFO.licence, /Lei n\.º 26\/2016/);
});

test("pt-sns-medicines: basket names", () => {
  assert.equal(normaliseBasket(), "all");
  assert.equal(normaliseBasket("All"), "all");
  assert.equal(normaliseBasket("genéricos"), "generics");
  assert.equal(normaliseBasket("generics"), "generics");
  assert.throws(() => normaliseBasket("paracetamol"), (e: Error) => e instanceof InputError && /medicine=all/.test(e.message));
});

test("pt-sns-medicines: newest month holding all five regions, from the real fixture", () => {
  const { month, regions } = newestMonth(rows, "all");
  assert.equal(month, "2026-07");
  assert.equal(regions.length, 5);
  const nat = nationalAverage(regions);
  assert.equal(nat.packs, 6011540 + 4469513 + 738191 + 6114709 + 751022);
  assert.ok(nat.average > 14.4 && nat.average < 14.7, String(nat.average));
});

test("pt-sns-medicines: a month with fewer than five regions is skipped", () => {
  const partial = rows.filter((r) => !(r.tempo === "2026-07" && r.regiao === "Algarve"));
  assert.equal(newestMonth(partial, "all").month, "2026-06");
  assert.throws(() => newestMonth(rows.filter((r) => r.regiao !== "Algarve"), "all"), SourceError);
});

test("pt-sns-medicines: all-medicines answer is an official-style average with a pack count and regions", () => {
  const a = ptAnswer(rows, "all");
  assert.equal(a.status, "ok");
  assert.equal(a.price?.currency, "EUR");
  assert.equal(a.price?.measure, "average");
  assert.ok(a.price!.value! > 14.4 && a.price!.value! < 14.7);
  assert.equal(a.price_type, "posted_price");
  assert.equal(a.period.from, "2026-07-01");
  assert.equal(a.period.to, "2026-07-31");
  assert.ok((a.sample_size ?? 0) > 18_000_000);
  assert.deepEqual(Object.keys((a.extra as any).by_region).sort(), ["Alentejo", "Algarve", "Centro", "Lisboa", "Norte"]);
  assert.match(a.summary, /not the price of any one medicine/);
});

test("pt-sns-medicines: generics answer uses the generics columns", () => {
  const a = ptAnswer(rows, "generics");
  assert.ok(a.price!.value! > 8.5 && a.price!.value! < 8.9, String(a.price!.value));
  assert.match(a.summary, /generic medicines/);
});

test("pt-sns-medicines: fetch builds the records URL and answers", async () => {
  const urls: string[] = [];
  const a = await ptMedicines({ medicine: "all" }, { fetcher: async (u) => (urls.push(u), FIXTURE) });
  assert.equal(a.status, "ok");
  assert.match(urls[0], /^https:\/\/transparencia\.sns\.gov\.pt\/api\/explore\/v2\.1\/catalog\/datasets\/preco-medio-por-embalagem\/records\?/);
  assert.match(urls[0], /order_by=tempo(%20|\+)desc/);
});

test("pt-sns-medicines: routed through the medicines category for PT", async () => {
  assert.ok(SOURCE_PLUGINS.some((s) => s.info.id === "pt-sns-medicines"));
  assert.ok(countriesFor("medicines").includes("PT"));
  assert.ok(categoryById("medicines"));
  assert.equal(pickSource(categoryById("medicines")!, { country: "PT", medicine: "all" }).src.info.id, "pt-sns-medicines");
});
