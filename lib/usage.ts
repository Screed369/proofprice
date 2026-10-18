// Anonymous usage counting. OFF unless a Vercel Blob store is connected to the project: nothing is counted, stored or sent
// unless BLOB_STORE_ID (a connected store, signed in with Vercel's OIDC token) or BLOB_READ_WRITE_TOKEN exists.
// Simon approved counting on 15 Oct 2026; the private store "proofprice-usage" (Dublin) is connected.
//
// What is counted: one tally per day, tool (or REST category), country, a normalised place/item key (lower case, trimmed, at most
// 60 characters; a postcode is cut to its first part), status (ok / insufficient_data / no_matches / unsupported / error) and, when the
// AI app sent it when connecting, the MCP clientInfo.name. Never IP addresses, user agents, prices, free text or any other identifier.
//
// How: tallies are batched in memory and written to Vercel Blob (@vercel/blob, a private store) at most every few minutes, as small
// aggregate JSON files under usage/<day>/. A serverless instance that is frozen before its next flush loses its pending tallies, so
// counts can be a little low; they are never invented. GET /api/v1/usage reads the last 30 days back as totals.

import { randomBytes } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";

export const USAGE_STATUSES = ["ok", "insufficient_data", "no_matches", "unsupported", "error"] as const;
export type UsageStatus = (typeof USAGE_STATUSES)[number];

export interface UsageEvent {
  /** MCP tool name, or the REST category's tool name. */
  tool: string;
  country?: unknown;
  /** Already-normalised place/item key (see usageKey). */
  key?: string | null;
  status: UsageStatus;
  /** MCP clientInfo.name, only if the client sent it. */
  client?: unknown;
  /** True for our own checks (smoke test, monitors, builders): the call is not counted at all. */
  own?: boolean;
}

// ---------- our own checks are not customers ----------

/** MCP client names used by our own checks. A call from one of these is simply not counted. */
export const OWN_CLIENTS = ["proofprice-smoke", "proofprice-check"] as const;
/** The smoke test's user agent starts with this. It is only compared, never stored or counted. */
export const OWN_UA_PREFIX = "proofprice-smoke/";
/** REST: add ppcheck=1 to a request and it is not counted. */
export const OWN_QUERY_PARAM = "ppcheck";

export function isOwnClient(name: unknown): boolean {
  const n = String(name ?? "").toLowerCase().trim();
  return (OWN_CLIENTS as readonly string[]).includes(n);
}

const truthy = (v: unknown) => v === true || v === 1 || /^(1|true|yes)$/i.test(String(v ?? "").trim());

/** True when a request says it is one of our own checks: ppcheck=1, or the smoke test's user agent. Nothing is kept: the answer is a
 *  yes or no used only to skip the count. */
export function isOwnRequest(req: Request): boolean {
  try {
    if (truthy(new URL(req.url).searchParams.get(OWN_QUERY_PARAM))) return true;
    return (req.headers.get("user-agent") ?? "").toLowerCase().startsWith(OWN_UA_PREFIX);
  } catch {
    return false;
  }
}

/** The query without ppcheck, so the marker never reaches a source or a cache key inside the answer. */
export function withoutOwnParam(q: URLSearchParams): URLSearchParams {
  const out = new URLSearchParams();
  for (const [k, v] of q.entries()) if (k !== OWN_QUERY_PARAM) out.append(k, v);
  return out;
}

/** Per-request flag for MCP calls: set when the request turns out to come from one of our own checks. */
const ownStore = new AsyncLocalStorage<{ own: boolean }>();
export function runWithOwnFlag<T>(fn: (flag: { own: boolean }) => T): T {
  const flag = { own: false };
  return ownStore.run(flag, () => fn(flag));
}

export interface UsageRow {
  day: string;
  tool: string;
  country: string;
  key: string;
  status: UsageStatus;
  client: string;
  count: number;
}

export interface UsageFile {
  version: 1;
  flushed_at: string;
  rows: UsageRow[];
}

