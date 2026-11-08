import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { aggregateAll, awardsOf, dayUrl, daysBefore, feedHonoured, gbContracts, gbContractsHarvest, INFO, itemsOf, mainCpv, rangeUrl, readRange, windowMarker, windowOf } from "./source";
import { writeDaily, writeMeta } from "../../lib/library/store";
import { InputError, SourceError } from "../../lib/http";

// Releases copied from the live OCDS award feed (GET /Published/Notices/OCDS/Search?publishedFrom=2026-11-05T00:00:00&publishedTo=2026-11-05T23:59:59&stages=award&limit=100,
// checked 2026-11-08). Only the fields the source reads are kept (buyers, suppliers, contacts and descriptions are left out on purpose).
// Item 5 is a real award and item 6 the real awardUpdate release of the same award (same award id, same value).
const LIVE: any[] = [{"ocid":"ocds-b5fd17-0ef89377-15da-487b-8dc2-10cf0225f8c4","date":"2026-11-05T19:10:34Z","tag":["award"],"tender":{"classification":{"scheme":"CPV","id":"34121000","description":"Buses and coaches"}},"awards":[{"id":"ocds-b5fd17-0ef89377-15da-487b-8dc2-10cf0225f8c4-1","status":"active","date":"2026-09-30T00:00:00+01:00","value":{"amount":645844.8,"currency":"GBP"}}]},{"ocid":"ocds-b5fd17-03e0c50a-5982-4e08-ba4b-5931fbfd3919","date":"2026-11-05T17:47:20Z","tag":["award"],"tender":{"classification":{"scheme":"CPV","id":"72260000","description":"Software-related services"}},"awards":[{"id":"ocds-b5fd17-03e0c50a-5982-4e08-ba4b-5931fbfd3919-2","status":"active","date":"2026-02-28T00:00:00Z","value":{"amount":165000,"currency":"GBP"}}]},{"ocid":"ocds-b5fd17-46a4e8d4-df83-4d68-aa15-73b8f3c791f3","date":"2026-11-05T17:45:08Z","tag":["award"],"tender":{"classification":{"scheme":"CPV","id":"30211300","description":"Computer platforms"}},"awards":[{"id":"ocds-b5fd17-46a4e8d4-df83-4d68-aa15-73b8f3c791f3-1","status":"active","date":"2026-10-27T00:00:00Z","value":{"amount":62716.8,"currency":"GBP"}}]},{"ocid":"ocds-b5fd17-5bacf30e-05e5-4e15-a3b2-05c86fb4dbb0","date":"2026-11-05T17:43:21Z","tag":["award"],"tender":{"classification":{"scheme":"CPV","id":"45453100","description":"Refurbishment work"}},"awards":[{"id":"ocds-b5fd17-5bacf30e-05e5-4e15-a3b2-05c86fb4dbb0-1","status":"active","date":"2026-10-30T00:00:00Z","value":{"amount":1330000,"currency":"GBP"}}]},{"ocid":"ocds-b5fd17-059610c9-43bf-482c-b89c-63ee31ef596d","date":"2026-11-05T17:16:47Z","tag":["awardUpdate"],"tender":{"classification":{"scheme":"CPV","id":"18444100","description":"Safety headgear"}},"awards":[{"id":"ocds-b5fd17-059610c9-43bf-482c-b89c-63ee31ef596d-1","status":"active","date":"2026-11-05T00:00:00Z","value":{"amount":870000,"currency":"GBP"}}]},{"ocid":"ocds-b5fd17-059610c9-43bf-482c-b89c-63ee31ef596d","date":"2026-11-05T17:11:41Z","tag":["award"],"tender":{"classification":{"scheme":"CPV","id":"18444100","description":"Safety headgear"}},"awards":[{"id":"ocds-b5fd17-059610c9-43bf-482c-b89c-63ee31ef596d-1","status":"active","date":"2026-11-05T00:00:00Z","value":{"amount":870000,"currency":"GBP"}}]},{"ocid":"ocds-b5fd17-3fed8dfa-e3b0-4946-8932-ee0e4f236bb1","date":"2026-11-05T16:35:22Z","tag":["award"],"tender":{"classification":{"scheme":"CPV","id":"45312100","description":"Fire-alarm system installation work"}},"awards":[{"id":"ocds-b5fd17-3fed8dfa-e3b0-4946-8932-ee0e4f236bb1-1","status":"active","date":"2026-10-23T00:00:00+01:00","value":{"amount":431708.78,"currency":"GBP"}}]},{"ocid":"ocds-b5fd17-b324137b-ee25-43ff-a6d6-41a2f391fb7d","date":"2026-11-05T16:32:18Z","tag":["award"],"tender":{"classification":{"scheme":"CPV","id":"73110000","description":"Research services"}},"awards":[{"id":"ocds-b5fd17-b324137b-ee25-43ff-a6d6-41a2f391fb7d-1","status":"active","date":"2026-10-14T00:00:00+01:00","value":{"amount":199925,"currency":"GBP"}}]},{"ocid":"ocds-b5fd17-a4652b07-1d1c-4ffc-b78d-a0a9ea440be9","date":"2026-11-05T16:28:08Z","tag":["award"],"tender":{"classification":{"scheme":"CPV","id":"72221000","description":"Business analysis consultancy services"}},"awards":[{"id":"ocds-b5fd17-a4652b07-1d1c-4ffc-b78d-a0a9ea440be9-1","status":"active","date":"2026-10-06T00:00:00+01:00","value":{"amount":173625.6,"currency":"GBP"}}]},{"ocid":"ocds-b5fd17-fc3f2623-bda1-4e21-8f97-898ae2274a72","date":"2026-11-05T16:01:16Z","tag":["award"],"tender":{"classification":{"scheme":"CPV","id":"48000000","description":"Software package and information systems"}},"awards":[{"id":"ocds-b5fd17-fc3f2623-bda1-4e21-8f97-898ae2274a72-1","status":"active","date":"2026-10-29T00:00:00Z","value":{"amount":64247.96,"currency":"GBP"}}]},{"ocid":"ocds-b5fd17-93465123-e41d-493b-9a89-b97bb646dedb","date":"2026-11-05T15:40:28Z","tag":["award"],"tender":{"classification":{"scheme":"CPV","id":"60000000","description":"Transport services (excl. Waste transport)"}},"awards":[{"id":"ocds-b5fd17-93465123-e41d-493b-9a89-b97bb646dedb-1","status":"active","date":"2026-11-05T00:00:00Z","value":{"amount":6116.4,"currency":"GBP"}}]},{"ocid":"ocds-b5fd17-f9ffdd45-b22b-47d7-b1ff-b935ce0f10cd","date":"2026-11-05T15:39:29Z","tag":["award"],"tender":{"classification":{"scheme":"CPV","id":"72253200","description":"Systems support services"}},"awards":[{"id":"ocds-b5fd17-f9ffdd45-b22b-47d7-b1ff-b935ce0f10cd-1","status":"active","date":"2026-08-31T00:00:00+01:00","value":{"amount":115533,"currency":"GBP"}}]}];

