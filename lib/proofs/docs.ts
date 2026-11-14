// Words and code samples about Signed Price Proofs, shared by the /proofs page, llms.txt, llms-full.txt and openapi.json.
import { JWKS_PATH, PROOF_META_KEY, PROOF_STATEMENT, VERIFY_PATH, VIEW_PREFIX } from "./index";

export const PROOFS_PAGE = "/proofs";

export const PROOFS_SHORT =
  "Every ok price answer and every price-check verdict can come with a signed price statement: a small Ed25519-signed note (compact JWS) of what the official records showed, which any other agent, seller or person can check for free without trusting the agent that shows it.";

export function proofsLlmsLines(base: string): string[] {
  return [
    PROOFS_SHORT,
    `- REST: response header X-ProofPrice-Proof: <jws>, plus Link: <${base}${VIEW_PREFIX}<jws>>; rel="proof" (a page a person can open).`,
    `- MCP: the tool result's _meta["${PROOF_META_KEY}"] = {jws, verify_url, view_url}. The answer itself is unchanged.`,
    `- Verify free (no key, never charged, CORS open): GET ${base}${VERIFY_PATH}?proof=<jws> or POST ${base}${VERIFY_PATH} {"proof": "<jws>", "answer": <optional full answer, to confirm it matches answer_sha256>} → {valid, reason, expired, kid, claims, human_summary}.`,
    `- Verify offline: public keys (JWKS, Ed25519 / EdDSA) at ${base}${JWKS_PATH}. Header typ "proofprice-proof+jws". Proofs expire 90 days after signing.`,
    `- Claims: iss, iat, exp, jti, kind (answer | check), tool, query, result {category, country, area, item, currency, unit, value, measure, median, p10, p90, n (or "no_count"), period, as_of, price_type, stale, verdict and asked price for checks}, sources [{id, name, licence}], answer_sha256 (SHA-256 of the answer as canonical JSON: keys sorted, no whitespace) and the statement "${PROOF_STATEMENT}"`,
    "- Only ok answers and real verdicts are signed: never errors, no_matches, insufficient_data or cannot_judge. An answer from ProofPrice's own copy (the official source did not respond) is signed with stale: true.",
    `- How it works, with code: ${base}${PROOFS_PAGE}`,
  ];
}

export const CURL_EXAMPLE = `# 1. Ask, and keep the proof from the response header
curl -sD headers.txt -o answer.json \\
  'https://proofprice.com/api/v1/check?category=fuel&country=IE&fuel=diesel&price=1.89'
PROOF=$(grep -i '^x-proofprice-proof:' headers.txt | cut -d' ' -f2 | tr -d '\\r')

# 2. Anyone can check it, free
curl -s "https://proofprice.com${VERIFY_PATH}?proof=$PROOF"

# 3. ...and confirm the full answer they were shown is the one that was signed
curl -s -X POST https://proofprice.com${VERIFY_PATH} -H 'content-type: application/json' \\
  -d "{\\"proof\\":\\"$PROOF\\",\\"answer\\":$(cat answer.json)}"`;

export const WEBCRYPTO_EXAMPLE = `// Check a ProofPrice proof offline with WebCrypto (browsers, Node 20+, Deno, Bun). No library needed.
async function verifyProofPrice(jws) {
  const [h, p, s] = jws.split(".");
  const dec = (x) => Uint8Array.from(atob(x.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  const header = JSON.parse(new TextDecoder().decode(dec(h)));
  const claims = JSON.parse(new TextDecoder().decode(dec(p)));
  const { keys } = await (await fetch("https://proofprice.com${JWKS_PATH}")).json();
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk || header.alg !== "EdDSA" || header.typ !== "proofprice-proof+jws") return { valid: false };
  const key = await crypto.subtle.importKey("jwk", { kty: "OKP", crv: "Ed25519", x: jwk.x }, { name: "Ed25519" }, false, ["verify"]);
  const ok = await crypto.subtle.verify({ name: "Ed25519" }, key, dec(s), new TextEncoder().encode(h + "." + p));
  const inDate = claims.exp > Date.now() / 1000;
  return { valid: ok && inDate && claims.iss === "https://proofprice.com", claims };
}`;

export const JOSE_EXAMPLE = `// Or with the jose library (npm i jose)
import { createRemoteJWKSet, compactVerify } from "jose";
const keys = createRemoteJWKSet(new URL("https://proofprice.com${JWKS_PATH}"));
const { payload, protectedHeader } = await compactVerify(jws, keys);
const claims = JSON.parse(new TextDecoder().decode(payload));
// then check protectedHeader.typ === "proofprice-proof+jws", claims.iss === "https://proofprice.com" and claims.exp > now`;
