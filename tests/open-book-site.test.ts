// Tests for the website side of discoverability: place names, answer pages, JSON-LD, status, examples, llms-full pages.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildLlmsFullTxt, buildSitemap, libraryForSitemap } from "../lib/open-book";
import { readLatestDay, rowsToCsv } from "../lib/library/store";
import { PAGE_SOURCES, buildSourcePages, noFullStop, shortLicence, shortPublisher, type DayRow } from "../lib/site/answer-pages";
import { areaFor, dublinDistrictName, knownAreaCodes, slugify } from "../lib/site/areas";
import { HOME_TITLE, SITE_URL } from "../lib/site/constants";
import { homeExamples } from "../lib/site/examples";
import { answerPageGraph, faqPageGraph, datasetLd, homeGraph, serializeJsonLd, sourcesGraph } from "../lib/site/jsonld";
import { int, longDate, monthsBefore } from "../lib/site/format";
import { allAnswerPages, loadAnswerPages } from "../lib/site/prices";
import { datasetInput, groupByCategory, sourceCards } from "../lib/site/sources";
import { libraryHealth } from "../lib/site/status";
import { CATEGORIES, SOURCE_PLUGINS, categoryById, exampleUrls } from "../lib/registry";

const row = (area: string, item: string, n: number, median: number, spread = 0.1): DayRow => ({
  area,
  item,
  n,
  median,
  low: Math.round((median - spread) * 1000) / 1000,
  high: Math.round((median + spread) * 1000) / 1000,
});

const info = SOURCE_PLUGINS.find((s) => s.info.id === "es-fuel")!.info;
const ieInfo = SOURCE_PLUGINS.find((s) => s.info.id === "ie-ppr")!.info;
const fuelCat = { tool: categoryById("fuel")!.tool, restPath: "fuel", hasHistory: true };
const homeCat = { tool: categoryById("home-sales")!.tool, restPath: "home-sales", hasHistory: false };
const esSpec = PAGE_SOURCES.find((p) => p.sourceId === "es-fuel")!;
const ieSpec = PAGE_SOURCES.find((p) => p.sourceId === "ie-ppr")!;

// ---------- place names ----------

test("area names are readable and URL-safe", () => {
  const madrid = areaFor("es-fuel", "28")!;
  assert.deepEqual([madrid.name, madrid.label, madrid.slug, madrid.kind], ["Madrid", "Madrid province", "madrid", "province"]);
  assert.equal(areaFor("es-fuel", "07")!.label, "Balearic Islands");
  assert.equal(areaFor("es-fuel", "15")!.slug, "a-coruna");
  assert.equal(areaFor("es-fuel", "41")!.name, "Seville");
  assert.equal(areaFor("fr-fuel", "69")!.label, "Rhône (department 69)");
  assert.equal(areaFor("fr-fuel", "69")!.slug, "rhone");
  assert.equal(areaFor("fr-fuel", "2A")!.name, "Corse-du-Sud");
  assert.equal(areaFor("fr-fuel", "21")!.slug, "cote-d-or");
  assert.equal(areaFor("it-fuel", "MI")!.label, "Milan province");
  assert.equal(areaFor("it-fuel", "MI")!.local, "Milano");
  assert.equal(areaFor("it-fuel", "AO")!.label, "Aosta Valley");
  assert.equal(areaFor("ie-ppr", "cork")!.label, "County Cork");
  assert.equal(areaFor("ie-ppr", "dublin-6")!.label, "Dublin 6");
  assert.equal(areaFor("ie-ppr", "dublin-6w")!.label, "Dublin 6W");
  assert.equal(areaFor("ie-ppr", "dublin-6")!.parent, "dublin");
  assert.equal(areaFor("ie-ppr", "ALL")!.label, "Ireland");
  assert.match(areaFor("es-fuel", "ALL")!.note ?? "", /Canary Islands, Ceuta and Melilla/);
  assert.equal(areaFor("es-fuel", "99"), null);
  assert.equal(areaFor("ie-ppr", "dublin-30"), null);
  assert.equal(areaFor("xx-unknown", "28"), null);
  assert.equal(dublinDistrictName("dublin-24"), "Dublin 24");
  assert.equal(slugify("Côte-d'Or"), "cote-d-or");
  assert.equal(slugify("Barletta-Andria-Trani"), "barletta-andria-trani");
});

