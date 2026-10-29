// Tests for the SG state-property rent awards. fixtures/awards.json is a REAL slice (award years 2015-2025, 282 rows, bidder names removed)
// of https://data.gov.sg/api/action/datastore_search?resource_id=d_2057d332317dd0d045e392fe4e9aca57&limit=1000 checked on 2026-10-29.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { InputError, SourceError } from "../../lib/http";
import { parseDatastoreSearch } from "../../lib/adapters";
import { INFO, answerFromAwards, parseAwards, parseRent, sgSlaRents } from "./source";

const RECORDS = parseDatastoreSearch(JSON.parse(readFileSync(new URL("./fixtures/awards.json", import.meta.url), "utf8"))).records;

test("licence and type", () => {
  assert.match(INFO.licence, /Singapore Open Data Licence/);
  assert.equal(INFO.price_type, "contract_price");
});

test("amount texts: digits, thousands commas, and texts that are not one rent", () => {
  assert.equal(parseRent("28288"), 28288);
  assert.equal(parseRent("58,000"), 58000);
  assert.equal(parseRent("71336.04"), 71336.04);
  assert.equal(parseRent("No Award"), null);
  assert.equal(parseRent("No Bid"), null);
  assert.equal(parseRent("2500000 (initial period)"), null);
  assert.equal(parseRent("71336.04 (A) 66355.24 (B) 99000 (C) 67032 (D)"), null);
  assert.equal(parseRent(undefined), null);
});

test("parses the real rows and drops the ones without a single rent", () => {
  const p = parseAwards(RECORDS);
  assert.equal(p.rows, 282);
  assert.equal(p.awards.length, 238);
  assert.equal(p.without_rent, 44);
  assert.ok(p.awards.every((a) => a.rent >= 100 && a.year >= 2015 && a.year <= 2025));
  assert.throws(() => parseAwards(RECORDS.slice(0, 20)), SourceError);
});

test("default answer: all awards of the newest 10 award years (checked against an independent calculation of the fixture)", () => {
  const a = answerFromAwards(parseAwards(RECORDS), {});
  assert.equal(a.status, "ok");
  assert.equal(a.price!.currency, "SGD");
  assert.equal(a.sample_size, 218);
  assert.equal(a.price!.median, 31502); // 31 501.5 rounded by roundFigure
  assert.deepEqual(a.period, { from: "2016", to: "2025" });
  assert.equal(a.price_type, "contract_price");
  assert.match(a.summary, /not market rents/);
  assert.ok(!JSON.stringify(a).includes("not kept"), "no bidder field is ever shown");
});

test("a use word filters the tendered uses; fewer than 5 awards give no range", () => {
  const p = parseAwards(RECORDS);
  const child = answerFromAwards(p, { use: "childcare", years: 11 });
  assert.equal(child.sample_size, 4);
  assert.equal(child.status, "insufficient_data");
  assert.equal(child.price, null);
  const none = answerFromAwards(p, { use: "zzzz" });
  assert.equal(none.status, "no_matches");
  const school = answerFromAwards(p, { use: "school", years: 11 });
  assert.equal(school.status, "ok");
  assert.ok(school.sample_size! >= 5);
});

test("allocation mode and year window", () => {
  const p = parseAwards(RECORDS);
  const tender = answerFromAwards(p, { allocation: "tender", years: 3 });
  assert.equal(tender.status, "ok");
  assert.deepEqual(tender.period, { from: "2023", to: "2025" });
  const auction = answerFromAwards(p, { allocation: "auction", years: 11 });
  assert.notEqual(auction.status, "ok"); // no auctions in the 2015-2025 file
});

test("input handling", async () => {
  const p = parseAwards(RECORDS);
  assert.throws(() => answerFromAwards(p, { allocation: "lottery" }), InputError);
  assert.throws(() => answerFromAwards(p, { use: "x" }), InputError);
  assert.throws(() => answerFromAwards(p, { years: 0 }), InputError);
  assert.throws(() => answerFromAwards(p, { years: 30 }), InputError);
  const a = await sgSlaRents({ years: 5 }, async () => RECORDS);
  assert.equal(a.status, "ok");
  assert.deepEqual(a.period, { from: "2021", to: "2025" });
});
