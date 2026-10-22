import { test } from "node:test";
import assert from "node:assert/strict";
import { auContracts, cleanUnspsc, dayWindows, dedupe, INFO, isEmptyDay, isMatch, MIN_VALUE, parsePage, wordsOf } from "./source";
import { SourceError, InputError } from "../../lib/http";
import { AU_PAGE } from "./fixtures";

// Fixture: real AusTender OCDS page (GET .../ocds/findByDates/contractPublished/2026-10-19T00:00:00Z/2026-10-20T00:00:00Z, probe 21 Oct 2026).

test("AusTender: a real page becomes one contract per release, with AUD value, date, UNSPSC code and agency", () => {
  const r = parsePage(AU_PAGE);
  assert.equal(r.contracts.length, 29);
  const c = r.contracts.find((x) => x.id === "CN4283333")!;
  assert.equal(c.value, 495581.03);
  assert.equal(c.unspsc, "43210000");
  assert.equal(c.agency, "Department of Parliamentary Services");
  assert.match(c.date, /^2026-10-/);
  assert.ok(r.next?.startsWith("https://api.tenders.gov.au/"));
});

test("AusTender: no supplier or contact data is kept", () => {
  const json = JSON.stringify(parsePage(AU_PAGE));
  assert.ok(!/supplier|email|@|telephone/i.test(json));
});

test("AusTender: placeholder values, other currencies and a next link to another host are ignored (derived from a real release)", () => {
  const rel = AU_PAGE.releases[0];
  const mk = (value: any) => ({ ...rel, contracts: [{ ...rel.contracts[0], value }] });
  const r = parsePage({ releases: [mk({ currency: "AUD", amount: "0.00" }), mk({ currency: "AUD", amount: "50" }), mk({ currency: "USD", amount: "5000" }), mk({ currency: "AUD", amount: "1000" })], links: { next: "https://evil.example/x" } });
  assert.deepEqual(r.contracts.map((c) => c.value), [1000]);
  assert.equal(r.next, null);
  assert.equal(MIN_VALUE, 100);
});

test("AusTender: an unexpected response is a source error", () => {
  assert.throws(() => parsePage({ message: "Forbidden" }), SourceError);
  assert.throws(() => parsePage(null), SourceError);
});

test("AusTender: an amended contract (same CN number) counts once, newest release wins (derived)", () => {
  const list = parsePage(AU_PAGE).contracts;
  const old = { ...list[0], value: 1, released: "2020-01-01T00:00:00Z" };
  const out = dedupe([old, ...list]);
  assert.equal(out.length, list.length);
  assert.equal(out.find((c) => c.id === list[0].id)!.value, list[0].value);
});

test("AusTender: words and UNSPSC prefixes find contracts", () => {
  const list = parsePage(AU_PAGE).contracts;
  assert.equal(list.filter((c) => isMatch(c, { prefixes: [], words: wordsOf("equipment") })).length, 21);
  assert.equal(list.filter((c) => isMatch(c, { prefixes: ["901016"], words: [] })).length, 1);
  assert.equal(list.filter((c) => isMatch(c, { prefixes: ["4321"], words: [] })).length, 12);
  assert.equal(list.filter((c) => isMatch(c, { prefixes: [], words: wordsOf("catering") })).length, 1);
});

test("AusTender: UNSPSC input and day windows", () => {
  assert.equal(cleanUnspsc("4321"), "4321");
  assert.equal(cleanUnspsc("30213100-5"), null);
  const d = dayWindows(3, new Date("2026-10-21T05:00:00Z"));
  assert.deepEqual(d, [{ from: "2026-10-21", to: "2026-10-22" }, { from: "2026-10-20", to: "2026-10-21" }, { from: "2026-10-19", to: "2026-10-20" }]);
});

test("AusTender: the answer is a contract-value range in AUD, with the licence and no supplier names", async () => {
  const orig = globalThis.fetch;
  const page = { ...AU_PAGE, links: { self: "x" } };
  globalThis.fetch = (async () => new Response(JSON.stringify(page), { status: 200, headers: { "content-type": "application/json" } })) as any;
  try {
    // the same page comes back for each of the 21 days: dedupe by CN number leaves the 12 real contracts
    const a = await auContracts({ what: "equipment", months: 24 }, new Date("2026-10-21T05:00:00Z"));
    assert.equal(a.status, "ok");
    assert.equal(a.price!.currency, "AUD");
    assert.equal(a.sample_size, 21);
    assert.ok(a.price!.median! > 14000 && a.price!.median! < 30000);
    assert.match(a.source.licence, /Attribution 3\.0 Australia/);
    assert.match(a.source.name, /AusTender/);
    const none = await auContracts({ what: "equipment", buyer_area: "Veterans", months: 1 }, new Date("2026-10-21T05:00:00Z"));
    assert.notEqual(none.status, "ok"); // fewer than 5 contracts: no figure
    await assert.rejects(() => auContracts({ what: "x", cpv: "abc", months: 1 }), InputError);
  } finally {
    globalThis.fetch = orig;
  }
  assert.equal(INFO.price_type, "contract_price");
});

test("AusTender: HTTP 400 'No Records found for Date Range' is an empty day, other errors are not", () => {
  assert.equal(isEmptyDay(new SourceError("Source returned HTTP 400", '{"message":"No Records found for Date Range"}', 400)), true);
  assert.equal(isEmptyDay(new SourceError("Source returned HTTP 400", "bad date", 400)), false);
  assert.equal(isEmptyDay(new SourceError("Source returned HTTP 503", "No Records", 503)), false);
  assert.equal(isEmptyDay(new Error("x")), false);
});

test("AusTender: weekend days that answer 400 'No Records' do not turn the whole answer into a 502", async () => {
  const orig = globalThis.fetch;
  const page = { ...AU_PAGE, links: { self: "x" } };
  globalThis.fetch = (async (url: string) =>
    /2026-10-1[0-9]T|2026-10-20T/.test(String(url)) && /T00:00:00Z\/2026-10-(11|18)/.test(String(url)) === false && /(2026-10-(10|17)T)/.test(String(url))
      ? new Response('{"message":"No Records found for Date Range"}', { status: 400 })
      : new Response(JSON.stringify(page), { status: 200, headers: { "content-type": "application/json" } })) as any;
  try {
    const a = await auContracts({ what: "equipment", months: 1 }, new Date("2026-10-21T05:00:00Z"));
    assert.equal(a.status, "ok");
  } finally {
    globalThis.fetch = orig;
  }
  globalThis.fetch = (async () => new Response("boom", { status: 400 })) as any;
  try {
    await assert.rejects(() => auContracts({ what: "equipment", months: 1 }, new Date("2026-10-21T05:00:00Z")), SourceError);
  } finally {
    globalThis.fetch = orig;
  }
});
