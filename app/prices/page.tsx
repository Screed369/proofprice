import { Breadcrumbs } from "../_components/Breadcrumbs";
import { JsonLd } from "../_components/JsonLd";
import { breadcrumbGraph } from "../../lib/site/jsonld";
import { longDate, plural } from "../../lib/site/format";
import { pageMetadata } from "../../lib/site/meta";
import { allAnswerPages, countryGroups } from "../../lib/site/prices";
import { sourceCards } from "../../lib/site/sources";

export const dynamic = "force-static";

export const metadata = pageMetadata({
  title: "Prices by place: homes and fuel",
  description:
    "The latest median and typical range of home sale prices and pump prices by province, department, county and district, from official data, with sample size, source and licence.",
  path: "/prices",
});

export default function PricesIndex() {
  const groups = countryGroups();
  const total = allAnswerPages().length;
  const noPages = sourceCards().filter((c) => !c.pricesPath);
  return (
    <main>
      <JsonLd data={breadcrumbGraph([{ name: "Home", path: "/" }, { name: "Prices", path: "/prices" }])} />
      <Breadcrumbs items={[{ name: "Home", path: "/" }, { name: "Prices" }]} />
      <h1>Prices by place</h1>
      <p className="lede">
        The latest figures from the ProofPrice price library, for every place where we hold at least 5 records. Each page gives the median, the
        typical range, how many records it rests on, the date, the source and the licence. {plural(total, "page")} in all, rebuilt each day.
      </p>

      <div className="grid">
        {groups.map((g) => (
          <div className="card" key={g.slug}>
            <h3>
              <a href={g.path}>{g.name}</a>
            </h3>
            <ul>
              {g.categories.map((c) => (
                <li key={c.path}>
                  <a href={c.path}>{c.label}</a>: {plural(c.pages.length, "place")}
                  <br />
                  <span className="muted small">figures of {longDate(c.asOf)}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <h2>How to read these pages</h2>
      <ul>
        <li>The headline figure is the median: half of the records are below it and half above.</li>
        <li>The typical range runs from the 10th to the 90th percentile, so it leaves out the cheapest and the dearest tenth.</li>
        <li>Home figures are recorded sale prices, never asking prices. Fuel figures are posted pump prices, not receipts, and are labelled so.</li>
        <li>A place appears only when at least 5 records sit behind a figure. Otherwise the page does not exist.</li>
      </ul>

      {noPages.length > 0 && (
        <>
          <h2>Not on these pages yet</h2>
          <p>
            Some sources are answered live by the API and do not yet keep a daily library, so they have no page here:{" "}
            {noPages.map((c, i) => (
              <span key={c.id}>
                {i > 0 && ", "}
                <a href={`/sources#${c.id}`}>{c.countryNames.join(", ")} ({c.categoryHeading.toLowerCase()})</a>
              </span>
            ))}
            . Ask your AI through the <a href="/connect">MCP server</a> for those.
          </p>
        </>
      )}
    </main>
  );
}
