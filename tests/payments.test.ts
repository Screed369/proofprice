// Payment gate (x402). No network, no real keys: the facilitator is a mock, the wallet address is a public test address.
// Pins: gate OFF changes nothing; gate ON gives 402 with correct requirements, accepts a valid payment, refuses an invalid one,
// charges only for real answers, and never returns payer or caller identifiers.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";

import { readGateConfig, NETWORKS } from "../lib/payments/config";
import { gateCall, buildRequirements } from "../lib/payments/gate";
import { gatedRest, isAnswered, setFacilitatorForTests } from "../lib/payments";
import type { Facilitator } from "../lib/payments/facilitator";
import { PREMIUM } from "../lib/payments/prices";
import { resetQuota } from "../lib/payments/quota";
import { cdpJwt } from "../lib/payments/cdp-jwt";
import { registerTools } from "../lib/mcp-tools";
import type { ToolSpec } from "../lib/mcp-tools";
import { z } from "zod";

import { allCleared, CLEARED_FOR_PAID } from "../lib/payments/cleared";
import { checkSources, checkSourcesFromUrl, historySources, historySourcesFromUrl } from "../lib/premium-sources";
import { CATEGORIES } from "../lib/registry";
const CLEARED = () => ["eu-energy"];
const PAY_TO = "0x1111111111111111111111111111111111111111"; // public test address, not a real wallet
const PAYER = "0x2222222222222222222222222222222222222222";
const ON = { PROOFPRICE_X402_ENABLED: "true", PROOFPRICE_X402_PAY_TO: PAY_TO };
const cfg = readGateConfig(ON)!;
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64");

function validPayment(key: "check" | "history" = "check", over: Record<string, unknown> = {}) {
  return b64({ x402Version: 2, accepted: { ...buildRequirements(cfg, key), ...over }, payload: { signature: "0xabc", authorization: { from: PAYER } } });
}
function mock(opts: { valid?: boolean; settle?: boolean; throwVerify?: boolean } = {}) {
  const calls: string[] = [];
  const f: Facilitator = {
    async verify() { calls.push("verify"); if (opts.throwVerify) throw new Error("down"); return opts.valid === false ? { isValid: false, invalidReason: "bad_signature" } : { isValid: true }; },
    async settle() { calls.push("settle"); return opts.settle === false ? { success: false, errorReason: "insufficient_funds" } : { success: true, transaction: "0xdeadbeef", network: cfg.caip2 }; },
  };
  return { f, calls };
}
const okAnswer = { status: "ok", price: { median: 1 } };
const base = (over: Partial<Parameters<typeof gateCall>[0]> = {}) => ({
  cfg, key: "check" as const, callerAddress: "203.0.113.9", resourceUrl: "https://proofprice.com/api/v1/check", run: async () => okAnswer, chargeable: () => true, ...over,
});

beforeEach(() => resetQuota());

test("gate is OFF unless both variables are set (and valid)", () => {
  assert.equal(readGateConfig({}), null);
  assert.equal(readGateConfig({ PROOFPRICE_X402_PAY_TO: PAY_TO }), null);
  assert.equal(readGateConfig({ PROOFPRICE_X402_ENABLED: "true" }), null);
  assert.equal(readGateConfig({ ...ON, PROOFPRICE_X402_ENABLED: "yes" }), null);
  assert.equal(readGateConfig({ ...ON, PROOFPRICE_X402_PAY_TO: "not-an-address" }), null);
  assert.equal(readGateConfig({ ...ON, PROOFPRICE_X402_NETWORK: "ethereum" }), null);
  assert.equal(readGateConfig({ ...ON, PROOFPRICE_X402_NETWORK: "base" }), null, "mainnet needs CDP keys");
  assert.ok(readGateConfig({ ...ON, PROOFPRICE_X402_NETWORK: "base", CDP_API_KEY_ID: "id", CDP_API_KEY_SECRET: "s" }));
  assert.equal(readGateConfig(ON)?.caip2, NETWORKS["base-sepolia"].caip2, "testnet is the default");
});

