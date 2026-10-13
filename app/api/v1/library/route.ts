// GET /api/v1/library  What the price library holds: per source, first and last day collected,
// number of days, last collection time and last error. Used by the Monitor worker.
import { libraryStatus } from "../../../../lib/library/store";
import { SOURCE_PLUGINS } from "../../../../lib/registry";
import { json } from "../../../../lib/route-helpers";

export async function GET() {
  const status = libraryStatus();
  const collected = SOURCE_PLUGINS.filter((s) => s.harvest).map((s) => s.info.id);
  return json({
    service: "ProofPrice price library",
    what: "Daily aggregate snapshots (median, 10th–90th percentile, count per area and item) of official price data. Aggregates only.",
    collected_sources: collected,
    sources: status,
    missing: collected.filter((id) => !status.find((m) => m.source === id)),
  });
}
