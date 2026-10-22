// Anonymous usage counting. OFF unless a Vercel Blob store is connected to the project: nothing is counted, stored or sent
// unless BLOB_STORE_ID (a connected store, signed in with Vercel's OIDC token) or BLOB_READ_WRITE_TOKEN exists.
// Simon approved counting on 15 Oct 2026, and anonymous visitor sessions on 21 Oct 2026. The private store "proofprice-usage"
// (Dublin) is connected.
//
// 1. QUESTION COUNTS. One tally per day, tool (or REST category), country asked about, a normalised place/item key (lower case,
//    trimmed, at most 60 characters; a postcode is cut to its first part), status (ok / insufficient_data / no_matches /
//    unsupported / error) and, when the AI app sent it, the MCP clientInfo.name. "mcp_initialize" rows are connection handshakes,
//    not questions: the report keeps them apart. The country is the country ASKED ABOUT, never where the caller is.
//
// 2. ANONYMOUS SESSIONS (privacy-first, in the style of cookieless analytics such as Plausible). A session is one visitor on one
//    UTC day. To tell visitors apart without knowing who they are:
//    a. Inside the request only, the IP address and user agent are turned into a one-way SHA-256 digest held in memory. The raw IP
//       address and user agent are never stored, logged or written anywhere; the digest itself is never written either.
//    b. Each UTC day has its own random 32-byte salt, created by the first flush of that day and kept in the private Blob store
//       (usage-salt/<day>.json) and in memory. At flush time the in-memory digest is replaced by HMAC-SHA256(day salt, digest), cut to
//       32 hex characters. Only that salted hash goes to the private store, inside the day's small files (usage/<day>/...).
//    c. The app name is not part of the hash (a stateless MCP server only hears it on initialize, so it would split one visitor in
//       two). Instead each hashed session carries only its client group: "directory_checks" (a known directory probe or health
//       checker, by app name or user agent; see DIRECTORY_CHECK_NAMES / DIRECTORY_CHECK_PATTERNS), "crawlers" (a search-engine, AI-
//       training or SEO crawler, or a generic bot, by user agent; see isCrawlerUA), "named_apps" (any other app that sent a name) or
//       "unnamed". Plus its question count, handshake count and tools used. Crawlers are web robots that follow links on our public
//       pages: their hits are not questions, so they are tallied apart (client "web-crawler", reported as crawler_questions) and are
//       not part of real_questions. AI fetchers started by a person ("-User" agents such as ChatGPT-User or Claude-User) are real
//       demand and are not crawlers. As with directory checks, only the yes/no class is kept, never the user agent.
//    d. When a day is closed (at the first flush or report at least CLOSE_GRACE_MS after midnight UTC), its small files are reduced
//       to one summary (usage-daily/<day>.json) holding counts only: distinct sessions; sessions per tool; per client group the
//       sessions, questions, handshakes and top tools; and how many sessions asked 0, 1, 2-5, 6-20 or 21+ questions. The small files
//       (with the hashes) and the day's salt are then deleted, and the in-memory salt is dropped. Without the salt nobody, including
//       us, can link a hash to a visitor or to the same visitor on another day.
//    e. A session seen on several days counts once per day, so the 30-day total is visitor-days, not people.
//
// 3. FULL 30 DAYS. The old report read only the newest 500 small files (about 3 days). Now finished days are compacted into one
//    summary file each, so the 30-day report reads about 30 summaries plus the open day's small files (cap MAX_FILES_READ, newest
//    first; if the cap is ever hit the report says so in coverage.capped). Compaction is idempotent: each summary lists the files it
//    merged, so two instances compacting at once never count a file twice.
//
// Never stored: IP addresses, user agents, unsalted digests, prices, free text or any other identifier.
// How: tallies are batched in memory and written to Vercel Blob (@vercel/blob, a private store) at most every few minutes. A
// serverless instance that is frozen before its next flush loses its pending tallies, so counts can be a little low; they are never
// invented. GET /api/v1/usage reads the last 30 days back as totals. The public privacy notice (app/privacy) describes this.

import { createHash, createHmac, randomBytes } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";

export const USAGE_STATUSES = ["ok", "insufficient_data", "no_matches", "unsupported", "error"] as const;
export type UsageStatus = (typeof USAGE_STATUSES)[number];

/** Opaque visitor digest for one request. `pre` lives in memory only and is salted before anything is written. */
export interface Visitor {
  pre: string;
  /** True when the user agent looks like a directory probe or health checker. Only this yes/no is kept, never the user agent. */
  probe: boolean;
  /** True when the user agent is a search/AI/SEO crawler or generic bot (isCrawlerUA). Only this yes/no is kept, never the user agent. */
  crawler?: boolean;
}

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
  /** The request's visitor digest (visitorOf). Omitted: taken from the MCP request context, if any. null: no session. */
  visitor?: Visitor | null;
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

// ---------- directory probes and health checkers ----------

/** App names of known MCP directories, probes and health checkers. They test that the server answers; they are not customers. */
export const DIRECTORY_CHECK_NAMES = [
  "glama",
  "smithery-probe",
  "mcpindex-trust",
  "agentrank-probe",
  "rokmcp-probe",
  "wellknown-prober",
  "toolvetprobe",
  "proofbench-probe",
  "factanker-probe",
  "mcp.market-uptime",
  "mcpbeat",
  "reliability-bureau-spike",
] as const;
/** Any app name (or user agent) matching one of these is also a directory check: *probe*, *prober*, *uptime*, health checkers,
 *  monitors, watchers, scanners, crawlers, bots, observatories, audits, snapshots, inventories, harvesters, collectors, research
 *  scans, "*-trust" scorers and "*-check(s)" checkers. Reviewed against the app names seen on 15-21 Oct 2026. */
export const DIRECTORY_CHECK_PATTERNS: readonly RegExp[] = [
  /probe/, /uptime/, /health/, /monitor/, /watch/, /scanner/, /crawler/, /mcpindex/, /bot$/, /observatory/, /audit/, /snapshot/,
  /inventory/, /harvester/, /collector/, /research/, /[-_ ]trust$/, /[-_ ]checks?$/,
];

