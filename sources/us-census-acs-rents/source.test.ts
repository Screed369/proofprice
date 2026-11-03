import { test } from "node:test";
import assert from "node:assert/strict";
import {
  geoOf, geoRows, INFO, ITEM, NATIONAL_AREA, parseRentLines, geoFileUrl, rentFileUrl, resolveArea, stateName, usRent, usRentAnswer, usRentHarvest,
  usRentHistoryKey, type Snapshot,
} from "./source";
import { InputError, SourceError } from "../../lib/http";

// FIXTURES. The B25064 header and the first rows are copied from the live 2024 file (GET from GitHub Actions on 2026-11-03):
//   GEO_ID|B25064_E001|B25064_M001 / 0100000US|1413|2 / 0100090US|488|268 ...   (-666666666 and -222222222 are the Bureau's "no estimate" codes)
// The geography header is the live Geos20245YR.txt header (43 columns). Rows below keep its column layout; names follow the Bureau's
// "<name> <kind>, <state>" form (rent figures other than the first rows are illustrative) (the collector refuses a file that has too few states or counties, so a wrong layout cannot be stored silently).
const GEO_HEADER =
  "FILEID|STUSAB|SUMLEVEL|COMPONENT|US|REGION|DIVISION|STATE|COUNTY|COUSUB|PLACE|TRACT|BLKGRP|CONCIT|AIANHH|AIANHHFP|AIHHTLI|AITS|AITSFP|ANRC|CBSA|CSA|METDIV|MACC|MEMI|NECTA|CNECTA|NECTADIV|UA|CDCURR|SLDU|SLDL|ZCTA5|SUBMCD|SDELM|SDSEC|SDUNI|UR|PCI|PUMA5|GEO_ID|NAME|BTTR|BTBG|TL_GEO_ID";
const cols = GEO_HEADER.split("|");
function geo(level: string, component: string, id: string, name: string): string {
  const c = cols.map(() => "");
  c[cols.indexOf("FILEID")] = "ACSSF";
  c[cols.indexOf("SUMLEVEL")] = level;
  c[cols.indexOf("COMPONENT")] = component;
  c[cols.indexOf("GEO_ID")] = id;
  c[cols.indexOf("NAME")] = name;
  return c.join("|");
}
const GEOS = [
  GEO_HEADER,
  geo("010", "00", "0100000US", "United States"),
  geo("010", "90", "0100090US", "United States -- American Indian Reservation and Trust Land -- State"),
  geo("040", "00", "0400000US48", "Texas"),
  geo("040", "00", "0400000US06", "California"),
  geo("050", "00", "0500000US48453", "Travis County, Texas"),
  geo("050", "00", "0500000US06037", "Los Angeles County, California"),
  geo("160", "00", "1600000US4805000", "Austin city, Texas"),
  geo("160", "00", "1600000US2702116", "Austin city, Minnesota"),
  geo("160", "00", "1600000US3651000", "New York city, New York"),
  geo("160", "00", "1600000US4899999", "Tiny CDP, Texas"),
  geo("160", "C1", "1600000US4805000", "Austin city, Texas (component)"),
];
const RENT = [
  "GEO_ID|B25064_E001|B25064_M001",
  "0100000US|1413|2",
  "0100090US|488|268",
  "0400000US48|1303|3",
  "0400000US06|1862|4",
  "0500000US48453|1561|9",
  "0500000US06037|1850|9",
  "1600000US4805000|1535|11",
  "1600000US2702116|861|150",
  "1600000US3651000|1790|8",
  "1600000US4899999|-666666666|-222222222",
];
const figs = parseRentLines(RENT);
const { rows, levels } = geoRows(GEOS, figs);

function snapshot(): Snapshot {
  const m = new Map(rows.map((r) => [r.area, { median: r.median, lo: r.min, hi: r.max }]));
  return { date: "2024-12-31", note: null, rows: m, areas: [...m.keys()] };
}

