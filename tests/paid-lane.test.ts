// The pay-first door (GET /api/v1/paid/<category>), the licence batch of 14 Nov 2026 and the private paid-wallet counting.
// No network and no real keys: the facilitator is a mock, wallets are public test addresses, official sources are stand-ins.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { readGateConfig } from "../lib/payments/config";
import { buildRequirements, gateCall, paymentRequiredBody, facilitatorPayload } from "../lib/payments/gate";
import { gatedRest, setFacilitatorForTests } from "../lib/payments";
import type { Facilitator } from "../lib/payments/facilitator";
import { bazaarExtension, descriptionFor, exampleFor } from "../lib/payments/discovery";
import { PREMIUM } from "../lib/payments/prices";
import { allCleared, CLEARED_FOR_PAID } from "../lib/payments/cleared";
import { resetQuota } from "../lib/payments/quota";
import { buildLookup, DESCRIPTION_MAX, lookupDescription } from "../lib/paid-lookup";
import { lookupSourcesFromUrl, historySourcesFromUrl, checkSourcesFromUrl } from "../lib/premium-sources";
import { CATEGORIES, categoryByRestPath, SOURCES } from "../lib/registry";
import { buildAnswer } from "../lib/answer";
import { summarise } from "../lib/stats";
import { memoryStore, ownWallets, pendingPaidSummary, recordPaid, reducePaid, resetUsage, setUsageStore, flushUsage, usageReport } from "../lib/usage";
import { GET as paidGet } from "../app/api/v1/paid/[category]/route";

const PAY_TO = "0x1111111111111111111111111111111111111111";
const PAYER = "0x2222222222222222222222222222222222222222";
const OWN = "0x3333333333333333333333333333333333333333";
const ON = { PROOFPRICE_X402_ENABLED: "true", PROOFPRICE_X402_PAY_TO: PAY_TO };
const cfg = readGateConfig(ON)!;
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64");
const payment = (key: "lookup" | "check" | "history" = "lookup", from = PAYER) =>
  b64({ x402Version: 2, accepted: buildRequirements(cfg, key), payload: { signature: "0xabc", authorization: { from } } });

function mock() {
  const calls: { op: string; payload: any }[] = [];
  const f: Facilitator = {
    async verify(p) { calls.push({ op: "verify", payload: p }); return { isValid: true }; },
    async settle(p) { calls.push({ op: "settle", payload: p }); return { success: true, transaction: "0xdeadbeef", network: cfg.caip2 }; },
  };
  return { f, calls };
}
const base = (over: Record<string, unknown> = {}) => ({
  cfg, key: "lookup" as const, callerAddress: "203.0.113.9", resourceUrl: "https://proofprice.com/api/v1/paid/fuel", run: async () => ({ status: "ok" }), chargeable: () => true, ...over,
});

beforeEach(() => { resetQuota(); setFacilitatorForTests(null); });

// ---------- licence batch ----------

test("licence batch: the top fuel sources FR and IT are cleared, ES is not; every cleared id is a real source", () => {
  assert.equal(allCleared(["fr-fuel"]), true);
  assert.equal(allCleared(["it-fuel"]), true);
  assert.equal(allCleared(["es-fuel"]), false);
  assert.equal(allCleared(["eu-oil-bulletin"]), true); // IE and DE fuel
  for (const id of CLEARED_FOR_PAID) assert.ok(SOURCES[id], `${id} is not a source`);
});

// ---------- gate with freePerDay 0 ----------

test("pay-first: price is USD 0.01 and there is no free allowance", () => {
  assert.equal(PREMIUM.lookup.microUsd, 10_000);
  assert.equal(PREMIUM.lookup.freePerDay, 0);
});

