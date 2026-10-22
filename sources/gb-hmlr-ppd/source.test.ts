import { test } from "node:test";
import assert from "node:assert/strict";
import { buildUkQuery, parseUkBindings, INFO } from "./source";

test("UK SPARQL query is built safely", () => {
  const q = buildUkQuery({ town: 'bristol"; DROP', postcodeDistrict: "bs8", propertyType: "terraced", fromDate: "2025-10-12", limit: 100 });
  assert.match(q, /"BRISTOL; DROP"\^\^xsd:string/);
  assert.match(q, /STRSTARTS\(\?postcode, "BS8 "\)/);
  assert.match(q, /lrcommon:terraced/);
  assert.match(q, /standardPricePaidTransaction/);
  assert.doesNotMatch(q, /"BRISTOL";/);
});

test("UK bindings parse", () => {
  const rows = parseUkBindings({
    results: { bindings: [
      { amount: { value: "325000" }, date: { value: "2026-08-01" } },
      { amount: { value: "abc" }, date: { value: "2026-08-02" } },
    ] },
  });
  assert.deepEqual(rows, [{ amount: 325000, date: "2026-08-01" }]);
  assert.throws(() => parseUkBindings({}));
});

test("UK: limits state per-home prices, category A only and the registration lag (audit 2026-10-14)", () => {
  assert.match(INFO.limits, /Prices are per home/);
  assert.match(INFO.limits, /category B\) are left out/);
  assert.match(INFO.limits, /most recent months are incomplete/);
  assert.match(INFO.freshness, /latest months are incomplete/);
});

test("UK bindings: zero, empty and missing amounts are dropped, never counted as a price", () => {
  const rows = parseUkBindings({
    results: { bindings: [
      { amount: { value: "" }, date: { value: "2026-08-01" } },
      { amount: { value: "0" }, date: { value: "2026-08-01" } },
      { date: { value: "2026-08-01" } },
      { amount: { value: "250000" } },
    ] },
  });
  assert.deepEqual(rows, []);
});

// ---------- the 12-month window (pilot finding 1, 22 Oct 2026) ----------
// A fake Land Registry: `perDay(date)` sales on each day, returned in the endpoint's SPARQL JSON shape and cut at the row limit.
import { monthWindows, splitWindow, collectUk, ukHomeSales, mergeWindows, UK_ROW_CAP, buildUkQuery as buildQ, DateWindow } from "./source";

function fakeEndpoint(perDay: (date: string) => number, opts: { failFrom?: string } = {}) {
  const calls: DateWindow[] = [];
  const fetchWindow = async (w: DateWindow) => {
    calls.push(w);
    if (opts.failFrom && w.from >= opts.failFrom) throw new Error("Source timed out");
    const rows: { amount: number; date: string }[] = [];
    for (let d = w.from; d < w.to; d = new Date(Date.parse(d + "T00:00:00Z") + 86400000).toISOString().slice(0, 10)) {
      for (let i = 0; i < perDay(d); i++) rows.push({ amount: 200000 + ((i * 7919) % 400000), date: d });
    }
    // what the endpoint's JSON would parse to, cut at the limit
    return parseUkBindings({ results: { bindings: rows.slice(0, UK_ROW_CAP).map((r) => ({ amount: { value: String(r.amount) }, date: { value: r.date } })) } });
  };
  return { fetchWindow, calls };
}

test("UK window: a query has an upper date bound and no newest-first cut-off", () => {
  const q = buildQ({ town: "Bristol", propertyType: "any", fromDate: "2026-01-01", toDate: "2026-02-01", limit: 2500 });
  assert.match(q, /\?date >= "2026-01-01"\^\^xsd:date && \?date < "2026-02-01"\^\^xsd:date/);
  assert.doesNotMatch(q, /ORDER BY/);
  assert.match(q, /LIMIT 2500/);
});

test("UK window: months are cut on calendar boundaries and cover every day exactly once", () => {
  const w = monthWindows("2025-10-22", "2026-10-22");
  assert.equal(w.length, 13);
  assert.deepEqual(w[0], { from: "2025-10-22", to: "2025-11-01" });
  assert.deepEqual(w[12], { from: "2026-10-01", to: "2026-10-23" });
  for (let i = 1; i < w.length; i++) assert.equal(w[i].from, w[i - 1].to);
  assert.deepEqual(splitWindow({ from: "2026-01-01", to: "2026-02-01" }), [{ from: "2026-01-01", to: "2026-01-16" }, { from: "2026-01-16", to: "2026-02-01" }]);
  assert.equal(splitWindow({ from: "2026-01-01", to: "2026-01-02" }), null);
});

