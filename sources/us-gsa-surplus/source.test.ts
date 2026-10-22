// Fixture copied from the live file on 2026-10-21 (header and first rows), plus synthetic sold vehicle lots.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsvRows, parseLots, matchLots, auctionPrices } from "./source";

const HEAD = "id,title,category,condition,seller_type,state,city,zip,currency,starting_bid,current_or_final_bid,bid_count,buyer_premium_pct,sold,ended_at,source_url";
const REAL = [
  HEAD,
  "gsa-1-1-QSC-I-26-184-003,FLUKE ELECTROSURGERY ANALYZER,medical-scientific,As-is,federal,MA,BEDFORD,01730,USD,,2105,3,0,true,2026-05-06,https://www.gsaauctions.gov/auctions/preview/362351",
  "gsa-1-1-QSC-I-26-184-007,Floor Scrubber Pads and Cleaning Supplies,medical-scientific,As-is,federal,WI,ZABLOCKI VA MEDICAL CTR,53295,USD,,,0,0,false,2026-05-06,https://www.gsaauctions.gov/auctions/preview/362354",
  'x-1,"TRUCK, PICKUP ""F150""",vehicles,As-is,federal,TX,AUSTIN,78701,USD,,4100,5,0,true,2026-09-01,https://x',
].join("\r\n");

function vehicles(): string {
  const rows = [HEAD];
  [3000, 4000, 5000, 6000, 7000, 8000].forEach((b, i) => rows.push(`v${i},SEDAN ${i},vehicles,As-is,federal,TX,A,1,USD,,${b},2,0,true,2026-09-0${i + 1},u`));
  return rows.join("\n");
}

test("parses quoted cells and keeps only sold lots with a bid", () => {
  assert.equal(parseCsvRows(REAL)[3][1], 'TRUCK, PICKUP "F150"');
  const lots = parseLots(REAL);
  assert.deepEqual(lots.map((l) => l.bid), [2105, 4100]);
  assert.equal(lots[0].category, "medical-scientific");
  assert.equal(lots[0].state, "MA");
  assert.equal(lots[0].endedAt, "2026-05-06");
});
test("rejects a file with a different header", () => {
  assert.throws(() => parseLots("a,b\n1,2"));
});
test("matches by group slug, by title words and by state", () => {
  const lots = parseLots(vehicles());
  assert.equal(matchLots(lots, "vehicles").length, 6);
  assert.equal(matchLots(lots, "sedan 3").length, 1);
  assert.equal(matchLots(lots, "vehicles", "ca").length, 0);
});
test("gives a range for six sold lots and labels it", async () => {
  const a = await auctionPrices({ what: "vehicles", months: 12 }, parseLots(vehicles()));
  assert.equal(a.status, "ok");
  assert.equal(a.sample_size, 6);
  assert.equal(a.price?.median, 5500);
  assert.equal(a.price?.unit, "per lot");
  assert.equal(a.source.licence, "CC BY 4.0");
});
test("refuses a figure under 5 lots", async () => {
  const a = await auctionPrices({ what: "sedan", months: 12, state: "TX" }, parseLots(vehicles()).slice(0, 3));
  assert.equal(a.status, "insufficient_data");
  assert.equal(a.price, null);
});

test("the figure is called a winning bid level, not a recorded sale; licence and attribution follow CC BY 4.0", async () => {
  const { INFO } = await import("./source");
  const a = await auctionPrices({ what: "vehicles", months: 12 }, parseLots(vehicles()));
  assert.equal(a.evidence!.label, "Auction final bids (winning bid level)");
  assert.match(a.evidence!.meaning, /not a confirmed completed sale/);
  assert.doesNotMatch(a.evidence!.meaning, /official records/);
  assert.match(a.summary, /final \(winning\) bid/);
  assert.match(a.summary, /not a confirmed sale price/);
  assert.equal(INFO.licence, "CC BY 4.0");
  assert.equal(INFO.licence_url, "https://creativecommons.org/licenses/by/4.0/");
  assert.match(INFO.attribution, /GovAuctions \(https:\/\/govauctions\.app\)/);
  assert.match(INFO.attribution, /changed/);
});
