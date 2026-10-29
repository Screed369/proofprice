import { test } from "node:test";
import assert from "node:assert/strict";
import { InputError } from "../../lib/http";
import { buildUrl, femaNfip, narrowSlice, quarterSlices, INFO, parseArea, parsePolicies, sampleSkips, totalCount, windowStart } from "./source";

// Fixture: real rows from the OpenFEMA v3 NfipPolicies API, ZIP 32935 (FL), captured 2026-10-17 (count 908 policies since 2025-10-01).
const REAL = (cost: number, prem: number, date: string, extra: Record<string, unknown> = {}) => ({
  policyCost: cost, totalInsurancePremiumOfThePolicy: prem, policyCount: 1, policyTermIndicator: 1, occupancyType: 11,
  policyEffectiveDate: `${date}T00:00:00.000Z`, asOfDate: "2026-09-08T00:00:00.000Z", ...extra,
});
const BODY = {
  metadata: { count: 908, entityname: "NfipPolicies", version: "v3" },
  NfipPolicies: [REAL(992, 780, "2025-10-19"), REAL(555, 409, "2025-10-14"), REAL(969, 760, "2025-10-05"), REAL(684, 519, "2025-10-02"), REAL(620, 464, "2025-10-17"), REAL(596, 444, "2025-12-30")],
};

test("us-fema-nfip: licence and type", () => {
  assert.equal(INFO.id, "us-fema-nfip");
  assert.match(INFO.licence, /U\.S\. Government Works/);
  assert.match(INFO.licence_url, /^https:\/\//);
  assert.match(INFO.attribution, /not an official FEMA or federal report/);
});

test("parseArea: zip, zip+4, state, junk", () => {
  assert.deepEqual(parseArea("32935"), { kind: "zip", value: "32935", field: "reportedZipCode" });
  assert.equal(parseArea("32935-1234").value, "32935");
  assert.deepEqual(parseArea("tx"), { kind: "state", value: "TX", field: "propertyState" });
  assert.throws(() => parseArea("ZZ"), InputError);
  assert.throws(() => parseArea("Florida"), InputError);
  assert.throws(() => parseArea(undefined), InputError);
});

test("buildUrl: filter, select, top, count", () => {
  const u = new URL(buildUrl(parseArea("32935"), "2025-10-17", { count: true }));
  assert.equal(u.searchParams.get("$filter"), "reportedZipCode eq '32935' and policyEffectiveDate ge '2025-10-17'");
  assert.equal(u.searchParams.get("$top"), "1000");
  assert.equal(u.searchParams.get("$count"), "true");
  assert.match(u.searchParams.get("$select")!, /policyCost/);
});

test("windowStart: twelve months back", () => {
  assert.equal(windowStart(new Date("2026-10-17T10:00:00Z")), "2025-10-17");
});

test("parsePolicies: drops multi-policy rows, multi-year terms, zero costs and renewals dated after the as-of date", () => {
  const body = { NfipPolicies: [...BODY.NfipPolicies, REAL(5000, 4000, "2026-01-01", { policyCount: 3 }), REAL(900, 700, "2026-01-01", { policyTermIndicator: 3 }), REAL(0, 0, "2026-01-01"), REAL(800, 600, "2026-12-22")] };
  const p = parsePolicies(body);
  assert.equal(p.length, 6);
  assert.equal(p[0].cost, 992);
  assert.equal(p[0].effective, "2025-10-19");
  assert.equal(totalCount(BODY), 908);
});

test("sampleSkips: none for small areas, spread for big ones", () => {
  assert.deepEqual(sampleSkips(908), []);
  const s = sampleSkips(413590);
  assert.equal(s.length, 3);
  assert.ok(s[0] > 0 && s[2] < 413590 - 1000 + 1);
});

test("quarterSlices: four consecutive bounded slices that cover the window", () => {
  const q = quarterSlices("2025-10-18", "2026-10-18");
  assert.equal(q.length, 4);
  assert.equal(q[0].from, "2025-10-18");
  assert.equal(q[3].until, "2026-10-19");
  for (let i = 1; i < 4; i++) assert.equal(q[i].from, q[i - 1].until);
});

test("narrowSlice: whole slice when it fits a page, a narrow middle slice for big ones", () => {
  const sl = { from: "2025-10-18", until: "2026-01-18" };
  assert.deepEqual(narrowSlice(sl, 900), sl);
  const n = narrowSlice(sl, 125000); // ~92 days, 125k policies -> 1 day
  assert.ok(n.from >= sl.from && n.until <= sl.until && n.from < n.until);
  const mid = narrowSlice(sl, 3000); // ~24 days
  assert.ok(Date.parse(mid.until) - Date.parse(mid.from) > 10 * 86400000);
});

// Fake FEMA: a count request ($top=1) answers metadata only; a row request answers the given rows. Every call must carry both date bounds.
const fake = (count: number, rows: unknown[], urls: string[] = []) => async (u: string) => {
  urls.push(u);
  const d = decodeURIComponent(u);
  assert.ok(d.includes("policyEffectiveDate ge") && d.includes("policyEffectiveDate lt"), "both date bounds on every call");
  assert.ok(!d.includes("$skip"), "no deep $skip paging");
  return { metadata: { count }, NfipPolicies: rows };
};

test("femaNfip: fewer than 5 policies gives no figure", async () => {
  const a = await femaNfip({ area: "32935", fetcher: fake(1, BODY.NfipPolicies.slice(0, 1)) });
  assert.equal(a.status, "insufficient_data");
  assert.equal(a.price, null);
});

test("femaNfip: a ZIP is read in full from four quarterly slices, median and range from real rows, no row-level data in the answer", async () => {
  const urls: string[] = [];
  const a = await femaNfip({ area: "32935", now: new Date("2026-10-17T00:00:00Z"), fetcher: fake(227, BODY.NfipPolicies, urls) });
  assert.equal(urls.length, 4); // one bounded request per quarter, each already complete
  assert.equal(a.status, "ok");
  assert.equal(a.price!.currency, "USD");
  assert.equal(a.price!.median, 652);
  assert.equal(a.sample_size, 24);
  assert.equal((a.extra as any).policies_in_period, 908);
  assert.equal((a.extra as any).sampled, false);
  assert.equal((a.extra as any).premium_only.median, 492);
  assert.ok(!JSON.stringify(a).includes("reportedZipCode"));
});

test("femaNfip: big area is sampled with narrow date slices, never deep $skip", async () => {
  const urls: string[] = [];
  const a = await femaNfip({ area: "TX", fetcher: fake(1300, BODY.NfipPolicies, urls) });
  assert.equal(urls.length, 8); // 8 single-day windows, no whole-quarter request
  for (const u of urls) { const d = decodeURIComponent(u); const m = /ge '(\d{4}-\d{2}-\d{2})' and policyEffectiveDate lt '(\d{4}-\d{2}-\d{2})'/.exec(d)!; assert.equal((Date.parse(m[2]) - Date.parse(m[1])) / 86400000, 1); }
  assert.equal((a.extra as any).sampled, true);
  assert.ok(urls.every((u) => !u.includes("$count")), "no $count on a state");
  assert.equal((a.extra as any).policies_in_period, undefined);
  assert.equal(a.sample_size, 48);
});