test("pay-first gate: 402 on the very first call, nothing run, facilitator untouched", async () => {
  const { f, calls } = mock();
  let ran = 0;
  const o = await gateCall({ ...base({ run: async () => { ran++; return { status: "ok" }; } }), facilitator: f });
  assert.equal(o.kind, "denied");
  if (o.kind !== "denied") return;
  assert.equal(o.status, 402);
  assert.equal(ran, 0);
  assert.equal(calls.length, 0);
  const body: any = o.body;
  assert.equal(body.accepts[0].amount, "10000");
  assert.match(body.notice, /paid from the first call/);
  assert.match(body.notice, /basic look-up without trend stays free/);
  assert.ok(body.resource.description.length <= DESCRIPTION_MAX);
});

test("pay-first gate: 200 after a valid mock payment, settled once, payer never echoed", async () => {
  const { f, calls } = mock();
  const o = await gateCall({ ...base(), facilitator: f, paymentHeader: payment() });
  assert.equal(o.kind, "served");
  if (o.kind !== "served") return;
  assert.equal(o.paid, true);
  assert.deepEqual(calls.map((c) => c.op), ["verify", "settle"]);
  assert.ok(!JSON.stringify(o).includes(PAYER));
});

test("pay-first gate: insufficient_data / no_matches / errors are never charged", async () => {
  const { f, calls } = mock();
  const o = await gateCall({ ...base({ run: async () => ({ status: "insufficient_data" }), chargeable: () => false }), facilitator: f, paymentHeader: payment() });
  assert.equal(o.kind, "served");
  if (o.kind !== "served") return;
  assert.equal(o.paid, false);
  assert.equal(o.headers["x-proofprice-charged"], "no");
  assert.deepEqual(calls.map((c) => c.op), ["verify"], "verified, never settled");
});

test("pay-first REST: an uncleared source is served free with the note, never a 402, payment ignored", async () => {
  Object.assign(process.env, ON);
  try {
    const m = mock();
    setFacilitatorForTests(m.f);
    const answer = () => new Response(JSON.stringify({ answer: { status: "ok" } }), { status: 200 });
    for (const withPayment of [false, true]) {
      const req = new Request("https://proofprice.com/api/v1/paid/fuel?country=MX", { headers: withPayment ? { "payment-signature": payment() } : {} });
      const r = await gatedRest("lookup", req, async () => answer(), () => ["mx-fuel"]);
      assert.equal(r.status, 200);
      assert.equal(r.headers.get("x-proofprice-charged"), "no");
      assert.match(r.headers.get("x-proofprice-note") ?? "", /not yet cleared/);
    }
    assert.equal(m.calls.length, 0);
    // a cleared source is gated from the first call
    const r = await gatedRest("lookup", new Request("https://proofprice.com/api/v1/paid/fuel?country=FR"), async () => answer(), () => ["fr-fuel"]);
    assert.equal(r.status, 402);
  } finally {
    for (const k of Object.keys(ON)) delete process.env[k];
    setFacilitatorForTests(null);
  }
});

test("the real paid route: gate off serves a bundle path; gate on with a cleared source asks for payment on the first call", async () => {
  Object.assign(process.env, ON);
  try {
    const m = mock();
    setFacilitatorForTests(m.f);
    const ctx = (category: string) => ({ params: Promise.resolve({ category }) });
    const r = await paidGet(new Request("https://proofprice.com/api/v1/paid/fuel?country=IT&area=Roma&fuel=diesel"), ctx("fuel"));
    assert.equal(r.status, 402, "it-fuel is cleared");
    const body: any = await r.json();
    assert.equal(body.accepts[0].amount, "10000");
    assert.ok(body.extensions.bazaar.info.input.queryParams.country);
    // an unknown category is a plain 404, free
    assert.equal((await paidGet(new Request("https://proofprice.com/api/v1/paid/nope?country=IT"), ctx("nope"))).status, 404);
    // a country with no cleared source is served free (here it fails on its own parameters, but never 402)
    const es = await paidGet(new Request("https://proofprice.com/api/v1/paid/fuel?country=ES&fuel=diesel"), ctx("fuel"));
    assert.notEqual(es.status, 402);
    assert.equal(m.calls.length, 0);
  } finally {
    for (const k of Object.keys(ON)) delete process.env[k];
    setFacilitatorForTests(null);
  }
});

