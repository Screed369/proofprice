// Coinbase CDP facilitator sign-in: a short-lived JWT (Bearer) signed with the CDP API key, made with Node's crypto only.
// The key comes from the environment (CDP_API_KEY_ID / CDP_API_KEY_SECRET) and is used here and nowhere else. Never logged.
// Supports both key kinds CDP issues: an EC (ES256) PEM key, or an Ed25519 key (base64, 64 bytes: seed + public).
import { createPrivateKey, randomBytes, sign } from "node:crypto";

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export function cdpJwt(keyId: string, secret: string, method: string, host: string, path: string, now = Date.now()): string {
  const t = Math.floor(now / 1000);
  const pem = secret.includes("BEGIN") ? secret.replace(/\\n/g, "\n") : null;
  const alg = pem ? "ES256" : "EdDSA";
  const header = { alg, typ: "JWT", kid: keyId, nonce: randomBytes(16).toString("hex") };
  const payload = { sub: keyId, iss: "cdp", aud: ["cdp_service"], nbf: t, exp: t + 120, uris: [`${method.toUpperCase()} ${host}${path}`] };
  const data = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  let sig: Buffer;
  if (pem) {
    sig = sign("sha256", Buffer.from(data), { key: createPrivateKey(pem), dsaEncoding: "ieee-p1363" });
  } else {
    const raw = Buffer.from(secret, "base64");
    if (raw.length < 32) throw new Error("CDP key has an unexpected format");
    const der = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), raw.subarray(0, 32)]);
    sig = sign(null, Buffer.from(data), createPrivateKey({ key: der, format: "der", type: "pkcs8" }));
  }
  return `${data}.${b64url(sig)}`;
}
