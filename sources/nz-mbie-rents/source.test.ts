// Fixtures (real rows copied on 2026-10-14 from the live files; header lines in the live layout):
//  - fixtures/links.html: the "Updated monthly" block of the Tenancy Services rental bond data page.
//  - fixtures/tla.csv and fixtures/region.csv: the header and a handful of rows of detailed-monthly-tla/region-tenancy-october.csv.
// The suppressed-month and tiny-count cases are SYNTHETIC rows in the same layout.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { InputError, SourceError } from "../../lib/http";
import { SOURCE_PLUGINS } from "../../lib/registry";
import { INFO, PAGE_URL, answerFromRows, matchPlace, nzRents, parseLinks, parseRents, placesIn } from "./source";

const f = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8");
const LINKS = f("links.html");
const TLA = f("tla.csv");
const REGION = f("region.csv");

test("nz-mbie-rents: finds the monthly file links on the page", () => {
  const l = parseLinks(LINKS);
  assert.match(l.tla!, /^https:\/\/www\.tenancy\.govt\.nz\/assets\/Uploads\/Tenancy\/Rental-bond-data\/detailed-monthly-tla-tenancy-october\.csv/);
  assert.match(l.region!, /detailed-monthly-region-tenancy-october\.csv/);
  assert.deepEqual(parseLinks("<html></html>"), { tla: null, region: null });
});

test("nz-mbie-rents: parses quoted numbers with thousands commas and the ' -99' country id", () => {
  const rows = parseRents(TLA);
  const all = rows.find((r) => r.id === "-99" && r.month === "2025-08")!;
  assert.equal(all.lodged, 14700);
  assert.equal(all.median, 590);
  const w = rows.find((r) => r.name === "Wellington City" && r.month === "2026-08")!;
  assert.deepEqual([w.lodged, w.median, w.lower, w.upper], [636, 595, 450, 725]);
  assert.throws(() => parseRents("<html>moved</html>"), SourceError);
});

test("nz-mbie-rents: place matching prefers the city, accepts bare names, finds regions", () => {
  const tas = placesIn(parseRents(TLA), "territorial authority");
  assert.equal(matchPlace("Wellington", tas)?.name, "Wellington City");
  assert.equal(matchPlace("wellington city", tas)?.name, "Wellington City");
  assert.equal(matchPlace("Masterton", tas)?.id, "48");
  assert.equal(matchPlace("Atlantis", tas), null);
  const regs = placesIn(parseRents(REGION), "region");
  assert.equal(matchPlace("Wellington Region", regs)?.id, "9");
  assert.equal(matchPlace("Auckland", regs)?.name, "Auckland Region");
});

test("nz-mbie-rents: Wellington answer is a transaction range from the published quartiles", () => {
  const rows = parseRents(TLA);
  const place = matchPlace("Wellington", placesIn(rows, "territorial authority"))!;
  const a = answerFromRows(rows, place, { town: "Wellington", bedrooms: 2 });
  assert.equal(a.status, "ok");
  assert.equal(a.price_type, "transaction");
  assert.equal(a.price!.currency, "NZD");
  assert.equal(a.price!.unit, "per week");
  assert.equal(a.price!.median, 595);
  assert.equal(a.price!.typical_low, null);
  assert.equal((a.extra as any).p25, 450);
  assert.equal(a.price!.typical_high, null);
  assert.equal((a.extra as any).p75, 725);
  assert.equal(a.price!.min, null);
  assert.equal(a.sample_size, 636);
  assert.deepEqual(a.period, { from: "2026-08-01", to: "2026-08-31" });
  const x = a.extra as any;
  assert.equal(x.median_a_year_earlier.median, 550);
  assert.equal(x.median_a_year_earlier.change_percent, 8.2);
  assert.deepEqual(x.filters_not_applied, ["bedrooms=2"]);
  assert.match(a.summary, /not applied/);
  assert.match(a.summary, /Quartile/);
  assert.match(a.source.licence, /Creative Commons Attribution 3\.0 New Zealand/);
});

test("nz-mbie-rents: fewer than 5 bonds gives no figure; a suppressed month is skipped", () => {
  const rows = parseRents(TLA + '"2026-09-01","48","Masterton District","3","2,070","3","540","501","560","450","0.19"\n');
  const place = placesIn(rows, "territorial authority").find((p) => p.id === "48")!;
  const a = answerFromRows(rows, place, {});
  assert.equal(a.status, "insufficient_data");
  assert.equal(a.price, null);
  const supp = parseRents(TLA + '"2026-09-01","48","Masterton District","","2,070","","NULL","NULL","NULL","NULL",""\n');
  assert.equal(answerFromRows(supp, place, {}).period.from, "2026-08-01");
});

test("nz-mbie-rents: end to end with an injected fetcher; region fallback; input errors", async () => {
  const fetcher = async (u: string) => {
    if (u === PAGE_URL) return LINKS;
    if (/tla-tenancy/.test(u)) return TLA;
    if (/region-tenancy/.test(u)) return REGION;
    throw new Error("unexpected " + u);
  };
  assert.equal((await nzRents({ town: "Wellington", bedrooms: 2 }, fetcher)).price!.median, 595);
  assert.equal((await nzRents({ town: "Wellington Region" }, fetcher)).price!.median, 580);
  assert.equal((await nzRents({ town: "New Zealand" }, fetcher)).price!.median, 595);
  await assert.rejects(nzRents({ town: "Atlantis" }, fetcher), InputError);
  await assert.rejects(nzRents({}, fetcher), InputError);
  await assert.rejects(nzRents({ postcode: "6011" }, fetcher), InputError);
  await assert.rejects(nzRents({ town: "Wellington" }, async () => "<html></html>"), SourceError);
});

test("nz-mbie-rents: registered for NZ in the rent category", () => {
  const p = SOURCE_PLUGINS.find((s) => s.info.id === INFO.id)!;
  assert.equal(p.category, "rent");
  assert.deepEqual(p.countries, ["NZ"]);
  assert.equal(p.examples[0].params.town, "Wellington");
});

test("nz-mbie-rents: the examples only pass parameters the source applies (no bedrooms)", async () => {
  const { default: plugin } = await import("./index");
  for (const ex of plugin.examples) assert.ok(!("bedrooms" in ex.params), JSON.stringify(ex.params));
});
