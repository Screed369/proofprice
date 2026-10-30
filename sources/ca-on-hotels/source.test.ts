import { test } from "node:test";
import assert from "node:assert/strict";
import { SourceError } from "../../lib/http";
import { INFO, caHotels, hotelAnswer, monthFiles, monthOf, parseHotelSheets, pickArea } from "./source";

// Fixtures: the CKAN package_show shape was proven by the Verifier on 2026-10-23 (resource urls follow mtcs-hotel-statistics-en-<mon>-<yy>.xlsx).
// The workbook rows below are the layout this reader EXPECTS (header text, not position). They were NOT copied from a real file: no workbook could be
// downloaded from the Builder workspace. The preview deployment shows the real layout (the error text lists it) and this fixture must then be replaced.
const PACKAGE = {
  success: true,
  result: {
    id: "947f4c51-7613-4279-9fd8-2e3d09be307a", name: "hotel-statistics", title: "Hotel statistics", license_id: "ontario.ca-tou", metadata_modified: "2026-10-05T10:00:00",
    resources: [
      { id: "a", name: "Hotel Statistics - November 2023 (English)", format: "XLSX", url: "https://data.ontario.ca/dataset/x/resource/a/download/mtcs-hotel-statistics-en-nov-23.xlsx" },
      { id: "b", name: "Hotel Statistics - August 2026 (English)", format: "XLSX", url: "https://data.ontario.ca/dataset/x/resource/b/download/mtcs-hotel-statistics-en-aug-26.xlsx" },
      { id: "c", name: "Hotel Statistics - August 2026 (French)", format: "XLSX", url: "https://data.ontario.ca/dataset/x/resource/c/download/mtcs-hotel-statistics-fr-aug-26.xlsx" },
      { id: "d", name: "Data dictionary", format: "PDF", url: "https://data.ontario.ca/dataset/x/resource/d/download/dict.pdf" },
    ],
  },
};
const SHEETS = [
  {
    name: "Hotel statistics",
    rows: [
      ["Ontario hotel statistics, August 2026"],
      [],
      ["Tourism region", "Occupancy rate (%)", "Average daily rate ($)", "Revenue per available room ($)"],
      ["Ontario", 71.2, 188.45, 134.18],
      ["Toronto", 78.9, 241.1, 190.2],
      ["Niagara", 74.0, 199.5, 147.63],
      ["Tiny place", 50, 0, 0],
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
  assert.deepEqual([f[0].year, f[0].month], [2026, 8]);
  assert.ok(!f.some((x) => x.url.includes("-fr-")));
});

test("ca-on-hotels: finds the header row by its text and reads areas", () => {
  const rows = parseHotelSheets(SHEETS);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], { area: "Ontario", adr: 188.45, occupancy: 71.2, revpar: 134.18 });
  assert.throws(() => parseHotelSheets([{ name: "x", rows: [["a", "b"], [1, 2]] }]), (e: unknown) => e instanceof SourceError && /layout not recognised/.test((e as Error).message));
});

test("ca-on-hotels: Ontario-wide by default, areas by name, unknown areas list the choices", () => {
  const rows = parseHotelSheets(SHEETS);
  assert.equal(pickArea(rows).row!.area, "Ontario");
  assert.equal(pickArea(rows, "toronto").row!.adr, 241.1);
  assert.equal(pickArea(rows, "Niagara Falls").row, null);
  assert.ok(pickArea(rows, "Atlantis").others.includes("Toronto"));
});

test("ca-on-hotels: end to end with fakes (answer is CAD per occupied room, August 2026)", async () => {
  const a = await caHotels({ area: "Toronto" }, { getJson: async () => PACKAGE, getFile: async () => Buffer.alloc(1), readBook: () => SHEETS });
  assert.equal(a.status, "ok");
  assert.equal(a.price!.currency, "CAD");
  assert.equal(a.price!.value, 241.1);
  assert.equal(a.price!.median, null);
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.period.to, "2026-08-31");
  assert.match(a.summary, /August 2026/);
});

test("ca-on-hotels: an unknown area is no_matches, not a guess", () => {
  const a = hotelAnswer(null, { url: "u", year: 2026, month: 8 }, { area: "Atlantis", others: ["Toronto"] });
  assert.equal(a.status, "no_matches");
  assert.match(a.summary, /Toronto/);
});