test("UK window: Bristol-sized town (about 700 sales a month) really gets 12 months, not the newest 5,000", async () => {
  const ep = fakeEndpoint(() => 23); // 23 a day = about 700 a month, about 8,400 a year: the old single query stopped at 5,000
  const a = await ukHomeSales({ town: "Bristol", months: 12, today: "2026-08-28", fetchWindow: ep.fetchWindow });
  assert.equal(a.status, "ok");
  assert.equal(a.period.from, "2025-08-28");
  assert.equal(a.period.to, "2026-08-28");
  assert.equal(a.sample_size, 23 * 366);
  assert.equal((a.extra as any).coverage.complete, true);
  assert.doesNotMatch(a.notice, /Partial window/);
});

test("UK window: a very busy month is split until it fits, so London-sized months are still complete", async () => {
  const ep = fakeEndpoint(() => 400); // 12,000 a month: far over the 2,500 cap
  const a = await ukHomeSales({ town: "Somewhere busy", months: 3, today: "2026-08-28", fetchWindow: ep.fetchWindow });
  assert.equal((a.extra as any).coverage.complete, true);
  assert.ok(ep.calls.length > 4 && ep.calls.length <= 48);
  assert.equal(a.sample_size! % 400, 0);
});

test("UK window: when the endpoint fails for part of the window the answer says so and reports the true period", async () => {
  const ep = fakeEndpoint(() => 20, { failFrom: "2026-05-01" });
  const a = await ukHomeSales({ town: "Bristol", months: 12, today: "2026-08-28", fetchWindow: ep.fetchWindow });
  assert.equal(a.status, "ok");
  assert.equal(a.period.to, "2026-04-30"); // nothing after April is in the figure, and the period says so
  const cov = (a.extra as any).coverage;
  assert.equal(cov.complete, false);
  assert.deepEqual(cov.missing_ranges, [{ from: "2026-05-01", to: "2026-08-28" }]);
  assert.match(a.notice, /Partial window: the 12-month period asked for/);
  assert.match(a.notice, /2026-05-01 to 2026-08-28/);
  assert.match(a.summary, /Partial window/);
});

test("UK window: if every piece fails the error is thrown (so stale-if-error can answer), never an empty ok", async () => {
  const ep = fakeEndpoint(() => 20, { failFrom: "2000-01-01" });
  await assert.rejects(ukHomeSales({ town: "Bristol", months: 2, today: "2026-08-28", fetchWindow: ep.fetchWindow }), /timed out/);
});

test("UK window: a spent time budget leaves pieces missing and reported, not silently dropped", async () => {
  let t = 0;
  const ep = fakeEndpoint(() => 20);
  const got = await collectUk(async (w) => { t += 10_000; return ep.fetchWindow(w); }, monthWindows("2026-01-01", "2026-06-30"), { budgetMs: 25_000, concurrency: 1, now: () => t });
  assert.ok(got.missing.length > 0);
  assert.equal(got.queries + got.missing.length, 6);
  assert.deepEqual(mergeWindows([{ from: "a", to: "b" }, { from: "b", to: "c" }]), [{ from: "a", to: "c" }]);
});

// ---------- district and London (pilot findings 2 and 3, 22 Oct 2026) ----------
import { normaliseDistrict, londonBoroughFor, boroughLabel } from "./source";
import { InputError } from "../../lib/http";

// Real response of the live endpoint for a Camden query, 22 Oct 2026 (probe hm1): extra variables ?d ?t come back beside amount and date.
const CAMDEN_LIVE = {
  head: { vars: ["amount", "date", "d", "t"] },
  results: { bindings: [
    { amount: { type: "literal", datatype: "http://www.w3.org/2001/XMLSchema#integer", value: "260000" }, date: { type: "literal", datatype: "http://www.w3.org/2001/XMLSchema#date", value: "2026-07-01" }, d: { type: "literal", value: "CAMDEN" }, t: { type: "literal", value: "LONDON" } },
    { amount: { type: "literal", datatype: "http://www.w3.org/2001/XMLSchema#integer", value: "400000" }, date: { type: "literal", datatype: "http://www.w3.org/2001/XMLSchema#date", value: "2026-07-21" }, d: { type: "literal", value: "CAMDEN" }, t: { type: "literal", value: "LONDON" } },
  ] },
};

test("UK district: the live Camden response parses, and a district query filters on the council, not the town", () => {
  assert.deepEqual(parseUkBindings(CAMDEN_LIVE), [{ amount: 260000, date: "2026-07-01" }, { amount: 400000, date: "2026-07-21" }]);
  const q = buildQ({ district: "camden", propertyType: "any", fromDate: "2026-01-01", toDate: "2026-02-01", limit: 10 });
  assert.match(q, /lrcommon:district \?authority \. FILTER\(\?authority = "CAMDEN"\)/);
  assert.doesNotMatch(q, /lrcommon:town/); // no town given: nothing restricts the postal town
  const both = buildQ({ town: "Bristol", district: "City of Bristol", propertyType: "terraced", fromDate: "2026-01-01", limit: 10 });
  assert.match(both, /"BRISTOL"\^\^xsd:string/);
  assert.match(both, /FILTER\(\?authority = "CITY OF BRISTOL"\)/);
});

