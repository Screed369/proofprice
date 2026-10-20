// OpenAPI 3.1 description of the REST API, and the llms.txt text, generated from the plug-in registry.
// Pure functions, unit-tested. Nothing here needs editing when a source or category is added.

import { z } from "zod";
import type { CategoryPlugin } from "./plugin";
import { CATEGORIES, countriesFor, countryHelp, exampleUrls, historySources, paramSchemas, sourcesFor, toolDescription } from "./registry";
import { CHECK_REST, CHECK_TOOL, checkExamplePath } from "./check";
import { checkResultSchema, coverageSchema, errorSchema, historyAnswerSchema, priceAnswerSchema, toJsonSchema } from "./schemas";
import { SERVICE_VERSION, SITE_URL } from "./site/constants";
import { joinAnd } from "./text";

const jsonBody = (schemaName: string) => ({ content: { "application/json": { schema: { $ref: `#/components/schemas/${schemaName}` } } } });

const STALE_HEADER = {
  "X-ProofPrice-Stale": {
    description:
      "Present only when the official source did not respond and the answer is ProofPrice's own recent daily copy: snapshot=<date>. The body says so too (extra.stale is true).",
    schema: { type: "string" },
  },
};

const answerResponses = {
  "200": {
    description:
      "A price answer: median, 10th–90th percentile range, sample size, period, confidence, source and licence. " +
      "For an official statistic: the published average or median (value, measure), its reference period, confidence, source and licence; the range fields and sample_size may be null. " +
      "If the official source does not respond and ProofPrice holds a recent daily copy of it, you get that copy instead of an error: status is ok, period and as_of carry the snapshot date, the notice says so and extra.stale is true.",
    headers: STALE_HEADER,
    ...jsonBody("PriceAnswer"),
  },
  "400": { description: "Missing or invalid parameter, or a country that is not covered yet.", ...jsonBody("Error") },
  "502": { description: "The official source could not be reached and ProofPrice holds no recent copy of it.", ...jsonBody("Error") },
};

const historyResponses = {
  "200": {
    description:
      "A daily series from the ProofPrice price library: date, median, typical_low, typical_high and sample_size for each day, with the change over the period, source and licence. " +
      "status is ok (two or more days), insufficient_history (one day so far) or no_history_yet.",
    ...jsonBody("HistoryAnswer"),
  },
  "400": { description: "Missing or invalid parameter, a country that is not covered yet, or a place this history does not key on.", ...jsonBody("Error") },
};

export function jsonSchemaOf(schema: z.ZodTypeAny): Record<string, unknown> {
  const s: any = z.toJSONSchema(schema, { unrepresentable: "any" });
  delete s.$schema;
  delete s.description;
  if (s.maximum === Number.MAX_SAFE_INTEGER) delete s.maximum;
  return s;
}

function parameters(catId: string, onlyCountries?: string[]) {
  const cat = CATEGORIES.find((c) => c.id === catId)!;
  const required = new Set(cat.required ?? []);
  const params = [
    {
      name: "country",
      in: "query",
      required: true,
      description: countryHelp(cat),
      schema: { type: "string", enum: onlyCountries ?? countriesFor(cat.id) },
    },
  ];
  for (const [name, schema] of Object.entries(paramSchemas(cat))) {
    params.push({ name, in: "query", required: required.has(name), description: schema.description ?? "", schema: jsonSchemaOf(schema) as any });
  }
  return params;
}

const FIXED_TAG = "Coverage";
const CHECK_TAG = "Price check";

/** The text of an MCP tool description names other tools (pricepaid_fuel_prices_now); in the REST description say the endpoint instead. */
function restWording(text: string): string {
  const byTool = new Map<string, string>();
  for (const c of CATEGORIES) {
    byTool.set(c.tool, `GET /api/v1/${c.restPath}`);
    if (c.history) byTool.set(c.history.tool, `GET /api/v1/${c.restPath}/history`);
  }
  byTool.set("pricepaid_coverage", "GET /api/v1/coverage");
  byTool.set(CHECK_TOOL, `GET ${CHECK_REST}`);
  return text.replace(/pricepaid_[a-z0-9_]+/g, (name) => byTool.get(name) ?? name);
}

