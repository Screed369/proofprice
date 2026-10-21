// The A2A Agent Card, built from the live registry so skills always match the deployed categories (S5).
import { CATEGORIES } from "./registry";
import { CHECK_REST, CHECK_TOOL } from "./check";
import { CONTACT, MCP_URL, SITE_URL, SERVER_DESCRIPTION } from "./open-book";
import { SERVICE_VERSION } from "./site/constants";
import { PREMIUM } from "./payments/prices";

export function buildAgentCard() {
  const skills = [
    ...CATEGORIES.map((c) => ({
      id: c.id,
      name: c.title,
      description: `${c.noun}: official price data with its source, licence and basis stated in each answer (read the basis: some are real sales, some official statistics, some posted prices). MCP tool ${c.tool}; REST GET ${SITE_URL}/api/v1/${c.restPath}. Free, no key.`,
      tags: ["prices", "real-prices-paid", c.id],
      inputModes: ["application/json"],
      outputModes: ["application/json"],
    })),
    {
      id: "check",
      name: "Price check",
      description: `Is a quoted price typical? Compares it with recorded prices, with evidence, source and licence. MCP tool ${CHECK_TOOL}; REST GET ${SITE_URL}${CHECK_REST}. ${PREMIUM.check.freePerDay} free a day, then paid per call with x402 once payments are on: see ${SITE_URL}/pricing.`,
      tags: ["prices", "price-check"],
      inputModes: ["application/json"],
      outputModes: ["application/json"],
    },
  ];
  return {
    protocolVersion: "0.3.0",
    name: "ProofPrice",
    description: `${SERVER_DESCRIPTION} This is a read-only price service reached over MCP (${MCP_URL}) and REST (${SITE_URL}/api/v1). It does not run A2A message exchange: use the MCP or REST endpoints, or read ${SITE_URL}/llms.txt.`,
    url: `${SITE_URL}/api/v1`,
    preferredTransport: "HTTP+JSON",
    version: SERVICE_VERSION,
    documentationUrl: `${SITE_URL}/connect`,
    provider: { organization: "ProofPrice", url: SITE_URL },
    iconUrl: `${SITE_URL}/icon.svg`,
    capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
    securitySchemes: {},
    security: [],
    defaultInputModes: ["application/json"],
    defaultOutputModes: ["application/json"],
    skills,
    "x-proofprice": { a2aMessaging: false, urlNote: "url is the REST base, not an A2A endpoint", mcp: MCP_URL, contact: CONTACT, openapi: `${SITE_URL}/openapi.json`, llms: `${SITE_URL}/llms.txt`, pricing: `${SITE_URL}/pricing.json`, mcpServerCard: `${SITE_URL}/.well-known/mcp-server-card` },
  };
}
