// Platform 0.4.0: the service version, a validated OpenAPI document, MCP tools with titles, annotations, outputSchema and
// structuredContent, stale-if-error from the price library, and "new categories appear everywhere with no edit".
// No test here needs the network: tool handlers run against fixture answers, the library is a temp folder.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const libDir = mkdtempSync(path.join(tmpdir(), "pp-platform-"));
process.env.PROOFPRICE_LIBRARY_DIR = libDir;

import { buildAnswer, buildStatisticAnswer } from "../lib/answer";
import type { PriceAnswer } from "../lib/answer";
import { InputError, SourceError, isSourceOutage } from "../lib/http";
import { writeDaily, writeMeta } from "../lib/library/store";
import { LIVE_DEPS, buildToolSpecs, createProofPriceMcpHandler } from "../lib/mcp-tools";
import type { ToolDeps } from "../lib/mcp-tools";
import { buildLlmsTxt, buildOpenApi } from "../lib/openapi";
import { buildLlmsFullTxt, buildServerJson, buildSitemap, SERVER_DESCRIPTION } from "../lib/open-book";
import {
  CATEGORIES, COMING_NEXT, SOURCE_PLUGINS, categoryById, countriesFor, coverage, exampleUrls, historySources, paramsFromQuery, runCategory, sourcesFor,
} from "../lib/registry";
import { coverageToolSchema, historyAnswerSchema, priceAnswerSchema } from "../lib/schemas";
import { SERVICE_VERSION } from "../lib/site/constants";
import { groupByCategory, sourceCards } from "../lib/site/sources";
import { STALE_MAX_DAYS, staleAnswer } from "../lib/stale";
import { summarise } from "../lib/stats";
import { answerResponse } from "../lib/route-helpers";

const BASE = "https://example.test";
const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

// ---------- a library with two fuel sources, two days each ----------

const itSrc = SOURCE_PLUGINS.find((s) => s.info.id === "it-fuel")!;
const esSrc = SOURCE_PLUGINS.find((s) => s.info.id === "es-fuel")!;
const fuelCat = categoryById("fuel")!;
const IT_PARAMS = { country: "IT", area: "MI", fuel: "diesel" };
const ES_PARAMS = { country: "ES", area: "28", fuel: "diesel" };
// the parameters a source's historyKey sees: after the category's own normalisation, as runCategory passes them
const prepared = (p: Record<string, unknown>) => fuelCat.prepare!({ ...p });

const r3 = (v: number) => Math.round(v * 1000) / 1000;

function seedLibrary(source: string, key: { area: string; item: string }, dates: string[], median: number, n = 60) {
  dates.forEach((date, i) => {
    const m = r3(median + i / 100); // each later day is a cent dearer
    writeDaily(source, {
      date,
      currency: "EUR",
      unit: "per litre",
      rows: [{ area: key.area, item: key.item, n, median: m, low: r3(m - 0.05), high: r3(m + 0.1), min: r3(m - 0.2), max: r3(m + 0.3) }],
    });
  });
  writeMeta(source, {
    source,
    currency: "EUR",
    unit: "per litre",
    first_date: dates[0],
    last_date: dates[dates.length - 1],
    days: dates.length,
    last_harvest_at: null,
    last_rows: 1,
    last_ok_at: null,
    last_error: null,
  });
}

const itKey = itSrc.historyKey!(prepared(IT_PARAMS))!;
const esKey = esSrc.historyKey!(prepared(ES_PARAMS))!;
seedLibrary("it-fuel", itKey, [day(-3), day(-1)], 1.8);
seedLibrary("es-fuel", esKey, [day(-2), day(-1)], 1.5);

// ---------- fixtures: every kind of answer a tool can return ----------

