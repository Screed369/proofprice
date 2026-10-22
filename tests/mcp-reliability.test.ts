// MCP reliability (15 Oct 2026): production POST /api/mcp ran into Vercel's 60 s limit ("Task timed out") in bursts. These tests
// pin the fixes: a deadline on every live answer (and a second one on every tool call), a log line for slow calls, usage counting
// that never holds a request up, a short coverage answer, and a server that never asks a client to hold a stream open.
// No test here needs the network: slow sources are fakes, the library is a temp folder.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const libDir = mkdtempSync(path.join(tmpdir(), "pp-mcprel-"));
process.env.PROOFPRICE_LIBRARY_DIR = libDir;
delete process.env.BLOB_STORE_ID; // usage counting is off unless a test switches it on
delete process.env.BLOB_READ_WRITE_TOKEN;

import { buildAnswer } from "../lib/answer";
import type { PriceAnswer } from "../lib/answer";
import { CHECK_TOOL } from "../lib/check";
import { InputError, SourceError, isSourceOutage, withDeadline } from "../lib/http";
import { writeDaily, writeMeta } from "../lib/library/store";
import {
  COVERAGE_TOOL, LIVE_DEPS, SLOW_CALL_MS, TOOL_DEADLINE_MS, buildToolSpecs, createProofPriceMcpHandler, logMcpEvent, withInitializeCount,
} from "../lib/mcp-tools";
import type { ToolDeps } from "../lib/mcp-tools";
import {
  ANSWER_DEADLINE_MS, CATEGORIES, SOURCE_PLUGINS, categoryById, countriesFor, coverage, coverageView, exampleUrls, runCategory, sourcesFor, updateFrequency,
} from "../lib/registry";
import { coverageToolSchema } from "../lib/schemas";
import { errorResponse } from "../lib/route-helpers";
import { summarise } from "../lib/stats";
import { pendingUsage, resetUsage, setUsageSink } from "../lib/usage";

const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const never = <T>() => new Promise<T>(() => {});

const fuelCat = categoryById("fuel")!;
const itSrc = SOURCE_PLUGINS.find((s) => s.info.id === "it-fuel")!;
const frSrc = SOURCE_PLUGINS.find((s) => s.info.id === "fr-fuel")!;
const IT_PARAMS = { country: "IT", area: "MI", fuel: "diesel" };

function fuelAnswer(): PriceAnswer {
  return buildAnswer({
    source: itSrc.info,
    query: IT_PARAMS,
    summary: summarise(Array.from({ length: 30 }, (_, i) => 1.7 + i / 100)),
    currency: "EUR",
    unit: "per litre",
    period: { from: day(-1), to: day(0) },
    method: "m",
    describe: (s) => `The median is ${s.median}.`,
  });
}

/** Replace a source's handler for the length of one test. */
async function withHandle<T>(src: (typeof SOURCE_PLUGINS)[number], handle: () => Promise<PriceAnswer>, body: () => Promise<T>): Promise<T> {
  const original = src.handle;
  src.handle = handle as any;
  try {
    return await body();
  } finally {
    src.handle = original;
  }
}

// ====================================================================================================================
// 1. A hard deadline on every live answer
// ====================================================================================================================

test("the deadlines: 40 s for one answer, 50 s for one tool call, both under the 60 s function limit", () => {
  assert.equal(ANSWER_DEADLINE_MS, 40_000);
  assert.equal(TOOL_DEADLINE_MS, 50_000);
  assert.ok(ANSWER_DEADLINE_MS < TOOL_DEADLINE_MS && TOOL_DEADLINE_MS < 60_000);
  assert.equal(SLOW_CALL_MS, 8_000);
});

