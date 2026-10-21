// Ready answer pages built from the registry (lib/site/example-pages.ts, page-wording.ts, offline.ts) and the tool text built
// from the registry (categories/*/index.ts). Nothing here depends on the network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAnswer, buildStatisticAnswer, type PriceAnswer } from "../lib/answer";
import { buildLlmsFullTxt, buildSitemap, libraryForSitemap } from "../lib/open-book";
import { MAX_PAGES_PER_SOURCE, type CategoryPlugin, type SourceInfo, type SourcePlugin, type ToolPlace } from "../lib/plugin";
import { CATEGORIES, SOURCE_PLUGINS, categoryById, findSource, toolDescription, toolPlaces } from "../lib/registry";
import { summarise } from "../lib/stats";
import { PAGE_SOURCES } from "../lib/site/answer-pages";
import { SITE_URL } from "../lib/site/constants";
import {
  buildExamplePage,
  examplePlans,
  figureFromAnswer,
  figureFromLibrary,
  loadExamplePages,
  planExamplePages,
  type ExamplePage,
} from "../lib/site/example-pages";
import { examplePageGraph, serializeJsonLd } from "../lib/site/jsonld";
import { OfflineError, isOfflineError, runOffline } from "../lib/site/offline";
import { inCountry, nameFromNotes, placeOf, slugOf, wordingFor } from "../lib/site/page-wording";
import { countryGroups, pageRefs, pricesPathsFor } from "../lib/site/prices";
import { slugify } from "../lib/site/areas";

const BASE = "https://example.test";

const INFO: SourceInfo = {
  id: "xx-test",
  country: "IE",
  category: "rents",
  name: "Test register",
  publisher: "Test Office",
  what_is_recorded: "Rents.",
  price_type: "transaction",
  freshness: "Daily",
  licence: "Open licence",
  licence_url: "https://example.test/licence",
  attribution: "Source: Test Office.",
  homepage: "https://example.test",
  limits: "None.",
};

function fakeSource(over: Partial<SourcePlugin> & { id?: string } = {}): SourcePlugin {
  const { id, ...rest } = over;
  return {
    info: { ...INFO, id: id ?? INFO.id },
    category: "rent",
    countries: ["IE"],
    countryHelp: "IE = Ireland",
    placeName: "Ireland",
    status: "live",
    examples: [{ params: { country: "IE", town: "Dublin" } }],
    handle: async () => {
      throw new Error("offline");
    },
    ...rest,
  };
}

const rent = categoryById("rent")!;
const routedTo = (list: SourcePlugin[]) => (cat: CategoryPlugin, country: string) => list.find((s) => s.category === cat.id && s.countries.includes(country));

// ====================================================================================================================
// Which pages exist
// ====================================================================================================================

test("plan: a source with no `pages` gets one page per example; a `pages` list replaces the examples", () => {
  const a = fakeSource({ id: "a", examples: [{ params: { country: "IE", town: "Dublin" } }, { params: { country: "IE", town: "Cork" } }] });
  const plans = planExamplePages([a], new Set(), categoryById, routedTo([a]));
  assert.deepEqual(plans.map((p) => p.path), ["/prices/ie/rent/rent-for-homes-in-dublin", "/prices/ie/rent/rent-for-homes-in-cork"]);
  assert.ok(plans.every((p) => !p.explicit));

  const b = fakeSource({ id: "b", pages: [{ params: { country: "IE", town: "Galway" }, label: "Galway rents" }, { params: { country: "IE", town: "Limerick" } }] });
  const listed = planExamplePages([b], new Set(), categoryById, routedTo([b]));
  assert.deepEqual(listed.map((p) => p.path), ["/prices/ie/rent/galway-rents", "/prices/ie/rent/rent-for-homes-in-limerick"]);
  assert.ok(listed.every((p) => p.explicit));
});

