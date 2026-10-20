// Fixture wholesale-2026-10-20.csv: the first 30 KB of the real AFCD file (days 1 to 4 Oct 2026), captured 2026-10-20 via the GitHub-hosted probe.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CATTY_KG, INFO, hkWholesale, hkWholesaleFromRows, matchSeries, parseCsv, parseDmy, seriesOf } from "./source";

const CSV = readFileSync(new URL("./fixtures/wholesale-2026-10-20.csv", import.meta.url), "utf8");

test("parses dates and drops dashes, headers and no-supply rows", () => {
  assert.equal(parseDmy("1/10/2026"), "2026-10-01");
  assert.equal(parseDmy("31/12/2026"), "2026-12-31");
  assert.equal(parseDmy("x"), null);
  const rows = parseCsv(CSV);
  assert.ok(rows.length > 50);
  assert.ok(rows.every((r) => r.price > 0 && /^2026-10-0\d$/.test(r.date)));
  // Mainland live chicken is "-" on 1 Oct, local is 25
  const chicken = rows.filter((r) => r.food === "Live chicken" && r.date === "2026-10-01");
  assert.deepEqual(chicken.map((r) => [r.supply, r.price]), [["Local", 25]]); // the Local 19 row is a farm-gate price and is left out
});

test("a changed layout is an error", () => {
  assert.throws(() => parseCsv("a,b,c\n1,2,3"), /changed the layout/);
});

test("live pig: HK$ per catty converted to per kg", async () => {
  const a = await hkWholesale({ product: "pork" }, async () => CSV);
  assert.equal(a.status, "ok");
  assert.equal(a.price_type, "posted_price");
  assert.equal(a.price?.unit, "per kg");
  assert.ok(Math.abs(a.price!.value - (a.extra!.published_price as number) / CATTY_KG) < 0.01);
  assert.ok(a.price!.value > 14 && a.price!.value < 20); // live pig about HK$17 per kg
  assert.equal(a.sample_size, null);
  assert.equal(a.extra?.published_unit, "HK$ per catty");
  assert.match(a.summary, /Hong Kong/);
});

test("newest published day wins and the earlier days are listed", () => {
  const a = hkWholesaleFromRows(parseCsv(CSV), { product: "live pig" });
  const days = (a.extra?.recent_days as any[]).map((d) => d.date);
  assert.equal(a.period.to, days[0]);
  assert.deepEqual(days, [...days].sort().reverse());
  assert.ok(days.length >= 2);
});

test("eggs stay per egg and keep their variants", () => {
  const a = hkWholesaleFromRows(parseCsv(CSV), { product: "eggs" });
  assert.equal(a.price?.unit, "per egg");
  assert.ok(a.price!.value < 5);
  assert.ok(Array.isArray(a.extra?.other_matches));
});

test("chicken: only the wholesale price (HK$25), not the farm-gate price (HK$19) or the unpriced Mainland line", () => {
  const s = matchSeries(seriesOf(parseCsv(CSV)), "chicken");
  assert.equal(s.length, 1);
  assert.equal(s[0].supply, "Local");
  assert.ok(s[0].rows.every((r) => r.price === 25));
});

test("unknown product gives no_matches that lists what exists", () => {
  const a = hkWholesaleFromRows(parseCsv(CSV), { product: "durian" });
  assert.equal(a.status, "no_matches");
  assert.match(String(a.extra?.note), /Live pig/i);
});

test("missing product is an input error", async () => {
  await assert.rejects(() => hkWholesale({ product: " " }, async () => CSV), /product is required/);
});

test("licence and attribution are filled in", () => {
  assert.match(INFO.attribution, /AFCD/);
  assert.match(INFO.licence_url, /data.gov.hk/);
});