export function isDirectoryCheck(name: unknown): boolean {
  const n = String(name ?? "").toLowerCase().trim();
  if (!n) return false;
  return (DIRECTORY_CHECK_NAMES as readonly string[]).includes(n) || DIRECTORY_CHECK_PATTERNS.some((p) => p.test(n));
}

// ---------- web crawlers (robots that follow links, as opposed to people and apps that ask) ----------

/** Reserved app name written on question rows made by crawlers. Those rows are reported as crawler_questions, not real_questions. */
export const CRAWLER_CLIENT = "web-crawler";
export function isCrawlerClient(name: unknown): boolean {
  return String(name ?? "").toLowerCase().trim() === CRAWLER_CLIENT;
}

/** Known search, AI-training, SEO and social-preview crawlers by name. */
export const CRAWLER_NAMES = [
  "googlebot", "google-extended", "googleother", "adsbot-google", "mediapartners-google", "bingbot", "bingpreview", "msnbot", "gptbot",
  "oai-searchbot", "claudebot", "claude-searchbot", "anthropic-ai", "perplexitybot", "ccbot", "bytespider", "amazonbot", "applebot",
  "ahrefsbot", "semrushbot", "mj12bot", "dotbot", "yandexbot", "baiduspider", "duckduckbot", "petalbot", "facebookexternalhit",
  "facebot", "meta-externalagent", "twitterbot", "linkedinbot", "slackbot", "discordbot", "telegrambot", "ia_archiver",
  "cohere-ai", "diffbot", "youbot", "sogou", "seznambot", "screaming frog", "dataforseobot", "barkrowler", "serpstatbot",
] as const;
/** Generic robot words in a user agent. */
export const CRAWLER_PATTERN = /bot|crawler|spider|slurp/i;
/** AI fetchers that run because a person asked (ChatGPT-User, Claude-User, Perplexity-User, MistralAI-User, DuckAssistBot, ...). They
 *  are real demand, so they are never crawlers even when a generic pattern would match. */
export const USER_INITIATED_PATTERN = /[-_ ]user\b|duckassistbot|meta-externalfetcher|gemini-deep-research|google-agent/i;

/** True when a user agent is a known search/AI/SEO crawler or a generic bot. Used only for a yes/no; the user agent is never kept. */
export function isCrawlerUA(ua: unknown): boolean {
  const u = String(ua ?? "").toLowerCase().trim();
  if (!u) return false;
  if (USER_INITIATED_PATTERN.test(u)) return false;
  return (CRAWLER_NAMES as readonly string[]).some((n) => u.includes(n)) || CRAWLER_PATTERN.test(u);
}

/** Rows for these tools are connection handshakes, not questions. */
export const HANDSHAKE_TOOLS = ["mcp_initialize"] as const;
export function isHandshake(tool: string): boolean {
  return (HANDSHAKE_TOOLS as readonly string[]).includes(tool) || /^mcp_/.test(tool);
}

// ---------- the visitor digest (request time, memory only) ----------

/** The caller's IP address as Vercel passes it. Used only to compute the in-memory digest below; never kept. */
function ipOf(req: Request): string {
  const h = req.headers;
  const v = h.get("x-vercel-forwarded-for") ?? h.get("x-forwarded-for") ?? h.get("x-real-ip") ?? "";
  return v.split(",")[0].trim();
}

/** One-way digest of the request's IP address and user agent, for counting distinct visitors per day. It is held in memory only and
 *  salted with the day's random salt before anything is written. Returns null when the request carries neither. */
export function visitorOf(req: Request): Visitor | null {
  try {
    const ip = ipOf(req);
    const ua = (req.headers.get("user-agent") ?? "").trim();
    if (!ip && !ua) return null;
    const pre = createHash("sha256").update(`proofprice-visitor\n${ip}\n${ua}`).digest("hex");
    // a health checker or monitor (UptimeRobot, ...) stays a directory check; any other crawler or bot is a crawler
    const crawler = isCrawlerUA(ua) && !/uptime|health|monitor|probe/i.test(ua);
    return { pre, probe: !crawler && isDirectoryCheck(ua), crawler };
  } catch {
    return null;
  }
}

/** Per-request context for MCP calls: set by withInitializeCount (lib/mcp-tools.ts) and read when a tool call finishes. */
export interface UsageContext {
  own: boolean;
  visitor?: Visitor | null;
  /** The app name, if this request carried one (initialize, or clientInfo in _meta). */
  client?: string;
}
const ownStore = new AsyncLocalStorage<UsageContext>();
export function runWithOwnFlag<T>(fn: (flag: UsageContext) => T): T {
  const flag: UsageContext = { own: false };
  return ownStore.run(flag, () => fn(flag));
}

// ---------- stored shapes ----------

export interface UsageRow {
  day: string;
  tool: string;
  country: string;
  key: string;
  status: UsageStatus;
  client: string;
  count: number;
}

export const CLIENT_GROUPS = ["directory_checks", "crawlers", "named_apps", "unnamed"] as const;
export type ClientGroup = (typeof CLIENT_GROUPS)[number];

/** One hashed session in a small file of an open day. `h` is HMAC-SHA256(day salt, digest), 32 hex characters. */
export interface SessionRecord {
  h: string;
  g: ClientGroup;
  /** questions (real tool calls) */
  q: number;
  /** handshakes */
  hs: number;
  /** questions per tool */
  tools: Record<string, number>;
}

export interface UsageFile {
  version: 1 | 2;
  flushed_at: string;
  day?: string;
  rows: UsageRow[];
  sessions?: SessionRecord[];
}

export const SESSION_BUCKETS = ["0", "1", "2-5", "6-20", "21+"] as const;
export type SessionBucket = (typeof SESSION_BUCKETS)[number];

export interface GroupStats {
  sessions: number;
  questions: number;
  handshakes: number;
  tools: Record<string, { sessions: number; questions: number }>;
}

/** Counts only: what is left of a day's sessions once the day is closed. */
export interface DaySessions {
  total: number;
  by_group: Record<ClientGroup, GroupStats>;
  questions_per_session: Record<SessionBucket, number>;
  /** distinct sessions per tool */
  by_tool: Record<string, number>;
}