test("plan: at most MAX_PAGES_PER_SOURCE pages per source, unique slugs per country and category", () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ params: { country: "IE", town: `Town${i}` } }));
  const a = fakeSource({ id: "a", examples: many });
  assert.equal(planExamplePages([a], new Set(), categoryById, routedTo([a])).length, MAX_PAGES_PER_SOURCE);
});

test("plan: slugs stay unique when two pages share a label, and every path is a clean URL", () => {
  const a = fakeSource({ id: "a", pages: [{ params: { country: "IE", town: "Dublin" }, label: "Dublin" }, { params: { country: "IE", town: "Dublin 2" }, label: "Dublin" }] });
  const plans = planExamplePages([a], new Set(), categoryById, routedTo([a]));
  assert.deepEqual(plans.map((p) => p.slug), ["dublin", "dublin-2"]);
});

test("plan: skips sources that already have a page per place, countries a source does not serve, and countries another source answers for", () => {
  const a = fakeSource({ id: "a" });
  assert.equal(planExamplePages([a], new Set(["a"]), categoryById, routedTo([a])).length, 0);

  const wrongCountry = fakeSource({ id: "b", examples: [{ params: { country: "FR", town: "Paris" } }] });
  assert.equal(planExamplePages([wrongCountry], new Set(), categoryById, routedTo([wrongCountry])).length, 0);

  const first = fakeSource({ id: "first" });
  const second = fakeSource({ id: "second" });
  // Another source answers for IE: a page for `second` would show the answer of `first`.
  const plans = planExamplePages([first, second], new Set(), categoryById, routedTo([first, second]));
  assert.deepEqual(plans.map((p) => p.sourceId), ["first"]);

  const unknownCategory = fakeSource({ id: "c", category: "no-such-category" });
  assert.equal(planExamplePages([unknownCategory], new Set(), categoryById, routedTo([unknownCategory])).length, 0);
});

test("the real registry: every source gets ready answer pages with nothing edited in lib/site", () => {
  const refs = pageRefs();
  const paths = refs.map((r) => r.path);
  assert.equal(new Set(paths).size, paths.length, "paths are unique");
  for (const r of refs) assert.match(r.path, /^\/prices\/[a-z]{2}\/[a-z0-9-]+\/[a-z0-9-]+$/, r.path);

  const bulk = new Set(PAGE_SOURCES.map((p) => p.sourceId));
  for (const src of SOURCE_PLUGINS) {
    if (bulk.has(src.info.id)) continue;
    const cat = categoryById(src.category)!;
    const countries = [...new Set(src.examples.map((e) => String(e.params.country).toUpperCase()))].filter((c) => src.countries.includes(c));
    const answeredElsewhere = countries.every((c) => findSource(cat.id, c) !== src);
    const own = examplePlans().filter((p) => p.sourceId === src.info.id);
    if (!answeredElsewhere) assert.ok(own.length > 0, `${src.info.id} has no page`);
    assert.ok(own.length <= MAX_PAGES_PER_SOURCE, `${src.info.id} has ${own.length} pages`);
    for (const p of own) assert.equal(findSource(p.category, p.country), src, `${p.path} is answered by another source`);
    if (own.length) assert.ok(pricesPathsFor(src.info.id).length > 0, `${src.info.id} is not linked from its /prices page`);
  }
  // Every country and category with a page has an index page that lists it.
  for (const g of countryGroups()) {
    assert.match(g.path, /^\/prices\/[a-z]{2}$/);
    assert.ok(g.categories.length > 0);
    for (const c of g.categories) assert.ok(c.refs.length > 0, c.path);
  }
});

// ====================================================================================================================
// The words of a page
// ====================================================================================================================

