import { Breadcrumbs } from "../_components/Breadcrumbs";
import { CONTACT } from "../../lib/site/constants";
import { pageMetadata } from "../../lib/site/meta";
import { sourceCards } from "../../lib/site/sources";
import { MIN_PUBLISH } from "../../lib/stats";

export const dynamic = "force-static";

export const metadata = pageMetadata({
  title: "How ProofPrice earns trust",
  description:
    "Official sources only, a source and licence on every answer, aggregates only and no range worked out from fewer than 5 records, asking prices never shown as paid prices, and how each source is checked before and after it goes live.",
  path: "/trust",
});

export default function Trust() {
  const cards = sourceCards();
  const collected = cards.filter((c) => c.collected).length;
  return (
    <main>
      <Breadcrumbs items={[{ name: "Home", path: "/" }, { name: "Trust" }]} />
      <h1>How ProofPrice earns trust</h1>
      <p className="lede">
        A price is only useful if you can check where it came from. These are the rules we keep, and how we check that we keep them.
      </p>

      <h2>Official and licensed sources only</h2>
      <p>
        Every figure comes from official open data, licensed data, partner data or (later) verified receipts. Today that is{" "}
        {cards.length} official sources, each listed with its publisher, licence and limits on <a href="/sources">/sources</a>. We do not
        scrape sites in breach of their terms. Where a publisher&apos;s licence wording is still being confirmed, the licence line on{" "}
        <a href="/sources">/sources</a> says so.
      </p>

      <h2>What every answer carries</h2>
      <ul>
        <li>
          <strong>Source and licence:</strong> the publisher, a link to the licence and the attribution line to show when you reuse the figure.
        </li>
        <li>
          <strong>Sample size:</strong> how many records the figure is built from. A published official average or median (the price type
          &ldquo;official statistic&rdquo;, for example a household energy price from a statistics office) is the publisher&apos;s own figure,
          passed on as published. It carries a sample size only where the publisher gives one; otherwise the sample size is empty.
        </li>
        <li>
          <strong>Period:</strong> the dates the records cover. For an official statistic, also the reference period the publisher states.
        </li>
        <li>
          <strong>Confidence:</strong> for a figure we work out from records, high is 50 or more records, medium is 15 to 49, low is{" "}
          {MIN_PUBLISH} to 14. A published official average or median is marked high because it is the publisher&apos;s own figure for its
          stated period. That mark is not a count of records, and an official statistic comes without a range.
        </li>
        <li>
          <strong>Method:</strong> a plain description of how the median and the typical range (10th to 90th percentile) were worked out, or,
          for an official statistic, which figure the publisher published. See <a href="/method">/method</a>.
        </li>
        <li>
          <strong>Price type:</strong> whether the figure is a recorded sale price, a posted price, a contract or reimbursement price, or a
          published official average or median.
        </li>
      </ul>

      <h2>Aggregates only, and never a thin figure</h2>
      <p>
        We publish ranges, not individual records. For home sales we never return an address or any personal data. We never publish a figure
        that we work out from fewer than {MIN_PUBLISH} records: below that, the answer says there is not enough data. A published official
        average or median is different: it is the publisher&apos;s own figure, passed on as published with its reference period, and we do not
        count records for it. See the <a href="/privacy">privacy notice</a>.
      </p>

      <h2>Asking prices are never shown as paid prices</h2>
      <p>
        Home figures are recorded sale prices. Fuel figures are posted pump prices, and they are labelled that way, because they are what each
        station displays, not a receipt. A listing or asking price is never presented as something people paid.
      </p>

      <h2>How a source is checked before it goes live</h2>
      <ol>
        <li>
          <strong>Found.</strong> We identify the official publisher and the dataset.
        </li>
        <li>
          <strong>Licence checked.</strong> We record the licence, its link and the attribution line, and what the data may and may not be used
          for.
        </li>
        <li>
          <strong>Real format proven from a server.</strong> We fetch the real file or feed from a server and build the reader against what it
          actually returns, not against its documentation.
        </li>
        <li>
          <strong>Tests.</strong> Automated tests run against a sample copied from the real format.
        </li>
        <li>
          <strong>Preview checks.</strong> The source is tried on a private preview deployment before it reaches the public site.
        </li>
        <li>
          <strong>Production smoke tests.</strong> After release, each source&apos;s example request is run against the live site and must
          return a valid answer.
        </li>
      </ol>
      <p>
        After release, every live source is monitored twice a day. The state of the daily price library is on <a href="/status">/status</a>.
      </p>

      <h2>The daily price library</h2>
      <p>
        Once a day we take a snapshot of each source that supports history ({collected} today) and keep, for each place and item, only the
        median, the 10th to 90th percentile and the count. Days with fewer than {MIN_PUBLISH} records are not kept. The latest figures are
        published as pages you can read at <a href="/prices">/prices</a>.
      </p>

      <h2>Corrections</h2>
      <p>
        If you think a figure is wrong, report a wrong figure to <a href={`mailto:${CONTACT}`}>{CONTACT}</a>. Tell us the request you made and
        what you expected. If the mistake is ours, we correct it. If the official source is wrong, we cannot change the publisher&apos;s data.
        We do not promise a turnaround time.
      </p>

      <h2>Limits</h2>
      <p>
        ProofPrice gives information, not a valuation, quote or offer. Ranges describe past recorded prices. Read the{" "}
        <a href="/terms">terms of use</a> before you rely on a figure for a big decision.
      </p>

      <p>
        See also: <a href="/method">Method</a> · <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/status">Status</a> ·{" "}
        <a href="/sources">Sources</a>
      </p>
    </main>
  );
}
