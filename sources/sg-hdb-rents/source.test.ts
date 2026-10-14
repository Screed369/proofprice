// Fixtures in ./fixtures are real data.gov.sg datastore_search responses captured through the GitHub-hosted probe on 2026-10-14
// (resource d_c9f57187485a850908655db0e8cfe651, "Renting Out of Flats from Jan 2021", 212 597 records, newest month 2026-09).
// The paging test builds a larger list in the same record shape, so it is marked synthetic.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseDatastoreSearch, datastoreSearchUrl } from "../../lib/adapters";
import { INFO, RESOURCE_ID, SITE, cutoffMonth, normaliseFlatType, normaliseTown, parseSgRents, sgRents } from "./source";

const read = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const FILTERED = read("datastore-tampines-4room.json");
const LATEST = read("datastore-latest.json");

test("real records parse: month, flat type and rent as a number", () => {
  const r = parseDatastoreSearch(FILTERED);
  assert.equal(r.total, 5416);
  const rents = parseSgRents(r.records);
  assert.deepEqual(rents, [
    { month: "2026-09", flat_type: "4-ROOM", rent: 3500 },
    { month: "2026-09", flat_type: "4-ROOM", rent: 2000 },
    { month: "2026-09", flat_type: "4-ROOM", rent: 3300 },
  ]);
  const latest = parseSgRents(parseDatastoreSearch(LATEST).records);
  assert.equal(latest.length, 5);
  assert.ok(latest.every((x) => x.rent >= 1000 && x.rent < 10000));
});

test("the request asks for one town and flat type, newest first, with a stable sort", () => {
  const url = new URL(datastoreSearchUrl(SITE, { resourceId: RESOURCE_ID, filters: { town: "TAMPINES", flat_type: "4-ROOM" }, sort: ["rent_approval_date desc", "_id desc"], limit: 1000, offset: 0, includeTotal: false }));
  assert.equal(url.origin + url.pathname, "https://data.gov.sg/api/action/datastore_search");
  assert.equal(url.searchParams.get("resource_id"), RESOURCE_ID);
  assert.deepEqual(JSON.parse(url.searchParams.get("filters")!), { town: "TAMPINES", flat_type: "4-ROOM" });
  assert.equal(url.searchParams.get("sort"), "rent_approval_date desc,_id desc");
});

test("town and flat type spellings", () => {
  assert.equal(normaliseTown("Tampines"), "TAMPINES");
  assert.equal(normaliseTown(" toa payoh "), "TOA PAYOH");
  assert.equal(normaliseTown("Kallang"), "KALLANG/WHAMPOA");
  assert.equal(normaliseTown("AMK"), "ANG MO KIO");
  assert.equal(normaliseTown("bukit t"), "BUKIT TIMAH");
  assert.throws(() => normaliseTown("Orchard"), /not an HDB town/);
  assert.equal(normaliseFlatType("4 ROOM"), "4-ROOM");
  assert.equal(normaliseFlatType("4-room"), "4-ROOM");
  assert.equal(normaliseFlatType("5room"), "5-ROOM");
  assert.equal(normaliseFlatType("Executive"), "EXECUTIVE");
  assert.throws(() => normaliseFlatType("6 ROOM"), /flat_type must be one of/);
});

test("window start month", () => {
  assert.equal(cutoffMonth(12, new Date("2026-10-14T00:00:00Z")), "2025-10");
  assert.equal(cutoffMonth(1, new Date("2026-01-31T00:00:00Z")), "2025-12");
});

