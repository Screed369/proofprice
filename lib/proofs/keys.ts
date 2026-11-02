// Signed Price Proofs, the keys. No secret ever passes through a chat, a log or the repo.
//
// Where the signing key comes from, in order:
//  1. PROOFPRICE_PROOF_SIGNING_KEY (base64 PKCS8 DER Ed25519), when set in the Vercel project. The strongest option.
//  2. Otherwise SELF-PROVISIONED: when a Blob store is connected (the same private store and the same signal as lib/usage.ts),
//     the first instance that needs a key generates an Ed25519 key pair on the server and stores the private half in the PRIVATE
//     Blob store at KEY_PATH (one key per Vercel environment, so a preview key never verifies as a production key). Written
//     with allowOverwrite false: if two instances race, the loser's write fails and it reads back and uses the winner's key.
//  3. Neither: the feature is off. Answers carry no proof and everything works as before.
// PROOFPRICE_PROOFS=off switches the feature off whatever the key.
//
// Public keys are not secrets: the current one is derived from the private key, and keys that no longer sign are listed in
// lib/proofs/retired-keys.json so the proofs they signed keep verifying. Both are published at /.well-known/proofprice-keys.json.

import { generateSigningKey, publicJwk, signingKeyFromPkcs8 } from "./jws";
import type { PublicJwk, SigningKey } from "./jws";
import RETIRED from "./retired-keys.json";

type Env = Record<string, string | undefined>;

export const KEY_PREFIX = "proofprice-proof-keys/";
/** One self-provisioned key per Vercel environment (production, preview, development). */
export function keyPath(env: Env = process.env): string {
  const e = (env.VERCEL_ENV || "development").toLowerCase().replace(/[^a-z0-9-]/g, "") || "development";
  return `${KEY_PREFIX}${e}/ed25519-signing-key.json`;
}

/** What is stored at keyPath: the private key (private Blob store only), its kid and public x, and when it was made. */
export interface StoredKey {
  v: 1;
  kid: string;
  x: string;
  pkcs8: string;
  created_at: string;
}

/** The private store for the self-provisioned key (tests use memoryKeyStore). */
export interface KeyStore {
  read(pathname: string): Promise<string | null>;
  /** Must fail when the pathname already exists. */
  create(pathname: string, body: string): Promise<void>;
}

export const blobKeyStore: KeyStore = {
  async read(pathname) {
    const { get } = await import("@vercel/blob");
    const res = await get(pathname, { access: "private", useCache: false });
    if (!res || res.statusCode !== 200 || !res.stream) return null;
    return await new Response(res.stream).text();
  },
  async create(pathname, body) {
    const { put } = await import("@vercel/blob");
    await put(pathname, body, { access: "private", contentType: "application/json", addRandomSuffix: false, allowOverwrite: false });
  },
};

export function memoryKeyStore(): KeyStore & { files: Map<string, string>; reads: number; creates: number } {
  const files = new Map<string, string>();
  const s = {
    files,
    reads: 0,
    creates: 0,
    async read(p: string) {
      s.reads++;
      return files.get(p) ?? null;
    },
    async create(p: string, body: string) {
      s.creates++;
      if (files.has(p)) throw new Error("This blob already exists");
      files.set(p, body);
    },
  };
  return s;
}

const has = (v: string | undefined) => Boolean(v && v.trim());

export function proofsSwitchedOff(env: Env = process.env): boolean {
  return /^(0|off|false|no|disabled?)$/i.test(String(env.PROOFPRICE_PROOFS ?? "").trim());
}

/** Where the key would come from right now: "env", "blob" (self-provisioned) or null (feature off). */
export function keyMode(env: Env = process.env): "env" | "blob" | null {
  if (proofsSwitchedOff(env)) return null;
  if (has(env.PROOFPRICE_PROOF_SIGNING_KEY)) return "env";
  if (has(env.BLOB_STORE_ID) || has(env.BLOB_READ_WRITE_TOKEN)) return "blob";
  return null;
}

let store: KeyStore = blobKeyStore;
let cached: SigningKey | null = null;
let loading: Promise<SigningKey | null> | null = null;
let failedAt = 0;
let loggedFailure = false;
/** After a failed load, wait this long before trying the store again (a down store must not slow every answer). */
export const RETRY_AFTER_MS = 60_000;

/** Tests: replace the store and forget any cached key. null puts the Blob store back. */
export function setKeyStore(s: KeyStore | null): void {
  store = s ?? blobKeyStore;
  resetKeyCache();
}

export function resetKeyCache(): void {
  cached = null;
  loading = null;
  failedAt = 0;
  loggedFailure = false;
}

function logOnce(msg: string): void {
  if (loggedFailure) return;
  loggedFailure = true;
  console.warn(`[proofs] ${msg}`); // never the key, never a request
}

function parseStored(text: string): SigningKey {
  const o = JSON.parse(text) as StoredKey;
  const key = signingKeyFromPkcs8(o.pkcs8);
  if (o.kid && o.kid !== key.kid) throw new Error("stored key id does not match its key");
  return key;
}

async function loadFromStore(env: Env): Promise<SigningKey> {
  const path = keyPath(env);
  const existing = await store.read(path);
  if (existing) return parseStored(existing);
  const { key, pkcs8 } = generateSigningKey();
  const body: StoredKey = { v: 1, kid: key.kid, x: key.x, pkcs8, created_at: new Date().toISOString() };
  try {
    await store.create(path, JSON.stringify(body));
    return key;
  } catch (e) {
    // another instance won the race (or the read missed a fresh write): use the key that is there, never ours
    const now = await store.read(path);
    if (now) return parseStored(now);
    throw e;
  }
}

/** The signing key, or null when the feature is off or the key cannot be had right now. Never throws. Cached in memory. */
export async function getSigningKey(env: Env = process.env): Promise<SigningKey | null> {
  const mode = keyMode(env);
  if (!mode) return null;
  if (cached) return cached;
  if (mode === "env") {
    try {
      cached = signingKeyFromPkcs8(String(env.PROOFPRICE_PROOF_SIGNING_KEY));
      return cached;
    } catch (e) {
      logOnce(`PROOFPRICE_PROOF_SIGNING_KEY could not be read as a base64 PKCS8 Ed25519 key, so answers carry no proof: ${(e as Error)?.message}`);
      return null;
    }
  }
  if (failedAt && Date.now() - failedAt < RETRY_AFTER_MS) return null;
  if (!loading) {
    loading = loadFromStore(env)
      .then((k) => {
        cached = k;
        failedAt = 0;
        return k;
      })
      .catch((e) => {
        failedAt = Date.now();
        logOnce(`the self-provisioned signing key could not be loaded or created, so answers carry no proof for now: ${(e as Error)?.message ?? e}`);
        return null;
      })
      .finally(() => {
        loading = null;
      });
  }
  return loading;
}

/** Keys that no longer sign but still verify (public keys only; edit lib/proofs/retired-keys.json when a key is rotated). */
export function retiredKeys(): PublicJwk[] {
  return (RETIRED as { x: string }[]).filter((k) => k && typeof k.x === "string").map((k) => publicJwk(k.x, "retired"));
}

/** Every public key a proof may be checked with: the current key (if any) first, then the retired ones. */
export async function publicKeys(env: Env = process.env): Promise<PublicJwk[]> {
  const out: PublicJwk[] = [];
  const key = await getSigningKey(env);
  if (key) out.push(publicJwk(key.x));
  for (const k of retiredKeys()) if (!out.some((o) => o.kid === k.kid)) out.push(k);
  return out;
}
