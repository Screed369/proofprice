import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import manifest from "./index";
import aemoPower from "../au-aemo-power/index";
import { answerFromHubDays, dayRows, parseExPost, parseGasDate, resolveHub, sttmBackfill, sttmGas, sttmHarvest, sttmHistoryKey } from "./source";

// Fixture: the live AEMO STTM ex post file, fetched 2026-10-30 (7 gas days x 3 hubs).
const csv = readFileSync(new URL("./fixtures/int657.csv", import.meta.url), "utf8");
const f = { text: async () => csv };

test("parses dates and the file", () => {
  assert.equal(parseGasDate("29 Oct 2026"), "2026-10-29");
  assert.equal(parseGasDate("nonsense"), null);
  const d = parseExPost(csv);
  assert.equal(d.length, 21);
  assert.deepEqual(d[0], { date: "2026-10-23", hub: "ADL", price: 11.9989 });
  assert.deepEqual(d[d.length - 1], { date: "2026-10-29", hub: "SYD", price: 12.5583 });
});

test("clear error when the layout changes", () => {
  assert.throws(() => parseExPost("a,b\n1,2"), /changed the columns/);
  assert.throws(() => parseExPost("gas_date,hub_identifier,ex_post_imbalance_price\n"), /no hub prices/);
});

test("resolves hubs and aliases", () => {
  assert.equal(resolveHub().code, "SYD");
  assert.equal(resolveHub("Queensland").code, "BRI");
  assert.equal(resolveHub("adl").code, "ADL");
  assert.throws(() => resolveHub("Perth"), /not available/);
});

test("answers Sydney with 7 records in AUD per GJ", async () => {
  const a = await sttmGas({}, f);
  assert.equal(a.status, "ok");
  assert.equal(a.sample_size, 7);
  assert.equal(a.price?.currency, "AUD");
  assert.equal(a.price?.unit, "per GJ");
  assert.ok(Math.abs((a.price?.median ?? 0) - 12.19) < 0.05);
  assert.deepEqual(a.period, { from: "2026-10-23", to: "2026-10-29" });
});

test("fewer than 5 records is not published as a range", () => {
  const a = answerFromHubDays(parseExPost(csv), { hub: "ADL", hubLabel: "Adelaide", days: 3 });
  assert.notEqual(a.status, "ok");
});

test("harvest, backfill and history key", async () => {
  const h = await sttmHarvest(f);
  assert.equal(h.date, "2026-10-29");
  assert.deepEqual(h.rows.map((r) => r.area), ["ADL", "BRI", "SYD"]);
  assert.ok(Number.isNaN(h.rows[0].n));
  assert.equal(dayRows(parseExPost(csv), "2026-10-23").length, 3);
  const b = await sttmBackfill("2026-10-25", "2026-10-27", f);
  assert.deepEqual(b.periods.map((p) => p.period), ["2026-10-25", "2026-10-26", "2026-10-27"]);
  assert.equal(sttmHistoryKey("Brisbane")?.area, "BRI");
  assert.equal(sttmHistoryKey("Perth"), null);
});

test("serves() splits gas from electricity for AU in both folders", () => {
  assert.equal(manifest.serves?.({ country: "AU", commodity: "gas" }), true);
  assert.equal(manifest.serves?.({ country: "AU" }), false);
  assert.equal(aemoPower.serves?.({ country: "AU", commodity: "gas" }), false);
  assert.equal(aemoPower.serves?.({ country: "AU" }), true);
  assert.equal(aemoPower.serves?.({ country: "AU", commodity: "electricity" }), true);
});
