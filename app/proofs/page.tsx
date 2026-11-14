import { Breadcrumbs } from "../_components/Breadcrumbs";
import { CHECK_REST, CHECK_TOOL } from "../../lib/check";
import { JWKS_PATH, PROOF_META_KEY, PROOF_STATEMENT, VERIFY_PATH } from "../../lib/proofs";
import { CURL_EXAMPLE, JOSE_EXAMPLE, PROOFS_PAGE, WEBCRYPTO_EXAMPLE } from "../../lib/proofs/docs";
import { pageMetadata } from "../../lib/site/meta";

export const dynamic = "force-static";

export const metadata = pageMetadata({
  title: "Signed price statements",
  description:
    "Every ProofPrice price answer and price check can carry a small signed proof that another agent, a seller or a person can check for free, without trusting the agent that shows it.",
  path: PROOFS_PAGE,
});

export default function Proofs() {
  return (
    <main>
      <Breadcrumbs items={[{ name: "Home", path: "/" }, { name: "Price proofs" }]} />
      <h1>Signed price statements</h1>
      <p className="lede">
        Think of a notary&apos;s stamp. Before two agents agree a price, one can show the other what the official records said, with
        ProofPrice&apos;s stamp on it. The other agent does not need to trust the first one: it checks the stamp, for free, in a second.
      </p>

      <h2>What you get</h2>
      <p>
        Every price answer with status <code>ok</code> and every price check with a real verdict (from <code>{CHECK_TOOL}</code> or{" "}
        <code>GET {CHECK_REST}</code>) comes with a proof: a compact JWS signed with Ed25519. The answer itself does not change; the proof travels
        beside it.
      </p>
      <ul>
        <li>
          <strong>REST:</strong> the header <code>X-ProofPrice-Proof: &lt;proof&gt;</code>, and <code>Link: &lt;https://proofprice.com/p/&lt;proof&gt;&gt;; rel=&quot;proof&quot;</code>,
          a page a person can open.
        </li>
        <li>
          <strong>MCP:</strong> the tool result&apos;s <code>_meta[&quot;{PROOF_META_KEY}&quot;]</code> holds <code>{"{ jws, verify_url, view_url }"}</code>.
        </li>
      </ul>
      <p>
        A proof says: which question was asked, the figures (median, typical range, number of records, period, price type), the verdict and
        price for a check, the source and its licence, whether it came from our own copy because the official source did not respond, a SHA-256
        hash of the full answer, when it was signed and when it expires (90 days later). And always this sentence:
      </p>
      <p className="notice">{PROOF_STATEMENT}</p>
      <p>
        Errors, &ldquo;no matches&rdquo;, &ldquo;not enough data&rdquo; and &ldquo;cannot judge&rdquo; are never signed. We sign only what the records showed.
      </p>

      <h2>Check a proof (free, no key)</h2>
      <ul>
        <li>
          API: <code>GET {VERIFY_PATH}?proof=&lt;proof&gt;</code> or <code>POST {VERIFY_PATH}</code> with{" "}
          <code>{'{"proof": "<proof>", "answer": <optional full answer>}'}</code>. It answers <code>valid</code>, <code>reason</code>,{" "}
          <code>expired</code>, <code>kid</code>, the signed <code>claims</code> and a plain-English <code>human_summary</code>. Send the answer too
          and <code>answer_matches</code> says whether it is exactly the one that was signed. Never charged, CORS open, nothing stored.
        </li>
        <li>
          People: open <code>https://proofprice.com/p/&lt;proof&gt;</code>.
        </li>
        <li>
          Offline: our public keys are at <a href={JWKS_PATH}>{JWKS_PATH}</a> (JWKS, <code>kty OKP</code>, <code>crv Ed25519</code>,{" "}
          <code>alg EdDSA</code>). Keys that no longer sign stay listed so older proofs keep checking.
        </li>
      </ul>

      <h2>curl</h2>
      <pre>
        <code>{CURL_EXAMPLE}</code>
      </pre>

      <h2>JavaScript (WebCrypto, no library)</h2>
      <pre>
        <code>{WEBCRYPTO_EXAMPLE}</code>
      </pre>
      <pre>
        <code>{JOSE_EXAMPLE}</code>
      </pre>

      <h2>Matching the full answer</h2>
      <p>
        <code>answer_sha256</code> is the SHA-256 (hex) of the answer you received (for a check, the whole check result) written as canonical JSON:
        object keys sorted, no spaces, as in RFC 8785. Keep the answer with the proof and anyone can confirm the two belong together.
      </p>

      <h2>What a proof is not</h2>
      <p>
        It is evidence of what official records showed when ProofPrice signed it. It is not a valuation, a guarantee or an offer, and it does not
        say whether a price is typical for one particular item.
      </p>
    </main>
  );
}
