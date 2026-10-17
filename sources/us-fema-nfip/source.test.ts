import { test } from "node:test";
import assert from "node:assert/strict";
import { InputError } from "../../lib/http";
import { buildUrl, femaNfip, INFO, parseArea, parsePolicies, sampleSkips, totalCount, windowStart } from "./source";

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

test("femaNfip: fewer than 5 policies gives no figure", async () => {
  const a = await femaNfip({ area: "32935", fetcher: async () => ({ metadata: { count: 3 }, NfipPolicies: BODY.NfipPolicies.slice(0, 3) }) });
  assert.equal(a.status, "insufficient_data");
  assert.equal(a.price, null);
});

test("femaNfip: median and range from real rows, no row-level data in the answer", async () => {
  const a = await femaNfip({ area: "32935", now: new Date("2026-10-17T00:00:00Z"), fetcher: async () => BODY });
  assert.equal(a.status, "ok");
  assert.equal(a.price!.currency, "USD");
  assert.equal(a.price!.median, 652);
  assert.equal(a.sample_size, 6);
  assert.equal(a.period.from, "2025-10-02");
  assert.equal((a.extra as any).sampled, false);
  assert.equal((a.extra as any).premium_only.median, 492);
  assert.ok(!JSON.stringify(a).includes("reportedZipCode"));
});

test("femaNfip: big area is sampled with spread pages", async () => {
  const urls: string[] = [];
  const a = await femaNfip({ area: "TX", fetcher: async (u) => { urls.push(u); return { metadata: { count: 413590 }, NfipPolicies: BODY.NfipPolicies }; } });
  assert.equal(urls.length, 4);
  assert.equal((a.extra as any).sampled, true);
  assert.equal(a.sample_size, 24);
});
