import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pressFacts, PRESS_LOGOS } from "../lib/site/press";
import { coverage } from "../lib/registry";
import { PUBLIC_PATHS, buildLlmsFullTxt } from "../lib/open-book";
import { buildLlmsTxt } from "../lib/openapi";

test("press facts are read from the live registry", () => {
  const f = pressFacts();
  assert.equal(f.sources, coverage().sources.length);
  assert.ok(f.countries >= 1 && f.categories.length >= 1);
  assert.equal(f.mcpUrl, "https://proofprice.com/api/mcp");
});

test("every logo file exists in public/", () => {
  for (const l of PRESS_LOGOS) assert.ok(existsSync(join(process.cwd(), "public", l.path)), l.path);
});

test("/press is in the sitemap, llms.txt and llms-full.txt", () => {
  assert.ok(PUBLIC_PATHS.includes("/press"));
  assert.match(buildLlmsTxt("https://proofprice.com"), /https:\/\/proofprice\.com\/press/);
  assert.match(buildLlmsFullTxt("https://proofprice.com"), /https:\/\/proofprice\.com\/press/);
});