function fixtures(catId: string): Record<string, PriceAnswer> {
  const source = sourcesFor(catId)[0].info;
  const base = { source, query: { country: "XX" }, currency: "EUR", unit: "per unit", period: { from: "2026-09-01", to: "2026-10-01" }, method: "m", baseUrl: BASE };
  const prices = Array.from({ length: 30 }, (_, i) => 100 + i);
  return {
    range: buildAnswer({ ...base, summary: summarise(prices), describe: (s) => `The median is ${s.median}.`, extra: { stations: [{ name: "x" }] } }),
    insufficient: buildAnswer({ ...base, summary: summarise([100, 101, 102]), describe: () => "unused" }),
    none: buildAnswer({ ...base, summary: null, describe: () => "unused" }),
    statistic: buildStatisticAnswer({ ...base, value: 0.31, measure: "average", reference_period: "2026-S1", describe: (v) => `Households paid ${v}.` }),
    statisticNone: buildStatisticAnswer({ ...base, value: null, measure: "average", reference_period: "", describe: () => "unused" }),
  };
}

// ====================================================================================================================
// 1. Version 0.4.0 everywhere
// ====================================================================================================================

test("the service version is 0.4.0 in OpenAPI, MCP serverInfo and server.json", async () => {
  assert.equal(SERVICE_VERSION, "0.4.0");
  assert.equal(buildOpenApi(BASE).info.version, "0.4.0");
  const file = JSON.parse(readFileSync(new URL("../server.json", import.meta.url), "utf8"));
  assert.equal(file.version, "0.4.0");
  assert.deepEqual(file, buildServerJson("0.4.0"));
  const res = await createProofPriceMcpHandler()(
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } }),
    }),
  );
  assert.match(await res.text(), /"serverInfo":\{"name":"proofprice","version":"0\.4\.0"\}/);
});

test("server.json: the registry description is at most 100 characters and links the public integration repo", () => {
  const file = JSON.parse(readFileSync(new URL("../server.json", import.meta.url), "utf8"));
  assert.equal(file.description, "Prices people actually paid, from official open data: homes, rents, fuel, energy, food, medicines.");
  assert.equal(SERVER_DESCRIPTION, file.description);
  assert.ok(file.description.length <= 100);
  assert.deepEqual(file.repository, { url: "https://github.com/Screed369/proofprice-mcp", source: "github" });
});

test("coming next lists the work in progress", () => {
  assert.deepEqual(COMING_NEXT, [
    "More countries and more kinds of price, one official source at a time (see the sources list for what is live)",
    "Verified receipts",
  ]);
  assert.deepEqual(coverage().coming_next, COMING_NEXT);
  assert.ok(buildLlmsFullTxt(BASE).includes("- Verified receipts"));
});

// ====================================================================================================================
// 2. OpenAPI
// ====================================================================================================================

test("openapi.json is a valid OpenAPI 3.1 document (real validator)", async () => {
  const { validate } = await import("@readme/openapi-parser");
  const spec = JSON.parse(JSON.stringify(buildOpenApi(BASE)));
  const result: any = await validate(spec);
  assert.equal(result.valid, true, JSON.stringify(result.errors ?? result, null, 1).slice(0, 2000));
});

