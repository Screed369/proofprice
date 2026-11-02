// Signed Price Proofs: ProofPrice as the neutral notary agents show each other before paying.
// Every ok price answer and every price-check verdict can carry a small signed statement (a compact JWS, Ed25519) that anyone can
// check for free at /api/v1/proofs/verify or /p/<proof>, or offline with the public keys at /.well-known/proofprice-keys.json,
// without trusting the agent that shows it.
//
// The answer itself is never changed (lib/answer.ts is untouched): the proof travels beside it, in the X-ProofPrice-Proof and Link
// headers on REST and in _meta["proofprice/proof"] on MCP tool results. Only ok answers and real verdicts are signed: never an error,
// no_matches, insufficient_data or cannot_judge. A stale copy is signed with stale: true in the claims.
// Signing never breaks or slows an answer: it is time-boxed (PROOF_DEADLINE_MS) and any failure just means no proof.

import { randomBytes } from "node:crypto";
import type { PriceAnswer } from "../answer";
import type { CheckResult } from "../check";
import { withDeadline } from "../http";
import { canonicalJson, sha256Hex, signJws, verifyJws } from "./jws";
import type { JwsCheck, PublicJwk, SigningKey } from "./jws";
import { getSigningKey, publicKeys } from "./keys";

export const PROOF_ISSUER = "https://proofprice.com";
export const PROOF_STATEMENT =
  "ProofPrice signed what the official records it cites showed at this time. Evidence, not a valuation, guarantee or offer.";
/** A proof is valid for this long after it is signed. */
export const PROOF_LIFETIME_SEC = 90 * 24 * 3600;
/** The longest a proof may add to an answer (first call on a cold instance loads the key; later calls sign in well under 1 ms). */
export const PROOF_DEADLINE_MS = 1500;
export const PROOF_HEADER = "x-proofprice-proof";
export const PROOF_META_KEY = "proofprice/proof";
export const VERIFY_PATH = "/api/v1/proofs/verify";
export const JWKS_PATH = "/.well-known/proofprice-keys.json";
export const VIEW_PREFIX = "/p/";

export type ProofKind = "answer" | "check";

type Env = Record<string, string | undefined>;

// ---------- what may be signed ----------

/** True for an answer worth a proof: status ok with a price. Errors, no_matches and insufficient_data are never signed. */
export function signableAnswer(a: unknown): a is PriceAnswer {
  const x = a as PriceAnswer | null;
  return Boolean(x && typeof x === "object" && x.status === "ok" && x.price && typeof x.price === "object" && x.source && typeof x.source === "object");
}

/** True for a check worth a proof: a real verdict (not cannot_judge) on an ok answer. */
export function signableCheck(c: unknown): c is CheckResult {
  const x = c as CheckResult | null;
  return Boolean(x && typeof x === "object" && typeof x.verdict === "string" && x.verdict !== "cannot_judge" && signableAnswer(x.answer));
}

// ---------- the claims ----------

const PLACE_KEYS = ["town", "postcode_district", "postcode", "area", "region", "county", "department", "state", "province", "city", "commune", "place", "origin", "destination"];
const ITEM_KEYS = ["fuel", "property_type", "house_type", "bedrooms", "medicine", "product", "energy", "service", "land_type", "consumption_band", "item", "make", "model"];

function firstOf(q: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = q[k];
    if (v !== undefined && v !== null && String(v).trim() && String(v).trim().toLowerCase() !== "any") return String(v).trim().slice(0, 80);
  }
  return null;
}

/** The query in a fixed, compact form: keys sorted, empty values dropped, text trimmed, nothing longer than 120 characters. */
function compactQuery(q: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(q ?? {}).sort()) {
    const v = (q as Record<string, unknown>)[k];
    if (v === undefined || v === null || v === "") continue;
    out[k] = typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, 120) : typeof v === "number" || typeof v === "boolean" ? v : String(v).slice(0, 120);
  }
  return out;
}

const clip = (t: string, max: number) => (t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t);

/** The licence's name, not its full legal text, so a proof stays small (under 2 KB): the first sentence, at most 120 characters.
 *  The full licence wording is in the answer itself (and its hash is signed) and on /sources. */
export function shortLicence(text: string | undefined | null): string {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  const first = t.match(/^(.+?[.;])(\s|$)/)?.[1] ?? t;
  return clip(first.replace(/[.;]$/, ""), 120);
}

export interface ProofResult {
  category: string;
  country: string | null;
  area: string | null;
  item: string | null;
  currency: string;
  unit: string;
  value: number;
  measure: string;
  median: number | null;
  p10: number | null;
  p90: number | null;
  n: number | "no_count";
  period: { from: string | null; to: string | null };
  as_of: string;
  price_type: string;
  stale: boolean;
  verdict?: string;
  asked?: { price: number; currency: string | null; unit: string | null };
  vs_median_percent?: number | null;
}

