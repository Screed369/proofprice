// The light homes address (/api/mcp/homes): four tools, the same public names and handlers as /api/mcp, a short tool list. No network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.PROOFPRICE_LIBRARY_DIR = mkdtempSync(path.join(tmpdir(), "pp-homes-"));
delete process.env.BLOB_STORE_ID;
delete process.env.BLOB_READ_WRITE_TOKEN;

import { z } from "zod";
import { buildToolSpecs, createProofPriceMcpHandler, HOMES_TOOLS } from "../lib/mcp-tools";

const HEADERS = { "content-type": "application/json", accept: "application/json, text/event-stream" };
const META = { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientInfo": { name: "spec-test", version: "1" }, "io.modelcontextprotocol/clientCapabilities": {} };
const main = createProofPriceMcpHandler();
const homes = createProofPriceMcpHandler(undefined, { tools: HOMES_TOOLS, homes: true });

async function rpc(h: (r: Request) => Promise<Response>, url: string, method: string, params: Record<string, unknown>) {
  const res = await h(new Request(url, { method: "POST", headers: { ...HEADERS, "mcp-method": method, ...(method === "tools/call" ? { "mcp-name": String(params.name) } : {}), "mcp-protocol-version": "2026-07-28" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: { ...params, _meta: META } }) }));
  const text = await res.text();
  return JSON.parse(text.startsWith("event:") ? text.split("\n").find((l) => l.startsWith("data:"))!.slice(5) : text);
}

test("the homes address lists exactly the four homes tools, under their public names", async () => {
  const body = await rpc(homes, "http://localhost/api/mcp/homes", "tools/list", {});
  assert.deepEqual(body.result.tools.map((t: { name: string }) => t.name).sort(), ["pricepaid_check_price", "pricepaid_coverage", "pricepaid_home_sales", "pricepaid_rent_prices"]);
});

test("each homes tool is the same tool as on the main address (same text, inputs, handler path)", async () => {
  const a = await rpc(main, "http://localhost/api/mcp", "tools/list", {});
  const b = await rpc(homes, "http://localhost/api/mcp/homes", "tools/list", {});
  // the check tool is the one deliberate difference: on the homes address it speaks of homes and rent only (tests/chatgpt-directory.test.ts)
  for (const t of b.result.tools) {
    if (t.name === "pricepaid_check_price") continue;
    assert.deepEqual(t, a.result.tools.find((x: { name: string }) => x.name === t.name), t.name);
  }
  // one builder makes the specs for both addresses, so the handler is the same function path
  const names = new Set<string>(HOMES_TOOLS);
  assert.equal(buildToolSpecs().filter((s) => names.has(s.name)).length, 4);
  const cov = (h: typeof main, url: string) => rpc(h, url, "tools/call", { name: "pricepaid_coverage", arguments: { category: "rent", country: "IE" } });
  assert.deepEqual((await cov(homes, "http://localhost/api/mcp/homes")).result.structuredContent, (await cov(main, "http://localhost/api/mcp")).result.structuredContent);
});

test("the main address still lists every tool", async () => {
  const a = await rpc(main, "http://localhost/api/mcp", "tools/list", {});
  assert.equal(a.result.tools.length, buildToolSpecs().length);
});

test("the whole homes tool list is under 8,000 tokens (4 characters a token, measured as in tool-list-size.test.ts)", () => {
  const names = new Set<string>(HOMES_TOOLS);
  let chars = 0;
  for (const s of buildToolSpecs().filter((x) => names.has(x.name))) {
    const c: any = s.config;
    chars += s.name.length + c.title.length + c.description.length;
    chars += JSON.stringify(z.toJSONSchema(c.inputSchema, { io: "input" })).length;
    chars += JSON.stringify(z.toJSONSchema(c.outputSchema, { io: "output", unrepresentable: "any" })).length;
  }
  const tokens = Math.round(chars / 4);
  console.log(`homes tool list: about ${tokens} tokens`);
  assert.ok(tokens < 8000, `homes tool list is about ${tokens} tokens`);
});