export interface DailySummary {
  version: 2;
  day: string;
  compacted_at: string;
  /** Small files already merged into this summary (so a file is never counted twice). */
  merged: string[];
  rows: UsageRow[];
  /** null when the day was recorded before sessions were counted, or its hashes could not be read. */
  sessions: DaySessions | null;
}

/** Flush at most this often (milliseconds). */
export const FLUSH_MS = 5 * 60 * 1000;
/** Most distinct tallies held in memory between flushes; further new tallies are dropped (counts only ever fall short, never grow). */
export const MAX_PENDING = 5000;
export const MAX_PENDING_SESSIONS = 5000;
export const KEY_MAX = 60;
export const BLOB_PREFIX = "usage/";
export const DAILY_PREFIX = "usage-daily/";
export const SALT_PREFIX = "usage-salt/";
/** A day is closed this long after its midnight UTC: late flushes from other instances get this long to arrive. */
export const CLOSE_GRACE_MS = 60 * 60 * 1000;
/** A flush checks for days to close at most this often per instance. */
export const COMPACT_EVERY_MS = 30 * 60 * 1000;
/** Most small files the report reads (newest first). After compaction this is normally the open day or two only. */
export const MAX_FILES_READ = 3000;

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

export function sessionBucket(questions: number): SessionBucket {
  if (questions <= 0) return "0";
  if (questions === 1) return "1";
  if (questions <= 5) return "2-5";
  if (questions <= 20) return "6-20";
  return "21+";
}

const GROUP_RANK: Record<ClientGroup, number> = { crawlers: 3, directory_checks: 2, named_apps: 1, unnamed: 0 };
const strongerGroup = (a: ClientGroup, b: ClientGroup): ClientGroup => (GROUP_RANK[a] >= GROUP_RANK[b] ? a : b);
function groupOf(client: string, probe: boolean, crawler = false): ClientGroup {
  if (crawler || isCrawlerClient(client)) return "crawlers";
  if (probe || isDirectoryCheck(client)) return "directory_checks";
  return client ? "named_apps" : "unnamed";
}

// ---------- the store (private Vercel Blob; tests use memoryStore) ----------

export interface UsageStore {
  /** Pathnames under a prefix. */
  list(prefix: string): Promise<string[]>;
  read<T = unknown>(pathname: string): Promise<T | null>;
  /** overwrite false: fail if the pathname already exists. */
  write(pathname: string, data: unknown, overwrite: boolean): Promise<void>;
  del(pathnames: string[]): Promise<void>;
}

export const blobStore: UsageStore = {
  async list(prefix) {
    const { list } = await import("@vercel/blob");
    const out: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix, cursor, limit: 1000 });
      out.push(...page.blobs.map((b) => b.pathname));
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor && out.length < 50000);
    return out;
  },
  async read(pathname) {
    const { get } = await import("@vercel/blob");
    const res = await get(pathname, { access: "private" });
    if (!res || res.statusCode !== 200 || !res.stream) return null;
    return (await new Response(res.stream).json()) as any;
  },
  async write(pathname, data, overwrite) {
    const { put } = await import("@vercel/blob");
    await put(pathname, JSON.stringify(data), { access: "private", contentType: "application/json", addRandomSuffix: false, allowOverwrite: overwrite });
  },
  async del(pathnames) {
    if (!pathnames.length) return;
    const { del } = await import("@vercel/blob");
    for (let i = 0; i < pathnames.length; i += 100) await del(pathnames.slice(i, i + 100));
  },
};

/** An in-memory store (tests). `writes` keeps every write, in order, so a test can inspect exactly what would have been stored. */
export function memoryStore(): UsageStore & { files: Map<string, string>; writes: { pathname: string; body: string }[] } {
  const files = new Map<string, string>();
  const writes: { pathname: string; body: string }[] = [];
  return {
    files,
    writes,
    async list(prefix) {
      return [...files.keys()].filter((k) => k.startsWith(prefix));
    },
    async read(pathname) {
      const v = files.get(pathname);
      return v === undefined ? null : JSON.parse(v);
    },
    async write(pathname, data, overwrite) {
      if (!overwrite && files.has(pathname)) throw new Error("This blob already exists");
      const body = JSON.stringify(data);
      files.set(pathname, body);
      writes.push({ pathname, body });
    },
    async del(pathnames) {
      for (const p of pathnames) files.delete(p);
    },
  };
}

let store: UsageStore = blobStore;
/** Tests replace the store so nothing touches the network. null puts the Blob store back. */
export function setUsageStore(s: UsageStore | null): void {
  store = s ?? blobStore;
}

export type UsageSink = (file: UsageFile, pathname: string) => Promise<void>;
/** Older test hook: an in-memory store whose usage files are also handed to `s`. */
export function setUsageSink(s: UsageSink | null): void {
  if (!s) return setUsageStore(null);
  const mem = memoryStore();
  setUsageStore({
    ...mem,
    async write(pathname, data, overwrite) {
      if (pathname.startsWith(BLOB_PREFIX)) await s(data as UsageFile, pathname);
      await mem.write(pathname, data, overwrite);
    },
  });
}

// ---------- the in-memory batch ----------

interface PendingSession {
  probe: boolean;
  crawler: boolean;
  client: string;
  q: number;
  hs: number;
  tools: Record<string, number>;
}

const pending = new Map<string, UsageRow>();
/** day -> visitor digest -> tallies. Memory only: digests are salted at flush time and never written as they are. */
const pendingSessions = new Map<string, Map<string, PendingSession>>();
let pendingSessionCount = 0;
let lastFlush = Date.now();
let flushing = false;
let lastCompact = 0;
let compacting = false;
/** day -> salt (hex), memory copy of usage-salt/<day>.json. Dropped once the day is closed. */
const salts = new Map<string, string>();

const dayOf = (d: Date) => d.toISOString().slice(0, 10);
const dayEndMs = (day: string) => Date.parse(`${day}T00:00:00Z`) + 86400000;
const isClosed = (day: string, now: Date) => now.getTime() >= dayEndMs(day) + CLOSE_GRACE_MS;

