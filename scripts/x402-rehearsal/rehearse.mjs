// Local rehearsal of the ProofPrice x402 gate on base-sepolia with a DUMMY pay-to address and a THROWAWAY client key made in memory.
// No real wallet, no real money, no network call to any facilitator: a local mock checks the EIP-3009 signature itself.
// Usage: see README.md. Needs the app running with the gate on (the README gives the exact command).
import http from "node:http";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { recoverTypedDataAddress } from "viem";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { ExactEvmScheme } from "@x402/evm/exact/client";

const APP = process.env.APP_URL ?? "http://localhost:3111";
const MOCK_PORT = Number(process.env.MOCK_PORT ?? 3112);
const PAY_TO = "0x000000000000000000000000000000000000dEaD"; // public dummy address
const CHECK = `${APP}/api/v1/check?category=rent&country=CA&town=Toronto&bedrooms=2&price=1900&unit=per%20month&ppcheck=1`;
let failures = 0;
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"}  ${m}`); if (!c) failures++; };

// --- mock facilitator: verifies the signature for real, "settles" with a fake hash ---
const seen = { verify: 0, settle: 0, signer: null };
const mock = http.createServer(async (req, res) => {
  let body = ""; for await (const c of req) body += c;
  const { paymentPayload: p, paymentRequirements: r } = JSON.parse(body || "{}");
  const send = (o) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(o)); };
  try {
    const a = p.payload.authorization;
    const signer = await recoverTypedDataAddress({
      domain: { name: r.extra.name, version: r.extra.version, chainId: 84532, verifyingContract: r.asset },
      types: { TransferWithAuthorization: [
        { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" } ] },
      primaryType: "TransferWithAuthorization",
      message: { from: a.from, to: a.to, value: BigInt(a.value), validAfter: BigInt(a.validAfter), validBefore: BigInt(a.validBefore), nonce: a.nonce },
      signature: p.payload.signature,
    });
    const good = signer.toLowerCase() === a.from.toLowerCase() && a.to.toLowerCase() === r.payTo.toLowerCase() && BigInt(a.value) >= BigInt(r.amount);
    seen.signer = signer;
    if (req.url.endsWith("/verify")) { seen.verify++; return send({ isValid: good, invalidReason: good ? undefined : "bad_signature" }); }
    seen.settle++; return send({ success: good, transaction: "0x" + "ab".repeat(32), network: r.network });
  } catch (e) { return send({ isValid: false, success: false, invalidReason: "mock_error: " + e.message }); }
});
await new Promise((r) => mock.listen(MOCK_PORT, r));

// --- 1. use up the free allowance (20/day for the check) ---
let first402 = null, freeCalls = 0;
for (let i = 0; i < 25 && !first402; i++) {
  const res = await fetch(CHECK);
  if (res.status === 402) first402 = res; else { freeCalls++; await res.text(); }
}
ok(freeCalls === 20, `free allowance: ${freeCalls} calls served before the first 402 (expected 20)`);
ok(!!first402, "REST: HTTP 402 after the allowance");

// --- 2. does the official client read the 402? ---
const account = privateKeyToAccount(generatePrivateKey());
const core = new x402Client().register("eip155:84532", new ExactEvmScheme(account));
const http402 = new x402HTTPClient(core);
const body402 = await first402.json();
const hdr = first402.headers.get("payment-required");
ok(!!hdr, "REST: PAYMENT-REQUIRED header present");
const required = http402.getPaymentRequiredResponse((n) => first402.headers.get(n), body402);
ok(required.x402Version === 2, "official client: x402Version 2");
const acc = required.accepts[0];
ok(acc.scheme === "exact" && acc.network === "eip155:84532" && acc.amount === "100000" && acc.payTo.toLowerCase() === PAY_TO.toLowerCase(), "official client: accepts[0] = exact / base-sepolia / 100000 / dummy pay-to");
console.log("      resource:", JSON.stringify(required.resource), "extra:", JSON.stringify(acc.extra));

// --- 3. build a payment with the official client and pay (REST) ---
const payload = await core.createPaymentPayload(required);
const sigHeaders = http402.encodePaymentSignatureHeader(payload);
ok(!!Object.values(sigHeaders)[0], `official client built a payment (header ${Object.keys(sigHeaders)[0]})`);
const paid = await fetch(CHECK, { headers: sigHeaders });
const paidText = await paid.text();
console.log("      paid call status:", paid.status, "charged:", paid.headers.get("x-proofprice-charged"), "payment-response:", paid.headers.get("payment-response") ? "yes" : "no");
if (paid.status === 200) {
  const settle = http402.getPaymentSettleResponse((n) => paid.headers.get(n));
  ok(settle.success === true && /^0x[0-9a-f]{64}$/.test(settle.transaction), "REST: settlement header read by the official client");
  ok(!paidText.includes(account.address) && !JSON.stringify([...paid.headers]).toLowerCase().includes(account.address.toLowerCase()), "payer address not echoed anywhere");
} else {
  console.log("      body:", paidText.slice(0, 300));
  ok(paid.status === 200 || paid.headers.get("x-proofprice-charged") === "no", "paid REST call answered, or honestly not charged");
}
ok(seen.verify >= 1, "mock facilitator verified a real EIP-3009 signature");

// --- 4. same for the MCP tool ---
async function mcp(method, params, id, extraMeta) {
  const res = await fetch(`${APP}/api/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params: extraMeta ? { ...params, _meta: extraMeta } : params }) });
  const t = await res.text();
  const line = t.split("\n").find((l) => l.startsWith("data:"));
  return JSON.parse(line ? line.slice(5) : t);
}
const args = { category: "rent", country: "CA", town: "Toronto", bedrooms: "2", price: 1900, unit: "per month" };
let r1, mcpFree = 0;
for (let i = 0; i < 25; i++) {
  r1 = await mcp("tools/call", { name: "pricepaid_check_price", arguments: args }, 100 + i);
  if (r1.result?.isError && r1.result?.structuredContent?.x402Version === 2) break;
  mcpFree++;
}
ok(mcpFree === 20, `MCP: ${mcpFree} free calls before the first payment request (expected 20)`);
const sc = r1.result?.structuredContent;
ok(r1.result?.isError === true && sc?.x402Version === 2 && sc?.accepts?.[0]?.amount === "100000", "MCP: quota used (shared per caller) -> isError result with x402 v2 requirements");
if (sc?.accepts) {
  const req2 = sc; // MCP: the PaymentRequired object is the structured content itself (x402 MCP transport)
  const p2 = await core.createPaymentPayload(req2);
  const r2 = await mcp("tools/call", { name: "pricepaid_check_price", arguments: args }, 2, { "x402/payment": p2 });
  console.log("      MCP paid: isError =", r2.result?.isError, " _meta =", JSON.stringify(r2.result?._meta));
  ok(!r2.result?.isError && r2.result?._meta?.["x402/payment-response"]?.success === true, "MCP: paid call returned the answer with a settlement in _meta");
}
mock.close();
console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
