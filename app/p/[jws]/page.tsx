// /p/<proof>: the human page for one Signed Price Proof (lib/proofs). Checked on the server, every time, against ProofPrice's
// published keys: shows valid / not valid / expired, the plain-English statement, the signed figures and the disclaimer.
// Kept out of search indexes (each URL is one person's proof, not a page for everyone).
import type { Metadata } from "next";
import { Breadcrumbs } from "../../_components/Breadcrumbs";
import { JWKS_PATH, PROOF_STATEMENT, VERIFY_PATH, reasonText, verifyProof } from "../../../lib/proofs";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Price proof",
  description: "Check a ProofPrice signed price statement: who signed it, when, and what the official records showed.",
  robots: { index: false, follow: false },
};

const when = (sec: unknown) =>
  typeof sec === "number" ? new Date(sec * 1000).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC" : "";

export default async function ProofPage({ params }: { params: Promise<{ jws: string }> }) {
  const { jws: raw } = await params;
  const jws = decodeURIComponent(raw ?? "");
  const v = await verifyProof(jws);
  const c: any = v.claims ?? {};
  const r: any = c.result ?? {};
  const tone = v.valid ? "var(--ok-bg)" : v.signature_valid ? "var(--warn-bg)" : "var(--bad-bg)";
  const ink = v.valid ? "var(--ok-ink)" : v.signature_valid ? "var(--warn-ink)" : "var(--bad-ink)";
  const headline = v.valid ? "Verified by ProofPrice" : v.expired ? "Genuine, but expired" : "Not a valid ProofPrice proof";
  const rows: [string, string][] = v.signature_valid
    ? [
        ["Kind", c.kind === "check" ? "Price check" : "Price answer"],
        ...(r.verdict ? ([["Verdict", String(r.verdict).replace(/_/g, " ")]] as [string, string][]) : []),
        ...(r.asked ? ([["Price checked", `${r.asked.price} ${r.asked.currency ?? r.currency ?? ""} ${r.asked.unit ?? r.unit ?? ""}`.trim()]] as [string, string][]) : []),
        ["Category", String(r.category ?? "")],
        ["Country", String(r.country ?? "")],
        ...(r.area ? ([["Area", String(r.area)]] as [string, string][]) : []),
        ...(r.item ? ([["Item", String(r.item)]] as [string, string][]) : []),
        [r.median !== null && r.median !== undefined ? "Median" : `Official ${r.measure ?? "figure"}`, `${r.median ?? r.value} ${r.currency} ${r.unit}`],
        ...(r.p10 !== null && r.p90 !== null && r.p10 !== undefined ? ([["Typical range (10th–90th percentile)", `${r.p10} – ${r.p90}`]] as [string, string][]) : []),
        ["Records", r.n === "no_count" ? "not published by the source" : String(r.n)],
        ["Period", [r.period?.from, r.period?.to].filter(Boolean).join(" to ")],
        ["Price type", String(r.price_type ?? "")],
        ["Our own copy (official source did not respond)", r.stale ? "yes" : "no"],
        ["Source", (c.sources ?? []).map((s: any) => `${s.name} (${s.id}), licence: ${s.licence}`).join("; ")],
        ["Signed", when(c.iat)],
        ["Expires", when(c.exp)],
        ["Answer hash (SHA-256 of canonical JSON)", String(c.answer_sha256 ?? "")],
        ["Key id", String(v.kid ?? "")],
        ["Proof id", String(c.jti ?? "")],
      ]
    : [];
  return (
    <main>
      <Breadcrumbs items={[{ name: "Home", path: "/" }, { name: "Price proofs", path: "/proofs" }, { name: "This proof" }]} />
      <div className="card" style={{ background: tone, color: ink, borderColor: "transparent" }}>
        <h1 style={{ marginTop: 0 }}>{headline}</h1>
        <p style={{ marginBottom: 0 }}>{reasonText(v.reason)}</p>
      </div>
      {v.human_summary && <p className="lede">{v.human_summary}</p>}
      {rows.length > 0 && (
        <div className="table-wrap">
          <table>
            <tbody>
              {rows.map(([k, val]) => (
                <tr key={k}>
                  <th scope="row">{k}</th>
                  <td style={{ overflowWrap: "anywhere" }}>{val}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="notice">{PROOF_STATEMENT}</p>
      <h2>Check it yourself</h2>
      <p>
        This page checked the signature on our server just now. You do not have to trust this page either: check the proof with the API, or
        offline with our public keys at <a href={JWKS_PATH}>{JWKS_PATH}</a> (Ed25519, EdDSA). How it works: <a href="/proofs">/proofs</a>.
      </p>
      <pre style={{ overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>
        <code>{`curl -s -X POST https://proofprice.com${VERIFY_PATH} -H 'content-type: application/json' -d '{"proof":"${jws.slice(0, 24)}…"}'`}</code>
      </pre>
      <details>
        <summary>The proof (compact JWS)</summary>
        <pre style={{ overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>
          <code>{jws}</code>
        </pre>
      </details>
    </main>
  );
}