export function recordUsage(ev: UsageEvent, now: Date = new Date(), env: Env = process.env): void {
  if (!usageEnabled(env)) return; // OFF: do nothing at all
  const ctx = ownStore.getStore();
  if (ev.own || isOwnClient(ev.client) || ctx?.own) return; // our own checks are skipped, not recorded
  try {
    const visitor = ev.visitor !== undefined ? ev.visitor : ctx?.visitor;
    const row: UsageRow = {
      day: dayOf(now),
      tool: clean(ev.tool).slice(0, 60),
      country: usageCountry(ev.country),
      key: clean(ev.key).slice(0, KEY_MAX),
      status: ev.status,
      // a crawler's hits are tallied apart under a reserved name: they are not questions (see crawler_questions)
      client: visitor?.crawler ? CRAWLER_CLIENT : usageClient(ev.client),
      count: 1,
    };
    const id = JSON.stringify([row.day, row.tool, row.country, row.key, row.status, row.client]);
    const have = pending.get(id);
    if (have) have.count++;
    else if (pending.size < MAX_PENDING) pending.set(id, row);

    if (visitor && visitor.pre) {
      let day = pendingSessions.get(row.day);
      if (!day) pendingSessions.set(row.day, (day = new Map()));
      let s = day.get(visitor.pre);
      if (!s && pendingSessionCount < MAX_PENDING_SESSIONS) {
        day.set(visitor.pre, (s = { probe: false, crawler: false, client: "", q: 0, hs: 0, tools: {} }));
        pendingSessionCount++;
      }
      if (s) {
        s.probe ||= visitor.probe;
        s.crawler ||= visitor.crawler === true;
        const name = row.client || usageClient(ctx?.client);
        if (name) {
          if (isDirectoryCheck(name)) s.probe = true;
          s.client ||= name;
        }
        if (isHandshake(row.tool)) s.hs++;
        else {
          s.q++;
          s.tools[row.tool] = (s.tools[row.tool] ?? 0) + 1;
        }
      }
    }
    if (now.getTime() - lastFlush >= FLUSH_MS) void flushUsage(now, env);
  } catch {
    /* counting must never break an answer */
  }
}

export function pendingUsage(): UsageRow[] {
  return [...pending.values()];
}

/** Pending session tallies, without their digests (tests and diagnostics). */
export function pendingSessionsSummary(): { day: string; group: ClientGroup; q: number; hs: number }[] {
  const out: { day: string; group: ClientGroup; q: number; hs: number }[] = [];
  for (const [day, m] of pendingSessions) for (const s of m.values()) out.push({ day, group: groupOf(s.client, s.probe, s.crawler), q: s.q, hs: s.hs });
  return out;
}

export function resetUsage(at: number = Date.now()): void {
  pending.clear();
  pendingSessions.clear();
  pendingSessionCount = 0;
  salts.clear();
  lastFlush = at;
  lastCompact = 0;
  flushing = false;
  compacting = false;
}

/** The day's salt: from memory, else from the store, else (only for the current day) a new random one. Never for a closed day. */
async function saltFor(day: string, now: Date, create: boolean): Promise<string | null> {
  for (const d of [...salts.keys()]) if (isClosed(d, now)) salts.delete(d); // a closed day's salt is forgotten
  if (isClosed(day, now)) return null;
  const have = salts.get(day);
  if (have) return have;
  const path = `${SALT_PREFIX}${day}.json`;
  const read = async () => {
    const f = await store.read<{ salt?: string }>(path).catch(() => null);
    return f && typeof f.salt === "string" && /^[0-9a-f]{64}$/.test(f.salt) ? f.salt : null;
  };
  let salt = await read();
  if (!salt && create) {
    const fresh = randomBytes(32).toString("hex");
    try {
      await store.write(path, { day, salt: fresh, note: "Random salt for counting distinct visitors on this day only. Deleted when the day is closed." }, false);
      salt = fresh;
    } catch {
      salt = await read(); // another instance created it first
    }
  }
  if (salt) salts.set(day, salt);
  return salt;
}

/** HMAC-SHA256(day salt, in-memory digest), cut to 32 hex characters. */
export function saltedHash(salt: string, pre: string): string {
  return createHmac("sha256", Buffer.from(salt, "hex")).update(pre).digest("hex").slice(0, 32);
}

/** Write the pending tallies: one aggregate file per day. Returns the number of tallies written. Failures keep the question tallies
 *  for the next try. Sessions of a day that is already closed are dropped (its salt is gone), so they can only fall short. */
export async function flushUsage(now: Date = new Date(), env: Env = process.env): Promise<number> {
  if (!usageEnabled(env) || flushing || (pending.size === 0 && pendingSessions.size === 0)) {
    lastFlush = now.getTime();
    if (usageEnabled(env)) maybeCompact(now, env);
    return 0;
  }
  flushing = true;
  let written = 0;
  try {
    const rowsByDay = new Map<string, [string, UsageRow][]>();
    for (const [id, r] of pending) {
      const list = rowsByDay.get(r.day) ?? [];
      list.push([id, { ...r }]); // a snapshot: tallies added during the write are kept
      rowsByDay.set(r.day, list);
    }
    const sessionsByDay = new Map(pendingSessions);
    pendingSessions.clear();
    pendingSessionCount = 0;
    const days = [...new Set([...rowsByDay.keys(), ...sessionsByDay.keys()])].sort();
    for (const day of days) {
      const rows = rowsByDay.get(day) ?? [];
      const sess = sessionsByDay.get(day);
      try {
        let sessions: SessionRecord[] | undefined;
        if (sess && sess.size) {
          const salt = await saltFor(day, now, !isClosed(day, now));
          if (salt) {
            sessions = [...sess].map(([pre, s]) => ({ h: saltedHash(salt, pre), g: groupOf(s.client, s.probe, s.crawler), q: s.q, hs: s.hs, tools: s.tools }));
          }
        }
        if (!rows.length && !sessions?.length) continue;
        const file: UsageFile = { version: 2, flushed_at: now.toISOString(), day, rows: rows.map(([, r]) => r), ...(sessions?.length ? { sessions } : {}) };
        const pathname = `${BLOB_PREFIX}${day}/${now.getTime()}-${randomBytes(4).toString("hex")}.json`;
        await store.write(pathname, file, false);
        for (const [id, r] of rows) {
          const cur = pending.get(id);
          if (!cur) continue;
          cur.count -= r.count;
          if (cur.count <= 0) pending.delete(id);
        }
        written += rows.length + (sessions?.length ?? 0);
      } catch (e) {
        console.warn("[usage] flush failed:", String((e as any)?.message ?? e).slice(0, 200));
        if (sess && !isClosed(day, now)) restoreSessions(day, sess); // try again next time
      }
    }
    lastFlush = now.getTime(); // do not retry on every request
    return written;
  } finally {
    flushing = false;
    maybeCompact(now, env);
  }
}