export interface ProofClaims {
  iss: string;
  iat: number;
  exp: number;
  jti: string;
  kind: ProofKind;
  tool: string;
  query: Record<string, unknown>;
  result: ProofResult;
  sources: { id: string; name: string; licence: string }[];
  answer_sha256: string;
  statement: string;
}

/** The claims for one answer or check. `body` is exactly what the caller receives (the answer, or the whole check result): its
 *  canonical JSON hash is answer_sha256, so the full body can be matched with the proof later. */
export function buildClaims(kind: ProofKind, tool: string, category: string, body: PriceAnswer | CheckResult, nowSec = Math.floor(Date.now() / 1000)): ProofClaims {
  const answer: PriceAnswer = kind === "check" ? (body as CheckResult).answer : (body as PriceAnswer);
  const p = answer.price!;
  const q = answer.query ?? {};
  const country = typeof q.country === "string" ? q.country.toUpperCase() : null;
  const result: ProofResult = {
    category: kind === "check" ? String((body as CheckResult).input?.category ?? category) : category,
    country,
    area: firstOf(q, PLACE_KEYS),
    item: firstOf(q, ITEM_KEYS),
    currency: p.currency,
    unit: p.unit,
    value: p.value,
    measure: p.measure,
    median: p.median ?? null,
    p10: p.typical_low ?? null,
    p90: p.typical_high ?? null,
    n: typeof answer.sample_size === "number" && answer.sample_size > 0 ? answer.sample_size : "no_count",
    period: { from: answer.period?.from ?? null, to: answer.period?.to ?? null },
    as_of: answer.as_of,
    price_type: answer.price_type,
    stale: answer.extra?.stale === true,
  };
  if (kind === "check") {
    const c = body as CheckResult;
    result.verdict = c.verdict;
    result.asked = { price: c.input.price, currency: c.input.currency, unit: c.input.unit };
    result.vs_median_percent = c.position?.vs_median_percent ?? null;
  }
  return {
    iss: PROOF_ISSUER,
    iat: nowSec,
    exp: nowSec + PROOF_LIFETIME_SEC,
    jti: randomBytes(12).toString("base64url"),
    kind,
    tool,
    query: compactQuery(q),
    result,
    sources: [{ id: answer.source.id, name: clip(answer.source.name, 100), licence: shortLicence(answer.source.licence) }],
    answer_sha256: sha256Hex(canonicalJson(body)),
    statement: PROOF_STATEMENT,
  };
}

// ---------- plain English ----------

function countryLabel(cc: string | null): string {
  if (!cc) return "";
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(cc) ?? cc;
  } catch {
    return cc;
  }
}

