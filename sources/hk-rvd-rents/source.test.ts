// Fixture fixtures/1.1M.csv is the real RVD file https://www.rvd.gov.hk/datagovhk/1.1M.csv captured through the GitHub-hosted probe on 2026-10-20
// (29 253 bytes, 332 monthly rows 01-1999 to 08-2026, Last-Modified 7 Oct 2026).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { INFO, hkRents, newestUsable, normaliseClass, parseRents, resolveRegion, URL_RENTS } from "./source";

const CSV = readFileSync(new URL("./fixtures/1.1M.csv", import.meta.url), "utf8");

test("real file parses: 332 months, 15 class x region columns, flags", () => {
  const rows = parseRents(CSV);
  assert.equal(rows.length, 332);
  assert.equal(rows[0].month, "1999-01");
  assert.equal(rows[0].cells["A|Hong Kong"].value, 190);
  assert.equal(rows[rows.length - 1].month, "2026-08");
  const last = rows[rows.length - 1].cells;
  assert.equal(last["A|Hong Kong"].value, 568);
  assert.equal(last["A|Hong Kong"].provisional, true);
  assert.equal(last["E|Kowloon"].unreliable, true);
  assert.equal(Object.keys(last).length, 15);
});

test("unreliable (Z) months are skipped for the headline", () => {
  const rows = parseRents(CSV);
  const cut = rows.map((r, i) => (i === rows.length - 1 ? { ...r, cells: { ...r.cells, "A|Kowloon": { ...r.cells["A|Kowloon"], unreliable: true } } } : r));
  assert.equal(newestUsable(cut, "A", "Kowloon")!.row.month, "2026-07");
  assert.equal(newestUsable(rows, "A", "Kowloon")!.row.month, "2026-08");
});

test("a cell unreliable for the whole last year gives no figure instead of a 1999 one", () => {
  const rows = parseRents(CSV);
  assert.equal(newestUsable(rows, "E", "Kowloon"), null); // real data: Class E Kowloon is flagged Z in all of the last 12 months
  const cut = rows.map((r, i) => (i >= rows.length - 12 ? { ...r, cells: { ...r.cells, "E|Kowloon": { value: 300, provisional: false, unreliable: true } } } : r));
  assert.equal(newestUsable(cut, "E", "Kowloon"), null);
});

test("region and class spellings", () => {
  assert.equal(resolveRegion("Kowloon").region, "Kowloon");
  assert.equal(resolveRegion("hong kong island").region, "Hong Kong");
  assert.equal(resolveRegion("NT").region, "New Territories");
  const d = resolveRegion("Mong Kok");
  assert.equal(d.region, "Kowloon");
  assert.match(d.note!, /region only/);
  assert.throws(() => resolveRegion("Macau"), /not a Hong Kong region/);
  assert.equal(normaliseClass("class b"), "B");
  assert.equal(normaliseClass("a"), "A");
  assert.equal(normaliseClass(undefined), undefined);
  assert.throws(() => normaliseClass("F"), /flat_class must be one of/);
});

test("answer: Kowloon class B is an official average with source, no range, no sample size", async () => {
  const seen: string[] = [];
  const a = await hkRents({ town: "Kowloon", flat_class: "B" }, async (u) => { seen.push(u); return CSV; });
  assert.deepEqual(seen, [URL_RENTS]);
  assert.equal(a.status, "ok");
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.price!.value, 418);
  assert.equal(a.price!.currency, "HKD");
  assert.equal(a.price!.typical_low, null);
  assert.equal(a.sample_size, null);
  assert.deepEqual(a.period, { from: "2026-08-01", to: "2026-08-31" });
  assert.equal(a.statistic!.reference_period, "2026-08");
  assert.match(a.summary, /418/);
  assert.match(a.summary, /provisional/);
  assert.ok(a.source.attribution.includes("Rating and Valuation Department"));
  const extra = a.extra as any;
  assert.equal(extra.classes.length, 5);
  assert.equal(extra.last_12_months.length, 12);
  assert.equal(extra.change_on_year_earlier.month, "2025-08");
});

test("default class is B and says so; a district note is given", async () => {
  const a = await hkRents({ town: "Sha Tin" }, async () => CSV);
  assert.equal((a.query as any).flat_class, "B");
  assert.equal((a.query as any).town, "New Territories");
  assert.match(a.statistic!.note!, /No flat class was asked for/);
  assert.match(a.statistic!.note!, /region only/);
});

test("bad input is refused before any download", async () => {
  const never = async () => { throw new Error("should not fetch"); };
  await assert.rejects(hkRents({}, never), /town is required/);
  await assert.rejects(hkRents({ town: "Paris" }, never), /not a Hong Kong region/);
  await assert.rejects(hkRents({ town: "Kowloon", flat_class: "Z" }, never), /flat_class must be/);
});

test("a changed file layout is reported, not guessed", () => {
  assert.throws(() => parseRents("a,b\n1,2\n"), /changed layout/);
});

test("licence and honesty fields", () => {
  assert.equal(INFO.price_type, "official_statistic");
  assert.match(INFO.licence, /DATA\.GOV\.HK/);
  assert.match(INFO.limits, /not an asking rent/);
});
