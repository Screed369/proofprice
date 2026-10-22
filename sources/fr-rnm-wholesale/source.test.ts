// Fixture fixtures/carotte-2026-10-22.html: the real RNM page https://rnm.franceagrimer.fr/prix?CAROTTE, captured 2026-10-22 via the GitHub-hosted probe.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { answerFromQuotes, frWholesale, median, parseDmy, parseProductPage, resolveProduct, usable } from "./source";

const HTML = readFileSync(new URL("./fixtures/carotte-2026-10-22.html", import.meta.url), "utf8");

test("dates and products", () => {
  assert.equal(parseDmy("20/10/26"), "2026-10-20");
  assert.equal(parseDmy("x"), null);
  assert.equal(resolveProduct("Carrots"), "CAROTTE");
  assert.equal(resolveProduct("carotte"), "CAROTTE");
  assert.equal(resolveProduct("pomme de terre"), "POMME-DE-TERRE");
  assert.equal(resolveProduct("durian"), null);
});

test("parses the market blocks of the real page", () => {
  const q = parseProductPage(HTML);
  assert.ok(q.length > 60);
  const lyon = q.find((x) => x.market.startsWith("Marché de Lyon-Corbas") && x.label.trim() === "CAROTTE Rhône-Alpes");
  assert.ok(lyon);
  assert.equal(lyon!.price, 1.15);
  assert.equal(lyon!.min, 1.1);
  assert.equal(lyon!.max, 1.2);
  assert.equal(lyon!.date, "2026-10-20");
  assert.equal(lyon!.stage, "Marché de producteurs");
});

test("drops retail, organic and bunch lines", () => {
  const all = parseProductPage(HTML);
  const u = usable(all);
  assert.ok(u.length < all.length);
  assert.ok(u.every((x) => x.stage !== "Détail" && !/biologique/i.test(x.label) && !/\(la botte\)/.test(x.label)));
});

test("carrot answer: median of per-kg wholesale quotes, plausible, posted, no sample size", async () => {
  const a = await frWholesale({ product: "carrot" }, async () => HTML);
  assert.equal(a.status, "ok");
  assert.equal(a.price_type, "posted_price");
  assert.equal(a.price?.currency, "EUR");
  assert.equal(a.price?.unit, "per kg");
  assert.ok(a.price!.value > 0.3 && a.price!.value < 3);
  assert.ok(a.price!.min! <= a.price!.value && a.price!.value <= a.price!.max!);
  assert.equal(a.sample_size, null);
  assert.ok((a.extra!.quote_count as number) >= 5);
  assert.match(a.summary, /France/);
});

test("median helper", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
});

test("only the last 7 days before the newest quote count", () => {
  const q = parseProductPage(HTML);
  const old = { ...q[0], date: "2026-01-01", price: 99, stage: "Grossistes", label: "CAROTTE X", market: "Old" };
  const a = answerFromQuotes([...q, old], { product: "carrot", slug: "CAROTTE" });
  assert.ok(a.price!.max! < 99);
});

test("unknown product and a changed page are explained", async () => {
  const a = await frWholesale({ product: "durian" }, async () => HTML);
  assert.equal(a.status, "no_matches");
  await assert.rejects(() => frWholesale({ product: "carrot" }, async () => "<html>nope</html>"), /changed the layout/);
  await assert.rejects(() => frWholesale({ product: "" }), /product is required/);
});