test("wording: question and label come from the category and the request", () => {
  const w = wordingFor({ categoryId: "rent", categoryNoun: "Rents paid", countryName: "Ireland", params: { country: "IE", town: "Dublin", bedrooms: "2", property_type: "apartment" } });
  assert.equal(w.label, "Rent for 2-bedroom flats in Dublin");
  assert.equal(w.question, "What is the typical rent for 2-bedroom flats in Dublin?");

  const fuel = wordingFor({ categoryId: "fuel", categoryNoun: "Fuel prices", countryName: "Netherlands", params: { country: "NL", fuel: "diesel" } });
  assert.equal(fuel.label, "Diesel in the Netherlands");
  assert.match(fuel.question, /^What does diesel cost in the Netherlands today\?$/);

  const home = wordingFor({ categoryId: "home-sales", categoryNoun: "Home sale prices", countryName: "United States", params: { country: "US", town: "Hartford" } });
  assert.equal(home.label, "Homes in Hartford");
});

test("wording: an unused parameter and a time window still end up in the label and the question", () => {
  const w = wordingFor({ categoryId: "home-sales", categoryNoun: "Home sale prices", countryName: "Singapore", params: { country: "SG", town: "Tampines", flat_type: "4 ROOM", months: "24" } });
  assert.match(w.label, /Tampines/);
  assert.match(w.label, /flat type 4 room/);
  assert.match(w.label, /last 24 months/);
  assert.match(w.question, /\(flat type 4 room\)/);
  assert.match(w.question, /over the last 24 months\?$/);
});

test("wording: a code is shown by its name when the source's own note gives it", () => {
  const notes = { area: "AT: Bundesland code 1-9 ('9' = Wien) or a place name" };
  assert.equal(nameFromNotes(notes, "area", "9"), "Wien");
  assert.equal(nameFromNotes(notes, "area", "6"), null);
  assert.equal(placeOf({ area: "9" }, notes), "Wien");
  assert.equal(placeOf({ area: "6" }, notes), "area 6");
  assert.equal(placeOf({ postcode: "1020" }), "postcode 1020");
  assert.equal(placeOf({ country: "AT" }), null);
});

test("wording: the source's own label and question win; a category nobody wrote a wording for still gets a readable page", () => {
  const w = wordingFor({ categoryId: "rent", categoryNoun: "Rents paid", countryName: "Ireland", params: { country: "IE", town: "Dublin" }, label: "Dublin rents", question: "What is rent in Dublin" });
  assert.deepEqual(w, { label: "Dublin rents", question: "What is rent in Dublin?" });

  const g = wordingFor({ categoryId: "wine", categoryNoun: "Wine prices", countryName: "France", params: { country: "FR", grape: "Merlot" } });
  assert.equal(g.label, "Merlot");
  assert.match(g.question, /^What do the official wine prices say for Merlot in France\?$/);
});

test("wording: country names read as people say them, and slugs are plain ASCII", () => {
  assert.equal(inCountry("Ireland"), "in Ireland");
  assert.equal(inCountry("Netherlands"), "in the Netherlands");
  assert.equal(inCountry("United States"), "in the United States");
  assert.equal(slugify("København"), "kobenhavn");
  assert.equal(slugify("Straße"), "strasse");
  assert.equal(slugOf("Rent for 2-bedroom flats in Dublin"), "rent-for-2-bedroom-flats-in-dublin");
  assert.equal(slugOf("???"), "overview");
  assert.ok(slugOf("x".repeat(300)).length <= 80);
});

// ====================================================================================================================
// What a page says: only a figure the rules allow
// ====================================================================================================================

const STAT_INFO: SourceInfo = { ...INFO, id: "xx-stat", price_type: "official_statistic" };

function rangeAnswer(count: number): PriceAnswer {
  const values = Array.from({ length: count }, (_, i) => 1000 + i * 100);
  return buildAnswer({
    source: INFO,
    query: { country: "IE" },
    summary: summarise(values),
    currency: "EUR",
    unit: "per month",
    period: { from: "2026-01-01", to: "2026-09-30" },
    method: "m",
    describe: (s) => `The median rent is ${s.median}.`,
  });
}

