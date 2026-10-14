import { Breadcrumbs } from "./Breadcrumbs";
import { JsonLd } from "./JsonLd";
import { shortLicence, shortPublisher } from "../../lib/site/answer-pages";
import { MCP_URL } from "../../lib/site/constants";
import type { ExamplePage } from "../../lib/site/example-pages";
import { int, longDate } from "../../lib/site/format";
import { examplePageGraph } from "../../lib/site/jsonld";
import { inCountry } from "../../lib/site/page-wording";
import type { PageRef } from "../../lib/site/prices";

/** A page a source's manifest asked for. With a figure it reads like a place page; without one it is the "ask live" form:
 *  the question, the tool, the REST link and no number. */
export function ExampleAnswerPage({ page, siblings }: { page: ExamplePage; siblings: PageRef[] }) {
  const s = page.source;
  const f = page.figure;
  const categoryPath = `/prices/${page.countrySlug}/${page.category}`;
  const crumbs = [
    { name: "Home", path: "/" },
    { name: "Prices", path: "/prices" },
    { name: page.countryName, path: `/prices/${page.countrySlug}` },
    { name: page.categoryLabel, path: categoryPath },
    { name: page.label, path: page.path },
  ];
  const others = siblings.filter((r) => r.path !== page.path);
  return (
    <main>
      <JsonLd data={examplePageGraph(page, crumbs)} />
      <Breadcrumbs items={[...crumbs.slice(0, 4), { name: page.label }]} />
      <h1>{page.h1}</h1>
      {f ? (
        <p className="lede">
          {page.categoryLabel} {inCountry(page.countryName)}, from {shortPublisher(s.publisher)}. {f.statistic ? "An official figure" : "Figures"} as of{" "}
          {longDate(f.asOf)}.
        </p>
      ) : (
        <p className="lede">
          {page.categoryLabel} {inCountry(page.countryName)}, from {shortPublisher(s.publisher)}. This source is answered live, so the page shows how to ask, not a number.
        </p>
      )}
      <p className="muted">{page.basis}</p>

      {f ? (
        <section className="answer" aria-label={page.h1}>
          <p className="big">
            {f.headline} <small>{f.unit}, {f.measure}</small>
          </p>
          <p>{f.answer}</p>
          <dl className="facts">
            {f.referencePeriod && (
              <>
                <dt>Reference period</dt>
                <dd>{f.referencePeriod} (the period the publisher states for this figure)</dd>
              </>
            )}
            {!f.referencePeriod && f.periodText && (
              <>
                <dt>Period</dt>
                <dd>{f.periodText}</dd>
              </>
            )}
            <dt>Kind of figure</dt>
            <dd>
              {f.statistic
                ? `An official ${f.measure} published by ${shortPublisher(s.publisher)}. It is passed on as published: no range of ours, and no count of records unless the publisher gives one.`
                : `The ${f.measure} of recorded prices, with the typical range from the 10th to the 90th percentile.`}
            </dd>
            {f.rangeText && (
              <>
                <dt>Typical range (10th to 90th percentile)</dt>
                <dd>{f.rangeText}</dd>
              </>
            )}
            {f.n !== null && (
              <>
                <dt>Records behind it</dt>
                <dd>{int(f.n)}</dd>
              </>
            )}
            {f.confidence && (
              <>
                <dt>Confidence</dt>
                <dd>{f.confidence}</dd>
              </>
            )}
          </dl>
          {f.caveat && <p className="caveat">{f.caveat}</p>}
          <p className="cite">
            Source: {shortPublisher(s.publisher)}. Licence: <a href={s.licence_url}>{shortLicence(s.licence)}</a>. Live answer:{" "}
            <a href={page.liveRestPath}>{page.liveRestPath}</a>
          </p>
        </section>
      ) : (
        <section className="answer" aria-label={page.h1}>
          <p>
            ProofPrice reads {shortPublisher(s.publisher)} when you ask, so the answer is always the latest published. It comes with its period, its source and
            its licence; a range built from records is given only when at least 5 records sit behind it.
          </p>
          <p className="cite">
            Ask for it: <a href={page.liveRestPath}>{page.liveRestPath}</a>
          </p>
        </section>
      )}

      <h2>Where this comes from</h2>
      <dl className="facts">
        <dt>Source</dt>
        <dd>
          <a href={s.homepage}>{s.name}</a>, published by {s.publisher}
        </dd>
        <dt>Licence</dt>
        <dd>
          <a href={s.licence_url}>{s.licence}</a>
        </dd>
        <dt>Attribution</dt>
        <dd>{s.attribution}</dd>
        {f && (
          <>
            <dt>Figures as of</dt>
            <dd>
              <time dateTime={f.asOf}>{longDate(f.asOf)}</time>. This page is rebuilt when the daily price library is deployed.
            </dd>
          </>
        )}
        <dt>How fresh the source is</dt>
        <dd>{s.freshness}</dd>
        <dt>Limits</dt>
        <dd>{s.limits}</dd>
        <dt>Rule</dt>
        <dd>
          A figure built from records is shown only when at least 5 records sit behind it; official statistics are shown as such, with their reference
          period. See <a href="/trust">how we earn trust</a> and <a href="/method">the method</a>.
        </dd>
      </dl>

      <h2>Ask your AI</h2>
      <p>
        Add the ProofPrice MCP server (<code>{MCP_URL}</code>) to your AI app, then paste this. Not connected yet? See <a href="/connect">how to connect</a>.
      </p>
      <pre className="selectall">
        <code>{page.ask}</code>
      </pre>

      <h2>Use it in code</h2>
      <ul>
        <li>
          MCP tool: <code>{page.mcpTool}</code> with <code>{JSON.stringify(page.mcpArgs)}</code>
        </li>
        <li>
          REST (live answer): <a href={page.liveRestPath}>{page.liveRestPath}</a>
        </li>
        <li>
          All parameters: <a href="/openapi.json">openapi.json</a>
        </li>
      </ul>

      <h2>More</h2>
      <ul>
        {others.map((r) => (
          <li key={r.path}>
            <a href={r.path}>{r.label}</a>
          </li>
        ))}
        <li>
          <a href={categoryPath}>
            All pages: {page.categoryLabel.toLowerCase()} {inCountry(page.countryName)}
          </a>
        </li>
        <li>
          <a href={`/sources#${s.id}`}>This source and its licence</a>
        </li>
      </ul>
      <p className="muted small">Information, not a valuation or offer. Ranges describe past recorded prices.</p>
    </main>
  );
}
