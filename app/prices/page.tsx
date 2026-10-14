import { Breadcrumbs } from "../_components/Breadcrumbs";
import { JsonLd } from "../_components/JsonLd";
import { breadcrumbGraph } from "../../lib/site/jsonld";
import { longDate, plural } from "../../lib/site/format";
import { pageMetadata } from "../../lib/site/meta";
import { countryGroups, pageRefs } from "../../lib/site/prices";
import { sourceCards } from "../../lib/site/sources";

export const dynamic = "force-static";

export const metadata = pageMetadata({
  title: "Prices by place and item: homes, rents, fuel, food and more",
  description:
    "Ready answers from official data: home sale prices, rents, fuel, groceries, energy, farm and land prices, medicines, medical services and public contracts, with the figure where we hold it, the source and the licence.",
  path: "/prices",
});

export default function PricesIndex() {
  const groups = countryGroups();
  const total = pageRefs().length;
  const noPages = sourceCards().filter((c) => c.pricesPaths.length === 0);
  // The same pages by topic: one entry per category, with its countries.
  const topics = new Map<string, { label: string; items: { name: string; path: string }[] }>();
  for (const g of groups) {
    for (const c of g.categories) {
      const t = topics.get(c.category) ?? { label: c.label, items: [] };
      t.items.push({ name: g.name, path: c.path });
      topics.set(c.category, t);
    }
  }
  const byTopic = [...topics.values()].sort((a, b) => a.label.localeCompare(b.label, "en"));
  return (
    <main>
      <JsonLd data={breadcrumbGraph([{ name: "Home", path: "/" }, { name: "Prices", path: "/prices" }])} />
      <Breadcrumbs items={[{ name: "Home", path: "/" }, { name: "Prices" }]} />
      <h1>Prices by place and item</h1>
      <p className="lede">
        Ready answers from official data. Where the ProofPrice price library holds the figure, a page gives the median or the official average, the typical
        range where there is one, how many records it rests on, the date, the source and the licence. Where a source is answered live, the page shows the
        question, the tool to call and the request, and no number. {plural(total, "page")} in all, rebuilt each day.
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
                  <a href={c.path}>{c.label}</a>: {c.mode === "bulk" ? plural(c.refs.length, "place") : plural(c.refs.length, "ready answer")}
                  {c.asOf && (
                    <>
                      <br />
                      <span className="muted small">figures of {longDate(c.asOf)}</span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <h2>By topic</h2>
      <ul>
        {byTopic.map((t) => (
          <li key={t.label}>
            <strong>{t.label}</strong>:{" "}
            {t.items.map((i, k) => (
              <span key={i.path}>
                {k > 0 && ", "}
                <a href={i.path}>{i.name}</a>
              </span>
            ))}
          </li>
        ))}
      </ul>

      <h2>How to read these pages</h2>
      <ul>
        <li>A median is the middle figure: half of the records are below it and half above. The typical range runs from the 10th to the 90th percentile.</li>
        <li>
          An official statistic is an average or median that a statistics office or regulator publishes. It is shown as such, with the reference period the
          publisher states, and has no range of ours.
        </li>
        <li>Home figures are recorded sale prices, never asking prices. Fuel figures are posted pump prices, not receipts, and are labelled so.</li>
        <li>A figure built from records appears only when at least 5 records sit behind it. Otherwise the page does not show one.</li>
        <li>A page with no number is a source we answer live: it gives the exact question, the MCP tool and the REST request to get the latest figure.</li>
      </ul>

      {noPages.length > 0 && (
        <>
          <h2>Not on these pages yet</h2>
          <p>
            These sources have no page here yet:{" "}
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