test("every name map is complete and has no duplicate slugs", () => {
  assert.equal(knownAreaCodes("es-fuel").length, 52 + 17); // provinces + autonomous communities
  assert.equal(knownAreaCodes("it-fuel").length, 107);
  assert.ok(knownAreaCodes("fr-fuel").length >= 96);
  assert.equal(knownAreaCodes("ie-ppr").length, 26);
  for (const src of ["es-fuel", "fr-fuel", "it-fuel", "ie-ppr"]) {
    const slugs = knownAreaCodes(src).map((c) => areaFor(src, c)!.slug);
    assert.equal(new Set(slugs).size, slugs.length, `${src} slugs are unique`);
    for (const s of slugs) assert.match(s, /^[a-z0-9]+(-[a-z0-9]+)*$/, s);
  }
});

test("the committed price library has a readable name for every area it holds", () => {
  for (const spec of PAGE_SOURCES) {
    const day = readLatestDay(spec.sourceId);
    if (!day) continue; // a source with no collected day yet has no pages, and that is fine
    const missing = [...new Set(day.rows.map((r) => r.area))].filter((code) => !areaFor(spec.sourceId, code));
    assert.deepEqual(missing, [], `${spec.sourceId}: add these codes to lib/site/areas.ts`);
  }
});

// ---------- answer page builder ----------

test("answer pages skip any figure built from fewer than 5 records, and any place left with none", () => {
  const day = {
    date: "2026-10-14",
    rows: [
      row("28", "diesel", 4, 1.9), // too thin: no diesel figure
      row("28", "petrol95", 5, 1.8), // exactly 5: kept
      row("08", "diesel", 4, 1.9), // every row thin: no page
      row("08", "lpg", 1, 1.1),
      row("ZZ", "diesel", 80, 1.9), // no readable name: skipped, reported
      row("42", "diesel", 120, 1.85),
    ],
  };
  const res = buildSourcePages(esSpec, day, { info, category: fuelCat, currency: "EUR" });
  assert.deepEqual(res.pages.map((p) => p.area.slug).sort(), ["madrid", "soria"]);
  const madrid = res.pages.find((p) => p.area.slug === "madrid")!;
  assert.deepEqual(madrid.figures.map((f) => f.id), ["petrol95"]);
  assert.equal(madrid.figures[0].n, 5);
  assert.equal(madrid.figures[0].confidence, "low");
  assert.deepEqual(res.skipped.sort((a, b) => a.code.localeCompare(b.code)), [
    { code: "08", reason: "too-few-records" },
    { code: "ZZ", reason: "no-name" },
  ]);
});

test("a fuel page asks a question, answers it with source, date and sample size, and links the live answer", () => {
  const day = { date: "2026-10-14", rows: [row("28", "diesel", 865, 1.949, 0.1), row("28", "methane", 37, 1.999), row("ALL", "diesel", 10774, 1.92)] };
  const res = buildSourcePages(esSpec, day, { info, category: fuelCat, currency: "EUR" });
  const page = res.pages.find((p) => p.area.slug === "madrid")!;
  assert.equal(page.path, "/prices/es/fuel/madrid");
  assert.equal(page.h1, "What does fuel cost in Madrid province today?");
  const diesel = page.figures[0];
  assert.equal(diesel.question, "What does diesel cost in Madrid province today?");
  assert.match(diesel.answer, /median €1\.949 per litre on 14 October 2026/);
  assert.match(diesel.answer, /across 865 stations\. Confidence: high\./);
  assert.equal(diesel.liveRestPath, "/api/v1/fuel?country=ES&area=28&fuel=diesel");
  assert.deepEqual(diesel.mcpArgs, { country: "ES", area: "28", fuel: "diesel" });
  assert.equal(page.figures[1].unit, "per kg");
  assert.equal(page.mcpTool, "pricepaid_fuel_prices_now");
  assert.match(page.ask, /^Using the ProofPrice MCP server, what does diesel cost in Madrid province today\?/);
  assert.match(page.basis, /not individual receipts/);
  assert.equal(page.source.licence_url, info.licence_url);
  assert.equal(page.asOf, "2026-10-14");
  assert.equal(page.historyRestPath, "/api/v1/fuel/history?country=ES&area=28&fuel=diesel&days=30");
  // the national page comes first, has no live REST answer (the live API needs a postcode or province) and carries its scope note
  assert.equal(res.pages[0].national, true);
  assert.equal(res.pages[0].path, "/prices/es/fuel/spain");
  assert.equal(res.pages[0].figures[0].liveRestPath, null);
  assert.match(res.pages[0].area.note ?? "", /mainland Spain/);
  assert.equal(res.pages[0].historyRestPath, "/api/v1/fuel/history?country=ES&fuel=diesel&days=30");
});

