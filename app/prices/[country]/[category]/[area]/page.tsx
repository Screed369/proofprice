import { notFound } from "next/navigation";
import { Breadcrumbs } from "../../../../_components/Breadcrumbs";
import { JsonLd } from "../../../../_components/JsonLd";
import { shortLicence, shortPublisher } from "../../../../../lib/site/answer-pages";
import { answerPageGraph } from "../../../../../lib/site/jsonld";
import { longDate } from "../../../../../lib/site/format";
import { MCP_URL } from "../../../../../lib/site/constants";
import { pageMetadata } from "../../../../../lib/site/meta";
import { findExamplePage } from "../../../../../lib/site/example-pages";
import { allAnswerPages, findAnswerPage, pageRefs } from "../../../../../lib/site/prices";
import { ExampleAnswerPage } from "../../../../_components/ExampleAnswerPage";

// Built at deploy time from the newest day of the price library (library/<source>/daily/*.csv).
export const dynamic = "force-static";
export const dynamicParams = false;

type Props = { params: Promise<{ country: string; category: string; area: string }> };

export function generateStaticParams() {
  return pageRefs().map((p) => ({ country: p.countrySlug, category: p.category, area: p.slug }));
}

const refOf = (country: string, category: string, area: string) =>
  pageRefs().find((r) => r.countrySlug === country && r.category === category && r.slug === area);

export async function generateMetadata({ params }: Props) {
  const { country, category, area } = await params;
  const ref = refOf(country, category, area);
  if (!ref) return {};
  const page = ref.mode === "example" ? await findExamplePage(country, category, area) : findAnswerPage(country, category, area);
  if (!page) return {};
  return pageMetadata({ title: page.title, description: page.description, path: page.path });
}

export default async function AnswerPageView({ params }: Props) {
  const { country, category, area } = await params;
  const ref = refOf(country, category, area);
  if (!ref) notFound();
  if (ref.mode === "example") {
    const example = await findExamplePage(country, category, area);
    if (!example) notFound();
    const siblings = pageRefs().filter((r) => r.countrySlug === country && r.category === category);
    return <ExampleAnswerPage page={example} siblings={siblings} />;
  }
  const page = findAnswerPage(country, category, area);
  if (!page) notFound();
  const homes = page.category === "home-sales";
  const parent = page.area.parent ? findAnswerPage(page.countrySlug, page.category, page.area.parent) : undefined;
  const national = allAnswerPages().find((p) => p.national && p.countrySlug === page.countrySlug && p.category === page.category);
  const categoryPath = `/prices/${page.countrySlug}/${page.category}`;
  const crumbs = [
    { name: "Home", path: "/" },
    { name: "Prices", path: "/prices" },
    { name: page.countryName, path: `/prices/${page.countrySlug}` },
    { name: page.categoryLabel, path: categoryPath },
    { name: page.area.label, path: page.path },
  ];
  const s = page.source;
  const headline = page.figures[0];
  return (
    <main>
      <JsonLd data={answerPageGraph(page, crumbs)} />
      <Breadcrumbs items={[...crumbs.slice(0, 4), { name: page.area.label }]} />
      <h1>{page.h1}</h1>
      <p className="lede">
        {homes && page.period ? (
          <>
            Homes sold in {page.area.label} between {longDate(page.period.from)} and {longDate(page.period.to)}, from the official register. Latest
            sale in the register: {longDate(page.asOf)}.
          </>
        ) : (
          <>Pump prices in {page.area.label} on {longDate(page.asOf)}, from the official feed.</>
        )}
      </p>
      <p className="muted">{page.basis}</p>
      {page.area.note && <p className="notice">{page.area.note}</p>}

      {page.figures.map((f) => (
        // The heading is the question. When the page title already is that question, it is not repeated.
        <section className="answer" key={f.id} aria-label={f.question}>
          {f.question !== page.h1 && <h2>{f.question}</h2>}
          <p className="big">
            {f.medianText} <small>{f.unit}, median</small>
          </p>
          <p>{f.answer}</p>
          {f.caveat && <p className="caveat">{f.caveat}</p>}
          <p className="cite">
            Source: {shortPublisher(s.publisher)}. Licence: <a href={s.licence_url}>{shortLicence(s.licence)}</a>.
            {f.liveRestPath && (
              <>
                {" "}
                Live answer: <a href={f.liveRestPath}>{f.liveRestPath}</a>
              </>
            )}
          </p>
        </section>
      ))}

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
        <dt>Figures as of</dt>
        <dd>
          <time dateTime={page.asOf}>{longDate(page.asOf)}</time>. This page is rebuilt when the daily price library is deployed. Source updates:{" "}
          {s.freshness.toLowerCase()}.
        </dd>
        <dt>Limits</dt>
        <dd>{s.limits}</dd>
        <dt>Rule</dt>
        <dd>A figure is shown only when at least 5 records sit behind it. See <a href="/trust">how we earn trust</a> and <a href="/method">the method</a>.</dd>
      </dl>

      <h2>Ask your AI</h2>
      <p>
        Add the ProofPrice MCP server (<code>{MCP_URL}</code>) to your AI app, then paste this. Not connected yet? See{" "}
        <a href="/connect">how to connect</a>.
      </p>
      <pre className="selectall">
        <code>{page.ask}</code>
      </pre>

      <h2>Use it in code</h2>
      <ul>
        <li>
          MCP tool: <code>{page.mcpTool}</code> with <code>{JSON.stringify(headline.mcpArgs)}</code>
        </li>
        {headline.liveRestPath ? (
          <li>
            REST (live answer): <a href={headline.liveRestPath}>{headline.liveRestPath}</a>
          </li>
        ) : (
          <li className="muted">
            The live REST answer needs a {page.category === "fuel" ? "postcode or a smaller area" : "place"}; this whole-country figure comes from the
            daily price library.
          </li>
        )}
        {page.historyRestPath && (
          <li>
            REST (daily snapshots, last 30 days): <a href={page.historyRestPath}>{page.historyRestPath}</a>
          </li>
        )}
        <li>
          All parameters: <a href="/openapi.json">openapi.json</a>
        </li>
      </ul>

      <h2>More</h2>
      <ul>
        {parent && (
          <li>
            Wider area: <a href={parent.path}>{parent.area.label}</a>
          </li>
        )}
        {national && !page.national && (
          <li>
            Whole country: <a href={national.path}>{national.area.label}</a>
          </li>
        )}
        <li>
          <a href={categoryPath}>
            All places: {page.categoryLabel.toLowerCase()} in {page.countryName}
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
