import { test } from "node:test";
import assert from "node:assert/strict";
import { SourceError } from "../../lib/http";
import { INFO, caHotels, hotelAnswer, monthFiles, monthOf, parseHotelSheets, pickArea } from "./source";

// Fixtures: the CKAN package_show shape was proven by the Verifier on 2026-10-23 (resource urls follow mtcs-hotel-statistics-en-<mon>-<yy>.xlsx).
const PACKAGE = {
  success: true,
  result: {
    id: "947f4c51-7613-4279-9fd8-2e3d09be307a", name: "hotel-statistics", title: "Hotel statistics", license_id: "ontario.ca-tou", metadata_modified: "2026-10-05T10:00:00",
    resources: [
      { id: "a", name: "Hotel Statistics - November 2023 (English)", format: "XLSX", url: "https://data.ontario.ca/dataset/x/resource/a/download/mtcs-hotel-statistics-en-nov-23.xlsx" },
      { id: "b", name: "Hotel Statistics - July 2026 (English)", format: "XLSX", url: "https://data.ontario.ca/dataset/947f4c51-7613-4279-9fd8-2e3d09be307a/resource/fc3ed152-e484-47c6-974b-ee23bfaec67b/download/mtcg-hotel-statistics-en-july-26.xlsx" },
      { id: "c", name: "Hotel Statistics - July 2026 (French)", format: "XLSX", url: "https://data.ontario.ca/dataset/947f4c51-7613-4279-9fd8-2e3d09be307a/resource/c3e35191-44ba-4e84-8ea5-e49b94be9d96/download/mtcg-hotel-statistics-fr-july-26.xlsx" },
      { id: "d", name: "Data dictionary", format: "PDF", url: "https://data.ontario.ca/dataset/x/resource/d/download/dict.pdf" },
    ],
  },
};
// Real rows copied from mtcg-hotel-statistics-en-july-26.xlsx (sheet "Month over month comparison"), read through the probe on 2026-10-30.
// Columns: area | occupancy 2026, 2025, point change | (blank) | ADR 2026, 2025, % change | (blank) | RevPAR 2026, 2025, % change.
const SHEETS = [
  {
    name: "Month over month comparison",
    rows: [
      ["Hotel Statistics for Ontario, July 2026"],
      [null, "Occupancy Percentage", null, null, null, "Average Daily Rate", null, null, null, "Revenue Per Available Room"],
      [null, 2026, 2025, "Point Change", null, 2026, 2025, "% Change", null, 2026, 2025, "% Change"],
      ["ONTARIO", 0.78268334105967696, 0.78103567213787695, 0.16476689218003501, null, 233.42835830510501, 222.401822863441, 0.04957934, null, 182.70048737631501, 173.70375720483699, 0.05179353],
      [],
      ["Greater Toronto Area ", 0.81047632790442103, 0.83171937502483695, -2.1243047120415701, null, 262.51634617137802, 246.32479563921899, 0.06573252, null, 212.763284259865, 204.873105082172, 0.03851252],
      ["Downtown Toronto", 0.82504585803464203, 0.85290114523956695, -2.7855287204925498, null, 384.80375822019101, 356.24221415617598, 0.08017451, null, 317.48074687573302, 303.839392436482, 0.0448966],
      ["Toronto Airport", 0.79550693209229795, 0.83096452317008196, -3.5457591077783701, null, 196.36792614645699, 181.82414177117101, 0.07998819, null, 156.21204649009499, 151.08941126769099, 0.03390466],
      [],
      ["Niagara Falls", 0.87245994029406604, 0.85498681618560002, 1.7473124108465701, null, 280.17147943248801, 281.18336087193001, -0.0035986529999999998, null, 244.43839221776901, 240.408066476258, 0.01676452],
      ["Other Niagara Region", 0.835869097172384, 0.80075383648927601, 3.5115260683108298, null, 251.34498154031101, 239.47249742233399, 0.049577650000000001, null, 210.091502798909, 191.75852104460199, 0.09560469],
      ["North Central Ontario"],
      ["Sault Ste. Marie", 0.74523350987000503, 0.82267693789118901, -7.7443428021184397, null, 169.186193752625, 154.21928951834701, 0.097049499999999999, null, 126.083220991815, 126.872652864709, -0.0062222379999999998],
      ["SOURCE:  CBRE Limited with reproduction and use of information subject to CBRE Disclaimer and Restrictions as detailed at:"],
    ],
  },
];