// ---------- the bundle ----------

function fuelAnswer() {
  return buildAnswer({
    source: SOURCES["fr-fuel"],
    query: { country: "FR", department: "69", fuel: "diesel" },
    summary: summarise(Array.from({ length: 40 }, (_, i) => 1.6 + i * 0.01)),
    currency: "EUR", unit: "per litre", period: { from: "2026-10-14", to: "2026-10-14" }, method: "m", describe: () => "Diesel.",
  });
}

test("bundle: { answer, trend, check, notice }; answer unchanged, trend from history, check only with a price", async () => {
  const cat = categoryByRestPath("fuel")!;
  const answer = fuelAnswer();
  const trend: any = { status: "ok", series: [{ date: "2026-10-13", median: 1.7 }, { date: "2026-10-14", median: 1.8 }] };
  const deps = { runCategory: async () => answer, runHistory: () => trend };
  const q = (s: string) => new URLSearchParams(s);
  const none = await buildLookup(cat, q("country=FR&department=69&fuel=diesel"), {}, new Date("2026-10-14T12:00:00Z"), deps);
  assert.deepEqual(Object.keys(none).sort(), ["answer", "check", "notice", "trend"]);
  assert.equal(none.answer, answer, "the normal answer, untouched");
  assert.equal(none.trend, trend);
  assert.equal(none.check, null);
  assert.match(none.notice, /free at \/api\/v1\/fuel/);
  const withPrice = await buildLookup(cat, q("country=FR&department=69&fuel=diesel&price=1.95&days=14"), {}, new Date("2026-10-14T12:00:00Z"), deps);
  assert.ok(withPrice.check);
  assert.equal(withPrice.check!.input.price, 1.95);
  assert.equal(withPrice.check!.answer, answer);
});

test("bundle: a category with no history gives trend null; the trend length is not a category parameter", async () => {
  const noHistory = CATEGORIES.find((c) => !c.history)!;
  let seen: any = null;
  const answer = fuelAnswer();
  await buildLookup(noHistory, new URLSearchParams("country=IE&days=5"), {}, new Date(), { runCategory: async (_c, p) => { seen = p; return answer; } }).catch(() => {});
  assert.ok(!seen || !("days" in seen), "days is stripped before the category sees it");
  const cat = categoryByRestPath("fuel")!;
  const b = await buildLookup(cat, new URLSearchParams("country=FR&department=69&fuel=diesel"), {}, new Date(), {
    runCategory: async () => answer,
    runHistory: () => { throw new (require("../lib/http").InputError)("no history here"); },
  });
  assert.equal(b.trend, null);
});

// ---------- discovery ----------

test("discovery: every paid-door description is at most 500 characters and says the free look-up stays free", () => {
  for (const cat of CATEGORIES) {
    const d = lookupDescription(cat);
    assert.ok(d.length <= DESCRIPTION_MAX, `${cat.id}: ${d.length}`);
    assert.ok(d.includes(`/api/v1/${cat.restPath}`) || d.endsWith("…"), cat.id);
    assert.match(d, /free/);
  }
  for (const key of ["check", "history", "lookup"] as const) assert.ok(descriptionFor(key, "https://proofprice.com/api/v1/paid/fuel").length <= DESCRIPTION_MAX);
});

