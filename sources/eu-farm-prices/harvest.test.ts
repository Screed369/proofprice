import { test } from "node:test";
import assert from "node:assert/strict";
import { SourceError } from "../../lib/http";
import { NO_COUNT } from "../../lib/stats";
import { SOURCE_PLUGINS } from "../../lib/registry";
import { euFarmHarvest, farmHistoryKey, harvestRow, HARVEST_PAIRS, readFarm } from "./source";
import { resolveProduct } from "./products";
import * as F from "./fixtures";

const NOW = new Date("2026-10-14T12:00:00Z");
const noSleep = async () => {};

test("eu-farm-prices harvest: weekly pig price becomes one euro-per-kg row with no count", () => {
  const product = resolveProduct("pig");
  const r = readFarm(F.PIG_IE_YEAR, { product, country: "IE", geo: "IE" });
  assert.ok("latest" in r);
  const kept = harvestRow(r as any, "IE")!;
  assert.equal(kept.row.area, "IE");
  assert.equal(kept.row.item, "pig");
  assert.equal(kept.row.n, NO_COUNT);
  assert.equal(kept.row.median, kept.row.low);
  assert.equal(kept.row.median, Math.round(((r as any).latest.value / 100) * 10000) / 10000);
  assert.ok(kept.row.median > 0.5 && kept.row.median < 5, `per kg ${kept.row.median}`);
});

test("eu-farm-prices harvest: monthly series (raw milk) are not kept", () => {
  const product = resolveProduct("milk");
  const r = readFarm(F.MILK_IE, { product, country: "IE", geo: "IE" });
  assert.ok("latest" in r);
  assert.equal(harvestRow(r as any, "IE"), null);
});

test("eu-farm-prices harvest: a full run writes rows, stops after repeated failures and fails only with nothing", async () => {
  const ok = await euFarmHarvest({ now: NOW, sleep: noSleep, pairs: [["IE", ["pig"]], ["FR", ["beef"]]], fetcher: async (u) => (/pigmeat/.test(u) ? F.PIG_IE_YEAR : F.BEEF_FR_YEAR) });
  assert.equal(ok.currency, "EUR");
  assert.equal(ok.unit, "per kg");
  assert.match(ok.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(ok.rows.length >= 1);

  let calls = 0;
  const dead = euFarmHarvest({ now: NOW, sleep: noSleep, pairs: HARVEST_PAIRS, fetcher: async () => { calls++; throw new SourceError("HTTP 429"); } });
  await assert.rejects(dead, SourceError);
  assert.ok(calls <= 4, `asked ${calls} times against a throttling portal`);

  const part = await euFarmHarvest({
    now: NOW, sleep: noSleep, pairs: [["IE", ["pig"]], ["FR", ["beef"]], ["DE", ["wheat"]]],
    fetcher: async (u) => { if (/pigmeat/.test(u)) return F.PIG_IE_YEAR; throw new SourceError("HTTP 500"); },
  });
  assert.ok(part.rows.length >= 1, "one good product is enough to keep a copy");
});

test("eu-farm-prices harvest: every harvested pair names a real country and product, and the key matches the request", () => {
  for (const [country, products] of HARVEST_PAIRS) {
    for (const key of products) {
      assert.equal(resolveProduct(key).key, key, `${key} is a catalogue key`);
      const k = farmHistoryKey({ country, product: key });
      assert.ok(k && k.area === country && k.item === key, `${country}/${key}`);
    }
  }
  assert.deepEqual(farmHistoryKey({ country: "ie", product: "Pigs" })?.item, "pig");
  assert.equal(farmHistoryKey({ country: "GB", product: "pig" }), null);
  assert.equal(farmHistoryKey({ country: "IE", product: "unobtainium" }), null);
});

test("eu-farm-prices: manifest declares the copy so runCategory can answer stale-if-error", () => {
  const src = SOURCE_PLUGINS.find((s) => s.info.id === "eu-farm-prices")!;
  assert.equal(typeof src.harvest, "function");
  assert.equal(typeof src.historyKey, "function");
  assert.equal(src.referenceDates, true);
  assert.equal(src.nominalCounts, true);
});
