import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AI_CRAWLERS,
  MCP_URL,
  MCP_REGISTRY_NAME,
  PUBLIC_PATHS,
  buildLlmsFullTxt,
  buildRobots,
  buildServerJson,
  buildSitemap,
  connectGuides,
} from "../lib/open-book";
import { buildLlmsTxt, buildOpenApi } from "../lib/openapi";
import { CATEGORIES, SOURCE_PLUGINS, exampleUrls, paramSchemas } from "../lib/registry";

const BASE = "https://example.test";

test("robots.txt welcomes every AI crawler and points at the sitemap", () => {
  const r = buildRobots("https://proofprice.com");
  const agents = r.rules.map((x) => x.userAgent);
  for (const bot of ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-User", "Claude-SearchBot", "PerplexityBot", "Perplexity-User", "Google-Extended", "Applebot-Extended", "CCBot", "Googlebot", "Bingbot", "*"]) {
    assert.ok(agents.includes(bot), bot);
  }
  assert.equal(AI_CRAWLERS.length, 13);
  assert.ok(r.rules.every((x) => x.allow === "/" && !("disallow" in x)));
  assert.equal(r.sitemap, "https://proofprice.com/sitemap.xml");
});

test("robots.txt leaves every public page open to every crawler, AI crawlers included", () => {
  const r = buildRobots("https://proofprice.com");
  for (const page of ["/sources", "/trust", "/status", "/prices", "/prices/es/fuel/madrid"]) {
    for (const rule of r.rules) {
      assert.equal(rule.allow, "/", `${rule.userAgent} may fetch ${page}`);
      assert.ok(!("disallow" in rule), `${rule.userAgent} has no disallow`);
    }
  }
});

test("sitemap lists the pages and the machine-readable files", () => {
  const urls = buildSitemap("https://proofprice.com", new Date("2026-10-13T00:00:00Z")).map((e) => e.url);
  for (const u of [
    "https://proofprice.com",
    "https://proofprice.com/connect",
    "https://proofprice.com/sources",
    "https://proofprice.com/trust",
    "https://proofprice.com/status",
    "https://proofprice.com/prices",
    "https://proofprice.com/method",
    "https://proofprice.com/llms.txt",
    "https://proofprice.com/llms-full.txt",
    "https://proofprice.com/openapi.json",
  ]) {
    assert.ok(urls.includes(u), u);
  }
  for (const p of PUBLIC_PATHS) assert.ok(urls.includes(p === "/" ? "https://proofprice.com" : `https://proofprice.com${p}`), p);
  assert.ok(urls.length > PUBLIC_PATHS.length, "answer pages are listed too");
  assert.equal(new Set(urls).size, urls.length);
});

test("sitemap adds the price indexes and every answer page, with a date and a sensible frequency", () => {
  const library = {
    answerPages: [
      { path: "/prices/es/fuel/madrid", category: "fuel", asOf: "2026-10-14" },
      { path: "/prices/ie/home-sales/dublin-6", category: "home-sales", asOf: "2026-10-02" },
    ],
    indexPaths: ["/prices/es", "/prices/es/fuel", "/prices/ie", "/prices/ie/home-sales"],
    newestDay: "2026-10-14",
  };
  const entries = buildSitemap("https://proofprice.com", new Date("2026-10-15T00:00:00Z"), library);
  const by = Object.fromEntries(entries.map((e) => [e.url, e]));
  assert.equal(by["https://proofprice.com/prices/es/fuel/madrid"].changeFrequency, "daily");
  assert.equal(by["https://proofprice.com/prices/es/fuel/madrid"].lastModified, "2026-10-14");
  assert.equal(by["https://proofprice.com/prices/ie/home-sales/dublin-6"].changeFrequency, "weekly");
  assert.equal(by["https://proofprice.com/prices/es/fuel"].lastModified, "2026-10-14");
  assert.equal(by["https://proofprice.com/prices/ie"].changeFrequency, "daily");
  assert.equal(entries.length, PUBLIC_PATHS.length + 4 + 2);
  assert.equal(by["https://proofprice.com"].priority, 1);
});