test("ca-on-hotels: the licence is Ontario's terms and the price is an official statistic", () => {
  assert.equal(INFO.id, "ca-on-hotels");
  assert.equal(INFO.price_type, "official_statistic");
  assert.match(INFO.licence, /Terms of Use/);
  assert.match(INFO.limits, /not a quote/);
});

test("ca-on-hotels: month from file names; newest English workbook first", () => {
  assert.deepEqual(monthOf("mtcs-hotel-statistics-en-nov-23.xlsx"), { year: 2023, month: 11 });
  assert.deepEqual(monthOf("Hotel Statistics - August 2026 (English)"), { year: 2026, month: 8 });
  const f = monthFiles(JSON.parse(JSON.stringify(PACKAGE.result.resources.map((r) => ({ ...r }))), (k, v) => v).map((r: any) => ({ ...r, datastoreActive: false, modified: null, mimetype: null })));
  assert.equal(f.length, 2);
  assert.deepEqual([f[0].year, f[0].month], [2026, 7]);
  assert.ok(!f.some((x) => x.url.includes("-fr-")));
});

test("ca-on-hotels: finds the header row by its text and reads areas", () => {
  const rows = parseHotelSheets(SHEETS);
  assert.equal(rows.length, 7); // blank separator rows, the empty North Central Ontario row and the CBRE credit line are skipped
  assert.equal(rows[0].area, "ONTARIO");
  assert.equal(rows[0].adr, 233.42835830510501);
  assert.equal(rows[0].occupancy, 78.3);
  assert.equal(rows[0].revpar, 182.70048737631501);
  assert.ok(rows.some((r) => r.area === "Greater Toronto Area"));
  assert.throws(() => parseHotelSheets([{ name: "x", rows: [["a", "b"], [1, 2]] }]), (e: unknown) => e instanceof SourceError && /layout not recognised/.test((e as Error).message));
});

test("ca-on-hotels: Ontario-wide by default, areas by name, unknown areas list the choices", () => {
  const rows = parseHotelSheets(SHEETS);
  assert.equal(pickArea(rows).row!.area, "ONTARIO");
  assert.equal(pickArea(rows, "toronto").row!.adr, 262.51634617137802); // Toronto means the Greater Toronto Area row
  assert.equal(pickArea(rows, "Downtown Toronto").row!.adr, 384.80375822019101);
  assert.equal(pickArea(rows, "Niagara Falls").row!.adr, 280.17147943248801);
  assert.equal(pickArea(rows, "Niagara").row, null); // two Niagara rows: ask which
  assert.ok(pickArea(rows, "Atlantis").others.includes("Toronto Airport"));
});

test("ca-on-hotels: end to end with fakes (answer is CAD per occupied room, July 2026)", async () => {
  const a = await caHotels({ area: "Toronto" }, { getJson: async () => PACKAGE, getFile: async () => Buffer.alloc(1), readBook: () => SHEETS });
  assert.equal(a.status, "ok");
  assert.equal(a.price!.currency, "CAD");
  assert.equal(a.price!.value, 262.52); // rounded to cents
  assert.equal(a.price!.median, null);
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.period.to, "2026-07-31");
  assert.match(a.summary, /July 2026/);
});

test("ca-on-hotels: an unknown area is no_matches, not a guess", () => {
  const a = hotelAnswer(null, { url: "u", year: 2026, month: 7 }, { area: "Atlantis", others: ["Toronto Airport"] });
  assert.equal(a.status, "no_matches");
  assert.match(a.summary, /Toronto Airport/);
});
