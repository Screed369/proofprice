// Tests for Canada rents (CMHC Rental Market Survey, Statistics Canada table 34-10-0133-01). Fixtures are real WDS replies captured on 2026-10-14.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeWds } from "../_ca-statcan/fake-wds";
import { RENT_DATA, RENT_META } from "./fixtures";
import { CMHC_LICENCE_URL, INFO, caRent, caRentHarvest, caRentMethod, rentHistoryKey } from "./source";
import manifest from "./index";

const TODAY = new Date("2026-10-14T12:00:00Z");
const calls: { path: string; body: unknown }[] = [];
const ask = (o: Parameters<typeof caRent>[0]) => caRent(o, fakeWds({ meta: RENT_META, data: RENT_DATA, calls }), TODAY);

test("Toronto two bedrooms: the October 2025 average in CAD a month, with the change on the year before", async () => {
  calls.length = 0;
  const a = await ask({ town: "Toronto", bedrooms: 2 });
  assert.equal(a.status, "ok");
  assert.equal(a.price?.value, 2045);
  assert.equal(a.price?.currency, "CAD");
  assert.equal(a.price?.unit, "per month");
  assert.equal(a.price?.measure, "average");
  assert.equal(a.price?.median, null);
  assert.equal(a.price?.typical_low, null);
  assert.equal(a.sample_size, null);
  assert.equal(a.price_type, "official_statistic");
  assert.deepEqual(a.period, { from: "2025-10-01", to: "2025-10-31" });
  assert.equal(a.statistic?.reference_period, "2025-10");
  const x = a.extra as any;
  assert.equal(x.change_on_previous_survey.survey_month, "2024-10");
  assert.equal(x.sizes.length, 4);
  assert.match(a.summary, /two-bedroom units/);
  assert.match(a.summary, /Official average published by Canada Mortgage and Housing Corporation/);
  assert.match(x.attribution_notice, /^Source: Canada Mortgage and Housing Corporation \(CMHC\), .*, October 2025\. This information is reproduced and distributed on an "as is" basis with the permission of CMHC\./);
  assert.match(x.attribution_notice, /does not constitute an endorsement by Canada Mortgage and Housing Corporation of this product\.$/);
  const dataCall = calls.find((c) => c.path === "getDataFromCubePidCoordAndLatestNPeriods")!;
  assert.equal((dataCall.body as any[]).length, 4, "one batch for the four unit sizes");
});

test("the rows-and-apartments total is the default; apartment means apartment buildings only", async () => {
  const any = await ask({ town: "Toronto", bedrooms: 2 });
  const apt = await ask({ town: "Toronto", bedrooms: 2, property_type: "apartment" });
  assert.equal(any.price?.value, 2045);
  assert.equal(apt.price?.value, 2046);
  assert.equal((apt.query as any).property_type, "apartment");
});

test("no bedrooms asked: two-bedroom headline, said plainly; bachelor and 3+ are read from their own series", async () => {
  const a = await ask({ town: "Toronto" });
  assert.equal(a.price?.value, 2045);
  assert.match(a.statistic?.note ?? "", /No unit size was asked for/);
  const b = await ask({ town: "Toronto", bedrooms: 0 });
  assert.equal(b.price?.value, 1491);
  const c = await ask({ town: "Toronto", bedrooms: 5 });
  assert.equal(c.price?.value, 2294);
  assert.match(c.statistic?.note ?? "", /three bedrooms or more/);
});

test("Ottawa is answered with the Ontario part of Ottawa-Gatineau and says so", async () => {
  const a = await ask({ town: "Ottawa", bedrooms: 1 });
  assert.equal(a.status, "ok");
  assert.equal((a.query as any).town, "Ottawa-Gatineau, Ontario part, Ontario/Quebec");
  assert.match(a.statistic?.note ?? "", /'Ottawa' is covered by the area/);
});

test("an area CMHC no longer surveys (blank in every year) is no_matches with a plain sentence, not an error", async () => {
  const none = await ask({ town: "Carbonear", bedrooms: 2 });
  assert.equal(none.status, "no_matches");
  assert.equal(none.price, null);
  assert.match(none.summary, /CMHC publishes no recent average rent/);
});

