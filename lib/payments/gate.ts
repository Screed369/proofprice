// The x402 payment gate (central code; sources never see it). The flow:
//   1. No payment sent and the caller still has free calls today  -> serve the answer, free.
//   2. No payment sent and the free calls are used up             -> HTTP 402 with the payment requirements (price, asset, pay-to).
//   3. Payment sent -> the facilitator VERIFIES it, we run the call, and only if the call returned a real answer do we SETTLE.
//      "Not enough records" and errors are never charged. If settlement fails the answer is withheld (fail closed).
// Responses never contain the payer's address or any caller identifier; the only payment detail returned is the settlement
// transaction hash, in a header. Facilitator problems end in 503 for premium calls only; free tools never touch this file.
import { isSolanaAddress, type GateConfig } from "./config";
import type { Facilitator } from "./facilitator";
import { SITE_URL } from "../site/constants";
import { bazaarExtension, descriptionFor } from "./discovery";
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

/** Solana `exact` requirements (x402 spec scheme_exact_svm.md): `extra.feePayer` is the facilitator's fee-paying signer. */
export interface SolanaPaymentRequirements {
  scheme: "exact";
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: { feePayer: string };
}

export function buildSolanaRequirements(cfg: GateConfig, key: PremiumKey, feePayer: string): SolanaPaymentRequirements | null {
  if (!cfg.solana || !isSolanaAddress(feePayer)) return null;
  return {
    scheme: "exact",
    network: cfg.solana.caip2,
    amount: String(PREMIUM[key].microUsd), // USDC has 6 decimals on Solana too
    asset: cfg.solana.asset,
    payTo: cfg.solana.payTo,
    maxTimeoutSeconds: 60,
    extra: { feePayer },
  };
}