test("withDeadline: the answer if it comes in time, the timeout error if not, and a late failure is swallowed", async () => {
  assert.equal(await withDeadline(Promise.resolve(7), 50, () => new Error("late")), 7);
  await assert.rejects(withDeadline(never(), 20, () => new Error("too slow")), /too slow/);
  await assert.rejects(withDeadline(Promise.reject(new Error("boom")), 50, () => new Error("late")), /boom/);
  let unhandled = 0;
  const count = () => void unhandled++;
  process.on("unhandledRejection", count);
  try {
    await assert.rejects(withDeadline(new Promise((_, reject) => setTimeout(() => reject(new Error("after the deadline")), 60)), 15, () => new Error("too slow")), /too slow/);
    await sleep(120); // the work fails after the deadline already won
    assert.equal(unhandled, 0, "a failure that arrives after the deadline must not surface as an unhandled rejection");
  } finally {
    process.off("unhandledRejection", count);
  }
});

test("runCategory: a source that never answers fails within the deadline with a 5xx SourceError (a clear, fast error)", async () => {
  const warn = mock.method(console, "warn", () => {});
  try {
    await withHandle(frSrc, () => never(), async () => {
      const started = Date.now();
      const err: any = await runCategory(fuelCat, { country: "FR", department: "69", fuel: "diesel" }, {}, { deadlineMs: 60 }).then(
        () => assert.fail("must not answer"),
        (e) => e,
      );
      const took = Date.now() - started;
      assert.ok(took >= 50 && took < 2000, `returned after ${took} ms`);
      assert.ok(err instanceof SourceError && !(err instanceof InputError));
      assert.equal(err.status, 504);
      assert.match(err.message, /did not respond within \d+ seconds, so ProofPrice stopped waiting/);
      assert.ok(isSourceOutage(err), "it counts as an outage, so stale-if-error applies");
      assert.equal(errorResponse(err).status, 502); // REST: a plain 502 with the message, not a platform timeout
    });
    assert.ok(warn.mock.calls.some((c) => /^\[deadline\] fr-fuel did not answer within 60 ms$/.test(String(c.arguments[0]))));
  } finally {
    warn.mock.restore();
  }
});

test("runCategory: when the source is too slow and the library holds a recent copy, the answer is that copy (stale-if-error)", async () => {
  const key = itSrc.historyKey!(fuelCat.prepare!({ ...IT_PARAMS }))!;
  for (const date of [day(-2), day(-1)]) {
    writeDaily("it-fuel", {
      date,
      currency: "EUR",
      unit: "per litre",
      rows: [{ area: key.area, item: key.item, n: 60, median: 1.8, low: 1.75, high: 1.9, min: 1.6, max: 2.1 }],
    });
  }
  writeMeta("it-fuel", {
    source: "it-fuel", currency: "EUR", unit: "per litre", first_date: day(-2), last_date: day(-1), days: 2,
    last_harvest_at: null, last_rows: 1, last_ok_at: null, last_error: null,
  });
  const warn = mock.method(console, "warn", () => {});
  try {
    await withHandle(itSrc, () => never(), async () => {
      const started = Date.now();
      const answer = await runCategory(fuelCat, IT_PARAMS, {}, { deadlineMs: 60 });
      assert.ok(Date.now() - started < 2000);
      assert.equal(answer.status, "ok");
      assert.equal((answer.extra as any).stale, true);
      assert.equal((answer.extra as any).snapshot_date, day(-1));
      assert.match(answer.notice, /The official source did not respond; this is our copy from/);
      assert.match(String((answer.extra as any).live_source_error), /did not respond within/);
    });
  } finally {
    warn.mock.restore();
  }
});

test("runCategory: a source that answers in time is untouched, and one that fails fast keeps its own error", async () => {
  const answer = fuelAnswer();
  await withHandle(itSrc, async () => answer, async () => {
    assert.equal(await runCategory(fuelCat, IT_PARAMS, {}, { deadlineMs: 500 }), answer);
    assert.equal(await runCategory(fuelCat, IT_PARAMS), answer); // the default deadline leaves no timer behind
  });
  await withHandle(itSrc, async () => { throw new InputError("area must be a province code"); }, async () => {
    await assert.rejects(runCategory(fuelCat, IT_PARAMS, {}, { deadlineMs: 500 }), (e: any) => e instanceof InputError && /area must be/.test(e.message));
  });
  await assert.rejects(runCategory(fuelCat, { country: "ZZ" }, {}, { deadlineMs: 500 }), InputError); // not covered: still a 400, before any deadline
});

