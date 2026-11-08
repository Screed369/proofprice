// Payment gate: USDC on Solana as a second option (OFF by default). No network, no real keys: mock facilitator, public example
// addresses from the x402 spec. Pins: unset = Base only and unchanged; set = a second `accepts` entry in the x402 SVM `exact`
// format; only our address, the official USDC mint and the exact price are accepted; fail closed; one transaction settles once.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { readGateConfig, isSolanaAddress, SOLANA_NETWORKS } from "../lib/payments/config";
import { gateCall, buildRequirements, buildSolanaRequirements, resetSolanaGuardForTests } from "../lib/payments/gate";
import { feePayersFromSupported, httpFacilitator, resetSupportedCacheForTests, type Facilitator } from "../lib/payments/facilitator";
import { PREMIUM } from "../lib/payments/prices";
import { resetQuota } from "../lib/payments/quota";

const PAY_TO = "0x1111111111111111111111111111111111111111";
const SOL_PAY_TO = "2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4"; // example address from the x402 SVM spec, not our wallet
const FEE_PAYER = "EwWqGE4ZFKLofuestmU4LDdK7XM1N4ALgdZccwYugwGd";
const OTHER = "CKPKJWNdJEqa81x7CkZ14BVPiY6y16Sxs7owznqtWYp5";
const MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const MAIN_ENV = { PROOFPRICE_X402_ENABLED: "true", PROOFPRICE_X402_PAY_TO: PAY_TO, PROOFPRICE_X402_NETWORK: "base", CDP_API_KEY_ID: "id", CDP_API_KEY_SECRET: "s" };
const cfg = readGateConfig({ ...MAIN_ENV, PROOFPRICE_X402_SOLANA_PAY_TO: SOL_PAY_TO })!;
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64");

function solPayment(over: Record<string, unknown> = {}, tx: unknown = "AQIDBAUGBwgJ") {
  return b64({ x402Version: 2, accepted: { ...buildSolanaRequirements(cfg, "check", FEE_PAYER)!, ...over }, payload: { transaction: tx } });
}
function mock(opts: { payers?: string[] | "throw"; valid?: boolean } = {}) {
  const calls: { op: string; req?: any }[] = [];
  const f: Facilitator = {
    async verify(_p, req) { calls.push({ op: "verify", req }); return opts.valid === false ? { isValid: false, invalidReason: "bad" } : { isValid: true }; },
    async settle(_p, req) { calls.push({ op: "settle", req }); return { success: true, transaction: "5sigBase58", network: (req as any).network }; },
    async solanaFeePayers(network) {
      calls.push({ op: "supported" });
      if (opts.payers === "throw") throw new Error("down");
      return network === MAINNET ? (opts.payers ?? [FEE_PAYER, OTHER]) : [];
    },
  };
  return { f, calls, ops: () => calls.map((c) => c.op).filter((x) => x !== "supported") };
}
const base = (f: Facilitator, paymentHeader?: string) => ({
  cfg, facilitator: f, key: "check" as const, callerAddress: "203.0.113.9", resourceUrl: "https://proofprice.com/api/v1/check",
  run: async () => ({ status: "ok" }), chargeable: () => true, paymentHeader,
});
async function exhaustFree(f: Facilitator) {
  for (let i = 0; i < PREMIUM.check.freePerDay; i++) await gateCall(base(f));
}

beforeEach(() => { resetQuota(); resetSolanaGuardForTests(); resetSupportedCacheForTests(); });

test("Solana addresses: base58 that decodes to 32 bytes", () => {
  for (const a of [SOL_PAY_TO, FEE_PAYER, USDC, "11111111111111111111111111111111"]) assert.ok(isSolanaAddress(a), a);
  for (const a of ["", "0x1111111111111111111111111111111111111111", "2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg0", "abc", "1111111111111111111111111111111111111111111"]) assert.ok(!isSolanaAddress(a), a);
});