test("openapi: licence, logo, description of the data licences, and tags", () => {
  const spec: any = buildOpenApi(BASE);
  assert.deepEqual(spec.info.license, { name: "ProofPrice terms of use", url: "https://proofprice.com/terms" });
  assert.deepEqual(spec.info["x-logo"], { url: "https://proofprice.com/icon-512.png" });
  assert.equal(spec.info.termsOfService, "https://proofprice.com/terms");
  assert.match(spec.info.description, /keeps each source's own licence/);
  assert.equal(spec.components.schemas.PriceAnswer.additionalProperties, true, "extra properties are allowed");
  assert.deepEqual(spec.components.schemas.PriceAnswer.required, ["query", "status", "source", "summary", "notice"]);
  const tagNames: string[] = spec.tags.map((t: any) => t.name);
  assert.equal(new Set(tagNames).size, tagNames.length, "tag names are unique");
  for (const t of spec.tags) assert.ok(t.description, `tag ${t.name} has a description`);
});

test("openapi: every category appears with its path, tag, history and typed responses, with no edit needed", () => {
  const spec: any = buildOpenApi(BASE);
  const tagNames = new Set<string>(spec.tags.map((t: any) => t.name));
  const ids = new Set<string>();
  for (const cat of CATEGORIES) {
    const op = spec.paths[`/api/v1/${cat.restPath}`]?.get;
    assert.ok(op, `${cat.id}: missing path`);
    assert.deepEqual(op.tags, [cat.title], `${cat.id}: tagged with its title`);
    assert.ok(tagNames.has(cat.title), `${cat.id}: has a tag`);
    assert.deepEqual(op.parameters.find((p: any) => p.name === "country").schema.enum, countriesFor(cat.id));
    assert.deepEqual(op.responses["200"].content["application/json"].schema, { $ref: "#/components/schemas/PriceAnswer" });
    if (cat.history) {
      const h = spec.paths[`/api/v1/${cat.restPath}/history`]?.get;
      assert.ok(h, `${cat.id}: missing history path`);
      assert.deepEqual(h.tags, [cat.title]);
      assert.deepEqual(h.responses["200"].content["application/json"].schema, { $ref: "#/components/schemas/HistoryAnswer" });
    }
  }
  for (const [p, item] of Object.entries<any>(spec.paths)) {
    for (const op of Object.values<any>(item)) {
      assert.match(op.operationId, /^[a-z][A-Za-z0-9]*$/, p);
      assert.ok(!ids.has(op.operationId), `duplicate operationId ${op.operationId}`);
      ids.add(op.operationId);
      for (const t of op.tags) assert.ok(tagNames.has(t), `${p}: tag ${t} is declared`);
    }
  }
  assert.equal(spec.paths["/api/v1/coverage"].get.responses["200"].content["application/json"].schema.$ref, "#/components/schemas/Coverage");
});

test("openapi: the history operations are named and worded for REST, and never claim a 502", () => {
  const spec: any = buildOpenApi(BASE);
  const h = spec.paths["/api/v1/fuel/history"].get;
  assert.equal(h.operationId, "fuelPriceHistory");
  assert.ok(!/pricepaid_/.test(h.description + h.summary), "tool names are replaced by REST paths");
  assert.match(h.description, /today's cheapest stations/);
  assert.ok(!/October 2026/.test(h.summary), "no stale 'building up from October 2026' text");
  assert.ok(!("502" in h.responses), "history reads the library and never calls the source");
  assert.ok("400" in h.responses);
  const countries: string[] = h.parameters.find((p: any) => p.name === "country").schema.enum;
  assert.deepEqual(countries, [...new Set(historySources(fuelCat).flatMap((s) => s.countries))]);
  assert.equal(h.parameters.find((p: any) => p.name === "days").schema.default, 30);
  const live = spec.paths["/api/v1/fuel"].get;
  assert.ok(!/pricepaid_/.test(live.description), "the live description names no MCP tool either");
  assert.match(live.responses["200"].description, /extra\.stale is true/);
  assert.ok(live.responses["200"].headers["X-ProofPrice-Stale"]);
});

// ====================================================================================================================
// 3. MCP tools: titles, annotations, outputSchema, structuredContent
// ====================================================================================================================

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

function fakeDeps(current: { answer: PriceAnswer }): ToolDeps {
  return { ...LIVE_DEPS, runCategory: async () => current.answer, historyDays: () => 999 };
}

test("every tool has a human title, the four read-only annotations and an outputSchema", () => {
  const specs = buildToolSpecs({ ...LIVE_DEPS, historyDays: () => 999 });
  const names = specs.map((s) => s.name);
  for (const cat of CATEGORIES) {
    assert.ok(names.includes(cat.tool), cat.tool);
    if (cat.history) assert.ok(names.includes(cat.history.tool), cat.history.tool);
  }
  assert.ok(names.includes("pricepaid_coverage"));
  assert.equal(new Set(names).size, names.length);
  for (const s of specs) {
    assert.ok(s.config.title.length >= 3 && !/^pricepaid_/.test(s.config.title), `${s.name}: human title`);
    assert.equal(s.config.annotations.title, s.config.title);
    const { title, ...hints } = s.config.annotations;
    assert.deepEqual(hints, READ_ONLY, s.name);
    assert.ok(s.config.outputSchema, `${s.name}: outputSchema`);
  }
});

test("the history tool is hidden until the library holds enough days", () => {
  const few = buildToolSpecs({ ...LIVE_DEPS, historyDays: () => 1 }).map((s) => s.name);
  assert.ok(!few.includes(fuelCat.history!.tool));
  const enough = buildToolSpecs({ ...LIVE_DEPS, historyDays: () => fuelCat.history!.minDays }).map((s) => s.name);
  assert.ok(enough.includes(fuelCat.history!.tool));
});

test("every category tool handler returns structuredContent that matches its outputSchema, for every kind of answer", async () => {
  for (const cat of CATEGORIES) {
    const variants = fixtures(cat.id);
    for (const [kind, answer] of Object.entries(variants)) {
      const spec = buildToolSpecs(fakeDeps({ answer })).find((s) => s.name === cat.tool)!;
      const result = await spec.call({ country: "XX" });
      assert.ok(!result.isError, `${cat.tool}/${kind}`);
      assert.ok(result.structuredContent, `${cat.tool}/${kind}: structuredContent`);
      const parsed = spec.config.outputSchema.safeParse(result.structuredContent);
      assert.ok(parsed.success, `${cat.tool}/${kind}: ${parsed.success ? "" : JSON.stringify(parsed.error.issues)}`);
      assert.equal(result.structuredContent!.status, answer.status);
      assert.equal(result.content[0].type, "text");
      assert.ok(result.content[0].text.startsWith(answer.summary), `${cat.tool}/${kind}: text starts with the summary`);
      assert.deepEqual(JSON.parse(result.content[0].text.slice(answer.summary.length + 2)), JSON.parse(JSON.stringify(answer)));
    }
  }
});

test("a stale-if-error answer is a valid tool result too", async () => {
  const stale = staleAnswer({ cat: fuelCat, src: itSrc, params: prepared(IT_PARAMS), query: IT_PARAMS, error: new SourceError("Source timed out") })!;
  assert.ok(stale);
  const spec = buildToolSpecs(fakeDeps({ answer: stale })).find((s) => s.name === fuelCat.tool)!;
  const result = await spec.call(IT_PARAMS);
  assert.ok(spec.config.outputSchema.safeParse(result.structuredContent).success);
});

test("the history and coverage tool handlers return structuredContent that matches their outputSchema", async () => {
  const specs = buildToolSpecs({ ...LIVE_DEPS, historyDays: () => 999 });
  const history = specs.find((s) => s.name === fuelCat.history!.tool)!;
  assert.equal(history.config.outputSchema, historyAnswerSchema);
  const ok = await history.call({ ...ES_PARAMS, days: 30 });
  assert.ok(!ok.isError, ok.content[0].text);
  assert.equal(ok.structuredContent!.status, "ok");
  assert.ok(history.config.outputSchema.safeParse(ok.structuredContent).success);
  const empty = await history.call({ country: "FR", postcode: "75015", fuel: "diesel" }); // no library rows for France here
  assert.equal(empty.structuredContent!.status, "no_history_yet");
  assert.ok(history.config.outputSchema.safeParse(empty.structuredContent).success);

  const cov = specs.find((s) => s.name === "pricepaid_coverage")!;
  assert.equal(cov.config.outputSchema, coverageToolSchema);
  const covResult = await cov.call({});
  assert.ok(cov.config.outputSchema.safeParse(covResult.structuredContent).success);
  const slice = await cov.call({ category: "fuel", country: "ES" }); // a slice: full per-source detail
  assert.ok(cov.config.outputSchema.safeParse(slice.structuredContent).success);
});

test("tool answers carry absolute method links (an agent cannot follow /method)", async () => {
  let seen: unknown;
  const deps: ToolDeps = { ...LIVE_DEPS, historyDays: () => 999, runCategory: async (_c, _p, ctx) => ((seen = ctx), fixtures("fuel").range) };
  await buildToolSpecs(deps).find((s) => s.name === fuelCat.tool)!.call(ES_PARAMS);
  assert.deepEqual(seen, { baseUrl: "https://proofprice.com" });
  const history = await buildToolSpecs({ ...LIVE_DEPS, historyDays: () => 999 }).find((s) => s.name === fuelCat.history!.tool)!.call(ES_PARAMS);
  assert.equal((history.structuredContent as any).method_url, "https://proofprice.com/method");
});

test("errors come back as isError results with a plain message and no structuredContent", async () => {
  const deps: ToolDeps = { ...LIVE_DEPS, runCategory: async () => { throw new InputError("country is required"); } };
  const spec = buildToolSpecs(deps).find((s) => s.name === fuelCat.tool)!;
  const result = await spec.call({});
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent, undefined);
  assert.match(result.content[0].text, /^Could not answer: country is required/);
});

test("through the real MCP handler: tools/list advertises titles, annotations and outputSchemas; tools/call returns validated structuredContent", async () => {
  const current = { answer: fixtures("fuel").range };
  const handler = createProofPriceMcpHandler(fakeDeps(current));
  let id = 0;
  const rpc = async (method: string, params: unknown): Promise<any> => {
    const res = await handler(
      new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
      }),
    );
    const text = await res.text();
    const data = text.split("\n").find((l) => l.startsWith("data: "));
    return JSON.parse(data ? data.slice(6) : text);
  };
  const list = (await rpc("tools/list", {})).result.tools as any[];
  assert.equal(list.length, buildToolSpecs(fakeDeps(current)).length);
  for (const t of list) {
    assert.ok(t.title, t.name);
    assert.deepEqual({ ...t.annotations, title: undefined }, { ...READ_ONLY, title: undefined }, t.name);
    assert.equal(t.outputSchema.type, "object", `${t.name}: outputSchema is an object schema`);
    assert.ok(Array.isArray(t.outputSchema.required) && t.outputSchema.required.length > 0, t.name);
    assert.notEqual(t.outputSchema.additionalProperties, false, `${t.name}: extra properties allowed`);
  }
  // Every category tool, called with its first working example, for each kind of answer.
  for (const cat of CATEGORIES) {
    const ex = exampleUrls().find((e) => e.category === cat.id)!;
    const args = paramsFromQuery(cat, new URLSearchParams(ex.path.split("?")[1]));
    for (const [kind, answer] of Object.entries(fixtures(cat.id))) {
      current.answer = answer;
      const out = (await rpc("tools/call", { name: cat.tool, arguments: args })).result;
      assert.ok(!out.isError, `${cat.tool}/${kind}: ${out.content?.[0]?.text}`);
      assert.equal(out.structuredContent.status, answer.status, `${cat.tool}/${kind}`);
      assert.equal(out.structuredContent.source.id, answer.source.id);
    }
  }
  const cov = (await rpc("tools/call", { name: "pricepaid_coverage", arguments: {} })).result;
  assert.ok(Array.isArray(cov.structuredContent.tools) && cov.structuredContent.tools.length === CATEGORIES.length);
});

