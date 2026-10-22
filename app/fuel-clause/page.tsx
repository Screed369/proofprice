import { Breadcrumbs } from "../_components/Breadcrumbs";
import { JsonLd } from "../_components/JsonLd";
import { breadcrumbGraph } from "../../lib/site/jsonld";
import { longDate } from "../../lib/site/format";
import { pageMetadata } from "../../lib/site/meta";
import { CLAUSE_PATH, clausePath, clauseSeries, loadClausePage } from "../../lib/site/fuel-clause";

export const dynamic = "force-static";

export const metadata = pageMetadata({
  title: "Diesel price records for fuel clauses in contracts",
  description:
    "For each country, the weekly official diesel price from a public source, with the licence, the date range and a SHA-256 hash of the figures, so a contract can point to a record that does not change.",
  path: CLAUSE_PATH,
});

export default function FuelClauseIndex() {
  const crumbs = [
    { name: "Home", path: "/" },
    { name: "Diesel price records", path: CLAUSE_PATH },
  ];
  const pages = clauseSeries()
    .map((s) => loadClausePage(s.slug))
    .filter((p): p is NonNullable<typeof p> => !!p);
  return (
    <main>
      <JsonLd data={breadcrumbGraph(crumbs)} />
      <Breadcrumbs items={[crumbs[0], { name: crumbs[1].name }]} />
      <h1>Diesel price records for fuel clauses</h1>
      <p className="lede">
        A fuel surcharge or diesel floater in a transport contract needs a named public source that still exists next year. Each page below keeps the weekly
        official diesel price for one country, with the publisher, the licence, the date range and a SHA-256 hash of the figures shown, so anyone can check that
        nothing has changed since it was cited.
      </p>
      <p className="notice">
        This is information, not legal, tax or financial advice. Ask your own adviser how to word a clause. Every figure is an official statistic from the publisher
        named on its page, never an asking price.
      </p>
      <div className="table-wrap">
        <table>
          <caption>Countries with a diesel price record</caption>
          <thead>
            <tr>
              <th>Country</th>
              <th>Source</th>
              <th>Newest week</th>
            </tr>
          </thead>
          <tbody>
            {pages.map((p) => (
              <tr key={p.series.slug}>
                <td>
                  <a href={clausePath(p.series.slug)}>{p.series.name}</a>
                </td>
                <td>{p.info.publisher}</td>
                <td>{p.to ? longDate(p.to) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        Prices in the European Union come from the European Commission&apos;s Weekly Oil Bulletin and include all duties and taxes. Many carriers&apos; own surcharge
        indices use prices without VAT: check which basis your contract names. Live answers: <a href="/api/v1/fuel?country=IE&fuel=diesel" rel="nofollow">REST example</a>{" "}
        and <a href="/connect">connect an AI client</a>.
      </p>
    </main>
  );
}