test("Solana is OFF unless PROOFPRICE_X402_SOLANA_PAY_TO is a valid address; it follows the Base mode", () => {
  assert.equal(readGateConfig(MAIN_ENV)?.solana, undefined);
  assert.equal(readGateConfig({ ...MAIN_ENV, PROOFPRICE_X402_SOLANA_PAY_TO: "0xnot-solana" })?.solana, undefined, "bad address drops Solana only");
  assert.ok(readGateConfig({ ...MAIN_ENV, PROOFPRICE_X402_SOLANA_PAY_TO: "0xnot-solana" }), "Base still on");
  assert.equal(readGateConfig({ PROOFPRICE_X402_SOLANA_PAY_TO: SOL_PAY_TO }), null, "Solana alone never switches the gate on");
  assert.deepEqual(cfg.solana, { payTo: SOL_PAY_TO, caip2: MAINNET, asset: USDC });
  const test = readGateConfig({ PROOFPRICE_X402_ENABLED: "true", PROOFPRICE_X402_PAY_TO: PAY_TO, PROOFPRICE_X402_SOLANA_PAY_TO: SOL_PAY_TO })!;
  assert.equal(test.solana?.caip2, SOLANA_NETWORKS["base-sepolia"].caip2, "test money: Solana devnet");
});

test("402 lists Base first and Solana second, in the x402 SVM exact format", async () => {
  const m = mock();
  await exhaustFree(m.f);
  const o = await gateCall(base(m.f));
  assert.equal(o.kind === "denied" && o.status, 402);
  if (o.kind !== "denied") return;
  const accepts = (o.body as any).accepts;
  assert.deepEqual(accepts[0], buildRequirements(cfg, "check"));
  assert.deepEqual(accepts[1], { scheme: "exact", network: MAINNET, amount: "100000", asset: USDC, payTo: SOL_PAY_TO, maxTimeoutSeconds: 60, extra: { feePayer: FEE_PAYER } });
  assert.equal(JSON.parse(Buffer.from(o.headers["payment-required"], "base64").toString()).accepts.length, 2);
});

test("402 falls back to Base only when Solana is off, the facilitator lists no Solana fee payer, or /supported is down", async () => {
  const off = readGateConfig(MAIN_ENV)!;
  for (const [name, c, m] of [["off", off, mock()], ["none", cfg, mock({ payers: [] })], ["down", cfg, mock({ payers: "throw" })]] as const) {
    resetQuota();
    for (let i = 0; i < PREMIUM.check.freePerDay; i++) await gateCall({ ...base(m.f), cfg: c });
    const o = await gateCall({ ...base(m.f), cfg: c });
    assert.equal(o.kind === "denied" && (o.body as any).accepts.length, 1, name);
  }
});

test("a valid Solana payment is verified and settled by the facilitator with Solana requirements", async () => {
  const m = mock();
  const o = await gateCall(base(m.f, solPayment()));
  assert.equal(o.kind, "served");
  if (o.kind !== "served") return;
  assert.equal(o.paid, true);
  assert.deepEqual(m.ops(), ["verify", "settle"]);
  for (const c of m.calls.filter((c) => c.req)) {
    assert.equal(c.req.network, MAINNET);
    assert.equal(c.req.payTo, SOL_PAY_TO);
    assert.equal(c.req.asset, USDC);
    assert.equal(c.req.amount, "100000");
    assert.equal(c.req.extra.feePayer, FEE_PAYER);
  }
  assert.equal(JSON.parse(Buffer.from(o.headers["payment-response"], "base64").toString()).network, MAINNET);
});