test("figure: a range built from 5 or more records is shown with its range, count and confidence", () => {
  const f = figureFromAnswer(rangeAnswer(8), INFO, null, "2026-10-14");
  assert.ok(f);
  assert.equal(f.via, "answer");
  assert.equal(f.statistic, false);
  assert.equal(f.n, 8);
  assert.ok(f.rangeText?.includes(" to "));
  assert.equal(f.confidence, "low");
  assert.equal(f.periodText, "2026-01-01 to 2026-09-30");
  assert.equal(f.asOf, "2026-09-30");
  assert.equal(f.referencePeriod, null);
});

test("figure: no figure from fewer than 5 records, however the answer arrives", () => {
  assert.equal(figureFromAnswer(rangeAnswer(4), INFO, null, "2026-10-14"), null);
  assert.equal(figureFromAnswer(rangeAnswer(0), INFO, null, "2026-10-14"), null);
  // An answer that says "ok" but states 3 records is refused too.
  const forged: PriceAnswer = { ...rangeAnswer(8), sample_size: 3 };
  assert.equal(figureFromAnswer(forged, INFO, null, "2026-10-14"), null);
  // A figure built from records must say how many: a missing count is not 5 or more.
  const unstated: PriceAnswer = { ...rangeAnswer(8), sample_size: null };
  assert.equal(figureFromAnswer(unstated, INFO, null, "2026-10-14"), null);
});

test("figure: an official statistic is shown as such, with its reference period, no range of ours and no invented count", () => {
  const a = buildStatisticAnswer({
    source: STAT_INFO,
    query: { country: "IE" },
    value: 1373,
    measure: "median",
    currency: "GBP",
    unit: "per month",
    period: { from: null, to: "2026-08-31" },
    reference_period: "2026-08",
    method: "m",
    describe: (v) => `The typical rent is ${v}.`,
    note: "Provisional figure.",
  });
  const f = figureFromAnswer(a, STAT_INFO, null, "2026-10-14");
  assert.ok(f);
  assert.equal(f.statistic, true);
  assert.equal(f.referencePeriod, "2026-08");
  assert.equal(f.rangeText, null);
  assert.equal(f.n, null);
  assert.equal(f.confidence, null);
  assert.equal(f.caveat, "Provisional figure.");
  assert.equal(f.asOf, "2026-08-31");
  // A publisher's own count under 5 is still no figure.
  assert.equal(figureFromAnswer({ ...a, sample_size: 4 }, STAT_INFO, null, "2026-10-14"), null);
  assert.ok(figureFromAnswer({ ...a, sample_size: 40 }, STAT_INFO, null, "2026-10-14"));
  // No match: no figure.
  const none = buildStatisticAnswer({ ...{ source: STAT_INFO, query: {}, measure: "median" as const, currency: "GBP", unit: "u", period: { from: null, to: null }, reference_period: "2026-08", method: "m" }, value: null, describe: () => "" });
  assert.equal(figureFromAnswer(none, STAT_INFO, null, "2026-10-14"), null);
});

const LIB_META = { source: "xx-test", currency: "EUR", unit: "per litre", first_date: "2026-10-01", last_date: "2026-10-14", days: 14, last_harvest_at: null, last_rows: 1, last_ok_at: null, last_error: null, note: "Posted prices." };
const row = (over: Partial<{ area: string; item: string; n: number; median: number; low: number; high: number }> = {}) => ({
  date: "2026-10-14", area: "28", item: "diesel", n: 40, median: 1.5, low: 1.4, high: 1.6, min: 1.3, max: 1.8, ...over,
});
const libSource = (over: Partial<SourcePlugin> = {}) =>
  fakeSource({ category: "fuel", harvest: async () => ({ date: "2026-10-14", currency: "EUR", unit: "per litre", rows: [] }), historyKey: () => ({ area: "28", item: "diesel", label: "Madrid" }), ...over });
const fuel = categoryById("fuel")!;

