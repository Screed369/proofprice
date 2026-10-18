import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSgUrl, parseSgRecords } from "./source";

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
