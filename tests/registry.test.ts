// The gate every new source must pass. If this file fails after you add a source, read the message:
// it says exactly which manifest field is wrong.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, existsSync } from "node:fs";
import { z } from "zod";
import {
  CATEGORIES, SOURCE_PLUGINS, categoryById, exampleUrls, paramSchemas, paramsFromQuery, runCategory, sourcesFor, toolDescription, toolShape,
} from "../lib/registry";
import { SOURCE_FOLDERS, CATEGORY_FOLDERS } from "../lib/registry.generated";
import { normaliseCountry } from "../lib/countries";

const RESERVED_PATHS = ["coverage", "receipts", "library", "history", "mcp"];

test("every folder in sources/ and categories/ is registered", () => {
  const onDisk = (d: string) =>
    readdirSync(d, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("_") && !e.name.startsWith(".") && existsSync(`${d}/${e.name}/index.ts`))
      .map((e) => e.name)
      .sort();
  assert.deepEqual(SOURCE_FOLDERS, onDisk("sources"));
  assert.deepEqual(CATEGORY_FOLDERS, onDisk("categories"));
});

test("categories: ids match folders, tool names and REST paths are unique and well formed", () => {
  const tools = new Set<string>();
  const paths = new Set<string>();
  CATEGORIES.forEach((c, i) => {
    assert.equal(c.id, CATEGORY_FOLDERS[i], `categories/${CATEGORY_FOLDERS[i]}: id must equal the folder name`);
    assert.match(c.tool, /^pricepaid_[a-z0-9_]+$/, `${c.id}: tool name must look like pricepaid_xxx`);
    assert.ok(!tools.has(c.tool), `${c.id}: duplicate tool name ${c.tool}`);
    tools.add(c.tool);
    assert.match(c.restPath, /^[a-z0-9-]+$/);
    assert.ok(!RESERVED_PATHS.includes(c.restPath), `${c.id}: restPath ${c.restPath} is reserved`);
    assert.ok(!paths.has(c.restPath), `${c.id}: duplicate restPath`);
    paths.add(c.restPath);
    assert.ok(!("country" in c.params), `${c.id}: do not declare country; it is built from the sources`);
    assert.ok(sourcesFor(c.id).length > 0, `${c.id}: has no sources yet`);
  });
});

