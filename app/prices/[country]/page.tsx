import { notFound } from "next/navigation";
import { Breadcrumbs } from "../../_components/Breadcrumbs";
import { JsonLd } from "../../_components/JsonLd";
import { breadcrumbGraph } from "../../../lib/site/jsonld";
import { longDate, plural } from "../../../lib/site/format";
import { pageMetadata } from "../../../lib/site/meta";
import { joinAnd } from "../../../lib/text";
import { countryGroups } from "../../../lib/site/prices";

export const dynamic = "force-static";
export const dynamicParams = false;

type Props = { params: Promise<{ country: string }> };

export function generateStaticParams() {
  return countryGroups().map((g) => ({ country: g.slug }));
}

export async function generateMetadata({ params }: Props) {
  const { country } = await params;
  const g = countryGroups().find((x) => x.slug === country);
  if (!g) return {};
  return pageMetadata({
    title: `Prices in ${g.name}`,
    description: `Latest official figures for ${g.name}: ${joinAnd(g.categories.map((c) => c.label.toLowerCase()))}, with the source and licence of every figure.`,
    path: g.path,
  });
}

export default async function CountryPrices({ params }: Props) {
  const { country } = await params;
  const g = countryGroups().find((x) => x.slug === country);
  if (!g) notFound();
  const crumbs = [
    { name: "Home", path: "/" },
    { name: "Prices", path: "/prices" },
    { name: g.name, path: g.path },
  ];
  return (
    <main>
      <JsonLd data={breadcrumbGraph(crumbs)} />
      <Breadcrumbs items={[...crumbs.slice(0, 2), { name: g.name }]} />
      <h1>Prices in {g.name}</h1>
      <ul>
        {g.categories.map((c) => (
          <li key={c.path}>
            <a href={c.path}>{c.label} in {g.name}</a>: {c.mode === "bulk" ? plural(c.refs.length, "place") : plural(c.refs.length, "ready answer")}
            {c.asOf ? <>, figures of {longDate(c.asOf)}</> : null}
          </li>
        ))}
      </ul>
    </main>
  );
}
