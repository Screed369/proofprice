// The "cashier": asks an x402 facilitator to verify a signed payment and to settle it (move the USDC).
// Tests pass a mock Facilitator; production uses httpFacilitator (fetch, short timeouts, CDP sign-in when keys exist).
import type { GateConfig } from "./config";
import { cdpJwt } from "./cdp-jwt";

export interface VerifyResult { isValid: boolean; invalidReason?: string }
export interface SettleResult { success: boolean; transaction?: string; network?: string; errorReason?: string }

export interface Facilitator {
  verify(payload: unknown, requirements: unknown): Promise<VerifyResult>;
  settle(payload: unknown, requirements: unknown): Promise<SettleResult>;
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
  return {
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
      };
    },
  };
}
