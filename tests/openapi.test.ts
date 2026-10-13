import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOpenApi, buildLlmsTxt } from "../lib/openapi";

test("openapi lists the REST endpoints with required params", () => {
  const spec: any = buildOpenApi("https://example.test");
  assert.equal(spec.openapi, "3.1.0");
  const paths = Object.keys(spec.paths);
  for (const p of ["/api/v1/coverage", "/api/v1/fuel", "/api/v1/home-sales", "/api/v1/fuel/history"]) assert.ok(paths.includes(p), p);
  const hs = spec.paths["/api/v1/home-sales"].get.parameters;
  assert.ok(hs.find((p: any) => p.name === "country" && p.required));
  assert.deepEqual(hs.find((p: any) => p.name === "country").schema.enum.sort(), ["FR", "GB", "SG"]);
  assert.ok(hs.find((p: any) => p.name === "postcode_district")); // a source's extra parameter
  const pt = hs.find((p: any) => p.name === "property_type");
  for (const v of ["terraced", "apartment", "any"]) assert.ok(pt.schema.enum.includes(v), v);
  assert.equal(hs.find((p: any) => p.name === "months").schema.type, "integer");
  const fuel = spec.paths["/api/v1/fuel"].get.parameters;
  assert.ok(fuel.find((p: any) => p.name === "fuel" && p.required));
  assert.match(fuel.find((p: any) => p.name === "area").description, /ES: province code/);
  assert.equal(spec.paths["/api/v1/fuel"].get.operationId, "fuelPricesNow");
  assert.equal(spec.paths["/api/v1/home-sales"].get.operationId, "homeSales");
  assert.equal(spec.servers[0].url, "https://example.test");
});

test("llms.txt points at the MCP, OpenAPI and coverage URLs", () => {
  const t = buildLlmsTxt("https://example.test");
  assert.match(t, /^# ProofPrice/);
  for (const p of ["/api/mcp", "/openapi.json", "/api/v1/coverage", "/api/v1/fuel/history"]) assert.ok(t.includes("https://example.test" + p), p);
  for (const tool of ["pricepaid_home_sales", "pricepaid_fuel_prices_now", "pricepaid_coverage"]) assert.ok(t.includes(tool), tool);
});

test("llms.txt describes the answer format", () => {
  const t = buildLlmsTxt("https://example.test");
  for (const k of ["median", "sample_size", "confidence", "attribution"]) assert.ok(t.includes(k));
});
