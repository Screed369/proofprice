// Small helpers for reading official statistics published on GOV.UK: the content API (https://www.gov.uk/api/content/<path>)
// lists a release's attachments, and the files themselves sit on assets.publishing.service.gov.uk. Used from harvest() and
// as a live fallback; never per request for a big file. Pure functions are tested; fetch wrappers use lib/http.ts.

import { SourceError, fetchJson } from "./http";

export const GOVUK = "https://www.gov.uk";
const UA = "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)";
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** Page slugs of monthly releases, newest first, starting with the month before `now` (releases come out about a month in arrears).
 *  monthlySlugs("boiler-upgrade-scheme-statistics", new Date("2026-10-15")) = [".../…-september-2026", ".../…-august-2026", ...]. */
export function monthlySlugs(prefix: string, now: Date, count = 5): string[] {
  const out: string[] = [];
  let y = now.getUTCFullYear();
  let m = now.getUTCMonth(); // 0-based; the previous month is m - 1
  for (let i = 0; i < count; i++) {
    m -= 1;
    if (m < 0) { m = 11; y -= 1; }
    out.push(`${prefix}-${MONTHS[m]}-${y}`);
  }
  return out;
}

export interface Attachment { url: string; title: string; filename: string }

/** The Excel (.xlsx) attachments of a GOV.UK content-API record, optionally only those whose title matches. */
export function xlsxAttachments(page: any, titleLike?: RegExp): Attachment[] {
  const list: any[] = page?.details?.attachments ?? [];
  return list
    .filter((a) => typeof a?.url === "string" && /\.xlsx$/i.test(a.url) && (!titleLike || titleLike.test(String(a.title ?? ""))))
    .map((a) => ({ url: a.url as string, title: String(a.title ?? ""), filename: String(a.filename ?? "") }));
}

/** A GOV.UK content-API record by path, e.g. "/government/statistics/solar-pv-cost-data". */
export async function govukContent(path: string): Promise<any> {
  return fetchJson(`${GOVUK}/api/content${path}`, { headers: { "user-agent": UA, accept: "application/json" } }, 30000);
}

/** Download a file (at most `maxBytes`) with a hard timeout. */
export async function downloadFile(url: string, maxBytes = 20_000_000, timeoutMs = 60000): Promise<Buffer> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { "user-agent": UA }, signal: ctl.signal });
    if (!res.ok) throw new SourceError(`The publisher answered ${res.status} for ${new URL(url).host}.`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) throw new SourceError("The file is larger than expected; this source needs updating.");
    return buf;
  } catch (e) {
    if (e instanceof SourceError) throw e;
    throw new SourceError(`Could not download the file from ${new URL(url).host}.`);
  } finally {
    clearTimeout(t);
  }
}
