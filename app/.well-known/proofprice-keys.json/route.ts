// The public keys that check Signed Price Proofs (lib/proofs), as a JWKS (RFC 7517): Ed25519 (kty OKP, crv Ed25519, alg EdDSA).
// The current signing key first, then retired keys (status "retired") so older proofs keep verifying. Public keys only: never a
// secret. Empty "keys" means proofs are switched off on this deployment. CORS open.
import { publicKeys } from "../../../lib/proofs/keys";
import { PROOF_ISSUER, PROOF_LIFETIME_SEC } from "../../../lib/proofs";

export const dynamic = "force-dynamic";

const HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "public, max-age=300, s-maxage=300",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
};

export async function GET() {
  let keys: Awaited<ReturnType<typeof publicKeys>> = [];
  try {
    keys = await publicKeys();
  } catch {
    keys = [];
  }
  const body = {
    issuer: PROOF_ISSUER,
    typ: "proofprice-proof+jws",
    proof_lifetime_days: PROOF_LIFETIME_SEC / 86400,
    docs: `${PROOF_ISSUER}/proofs`,
    keys,
  };
  return new Response(JSON.stringify(body, null, 2), { headers: { ...HEADERS, ...(keys.length ? {} : { "cache-control": "no-store" }) } });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: HEADERS });
}