test("UK district: council names are normalised and cannot break out of the query", () => {
  assert.equal(normaliseDistrict("Kensington & Chelsea"), "KENSINGTON AND CHELSEA");
  assert.equal(normaliseDistrict("  london  borough of Camden "), "CAMDEN");
  assert.equal(normaliseDistrict("Westminster"), "CITY OF WESTMINSTER");
  assert.equal(normaliseDistrict("Bristol"), "CITY OF BRISTOL");
  assert.equal(normaliseDistrict("   "), undefined);
  const q = buildQ({ district: 'Camden") } ; DROP "', propertyType: "any", fromDate: "2026-01-01", limit: 1 });
  assert.doesNotMatch(q, /authority = "[^"]*"\)[^\n]*DROP/);
  assert.equal((q.match(/"/g) ?? []).length % 2, 0);
  assert.equal(londonBoroughFor("Camden"), "CAMDEN");
  assert.equal(londonBoroughFor("Bristol"), null);
  assert.equal(boroughLabel("CITY OF WESTMINSTER"), "City of Westminster");
});

test("UK district: district=Camden is answered from district sales, with the district in the query and the summary", async () => {
  const ep = fakeEndpoint(() => 3);
  const a = await ukHomeSales({ district: "Camden", months: 2, today: "2026-08-28", fetchWindow: ep.fetchWindow });
  assert.equal(a.status, "ok");
  assert.equal((a.query as any).district, "CAMDEN");
  assert.equal((a.query as any).town, null);
  assert.match(a.summary, /in district CAMDEN|in CAMDEN/);
});

test("UK London: a London borough asked as a town gets a hint pointing to district, not a bare no_matches", async () => {
  const ep = fakeEndpoint(() => 0); // the register has no town called Camden
  const a = await ukHomeSales({ town: "Camden", months: 3, today: "2026-08-28", fetchWindow: ep.fetchWindow });
  assert.equal(a.status, "no_matches");
  assert.match(a.summary, /London borough/);
  assert.match(a.summary, /district=CAMDEN/);
  assert.match(a.suggestions![0], /district=CAMDEN/);
  assert.match((a.extra as any).hint, /postal town LONDON/);
  // an ordinary town with no sales gets no London hint
  const b = await ukHomeSales({ town: "Nowhereville", months: 3, today: "2026-08-28", fetchWindow: ep.fetchWindow });
  assert.equal(b.status, "no_matches");
  assert.equal((b.extra as any).hint, undefined);
  // a district that matches nothing says how the register spells councils
  const c = await ukHomeSales({ district: "Camdn", months: 3, today: "2026-08-28", fetchWindow: ep.fetchWindow });
  assert.match((c.extra as any).hint, /check the spelling/);
});

test("UK London: town=London does not run a 30,000-sale query; it answers at once with the boroughs to ask for", async () => {
  let called = 0;
  const fetchWindow = async () => { called++; return []; };
  await assert.rejects(
    ukHomeSales({ town: "London", fetchWindow }),
    (e: any) => e instanceof InputError && /district=Camden/.test(e.message) && /Tower Hamlets/.test(e.message) && /postcode_district=SW1/.test(e.message),
  );
  assert.equal(called, 0);
  // London narrowed by postcode district, or by borough, is allowed
  const ep = fakeEndpoint(() => 4);
  assert.equal((await ukHomeSales({ town: "London", postcode_district: "SW1", months: 1, today: "2026-08-28", fetchWindow: ep.fetchWindow })).status, "ok");
  assert.equal((await ukHomeSales({ town: "London", district: "Camden", months: 1, today: "2026-08-28", fetchWindow: ep.fetchWindow })).status, "ok");
  await assert.rejects(ukHomeSales({ fetchWindow }), /A town is required/);
});

test("UK manifest: district is an extra on home-sales (no new tool), town no longer required alone, and the postal-town meaning is documented", async () => {
  const m = (await import("./index")).default as any;
  assert.equal(m.category, "home-sales");
  assert.ok(m.extraParams.district);
  assert.match(m.paramNotes.town, /Royal Mail POSTAL TOWN/);
  assert.match(m.paramNotes.town, /Bradley Stoke/);
  assert.match(m.paramNotes.town, /every London sale is filed under 'London'/);
  assert.match(m.paramNotes.town, /use district/);
});
