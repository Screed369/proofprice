import { JsonLd } from "./_components/JsonLd";
import { CONTACT, MCP_URL, SITE_DESCRIPTION } from "../lib/site/constants";
import { homeExamples } from "../lib/site/examples";
import { homeGraph } from "../lib/site/jsonld";
import { pageMetadata } from "../lib/site/meta";
import { sourceCards, groupByCategory } from "../lib/site/sources";
import { shortPublisher } from "../lib/site/answer-pages";

export const metadata = pageMetadata({
  title: "ProofPrice: what people actually paid, for AI agents",
  absoluteTitle: true,
  description: SITE_DESCRIPTION,
  path: "/",
});

export default function Home() {
  const cards = sourceCards();
  const groups = groupByCategory(cards);
  const countries = new Set(cards.flatMap((c) => c.countryCodes));
  const examples = homeExamples(3);
  return (
    <main>
      <JsonLd data={homeGraph()} />
      <section className="hero">
        <h1>What people actually paid, for AI agents</h1>
        <p className="lede">
          ProofPrice answers one question: what did people actually pay for something, here, recently? It returns a price range built from
          official records, with the sample size, period, source and licence on every answer. It is free, read-only and needs no API key.
        </p>
        <div className="mcp-box">
          <p className="label">MCP server address (Streamable HTTP, no sign-in)</p>
          <code className="mcp-url">{MCP_URL}</code>
        </div>
        <div className="actions">
          <a className="btn" href="/connect">
            Connect your AI
          </a>
          <a className="btn secondary" href="/sources">
            See the sources
          </a>
          <a className="btn secondary" href="/prices">
            Browse prices
          </a>
        </div>
        <ul className="stats" aria-label="Coverage at a glance">
          <li>
            <strong>{cards.length}</strong>
            official {cards.length === 1 ? "source" : "sources"}
          </li>
          <li>
            <strong>{countries.size}</strong>
            {countries.size === 1 ? "country" : "countries"}
          </li>
          <li>
            <strong>{groups.length}</strong>
            {groups.length === 1 ? "category" : "categories"}
          </li>
        </ul>
      </section>

      <h2>Three questions it can answer today</h2>
      <p className="muted">
        Each link below is a real request to the REST API. The MCP tool named on each card takes the same parameters.
      </p>
      <div className="grid">
        {examples.map((e) => (
          <div className="card" key={e.path}>
            <h3>{e.question}</h3>
            <p>
              <a href={e.path}>Open the live answer (JSON)</a>
            </p>
            <p className="small muted">
              REST: <code>{e.path}</code>
              {e.tool && (
                <>
                  <br />
                  MCP tool: <code>{e.tool}</code>
                </>
              )}
            </p>
          </div>
        ))}
      </div>

      <h2>What it covers now</h2>
      {groups.map((g) => (
        <div key={g.categoryId}>
          <h3>{g.heading}</h3>
          <ul>
            {g.cards.map((c) => (
              <li key={c.id}>
                {c.countryNames.join(", ")}: <a href={`/sources#${c.id}`}>{c.name}</a>
                <span className="muted"> ({shortPublisher(c.publisher)})</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <p>
        Home sale and fuel prices also have pages you can read without an AI: <a href="/prices">prices by place</a>, with the latest median
        and typical range for each province, department, county and Dublin district in our daily price library.
      </p>

      <h2>Why you can rely on it</h2>
      <ul>
        <li>Official and licensed data only. Every source, its licence and the attribution line are listed on <a href="/sources">/sources</a>.</li>
        <li>Every answer carries its source, licence, sample size, period, confidence and method.</li>
        <li>Aggregates only, and never a figure from fewer than 5 records. Asking prices are never shown as paid prices.</li>
      </ul>
      <p>
        More on <a href="/trust">how we earn trust</a>, and the live <a href="/status">status of the price library</a>.
      </p>

      <h2>For machines</h2>
      <p>
        <a href="/llms.txt">llms.txt</a> (short menu) · <a href="/llms-full.txt">llms-full.txt</a> (everything in one file) ·{" "}
        <a href="/openapi.json">openapi.json</a> · <a href="/api/v1/coverage">coverage (JSON)</a> · <a href="/sitemap.xml">sitemap.xml</a>
      </p>
      <p className="muted small">
        Questions or a wrong figure to report: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>
      </p>
    </main>
  );
}