const num = (v: number) => new Intl.NumberFormat("en-GB", { maximumFractionDigits: Math.abs(v) >= 100 ? 0 : 3 }).format(v);
const day = (sec: number) => new Date(sec * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const VERDICT_WORDS: Record<string, string> = {
  within_typical_range: "within the typical range",
  above_typical_range: "above the typical range",
  below_typical_range: "below the typical range",
  about_average: "about the official average",
  above_average: "above the official average",
  below_average: "below the official average",
};

/** One plain-English paragraph saying what a proof's claims state. Built only from the signed claims. */
export function humanSummary(c: Partial<ProofClaims> | null | undefined): string {
  if (!c || !c.result) return "";
  const r = c.result;
  const unit = r.unit ? ` ${r.unit}` : "";
  const what = [r.item, [r.area, countryLabel(r.country)].filter(Boolean).join(", ")].filter(Boolean);
  const subject = what.length === 2 ? `${what[0]} in ${what[1]}` : what[0] ?? r.category;
  const figures: string[] = [];
  if (typeof r.median === "number") figures.push(`Median ${num(r.median)} ${r.currency}${unit}`);
  else if (typeof r.value === "number") figures.push(`Official ${r.measure ?? "figure"} ${num(r.value)} ${r.currency}${unit}`);
  if (typeof r.p10 === "number" && typeof r.p90 === "number") figures.push(`typical ${num(r.p10)}–${num(r.p90)}`);
  figures.push(typeof r.n === "number" ? `${num(r.n)} records` : "record count not published");
  const ends = [...new Set([r.period?.from, r.period?.to].filter(Boolean))];
  const period = ends.length ? `period ${ends.join(" to ")}` : "";
  if (period) figures.push(period);
  const src = (c.sources ?? []).map((s) => `${s.name} (licence: ${s.licence})`).join("; ");
  const when = typeof c.iat === "number" ? `On ${day(c.iat)} ` : "";
  const lead =
    c.kind === "check" && r.asked
      ? `${when}ProofPrice checked ${num(r.asked.price)} ${r.asked.currency ?? r.currency}${r.asked.unit ? ` ${r.asked.unit}` : unit} for ${subject} against official records: ${VERDICT_WORDS[r.verdict ?? ""] ?? r.verdict}.`
      : `${when}ProofPrice reported official records for ${subject}.`;
  const stale = r.stale ? " This came from ProofPrice's own recent copy because the official source did not respond at the time." : "";
  return `${lead} ${figures.join(", ")}.${src ? ` Source: ${src}.` : ""}${stale}`.replace(/\s+/g, " ").trim();
}

// ---------- signing (time-boxed, never throws) ----------

export interface ProofEnvelope {
  jws: string;
  /** GET <verify_url>?proof=<jws> or POST it {"proof": "<jws>"} */
  verify_url: string;
  view_url: string;
}

let loggedSignFailure = false;

export function viewUrl(base: string, jws: string): string {
  return `${base.replace(/\/$/, "")}${VIEW_PREFIX}${jws}`;
}

/** Sign one answer or check, or null when it must not be signed, the feature is off or anything goes wrong. Never throws and never
 *  takes longer than deadlineMs. `getKey` is injectable for tests. */
export async function proofFor(
  kind: ProofKind,
  tool: string,
  category: string,
  body: unknown,
  base: string = PROOF_ISSUER,
  opts: { env?: Env; deadlineMs?: number; getKey?: () => Promise<SigningKey | null> } = {},
): Promise<ProofEnvelope | null> {
  try {
    if (kind === "check" ? !signableCheck(body) : !signableAnswer(body)) return null;
    const key = await withDeadline(
      (opts.getKey ?? (() => getSigningKey(opts.env ?? process.env)))(),
      opts.deadlineMs ?? PROOF_DEADLINE_MS,
      () => new Error("the signing key took too long to load"),
    );
    if (!key) return null;
    const jws = signJws(buildClaims(kind, tool, category, body as PriceAnswer | CheckResult) as unknown as Record<string, unknown>, key);
    const b = base.replace(/\/$/, "");
    return { jws, verify_url: `${b}${VERIFY_PATH}`, view_url: viewUrl(b, jws) };
  } catch (e) {
    if (!loggedSignFailure) {
      loggedSignFailure = true;
      console.warn(`[proofs] an answer went out without a proof: ${(e as Error)?.message ?? e}`);
    }
    return null;
  }
}

/** The REST headers that carry a proof (none when there is no proof). */
export function proofHeaders(p: ProofEnvelope | null): Record<string, string> {
  if (!p) return {};
  return { [PROOF_HEADER]: p.jws, link: `<${p.view_url}>; rel="proof"` };
}

// ---------- verifying ----------

export interface ProofVerification {
  valid: boolean;
  reason: JwsCheck["reason"];
  signature_valid: boolean;
  expired: boolean;
  kid: string | null;
  claims: Record<string, unknown> | null;
  human_summary: string | null;
  /** Only when a full answer was sent with the proof: true when its canonical hash equals the signed answer_sha256. */
  answer_matches?: boolean;
  keys_url: string;
  statement: string;
}

const REASON_WORDS: Record<JwsCheck["reason"], string> = {
  ok: "Valid: signed by ProofPrice and in date.",
  malformed: "Not a ProofPrice proof: it is not a well-formed compact JWS.",
  unsupported_alg: "Not a ProofPrice proof: ProofPrice signs with EdDSA (Ed25519) only.",
  wrong_type: "Not a ProofPrice proof: the header type is not proofprice-proof+jws.",
  unknown_key: "Not valid: it names a key ProofPrice does not publish.",
  bad_signature: "Not valid: the signature does not match. The proof was changed or forged.",
  wrong_issuer: "Not valid: the issuer is not ProofPrice.",
  expired: "Expired: the signature is genuine, but the proof is older than 90 days.",
  not_yet_valid: "Not valid: it is dated in the future.",
};

export function reasonText(r: JwsCheck["reason"]): string {
  return REASON_WORDS[r] ?? r;
}

/** Check a proof against our published keys. `answer`, when given, is compared with answer_sha256. Never throws. */
export async function verifyProof(
  jws: string,
  opts: { answer?: unknown; keys?: PublicJwk[]; env?: Env; nowSec?: number; base?: string; keyDeadlineMs?: number } = {},
): Promise<ProofVerification> {
  let keys = opts.keys;
  if (!keys) {
    try {
      keys = await withDeadline(publicKeys(opts.env ?? process.env), opts.keyDeadlineMs ?? 8000, () => new Error("keys took too long"));
    } catch {
      keys = [];
    }
  }
  const r = verifyJws(jws, keys, PROOF_ISSUER, opts.nowSec);
  const out: ProofVerification = {
    valid: r.valid,
    reason: r.reason,
    signature_valid: r.signature_valid,
    expired: r.expired,
    kid: r.kid,
    claims: r.signature_valid ? r.claims : null,
    human_summary: r.signature_valid ? humanSummary(r.claims as Partial<ProofClaims>) : null,
    keys_url: `${(opts.base ?? PROOF_ISSUER).replace(/\/$/, "")}${JWKS_PATH}`,
    statement: PROOF_STATEMENT,
  };
  if (opts.answer !== undefined && r.signature_valid) {
    out.answer_matches = sha256Hex(canonicalJson(opts.answer)) === (r.claims as any)?.answer_sha256;
  }
  return out;
}
