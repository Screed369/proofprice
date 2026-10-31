import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSgUrl, parseSgRecords, fetchWithBackoff } from "./source";

test("SG url and records parse (shape seen on data.gov.sg)", () => {
  const url = new URL(buildSgUrl("tampines", "4 room"));
  const filters = JSON.parse(url.searchParams.get("filters")!);
  assert.deepEqual(filters, { town: "TAMPINES", flat_type: "4 ROOM" });
  assert.equal(url.searchParams.get("sort"), "month desc,_id desc");
  const recs = parseSgRecords({
    success: true,
    result: { records: [
      { _id: 1, month: "2026-08", town: "TAMPINES", flat_type: "4 ROOM", floor_area_sqm: "92", resale_price: "615000" },
      { _id: 2, month: "2026-07", town: "TAMPINES", flat_type: "4 ROOM", floor_area_sqm: "93", resale_price: 640000 },
    ] },
  });
  assert.equal(recs.length, 2);
  assert.equal(recs[0].price, 615000);
});

// SYNTHETIC portal in the live record shape: `perMonth` Tampines resales a month for 2025-06 .. 2026-10, served newest first, page by page.
function fakePortal(perMonth: number) {
  const records: Record<string, any>[] = [];
  let id = 1;
  for (let y = 2025, m = 6; y < 2026 || m <= 10; ) {
    const month = `${y}-${String(m).padStart(2, "0")}`;
    for (let i = 0; i < perMonth; i++) records.push({ _id: id++, month, town: "TAMPINES", flat_type: "4 ROOM", floor_area_sqm: "92", resale_price: String(500000 + (i % 10) * 10000) });
    if (++m > 12) { m = 1; y++; }
  }
  records.reverse();
  const calls: string[] = [];
  const fetcher = async (url: string) => {
    calls.push(url);
    const u = new URL(url);
    const limit = Number(u.searchParams.get("limit"));
    const offset = Number(u.searchParams.get("offset") ?? 0);
    return { success: true, result: { records: records.slice(offset, offset + limit) } };
  };
  return { fetcher, calls };
}

test("sgHomeSales pages past 1 000 resales so the 12-month window is whole (was cut at 1 000 rows)", async () => {
  const { sgHomeSales } = await import("./source");
  const { fetcher, calls } = fakePortal(150); // 1 800 resales in 12 months
  const a = await sgHomeSales({ town: "Tampines", months: 12 }, fetcher, new Date("2026-10-14T00:00:00Z"));
  assert.equal(a.status, "ok");
  assert.deepEqual(a.period, { from: "2025-11", to: "2026-10" });
  assert.equal(a.sample_size, 12 * 150);
  assert.ok(calls.length >= 2);
  assert.match(a.summary, /^HDB resale flats in TAMPINES \(all flat types\) sold for a median of SGD/);
  assert.match(a.summary, /10th–90th percentile range/);
  assert.equal((a.extra as any).capped, undefined);
});

test("sgHomeSales: above the 5 000 cap only whole recent months are used, and the summary says so", async () => {
  const { sgHomeSales, MAX_ROWS } = await import("./source");
  const { fetcher } = fakePortal(700); // 8 400 resales in 12 months
  const a = await sgHomeSales({ town: "Tampines", months: 12 }, fetcher, new Date("2026-10-14T00:00:00Z"));
  // 5 000 newest = 7 whole months (2026-04..2026-10, 4 900) + 100 of 2026-03, which is dropped as partial.
  assert.deepEqual(a.period, { from: "2026-04", to: "2026-10" });
  assert.equal(a.sample_size, 7 * 700);
  assert.ok(a.sample_size! < MAX_ROWS);
  assert.match(a.summary, /Only the most recent whole months \(2026-04 to 2026-10\) are used/);
  assert.match(String((a.extra as any).capped), /more than 5,000 resales/);
});

test("SG parse: empty or 'na' prices and bad months are dropped, never counted as 0", () => {
  const recs = parseSgRecords({ success: true, result: { records: [
    { month: "2026-08", floor_area_sqm: "92", resale_price: "" },
    { month: "2026-08", floor_area_sqm: "92", resale_price: "na" },
    { month: "", floor_area_sqm: "92", resale_price: "600000" },
    { month: "2026-08", floor_area_sqm: "92", resale_price: "600000" },
  ] } });
  assert.deepEqual(recs, [{ month: "2026-08", price: 600000, area: 92 }]);
});