test("Italian pages label self-service and attended prices apart", () => {
  const itInfo = SOURCE_PLUGINS.find((s) => s.info.id === "it-fuel")!.info;
  const itSpec = PAGE_SOURCES.find((p) => p.sourceId === "it-fuel")!;
  const day = { date: "2026-10-13", rows: [row("MI", "diesel", 300, 2.0), row("MI", "diesel/served", 200, 2.4), row("MI", "lpg", 90, 0.78)] };
  const page = buildSourcePages(itSpec, day, { info: itInfo, category: fuelCat }).pages[0];
  assert.deepEqual(page.figures.map((f) => f.label), ["Diesel (self-service)", "Diesel (attended service)", "LPG (autogas)"]);
  assert.equal(page.figures[1].liveRestPath, "/api/v1/fuel?country=IT&area=MI&fuel=diesel&service=served");
  assert.equal(page.figures[1].question, "What does diesel with attended service cost in Milan province today?");
});

test("an Irish page uses the 12-month window, shows new homes with their VAT caveat and drops a duplicate figure", () => {
  const day = {
    date: "2026-10-02",
    rows: [
      row("dublin-6", "any:12m", 382, 775000, 100000),
      row("dublin-6", "second-hand:12m", 382, 775000, 100000), // same records as "any": shown once
      row("dublin-6", "any:3m", 90, 1), // other windows are ignored
      row("cork", "any:12m", 3000, 300000, 50000),
      row("cork", "second-hand:12m", 2500, 290000, 50000),
      row("cork", "new:12m", 500, 360000, 50000),
      row("dublin-9", "any:12m", 4, 500000), // too thin
    ],
  };
  const res = buildSourcePages(ieSpec, day, { info: ieInfo, category: homeCat, currency: "EUR" });
  assert.deepEqual(res.pages.map((p) => p.area.slug).sort(), ["cork", "dublin-6"]);
  const d6 = res.pages.find((p) => p.area.slug === "dublin-6")!;
  assert.equal(d6.h1, "What did homes sell for in Dublin 6?");
  assert.equal(d6.figures.length, 1);
  assert.deepEqual(d6.period, { from: monthsBefore("2026-10-02", 12), to: "2026-10-02" });
  assert.equal(d6.period!.from, "2025-10-02");
  assert.match(d6.figures[0].answer, /sold for a median of €775,000 in the 12 months to 2 October 2026/);
  assert.equal(d6.figures[0].liveRestPath, "/api/v1/home-sales?country=IE&months=12&town=Dublin+6");
  assert.equal(d6.historyRestPath, null);
  const cork = res.pages.find((p) => p.area.slug === "cork")!;
  assert.equal(cork.area.label, "County Cork");
  assert.deepEqual(cork.figures.map((f) => f.id), ["any", "second-hand", "new"]);
  assert.match(cork.figures[2].caveat ?? "", /without 13\.5% VAT/);
  assert.equal(cork.figures[2].liveRestPath, "/api/v1/home-sales?country=IE&months=12&town=Cork&property_type=new");
  assert.equal(res.skipped.find((s) => s.code === "dublin-9")?.reason, "too-few-records");
});

test("publisher names shorten cleanly for meta descriptions", () => {
  assert.equal(shortPublisher("Property Services Regulatory Authority (PSRA), Ireland"), "Property Services Regulatory Authority");
  assert.equal(shortPublisher("Ministère de l'Économie via data.economie.gouv.fr"), "Ministère de l'Économie");
  assert.equal(longDate("2026-10-14"), "14 October 2026");
  assert.equal(shortLicence("Creative Commons Attribution 4.0 (PSRA open data; wording to be confirmed with the publisher)"), "Creative Commons Attribution 4.0");
  assert.equal(shortLicence("Spanish public-sector information reuse terms (Ley 37/2007, RD 1495/2011): reuse allowed."), "Spanish public-sector information reuse terms");
  assert.equal(shortLicence("Open Government Licence v3.0"), "Open Government Licence v3.0");
  assert.equal(noFullStop("Exact licence text to be confirmed."), "Exact licence text to be confirmed");
});

