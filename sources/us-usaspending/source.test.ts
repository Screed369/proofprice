import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFilters, classifyUsCode, INFO, MIN_VALUE, parseAwards, PER_SLICE, STATES, stateCode, usContracts } from "./source";
import { InputError, SourceError } from "../../lib/http";

// Rows copied from live USAspending responses (POST https://api.usaspending.gov/api/v2/search/spending_by_award/, award types A B C D,
// fields Award Amount, Start Date, Base Obligation Date, Description), checked 2026-10-14. Note the first row: its work starts on 2026-12-04,
// after the date it was first obligated (2026-09-30), which is why the source dates awards by Base Obligation Date.
const LAPTOP_ROWS = [
  { internal_id: 363217725, "Award Amount": 64466.7, "Start Date": "2026-12-04", "Base Obligation Date": "2026-09-30", Description: "LAPTOPS AND PERIPHERALS", generated_internal_id: "CONT_AWD_9531BM26F0063_9508_47QTCA22A000C_4732" },
  { internal_id: 362253815, "Award Amount": 4712, "Start Date": "2026-11-16", "Base Obligation Date": "2026-09-15", Description: "LAPTOPS - HP", generated_internal_id: "CONT_AWD_15B30826F00000101_1540_NNG15SD28B_8000" },
  { internal_id: 361344465, "Award Amount": 7068, "Start Date": "2026-10-16", "Base Obligation Date": "2026-08-14", Description: "FY26 M2 ALPHASIX LAPTOPS AUG 26", generated_internal_id: "CONT_AWD_15B40626F00000217_1540_NNG15SD28B_8000" },
  { internal_id: 363309759, "Award Amount": 40.75, "Start Date": "2026-10-07", "Base Obligation Date": "2026-10-07", Description: "RISER,LAPTOP", generated_internal_id: "CONT_AWD_47QSSC27F07LV_4732_GS03FDA044_4732" },
  { internal_id: 363257701, "Award Amount": 0, "Start Date": "2026-10-06", "Base Obligation Date": "2026-10-06", Description: "7025-00-NIB-0023 MONITOR, PORTABLE, BLACK, 15 IN - 17 IN LAPTOPS", generated_internal_id: "CONT_AWD_47QSSC27P048B_4732_-NONE-_-NONE-" },
  { internal_id: 363217391, "Award Amount": 39850.09, "Start Date": "2026-10-06", "Base Obligation Date": "2026-10-06", Description: "THE PURPOSE OF THIS REQUEST IS TO REPLACE 16 NON-COMPLIANT AND/OR END OF LIFE (EOL) COMPUTERS AND LAPTOPS FOR THE LAKE GUARDIAN RESEARCH VESSEL.", generated_internal_id: "CONT_AWD_68HE0527F0002_6800_NNG15SC06B_8000" },
  { internal_id: 362663558, "Award Amount": 21931770.66, "Start Date": "2026-09-24", "Base Obligation Date": "2026-09-23", Description: "THIS INFORMATION TECHNOLOGY CLIENT DEVICE REFRESH BLANKET PURCHASE AGREEMENT CALL PROVIDES ICE THE DELIVERY OF LAPTOPS, TABLETS, DESKTOPS, MONITORS & ACCESSORIES", generated_internal_id: "CONT_AWD_70CTD026FC0000041_7012_70CTD023A00000001_7012" },
  { internal_id: 362505287, "Award Amount": 16516990.76, "Start Date": "2026-09-16", "Base Obligation Date": "2026-09-16", Description: "PURCHASE LAPTOPS, DESKTOPS, ADVANCED COMPUTING, MONITOR, AND DOCKS", generated_internal_id: "CONT_AWD_7571TE26F80295_7571_47QTCA22A000C_4732" },
  { internal_id: 363129176, "Award Amount": 10674042.61, "Start Date": "2026-09-30", "Base Obligation Date": "2026-09-30", Description: "DISTRIBUTE APPROXIMATELY 6,000 LAPTOPS TO DIRECT SERVICE COMPONENT THAT PROVIDE SERVICES TO THE PUBLIC.", generated_internal_id: "CONT_AWD_28321326FA0010230_2800_28321326A00040001_2800" },
];
// Real road rows, work in Virginia (PSC Z2LB and keyword "paving").
const ROAD_ROWS = [
  { internal_id: 361774933, "Award Amount": 1639765, "Start Date": "2026-08-25", "Base Obligation Date": "2026-08-25", Description: "PROJECT VA ERFO COE 2020-1(1): ASPHALT PAVEMENT REMOVAL, GRADING, AGGREGATE BASE, ASPHALT CONCRETE PAVING", generated_internal_id: "CONT_AWD_693C7326F00087N_6925_693C7326D000002_6925" },
  { internal_id: 361904121, "Award Amount": 535844.08, "Start Date": "2026-09-04", "Base Obligation Date": "2026-08-31", Description: "FY26-016032 GLEN ALTON TRAIL AND ROAD REPAIRS ED RANGER DISTRICT", generated_internal_id: "CONT_AWD_12445126F0032_12C2_140F0822D0002_1448" },
  { internal_id: 357448744, "Award Amount": 465674.29, "Start Date": "2026-01-26", "Base Obligation Date": "2026-01-26", Description: "FY26 CONSOLIDATED PAVING", generated_internal_id: "CONT_AWD_N4008526F0304_9700_N4008524D0062_9700" },
  { internal_id: 355907994, "Award Amount": 1864676.74, "Start Date": "2026-03-10", "Base Obligation Date": "2026-03-10", Description: "SHENANDOAH NATIONAL PARK (SHEN) - REPAIR BIG MEADOWS CAMPGROUND ACCESS ROUTES", generated_internal_id: "CONT_AWD_140P4226C0002_1443_-NONE-_-NONE-" },
  { internal_id: 353939739, "Award Amount": 664427.38, "Start Date": "2025-09-30", "Base Obligation Date": "2025-09-29", Description: "BASE-WIDE SIGN REPLACEMENT", generated_internal_id: "CONT_AWD_FA480025F0184_9700_FA480021D0001_9700" },
];