test("library figure: a row of 5 or more records becomes a figure with its currency, unit and count", () => {
  const f = figureFromLibrary({ src: libSource(), cat: fuel, prepared: { fuel: "diesel", area: "28" }, day: { date: "2026-10-14", rows: [row()] }, meta: LIB_META });
  assert.ok(f);
  assert.equal(f.via, "library");
  assert.equal(f.n, 40);
  assert.equal(f.statistic, false);
  assert.match(f.answer, /median/);
  assert.match(f.answer, /40/);
  assert.equal(f.caveat, "Posted prices.");
  assert.equal(f.asOf, "2026-10-14");
});

test("library figure: fewer than 5 records, a missing currency or unit, a statistic source or a national row for a local request give none", () => {
  const day = (r = row()) => ({ date: "2026-10-14", rows: [r] });
  const ask = (over: Parameters<typeof figureFromLibrary>[0]) => figureFromLibrary(over);
  assert.equal(ask({ src: libSource(), cat: fuel, prepared: {}, day: day(row({ n: 4 })), meta: LIB_META }), null);
  assert.equal(ask({ src: libSource(), cat: fuel, prepared: {}, day: day(row({ n: 0 })), meta: LIB_META }), null);
  assert.equal(ask({ src: libSource(), cat: fuel, prepared: {}, day: day(), meta: { ...LIB_META, currency: null } }), null);
  assert.equal(ask({ src: libSource(), cat: fuel, prepared: {}, day: day(), meta: null }), null);
  assert.equal(ask({ src: libSource(), cat: fuel, prepared: {}, day: null, meta: LIB_META }), null);
  assert.equal(ask({ src: libSource(), cat: fuel, prepared: {}, day: day(row({ item: "petrol95" })), meta: LIB_META }), null, "another item");
  // A published statistic keeps a placeholder count in the library: that is not a number of records.
  const stat = libSource({ info: STAT_INFO });
  assert.equal(ask({ src: stat, cat: fuel, prepared: {}, day: day(), meta: LIB_META }), null);
  // The country row cannot answer for a town.
  const national = libSource({ historyKey: () => ({ area: "ALL", item: "diesel", label: "Spain" }) });
  assert.equal(ask({ src: national, cat: fuel, prepared: { town: "Madrid" }, day: day(row({ area: "ALL" })), meta: LIB_META }), null);
  assert.ok(ask({ src: national, cat: fuel, prepared: {}, day: day(row({ area: "ALL" })), meta: LIB_META }));
  // A source that only answers live has no library row to show.
  const live = fakeSource({ category: "fuel" });
  assert.equal(ask({ src: live, cat: fuel, prepared: {}, day: day(), meta: LIB_META }), null);
});

// ====================================================================================================================
// Building a page
// ====================================================================================================================

test("page: a live-only source (the network is off) gets the ask-live form: question, tool and REST link, no number", async () => {
  const plan = examplePlans().find((p) => !SOURCE_PLUGINS.find((s) => s.info.id === p.sourceId)?.harvest)!;
  const page = await buildExamplePage(plan, async () => {
    throw new OfflineError("https://example.test");
  });
  assert.equal(page.figure, null);
  assert.match(page.title, /, ask live$/);
  assert.match(page.h1, /\?$/);
  assert.match(page.ask, new RegExp(plan.tool));
  assert.match(page.liveRestPath, /^\/api\/v1\/[a-z-]+\?/);
  assert.doesNotMatch(page.description, /[€£$¥]\s?\d|\d\s?(EUR|GBP|USD)/);
  assert.equal(page.asOf, null);
  assert.ok(page.source.licence_url.startsWith("https://"));
});

test("page: a figure from the source's own answer is used, a thin answer is not", async () => {
  const plan = examplePlans()[0];
  const good = await buildExamplePage(plan, async (src) => ({ ...rangeAnswer(12), source: { ...rangeAnswer(12).source, id: src.info.id } }));
  assert.ok(good.figure);
  assert.equal(good.figure.n, 12);
  assert.ok(good.title.includes(good.figure.headline));
  assert.ok(good.description.includes("Source:"));
  assert.ok(good.description.length <= 300);
  const thin = await buildExamplePage(plan, async () => rangeAnswer(3));
  assert.equal(thin.figure?.via === "answer", false, "3 records give no figure from the answer");
  assert.ok(!thin.title.includes("€1"));
});

