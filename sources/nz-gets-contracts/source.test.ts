import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRows, itemFor, nzAnswer, nzHistoryKey, parseAwards, parseCsv, parseNzDate, topicsOf, windowFrom, INFO } from "./source";
import { InputError } from "../../lib/http";

// Header and rows copied from the live file gets-award-notices.csv (probed 2026-10-20 by the Verifier from GitHub's servers); values shortened
// where the publisher's text is long. Note the BOM, the trailing space in "Awarded Date ", the text NULL, d/mm/yyyy dates and a quoted field with a line break.
const HEADER =
  "Posting Agency,RFx ID,RFx Type,Competition Type,Title,Reference Number,Open Date,Close Date,Awarded Date ,Department,Tender Coverage,Prequalification Required?,Alternative Physical Tender Box Delivery Address,Overview,Award Type,Comments,Awarded Amount,Report Date";
const line = (agency: string, title: string, awarded: string, type: string, amount: string, overview = "NULL") =>
  `${agency},1234,Request for Proposals,Open Competition,"${title}",REF1,30/09/2015,30/10/2015,${awarded},NULL,All of Government,No,NULL,"${overview}",${type},NULL,${amount},20260715`;
const FILE =
  "﻿" +
  [
    HEADER,
    line("Auckland Council", "Research on solid waste composition (SWAPs)", "16/08/2020", "Awarded", "95682"),
    line("Museum of New Zealand Te Papa Tongarewa", "Te Papa - Generator Upgrade RFP", "17/02/2020", "Awarded", "98000"),
    line("NZ on Air", "NZ CHILDREN'S MEDIA USE SURVEY", "13/05/2025", "Awarded", "213370", "Survey of children\nand media"),
    line("Auckland Council", "Supply of laptops", "1/03/2026", "Awarded", "0"),
    line("Auckland Council", "Supply of laptops", "1/03/2026", "Not Awarded", "0"),
    line("Auckland Council", "Supply of laptops", "01/13/2026", "Awarded", "5000"),
    line("Auckland Council", "Supply of laptops", "1/03/2095", "Awarded", "5000"),
  ].join("\n");

test("CSV: BOM, quoted line breaks and doubled quotes are handled", () => {
  const rows = parseCsv(FILE);
  assert.equal(rows[0][0], "Posting Agency");
  assert.equal(rows[3][13], "Survey of children\nand media");
  assert.deepEqual(parseCsv('a,"b ""q"" c",d\r\n1,2,3\r\n'), [["a", 'b "q" c', "d"], ["1", "2", "3"]]);
});

test("dates are day first", () => {
  assert.equal(parseNzDate("17/02/2020"), "2020-02-17");
  assert.equal(parseNzDate("1/3/2026"), "2026-03-01");
  assert.equal(parseNzDate("01/13/2026"), null);
  assert.equal(parseNzDate("NULL"), null);
});

test("only awarded rows with a real date and a plausible amount are kept (header has a trailing space on Awarded Date)", () => {
  const r = parseAwards(FILE, new Date("2026-10-21T00:00:00Z"));
  assert.deepEqual(r.awards.map((a) => [a.agency, a.date, a.value]), [
    ["Auckland Council", "2020-08-16", 95682],
    ["Museum of New Zealand Te Papa Tongarewa", "2020-02-17", 98000],
    ["NZ on Air", "2025-05-13", 213370],
  ]);
  assert.equal(r.skipped, 3); // amount 0, bad month, future year; the Not Awarded row is not counted
});

test("a changed header fails loudly instead of answering from the wrong column", () => {
  assert.throws(() => parseAwards("Agency,Value\nx,1\n"), /changed format/);
});

test("purchase words are found in titles as whole words, plurals allowed", () => {
  assert.deepEqual(topicsOf("Supply of laptops to schools"), ["laptops"]);
  assert.deepEqual(topicsOf("Business case for new bus network"), ["buses"]);
  assert.ok(topicsOf("Office cleaning services 2025").includes("office-cleaning"));
  assert.deepEqual(topicsOf("Generator Upgrade RFP"), []);
});