test("the SDK refuses structuredContent that breaks the outputSchema (so the schema is really enforced)", async () => {
  const broken = { ...fixtures("fuel").range, status: "maybe" } as unknown as PriceAnswer;
  const handler = createProofPriceMcpHandler(fakeDeps({ answer: broken }));
  const res = await handler(
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: fuelCat.tool, arguments: { ...ES_PARAMS } } }),
    }),
  );
  assert.match(await res.text(), /Output validation error/);
});

test("the answer schema is permissive: it allows extra properties and requires only what every answer has", () => {
  const minimal = { query: {}, status: "no_matches", source: { id: "x", name: "x", publisher: "x", licence: "x", licence_url: "x", attribution: "x", url: "x" }, summary: "s", notice: "n" };
  assert.ok(priceAnswerSchema.safeParse(minimal).success);
  assert.ok(priceAnswerSchema.safeParse({ ...minimal, price: null, new_field: { anything: [1, 2] }, extra: { a: 1 } }).success);
  assert.ok(!priceAnswerSchema.safeParse({ ...minimal, status: "weird" }).success);
  const { summary, ...noSummary } = minimal;
  assert.ok(!priceAnswerSchema.safeParse(noSummary).success);
});

// ====================================================================================================================
// 4. Stale-if-error
// ====================================================================================================================

