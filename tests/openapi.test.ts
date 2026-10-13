import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOpenApi, buildLlmsTxt } from "../lib/openapi";

test("openapi lists the three REST endpoints with required params", () => {
  const spec: any = buildOpenApi("https://example.test");
  assert.equal(spec.openapi, "3.1.0");
  assert.deepEqual(Object.keys(spec.paths).sort(), ["/api/v1/coverage", "/api/v1/fuel", "/api/v1/home-sales"]);
  const hs = spec.paths["/api/v1/home-sales"].get.parameters;
  assert.ok(hs.find((p: any) => p.name === "country" && p.required));
  const fuel = spec.paths["/api/v1/fuel"].get.parameters;
  assert.ok(fuel.find((p: any) => p.name === "fuel" && p.required));
  assert.equal(spec.servers[0].url, "https://example.test");
});

test("llms.txt points at the MCP, OpenAPI and coverage URLs", () => {
  const t = buildLlmsTxt("https://example.test");
  assert.match(t, /^# ProofPrice/);
  for (const p of ["/api/mcp", "/openapi.json", "/api/v1/coverage"]) assert.ok(t.includes("https://example.test" + p));
});
