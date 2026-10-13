import { SOURCE_PLUGINS } from "../../lib/registry";

export default function Method() {
  return (
    <main>
      <h1>Method (v0.3)</h1>
      <ul>
        <li>Every answer is a range: the median and the 10th–90th percentile of recorded prices, with the sample size, period and a confidence label.</li>
        <li>Confidence: high = 50+ records, medium = 15–49, low = 5–14. Below 5 records we do not publish a figure.</li>
        <li>Home sales: official transaction records only. Aggregates only: we never return individual addresses or personal data for home sales.</li>
        <li>Fuel: the latest pump price each public station reports, for the chosen fuel.</li>
        <li>
          Price library: once a day we take a snapshot of each live source and keep, for each area and item, the median, 10th–90th percentile and count.
          That is what the history endpoints show. Only aggregates are stored.
        </li>
        {SOURCE_PLUGINS.filter((s) => s.method).map((s) => (
          <li key={s.info.id}>{s.method}</li>
        ))}
        <li>Information, not a valuation or offer.</li>
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
