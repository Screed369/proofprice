// The MCP tool list is read in full by an AI before it asks anything. Keep it small (see lib/mcp-slim.ts).
import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { buildToolSpecs } from "../lib/mcp-tools";
import { slimAnswerSchema, clip } from "../lib/mcp-slim";

const BUDGET_TOKENS = 60_000; // 4 characters a token; was about 166,000 on 12 Nov 2026

test("the whole tool list stays under budget", () => {
  const specs = buildToolSpecs();
  let chars = 0;
  for (const s of specs) {
    const c: any = s.config;
    chars += s.name.length + c.title.length + c.description.length;
    chars += JSON.stringify(z.toJSONSchema(c.inputSchema, { io: "input" })).length;
    chars += JSON.stringify(z.toJSONSchema(c.outputSchema, { io: "output", unrepresentable: "any" })).length;
  }
  const tokens = Math.round(chars / 4);
  assert.ok(tokens < BUDGET_TOKENS, `tool list is about ${tokens} tokens (budget ${BUDGET_TOKENS}): shorten descriptions, do not repeat text per country (npx tsx scripts/measure-tools.ts)`);
});

test("no tool shows the same long place text twice in its description", () => {
  for (const s of buildToolSpecs()) {
    const d: string = (s.config as any).description;
    const parts = d.split(/, | and /).filter((x) => x.length > 40);
    const seen = new Set<string>();
    for (const p of parts) {
      assert.ok(!seen.has(p), `${s.name} description repeats "${p.slice(0, 60)}"`);
      seen.add(p);
    }
  }
});

test("the advertised output sketch accepts a real answer and an insufficient-data answer", () => {
  const ok = { status: "ok", summary: "x", price: { currency: "EUR", unit: "per litre", value: 1.7, typical_low: 1.6, typical_high: 1.8 }, sample_size: 12, source: { id: "a", name: "A", licence: "L", attribution: "x" }, extra: { anything: 1 } };
  assert.ok(slimAnswerSchema.safeParse(ok).success);
  assert.ok(slimAnswerSchema.safeParse({ status: "insufficient_data", summary: "x", price: null }).success);
});

test("the check tool still passes a category's own parameters through", () => {
  const check = buildToolSpecs().find((s) => s.name === "pricepaid_check_price")!;
  const parsed = (check.config.inputSchema as z.ZodType).safeParse({ category: "rent", country: "IE", town: "Dublin", price: 2400 });
  assert.ok(parsed.success);
  assert.equal((parsed.data as any).town, "Dublin");
});

test("clip cuts at a word and never exceeds the limit", () => {
  const out = clip("alpha beta gamma delta epsilon zeta eta theta", 20);
  assert.ok(out.length <= 20 && out.endsWith("…"));
});