test("gate OFF: premium REST route is the plain handler, untouched", async () => {
  for (const k of ["PROOFPRICE_X402_ENABLED", "PROOFPRICE_X402_PAY_TO"]) delete process.env[k];
  const plain = new Response('{"status":"ok"}', { status: 200, headers: { "cache-control": "public, s-maxage=600", "x-test": "1" } });
  const res = await gatedRest("check", new Request("https://proofprice.com/api/v1/check"), async () => plain, () => ["eu-energy"]);
  assert.equal(res, plain, "same Response object, nothing added");
});

test("gate OFF: MCP tools are registered exactly as built (no price text, no wrapper)", () => {
  const spec: ToolSpec = {
    name: "t", premium: "check",
    config: { title: "T", description: "Desc.", inputSchema: z.object({}), outputSchema: z.any(), annotations: { title: "T", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } },
    call: async () => ({ content: [{ type: "text", text: "x" }] }),
  };
  const seen: any[] = [];
  registerTools({ registerTool: (...a: any[]) => seen.push(a) }, [spec], {});
  assert.equal(seen[0][1], spec.config, "same config object");
  registerTools({ registerTool: (...a: any[]) => seen.push(a) }, [spec], ON);
  assert.match(seen[1][1].description, /^Desc\. After 20 free calls a day/);
  assert.match(seen[1][1].description, /x402/);
});

test("gate ON: free quota first, then 402 with correct payment requirements", async () => {
  const { f, calls } = mock();
  for (let i = 0; i < PREMIUM.check.freePerDay; i++) {
    const o = await gateCall({ ...base(), facilitator: f });
    assert.equal(o.kind, "served");
  }
  const o = await gateCall({ ...base(), facilitator: f });
  assert.equal(o.kind, "denied");
  if (o.kind !== "denied") return;
  assert.equal(o.status, 402);
  const body: any = o.body;
  assert.equal(body.x402Version, 2);
  assert.equal(body.error, "payment_required");
  assert.deepEqual(body.accepts, [{
    scheme: "exact", network: "eip155:84532", amount: "100000", asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    payTo: PAY_TO, maxTimeoutSeconds: 60, extra: { name: "USDC", version: "2" },
  }]);
  assert.equal(JSON.parse(Buffer.from(o.headers["payment-required"], "base64").toString()).accepts[0].payTo, PAY_TO);
  assert.equal(calls.length, 0, "no facilitator call without a payment");
});

test("gate ON: a valid payment passes, is settled once, and the response holds no payer or caller data", async () => {
  const { f, calls } = mock();
  const o = await gateCall({ ...base(), facilitator: f, paymentHeader: validPayment() });
  assert.equal(o.kind, "served");
  if (o.kind !== "served") return;
  assert.equal(o.paid, true);
  assert.deepEqual(calls, ["verify", "settle"]);
  const wire = JSON.stringify(o);
  assert.ok(!wire.includes(PAYER) && !wire.includes("203.0.113.9"), "no payer address, no caller address");
  assert.equal(JSON.parse(Buffer.from(o.headers["payment-response"], "base64").toString()).transaction, "0xdeadbeef");
});

test("gate ON: invalid payments are refused (bad signature, wrong wallet, too little, wrong network, junk)", async () => {
  const cases: [string, ReturnType<typeof mock>, string][] = [
    ["bad signature", mock({ valid: false }), validPayment()],
    ["wrong wallet", mock(), validPayment("check", { payTo: "0x3333333333333333333333333333333333333333" })],
    ["too little", mock(), validPayment("check", { amount: "1" })],
    ["wrong network", mock(), validPayment("check", { network: "eip155:8453" })],
    ["junk header", mock(), "%%%not-base64-json"],
  ];
  for (const [name, m, header] of cases) {
    const o = await gateCall({ ...base(), facilitator: m.f, paymentHeader: header });
    assert.equal(o.kind, "denied", name);
    if (o.kind === "denied") { assert.equal(o.status, 402, name); assert.equal((o.body as any).error, "invalid_payment", name); }
    assert.ok(!m.calls.includes("settle"), `${name}: never settled`);
  }
});