test("llms-full.txt covers every tool, parameter, example and source from the registry", () => {
  const t = buildLlmsFullTxt(BASE);
  assert.match(t, /^# ProofPrice/);
  for (const cat of CATEGORIES) {
    assert.ok(t.includes(cat.tool), cat.tool);
    assert.ok(t.includes(`${BASE}/api/v1/${cat.restPath}`), cat.restPath);
    for (const name of Object.keys(paramSchemas(cat))) assert.ok(t.includes(`- ${name} (`), `param ${name}`);
  }
  assert.ok(t.includes("pricepaid_coverage"));
  for (const ex of exampleUrls()) assert.ok(t.includes(`GET ${BASE}${ex.path}`), ex.path);
  for (const s of SOURCE_PLUGINS) {
    for (const field of [s.info.name, s.info.licence, s.info.licence_url, s.info.attribution]) assert.ok(t.includes(field), `${s.info.id}: ${field}`);
  }
  for (const k of ["median", "typical_low", "sample_size", "confidence", "Rules for citing", "## Method", "Allowed values"]) assert.ok(t.includes(k), k);
  assert.ok(t.includes(`${BASE}/connect`));
});

test("llms-full.txt lists allowed values for choice parameters", () => {
  const t = buildLlmsFullTxt(BASE);
  const fuel = CATEGORIES.find((c) => c.id === "fuel")!;
  const schema: any = paramSchemas(fuel).fuel;
  const options: string[] = (schema.unwrap ? schema.unwrap() : schema).options;
  assert.ok(options.length > 0);
  assert.ok(t.includes(`Allowed values: ${options.join(", ")}`));
});

test("llms.txt links the connect page and the full reference", () => {
  const t = buildLlmsTxt(BASE);
  assert.ok(t.includes(`${BASE}/connect`));
  assert.ok(t.includes(`${BASE}/llms-full.txt`));
});

test("server.json matches the current registry format and the live service", () => {
  const file = JSON.parse(readFileSync(new URL("../server.json", import.meta.url), "utf8"));
  const version = buildOpenApi(BASE).info.version;
  assert.deepEqual(file, buildServerJson(version));
  assert.match(file.name, /^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/);
  assert.equal(file.name, MCP_REGISTRY_NAME);
  assert.ok(file.name.startsWith("com.proofprice/"));
  assert.ok(file.description.length >= 1 && file.description.length <= 100, `description is ${file.description.length} chars`);
  assert.match(file.version, /^\d+\.\d+\.\d+$/);
  assert.equal(file.$schema, "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json");
  assert.deepEqual(file.remotes, [{ type: "streamable-http", url: "https://proofprice.com/api/mcp" }]);
  assert.equal(file.remotes[0].url, MCP_URL);
});

test("connect guides cover every client and use the real MCP address", () => {
  const guides = connectGuides();
  const ids = guides.map((g) => g.id);
  for (const id of ["claude", "chatgpt", "cursor", "vscode", "windsurf", "claude-code", "openai-responses", "openai-agents", "vercel-ai-sdk", "langchain", "llamaindex", "rest"]) {
    assert.ok(ids.includes(id), id);
  }
  const by = Object.fromEntries(guides.map((g) => [g.id, g]));
  assert.equal(by["claude-code"].code, "claude mcp add --transport http proofprice https://proofprice.com/api/mcp");
  assert.deepEqual(JSON.parse(by.cursor.code!), { mcpServers: { proofprice: { url: MCP_URL } } });
  assert.deepEqual(JSON.parse(by.vscode.code!), { servers: { proofprice: { type: "http", url: MCP_URL } } });
  assert.deepEqual(JSON.parse(by.windsurf.code!), { mcpServers: { proofprice: { serverUrl: MCP_URL } } });
  for (const g of guides) {
    assert.match(g.docUrl, /^https:\/\//, g.id);
    if (g.id !== "rest") assert.ok(JSON.stringify(g).includes(MCP_URL), g.id);
  }
  // the REST example is a real example from the coverage list
  const curl = by.rest.code!;
  assert.ok(exampleUrls().some((e) => curl.includes(e.path)));
});

test("privacy and terms are public, in the sitemap and linked for AIs", async () => {
  const { PUBLIC_PATHS, buildLlmsFullTxt } = await import("../lib/open-book");
  const { buildLlmsTxt, buildOpenApi } = await import("../lib/openapi");
  for (const p of ["/privacy", "/terms"]) assert.ok(PUBLIC_PATHS.includes(p), p);
  for (const t of [buildLlmsTxt("https://x.test"), buildLlmsFullTxt("https://x.test")]) {
    assert.ok(t.includes("https://x.test/privacy"));
    assert.ok(t.includes("https://x.test/terms"));
  }
  assert.equal((buildOpenApi("https://x.test") as any).info.termsOfService, "https://proofprice.com/terms");
});

test("JSON-LD: Dataset markup on /sources and on pages that show a figure; home and breadcrumb-only pages carry none", async () => {
  const { answerPageGraph, examplePageGraph, sourcesGraph, homeGraph, breadcrumbGraph } = await import("../lib/site/jsonld");
  const source = { publisher: "A publisher", licence: "A licence" };
  const answerPage: any = { path: "/prices/ie/rent/dublin", h1: "Rent in Dublin", description: "d", asOf: "2026-10-14", source, figures: [{ question: "q?", answer: "a", caveat: "" }] };
  const examplePage: any = { path: "/prices/ie/rent/dublin", h1: "Rent in Dublin", description: "d", asOf: "2026-10-14", source, figure: { answer: "a", caveat: "" } };
  const crumbs = [{ name: "Home", path: "/" }];
  for (const g of [homeGraph(), breadcrumbGraph(crumbs)]) {
    assert.ok(!JSON.stringify(g).includes('"Dataset"'));
  }
  const ds = sourcesGraph([
    { id: "x", name: "X", whatIsRecorded: "r", limits: "l", publisher: "p", publisherUrl: "https://p.example", licenceUrl: "https://l.example", attribution: "a", countries: [{ code: "IE", name: "Ireland" }], restUrl: "/api/v1/rent", categoryTitle: "Rents" },
  ]);
  assert.ok(JSON.stringify(ds).includes('"Dataset"'));
});
