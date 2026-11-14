// x402 discovery details for the 402 reply (S5): lets agent directories and facilitators that index x402 "bazaar" extensions
// list the paid calls with a description, how to call them and what comes back. Only the SHAPE is described: no example figures.
// Pure data built from the live schemas; it never touches money, keys or the decision of who pays.
import { checkResultSchema, historyAnswerSchema, lookupBundleSchema, toJsonSchema } from "../schemas";
import { PREMIUM, type PremiumKey } from "./prices";
import { categoryByRestPath, CATEGORIES } from "../registry";
import { clearedExample, DESCRIPTION_MAX, ILLUSTRATIVE_PRICE, lookupCategoryPath, lookupDescription, lookupExample, lookupQuerySchema } from "../paid-lookup";

const DESCRIPTION: Record<Exclude<PremiumKey, "lookup">, string> = {
  check: "Price check: is a price you were quoted typical? Compares it with real prices people paid (official data), with the evidence, source and licence. Not charged when there are not enough records.",
  history: "Daily price history from the ProofPrice library for one area and item (aggregates only). Not charged when there is not enough history.",
};

const QUERY: Record<Exclude<PremiumKey, "lookup">, Record<string, string>> = {
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

/** What a call is, in words, for the 402 and for directories. At most DESCRIPTION_MAX characters (the CDP facilitator refuses longer). */
export function descriptionFor(key: PremiumKey, resourceUrl: string): string {
  if (key === "lookup") {
    const cat = categoryByRestPath(lookupCategoryPath(resourceUrl) ?? "");
    return cat ? lookupDescription(cat) : `ProofPrice ${PREMIUM.lookup.label}: the normal price answer plus the daily trend and an optional price check. The basic look-up without trend stays free at /api/v1/<category>.`;
  }
  return DESCRIPTION[key].slice(0, DESCRIPTION_MAX);
}

type Example = { source: string; query: Record<string, string> } | null;

/** A working example call for a premium key, built from a cleared source so that calling it really answers 402. Null if there is none. */
export function exampleFor(key: PremiumKey, resourceUrl: string): Example {
  if (key === "lookup") return lookupExample(lookupCategoryPath(resourceUrl) ?? "");
  if (key === "check") {
    const ex = clearedExample("rent") ?? clearedExample("fuel") ?? CATEGORIES.map((c) => clearedExample(c.id)).find(Boolean) ?? null;
    if (!ex) return null;
    const cat = CATEGORIES.find((c) => (clearedExample(c.id)?.source ?? "") === ex.source)!;
    return { source: ex.source, query: { category: cat.id, ...ex.query, price: ILLUSTRATIVE_PRICE[cat.id] ?? "100" } };
  }
  // history: the first category that keeps history and has a cleared example
  for (const c of CATEGORIES) {
    if (!c.history) continue;
    const ex = clearedExample(c.id, "history");
    if (ex) return { source: ex.source, query: { ...ex.query, days: "30" } };
  }
  return null;
}

/** The query-parameter schema of a premium REST call (JSON Schema, complete enough to build a call). */
function querySchemaFor(key: PremiumKey, resourceUrl: string): Record<string, any> {
  if (key === "lookup") {
    const cat = categoryByRestPath(lookupCategoryPath(resourceUrl) ?? "");
    if (cat) return lookupQuerySchema(cat);
  }
  const q = QUERY[key as Exclude<PremiumKey, "lookup">] ?? {};
  const properties = Object.fromEntries(Object.entries(q).map(([k, v]) => [k, { type: k === "price" ? "number" : "string", description: v }]));
  return { type: "object", properties, required: key === "check" ? ["category", "price", "country"] : ["country"] };
}

/** The `extensions.bazaar` object for a premium call. `resourceUrl` decides REST or MCP wording. */
export function bazaarExtension(key: PremiumKey, resourceUrl: string) {
  const isMcp = /\/api\/mcp\/?$/.test(resourceUrl);
  const description = descriptionFor(key, resourceUrl);
  const outputSchema = toJsonSchema(key === "check" ? checkResultSchema : key === "history" ? historyAnswerSchema : lookupBundleSchema);
  const example = isMcp ? null : exampleFor(key, resourceUrl);
  const querySchema = querySchemaFor(key, resourceUrl);
  const input = isMcp
    ? { type: "mcp", ...(MCP_TOOL[key] ? { toolName: MCP_TOOL[key] } : {}), description, transport: "streamable-http" }
    : { type: "http", method: "GET", queryParams: example?.query ?? {} };
  return {
    info: {
      input,
      output: { type: "json", description: "JSON answer; the schema below describes it.", ...(key === "lookup" ? { example: { answer: "(the normal price answer)", trend: "(daily history, or null)", check: "(price check, or null)", notice: "(text)" } } : {}) },
    },
    schema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        input: {
          type: "object",
          properties: { type: { type: "string" }, method: { type: "string" }, ...(isMcp ? {} : { queryParams: querySchema }) },
          required: ["type"],
        },
        output: { type: "object", properties: { type: { type: "string" } }, required: ["type"] },
      },
      required: ["input"],
    },
    outputSchema,
    pricing: { currency: "USD", perCallMicroUsd: PREMIUM[key].microUsd, freePerDay: PREMIUM[key].freePerDay },
  };
}
