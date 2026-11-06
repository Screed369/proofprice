// GET /api/v1/library  What the price library holds: per source, first and last day collected,
// number of days, last collection time, last error and failing_days (whole days since the last good run, null when healthy). Used by the Monitor worker.
import { failingDays, libraryStatus } from "../../../../lib/library/store";
import { SOURCE_PLUGINS } from "../../../../lib/registry";
import { json } from "../../../../lib/route-helpers";

export async function GET() {
  // Only sources that are registered now: a source taken offline (manifest.offline.ts) keeps its old library folder until the
  // collector tidies it, but it is no longer collected, so its last error or age must not show up in the Monitor.
  // A source that is registered but no longer has a harvest() (live answers only, e.g. ro-opcom-power since 4 Nov) also leaves
  // the report: its old folder holds a frozen error that the collector will never clear.
  const collected = SOURCE_PLUGINS.filter((s) => s.harvest).map((s) => s.info.id);
  const harvested = new Set(collected);
  const status = libraryStatus().filter((m) => harvested.has(m.source));
  return json({
    service: "ProofPrice price library",
    what: "Daily aggregate snapshots (median, 10th–90th percentile, count per area and item) of official price data. Aggregates only.",
    collected_sources: collected,
    sources: status.map((m) => ({ ...m, failing_days: failingDays(m) })),
    missing: collected.filter((id) => !status.find((m) => m.source === id)),
  });
}