/** SYNTHETIC: 60 rents per month for 2025-06 .. 2026-09, in the real record shape, served page by page like the portal does. */
function fakePortal() {
  const records: Record<string, any>[] = [];
  let id = 1;
  for (let y = 2025, m = 6; y < 2026 || m <= 9; ) {
    const month = `${y}-${String(m).padStart(2, "0")}`;
    for (let i = 0; i < 60; i++) {
      records.push({ _id: id++, rent_approval_date: month, town: "TAMPINES", block: String(100 + i), street_name: "TAMPINES ST 12", flat_type: i % 2 ? "4-ROOM" : "5-ROOM", monthly_rent: String(2600 + (i % 10) * 100 + (i % 2) * 300) });
    }
    if (++m > 12) { m = 1; y++; }
  }
  records.reverse(); // newest first
  const calls: string[] = [];
  const fetcher = async (url: string) => {
    calls.push(url);
    const u = new URL(url);
    const limit = Number(u.searchParams.get("limit"));
    const offset = Number(u.searchParams.get("offset") ?? 0);
    const filters = JSON.parse(u.searchParams.get("filters")!);
    const rows = records.filter((r) => r.town === filters.town && (!filters.flat_type || r.flat_type === filters.flat_type));
    return { success: true, result: { resource_id: RESOURCE_ID, records: rows.slice(offset, offset + limit), total: rows.length } };
  };
  return { fetcher, calls };
}

test("sgRents: median and range, period, caveat, and the paging stops at the window", async () => {
  const { fetcher, calls } = fakePortal();
  const a = await sgRents({ town: "Tampines", flat_type: "4 ROOM", months: 6 }, fetcher, new Date("2026-10-14T00:00:00Z"));
  assert.equal(a.status, "ok");
  assert.equal(a.price_type, "transaction");
  assert.equal(a.price?.currency, "SGD");
  assert.equal(a.price?.unit, "per month");
  assert.equal(a.price?.measure, "median");
  assert.ok(a.price!.typical_low! < a.price!.median! && a.price!.median! < a.price!.typical_high!);
  assert.deepEqual(a.period, { from: "2026-04", to: "2026-09" });
  assert.equal(a.sample_size, 6 * 30); // 30 four-room rents a month, April..September
  assert.equal(a.confidence, "high");
  assert.match(a.summary, /4-ROOM HDB flats in TAMPINES were approved for rent at a median of SGD\s[\d,]+ a month/);
  assert.match(a.method, /declared by the owner and not verified/);
  assert.match(String((a.extra as any).caveat), /not verified by HDB/);
  assert.equal(calls.length, 1); // 180 rents fit in one page of 1 000, and the page reached back before the window
  assert.equal(a.source.id, "sg-hdb-rents");
});

test("sgRents: all flat types gives a breakdown; a long window pages on", async () => {
  const { fetcher, calls } = fakePortal();
  const a = await sgRents({ town: "TAMPINES", months: 24 }, fetcher, new Date("2026-10-14T00:00:00Z"));
  assert.equal(a.status, "ok");
  assert.equal(a.sample_size, 16 * 60); // June 2025 .. September 2026
  assert.equal(calls.length, 1); // 960 rents < 1 000: one page, nothing older to fetch
  const by = (a.extra as any).by_flat_type;
  assert.ok(by["4-ROOM"].median > 0 && by["5-ROOM"].median > 0);
  assert.equal(by["4-ROOM"].records + by["5-ROOM"].records, a.sample_size);
});

test("sgRents: a quiet flat type gives no range below 5 records, and bad input is refused", async () => {
  const { fetcher } = fakePortal();
  const none = await sgRents({ town: "BEDOK", flat_type: "3 ROOM" }, fetcher, new Date("2026-10-14T00:00:00Z"));
  assert.equal(none.status, "no_matches");
  assert.equal(none.price, null);
  await assert.rejects(sgRents({}, fetcher), /A town is required/);
  await assert.rejects(sgRents({ town: "Narnia" }, fetcher), /not an HDB town/);
});

test("INFO carries the Singapore Open Data Licence and the owner-declared warning", () => {
  assert.equal(INFO.licence, "Singapore Open Data Licence v1.0");
  assert.equal(INFO.licence_url, "https://data.gov.sg/open-data-licence");
  assert.match(INFO.limits, /owner-declared/);
});
