// The x402 payment gate (central code; sources never see it). The flow:
//   1. No payment sent and the caller still has free calls today  -> serve the answer, free.
//   2. No payment sent and the free calls are used up             -> HTTP 402 with the payment requirements (price, asset, pay-to).
//   3. Payment sent -> the facilitator VERIFIES it, we run the call, and only if the call returned a real answer do we SETTLE.
//      "Not enough records" and errors are never charged. If settlement fails the answer is withheld (fail closed).
// Responses never contain the payer's address or any caller identifier; the only payment detail returned is the settlement
// transaction hash, in a header. Facilitator problems end in 503 for premium calls only; free tools never touch this file.
import type { GateConfig } from "./config";
import type { Facilitator } from "./facilitator";
import { DAILY_PAID_CAP, PREMIUM, type PremiumKey } from "./prices";
import { notePaid, paidCapReached, takeFree } from "./quota";

export interface PaymentRequirements {
  scheme: "exact";
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: { name: string; version: string };
}

export function buildRequirements(cfg: GateConfig, key: PremiumKey): PaymentRequirements {
  return {
    scheme: "exact",
    network: cfg.caip2,
    amount: String(PREMIUM[key].microUsd),
    asset: cfg.asset,
    payTo: cfg.payTo,
    maxTimeoutSeconds: 60,
    extra: { name: cfg.assetName, version: cfg.assetVersion },
  };
}

export function paymentRequiredBody(cfg: GateConfig, key: PremiumKey, resourceUrl: string, error = "payment_required", reason?: string) {
  const p = PREMIUM[key];
  return {
    x402Version: 2,
    error,
    ...(reason ? { reason } : {}),
    resource: { url: resourceUrl, description: `ProofPrice ${p.label}`, mimeType: "application/json" },
    accepts: [buildRequirements(cfg, key)],
    notice: `The free allowance of ${p.freePerDay} calls a day for this tool is used up. Basic price look-ups stay free and need no payment. Not charged when the answer is "not enough records" or an error.`,
  };
}

export type GateOutcome<T> =
  | { kind: "served"; result: T; paid: boolean; headers: Record<string, string> }
  | { kind: "denied"; status: 402 | 503; body: Record<string, unknown>; headers: Record<string, string> };

export interface GateOptions<T> {
  cfg: GateConfig;
  facilitator: Facilitator;
  key: PremiumKey;
  /** Network address of the caller, used only for the free-quota counter (hashed in memory, see quota.ts). */
  callerAddress: string;
  /** The payment header value (base64 JSON) if the caller sent one. */
  paymentHeader?: string | null;
  resourceUrl: string;
  run: () => Promise<T>;
  /** True when the result is a real answer worth charging for. */
  chargeable: (r: T) => boolean;
  now?: Date;
}

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64");

function decodePayment(h: string): any | null {
  try {
    const v = JSON.parse(Buffer.from(h.trim(), "base64").toString("utf8"));
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

function deny402(cfg: GateConfig, key: PremiumKey, url: string, error: string, reason?: string): GateOutcome<never> {
  const body = paymentRequiredBody(cfg, key, url, error, reason);
  return { kind: "denied", status: 402, body, headers: { "payment-required": b64(body), "cache-control": "no-store" } };
}

export async function gateCall<T>(o: GateOptions<T>): Promise<GateOutcome<T>> {
  const { cfg, key } = o;
  const now = o.now ?? new Date();
  const header = o.paymentHeader?.trim();

  if (!header) {
    if (takeFree(o.callerAddress, key, PREMIUM[key].freePerDay, now)) {
      return { kind: "served", result: await o.run(), paid: false, headers: {} };
    }
    return deny402(cfg, key, o.resourceUrl, "payment_required");
  }

  if (paidCapReached(DAILY_PAID_CAP, now)) {
    return { kind: "denied", status: 503, body: { error: "paid_calls_paused", notice: "Premium calls are paused for today. Basic look-ups are unaffected." }, headers: { "cache-control": "no-store" } };
  }

  const payload = decodePayment(header);
  const want = buildRequirements(cfg, key);
  const a = payload?.accepted;
  // Our own check first: the payment must be for this price, this wallet and this network. The facilitator then checks the signature.
  if (!payload || !a || a.payTo?.toLowerCase() !== want.payTo.toLowerCase() || a.network !== want.network || a.asset?.toLowerCase() !== want.asset.toLowerCase() || !/^\d+$/.test(String(a.amount ?? "")) || BigInt(a.amount) < BigInt(want.amount)) {
    return deny402(cfg, key, o.resourceUrl, "invalid_payment", "payment does not match the requirements");
  }

  let verified;
  try {
    verified = await o.facilitator.verify(payload, want);
  } catch {
    return { kind: "denied", status: 503, body: { error: "payment_service_unavailable", notice: "Could not check the payment. Nothing was charged. Try again later." }, headers: { "cache-control": "no-store", "retry-after": "30" } };
  }
  if (!verified.isValid) return deny402(cfg, key, o.resourceUrl, "invalid_payment", verified.invalidReason ?? "payment not valid");

  const result = await o.run();
  if (!o.chargeable(result)) return { kind: "served", result, paid: false, headers: { "x-proofprice-charged": "no" } };

  let settled;
  try {
    settled = await o.facilitator.settle(payload, want);
  } catch {
    return { kind: "denied", status: 503, body: { error: "payment_service_unavailable", notice: "The payment could not be completed, so no answer was released and nothing was charged. Try again later." }, headers: { "cache-control": "no-store", "retry-after": "30" } };
  }
  if (!settled.success) return deny402(cfg, key, o.resourceUrl, "settlement_failed", settled.errorReason ?? "settlement failed");
  notePaid(now);
  return {
    kind: "served",
    result,
    paid: true,
    headers: { "payment-response": b64({ success: true, transaction: settled.transaction, network: settled.network ?? want.network }), "x-proofprice-charged": "yes" },
  };
}