test("G20261018-1: Tampines in any spelling, and other HDB town names, resolve to the dataset's town", async () => {
  const { resolveSgTown, SG_TOWNS } = await import("./source");
  for (const x of ["Tampines", "tampines", "TAMPINES", " Tampines, Singapore ", "Tampines Town", "Tampines Estate", "tampines estate", "Tampines Estates", "Tampines Township", "Tampines New Town", "Tampinis"])
    assert.equal(resolveSgTown(x), "TAMPINES", x);
  assert.equal(resolveSgTown("Bishan estate"), "BISHAN");
  assert.equal(resolveSgTown("Ang-Mo-Kio"), "ANG MO KIO");
  assert.equal(resolveSgTown("AMK"), "ANG MO KIO");
  assert.equal(resolveSgTown("Kallang"), "KALLANG/WHAMPOA");
  assert.equal(resolveSgTown("Kallang/Whampoa"), "KALLANG/WHAMPOA");
  assert.equal(resolveSgTown("CBD"), "CENTRAL AREA");
  assert.equal(resolveSgTown("Jurong"), null); // East or West: do not guess
  assert.equal(resolveSgTown("Orchard"), null);
  assert.equal(SG_TOWNS.length, 26);
});

test("G20261018-1: a name that is not an HDB town gets the list of real towns, not a silent empty answer", async () => {
  const { sgHomeSales } = await import("./source");
  let called = 0;
  const a = await sgHomeSales({ town: "Orchard" }, async () => { called++; return {}; });
  assert.equal(called, 0);
  assert.equal(a.status, "no_matches");
  assert.match(a.summary, /not an HDB town/);
  assert.ok(((a.extra as any).valid_towns as string[]).includes("TAMPINES"));
});

test("G20261018-1: the portal is asked for the resolved town name", async () => {
  const { sgHomeSales } = await import("./source");
  const urls: string[] = [];
  await sgHomeSales({ town: "Tampines, Singapore" }, async (u: string) => { urls.push(u); return { success: true, result: { records: [] } }; });
  assert.deepEqual(JSON.parse(new URL(urls[0]).searchParams.get("filters")!), { town: "TAMPINES" });
});

// ---------- daily collector ----------
test("sgHistoryKey keys a request to the library (town, flat type, 12-month window only)", async () => {
  const { sgHistoryKey } = await import("./source");
  assert.deepEqual(sgHistoryKey({ town: "tampines" }), { area: "TAMPINES", item: "any:12m", label: "TAMPINES" });
  assert.deepEqual(sgHistoryKey({ town: "AMK", flat_type: "4 room" }), { area: "ANG MO KIO", item: "4-room:12m", label: "ANG MO KIO 4 ROOM" });
  assert.equal(sgHistoryKey({ town: "Orchard" }), null); // not an HDB town
  assert.equal(sgHistoryKey({ town: "Tampines", months: 24 }), null); // the copy holds the 12-month window only
  assert.equal(sgHistoryKey({ town: "Tampines", flat_type: "6 ROOM" }), null);
  assert.equal(sgHistoryKey({ town: "Tampines" }, { monthly: true }), null);
  assert.equal(sgHistoryKey({}), null);
});