function withHandle<T>(src: (typeof SOURCE_PLUGINS)[number], fn: () => Promise<never> | never, body: () => Promise<T>): Promise<T> {
  const original = src.handle;
  src.handle = (async () => fn()) as any;
  return body().finally(() => {
    src.handle = original;
  });
}

test("isSourceOutage: timeouts, unreachable sources and 5xx are outages; bad input and other failures are not", () => {
  for (const e of [
    new SourceError("Source timed out"),
    new SourceError("MIMIT timed out"),
    new SourceError("MIMIT returned HTTP 503"),
    new SourceError("Could not reach the official source", "ENOTFOUND"),
    new SourceError("Source returned HTTP 500", "", 500),
    new SourceError("The Agri-food data portal is limiting requests at the moment; try again in a minute"),
    Object.assign(new Error("aborted"), { name: "AbortError" }),
    Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } }),
  ])
    assert.equal(isSourceOutage(e), true, e.message);
  for (const e of [
    new InputError("A town is required."),
    new SourceError("Give an Italian town (comune) or a 2-letter province code"),
    new SourceError("DVF file returned HTTP 404"),
    new SourceError("Unexpected response from data.gov.sg"),
    new SourceError("Source returned HTTP 404", "", 404),
    new Error("boom"),
    null,
  ])
    assert.equal(isSourceOutage(e), false, String((e as any)?.message));
});

