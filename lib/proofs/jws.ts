// Signed Price Proofs, the cryptography (pure, Node crypto only, no dependencies).
// A proof is a compact JWS (RFC 7515) signed with Ed25519 (alg "EdDSA", RFC 8037). Anyone can check it with the public key
// published at /.well-known/proofprice-keys.json (a JWKS), with any JOSE library or with WebCrypto.

import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import type { KeyObject } from "node:crypto";

export const PROOF_TYP = "proofprice-proof+jws";
export const PROOF_ALG = "EdDSA";

export const b64u = (buf: Buffer | Uint8Array | string): string => Buffer.from(buf as any).toString("base64url");
export const fromB64u = (s: string): Buffer => Buffer.from(s, "base64url");

/** Canonical JSON (RFC 8785 style): object keys sorted, no whitespace, numbers and strings as JSON.stringify writes them.
 *  Used for answer_sha256, so a verifier can hash a stored answer the same way. undefined members are dropped (as JSON does). */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return "[" + v.map((x) => (x === undefined || typeof x === "function" ? "null" : canonicalJson(x))).join(",") + "]";
  const o = v as Record<string, unknown>;
  const parts: string[] = [];
  for (const k of Object.keys(o).sort()) {
    const x = o[k];
    if (x === undefined || typeof x === "function") continue;
    parts.push(JSON.stringify(k) + ":" + canonicalJson(x));
  }
  return "{" + parts.join(",") + "}";
}

export const sha256Hex = (s: string): string => createHash("sha256").update(s).digest("hex");

/** A signing key: the private key, its public half and the key id. */
export interface SigningKey {
  kid: string;
  privateKey: KeyObject;
  publicKey: KeyObject;
  /** The raw 32-byte public key, base64url (the JWK "x"). */
  x: string;
}

/** A public key as published in the JWKS. */
export interface PublicJwk {
  kty: "OKP";
  crv: "Ed25519";
  x: string;
  kid: string;
  use: "sig";
  alg: "EdDSA";
  /** Present on keys that no longer sign new proofs but still verify the ones they signed. */
  status?: "retired";
}

/** kid = first 16 characters of base64url(SHA-256(raw 32-byte public key)). */
export function kidFor(x: string): string {
  return b64u(createHash("sha256").update(fromB64u(x)).digest()).slice(0, 16);
}

export function publicXOf(publicKey: KeyObject): string {
  const jwk = publicKey.export({ format: "jwk" }) as { x?: string; crv?: string };
  if (jwk.crv !== "Ed25519" || !jwk.x) throw new Error("not an Ed25519 key");
  return jwk.x;
}

/** A signing key from a base64 PKCS8 DER Ed25519 private key (the PROOFPRICE_PROOF_SIGNING_KEY format). */
export function signingKeyFromPkcs8(b64: string): SigningKey {
  const privateKey = createPrivateKey({ key: Buffer.from(b64.trim(), "base64"), format: "der", type: "pkcs8" });
  if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("PROOFPRICE_PROOF_SIGNING_KEY is not an Ed25519 key");
  const publicKey = createPublicKey(privateKey);
  const x = publicXOf(publicKey);
  return { kid: kidFor(x), privateKey, publicKey, x };
}

/** A fresh Ed25519 key, and its private half as base64 PKCS8 DER (to store). */
export function generateSigningKey(): { key: SigningKey; pkcs8: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const x = publicXOf(publicKey);
  const pkcs8 = (privateKey.export({ format: "der", type: "pkcs8" }) as Buffer).toString("base64");
  return { key: { kid: kidFor(x), privateKey, publicKey, x }, pkcs8 };
}

export function publicJwk(x: string, status?: "retired"): PublicJwk {
  return { kty: "OKP", crv: "Ed25519", x, kid: kidFor(x), use: "sig", alg: "EdDSA", ...(status ? { status } : {}) };
}

export function publicKeyFromX(x: string): KeyObject {
  return createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x }, format: "jwk" });
}

/** Sign claims as a compact JWS. */
export function signJws(claims: Record<string, unknown>, key: SigningKey): string {
  const header = { alg: PROOF_ALG, kid: key.kid, typ: PROOF_TYP };
  const input = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(claims))}`;
  const sig = sign(null, Buffer.from(input), key.privateKey);
  return `${input}.${b64u(sig)}`;
}

export type VerifyReason =
  | "ok"
  | "malformed"
  | "unsupported_alg"
  | "wrong_type"
  | "unknown_key"
  | "bad_signature"
  | "wrong_issuer"
  | "expired"
  | "not_yet_valid";

export interface JwsCheck {
  /** True only when the signature is good, the key is ours, the issuer is ours and the proof is in date. */
  valid: boolean;
  reason: VerifyReason;
  /** The signature itself checked out with a ProofPrice key (even if the proof has since expired). */
  signature_valid: boolean;
  kid: string | null;
  header: Record<string, unknown> | null;
  claims: Record<string, unknown> | null;
  expired: boolean;
}

/** The longest proof we accept for checking (a real one is about 1.5 KB). */
export const MAX_PROOF_CHARS = 8192;

const B64U = /^[A-Za-z0-9_-]+$/;

/** Check a compact JWS against the keys we know (current and retired). `nowSec` lets tests move the clock. */
export function verifyJws(jws: string, keys: PublicJwk[], issuer: string, nowSec = Math.floor(Date.now() / 1000)): JwsCheck {
  const fail = (reason: VerifyReason, extra: Partial<JwsCheck> = {}): JwsCheck => ({
    valid: false, reason, signature_valid: false, kid: null, header: null, claims: null, expired: false, ...extra,
  });
  const s = String(jws ?? "").trim();
  if (!s || s.length > MAX_PROOF_CHARS) return fail("malformed");
  const parts = s.split(".");
  if (parts.length !== 3 || !parts.every((p) => B64U.test(p))) return fail("malformed");
  let header: Record<string, unknown>;
  let claims: Record<string, unknown>;
  try {
    header = JSON.parse(fromB64u(parts[0]).toString("utf8"));
    claims = JSON.parse(fromB64u(parts[1]).toString("utf8"));
    if (!header || typeof header !== "object" || !claims || typeof claims !== "object") return fail("malformed");
  } catch {
    return fail("malformed");
  }
  const kid = typeof header.kid === "string" ? header.kid : null;
  if (header.alg !== PROOF_ALG) return fail("unsupported_alg", { kid, header });
  if (header.typ !== PROOF_TYP) return fail("wrong_type", { kid, header });
  const jwk = keys.find((k) => k.kid === kid);
  if (!jwk) return fail("unknown_key", { kid, header });
  let ok = false;
  try {
    ok = verify(null, Buffer.from(`${parts[0]}.${parts[1]}`), publicKeyFromX(jwk.x), fromB64u(parts[2]));
  } catch {
    ok = false;
  }
  if (!ok) return fail("bad_signature", { kid, header });
  const base = { signature_valid: true, kid, header, claims };
  if (claims.iss !== issuer) return { ...base, valid: false, reason: "wrong_issuer", expired: false };
  const exp = Number(claims.exp);
  const iat = Number(claims.iat);
  if (!Number.isFinite(exp) || exp <= nowSec) return { ...base, valid: false, reason: "expired", expired: true };
  if (Number.isFinite(iat) && iat > nowSec + 300) return { ...base, valid: false, reason: "not_yet_valid", expired: false };
  return { ...base, valid: true, reason: "ok", expired: false };
}
