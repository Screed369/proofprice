// MCP spec currency (S4, 20 Oct 2026): /api/mcp must keep answering older clients (initialize) and the 2026-07-28 stateless
// revision (no initialize; version and client info in each request's _meta; server/discover; resultType on every result).
// Also pins the Server Card served at /.well-known/mcp-server-card. No network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.PROOFPRICE_LIBRARY_DIR = mkdtempSync(path.join(tmpdir(), "pp-mcpspec-"));
delete process.env.BLOB_STORE_ID;
delete process.env.BLOB_READ_WRITE_TOKEN;

import { createProofPriceMcpHandler } from "../lib/mcp-tools";
import { buildServerCard, buildServerJson, MCP_PROTOCOL_VERSIONS } from "../lib/open-book";
import { SERVICE_VERSION } from "../lib/site/constants";
import { GET as cardGet } from "../app/.well-known/mcp-server-card/route";

const handler = createProofPriceMcpHandler();
const HEADERS = { "content-type": "application/json", accept: "application/json, text/event-stream" };
const META = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientInfo": { name: "spec-test", version: "1" },
  "io.modelcontextprotocol/clientCapabilities": {},
};

async function rpc(method: string, params: Record<string, unknown>, extra: Record<string, string> = {}) {
  const res = await handler(
    new Request("http://localhost/api/mcp", { method: "POST", headers: { ...HEADERS, ...extra }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }),
  );
  const text = await res.text();
  const data = text.startsWith("event:") ? text.split("\n").find((l) => l.startsWith("data:"))!.slice(5) : text;
  return { status: res.status, body: JSON.parse(data) };
}

test("2026-07-28: tools/list works without initialize and carries resultType, ttlMs, cacheScope and serverInfo", async () => {
  const { status, body } = await rpc("tools/list", { _meta: META }, { "mcp-method": "tools/list", "mcp-protocol-version": "2026-07-28" });
  assert.equal(status, 200);
  assert.equal(body.result.resultType, "complete");
  assert.equal(typeof body.result.ttlMs, "number");
  assert.ok(["public", "private"].includes(body.result.cacheScope));
  assert.equal(body.result._meta["io.modelcontextprotocol/serverInfo"].version, SERVICE_VERSION);
  assert.ok(body.result.tools.length >= 20);
  const names = body.result.tools.map((t: { name: string }) => t.name);
  const again = await rpc("tools/list", { _meta: META }, { "mcp-method": "tools/list", "mcp-protocol-version": "2026-07-28" });
  assert.deepEqual(again.body.result.tools.map((t: { name: string }) => t.name), names, "tool order is stable between calls");
});

test("2026-07-28: server/discover answers with the supported version, tools capability and instructions", async () => {
  const { status, body } = await rpc("server/discover", { _meta: META }, { "mcp-method": "server/discover", "mcp-protocol-version": "2026-07-28" });
  assert.equal(status, 200);
  assert.ok(body.result.supportedVersions.includes("2026-07-28"));
  assert.ok(body.result.capabilities.tools);
  assert.match(body.result.instructions, /prices actually paid/);
});

test("2026-07-28: a tool call works statelessly and the result says it is complete", async () => {
  const { status, body } = await rpc(
    "tools/call",
    { name: "pricepaid_coverage", arguments: {}, _meta: META },
    { "mcp-method": "tools/call", "mcp-name": "pricepaid_coverage", "mcp-protocol-version": "2026-07-28" },
  );
  assert.equal(status, 200);
  assert.equal(body.result.resultType, "complete");
  assert.ok(body.result.structuredContent);
});

test("older clients still connect with initialize (2025-11-25 and 2025-06-18)", async () => {
  for (const v of ["2025-11-25", "2025-06-18"]) {
    const { status, body } = await rpc("initialize", { protocolVersion: v, capabilities: {}, clientInfo: { name: "old", version: "1" } });
    assert.equal(status, 200);
    assert.equal(body.result.protocolVersion, v);
    assert.equal(body.result.serverInfo.name, "proofprice");
  }
});

test("Server Card: same identity as server.json, one keyless remote, versions we really answer, CORS open", async () => {
  const card = buildServerCard(SERVICE_VERSION);
  const json = buildServerJson(SERVICE_VERSION);
  for (const k of ["name", "title", "description", "version", "websiteUrl", "repository"] as const) assert.deepEqual(card[k], json[k]);
  assert.equal(card.remotes.length, 1);
  assert.equal(card.remotes[0].url, json.remotes[0].url);
  assert.deepEqual(card.remotes[0].supportedProtocolVersions, MCP_PROTOCOL_VERSIONS);
  assert.match(card.name, /^[^/]+\/[^/]+$/, "reverse-DNS name with exactly one slash");
  assert.ok(!JSON.stringify(card).match(/key|secret|token/i));
  const res = await cardGet();
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
  assert.match(res.headers.get("content-type") ?? "", /application\/json/);
  assert.deepEqual(await res.json(), card);
});
