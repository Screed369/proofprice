# Payments (x402) — design and switch-on guide

Status: built, **OFF by default**. With neither `PROOFPRICE_X402_ENABLED` nor `PROOFPRICE_X402_PAY_TO` set, every answer, REST route and MCP tool is exactly as before.

## What is free and what can cost
- **Always free, never gated:** the 15 category tools and `/api/v1/<category>`, `pricepaid_coverage`, answer pages, llms.txt, openapi.json, connect guides. Discoverability depends on it.
- **Premium (gated only when the gate is on):** the price check with itemised analysis (`pricepaid_check_price`, `GET /api/v1/check`) and daily history (`pricepaid_*_history`, `GET /api/v1/<category>/history`). Bulk is not built; it gets an entry in `lib/payments/prices.ts` when it exists.
- **Free quota first:** each caller gets a number of free premium calls per UTC day before the first HTTP 402. Prices and quotas live in ONE file: `lib/payments/prices.ts` (approved by Simon 20 Oct 2026, from the Strategist's pricing research of 15 Oct 2026: check USD 0.10 / 20 free a day, history USD 0.02 / 10 free a day). Change them there.
- **Licence guard (S1):** a premium call is gated and charged ONLY when every source behind it is on the cleared list in `lib/payments/cleared.ts` (Source Pipeline lines "Licence checked: ... commercial: yes"). Any other source, or a call whose source cannot be worked out, is served free with an `x-proofprice-note` header (MCP: `_meta["proofprice/note"]`): never a 402, a payment sent is ignored and never verified or settled. A new source is NOT cleared until its id is added there.
- **Never charged:** "not enough records", no matches, errors, stale copies. The answer is identical free or paid.

## Flow
1. No payment, free calls left → answer, free.
2. No payment, quota used → **HTTP 402** (REST) or an `isError` result (MCP) with `x402Version: 2`, `accepts: [{scheme: "exact", network, amount, asset, payTo, ...}]` (also in the `PAYMENT-REQUIRED` header, base64).
3. Payment sent (`PAYMENT-SIGNATURE` or `X-PAYMENT` header, base64 JSON; for MCP `_meta["x402/payment"]`) → we check it is for our wallet, network and price, the **facilitator verifies** it, we run the call, and only for a real answer the **facilitator settles**. If settlement fails the answer is withheld (fail closed). Success carries `PAYMENT-RESPONSE` (settlement transaction hash only).
4. Facilitator down → HTTP 503 on premium calls only. Free tools never touch the gate.

## Environment variables (all set by Simon in Vercel; none are in the repo)
| Variable | Meaning |
|---|---|
| `PROOFPRICE_X402_ENABLED` | `true` to switch the gate on. Anything else = off. |
| `PROOFPRICE_X402_PAY_TO` | Your PUBLIC receiving wallet address (0x…). |
| `PROOFPRICE_X402_NETWORK` | `base-sepolia` (default, testnet) or `base` (mainnet). |
| `PROOFPRICE_X402_FACILITATOR_URL` | Optional. Default: x402.org (testnet), Coinbase CDP (mainnet). |
| `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET` | Coinbase CDP facilitator keys. Required for mainnet (the gate stays off without them). Secret: Vercel settings only. |

## Honest limits
- **Free quota is best-effort.** There are no API keys, so a caller is a network address, hashed with a daily salt and held in one server instance's memory (never stored, returned or logged). With several instances the true allowance can exceed the setting. A shared store would fix it; not needed yet.
- A paid-call safety cap (`DAILY_PAID_CAP`) per instance per day pauses premium calls with 503 if abused.
- The code speaks the x402 v2 HTTP flow directly (no x402 packages) and signs CDP requests with Node's `crypto`. It has been tested against a mock facilitator only. **First live check is the testnet paid call** (see the go-live steps in Notion).
- Before real money: accountant answers, Vercel plan (Hobby is non-commercial), licence flags for sources inside paid tiers (Cook County, br-fuel, mx-fuel unconfirmed; ODbL/PSRA conditions) — see the pricing research pages.

## Rehearsal result (S2, 2026-10-20)
`scripts/x402-rehearsal/` runs the gate locally on base-sepolia with the official x402 client (`@x402/core` 2.28.0, `@x402/evm`). All checks pass for REST (`/api/v1/check`) and MCP (`pricepaid_check_price`): exactly 20 free calls, then a 402 / `isError` result with `x402Version: 2` and `accepts[0]` = exact, eip155:84532, 100000 (USD 0.10), the pay-to address; the client reads it and builds a signed payment (`PAYMENT-SIGNATURE` header for REST, `_meta["x402/payment"]` for MCP); the signature recovers to the payer; the answer comes back with the settlement in `PAYMENT-RESPONSE` (REST) or `_meta["x402/payment-response"]` (MCP); the payer address is never echoed. A paid call whose source is unreachable answers 502 and is NOT charged (verified, never settled). Not tested: the real x402.org and CDP facilitators (no network to them here) and a CDP-signed request. Free-allowance counters are per route and per instance (REST and MCP count separately), which the "honest limits" above already allow.
