// An app may tell us its own name (?app=, X-ProofPrice-App, MCP clientInfo.name) and gets 3x the free daily allowance on premium calls.
// Pins: name validation, the 3x allowance, no bonus for proofprice-* names, nothing personal stored, the named-apps count. No network.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { appNameOfRequest, earnsNamedBonus, validAppName, recordUsage, pendingUsage, resetUsage, summariseUsage, withoutOwnParam, setUsageSink } from "../lib/usage";
import { gateCall, paymentRequiredBody } from "../lib/payments/gate";
import { readGateConfig } from "../lib/payments/config";
import { PREMIUM, freeAllowance } from "../lib/payments/prices";
import { resetQuota } from "../lib/payments/quota";
import type { Facilitator } from "../lib/payments/facilitator";

const NOW = new Date("2026-11-14T12:00:00Z");
const ON = { BLOB_READ_WRITE_TOKEN: "test-token-not-real" };
const cfg = readGateConfig({ PROOFPRICE_X402_ENABLED: "true", PROOFPRICE_X402_PAY_TO: "0x1111111111111111111111111111111111111111" })!;
const facilitator: Facilitator = { async verify() { return { isValid: true }; }, async settle() { return { success: true, transaction: "0x1", network: cfg.caip2 }; } };

beforeEach(() => {
  resetUsage(NOW.getTime());
  setUsageSink(null);
  resetQuota();
});

test("name validation: letters, digits, dot, dash, underscore, space; at most 40; anything else is ignored", () => {
  assert.equal(validAppName("My-App_2.0 beta"), "my-app_2.0 beta");
  assert.equal(validAppName("  rent-bot  "), "rent-bot");
  assert.equal(validAppName("a".repeat(40)), "a".repeat(40));
  assert.equal(validAppName("a".repeat(41)), "");
  for (const bad of ["", "   ", "jane@example.com", "name;drop", "app/1", "héllo", "<b>x</b>", "a,b", null, undefined, 42]) assert.equal(validAppName(bad), "", String(bad));
});

test("REST: ?app= or X-ProofPrice-App; the query wins; an invalid value is ignored; ?app= never reaches the price parameters", () => {
  assert.equal(appNameOfRequest({ url: "https://proofprice.com/api/v1/rent?country=IE&app=my-bot" }), "my-bot");
  assert.equal(appNameOfRequest({ url: "https://proofprice.com/api/v1/rent?country=IE", headers: new Headers({ "x-proofprice-app": "Header App" }) }), "header app");
  assert.equal(appNameOfRequest({ url: "https://proofprice.com/api/v1/rent?app=q-app", headers: new Headers({ "x-proofprice-app": "h-app" }) }), "q-app");
  assert.equal(appNameOfRequest({ url: "https://proofprice.com/api/v1/rent?app=me@x.com", headers: new Headers({ "x-proofprice-app": "h-app" }) }), "h-app");
  assert.equal(appNameOfRequest({ url: "https://proofprice.com/api/v1/rent?app=me@x.com" }), "");
  assert.deepEqual([...withoutOwnParam(new URLSearchParams("country=IE&app=my-bot&ppcheck=1")).keys()], ["country"]);
});

test("the 3x allowance: a named app gets 60 price checks and 30 history calls a day, an unnamed caller 20 and 10", async () => {
  assert.equal(freeAllowance("check", true), 60);
  assert.equal(freeAllowance("history", true), 30);
  assert.equal(freeAllowance("check", false), 20);
  const run = async (callerApp: string | null, key: "check" | "history", address: string) =>
    gateCall({ cfg, facilitator, key, callerAddress: address, callerApp, resourceUrl: "https://proofprice.com/api/v1/check", run: async () => ({ status: "ok" }), chargeable: () => true, now: NOW });
  let served = 0;
  while ((await run("my-bot", "check", "203.0.113.1")).kind === "served") served++;
  assert.equal(served, 60);
  served = 0;
  while ((await run("my-bot", "history", "203.0.113.1")).kind === "served") served++;
  assert.equal(served, 30);
  served = 0;
  while ((await run(null, "check", "203.0.113.2")).kind === "served") served++;
  assert.equal(served, PREMIUM.check.freePerDay);
  served = 0;
  while ((await run("jane@example.com" as any, "check", "203.0.113.3")).kind === "served") served++;
  assert.equal(served, 20, "an invalid name earns nothing");
});