test("the price check is bounded too: it answers through runCategory, and a hung source ends in a plain error", async () => {
  const warn = mock.method(console, "warn", () => {});
  try {
    await withHandle(frSrc, () => never(), async () => {
      const deps: ToolDeps = { ...LIVE_DEPS, runCategory: (c, p, ctx) => runCategory(c, p, ctx, { deadlineMs: 60 }) };
      const check = buildToolSpecs(deps).find((s) => s.name === CHECK_TOOL)!;
      const started = Date.now();
      const out = await check.call({ category: "fuel", country: "FR", department: "69", fuel: "diesel", price: 1.9 });
      assert.ok(Date.now() - started < 2000);
      assert.equal(out.isError, true);
      assert.match(out.content[0].text, /^Could not answer: The official source did not respond within/);
    });
  } finally {
    warn.mock.restore();
  }
});

// ====================================================================================================================
// 2. A second limit on every tool call, and a log line for slow ones
// ====================================================================================================================

test("every tool ends within its limit even if what it calls never returns (category, check, history and coverage tools)", async () => {
  const warn = mock.method(console, "warn", () => {});
  try {
    const hang = () => never<any>();
    const deps: ToolDeps = {
      ...LIVE_DEPS,
      runCategory: hang,
      runHistory: hang as any,
      coverageView: hang as any,
      historyDays: () => 999,
      limits: { deadlineMs: 40, slowCallMs: 10_000 },
    };
    const calls: Record<string, Record<string, unknown>> = {
      [fuelCat.tool]: IT_PARAMS,
      [CHECK_TOOL]: { category: "fuel", country: "IT", area: "MI", fuel: "diesel", price: 1.9 },
      [fuelCat.history!.tool]: IT_PARAMS,
      [COVERAGE_TOOL]: {},
    };
    for (const spec of buildToolSpecs(deps)) {
      if (!(spec.name in calls)) continue;
      const started = Date.now();
      const out = await spec.call(calls[spec.name]);
      const took = Date.now() - started;
      assert.ok(took < 2000, `${spec.name} took ${took} ms`);
      assert.equal(out.isError, true, spec.name);
      assert.equal(out.structuredContent, undefined, spec.name);
      assert.match(out.content[0].text, /^Could not answer: This took longer than \d+ seconds, so ProofPrice stopped waiting\./, spec.name);
    }
  } finally {
    warn.mock.restore();
  }
});

test("a tool call slower than the limit logs one line with the tool name and the time, and nothing else", async () => {
  const warn = mock.method(console, "warn", () => {});
  try {
    const slow: ToolDeps = {
      ...LIVE_DEPS,
      runCategory: async () => { await sleep(60); return fuelAnswer(); },
      limits: { slowCallMs: 25 },
    };
    const spec = buildToolSpecs(slow).find((s) => s.name === fuelCat.tool)!;
    const out = await spec.call({ ...IT_PARAMS, postcode: "SW1A 1AA", note: "my home is 5 High Street" });
    assert.ok(!out.isError);
    assert.equal(warn.mock.calls.length, 1);
    const line = String(warn.mock.calls[0].arguments[0]);
    assert.match(line, /^\[slow-mcp-call\] pricepaid_fuel_prices_now took \d+ ms \(ok\)$/);
    assert.ok(!/SW1A|High Street|diesel|IT\b|MI\b/.test(line), "no arguments and no answer text in the log line");
    assert.ok(Number(/took (\d+) ms/.exec(line)![1]) >= 55);
    assert.equal(warn.mock.calls[0].arguments.length, 1);

    // a failing call that is slow is logged too, marked as an error
    warn.mock.resetCalls();
    const failing: ToolDeps = { ...LIVE_DEPS, runCategory: async () => { await sleep(40); throw new SourceError("boom"); }, limits: { slowCallMs: 20 } };
    const bad = await buildToolSpecs(failing).find((s) => s.name === fuelCat.tool)!.call(IT_PARAMS);
    assert.equal(bad.isError, true);
    assert.match(String(warn.mock.calls[0].arguments[0]), /^\[slow-mcp-call\] pricepaid_fuel_prices_now took \d+ ms \(error\)$/);

    // the history and coverage tools and the price check are named too
    warn.mock.resetCalls();
    const all: ToolDeps = { ...LIVE_DEPS, historyDays: () => 999, limits: { slowCallMs: -1 } };
    for (const spec of buildToolSpecs(all)) {
      if (spec.name === fuelCat.history!.tool) await spec.call(IT_PARAMS);
      if (spec.name === COVERAGE_TOOL) await spec.call({});
    }
    const logged = warn.mock.calls.map((c) => String(c.arguments[0]));
    assert.ok(logged.some((l) => l.startsWith(`[slow-mcp-call] ${fuelCat.history!.tool} took`)), logged.join("\n"));
    assert.ok(logged.some((l) => l.startsWith(`[slow-mcp-call] ${COVERAGE_TOOL} took`)), logged.join("\n"));
  } finally {
    warn.mock.restore();
  }
});