test("pages: every real page obeys the data rules", async () => {
  const pages = await loadExamplePages();
  assert.equal(pages.length, examplePlans().length);
  let figures = 0;
  for (const p of pages) {
    assert.match(p.h1, /\?$/, p.path);
    assert.ok(p.title.length > 10 && p.title.length < 140, `${p.path} title length: ${p.title}`);
    assert.ok(p.description.length > 40 && p.description.length < 340, `${p.path} description length`);
    assert.ok(p.source.licence_url.startsWith("https://"), `${p.path} cites a licence`);
    assert.ok(p.source.attribution.length > 10, `${p.path} cites its source`);
    assert.ok(p.liveRestPath.startsWith(`/api/v1/`), p.path);
    const f = p.figure;
    if (!f) {
      assert.match(p.title, /, ask live$/, p.path);
      assert.equal(p.asOf, null);
      continue;
    }
    figures++;
    assert.ok(f.value > 0 && f.currency && f.unit, `${p.path} states a value with currency and unit`);
    assert.ok(f.asOf && /^\d{4}-\d{2}-\d{2}$/.test(f.asOf), `${p.path} has a date`);
    if (f.statistic) {
      assert.ok(f.referencePeriod, `${p.path} is an official statistic and states its reference period`);
      assert.equal(f.rangeText, null, `${p.path} shows no range of ours for a statistic`);
      assert.ok(f.n === null || f.n >= 5);
    } else {
      assert.ok(f.n !== null && f.n >= 5, `${p.path} rests on ${f.n} records`);
      assert.ok(f.rangeText, `${p.path} shows its range`);
      assert.ok(f.confidence, `${p.path} shows its confidence`);
    }
  }
  assert.ok(figures > 0, "some pages carry a real figure from the library");
});

// ====================================================================================================================
// JSON-LD
// ====================================================================================================================

function pageOf(figure: ExamplePage["figure"], over: Partial<ExamplePage> = {}): ExamplePage {
  const plan = examplePlans()[0];
  return {
    mode: "example",
    path: plan.path,
    slug: plan.slug,
    sourceId: plan.sourceId,
    country: plan.country,
    countrySlug: plan.countrySlug,
    countryName: plan.countryName,
    category: plan.category,
    categoryLabel: plan.categoryLabel,
    label: plan.label,
    h1: plan.question,
    title: "t",
    description: "d",
    figure,
    asOf: figure?.asOf ?? null,
    params: plan.params,
    liveRestPath: "/api/v1/x?country=IE",
    mcpTool: plan.tool,
    mcpArgs: {},
    ask: "a",
    basis: "b",
    source: { name: "S", publisher: "Pub", licence: "Open Government Licence", licence_url: "https://example.test/l", attribution: "Source: Pub", homepage: "https://example.test", priceType: "transaction", priceTypeLabel: "Transaction", freshness: "Daily", whatIsRecorded: "x" } as unknown as ExamplePage["source"],
    ...over,
  };
}

