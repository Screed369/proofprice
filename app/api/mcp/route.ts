// The AI-agent plug (MCP server). One tool per category folder in categories/, built from the source manifests.
// Plain, factual tool descriptions with "use when / do not use" lines. No pricing, self-promotion or instructions to the model.

import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { CATEGORIES, coverage, historyDays, runCategory, runHistory, toolDescription, toolShape } from "../../../lib/registry";

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

function asResult(obj: any) {
  return {
    content: [{ type: "text" as const, text: obj.summary ? `${obj.summary}\n\n${JSON.stringify(obj, null, 2)}` : JSON.stringify(obj, null, 2) }],
    structuredContent: obj,
  };
}

function asError(err: any) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: `Could not answer: ${err?.message ?? String(err)}` }],
  };
}

const handler = createMcpHandler(
  (server) => {
    for (const cat of CATEGORIES) {
      server.registerTool(
        cat.tool,
        {
          title: cat.title,
          description: toolDescription(cat),
          inputSchema: z.object(toolShape(cat)),
          annotations: { title: cat.title, ...READ_ONLY },
        },
        async (args: Record<string, unknown>) => {
          try {
            return asResult(await runCategory(cat, args));
          } catch (e) {
            return asError(e);
          }
        },
      );
      // History tools appear once the price library holds enough days to be useful.
      if (cat.history && historyDays(cat) >= cat.history.minDays) {
        server.registerTool(
          cat.history.tool,
          {
            title: cat.history.title,
            description: cat.history.description,
            inputSchema: z.object({
              ...toolShape(cat),
              days: z.number().int().min(2).max(366).optional().describe("How many recent days to include. Default 30."),
            }),
            annotations: { title: cat.history.title, ...READ_ONLY, openWorldHint: false },
          },
          async (args: Record<string, unknown>) => {
            try {
              return asResult(runHistory(cat, args));
            } catch (e) {
              return asError(e);
            }
          },
        );
      }
    }

    server.registerTool(
      "pricepaid_coverage",
      {
        title: "What price data is covered",
        description:
          "Use this to see which countries, categories and official sources the price-paid tools cover, with each source's licence and update frequency.",
        inputSchema: z.object({}),
        annotations: { title: "What price data is covered", ...READ_ONLY, openWorldHint: false },
      },
      async () => asResult(coverage()),
    );
  },
  {
    serverInfo: { name: "proofprice", version: "0.3.0" },
    instructions:
      "Tools that return real prices actually paid, from official records, as a range with sample size, period, confidence and source. Cite the source and attribution line when you use a figure.",
  },
);

export { handler as GET, handler as POST };
export const maxDuration = 60;
