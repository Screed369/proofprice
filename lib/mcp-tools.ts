// The AI-agent plug: the MCP tool list, built from the registry. app/api/mcp/route.ts only mounts it.
// One tool per category folder, a history tool once the price library holds enough days, and a coverage tool.
// Every tool has a human title, read-only annotations and an outputSchema (lib/schemas.ts); successful calls return
// structuredContent (the answer as JSON) next to the text rendering. Errors come back as MCP isError results.
// Kept apart from the route so tests can call every handler with fixture answers (no network).
//
// Reliability: no tool call may outlast Vercel's 60 s function limit, which ends a request with a bare "Task timed out" and no
// answer. runCategory (lib/registry.ts) gives up on a slow official source after 40 s; guarded() below is a second limit of 50 s
// around every tool, and logs one line for any call slower than 8 s. The server also says it never sends tool-list changes, so
// a client has no reason to hold a stream open against a function that cannot keep one open past 60 s.

import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import type { ZodTypeAny } from "zod";
import type { CategoryPlugin } from "./plugin";
import { CATEGORIES, coverageView, historyDays, runCategory, runHistory, toolDescription, toolShape } from "./registry";
import { CHECK_TOOL, checkToolDescription, checkToolShape, runCheck } from "./check";
import { withDeadline } from "./http";
import { checkResultSchema, coverageToolSchema, historyAnswerSchema, priceAnswerSchema } from "./schemas";
import { SERVICE_VERSION, SITE_URL } from "./site/constants";
import { historySources, checkSources } from "./premium-sources";
import { gate, paymentHeaderFromMeta, premiumNote, readGateConfig, isAnswered, type PremiumKey } from "./payments";
import { isOwnClient, isOwnRequest, recordUsage, runWithOwnFlag, statusOfAnswer, statusOfError, usageEnabled, usageKey } from "./usage";

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
  /** Set on the premium tools only (lib/payments/prices.ts). They are free until the payment gate is switched on. */
  premium?: PremiumKey;
  /** Premium tools only: the source ids behind a call, for the licence guard (lib/payments/cleared.ts). Missing or null = not cleared = free. */
  sources?: (args: Record<string, unknown>) => string[] | null;
  /** The tool handler: never throws; failures come back as an isError result. */
  call(args: Record<string, unknown>): Promise<McpToolResult>;
}

export const COVERAGE_TOOL = "pricepaid_coverage";

/** A tool call slower than this (milliseconds) is logged: the tool name and the time taken, nothing else. */
export const SLOW_CALL_MS = 8_000;
/** The longest any tool call may take. Below Vercel's 60 s limit and above runCategory's own 40 s, so a hung call ends in a plain
 *  error result instead of a platform timeout. */
export const TOOL_DEADLINE_MS = 50_000;

export interface ToolLimits {
  slowCallMs?: number;
  deadlineMs?: number;
}

/** What the tools call to get answers. Tests pass fixtures here so no handler needs the network. */
export interface ToolDeps {
  categories: CategoryPlugin[];
  runCategory: typeof runCategory;
  runHistory: typeof runHistory;
  coverageView: typeof coverageView;
  historyDays: typeof historyDays;
  /** Replaces SLOW_CALL_MS and TOOL_DEADLINE_MS (tests use a few milliseconds). */
  limits?: ToolLimits;
}

export const LIVE_DEPS: ToolDeps = { categories: CATEGORIES, runCategory, runHistory, coverageView, historyDays };

export function asResult(obj: any): McpToolResult {
  const text = typeof obj?.summary === "string" && obj.summary ? `${obj.summary}\n\n${JSON.stringify(obj, null, 2)}` : JSON.stringify(obj, null, 2);
  return { content: [{ type: "text", text }], structuredContent: obj };
}

export function asError(err: any): McpToolResult {
  return { isError: true, content: [{ type: "text", text: `Could not answer: ${err?.message ?? String(err)}` }] };
}

/** Run one tool call: bounded in time (limits.deadlineMs), logged when slow (limits.slowCallMs), and never throwing. Whatever
 *  happens comes back as an MCP result. The slow-call line carries the tool name and the milliseconds only: no arguments, no answer
 *  text, nothing about the caller. */
async function guarded(
  name: string,
  limits: ToolLimits,
  fn: () => unknown | Promise<unknown>,
  count?: { tool: string; args: Record<string, unknown> },
): Promise<McpToolResult> {
  const started = Date.now();
  const deadlineMs = limits.deadlineMs ?? TOOL_DEADLINE_MS;
  let outcome = "ok";
  try {
    const out: any = await withDeadline(
      Promise.resolve().then(fn),
      deadlineMs,
      () => new Error(`This took longer than ${Math.max(1, Math.round(deadlineMs / 1000))} seconds, so ProofPrice stopped waiting. Try again in a minute.`),
    );
    // anonymous usage counting: does nothing unless it has been switched on (lib/usage.ts)
    if (count) recordUsage({ tool: count.tool, country: count.args.country, key: usageKey(count.args), status: statusOfAnswer(out?.answer ?? out) });
    return asResult(out);
  } catch (e) {
    outcome = "error";
    if (count) recordUsage({ tool: count.tool, country: count.args.country, key: usageKey(count.args), status: statusOfError(e) });
    return asError(e);
  } finally {
    const ms = Date.now() - started;
    if (ms > (limits.slowCallMs ?? SLOW_CALL_MS)) console.warn(`[slow-mcp-call] ${name} took ${ms} ms (${outcome})`);
  }
}

