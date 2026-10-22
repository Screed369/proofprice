import test from "node:test";
import assert from "node:assert/strict";
import { CLEARED_FOR_PAID } from "../lib/payments/cleared";
import { paidUseSummary, PAYMENT_MODE_TEXT } from "../lib/site/status";
import { sourceCards } from "../lib/site/sources";

test("status payments section: cleared + free-only add up to all sources; unknown ids never count", () => {
  const cards = sourceCards();
  const s = paidUseSummary(cards, CLEARED_FOR_PAID);
  assert.equal(s.cleared.length + s.freeOnlyCount, cards.length);
  for (const c of s.cleared) assert.ok(CLEARED_FOR_PAID.has(c.id));
  assert.equal(paidUseSummary(cards, new Set(["not-a-source"])).cleared.length, 0);
  assert.deepEqual(Object.keys(PAYMENT_MODE_TEXT).sort(), ["mainnet", "off", "testnet"]);
});