test("discovery: the example arguments of every premium key point at a cleared source, so calling them really answers 402", () => {
  const fuel = exampleFor("lookup", "https://proofprice.com/api/v1/paid/fuel")!;
  assert.ok(fuel && CLEARED_FOR_PAID.has(fuel.source));
  for (const cat of CATEGORIES) {
    const ex = exampleFor("lookup", `https://proofprice.com/api/v1/paid/${cat.restPath}`);
    if (!ex) continue;
    const url = `https://proofprice.com/api/v1/paid/${cat.restPath}?${new URLSearchParams(ex.query)}`;
    assert.ok(allCleared(lookupSourcesFromUrl(url, cat.restPath)), `${cat.id} example is not on a cleared source`);
  }
  const check = exampleFor("check", "https://proofprice.com/api/v1/check")!;
  assert.ok(check.query.price && check.query.category);
  assert.ok(allCleared(checkSourcesFromUrl(`https://proofprice.com/api/v1/check?${new URLSearchParams(check.query)}`)));
  const hist = exampleFor("history", "https://proofprice.com/api/v1/fuel/history");
  if (hist) {
    const cat = CATEGORIES.find((c) => c.history && hist.source && CLEARED_FOR_PAID.has(hist.source))!;
    assert.ok(allCleared(historySourcesFromUrl(`https://proofprice.com/api/v1/${cat.restPath}/history?${new URLSearchParams(hist.query)}`, cat.restPath)));
  }
});

test("discovery: the 402 for a paid-door category has a complete input schema and a real example; the lean header stays small", async () => {
  const url = "https://proofprice.com/api/v1/paid/fuel";
  const body: any = paymentRequiredBody(cfg, "lookup", url);
  const b = body.extensions.bazaar;
  assert.equal(b.info.input.type, "http");
  assert.equal(b.info.input.method, "GET");
  assert.ok(b.info.input.queryParams.country, "example holds real values");
  const props = b.schema.properties.input.properties.queryParams;
  for (const k of ["country", "price", "days"]) assert.ok(props.properties[k], k);
  assert.ok(props.required.includes("country"));
  assert.equal(body.resource.url, url);
  assert.ok(body.resource.description.length <= 500);
  const { gateCall: gc } = await import("../lib/payments/gate");
  const out: any = await gc({ ...base(), resourceUrl: url, facilitator: mock().f });
  assert.ok(out.headers["payment-required"].length < 8000, `header ${out.headers["payment-required"].length}`);
  // existing keys now carry examples too
  assert.ok(Object.keys(bazaarExtension("check", "https://proofprice.com/api/v1/check").info.input.queryParams!).length > 1);
});

test("settle carries the Bazaar fields: paymentPayload.resource and paymentPayload.extensions.bazaar, ours over the payer's", async () => {
  const { f, calls } = mock();
  const url = "https://proofprice.com/api/v1/paid/fuel";
  // a payer that sent nothing, and one that sent junk in those fields
  for (const extra of [{}, { resource: { url: "https://evil.example" }, extensions: { bazaar: { info: "junk" }, other: 1 } }]) {
    calls.length = 0;
    const header = b64({ x402Version: 2, accepted: buildRequirements(cfg, "lookup"), payload: { authorization: { from: PAYER } }, ...extra });
    const o = await gateCall({ ...base({ resourceUrl: url }), facilitator: f, paymentHeader: header });
    assert.equal(o.kind, "served");
    const settle = calls.find((c) => c.op === "settle")!.payload;
    const verify = calls.find((c) => c.op === "verify")!.payload;
    for (const p of [settle, verify]) {
      assert.equal(p.resource.url, url);
      assert.ok(p.resource.description.length > 0 && p.resource.description.length <= 500);
      assert.equal(p.extensions.bazaar.info.input.type, "http");
      assert.ok(p.extensions.bazaar.schema.properties.input);
      assert.equal(p.payload.authorization.from, PAYER, "the payer's signed part is untouched");
    }
  }
  assert.deepEqual(Object.keys(facilitatorPayload({ a: 1 }, "history", "https://proofprice.com/api/v1/fuel/history")).sort(), ["a", "extensions", "resource"]);
});

