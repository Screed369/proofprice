// OpenAPI 3.1 description of the REST API, and the llms.txt text, generated from the plug-in registry.
// Pure functions, unit-tested. Nothing here needs editing when a source or category is added.

import { z } from "zod";
import { CATEGORIES, countriesFor, countryHelp, exampleUrls, paramSchemas, sourcesFor } from "./registry";
import { joinAnd } from "./text";

const answerResponses = {
  "200": {
    description: "A price answer: median, 10th–90th percentile range, sample size, period, confidence, source and licence.",
    content: { "application/json": { schema: { type: "object", additionalProperties: true } } },
  },
  "400": { description: "Missing or invalid parameter.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
  "502": { description: "The official source could not be reached.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
};

export function jsonSchemaOf(schema: z.ZodTypeAny): Record<string, unknown> {
  const s: any = z.toJSONSchema(schema, { unrepresentable: "any" });
  delete s.$schema;
  delete s.description;
  if (s.maximum === Number.MAX_SAFE_INTEGER) delete s.maximum;
  return s;
}

function parameters(catId: string) {
  const cat = CATEGORIES.find((c) => c.id === catId)!;
  const required = new Set(cat.required ?? []);
  const params = [
    {
      name: "country",
      in: "query",
      required: true,
      description: countryHelp(cat),
      schema: { type: "string", enum: countriesFor(cat.id) },
    },
  ];
  for (const [name, schema] of Object.entries(paramSchemas(cat))) {
    params.push({ name, in: "query", required: required.has(name), description: schema.description ?? "", schema: jsonSchemaOf(schema) as any });
  }
  return params;
}

export function buildOpenApi(baseUrl: string) {
  const paths: Record<string, unknown> = {};
  for (const cat of CATEGORIES) {
    const places = joinAnd(sourcesFor(cat.id).flatMap((s) => s.countries));
    paths[`/api/v1/${cat.restPath}`] = {
      get: {
        operationId: cat.tool.replace(/^pricepaid_/, "").replace(/_([a-z])/g, (_, c) => c.toUpperCase()),
        summary: `${cat.title} (${places})`,
        description: cat.description(
          sourcesFor(cat.id).flatMap((s) => s.countries.map((code) => ({ place: s.placeName, code, freshness: s.info.freshness }))),
        ),
        parameters: parameters(cat.id),
        responses: answerResponses,
      },
    };
    if (cat.history) {
      paths[`/api/v1/${cat.restPath}/history`] = {
        get: {
          operationId: cat.history.tool.replace(/^pricepaid_/, "").replace(/_([a-z])/g, (_, c) => c.toUpperCase()),
          summary: `${cat.history.title} (daily snapshots, building up from October 2026)`,
          description: cat.history.description,
          parameters: [
            ...parameters(cat.id),
            { name: "days", in: "query", required: false, description: "How many recent days to include. Default 30.", schema: { type: "integer", minimum: 2, maximum: 366 } },
          ],
          responses: {
            ...answerResponses,
            "200": { description: "A daily series: date, median, typical_low, typical_high, sample_size, with the change over the period, source and licence.", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
          },
        },
      };
    }
  }
  paths["/api/v1/coverage"] = {
    get: {
      operationId: "coverage",
      summary: "Which countries, categories and sources are covered",
      responses: { "200": { description: "Sources with licence and update frequency.", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } } },
    },
  };
  return {
    openapi: "3.1.0",
    info: {
      title: "ProofPrice API",
      version: "0.3.0",
      description:
        "What did people actually pay for X, here, recently? Returns a price range from official open data: median, 10th–90th percentile, sample size, period, confidence, source and licence. Aggregates only; never individual records.",
    },
    servers: [{ url: baseUrl }],
    paths,
    components: {
      schemas: {
        Error: { type: "object", properties: { error: { type: "string" }, detail: {} }, required: ["error"] },
      },
    },
  };
}

/** The answer format and citing rules, shared by llms.txt and llms-full.txt. */
export const ANSWER_FORMAT =
  'JSON with: query, status ("ok" or not), price {currency, unit, median, typical_low, typical_high, min, max}, sample_size, period {from, to}, confidence (low / medium / high), price_type ("transaction" or "posted_pump_price"), as_of, source {id, name, publisher, licence, licence_url, attribution, url}, method, method_url, summary (one plain sentence), notice, and an optional extra object.\ntypical_low and typical_high are the 10th and 90th percentiles.';

export const CITING_RULES = [
  "Cite the source and attribution line returned with each answer.",
  "Home figures are prices paid (transactions). Fuel figures are posted pump prices, not receipts.",
  "Never treat a range as an asking price. Figures from fewer than 5 records are not returned.",
];

export function buildLlmsTxt(baseUrl: string): string {
  const tools = CATEGORIES.map((c) => c.tool).concat("pricepaid_coverage").join(", ");
  const endpoints = CATEGORIES.map((c) => {
    const ex = exampleUrls().find((e) => e.category === c.id);
    return `- GET ${baseUrl}${ex?.path ?? `/api/v1/${c.restPath}`} — ${c.title.toLowerCase()} (${joinAnd(countriesFor(c.id))})`;
  });
  const history = CATEGORIES.filter((c) => c.history).map(
    (c) => `- GET ${baseUrl}/api/v1/${c.restPath}/history?${new URLSearchParams(exampleUrls().find((e) => e.category === c.id)?.path.split("?")[1] ?? "")}&days=30 — ${c.history!.title.toLowerCase()} (daily snapshots, building up from October 2026)`,
  );
  return `# ProofPrice

> Real prices actually paid, for AI agents. Ask "what did people actually pay for X, here, recently?" and get a range (median, 10th–90th percentile), sample size, period, confidence, source and licence. Built from official open data. Aggregates only.

## Use it
- MCP server (Streamable HTTP): ${baseUrl}/api/mcp — tools: ${tools}
- REST API description (OpenAPI 3.1): ${baseUrl}/openapi.json
- Coverage and licences: ${baseUrl}/api/v1/coverage
- Method: ${baseUrl}/method

## Endpoints
${endpoints.join("\n")}
${history.join("\n")}
- GET ${baseUrl}/api/v1/coverage — sources, licences, update frequency

## Answer format (every endpoint)
${ANSWER_FORMAT}

## Rules for citing
${CITING_RULES.map((r) => `- ${r}`).join("\n")}

## More
- Setup for every AI client and framework: ${baseUrl}/connect
- Everything in one file (tools, parameters, examples, sources, licences): ${baseUrl}/llms-full.txt

## Contact
- hello@proofprice.com
`;
}
