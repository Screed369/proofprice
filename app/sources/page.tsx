import { JsonLd } from "../_components/JsonLd";
import { Breadcrumbs } from "../_components/Breadcrumbs";
import { sourcesGraph } from "../../lib/site/jsonld";
import { pageMetadata } from "../../lib/site/meta";
import { datasetInput, groupByCategory, sourceCards } from "../../lib/site/sources";
import { longDate } from "../../lib/site/format";

export const dynamic = "force-static";

export const metadata = pageMetadata({
  title: "Sources, licences and attribution",
  description:
    "Every official source behind ProofPrice: publisher, what one record is, price type, how fresh it is, the licence, the attribution line to show, and the limits.",
  path: "/sources",
});

export default function Sources() {
  const cards = sourceCards();
  const groups = groupByCategory(cards);
  return (
    <main>
      <JsonLd data={sourcesGraph(cards.map(datasetInput))} />
      <Breadcrumbs items={[{ name: "Home", path: "/" }, { name: "Sources" }]} />
      <h1>Sources: the open book</h1>
      <p className="lede">
        Every figure ProofPrice returns comes from one of the official sources below. For each one you can see who publishes it, what a single
        record is, what kind of price it is, how fresh it is, the licence, the attribution line to show, and the limits.
      </p>
      <p>
        If you reuse a figure, show its source and the attribution line. Where a publisher&apos;s licence wording is still being confirmed, the
        licence line says so. Rules for all sources are on <a href="/trust">how we earn trust</a>.
      </p>

      <div className="table-wrap">
        <table>
          <caption>
            {cards.length} sources at a glance
          </caption>
          <thead>
            <tr>
              <th>Country</th>
              <th>Category</th>
              <th>Source</th>
              <th>Price type</th>
              <th>Freshness</th>
            </tr>
          </thead>
          <tbody>
            {groups.flatMap((g) =>
              g.cards.map((c) => (
                <tr key={c.id}>
                  <td>{c.countryNames.join(", ")}</td>
                  <td>{g.heading}</td>
                  <td>
                    <a href={`#${c.id}`}>{c.name}</a>
                  </td>
                  <td>{c.priceTypeShort}</td>
                  <td>{c.freshness}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>

      {groups.map((g) => (
        <section key={g.categoryId} aria-labelledby={`cat-${g.categoryId}`}>
          <h2 id={`cat-${g.categoryId}`}>{g.heading}</h2>
          {g.cards.map((c) => (
            <section className="source" id={c.id} key={c.id} aria-labelledby={`h-${c.id}`}>
              <h3 id={`h-${c.id}`}>
                {c.countryNames.join(", ")}: {c.name}
              </h3>
              <dl className="facts">
                <dt>Country</dt>
                <dd>{c.countryNames.join(", ")}</dd>
                <dt>Category</dt>
                <dd>{g.heading}</dd>
                <dt>Publisher</dt>
                <dd>
                  <a href={c.homepage}>{c.publisher}</a>
                </dd>
                <dt>What one record is</dt>
                <dd>{c.whatIsRecorded}</dd>
                <dt>Price type</dt>
                <dd>{c.priceTypeLabel}</dd>
                <dt>Freshness</dt>
                <dd>{c.freshness}</dd>
                <dt>Licence</dt>
                <dd>
                  <a href={c.licenceUrl}>{c.licence}</a>
                </dd>
                <dt>Attribution line</dt>
                <dd>{c.attribution}</dd>
                <dt>Limits</dt>
                <dd>{c.limits}</dd>
                {c.method && (
                  <>
                    <dt>How we compute it</dt>
                    <dd>{c.method}</dd>
                  </>
                )}
                <dt>Example request</dt>
                <dd>
                  {c.exampleRest ? (
                    <>
                      <a href={c.exampleRest}>{c.exampleRest}</a>
                      {c.tool && (
                        <>
                          <br />
                          <span className="muted small">
                            MCP tool: <code>{c.tool}</code>
                          </span>
                        </>
                      )}
                    </>
                  ) : (
                    <span className="muted">See the coverage list</span>
                  )}
                </dd>
                {c.collected && (
                  <>
                    <dt>Price library</dt>
                    <dd>
                      Collected once a day.{" "}
                      {c.library?.last_date ? <>Newest figures: {longDate(c.library.last_date)}. </> : <>First collection pending. </>}
                      <a href="/status">Library status</a>
                      {c.pricesPath && (
                        <>
                          {" "}
                          · <a href={c.pricesPath}>Prices by place</a>
                        </>
                      )}
                    </dd>
                  </>
                )}
              </dl>
            </section>
          ))}
        </section>
      ))}
    </main>
  );
}
