// The "AI open book": everything an AI crawler, agent or developer needs to find and plug in ProofPrice.
// Pure functions generated from the plug-in registry, so a new source appears here automatically.
// Used by app/robots.ts, app/sitemap.ts, app/llms-full.txt, app/connect and server.json checks (tests/open-book.test.ts).

import { CHECK_REST, CHECK_TOOL, checkExamplePath } from "./check";
import { ANSWER_FORMAT, CITING_RULES, jsonSchemaOf } from "./openapi";
import {
  CATEGORIES,
  COMING_NEXT,
  SOURCE_PLUGINS,
  countriesFor,
  countryHelp,
  exampleUrls,
  paramSchemas,
  paramsFromQuery,
  sourcesFor,
  toolDescription,
} from "./registry";
import { CATEGORY_LABEL, PAGE_SOURCES } from "./site/answer-pages";
import { countryName } from "./site/areas";
import { CONTACT, MCP_URL, SITE_URL } from "./site/constants";
import { examplePlans } from "./site/example-pages";
import { countryGroups, newestLibraryDay, pageRefs } from "./site/prices";
import { MIN_PUBLISH } from "./stats";
import { joinAnd } from "./text";

// The canonical public address and the contact live in lib/site/constants.ts (shared with the website pages); re-exported here.
export { CONTACT, MCP_URL, SITE_URL };

// ---------- robots.txt and sitemap ----------

/** Crawlers we name explicitly so there is no doubt they are welcome. */
export const AI_CRAWLERS = [
  "OAI-SearchBot",
  "ChatGPT-User",
  "GPTBot",
  "ClaudeBot",
  "Claude-User",
  "Claude-SearchBot",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "Applebot-Extended",
  "CCBot",
  "Googlebot",
  "Bingbot",
];

export function buildRobots(site = SITE_URL) {
  return {
    rules: [{ userAgent: "*", allow: "/" }, ...AI_CRAWLERS.map((userAgent) => ({ userAgent, allow: "/" }))],
    sitemap: `${site}/sitemap.xml`,
    host: site,
  };
}

/** Fixed public pages and machine-readable files. The /prices indexes and answer pages are added by buildSitemap from the price library. */
export const PUBLIC_PATHS = [
  "/",
  "/connect",
  "/sources",
  "/pricing",
  "/trust",
  "/status",
  "/prices",
  "/method",
  "/privacy",
  "/terms",
  "/pricing.json",
  "/llms.txt",
  "/llms-full.txt",
  "/openapi.json",
  "/api/v1/coverage",
];

type Freq = "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";

const STATIC_CHANGE: Record<string, Freq> = {
  "/": "weekly",
  "/connect": "weekly",
  "/sources": "weekly",
  "/pricing": "weekly",
  "/pricing.json": "weekly",
  "/trust": "monthly",
  "/status": "daily",
  "/prices": "daily",
  "/method": "monthly",
  "/privacy": "monthly",
  "/terms": "monthly",
  "/api/v1/coverage": "daily",
};

const STATIC_PRIORITY: Record<string, number> = {
  "/": 1,
  "/connect": 0.9,
  "/sources": 0.8,
  "/prices": 0.8,
  "/trust": 0.7,
  "/status": 0.4,
};

export interface SitemapEntry {
  url: string;
  lastModified?: string | Date;
  changeFrequency: Freq;
  priority: number;
}

/** What the sitemap needs to know about the price library (injectable, so tests can check the rules without the files on disk). */
export interface SitemapLibrary {
  /** One entry per answer page. asOf is the newest data day behind it when known (null: the page is dated by the build). */
  answerPages: { path: string; category: string; asOf: string | null; priority?: number }[];
  indexPaths: string[]; // /prices/<country> and /prices/<country>/<category>
  newestDay: string | null;
}

/** Pages with a place of their own (every place of a library source) rank above the pages a manifest lists as examples. */
const BULK_PRIORITY = 0.5;
const EXAMPLE_PRIORITY = 0.4;

export function libraryForSitemap(): SitemapLibrary {
  return {
    answerPages: pageRefs().map((p) => ({ path: p.path, category: p.category, asOf: p.asOf, priority: p.mode === "bulk" ? BULK_PRIORITY : EXAMPLE_PRIORITY })),
    indexPaths: countryGroups().flatMap((g) => [g.path, ...g.categories.map((c) => c.path)]),
    newestDay: newestLibraryDay(),
  };
}