/** Flush at most this often (milliseconds). */
export const FLUSH_MS = 5 * 60 * 1000;
/** Most distinct tallies held in memory between flushes; further new tallies are dropped (counts only ever fall short, never grow). */
export const MAX_PENDING = 5000;
export const KEY_MAX = 60;
export const BLOB_PREFIX = "usage/";

type Env = Record<string, string | undefined>;

/** Counting is on only when a Blob store is connected (BLOB_STORE_ID, used with Vercel's OIDC sign-in) or a Blob read-write token
 * exists. Checked on every call, so disconnecting the store (and redeploying) switches it off. */
export function usageEnabled(env: Env = process.env): boolean {
  const has = (v: string | undefined) => Boolean(v && v.trim());
  return has(env.BLOB_STORE_ID) || has(env.BLOB_READ_WRITE_TOKEN);
}

// ---------- normalising what is counted ----------

const PLACE_KEYS = ["town", "postcode_district", "postcode", "area", "region", "county", "department", "state", "province", "city", "commune"];
const ITEM_KEYS = ["property_type", "house_type", "bedrooms", "fuel", "medicine", "product", "energy", "service", "land_type", "consumption_band"];

function clean(v: unknown): string {
  return String(v ?? "").toLowerCase().replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
}

/** The place and item a question was about, as one short lower-case key. Free text and numbers such as prices are never part of it. */
export function usageKey(params: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const k of [...PLACE_KEYS, ...ITEM_KEYS]) {
    let v = clean(params[k]);
    if (!v || v === "any") continue;
    if (k === "postcode") v = v.split(" ")[0].slice(0, 4); // outward part only: a neighbourhood, never a street
    parts.push(v);
  }
  return parts.join(" / ").slice(0, KEY_MAX).trim();
}

export function usageCountry(v: unknown): string {
  const s = clean(v).toUpperCase();
  return /^[A-Z]{2}$/.test(s) ? s : "";
}

export function usageClient(v: unknown): string {
  return clean(v).replace(/[^a-z0-9 ._-]/g, "").slice(0, 40).trim();
}

export function statusOfAnswer(answer: { status?: unknown } | null | undefined): UsageStatus {
  const s = String(answer?.status ?? "");
  return (USAGE_STATUSES as readonly string[]).includes(s) ? (s as UsageStatus) : "ok";
}

/** A request for a country or category we do not cover is "unsupported"; any other failure is "error". */
export function statusOfError(e: unknown): UsageStatus {
  const msg = String((e as any)?.message ?? e ?? "");
  return /\bNot yet:|are available for|category is required|Unknown endpoint/i.test(msg) ? "unsupported" : "error";
}

// ---------- the in-memory batch ----------

const pending = new Map<string, UsageRow>();
let lastFlush = Date.now();
let flushing = false;

export type UsageSink = (file: UsageFile, pathname: string) => Promise<void>;

async function blobSink(file: UsageFile, pathname: string): Promise<void> {
  const { put } = await import("@vercel/blob");
  await put(pathname, JSON.stringify(file), { access: "private", contentType: "application/json", addRandomSuffix: false, allowOverwrite: false });
}

let sink: UsageSink = blobSink;
/** Tests replace the sink so nothing touches the network. */
export function setUsageSink(s: UsageSink | null): void {
  sink = s ?? blobSink;
}

const dayOf = (d: Date) => d.toISOString().slice(0, 10);

export function recordUsage(ev: UsageEvent, now: Date = new Date(), env: Env = process.env): void {
  if (!usageEnabled(env)) return; // OFF: do nothing at all
  if (ev.own || isOwnClient(ev.client) || ownStore.getStore()?.own) return; // our own checks are skipped, not recorded
  try {
    const row: UsageRow = {
      day: dayOf(now),
      tool: clean(ev.tool).slice(0, 60),
      country: usageCountry(ev.country),
      key: clean(ev.key).slice(0, KEY_MAX),
      status: ev.status,
      client: usageClient(ev.client),
      count: 1,
    };
    const id = JSON.stringify([row.day, row.tool, row.country, row.key, row.status, row.client]);
    const have = pending.get(id);
    if (have) have.count++;
    else if (pending.size < MAX_PENDING) pending.set(id, row);
    if (now.getTime() - lastFlush >= FLUSH_MS) void flushUsage(now, env);
  } catch {
    /* counting must never break an answer */
  }
}

