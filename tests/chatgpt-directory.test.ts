// Readiness for OpenAI's plugin directory: the homes-only check tool, no pricing text on the homes address, the domain-verification token.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.PROOFPRICE_LIBRARY_DIR = mkdtempSync(path.join(tmpdir(), "pp-dir-"));
delete process.env.BLOB_STORE_ID;
delete process.env.BLOB_READ_WRITE_TOKEN;

import { buildToolSpecs, createProofPriceMcpHandler, HOMES_TOOLS, registerTools } from "../lib/mcp-tools";
import { challengeToken } from "../lib/openai-challenge";
import { GET as challengeRoute } from "../app/.well-known/openai-apps-challenge/route";

const HEADERS = { "content-type": "application/json", accept: "application/json, text/event-stream" };
const META = { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientInfo": { name: "dir-test", version: "1" }, "io.modelcontextprotocol/clientCapabilities": {} };

async function rpc(h: (r: Request) => Promise<Response>, method: string, params: Record<string, unknown>) {
  const res = await h(new Request("http://localhost/api/mcp/homes", { method: "POST", headers: { ...HEADERS, "mcp-method": method, ...(method === "tools/call" ? { "mcp-name": String(params.name) } : {}), "mcp-protocol-version": "2026-07-28" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: { ...params, _meta: META } }) }));
  const text = await res.text();
  return JSON.parse(text.startsWith("event:") ? text.split("\n").find((l) => l.startsWith("data:"))!.slice(5) : text);
}

const homes = () => createProofPriceMcpHandler(undefined, { tools: HOMES_TOOLS, homes: true });
const checkTool = (body: any) => body.result.tools.find((t: { name: string }) => t.name === "pricepaid_check_price");

test("homes server: the check tool talks about homes and rent only", async () => {
  const t = checkTool(await rpc(homes(), "tools/list", {}));
  const all = JSON.stringify(t);
  for (const word of ["fuel", "medicine", "contract", "litre", "energy"]) assert.ok(!all.toLowerCase().includes(word), `mentions ${word}`);
  assert.match(t.description, /home/);
  assert.match(JSON.stringify(t.inputSchema.properties.category), /home-sales and rent/);
});

test("homes server: another category gets a plain error naming the two it supports", async () => {
  const body = await rpc(homes(), "tools/call", { name: "pricepaid_check_price", arguments: { category: "fuel", country: "IE", price: 1.8 } });
  assert.equal(body.result.isError, true);
  assert.match(body.result.content[0].text, /home-sales/);
  assert.match(body.result.content[0].text, /rent/);
});

test("full server: tool names, descriptions and schemas are untouched by the homes code path", async () => {
  const plain = buildToolSpecs();
  const explicitOff = buildToolSpecs(undefined, { homes: false });
  assert.deepEqual(plain.map((s) => [s.name, s.config.description, JSON.stringify((s.config.inputSchema as any).shape ?? null)]), explicitOff.map((s) => [s.name, s.config.description, JSON.stringify((s.config.inputSchema as any).shape ?? null)]));
  const main = await rpc(createProofPriceMcpHandler(), "tools/list", {});
  assert.equal(main.result.tools.length, plain.length);
  const c = checkTool(main);
  assert.match(c.description, /fuel/);
  assert.match(c.description, /medicine/);
  // the homes-only wording is not what the full server says
  assert.notEqual(c.description, checkTool(await rpc(homes(), "tools/list", {})).description);
});

test("homes server with the payment gate ON: no pricing sentence in any description, full server still has it", async () => {
  Object.assign(process.env, { PROOFPRICE_X402_ENABLED: "true", PROOFPRICE_X402_PAY_TO: "0x1111111111111111111111111111111111111111" });
  try {
    const h = checkTool(await rpc(homes(), "tools/list", {}));
    assert.ok(!/USD|x402|per answered call|free calls/i.test(h.description), h.description);
    const m = checkTool(await rpc(createProofPriceMcpHandler(), "tools/list", {}));
    assert.match(m.description, /x402/, "the full server keeps its gate wording");
  } finally {
    delete process.env.PROOFPRICE_X402_ENABLED;
    delete process.env.PROOFPRICE_X402_PAY_TO;
  }
});

test("challengeToken: trims, and refuses unset, empty, odd characters or over 512 characters", () => {
  assert.equal(challengeToken({}), null);
  assert.equal(challengeToken({ OPENAI_APPS_CHALLENGE: "" }), null);
  assert.equal(challengeToken({ OPENAI_APPS_CHALLENGE: "   \n" }), null);
  assert.equal(challengeToken({ OPENAI_APPS_CHALLENGE: "  abc-DEF_1.2=+/x\n" }), "abc-DEF_1.2=+/x");
  assert.equal(challengeToken({ OPENAI_APPS_CHALLENGE: "abc def" }), null);
  assert.equal(challengeToken({ OPENAI_APPS_CHALLENGE: "abc\ndef" }), null);
  assert.equal(challengeToken({ OPENAI_APPS_CHALLENGE: '{"a":1}' }), null);
  assert.equal(challengeToken({ OPENAI_APPS_CHALLENGE: "a".repeat(512) })?.length, 512);
  assert.equal(challengeToken({ OPENAI_APPS_CHALLENGE: "a".repeat(513) }), null);
});

test("/.well-known/openai-apps-challenge: token as plain text, or an uncached 404", async () => {
  delete process.env.OPENAI_APPS_CHALLENGE;
  const missing = challengeRoute();
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get("cache-control"), "no-store");
  assert.match(missing.headers.get("content-type") ?? "", /^text\/plain/);
  process.env.OPENAI_APPS_CHALLENGE = " test-token_123 ";
  try {
    const ok = challengeRoute();
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("content-type"), "text/plain; charset=utf-8");
    assert.equal(await ok.text(), "test-token_123");
  } finally {
    delete process.env.OPENAI_APPS_CHALLENGE;
  }
});

test("homes address with the payment gate ON: the check tool is registered plain, so it never answers with a payment reply", async () => {
  const env = { PROOFPRICE_X402_ENABLED: "true", PROOFPRICE_X402_PAY_TO: "0x1111111111111111111111111111111111111111" };
  let calls = 0;
  const spec = {
    premium: "check",
    name: "pricepaid_check_price",
    config: { title: "t", description: "plain text", inputSchema: {}, outputSchema: {}, annotations: {} },
    call: async () => ({ content: [{ type: "text", text: "ok" }], structuredContent: { status: "ok", n: ++calls } }),
  };
  const seen: { config: { description: string }; handler: (a: Record<string, unknown>, c?: unknown) => Promise<any> }[] = [];
  const server = { registerTool: (_n: string, config: any, handler: any) => seen.push({ config, handler }) };

  registerTools(server, [spec as any], env, { noGate: true });
  assert.equal(seen[0].config.description, "plain text", "no pricing sentence");
  // far past the 20-a-day free allowance of the gated tool: every call is still answered
  for (let i = 1; i <= 70; i++) {
    const r = await seen[0].handler({}, {});
    assert.ok(!r.isError, `call ${i} answered`);
    assert.equal(r.structuredContent.n, i);
  }

  // the same spec on the full server keeps the gate and its wording
  registerTools(server, [spec as any], env);
  assert.match(seen[1].config.description, /x402/);
});
