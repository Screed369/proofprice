// Payment gate configuration: environment variables ONLY. Nothing here is a secret except CDP_API_KEY_SECRET, which is read
// from the environment at call time and never logged, returned or stored.
//
//   PROOFPRICE_X402_ENABLED=true      master switch (anything else = off)
//   PROOFPRICE_X402_PAY_TO=0x...      PUBLIC receiving wallet address
//   PROOFPRICE_X402_NETWORK           base-sepolia (default, testnet) | base (mainnet)
//   PROOFPRICE_X402_FACILITATOR_URL   optional override; default x402.org (testnet) or Coinbase CDP (mainnet)
//   CDP_API_KEY_ID / CDP_API_KEY_SECRET   Coinbase CDP facilitator credentials (required for mainnet)
//
// The gate is active only when ENABLED is "true" AND PAY_TO is a valid address (AND, on mainnet, the CDP keys exist).
// With neither variable set, production behaves exactly as before.

export type Env = Record<string, string | undefined>;

export const NETWORKS = {
  "base-sepolia": {
    caip2: "eip155:84532",
    asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    assetName: "USDC",
    assetVersion: "2",
    facilitator: "https://x402.org/facilitator",
    testnet: true,
  },
  base: {
    caip2: "eip155:8453",
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    assetName: "USD Coin",
    assetVersion: "2",
    facilitator: "https://api.cdp.coinbase.com/platform/v2/x402",
    testnet: false,
  },
} as const;
export type NetworkId = keyof typeof NETWORKS;

export interface GateConfig {
  payTo: string;
  network: NetworkId;
  caip2: string;
  asset: string;
  assetName: string;
  assetVersion: string;
  facilitatorUrl: string;
  cdpKeyId?: string;
  cdpKeySecret?: string;
}

const has = (v: string | undefined): v is string => Boolean(v && v.trim());
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** The active gate configuration, or null when the gate is off (the normal state). */
export function readGateConfig(env: Env = process.env): GateConfig | null {
  if (env.PROOFPRICE_X402_ENABLED?.trim().toLowerCase() !== "true") return null;
  const payTo = env.PROOFPRICE_X402_PAY_TO?.trim();
  if (!payTo || !ADDRESS.test(payTo)) return null;
  const requested = (env.PROOFPRICE_X402_NETWORK ?? "base-sepolia").trim() as NetworkId;
  if (!(requested in NETWORKS)) return null; // unknown network: stay off rather than guess
  const n = NETWORKS[requested];
  const cdpKeyId = has(env.CDP_API_KEY_ID) ? env.CDP_API_KEY_ID.trim() : undefined;
  const cdpKeySecret = has(env.CDP_API_KEY_SECRET) ? env.CDP_API_KEY_SECRET.trim() : undefined;
  const custom = has(env.PROOFPRICE_X402_FACILITATOR_URL) ? env.PROOFPRICE_X402_FACILITATOR_URL.trim().replace(/\/+$/, "") : undefined;
  // Mainnet through the default (CDP) facilitator cannot settle without keys, so the gate stays off.
  if (!n.testnet && !custom && !(cdpKeyId && cdpKeySecret)) return null;
  return {
    payTo,
    network: requested,
    caip2: n.caip2,
    asset: n.asset,
    assetName: n.assetName,
    assetVersion: n.assetVersion,
    facilitatorUrl: custom ?? n.facilitator,
    cdpKeyId,
    cdpKeySecret,
  };
}