test("a quick call logs nothing", async () => {
  const warn = mock.method(console, "warn", () => {});
  try {
    const deps: ToolDeps = { ...LIVE_DEPS, runCategory: async () => fuelAnswer() };
    await buildToolSpecs(deps).find((s) => s.name === fuelCat.tool)!.call(IT_PARAMS);
    await buildToolSpecs(deps).find((s) => s.name === COVERAGE_TOOL)!.call({});
    assert.equal(warn.mock.calls.length, 0);
  } finally {
    warn.mock.restore();
  }
});

// ====================================================================================================================
// 3. Usage counting never holds a request up
// ====================================================================================================================

const ON = { BLOB_READ_WRITE_TOKEN: "test-token-not-real" };
const OFF = {};
const settle = () => sleep(40);
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const initialize = (name: unknown) => ({
  jsonrpc: "2.0", id: 1, method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: { roots: {} }, clientInfo: { name, version: "9.9", title: "A secret title" } },
});

test("usage counting: the handler is called at once, even when the body has not arrived yet", async () => {
  resetUsage();
  setUsageSink(async () => {});
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      c.enqueue(new TextEncoder().encode('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"Late-Client"'));
    },
  });
  let calledAt = 0;
  const started = Date.now();
  const wrapped = withInitializeCount(async () => {
    calledAt = Date.now() - started;
    return new Response("answered");
  }, ON);
  const req = new Request("http://localhost/api/mcp", { method: "POST", headers: { "content-type": "application/json" }, body, duplex: "half" } as RequestInit);
  const res = await Promise.race([wrapped(req), sleep(1000).then(() => "the wrapper waited for the body" as const)]);
  assert.notEqual(res, "the wrapper waited for the body");
  assert.ok(calledAt < 500, `the handler was called after ${calledAt} ms`);
  assert.equal(await (res as Response).text(), "answered");
  assert.equal(pendingUsage().length, 0, "nothing is counted before the message is complete");
  // the rest of the body arrives later: it is counted then, on the side
  controller.enqueue(new TextEncoder().encode("}}}"));
  controller.close();
  await settle();
  assert.deepEqual(pendingUsage().map((r) => [r.tool, r.client, r.count]), [["mcp_initialize", "late-client", 1]]);
});

test("usage counting: only initialize's clientInfo.name is tallied, as before (single messages and batches)", async () => {
  resetUsage();
  setUsageSink(async () => {});
  const wrapped = withInitializeCount(async () => new Response("ok"), ON);
  await wrapped(post(initialize("Claude-AI")));
  await wrapped(post([initialize("Cursor"), { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "pricepaid_home_sales", arguments: { country: "IE", town: "Cork", price: 400000, note: "my address is 5 High St" } } }]));
  await wrapped(post({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "pricepaid_home_sales", arguments: { country: "IE" } } }));
  await wrapped(post({ jsonrpc: "2.0", id: 4, method: "tools/list" }));
  await wrapped(post("this is not json"));
  await wrapped(new Request("http://localhost/api/mcp", { method: "GET" }));
  await settle();
  const rows = pendingUsage();
  assert.deepEqual(rows.map((r) => [r.tool, r.client, r.status, r.count]).sort(), [["mcp_initialize", "claude-ai", "ok", 1], ["mcp_initialize", "cursor", "ok", 1]]);
  assert.deepEqual(Object.keys(rows[0]).sort(), ["client", "count", "country", "day", "key", "status", "tool"]);
  const everything = JSON.stringify(rows);
  assert.ok(!/9\.9|secret|roots|High St|400000|cork/i.test(everything), "nothing but the client name is kept");
});