export function buildToolSpecs(deps: ToolDeps = LIVE_DEPS): ToolSpec[] {
  const specs: ToolSpec[] = [];
  const limits = deps.limits ?? {};
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
      call: (args) => guarded(cat.tool, limits, () => deps.runCategory(cat, args, { baseUrl: SITE_URL }), { tool: cat.tool, args }),
    });
    // History tools appear once the price library holds enough days to be useful.
    if (cat.history && deps.historyDays(cat) >= cat.history.minDays) {
      const h = cat.history;
      specs.push({
        premium: "history",
        sources: (args) => historySources(cat, args),
        name: h.tool,
        config: {
          title: h.title,
          description: h.description,
          inputSchema: z.object({
            ...toolShape(cat),
            days: z.number().int().min(2).max(366).optional().describe("How many recent days to include. Default 30."),
            months: z.number().int().min(2).max(360).optional().describe("Instead of days: how many whole months of monthly history to return, where a source has loaded long history."),
          }),
          outputSchema: historyAnswerSchema,
          annotations: { title: h.title, ...READ_ONLY },
        },
        call: (args) => guarded(h.tool, limits, () => deps.runHistory(cat, args, { baseUrl: SITE_URL })),
      });
    }
  }
  const checkTitle = "Check a price before you pay";
  specs.push({
    premium: "check",
    sources: (args) => checkSources(args, deps.categories),
    name: CHECK_TOOL,
    config: {
      title: checkTitle,
      description: checkToolDescription(deps.categories),
      inputSchema: z.object(checkToolShape(deps.categories)),
      outputSchema: checkResultSchema,
      annotations: { title: checkTitle, ...READ_ONLY },
    },
    call: (args) =>
      guarded(CHECK_TOOL, limits, () => runCheck(args, { categories: deps.categories, runCategory: deps.runCategory }, { baseUrl: SITE_URL }), { tool: CHECK_TOOL, args }),
  });
  const coverageTitle = "What price data is covered";
  specs.push({
    name: COVERAGE_TOOL,
    config: {
      title: coverageTitle,
      description:
        "Use this to see which countries and kinds of price the tools cover. It returns a short overview: for each tool the countries it answers for, " +
        "how many official sources stand behind it and how often they update. Give category and/or country to get the full detail of the matching " +
        `sources instead (publisher, licence, attribution line, limits, example requests). Every source at once, as JSON: ${SITE_URL}/api/v1/coverage`,
      inputSchema: z.object({
        category: z
          .string()
          .optional()
          .describe(`Optional. Return the full detail of this category's sources: one of ${deps.categories.map((c) => c.id).join(", ")} (the tool name also works).`),
        country: z
          .string()
          .optional()
          .describe("Optional. Return the full detail of the sources that cover this country: an ISO code such as IE, GB or FR. Can be combined with category."),
      }),
      outputSchema: coverageToolSchema,
      annotations: { title: coverageTitle, ...READ_ONLY },
    },
    call: (args) =>
      guarded(COVERAGE_TOOL, limits, () => deps.coverageView({ category: stringArg(args.category), country: stringArg(args.country) }, SITE_URL)),
  });
  return specs;
}

function stringArg(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined;
}

/** Register the tools on an MCP server. The SDK validates each successful result's structuredContent against its outputSchema.
 *  Payment gate: premium tools are wrapped ONLY while the gate is active (lib/payments/config.ts). With it off, registration is
 *  exactly as before: same descriptions, same handlers, same tools/list. */
export function registerTools(server: { registerTool: (...a: any[]) => unknown }, specs: ToolSpec[], env: Record<string, string | undefined> = process.env): void {
  const gateOn = readGateConfig(env) !== null;
  for (const spec of specs) {
    if (!gateOn || !spec.premium) {
      server.registerTool(spec.name, spec.config, (args: Record<string, unknown>) => spec.call(args ?? {}));
      continue;
    }
    const key = spec.premium;
    const config = { ...spec.config, description: spec.config.description + premiumNote(key) };
    server.registerTool(spec.name, config, async (args: Record<string, unknown>, ctx: any) => {
      const req: Request | undefined = ctx?.http?.req;
      const out = await gate(
        key,
        { headers: req?.headers, url: req?.url ?? `${SITE_URL}/api/mcp`, paymentHeader: paymentHeaderFromMeta(ctx?.mcpReq?._meta ?? ctx?._meta) },
        () => spec.call(args ?? {}),
        (r) => !r.isError && isAnswered(JSON.stringify(r.structuredContent ?? {})),
        () => (spec.sources ? spec.sources(args ?? {}) : null),
        env,
      );
      if (!out) return spec.call(args ?? {});
      if (out.kind === "denied") return { isError: true, content: [{ type: "text", text: JSON.stringify(out.body) }], structuredContent: out.body };
      const note = out.headers["x-proofprice-note"];
      if (note) return { ...out.result, _meta: { ...((out.result as any)._meta ?? {}), "proofprice/note": note, "proofprice/charged": false } };
      const settlement = out.headers["payment-response"];
      return settlement ? { ...out.result, _meta: { "x402/payment-response": JSON.parse(Buffer.from(settlement, "base64").toString("utf8")) } } : out.result;
    });
  }
}