test("INFO: official statistic, free-tier licence wording, attribution", () => {
  assert.equal(INFO.id, "us-census-acs-rents");
  assert.equal(INFO.price_type, "official_statistic");
  assert.match(INFO.attribution, /U\.S\. Census Bureau/);
  assert.match(INFO.attribution, /not endorsed/);
  assert.match(rentFileUrl(2024), /acsdt5y2024-b25064\.dat$/);
  assert.match(geoFileUrl(2024), /Geos20245YR\.txt$/);
});

test("rent file: header checked, no-estimate codes dropped, margin of error kept", () => {
  assert.equal(figs.size, 9);
  assert.deepEqual(figs.get("0100000US"), { estimate: 1413, moe: 2 });
  assert.equal(figs.has("1600000US4899999"), false);
  assert.throws(() => parseRentLines(["GEO_ID|X|Y", "a|1|2"]), SourceError);
  assert.throws(() => parseRentLines([]), SourceError);
});

test("geography file: only whole-area rows of the four levels with a figure", () => {
  assert.deepEqual(levels, { country: 1, state: 2, county: 2, place: 3 });
  assert.equal(rows.length, 8);
  const austin = rows.find((r) => r.area === "Austin city, Texas")!;
  assert.equal(austin.item, ITEM);
  assert.ok(Number.isNaN(austin.n));
  assert.equal(austin.median, 1535);
  assert.equal(austin.min, 1524);
  assert.equal(austin.max, 1546);
  assert.equal(rows.some((r) => /component|Reservation/.test(r.area)), false);
  assert.throws(() => geoRows(["A|B", "1|2"], figs), SourceError);
});

test("names: states, counties and places are told apart", () => {
  assert.equal(stateName("tx"), "Texas");
  assert.equal(stateName("New  York"), "New York");
  assert.equal(stateName("Atlantis"), null);
  assert.deepEqual(geoOf("Austin city, Texas"), { area: "Austin city, Texas", level: "place", base: "Austin", kind: "city", state: "Texas" });
  assert.equal(geoOf("Travis County, Texas").level, "county");
  assert.equal(geoOf("Texas").level, "state");
});

test("resolve: state, county, city with state, aliases, ambiguity and errors", () => {
  const areas = snapshot().areas;
  assert.equal(resolveArea(areas, undefined).area, NATIONAL_AREA);
  assert.equal(resolveArea(areas, "TX").area, "Texas");
  assert.equal(resolveArea(areas, "california").area, "California");
  assert.equal(resolveArea(areas, "Austin, Texas").area, "Austin city, Texas");
  assert.equal(resolveArea(areas, "Austin, MN").area, "Austin city, Minnesota");
  assert.equal(resolveArea(areas, "Travis County, Texas").area, "Travis County, Texas");
  assert.equal(resolveArea(areas, "Travis, TX").area, "Travis County, Texas");
  assert.equal(resolveArea(areas, "NYC").area, "New York city, New York");
  assert.equal(resolveArea(areas, "United States").area, NATIONAL_AREA);
  assert.throws(() => resolveArea(areas, "Austin"), (e: any) => e instanceof InputError && /Add the state/.test(e.message));
  assert.throws(() => resolveArea(areas, "Austin, Narnia"), InputError);
  assert.throws(() => resolveArea(areas, "Gotham, Texas"), (e: any) => e instanceof InputError && /Austin, Texas/.test(e.message));
});

test("answer: official statistic with the survey years, interval and no sample size", () => {
  const a = usRentAnswer(snapshot(), { town: "Austin, Texas" });
  assert.equal(a.status, "ok");
  assert.equal(a.price?.median, 1535);
  assert.equal(a.price?.unit, "per month");
  assert.equal(a.price?.currency, "USD");
  assert.equal(a.sample_size ?? null, null);
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.statistic?.reference_period, "2020-2024");
  assert.equal((a.extra as any).margin_of_error_90, 11);
  assert.match(a.summary, /Austin city, Texas/);
  assert.match(a.summary, /not an asking rent/);
});