export function pendingUsage(): UsageRow[] {
  return [...pending.values()];
}

export function resetUsage(at: number = Date.now()): void {
  pending.clear();
  lastFlush = at;
  flushing = false;
}

/** Write the pending tallies as one aggregate file. Returns the number of tallies written. Failures keep the tallies for the next try. */
export async function flushUsage(now: Date = new Date(), env: Env = process.env): Promise<number> {
  if (!usageEnabled(env) || flushing || pending.size === 0) {
    lastFlush = now.getTime();
    return 0;
  }
  flushing = true;
  const rows = [...pending.entries()].map(([id, r]) => [id, { ...r }] as [string, UsageRow]); // a snapshot: tallies added during the write are kept
  try {
    const file: UsageFile = { version: 1, flushed_at: now.toISOString(), rows: rows.map(([, r]) => r) };
    const pathname = `${BLOB_PREFIX}${dayOf(now)}/${now.getTime()}-${randomBytes(4).toString("hex")}.json`;
    await sink(file, pathname);
    for (const [id, r] of rows) {
      const cur = pending.get(id);
      if (!cur) continue;
      cur.count -= r.count;
      if (cur.count <= 0) pending.delete(id);
    }
    lastFlush = now.getTime();
    return rows.length;
  } catch (e) {
    console.warn("[usage] flush failed:", String((e as any)?.message ?? e).slice(0, 200));
    lastFlush = now.getTime(); // do not retry on every request
    return 0;
  } finally {
    flushing = false;
  }
}

// ---------- reading it back: GET /api/v1/usage ----------

export interface UsageReport {
  enabled: boolean;
  service: string;
  message?: string;
  period?: { from: string; to: string; days: number };
  /** Everything recorded in the period, including older rows from our own checks that cannot be told apart (see own_checks). */
  total_questions?: number;
  /** Questions from outside: total_questions minus the rows from our own named checks. This is the number to watch. */
  outside_questions?: number;
  own_checks?: { questions: number; clients: string[]; note: string };
  by_day?: { day: string; questions: number; outside_questions: number; answered: number }[];
  by_tool?: { tool: string; questions: number }[];
  by_country?: { country: string; questions: number }[];
  by_status?: Record<string, number>;
  by_client?: { client: string; questions: number }[];
  top_unanswered?: { tool: string; country: string; key: string; status: string; questions: number }[];
  note: string;
}

export const OWN_CHECKS_NOTE =
  "Our own smoke test and monitors are no longer counted. Rows from our own checks that were recorded before this change are shown here, not as outside questions. Older smoke-test tool calls carried no app name, so a few may still sit in the outside number.";

export const USAGE_NOTE =
  "Anonymous aggregate counts only: no IP addresses, user agents or other identifiers are collected. Counts can fall a little short because tallies are batched in memory and written every few minutes.";

const top = <T extends { questions: number }>(a: T[], n: number) => a.sort((x, y) => y.questions - x.questions).slice(0, n);

