// GET /api/v1/usage  Aggregate counts of questions over the last 30 days (by day, tool, country, status, app name) and the top
// questions we could not answer. Anonymous counts only. When counting is off (no BLOB_READ_WRITE_TOKEN) it says so.
import { usageReport } from "../../../../lib/usage";
import { errorResponse, json, corsPreflight } from "../../../../lib/route-helpers";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const report = await usageReport();
    return json(report, 200, report.enabled ? 300 : 60);
  } catch (e) {
    return errorResponse(e);
  }
}

export function OPTIONS() {
  return corsPreflight();
}
