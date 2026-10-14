import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRequest, gbContracts, INFO, keywordFor, MIN_VALUE, parseNotices, REGION_NAMES, regionName, SEARCH_URL } from "./source";
import { InputError, SourceError } from "../../lib/http";
import { cpvStem } from "../../categories/contracts/purchases";

// Items copied from live Contracts Finder responses (POST https://www.contractsfinder.service.gov.uk/api/rest/2/search_notices/json,
// types Contract, statuses Awarded, keyword resurfacing), checked 2026-10-14. Only the fields the source reads are kept
// (description, organisation, supplier and the other fields are left out on purpose; suppliers are never named).
const SUB_NOTICE = { id: "dfa40e13-7b0a-424b-927a-5af26f927a63", parentId: "b6e04b53-8919-423c-afbb-265c66b6eb17", isSubNotice: true, noticeType: "Contract", noticeStatus: "Awarded", title: "12379 CRSTS Highway Capital Maintenance Programme 2024/25 - Carriageway Resurfacing Works (Bulk Tender Number 2)", awardedValue: 1034923.66, awardedDate: "2024-10-16T00:00:00+01:00", publishedDate: "2024-10-17T14:53:52+01:00", cpvCodes: "45233223", region: "North West" };
const SLIP_ROAD = { id: "9693df03-16b1-476f-8386-44752fbbf253", parentId: null, isSubNotice: false, noticeType: "Contract", noticeStatus: "Awarded", title: "621600 - Western IC entry slip road pavement - construction phase support", awardedValue: 231185.88, awardedDate: "2025-04-28T00:00:00+01:00", publishedDate: "2025-10-16T14:35:59+01:00", cpvCodes: "45233210", region: "North East" };
const BEESTON = { id: "2a5f8a33-d72a-4463-ac61-564aa22c81d6", parentId: null, isSubNotice: false, noticeType: "Contract", noticeStatus: "Awarded", title: "CPU 8610 Main Roads - Beeston Road Resurfacing Works", awardedValue: 254555.72, awardedDate: "2026-08-07T00:00:00+01:00", publishedDate: "2026-09-08T11:07:28+01:00", cpvCodes: "45000000", region: "North East,North West,Yorkshire and The Humber,East Midlands,West Midlands,East of England,London,South East,South West" };
const HOSPITAL_ROADS = { id: "0c0716a1-a58a-41d6-bbe4-7a25336539a1", parentId: null, isSubNotice: false, noticeType: "Contract", noticeStatus: "Awarded", title: "CGH and GHR Roads and Pathways Resurfacing", awardedValue: 760648.98, awardedDate: "2026-03-05T00:00:00Z", publishedDate: "2026-03-05T18:41:33Z", cpvCodes: "45233142", region: "North East,North West,Yorkshire and The Humber,East Midlands,West Midlands,East of England,London,South East,South West" };

const wrap = (items: any[], hitCount = items.length) => ({ hitCount, maxHits: 1000, noticeList: items.map((item, i) => ({ score: 1 - i / 100, item })) });

test("Contracts Finder: awarded notices become contracts with their award date and value", () => {
  const r = parseNotices(wrap([SUB_NOTICE, SLIP_ROAD, BEESTON, HOSPITAL_ROADS]));
  assert.equal(r.hitCount, 4);
  assert.deepEqual(r.awards.map((a) => [a.value, a.date]), [
    [1034923.66, "2024-10-16"],
    [231185.88, "2025-04-28"],
    [254555.72, "2026-08-07"],
    [760648.98, "2026-03-05"],
  ]);
});

test("Contracts Finder: with CPV groups only notices that carry their own code in the group count (parent codes do not)", () => {
  const road = parseNotices(wrap([SUB_NOTICE, SLIP_ROAD, BEESTON, HOSPITAL_ROADS]), ["45233142"]);
  assert.deepEqual(road.awards.map((a) => a.id), [HOSPITAL_ROADS.id]);
  assert.equal(road.other_product, 3); // BEESTON only carries the parent code 45000000
  // "45233210" is a user-typed code: its stem is the code itself
  assert.deepEqual(parseNotices(wrap([SUB_NOTICE, SLIP_ROAD]), [cpvStem("45233210")]).awards.map((a) => a.id), [SLIP_ROAD.id]);
  // a group stem covers everything below it
  assert.equal(parseNotices(wrap([SUB_NOTICE, SLIP_ROAD, HOSPITAL_ROADS]), ["45233"]).awards.length, 3);
});

