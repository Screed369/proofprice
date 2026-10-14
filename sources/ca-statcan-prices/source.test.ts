// Tests for Canada grocery prices (Statistics Canada table 18-10-0245-01). Fixtures are real WDS replies captured on 2026-10-14.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeWds } from "../_ca-statcan/fake-wds";
import { PRICES_DATA, PRICES_META } from "./fixtures";
import { INFO, ITEMS, caStatcanPrices, caPricesMethod, exampleItems } from "./source";
import manifest from "./index";

const TODAY = new Date("2026-10-14T12:00:00Z");
const calls: { path: string; body: unknown }[] = [];
const ask = (o: { item: string; region?: string }, today = TODAY) => {
  const post = fakeWds({ meta: PRICES_META, data: PRICES_DATA, calls });
  return caStatcanPrices({ ...o, today } as any, post);
};

test("milk: the Canada average for 2 litres in August 2026, with the change on a year earlier", async () => {
  calls.length = 0;
  const a = await ask({ item: "milk" });
  assert.equal(a.status, "ok");
  assert.equal(a.price?.value, 5.49);
  assert.equal(a.price?.currency, "CAD");
  assert.equal(a.price?.unit, "per 2 litres");
  assert.equal(a.price?.measure, "average");
  assert.equal(a.price?.median, null);
  assert.equal(a.price?.typical_low, null);
  assert.equal(a.sample_size, null);
  assert.equal(a.price_type, "official_statistic");
  assert.deepEqual(a.period, { from: "2026-08-01", to: "2026-08-31" });
  assert.equal(a.statistic?.reference_period, "2026-08");
  const x = a.extra as any;
  assert.equal(x.change_on_year_earlier.reference_month, "2025-08");
  assert.equal(x.change_on_previous_month.reference_month, "2026-07");
  assert.equal(x.change_on_previous_month.value, 5.53);
  assert.match(a.summary, /Milk, 2 litres/);
  assert.match(a.summary, /Official average published by Statistics Canada for 2026-08/);
  assert.match(x.attribution_notice, /^Source: Statistics Canada, .*, August 2026\. Reproduced and distributed on an "as is" basis with the permission of Statistics Canada\./);
  const dataCall = calls.find((c) => c.path === "getDataFromCubePidCoordAndLatestNPeriods")!;
  assert.ok((dataCall.body as any[]).every((b) => b.latestN === 14 && b.productId === 18100245));
});

test("eggs: a dozen, Canada", async () => {
  const a = await ask({ item: "eggs" });
  assert.equal(a.status, "ok");
  assert.equal(a.price?.value, 4.83);
  assert.equal(a.price?.unit, "per dozen");
});

test("a province, a city (answered with its province, and says so) and a territory", async () => {
  const on = await ask({ item: "milk", region: "Ontario" });
  assert.equal(on.price?.value, 5.92);
  assert.equal((on.query as any).region, "Ontario");
  const city = await ask({ item: "milk", region: "Toronto" });
  assert.equal(city.price?.value, on.price?.value);
  assert.match(city.statistic?.note ?? "", /provincial averages, not city averages/);
  const yt = await ask({ item: "milk", region: "Yukon" });
  assert.equal(yt.price?.value, 5.78);
  assert.match(yt.statistic?.note ?? "", /start with September 2025/);
});

test("an item or region Statistics Canada does not publish is no_matches or a clear InputError", async () => {
  const none = await ask({ item: "unicorn steak" });
  assert.equal(none.status, "no_matches");
  assert.match(none.summary, /no standard item/);
  await assert.rejects(ask({ item: "milk", region: "Atlantis" }), /is not a region in this table/);
  await assert.rejects(ask({ item: "milk", region: "Nunavut" }), /does not publish average prices for Nunavut/);
  await assert.rejects(ask({ item: "" }), /item is required/);
});

test("old data is flagged plainly when the newest month is 3 or more months behind", async () => {
  const a = await ask({ item: "milk" }, new Date("2027-01-14T12:00:00Z"));
  assert.match(a.statistic?.note ?? "", /Old data: .* 5 months ago/);
  assert.match(a.summary, /Old data: 5 months old/);
});

test("manifest: groceries tool, CA, milk then eggs are the smoke tests, Open Licence quoted with its URL", () => {
  assert.equal(manifest.category, "groceries");
  assert.deepEqual(manifest.countries, ["CA"]);
  assert.equal(manifest.examples[0].params.item, "milk");
  assert.equal(manifest.examples[1].params.item, "eggs");
  assert.equal(INFO.licence_url, "https://www.statcan.gc.ca/en/terms-conditions/open-licence");
  assert.match(INFO.licence, /use, reproduce, publish, freely distribute, or sell the Information/);
  assert.equal(ITEMS.length >= 100, true);
  assert.match(exampleItems(5), /milk/);
  assert.match(caPricesMethod(), /No range is calculated/);
});