test("stale-if-error: a timeout is answered from the newest recent snapshot, in the one answer format", async (t) => {
  t.mock.method(console, "warn", () => {});
  const answer = await withHandle(itSrc, () => { throw new SourceError("MIMIT timed out"); }, () => runCategory(fuelCat, IT_PARAMS, { baseUrl: BASE }));
  const date = day(-1);
  assert.equal(answer.status, "ok");
  assert.equal(answer.as_of, date);
  assert.deepEqual(answer.period, { from: date, to: date });
  assert.equal(answer.price!.currency, "EUR");
  assert.equal(answer.price!.unit, "per litre");
  assert.equal(answer.price!.measure, "median");
  assert.equal(answer.price!.value, 1.81);
  assert.equal(answer.price!.median, 1.81);
  assert.equal(answer.price!.typical_low, 1.76);
  assert.equal(answer.price!.typical_high, 1.91);
  assert.equal(answer.sample_size, 60);
  assert.equal(answer.confidence, "high");
  assert.equal(answer.price_type, "posted_pump_price");
  assert.equal(answer.source.id, "it-fuel");
  assert.equal(answer.method_url, `${BASE}/method`);
  assert.ok(answer.notice.startsWith(`The official source did not respond; this is our copy from ${date}.`));
  assert.ok(answer.summary.includes(`The official source did not respond; this is our copy from ${date}.`));
  assert.ok(answer.summary.includes("province MI"), "says which area the copy covers");
  assert.equal(answer.extra!.stale, true);
  assert.equal(answer.extra!.snapshot_date, date);
  assert.equal(answer.extra!.live_source_error, "MIMIT timed out");
  assert.equal(answer.query.country, "IT");
  assert.ok(priceAnswerSchema.safeParse(answer).success);
});

test("stale-if-error: 5xx answers and network errors from any source with library data use the same path", async (t) => {
  t.mock.method(console, "warn", () => {});
  for (const make of [
    () => new SourceError("Source returned HTTP 502", "", 502),
    () => new SourceError("MIMIT returned HTTP 500"),
    () => new SourceError("Could not reach the official source", "ECONNREFUSED"),
    () => Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } }),
  ]) {
    const a = await withHandle(esSrc, () => { throw make(); }, () => runCategory(fuelCat, ES_PARAMS));
    assert.equal(a.status, "ok");
    assert.equal(a.extra!.stale, true);
    assert.equal(a.source.id, "es-fuel");
    assert.equal(a.as_of, day(-1));
  }
});