const synth = (n: number, cpv: string, date: string, value: (k: number) => number, tag = "award") =>
  Array.from({ length: n }, (_, k) => ({
    ocid: `synthetic-${cpv}-${date}-${k}`, date: `${date}T10:00:00Z`, tag: [tag],
    tender: { classification: { scheme: "CPV", id: cpv } },
    awards: [{ id: `synthetic-${cpv}-${date}-${k}-1`, status: "active", date: `${date}T00:00:00Z`, value: { amount: value(k), currency: "GBP" } }],
  }));

test("mainCpv and awardsOf read the live layout: CPV id, active GBP award value, publication date", () => {
  assert.equal(mainCpv(LIVE[0]), "34121000");
  assert.equal(mainCpv({ tender: { classification: { scheme: "CPV", id: "34121000-1" } } }), "34121000");
  assert.equal(mainCpv({ tender: { classification: { scheme: "OTHER", id: "34121000" } } }), "");
  assert.equal(mainCpv({}), "");
  const a = awardsOf(LIVE[0]);
  assert.equal(a.length, 1);
  assert.equal(a[0].value, 645844.8);
  assert.equal(a[0].date, LIVE[0].date.slice(0, 10));
  assert.equal(a[0].cpv, "34121000");
});

test("awardsOf drops placeholders (0, 0.01), other currencies, inactive awards and missing codes", () => {
  const r = (amount: any, over: any = {}) => ({ ...LIVE[0], awards: [{ id: "x-1", status: "active", value: { amount, currency: "GBP" }, ...over }] });
  assert.equal(awardsOf(r(0)).length, 0);
  assert.equal(awardsOf(r(0.01)).length, 0);
  assert.equal(awardsOf(r(99)).length, 0);
  assert.equal(awardsOf(r(100)).length, 1);
  assert.equal(awardsOf(r(1000, { value: { amount: 1000, currency: "EUR" } })).length, 0);
  assert.equal(awardsOf(r(1000, { status: "cancelled" })).length, 0);
  assert.equal(awardsOf(r(6e9)).length, 0);
  assert.equal(awardsOf({ ...LIVE[0], tender: {} }).length, 0);
  assert.equal(awardsOf(null).length, 0);
  assert.equal(awardsOf({ ...LIVE[0], date: "bad" }).length, 0);
});