// SYNTHETIC bulk portal in the live record shape (all towns mixed, newest first): 3 towns x 12 months x `per` resales, plus an old month.
function fakeBulk(towns: string[], per: number) {
  const records: Record<string, any>[] = [];
  let id = 1;
  const months = ["2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
  for (const month of months)
    for (const town of towns)
      for (let i = 0; i < per; i++) records.push({ _id: id++, month, town, flat_type: i % 2 ? "4 ROOM" : "5 ROOM", floor_area_sqm: "92", resale_price: String(500000 + i * 1000) });
  records.reverse();
  const calls: string[] = [];
  const fetcher = async (url: string) => {
    calls.push(url);
    const u = new URL(url);
    const limit = Number(u.searchParams.get("limit"));
    const offset = Number(u.searchParams.get("offset") ?? 0);
    return { success: true, result: { records: records.slice(offset, offset + limit) } };
  };
  return { fetcher, calls };
}

test("sgHarvest stores a rolling-12-month median per town and flat type, and stops paging at the window", async () => {
  const { sgHarvest, sgItem } = await import("./source");
  const towns = Array.from({ length: 24 }, (_, i) => `TOWN${i}`);
  const { fetcher, calls } = fakeBulk(towns, 10);
  const h = await sgHarvest(fetcher, new Date("2026-10-24T03:17:00Z"));
  assert.equal(h.date, "2026-10-24");
  assert.equal(h.currency, "SGD");
  const any = h.rows.find((r) => r.area === "TOWN0" && r.item === sgItem())!;
  assert.equal(any.n, 12 * 10); // 2025-11 .. 2026-10; 2025-09 and 2025-10 are outside the window
  const four = h.rows.find((r) => r.area === "TOWN0" && r.item === "4-room:12m")!;
  assert.equal(four.n, 12 * 5);
  assert.ok(calls.length < 14 * 24 * 10 / 1000 + 3); // did not read the whole file
});

test("sgHarvest refuses a partial read and groups under 5 resales are not written", async () => {
  const { sgHarvest, sgDailyRows } = await import("./source");
  const { fetcher } = fakeBulk(["A", "B", "C"], 10);
  await assert.rejects(() => sgHarvest(fetcher, new Date("2026-10-24T03:17:00Z")), /Only 3 HDB towns/);
  const rows = sgDailyRows([
    ...Array.from({ length: 5 }, (_, i) => ({ month: "2026-10", town: "BEDOK", flat: "4 ROOM", price: 600000 + i })),
    ...Array.from({ length: 4 }, (_, i) => ({ month: "2026-10", town: "BEDOK", flat: "5 ROOM", price: 700000 + i })),
  ]);
  assert.ok(rows.some((r) => r.item === "4-room:12m"));
  assert.ok(!rows.some((r) => r.item === "5-room:12m"));
  assert.equal(rows.find((r) => r.item === "any:12m")!.n, 9);
});

// REAL response copied from data.gov.sg (probe dep-sghdb1, 2026-10-24, no filter, newest first): the bulk parser reads town and flat type.
test("parseSgBulk reads the live record shape", async () => {
  const { parseSgBulk } = await import("./source");
  const live = { success: true, result: { records: [
    { _id: 243500, month: "2026-10", town: "YISHUN", flat_type: "MULTI-GENERATION", block: "633", street_name: "YISHUN ST 61", storey_range: "10 TO 12", floor_area_sqm: "171.00", flat_model: "Multi Generation", lease_commence_date: "1987", remaining_lease: "60 years 03 months", resale_price: "1178000" },
    { _id: 243441, month: "2026-10", town: "YISHUN", flat_type: "5 ROOM", block: "832", street_name: "YISHUN ST 81", storey_range: "01 TO 03", floor_area_sqm: "122.00", flat_model: "Improved", lease_commence_date: "1988", remaining_lease: "60 years 07 months", resale_price: "740000" },
  ] }, total: 243500 };
  const p = parseSgBulk(live);
  assert.equal(p.rawCount, 2);
  assert.equal(p.oldest, "2026-10");
  assert.deepEqual(p.sales[0], { month: "2026-10", town: "YISHUN", flat: "MULTI-GENERATION", price: 1178000 });
  assert.throws(() => parseSgBulk({ success: false }), /Unexpected response/);
});

test("sgHomeSales retries a page once when the portal fails (429/timeout), so the live answer is not replaced by a stale copy", async () => {
  const { sgHomeSales } = await import("./source");
  const { fetcher } = fakePortal(40);
  let failed = 0;
  const flaky = async (url: string) => {
    if (failed < 1) { failed++; throw new Error("HTTP 429"); }
    return fetcher(url);
  };
  const a = await sgHomeSales({ town: "Tampines", months: 12 }, flaky as any, new Date("2026-10-14T00:00:00Z"));
  assert.equal(a.status, "ok");
  assert.equal(failed, 1);
  assert.equal(a.sample_size, 12 * 40);
});

test("fetchWithBackoff: HTTP 429 is retried after growing pauses", async () => {
  let calls = 0;
  const waits: number[] = [];
  const out = await fetchWithBackoff(async () => { calls++; if (calls < 3) throw new Error("Source returned HTTP 429"); return { ok: 1 }; }, "u", async (ms) => { waits.push(ms); });
  assert.deepEqual(out, { ok: 1 });
  assert.deepEqual(waits, [3000, 10000]);
});

test("fetchWithBackoff: gives up with the last error", async () => {
  await assert.rejects(fetchWithBackoff(async () => { throw new Error("Source returned HTTP 429"); }, "u", async () => {}, [1, 1]), /429/);
});
