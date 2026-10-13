// The AI-agent plug (MCP server). Plain, factual tool descriptions with "use when / do not use" lines.
// No pricing, no self-promotion and no instructions to the model, per directory rules.

import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { homeSales, fuelNow, coverage } from "../../../lib/tools";

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
    server.registerTool(
      "pricepaid_home_sales",
      {
        title: "Home sale prices actually paid",
        description:
          "Use this when a user asks what homes actually sold for in a town or area, what a fair price for a home is, or how much property costs there, " +
          "in England & Wales (country GB), France (country FR) or Singapore public housing (country SG). Returns the median sale price, a typical range (10th–90th percentile), " +
          "the number of sales, the period covered, a confidence label, and the official source and licence, from government sale records. " +
          "Do not use for rents, asking prices, commercial property, or other countries.",
        inputSchema: z.object({
          country: z.enum(["GB", "FR", "SG"]).describe("GB = England & Wales (HM Land Registry); FR = France (DVF); SG = Singapore HDB resale flats"),
          town: z.string().min(2).optional().describe("Town or city, e.g. 'Bristol' (GB), 'Bordeaux' (FR), 'Tampines' (SG). Required for GB and SG"),
          postcode: z.string().optional().describe("FR only: 5-digit postcode, e.g. '69003'. Use instead of town for a precise area"),
          postcode_district: z.string().optional().describe("GB only: postcode district such as 'BS8' to narrow the area"),
          property_type: z
            .enum(["detached", "semi-detached", "terraced", "flat-maisonette", "house", "apartment", "any"])
            .optional()
            .describe("GB: detached, semi-detached, terraced, flat-maisonette. FR: house or apartment. Default 'any'"),
          flat_type: z
            .enum(["1 ROOM", "2 ROOM", "3 ROOM", "4 ROOM", "5 ROOM", "EXECUTIVE", "MULTI-GENERATION"])
            .optional()
            .describe("SG only"),
          months: z.number().int().min(1).max(36).optional().describe("How many recent months to include. Default 12"),
        }),
        annotations: { title: "Home sale prices actually paid", ...READ_ONLY },
      },
      async (args) => {
        try {
          return asResult(await homeSales(args));
        } catch (e) {
          return asError(e);
        }
      },
    );

    server.registerTool(
      "pricepaid_fuel_prices_now",
      {
        title: "Live fuel prices at the pump",
        description:
          "Use this when a user asks the current price of petrol, diesel, E10, E85, LPG or CNG near a place in France, Spain or Italy, or where fuel is cheapest there. " +
          "Returns the median and typical range of pump prices across stations in the area, the three cheapest stations, " +
          "and the official source and licence. France and Spain update during the day; Italy daily. Do not use for other countries or for historical prices.",
        inputSchema: z.object({
          country: z.enum(["FR", "ES", "IT"]).describe("FR = France; ES = Spain; IT = Italy"),
          fuel: z
            .enum(["diesel", "petrol95", "petrol98", "e10", "e85", "lpg", "methane"])
            .describe("petrol95 = unleaded 95; methane = CNG (priced per kg). Italy: diesel, petrol95, lpg, methane only"),
          postcode: z.string().optional().describe("FR or ES: 5-digit postcode, e.g. '75015' or '28001'"),
          area: z
            .string()
            .optional()
            .describe("Wider area when no postcode: FR department ('69', '2A'), ES province code ('28' = Madrid), IT province ('MI', 'RM')"),
          town: z.string().optional().describe("ES or IT: town / comune name, e.g. 'Valencia', 'Bologna'"),
          service: z.enum(["self", "served"]).optional().describe("IT only: self-service (default) or attended service, which costs more"),
        }),
        annotations: { title: "Live fuel prices at the pump", ...READ_ONLY },
      },
      async (args) => {
        try {
          return asResult(await fuelNow(args));
        } catch (e) {
          return asError(e);
        }
      },
    );

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
    serverInfo: { name: "pricepaid-plug", version: "0.2.0" },
    instructions:
      "Tools that return real prices actually paid, from official records, as a range with sample size, period, confidence and source. Cite the source and attribution line when you use a figure.",
  },
);

export { handler as GET, handler as POST };
export const maxDuration = 60;
