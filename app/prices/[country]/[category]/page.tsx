import { notFound } from "next/navigation";
import { Breadcrumbs } from "../../../_components/Breadcrumbs";
import { JsonLd } from "../../../_components/JsonLd";
import { noFullStop, shortLicence, type AnswerPage, type Figure } from "../../../../lib/site/answer-pages";
import { examplePagesIn } from "../../../../lib/site/example-pages";
import { breadcrumbGraph } from "../../../../lib/site/jsonld";
import { int, longDate, plural } from "../../../../lib/site/format";
import { clausePath, clauseSlugs } from "../../../../lib/site/fuel-clause";
import { pageMetadata } from "../../../../lib/site/meta";
import { allAnswerPages, countryGroups, findCategoryGroup } from "../../../../lib/site/prices";

export const dynamic = "force-static";
export const dynamicParams = false;

type Props = { params: Promise<{ country: string; category: string }> };

export function generateStaticParams() {
  return countryGroups().flatMap((g) => g.categories.map((c) => ({ country: g.slug, category: c.category })));
}

export async function generateMetadata({ params }: Props) {
  const { country, category } = await params;
  const found = findCategoryGroup(country, category);
  if (!found) return {};
  const { country: c, group } = found;
  const what = group.mode === "bulk" ? plural(group.refs.length, "place") : plural(group.refs.length, "ready answer");
  return pageMetadata({
    title: group.mode === "bulk" ? `${group.label} in ${c.name}, by place` : `${group.label} in ${c.name}`,
    description:
      group.mode === "bulk"
        ? `Latest median and typical range of ${group.label.toLowerCase()} in ${c.name}, for ${what}, from official data${group.asOf ? ` (figures of ${longDate(group.asOf)})` : ""}. Source and licence on every page.`
        : `Ready answers on ${group.label.toLowerCase()} in ${c.name} (${what}), from official data: the question, the figure where we hold it, the source and the licence, and how to ask for the latest.`,
    path: group.path,
  });
}

const byId = (p: AnswerPage, id: string): Figure | undefined => p.figures.find((f) => f.id === id);

export default async function CategoryIndex({ params }: Props) {
  const { country, category } = await params;
  const found = findCategoryGroup(country, category);
  if (!found) notFound();
  const { country: c, group } = found;
  const crumbs = [
    { name: "Home", path: "/" },
    { name: "Prices", path: "/prices" },
    { name: c.name, path: c.path },
    { name: group.label, path: group.path },
  ];

  if (group.mode === "example") {
    const pages = await examplePagesIn(country, category);
    const first = pages[0];
    return (
      <main>
        <JsonLd data={breadcrumbGraph(crumbs)} />
        <Breadcrumbs items={[...crumbs.slice(0, 3), { name: group.label }]} />
        <h1>
          {group.label} in {c.name}
        </h1>
        <p className="lede">
          {plural(pages.length, "ready answer")} from official data. Open one for the figure where we hold it, the source and the licence, and the exact request to
          get the latest.
        </p>
        <div className="table-wrap">
          <table>
            <caption>Latest figure, where the ProofPrice library holds it</caption>
            <thead>
              <tr>
                <th>Question</th>
                <th className="num">Figure</th>
                <th>Kind</th>
              </tr>
            </thead>
            <tbody>
              {pages.map((p) => (
                <tr key={p.path}>
                  <td>
                    <a href={p.path}>{p.h1}</a>
                  </td>
                  <td className="num">
                    {p.figure ? (
                      <>
                        {p.figure.headline} <span className="muted small">{p.figure.unit}</span>
                      </>
                    ) : (
                      <span className="muted">ask live</span>
                    )}
                  </td>
                  <td>{p.figure ? (p.figure.statistic ? `official ${p.figure.measure}` : `${p.figure.measure} of ${p.figure.n === null ? "records" : `${int(p.figure.n)} records`}`) : "answered live"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {first && (
          <p className="cite">
            Source: {noFullStop(first.source.publisher)}. Licence: <a href={first.source.licence_url}>{shortLicence(first.source.licence)}</a>.{" "}
            {first.source.attribution} {first.basis} A figure built from records is shown only when at least 5 records sit behind it; where no figure is shown the
            source is answered live. See <a href="/sources">/sources</a> and <a href="/method">/method</a>.
          </p>
        )}
        {category === "fuel" && clauseSlugs().includes(country) ? (
          <p className="muted small">
            Need a diesel price to cite in a contract? See the <a href={clausePath(country)}>weekly diesel record for {c.name}</a>.
          </p>
        ) : null}
      </main>
    );
  }

  const homes = group.category === "home-sales";
  const pages = allAnswerPages().filter((p) => p.countrySlug === country && p.category === category);
  const first = pages[0];
  const nationalPage = pages.find((p) => p.national);
  return (
    <main>
      <JsonLd data={breadcrumbGraph(crumbs)} />
      <Breadcrumbs items={[...crumbs.slice(0, 3), { name: group.label }]} />
      <h1>
        {group.label} in {c.name}, by place
      </h1>
      <p className="lede">
        {homes
          ? `What homes sold for in each place, over the 12 months to ${longDate(group.asOf ?? "")}.`
          : `What fuel costs at the pump in each place, on ${longDate(group.asOf ?? "")}.`}{" "}
        {plural(pages.length, "place")}. Open a place for every figure, its source and licence.
      </p>
      {nationalPage && (
        <p>
          Whole country: <a href={nationalPage.path}>{nationalPage.area.label}</a>
        </p>
      )}
      <div className="table-wrap">
        <table>
          <caption>
            {homes ? "Median sale price, typical range (10th to 90th percentile) and number of sales" : "Median pump price (EUR per litre) and number of stations"}
          </caption>
          <thead>
            <tr>
              <th>Place</th>
              {homes ? (
                <>
                  <th className="num">Median</th>
                  <th className="num">Typical range</th>
                  <th className="num">Sales</th>
                </>
              ) : (
                <>
                  <th className="num">Diesel</th>
                  <th className="num">Unleaded 95</th>
                  <th className="num">Stations (diesel)</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {pages.map((p) => {
              const h = p.figures[0];
              const diesel = byId(p, "diesel");
              const petrol = byId(p, "petrol95");
              return (
                <tr key={p.path}>
                  <td>
                    <a href={p.path}>{p.area.label}</a>
                  </td>
                  {homes ? (
                    <>
                      <td className="num">{h.medianText}</td>
                      <td className="num">{h.rangeText}</td>
                      <td className="num">{int(h.n)}</td>
                    </>
                  ) : (
                    <>
                      <td className="num">{diesel ? diesel.medianText : "not enough data"}</td>
                      <td className="num">{petrol ? petrol.medianText : "not enough data"}</td>
                      <td className="num">{diesel ? int(diesel.n) : "n/a"}</td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="cite">
        Source: {noFullStop(first.source.publisher)}. Licence: <a href={first.source.licence_url}>{shortLicence(first.source.licence)}</a>.{" "}
        {first.source.attribution} {first.basis}{" "}
        Figures of {longDate(group.asOf ?? "")}; rebuilt when the daily price library is deployed. Only places with at least 5 records are listed. See{" "}
        <a href="/sources">/sources</a> and <a href="/method">/method</a>.
      </p>
      {category === "fuel" && clauseSlugs().includes(country) ? (
        <p className="muted small">
          Need a diesel price to cite in a contract? See the <a href={clausePath(country)}>weekly diesel record for {c.name}</a>.
        </p>
      ) : null}
    </main>
  );
}