test("USAspending: awards are dated by the day first obligated, and token amounts (0, $40) are left out", () => {
  const out = parseAwards({ results: LAPTOP_ROWS.slice(0, 6), meta: { page: 1, hasNext: true } });
  assert.deepEqual(out.map((a) => [a.id, a.amount, a.date]), [
    ["363217725", 64466.7, "2026-09-30"],
    ["362253815", 4712, "2026-09-15"],
    ["361344465", 7068, "2026-08-14"],
    ["363217391", 39850.09, "2026-10-06"],
  ]);
  assert.equal(MIN_VALUE, 100);
  assert.equal(parseAwards({ results: [] }).length, 0);
});

test("USAspending: an unexpected response is a source error, not an empty answer", () => {
  assert.throws(() => parseAwards({ detail: "Invalid" }), SourceError);
  assert.throws(() => parseAwards(null), SourceError);
});

test("USAspending: filters for keyword, PSC, NAICS and state", () => {
  const slice = { from: "2025-10-01", to: "2025-10-31" };
  const k = buildFilters({ keywords: "laptop" }, slice);
  assert.deepEqual(k, {
    award_type_codes: ["A", "B", "C", "D"],
    time_period: [{ start_date: "2025-10-01", end_date: "2025-10-31", date_type: "new_awards_only" }],
    keywords: ["laptop"],
  });
  const psc = buildFilters({ psc: "Z2LB", state: "VA" }, slice, false);
  assert.deepEqual(psc.psc_codes, ["Z2LB"]);
  assert.deepEqual(psc.place_of_performance_locations, [{ country: "USA", state: "VA" }]);
  assert.deepEqual(psc.time_period, [{ start_date: "2025-10-01", end_date: "2025-10-31" }]);
  assert.equal("keywords" in psc, false);
  assert.deepEqual(buildFilters({ naics: "334111" }, slice).naics_codes, ["334111"]);
});

test("USAspending: state names and codes", () => {
  assert.equal(stateCode("Virginia"), "VA");
  assert.equal(stateCode(" va "), "VA");
  assert.equal(stateCode("District of Columbia"), "DC");
  assert.equal(stateCode("new york"), "NY");
  assert.equal(stateCode("Ontario"), null);
  assert.equal(stateCode(""), null);
  assert.ok(Object.keys(STATES).length >= 51);
});

test("USAspending: PSC and NAICS codes are told apart", () => {
  assert.deepEqual(classifyUsCode("7010"), { psc: "7010" });
  assert.deepEqual(classifyUsCode("Z2LB"), { psc: "Z2LB" });
  assert.deepEqual(classifyUsCode("psc:z2lb"), { psc: "Z2LB" });
  assert.deepEqual(classifyUsCode("naics:334111"), { naics: "334111" });
  assert.deepEqual(classifyUsCode("334111"), { naics: "334111" });
  assert.equal(classifyUsCode("30213100"), null); // a CPV code is not a US code
  assert.equal(classifyUsCode("laptops"), null);
});

