import { test } from "node:test";
import assert from "node:assert/strict";
import { buildUrl, INFO, MIN_VALUE, parseRecords, parseSgDate, sgContracts } from "./source";
import { InputError, SourceError } from "../../lib/http";

// Rows copied from live data.gov.sg responses (datastore_search, q=cleaning), probed 2026-10-20. Supplier names are left out on purpose.
const row = (o: Record<string, unknown>) => ({ tender_detail_status: "Awarded to Suppliers", ...o });
const AGC = row({ _id: 37, tender_no: "AGC000ETT23000003", agency: "Attorney-General's Chambers", award_date: "3/7/2023", awarded_amt: "5787623" });
const AGO = row({ _id: 60, tender_no: "AGO000ETT23000002", agency: "Auditor-General's Office", award_date: "19/2/2024", awarded_amt: "91080" });
const CCCS = row({ _id: 418, tender_no: "CCS000ETT23000001", agency: "Competition and Consumer Commission of Singapore (CCCS)", award_date: "11/7/2023", awarded_amt: "168000" });
const MSF = row({ _id: 649, tender_no: "CDVHQ0ETT21000032", agency: "Ministry of Social and Family Development - Ministry Headquarter", award_date: "22/12/2021", awarded_amt: "1200000" });
const CEA = row({ _id: 844, tender_no: "CEA000ETT25000001", agency: "Council for Estate Agencies", award_date: "24/9/2025", awarded_amt: "260400" });
const wrap = (recs: any[], total = recs.length) => ({ success: true, result: { records: recs, total } });

async function withFetch(handler: (url: string) => any, run: () => Promise<void>) {
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: any) => new Response(JSON.stringify(handler(String(url))), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = real;
  }
}

test("GeBIZ: dates are day first", () => {
  assert.equal(parseSgDate("6/7/2023"), "2023-07-06");
  assert.equal(parseSgDate("22/12/2021"), "2021-12-22");
  assert.equal(parseSgDate("2023-07-06"), null);
  assert.equal(parseSgDate("31/13/2023"), null);
});

test("GeBIZ: awarded rows become awards with value, date and agency", () => {
  const r = parseRecords(wrap([AGC, AGO, CEA], 182));
  assert.equal(r.total, 182);
  assert.deepEqual(r.awards.map((a) => [a.value, a.date]), [[5787623, "2023-07-03"], [91080, "2024-02-19"], [260400, "2025-09-24"]]);
});

test("GeBIZ: other statuses, placeholder amounts and bad dates are skipped (derived from a real row)", () => {
  const r = parseRecords(wrap([row({ ...AGO, tender_detail_status: "Cancelled" }), { ...AGO, tender_no: "d1", awarded_amt: "0" }, { ...AGO, tender_no: "d2", award_date: "n/a" }, CCCS]));
  assert.equal(r.awards.length, 1);
  assert.equal(r.skipped, 3);
  assert.equal(MIN_VALUE, 100);
});

test("GeBIZ: an unexpected response is a source error", () => {
  assert.throws(() => parseRecords({ success: false }), SourceError);
  assert.throws(() => parseRecords(null), SourceError);
});

test("GeBIZ: the request is a key-free full-text search", () => {
  const u = new URL(buildUrl("cleaning", 1000));
  assert.equal(u.searchParams.get("resource_id"), "d_acde1106003906a75c3fa052592f2fcb");
  assert.equal(u.searchParams.get("q"), "cleaning");
  assert.equal(u.searchParams.get("offset"), "1000");
});

test("GeBIZ end to end: five awards give a median and range, window by award date", async () => {
  const now = new Date("2026-10-20T00:00:00Z");
  await withFetch(() => wrap([AGC, AGO, CCCS, MSF, CEA], 5), async () => {
    const a = await sgContracts({ what: "cleaning", months: 60, now });
    assert.equal(a.status, "ok");
    assert.equal(a.sample_size, 5);
    assert.equal((a.price as any).median, 260400); // median of 91080, 168000, 260400, 1200000, 5787623
    assert.match(a.summary, /Singapore/);
    const short = await sgContracts({ what: "cleaning", months: 12, now });
    assert.equal(short.status, "insufficient_data"); // only CEA (Sep 2025) is inside 12 months
  });
});

test("GeBIZ end to end: an agency filter narrows, fewer than five is insufficient_data", async () => {
  await withFetch(() => wrap([AGC, AGO, CCCS, MSF, CEA], 5), async () => {
    const a = await sgContracts({ what: "cleaning", buyer_area: "Council for Estate", months: 60, now: new Date("2026-10-20T00:00:00Z") });
    assert.equal(a.status, "insufficient_data");
    assert.equal(a.sample_size, 1);
    assert.equal(a.price, null);
  });
});

test("GeBIZ: a CPV code is the caller's mistake; licence text is the Singapore Open Data Licence", async () => {
  await assert.rejects(() => sgContracts({ what: "cleaning", cpv: "90910000", months: 12 }), InputError);
  assert.match(INFO.attribution, /Singapore Open Data Licence version 1\.0/);
});
