// Tests for the GB Ofgem price cap source. Fixtures are the REAL tables read on 2026-10-23 (see fixtures.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { PAGE_HTML, SCRIPTS } from "./fixtures";
import { INFO, capAnswer, gbHistoryKey, harvestFromTables, embedsFromPage, EMBED_URL, gbEnergy, loadTables, normalisePayment, parseScript, resolveRegion, PAGE_URL } from "./source";
import manifest from "./index";
import { InputError, SourceError } from "../../lib/http";
import { findSource } from "../../lib/registry";

const fetcher = async (url: string): Promise<string> => {
  if (url === PAGE_URL) return PAGE_HTML;
  const id = /inject\/([^/]+)\//.exec(url)?.[1] ?? "";
  if (SCRIPTS[id]) return SCRIPTS[id];
  throw new SourceError("Source returned HTTP 404", url, 404);
};

test("licence and type are Ofgem's OGL posted cap", () => {
  assert.equal(INFO.id, "gb-ofgem-energy");
  assert.equal(INFO.price_type, "posted_price");
  assert.match(INFO.licence, /Open Government Licence/);
  assert.match(INFO.attribution, /Open Government Licence v3\.0/);
  assert.match(INFO.limits, /CAP/);
});

test("embeds are read from the page in order, once each", () => {
  const e = embedsFromPage(PAGE_HTML + PAGE_HTML);
  assert.equal(e.length, 9);
  assert.deepEqual(e[0], { id: "YS_arnkBg", v: "59" });
  assert.equal(EMBED_URL("YS_arnkBg", "59"), "https://app.everviz.com/inject/YS_arnkBg/?v=59");
});

test("parseScript reads the real Direct Debit single-rate electricity table", () => {
  const t = parseScript(SCRIPTS["YS_arnkBg"])!;
  assert.equal(t.energy, "electricity");
  assert.equal(t.payment, "direct_debit");
  assert.equal(t.multi, false);
  assert.equal(t.quarter, "October to December 2026");
  assert.equal(t.prevQuarter, "July to September 2026");
  assert.equal(t.rows.length, 15);
  const gb = t.rows.find((r) => r.region === "Great Britain average")!;
  assert.deepEqual(gb, { region: "Great Britain average", standing_prev: 57.19, standing: 54.83, unit_prev: 26.11, unit: 26.32 });
});

test("multi-rate tables are recognised and kept apart", async () => {
  const tables = await loadTables(fetcher);
  assert.equal(tables.length, 9);
  assert.equal(tables.filter((t) => t.multi).length, 3);
  assert.equal(tables.filter((t) => !t.multi).length, 6);
});

test("default: GB average electricity by Direct Debit is 26.32 p/kWh, 54.83 p/day, a posted cap with no sample size", async () => {
  const a = await gbEnergy({ energy: "electricity" }, fetcher);
  assert.equal(a.status, "ok");
  assert.equal(a.price?.value, 0.2632);
  assert.equal(a.price?.currency, "GBP");
  assert.equal(a.price?.unit, "per kWh");
  assert.equal(a.sample_size, null);
  assert.equal(a.price_type, "posted_price");
  assert.deepEqual(a.period, { from: "2026-10-01", to: "2026-12-31" });
  assert.equal(a.statistic?.reference_period, "October to December 2026");
  assert.match(a.summary, /26\.32 pence per kWh/);
  assert.match(a.summary, /54\.83 pence a day/);
  assert.match(a.summary, /not what households paid/);
  const x = a.extra as any;
  assert.equal(x.standing_charge_pence_per_day, 54.83);
  assert.equal(x.previous_period.unit_rate_pence_per_kwh, 26.11);
  assert.equal(x.previous_period.unit_rate_change_percent, 0.8);
  assert.equal(x.all_payment_methods.length, 3);
  assert.equal(x.all_regions_cheapest_unit_rate_first.length, 14);
  assert.equal(x.all_regions_cheapest_unit_rate_first[0].region, "East Midlands");
});

