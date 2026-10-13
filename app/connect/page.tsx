import { CONTACT, MCP_URL, SITE_URL, connectGuides } from "../../lib/open-book";

export const metadata = {
  title: "Connect ProofPrice to your AI",
  description: "Copy-paste setup for Claude, ChatGPT, Cursor, VS Code, Windsurf, Claude Code and agent frameworks. No key needed.",
  alternates: { canonical: `${SITE_URL}/connect` },
};

const pre = { background: "#f4f4f5", padding: 12, borderRadius: 6, overflowX: "auto" as const, fontSize: 13 };

export default function Connect() {
  const guides = connectGuides();
  return (
    <main>
      <h1>Connect ProofPrice to your AI</h1>
      <p>
        ProofPrice is a free, read-only MCP server. No API key, no sign-in. Add this address to any MCP-capable AI app:
      </p>
      <pre style={pre}>
        <code>{MCP_URL}</code>
      </pre>
      <p>Transport: Streamable HTTP. Tools: price paid for home sales, live fuel prices, and a coverage check.</p>
      <ul>
        {guides.map((g) => (
          <li key={g.id}>
            <a href={`#${g.id}`}>{g.title}</a>
          </li>
        ))}
      </ul>
      {guides.map((g) => (
        <section key={g.id} id={g.id}>
          <h2>{g.title}</h2>
          {g.steps && (
            <ol>
              {g.steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          )}
          {g.code && (
            <>
              {g.codeLabel && <p style={{ margin: "8px 0 2px", fontSize: 13, color: "#555" }}>{g.codeLabel}</p>}
              <pre style={pre}>
                <code>{g.code}</code>
              </pre>
            </>
          )}
          {g.note && <p>{g.note}</p>}
          <p>
            Official guide: <a href={g.docUrl}>{g.docUrl}</a>
          </p>
        </section>
      ))}
      <p style={{ fontSize: 13, color: "#555" }}>
        Setup formats were checked against each vendor's documentation on 13 October 2026. Vendors change menus and file formats, so if a step
        differs, follow the official guide linked in each section.
      </p>
      <p>
        <a href="/">Home</a> · <a href="/llms.txt">llms.txt</a> · <a href="/llms-full.txt">llms-full.txt</a> ·{" "}
        <a href="/openapi.json">openapi.json</a> · <a href="/method">Method</a> · Contact: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>
      </p>
    </main>
  );
}