test("usage counting is off without a Blob store: nothing is read, nothing is counted, the handler still answers", async () => {
  resetUsage();
  let handled = 0;
  const wrapped = withInitializeCount(async (req) => {
    handled++;
    assert.equal(req.bodyUsed, false);
    return new Response("ok");
  }, OFF);
  assert.equal(await (await wrapped(post(initialize("Claude-AI")))).text(), "ok");
  await settle();
  assert.equal(handled, 1);
  assert.equal(pendingUsage().length, 0);
});

test("usage counting: a request the counter cannot copy or read still reaches the handler", async () => {
  resetUsage();
  const wrapped = withInitializeCount(async () => new Response("ok"), ON);
  const used = post(initialize("Claude-AI"));
  await used.text(); // body already used: clone() throws
  assert.equal(await (await wrapped(used)).text(), "ok");
  const big = post(initialize("Big-Client"), { "content-length": String(10 * 1024 * 1024) });
  assert.equal(await (await wrapped(big)).text(), "ok");
  await settle();
  assert.equal(pendingUsage().length, 0);
});

// ====================================================================================================================
// 4. A short coverage answer by default; the full detail per category and/or country
// ====================================================================================================================

const coverageSpec = () => buildToolSpecs(LIVE_DEPS).find((s) => s.name === COVERAGE_TOOL)!;

test("pricepaid_coverage: the default answer is a short overview (under 20,000 characters, text and structuredContent)", async () => {
  const spec = coverageSpec();
  const out = await spec.call({});
  assert.ok(!out.isError, out.content[0].text);
  const text = out.content[0].text;
  const sc: any = out.structuredContent;
  assert.ok(text.length < 20_000, `text is ${text.length} characters`);
  assert.ok(JSON.stringify(sc).length < 20_000, "structuredContent travels as compact JSON");
  assert.ok(spec.config.outputSchema.safeParse(sc).success, JSON.stringify((spec.config.outputSchema.safeParse(sc) as any).error?.issues));
  assert.equal(spec.config.outputSchema, coverageToolSchema);
  assert.equal(sc.detail, "summary");
  assert.equal(sc.full_coverage_url, "https://proofprice.com/api/v1/coverage");
  assert.match(sc.summary, /https:\/\/proofprice\.com\/api\/v1\/coverage/);
  assert.ok(text.startsWith(sc.summary));
  assert.equal(sc.source_count, SOURCE_PLUGINS.length);
  assert.equal(sc.tools.length, CATEGORIES.length);
  for (const cat of CATEGORIES) {
    const t = sc.tools.find((x: any) => x.name === cat.tool);
    assert.ok(t, cat.tool);
    assert.equal(t.category, cat.id);
    assert.equal(t.rest, `/api/v1/${cat.restPath}`);
    assert.deepEqual(t.countries, countriesFor(cat.id));
    assert.equal(t.source_count, sourcesFor(cat.id).length);
    assert.ok(t.update_frequency.length > 3, cat.tool);
  }
  // none of the long per-source detail is in the overview
  assert.equal(sc.sources, undefined);
  assert.equal(sc.examples, undefined);
  assert.ok(!/"(attribution|licence_url|what_is_recorded|limits|publisher)":/.test(text), "no per-source fields in the overview");
  assert.ok(sc.rules.length > 0 && sc.coming_next.length > 0);
});

test("pricepaid_coverage: keeps its name, title and the four read-only hints; both arguments are optional", () => {
  const spec = coverageSpec();
  assert.equal(spec.name, "pricepaid_coverage");
  assert.equal(spec.config.title, "What price data is covered");
  assert.deepEqual(spec.config.annotations, { title: "What price data is covered", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true });
  assert.ok(spec.config.inputSchema.safeParse({}).success);
  assert.ok(spec.config.inputSchema.safeParse({ category: "fuel", country: "IE" }).success);
  assert.match(spec.config.description, /category and\/or country/);
  assert.match(spec.config.description, /https:\/\/proofprice\.com\/api\/v1\/coverage/);
  for (const cat of CATEGORIES) assert.ok(spec.config.inputSchema.shape.category.description!.includes(cat.id), cat.id);
});

