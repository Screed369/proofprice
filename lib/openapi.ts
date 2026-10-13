// OpenAPI 3.1 description of the REST API, and the llms.txt text. Pure functions, unit-tested.
// Keep in step with app/api/v1/* and the MCP tool schemas in app/api/mcp/route.ts.

const FUELS = ["diesel", "petrol95", "petrol98", "e10", "e85", "lpg", "methane"];
const PROPERTY_TYPES = ["detached", "semi-detached", "terraced", "flat-maisonette", "house", "apartment", "any"];
const FLAT_TYPES = ["1 ROOM", "2 ROOM", "3 ROOM", "4 ROOM", "5 ROOM", "EXECUTIVE", "MULTI-GENERATION"];

const q = (name: string, description: string, schema: Record<string, unknown> = { type: "string" }, required = false) => ({
  name,
  in: "query",
  required,
  description,
  schema,
});

const answerResponses = {
  "200": {
    description: "A price answer: median, 10th–90th percentile range, sample size, period, confidence, source and licence.",
    content: { "application/json": { schema: { type: "object", additionalProperties: true } } },
  },
  "400": { description: "Missing or invalid parameter.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
  "502": { description: "The official source could not be reached.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
};

export function buildOpenApi(baseUrl: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "ProofPrice API",
      version: "0.2.0",
      description:
        "What did people actually pay for X, here, recently? Returns a price range from official open data: median, 10th–90th percentile, sample size, period, confidence, source and licence. Aggregates only; never individual records.",
    },
    servers: [{ url: baseUrl }],
    paths: {
      "/api/v1/home-sales": {
        get: {
          operationId: "homeSales",
          summary: "Home sale prices actually paid (GB, FR, SG)",
          description: "Use for what homes sold for in a town or area. Not for rents, asking prices or commercial property.",
          parameters: [
            q("country", "GB = England & Wales, FR = France, SG = Singapore HDB resale", { type: "string", enum: ["GB", "FR", "SG"] }, true),
            q("town", "Town or city. Required for GB and SG"),
            q("postcode", "FR only: 5-digit postcode, e.g. 69003"),
            q("postcode_district", "GB only: postcode district such as BS8"),
            q("property_type", "GB: detached, semi-detached, terraced, flat-maisonette. FR: house or apartment", { type: "string", enum: PROPERTY_TYPES }),
            q("flat_type", "SG only", { type: "string", enum: FLAT_TYPES }),
            q("months", "Recent months to include (default 12)", { type: "integer", minimum: 1, maximum: 36 }),
          ],
          responses: answerResponses,
        },
      },
      "/api/v1/fuel": {
        get: {
          operationId: "fuelPricesNow",
          summary: "Live pump prices (FR, ES, IT)",
          description: "Posted pump prices now, not historical prices. Not for other countries.",
          parameters: [
            q("country", "FR, ES or IT", { type: "string", enum: ["FR", "ES", "IT"] }, true),
            q("fuel", "Fuel type; petrol95 = unleaded 95; methane = CNG per kg", { type: "string", enum: FUELS }, true),
            q("postcode", "FR or ES: 5-digit postcode"),
            q("area", "FR department ('69'), ES province code ('28'), IT province ('MI')"),
            q("town", "ES or IT: town / comune name"),
            q("service", "IT only: self (default) or served", { type: "string", enum: ["self", "served"] }),
          ],
          responses: answerResponses,
        },
      },
      "/api/v1/coverage": {
        get: {
          operationId: "coverage",
          summary: "Which countries, categories and sources are covered",
          responses: { "200": { description: "Sources with licence and update frequency.", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } } },
        },
      },
    },
    components: {
      schemas: {
        Error: { type: "object", properties: { error: { type: "string" }, detail: {} }, required: ["error"] },
      },
    },
  };
}

export function buildLlmsTxt(baseUrl: string): string {
  return `# ProofPrice

> Real prices actually paid, for AI agents. Ask "what did people actually pay for X, here, recently?" and get a range (median, 10th–90th percentile), sample size, period, confidence, source and licence. Built from official open data. Aggregates only.

## Use it
- MCP server (Streamable HTTP): ${baseUrl}/api/mcp — tools: pricepaid_home_sales, pricepaid_fuel_prices_now, pricepaid_coverage
- REST API description (OpenAPI 3.1): ${baseUrl}/openapi.json
- Coverage and licences: ${baseUrl}/api/v1/coverage
- Method: ${baseUrl}/method

## Endpoints
- GET ${baseUrl}/api/v1/home-sales?country=GB&town=Bristol&property_type=terraced — home sale prices paid (GB, FR, SG)
- GET ${baseUrl}/api/v1/fuel?country=FR&postcode=75015&fuel=diesel — live pump prices (FR, ES, IT)
- GET ${baseUrl}/api/v1/coverage — sources, licences, update frequency

## Rules for citing
- Cite the source and attribution line returned with each answer.
- Home figures are prices paid (transactions). Fuel figures are posted pump prices, not receipts.
- Never treat a range as an asking price. Figures from fewer than 5 records are not returned.
`;
}