test("sources: manifests are complete and honest", () => {
  const seen = new Map<string, string>();
  const servesKey = new Set<string>();
  SOURCE_PLUGINS.forEach((s, i) => {
    const where = `sources/${SOURCE_FOLDERS[i]}`;
    const info = s.info as unknown as Record<string, unknown>;
    assert.equal(s.info.id, SOURCE_FOLDERS[i], `${where}: info.id must equal the folder name`);
    for (const k of ["country", "category", "name", "publisher", "what_is_recorded", "price_type", "freshness", "licence", "licence_url", "attribution", "homepage", "limits"]) {
      assert.ok(typeof info[k] === "string" && (info[k] as string).trim().length >= 2, `${where}: info.${k} is missing`);
    }
    assert.match(s.info.licence_url, /^https:\/\//, `${where}: licence_url must be an https link`);
    assert.match(s.info.homepage, /^https:\/\//, `${where}: homepage must be an https link`);
    assert.ok(categoryById(s.category), `${where}: category "${s.category}" has no folder in categories/`);
    assert.ok(s.countries.length > 0, `${where}: countries is empty`);
    for (const c of s.countries) {
      assert.match(c, /^[A-Z]{2}$/, `${where}: country "${c}" must be an ISO 3166 alpha-2 code (GB, not UK)`);
      const key = `${s.category}/${c}`;
      // Two sources may answer for the same country only if each says which requests it serves (SourcePlugin.serves).
      assert.ok(!seen.has(key) || (s.serves && servesKey.has(key)), `${where}: ${key} is already answered by ${seen.get(key)} (give both sources a serves() to share a country)`);
      seen.set(key, s.info.id);
      if (s.serves) servesKey.add(key);
      assert.match(s.countryHelp, new RegExp(`\\b${c}\\b`), `${where}: countryHelp should mention ${c}`);
    }
    assert.ok(s.placeName.trim(), `${where}: placeName is missing`);
    assert.ok(s.examples.length > 0, `${where}: add at least one working example`);
    const cat = categoryById(s.category)!;
    const known = new Set(["country", ...Object.keys(paramSchemas(cat))]);
    for (const ex of s.examples) {
      assert.ok(s.countries.includes(normaliseCountry(ex.params.country) ?? ""), `${where}: example country must be one of ${s.countries}`);
      for (const k of Object.keys(ex.params)) assert.ok(known.has(k), `${where}: example uses unknown parameter "${k}"`);
    }
    for (const k of Object.keys(s.paramNotes ?? {})) assert.ok(k in cat.params, `${where}: paramNotes.${k} is not a parameter of ${cat.id}`);
    for (const k of Object.keys(s.paramValues ?? {})) assert.ok(k in cat.params, `${where}: paramValues.${k} is not a parameter of ${cat.id}`);
    if (s.harvest && cat.history) assert.ok(s.historyKey, `${where}: has harvest() but no historyKey()`);
  });
});

test("every tool schema builds and describes every covered place", () => {
  for (const c of CATEGORIES) {
    const shape = toolShape(c);
    assert.ok(z.object(shape));
    const d = toolDescription(c);
    assert.match(d, /^Use this when/);
    assert.match(d, /Do not use/);
    for (const s of sourcesFor(c.id)) assert.ok(d.includes(s.placeName), `${c.tool} description should mention ${s.placeName}`);
    // Directory policy: descriptions say what this tool does and does not do, never instructions about other tools.
    for (const text of [d, c.history?.description ?? ""]) {
      assert.ok(!/\(use [^)]*\)|use pricepaid_|call pricepaid_/i.test(text), `${c.tool} description points to another tool: say only what this tool does not cover`);
    }
    // Directory reviewers and agents read these: no clause may repeat (use freshnessList from lib/text for "How fresh").
    const clauses = d.split(/; |\. /).map((x) => x.trim()).filter((x) => x.length > 20);
    const seen = new Map<string, number>();
    for (const x of clauses) {
      seen.set(x, (seen.get(x) ?? 0) + 1);
      assert.ok(seen.get(x)! < 3, `${c.tool} description repeats "${x.slice(0, 80)}": group places that share a freshness note`);
    }
  }
});

test("freshnessList: one entry per distinct note, labelled only when notes differ", async () => {
  const { freshnessList } = await import("../lib/text");
  assert.equal(freshnessList([{ place: "A", freshness: "Weekly" }, { place: "B", freshness: "Weekly" }]), "weekly");
  assert.equal(
    freshnessList([
      { place: "Spain", freshness: "Several times a day" },
      { place: "the EU", freshness: "Weekly" },
      { place: "the EU", freshness: "Weekly" },
      { place: "the UK", freshness: "Weekly" },
    ]),
    "Spain: several times a day; the EU and the UK: weekly",
  );
});

test("REST query parsing: numbers are coerced, aliases pass through", () => {
  const hs = categoryById("home-sales")!;
  const p = paramsFromQuery(hs, new URLSearchParams("country=uk&town=Bristol&months=6&department=x&empty="));
  assert.equal(p.months, 6);
  assert.equal(p.department, "x");
  assert.ok(!("empty" in p));
});

test("routing: unknown countries and fuels get a clear 400 message", async () => {
  const fuel = categoryById("fuel")!;
  // The list of covered countries grows with every fuel source: check that the known ones are present, not the exact list.
  await assert.rejects(runCategory(fuel, { country: "XX", fuel: "diesel" }), /Live fuel prices are available for .*\bES\b.*\bFR\b.*\bIT\b.* so far\. Not yet: XX/);
  await assert.rejects(runCategory(fuel, { country: "ES", fuel: "kerosene" }), /fuel must be one of/);
  await assert.rejects(runCategory(fuel, {}), /country is required/);
  const hs = categoryById("home-sales")!;
  await assert.rejects(runCategory(hs, { country: "england" }), /A town is required/); // "england" -> GB, then GB needs a town
});

test("smoke tests: one per source, all on known endpoints", () => {
  const smoke = exampleUrls().filter((e) => e.smoke);
  assert.equal(new Set(smoke.map((e) => e.source)).size, SOURCE_PLUGINS.length);
  for (const e of smoke) assert.match(e.path, /^\/api\/v1\/[a-z0-9-]+\?country=[A-Z]{2}/);
});

test("home-upgrades: sources that share a country are routed by the request (serves)", async () => {
  const { findSource } = await import("../lib/registry");
  assert.equal(findSource("home-upgrades", "GB", { measure: "solar_pv" })?.info.id, "gb-desnz-solar-cost");
  assert.equal(findSource("home-upgrades", "GB", { measure: "heat_pump" })?.info.id, "gb-bus-stats");
  assert.ok(findSource("home-upgrades", "GB", { measure: "windows" })); // none serves it: the first answers, honestly
  assert.equal(findSource("home-upgrades", "IE", { measure: "heat_pump" })?.info.id, "ie-revenue-hri");
});
