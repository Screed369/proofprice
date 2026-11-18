// The "cashier": asks an x402 facilitator to verify a signed payment and to settle it (move the USDC).
// Tests pass a mock Facilitator; production uses httpFacilitator (fetch, short timeouts, CDP sign-in when keys exist).
import { isSolanaAddress, type GateConfig } from "./config";
import { cdpJwt } from "./cdp-jwt";

export interface VerifyResult { isValid: boolean; invalidReason?: string }
export interface SettleResult {
  success: boolean;
  transaction?: string;
  network?: string;
  errorReason?: string;
  /** The payer's public address as the facilitator reports it. Only ever used to count distinct wallets (hashed, never stored or returned). */
  payer?: string;
}

export interface Facilitator {
  verify(payload: unknown, requirements: unknown): Promise<VerifyResult>;
  settle(payload: unknown, requirements: unknown): Promise<SettleResult>;
  /**
   * Solana only: the fee-payer addresses the facilitator signs with on `network` (GET /supported, kinds[].extra.feePayer for
   * scheme "exact" and x402Version 2). An empty list or no method means the Solana option is not offered and Solana payments are
   * refused. Not needed for Base.
   */
  solanaFeePayers?(network: string): Promise<string[]>;
}

/** Fee payers for `network` from a GET /supported reply (x402 v2 SupportedResponse). Pure, exported for tests. */
export function feePayersFromSupported(body: any, network: string): string[] {
  const kinds: any[] = Array.isArray(body?.kinds) ? body.kinds : [];
  const out = kinds
    .filter((k) => k?.x402Version === 2 && k?.scheme === "exact" && k?.network === network)
    .map((k) => k?.extra?.feePayer)
    .filter(isSolanaAddress);
  // `signers` (required in a v2 SupportedResponse) lists every signer, so a fee payer from an earlier /supported reply still matches
  // when the facilitator rotates among several. Kind fee payers come first: the first one is the one we offer.
  const signers = body?.signers && typeof body.signers === "object" ? body.signers : {};
  for (const pattern of [network, `${network.split(":")[0]}:*`]) {
    const list = signers[pattern];
    if (Array.isArray(list) && out.length) out.push(...list.filter(isSolanaAddress));
  }
  return [...new Set(out)];
}

const SUPPORTED_TTL_MS = 10 * 60_000;
const supportedCache = new Map<string, { at: number; body: any }>();
export function resetSupportedCacheForTests(): void {
  supportedCache.clear();
}

const TIMEOUT_MS = 12_000;

export function httpFacilitator(cfg: GateConfig, fetchImpl: typeof fetch = fetch): Facilitator {
  const base = new URL(cfg.facilitatorUrl);
  async function post(action: "verify" | "settle", payload: unknown, requirements: unknown): Promise<any> {
    const path = `${base.pathname.replace(/\/+$/, "")}/${action}`;
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (cfg.cdpKeyId && cfg.cdpKeySecret && base.host.endsWith("coinbase.com")) {
      headers.authorization = `Bearer ${cdpJwt(cfg.cdpKeyId, cfg.cdpKeySecret, "POST", base.host, path)}`;
    }
    const res = await fetchImpl(`${base.origin}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ x402Version: 2, paymentPayload: payload, paymentRequirements: requirements }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok && res.status >= 500) throw new Error(`facilitator ${action} HTTP ${res.status}`);
    return res.json().catch(() => ({}));
  }
  async function supported(): Promise<any> {
    const hit = supportedCache.get(cfg.facilitatorUrl);
    if (hit && Date.now() - hit.at < SUPPORTED_TTL_MS) return hit.body;
    const path = `${base.pathname.replace(/\/+$/, "")}/supported`;
    const headers: Record<string, string> = { accept: "application/json" };
    if (cfg.cdpKeyId && cfg.cdpKeySecret && base.host.endsWith("coinbase.com")) {
      headers.authorization = `Bearer ${cdpJwt(cfg.cdpKeyId, cfg.cdpKeySecret, "GET", base.host, path)}`;
    }
    const res = await fetchImpl(`${base.origin}${path}`, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`facilitator supported HTTP ${res.status}`);
    const body = await res.json();
    supportedCache.set(cfg.facilitatorUrl, { at: Date.now(), body });
    return body;
  }
  return {
    async solanaFeePayers(network) {
      return feePayersFromSupported(await supported(), network);
    },
    async verify(payload, requirements) {
      const r = await post("verify", payload, requirements);
      return { isValid: r?.isValid === true, invalidReason: typeof r?.invalidReason === "string" ? r.invalidReason : undefined };
    },
    async settle(payload, requirements) {
      const r = await post("settle", payload, requirements);
      return {
        success: r?.success === true,
        transaction: typeof r?.transaction === "string" ? r.transaction : undefined,
        network: typeof r?.network === "string" ? r.network : undefined,
        errorReason: typeof r?.errorReason === "string" ? r.errorReason : undefined,
        payer: typeof r?.payer === "string" ? r.payer : undefined,
      };
    },
  };
}