test("USAspending: licence is quoted as 'not stated' with the official URL", () => {
  assert.equal(INFO.price_type, "contract_price");
  assert.match(INFO.licence, /No licence is stated/);
  assert.equal(INFO.licence_url, "https://www.usaspending.gov/");
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

/** A stand-in for the API: every slice gets the real rows again under fresh ids (synthetic ids, real amounts and dates). */
function fakeApi(rows: any[], seen: { url: string; body: any }[]) {
  let n = 0;
  return (url: string, body: any) => {
    seen.push({ url, body });
    if (url.includes("spending_by_award_count")) return { results: { contracts: 458, idvs: 0, grants: 0 } };
    n++;
    return { results: rows.map((r) => ({ ...r, internal_id: r.internal_id + n * 1000000 })), page_metadata: { page: 1, hasNext: true } };
  };
}

test("USAspending end to end with a stubbed API: laptops across the United States", async () => {
  const seen: { url: string; body: any }[] = [];
  await withFetch(fakeApi(LAPTOP_ROWS, seen), async () => {
    const a = await usContracts({ what: "laptops", months: 24 });
    assert.equal(a.status, "ok");
    assert.equal(a.price_type, "contract_price");
    assert.equal(a.price?.currency, "USD");
    assert.equal(a.price?.unit, "per contract (lot), total awarded value");
    assert.equal(a.source.id, "us-usaspending");
    assert.match(a.summary, /not unit prices/);
    assert.match(a.summary, /United States/);
    assert.equal(a.extra?.awards_matching, 458);
    assert.ok((a.sample_size ?? 0) >= 5);
    // 9 real rows per slice, 2 of them under 100 dollars -> 7 per slice; the same rows in every slice have different (synthetic) ids.
    assert.equal(a.sample_size, 7 * (a.extra?.slices as number));
    assert.equal(a.period.to, new Date().toISOString().slice(0, 10));
  });
  const calls = seen.filter((s) => !s.url.includes("_count"));
  assert.equal(calls.length, 12);
  assert.equal(calls[0].body.sort, "Base Obligation Date");
  assert.equal(calls[0].body.limit, PER_SLICE);
  assert.deepEqual(calls[0].body.filters.keywords, ["laptop"]);
  assert.equal(calls[0].body.filters.time_period[0].date_type, "new_awards_only");
  assert.ok(seen.some((s) => s.url.endsWith("/spending_by_award_count/")));
});

test("USAspending end to end with a stubbed API: road resurfacing uses the PSC and the state", async () => {
  const seen: { url: string; body: any }[] = [];
  await withFetch(fakeApi(ROAD_ROWS, seen), async () => {
    const a = await usContracts({ what: "road resurfacing", buyer_area: "Virginia", months: 12 });
    assert.equal(a.status, "ok");
    assert.match(a.summary, /Virginia/);
    assert.match(a.method, /PSC\) Z2LB/);
  });
  const first = seen.find((s) => !s.url.includes("_count"))!;
  assert.deepEqual(first.body.filters.psc_codes, ["Z2LB"]);
  assert.equal("keywords" in first.body.filters, false);
  assert.deepEqual(first.body.filters.place_of_performance_locations, [{ country: "USA", state: "VA" }]);
});

test("USAspending end to end: a refused 'new awards only' period is repeated with the default, and too few awards is insufficient_data", async () => {
  let refused = 0;
  await withFetch(
    (url, body) => {
      if (url.includes("_count")) return { results: { contracts: 3 } };
      if (body.filters.time_period[0].date_type) {
        refused++;
        return { status: 422, body: { detail: "bad date_type" } };
      }
      return { results: LAPTOP_ROWS.slice(0, 3).map((r) => ({ ...r, internal_id: Math.random() })) };
    },
    async () => {
      const a = await usContracts({ what: "laptops", months: 1 });
      assert.ok(refused >= 1);
      assert.equal(a.status, "insufficient_data");
      assert.equal(a.price, null);
    },
  );
});

test("USAspending: a bad buyer_area or code is the caller's mistake", async () => {
  await assert.rejects(() => usContracts({ what: "laptops", buyer_area: "Ontario", months: 12 }), InputError);
  await assert.rejects(() => usContracts({ what: "laptops", cpv: "30213100", months: 12 }), InputError);
});

test("USAspending: a missing, empty, text or negative (de-obligated) amount is never counted as a price", () => {
  const rows = [
    { internal_id: 1, "Award Amount": null, "Base Obligation Date": "2026-01-01" },
    { internal_id: 2, "Award Amount": "", "Base Obligation Date": "2026-01-01" },
    { internal_id: 3, "Award Amount": "n/a", "Base Obligation Date": "2026-01-01" },
    { internal_id: 4, "Award Amount": -5000, "Base Obligation Date": "2026-01-01" },
    { internal_id: 5, "Base Obligation Date": "2026-01-01" },
    { internal_id: 6, "Award Amount": 2500, "Base Obligation Date": "2026-01-01" },
  ];
  assert.deepEqual(parseAwards({ results: rows }).map((a) => [a.id, a.amount]), [["6", 2500]]);
});