/** A place's page changes as often as its source: fuel daily, the home sale registers about monthly. */
function pageFreq(category: string): Freq {
  return category === "fuel" ? "daily" : "weekly";
}

/** A data day as the page's last-modified date, never later than now (a feed can carry tomorrow's prices). */
function dayOrNow(day: string | null, now: Date): string | Date {
  return day && day <= now.toISOString().slice(0, 10) ? day : now;
}

/** Every page we want found: the fixed pages, the /prices indexes and one answer page per page in the price library or manifests. */
export function buildSitemap(site = SITE_URL, now = new Date(), library: SitemapLibrary = libraryForSitemap()): SitemapEntry[] {
  const at = (p: string) => (p === "/" ? site : `${site}${p}`);
  const fixed: SitemapEntry[] = PUBLIC_PATHS.map((p) => ({
    url: at(p),
    lastModified: now,
    changeFrequency: STATIC_CHANGE[p] ?? "weekly",
    priority: STATIC_PRIORITY[p] ?? 0.6,
  }));
  const indexes: SitemapEntry[] = library.indexPaths.map((p) => ({
    url: at(p),
    lastModified: dayOrNow(library.newestDay, now),
    changeFrequency: "daily",
    priority: 0.6,
  }));
  const answers: SitemapEntry[] = library.answerPages.map((p) => ({
    url: at(p.path),
    lastModified: dayOrNow(p.asOf, now),
    changeFrequency: pageFreq(p.category),
    priority: p.priority ?? BULK_PRIORITY,
  }));
  return [...fixed, ...indexes, ...answers];
}

// ---------- llms-full.txt ----------

function describeParam(name: string, schema: any, required: boolean): string {
  const js: any = jsonSchemaOf(schema);
  const type = Array.isArray(js.enum) ? "one of" : js.type ?? "any";
  const bits = [type, required ? "required" : "optional"];
  if (js.minimum !== undefined) bits.push(`min ${js.minimum}`);
  if (js.maximum !== undefined) bits.push(`max ${js.maximum}`);
  const allowed = Array.isArray(js.enum) ? `\n    Allowed values: ${js.enum.join(", ")}` : "";
  const desc = schema.description ? `\n    ${schema.description}` : "";
  return `  - ${name} (${bits.join(", ")})${desc}${allowed}`;
}

/** One line per category that has ready answer pages, listing the page of each country. Built from the page specs and the
 *  registry's page plans, not from the library files, so llms-full.txt never depends on reading the library at request time
 *  and every new source appears here without an edit. */
export function pricePageLines(baseUrl: string): string[] {
  const byCategory = new Map<string, { label: string; seen: Set<string>; items: { name: string; path: string }[] }>();
  const add = (country: string, category: string, label: string) => {
    const path = `/prices/${country.toLowerCase()}/${category}`;
    const entry = byCategory.get(category) ?? { label, seen: new Set<string>(), items: [] };
    byCategory.set(category, entry);
    if (entry.seen.has(path)) return;
    entry.seen.add(path);
    entry.items.push({ name: countryName(country), path });
  };
  for (const p of PAGE_SOURCES) add(p.country, p.category, CATEGORY_LABEL[p.category]);
  for (const p of examplePlans()) add(p.country, p.category, p.categoryLabel);
  return [...byCategory.values()]
    .sort((a, b) => a.label.localeCompare(b.label, "en"))
    .map((e) => `  - ${e.label}, by country: ${e.items.sort((a, b) => a.name.localeCompare(b.name, "en")).map((i) => `${i.name} ${baseUrl}${i.path}`).join("; ")}`);
}