test("gate ON: pays only for a real answer; failed settlement and facilitator outage fail closed", async () => {
  const none = mock();
  const o1 = await gateCall({ ...base({ chargeable: () => false }), facilitator: none.f, paymentHeader: validPayment() });
  assert.equal(o1.kind, "served");
  assert.deepEqual(none.calls, ["verify"], "not charged for 'not enough records'");

  const o2 = await gateCall({ ...base(), facilitator: mock({ settle: false }).f, paymentHeader: validPayment() });
  assert.equal(o2.kind, "denied", "answer withheld when settlement fails");

  const o3 = await gateCall({ ...base(), facilitator: mock({ throwVerify: true }).f, paymentHeader: validPayment() });
  assert.equal(o3.kind === "denied" && o3.status, 503);
});

test("gate ON: REST wrapper returns 402 JSON after the quota, serves a paid call, never caches it", async () => {
  Object.assign(process.env, ON);
  try {
    const { f } = mock();
    setFacilitatorForTests(f);
    const answer = () => new Response(JSON.stringify({ status: "ok", summary: "s" }), { status: 200, headers: { "content-type": "application/json" } });
    const mk = (h: Record<string, string> = {}) => new Request("https://proofprice.com/api/v1/fuel/history?country=ES", { headers: { "x-forwarded-for": "198.51.100.7", ...h } });
    for (let i = 0; i < PREMIUM.history.freePerDay; i++) assert.equal((await gatedRest("history", mk(), async () => answer(), CLEARED)).status, 200);
    const denied = await gatedRest("history", mk(), async () => answer(), CLEARED);
    assert.equal(denied.status, 402);
    assert.equal(denied.headers.get("access-control-allow-origin"), "*");
    assert.equal((await denied.json() as any).accepts[0].amount, "20000");
    const paid = await gatedRest("history", mk({ "payment-signature": validPayment("history") }), async () => answer(), CLEARED);
    assert.equal(paid.status, 200);
    assert.equal(paid.headers.get("cache-control"), "no-store");
    assert.ok(paid.headers.get("payment-response"));
    // an upstream error is not charged
    const err = await gatedRest("history", mk({ "payment-signature": validPayment("history") }), async () => new Response("{}", { status: 400 }), CLEARED);
    assert.equal(err.status, 400);
    assert.equal(err.headers.get("payment-response"), null);
  } finally {
    for (const k of Object.keys(ON)) delete process.env[k];
    setFacilitatorForTests(null);
  }
});

test("gate ON: the MCP tool returns an isError result with the requirements, and accepts payment in _meta", async () => {
  const { f } = mock();
  setFacilitatorForTests(f);
  try {
    const spec: ToolSpec = {
      name: "pricepaid_check_price", premium: "check", sources: () => ["eu-energy"],
      config: { title: "T", description: "D.", inputSchema: z.object({}), outputSchema: z.any(), annotations: { title: "T", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } },
      call: async () => ({ content: [{ type: "text", text: "answer" }], structuredContent: { verdict: "typical", answer: { status: "ok" } } }),
    };
    let handler: any;
    registerTools({ registerTool: (_n: string, _c: unknown, h: unknown) => { handler = h; } }, [spec], ON);
    const ctx = (meta?: unknown) => ({ http: { req: new Request("https://proofprice.com/api/mcp", { headers: { "x-forwarded-for": "198.51.100.8" } }) }, mcpReq: { _meta: meta } });
    for (let i = 0; i < PREMIUM.check.freePerDay; i++) assert.equal((await handler({}, ctx())).isError, undefined);
    const denied = await handler({}, ctx());
    assert.equal(denied.isError, true);
    assert.equal(denied.structuredContent.accepts[0].payTo, PAY_TO);
    const paid = await handler({}, ctx({ "x402/payment": JSON.parse(Buffer.from(validPayment(), "base64").toString()) }));
    assert.equal(paid.isError, undefined);
    assert.equal(paid._meta["x402/payment-response"].success, true);
    assert.ok(!JSON.stringify(paid).includes(PAYER));
  } finally {
    setFacilitatorForTests(null);
  }
});

