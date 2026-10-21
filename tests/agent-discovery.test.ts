// S5: A2A agent card and x402 discovery details in the 402 reply. No network, no keys.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.PROOFPRICE_LIBRARY_DIR = mkdtempSync(path.join(tmpdir(), "pp-s5-"));

import { buildAgentCard } from "../lib/agent-card";
import { GET as cardGet } from "../app/.well-known/agent-card.json/route";
import { CATEGORIES } from "../lib/registry";
import { buildLlmsFullTxt } from "../lib/open-book";
import { readGateConfig } from "../lib/payments/config";
import { paymentRequiredBody } from "../lib/payments/gate";
import { bazaarExtension } from "../lib/payments/discovery";
import { PREMIUM } from "../lib/payments/prices";

const PAY_TO = "0x000000000000000000000000000000000000dEaD";

test("agent card: required A2A fields, one skill per category plus check, honest about not running A2A messaging", () => {
  const c: any = buildAgentCard();
  for (const k of ["protocolVersion", "name", "description", "url", "version", "capabilities", "defaultInputModes", "defaultOutputModes", "skills"]) assert.ok(c[k] !== undefined, k);
  assert.equal(c.skills.length, CATEGORIES.length + 1);
  for (const s of c.skills) for (const k of ["id", "name", "description", "tags"]) assert.ok(s[k], `${s.id}.${k}`);
  assert.equal(new Set(c.skills.map((s: any) => s.id)).size, c.skills.length);
  assert.match(c.description, /does not run A2A/);
  assert.deepEqual(c.security, []);
  assert.doesNotMatch(JSON.stringify(c), /secret|private|apikey/i);
});

test("agent card route serves JSON with open CORS", async () => {
  const res = await cardGet();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
  assert.equal((await res.json()).name, "ProofPrice");
});

test("llms-full.txt lists the agent card", () => {
  assert.match(buildLlmsFullTxt("https://proofprice.com"), /\.well-known\/agent-card\.json/);
});

test("402 body carries x402 discovery details for REST and MCP, with no figures and unchanged requirements", () => {
  const cfg = readGateConfig({ PROOFPRICE_X402_ENABLED: "true", PROOFPRICE_X402_PAY_TO: PAY_TO })!;
  const rest: any = paymentRequiredBody(cfg, "check", "https://proofprice.com/api/v1/check");
  assert.equal(rest.x402Version, 2);
  assert.equal(rest.accepts.length, 1);
  assert.equal(rest.accepts[0].amount, String(PREMIUM.check.microUsd));
  const b = rest.extensions.bazaar;
  assert.equal(b.info.input.type, "http");
  assert.equal(b.info.input.method, "GET");
  assert.ok(b.outputSchema && typeof b.outputSchema === "object");
  assert.ok(rest.resource.description);
  const mcp: any = paymentRequiredBody(cfg, "check", "https://proofprice.com/api/mcp");
  assert.equal(mcp.extensions.bazaar.info.input.type, "mcp");
  assert.equal(mcp.extensions.bazaar.info.input.toolName, "pricepaid_check_price");
  const h: any = bazaarExtension("history", "https://proofprice.com/api/v1/fuel/history");
  assert.equal(h.pricing.perCallMicroUsd, PREMIUM.history.microUsd);
  assert.ok(JSON.stringify(rest).length < 20000, "the 402 header (base64 of this body) must stay small enough for HTTP headers");
});

test("PAYMENT-REQUIRED header stays small and still carries the requirements and discovery info", async () => {
  const { gateCall } = await import("../lib/payments/gate");
  const cfg = readGateConfig({ PROOFPRICE_X402_ENABLED: "true", PROOFPRICE_X402_PAY_TO: PAY_TO })!;
  const fac = { verify: async () => ({ isValid: true }), settle: async () => ({ success: true, transaction: "0x1" }) } as any;
  let out: any;
  for (let i = 0; i < 40; i++) {
    out = await gateCall({ cfg, facilitator: fac, key: "check", callerAddress: "198.51.100.77", resourceUrl: "https://proofprice.com/api/v1/check", run: async () => 1, chargeable: () => true });
    if (out.kind === "denied") break;
  }
  assert.equal(out.kind, "denied");
  const hdr = out.headers["payment-required"];
  assert.ok(hdr.length < 6000, `header ${hdr.length}`);
  const decoded = JSON.parse(Buffer.from(hdr, "base64").toString("utf8"));
  assert.equal(decoded.accepts[0].amount, String(PREMIUM.check.microUsd));
  assert.equal(decoded.extensions.bazaar.info.input.type, "http");
  assert.ok(out.body.extensions.bazaar.outputSchema, "full schema stays in the body");
});