test("gas, London, prepayment comes from the right table", async () => {
  const a = await gbEnergy({ energy: "gas", region: "London", payment_method: "prepayment" }, fetcher);
  assert.equal(a.status, "ok");
  const t = parseScript(SCRIPTS["FuJ6m75Bz"])!;
  const row = t.rows.find((r) => r.region === "London")!;
  assert.equal(a.price?.value, Math.round(row.unit * 100) / 10000);
  assert.equal((a.extra as any).region, "London");
  assert.equal((a.extra as any).payment_method, "prepayment");
  assert.match(a.summary, /gas in London/);
  assert.match(String((a.extra as any).vat), /5% VAT/);
});

test("towns map to their usual region; unknown places and payment methods are refused with the valid names", () => {
  assert.equal(resolveRegion("Manchester"), "North Western England");
  assert.equal(resolveRegion("Glasgow"), "Southern Scotland");
  assert.equal(resolveRegion("Cardiff, Wales"), "Southern Wales");
  assert.equal(resolveRegion("yorkshire"), "Yorkshire");
  assert.equal(resolveRegion("Merseyside & Northern Wales"), "Merseyside and Northern Wales");
  assert.equal(resolveRegion(""), "Great Britain average");
  assert.throws(() => resolveRegion("Belfast"), (e: any) => e instanceof InputError && /14 Ofgem regions/.test(e.message));
  assert.throws(() => resolveRegion("Scotland"), InputError);
  assert.equal(normalisePayment("Direct Debit"), "direct_debit");
  assert.equal(normalisePayment("prepay"), "prepayment");
  assert.throws(() => normalisePayment("cash"), InputError);
});

test("a changed page layout fails loudly, not silently", async () => {
  await assert.rejects(loadTables(async () => "<html>no tables</html>"), /needs updating/);
  const bad = SCRIPTS["YS_arnkBg"].replace("26.32 pence per kWh", "26.32 p/kWh");
  assert.throws(() => parseScript(bad), /expected/);
  assert.throws(() => parseScript(SCRIPTS["YS_arnkBg"].replace("October to December 2026", "Autumn")), /columns/);
});

test("registry: GB household energy routes to this source, business to the DESNZ source", () => {
  assert.equal(manifest.info.id, "gb-ofgem-energy");
  assert.equal(findSource("energy", "GB", { energy: "electricity" } as any)?.info.id, "gb-ofgem-energy");
  assert.equal(findSource("energy", "GB", { energy: "electricity", sector: "business" } as any)?.info.id, "gb-desnz-energy-business");
});

test("harvest stores the current quarter's unit rate per region, energy and payment method, with no invented count", async () => {
  const h = harvestFromTables(await loadTables(fetcher));
  assert.equal(h.date, "2026-10-01");
  assert.equal(h.currency, "GBP");
  assert.equal(h.unit, "per kWh");
  assert.equal(h.rows.length, 15 * 3 * 2);
  const avg = h.rows.find((r) => r.area === "ALL" && r.item === "electricity/direct_debit")!;
  assert.equal(avg.median, 0.2632);
  assert.ok(Number.isNaN(avg.n), "n is NO_COUNT, never a made-up number");
});

test("the harvested figure equals the live answer", async () => {
  const h = harvestFromTables(await loadTables(fetcher));
  for (const [region, area] of [["London", "London"], ["Great Britain average", "ALL"]] as const) {
    for (const energy of ["electricity", "gas"] as const) {
      const live = await gbEnergy({ energy, region, payment_method: "prepayment" }, fetcher);
      const row = h.rows.find((r) => r.area === area && r.item === `${energy}/prepayment`)!;
      assert.equal(row.median, live.price?.value);
    }
  }
});

test("history key maps a request to the library row", () => {
  assert.deepEqual(gbHistoryKey({ energy: "gas" }), { area: "ALL", item: "gas/direct_debit", label: "Great Britain average, Direct Debit" });
  assert.equal(gbHistoryKey({ energy: "electricity", gb_region: "Glasgow", payment_method: "prepay" })?.area, "Southern Scotland");
  assert.equal(gbHistoryKey({ energy: "oil" }), null);
});
