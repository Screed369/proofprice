import { SOURCES } from "../../lib/sources";

export default function Method() {
  return (
    <main>
      <h1>Method (v0.1)</h1>
      <ul>
        <li>Every answer is a range: the median and the 10th–90th percentile of recorded prices, with the sample size, period and a confidence label.</li>
        <li>Confidence: high = 50+ records, medium = 15–49, low = 5–14. Below 5 records we do not publish a figure.</li>
        <li>Home sales: official transaction records only. England &amp; Wales uses standard-price sales (category A); repossessions and company transfers are excluded.</li>
        <li>France (DVF): only plain sales of exactly one house or apartment are counted; sales that bundle several homes or commercial premises are left out. DVF arrives with a delay of several months, so the period shown is the latest available.</li>
        <li>Aggregates only. We never return individual addresses or personal data for home sales.</li>
        <li>Fuel: the latest pump price each public station reports, for the chosen fuel. Italy: prices in force at 08:00 on the extraction day, self-service unless asked otherwise; prices not updated in 30 days are left out.</li>
        <li>Information, not a valuation or offer.</li>
      </ul>
      <h2>Sources and licences</h2>
      <ul>
        {Object.values(SOURCES).map((s) => (
          <li key={s.id}>
            <strong>{s.name}</strong> ({s.publisher}, {s.country}): {s.licence}. {s.attribution} <em>{s.limits}</em>
          </li>
        ))}
      </ul>
    </main>
  );
}
