import { notFound } from "next/navigation";
import { Breadcrumbs } from "../../../_components/Breadcrumbs";
import { JsonLd } from "../../../_components/JsonLd";
import { noFullStop, shortLicence, type AnswerPage, type Figure } from "../../../../lib/site/answer-pages";
import { breadcrumbGraph } from "../../../../lib/site/jsonld";
import { int, longDate, plural } from "../../../../lib/site/format";
import { pageMetadata } from "../../../../lib/site/meta";
import { countryGroups, findCategoryGroup } from "../../../../lib/site/prices";

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
  return pageMetadata({
    title: `${group.label} in ${c.name}, by place`,
    description: `Latest median and typical range of ${group.label.toLowerCase()} in ${c.name}, for ${plural(group.pages.length, "place")}, from official data (figures of ${longDate(group.asOf)}). Source and licence on every page.`,
    path: group.path,
  });
}

const byId = (p: AnswerPage, id: string): Figure | undefined => p.figures.find((f) => f.id === id);

export default async function CategoryIndex({ params }: Props) {
  const { country, category } = await params;
  const found = findCategoryGroup(country, category);
  if (!found) notFound();
  const { country: c, group } = found;
  const homes = group.category === "home-sales";
  const first = group.pages[0];
  const crumbs = [
    { name: "Home", path: "/" },
    { name: "Prices", path: "/prices" },
    { name: c.name, path: c.path },
    { name: group.label, path: group.path },
  ];
  const nationalPage = group.pages.find((p) => p.national);
  return (
    <main>
      <JsonLd data={breadcrumbGraph(crumbs)} />
      <Breadcrumbs items={[...crumbs.slice(0, 3), { name: group.label }]} />
      <h1>
        {group.label} in {c.name}, by place
      </h1>
      <p className="lede">
        {homes
          ? `What homes sold for in each place, over the 12 months to ${longDate(group.asOf)}.`
          : `What fuel costs at the pump in each place, on ${longDate(group.asOf)}.`}{" "}
        {plural(group.pages.length, "place")}. Open a place for every figure, its source and licence.
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
            {group.pages.map((p) => {
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
        Figures of {longDate(group.asOf)}; rebuilt when the daily price library is deployed. Only places with at least 5 records are listed. See{" "}
        <a href="/sources">/sources</a> and <a href="/method">/method</a>.
      </p>
    </main>
  );
}
