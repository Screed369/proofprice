import { Breadcrumbs } from "../_components/Breadcrumbs";
import { pageMetadata } from "../../lib/site/meta";
import snapshot from "../../lib/scoreboard/snapshot-2026-11-24.json";
import resultsFile from "../../lib/scoreboard/results.json";
import { METHOD_STEPS, LIMITS } from "../../lib/scoreboard/method";
import { NEAR_MARGIN } from "../../lib/scoreboard/score";
import { buildScoreboardView } from "../../lib/scoreboard/view";
import type { RecordedRun } from "../../lib/scoreboard/results";
import type { Snapshot } from "../../lib/scoreboard/snapshot";

export const dynamic = "force-static";

export const metadata = pageMetadata({
  title: "How wrong are AI models about real prices?",
  description:
    "A fixed, dated set of nine home-price questions, our typical range for each from official sales records, the scoring rule, and the answers we have recorded. No result is shown that we did not record ourselves.",
  path: "/scoreboard",
});

const nf = (n: number, cur: string) => new Intl.NumberFormat("en-IE", { style: "currency", currency: cur, maximumFractionDigits: 0 }).format(n);

export default function Scoreboard() {
  const view = buildScoreboardView(snapshot as Snapshot, (resultsFile as { runs: RecordedRun[] }).runs);
  return (
    <main>
      <Breadcrumbs items={[{ name: "Home", path: "/" }, { name: "Scoreboard" }]} />
      <h1>How wrong are AI models about real prices?</h1>
      <p className="lede">
        We ask assistants the same plain questions about what homes sold for, and compare each answer with the typical range from official sales
        records. Question set {view.question_set}, answer key frozen on {view.frozen_on}.
      </p>
      {view.no_results_note ? <p><strong>{view.no_results_note}</strong></p> : null}

      <h2>The questions and our typical range</h2>
      <p>
        The range is the 10th to 90th percentile of recorded sales, with the number of records behind it. It is a guide to what is typical, not the
        price of any one home.
      </p>
      <table>
        <thead>
          <tr><th>Question</th><th>Typical range</th><th>Median</th><th>Records</th><th>Data date</th></tr>
        </thead>
        <tbody>
          {view.questions.map(({ question: q, key: k }) => (
            <tr key={q.id}>
              <td>{q.prompt}</td>
              <td>{nf(k.low, k.currency)} to {nf(k.high, k.currency)}</td>
              <td>{nf(k.median, k.currency)}</td>
              <td>{k.n.toLocaleString("en-IE")}</td>
              <td>{k.data_date}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul>
        {view.questions.map(({ question: q }) => (
          <li key={q.id}><strong>{q.id}:</strong> {q.unit_note}</li>
        ))}
      </ul>

      <h2>Results</h2>
      {view.runs.length === 0 ? (
        <p>None yet.</p>
      ) : (
        view.runs.map((r) => (
          <section key={`${r.run.model_id}-${r.run.asked_on}`}>
            <h3>{r.run.model_id} {r.run.model_version}, asked {r.run.asked_on} by {r.run.asked_by}</h3>
            <p>
              Inside our range: {r.tally.inside} of {r.tally.total}. Near: {r.tally.near}. Far: {r.tally.far}. No single price: {r.tally.none}.
            </p>
            <table>
              <thead><tr><th>Question</th><th>Answer</th><th>Against our range</th><th>From our median</th></tr></thead>
              <tbody>
                {r.answers.map((a) => {
                  const key = view.questions.find((q) => q.question.id === a.question_id)!;
                  return (
                    <tr key={a.question_id}>
                      <td>{a.question_id}</td>
                      <td>{a.value === null ? "no single price" : nf(a.value, key.key.currency)}</td>
                      <td>{a.verdict}</td>
                      <td>{a.percent_from_median === null ? "" : `${a.percent_from_median > 0 ? "+" : ""}${a.percent_from_median}%`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <details>
              <summary>Full replies, word for word</summary>
              {r.answers.map((a) => (
                <p key={a.question_id}><strong>{a.question_id}:</strong> {a.reply_text}</p>
              ))}
            </details>
          </section>
        ))
      )}

      <h2>Method</h2>
      <ol>
        {METHOD_STEPS.map((s) => <li key={s}>{s}</li>)}
      </ol>
      <p>Near means within {Math.round(NEAR_MARGIN * 100)}% of the edge of our range.</p>

      <h2>What this does not show</h2>
      <ul>
        {LIMITS.map((s) => <li key={s}>{s}</li>)}
      </ul>

      <h2>Sources and licences</h2>
      <ul>
        {Array.from(new Map(view.questions.map(({ key }) => [key.source, key])).values()).map((k) => (
          <li key={k.source}>{k.attribution} {k.licence}</li>
        ))}
      </ul>
      <p>Information, not a valuation or offer.</p>
    </main>
  );
}
