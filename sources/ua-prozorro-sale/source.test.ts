// Fixtures: trimmed copies of three real procedures from the live API (probes uasale-e1..e3, checked 2026-10-24); owner, bidder and
// contact objects removed, the fields below are exactly the ones the parser reads.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { dailyRows, groupFor, groupOfCav, INFO, nextCursor, regionFor, regionOfUk, saleOf, uaPublicSales, uaSaleHarvest, windowStart, API, Sale } from "./source";
import { writeDaily, writeMeta } from "../../lib/library/store";
import { InputError, SourceError } from "../../lib/http";

const LEASE = { _id: "6abccef1e702d2363cfedb67", status: "active_awarded", sellingMethod: "legitimatePropertyLease-english", dateModified: "2026-10-20T04:06:07.762000Z",
  value: { amount: 5236.24, currency: "UAH" }, valuePeriod: "month", contracts: [{ status: "pending", value: { amount: 5570.0, currency: "UAH" } }],
  items: [{ classification: { scheme: "CAV", id: "04000000-8" }, address: { region: { uk_UA: "Івано-Франківська область" } } }] };
const BANKRUPT = { _id: "b1", status: "complete", sellingMethod: "bankRuptcy-english", dateModified: "2026-07-15T04:00:00.000000Z", value: { amount: 900000.0, currency: "UAH" },
  contracts: [{ status: "active", value: { amount: 900000.0, currency: "UAH" }, dateSigned: "2026-06-19T04:04:47.000000Z" }],
  items: [{ classification: { scheme: "CAV", id: "03211100-4" }, address: { region: { uk_UA: "Миколаївська область" } } }] };
const LAND = { _id: "l1", status: "complete", sellingMethod: "landArrested-priorityEnglish", dateModified: "2026-03-01T10:00:00.000000Z", value: { amount: 229120.0, currency: "UAH" },
  contracts: [{ status: "active", value: { amount: 798000.0, currency: "UAH" }, dateSigned: "2026-02-24T17:49:06.000000Z" }],
  items: [{ classification: { scheme: "CAV", id: "06121000-6" }, address: { region: { uk_UA: "м. Київ" } } }] };
const CANCELLED = { _id: "c1", status: "cancelled", sellingMethod: "commercialSell-english", dateModified: "2026-10-20T04:56:59.642000Z", value: { amount: 186000.0, currency: "UAH" }, contracts: [],
  items: [{ classification: { scheme: "CAV", id: "34000000-7" }, address: { region: { uk_UA: "Миколаївська область" } } }] };

test("a completed sale gives the signed amount, date, group and region; start prices are never used", () => {
  assert.deepEqual(saleOf(BANKRUPT), { id: "b1", group: "farm-produce", region: "mykolaiv", date: "2026-06-19", price: 900000 });
  assert.deepEqual(saleOf(LAND), { id: "l1", group: "land", region: "kyiv-city", date: "2026-02-24", price: 798000 });
});
test("leases, cancelled and pending procedures, and foreign currency give no sale", () => {
  assert.equal(saleOf(LEASE), null);
  assert.equal(saleOf(CANCELLED), null);
  assert.equal(saleOf({ ...BANKRUPT, status: "complete", sellingMethod: "landRental-english" }), null);
  assert.equal(saleOf({ ...BANKRUPT, contracts: [{ status: "active", value: { amount: 10, currency: "USD" }, dateSigned: "2026-06-19" }] }), null);
  assert.equal(saleOf({ ...BANKRUPT, contracts: [{ status: "cancelled", value: { amount: 10, currency: "UAH" }, dateSigned: "2026-06-19" }] }), null);
  assert.equal(saleOf(null), null);
});
test("groups and regions", () => {
  assert.equal(groupOfCav("34000000-7"), "vehicles");
  assert.equal(groupOfCav("04000000-8"), "real-estate");
  assert.equal(groupOfCav("99"), "other");
  assert.equal(groupFor("Real estate"), "real-estate");
  assert.equal(groupFor("truck"), "vehicles");
  assert.equal(groupFor("banana"), null);
  assert.equal(regionOfUk("Миколаївська область"), "mykolaiv");
  assert.equal(regionOfUk("Київська область"), "kyiv-oblast");
  assert.equal(regionOfUk("м. Київ"), "kyiv-city");
  assert.equal(regionOfUk("Atlantis"), null);
  assert.equal(regionFor("Kharkiv oblast"), "kharkiv");
  assert.equal(regionFor("Kyiv"), "kyiv-city");
  assert.equal(regionFor("Kyiv oblast"), "kyiv-oblast");
  assert.equal(regionFor("Atlantis"), null);
});
test("cursor is the newest dateModified plus one millisecond", () => {
  assert.equal(nextCursor([LEASE, BANKRUPT]), "2026-10-20T04:06:07.763Z");
  assert.equal(nextCursor([]), null);
});

