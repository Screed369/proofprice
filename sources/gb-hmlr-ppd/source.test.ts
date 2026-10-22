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
