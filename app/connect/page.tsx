import { CHECK_REST, CHECK_TOOL } from "../../lib/check";
import { CONTACT, MCP_URL, SITE_URL, connectGuides } from "../../lib/open-book";
import { CATEGORIES } from "../../lib/registry";
import { pageMetadata } from "../../lib/site/meta";
import { joinAnd } from "../../lib/text";

export const metadata = pageMetadata({
  title: "Connect ProofPrice to your AI",
  description: "Copy-paste setup for Claude, ChatGPT, Cursor, VS Code, Windsurf, Claude Code and agent frameworks. No key needed.",
  path: "/connect",
});

export default function Connect() {
  const guides = connectGuides();
  return (
    <main>
      <h1>Connect ProofPrice to your AI</h1>
      <p>
        ProofPrice is a free, read-only MCP server. No API key, no sign-in. Add this address to any MCP-capable AI app:
      </p>
      <pre className="selectall">
        <code>{MCP_URL}</code>
      </pre>
      <p>
        Transport: Streamable HTTP. Tools: {joinAnd([...CATEGORIES.map((c) => c.title.toLowerCase()), "check a price before you pay", "a coverage check"])}.
      </p>
      <section id="check-a-price">
        <h2>Check a price before you pay</h2>
        <p>
          The tool <code>{CHECK_TOOL}</code> (REST: <code>GET {CHECK_REST}</code>) takes a proposed price and compares it with the recorded evidence. Give the
          category, the country, that category&apos;s own parameters and the <code>price</code>; currency, unit and includes are optional. It answers
          with a verdict (within, above or below the typical range, or about, above or below the official average, or cannot_judge), where the price
          sits, the reasons, what is missing, and the full evidence answer to keep with your reasoning. Currencies and units are never converted.
        </p>
        <pre>
          <code>{`${SITE_URL}${CHECK_REST}?category=rent&country=IE&town=Dublin&price=2400&unit=per%20month`}</code>
        </pre>
      </section>
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
              {g.codeLabel && <p className="muted small">{g.codeLabel}</p>}
              <pre>
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
      <p className="muted small">
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
