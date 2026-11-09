// Fixture aquatic-2026-11-09.json: real rows of the MOA fishery trading feed (trading days 5, 6 and 9 Nov 2026, a few species plus frozen/other/zero rows), captured 2026-11-09.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { INFO, answerFromRows, harvestFromRows, minguoToIso, newestFullDay, parseRows, resolveProduct, twFish, twHarvest, twHistoryKey } from "./source";

const JSON_ROWS = JSON.parse(readFileSync(new URL("./fixtures/aquatic-2026-11-09.json", import.meta.url), "utf8"));
const fetcher = async () => JSON_ROWS;

test("Minguo dates", () => {
  assert.equal(minguoToIso("1151109"), "2026-11-09");
  assert.equal(minguoToIso("991231"), "2010-12-31");
  assert.equal(minguoToIso("x"), null);
  assert.equal(minguoToIso("1151309"), null);
});

test("parse drops frozen, other, zero price and zero volume rows", () => {
  const rows = parseRows(JSON_ROWS);
  assert.ok(rows.length > 50);
  assert.ok(rows.every((r) => r.avg > 0 && r.qty > 0 && !/凍/.test(r.name) && !r.name.startsWith("其他")));
  assert.ok(rows.length < JSON_ROWS.length);
});

test("a changed layout is an error", () => {
  assert.throws(() => parseRows({ RS: "OK" }), /changed the layout/);
  assert.throws(() => parseRows([{ a: 1 }]), /expected fields/);
});

test("tilapia: range over market averages in NT$ per kg", async () => {
  const a = await twFish({ product: "Tilapia" }, fetcher);
  assert.equal(a.status, "ok");
  assert.equal(a.price_type, "transaction");
  assert.equal(a.price?.unit, "per kg");
  assert.equal(a.price?.currency, "TWD");
  assert.ok(a.price!.value > 30 && a.price!.value < 90); // tilapia about NT$50 to 60 per kg wholesale
  assert.ok((a.sample_size ?? 0) >= 5);
  assert.match(a.summary, /Taiwan/);
  assert.equal(a.source.id, INFO.id);
});

test("aliases and Taiwanese names resolve; unknown species is a 400-style error", async () => {
  assert.equal(resolveProduct("shrimp")?.key, "white shrimp");
  assert.equal(resolveProduct("吳郭魚")?.key, "tilapia");
  assert.equal(resolveProduct("unobtainium"), null);
  await assert.rejects(() => twFish({ product: "unobtainium" }, async () => { throw new Error("must not fetch"); }), /not one of the species/);
  await assert.rejects(() => twFish({ product: " " }), /product is required/);
});

test("milkfish does not mix in milkfish belly (exact names)", () => {
  const rows = parseRows(JSON_ROWS);
  const a = answerFromRows(rows, { product: "milkfish" });
  const belly = answerFromRows(rows, { product: "milkfish belly" });
  assert.notEqual(a.price!.value, belly.price!.value);
});

test("newest three trading days are used", () => {
  const a = answerFromRows(parseRows(JSON_ROWS), { product: "salmon" });
  const days = a.extra!.trading_days as string[];
  assert.ok(days.length >= 1 && days.length <= 3);
  assert.equal(a.period.to, days[days.length - 1]);
});

test("harvest: one national row per species with 5+ records, on the newest full day (not the partial 9 Nov)", async () => {
  const rows = parseRows(JSON_ROWS);
  const day = newestFullDay(rows);
  assert.equal(day, "2026-11-06");
  const h = harvestFromRows(rows, day!);
  assert.equal(h.currency, "TWD");
  assert.ok(h.rows.length >= 3);
  assert.ok(h.rows.every((r) => r.area === "ALL" && r.n >= 5 && r.low <= r.median && r.median <= r.high));
  const h2 = await twHarvest(fetcher);
  assert.equal(h2.date, "2026-11-06");
});

test("history key", () => {
  assert.deepEqual(twHistoryKey({ country: "TW", product: "squid" }), { area: "ALL", item: "swordtip squid", label: "Taiwan wholesale swordtip squid" });
  assert.equal(twHistoryKey({ country: "JP", product: "squid" }), null);
});
