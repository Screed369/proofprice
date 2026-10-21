// GET /api/v1/usage  Aggregate counts over the last 30 days: real questions apart from handshakes, by day, tool, country asked
// about, status and app (directory checks apart from other apps), distinct anonymous sessions per day, and the top questions we
// could not answer. Closes finished days first (lib/usage.ts). Anonymous counts only. When counting is off it says so.
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