// ---------- the real library, as it will be built ----------

test("the real answer pages obey the data rules", () => {
  const { pages, skipped } = loadAnswerPages();
  assert.ok(pages.length >= 100, `expected a few hundred pages, got ${pages.length}`);
  assert.ok(pages.length < 1000, "keep the page count reasonable");
  assert.deepEqual(skipped.filter((s) => s.reason === "no-name"), []);
  const paths = pages.map((p) => p.path);
  assert.equal(new Set(paths).size, paths.length, "paths are unique");
  for (const p of pages) {
    assert.match(p.path, /^\/prices\/[a-z]{2}\/(fuel|home-sales)\/[a-z0-9-]+$/, p.path);
    assert.ok(p.figures.length > 0, p.path);
    assert.match(p.h1, /\?$/, `${p.path} H1 is a question`);
    assert.ok(p.description.length > 50 && p.description.length < 400, `${p.path} description length`);
    assert.ok(p.source.licence_url.startsWith("https://"), p.path);
    assert.ok(p.source.attribution.length > 10, p.path);
    for (const f of p.figures) {
      assert.ok(f.n >= 5, `${p.path} ${f.id} rests on ${f.n} records`);
      assert.ok(f.low <= f.median && f.median <= f.high, `${p.path} ${f.id} range brackets the median`);
      assert.ok(f.answer.includes(int(f.n)), `${p.path} ${f.id} answer states its sample size`);
      assert.ok(f.answer.includes(f.medianText), `${p.path} ${f.id} answer states the median`);
      assert.match(f.answer, /Confidence: (high|medium|low)\./);
      assert.match(f.question, /\?$/);
    }
  }
  // the pages named in the brief exist
  for (const p of ["/prices/es/fuel/madrid", "/prices/ie/home-sales/dublin-6", "/prices/it/fuel/milan", "/prices/fr/fuel/paris"]) assert.ok(paths.includes(p), p);
  assert.deepEqual(allAnswerPages(), pages);
});

test("the sitemap built from the real library lists every answer page once", () => {
  const entries = buildSitemap(SITE_URL, new Date("2026-10-14T00:00:00Z"), libraryForSitemap());
  const urls = entries.map((e) => e.url);
  assert.equal(new Set(urls).size, urls.length);
  for (const p of allAnswerPages()) assert.ok(urls.includes(`${SITE_URL}${p.path}`), p.path);
  for (const idx of ["/prices", "/prices/es", "/prices/es/fuel", "/prices/ie/home-sales"]) assert.ok(urls.includes(`${SITE_URL}${idx}`), idx);
});

// ---------- JSON-LD ----------

test("serializeJsonLd gives valid JSON and can never close the script tag", () => {
  const text = serializeJsonLd({ name: "</script><script>alert(1)</script> & <b>", n: 1 });
  assert.ok(!text.includes("</script>"));
  assert.ok(!text.includes("<"));
  assert.deepEqual(JSON.parse(text), { name: "</script><script>alert(1)</script> & <b>", n: 1 });
});

