// Entry points used by the REST routes and the MCP tool list. Everything returns "off" (no change at all) unless the gate is active.
import { readGateConfig, type Env, type GateConfig } from "./config";
import { httpFacilitator, type Facilitator } from "./facilitator";
import { gateCall, type GateOutcome } from "./gate";
import { allCleared, UNCLEARED_NOTE } from "./cleared";
import { PREMIUM, type PremiumKey } from "./prices";
import { json, CORS_HEADERS } from "../route-helpers";

export type { GateConfig, Facilitator, GateOutcome, PremiumKey };
export { readGateConfig, PREMIUM };

/** Facilitator used by live routes; tests replace it with a mock. */
let facilitatorOverride: Facilitator | null = null;
export function setFacilitatorForTests(f: Facilitator | null): void {
  facilitatorOverride = f;
}
function facilitatorFor(cfg: GateConfig): Facilitator {
  return facilitatorOverride ?? httpFacilitator(cfg);
}

export function callerAddressOf(headers: Headers | undefined | null): string {
  const xff = headers?.get("x-forwarded-for")?.split(",")[0]?.trim();
  return xff || headers?.get("x-real-ip")?.trim() || "unknown";
}

export function paymentHeaderFromMeta(meta: unknown): string | null {
  const v = (meta as any)?.["x402/payment"];
  return v && typeof v === "object" ? Buffer.from(JSON.stringify(v)).toString("base64") : typeof v === "string" ? v : null;
}

export function paymentHeaderOf(headers: Headers | undefined | null): string | null {
  return headers?.get("payment-signature") ?? headers?.get("x-payment") ?? null;
}

/** Description suffix added to a premium MCP tool only while the gate is active. */
export function premiumNote(key: PremiumKey): string {
  const p = PREMIUM[key];
  return ` After ${p.freePerDay} free calls a day per caller this tool costs USD ${(p.microUsd / 1_000_000).toFixed(2)} per answered call, paid with x402 (USDC); a 402 reply lists how. Nothing is charged for "not enough records" or errors.`;
}

export async function gate<T>(
  key: PremiumKey,
  req: { headers: Headers | undefined | null; url: string; paymentHeader?: string | null },
  run: () => Promise<T>,
  chargeable: (r: T) => boolean,
  /** Source ids behind this call, worked out before anything is charged. REQUIRED: null/unknown/uncleared means served free, never a 402. */
  sources: () => readonly string[] | null | Promise<readonly string[] | null>,
  env: Env = process.env,
): Promise<GateOutcome<T> | null> {
  const cfg = readGateConfig(env);
  if (!cfg) return null;
  // Licence guard (lib/payments/cleared.ts): fail closed. If we cannot tell, or any source is not cleared, nothing is gated or charged.
  let ids: readonly string[] | null = null;
  try {
    ids = await sources();
  } catch {
    ids = null;
  }
  if (!allCleared(ids)) {
    return { kind: "served", result: await run(), paid: false, headers: { "x-proofprice-charged": "no", "x-proofprice-note": UNCLEARED_NOTE } };
  }
  return gateCall({
    cfg,
    facilitator: facilitatorFor(cfg),
    key,
    callerAddress: callerAddressOf(req.headers),
    paymentHeader: req.paymentHeader ?? paymentHeaderOf(req.headers),
    resourceUrl: req.url.split("?")[0],
    run,
    chargeable,
  });
}

/** REST helper: wraps a premium route. With the gate off it simply runs `handler` (no change at all). */
export async function gatedRest(
  key: PremiumKey,
  req: Request,
  handler: () => Promise<Response>,
  sources: () => readonly string[] | null | Promise<readonly string[] | null>,
  chargeable: (res: Response) => boolean | Promise<boolean> = (r) => r.status === 200,
): Promise<Response> {
  const cfg = readGateConfig();
  if (!cfg) return handler();
  // Response bodies are read once, so decide chargeability from the status plus the answer's own status field.
  const out = await gate(
    key,
    { headers: req.headers, url: req.url },
    async () => {
      const res = await handler();
      const text = await res.text();
      return { res, text };
    },
    ({ res, text }) => res.status === 200 && isAnswered(text),
    sources,
  );
  if (!out) return handler();
  if (out.kind === "denied") return json(out.body, out.status, 0, out.headers);
  const { res, text } = out.result;
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(out.headers)) headers.set(k, v);
  headers.set("access-control-expose-headers", `${CORS_HEADERS["access-control-expose-headers"]}, payment-required, payment-response, x-proofprice-charged, x-proofprice-note`);
  headers.set("cache-control", "no-store"); // premium answers are never shared from the CDN cache
  return new Response(text, { status: res.status, headers });
}

/** An answer worth charging for: not "insufficient_data"/"no_matches"/"unsupported" and not a stale copy. */
export function isAnswered(text: string): boolean {
  try {
    const o = JSON.parse(text);
    if (o?.verdict === "cannot_judge") return false;
    const s = o?.status ?? o?.answer?.status;
    return s === "ok" && (o?.extra?.stale ?? o?.answer?.extra?.stale) !== true;
  } catch {
    return false;
  }
}
