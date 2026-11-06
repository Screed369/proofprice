// Tests for the FEWS NET market prices source. The fixture holds real rows fetched 2026-11-06 (see fixtures.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { KE_MAIZE_SAMPLE } from "./fixtures";
import { COUNTRIES, INFO, LISTED, FewsRow, answerFromRows, fewsMarketPrices, groupRows, pageUrl, parsePage, searchTerm, usable } from "./source";
import manifest from "./index";
import { categoryById, countriesFor } from "../../lib/registry";

const rows = () => parsePage(KE_MAIZE_SAMPLE).rows;

test("parsePage reads the real Django-style page and refuses anything else (for example a bot-challenge body)", () => {
  const p = parsePage(KE_MAIZE_SAMPLE);
  assert.equal(p.rows.length, 14);
  assert.equal(p.next, null);
  assert.throws(() => parsePage({}), /layout we do not know/);
  assert.throws(() => parsePage(null), /layout we do not know/);
});

test("usable drops rows with no value (Not Collected) and keeps collected prices in USD", () => {
  const u = usable(rows());
  assert.ok(u.length < rows().length);
  assert.ok(u.every((r) => r.status === "Collected" && (r.common_currency_price as number) > 0));
});

test("searchTerm turns a plain question into the API's product filter", () => {
  assert.equal(searchTerm("Maize"), "maize");
  assert.equal(searchTerm("wholesale maize prices"), "maize");
  assert.equal(searchTerm("potatoes"), "potato");
  assert.equal(searchTerm("corn"), "maize");
  assert.equal(searchTerm("wheat flour"), "wheat flour");
});

test("groupRows: retail white maize leads with each market's newest price; wholesale leads when asked", () => {
  const g = groupRows(rows(), false);
  assert.equal(g[0].product, "Maize Grain (White)");
  assert.equal(g[0].type, "Retail");
  assert.equal(g[0].markets, 9);
  assert.equal(g[0].newest, "2026-09-30");
  const w = groupRows(rows(), true);
  assert.equal(w[0].type, "Wholesale");
  assert.equal(w[0].markets, 1);
});

test("a market's older price never counts twice", () => {
  const extra: FewsRow = { ...(rows().find((r) => r.status === "Collected" && r.price_type === "Retail" && r.period_date === "2026-09-30") as FewsRow), period_date: "2026-08-31", common_currency_price: 9 };
  const g = groupRows([...rows(), extra], false)[0];
  assert.equal(g.markets, 9);
  assert.ok(Math.max(...g.values) < 9);
});

test("answerFromRows: 9 markets give an ok answer in USD per kg with the sources named and no 'paid' claim", () => {
  const a = answerFromRows(rows(), { country: "KE", item: "maize" });
  assert.equal(a.status, "ok");
  assert.equal(a.price.currency, "USD");
  assert.equal(a.sample_size, 9);
  assert.ok(a.price.median! > 0.2 && a.price.median! < 1.5, `median ${a.price.median}`);
  assert.equal(a.price_type, "posted_price");
  assert.match(a.summary, /not receipts/);
  assert.equal((a as any).extra.latest_month, "2026-09");
  assert.ok(((a as any).extra.source_organizations as string[]).length >= 1);
});

test("fewer than 5 markets never publish a range", () => {
  const few = rows().filter((r) => r.price_type === "Wholesale");
  const a = answerFromRows(few, { country: "KE", item: "wholesale maize" });
  assert.notEqual(a.status, "ok");
});

test("no rows gives 'no matches' with a hint", () => {
  const a = answerFromRows([], { country: "KE", item: "caviar" });
  assert.equal(a.status, "no_matches");
});

test("fewsMarketPrices asks for one country and one food, follows paging, and rejects a bad country or empty item", async () => {
  const urls: string[] = [];
  const a = await fewsMarketPrices({ country: "ke", item: "Maize", today: "2026-11-06", fetchPage: async (u) => (urls.push(u), KE_MAIZE_SAMPLE) });
  assert.equal(a.status, "ok");
  assert.equal(urls.length, 1);
  assert.match(urls[0], /country_code=KE/);
  assert.match(urls[0], /product=maize/);
  assert.match(urls[0], /start_date=2026-06-09/);
  assert.match(urls[0], /page_size=500/);
  assert.doesNotMatch(urls[0], /ordering/, "ordering makes the API answer 403");
  await assert.rejects(() => fewsMarketPrices({ country: "FR", item: "maize" }), /country must be one of/);
  await assert.rejects(() => fewsMarketPrices({ country: "KE", item: " " }), /item is required/);
  await assert.rejects(() => fewsMarketPrices({ country: "KE", item: "maize", region: "Nairobi" }), /region must be left out/);
  await assert.rejects(() => fewsMarketPrices({ country: "KE", item: "maize", fetchPage: async () => ({}) }), /layout we do not know/);
});

test("pageUrl never asks for more than 500 rows", () => {
  assert.match(pageUrl("GT", "beans", "2026-11-06", 500), /offset=500/);
});

test("manifest: groceries category, free-tier source info, no country shared with another source", () => {
  assert.equal(manifest.info.id, "un-fews-market-prices");
  assert.ok(categoryById("groceries"));
  assert.deepEqual([...manifest.countries].sort(), [...LISTED].sort());
  assert.equal(INFO.price_type, "posted_price");
  for (const c of LISTED) assert.ok(COUNTRIES[c] && countriesFor("groceries").includes(c));
  assert.equal(manifest.examples[0].params.country, "KE");
});