export function buildLlmsFullTxt(baseUrl: string): string {
  const out: string[] = [];
  out.push(`# ProofPrice: full reference for AI agents

> Real prices actually paid, not asking prices. Ask "what did people actually pay for X, here, recently?" and get a range (median, 10th–90th percentile) with sample size, period, confidence, source and licence. Built from official open data. Aggregates only. Free, no API key.

This file is generated from the live service, so it always matches what is deployed.
Short version: ${baseUrl}/llms.txt · OpenAPI 3.1: ${baseUrl}/openapi.json · Setup for AI clients: ${baseUrl}/connect · Method: ${baseUrl}/method
Privacy notice: ${baseUrl}/privacy · Terms of use: ${baseUrl}/terms
Contact: ${CONTACT}

## How to connect
- MCP server (Streamable HTTP, no key, no sign-in): ${baseUrl}/api/mcp
- MCP Server Card (draft discovery standard): ${baseUrl}/.well-known/mcp-server-card
- REST (GET, JSON, CORS open): ${baseUrl}/api/v1/<category>
- Add-to-client instructions for Claude, ChatGPT, Cursor, VS Code, Windsurf, Claude Code and agent frameworks: ${baseUrl}/connect

## Pages for people and crawlers
- Sources, licences and attribution (every source with its publisher, licence and limits): ${baseUrl}/sources
- Pricing (free forever, premium calls, how agents pay with x402): ${baseUrl}/pricing (JSON: ${baseUrl}/pricing.json)
- How we earn trust (rules, checks before a source goes live, corrections): ${baseUrl}/trust
- Status of the price library and sources (last collection, days held, last error): ${baseUrl}/status
- Prices by place (latest median and typical range, from the daily price library): ${baseUrl}/prices
${pricePageLines(baseUrl).join("\n")}
- Each place or item has its own page at ${baseUrl}/prices/<country>/<category>/<place>: the latest figure with its date, the source and licence, and a link to the live REST answer. Figures built from records show the median, the typical range (10th–90th percentile) and the number of records, and only when at least ${MIN_PUBLISH} records sit behind them; official statistics are shown as such, with the reference period the publisher states. Where a source is answered live only, the page gives the question, the MCP tool and the REST link and no number: call the tool for the figure.
`);

  out.push("## Tools (MCP) and endpoints (REST)\n");
  for (const cat of CATEGORIES) {
    const required = new Set(cat.required ?? []);
    out.push(`### ${cat.tool}  —  ${cat.title}`);
    out.push(`REST: GET ${baseUrl}/api/v1/${cat.restPath}`);
    out.push(`Countries: ${countriesFor(cat.id).join(", ")}`);
    out.push(`Description: ${toolDescription(cat)}`);
    out.push("Parameters (the same names work as MCP tool arguments and REST query parameters):");
    out.push(`  - country (one of, required)\n    ${countryHelp(cat)}\n    Allowed values: ${countriesFor(cat.id).join(", ")}`);
    for (const [name, schema] of Object.entries(paramSchemas(cat))) out.push(describeParam(name, schema, required.has(name)));
    out.push("Example requests:");
    for (const ex of exampleUrls().filter((e) => e.category === cat.id)) {
      const args = paramsFromQuery(cat, new URLSearchParams(ex.path.split("?")[1] ?? ""));
      out.push(`  - REST: GET ${baseUrl}${ex.path}`);
      out.push(`    MCP: call ${cat.tool} with ${JSON.stringify(args)}   (source: ${ex.source})`);
    }
    if (cat.history) {
      out.push(`History: ${cat.history.tool} / GET ${baseUrl}/api/v1/${cat.restPath}/history takes the same parameters plus days (integer, 2–366, default 30).`);
      out.push(`  ${cat.history.description}`);
      out.push(`  The MCP history tool is offered once the price library holds ${cat.history.minDays} days; the REST endpoint always answers (it says when history is still building).`);
    }
    out.push("");
  }
  out.push(`### ${CHECK_TOOL}  —  Check a price before you pay
REST: GET ${baseUrl}${CHECK_REST}
Description: Compare a proposed price with the recorded evidence before paying, and keep the reasoning. Runs the category's normal answer (same data, cache and stale-if-error) and compares the price with it.
Parameters (the same names work as MCP tool arguments and REST query parameters):
  - category (required): ${CATEGORIES.map((c) => c.id).join(", ")} (the REST path or the tool name also works)
  - country (required): ISO country code of the place
  - price (required): the price to check, a number above zero
  - currency (optional): ISO 4217 code; defaults to the evidence currency; a different currency gives cannot_judge (never converted)
  - unit (optional): for example "per month" or "per litre"; defaults to the evidence unit; a different unit gives cannot_judge
  - includes (optional): free text such as "VAT included, delivery excluded"; echoed back as a caution, not used to adjust the figure
  - plus the category's own parameters, with the same names and validation as its tool (see the category sections above)
Verdicts:
  - within_typical_range / above_typical_range / below_typical_range: the evidence is a set of records; the price is compared with the 10th–90th percentile, and position says where it sits (for example "27% above the median and above the 90th percentile").
  - about_average / above_average / below_average: the evidence is one official average or median, not a distribution; within ±5% of it is about_average, and position says the % difference from the published figure.
  - cannot_judge: currency or unit differs, fewer than ${MIN_PUBLISH} records, or nothing matched; reasons and missing say why.
Also returned: reasons (posted prices are not paid prices, old periods, assumptions made), missing, a one-sentence summary, and the full evidence answer embedded as "answer" (with its audit-trail fields). Deterministic: no benchmark is ever invented.
Example: GET ${baseUrl}${checkExamplePath()}
`);

  out.push(`### pricepaid_coverage  —  What price data is covered
REST: GET ${baseUrl}/api/v1/coverage (every source in full, no parameters; about 140 KB)
Description: Which countries, categories and official sources the price-paid tools cover. Call it first when unsure whether a place is covered.
The MCP tool returns a short overview by default: for each tool its countries, the number of official sources behind it and how often they update. With the optional arguments below it returns the full detail (publisher, licence, attribution line, limits, example requests) of the matching sources instead.
Parameters (MCP tool arguments, both optional):
  - category: ${CATEGORIES.map((c) => c.id).join(", ")} (the REST path or the tool name also works)
  - country: an ISO country code such as IE, GB or FR
`);

  out.push(`## Answer format (every endpoint and tool)
${ANSWER_FORMAT}

Confidence: high = 50+ records, medium = 15–49, low = ${MIN_PUBLISH}–14. Below ${MIN_PUBLISH} records no figure is returned.
Errors: HTTP 400 with {error, detail} for a missing or invalid parameter or an uncovered country; 502 when the official source cannot be reached and we hold no recent copy of it. MCP tools return isError with a plain message.
Stale-if-error: when the official source does not respond but our price library holds a recent daily snapshot for the same source, area and item, you get that copy instead of an error (status ok, extra.stale true, the snapshot date in period and as_of, and the notice says "The official source did not respond; this is our copy from <date>."). REST also sets an X-ProofPrice-Stale header.
MCP tools declare an outputSchema and return the answer both as text and as structuredContent.

## Rules for citing
${CITING_RULES.map((r) => `- ${r}`).join("\n")}
- This is information, not a valuation, offer or advice.

## Method
- Every answer is a range: the median and the 10th–90th percentile of recorded prices, with sample size, period and confidence.
- Aggregates only: no individual addresses or personal data are returned for home sales.
- Price library: once a day ProofPrice snapshots each live source that supports history and keeps, per area and item, the median, 10th–90th percentile and count. Days with fewer than ${MIN_PUBLISH} records are not shown.
- Asking prices are never presented as paid prices. Fuel figures are labelled as posted pump prices.
${SOURCE_PLUGINS.filter((s) => s.method)
  .map((s) => `- ${s.method}`)
  .join("\n")}
- Full method page: ${baseUrl}/method

## Sources, licences and attribution`);
  for (const s of SOURCE_PLUGINS) {
    const i = s.info;
    out.push(`### ${i.name} (${i.id})
- Country: ${i.country} · Category: ${i.category} · Status: ${s.status}
- Publisher: ${i.publisher}
- What is recorded: ${i.what_is_recorded}
- Price type: ${i.price_type} · Freshness: ${i.freshness}
- Licence: ${i.licence} (${i.licence_url})
- Attribution to show: ${i.attribution}
- Homepage: ${i.homepage}
- Limits: ${i.limits}
`);
  }
  out.push(`## Coming next
${COMING_NEXT.map((c) => `- ${c}`).join("\n")}

## Contact
- ${CONTACT}
`);
  return out.join("\n");
}