function restoreSessions(day: string, sess: Map<string, PendingSession>): void {
  let m = pendingSessions.get(day);
  if (!m) pendingSessions.set(day, (m = new Map()));
  for (const [pre, s] of sess) {
    const cur = m.get(pre);
    if (!cur) {
      if (pendingSessionCount >= MAX_PENDING_SESSIONS) continue;
      m.set(pre, s);
      pendingSessionCount++;
      continue;
    }
    cur.probe ||= s.probe;
    cur.crawler ||= s.crawler;
    cur.client ||= s.client;
    cur.q += s.q;
    cur.hs += s.hs;
    for (const [t, n] of Object.entries(s.tools)) cur.tools[t] = (cur.tools[t] ?? 0) + n;
  }
}

function maybeCompact(now: Date, env: Env): void {
  if (compacting || now.getTime() - lastCompact < COMPACT_EVERY_MS) return;
  lastCompact = now.getTime();
  compacting = true;
  void compactUsage(now, env)
    .catch((e) => console.warn("[usage] compaction failed:", String((e as any)?.message ?? e).slice(0, 200)))
    .finally(() => {
      compacting = false;
    });
}

// ---------- closing a day: many small files -> one summary of counts, hashes and salt deleted ----------

const emptyGroup = (): GroupStats => ({ sessions: 0, questions: 0, handshakes: 0, tools: {} });

/** Distinct sessions of one day, reduced to counts (pure). Records with the same hash are one session. */
export function reduceSessions(records: SessionRecord[]): DaySessions {
  const merged = new Map<string, SessionRecord>();
  for (const r of records) {
    if (!r || typeof r.h !== "string" || !(CLIENT_GROUPS as readonly string[]).includes(r.g)) continue;
    const cur = merged.get(r.h);
    if (!cur) {
      merged.set(r.h, { h: r.h, g: r.g, q: r.q || 0, hs: r.hs || 0, tools: { ...(r.tools ?? {}) } });
      continue;
    }
    cur.g = strongerGroup(cur.g, r.g);
    cur.q += r.q || 0;
    cur.hs += r.hs || 0;
    for (const [t, n] of Object.entries(r.tools ?? {})) cur.tools[t] = (cur.tools[t] ?? 0) + n;
  }
  const out: DaySessions = {
    total: 0,
    by_group: { directory_checks: emptyGroup(), crawlers: emptyGroup(), named_apps: emptyGroup(), unnamed: emptyGroup() },
    questions_per_session: { "0": 0, "1": 0, "2-5": 0, "6-20": 0, "21+": 0 },
    by_tool: {},
  };
  for (const s of merged.values()) {
    out.total++;
    const g = out.by_group[s.g];
    g.sessions++;
    g.questions += s.q;
    g.handshakes += s.hs;
    out.questions_per_session[sessionBucket(s.q)]++;
    for (const [t, n] of Object.entries(s.tools)) {
      const gt = (g.tools[t] ??= { sessions: 0, questions: 0 });
      gt.sessions++;
      gt.questions += n;
      out.by_tool[t] = (out.by_tool[t] ?? 0) + 1;
    }
  }
  return out;
}

function addRows(into: Map<string, UsageRow>, rows: UsageRow[] | undefined): void {
  for (const r of rows ?? []) {
    if (!r || !Number.isFinite(r.count) || r.count <= 0) continue;
    const id = JSON.stringify([r.day, r.tool, r.country, r.key, r.status, r.client]);
    const cur = into.get(id);
    if (cur) cur.count += r.count;
    else into.set(id, { ...r });
  }
}

const SMALL_FILE = /^usage\/(\d{4}-\d{2}-\d{2})\/[^/]+\.json$/;
const SALT_FILE = /^usage-salt\/(\d{4}-\d{2}-\d{2})\.json$/;

export interface CompactResult {
  compacted: string[];
  deleted_files: number;
  deleted_salts: number;
  /** closed days still holding small files (the time budget ran out) */
  remaining: string[];
}

/** Close every finished day (at least CLOSE_GRACE_MS after its midnight UTC), oldest first, within a time budget: merge its small
 *  files into usage-daily/<day>.json (counts only), then delete the small files and the day's salt. Safe to run on several instances
 *  at once and to repeat. */
