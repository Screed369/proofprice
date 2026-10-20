// LIVE testnet payment check against https://proofprice.com (gate on, base-sepolia, USDC test money only).
// The paying key is a throwaway TESTNET key in the secret X402_TEST_WALLET_KEY. It is never printed.
// Prints a plain report; exit code is always 0 so a failed check does not email the owner (the report says PASS/FAIL).
import { privateKeyToAccount } from "viem/accounts";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { ExactEvmScheme } from "@x402/evm/exact/client";

const APP = process.env.APP_URL ?? "https://proofprice.com";
const KEY = process.env.X402_TEST_WALLET_KEY;
const CHECK = `${APP}/api/v1/check?category=rent&country=CA&town=Toronto&bedrooms=2&price=1900&unit=per%20month&ppcheck=1`;
const UA = { "user-agent": "ProofPrice-x402-livecheck/1.0 (+https://proofprice.com; hello@proofprice.com)" };
const MAX_FREE = 80;
let failures = 0;
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"}  ${m}`); if (!c) failures++; };
const safe = (s) => String(s).replace(/0x[0-9a-fA-F]{64}/g, "0x<hash>");

if (!KEY || !/^0x[0-9a-fA-F]{64}$/.test(KEY)) { console.log("FAIL  secret X402_TEST_WALLET_KEY missing or malformed"); process.exit(0); }
const account = privateKeyToAccount(KEY);
console.log("payer (public test address):", account.address);
const core = new x402Client().register("eip155:84532", new ExactEvmScheme(account));
const http402 = new x402HTTPClient(core);

try {
  // 0. gate state
  const pj = await (await fetch(`${APP}/pricing.json`, { headers: UA })).json();
  ok(pj.payment_mode === "testnet", `pricing.json payment_mode = ${pj.payment_mode} (expected testnet)`);

  // 1. REST: use up the free allowance until the first 402
  let first402 = null, free = 0, lastStatus = null;
  for (let i = 0; i < MAX_FREE && !first402; i++) {
    const res = await fetch(CHECK, { headers: UA });
    lastStatus = res.status;
    if (res.status === 402) first402 = res; else { free++; await res.text(); }
  }
  ok(!!first402, `REST: reached HTTP 402 after ${free} free calls (last status ${lastStatus}; instances may differ, 20 expected)`);
  if (first402) {
    const body = await first402.json().catch(() => ({}));
    const required = http402.getPaymentRequiredResponse((n) => first402.headers.get(n), body);
    const acc = required.accepts[0];
    console.log("      accepts[0]:", JSON.stringify({ scheme: acc.scheme, network: acc.network, amount: acc.amount, payTo: acc.payTo, asset: acc.asset }));
    ok(required.x402Version === 2 && acc.scheme === "exact" && acc.network === "eip155:84532" && acc.amount === "100000", "REST: 402 is x402 v2, exact, base-sepolia, 100000 (USD 0.10)");
    const payload = await core.createPaymentPayload(required);
    const sigHeaders = http402.encodePaymentSignatureHeader(payload);
    const paid = await fetch(CHECK, { headers: { ...UA, ...sigHeaders } });
    const text = await paid.text();
    console.log("      paid call:", paid.status, "charged:", paid.headers.get("x-proofprice-charged"), "payment-response header:", paid.headers.get("payment-response") ? "yes" : "no");
    if (paid.status === 200) {
      const settle = http402.getPaymentSettleResponse((n) => paid.headers.get(n));
      console.log("      settlement:", safe(JSON.stringify({ success: settle.success, network: settle.network, transaction: settle.transaction })));
      ok(settle.success === true && /^0x[0-9a-f]{64}$/.test(settle.transaction ?? ""), "REST: real facilitator verified AND settled the payment on base-sepolia");
      ok(!text.toLowerCase().includes(account.address.toLowerCase()), "payer address not echoed in the answer");
      console.log("      answer summary:", text.includes('"status":"ok"') || text.includes('"status": "ok"') ? "status ok" : "NOT ok: " + text.slice(0, 200));
    } else {
      console.log("      body:", safe(text.slice(0, 400)));
      ok(false, `REST: paid call returned ${paid.status} (not 200)`);
    }
  }

  // 2. MCP
  const mcp = async (method, params, id, meta) => {
    const res = await fetch(`${APP}/api/mcp`, { method: "POST", headers: { ...UA, "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params: meta ? { ...params, _meta: meta } : params }) });
    const t = await res.text(); const line = t.split("\n").find((l) => l.startsWith("data:"));
    return JSON.parse(line ? line.slice(5) : t);
  };
  const args = { category: "rent", country: "CA", town: "Toronto", bedrooms: "2", price: 1900, unit: "per month" };
  let r1, mfree = 0, gated = false;
  for (let i = 0; i < MAX_FREE; i++) {
    r1 = await mcp("tools/call", { name: "pricepaid_check_price", arguments: args }, 100 + i);
    if (r1.result?.isError && r1.result?.structuredContent?.x402Version === 2) { gated = true; break; }
    mfree++;
  }
  ok(gated, `MCP: payment request after ${mfree} free calls (20 expected)`);
  if (gated) {
    const p2 = await core.createPaymentPayload(r1.result.structuredContent);
    const r2 = await mcp("tools/call", { name: "pricepaid_check_price", arguments: args }, 5, { "x402/payment": p2 });
    const resp = r2.result?._meta?.["x402/payment-response"];
    console.log("      MCP settlement:", safe(JSON.stringify(resp ?? null)));
    ok(!r2.result?.isError && resp?.success === true, "MCP: paid call answered and settled on base-sepolia");
  }
} catch (e) {
  console.log("FAIL  unexpected error:", safe(e?.message ?? e));
  failures++;
}
console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll live checks passed");