test("pricepaid_coverage: a category returns every one of its sources in full, with their examples", async () => {
  for (const key of ["fuel", "pricepaid_fuel_prices_now", "/api/v1/fuel", "FUEL"]) {
    const out = await coverageSpec().call({ category: key });
    assert.ok(!out.isError, `${key}: ${out.content[0].text}`);
    const sc: any = out.structuredContent;
    assert.equal(sc.detail, "full");
    assert.deepEqual(sc.filter, { category: "fuel" });
    assert.deepEqual(sc.sources.map((s: any) => s.id), sourcesFor("fuel").map((s) => s.info.id));
    for (const s of sc.sources) {
      const plugin = SOURCE_PLUGINS.find((p) => p.info.id === s.id)!;
      assert.deepEqual({ ...s }, { ...plugin.info, tool: fuelCat.tool, countries: plugin.countries, status: plugin.status });
      for (const field of ["publisher", "licence", "licence_url", "attribution", "limits", "freshness"]) assert.ok(s[field], `${s.id}.${field}`);
    }
    assert.equal(sc.tools.length, 1);
    assert.equal(sc.tools[0].name, fuelCat.tool);
    assert.equal(sc.source_count, sc.sources.length);
    assert.ok(sc.examples.length >= sc.sources.length && sc.examples.every((e: string) => e.startsWith("/api/v1/fuel?")));
    assert.ok(coverageSpec().config.outputSchema.safeParse(sc).success);
  }
});

test("pricepaid_coverage: a country returns the sources that cover it (a country name or UK works too); category and country narrow it", async () => {
  const ie: any = (await coverageSpec().call({ country: "ie" })).structuredContent;
  const expectedIe = SOURCE_PLUGINS.filter((s) => s.countries.includes("IE")).map((s) => s.info.id);
  assert.deepEqual(ie.sources.map((s: any) => s.id).sort(), expectedIe.sort());
  assert.ok(ie.tools.length > 1 && ie.tools.every((t: any) => t.countries.includes("IE")));
  assert.deepEqual(ie.filter, { country: "IE" });

  const gb: any = (await coverageSpec().call({ country: "UK" })).structuredContent;
  assert.deepEqual(gb.filter, { country: "GB" });
  assert.deepEqual(gb.sources.map((s: any) => s.id).sort(), SOURCE_PLUGINS.filter((s) => s.countries.includes("GB")).map((s) => s.info.id).sort());

  const es: any = (await coverageSpec().call({ category: "fuel", country: "ES" })).structuredContent;
  assert.deepEqual(es.sources.map((s: any) => s.id), ["es-fuel"]);
  assert.deepEqual(es.tools.map((t: any) => [t.name, t.countries, t.source_count]), [[fuelCat.tool, ["ES"], 1]]);
  assert.deepEqual(es.examples, exampleUrls().filter((e) => e.source === "es-fuel").map((e) => e.path));
});

test("pricepaid_coverage: a country or category nothing covers is an answer, not an error; unknown values are plain input errors", async () => {
  const none = await coverageSpec().call({ country: "ZZ" });
  assert.ok(!none.isError);
  const sc: any = none.structuredContent;
  assert.deepEqual(sc.sources, []);
  assert.deepEqual(sc.tools, []);
  assert.match(sc.summary, /^No ProofPrice source covers country ZZ\. Countries covered: (?:GB, )?AT,/);
  assert.ok(coverageSpec().config.outputSchema.safeParse(sc).success);
  const noFuel: any = (await coverageSpec().call({ category: "cars", country: "IE" })).structuredContent;
  assert.match(noFuel.summary, /^No ProofPrice source covers category cars, country IE\. Countries covered for cars: SG\.$/);

  const badCat = await coverageSpec().call({ category: "spaceships" });
  assert.equal(badCat.isError, true);
  assert.match(badCat.content[0].text, /^Could not answer: category must be one of: (?:border-prices, )?broadband, cars,/);
  const badCountry = await coverageSpec().call({ country: "Atlantis" });
  assert.equal(badCountry.isError, true);
  assert.match(badCountry.content[0].text, /country must be an ISO country code/);
  assert.throws(() => coverageView({ country: "Atlantis" }), InputError);
});

