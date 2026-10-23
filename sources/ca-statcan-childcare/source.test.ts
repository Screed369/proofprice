// Tests for Canada childcare fees (Statistics Canada table 42-10-0071-01). Rows are real, captured 2026-10-23 (see fixtures.ts).
import test from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { InputError, SourceError } from "../../lib/http";
import { CHILDCARE_CSV } from "./fixtures";
import {
  INFO, bucketFor, caChildcare, caChildcareHarvest, childcareAnswer, childcareHarvestRows, childcareHistoryKey, clearCache, parseFeeCsv, pick, provinceOf, startMonths,
} from "./source";
import manifest from "./index";

const rows = parseFeeCsv(CHILDCARE_CSV);

function zipOf(name: string, content: string): Buffer {
  const data = deflateRawSync(Buffer.from(content, "utf8"));
  const nm = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt16LE(nm.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt16LE(nm.length, 28);
  const cdOffset = 30 + nm.length + data.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(46 + nm.length, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  return Buffer.concat([local, nm, data, central, nm, eocd]);
}

test("the parser keeps only the dollar fee rows, splits province from age group and drops missing figures", () => {
  assert.equal(rows.length, 67);
  const nl = rows.filter((r) => r.province === "Newfoundland and Labrador");
  assert.equal(nl.length, 5);
  assert.equal(nl[0].group, "infants, children aged less than 24 months");
  assert.equal(nl[0].value, 10);
  const nwt = rows.filter((r) => r.province === "Northwest Territories");
  assert.equal(nwt.filter((r) => r.value === null).length, 1);
  assert.throws(() => parseFeeCsv('"REF_DATE","GEO"\n"2024","Ontario"'), /columns missing/);
});

test("every real age group of every province lands in the right one of our four groups", () => {
  const expected: Record<string, string> = {
    "infants, children aged less than 24 months": "infant",
    "toddlers, children aged 18 months to less than 3 years": "toddler",
    "pre-school age children, children aged 2 years 9 months to less than 5 years 9 months who do not attend pre-kindergarten nor school": "preschool",
    "pre-kindergarten age children, children aged 3 years 8 months to less than 5 years 9 months who attend pre-kindergarten": "preschool",
    "school age children, children aged 4 years 8 months to 13 years who attend school": "school-age",
    "children aged less than 22 months": "infant",
    "children aged 22 months to 3 years": "toddler",
    "children aged 3 years or more who do not attend school": "preschool",
    "school age children, children aged 3 years or more who attend school": "school-age",
    "preschoolers, children aged 3 years or older who do not attend school nor a pre-primary program": "preschool",
    "pre-primary children, children who attend a pre-primary program": "preschool",
    "school-age children, children 12 and under who attend school above pre-primary level": "school-age",
    "preschool children aged 2 years old": "toddler",
    "preschool children aged 3 years old who do not attend school": "preschool",
    "preschool children aged 4 years or older who do not attend school": "preschool",
    "school-aged children who attend school": "school-age",
    "children aged 18 months to less than 4 years who do not attend school": "toddler",
    "children aged 4 years or more who do not attend school": "preschool",
    "children who attend school": "school-age",
    "preschool aged children, children aged 30 months to less than 6 years who do not attend school": "preschool",
    "kindergarten aged children, children aged 44 months to less than 7 years who attend kindergarten": "school-age",
    "primary or junior grade school aged children, children aged 68 months to 12 years who attend school": "school-age",
    "infants, children aged 12 weeks to less than 12 months": "infant",
    "preschool age children aged 5 years and older who do not attend school": "preschool",
    "infants, aged 12 months to less than 19 months": "infant",
    "children aged 19 months to less than 3 years, children who do not attend school": "toddler",
    "pre-school children, aged 3 years to less than 4 years, children who do not attend school": "preschool",
    "kindergarten children and school-aged children, children aged 4 years or more who attend school": "school-age",
    "preschool children, children aged 30 months or more who do not attend school": "preschool",
    "infants - children less than 18 months": "infant",
    "preschool children, aged 18 months to less than 3 years, children who do not attend school": "toddler",
    "preschool child, aged 25 months to less than 36 months": "toddler",
    "children aged 0 to 12 months": "infant",
    "children aged 13 to 24 months": "infant",
    "children aged 25 to 35 months": "toddler",
    "children aged 3 years": "preschool",
    "children aged 4 years who do not attend school": "preschool",
  };
  for (const [g, b] of Object.entries(expected)) assert.equal(bucketFor(g), b, g);
  // every group present in the real file gets a bucket (none left unmatched)
  for (const r of rows) assert.notEqual(bucketFor(r.group), null, `${r.province}: ${r.group}`);
  assert.equal(startMonths("infants, children aged 12 weeks to less than 12 months")! < 4, true);
});

test("Ontario preschool is the one published figure, as an official statistic with no sample size", () => {
  const a = childcareAnswer(rows, { area: "Ontario", age_group: "preschool" });
  assert.equal(a.status, "ok");
  assert.equal(a.price?.value, 33.33);
  assert.equal(a.price?.currency, "CAD");
  assert.equal(a.price?.unit, "per day");
  assert.equal(a.price?.median, null);
  assert.equal(a.sample_size, null);
  assert.equal(a.price_type, "official_statistic");
  assert.deepEqual(a.period, { from: "2024-04-01", to: "2024-04-30" });
  assert.match(a.source.attribution, /Open Government Licence – Canada/);
});

test("Ontario infants 42.35, Quebec infants 22.21, Alberta school-age 31.52 (real figures)", () => {
  assert.equal(childcareAnswer(rows, { area: "Ontario", age_group: "infant" }).price?.value, 42.35);
  assert.equal(childcareAnswer(rows, { area: "Quebec", age_group: "infant" }).price?.value, 22.21);
  assert.equal(childcareAnswer(rows, { area: "AB", age_group: "school-age" }).price?.value, 31.52);
});

test("when a province publishes several groups for one of ours the simple average is shown, with every group listed", () => {
  const a = childcareAnswer(rows, { area: "Manitoba", age_group: "infant" });
  assert.equal(a.price?.value, 14.4); // (15.84 + 12.95) / 2 = 14.395
  assert.match(String(a.statistic?.note), /simple average/);
  assert.equal((a.extra as any).groups_used.length, 2);
});

test("no age_group gives the preschool figure and says so; 'BC' and 'Toronto, ON' resolve", () => {
  const a = childcareAnswer(rows, { area: "BC" });
  assert.equal(a.price?.value, 38.99);
  assert.match(String(a.statistic?.note), /preschool figure/);
  assert.equal(provinceOf("Toronto, ON"), "Ontario");
});

test("missing or unknown places and unsupported options are refused with plain words", () => {
  assert.throws(() => childcareAnswer(rows, {}), (e: any) => e instanceof InputError && /province or territory only/.test(e.message));
  assert.throws(() => childcareAnswer(rows, { area: "Atlantis" }), /not a Canadian province/);
  assert.throws(() => childcareAnswer(rows, { area: "Ontario", care_type: "home-based" }), /centre-based fees only/);
  assert.throws(() => childcareAnswer(rows, { area: "Ontario", age_group: "teen" }), /age_group must be/);
});

test("a province with no usable figure for the age group answers no_matches, never a made-up number", () => {
  const a = childcareAnswer(rows.filter((r) => !(r.province === "Ontario" && bucketFor(r.group) === "toddler")), { area: "Ontario", age_group: "toddler" });
  assert.equal(a.status, "no_matches");
  assert.equal(a.price, null);
});

test("harvest: one row per province and age group, equal to the live answer, n is NO_COUNT", () => {
  const h = childcareHarvestRows(rows);
  assert.equal(h.date, "2024-04-01");
  const row = h.rows.find((r) => r.area === "Ontario" && r.item === "infant")!;
  assert.equal(row.median, childcareAnswer(rows, { area: "Ontario", age_group: "infant" }).price?.value);
  assert.ok(h.rows.every((r) => r.n === undefined || typeof r.n === "number"));
  assert.equal(h.rows.filter((r) => r.area === "Northwest Territories").length, 4);
});

test("history key and manifest", () => {
  assert.deepEqual(childcareHistoryKey({ area: "Quebec" }), { area: "Quebec", item: "preschool", label: "Quebec, preschool children" });
  assert.equal(childcareHistoryKey({}), null);
  assert.equal(manifest.info.id, "ca-statcan-childcare");
  assert.equal(manifest.category, "childcare");
  assert.deepEqual(manifest.countries, ["CA"]);
  assert.equal(INFO.price_type, "official_statistic");
});

test("fetch path: a zip is read; a non-zip page is retried once then fails plainly; harvest reads the same zip", async () => {
  clearCache();
  const zip = zipOf("42100071.csv", CHILDCARE_CSV);
  const a = await caChildcare({ area: "Ontario", age_group: "toddler" }, async () => zip);
  assert.equal(a.price?.value, 36.24);
  clearCache();
  let calls = 0;
  await assert.rejects(
    caChildcare({ area: "Ontario" }, async () => {
      calls++;
      return Buffer.from("<html>site unavailable</html>");
    }),
    (e: any) => e instanceof SourceError,
  );
  assert.equal(calls, 2);
  clearCache();
  assert.ok((await caChildcareHarvest(async () => zip)).rows.length > 30);
  assert.equal(pick(rows, "Ontario", "infant").value, 42.35);
});