test("Contracts Finder: a parent notice whose lots are also listed is not counted twice (derived: the parent is built from the real sub-notice's numbers)", () => {
  const parent = { ...SUB_NOTICE, id: SUB_NOTICE.parentId, parentId: null, isSubNotice: false, awardedValue: 2238000 };
  const r = parseNotices(wrap([parent, SUB_NOTICE, SLIP_ROAD]));
  assert.deepEqual(r.awards.map((a) => a.id), [SUB_NOTICE.id, SLIP_ROAD.id]);
  // a parent on its own (its lots are not in the results) stays
  assert.equal(parseNotices(wrap([parent, SLIP_ROAD])).awards.length, 2);
});

test("Contracts Finder: placeholder values and repeated notices are left out (derived from a real notice, value changed to 0.01)", () => {
  const placeholder = { ...HOSPITAL_ROADS, id: "derived-placeholder", awardedValue: 0.01 };
  const r = parseNotices(wrap([placeholder, SLIP_ROAD, SLIP_ROAD, { ...BEESTON, awardedValue: null }, { ...BEESTON, id: "derived-no-value", awardedValue: undefined }]));
  assert.deepEqual(r.awards.map((a) => a.id), [SLIP_ROAD.id]);
  assert.equal(MIN_VALUE, 100);
});

test("Contracts Finder: an unexpected response is a source error", () => {
  assert.throws(() => parseNotices({ message: "bad request" }), SourceError);
  assert.throws(() => parseNotices(null), SourceError);
});

test("Contracts Finder: several words are searched as a phrase, one word as it is", () => {
  assert.equal(keywordFor("road resurfacing"), '"road resurfacing"');
  assert.equal(keywordFor("resurfacing"), "resurfacing");
  assert.equal(keywordFor('  school "meals"  '), '"school meals"');
});

test("Contracts Finder: regions use the names the search knows, and unknown names are refused instead of silently ignored", () => {
  assert.equal(regionName("London"), "London");
  assert.equal(regionName("yorkshire"), "Yorkshire and The Humber");
  assert.equal(regionName("Yorkshire and Humber"), "Yorkshire and The Humber");
  assert.equal(regionName("East"), "East of England");
  assert.equal(regionName("north-west"), "North West");
  assert.equal(regionName("Narnia"), null);
  assert.equal(REGION_NAMES.length, 12);
});

test("Contracts Finder: the request is for awarded contracts in the window", () => {
  const slice = { from: "2024-10-14", to: "2026-10-14" };
  assert.deepEqual(buildRequest({ keyword: "resurfacing", region: "London" }, slice, 1000), {
    searchCriteria: {
      types: ["Contract"],
      statuses: ["Awarded"],
      awardedFrom: "2024-10-14T00:00:00",
      awardedTo: "2026-10-14T23:59:59",
      keyword: "resurfacing",
      regions: "London",
    },
    size: 1000,
  });
  const byCode = buildRequest({ cpv: "45233142", keyword: "ignored" }, slice, 1000) as any;
  assert.deepEqual(byCode.searchCriteria.cpvCodes, ["45233142"]);
  assert.equal("keyword" in byCode.searchCriteria, false);
  assert.equal(SEARCH_URL, "https://www.contractsfinder.service.gov.uk/api/rest/2/search_notices/json");
});

test("Contracts Finder: the licence is the Open Government Licence v3.0", () => {
  assert.equal(INFO.price_type, "contract_price");
  assert.match(INFO.licence, /Open Government Licence v3\.0/);
  assert.equal(INFO.licence_url, "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/");
  assert.match(INFO.attribution, /Contains public sector information licensed under the Open Government Licence v3\.0/);
});