/** Totals over a set of usage files (pure). */
export function summariseUsage(files: UsageFile[], now: Date = new Date(), days = 30, topN = 20): UsageReport {
  const to = dayOf(now);
  const from = dayOf(new Date(now.getTime() - (days - 1) * 86400000));
  const byDay = new Map<string, { questions: number; outside_questions: number; answered: number }>();
  let ownTotal = 0;
  const ownClients = new Set<string>();
  const byTool = new Map<string, number>();
  const byCountry = new Map<string, number>();
  const byStatus: Record<string, number> = {};
  const byClient = new Map<string, number>();
  const unanswered = new Map<string, { tool: string; country: string; key: string; status: string; questions: number }>();
  let total = 0;
  const add = (m: Map<string, number>, k: string, n: number) => m.set(k, (m.get(k) ?? 0) + n);
  for (const f of files) {
    for (const r of f.rows ?? []) {
      if (!r || r.day < from || r.day > to || !Number.isFinite(r.count) || r.count <= 0) continue;
      total += r.count;
      const own = isOwnClient(r.client);
      if (own) {
        ownTotal += r.count;
        ownClients.add(r.client);
      }
      const d = byDay.get(r.day) ?? { questions: 0, outside_questions: 0, answered: 0 };
      d.questions += r.count;
      if (!own) d.outside_questions += r.count;
      if (r.status === "ok") d.answered += r.count;
      byDay.set(r.day, d);
      add(byTool, r.tool, r.count);
      if (r.country) add(byCountry, r.country, r.count);
      byStatus[r.status] = (byStatus[r.status] ?? 0) + r.count;
      if (r.client && !own) add(byClient, r.client, r.count);
      if (r.status !== "ok" && r.status !== "error" && r.tool !== "mcp_initialize") {
        const id = JSON.stringify([r.tool, r.country, r.key, r.status]);
        const u = unanswered.get(id) ?? { tool: r.tool, country: r.country, key: r.key, status: r.status, questions: 0 };
        u.questions += r.count;
        unanswered.set(id, u);
      }
    }
  }
  return {
    enabled: true,
    service: "ProofPrice usage",
    period: { from, to, days },
    total_questions: total,
    outside_questions: total - ownTotal,
    own_checks: { questions: ownTotal, clients: [...ownClients].sort(), note: OWN_CHECKS_NOTE },
    by_day: [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([day, v]) => ({ day, ...v })),
    by_tool: top([...byTool].map(([tool, questions]) => ({ tool, questions })), 50),
    by_country: top([...byCountry].map(([country, questions]) => ({ country, questions })), 50),
    by_status: byStatus,
    by_client: top([...byClient].map(([client, questions]) => ({ client, questions })), 20),
    top_unanswered: top([...unanswered.values()], topN),
    note: USAGE_NOTE,
  };
}

export interface UsageReader {
  /** Pathnames of usage files, newest day first not required. */
  list(): Promise<string[]>;
  read(pathname: string): Promise<UsageFile | null>;
}

export const MAX_FILES_READ = 500;

const blobReader: UsageReader = {
  async list() {
    const { list } = await import("@vercel/blob");
    const out: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix: BLOB_PREFIX, cursor, limit: 1000 });
      out.push(...page.blobs.map((b) => b.pathname));
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor && out.length < 5000);
    return out;
  },
  async read(pathname) {
    const { get } = await import("@vercel/blob");
    const res = await get(pathname, { access: "private" });
    if (!res || res.statusCode !== 200 || !res.stream) return null;
    return (await new Response(res.stream).json()) as UsageFile;
  },
};

/** The report for the last `days` days. When counting is off it says so and reads nothing. */
export async function usageReport(now: Date = new Date(), env: Env = process.env, reader: UsageReader = blobReader, days = 30): Promise<UsageReport> {
  if (!usageEnabled(env)) {
    return { enabled: false, service: "ProofPrice usage", message: "Usage counting is switched off, so there is nothing to report.", note: USAGE_NOTE };
  }
  const from = dayOf(new Date(now.getTime() - (days - 1) * 86400000));
  const names = (await reader.list())
    .filter((p) => /^usage\/\d{4}-\d{2}-\d{2}\//.test(p) && p.slice(6, 16) >= from)
    .sort()
    .reverse()
    .slice(0, MAX_FILES_READ);
  const files: UsageFile[] = [];
  for (let i = 0; i < names.length; i += 8) {
    const got = await Promise.all(names.slice(i, i + 8).map((n) => reader.read(n).catch(() => null)));
    for (const f of got) if (f && Array.isArray(f.rows)) files.push(f);
  }
  return summariseUsage(files, now, days);
}
