// The outside check runner. Runs on GitHub Actions (.github/workflows/crosscheck.yml), never in the app.
// For every source whose manifest has a crossCheck: read the publisher's headline figures (one plain GET per file, honest user agent,
// retried on network errors and 5xx), read our figure (live API with ppcheck=1, or our library roll-up), and write one row per area
// and release to library/_crosscheck/<source>.csv (AGREES / EXPLAINED / SUSPECT), plus library/_crosscheck/meta.json.
// The Quality Auditor reads only the rows that are not AGREES, and meta.json last_error.
//
// Usage: npm run crosscheck                     (all sources with a crossCheck)
//        npm run crosscheck -- es-fuel ie-ppr   (only these)
//        npm run crosscheck -- --dry-run        (write nothing; print the rows; used on branches)
// Exit code: non-zero only when the runner crashes, or a source's publisher file has now failed FAIL_AFTER_RUNS runs in a row
// (one email per broken link, not one a week). SUSPECT rows never fail the run: they are data for the Auditor.

import { SOURCE_PLUGINS, categoryById } from "../lib/registry";
import { CROSSCHECK_USER_AGENT, FAIL_AFTER_RUNS, nextMeta, runSourceCheck } from "../lib/crosscheck";
import type { CrossCheckContext, SourcePlugin } from "../lib/plugin";
import type { PriceAnswer } from "../lib/answer";
import {
  appendCrossCheck, CrossCheckRow, libraryDates, readCrossCheck, readCrossCheckMeta, readRowsOnDates, writeCrossCheckMeta,
} from "../lib/library/store";

const API_BASE = process.env.PROOFPRICE_API_BASE || "https://proofprice.com";
const TRIES = 3;
const RETRY_MS = Number(process.env.CROSSCHECK_RETRY_MS ?? 5000);
const TIMEOUT_MS = 180000;

class HttpError extends Error {
  constructor(public status: number, url: string) {
    super(`HTTP ${status} for ${url}`);
  }
}

/** One plain GET, retried on network errors, 429 and 5xx (a flaky upstream is not a failure); other 4xx fail at once. */
async function getOnce(url: string, kind: "text" | "binary"): Promise<string | Buffer> {
  let last: unknown;
  for (let i = 0; i < TRIES; i++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": CROSSCHECK_USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (res.ok) return kind === "text" ? await res.text() : Buffer.from(await res.arrayBuffer());
      last = new HttpError(res.status, url);
      if (res.status < 500 && res.status !== 429) throw last;
    } catch (e) {
      if (e instanceof HttpError && e.status < 500 && e.status !== 429) throw e;
      last = e instanceof HttpError ? e : new Error(`${url}: ${(e as any)?.cause?.code ?? (e as any)?.message ?? e}`);
    }
    if (i < TRIES - 1) await new Promise((r) => setTimeout(r, RETRY_MS * (i + 1) * (i + 1)));
  }
  throw last instanceof Error ? last : new Error(String(last));
}

function makeContext(now: Date): CrossCheckContext {
  const memo = new Map<string, Promise<string | Buffer | null>>();
  const get = (url: string, kind: "text" | "binary", opts: { optional?: boolean } = {}) => {
    if (!/^https:\/\//.test(url)) return Promise.reject(new Error(`Only https links: ${url}`));
    const key = `${kind} ${url}`;
    if (!memo.has(key)) {
      memo.set(
        key,
        getOnce(url, kind).catch((e) => {
          if (opts.optional && e instanceof HttpError && e.status === 404) return null;
          throw e;
        }),
      );
    }
    return memo.get(key)!;
  };
  return { get: get as CrossCheckContext["get"], now };
}

async function askApi(source: SourcePlugin, query: Record<string, string>): Promise<PriceAnswer> {
  const cat = categoryById(source.category)!;
  const qs = new URLSearchParams({ ...query, ppcheck: "1" }); // never counted as a customer (Rule Q0)
  const url = `${API_BASE}/api/v1/${cat.restPath}?${qs}`;
  let last: unknown;
  for (let i = 0; i < TRIES; i++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": CROSSCHECK_USER_AGENT, accept: "application/json" }, signal: AbortSignal.timeout(60000) });
      const body = await res.json().catch(() => null);
      if (res.ok && body) return body as PriceAnswer;
      last = new Error(`HTTP ${res.status} from ${url}${body?.error ? `: ${String(body.error).slice(0, 120)}` : ""}`);
      if (res.status < 500 && res.status !== 429) break;
    } catch (e) {
      last = e;
    }
    if (i < TRIES - 1) await new Promise((r) => setTimeout(r, RETRY_MS * (i + 1)));
  }
  throw last instanceof Error ? last : new Error(String(last));
}

function libraryFor(sourceId: string) {
  const dates = libraryDates(sourceId);
  const recent = dates.slice(-40);
  return { dates, rows: readRowsOnDates(sourceId, recent) };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const only = args.filter((a) => !a.startsWith("-"));
  const targets = SOURCE_PLUGINS.filter((s) => s.crossCheck && (!only.length || only.includes(s.info.id)));
  if (!targets.length) {
    console.log("No source with a crossCheck.");
    return;
  }
  const now = new Date();
  const nowIso = now.toISOString();
  const today = nowIso.slice(0, 10);
  const ctx = makeContext(now);
  const meta = readCrossCheckMeta();
  const report: string[] = [];
  const failing: string[] = [];
  for (const s of targets) {
    const id = s.info.id;
    let result;
    try {
      result = await runSourceCheck(s, { ctx, askApi, library: libraryFor, previous: readCrossCheck(id), today });
    } catch (e: any) {
      result = { rows: [] as CrossCheckRow[], fetchError: `runner error: ${String(e?.message ?? e).slice(0, 240)}`, notes: [] };
    }
    const written = dryRun ? 0 : appendCrossCheck(id, result.rows);
    const { meta: m, failRun } = nextMeta(meta[id], id, nowIso, result, written);
    meta[id] = m;
    if (failRun) failing.push(`${id}: ${result.fetchError}`);
    if (result.fetchError) report.push(`ERROR  ${id}: ${result.fetchError}`);
    for (const r of result.rows) {
      report.push(
        `${r.verdict.padEnd(9)} ${id} | ${r.area} | ours ${r.our_value} (${r.our_period}${r.our_n ? `, n ${r.our_n}` : ""}) | theirs ${r.their_value} (${r.their_period}${r.their_n ? `, n ${r.their_n}` : ""}) | gap ${r.gap_pct}%${r.reason ? ` | ${r.reason}` : ""}`,
      );
    }
    for (const n of result.notes) report.push(`NOTE   ${id}: ${n}`);
    if (!dryRun) report.push(`       ${id}: ${written} new row(s) written`);
  }
  if (!dryRun) writeCrossCheckMeta(meta);
  console.log(report.join("\n"));
  if (failing.length) {
    console.error(`The publisher file of ${failing.length} source(s) has failed ${FAIL_AFTER_RUNS} runs in a row:\n${failing.join("\n")}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
