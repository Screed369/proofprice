// Fixture: rows copied from the live files of auction 18/2026 (probes hkgld-res and hkgld-list, 2026-10-29), plus synthetic lots.
import { test } from "node:test";
import assert from "node:assert/strict";
import { classify, parseCsv, parseDate, parseAuction, dailyRows, groupFor, hkKey, hkHistoryKey, hkAnswerFromRow, resultUrl, listUrl } from "./source";

const RESULT =
  "﻿Date of Auction,Auction List No.,Lot No.,Transaction Price (HK$)\n" +
  "08/10/2026,18/2026,C-401,16000.0\n08/10/2026,18/2026,C-402,16000.0\n08/10/2026,18/2026,C-403,28000.0\n" +
  "08/10/2026,18/2026,C-408,7000.0\n08/10/2026,18/2026,C-409,14000.0\n08/10/2026,18/2026,C-410,100.0\n" +
  "08/10/2026,18/2026,C-411,5000.0\n08/10/2026,18/2026,C-414,3150000.0\n08/10/2026,18/2026,C-499,0.0\n";
const LIST =
  "﻿Date of Auction,Auction List No.,Lot No.,Description,Quantity,Unit\n" +
  `08/10/2026,18/2026,C-401,"Used 40' Container\n(No.: MANU8791025)",1,No.\n` +
  `08/10/2026,18/2026,C-402,"Used 40' Container\n(No.: TSLU0540820)",1,No.\n` +
  `08/10/2026,18/2026,C-403,"Used Light Goods Vehicle (without Key)\nBrand: Kia\nModel: K2500 CRDI EX M/T \nRegistration Mark: YY3961\nChassis No.: TD2017104\nYear of Manufacture: 2013 ",1,No.\n` +
  `08/10/2026,18/2026,C-408,"Used Private Car (without Key)\nRegistration Mark: UD3749\nBrand: Lexus",1,No.\n` +
  `08/10/2026,18/2026,C-409,"Used Private Car (without Key)\nRegistration Mark: ZB3217\nBrand: Toyota",1,No.\n` +
  "08/10/2026,18/2026,C-410,Bicycle,58,Nos.\n" +
  "08/10/2026,18/2026,C-411,\"Electric Pallet Truck (Brand: EP, Model No.: EPT20-15ET2MAX) (without Key)\",1,No.\n" +
  "08/10/2026,18/2026,C-411,Manual Pallet Truck,1,No.\n" +
  "08/10/2026,18/2026,C-414,\"Integrated Circuit (Approx. 1,447,683 Nos.)\",1,Lot\n" +
  `08/10/2026,18/2026,C-499,"Used Private Car (without Key)\nRegistration Mark: AA1",1,No.\n`;

test("csv with line breaks inside quotes stays one row; dates are day/month/year", () => {
  const rows = parseCsv(LIST);
  assert.equal(rows.length, 11);
  assert.match(rows[3][3], /Registration Mark: YY3961/);
  assert.equal(parseDate("08/1/2026"), "2026-01-08");
  assert.equal(parseDate("08/10/2026"), "2026-10-08");
  assert.equal(parseDate("32/1/2026"), null);
  assert.equal(parseDate("nonsense"), null);
});
test("classify reads only the first line of the description", () => {
  assert.equal(classify("Used Private Car (with Key) (Damaged)\nMake: TOYOTA"), "private-cars");
  assert.equal(classify("Used Medium Goods Vehicle (without Key)\nBrand: Jac"), "goods-vehicles");
  assert.equal(classify("Used 40' Container\n(No.: X)"), "containers");
  assert.equal(classify("Used Motor Cycle (without Key)"), "motorcycles");
  assert.equal(classify("Bicycle"), null);
  assert.equal(classify("Electric Pallet Truck (without Key)"), null);
});
test("parseAuction joins the files; multi-row lots, quantity over 1, unknown groups and zero prices drop out", () => {
  const s = parseAuction(RESULT, LIST);
  assert.deepEqual(s.map((x) => [x.group, x.date, x.price]), [
    ["containers", "2026-10-08", 16000], ["containers", "2026-10-08", 16000], ["goods-vehicles", "2026-10-08", 28000],
    ["private-cars", "2026-10-08", 7000], ["private-cars", "2026-10-08", 14000],
  ]);
  assert.ok(!JSON.stringify(s).includes("Registration"));
  assert.throws(() => parseAuction("a,b\n1,2", LIST));
});
test("dailyRows: windows, nothing under 5 lots", () => {
  const sales = [1000, 2000, 3000, 4000, 5000, 6000].map((price, i) => ({ group: "private-cars" as const, date: `2026-09-0${i + 1}`, price }))
    .concat([{ group: "private-cars" as const, date: "2025-01-05", price: 99999 }, { group: "containers" as const, date: "2026-09-01", price: 1 }]);
  const { date, rows } = dailyRows(sales);
  assert.equal(date, "2026-09-06");
  assert.equal(rows.find((r) => r.item === "private-cars:12m")!.n, 6);
  assert.equal(rows.find((r) => r.item === "private-cars:12m")!.median, 3500);
  assert.equal(rows.find((r) => r.item === "private-cars:24m")!.n, 7);
  assert.ok(!rows.some((r) => r.item.startsWith("containers")));
});
test("requests map to library keys and urls", () => {
  assert.equal(groupFor("Car"), "private-cars");
  assert.equal(groupFor("shipping container"), "containers");
  assert.equal(groupFor("banana"), null);
  assert.deepEqual(hkKey({ what: "van", months: 20 }), { area: "ALL", item: "goods-vehicles:24m", group: "goods-vehicles", months: 24 });
  assert.equal(hkKey({ what: "banana" }), null);
  assert.equal(hkHistoryKey({ what: "container" })!.item, "containers:12m");
  assert.equal(resultUrl(18, 2026), "https://www.gld.gov.hk/datagovhk/supplies-mgmt/auctionResult_18-2026_EN.csv");
  assert.equal(listUrl(1, 2026), "https://www.gld.gov.hk/datagovhk/supplies-mgmt/auctionList_1-2026_EN.csv");
});
test("answer from a library row says what it is", () => {
  const a = hkAnswerFromRow({ date: "2026-10-22", area: "ALL", item: "private-cars:12m", n: 30, median: 14000, low: 3000, high: 60000, min: 500, max: 90000 }, { group: "private-cars", months: 12 });
  assert.equal(a.price?.currency, "HKD");
  assert.equal(a.price?.median, 14000);
  assert.match(a.summary, /not retail prices/);
  assert.match(JSON.stringify(a), /DATA\.GOV\.HK/);
});