export async function compactUsage(
  now: Date = new Date(),
  env: Env = process.env,
  s: UsageStore = store,
  opts: { budgetMs?: number; maxDays?: number } = {},
): Promise<CompactResult> {
  const res: CompactResult = { compacted: [], deleted_files: 0, deleted_salts: 0, remaining: [] };
  if (!usageEnabled(env)) return res;
  const started = Date.now();
  const budget = opts.budgetMs ?? 20_000;
  const maxDays = opts.maxDays ?? 400;
  for (const d of [...salts.keys()]) if (isClosed(d, now)) salts.delete(d);
  const byDay = new Map<string, string[]>();
  for (const p of await s.list(BLOB_PREFIX)) {
    const m = SMALL_FILE.exec(p);
    if (!m || !isClosed(m[1], now)) continue;
    const list = byDay.get(m[1]) ?? [];
    list.push(p);
    byDay.set(m[1], list);
  }
  const days = [...byDay.keys()].sort();
  for (const day of days) {
    if (res.compacted.length >= maxDays || Date.now() - started > budget) {
      res.remaining.push(day);
      continue;
    }
    const path = `${DAILY_PREFIX}${day}.json`;
    const existing = await s.read<DailySummary>(path).catch(() => null);
    const already = new Set(existing?.merged ?? []);
    const names = byDay.get(day)!.filter((n) => !already.has(n));
    const rows = new Map<string, UsageRow>();
    addRows(rows, existing?.rows);
    const records: SessionRecord[] = [];
    const readOk: string[] = [];
    for (let i = 0; i < names.length; i += 16) {
      const got = await Promise.all(names.slice(i, i + 16).map((n) => s.read<UsageFile>(n).then((f) => [n, f] as const).catch(() => [n, null] as const)));
      for (const [n, f] of got) {
        if (!f || !Array.isArray(f.rows)) continue; // unreadable now: left for the next run
        readOk.push(n);
        addRows(rows, f.rows);
        if (Array.isArray(f.sessions)) records.push(...f.sessions);
      }
    }
    // Hashes can be merged into distinct sessions only before the day has a summary. Hashes in a late file are dropped (counts only
    // fall short), and deleted with the file.
    const sessions = existing ? existing.sessions : records.length ? reduceSessions(records) : null;
    const summary: DailySummary = {
      version: 2,
      day,
      compacted_at: now.toISOString(),
      merged: [...already, ...readOk].sort(),
      rows: [...rows.values()],
      sessions,
    };
    await s.write(path, summary, true);
    const toDelete = byDay.get(day)!.filter((n) => already.has(n) || readOk.includes(n));
    await s.del(toDelete);
    res.deleted_files += toDelete.length;
    res.compacted.push(day);
  }
  // Every closed day's salt is deleted, whether or not the day had files.
  const oldSalts = (await s.list(SALT_PREFIX)).filter((p) => {
    const m = SALT_FILE.exec(p);
    return m && isClosed(m[1], now) && !res.remaining.includes(m[1]);
  });
  await s.del(oldSalts);
  res.deleted_salts = oldSalts.length;
  return res;
}

// ---------- reading it back: GET /api/v1/usage ----------

type Named = { client: string; handshakes: number; questions: number };

export interface SessionTotals {
  total: number;
  directory_checks: number;
  /** search/AI/SEO crawlers and generic bots (not part of real_apps). Added 22 Oct 2026. */
  crawlers: number;
  /** named_apps + unnamed: everything that is not a directory check or a crawler */
  real_apps: number;
  named_apps: number;
  unnamed: number;
}

export interface UsageReport {
  enabled: boolean;
  service: string;
  message?: string;
  period?: { from: string; to: string; days: number };
  /** Real questions (tool calls) from outside, excluding handshakes and our own checks. The number to watch. */
  real_questions?: number;
  /** Hits on our API from search/AI/SEO crawlers and generic bots following links on public pages. Not questions: kept out of real_questions. */
  crawler_questions?: number;
  /** Connection handshakes (mcp_initialize) from outside. Not questions. */
  handshakes?: number;
  /** Legacy: every recorded row in the period, handshakes and older rows from our own checks included. */
  total_questions?: number;
  /** Legacy: total_questions minus older rows from our own named checks (handshakes included). See real_questions. */
  outside_questions?: number;
  own_checks?: { questions: number; clients: string[]; note: string };
  by_day?: {
    day: string;
    questions: number;
    outside_questions: number;
    answered: number;
    real_questions: number;
    /** crawler hits that day (not in real_questions) */
    crawler_questions: number;
    handshakes: number;
    sessions: SessionTotals | null;
  }[];
  /** Legacy: every row by tool, handshakes included. */
  by_tool?: { tool: string; questions: number }[];
  /** Real questions from outside, by tool. */
  questions_by_tool?: { tool: string; questions: number }[];
  /** Legacy name for by_country_asked_about (handshakes have no country). */
  by_country?: { country: string; questions: number }[];
  /** The country each question was ABOUT (the country parameter), never where the caller is. */
  by_country_asked_about?: { country: string; questions: number }[];
  by_status?: Record<string, number>;
  /** Legacy: every named client together. See clients. */
  by_client?: { client: string; questions: number }[];
  clients?: { directory_checks: Named[]; other_apps: Named[]; note: string };
  sessions?: SessionTotals & {
    days_with_data: number;
    questions_per_session: Record<SessionBucket, number>;
    by_tool: { tool: string; sessions: number }[];
    top_tools_by_group: Record<ClientGroup, { tool: string; sessions: number; questions: number }[]>;
    by_group: Record<ClientGroup, { sessions: number; questions: number; handshakes: number }>;
    note: string;
  };
  coverage?: { days: number; days_with_data: number; days_from_summaries: number; days_from_small_files: number; small_files_read: number; capped: boolean };
  top_unanswered?: { tool: string; country: string; key: string; status: string; questions: number }[];
  fields?: Record<string, string>;
  note: string;
}

export const OWN_CHECKS_NOTE =
  "Our own smoke test and monitors are no longer counted. Rows from our own checks that were recorded before this change are shown here, not as outside questions. Older smoke-test tool calls carried no app name, so a few may still sit in the outside number.";

export const USAGE_NOTE =
  "Anonymous aggregate counts only: no IP addresses, user agents or other identifiers are stored. Distinct visitors are counted per day with a one-way hash salted with a random value that changes every day and is deleted, together with the hashes, shortly after the day ends (UTC). Counts can fall a little short because tallies are batched in memory and written every few minutes.";

export const SESSIONS_NOTE =
  "A session is one visitor (IP address plus user agent, hashed with a salt that changes every UTC day) on one day. The same visitor on several days counts once per day, so totals over the period are visitor-days. Directory checks are known directory probes and health checkers; crawlers are search, AI-training and SEO robots; real apps are everything else.";

export const CLIENTS_NOTE = "Directory checks are known directory probes and health checkers (a list kept in lib/usage.ts); other apps are every other app name sent when connecting.";