/** The web-standard request handler for /api/mcp (stateless Streamable HTTP).
 *
 *  capabilities.tools.listChanged is false on purpose. The SDK otherwise advertises true for any server with tools, and a client of
 *  the 2026 protocol that sees it can open a long-lived `subscriptions/listen` stream to wait for "tool list changed" notices
 *  (the SDK holds that request open, with keepalives, until the client leaves). This server is stateless and its tool list only
 *  changes with a deployment, so it never sends one, and a function that Vercel stops after 60 s cannot hold a stream open anyway:
 *  the likely cause of the "Task timed out after 60 seconds" bursts of 15 Oct 2026, with the client reconnecting every 61 s.
 *  With nothing to subscribe to, the SDK answers such a request with an acknowledgement and an immediate, graceful close. */
export function createProofPriceMcpHandler(deps: ToolDeps = LIVE_DEPS) {
  return createMcpHandler(
    (server) => {
      registerTools(server as any, buildToolSpecs(deps));
    },
    {
      serverInfo: { name: "proofprice", version: SERVICE_VERSION },
      instructions: MCP_INSTRUCTIONS,
      capabilities: { tools: { listChanged: false } },
      onEvent: logMcpEvent,
    },
  );
}

/** The two things worth a log line besides slow tool calls (guarded): a client asking to subscribe, so the logs show whether and
 *  when clients still do, and any other request (not a tool call, which guarded logs by name) the SDK took more than SLOW_CALL_MS
 *  to answer. The method name and the milliseconds only: never the parameters. */
export function logMcpEvent(event: { type: string; method?: string; duration?: number }): void {
  if (event.type === "REQUEST_RECEIVED" && event.method === "subscriptions/listen") {
    console.log("[mcp] subscriptions/listen received: this server sends no list-change notices, so the stream is closed at once");
  } else if (event.type === "REQUEST_COMPLETED" && event.method !== "tools/call" && (event.duration ?? 0) > SLOW_CALL_MS) {
    console.warn(`[slow-mcp-request] ${event.method} took ${event.duration} ms`);
  }
}

// ---------- anonymous usage counting for the connection handshake ----------

export type McpHandler = (req: Request) => Promise<Response>;

/** An initialize message is a few hundred bytes. A request body bigger than this is not looked at for counting. */
const INITIALIZE_BODY_MAX = 64 * 1024;

/** Wrap the MCP handler with the one usage count that has to look at the request: when a client connects (initialize) and says what
 *  app it is (clientInfo.name), that name is tallied (lib/usage.ts, off unless switched on). Nothing else in the request is read
 *  or kept.
 *
 *  Counting never delays a request. The body is copied (a Request body can be read only once) and the copy is read on the side,
 *  never awaited: `next` is called at once, and a slow, huge or unfinished body costs the handler nothing. A failure to read or
 *  parse the copy just means nothing is counted. */
export function withInitializeCount(next: McpHandler, env: Record<string, string | undefined> = process.env): McpHandler {
  return (req) => {
    if (req.method !== "POST" || !usageEnabled(env)) return next(req);
    // Our own checks (smoke user agent, ppcheck=1, client proofprice-smoke / proofprice-check) are not counted. The flag is set on
    // the side and read when a tool call finishes, so it never holds a request up.
    return runWithOwnFlag((flag) => {
      if (isOwnRequest(req)) flag.own = true;
      countInitialize(req, env, flag);
      return next(req);
    });
  };
}

function countInitialize(req: Request, env: Record<string, string | undefined>, flag: { own: boolean }): void {
  try {
    if (Number(req.headers.get("content-length") ?? 0) > INITIALIZE_BODY_MAX) return;
    void req
      .clone()
      .json()
      .then((body: any) => {
        for (const m of Array.isArray(body) ? body : [body]) {
          const meta = m?.params?._meta?.["io.modelcontextprotocol/clientInfo"];
          const ppcheck = m?.params?.arguments?.ppcheck;
          if (isOwnClient(m?.params?.clientInfo?.name) || isOwnClient(meta?.name) || ppcheck === 1 || ppcheck === "1" || ppcheck === true) flag.own = true;
        }
        for (const m of Array.isArray(body) ? body : [body]) {
          if (m?.method === "initialize") recordUsage({ tool: "mcp_initialize", status: "ok", client: m?.params?.clientInfo?.name }, new Date(), env);
        }
      })
      .catch(() => {
        /* not JSON, or unreadable: nothing to count */
      });
  } catch {
    /* the request could not be copied: nothing to count */
  }
}