// ---------- MCP Registry server.json ----------

export const MCP_REGISTRY_SCHEMA = "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json";
export const MCP_REGISTRY_NAME = "com.proofprice/pricepaid";

/** The MCP Registry allows at most 100 characters. */
export const SERVER_DESCRIPTION = "Prices people actually paid, from official open data: homes, rents, fuel, energy, food, medicines.";

/** The shape of server.json at the repo root (also used by tests to check the file has not drifted). */
export function buildServerJson(version: string) {
  return {
    $schema: MCP_REGISTRY_SCHEMA,
    name: MCP_REGISTRY_NAME,
    title: "ProofPrice",
    description: SERVER_DESCRIPTION,
    version,
    websiteUrl: SITE_URL,
    repository: { url: "https://github.com/Screed369/proofprice", source: "github" },
    remotes: [{ type: "streamable-http", url: MCP_URL }],
  };
}

// ---------- MCP Server Card (draft SEP-2127, /.well-known/mcp-server-card) ----------

export const MCP_SERVER_CARD_SCHEMA = "https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json";
/** Protocol revisions /api/mcp answers (checked by tests/mcp-spec.test.ts): the 2026-07-28 stateless one and the two before it. */
export const MCP_PROTOCOL_VERSIONS = ["2026-07-28", "2025-11-25", "2025-06-18"];

