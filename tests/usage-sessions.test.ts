// Usage meter v2 (lib/usage.ts): the full 30 days (finished days compacted into one summary each), questions apart from handshakes,
// the country asked about, directory checks apart from other apps, and anonymous daily sessions (a daily-salted one-way hash that
// is deleted with its salt when the day closes; raw IP addresses and user agents are never written).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  BLOB_PREFIX, CLOSE_GRACE_MS, DAILY_PREFIX, DIRECTORY_CHECK_NAMES, SALT_PREFIX, compactUsage, flushUsage, isDirectoryCheck, memoryStore,
  pendingSessionsSummary, recordUsage, reduceSessions, resetUsage, saltedHash, sessionBucket, setUsageStore, summariseUsage, usageReport,
  visitorOf,
} from "../lib/usage";
import { withInitializeCount } from "../lib/mcp-tools";
import type { DailySummary, UsageFile, UsageRow } from "../lib/usage";

const ON = { BLOB_READ_WRITE_TOKEN: "test-token-not-real" };
const DAY1 = new Date("2026-10-14T12:00:00Z");
const DAY2 = new Date("2026-10-15T12:00:00Z");
const IP = "203.0.113.77";
const UA = "SecretAgentBrowser/7.3 (unique-fingerprint-xyz)";
const req = (ip = IP, ua = UA) => new Request("https://proofprice.com/api/v1/fuel?country=ES", { headers: { "x-forwarded-for": `${ip}, 10.0.0.1`, "user-agent": ua } });

let mem = memoryStore();
beforeEach(() => {
  resetUsage(DAY1.getTime());
  mem = memoryStore();
  setUsageStore(mem);
});

const everythingWritten = () => mem.writes.map((w) => w.pathname + "\n" + w.body).join("\n");
const sessionHashes = () =>
  [...mem.files.entries()].filter(([p]) => p.startsWith(BLOB_PREFIX)).flatMap(([, b]) => ((JSON.parse(b) as UsageFile).sessions ?? []).map((s) => s.h));

// ---------- 1. the full 30 days ----------

test("30-day coverage: 30 days of 200 small files each (6,000 files, far over the old 500-file limit) are all counted", async () => {
  const now = new Date("2026-10-14T12:00:00Z");
  for (let d = 0; d < 30; d++) {
    const day = new Date(now.getTime() - d * 86400000).toISOString().slice(0, 10);
    for (let i = 0; i < 200; i++) {
      const row: UsageRow = { day, tool: "pricepaid_rent_prices", country: "IE", key: "dublin", status: "ok", client: "", count: 1 };
      mem.files.set(`${BLOB_PREFIX}${day}/${i}-x.json`, JSON.stringify({ version: 1, flushed_at: day, rows: [row] }));
    }
  }
  // older than the period: never counted
  mem.files.set(`${BLOB_PREFIX}2026-08-01/old.json`, JSON.stringify({ version: 1, flushed_at: "x", rows: [{ day: "2026-08-01", tool: "t", country: "", key: "", status: "ok", client: "", count: 99 }] }));
  const r = await usageReport(now, ON, mem, { compactBudgetMs: 60_000 });
  assert.equal(r.real_questions, 6000);
  assert.equal(r.by_day!.length, 30);
  assert.equal(r.by_day![0].day, "2026-09-15");
  assert.ok(r.by_day!.every((d) => d.real_questions === 200));
  assert.equal(r.coverage!.days_with_data, 30);
  assert.equal(r.coverage!.capped, false);
  // finished days became one summary each; only the open day (and nothing else in the period) is still small files
  const left = [...mem.files.keys()].filter((p) => p.startsWith(BLOB_PREFIX) && !p.includes("2026-08-01"));
  assert.ok(left.every((p) => p.startsWith(`${BLOB_PREFIX}2026-10-14/`)), "only today's small files are left");
  assert.equal([...mem.files.keys()].filter((p) => p.startsWith(DAILY_PREFIX)).length, 30); // 29 days in the period + 2026-08-01
  assert.equal(r.coverage!.days_from_summaries, 29);
  // and a second report reads the same totals from the summaries
  const again = await usageReport(now, ON, mem);
  assert.equal(again.real_questions, 6000);
});

