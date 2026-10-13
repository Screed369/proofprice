import { CATEGORIES, exampleUrls, sourcesFor } from "../lib/registry";

export default function Home() {
  const examples = exampleUrls();
  return (
    <main>
      <h1>ProofPrice</h1>
      <p>
        What did people actually pay for X, here, recently? Real prices from official records, as a range with sample size,
        period, confidence, source and licence. Built for AI agents.
      </p>
      <h2>For AI agents</h2>
      <p>
        MCP endpoint: <code>/api/mcp</code> · tools: {CATEGORIES.map((c) => c.tool).join(", ")}, pricepaid_coverage
      </p>
      <h2>Coverage</h2>
      <ul>
        {CATEGORIES.map((c) => (
          <li key={c.id}>
            <strong>{c.title}</strong>: {sourcesFor(c.id).map((s) => s.info.country).join(", ")}
          </li>
        ))}
      </ul>
      <h2>REST API</h2>
      <ul>
        {examples.map((e) => (
          <li key={e.path}>
            <code>{e.path}</code>
          </li>
        ))}
        {CATEGORIES.filter((c) => c.history).map((c) => (
          <li key={c.id + "-h"}>
            <code>{`/api/v1/${c.restPath}/history?${examples.find((e) => e.category === c.id)?.path.split("?")[1] ?? ""}&days=30`}</code> (daily history, building up)
          </li>
        ))}
        <li>
          <code>/api/v1/coverage</code>
        </li>
        <li>
          <code>POST /api/v1/receipts/verify</code>: send an order email (.eml) to check its seal
        </li>
      </ul>
      <p>
        <a href="/method">How the numbers are made</a> · <a href="/llms.txt">llms.txt (menu for AIs)</a> ·{" "}
        <a href="/openapi.json">openapi.json</a> · Contact: <a href="mailto:hello@proofprice.com">hello@proofprice.com</a>
      </p>
    </main>
  );
}