/** The Server Card served at /.well-known/mcp-server-card: the same identity as server.json, one remote, no key and no sign-in.
 *  The card spec is still a draft; the fields used here are the ones its example uses. */
export function buildServerCard(version: string) {
  return {
    $schema: MCP_SERVER_CARD_SCHEMA,
    name: MCP_REGISTRY_NAME,
    title: "ProofPrice",
    description: SERVER_DESCRIPTION,
    version,
    websiteUrl: SITE_URL,
    repository: { url: "https://github.com/Screed369/proofprice", source: "github" },
    remotes: [{ type: "streamable-http", url: MCP_URL, supportedProtocolVersions: MCP_PROTOCOL_VERSIONS }],
  };
}

// ---------- /connect page content ----------

export interface ConnectGuide {
  id: string;
  title: string;
  steps?: string[];
  codeLabel?: string;
  language?: string;
  code?: string;
  note?: string;
  docUrl: string;
}

export function firstRestExample(): string {
  const ex = exampleUrls()[0];
  return ex ? `${SITE_URL}${ex.path}` : `${SITE_URL}/api/v1/coverage`;
}

export function connectGuides(): ConnectGuide[] {
  const rest = firstRestExample();
  return [
    {
      id: "claude",
      title: "Claude (claude.ai and the desktop app)",
      steps: [
        "Open Customize > Connectors and click Add custom connector.",
        `Paste the server URL: ${MCP_URL}`,
        "Leave sign-in off (No sign-in). ProofPrice needs no key. Click Add.",
        "In a chat, click + > Connectors and switch ProofPrice on.",
        "On Team and Enterprise plans an Owner adds it under Organization settings > Connectors; members then click Connect.",
      ],
      docUrl: "https://www.claude.com/docs/connectors/custom/remote-mcp",
    },
    {
      id: "chatgpt",
      title: "ChatGPT (developer mode / apps)",
      steps: [
        "Developer mode is on the web for Pro, Plus, Business, Enterprise and Education accounts: Settings > Apps > Advanced settings > turn on Developer mode.",
        "Click Create app and enter the remote MCP server URL (Streamable HTTP):",
        MCP_URL,
        "Choose No Authentication, then create it. It appears under Drafts.",
        "In a chat open the + menu, choose Developer mode and pick ProofPrice. Name the tool in your prompt if ChatGPT does not call it.",
      ],
      note: "OpenAI's menus change often (its Apps SDK guide calls this Add custom MCP server under Plugins). If yours differs, follow the official guides below. ProofPrice's tools are read-only.",
      docUrl: "https://developers.openai.com/api/docs/guides/developer-mode",
    },
    {
      id: "cursor",
      title: "Cursor",
      steps: ["Add this to .cursor/mcp.json in your project, or ~/.cursor/mcp.json for all projects."],
      codeLabel: ".cursor/mcp.json",
      language: "json",
      code: JSON.stringify({ mcpServers: { proofprice: { url: MCP_URL } } }, null, 2),
      docUrl: "https://cursor.com/docs/mcp",
    },
    {
      id: "vscode",
      title: "VS Code / GitHub Copilot",
      steps: [
        "Add this to .vscode/mcp.json in your workspace, or run the command MCP: Open User Configuration to add it for all workspaces.",
        "You can also run MCP: Add Server from the Command Palette and choose HTTP.",
      ],
      codeLabel: "mcp.json",
      language: "json",
      code: JSON.stringify({ servers: { proofprice: { type: "http", url: MCP_URL } } }, null, 2),
      docUrl: "https://code.visualstudio.com/docs/agent-customization/mcp-servers",
    },
    {
      id: "windsurf",
      title: "Windsurf",
      steps: [
        "In Cascade, use Open MCP config file (the file's location depends on your Windsurf version; the official guide lists it) and add:",
      ],
      codeLabel: "mcp_config.json",
      language: "json",
      code: JSON.stringify({ mcpServers: { proofprice: { serverUrl: MCP_URL } } }, null, 2),
      docUrl: "https://docs.windsurf.com/plugins/cascade/mcp",
    },
    {
      id: "claude-code",
      title: "Claude Code",
      codeLabel: "terminal",
      language: "bash",
      code: `claude mcp add --transport http proofprice ${MCP_URL}`,
      docUrl: "https://code.claude.com/docs/en/mcp",
    },
    {
      id: "openai-responses",
      title: "OpenAI Responses API (hosted MCP tool)",
      steps: ["OpenAI's servers call ProofPrice for you. Put the MCP tool in the tools list:"],
      codeLabel: "python",
      language: "python",
      code: `from openai import OpenAI

client = OpenAI()
resp = client.responses.create(
    model="YOUR_MODEL",
    tools=[{
        "type": "mcp",
        "server_label": "proofprice",
        "server_url": "${MCP_URL}",
        "require_approval": "never",
    }],
    input="What did terraced houses in Bristol actually sell for recently?",
)
print(resp.output_text)`,
      docUrl: "https://developers.openai.com/api/docs/guides/tools-remote-mcp",
    },
    {
      id: "openai-agents",
      title: "OpenAI Agents SDK",
      steps: ["Hosted MCP tool (OpenAI calls ProofPrice):"],
      codeLabel: "python",
      language: "python",
      code: `from agents import Agent, HostedMCPTool, Runner

agent = Agent(
    name="Price checker",
    tools=[HostedMCPTool(tool_config={
        "type": "mcp",
        "server_label": "proofprice",
        "server_url": "${MCP_URL}",
        "require_approval": "never",
    })],
)
result = await Runner.run(agent, "What is diesel costing near Milan right now?")
print(result.final_output)

# Or connect from your own process over Streamable HTTP:
# from agents.mcp import MCPServerStreamableHttp
# async with MCPServerStreamableHttp(params={"url": "${MCP_URL}"}) as server:
#     agent = Agent(name="Price checker", mcp_servers=[server])`,
      docUrl: "https://openai.github.io/openai-agents-python/mcp/",
    },
    {
      id: "vercel-ai-sdk",
      title: "Vercel AI SDK",
      steps: ["Install the MCP package: npm install @ai-sdk/mcp"],
      codeLabel: "typescript",
      language: "typescript",
      code: `import { createMCPClient } from "@ai-sdk/mcp";

const mcpClient = await createMCPClient({
  transport: { type: "http", url: "${MCP_URL}" },
});
try {
  const tools = await mcpClient.tools();
  // pass \`tools\` to generateText / streamText
} finally {
  await mcpClient.close();
}`,
      docUrl: "https://ai-sdk.dev/docs/ai-sdk-core/mcp-tools",
    },
    {
      id: "langchain",
      title: "LangChain",
      steps: [
        "Current LangChain (1.4 or newer): pip install \"langchain[mcp]\"",
        "Older projects can keep using the langchain-mcp-adapters package (now archived); its snippet is below too.",
      ],
      codeLabel: "python",
      language: "python",
      code: `# langchain[mcp] (1.4+)
from langchain.mcp import MCPAdapter

async with MCPAdapter("${MCP_URL}") as adapter:
    tools = await adapter.list_tools()

# langchain-mcp-adapters (pip install langchain-mcp-adapters)
from langchain_mcp_adapters.client import MultiServerMCPClient

client = MultiServerMCPClient({
    "proofprice": {"transport": "http", "url": "${MCP_URL}"},
})
tools = await client.get_tools()`,
      docUrl: "https://docs.langchain.com/oss/python/langchain/mcp",
    },
    {
      id: "llamaindex",
      title: "LlamaIndex",
      steps: ["pip install llama-index-tools-mcp"],
      codeLabel: "python",
      language: "python",
      code: `from llama_index.tools.mcp import BasicMCPClient, McpToolSpec

mcp_client = BasicMCPClient("${MCP_URL}")
tools = await McpToolSpec(client=mcp_client).to_tool_list_async()`,
      docUrl: "https://developers.llamaindex.ai/python/framework/module_guides/mcp/llamaindex_mcp/",
    },
    {
      id: "rest",
      title: "Plain REST (any language)",
      steps: ["No key, JSON back, browsers may call it (CORS is open). The example below is a real one from the coverage list:"],
      codeLabel: "terminal",
      language: "bash",
      code: `curl "${rest}"`,
      note: `More requests: ${SITE_URL}/api/v1/coverage lists the sources and working examples. Machine-readable: ${SITE_URL}/openapi.json and ${SITE_URL}/llms-full.txt.`,
      docUrl: `${SITE_URL}/openapi.json`,
    },
  ];
}

export function sourcesSummary(): string {
  return joinAnd(SOURCE_PLUGINS.map((s) => s.info.country));
}

export { sourcesFor };