test("compaction is idempotent and a late file after the summary is added once, without double counting", async () => {
  const day = "2026-10-13";
  const row = (count: number): UsageRow => ({ day, tool: "pricepaid_fuel_prices_now", country: "FR", key: "lyon", status: "ok", client: "", count });
  mem.files.set(`${BLOB_PREFIX}${day}/a.json`, JSON.stringify({ version: 2, flushed_at: "x", day, rows: [row(3)] }));
  mem.files.set(`${BLOB_PREFIX}${day}/b.json`, JSON.stringify({ version: 2, flushed_at: "x", day, rows: [row(4)] }));
  await compactUsage(DAY1, ON, mem);
  await compactUsage(DAY1, ON, mem);
  let sum = JSON.parse(mem.files.get(`${DAILY_PREFIX}${day}.json`)!) as DailySummary;
  assert.equal(sum.rows[0].count, 7);
  mem.files.set(`${BLOB_PREFIX}${day}/late.json`, JSON.stringify({ version: 2, flushed_at: "x", day, rows: [row(2)] }));
  // a racing instance that had read the summary still sees the merged names and skips them
  mem.files.set(`${BLOB_PREFIX}${day}/a.json`, JSON.stringify({ version: 2, flushed_at: "x", day, rows: [row(3)] }));
  await compactUsage(DAY1, ON, mem);
  sum = JSON.parse(mem.files.get(`${DAILY_PREFIX}${day}.json`)!) as DailySummary;
  assert.equal(sum.rows[0].count, 9);
  assert.deepEqual([...mem.files.keys()].filter((p) => p.startsWith(BLOB_PREFIX)), []);
  // an open day (today, or yesterday within the grace hour) is never compacted
  mem.files.set(`${BLOB_PREFIX}2026-10-14/t.json`, JSON.stringify({ version: 2, flushed_at: "x", rows: [] }));
  const early = new Date(Date.parse("2026-10-15T00:00:00Z") + CLOSE_GRACE_MS - 1000);
  assert.deepEqual((await compactUsage(early, ON, mem)).compacted, []);
});

// ---------- 2. report clarity ----------