test("old data is flagged plainly 18 or more months after the survey", async () => {
  const late = await caRent({ town: "Toronto", bedrooms: 2 }, fakeWds({ meta: RENT_META, data: RENT_DATA }), new Date("2027-05-14T12:00:00Z"));
  assert.match(late.statistic?.note ?? "", /Old data: the newest figure is from October 2025, 19 months ago/);
  const fresh = await ask({ town: "Toronto", bedrooms: 2 });
  assert.doesNotMatch(fresh.statistic?.note ?? "", /Old data/);
});

test("bad input: no town, houses, rooms, an unknown place, a province", async () => {
  await assert.rejects(ask({}), /town is required/);
  await assert.rejects(ask({ town: "Toronto", property_type: "house" }), /apartments and rows of three or more units only/);
  await assert.rejects(ask({ town: "Toronto", property_type: "room" }), /not houses or rooms/);
  await assert.rejects(ask({ town: "Atlantis" }), /is not a place in this table/);
  await assert.rejects(ask({ town: "Ontario" }), /is a province or territory/);
});

test("a changed table layout is a SourceError that names the table", async () => {
  const broken = JSON.parse(JSON.stringify(RENT_META));
  broken[0].object.dimension[2].member = broken[0].object.dimension[2].member.filter((m: any) => !/Two bedroom/.test(m.memberNameEn));
  await assert.rejects(caRent({ town: "Toronto" }, fakeWds({ meta: broken, data: RENT_DATA }), TODAY), /changed table 34-10-0133-01 \(no unit type "Two bedroom units"\)/);
});

test("manifest: rent tool, CA, first example is the smoke test, CMHC licence is quoted with its URL", () => {
  assert.equal(manifest.category, "rent");
  assert.deepEqual(manifest.countries, ["CA"]);
  assert.equal(manifest.examples[0].params.town, "Toronto");
  assert.equal(manifest.examples[0].params.bedrooms, "2");
  assert.equal(INFO.licence_url, CMHC_LICENCE_URL);
  assert.match(INFO.licence, /use, reproduce, publish, freely distribute, or sell the Information/);
  assert.match(INFO.attribution, /reproduced and distributed on an "as is" basis with the permission of CMHC/);
  assert.match(caRentMethod(), /not the asking rent of a vacant unit/);
});

// ---------- daily copy (stale-if-error) ----------

test("harvest: the newest survey's averages by area, structure and size, the same figure as the live answer, no made-up count", async () => {
  const h = await caRentHarvest(fakeWds({ meta: RENT_META, data: RENT_DATA }));
  assert.equal(h.date, "2025-10-31");
  assert.equal(h.currency, "CAD");
  assert.equal(h.unit, "per month");
  const toronto = h.rows.find((r) => r.area.startsWith("Toronto") && r.item === "rows and apartments of three or more units, two-bedroom")!;
  assert.ok(toronto, "Toronto two-bedroom row");
  assert.equal(toronto.median, 2045);
  assert.ok(Number.isNaN(toronto.n), "official statistic: n is NO_COUNT");
  assert.equal(toronto.low, toronto.high);
  assert.ok(h.rows.every((r) => r.median > 0));
});

test("history key: the town resolves to the library area, size and structure pick the item, a house or an unknown town gives null", () => {
  const areas = ["Toronto, Ontario", "Vancouver, British Columbia", "Calgary, Alberta"];
  const k = rentHistoryKey({ town: "Toronto", bedrooms: 2 }, areas)!;
  assert.equal(k.area, "Toronto, Ontario");
  assert.equal(k.item, "rows and apartments of three or more units, two-bedroom");
  assert.equal(rentHistoryKey({ town: "Vancouver", property_type: "apartment", bedrooms: 1 }, areas)!.item, "apartment buildings of three or more units, one-bedroom");
  assert.equal(rentHistoryKey({ town: "Calgary" }, areas)!.item, "rows and apartments of three or more units, two-bedroom");
  assert.equal(rentHistoryKey({ town: "Calgary", bedrooms: 5 }, areas)!.item, "rows and apartments of three or more units, three-bedroom (or larger)");
  assert.equal(rentHistoryKey({ town: "Toronto", property_type: "house" }, areas), null);
  assert.equal(rentHistoryKey({ town: "Nowhereville" }, areas), null);
  assert.equal(rentHistoryKey({}, areas), null);
});

test("the manifest declares the daily copy for stale-if-error", () => {
  assert.ok(manifest.harvest && manifest.historyKey && manifest.referenceDates && manifest.nominalCounts);
});