test("a Dataset is built for every source from the registry, with a licence URL, a publisher and a JSON download", () => {
  const cards = sourceCards();
  assert.equal(cards.length, SOURCE_PLUGINS.length);
  const graph = JSON.parse(serializeJsonLd(sourcesGraph(cards.map(datasetInput))));
  const datasets = graph["@graph"].filter((n: any) => n["@type"] === "Dataset");
  assert.equal(datasets.length, SOURCE_PLUGINS.length);
  for (const d of datasets) {
    const src = SOURCE_PLUGINS.find((s) => s.info.id === d.identifier)!;
    assert.equal(d.license, src.info.licence_url);
    assert.match(d.license, /^https:\/\//);
    assert.equal(d.isAccessibleForFree, true);
    assert.equal(d.creator["@type"], "Organization");
    assert.equal(d.creator.name, src.info.publisher);
    assert.ok(d.description.length >= 50, `${d.identifier} description is long enough for Dataset Search`);
    assert.ok(d.description.includes(src.info.what_is_recorded.replace(/\.$/, "")));
    assert.ok(d.description.includes(src.info.limits.replace(/\.$/, "")));
    assert.ok(d.spatialCoverage.length >= 1);
    assert.deepEqual(d.spatialCoverage.map((p: any) => p.address.addressCountry), src.countries);
    assert.equal(d.distribution[0].encodingFormat, "application/json");
    assert.match(d.distribution[0].contentUrl, /^https:\/\/proofprice\.com\/api\/v1\//);
    assert.ok(exampleUrls().some((e) => d.distribution[0].contentUrl === `${SITE_URL}${e.path}`), `${d.identifier} points at a real example request`);
    assert.equal(d.url, `${SITE_URL}/sources#${src.info.id}`);
  }
  const page = graph["@graph"].find((n: any) => n["@type"] === "CollectionPage");
  assert.equal(page.mainEntity.length, SOURCE_PLUGINS.length);
});

test("a Dataset omits dateModified when there is no library and adds it when there is", () => {
  const base = datasetInput(sourceCards()[0]);
  assert.equal("dateModified" in datasetLd({ ...base, dateModified: null }), false);
  assert.equal((datasetLd({ ...base, dateModified: "2026-10-14" }) as any).dateModified, "2026-10-14");
});

test("the home page describes the organisation, the website and the API with their links", () => {
  const g = JSON.parse(serializeJsonLd(homeGraph()));
  const by = (t: string) => g["@graph"].find((n: any) => n["@type"] === t);
  const org = by("Organization");
  assert.equal(org.name, "ProofPrice");
  assert.equal(org.url, SITE_URL);
  assert.equal(org.email, "hello@proofprice.com");
  assert.equal(org.logo.url, `${SITE_URL}/icon-512.png`);
  assert.equal(by("WebSite").url, SITE_URL);
  const api = by("WebAPI");
  assert.ok(api.documentation.includes(`${SITE_URL}/connect`));
  assert.ok(api.documentation.includes(`${SITE_URL}/openapi.json`));
  assert.equal(api.termsOfService, `${SITE_URL}/terms`);
  assert.deepEqual(api.provider, { "@id": org["@id"] });
  assert.ok(by("WebPage").significantLink.includes(`${SITE_URL}/privacy`));
});

test("an answer page's FAQ repeats exactly the questions and answers the page shows", () => {
  const page = allAnswerPages().find((p) => p.path === "/prices/es/fuel/madrid")!;
  const crumbs = [{ name: "Home", path: "/" }, { name: "Prices", path: "/prices" }];
  const g = JSON.parse(serializeJsonLd(answerPageGraph(page, crumbs)));
  const faq = g["@graph"].find((n: any) => n["@type"] === "FAQPage");
  assert.equal(faq.mainEntity.length, page.figures.length);
  faq.mainEntity.forEach((q: any, i: number) => {
    assert.equal(q.name, page.figures[i].question);
    assert.ok(q.acceptedAnswer.text.startsWith(page.figures[i].answer));
    assert.ok(q.acceptedAnswer.text.includes(noFullStop(page.source.licence)));
    assert.ok(q.acceptedAnswer.text.includes(noFullStop(page.source.publisher)));
    assert.ok(!q.acceptedAnswer.text.includes(".."), "no doubled full stops");
  });
  const web = g["@graph"].find((n: any) => n["@type"] === "WebPage");
  assert.equal(web.url, `${SITE_URL}${page.path}`);
  assert.equal(web.dateModified, page.asOf);
  assert.equal(web.breadcrumb.itemListElement[1].item, `${SITE_URL}/prices`);
  const ds = g["@graph"].find((n: any) => n["@type"] === "Dataset");
  assert.equal(ds["@id"], `${SITE_URL}${page.path}#dataset`);
  assert.deepEqual(web.mainEntity, { "@id": ds["@id"] });
  assert.equal(ds.license, page.source.licence_url);
  assert.equal(ds.creator.name, page.source.publisher);
  assert.equal(ds.isAccessibleForFree, true);
  assert.equal(ds.spatialCoverage.address.addressCountry, "ES");
  assert.match(ds.temporalCoverage, /^\d{4}-\d{2}-\d{2}(\/\d{4}-\d{2}-\d{2})?$/);
  assert.ok(ds.description.length >= 50);
});

test("every answer page carries a valid-looking Dataset (licence, creator, place, period, no HTML in the JSON)", () => {
  const crumbs = [{ name: "Home", path: "/" }];
  for (const page of allAnswerPages()) {
    const text = serializeJsonLd(answerPageGraph(page, crumbs));
    assert.ok(!text.includes("<"));
    const ds = JSON.parse(text)["@graph"].find((n: any) => n["@type"] === "Dataset");
    assert.ok(ds, page.path);
    assert.match(ds.license, /^https?:\/\//, page.path);
    assert.ok(ds.creator.name && ds.name && ds.description, page.path);
    assert.ok(ds.temporalCoverage, page.path);
  }
});

// ---------- /sources, /status, home page ----------

test("sources are grouped by category, each with a record description, price type, licence link and an example", () => {
  const cards = sourceCards();
  const groups = groupByCategory(cards);
  assert.deepEqual(new Set(groups.map((g) => g.categoryId)), new Set(CATEGORIES.map((c) => c.id)));
  assert.equal(groups.flatMap((g) => g.cards).length, cards.length);
  for (const c of cards) {
    assert.ok(c.whatIsRecorded && c.priceTypeLabel && c.limits && c.attribution, c.id);
    assert.match(c.licenceUrl, /^https:\/\//, c.id);
    assert.ok(c.exampleRest?.startsWith("/api/v1/"), `${c.id} has an example request`);
    assert.ok(c.countryNames.every((n) => n.length > 2), `${c.id} country names are readable`);
  }
  assert.equal(cards.find((c) => c.id === "gb-hmlr-ppd")!.countryNames[0], "England and Wales");
  assert.equal(cards.find((c) => c.id === "ie-ppr")!.pricesPath, "/prices/ie/home-sales");
});

test("library health: OK, late, error and no data are told apart", () => {
  const card = (library: any) => ({ id: "x", name: "x", countryNames: ["Spain"], collected: true, library }) as any;
  const meta = (o: any = {}) => ({ source: "x", currency: "EUR", unit: null, first_date: "2026-10-13", last_date: "2026-10-14", days: 2, last_harvest_at: "2026-10-14T03:30:00.000Z", last_rows: 10, last_ok_at: "2026-10-14T03:30:00.000Z", last_error: null, ...o });
  const now = new Date("2026-10-15T09:00:00Z");
  assert.equal(libraryHealth(card(meta()), now).health, "ok");
  assert.equal(libraryHealth(card(meta()), now).ageDays, 1);
  assert.equal(libraryHealth(card(meta({ last_ok_at: "2026-10-10T03:30:00.000Z" })), now).health, "late");
  assert.equal(libraryHealth(card(meta({ last_error: "HTTP 503" })), now).health, "error");
  assert.equal(libraryHealth(card(meta({ last_error: "HTTP 503" })), now).lastError, "HTTP 503");
  assert.equal(libraryHealth(card(null), now).health, "no-data");
  assert.equal(libraryHealth(card(meta({ last_ok_at: null })), now).health, "late");
});

test("the real library status covers every collected source", () => {
  const cards = sourceCards().filter((c) => c.collected);
  assert.ok(cards.length >= 4);
  // A source added since the last harvest has no library/<id>/meta.json until the collector's first run on main
  // (the collector runs `npm test` first, so main must be able to hold such a source). Status reports it as "no-data".
  const held = cards.filter((c) => c.library);
  assert.ok(held.length >= 4, "the library holds at least the first collected sources");
  for (const c of cards.filter((c) => !c.library)) assert.equal(libraryHealth(c, new Date()).health, "no-data", `${c.id} is reported as awaiting its first harvest`);
});

test("home page examples are real requests from the registry's example list", () => {
  const ex = homeExamples(3);
  assert.equal(ex.length, 3);
  const known = exampleUrls().map((e) => e.path);
  for (const e of ex) {
    assert.ok(known.includes(e.path), e.path);
    assert.match(e.question, /\?$/);
    assert.ok(e.tool.startsWith("pricepaid_"), e.tool);
  }
});

test("llms-full.txt points AIs at the new pages and the answer-page pattern", () => {
  const t = buildLlmsFullTxt("https://example.test");
  for (const p of ["/sources", "/trust", "/status", "/prices"]) assert.ok(t.includes(`https://example.test${p}`), p);
  assert.ok(t.includes("https://example.test/prices/es/fuel"));
  assert.ok(t.includes("https://example.test/prices/ie/home-sales"));
  assert.ok(t.includes("/prices/<country>/<category>/<place>"));
});

// ---------- the library reader the pages use ----------

test("readLatestDay returns only the newest day of the newest month", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "pp-latest-"));
  const before = process.env.PROOFPRICE_LIBRARY_DIR;
  process.env.PROOFPRICE_LIBRARY_DIR = dir;
  try {
    assert.equal(readLatestDay("es-fuel"), null);
    mkdirSync(path.join(dir, "es-fuel", "daily"), { recursive: true });
    const r = (date: string, area: string, n: number) => ({ date, area, item: "diesel", n, median: 1.5, low: 1.4, high: 1.6, min: 1.3, max: 1.7 });
    writeFileSync(path.join(dir, "es-fuel", "daily", "2026-09.csv"), rowsToCsv([r("2026-09-30", "28", 50)]));
    assert.equal(readLatestDay("es-fuel")!.date, "2026-09-30");
    writeFileSync(path.join(dir, "es-fuel", "daily", "2026-10.csv"), rowsToCsv([r("2026-10-01", "28", 51), r("2026-10-02", "28", 52), r("2026-10-02", "08", 60)]));
    const day = readLatestDay("es-fuel")!;
    assert.equal(day.date, "2026-10-02");
    assert.deepEqual(day.rows.map((x) => `${x.area}:${x.n}`).sort(), ["08:60", "28:52"]);
  } finally {
    if (before === undefined) delete process.env.PROOFPRICE_LIBRARY_DIR;
    else process.env.PROOFPRICE_LIBRARY_DIR = before;
  }
});

test("us-gsa-surplus is described as a winning auction bid, not a completed sale (G20261021-GSA-WORDING)", () => {
  const c = sourceCards().find((x) => x.id === "us-gsa-surplus");
  assert.ok(c);
  assert.equal(c.priceTypeLabel, "Winning auction bid (before buyer premium)");
  assert.doesNotMatch(c.priceTypeShort, /completed sale/i);
});

test("404 page metadata: one plain title, no canonical, not indexed", async () => {
  const { notFoundMetadata } = await import("../lib/site/meta");
  const m = notFoundMetadata();
  assert.equal(m.title, "Page not found");
  assert.equal(m.alternates, undefined);
  assert.deepEqual(m.robots, { index: false, follow: true });
});

test("country price pages have a descriptive title with the main categories", async () => {
  const { generateMetadata } = await import("../app/prices/[country]/page");
  const g = (await import("../lib/site/prices")).countryGroups()[0];
  const m = await generateMetadata({ params: Promise.resolve({ country: g.slug }) });
  const title = String(m.title);
  assert.match(title, new RegExp(`^What people actually pay in ${g.name.replace(/[()]/g, "\\$&")}: `));
  assert.ok(title.toLowerCase().includes(g.categories[0].label.toLowerCase()));
});

test("home title names the product, the data and the audience, and fits a search result", () => {
  assert.ok(HOME_TITLE.length <= 70, `title is ${HOME_TITLE.length} characters`);
  for (const word of ["ProofPrice", "prices paid", "MCP", "API", "AI agents"]) {
    assert.ok(HOME_TITLE.toLowerCase().includes(word.toLowerCase()) || (word === "prices paid" && /prices paid/i.test(HOME_TITLE)), `missing ${word}`);
  }
});

test("faqPageGraph builds a FAQPage with absolute URLs and the given answers", () => {
  const g = faqPageGraph("/pricing", [{ name: "Home", path: "/" }, { name: "Pricing", path: "/pricing" }], [{ question: "Q?", answer: "A." }]) as {
    "@graph": Record<string, unknown>[];
  };
  const faq = g["@graph"].find((n) => n["@type"] === "FAQPage") as { url: string; mainEntity: { name: string; acceptedAnswer: { text: string } }[] };
  assert.equal(faq.url, `${SITE_URL}/pricing`);
  assert.equal(faq.mainEntity[0].name, "Q?");
  assert.equal(faq.mainEntity[0].acceptedAnswer.text, "A.");
});