/** The Solana option for a 402, or [] when it is off or the facilitator offers no fee payer (then only Base is offered). */
async function solanaAccepts(cfg: GateConfig, facilitator: Facilitator | undefined, key: PremiumKey): Promise<SolanaPaymentRequirements[]> {
  if (!cfg.solana || !facilitator?.solanaFeePayers) return [];
  try {
    const payers = await facilitator.solanaFeePayers(cfg.solana.caip2);
    const r = payers.length ? buildSolanaRequirements(cfg, key, payers[0]) : null;
    return r ? [r] : [];
  } catch {
    return [];
  }
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

/** The `resource` block of a 402 (and of what the facilitator is sent): URL, a plain description (at most 500 characters) and the type. */
export function resourceFor(key: PremiumKey, resourceUrl: string) {
  return { url: resourceUrl, description: descriptionFor(key, resourceUrl), mimeType: "application/json" };
}

/**
 * What the facilitator is sent on verify and settle. Coinbase's Bazaar indexes a paid resource only when the settle call carries
 * `paymentPayload.resource` and `paymentPayload.extensions.bazaar`. A client normally echoes both from our 402, but we do not rely on
 * that: our own values (never the payer's) are set here, over anything the payer sent. The payer's signed part is left untouched.
 */
export function facilitatorPayload(payload: any, key: PremiumKey, resourceUrl: string): any {
  return {
    ...payload,
    resource: resourceFor(key, resourceUrl),
    extensions: { ...(payload?.extensions && typeof payload.extensions === "object" ? payload.extensions : {}), bazaar: bazaarExtension(key, resourceUrl) },
  };
}

export function paymentRequiredBody(
  cfg: GateConfig,
  key: PremiumKey,
  resourceUrl: string,
  error = "payment_required",
  reason?: string,
  /** Extra payment options after Base (today only USDC on Solana, when switched on). */
  more: SolanaPaymentRequirements[] = [],
) {
  const p = PREMIUM[key];
  return {
    x402Version: 2,
    error,
    ...(reason ? { reason } : {}),
    resource: resourceFor(key, resourceUrl),
    accepts: [buildRequirements(cfg, key), ...more] as Array<PaymentRequirements | SolanaPaymentRequirements>,
    extensions: { bazaar: bazaarExtension(key, resourceUrl) },
    notice:
      p.freePerDay > 0
        ? `The free allowance of ${p.freePerDay} calls a day for this tool is used up. Basic price look-ups stay free and need no payment. Not charged when the answer is "not enough records" or an error.`
        : `This call is paid from the first call (USD ${(p.microUsd / 1_000_000).toFixed(2)}). The basic look-up without trend stays free and needs no payment. Not charged when the answer is "not enough records" or an error.`,
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
  /** Called once after a payment is settled, with the premium key and the payer's public address (when known). For anonymous counting only. */
  onPaid?: (info: { key: PremiumKey; wallet: string | null }) => void;
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

// Solana duplicate-settlement guard (recommended by the x402 SVM spec): the same signed transaction may not be settled twice
// within 120 s (about twice a Solana blockhash lifetime), so one payment can never buy two answers on this instance.
const SOLANA_SETTLE_TTL_MS = 120_000;
const solanaInFlight = new Map<string, number>();
function claimSolanaTx(tx: string, now: number): boolean {
  for (const [k, t] of solanaInFlight) if (now - t > SOLANA_SETTLE_TTL_MS) solanaInFlight.delete(k);
  if (solanaInFlight.has(tx)) return false;
  solanaInFlight.set(tx, now);
  return true;
}
export function resetSolanaGuardForTests(): void {
  solanaInFlight.clear();
}

async function deny402(cfg: GateConfig, key: PremiumKey, url: string, error: string, reason?: string, facilitator?: Facilitator): Promise<GateOutcome<never>> {
  const body: any = paymentRequiredBody(cfg, key, url, error, reason, await solanaAccepts(cfg, facilitator, key));
  // The header must stay small (HTTP header limits): it carries the same reply without the big answer schema, which stays in the body.
  const { outputSchema: _omit, ...bazaarLean } = body.extensions.bazaar;
  const lean = { ...body, extensions: { bazaar: { ...bazaarLean, outputSchemaUrl: `${SITE_URL}/openapi.json` } } };
  return { kind: "denied", status: 402, body, headers: { "payment-required": b64(lean), "cache-control": "no-store" } };
}

export async function gateCall<T>(o: GateOptions<T>): Promise<GateOutcome<T>> {
  const { cfg, key } = o;
  const now = o.now ?? new Date();
  const header = o.paymentHeader?.trim();

  if (!header) {
    // freePerDay 0 = paid from the first call: no free call is ever taken (and no counter entry is made).
    if (PREMIUM[key].freePerDay > 0 && takeFree(o.callerAddress, key, PREMIUM[key].freePerDay, now)) {
      return { kind: "served", result: await o.run(), paid: false, headers: {} };
    }
    return deny402(cfg, key, o.resourceUrl, "payment_required", undefined, o.facilitator);
  }

  if (paidCapReached(DAILY_PAID_CAP, now)) {
    return { kind: "denied", status: 503, body: { error: "paid_calls_paused", notice: "Premium calls are paused for today. Basic look-ups are unaffected." }, headers: { "cache-control": "no-store" } };
  }

  const payload = decodePayment(header);
  const deny = (error: string, reason?: string) => deny402(cfg, key, o.resourceUrl, error, reason, o.facilitator);
  const unavailable = (notice: string): GateOutcome<T> => ({ kind: "denied", status: 503, body: { error: "payment_service_unavailable", notice }, headers: { "cache-control": "no-store", "retry-after": "30" } });
  const a = payload?.accepted;

  // Which payment option did the payer pick? Base unless it is exactly our Solana network (and Solana is switched on).
  const isSolana = !!cfg.solana && a?.network === cfg.solana.caip2;
  let want: PaymentRequirements | SolanaPaymentRequirements;
  let solanaTx: string | null = null;
  if (isSolana) {
    // Fail closed. Only OUR Solana address, the official USDC mint, the exact price, the exact scheme, a signed transaction, and a
    // fee payer the facilitator itself advertises. Anything else is refused before the facilitator is asked.
    const sol = cfg.solana!;
    const tx = payload?.payload?.transaction;
    const feePayer = a?.extra?.feePayer;
    if (a.scheme !== "exact" || a.payTo !== sol.payTo || a.asset !== sol.asset || String(a.amount ?? "") !== String(PREMIUM[key].microUsd) || typeof tx !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(tx) || !isSolanaAddress(feePayer)) {
      return deny("invalid_payment", "payment does not match the requirements");
    }
    let payers: string[];
    try {
      payers = o.facilitator.solanaFeePayers ? await o.facilitator.solanaFeePayers(sol.caip2) : [];
    } catch {
      return unavailable("Could not check the payment. Nothing was charged. Try again later.");
    }
    if (!payers.includes(feePayer)) return deny("invalid_payment", "fee payer is not one the facilitator offers");
    want = buildSolanaRequirements(cfg, key, feePayer)!;
    solanaTx = tx;
  } else {
    want = buildRequirements(cfg, key);
    // Our own check first: the payment must be for this price, this wallet and this network. The facilitator then checks the signature.
    if (!payload || !a || a.payTo?.toLowerCase() !== want.payTo.toLowerCase() || a.network !== want.network || a.asset?.toLowerCase() !== want.asset.toLowerCase() || !/^\d+$/.test(String(a.amount ?? "")) || BigInt(a.amount) < BigInt(want.amount)) {
      return deny("invalid_payment", "payment does not match the requirements");
    }
  }

  let verified;
  try {
    verified = await o.facilitator.verify(facilitatorPayload(payload, key, o.resourceUrl), want);
  } catch {
    return unavailable("Could not check the payment. Nothing was charged. Try again later.");
  }
  if (!verified.isValid) return deny("invalid_payment", verified.invalidReason ?? "payment not valid");

  const result = await o.run();
  if (!o.chargeable(result)) return { kind: "served", result, paid: false, headers: { "x-proofprice-charged": "no" } };

  if (solanaTx !== null && !claimSolanaTx(solanaTx, now.getTime())) {
    return deny("invalid_payment", "duplicate_settlement");
  }

  let settled;
  try {
    settled = await o.facilitator.settle(facilitatorPayload(payload, key, o.resourceUrl), want);
  } catch {
    return unavailable("The payment could not be completed, so no answer was released and nothing was charged. Try again later.");
  }
  if (!settled.success) return deny("settlement_failed", settled.errorReason ?? "settlement failed");
  notePaid(now);
  try {
    // The EVM payer is in the signed authorization; the facilitator may also report it (the only source on Solana). Counting only.
    const wallet = settled.payer ?? payload?.payload?.authorization?.from;
    o.onPaid?.({ key, wallet: typeof wallet === "string" && wallet ? wallet : null });
  } catch {
    /* counting must never break a paid answer */
  }
  return {
    kind: "served",
    result,
    paid: true,
    headers: { "payment-response": b64({ success: true, transaction: settled.transaction, network: settled.network ?? want.network }), "x-proofprice-charged": "yes" },
  };
}