test("questions are kept apart from handshakes; the country is the country asked about; directory checks apart from other apps", () => {
  const rows: UsageRow[] = [
    { day: "2026-10-14", tool: "mcp_initialize", country: "", key: "", status: "ok", client: "glama", count: 10 },
    { day: "2026-10-14", tool: "mcp_initialize", country: "", key: "", status: "ok", client: "rokmcp-probe", count: 5 },
    { day: "2026-10-14", tool: "mcp_initialize", country: "", key: "", status: "ok", client: "mcp.market-uptime", count: 4 },
    { day: "2026-10-14", tool: "mcp_initialize", country: "", key: "", status: "ok", client: "cursor", count: 2 },
    { day: "2026-10-14", tool: "pricepaid_rent_prices", country: "IE", key: "dublin", status: "ok", client: "", count: 6 },
    { day: "2026-10-14", tool: "pricepaid_fuel_prices_now", country: "ES", key: "28 / diesel", status: "no_matches", client: "", count: 1 },
  ];
  const r = summariseUsage([{ rows }], DAY1);
  assert.equal(r.real_questions, 7);
  assert.equal(r.handshakes, 21);
  assert.equal(r.total_questions, 28); // legacy total, unchanged meaning
  assert.equal(r.by_day![0].real_questions, 7);
  assert.equal(r.by_day![0].handshakes, 21);
  assert.equal(r.by_day![0].answered, 6);
  assert.deepEqual(r.by_country_asked_about, [{ country: "IE", questions: 6 }, { country: "ES", questions: 1 }]);
  assert.deepEqual(r.by_country, r.by_country_asked_about); // old field kept
  assert.match(r.fields!.by_country_asked_about, /about.*not the caller's location/i);
  assert.deepEqual(r.questions_by_tool!.map((t) => t.tool), ["pricepaid_rent_prices", "pricepaid_fuel_prices_now"]);
  assert.deepEqual(r.clients!.directory_checks.map((c) => c.client), ["glama", "rokmcp-probe", "mcp.market-uptime"]);
  assert.deepEqual(r.clients!.other_apps, [{ client: "cursor", handshakes: 2, questions: 0 }]);
});

test("the directory-check list: named probes, *-probe, *uptime*, health checkers; real apps are not caught", () => {
  for (const n of DIRECTORY_CHECK_NAMES) assert.ok(isDirectoryCheck(n), n);
  for (const n of ["some-new-probe", "ToolVetProbe", "status uptime bot", "MCP Health Checker", "healthcheck", "wellknown-prober", "UptimeRobot/2.0", "golemreach-trust",
    "mcpstation-check", "annalist-checks", "catalog-health", "mcpwatch", "agentindexbot", "x402-observatory", "endpointaudit", "mcphub-snapshot",
    "mcp-inventory", "taifoon-harvester", "agent-collector", "mcp-rugpull-research", "mcpbeat", "stackduke-mcp-scanner"]) assert.ok(isDirectoryCheck(n), n);
  for (const n of ["claude-ai", "claude-code", "cursor", "openai-mcp", "vscode", "windsurf-client", "anthropic", "rmcp", "mcp", "tacuri-ai", "", undefined]) assert.equal(isDirectoryCheck(n), false, String(n));
});

// ---------- 3. anonymous sessions ----------

test("no raw IP address or user agent is ever written, nor the unsalted digest; only a 32-hex salted hash", async () => {
  const v = visitorOf(req())!;
  assert.ok(v && /^[0-9a-f]{64}$/.test(v.pre));
  assert.ok(!JSON.stringify(v).includes(IP) && !JSON.stringify(v).includes("SecretAgent"));
  recordUsage({ tool: "mcp_initialize", status: "ok", client: "Cursor", visitor: v }, DAY1, ON);
  recordUsage({ tool: "pricepaid_fuel_prices_now", country: "ES", key: "28 / diesel", status: "ok", visitor: v }, DAY1, ON);
  assert.ok(await flushUsage(DAY1, ON));
  const all = everythingWritten();
  for (const secret of [IP, "203.0.113", UA, "SecretAgent", "unique-fingerprint", v.pre]) assert.ok(!all.includes(secret), `${secret} was written`);
  const hashes = sessionHashes();
  assert.equal(hashes.length, 1);
  assert.match(hashes[0], /^[0-9a-f]{32}$/);
  assert.ok(mem.files.has(`${SALT_PREFIX}2026-10-14.json`));
  // and through the report and the day's close: still nothing
  await usageReport(new Date("2026-10-16T12:00:00Z"), ON, mem);
  const after = everythingWritten();
  for (const secret of [IP, UA, "SecretAgent", v.pre]) assert.ok(!after.includes(secret));
});

test("the hash changes between days: the same visitor gets unlinkable hashes on two days", async () => {
  const v = visitorOf(req())!;
  recordUsage({ tool: "pricepaid_rent_prices", country: "IE", status: "ok", visitor: v }, DAY1, ON);
  await flushUsage(DAY1, ON);
  const s1 = JSON.parse(mem.files.get(`${SALT_PREFIX}2026-10-14.json`)!).salt;
  const h1 = sessionHashes();
  // day 2, just after midnight (day 1 still open for late flushes): a new salt, a new hash
  const early2 = new Date("2026-10-15T00:10:00Z");
  recordUsage({ tool: "pricepaid_rent_prices", country: "IE", status: "ok", visitor: v }, early2, ON);
  await flushUsage(early2, ON);
  await new Promise((r) => setTimeout(r, 20)); // the record above may already have started a flush
  const s2 = JSON.parse(mem.files.get(`${SALT_PREFIX}2026-10-15.json`)!).salt;
  assert.notEqual(s1, s2);
  const hashes = sessionHashes();
  assert.equal(hashes.length, 2);
  assert.notEqual(hashes[0], hashes[1]);
  assert.deepEqual(h1, [saltedHash(s1, v.pre)]);
  assert.ok(hashes.includes(saltedHash(s2, v.pre)));
  // by midday day 1 is closed: its salt is gone and nothing can re-link the two
  recordUsage({ tool: "pricepaid_rent_prices", country: "IE", status: "ok", visitor: v }, DAY2, ON);
  await flushUsage(DAY2, ON);
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(!mem.files.has(`${SALT_PREFIX}2026-10-14.json`));
  assert.ok(mem.files.has(`${SALT_PREFIX}2026-10-15.json`));
});

test("closing the day deletes every hash and the day's salt and keeps counts only; later flushes cannot use the old salt", async () => {
  const a = visitorOf(req("198.51.100.1", "AppOne/1"))!;
  const b = visitorOf(req("198.51.100.2", "AppTwo/1"))!;
  recordUsage({ tool: "pricepaid_rent_prices", country: "IE", status: "ok", visitor: a }, DAY1, ON);
  recordUsage({ tool: "pricepaid_rent_prices", country: "IE", status: "ok", visitor: b }, DAY1, ON);
  await flushUsage(DAY1, ON);
  const hashes = sessionHashes();
  assert.equal(hashes.length, 2);
  // a late tally for day 1, held by an instance until after the day closed
  recordUsage({ tool: "pricepaid_rent_prices", country: "IE", status: "ok", visitor: a }, DAY1, ON);
  const closeAt = new Date(Date.parse("2026-10-15T00:00:00Z") + CLOSE_GRACE_MS + 60_000);
  const res = await compactUsage(closeAt, ON, mem);
  assert.deepEqual(res.compacted, ["2026-10-14"]);
  assert.equal(res.deleted_salts, 1);
  assert.ok(!mem.files.has(`${SALT_PREFIX}2026-10-14.json`), "salt deleted");
  assert.deepEqual([...mem.files.keys()].filter((p) => p.startsWith(`${BLOB_PREFIX}2026-10-14/`)), [], "small files with hashes deleted");
  const stored = [...mem.files.values()].join("\n");
  for (const h of hashes) assert.ok(!stored.includes(h), "no hash survives the day");
  const sum = JSON.parse(mem.files.get(`${DAILY_PREFIX}2026-10-14.json`)!) as DailySummary;
  assert.equal(sum.sessions!.total, 2);
  assert.ok(!JSON.stringify(sum).match(/"h"\s*:/), "the summary holds counts, not hashes");
  // the late tally: its question is still counted, but no salt is created again for a closed day and no hash is written
  await flushUsage(closeAt, ON);
  assert.ok(!mem.files.has(`${SALT_PREFIX}2026-10-14.json`));
  assert.equal(sessionHashes().length, 0);
  await compactUsage(new Date(closeAt.getTime() + 60_000), ON, mem);
  const after = JSON.parse(mem.files.get(`${DAILY_PREFIX}2026-10-14.json`)!) as DailySummary;
  assert.equal(after.rows.reduce((n, r) => n + r.count, 0), 3);
  assert.equal(after.sessions!.total, 2);
});

test("sessions per day: distinct visitors across instances, client groups, questions per session, tools per group", async () => {
  const cursor = visitorOf(req("192.0.2.10", "node-fetch/3"))!;
  const glama = visitorOf(req("192.0.2.11", "node"))!;
  const rest = visitorOf(req("192.0.2.12", "curl/8"))!;
  const robot = visitorOf(req("192.0.2.13", "UptimeRobot/2.0"))!;
  assert.equal(robot.probe, true);
  // instance 1
  recordUsage({ tool: "mcp_initialize", status: "ok", client: "Cursor", visitor: cursor }, DAY1, ON);
  recordUsage({ tool: "pricepaid_rent_prices", country: "IE", status: "ok", visitor: cursor }, DAY1, ON);
  recordUsage({ tool: "mcp_initialize", status: "ok", client: "glama", visitor: glama }, DAY1, ON);
  recordUsage({ tool: "pricepaid_home_sales", country: "GB", status: "ok", visitor: rest }, DAY1, ON);
  for (let i = 0; i < 25; i++) recordUsage({ tool: "pricepaid_fuel_prices_now", country: "ES", status: "ok", visitor: robot }, DAY1, ON);
  assert.deepEqual(pendingSessionsSummary().map((s) => s.group).sort(), ["directory_checks", "directory_checks", "named_apps", "unnamed"]);
  await flushUsage(DAY1, ON);
  // instance 2 (fresh memory, same store): the same Cursor visitor asks two more questions without a name
  resetUsage(DAY1.getTime());
  recordUsage({ tool: "pricepaid_rent_prices", country: "IE", status: "ok", visitor: cursor }, DAY1, ON);
  recordUsage({ tool: "pricepaid_fuel_prices_now", country: "FR", status: "ok", visitor: cursor }, DAY1, ON);
  await flushUsage(DAY1, ON);
  const r = await usageReport(DAY1, ON, mem);
  const s = r.sessions!;
  assert.equal(s.total, 4, "one visitor seen by two instances is one session");
  assert.equal(s.directory_checks, 2);
  assert.equal(s.real_apps, 2);
  assert.equal(s.named_apps, 1);
  assert.equal(s.unnamed, 1);
  assert.deepEqual(s.questions_per_session, { "0": 1, "1": 1, "2-5": 1, "6-20": 0, "21+": 1 });
  assert.deepEqual(s.by_group.named_apps, { sessions: 1, questions: 3, handshakes: 1 });
  assert.deepEqual(s.top_tools_by_group.named_apps.map((t) => [t.tool, t.sessions, t.questions]), [["pricepaid_rent_prices", 1, 2], ["pricepaid_fuel_prices_now", 1, 1]]);
  assert.equal(s.by_tool.find((t) => t.tool === "pricepaid_fuel_prices_now")!.sessions, 2);
  assert.deepEqual(r.by_day![0].sessions, { total: 4, directory_checks: 2, real_apps: 2, named_apps: 1, unnamed: 1 });
  // the same numbers once the day is closed and only counts remain
  const later = await usageReport(new Date("2026-10-16T12:00:00Z"), ON, mem);
  assert.deepEqual(later.by_day!.find((d) => d.day === "2026-10-14")!.sessions, { total: 4, directory_checks: 2, real_apps: 2, named_apps: 1, unnamed: 1 });
  assert.equal(later.sessions!.days_with_data, 1);
});

test("buckets and reduction are pure and simple", () => {
  assert.deepEqual([0, 1, 2, 5, 6, 20, 21, 500].map(sessionBucket), ["0", "1", "2-5", "2-5", "6-20", "6-20", "21+", "21+"]);
  const d = reduceSessions([
    { h: "a", g: "unnamed", q: 1, hs: 0, tools: { t: 1 } },
    { h: "a", g: "named_apps", q: 1, hs: 1, tools: { t: 1 } },
    { h: "b", g: "directory_checks", q: 0, hs: 3, tools: {} },
  ]);
  assert.equal(d.total, 2);
  assert.equal(d.by_group.named_apps.sessions, 1);
  assert.equal(d.by_group.named_apps.tools.t.questions, 2);
  assert.equal(d.questions_per_session["2-5"], 1);
});

test("through the real MCP handler: initialize names the app, a later tool call from the same visitor joins its session", async () => {
  const { createProofPriceMcpHandler, LIVE_DEPS } = await import("../lib/mcp-tools");
  const saved = process.env.BLOB_READ_WRITE_TOKEN;
  process.env.BLOB_READ_WRITE_TOKEN = "test-token-not-real"; // the tool handlers read process.env
  resetUsage(Date.now());
  try {
    const handler = withInitializeCount(createProofPriceMcpHandler(LIVE_DEPS), ON);
    const call = (body: unknown) =>
      handler(new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "x-forwarded-for": "192.0.2.50", "user-agent": "claude-user" },
        body: JSON.stringify(body),
      })).then((r) => r.text());
    await call({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "Claude-AI", version: "1" } } });
    const out = await call({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "pricepaid_coverage", arguments: { country: "IE" } } });
    assert.match(out, /"result"/);
    await new Promise((r) => setTimeout(r, 40));
    assert.deepEqual(pendingSessionsSummary().map((s) => [s.group, s.q, s.hs]), [["named_apps", 1, 1]]);
    await flushUsage(new Date(), ON);
    assert.ok(!everythingWritten().includes("192.0.2.50") && !everythingWritten().includes("claude-user"));
  } finally {
    if (saved === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
    else process.env.BLOB_READ_WRITE_TOKEN = saved;
    resetUsage(DAY1.getTime());
  }
});
