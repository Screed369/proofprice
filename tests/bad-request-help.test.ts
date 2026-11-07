// Gap G20261101-BADREQ: every 400 about a call lists the required parameters and up to 3 working example calls.
import { test } from "node:test";
import assert from "node:assert/strict";
import { GET } from "../app/api/v1/[category]/route";

const rest = async (cat: string, qs: string) =>
  GET(new Request(`https://example.test/api/v1/${cat}?${qs}&ppcheck=1`), { params: Promise.resolve({ category: cat }) });

test("400s name the required parameters and give working examples", async () => {
  for (const [cat, qs] of [["groceries", "country=MY"], ["contracts", "country=FR"], ["fuel", ""], ["home-sales", "country=ZZ"]] as const) {
    const r = await rest(cat, qs);
    assert.equal(r.status, 400, `${cat}?${qs}`);
    const body = await r.text();
    assert.match(body, /Required parameters: country/, cat);
    const examples = body.match(/\/api\/v1\/[a-z-]+\?[^ ;"\\]+/g) ?? [];
    assert.ok(examples.length >= 1, `${cat}: ${body}`);
    assert.equal((body.match(/Working examples:/g) ?? []).length, 1, "added once");
  }
});

test("the asked country's example comes first", async () => {
  const body = await (await rest("groceries", "country=GB")).text();
  const first = (body.match(/Working examples: ([^;"\\]+)/) ?? [])[1] ?? "";
  assert.match(first, /country=GB/);
});