test("isAnswered: only real answers are chargeable", () => {
  assert.equal(isAnswered('{"status":"ok"}'), true);
  assert.equal(isAnswered('{"verdict":"typical","answer":{"status":"ok"}}'), true);
  assert.equal(isAnswered('{"verdict":"cannot_judge","answer":{"status":"ok"}}'), false);
  assert.equal(isAnswered('{"status":"insufficient_data"}'), false);
  assert.equal(isAnswered('{"status":"ok","extra":{"stale":true}}'), false);
  assert.equal(isAnswered("nope"), false);
});

test("CDP JWT: signs with an EC key and with an Ed25519 key (generated here, not real keys)", () => {
  const ec = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const t = cdpJwt("kid", ec, "POST", "api.cdp.coinbase.com", "/platform/v2/x402/verify", 1_800_000_000_000);
  const [h, p] = t.split(".").slice(0, 2).map((x) => JSON.parse(Buffer.from(x, "base64url").toString()));
  assert.equal(h.alg, "ES256"); assert.equal(p.uris[0], "POST api.cdp.coinbase.com/platform/v2/x402/verify");
  const seed = Buffer.concat([Buffer.alloc(32, 7), Buffer.alloc(32, 9)]).toString("base64");
  assert.equal(JSON.parse(Buffer.from(cdpJwt("kid", seed, "POST", "h", "/p").split(".")[0], "base64url").toString()).alg, "EdDSA");
});

// ---------- licence guard (S1) ----------

test("licence guard: the cleared list is exactly the sources whose Pipeline line says commercial: yes; default is not cleared", () => {
  assert.deepEqual([...CLEARED_FOR_PAID].sort(), ["ca-cmhc-rents", "ca-farm-prices", "eu-energy", "no-childcare-fees", "wb-fpn-diet-costs"]);
  assert.equal(allCleared(["eu-energy"]), true);
  assert.equal(allCleared(["eu-energy", "ie-ppr"]), false, "one uncleared source is enough");
  for (const bad of [null, undefined, [], ["new-source"], ["mx-fuel"], ["br-fuel"], ["us-home-sales"], ["un-wfp-food-prices"]]) assert.equal(allCleared(bad as any), false);
});

test("licence guard: REST premium call on an uncleared source is served free, never 402, never verified or settled, payment ignored", async () => {
  Object.assign(process.env, ON);
  try {
    const m = mock();
    setFacilitatorForTests(m.f);
    const answer = () => new Response(JSON.stringify({ status: "ok" }), { status: 200 });
    const mk = (h: Record<string, string> = {}) => new Request("https://proofprice.com/api/v1/check?country=MX", { headers: { "x-forwarded-for": "198.51.100.20", ...h } });
    for (const unclear of [() => ["mx-fuel"], () => null, () => { throw new Error("boom"); }]) {
      for (let i = 0; i < PREMIUM.check.freePerDay + 5; i++) {
        const r = await gatedRest("check", mk(i % 2 ? { "payment-signature": validPayment() } : {}), async () => answer(), unclear as any);
        assert.equal(r.status, 200, "never a 402");
        assert.equal(r.headers.get("x-proofprice-charged"), "no");
        assert.match(r.headers.get("x-proofprice-note") ?? "", /not yet cleared for paid use/);
        assert.equal(r.headers.get("payment-response"), null);
      }
    }
    assert.deepEqual(m.calls, [], "facilitator never touched");
    // a cleared source still gates normally
    for (let i = 0; i < PREMIUM.check.freePerDay; i++) await gatedRest("check", mk(), async () => answer(), CLEARED);
    assert.equal((await gatedRest("check", mk(), async () => answer(), CLEARED)).status, 402);
  } finally {
    for (const k of Object.keys(ON)) delete process.env[k];
    setFacilitatorForTests(null);
  }
});