test("JSON-LD: a page with a figure has WebPage, BreadcrumbList and FAQPage; an ask-live page has no FAQ because there is no answer", () => {
  const f = figureFromAnswer(rangeAnswer(8), INFO, null, "2026-10-14")!;
  const crumbs = [{ name: "Prices", path: "/prices" }, { name: "Ireland", path: "/prices/ie" }];
  const withFigure = examplePageGraph(pageOf(f), crumbs);
  const types = (g: any) => g["@graph"].flatMap((n: any) => [n["@type"], n.breadcrumb?.["@type"]]).filter(Boolean);
  assert.deepEqual(types(withFigure), ["WebPage", "BreadcrumbList", "Dataset", "FAQPage"]);
  const faq = withFigure["@graph"].find((n: any) => n["@type"] === "FAQPage") as any;
  assert.equal(faq.mainEntity.length, 1);
  assert.match(faq.mainEntity[0].acceptedAnswer.text, /Source: Pub\. Licence: Open Government Licence\./);
  assert.equal((withFigure["@graph"][0] as any).dateModified, "2026-09-30");

  const ds = withFigure["@graph"].find((n: any) => n["@type"] === "Dataset") as any;
  assert.equal(ds.license, "https://example.test/l");
  assert.equal(ds.creator.name, "Pub");
  assert.equal(ds.isAccessibleForFree, true);
  assert.equal(ds.dateModified, "2026-09-30");
  assert.match(ds.spatialCoverage.address.addressCountry, /^[A-Z]{2}$/);
  assert.ok(ds.temporalCoverage);
  assert.ok(ds.distribution[0].contentUrl.startsWith("https://proofprice.com/api/v1/"));
  assert.deepEqual((withFigure["@graph"][0] as any).mainEntity, { "@id": ds["@id"] });

  const askLive = examplePageGraph(pageOf(null), crumbs);
  assert.deepEqual(types(askLive), ["WebPage", "BreadcrumbList"]); // no data stated, so no Dataset
  assert.equal((askLive["@graph"][0] as any).dateModified, undefined);

  for (const g of [withFigure, askLive]) {
    const text = serializeJsonLd(g);
    assert.ok(!text.includes("<"));
    assert.equal(JSON.parse(text)["@context"], "https://schema.org");
  }
});

// ====================================================================================================================
// The network is off while pages are prepared
// ====================================================================================================================

test("offline: code started inside runOffline cannot fetch; code outside it can, even at the same time", async () => {
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response("ok");
  }) as typeof fetch;
  try {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const inside = runOffline(async () => {
      await gate;
      return fetch("https://example.test/a");
    });
    // While the offline scope is waiting, other code (a live request on the same server) still reaches the network.
    const outside = await fetch("https://example.test/b");
    assert.equal(await outside.text(), "ok");
    release();
    await assert.rejects(inside, (e) => isOfflineError(e) && e instanceof OfflineError);
    assert.equal(calls, 1, "only the request outside the scope went out");
    // A scope that does not fetch just returns.
    assert.equal(await runOffline(async () => 42), 42);
    // After the scope the network is back.
    assert.equal(await (await fetch("https://example.test/c")).text(), "ok");
    assert.equal(calls, 2);
    assert.equal(isOfflineError(new Error("x")), false);
  } finally {
    globalThis.fetch = real;
  }
});

// ====================================================================================================================
// Sitemap and llms-full.txt
// ====================================================================================================================

test("sitemap: every ready answer page and every index page is listed once, with dates that are never in the future", () => {
  const now = new Date("2026-10-14T12:00:00Z");
  const entries = buildSitemap(SITE_URL, now, libraryForSitemap());
  const urls = entries.map((e) => e.url);
  assert.equal(new Set(urls).size, urls.length);
  for (const r of pageRefs()) assert.ok(urls.includes(`${SITE_URL}${r.path}`), r.path);
  for (const g of countryGroups()) {
    assert.ok(urls.includes(`${SITE_URL}${g.path}`), g.path);
    for (const c of g.categories) assert.ok(urls.includes(`${SITE_URL}${c.path}`), c.path);
  }
  for (const e of entries) {
    const when = e.lastModified instanceof Date ? e.lastModified.toISOString() : String(e.lastModified);
    assert.ok(when.slice(0, 10) <= "2026-10-14", `${e.url} is dated ${when}`);
  }
  // Pages for every place rank above pages a manifest lists as examples.
  const bulk = entries.find((e) => e.url.endsWith("/prices/es/fuel/madrid"))!;
  const example = entries.find((e) => e.url === `${SITE_URL}${examplePlans()[0].path}`)!;
  assert.ok(bulk.priority > example.priority);
});