test("stale-if-error: the 502 stays when it should", async (t) => {
  t.mock.method(console, "warn", () => {});
  // bad input and 4xx are not outages
  await assert.rejects(withHandle(itSrc, () => { throw new InputError("Fuel 'x' is not published for Italy."); }, () => runCategory(fuelCat, IT_PARAMS)), /not published/);
  await assert.rejects(withHandle(itSrc, () => { throw new SourceError("MIMIT returned HTTP 404"); }, () => runCategory(fuelCat, IT_PARAMS)), /HTTP 404/);
  // an area the library holds nothing for
  await assert.rejects(
    withHandle(itSrc, () => { throw new SourceError("MIMIT timed out"); }, () => runCategory(fuelCat, { country: "IT", area: "RM", fuel: "diesel" })),
    /MIMIT timed out/,
  );
  // a source without library data (no harvest): the outage is reported as before
  const homes = categoryById("home-sales")!;
  const gb = SOURCE_PLUGINS.find((s) => s.info.id === "gb-hmlr-ppd")!;
  assert.equal(gb.harvest, undefined);
  await assert.rejects(withHandle(gb, () => { throw new SourceError("Source timed out"); }, () => runCategory(homes, { country: "GB", town: "Bristol" })), /Source timed out/);
});

test("stale-if-error: a snapshot older than a week is not recent, and thin days are never served", () => {
  const old = day(-(STALE_MAX_DAYS + 3));
  seedLibrary("fr-fuel", { area: "75", item: "diesel" }, [old], 1.7);
  const fr = SOURCE_PLUGINS.find((s) => s.info.id === "fr-fuel")!;
  const params = { country: "FR", postcode: "75015", fuel: "diesel" };
  assert.ok(fr.historyKey!(prepared(params)), "the key exists");
  const base = { cat: fuelCat, src: fr, params: prepared(params), query: params, error: new SourceError("Source timed out") };
  assert.equal(staleAnswer(base), null);
  // the same snapshot is fine when "today" is a few days after it
  assert.ok(staleAnswer({ ...base, today: new Date(Date.parse(old) + 2 * 86400000) }));
  // fewer than 5 records are never stored, let alone served
  writeDaily("fr-fuel", { date: day(-1), currency: "EUR", unit: "per litre", rows: [{ area: "75", item: "diesel", n: 3, median: 1.7, low: 1.6, high: 1.8, min: 1.5, max: 1.9 }] });
  assert.equal(staleAnswer(base), null);
});

test("stale-if-error: a national copy never stands in for a request about a smaller place", () => {
  const params = prepared({ country: "ES", town: "Madrid", fuel: "diesel" });
  const key = esSrc.historyKey!(params)!;
  assert.equal(key.area, "ALL", "this source keys a town request to the national row");
  seedLibrary("es-fuel", key, [day(-2), day(-1)], 1.5);
  assert.equal(staleAnswer({ cat: fuelCat, src: esSrc, params, query: params, error: new SourceError("Source timed out") }), null);
  // asked for the whole country, the national copy is right
  const national = prepared({ country: "ES", fuel: "diesel" });
  assert.ok(staleAnswer({ cat: fuelCat, src: esSrc, params: national, query: national, error: new SourceError("Source timed out") }));
});

test("stale-if-error: REST sends the copy with a short cache and an X-ProofPrice-Stale header; live answers keep the full cache", async () => {
  const stale = staleAnswer({ cat: fuelCat, src: itSrc, params: prepared(IT_PARAMS), query: IT_PARAMS, error: new SourceError("Source timed out") })!;
  const res = answerResponse(stale, 600);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("x-proofprice-stale"), `snapshot=${day(-1)}`);
  assert.match(res.headers.get("cache-control")!, /s-maxage=60,/);
  assert.equal(res.headers.get("access-control-expose-headers"), "x-proofprice-stale");
  const live = answerResponse(fixtures("fuel").range, 600);
  assert.equal(live.headers.get("x-proofprice-stale"), null);
  assert.match(live.headers.get("cache-control")!, /s-maxage=600,/);
});