test("a facilitator that refuses the listing details still takes a good payment: plain payload is checked and settled", async () => {
  const calls: { op: string; payload: any }[] = [];
  const picky = {
    async verify(payload: any) {
      calls.push({ op: "verify", payload });
      return payload?.extensions?.bazaar ? { isValid: false, invalidReason: "bazaar_schema_invalid" } : { isValid: true };
    },
    async settle(payload: any) {
      calls.push({ op: "settle", payload });
      return { success: true, transaction: "0xabc" };
    },
  };
  const url = "https://proofprice.com/api/v1/paid/fuel";
  const header = b64({ x402Version: 2, accepted: buildRequirements(cfg, "lookup"), payload: { authorization: { from: PAYER } } });
  const o = await gateCall({ ...base({ resourceUrl: url }), facilitator: picky as any, paymentHeader: header });
  assert.equal(o.kind, "served");
  assert.equal(calls.filter((c) => c.op === "verify").length, 2, "enriched first, then the payer's own payload");
  const settle = calls.find((c) => c.op === "settle")!.payload;
  assert.equal(settle.extensions, undefined, "the plain payload is the one settled");
  assert.equal(settle.resource, undefined);
});

test("a payment that is bad either way is still refused, with the facilitator's reason", async () => {
  const never = { async verify() { return { isValid: false, invalidReason: "insufficient_funds" }; }, async settle() { throw new Error("must not settle"); } };
  const header = b64({ x402Version: 2, accepted: buildRequirements(cfg, "lookup"), payload: { authorization: { from: PAYER } } });
  const o: any = await gateCall({ ...base({ resourceUrl: "https://proofprice.com/api/v1/paid/fuel" }), facilitator: never as any, paymentHeader: header });
  assert.notEqual(o.kind, "served");
});

// ---------- wallet counting ----------

const BLOB = { BLOB_READ_WRITE_TOKEN: "test" };

test("paid counting: calls per key, distinct outside wallets by salted hash, own wallets apart, no address kept", async () => {
  const mem = memoryStore();
  setUsageStore(mem);
  resetUsage();
  const env = { ...BLOB, PROOFPRICE_OWN_WALLETS: ` ${OWN.toUpperCase().replace("0X", "0x")} , ` };
  assert.ok(ownWallets(env).has(OWN));
  const now = new Date("2026-11-14T10:00:00Z");
  recordPaid({ key: "lookup", wallet: PAYER }, now, env);
  recordPaid({ key: "lookup", wallet: PAYER.toUpperCase().replace("0X", "0x") }, now, env); // same wallet, other letter case
  recordPaid({ key: "lookup", wallet: "0x4444444444444444444444444444444444444444" }, now, env);
  recordPaid({ key: "check", wallet: null }, now, env); // wallet unknown (for example Solana): the call counts, no wallet
  recordPaid({ key: "lookup", wallet: OWN }, now, env);
  recordPaid({ key: "history", wallet: OWN }, now, env);
  const pend = pendingPaidSummary();
  assert.deepEqual(pend, [{ day: "2026-11-14", calls: { lookup: 3, check: 1 }, own_calls: 2, wallets: 2 }]);

  await flushUsage(now, env);
  const wire = [...mem.files.values()].join("\n");
  for (const a of [PAYER, PAYER.toLowerCase(), OWN, "4444444444444444444444444444444444444444"]) assert.ok(!wire.toLowerCase().includes(a.toLowerCase().replace(/^0x/, "")), "no address is ever stored");
  const small = [...mem.files.entries()].find(([k]) => k.startsWith("usage/2026-11-14/"))!;
  const file = JSON.parse(small[1]);
  assert.equal(file.paid.own_calls, 2);
  assert.deepEqual(file.paid.calls, { lookup: 3, check: 1 });
  assert.equal(file.paid.wallets.length, 2);
  assert.ok(file.paid.wallets.every((h: string) => /^[0-9a-f]{32}$/.test(h)));

  // the report, from the open day's file
  const rep = await usageReport(new Date("2026-11-14T12:00:00Z"), env, mem);
  assert.equal(rep.paid!.paid_calls, 4);
  assert.equal(rep.paid!.own_paid_calls, 2);
  assert.deepEqual(rep.paid!.paid_calls_by_key, { lookup: 3, check: 1 });
  assert.equal(rep.paid!.by_day[0].paying_wallets, 2);
  assert.equal(rep.paid!.paying_wallet_days, 2);
  assert.ok(!JSON.stringify(rep).toLowerCase().includes("4444444444444444"));

  // the day closes: only counts remain, hashes and salt are deleted
  const later = new Date("2026-11-15T03:00:00Z");
  const rep2 = await usageReport(later, env, mem);
  assert.equal(rep2.paid!.paying_wallet_days, 2);
  assert.equal(rep2.paid!.own_paid_calls, 2);
  const daily = JSON.parse(mem.files.get("usage-daily/2026-11-14.json")!);
  assert.deepEqual(daily.paid, { calls: { lookup: 3, check: 1 }, own_calls: 2, wallets: 2 });
  assert.ok(![...mem.files.keys()].some((k) => k.startsWith("usage/2026-11-14/") || k.startsWith("usage-salt/2026-11-14")));
  setUsageStore(null);
  resetUsage();
});

