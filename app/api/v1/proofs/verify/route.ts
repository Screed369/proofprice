// GET /api/v1/proofs/verify?proof=<jws>   or   POST {"proof": "<jws>", "answer": <optional full answer>}
// Free proof checking for anyone (another agent, a seller, a person): never behind the payment gate, CORS open, nothing stored.
// Returns {valid, reason, signature_valid, expired, kid, claims, human_summary, answer_matches?, keys_url, statement}.
import { MAX_PROOF_CHARS } from "../../../../../lib/proofs/jws";
import { verifyProof } from "../../../../../lib/proofs";
import { json, errorResponse, corsPreflight, baseUrl } from "../../../../../lib/route-helpers";

export const dynamic = "force-dynamic";
export const maxDuration = 15;
/** A proof plus a full answer is a few tens of KB; anything far bigger is not ours. */
const MAX_BODY = 512 * 1024;

const missing = () =>
  json({ error: "Give the proof: GET ?proof=<jws> or POST {\"proof\": \"<jws>\"} (optionally with \"answer\": the full answer, to check it matches)." }, 400);

export async function GET(req: Request) {
  try {
    const proof = new URL(req.url).searchParams.get("proof") ?? new URL(req.url).searchParams.get("p");
    if (!proof) return missing();
    if (proof.length > MAX_PROOF_CHARS) return json({ error: "That proof is too long to be a ProofPrice proof." }, 400);
    return json(await verifyProof(proof, { base: baseUrl(req) }));
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request) {
  try {
    const text = await req.text();
    if (text.length > MAX_BODY) return json({ error: "Body too large (max 512 KB)." }, 413);
    let proof: unknown;
    let answer: unknown;
    const t = text.trim();
    if (t.startsWith("{")) {
      let body: any;
      try {
        body = JSON.parse(t);
      } catch {
        return json({ error: "The body is not valid JSON." }, 400);
      }
      proof = body?.proof ?? body?.jws;
      answer = body?.answer;
    } else {
      proof = t; // a bare proof as text/plain also works
    }
    if (typeof proof !== "string" || !proof.trim()) return missing();
    if (proof.length > MAX_PROOF_CHARS) return json({ error: "That proof is too long to be a ProofPrice proof." }, 400);
    return json(await verifyProof(proof.trim(), { base: baseUrl(req), answer }));
  } catch (e) {
    return errorResponse(e);
  }
}

export function OPTIONS() {
  return corsPreflight();
}