test("stale-if-error: the REST route and the MCP tool both go through it", async (t) => {
  t.mock.method(console, "warn", () => {});
  const { GET } = await import("../app/api/v1/[category]/route");
  const ask = (url: string) => GET(new Request(url), { params: Promise.resolve({ category: "fuel" }) });
  const viaRest = await withHandle(itSrc, () => { throw new SourceError("MIMIT timed out"); }, () => ask(`${BASE}/api/v1/fuel?country=IT&area=MI&fuel=diesel`));
  assert.equal(viaRest.status, 200);
  assert.ok(viaRest.headers.get("x-proofprice-stale"));
  const body: any = await viaRest.json();
  assert.equal(body.status, "ok");
  assert.equal(body.extra.stale, true);
  assert.equal(body.method_url, `${BASE}/method`);

  const viaMcp = await withHandle(itSrc, () => { throw new SourceError("MIMIT timed out"); }, async () => {
    const spec = buildToolSpecs({ ...LIVE_DEPS, historyDays: () => 0 }).find((s) => s.name === fuelCat.tool)!;
    return spec.call(IT_PARAMS);
  });
  assert.ok(!viaMcp.isError);
  assert.equal((viaMcp.structuredContent as any).extra.stale, true);

  // and with no copy to fall back on, REST still says 502
  const down = await withHandle(itSrc, () => { throw new SourceError("MIMIT timed out"); }, () => ask(`${BASE}/api/v1/fuel?country=IT&area=RM&fuel=diesel`));
  assert.equal(down.status, 502);
});

// ====================================================================================================================
// 6. New categories and sources show up everywhere with no edit
// ====================================================================================================================

test("every category and source reaches llms.txt, llms-full.txt, the coverage list, the sources page and the sitemap automatically", () => {
  const llms = buildLlmsTxt(BASE);
  const full = buildLlmsFullTxt(BASE);
  const cov = coverage();
  for (const cat of CATEGORIES) {
    assert.ok(llms.includes(cat.tool), `llms.txt: ${cat.tool}`);
    assert.ok(llms.includes(`${BASE}/api/v1/${cat.restPath}`), `llms.txt: ${cat.restPath}`);
    assert.ok(full.includes(`### ${cat.tool}`), `llms-full.txt: ${cat.tool}`);
    assert.ok(cov.tools.some((x) => x.name === cat.tool && x.rest === `/api/v1/${cat.restPath}`), `coverage: ${cat.tool}`);
    if (cat.history) {
      assert.ok(llms.includes(`${BASE}/api/v1/${cat.restPath}/history?`), `llms.txt: ${cat.restPath} history`);
      assert.ok(full.includes(cat.history.tool), `llms-full.txt: ${cat.history.tool}`);
    }
  }
  for (const s of SOURCE_PLUGINS) {
    assert.ok(full.includes(`(${s.info.id})`), `llms-full.txt: ${s.info.id}`);
    assert.ok(cov.sources.some((x) => x.id === s.info.id), `coverage: ${s.info.id}`);
  }
  const cards = sourceCards();
  assert.deepEqual(cards.map((c) => c.id).sort(), SOURCE_PLUGINS.map((s) => s.info.id).sort());
  const groups = groupByCategory(cards);
  assert.deepEqual(groups.map((g) => g.categoryId).sort(), [...new Set(SOURCE_PLUGINS.map((s) => s.category))].sort());
  for (const g of groups) assert.ok(g.heading.trim().length > 1, `${g.categoryId}: has a heading`);
  const urls = buildSitemap("https://proofprice.com", new Date("2026-10-14T00:00:00Z"), { answerPages: [], indexPaths: [], newestDay: null }).map((e) => e.url);
  for (const p of ["/sources", "/openapi.json", "/llms.txt", "/llms-full.txt", "/api/v1/coverage", "/connect"]) assert.ok(urls.includes("https://proofprice.com" + p), p);
});