test("answer: bedrooms asked -> says the table has no split; wide margin flagged; national by default", () => {
  const a = usRentAnswer(snapshot(), { town: "Austin, Minnesota", bedrooms: 2 });
  assert.match(a.statistic?.note ?? "", /does not split by bedrooms/);
  assert.match(a.statistic?.note ?? "", /margin of error is wide/);
  const n = usRentAnswer(snapshot(), {});
  assert.equal(n.price?.median, 1413);
});

test("usRent: asks the library; an empty library is a clear source error", async () => {
  await assert.rejects(() => usRent({ town: "Texas" }, null), /not been collected yet/);
  const a = await usRent({ town: "Texas" }, snapshot());
  assert.equal(a.price?.median, 1303);
});

test("history key follows the same place resolution", () => {
  const areas = snapshot().areas;
  assert.deepEqual(usRentHistoryKey({ town: "Austin, Texas" }, areas), { area: "Austin city, Texas", item: ITEM, label: "Austin city, Texas" });
  assert.equal(usRentHistoryKey({ town: "Nowhere, Texas" }, areas), null);
  assert.equal(usRentHistoryKey({}, []), null);
});

// ---------- harvest ----------
function deps(files: Record<string, string[] | number>) {
  const asked: string[] = [];
  return {
    asked,
    d: {
      now: () => new Date("2026-11-03T03:17:00Z"),
      lines: (url: string) => {
        asked.push(url);
        const f = files[url];
        if (typeof f === "number") throw new SourceError(`HTTP ${f}`, url, f);
        if (!f) throw new SourceError("HTTP 404", url, 404);
        return (async function* () { for (const l of f) yield l; })();
      },
    },
  };
}

// A full-size fake release: 1 country, 51 states, 1,200 counties, so the sanity gate passes.
function bigRelease() {
  const g = [GEO_HEADER, geo("010", "00", "0100000US", "United States")];
  const r = ["GEO_ID|B25064_E001|B25064_M001", "0100000US|1413|2"];
  for (let i = 0; i < 52; i++) { g.push(geo("040", "00", `0400000US${i}`, `State ${i}`)); r.push(`0400000US${i}|1000|5`); }
  for (let i = 0; i < 1200; i++) { g.push(geo("050", "00", `0500000US${i}`, `County ${i}, State 1`)); r.push(`0500000US${i}|900|20`); }
  return { g, r };
}

test("harvest: newest release wins; date is the survey end so a rerun replaces the same day", async () => {
  const { g, r } = bigRelease();
  const { asked, d } = deps({ [rentFileUrl(2025)]: 404, [rentFileUrl(2024)]: r, [geoFileUrl(2024)]: g });
  const out = await usRentHarvest(d);
  assert.equal(out.date, "2024-12-31");
  assert.equal(out.currency, "USD");
  assert.equal(out.unit, "per month");
  assert.equal(out.rows.length, 1 + 52 + 1200);
  assert.deepEqual(asked, [rentFileUrl(2025), rentFileUrl(2024), geoFileUrl(2024)]);
});

test("harvest: a release that looks incomplete is refused; other errors surface", async () => {
  const { d } = deps({ [rentFileUrl(2025)]: ["GEO_ID|B25064_E001|B25064_M001", "0100000US|1413|2"], [geoFileUrl(2025)]: GEOS });
  await assert.rejects(() => usRentHarvest(d), /looks incomplete/);
  const { d: d2 } = deps({ [rentFileUrl(2025)]: 500 });
  await assert.rejects(() => usRentHarvest(d2), /HTTP 500/);
  const { d: d3 } = deps({});
  await assert.rejects(() => usRentHarvest(d3), /No ACS 5-year B25064 file found/);
});