test("GET /api/v1/coverage is unchanged: every source in full and the example list the smoke test reads", () => {
  const rest = coverage();
  assert.deepEqual(Object.keys(rest), ["service", "purpose", "tools", "sources", "examples", "rules", "coming_next"]);
  assert.equal(rest.sources.length, SOURCE_PLUGINS.length);
  assert.deepEqual(rest.sources, SOURCE_PLUGINS.map((s) => s.info));
  assert.deepEqual(rest.examples, exampleUrls().map((e) => e.path));
  assert.deepEqual(rest.tools, CATEGORIES.map((c) => ({ name: c.tool, rest: `/api/v1/${c.restPath}`, countries: sourcesFor(c.id).map((s) => s.info.country) })));
  assert.ok(JSON.stringify(rest).length > 100_000, "the REST answer stays the complete list");
});

test("updateFrequency: the first sentence, cut before a long aside, never in the middle of a word", () => {
  assert.equal(updateFrequency("Monthly. The newest month is marked provisional."), "Monthly");
  assert.equal(updateFrequency("Two bidding rounds a month; updated after each round"), "Two bidding rounds a month; updated after each round");
  const long = "Annual figures with a lag of about two years (newest year 2024, dataset updated May 2026); each answer states its reference year";
  assert.equal(updateFrequency(long), "Annual figures with a lag of about two years…");
  const noAside = "Quarterly, published about three and a half months after the quarter ends and revised once more in the following quarter by the office";
  const cut = updateFrequency(noAside);
  assert.ok(cut.length <= 101 && cut.endsWith("…") && noAside.startsWith(cut.slice(0, -1)), cut);
  assert.ok(!/\s…$/.test(cut));
  assert.equal(updateFrequency("  Daily \n updates  "), "Daily updates");
});

// ====================================================================================================================
// 5. Through the real MCP handler: no stream is left open
// ====================================================================================================================

const modernMeta = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientInfo": { name: "t", version: "1" },
  "io.modelcontextprotocol/clientCapabilities": {},
};

/** Read a whole response, or report that it was still open after `ms`. */
async function readAll(res: Response, ms: number): Promise<string | "STILL OPEN"> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  const deadline = Date.now() + ms;
  for (;;) {
    const left = deadline - Date.now();
    const next = await Promise.race([reader.read(), sleep(Math.max(left, 0)).then(() => null)]);
    if (next === null) {
      void reader.cancel().catch(() => {});
      return "STILL OPEN";
    }
    if (next.done) return text;
    text += decoder.decode(next.value);
  }
}

test("the server says it never sends tool-list changes (tools.listChanged is false)", async () => {
  const handler = createProofPriceMcpHandler({ ...LIVE_DEPS, historyDays: () => 0 });
  const res = await handler(post(initialize("t")));
  const text = await readAll(res, 3000);
  assert.notEqual(text, "STILL OPEN");
  const data = (text as string).split("\n").find((l) => l.startsWith("data: "));
  const result = JSON.parse(data ? data.slice(6) : (text as string)).result;
  assert.equal(result.serverInfo.name, "proofprice");
  assert.deepEqual(result.capabilities.tools, { listChanged: false });
});