export const FIELD_NOTES: Record<string, string> = {
  real_questions: "Tool calls from outside: the questions actually asked. Search/AI/SEO crawlers and bots are not included (see crawler_questions); AI fetchers started by a person are.",
  crawler_questions: "Hits from known web crawlers and bots that follow links on our public pages. Not questions, so not in real_questions.",
  handshakes: "Connection handshakes (mcp_initialize). An app connecting, not a question.",
  by_country_asked_about: "The country each question was about (its country parameter). Not the caller's location, which is never recorded.",
  by_country: "Old name for by_country_asked_about, kept for compatibility.",
  total_questions: "Old total: every recorded row, handshakes included. Use real_questions.",
  outside_questions: "Old total without our own checks, handshakes included. Use real_questions.",
  sessions: "Distinct anonymous visitors per day, summed over the period (visitor-days). Recorded from 21 Oct 2026.",
};

const top = <T extends { questions: number }>(a: T[], n: number) => a.sort((x, y) => y.questions - x.questions).slice(0, n);

const totalsOf = (s: DaySessions): SessionTotals => ({
  total: s.total,
  directory_checks: s.by_group.directory_checks.sessions,
  crawlers: s.by_group.crawlers?.sessions ?? 0,
  real_apps: s.by_group.named_apps.sessions + s.by_group.unnamed.sessions,
  named_apps: s.by_group.named_apps.sessions,
  unnamed: s.by_group.unnamed.sessions,
});

/** Totals over a set of usage files (pure). `sessions` holds each day's distinct-session counts, where known. */
export function summariseUsage(
  files: { rows?: UsageRow[] }[],
  now: Date = new Date(),
  days = 30,
  topN = 20,
  extra: { sessions?: Record<string, DaySessions>; coverage?: UsageReport["coverage"] } = {},
): UsageReport {
  const to = dayOf(now);
  const from = dayOf(new Date(now.getTime() - (days - 1) * 86400000));
  const byDay = new Map<string, { questions: number; outside_questions: number; answered: number; real_questions: number; crawler_questions: number; handshakes: number }>();
  let ownTotal = 0;
  let real = 0;
  let crawlerQ = 0;
  let handshakes = 0;
  const ownClients = new Set<string>();
  const byTool = new Map<string, number>();
  const questionsByTool = new Map<string, number>();
  const byCountry = new Map<string, number>();
  const byStatus: Record<string, number> = {};
  const byClient = new Map<string, number>();
  const named = new Map<string, Named>();
  const unanswered = new Map<string, { tool: string; country: string; key: string; status: string; questions: number }>();
  let total = 0;
  const add = (m: Map<string, number>, k: string, n: number) => m.set(k, (m.get(k) ?? 0) + n);
  for (const f of files) {
    for (const r of f.rows ?? []) {
      if (!r || r.day < from || r.day > to || !Number.isFinite(r.count) || r.count <= 0) continue;
      total += r.count;
      const own = isOwnClient(r.client);
      const hs = isHandshake(r.tool);
      const crawl = !own && isCrawlerClient(r.client);
      if (own) {
        ownTotal += r.count;
        ownClients.add(r.client);
      }
      const d = byDay.get(r.day) ?? { questions: 0, outside_questions: 0, answered: 0, real_questions: 0, crawler_questions: 0, handshakes: 0 };
      d.questions += r.count;
      if (!own) {
        d.outside_questions += r.count;
        if (crawl) {
          if (!hs) d.crawler_questions += r.count; // a crawler's connection handshake is neither a question nor a handshake
        } else if (hs) d.handshakes += r.count;
        else d.real_questions += r.count;
      }
      if (r.status === "ok" && !hs && !crawl) d.answered += r.count;
      byDay.set(r.day, d);
      add(byTool, r.tool, r.count);
      if (!own) {
        if (crawl) {
          if (!hs) crawlerQ += r.count;
        } else if (hs) handshakes += r.count;
        else {
          real += r.count;
          add(questionsByTool, r.tool, r.count);
        }
      }
      if (r.country && !crawl) add(byCountry, r.country, r.count);
      byStatus[r.status] = (byStatus[r.status] ?? 0) + r.count;
      if (r.client && !own && !crawl) {
        add(byClient, r.client, r.count);
        const c = named.get(r.client) ?? { client: r.client, handshakes: 0, questions: 0 };
        if (hs) c.handshakes += r.count;
        else c.questions += r.count;
        named.set(r.client, c);
      }
      if (r.status !== "ok" && r.status !== "error" && !hs && !crawl) {
        const id = JSON.stringify([r.tool, r.country, r.key, r.status]);
        const u = unanswered.get(id) ?? { tool: r.tool, country: r.country, key: r.key, status: r.status, questions: 0 };
        u.questions += r.count;
        unanswered.set(id, u);
      }
    }
  }
  // sessions
  const sess = Object.entries(extra.sessions ?? {}).filter(([d]) => d >= from && d <= to);
  const all = reduceSessions([]); // an empty total to add days into
  for (const [, s] of sess) {
    all.total += s.total;
    for (const b of SESSION_BUCKETS) all.questions_per_session[b] += s.questions_per_session?.[b] ?? 0;
    for (const [t, n] of Object.entries(s.by_tool ?? {})) all.by_tool[t] = (all.by_tool[t] ?? 0) + n;
    for (const g of CLIENT_GROUPS) {
      const src = s.by_group?.[g];
      if (!src) continue;
      const dst = all.by_group[g];
      dst.sessions += src.sessions;
      dst.questions += src.questions;
      dst.handshakes += src.handshakes;
      for (const [t, v] of Object.entries(src.tools ?? {})) {
        const dt = (dst.tools[t] ??= { sessions: 0, questions: 0 });
        dt.sessions += v.sessions;
        dt.questions += v.questions;
      }
    }
  }
  const sessionsByDay = new Map(sess);
  const dayList = [...new Set([...byDay.keys(), ...sessionsByDay.keys()])].sort();
  const emptyDay = { questions: 0, outside_questions: 0, answered: 0, real_questions: 0, crawler_questions: 0, handshakes: 0 };
  const countries = top([...byCountry].map(([country, questions]) => ({ country, questions })), 50);
  const clientList = [...named.values()].sort((a, b) => b.questions + b.handshakes - (a.questions + a.handshakes));
  return {
    enabled: true,
    service: "ProofPrice usage",
    period: { from, to, days },
    real_questions: real,
    crawler_questions: crawlerQ,
    handshakes,
    total_questions: total,
    outside_questions: total - ownTotal,
    own_checks: { questions: ownTotal, clients: [...ownClients].sort(), note: OWN_CHECKS_NOTE },
    by_day: dayList.map((day) => {
      const s = sessionsByDay.get(day);
      return { day, ...(byDay.get(day) ?? emptyDay), sessions: s ? totalsOf(s) : null };
    }),
    by_tool: top([...byTool].map(([tool, questions]) => ({ tool, questions })), 50),
    questions_by_tool: top([...questionsByTool].map(([tool, questions]) => ({ tool, questions })), 50),
    by_country: countries,
    by_country_asked_about: countries.map((c) => ({ ...c })),
    by_status: byStatus,
    by_client: top([...byClient].map(([client, questions]) => ({ client, questions })), 20),
    clients: {
      directory_checks: clientList.filter((c) => isDirectoryCheck(c.client)).slice(0, 30),
      other_apps: clientList.filter((c) => !isDirectoryCheck(c.client)).slice(0, 30),
      note: CLIENTS_NOTE,
    },
    sessions: {
      ...totalsOf(all),
      days_with_data: sess.length,
      questions_per_session: all.questions_per_session,
      by_tool: Object.entries(all.by_tool)
        .map(([tool, sessions]) => ({ tool, sessions }))
        .sort((a, b) => b.sessions - a.sessions)
        .slice(0, 50),
      top_tools_by_group: Object.fromEntries(
        CLIENT_GROUPS.map((g) => [
          g,
          Object.entries(all.by_group[g].tools)
            .map(([tool, v]) => ({ tool, ...v }))
            .sort((a, b) => b.sessions - a.sessions || b.questions - a.questions)
            .slice(0, 10),
        ]),
      ) as Record<ClientGroup, { tool: string; sessions: number; questions: number }[]>,
      by_group: Object.fromEntries(
        CLIENT_GROUPS.map((g) => [g, { sessions: all.by_group[g].sessions, questions: all.by_group[g].questions, handshakes: all.by_group[g].handshakes }]),
      ) as Record<ClientGroup, { sessions: number; questions: number; handshakes: number }>,
      note: SESSIONS_NOTE,
    },
    ...(extra.coverage ? { coverage: extra.coverage } : {}),
    top_unanswered: top([...unanswered.values()], topN),
    fields: FIELD_NOTES,
    note: USAGE_NOTE,
  };
}

