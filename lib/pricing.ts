// Pricing facts for /pricing, /pricing.json, llms.txt and openapi.json. Every number is read from lib/payments/prices.ts
// (the one place prices live) and the cleared-source list; nothing is typed in here. Read-only: this file changes no payment behaviour.

import { CHECK_REST, CHECK_TOOL } from "./check";
import { CLEARED_FOR_PAID } from "./payments/cleared";
import { DAILY_PAID_CAP, PREMIUM, type PremiumKey } from "./payments/prices";
import { readGateConfig } from "./payments/config";
import { CATEGORIES } from "./registry";
import { CONTACT, SITE_URL } from "./site/constants";

export type PaymentMode = "off" | "testnet" | "mainnet";

/** Whether paid calls are switched on right now. Reads only the public mode, never the wallet address or any key. */
export function paymentMode(): PaymentMode {
  const cfg = readGateConfig();
  if (!cfg) return "off";
  return cfg.network === "base" ? "mainnet" : "testnet";
}

export function usd(microUsd: number): string {
  const v = microUsd / 1_000_000;
  return `USD ${v.toFixed(2)}`;
}

export function pricingFacts(baseUrl: string = SITE_URL) {
  const historyTools = CATEGORIES.filter((c) => c.history).map((c) => c.history!.tool);
  const mode = paymentMode();
  const premium = (Object.keys(PREMIUM) as PremiumKey[]).map((key) => ({
    id: key,
    what: PREMIUM[key].label,
    price_usd: PREMIUM[key].microUsd / 1_000_000,
    price_per_call: usd(PREMIUM[key].microUsd),
    free_calls_per_day: PREMIUM[key].freePerDay,
    mcp_tools: key === "check" ? [CHECK_TOOL] : historyTools,
    rest: key === "check" ? `${baseUrl}${CHECK_REST}` : `${baseUrl}/api/v1/<category>/history`,
  }));
  return {
    name: "ProofPrice pricing",
    currency: "USD",
    payment_mode: mode,
    payments_note:
      mode === "off"
        ? "Paid calls are not switched on yet. Every call is free today."
        : mode === "testnet"
          ? "Paid calls are being tested with test money only (no real money moves)."
          : "Paid calls are switched on.",
    free_forever: [
      "Every category tool and REST path (/api/v1/<category>)",
      "Coverage, sources, licences",
      "llms.txt, llms-full.txt, openapi.json, setup guides and all public pages",
    ],
    premium,
    payment_method: {
      protocol: "x402 (version 2)",
      how: "The caller asks. After the free calls for the day are used, the reply is HTTP 402 (REST) or an error result (MCP) that says what to pay and where. The caller signs a USDC payment and repeats the call with it. We only settle the payment when we have a real answer.",
      network_when_live: "Base (USDC)",
    },
    never_charged: [
      "Any answer that uses a source not yet cleared for commercial use (served free, with a note)",
      "Answers with not enough records, no match, errors or a source that could not be reached",
    ],
    sources_cleared_for_paid_use: CLEARED_FOR_PAID.size,
    daily_paid_call_cap_per_server_instance: DAILY_PAID_CAP,
    business_plans: `Email ${CONTACT}`,
    status: "Prices approved by the owner on 20 Oct 2026. Payments are off until they are switched on.",
    page: `${baseUrl}/pricing`,
  };
}