test("no bonus for proofprice-* names, or for an invalid name", async () => {
  assert.equal(earnsNamedBonus("proofprice-smoke"), false);
  assert.equal(earnsNamedBonus("ProofPrice-builder"), false);
  assert.equal(earnsNamedBonus("jane@example.com"), false);
  assert.equal(earnsNamedBonus("my-bot"), true);
  let served = 0;
  for (;;) {
    const o = await gateCall({ cfg, facilitator, key: "check", callerAddress: "203.0.113.4", callerApp: "proofprice-smoke", resourceUrl: "x", run: async () => ({}), chargeable: () => true, now: NOW });
    if (o.kind !== "served") break;
    served++;
  }
  assert.equal(served, 20);
});

test("the 402 notice tells callers about the bigger allowance", () => {
  const body: any = paymentRequiredBody(cfg, "check", "https://proofprice.com/api/v1/check");
  assert.match(body.notice, /An app that gives its own name \(clientInfo\.name on MCP, or \?app=your-app on REST\) gets a higher free allowance\. No personal data\./);
  assert.match(body.notice, /60 free calls a day instead of 20/);
});

test("nothing personal is stored: a name is the only extra thing, and a person-like value is dropped", () => {
  recordUsage({ tool: "pricepaid_rent_prices", country: "IE", key: "dublin", status: "ok", client: validAppName("Rent Finder 1") }, NOW, ON);
  recordUsage({ tool: "pricepaid_rent_prices", country: "IE", key: "dublin", status: "ok", client: validAppName("jane.doe@example.com") }, NOW, ON);
  const rows = pendingUsage();
  assert.deepEqual(rows.map((r) => r.client).sort(), ["", "rent finder 1"]);
  assert.deepEqual(Object.keys(rows[0]).sort(), ["client", "count", "country", "day", "key", "status", "tool"]);
  assert.ok(!JSON.stringify(rows).includes("example.com"));
});

test("/api/v1/usage counts named apps that asked a real question; probes, crawlers, handshakes and proofprice-* are left out", () => {
  const row = (client: string, tool: string, count = 1) => ({ day: "2026-11-14", tool, country: "IE", key: "dublin", status: "ok" as const, client, count });
  const r = summariseUsage(
    [{ rows: [
      row("rent finder", "pricepaid_rent_prices", 3),
      row("rent finder", "pricepaid_check_price"),
      row("home helper", "pricepaid_home_sales"),
      row("connect only", "mcp_initialize"), // handshake only: did not ask
      row("glama", "pricepaid_rent_prices"), // directory probe
      row("smithery-probe", "pricepaid_rent_prices"),
      row("web-crawler", "pricepaid_rent_prices"),
      row("proofprice-smoke", "pricepaid_rent_prices"),
      row("proofprice-builder", "pricepaid_rent_prices"),
      row("", "pricepaid_rent_prices"), // no name
    ] }],
    new Date("2026-11-14T18:00:00Z"),
  );
  assert.equal(r.named_apps_asking, 2);
  assert.ok(r.fields!.named_apps_asking);
  assert.ok(r.by_client && r.clients && r.real_questions !== undefined, "existing fields are kept");
});

test("MCP: clientInfo.name sent with the request, or an X-ProofPrice-App header, raises the free allowance", async () => {
  const { registerTools } = await import("../lib/mcp-tools");
  const { z } = await import("zod");
  const spec: any = {
    name: "pricepaid_check_price", premium: "check", sources: () => ["eu-energy"],
    config: { title: "T", description: "D.", inputSchema: z.object({}), outputSchema: z.any(), annotations: { title: "T", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } },
    call: async () => ({ content: [{ type: "text", text: "a" }], structuredContent: { verdict: "within_typical_range", answer: { status: "ok" } } }),
  };
  const env = { PROOFPRICE_X402_ENABLED: "true", PROOFPRICE_X402_PAY_TO: "0x1111111111111111111111111111111111111111" };
  let handler: any;
  registerTools({ registerTool: (_n: string, _c: unknown, h: unknown) => { handler = h; } }, [spec], env);
  const ctx = (ip: string, meta?: unknown, headers: Record<string, string> = {}) => ({ http: { req: new Request("https://proofprice.com/api/mcp", { headers: { "x-forwarded-for": ip, ...headers } }) }, mcpReq: { _meta: meta } });
  const count = async (make: () => unknown) => { let n = 0; while (!(await handler({}, make())).isError) n++; return n; };
  assert.equal(await count(() => ctx("198.51.100.1")), 20);
  assert.equal(await count(() => ctx("198.51.100.2", { "io.modelcontextprotocol/clientInfo": { name: "Rent Finder" } })), 60);
  assert.equal(await count(() => ctx("198.51.100.3", undefined, { "x-proofprice-app": "rent-finder" })), 60);
  assert.equal(await count(() => ctx("198.51.100.4", { "io.modelcontextprotocol/clientInfo": { name: "proofprice-smoke" } })), 20);
});
