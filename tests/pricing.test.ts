import test from "node:test";
import assert from "node:assert/strict";
import { pricingFacts, usd } from "../lib/pricing";
import { PREMIUM } from "../lib/payments/prices";
import { buildLlmsTxt, buildOpenApi } from "../lib/openapi";

test("pricing facts read prices from lib/payments/prices.ts and never hold a wallet or key", () => {
  const f = pricingFacts("https://proofprice.com");
  const check = f.premium.find((x) => x.id === "check")!;
  assert.equal(check.price_usd, PREMIUM.check.microUsd / 1_000_000);
  assert.equal(check.free_calls_per_day, PREMIUM.check.freePerDay);
  assert.equal(usd(100_000), "USD 0.10");
  assert.equal(f.payment_mode, "off");
  assert.ok(!/0x[0-9a-fA-F]{40}/.test(JSON.stringify(f)));
  assert.ok(f.free_forever.length >= 3);
});

test("llms.txt and openapi.json point at /pricing", () => {
  assert.match(buildLlmsTxt("https://proofprice.com"), /https:\/\/proofprice\.com\/pricing/);
  assert.match(JSON.stringify(buildOpenApi("https://proofprice.com")), /\/pricing\.json/);
});