test("Solana payments that do not match are refused before the facilitator verifies anything", async () => {
  const cases: [string, string, ReturnType<typeof mock>?][] = [
    ["wrong address", solPayment({ payTo: OTHER })],
    ["wrong mint", solPayment({ asset: OTHER })],
    ["too little", solPayment({ amount: "99999" })],
    ["not the exact price", solPayment({ amount: "100001" })],
    ["wrong scheme", solPayment({ scheme: "upto" })],
    ["no transaction", solPayment({}, null)],
    ["transaction not base64", solPayment({}, "not base64!")],
    ["fee payer not offered", solPayment({ extra: { feePayer: SOL_PAY_TO } })],
    ["no fee payer", solPayment({ extra: {} })],
  ];
  for (const [name, header] of cases) {
    const m = mock();
    const o = await gateCall(base(m.f, header));
    assert.equal(o.kind === "denied" && o.status, 402, name);
    assert.equal(o.kind === "denied" && (o.body as any).error, "invalid_payment", name);
    assert.deepEqual(m.ops(), [], `${name}: facilitator never asked to verify or settle`);
  }
});

test("Solana: facilitator says invalid -> refused; fee-payer list unreachable -> 503; nothing settled", async () => {
  const bad = mock({ valid: false });
  const o1 = await gateCall(base(bad.f, solPayment()));
  assert.equal(o1.kind === "denied" && o1.status, 402);
  assert.deepEqual(bad.ops(), ["verify"]);
  const down = mock({ payers: "throw" });
  const o2 = await gateCall(base(down.f, solPayment()));
  assert.equal(o2.kind === "denied" && o2.status, 503);
  assert.deepEqual(down.ops(), []);
});

test("Solana: the same signed transaction is settled only once (duplicate-settlement guard)", async () => {
  const m = mock();
  const h = solPayment();
  assert.equal((await gateCall(base(m.f, h))).kind, "served");
  const again = await gateCall(base(m.f, h));
  assert.equal(again.kind === "denied" && (again.body as any).reason, "duplicate_settlement");
  assert.equal(m.ops().filter((x) => x === "settle").length, 1);
});

test("Solana switched off: a Solana payment is refused (treated as a wrong network)", async () => {
  const m = mock();
  const o = await gateCall({ ...base(m.f, solPayment()), cfg: readGateConfig(MAIN_ENV)! });
  assert.equal(o.kind === "denied" && (o.body as any).error, "invalid_payment");
  assert.deepEqual(m.ops(), []);
});

test("GET /supported is read for Solana fee payers (kinds first, then signers), cached, and signed for CDP", async () => {
  const body = {
    kinds: [
      { x402Version: 2, scheme: "exact", network: "eip155:8453" },
      { x402Version: 2, scheme: "exact", network: MAINNET, extra: { feePayer: FEE_PAYER } },
      { x402Version: 1, scheme: "exact", network: MAINNET, extra: { feePayer: SOL_PAY_TO } },
    ],
    extensions: [],
    signers: { "solana:*": [OTHER, FEE_PAYER, "junk"] },
  };
  assert.deepEqual(feePayersFromSupported(body, MAINNET), [FEE_PAYER, OTHER]);
  assert.deepEqual(feePayersFromSupported({ kinds: [], signers: { "solana:*": [OTHER] } }, MAINNET), [], "no Solana kind = not offered");
  assert.deepEqual(feePayersFromSupported(null, MAINNET), []);

  const seen: { url: string; init: any }[] = [];
  const fetchMock = (async (url: any, init: any) => { seen.push({ url: String(url), init }); return new Response(JSON.stringify(body), { status: 200 }); }) as typeof fetch;
  const f = httpFacilitator({ ...cfg, facilitatorUrl: "https://api.cdp.coinbase.com/platform/v2/x402", cdpKeyId: undefined, cdpKeySecret: undefined }, fetchMock);
  assert.deepEqual(await f.solanaFeePayers!(MAINNET), [FEE_PAYER, OTHER]);
  await f.solanaFeePayers!(MAINNET);
  assert.equal(seen.length, 1, "cached");
  assert.equal(seen[0].url, "https://api.cdp.coinbase.com/platform/v2/x402/supported");
  assert.equal(seen[0].init.method, undefined, "plain GET");
});