test("paid counting: off while usage counting is off; reducePaid merges the same hash once", () => {
  resetUsage();
  recordPaid({ key: "lookup", wallet: PAYER }, new Date(), {});
  assert.deepEqual(pendingPaidSummary(), []);
  const r = reducePaid([{ calls: { lookup: 1 }, own_calls: 0, wallets: ["a", "b"] }, { calls: { lookup: 2 }, own_calls: 1, wallets: ["b"] }, undefined])!;
  assert.deepEqual(r, { calls: { lookup: 3 }, own_calls: 1, wallets: 2 });
  assert.equal(reducePaid([undefined]), null);
});

test("paying through the gate counts the wallet (the gate hands the payer to the counter only after settlement)", async () => {
  const mem = memoryStore();
  setUsageStore(mem);
  resetUsage();
  Object.assign(process.env, BLOB);
  try {
    const seen: any[] = [];
    const { f } = mock();
    await gateCall({ ...base(), facilitator: f, paymentHeader: payment("lookup", PAYER), onPaid: (i) => seen.push(i) });
    assert.deepEqual(seen, [{ key: "lookup", wallet: PAYER }]);
    // not settled (no charge) = not counted
    await gateCall({ ...base({ chargeable: () => false }), facilitator: f, paymentHeader: payment("lookup", PAYER), onPaid: (i) => seen.push(i) });
    assert.equal(seen.length, 1);
  } finally {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    setUsageStore(null);
    resetUsage();
  }
});

// ---------- the free addresses behave exactly as before ----------

test("free addresses: the plain category route never asks for payment, even with the gate on and a cleared source", async () => {
  Object.assign(process.env, ON);
  try {
    const { GET } = await import("../app/api/v1/[category]/route");
    // a request the route refuses on its own terms (unknown category): 404 JSON, no payment header, no 402
    const r = await GET(new Request("https://proofprice.com/api/v1/nope?country=IT"), { params: Promise.resolve({ category: "nope" }) });
    assert.equal(r.status, 404);
    assert.equal(r.headers.get("payment-required"), null);
    // the premium keys keep their free allowance
    assert.equal(PREMIUM.check.freePerDay, 20);
    assert.equal(PREMIUM.history.freePerDay, 10);
    assert.equal(PREMIUM.check.microUsd, 100_000);
    assert.equal(PREMIUM.history.microUsd, 20_000);
  } finally {
    for (const k of Object.keys(ON)) delete process.env[k];
  }
});

test("free addresses: the plain look-up route and lib/answer.ts do not know about payments at all", async () => {
  const { readFileSync } = await import("node:fs");
  for (const f of ["app/api/v1/[category]/route.ts", "lib/answer.ts"]) assert.ok(!/payments|gatedRest|paid-lookup/.test(readFileSync(f, "utf8")), `${f} must not mention the gate`);
});
