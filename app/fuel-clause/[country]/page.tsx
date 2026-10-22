import { notFound } from "next/navigation";
import { Breadcrumbs } from "../../_components/Breadcrumbs";
import { JsonLd } from "../../_components/JsonLd";
import { breadcrumbGraph } from "../../../lib/site/jsonld";
import { CONTACT, SITE_URL } from "../../../lib/site/constants";
import { clausePath, clauseSlugs, CLAUSE_PATH, loadClausePage } from "../../../lib/site/fuel-clause";
import { longDate, plural } from "../../../lib/site/format";
import { pageMetadata } from "../../../lib/site/meta";

export const dynamic = "force-static";
export const dynamicParams = false;

type Props = { params: Promise<{ country: string }> };

export function generateStaticParams() {
  return clauseSlugs().map((country) => ({ country }));
}

const SYMBOL: Record<string, string> = { EUR: "€", GBP: "£" };
const money = (v: number, currency: string) => `${SYMBOL[currency] ?? currency + " "}${v.toFixed(4)}`;

export async function generateMetadata({ params }: Props) {
  const { country } = await params;
  const p = loadClausePage(country);
  if (!p) return {};
  return pageMetadata({
    title: `Diesel price record for contracts: ${p.series.name}`,
    description: `Weekly official diesel price for ${p.series.name} from ${p.info.publisher}, ${p.from ? longDate(p.from) : ""} to ${p.to ? longDate(p.to) : ""}, with licence, wording for citing it in a contract and a SHA-256 hash of the figures.`,
    path: clausePath(country),
  });
}

