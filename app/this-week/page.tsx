import { Breadcrumbs } from "../_components/Breadcrumbs";
import { JsonLd } from "../_components/JsonLd";
import { breadcrumbGraph } from "../../lib/site/jsonld";
import { int, longDate, plural, shortDate } from "../../lib/site/format";
import { pageMetadata } from "../../lib/site/meta";
import { loadThisWeek, priceText } from "../../lib/site/this-week";

export const dynamic = "force-static";

export const metadata = pageMetadata({
  title: "What people paid this week",
  description:
    "The biggest week-on-week moves in fuel, energy and home prices, worked out each day from the ProofPrice price library. Every figure says whether it is a real sale, an official statistic or a posted price, with its source and licence.",
  path: "/this-week",
});

export default function ThisWeek() {
  const t = loadThisWeek();
  const any = t.groups.some((g) => g.moves.length > 0);
  return (
    <main>
      <JsonLd data={breadcrumbGraph([{ name: "Home", path: "/" }, { name: "This week", path: "/this-week" }])} />
      <Breadcrumbs items={[{ name: "Home", path: "/" }, { name: "This week" }]} />
      <h1>What people paid this week</h1>
      <p className="lede">
        The biggest moves in fuel, energy and home prices, worked out from the ProofPrice price library: the newest day we hold against the day about a
        week earlier. Whole-country figures only. Rebuilt each day{t.asOf ? `; newest figure here is from ${longDate(t.asOf)}` : ""}.
      </p>
      <p className="muted small">
        Each line says what kind of figure it is. A <strong>real sale</strong> comes from an official record of completed sales. An{" "}
        <strong>official statistic</strong> is an average or median published by a statistics office or regulator. A <strong>posted price</strong> is
        what a station or seller displays; it is not a receipt. Asking prices are never used. How we work out each number is on{" "}
        <a href="/method">/method</a>.
      </p>

      {!any && (
        <p>
          There is not yet enough history in the library to compare two days about a week apart. This page fills in on its own as the daily collector
          adds days.
        </p>
      )}

      {t.groups.map((g) => (
        <section key={g.spec.id}>
          <h2>{g.spec.title}</h2>
          <p className="muted">{g.spec.intro}</p>
          {g.moves.length === 0 ? (
            <p>
              No comparison to show yet.{" "}
              {g.sourcesCompared === 0
                ? "No source in this group has two days about a week apart in the library."
                : `${plural(g.sourcesCompared, "source")} compared, none with a change in a figure backed by at least 5 records.`}
            </p>
          ) : (
            <ul>
              {g.moves.map((m) => (
                <li key={`${m.sourceId}:${m.itemName}`}>
                  <strong>
                    {m.placeName}, {m.itemName}: {m.pct > 0 ? "up" : "down"} {Math.abs(m.pct)}%
                  </strong>
                  <br />
                  {priceText(m.baseMedian, m.currency)} on {shortDate(m.baseDate)} → {priceText(m.latestMedian, m.currency)} on {shortDate(m.latestDate)}{" "}
                  ({m.unit}).{" "}
                  {m.countsRecords
                    ? `Median of ${int(m.baseN)} ${m.baseN === 1 ? "record" : "records"} then and ${int(m.latestN)} ${m.latestN === 1 ? "record" : "records"} now.`
                    : "Published average, not worked out from records we hold."}
                  <br />
                  <span className="muted small">
                    {m.kind}. Source: {m.sourceName} ({m.publisher}), licence{" "}
                    <a href={m.licenceUrl}>{m.licenceShort}</a>. {m.attribution}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}

      <h2>Use it</h2>
      <p>
        Ask for any of these figures yourself, free and with no key, through the MCP server or REST API: see <a href="/connect">/connect</a>. The full
        list of sources and their licences is on <a href="/sources">/sources</a>, and ready answers by place are on <a href="/prices">/prices</a>.
      </p>
    </main>
  );
}
