// The gate every new source must pass. If this file fails after you add a source, read the message:
// it says exactly which manifest field is wrong.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import {
  CATEGORIES, SOURCE_PLUGINS, categoryById, exampleUrls, fallbackProblems, paramSchemas, paramsFromQuery, runCategory, sourcesFor, toolDescription, toolShape,
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

// Public tool names are permanent (a tool or REST path that has been published can never be renamed or removed), so a new category
// (= a new public MCP tool + REST path) needs Simon's OK. The OK is a line in categories/APPROVED.json, added only after a
// "Simon is needed" decision says yes. Builders may build a new category on a branch; it cannot merge to main without the entry.
test("categories: every public tool name is on categories/APPROVED.json", () => {
  const list = JSON.parse(readFileSync("categories/APPROVED.json", "utf8")) as { approved: { id: string; tool: string; rest_path: string; comment: string }[] };
  assert.ok(Array.isArray(list.approved), "categories/APPROVED.json must have an 'approved' list");
  const approved = new Map(list.approved.map((a) => [a.id, a]));
  assert.equal(approved.size, list.approved.length, "categories/APPROVED.json lists a category id twice");
  for (const a of list.approved) {
    assert.ok(typeof a.comment === "string" && a.comment.trim().length >= 3, `categories/APPROVED.json: '${a.id}' needs a comment such as "approved by Simon <date>"`);
  }
  for (const c of CATEGORIES) {
    const a = approved.get(c.id);
    assert.ok(
      a,
      `New public tool name '${c.id}' needs Simon's approval: add it to categories/APPROVED.json only after a 'Simon is needed' decision says yes. ` +
        `(A category is a new public MCP tool '${c.tool}' and REST path '/api/v1/${c.restPath}', and public names are permanent. Prefer adding an option to an existing tool.)`
    );
    // an approved name never changes: renaming a published tool breaks every agent that uses it
    assert.equal(a.tool, c.tool, `categories/${c.id}: the public tool name was approved as '${a.tool}' and must never be renamed (now '${c.tool}')`);
    assert.equal(a.rest_path, c.restPath, `categories/${c.id}: the public REST path was approved as '${a.rest_path}' and must never be renamed (now '${c.restPath}')`);
  }
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

test("fallbackFor: every stand-in names registered sources of the same category and countries they cover", () => {
  assert.deepEqual(fallbackProblems(), []);
  // the checker itself catches each kind of mistake
  const it = SOURCE_PLUGINS.find((s) => s.info.id === "it-fuel")!;
  const wob = SOURCE_PLUGINS.find((s) => s.info.id === "eu-oil-bulletin")!;
  const fi = SOURCE_PLUGINS.find((s) => s.info.id === "fi-home-prices")!;
  const bad = (fallbackFor: any) => fallbackProblems([it, fi, { ...wob, fallbackFor }]).join(" | ");
  assert.match(bad({ sources: ["xx-nothing"], countries: ["IT"] }), /"xx-nothing", which is not a registered source/);
  assert.match(bad({ sources: ["fi-home-prices"], countries: ["FI"] }), /answers home-sales, not fuel/);
  assert.match(bad({ sources: ["it-fuel"], countries: ["FR"] }), /FR is not a country of any of it-fuel/);
  assert.match(bad({ sources: ["it-fuel"], countries: ["IE"] }), /IE is already one of this source's own countries/);
  assert.match(bad({ sources: ["it-fuel"], countries: ["italy"] }), /must be an ISO 3166 alpha-2 code/);
  assert.match(bad({ sources: [], countries: [] }), /sources is empty.*countries is empty/);
  assert.deepEqual(fallbackProblems([it, { ...wob, fallbackFor: { sources: ["it-fuel"], countries: ["IT"] } }]), []);
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

// The outside check (crossCheck, lib/crosscheck.ts): optional, internal, and checked here so a malformed one says what to fix.
test("crossCheck: every outside check names an official series, a tolerance, known differences and like-for-like places", async () => {
  const { crossCheckProblems } = await import("../lib/crosscheck");
  const known = (s: (typeof SOURCE_PLUGINS)[number]) => new Set(["country", ...Object.keys(paramSchemas(categoryById(s.category)!))]);
  assert.deepEqual(crossCheckProblems(SOURCE_PLUGINS, known), []);
  assert.ok(SOURCE_PLUGINS.filter((s) => s.crossCheck).length >= 1, "at least one source has a crossCheck");
  // the checker itself catches each kind of mistake
  const es = SOURCE_PLUGINS.find((s) => s.info.id === "es-fuel")!;
  const us = SOURCE_PLUGINS.find((s) => s.info.id === "us-eia-energy")!;
  const bad = (s: (typeof SOURCE_PLUGINS)[number], patch: Record<string, unknown>) => crossCheckProblems([{ ...s, crossCheck: { ...s.crossCheck!, ...patch } as any }], known).join(" | ");
  assert.match(bad(es, { headlineUrl: "http://energy.ec.europa.eu/x" }), /headlineUrl must be the publisher's official https link/);
  assert.match(bad(es, { releasePage: "https://proofprice.com/prices" }), /points at proofprice.com/);
  assert.match(bad(es, { series: "Oil Bulletin" }), /series must name the EXACT official series/);
  assert.match(bad(es, { statistic: "typical" }), /statistic must be one of/);
  assert.match(bad(es, { tolerancePct: 0 }), /tolerancePct must be a number above 0/);
  assert.match(bad(es, { expectedBiasPct: [1.7, 0.2] }), /expectedBiasPct must be a number or a \[low, high\] band/);
  assert.match(bad(es, { knownDifferences: [] }), /knownDifferences must list/);
  assert.match(bad(es, { areas: [] }), /areas must list 1 to 6/);
  assert.match(bad(es, { areas: [{ label: "Spain", theirs: "ES/diesel", ours: {} }] }), /ours must be \{ item/);
  assert.match(bad(es, { areas: [{ label: "A", theirs: "ES/diesel", ours: { item: "diesel" } }, { label: "B", theirs: "ES/diesel", ours: { item: "lpg" } }] }), /"ES\/diesel" is listed twice/);
  assert.match(bad(es, { compareVolumes: { tolerancePct: 0 } }), /compareVolumes.tolerancePct/);
  assert.match(bad(es, { fetch: undefined }), /fetch\(ctx\) is missing/);
  assert.match(bad(us, { ours: "library", areas: us.crossCheck!.areas }), /ours must be \{ item/);
  assert.match(bad({ ...us, harvest: undefined }, { ours: "library" }), /no harvest\(\)/);
  assert.match(bad(us, { areas: [{ label: "TX", theirs: "TX", ours: { country: "GB", energy: "electricity" } }] }), /ours.country must be one of this source's countries \(US\)/);
  assert.match(bad(us, { areas: [{ label: "TX", theirs: "TX", ours: { country: "US", colour: "TX" } }] }), /uses "colour", which is not a parameter/);
  assert.match(bad(us, { areas: [{ label: "TX", theirs: "TX", ours: { country: "US", sector: "business", energy: "electricity" } }] }), /answered by another source/);
});

test("rent SE: the existing source keeps answering ordinary requests and steps aside for new_build=true (shared-country routing)", async () => {
  const { findSource } = await import("../lib/registry");
  assert.equal(findSource("rent", "SE", { bedrooms: 2 })?.info.id, "se-scb-rents");
  assert.equal(findSource("rent", "SE")?.info.id, "se-scb-rents");
  const s = SOURCE_PLUGINS.find((x) => x.info.id === "se-scb-rents")!;
  assert.equal(s.serves!({ country: "SE", new_build: true }), false);
  assert.equal(s.serves!({ country: "SE", new_build: "true" }), false);
  assert.equal(s.serves!({ country: "SE", new_build: false }), true);
});