const mk = (agency: string, title: string, date: string, n: number, base: number) =>
  Array.from({ length: n }, (_, i) => ({ agency, title, date, value: base + i * 1000 }));

test("library rows: windowed, per agency and purchase, ALL row, nothing under 5 is a figure", () => {
  const awards = [
    ...mk("Auckland Council", "Supply of laptops", "2026-03-10", 6, 1000),
    ...mk("Auckland Council", "Park maintenance", "2026-06-30", 5, 50000),
    ...mk("Old Agency", "Supply of laptops", "2022-01-10", 9, 1000), // outside the 24 months
    ...mk("Small Agency", "Supply of laptops", "2026-02-01", 2, 1000),
  ];
  const b = buildRows(awards);
  assert.equal(b.date, "2026-06-30");
  assert.equal(b.used, 13);
  const get = (area: string, item: string) => b.rows.find((r) => r.area === area && r.item === item);
  assert.equal(get("ALL", "laptops")?.n, 8);
  assert.equal(get("Auckland Council", "laptops")?.n, 6);
  assert.equal(get("Auckland Council", "all")?.n, 11);
  assert.equal(get("Old Agency", "all"), undefined);
  assert.equal(get("Small Agency", "laptops")?.n, 2); // kept here, dropped by writeDaily (below 5)
  assert.equal(windowFrom("2026-06-30"), "2024-06-30");
});

const LIB = {
  date: "2026-06-30",
  rows: [
    { area: "ALL", item: "all", n: 9000, median: 120000, low: 20000, high: 900000, min: 100, max: 90000000 },
    { area: "ALL", item: "laptops", n: 12, median: 85000, low: 20000, high: 400000, min: 5000, max: 900000 },
    { area: "Auckland Council", item: "all", n: 300, median: 150000, low: 25000, high: 1200000, min: 500, max: 5000000 },
    { area: "Auckland Transport", item: "all", n: 200, median: 200000, low: 30000, high: 1500000, min: 500, max: 5000000 },
    { area: "Auckland Council", item: "laptops", n: 5, median: 60000, low: 30000, high: 90000, min: 30000, max: 90000 },
  ],
};

test("answer: whole country, a purchase, an agency", () => {
  const a = nzAnswer(LIB, { what: "all" });
  assert.equal(a.status, "ok");
  assert.equal(a.price?.median, 120000);
  assert.equal(a.price?.currency, "NZD");
  assert.equal(a.sample_size, 9000);
  assert.match(a.summary, /not unit prices/);
  const l = nzAnswer(LIB, { what: "laptops" });
  assert.equal(l.price?.median, 85000);
  const c = nzAnswer(LIB, { what: "laptop computers", buyer_area: "auckland council" });
  assert.equal(c.price?.median, 60000);
  const m = nzAnswer(LIB, { what: "all", buyer_area: "Auckland" });
  assert.equal(m.price?.median, 150000); // most awards of the two matching agencies
  assert.match(m.summary, /2 agencies matched/);
});

test("answer: too few awards gives no figure, unknown purchase and CPV give clear 400s", () => {
  const none = nzAnswer(LIB, { what: "ambulances" });
  assert.notEqual(none.status, "ok");
  assert.equal(none.price, null);
  assert.throws(() => nzAnswer(LIB, { what: "blockchain consulting for yaks" }), (e: any) => e instanceof InputError && /laptops/.test(e.message));
  assert.throws(() => nzAnswer(LIB, { what: "laptops", cpv: "30213100" }), InputError);
  assert.throws(() => nzAnswer(LIB, { what: "all", buyer_area: "Ministry of Nonsense" }), InputError);
});

test("history key and licence", () => {
  assert.deepEqual(nzHistoryKey({ what: "laptops" }), { area: "ALL", item: "laptops", label: "New Zealand, laptops" });
  assert.equal(nzHistoryKey({ what: "laptops", buyer_area: "x" }), null);
  assert.equal(itemFor("zzz"), null);
  assert.match(INFO.licence, /CC BY 4.0/);
});