function operationId(tool: string): string {
  return tool.replace(/^pricepaid_/, "").replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

/** One tag per category, named after the category's title, so directories group the operations the way the MCP tools are grouped. */
function tagFor(cat: CategoryPlugin) {
  const sources = sourcesFor(cat.id).map((s) => s.info.name);
  return {
    name: cat.title,
    description: `${cat.noun}: ${joinAnd(countriesFor(cat.id))}. Sources: ${joinAnd(sources)}.`,
  };
}

/** Parameters of GET /api/v1/check: the check's own fields, country, and the union of every category's parameters. */
function checkParameters() {
  const params: any[] = [
    { name: "category", in: "query", required: true, description: `Which kind of price: ${joinAnd(CATEGORIES.map((c) => c.id))} (the REST path or the tool name also works).`, schema: { type: "string", enum: CATEGORIES.map((c) => c.id) } },
    { name: "country", in: "query", required: true, description: "ISO country code of the place (for example IE, GB, FR). Which countries a category covers: /api/v1/coverage.", schema: { type: "string" } },
    { name: "price", in: "query", required: true, description: "The price to check, a number above zero (for example 2400 or 1.95), in the currency and unit below (or the evidence's, if those are left out).", schema: { type: "number", exclusiveMinimum: 0 } },
    { name: "currency", in: "query", required: false, description: "ISO 4217 currency code of the price. Defaults to the evidence currency. A different currency gives cannot_judge: ProofPrice never converts.", schema: { type: "string" } },
    { name: "unit", in: "query", required: false, description: "What the price is per, for example 'per month' or 'per litre'. Defaults to the evidence unit. A different unit gives cannot_judge.", schema: { type: "string" } },
    { name: "includes", in: "query", required: false, description: "What the price includes or excludes, free text (for example 'VAT included, delivery excluded'). Echoed back as a caution; it does not adjust the figure.", schema: { type: "string" } },
  ];
  const seen = new Map<string, { notes: string[]; schema: z.ZodTypeAny }>();
  for (const cat of CATEGORIES) {
    for (const [name, schema] of Object.entries(paramSchemas(cat))) {
      const e = seen.get(name) ?? { notes: [], schema };
      e.notes.push(`${cat.id}: ${(schema.description ?? "").replace(/\s+/g, " ").slice(0, 200)}`);
      seen.set(name, e);
    }
  }
  for (const [name, e] of seen) {
    if (["category", "country", "price", "currency", "unit", "includes"].includes(name)) continue;
    params.push({ name, in: "query", required: false, description: `Parameter of the category (same name and meaning as on its own endpoint). ${e.notes.join(" | ")}`, schema: {} });
  }
  return params;
}

export function buildOpenApi(baseUrl: string) {
  const paths: Record<string, unknown> = {};
  for (const cat of CATEGORIES) {
    const places = joinAnd(sourcesFor(cat.id).flatMap((s) => s.countries));
    const tag = cat.title;
    paths[`/api/v1/${cat.restPath}`] = {
      get: {
        operationId: operationId(cat.tool),
        tags: [tag],
        summary: `${cat.title} (${places})`,
        description: restWording(toolDescription(cat)),
        parameters: parameters(cat.id),
        responses: answerResponses,
      },
    };
    if (cat.history) {
      paths[`/api/v1/${cat.restPath}/history`] = {
        get: {
          operationId: operationId(cat.history.tool),
          tags: [tag],
          summary: `${cat.history.title} (daily snapshots, ${joinAnd(historySources(cat).flatMap((s) => s.countries))})`,
          description: restWording(cat.history.description),
          parameters: [
            ...parameters(cat.id, [...new Set(historySources(cat).flatMap((s) => s.countries))]),
            { name: "days", in: "query", required: false, description: "How many recent days to include (2–366). Default 30.", schema: { type: "integer", minimum: 2, maximum: 366, default: 30 } },
            { name: "months", in: "query", required: false, description: "Instead of days: how many whole months of monthly history to return (2–360), for sources with long history loaded.", schema: { type: "integer", minimum: 2, maximum: 360 } },
          ],
          responses: historyResponses,
        },
      };
    }
  }
  paths[CHECK_REST] = {
    get: {
      operationId: operationId(CHECK_TOOL),
      tags: [CHECK_TAG],
      summary: "Check a price before you pay",
      description:
        "Compare a proposed price with recorded official evidence. Runs the category's normal answer (same data, cache and stale-if-error) and returns a verdict: within_typical_range, above_typical_range or below_typical_range when the evidence is a set of records (10th–90th percentile); about_average, above_average or below_average when the evidence is one official average or median (within 5% is about_average; it says plainly this is an average, not a distribution); or cannot_judge when the currency or unit differs (never converted), there are too few records or nothing matched. " +
        "Also returns where the price sits, the reasons and cautions (posted prices are not paid prices, old periods), what is missing, one quotable sentence, and the full evidence answer with its audit-trail fields. Information, not a valuation or advice.",
      parameters: checkParameters(),
      responses: {
        "200": { description: "A verdict with its evidence. cannot_judge is a normal 200 answer, with the reason in reasons and missing.", headers: STALE_HEADER, ...jsonBody("CheckResult") },
        "400": { description: "Missing or invalid parameter (for example no price, or a country the category does not cover).", ...jsonBody("Error") },
        "502": { description: "The official source could not be reached and ProofPrice holds no recent copy of it.", ...jsonBody("Error") },
      },
    },
  };
  paths["/api/v1/coverage"] = {
    get: {
      operationId: "coverage",
      tags: [FIXED_TAG],
      summary: "Which countries, categories and sources are covered",
      description:
        "Call this first when unsure whether a place is covered. Lists every tool and REST path with its countries, every source with its publisher, licence and update frequency, working example requests and what is coming next.",
      responses: {
        "200": { description: "Tools, sources with licence and update frequency, examples and rules.", ...jsonBody("Coverage") },
      },
    },
  };
  return {
    openapi: "3.1.0",
    info: {
      title: "ProofPrice API",
      termsOfService: `${SITE_URL}/terms`,
      contact: { name: "ProofPrice", email: "hello@proofprice.com", url: SITE_URL },
      license: { name: "ProofPrice terms of use", url: `${SITE_URL}/terms` },
      "x-logo": { url: `${SITE_URL}/icon-512.png` },
      version: SERVICE_VERSION,
      description:
        "What did people actually pay for X, here, recently? Returns a price range from official open data: median, 10th–90th percentile, sample size, period, confidence, source and licence. Aggregates only; never individual records. " +
        "The data keeps each source's own licence: every answer names its source, that source's licence and the attribution line to show, so reuse follows the publisher's licence. " +
        "The ProofPrice terms of use govern use of the API itself. Free, read-only, no API key. A few premium calls (price check, daily history) may cost a few cents each once payments are switched on, paid per call with x402 after a free daily allowance; see " + `${SITE_URL}/pricing` + " and " + `${SITE_URL}/pricing.json`+ ".",
    },
    servers: [{ url: baseUrl }],
    tags: [...CATEGORIES.map(tagFor), { name: CHECK_TAG, description: "Check a proposed price against recorded official evidence before paying." }, { name: FIXED_TAG, description: "Which countries, categories and official sources are covered." }],
    paths,
    components: {
      schemas: {
        Error: toJsonSchema(errorSchema),
        PriceAnswer: toJsonSchema(priceAnswerSchema),
        CheckResult: toJsonSchema(checkResultSchema),
        HistoryAnswer: toJsonSchema(historyAnswerSchema),
        Coverage: toJsonSchema(coverageSchema),
      },
    },
  };
}

/** The answer format and citing rules, shared by llms.txt and llms-full.txt. */
export const ANSWER_FORMAT =
  'JSON with: query, status ("ok" or not), price {currency, unit, value, measure ("median" for ranges built from records, "average" or "median" for official statistics), median, typical_low, typical_high, min, max}, sample_size, period {from, to}, confidence (low / medium / high), price_type ("transaction", "posted_pump_price", "posted_price", "contract_price", "reimbursement_price" or "official_statistic"), as_of, source {id, name, publisher, licence, licence_url, attribution, url}, method, method_url, summary (one plain sentence), notice, an optional statistic {measure, reference_period} (official statistics only), and an optional extra object.\n' +
  "Audit trail (every answer): answer_id (a stable hash of source id, normalised query, data period and method_version: the same question on the same data gives the same id, so keep it with your reasoning), method_version (per source, default \"1\"), retrieved_at (when ProofPrice produced the answer) and evidence {type (same as price_type), label (for example \"Recorded sale prices\", \"Official published average\", \"Posted shelf or pump price\", \"Contract award value\", \"Regulated reimbursement price\"), meaning (one sentence on what this kind of evidence does and does not establish)}.\n" +
  "Reliability (every answer, additive): reliability (official_with_count, official_median_no_count, record_level, thin, stale or insufficient_data: how far to trust the figure as a distribution of real prices; confidence is unchanged and, for an official average, 'high' means the publisher is official, not that a record count was checked), data_as_of (ISO date of the newest data point, or null), data_age_days (whole days since data_as_of, or null) and suggestions (short plain things to try next, such as widening the period or area or asking for an itemised quote).\n" +
  "value is the headline figure and measure says what kind of figure it is. typical_low and typical_high are the 10th and 90th percentiles.\n" +
  "For official statistics (price_type official_statistic) the range fields (median, typical_low, typical_high, min, max) may be null, because the publisher gives one figure and not a distribution, and sample_size may be null when the publisher does not state it.\n" +
  "If the official source did not respond and ProofPrice holds a recent daily copy of it, the answer is that copy instead of an error: status is ok, period and as_of give the snapshot date, the notice says so and extra.stale is true (REST also sets an X-ProofPrice-Stale header).";

export const CITING_RULES = [
  "Cite the source and attribution line returned with each answer.",
  "Home figures are prices paid (transactions). Fuel figures are posted pump prices, not receipts.",
  "Official statistics (price_type official_statistic, such as household energy prices from Eurostat) are an average or median that a statistics office or regulator publishes: quote them with their reference period and source, never as individual sales or offers.",
  "Never treat a range as an asking price. Figures from fewer than 5 records are not returned.",
];

export function buildLlmsTxt(baseUrl: string): string {
  const tools = CATEGORIES.map((c) => c.tool).concat(CHECK_TOOL, "pricepaid_coverage").join(", ");
  const checkExample = `${baseUrl}${checkExamplePath()}`;
  const endpoints = CATEGORIES.map((c) => {
    const ex = exampleUrls().find((e) => e.category === c.id);
    return `- GET ${baseUrl}${ex?.path ?? `/api/v1/${c.restPath}`} — ${c.title.toLowerCase()} (${joinAnd(countriesFor(c.id))})`;
  });
  const history = CATEGORIES.filter((c) => c.history).map((c) => {
    // an example of a source that really keeps history (the first example of the category may belong to one that does not)
    const keepers = new Set(historySources(c).map((s) => s.info.id));
    const ex = exampleUrls().find((e) => e.category === c.id && keepers.has(e.source)) ?? exampleUrls().find((e) => e.category === c.id);
    return `- GET ${baseUrl}/api/v1/${c.restPath}/history?${new URLSearchParams(ex?.path.split("?")[1] ?? "")}&days=30 — ${c.history!.title.toLowerCase()} (daily snapshots of ${joinAnd(historySources(c).flatMap((s) => s.countries))})`;
  });
  return `# ProofPrice

> Real prices actually paid, for AI agents. Ask "what did people actually pay for X, here, recently?" and get a range (median, 10th–90th percentile), sample size, period, confidence, source and licence. Built from official open data. Aggregates only. Check a price before you pay: give a proposed price and get a verdict against the recorded evidence.

## Check a price before you pay
- MCP tool ${CHECK_TOOL}, or GET ${baseUrl}${CHECK_REST}: give category, country, the category's own parameters and price (optional: currency, unit, includes).
- Returns a verdict (within_typical_range, above_typical_range, below_typical_range, about_average, above_average, below_average or cannot_judge), where the price sits, the reasons, what is missing, one quotable sentence and the full evidence answer. Currencies and units are never converted: a mismatch is cannot_judge.
- Example: ${checkExample}

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
- Every source with its publisher, licence and limits: ${baseUrl}/sources
- Pricing: what is free forever, what premium calls cost, how agents pay per call with x402 (JSON: ${baseUrl}/pricing.json): ${baseUrl}/pricing
- How we check sources and earn trust: ${baseUrl}/trust
- Freshness and health of every source: ${baseUrl}/status
- Ready answers by country, category and place (from the daily price library): ${baseUrl}/prices
- Privacy notice: ${baseUrl}/privacy
- Terms of use: ${baseUrl}/terms

## Contact
- hello@proofprice.com
`;
}