test("itemsOf files an award under its shared purchase, its 2-digit division and its 4-digit group", () => {
  assert.deepEqual(itemsOf("30213100"), ["laptops", "cpv-30", "cpv-3021"]);
  assert.ok(itemsOf("45233251").includes("road-resurfacing"));
  assert.deepEqual(itemsOf("72260000").slice(-2), ["cpv-72", "cpv-7226"]);
});

test("aggregateAll counts an award once even when an update repeats it, and never publishes fewer than 5 awards", () => {
  const live = LIVE.flatMap(awardsOf);
  assert.equal(live.length, 12); // 12 releases, 12 award rows (the awardUpdate repeats one)
  const rows = aggregateAll(live, "2026-11-01", "2026-11-30");
  assert.deepEqual(rows, []); // 11 distinct awards spread over many groups: none reaches 5
  const more = [...live, ...synth(6, "72260000", "2026-11-04", (k) => 100000 * (k + 1)).flatMap(awardsOf)];
  const r = aggregateAll(more, "2026-11-01", "2026-11-30");
  const d72 = r.find((x) => x.item === "cpv-72");
  assert.equal(d72?.n, 6 + 3); // 6 synthetic + the 3 live codes starting 72 (72260000, 72221000, 72253200)
  const d7226 = r.find((x) => x.item === "cpv-7226");
  assert.equal(d7226?.n, 7);
  // the duplicated award (18444100) is not double counted
  const dup = aggregateAll([...synth(5, "18444100", "2026-11-04", () => 870000).flatMap(awardsOf), ...LIVE.slice(4, 6).flatMap(awardsOf)], "2026-11-01", "2026-11-30");
  assert.equal(dup.find((x) => x.item === "cpv-18")?.n, 6);
});

test("aggregateAll keeps the newest release of an award (a correction replaces the earlier value)", () => {
  const a = { key: "k-1", date: "2026-11-02", value: 1000, cpv: "30213100", stamp: "2026-11-02T10:00:00Z" };
  const b = { ...a, value: 5000, stamp: "2026-11-03T10:00:00Z" };
  const others = [1, 2, 3, 4].map((i) => ({ ...a, key: `o-${i}`, value: 2000 }));
  const r = aggregateAll([a, ...others, b], "2026-11-01", "2026-11-30").find((x) => x.item === "laptops");
  assert.equal(r?.n, 5);
  assert.equal(r?.max, 5000);
  assert.equal(r?.min, 2000);
});

test("rangeUrl asks for whole days with a time part (a date-only day returns nothing) and the 100 page cap", () => {
  const u = rangeUrl("2026-11-02", "2026-11-05");
  assert.match(u, /publishedFrom=2026-11-02T00:00:00&publishedTo=2026-11-05T23:59:59/);
  assert.match(u, /stages=award&limit=100$/);
  assert.equal(dayUrl("2026-11-05"), rangeUrl("2026-11-05", "2026-11-05"));
});

/** A fake feed: pages of 2 releases, filtered by the dates in the URL, with the cursor link the live feed gives. */
function fakeFeed(releases: any[], pageSize = 2) {
  const calls: string[] = [];
  const get = async (url: string) => {
    calls.push(url);
    const from = /publishedFrom=(\d{4}-\d{2}-\d{2})/.exec(url)![1];
    const to = /publishedTo=(\d{4}-\d{2}-\d{2})/.exec(url)![1];
    const off = Number(/cursor=(\d+)/.exec(url)?.[1] ?? 0);
    const all = releases.filter((r) => r.date.slice(0, 10) >= from && r.date.slice(0, 10) <= to);
    const page = all.slice(off, off + pageSize);
    const body: any = { uri: url.split("&cursor=")[0], releases: page };
    if (off + pageSize < all.length) body.links = { next: `${url.split("&cursor=")[0]}&cursor=${off + pageSize}` };
    return body;
  };
  return { get, calls };
}

test("readRange follows the cursor links through every page, and stops when there is no next link", async () => {
  const day = LIVE[0].date.slice(0, 10);
  const feed = fakeFeed(LIVE.slice(0, 5), 2);
  const got: string[] = [];
  const n = await readRange(day, day, feed.get, (r) => got.push(r.ocid));
  assert.equal(n, 5);
  assert.equal(feed.calls.length, 3);
  assert.equal(new Set(got).size, 5);
  assert.equal(await readRange("2026-01-03", "2026-01-04", feed.get, () => {}), 0); // a weekend: empty list, no crash
});

