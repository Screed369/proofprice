// Anonymous usage counting (lib/usage.ts): off unless BLOB_READ_WRITE_TOKEN exists; counts only the documented fields; flushes in batches.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { FLUSH_MS, KEY_MAX, flushUsage, pendingUsage, recordUsage, resetUsage, setUsageSink, statusOfAnswer, statusOfError, summariseUsage, usageClient, usageEnabled, usageKey, usageReport } from "../lib/usage";
import type { UsageFile } from "../lib/usage";

const ON = { BLOB_READ_WRITE_TOKEN: "test-token-not-real" };
const OFF = {};
const NOW = new Date("2026-10-14T12:00:00Z");

beforeEach(() => {
  resetUsage(NOW.getTime());
  setUsageSink(null);
});

test("off by default: with no Blob token nothing is counted or sent", async () => {
  let sent = 0;
  setUsageSink(async () => void sent++);
  assert.equal(usageEnabled(OFF), false);
  assert.equal(usageEnabled({ BLOB_READ_WRITE_TOKEN: "  " }), false);
  recordUsage({ tool: "pricepaid_rent_prices", country: "IE", key: "dublin", status: "ok" }, NOW, OFF);
  assert.equal(pendingUsage().length, 0);
  assert.equal(await flushUsage(NOW, OFF), 0);
  assert.equal(sent, 0);
  const r = await usageReport(NOW, OFF, { list: async () => { throw new Error("must not read"); }, read: async () => null });
  assert.equal(r.enabled, false);
  assert.match(r.message!, /switched off/);
});

test("on: tallies by day, tool, country, key, status and client; nothing else", () => {
  const e = { tool: "pricepaid_fuel_prices_now", country: "fr", key: "  Lyon / DIESEL ", status: "ok" as const, client: "Claude-AI" };
  recordUsage(e, NOW, ON);
  recordUsage(e, NOW, ON);
  recordUsage({ ...e, status: "no_matches" }, NOW, ON);
  const rows = pendingUsage();
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.find((r) => r.status === "ok"), { day: "2026-10-14", tool: "pricepaid_fuel_prices_now", country: "FR", key: "lyon / diesel", status: "ok", client: "claude-ai", count: 2 });
  assert.deepEqual(Object.keys(rows[0]).sort(), ["client", "count", "country", "day", "key", "status", "tool"]);
});

test("the key is lower case, trimmed, at most 60 characters, and has no free text, prices or full postcodes", () => {
  assert.equal(usageKey({ town: " Bristol ", property_type: "Terraced", months: 12, price: 400000, includes: "VAT", note: "my address is 5 High St" }), "bristol / terraced");
  assert.equal(usageKey({ postcode: "BS1 4DJ" }), "bs1");
  assert.equal(usageKey({ town: "x".repeat(200) }).length, KEY_MAX);
  assert.equal(usageKey({ property_type: "any" }), "");
  assert.equal(usageClient("Weird/Client <script>"), "weirdclient script");
  assert.equal(usageClient(undefined), "");
  assert.equal(statusOfAnswer({ status: "insufficient_data" }), "insufficient_data");
  assert.equal(statusOfAnswer({}), "ok");
  assert.equal(statusOfError(new Error("Rents paid are available for IE and GB so far. Not yet: ZZ.")), "unsupported");
  assert.equal(statusOfError(new Error("boom")), "error");
});

test("flush writes one aggregate file when the interval has passed, and keeps tallies if the write fails", async () => {
  const files: { f: UsageFile; p: string }[] = [];
  setUsageSink(async (f, p) => void files.push({ f, p }));
  recordUsage({ tool: "t", country: "IE", key: "dublin", status: "ok" }, NOW, ON);
  assert.equal(files.length, 0); // not yet: the batch is only flushed every few minutes
  recordUsage({ tool: "t", country: "IE", key: "dublin", status: "ok" }, new Date(NOW.getTime() + FLUSH_MS + 1000), ON);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(files.length, 1);
  assert.match(files[0].p, /^usage\/2026-10-14\/\d+-[0-9a-f]{8}\.json$/);
  assert.equal(files[0].f.rows[0].count, 2);
  assert.equal(pendingUsage().length, 0);

  resetUsage(NOW.getTime());
  setUsageSink(async () => { throw new Error("blob down"); });
  recordUsage({ tool: "t", country: "IE", key: "x", status: "ok" }, NOW, ON);
  assert.equal(await flushUsage(NOW, ON), 0);
  assert.equal(pendingUsage().length, 1); // kept for the next try
});

test("the report: last 30 days, totals, answered share and the top unanswered questions", async () => {
  const f = (day: string, rows: Partial<UsageFile["rows"][number]>[]): UsageFile => ({
    version: 1, flushed_at: day, rows: rows.map((r) => ({ day, tool: "pricepaid_rent_prices", country: "IE", key: "dublin", status: "ok", client: "", count: 1, ...r })) as any,
  });
  const files = [
    f("2026-10-13", [{ count: 5 }, { key: "galway", status: "no_matches", count: 3 }, { country: "ZZ", key: "", status: "unsupported", count: 2 }]),
    f("2026-10-14", [{ key: "galway", status: "no_matches", count: 4 }, { status: "insufficient_data", key: "tiny", count: 1 }, { tool: "mcp_initialize", client: "cursor", count: 6 }, { status: "error", count: 9 }]),
    f("2026-08-01", [{ count: 100 }]), // older than 30 days
  ];
  const r = summariseUsage(files, NOW);
  assert.equal(r.total_questions, 5 + 3 + 2 + 4 + 1 + 6 + 9);
  assert.deepEqual(r.top_unanswered![0], { tool: "pricepaid_rent_prices", country: "IE", key: "galway", status: "no_matches", questions: 7 });
  assert.ok(!r.top_unanswered!.some((u) => u.tool === "mcp_initialize" || u.status === "error"));
  assert.equal(r.by_client![0].client, "cursor");
  assert.equal(r.by_day![0].day, "2026-10-13");
  assert.equal(r.by_day![0].answered, 5);
  assert.deepEqual(r.period, { from: "2026-09-15", to: "2026-10-14", days: 30 });
  assert.ok(!JSON.stringify(r).match(/ip|user.?agent/i) || /no IP addresses, user agents/.test(r.note));

  const rep = await usageReport(NOW, ON, {
    list: async () => ["usage/2026-10-14/a.json", "usage/2026-08-01/old.json", "other/x.json"],
    read: async (p) => (p.endsWith("a.json") ? files[1] : files[2]),
  });
  assert.equal(rep.enabled, true);
  assert.equal(rep.total_questions, 4 + 1 + 6 + 9);
});
