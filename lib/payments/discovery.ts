// x402 discovery details for the 402 reply (S5): lets agent directories and facilitators that index x402 "bazaar" extensions
// list the paid calls with a description, how to call them and what comes back. Only the SHAPE is described: no example figures.
// Pure data built from the live schemas; it never touches money, keys or the decision of who pays.
import { checkResultSchema, historyAnswerSchema, toJsonSchema } from "../schemas";
import { PREMIUM, type PremiumKey } from "./prices";

const DESCRIPTION: Record<PremiumKey, string> = {
  check: "Price check: is a price you were quoted typical? Compares it with real prices people paid (official data), with the evidence, source and licence. Not charged when there are not enough records.",
  history: "Daily price history from the ProofPrice library for one area and item (aggregates only). Not charged when there is not enough history.",
};

const QUERY: Record<PremiumKey, Record<string, string>> = {
  check: {
    category: "Category id, e.g. rent, fuel, home-sales (see /api/v1/coverage).",
    price: "The price you want checked, a number.",
    currency: "Optional currency code.",
    unit: "Optional unit, e.g. per month.",
    "(category parameters)": "The category's own parameters, e.g. country, town, postcode.",
  },
  history: {
    country: "Country code.",
    area: "Area or place, as the category defines it.",
    days: "Optional number of days to look back.",
    "(category parameters)": "The category's own parameters, e.g. fuel for the fuel category.",
  },
};

const MCP_TOOL: Partial<Record<PremiumKey, string>> = { check: "pricepaid_check_price" };

/** The `extensions.bazaar` object for a premium call. `resourceUrl` decides REST or MCP wording. */
export function bazaarExtension(key: PremiumKey, resourceUrl: string) {
  const isMcp = /\/api\/mcp\/?$/.test(resourceUrl);
  const outputSchema = toJsonSchema(key === "check" ? checkResultSchema : historyAnswerSchema);
  const input = isMcp
    ? { type: "mcp", ...(MCP_TOOL[key] ? { toolName: MCP_TOOL[key] } : {}), description: DESCRIPTION[key], transport: "streamable-http" }
    : { type: "http", method: "GET", queryParams: QUERY[key] };
  return {
    info: {
      input,
      output: { type: "json", description: "JSON answer in ProofPrice's standard shape; the schema below describes it." },
    },
    schema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        input: { type: "object", properties: { type: { type: "string" } }, required: ["type"] },
        output: { type: "object", properties: { type: { type: "string" } }, required: ["type"] },
      },
      required: ["input"],
    },
    outputSchema,
    pricing: { currency: "USD", perCallMicroUsd: PREMIUM[key].microUsd, freePerDay: PREMIUM[key].freePerDay },
  };
}