/** The report for the last `days` days. Closes finished days first (within a time budget), then reads one summary per closed day
 *  and the small files of open days. When counting is off it says so and reads nothing. */
export async function usageReport(
  now: Date = new Date(),
  env: Env = process.env,
  s: UsageStore = store,
  opts: { days?: number; compactBudgetMs?: number } = {},
): Promise<UsageReport> {
  const days = opts.days ?? 30;
  if (!usageEnabled(env)) {
    return { enabled: false, service: "ProofPrice usage", message: "Usage counting is switched off, so there is nothing to report.", note: USAGE_NOTE };
  }
  try {
    await compactUsage(now, env, s, { budgetMs: opts.compactBudgetMs ?? 10_000 });
  } catch (e) {
    console.warn("[usage] compaction failed:", String((e as any)?.message ?? e).slice(0, 200));
  }
  const from = dayOf(new Date(now.getTime() - (days - 1) * 86400000));
  const to = dayOf(now);
  const inPeriod = (d: string) => d >= from && d <= to;

  const summaries = new Map<string, DailySummary>();
  const summaryNames = (await s.list(DAILY_PREFIX)).filter((p) => /^usage-daily\/\d{4}-\d{2}-\d{2}\.json$/.test(p) && inPeriod(p.slice(12, 22)));
  for (let i = 0; i < summaryNames.length; i += 10) {
    const got = await Promise.all(summaryNames.slice(i, i + 10).map((n) => s.read<DailySummary>(n).catch(() => null)));
    for (const f of got) if (f && Array.isArray(f.rows) && typeof f.day === "string") summaries.set(f.day, f);
  }
  const allSmall = (await s.list(BLOB_PREFIX)).filter((p) => {
    const m = SMALL_FILE.exec(p);
    return m && inPeriod(m[1]) && !summaries.get(m[1])?.merged?.includes(p);
  });
  const smallNames = allSmall.sort().reverse().slice(0, MAX_FILES_READ);
  const files: { rows?: UsageRow[] }[] = [...summaries.values()];
  const records = new Map<string, SessionRecord[]>();
  for (let i = 0; i < smallNames.length; i += 16) {
    const got = await Promise.all(smallNames.slice(i, i + 16).map((n) => s.read<UsageFile>(n).then((f) => [n, f] as const).catch(() => [n, null] as const)));
    for (const [n, f] of got) {
      if (!f || !Array.isArray(f.rows)) continue;
      files.push(f);
      const day = n.slice(6, 16);
      if (!summaries.has(day) && Array.isArray(f.sessions)) records.set(day, [...(records.get(day) ?? []), ...f.sessions]);
    }
  }
  const sessions: Record<string, DaySessions> = {};
  for (const [day, sum] of summaries) if (sum.sessions) sessions[day] = sum.sessions;
  for (const [day, recs] of records) sessions[day] = reduceSessions(recs);
  const smallDays = new Set(smallNames.map((n) => n.slice(6, 16)));
  const dataDays = new Set([...summaries.keys(), ...smallDays]);
  return summariseUsage(files, now, days, 20, {
    sessions,
    coverage: {
      days,
      days_with_data: dataDays.size,
      days_from_summaries: summaries.size,
      days_from_small_files: [...smallDays].filter((d) => !summaries.has(d)).length,
      small_files_read: smallNames.length,
      capped: allSmall.length > smallNames.length,
    },
  });
}
