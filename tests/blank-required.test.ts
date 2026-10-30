// Gap G20261030-2: a required parameter sent empty is a 400 (bad_request in the usage log), never an ok/no_matches answer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { categoryByRestPath, pickSource } from "../lib/registry";
import { InputError } from "../lib/http";
import { GET } from "../app/api/v1/[category]/route";

const rest = async (cat: string, qs: string) =>
  GET(new Request(`https://example.test/api/v1/${cat}?${qs}&ppcheck=1`), { params: Promise.resolve({ category: cat }) });

test("REST: /api/v1/groceries?country=MY and an empty item are 400 with an example", async () => {
  for (const qs of ["country=MY", "country=MY&item=", "country=MY&item=%20%20"]) {
    const r = await rest("groceries", qs);
    assert.equal(r.status, 400, qs);
    assert.match(await r.text(), /item is required/);
  }
});

test("REST: /api/v1/contracts?country=ES is 400", async () => {
  assert.equal((await rest("contracts", "country=ES")).status, 400);
  assert.equal((await rest("contracts", "country=ES&what=")).status, 400);
});

test("pickSource: a blank required value sent through MCP (not the REST parser) is refused as InputError", () => {
  for (const [cat, key, country] of [["groceries", "item", "MY"], ["contracts", "what", "ES"], ["medicines", "medicine", "GB"]] as const) {
    const c = categoryByRestPath(cat)!;
    assert.throws(() => pickSource(c, { country, [key]: "   " }), InputError, cat);
  }
});
