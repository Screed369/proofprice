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
  const homeCountries: string[] = hs.find((p: any) => p.name === "country").schema.enum; // grows as sources are added: check the ones we know
  for (const c of ["FR", "GB", "IE", "SG", "US"]) assert.ok(homeCountries.includes(c), c);
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

test("llms.txt describes official statistics: value, measure, nullable range fields, the new price type", () => {
  const t = buildLlmsTxt("https://example.test");
  for (const k of ["value", "measure", "official_statistic", "reference_period", "statistic", "may be null", "sample_size may be null"]) assert.ok(t.includes(k), k);
  for (const k of ["transaction", "posted_pump_price", "posted_price", "contract_price", "reimbursement_price"]) assert.ok(t.includes(k), k);
  assert.match(t, /Official statistics .*never as individual sales or offers/);
});

test("openapi and llms.txt list the energy endpoint with its parameters and examples", () => {
  const spec: any = buildOpenApi("https://example.test");
  const energy = spec.paths["/api/v1/energy"].get;
  assert.equal(energy.operationId, "energyPrices");
  assert.match(energy.summary, /Household electricity and gas prices/);
  assert.match(energy.description, /^Use this when/);
  const params = energy.parameters;
  const country = params.find((p: any) => p.name === "country");
  assert.equal(country.schema.enum.length, 29);
  for (const c of ["GR", "IE", "DE", "NO", "IS"]) assert.ok(country.schema.enum.includes(c), c);
  assert.ok(params.find((p: any) => p.name === "energy" && p.required));
  assert.deepEqual(params.find((p: any) => p.name === "energy").schema.enum, ["electricity", "gas"]);
  assert.ok(!params.find((p: any) => p.name === "taxes").required);
  assert.deepEqual(params.find((p: any) => p.name === "taxes").schema.enum, ["all", "excl_vat", "none"]);
  assert.ok(!params.find((p: any) => p.name === "consumption_band").required);
  assert.match(params.find((p: any) => p.name === "consumption_band").description, /DC = 2,500 to 4,999 kWh a year/);
  const t = buildLlmsTxt("https://example.test");
  assert.ok(t.includes("pricepaid_energy_prices"));
  assert.ok(t.includes("https://example.test/api/v1/energy?country=IE&energy=electricity"));
});