test("harvest: reads a week at a time newest first, builds the window marker and aggregates; a broken newest week is refused", async () => {
  const now = new Date("2026-11-08T03:17:00Z");
  const rel: any[] = [];
  for (let d = 0; d < 40; d++) rel.push(...synth(3, "45233251", daysBefore("2026-11-08", d), (k) => (k + 1) * 100000));
  const feed = fakeFeed(rel, 50);
  const r = await gbContractsHarvest(now, { get: feed.get, days: 35 });
  assert.equal(r.currency, "GBP");
  assert.equal(r.date, "2026-11-08");
  assert.equal(windowOf(r.rows), "2026-10-05");
  const road = r.rows.find((x) => x.item === "road-resurfacing");
  assert.equal(road?.n, 105);
  assert.equal(road?.median, 200000);
  assert.ok(r.note?.includes("2026-10-05 to 2026-11-08"));
  assert.equal(feed.calls.length, 5); // five weekly queries, one page each: few calls, because the feed throttles
  const failing = async (url: string) => {
    if (url.includes("publishedTo=2026-11-08")) throw new SourceError("down");
    return feed.get(url);
  };
  await assert.rejects(gbContractsHarvest(now, { get: failing, days: 35 }), SourceError);
  const failOld = async (url: string) => {
    if (url.includes("publishedFrom=2026-10-05")) throw new SourceError("down");
    return feed.get(url);
  };
  const short = await gbContractsHarvest(now, { get: failOld, days: 35 });
  assert.equal(windowOf(short.rows), "2026-10-12");
  await assert.rejects(gbContractsHarvest(now, { get: async () => { throw new SourceError("down"); } }), SourceError);
  await assert.rejects(gbContractsHarvest(now, { get: async () => ({ releases: [] }), days: 35 }), SourceError);
});

test("answer: median and range from the library, period from the window marker, and clear refusals", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "gbcf-"));
  process.env.PROOFPRICE_LIBRARY_DIR = dir;
  try {
    const h = {
      date: "2026-11-08",
      currency: "GBP",
      unit: "per contract (lot), total awarded value",
      rows: [
        { area: "ALL", item: "road-resurfacing", n: 87, median: 141664, low: 40000, high: 900000, min: 12000, max: 2000000 },
        { area: "ALL", item: "cpv-45", n: 400, median: 250000, low: 50000, high: 2000000, min: 12000, max: 9000000 },
        windowMarker("2026-09-13"),
      ],
    };
    writeDaily(INFO.id, h);
    writeMeta(INFO.id, { source: INFO.id, currency: "GBP", unit: h.unit, first_date: h.date, last_date: h.date, days: 1, last_harvest_at: "x", last_rows: h.rows.length, last_ok_at: "x", last_error: null });
    const a = await gbContracts({ what: "road resurfacing" });
    assert.equal(a.status, "ok");
    assert.equal(a.price_type, "contract_price");
    assert.equal(a.price?.currency, "GBP");
    assert.equal(a.sample_size, 87);
    assert.equal(a.price?.median, 141664);
    assert.deepEqual(a.period, { from: "2026-09-13", to: "2026-11-08" });
    assert.match(a.summary, /not unit prices/);
    assert.doesNotMatch(JSON.stringify(a), /window:/);
    const c = await gbContracts({ what: "x", cpv: "45233142" }); // 4-digit group cpv-4523 has no row in this fixture: an honest "not enough records"
    assert.notEqual(c.status, "ok");
    const d = await gbContracts({ what: "x", cpv: "45" });
    assert.equal(d.sample_size, 400);
    await assert.rejects(gbContracts({ what: "x", cpv: "123" }), InputError);
    await assert.rejects(gbContracts({ what: "laptops", buyer_area: "London" }), InputError);
    await assert.rejects(gbContracts({ what: "quantum widgets" }), InputError);
  } finally {
    delete process.env.PROOFPRICE_LIBRARY_DIR;
  }
});

test("answer: no library copy yet is a clear source error, not a crash", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "gbcf-"));
  process.env.PROOFPRICE_LIBRARY_DIR = dir;
  try {
    await assert.rejects(gbContracts({ what: "laptops" }), SourceError);
  } finally {
    delete process.env.PROOFPRICE_LIBRARY_DIR;
  }
});

test("feedHonoured spots the throttled reply (empty list, default query echoed without publishedFrom)", () => {
  // copied from the live feed on 2026-11-08 when it answered a default query to a dated request
  assert.equal(feedHonoured({ uri: "https://www.contractsfinder.service.gov.uk/Published/Notices/OCDS/Search?publishedTo=2026-11-08T01:48:59Z&limit=100", releases: [] }), false);
  assert.equal(feedHonoured({ uri: "https://www.contractsfinder.service.gov.uk/Published/Notices/OCDS/Search?publishedFrom=2026-11-05T00:00:00&publishedTo=2026-11-05T23:59:59&stages=award&limit=100", releases: [] }), true);
  assert.equal(feedHonoured({ releases: [] }), true);
});