test("licence guard: MCP premium tool with an uncleared source (or no resolver) is served free with a note", async () => {
  const m = mock();
  setFacilitatorForTests(m.f);
  try {
    const mkSpec = (sources?: ToolSpec["sources"]): ToolSpec => ({
      name: "pricepaid_check_price", premium: "check", ...(sources ? { sources } : {}),
      config: { title: "T", description: "D.", inputSchema: z.object({}), outputSchema: z.any(), annotations: { title: "T", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } },
      call: async () => ({ content: [{ type: "text", text: "answer" }], structuredContent: { verdict: "x", answer: { status: "ok" } } }),
    });
    for (const spec of [mkSpec(() => ["mx-fuel"]), mkSpec()]) {
      let handler: any;
      registerTools({ registerTool: (_n: string, _c: unknown, h: unknown) => { handler = h; } }, [spec], ON);
      const ctx = { http: { req: new Request("https://proofprice.com/api/mcp", { headers: { "x-forwarded-for": "198.51.100.30" } }) }, mcpReq: { _meta: { "x402/payment": JSON.parse(Buffer.from(validPayment(), "base64").toString()) } } };
      for (let i = 0; i < PREMIUM.check.freePerDay + 3; i++) {
        const r = await handler({}, ctx);
        assert.equal(r.isError, undefined);
        assert.equal(r._meta["proofprice/charged"], false);
        assert.match(r._meta["proofprice/note"], /not yet cleared/);
      }
    }
    assert.deepEqual(m.calls, []);
  } finally {
    setFacilitatorForTests(null);
  }
});

test("licence guard: source resolvers return the real source id, and null (not cleared) on bad input", () => {
  const rent = CATEGORIES.find((c) => c.id === "rent")!;
  assert.deepEqual(checkSources({ category: "rent", country: "CA", price: 1800 }), ["ca-cmhc-rents"]);
  assert.deepEqual(checkSources({ category: "fuel", country: "MX", area: "Ciudad de México", fuel: "petrol95", price: 1 }), ["mx-fuel"]);
  assert.equal(checkSources({ category: "nonsense", country: "CA" }), null);
  assert.equal(checkSources({ category: "rent" }), null, "no country");
  assert.equal(historySources(rent, { country: "ZZ" }), null);
  assert.equal(allCleared(checkSources({ category: "rent", country: "CA", price: 1 })), true);
  assert.equal(allCleared(checkSources({ category: "fuel", country: "MX", area: "Ciudad de México", fuel: "petrol95", price: 1 })), false);
});

test("licence guard: real REST URLs map to the source the handler runs", () => {
  assert.deepEqual(checkSourcesFromUrl("https://proofprice.com/api/v1/check?category=rent&country=CA&price=1800&ppcheck=1"), ["ca-cmhc-rents"]);
  assert.deepEqual(checkSourcesFromUrl("https://proofprice.com/api/v1/check?category=fuel&country=MX&area=Ciudad%20de%20M%C3%A9xico&fuel=petrol95&price=1"), ["mx-fuel"]);
  assert.equal(checkSourcesFromUrl("https://proofprice.com/api/v1/check?category=zzz"), null);
  assert.deepEqual(historySourcesFromUrl("https://proofprice.com/api/v1/fuel/history?country=MX&area=Ciudad%20de%20M%C3%A9xico&fuel=petrol95", "fuel"), ["mx-fuel"]);
  assert.equal(historySourcesFromUrl("https://proofprice.com/api/v1/zzz/history?country=MX", "zzz"), null);
});