export default async function FuelClause({ params }: Props) {
  const { country } = await params;
  const p = loadClausePage(country);
  if (!p || !p.to || !p.from) notFound();
  const { series, info } = p;
  const url = `${SITE_URL}${clausePath(series.slug)}`;
  const crumbs = [
    { name: "Home", path: "/" },
    { name: "Diesel price records", path: CLAUSE_PATH },
    { name: series.name, path: clausePath(series.slug) },
  ];
  const newest = p.weeks[0];
  const rest = `/api/v1/fuel?country=${series.code}&fuel=diesel`;
  const cite =
    `The diesel price for ${series.name} is the national average pump price of diesel (automotive gas oil) published by ${info.publisher} in ${info.name}, ` +
    `for the Monday of the relevant week, in ${p.currency === "EUR" ? "euro" : p.currency} ${p.unit}, with duties and taxes included, as recorded at ${url}. ` +
    `If the publisher restates or stops publishing the figure, the parties will use the closest successor series published by the same body.`;
  return (
    <main>
      <JsonLd data={breadcrumbGraph(crumbs)} />
      <Breadcrumbs items={[...crumbs.slice(0, 2), { name: series.name }]} />
      <h1>Diesel price record for contracts: {series.name}</h1>
      <p className="lede">
        The weekly official diesel price for {series.name}, kept as a record you can point to: {plural(p.weeks.length, "weekly figure")} from {longDate(p.from)} to{" "}
        {longDate(p.to)}, with the publisher, the licence and a SHA-256 hash so nothing can change unnoticed.
      </p>
      <p className="notice">
        This page is information, not legal, tax or financial advice, and ProofPrice is not a party to your contract. Have your own adviser check any clause. The
        figures are an official statistic published by {info.publisher}; they are not asking prices and not the price at any one station.
      </p>

      <h2>Newest figure</h2>
      <p>
        <strong>{money(newest.value, p.currency)}</strong> {p.unit} for the week of {longDate(newest.date)}. {series.basis}
      </p>

      <h2>Weekly figures</h2>
      <div className="table-wrap">
        <table>
          <caption>
            {series.name}: diesel, {p.currency} {p.unit} (weeks held in the ProofPrice price library, newest first)
          </caption>
          <thead>
            <tr>
              <th>Week (Monday)</th>
              <th className="num">Price</th>
            </tr>
          </thead>
          <tbody>
            {p.weeks.map((w) => (
              <tr key={w.date}>
                <td>{longDate(w.date)}</td>
                <td className="num">{money(w.value, p.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        The library started keeping this series in October 2026, so the weekly table is short and grows every week; earlier years are shown as monthly averages below.
        {p.revisedWeeks > 0 ? ` For ${plural(p.revisedWeeks, "week")} a later bulletin gave a different value from the first one; the table shows the value recorded on the day of that week's own bulletin.` : ""}
      </p>

      {p.months.length > 0 ? (
        <>
          <h2>Monthly averages</h2>
          <div className="table-wrap">
            <table>
              <caption>Average of the weekly national figures in each month, lowest and highest week (our calculation from the weekly figures)</caption>
              <thead>
                <tr>
                  <th>Month</th>
                  <th className="num">Average</th>
                  <th className="num">Lowest week</th>
                  <th className="num">Highest week</th>
                </tr>
              </thead>
              <tbody>
                {p.months.map((m) => (
                  <tr key={m.month}>
                    <td>{m.month}</td>
                    <td className="num">{money(m.mean, p.currency)}</td>
                    <td className="num">{money(m.low, p.currency)}</td>
                    <td className="num">{money(m.high, p.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      <h2>How to cite this in a contract</h2>
      <p>A clause that adjusts a price with the diesel price should name the series, the publisher, the day it is read and what happens if it disappears. Wording you could adapt:</p>
      <blockquote>{cite}</blockquote>
      <p>
        Cite the publisher as the primary source and this page as the record of the figures. State whether your clause means prices with or without VAT: this series
        includes all duties and taxes{series.sourceId === "eu-oil-bulletin" ? ", and many carriers’ own indices are quoted without VAT. The Commission also publishes the bulletin net of duties and taxes; ProofPrice offers it as the tax=without option of the fuel tool" : ""}.
        Whether and how a figure is binding is for your contract and your adviser, not for this page.
      </p>

      <h2>Source, licence and attribution</h2>
      <ul>
        <li>
          <strong>Publisher:</strong> {info.publisher}. <strong>Series:</strong> {info.name}. Original: <a href={info.homepage}>{info.homepage}</a>
        </li>
        <li>
          <strong>Licence:</strong> {info.licence}{" "}
          {info.licence_url ? (
            <>
              (<a href={info.licence_url}>licence terms</a>)
            </>
          ) : null}
        </li>
        <li>
          <strong>Attribution:</strong> {info.attribution}
        </li>
        <li>
          <strong>Limits:</strong> {info.limits}
        </li>
        <li>
          <strong>How fresh:</strong> {info.freshness}. Newest day in our library for this source: {p.libraryDay ? longDate(p.libraryDay) : "unknown"}.
        </li>
      </ul>

      {p.outside ? (
        <p>
          <strong>Outside check:</strong> on {longDate(p.outside.checkedAt)} {p.outside.what} was compared with the publisher&apos;s own headline figure for{" "}
          {longDate(p.outside.theirPeriod)} (the figure on this page): {p.outside.verdict}, a gap of {p.outside.gapPct > 0 ? "+" : ""}
          {p.outside.gapPct}%. The check is a tripwire for errors, not a certificate.
        </p>
      ) : null}

      <h2>Content hash</h2>
      <p>
        SHA-256 of the figures on this page (the weekly and monthly tables above): <code>{p.hash}</code>
      </p>
      <p className="muted small">
        To check it, save the text below exactly as shown (UTF-8, one line per figure, a line feed after every line, none after the last) and run{" "}
        <code>sha256sum file.txt</code>. If the hash differs, the figures differ. The hash covers the figures, not the wording of this page.
      </p>
      <details>
        <summary>The exact text that is hashed</summary>
        <pre>{p.canonical}</pre>
      </details>

      <p className="muted small">
        Ask for the latest figure live: <a href={rest} rel="nofollow">{rest}</a>. Questions or corrections: {CONTACT}. See also the <a href="/method">method</a> and{" "}
        <a href="/terms">terms</a>.
      </p>
    </main>
  );
}
