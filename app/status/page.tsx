import { Breadcrumbs } from "../_components/Breadcrumbs";
import { dateTimeUtc, longDate, plural } from "../../lib/site/format";
import { pageMetadata } from "../../lib/site/meta";
import { sourceCards } from "../../lib/site/sources";
import { HEALTH_LABEL, LATE_AFTER_DAYS, libraryStatusRows } from "../../lib/site/status";
import { usageReport } from "../../lib/usage";
import type { UsageReport } from "../../lib/usage";

// Usage counts are read with a short time limit; if they cannot be read (counting off, store slow) the section says so.
async function readUsage(): Promise<UsageReport | null> {
  try {
    return await Promise.race([usageReport(), new Promise<null>((r) => setTimeout(() => r(null), 8000))]);
  } catch {
    return null;
  }
}

// Built without any network access: it reads the price library that ships with the deployment (library/*/meta.json).
export const dynamic = "force-static";
export const revalidate = 3600;

export const metadata = pageMetadata({
  title: "Status of the price library and sources",
  description: "When each source was last collected into the ProofPrice price library, how many days it holds, and any error from the last run.",
  path: "/status",
});

export default async function Status() {
  const now = new Date();
  const usage = await readUsage();
  const cards = sourceCards();
  const rows = libraryStatusRows(cards, now);
  const problems = rows.filter((r) => r.health !== "ok");
  return (
    <main>
      <Breadcrumbs items={[{ name: "Home", path: "/" }, { name: "Status" }]} />
      <h1>Status</h1>
      <p className="lede">
        Freshness and health of the price library, source by source. Page generated {dateTimeUtc(now.toISOString())}; it refreshes about once an
        hour.
      </p>
      <p>
        {problems.length === 0 ? (
          <span className="chip ok">All {plural(rows.length, "library source")} collected with no error</span>
        ) : (
          <span className="chip late">
            {plural(problems.length, "library source")} to check: {problems.map((p) => p.id).join(", ")}
          </span>
        )}
      </p>

      <h2>Price library</h2>
      <p>
        Once a day we snapshot each source below. A source is <strong>OK</strong> when its last collection finished without an error and no more
        than {LATE_AFTER_DAYS} days ago, <strong>Late</strong> when it is older, and <strong>Error</strong> when the last run reported one.
        The last error reads &quot;None&quot; when the last run was clean.
      </p>
      <div className="table-wrap">
        <table>
          <caption>Price library, from library/&lt;source&gt;/meta.json</caption>
          <thead>
            <tr>
              <th>Source</th>
              <th>Status</th>
              <th>Newest figures</th>
              <th className="num">Days collected</th>
              <th>Last collection</th>
              <th>Last error</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <a href={`/sources#${r.id}`}>{r.id}</a>
                  <br />
                  <span className="muted small">{r.countryNames.join(", ")}</span>
                </td>
                <td>
                  <span className={`chip ${r.health}`}>{HEALTH_LABEL[r.health]}</span>
                </td>
                <td>{r.lastDate ? longDate(r.lastDate) : "none yet"}</td>
                <td className="num">{r.daysCollected}</td>
                <td>
                  {dateTimeUtc(r.lastHarvestAt)}
                  {r.ageDays !== null && (
                    <>
                      <br />
                      <span className="muted small">
                        last success {r.ageDays === 0 ? "today" : `${plural(r.ageDays, "day")} ago`}
                      </span>
                    </>
                  )}
                </td>
                <td>{r.lastError ?? "None"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.some((r) => r.note) && (
        <ul className="small muted">
          {rows
            .filter((r) => r.note)
            .map((r) => (
              <li key={r.id}>
                <strong>{r.id}:</strong> {r.note}
              </li>
            ))}
        </ul>
      )}
      <p className="small muted">
        Home sale registers publish with a delay, so &quot;newest figures&quot; can be older than the last collection. Machine-readable:{" "}
        <a href="/api/v1/library">/api/v1/library</a>.
      </p>

      <h2>Questions asked</h2>
      {usage && usage.enabled && usage.period ? (
        <>
          <p>
            In the last {usage.period.days} days ProofPrice was asked <strong>{usage.outside_questions ?? 0}</strong> questions from outside.
            Our own checks (the smoke test and the monitors) are not counted as customers
            {usage.own_checks && usage.own_checks.questions > 0
              ? `; ${usage.own_checks.questions} older rows from our own named checks are kept apart.`
              : "."}
          </p>
          <p className="small muted">
            Anonymous counts only: no IP addresses, user agents or other identifiers. Machine-readable: <a href="/api/v1/usage">/api/v1/usage</a>.
          </p>
        </>
      ) : (
        <p className="muted">Question counts are not available right now. They are anonymous, and our own checks are never counted. See <a href="/api/v1/usage">/api/v1/usage</a>.</p>
      )}

      <h2>Live sources</h2>
      <p>
        Every source on the coverage list, how it is served, and a request you can run yourself. Sources without a daily library are asked
        live each time a question arrives, so there is nothing to age. Each source&apos;s example request is checked against the live site
        after every release and monitored twice a day (see <a href="/trust">how we earn trust</a>).
      </p>
      <div className="table-wrap">
        <table>
          <caption>
            All {cards.length} sources from the coverage list
          </caption>
          <thead>
            <tr>
              <th>Source</th>
              <th>Country</th>
              <th>Release status</th>
              <th>How it is served</th>
              <th>Try it</th>
            </tr>
          </thead>
          <tbody>
            {cards.map((c) => (
              <tr key={c.id}>
                <td>
                  <a href={`/sources#${c.id}`}>{c.id}</a>
                </td>
                <td>{c.countryNames.join(", ")}</td>
                <td>
                  <span className={`chip ${c.status === "live" ? "ok" : "neutral"}`}>{c.status === "live" ? "Live" : "Beta"}</span>
                </td>
                <td>{c.collected ? "Live, plus daily library" : "Live from the publisher"}</td>
                <td>{c.exampleRest ? <a href={c.exampleRest}>example request</a> : "n/a"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
