import { SOURCE_PLUGINS } from "../../lib/registry";
import { SERVICE_VERSION } from "../../lib/site/constants";
import { STALE_MAX_DAYS } from "../../lib/stale";

export default function Method() {
  return (
    <main>
      <h1>Method (v{SERVICE_VERSION})</h1>
      <ul>
        <li>Most answers are a range: the median and the 10th–90th percentile of recorded prices, with the sample size, period and a confidence label. Official statistics (below) are the one exception.</li>
        <li>Confidence: high = 50+ records, medium = 15–49, low = 5–14. Below 5 records we do not publish a figure.</li>
        <li>Home sales: official transaction records only. Aggregates only: we never return individual addresses or personal data for home sales.</li>
        <li>Fuel: the latest pump price each public station reports, for the chosen fuel.</li>
        <li>
          Price library: once a day we take a snapshot of each live source and keep, for each area and item, the median, 10th–90th percentile and count.
          That is what the history endpoints show. Only aggregates are stored.
        </li>
        <li>
          If an official source does not respond (it times out or returns a server error) and our price library holds a snapshot of it from the last{" "}
          {STALE_MAX_DAYS} days for the same area and item, we answer from that copy instead of an error. The answer says so: the notice reads &quot;The
          official source did not respond; this is our copy from &lt;date&gt;&quot;, the snapshot date is in the period, and <code>extra.stale</code> is true.
          Without a recent copy the request fails with an error.
        </li>
        {SOURCE_PLUGINS.filter((s) => s.method).map((s) => (
          <li key={s.info.id}>{s.method}</li>
        ))}
        <li>Information, not a valuation or offer.</li>
      </ul>
      <h2>Official statistics</h2>
      <ul>
        <li>
          Some answers are not built from individual records. They are an official average or median that a statistics office or regulator publishes
          (for example Eurostat&apos;s household electricity and gas prices). We pass on the published figure, its reference period (for example the first
          half of 2026) and its source, and we say whether it is an average or a median.
        </li>
        <li>
          These answers are labelled <code>price_type: &quot;official_statistic&quot;</code>. The publisher gives one figure, not a range, so the range fields are empty,
          and the sample size is empty when the publisher does not say how many records are behind it.
        </li>
        <li>An official statistic is never presented as an individual sale or as an offer from a supplier.</li>
      </ul>
      <h2>Sources and licences</h2>
      <ul>
        {SOURCE_PLUGINS.map(({ info: s }) => (
          <li key={s.id}>
            <strong>{s.name}</strong> ({s.publisher}, {s.country}): {s.licence}. {s.attribution} <em>{s.limits}</em>
          </li>
        ))}
      </ul>
    </main>
  );
}
