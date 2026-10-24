import { Breadcrumbs } from "../_components/Breadcrumbs";
import { CONTACT } from "../../lib/site/constants";
import { pageMetadata } from "../../lib/site/meta";
import { PRESS_LOGOS, pressFacts } from "../../lib/site/press";

export const dynamic = "force-static";

export const metadata = pageMetadata({
  title: "Press",
  description:
    "About ProofPrice for journalists and writers: a one-paragraph description, live facts about the sources, countries and categories, how we work out a price, logo files and a contact address.",
  path: "/press",
});

export default function Press() {
  const f = pressFacts();
  return (
    <main>
      <Breadcrumbs items={[{ name: "Home", path: "/" }, { name: "Press" }]} />
      <h1>Press</h1>
      <p className="lede">Everything a writer needs to describe ProofPrice accurately. Feel free to quote from this page.</p>

      <h2>In one paragraph</h2>
      <p>
        ProofPrice answers one question for AI agents: what did people actually pay for something, here, recently? It is a free MCP server and REST
        API. Each answer is a price range built from real records, with the number of records behind it, the period, a confidence level, the source
        and its licence. Today the records come from official open data. Verified receipts are planned for later and are not live. Asking prices are
        never shown as paid prices, and no figure is worked out from fewer than 5 records.
      </p>

      <h2>Facts, read live from the service</h2>
      <ul>
        <li>
          <strong>{f.sources} official sources</strong>, each listed with its publisher, licence and limits on <a href="/sources">/sources</a>.
        </li>
        <li>
          <strong>{f.countries} countries and regions</strong> with at least one source; the country of each source is on <a href="/sources">/sources</a>.
        </li>
        <li>
          <strong>{f.categories.length} categories</strong>: {f.categories.map((c) => c.title).join(", ")}.
        </li>
        <li>
          Every figure is labelled as a real sale, an official statistic or a posted price. The label is on each answer, and what each one means is
          on <a href="/method">/method</a>.
        </li>
        <li>
          Answers are free and need no key. A few extra calls (price check, daily history) cost a few cents each after a free daily allowance; see{" "}
          <a href="/pricing">/pricing</a>.
        </li>
      </ul>

      <h2>How a price is worked out</h2>
      <p>
        The plain-English method, including how the median and the typical range (10th to 90th percentile) are calculated, is on{" "}
        <a href="/method">/method</a>. The rules we keep and how we check them are on <a href="/trust">/trust</a>. If you reuse a figure, show the
        attribution line that comes with it.
      </p>

      <h2>Try it</h2>
      <p>
        MCP address: <code>{f.mcpUrl}</code>. Setup for common AI tools is on <a href="/connect">/connect</a>. The live status of every source is on{" "}
        <a href="/status">/status</a>.
      </p>

      <h2>Logo files</h2>
      <ul>
        {PRESS_LOGOS.map((l) => (
          <li key={l.path}>
            <a href={l.path}>{l.label}</a>
          </li>
        ))}
      </ul>
      <p>Use the logo to refer to ProofPrice. Please do not change its colours or shape.</p>

      <h2>Contact</h2>
      <p>
        Email <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
      </p>
    </main>
  );
}