const sale = (i: number, price: number, region: string | null = "kharkiv", group: Sale["group"] = "vehicles", date = "2026-10-10"): Sale => ({ id: `s${i}`, group, region, date, price });
test("dailyRows: regional, national and 'any' rows, nothing under 5 sales, a repeated id counts once, window respected", () => {
  const sales = [1, 2, 3, 4, 5].map((i) => sale(i, i * 1000)).concat([sale(5, 9999), sale(6, 777, "lviv"), sale(7, 5, "kharkiv", "vehicles", "2026-01-01")]);
  const rows = dailyRows(sales, "2026-08-25", "2026-10-24");
  const kh = rows.find((r) => r.area === "kharkiv" && r.item === "vehicles")!;
  assert.equal(kh.n, 5);
  assert.equal(kh.median, 3000);
  assert.equal(rows.find((r) => r.area === "ALL" && r.item === "any")!.n, 6);
  assert.ok(!rows.some((r) => r.area === "lviv"));
});

const page = (n: number, base: number) => Array.from({ length: n }, (_, i) => ({ ...BANKRUPT, contracts: [{ status: "active", value: { amount: 1000 + i, currency: "UAH" }, dateSigned: "2026-10-10T04:00:00.000000Z" }], _id: `p${base + i}`, dateModified: new Date(Date.parse("2026-10-01T00:00:00Z") + (base + i) * 1000).toISOString() }));
test("harvest pages until a short page, keeps aggregates only, and publishes the period it read", async () => {
  const urls: string[] = [];
  const get = async (u: string) => { urls.push(u); return urls.length === 1 ? page(100, 0) : page(10, 100); };
  const r = await uaSaleHarvest(new Date("2026-10-24T05:00:00Z"), { get });
  assert.equal(urls.length, 2);
  assert.ok(urls[0].startsWith(`${API}/2026-08-25T00:00:00.000Z?limit=100`));
  assert.equal(r.currency, "UAH");
  assert.equal(r.date, "2026-10-24");
  assert.equal(r.rows.find((x) => x.area === "ALL" && x.item === "any")!.n, 110);
  assert.ok(!JSON.stringify(r).includes("p1"));
});
test("harvest refuses a partial window and an unexpected format", async () => {
  const slow = async () => page(100, 0); // never a short page, stops at the page cap
  await assert.rejects(uaSaleHarvest(new Date("2026-10-24T05:00:00Z"), { get: slow, maxPages: 2 }), SourceError);
  await assert.rejects(uaSaleHarvest(new Date("2026-10-24T05:00:00Z"), { get: async () => ({ nope: 1 }) }), /changed/);
});

test("answers come from the library and say what they are", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "uasale-"));
  process.env.PROOFPRICE_LIBRARY_DIR = dir;
  const rows = [1, 2, 3, 4, 5, 6].map((i) => sale(i, i * 100000, "kharkiv", "vehicles"));
  const day = dailyRows(rows, "2026-08-25", "2026-10-24");
  try {
    writeDaily(INFO.id, { date: "2026-10-24", currency: "UAH", unit: "per lot", rows: day });
    writeMeta(INFO.id, { source: INFO.id, currency: "UAH", unit: "per lot", first_date: "2026-10-24", last_date: "2026-10-24", days: 1, last_harvest_at: "x", last_rows: day.length, last_ok_at: "x", last_error: null });
    const a = await uaPublicSales({ what: "vehicles" });
    assert.equal(a.price?.currency, "UAH");
    assert.equal(a.price?.median, 350000);
    assert.match(a.summary, /not retail prices/);
    assert.match(JSON.stringify(a), /Prozorro\.Sale/);
    const thin = await uaPublicSales({ what: "land" });
    assert.equal(thin.price, null);
    await assert.rejects(uaPublicSales({ what: "vehicles", state: "Atlantis" }), InputError);
    await assert.rejects(uaPublicSales({ what: "banana" }), InputError);
  } finally {
    delete process.env.PROOFPRICE_LIBRARY_DIR;
  }
  assert.equal(windowStart("2026-10-24"), "2026-08-25");
});