async function withFetch(handler: (url: string, body: any) => any, run: () => Promise<void>): Promise<void> {
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any) => {
    const out = handler(String(url), JSON.parse(init.body));
    return new Response(JSON.stringify(out.body ?? out), { status: out.status ?? 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = real;
  }
}

/** Six notices: the real ones plus two synthetic copies with new ids (so the sample reaches the minimum of five). */
function sixNotices(): any[] {
  return [
    SUB_NOTICE, SLIP_ROAD, BEESTON, HOSPITAL_ROADS,
    { ...SLIP_ROAD, id: "synthetic-1", awardedValue: 310000, awardedDate: "2026-01-12T00:00:00Z" },
    { ...SLIP_ROAD, id: "synthetic-2", awardedValue: 95000, awardedDate: "2026-02-20T00:00:00Z" },
  ];
}

test("Contracts Finder end to end with a stubbed API: road resurfacing in the UK (one request for the whole window)", async () => {
  const seen: any[] = [];
  await withFetch(
    (_url, body) => {
      seen.push(body);
      return wrap(sixNotices());
    },
    async () => {
      const a = await gbContracts({ what: "road resurfacing", months: 24 });
      assert.equal(a.status, "ok");
      assert.equal(a.price_type, "contract_price");
      assert.equal(a.price?.currency, "GBP");
      assert.equal(a.sample_size, 6);
      assert.equal(a.source.id, "gb-contracts-finder");
      assert.match(a.summary, /not unit prices/);
      assert.match(a.summary, /Newest award used: 2026-08-07\.|newest matching award is from 2026-08-07/); // which one depends on today's date
      assert.equal(a.extra?.newest_award_used, "2026-08-07");
      assert.equal(a.extra?.slices, 1);
    },
  );
  assert.equal(seen.length, 1);
  assert.equal(seen[0].searchCriteria.keyword, "resurfacing"); // the single distinctive word, not the OR-ed phrase
  assert.equal(seen[0].size, 1000);
});

test("Contracts Finder end to end with a stubbed API: a region filter is sent and explained, more than 1000 hits are read in slices", async () => {
  const seen: any[] = [];
  let n = 0;
  await withFetch(
    (_url, body) => {
      seen.push(body);
      n++;
      // The whole-window call reports 1500 hits; each slice returns three notices with fresh ids.
      if (seen.length === 1) return wrap([SLIP_ROAD], 1500);
      return wrap(
        [1, 2, 3].map((k) => ({ ...SLIP_ROAD, id: `synthetic-${n}-${k}`, awardedValue: 100000 * k })),
        800,
      );
    },
    async () => {
      const a = await gbContracts({ what: "laptops", buyer_area: "London", months: 24 });
      assert.equal(a.status, "ok");
      assert.match(a.summary, /London/);
      assert.match(a.summary, /nationwide contracts/);
      assert.equal(a.extra?.slices, 12);
      assert.equal(a.sample_size, 36);
    },
  );
  assert.equal(seen.length, 13);
  assert.equal(seen[0].searchCriteria.keyword, "laptop");
  assert.equal(seen[0].searchCriteria.regions, "London");
});

test("Contracts Finder end to end: a cpv code filters on each notice's own codes, fewer than five awards is insufficient_data", async () => {
  await withFetch(
    () => wrap([SLIP_ROAD, SUB_NOTICE, BEESTON, HOSPITAL_ROADS]),
    async () => {
      const a = await gbContracts({ what: "anything", cpv: "45233210", months: 12 });
      assert.equal(a.status, "insufficient_data");
      assert.equal(a.price, null);
      assert.equal(a.sample_size, 1);
    },
  );
});

test("Contracts Finder: a bad region or code is the caller's mistake", async () => {
  await assert.rejects(() => gbContracts({ what: "laptops", buyer_area: "Narnia", months: 12 }), InputError);
  await assert.rejects(() => gbContracts({ what: "laptops", cpv: "3021", months: 12 }), InputError);
  await assert.rejects(() => gbContracts({ what: "laptops", cpv: "x", months: 12 }), InputError);
});
