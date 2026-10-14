// The AI-agent plug: the MCP tool list, built from the registry. app/api/mcp/route.ts only mounts it.
// One tool per category folder, a history tool once the price library holds enough days, and a coverage tool.
// Every tool has a human title, read-only annotations and an outputSchema (lib/schemas.ts); successful calls return
// structuredContent (the answer as JSON) next to the text rendering. Errors come back as MCP isError results.
// Kept apart from the route so tests can call every handler with fixture answers (no network).

import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import type { ZodTypeAny } from "zod";
import type { CategoryPlugin } from "./plugin";
import { CATEGORIES, coverage, historyDays, runCategory, runHistory, toolDescription, toolShape } from "./registry";
import { CHECK_TOOL, checkToolDescription, checkToolShape, runCheck } from "./check";
import { checkResultSchema, coverageSchema, historyAnswerSchema, priceAnswerSchema } from "./schemas";
import { SERVICE_VERSION, SITE_URL } from "./site/constants";
import { recordUsage, statusOfAnswer, statusOfError, usageKey } from "./usage";

/** The same four hints on every tool: they read official sources and never change anything. */
export const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

export const MCP_INSTRUCTIONS =
  "Tools that return real prices actually paid, from official records, as a range with sample size, period, confidence and source. Cite the source and attribution line when you use a figure.";

export interface McpToolResult {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export interface ToolSpec {
  name: string;
  config: {
    title: string;
    description: string;
    inputSchema: ZodTypeAny;
    outputSchema: ZodTypeAny;
    annotations: { title: string } & typeof READ_ONLY;
  };
  /** The tool handler: never throws; failures come back as an isError result. */
  call(args: Record<string, unknown>): Promise<McpToolResult>;
}

/** What the tools call to get answers. Tests pass fixtures here so no handler needs the network. */
export interface ToolDeps {
  categories: CategoryPlugin[];
  runCategory: typeof runCategory;
  runHistory: typeof runHistory;
  coverage: typeof coverage;
  historyDays: typeof historyDays;
}

export const LIVE_DEPS: ToolDeps = { categories: CATEGORIES, runCategory, runHistory, coverage, historyDays };

export function asResult(obj: any): McpToolResult {
  const text = typeof obj?.summary === "string" && obj.summary ? `${obj.summary}\n\n${JSON.stringify(obj, null, 2)}` : JSON.stringify(obj, null, 2);
  return { content: [{ type: "text", text }], structuredContent: obj };
}

export function asError(err: any): McpToolResult {
  return { isError: true, content: [{ type: "text", text: `Could not answer: ${err?.message ?? String(err)}` }] };
}

async function guarded(fn: () => unknown | Promise<unknown>, count?: { tool: string; args: Record<string, unknown> }): Promise<McpToolResult> {
  try {
    const out: any = await fn();
    // anonymous usage counting: does nothing unless it has been switched on (lib/usage.ts)
    if (count) recordUsage({ tool: count.tool, country: count.args.country, key: usageKey(count.args), status: statusOfAnswer(out?.answer ?? out) });
    return asResult(out);
  } catch (e) {
    if (count) recordUsage({ tool: count.tool, country: count.args.country, key: usageKey(count.args), status: statusOfError(e) });
    return asError(e);
  }
}

export function buildToolSpecs(deps: ToolDeps = LIVE_DEPS): ToolSpec[] {
  const specs: ToolSpec[] = [];
  for (const cat of deps.categories) {
    specs.push({
      name: cat.tool,
      config: {
        title: cat.title,
        description: toolDescription(cat),
        inputSchema: z.object(toolShape(cat)),
        outputSchema: priceAnswerSchema,
        annotations: { title: cat.title, ...READ_ONLY },
      },
      call: (args) => guarded(() => deps.runCategory(cat, args, { baseUrl: SITE_URL }), { tool: cat.tool, args }),
    });
    // History tools appear once the price library holds enough days to be useful.
    if (cat.history && deps.historyDays(cat) >= cat.history.minDays) {
      const h = cat.history;
      specs.push({
        name: h.tool,
        config: {
          title: h.title,
          description: h.description,
          inputSchema: z.object({
            ...toolShape(cat),
            days: z.number().int().min(2).max(366).optional().describe("How many recent days to include. Default 30."),
          }),
          outputSchema: historyAnswerSchema,
          annotations: { title: h.title, ...READ_ONLY },
        },
        call: (args) => guarded(() => deps.runHistory(cat, args, { baseUrl: SITE_URL })),
      });
    }
  }
  const checkTitle = "Check a price before you pay";
  specs.push({
    name: CHECK_TOOL,
    config: {
      title: checkTitle,
      description: checkToolDescription(deps.categories),
      inputSchema: z.object(checkToolShape(deps.categories)),
      outputSchema: checkResultSchema,
      annotations: { title: checkTitle, ...READ_ONLY },
    },
    call: (args) => guarded(() => runCheck(args, { categories: deps.categories, runCategory: deps.runCategory }, { baseUrl: SITE_URL }), { tool: CHECK_TOOL, args }),
  });
  const coverageTitle = "What price data is covered";
  specs.push({
    name: "pricepaid_coverage",
    config: {
      title: coverageTitle,
      description:
        "Use this to see which countries, categories and official sources the price-paid tools cover, with each source's licence and update frequency.",
      inputSchema: z.object({}),
      outputSchema: coverageSchema,
      annotations: { title: coverageTitle, ...READ_ONLY },
    },
    call: () => guarded(() => deps.coverage()),
  });
  return specs;
}

/** Register the tools on an MCP server. The SDK validates each successful result's structuredContent against its outputSchema. */
export function registerTools(server: { registerTool: (...a: any[]) => unknown }, specs: ToolSpec[]): void {
  for (const spec of specs) server.registerTool(spec.name, spec.config, (args: Record<string, unknown>) => spec.call(args ?? {}));
}

/** The web-standard request handler for /api/mcp (stateless Streamable HTTP). */
export function createProofPriceMcpHandler(deps: ToolDeps = LIVE_DEPS) {
  return createMcpHandler(
    (server) => {
      registerTools(server as any, buildToolSpecs(deps));
    },
    { serverInfo: { name: "proofprice", version: SERVICE_VERSION }, instructions: MCP_INSTRUCTIONS },
  );
}