test("subscriptions/listen is acknowledged with nothing to subscribe to and closed at once, not held open until the platform kills it", async () => {
  const log = mock.method(console, "log", () => {});
  try {
    const handler = createProofPriceMcpHandler({ ...LIVE_DEPS, historyDays: () => 0 });
    const started = Date.now();
    const res = await handler(
      post(
        { jsonrpc: "2.0", id: 7, method: "subscriptions/listen", params: { notifications: { toolsListChanged: true }, _meta: modernMeta } },
        { "mcp-protocol-version": "2026-07-28", "mcp-method": "subscriptions/listen" },
      ),
    );
    assert.equal(res.status, 200);
    const text = await readAll(res, 3000);
    assert.notEqual(text, "STILL OPEN", "the listen stream was held open");
    assert.ok(Date.now() - started < 3000);
    const frames = (text as string).split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)));
    assert.equal(frames[0].method, "notifications/subscriptions/acknowledged");
    assert.deepEqual(frames[0].params.notifications, {}); // nothing honoured
    assert.equal(frames.at(-1).id, 7);
    assert.equal(frames.at(-1).result.resultType, "complete");
    // the logs show that a client asked
    assert.ok(log.mock.calls.some((c) => /^\[mcp\] subscriptions\/listen received/.test(String(c.arguments[0]))));
  } finally {
    log.mock.restore();
  }
});

test("through the real handler: the coverage tool lists optional category and country, and answers short by default", async () => {
  const handler = createProofPriceMcpHandler({ ...LIVE_DEPS, historyDays: () => 0 });
  const rpc = async (method: string, params: unknown): Promise<any> => {
    const text = (await readAll(await handler(post({ jsonrpc: "2.0", id: 1, method, params })), 5000)) as string;
    const data = text.split("\n").find((l) => l.startsWith("data: "));
    return JSON.parse(data ? data.slice(6) : text);
  };
  const tool = (await rpc("tools/list", {})).result.tools.find((t: any) => t.name === "pricepaid_coverage");
  assert.deepEqual(Object.keys(tool.inputSchema.properties).sort(), ["category", "country"]);
  assert.ok(!tool.inputSchema.required || tool.inputSchema.required.length === 0);
  assert.equal(tool.outputSchema.type, "object");
  const short = (await rpc("tools/call", { name: "pricepaid_coverage", arguments: {} })).result;
  assert.equal(short.structuredContent.detail, "summary");
  assert.ok(short.content[0].text.length < 20_000);
  const slice = (await rpc("tools/call", { name: "pricepaid_coverage", arguments: { category: "fuel", country: "FR" } })).result;
  assert.deepEqual(slice.structuredContent.sources.map((s: any) => s.id), ["fr-fuel"]);
  const bad = (await rpc("tools/call", { name: "pricepaid_coverage", arguments: { category: "nonsense" } })).result;
  assert.equal(bad.isError, true);
});

test("logMcpEvent: a subscription request and a slow non-tool request are logged by method name only", () => {
  const log = mock.method(console, "log", () => {});
  const warn = mock.method(console, "warn", () => {});
  try {
    logMcpEvent({ type: "REQUEST_RECEIVED", method: "tools/list", parameters: { secret: 1 } } as any);
    logMcpEvent({ type: "REQUEST_COMPLETED", method: "tools/call", duration: 60_000 } as any); // a tool call: guarded() logs it by tool name
    logMcpEvent({ type: "REQUEST_COMPLETED", method: "tools/list", duration: 100 } as any);
    assert.equal(log.mock.calls.length + warn.mock.calls.length, 0);
    logMcpEvent({ type: "REQUEST_COMPLETED", method: "tools/list", duration: SLOW_CALL_MS + 1, parameters: { secret: 1 } } as any);
    assert.deepEqual(warn.mock.calls.map((c) => c.arguments), [[`[slow-mcp-request] tools/list took ${SLOW_CALL_MS + 1} ms`]]);
    logMcpEvent({ type: "ERROR", error: new Error("x") } as any);
    assert.equal(warn.mock.calls.length, 1);
  } finally {
    log.mock.restore();
    warn.mock.restore();
  }
});

test("the route mounts the wrapped handler: POST and GET exist, maxDuration is 60", async () => {
  const route = await import("../app/api/mcp/route");
  assert.equal(typeof route.POST, "function");
  assert.equal(route.GET, route.POST);
  assert.equal(route.maxDuration, 60);
  const res = await route.POST(post(initialize("route-test")));
  assert.equal(res.status, 200);
  assert.match((await readAll(res, 3000)) as string, /"serverInfo":\{"name":"proofprice"/);
});