test("sitemap: a future data day is not used as a last-modified date", () => {
  const entries = buildSitemap(SITE_URL, new Date("2026-10-14T00:00:00Z"), {
    answerPages: [{ path: "/prices/au/fuel/x", category: "fuel", asOf: "2026-10-15" }],
    indexPaths: ["/prices/au"],
    newestDay: "2026-10-15",
  });
  const last = (p: string) => {
    const when = entries.find((e) => e.url.endsWith(p))!.lastModified;
    return when instanceof Date ? when.toISOString() : String(when);
  };
  assert.ok(last("/prices/au/fuel/x").startsWith("2026-10-14"), last("/prices/au/fuel/x"));
  assert.ok(last("/prices/au").startsWith("2026-10-14"));
});

test("llms-full.txt lists the /prices pages of every country and category, from the registry", () => {
  const text = buildLlmsFullTxt(BASE);
  for (const g of countryGroups()) for (const c of g.categories) assert.ok(text.includes(`${BASE}${c.path}`), c.path);
});

// ====================================================================================================================
// Tool text comes from the registry
// ====================================================================================================================

const COUNTRY_WORDS = [
  "Ireland", "Spain", "France", "Italy", "Germany", "Austria", "Belgium", "Netherlands", "Denmark", "Norway", "Sweden", "Finland", "Portugal",
  "Poland", "Singapore", "Australia", "Canada", "Brazil", "Mexico", "United States", "United Kingdom", "England", "Wales", "Scotland",
  "Medicare", "Eurostat", "Alaska", "Hawaii", "NUTS",
];
const mention = (text: string, word: string) => new RegExp(`(^|[^A-Za-z])${word}([^A-Za-z]|$)`).test(text);

const fakePlace: ToolPlace = {
  place: "Atlantis",
  code: "AT",
  freshness: "Daily",
  priceType: "transaction",
  priceTypeLabel: "Transaction",
  sourceName: "Atlantis register",
  publisher: "Atlantis Office",
  whatIsRecorded: "Sales.",
};

test("every category describes only the places the registry gives it: no country named by hand", () => {
  for (const cat of CATEGORIES) {
    const text = cat.description([fakePlace]);
    assert.match(text, /Atlantis/, `${cat.id} does not use its places`);
    for (const w of COUNTRY_WORDS) assert.ok(!mention(text, w), `${cat.id} names "${w}" by hand`);
    // Parameter texts are generic too: a country-specific hint belongs in the source's paramNotes.
    for (const [name, schema] of Object.entries(cat.params)) {
      const own = [(schema as any).description, (schema as any)._def?.innerType?.description, (schema as any)._def?.description].filter(Boolean).join(" ");
      for (const w of COUNTRY_WORDS) assert.ok(!mention(own, w), `${cat.id}.${name} names "${w}" by hand`);
    }
  }
});

test("every category description copes with one place, many places and none", () => {
  for (const cat of CATEGORIES) {
    for (const places of [[], [fakePlace], [fakePlace, { ...fakePlace, place: "Lemuria", code: "LE" }]]) {
      const text = cat.description(places);
      assert.ok(text.length > 100, cat.id);
      assert.ok(!/undefined|\[object/.test(text), `${cat.id}: ${text}`);
    }
    const two = cat.description([fakePlace, { ...fakePlace, place: "Lemuria", code: "LE" }]);
    assert.match(two, /Atlantis/);
    assert.match(two, /Lemuria/);
  }
});

test("the real tool descriptions mention a country only when a source behind the tool covers it", () => {
  for (const cat of CATEGORIES) {
    const description = toolDescription(cat);
    const known = toolPlaces(cat).map((p) => `${p.place} ${p.sourceName} ${p.publisher} ${p.whatIsRecorded}`).join(" ");
    for (const w of COUNTRY_WORDS) {
      if (mention(description, w)) assert.ok(mention(known, w), `${cat.id} describes "${w}" but no source behind it does`);
    }
    for (const p of toolPlaces(cat)) assert.ok(description.includes(p.place), `${cat.id} leaves out ${p.place}`);
  }
});
