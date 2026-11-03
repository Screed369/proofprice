// Fixtures copied from the live Census files, checked 2026-11-03 (GitHub probe): table b25064 first lines, Geos20245YR.txt header and rows.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
// Tiny expect() so the assertions read plainly (the repo's runner is node:test).
const expect = (v: any) => ({
  toBe: (x: any) => assert.equal(v, x),
  toEqual: (x: any) => assert.deepEqual(v, x),
  toBeNull: () => assert.equal(v, null),
  toContain: (x: any) => assert.ok(v.includes(x), `${JSON.stringify(v)} should contain ${x}`),
  toMatch: (re: RegExp) => assert.match(String(v), re),
  toThrow: (re: RegExp) => assert.throws(v, re),
  not: { toContain: (x: any) => assert.ok(!v.includes(x), `${JSON.stringify(v)} should not contain ${x}`) },
});
import {
  areasOf, buildRows, harvestFrom, parseGeos, parseTable, resolveArea, answerFrom, usRentHistoryKey, dataUrl, geosUrl, collectLines, keepGeo,
} from "./source";

const TABLE = ["GEO_ID|B25064_E001|B25064_M001", "0100000US|1413|2", "0100089US|816|10", "0400000US53|1707|8", "0400000US48|1257|5", "0500000US53033|1900|12", "1600000US5363000|1834|20", "1600000US5360000|1400|700", "3100000US42660|1850|15", "1600000US4805000|1300|", "1600000US4159000|1500|30", "1600000US2338970|1200|30", "1600000US9999999|-|-"];
const POP = ["GEO_ID|B01003_E001|B01003_M001", "1600000US5363000|755000|-", "1600000US5360000|60000|900", "1600000US4805000|961000|-", "1600000US4159000|650000|-", "1600000US2338970|68000|-"];
const GEO_HEADER = "FILEID|STUSAB|SUMLEVEL|COMPONENT|US|REGION|DIVISION|STATE|COUNTY|COUSUB|PLACE|TRACT|BLKGRP|CONCIT|AIANHH|AIANHHFP|AIHHTLI|AITS|AITSFP|ANRC|CBSA|CSA|METDIV|MACC|MEMI|NECTA|CNECTA|NECTADIV|UA|CDCURR|SLDU|SLDL|ZCTA5|SUBMCD|SDELM|SDSEC|SDUNI|UR|PCI|PUMA5|GEO_ID|NAME|BTTR|BTBG|TL_GEO_ID";
// One names-file row: the real file has these 45 columns; only the ones we read are filled here.
const geo = (st: string, level: string, comp: string, id: string, name: string) => {
  const cols = GEO_HEADER.split("|");
  const v = cols.map(() => "");
  v[0] = "ACSSF"; v[1] = st; v[2] = level; v[3] = comp; v[cols.indexOf("GEO_ID")] = id; v[cols.indexOf("NAME")] = name;
  return v.join("|");
};
const GEOS = [
  GEO_HEADER,
  geo("US", "010", "00", "0100000US", "United States"),
  geo("US", "010", "89", "0100089US", "United States -- American Indian Reservation and Trust Land -- Federal"),
  geo("WA", "040", "00", "0400000US53", "Washington"),
  geo("TX", "040", "00", "0400000US48", "Texas"),
  geo("WA", "050", "00", "0500000US53033", "King County, Washington"),
  geo("WA", "160", "00", "1600000US5363000", "Seattle city, Washington"),
  geo("WA", "160", "00", "1600000US5360000", "Sunnyview city, Washington"),
  geo("WA", "310", "00", "3100000US42660", "Seattle-Tacoma-Bellevue, WA Metro Area"),
  geo("TX", "160", "00", "1600000US4805000", "Austin city, Texas"),
  geo("OR", "160", "00", "1600000US4159000", "Portland city, Oregon"),
  geo("ME", "160", "00", "1600000US2338970", "Portland city, Maine"),
];

const rows = () => buildRows(parseGeos(GEOS), parseTable(TABLE, "b25064"), parseTable(POP, "b01003"));
const day = () => ({ date: "2024-12-31", rows: rows() });

describe("us-census-acs-rent parsers", () => {
  it("reads the table and skips blank and dash cells", () => {
    const t = parseTable(TABLE, "b25064");
    expect(t.get("0400000US53")).toEqual({ est: 1707, moe: 8 });
    expect(t.get("1600000US4805000")).toEqual({ est: 1300, moe: null });
    expect(t.has("1600000US9999999")).toBe(false);
  });
  it("keeps whole-geography rows of the kinds we use", () => {
    const g = parseGeos(GEOS);
    expect(g.map((x) => x.kind)).toEqual(["national", "state", "state", "county", "place", "place", "metro", "place", "place", "place"]);
  });
  it("drops imprecise estimates and small places", () => {
    const keys = rows().map((r) => r.area);
    expect(keys).not.toContain("place:Sunnyview city, Washington"); // moe 700 of 1400 = 50%
    expect(keys).toContain("ALL");
    expect(rows().every((r) => Number.isNaN(r.n))).toBe(true);
  });
  it("drops cities under 50,000 people", () => {
    const g = parseGeos(["FILEID|STUSAB|SUMLEVEL|COMPONENT|GEO_ID|NAME", "ACSSF|WA|160|00|1600000US5399999|Tinyville town, Washington"]);
    const r = buildRows(g, new Map([["1600000US5399999", { est: 900, moe: 10 }]]), new Map([["1600000US5399999", { est: 4000, moe: 0 }]]));
    expect(r).toEqual([]);
  });
  it("filters a streamed geography file", async () => {
    async function* gen() { for (const l of GEOS) yield l; }
    const kept = await collectLines(gen(), keepGeo);
    expect(kept.length).toBe(GEOS.length - 1); // the tribal-land row is dropped
  });
  it("builds file urls", () => {
    expect(dataUrl(2024, "b25064")).toBe("https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/data/5YRData/acsdt5y2024-b25064.dat");
    expect(geosUrl(2024)).toContain("Geos20245YR.txt");
  });
  it("refuses a layout it does not know", () => {
    expect(() => parseTable(["GEO_ID|X|Y", "a|1|2"], "b25064")).toThrow(/new layout/);
  });
});

describe("us-census-acs-rent places", () => {
  const areas = () => areasOf([...new Set(rows().map((r) => r.area))]);
  it("whole country by default", () => expect(resolveArea(areas()).area.kind).toBe("national"));
  it("finds a city, a state, a county", () => {
    expect(resolveArea(areas(), "Seattle").area.key).toBe("place:Seattle city, Washington");
    expect(resolveArea(areas(), "Texas").area.key).toBe("state:Texas");
    expect(resolveArea(areas(), "King County, WA").area.key).toBe("county:King County, Washington");
    expect(resolveArea(areas(), "Austin, TX").area.kind).toBe("place");
  });
  it("a state name wins over counties of the same name", () => {
    const a = areasOf(["ALL", "state:Texas", "county:Texas County, Missouri", "county:Texas County, Oklahoma"]);
    expect(resolveArea(a, "Texas").area.key).toBe("state:Texas");
  });
  it("asks for the state when a name is shared", () => {
    expect(() => resolveArea(areas(), "Portland")).toThrow(/several cities.*Oregon/);
    expect(resolveArea(areas(), "Portland, OR").area.key).toBe("place:Portland city, Oregon");
    expect(resolveArea(areas(), "portland, maine").area.key).toBe("place:Portland city, Maine");
  });
  it("lists options for an unknown place", () => expect(() => resolveArea(areas(), "Atlantis")).toThrow(/no area called "Atlantis"/));
  it("history key", () => expect(usRentHistoryKey({ town: "Seattle" }, rows().map((r) => r.area))).toEqual({ area: "place:Seattle city, Washington", item: "gross", label: "Seattle, Washington" }));
});

describe("us-census-acs-rent answer", () => {
  it("answers Seattle as an official statistic", () => {
    const a = answerFrom(day(), { town: "Seattle" });
    expect(a.status).toBe("ok");
    expect(a.price_type).toBe("official_statistic");
    expect(a.price?.median).toBe(1834);
    expect(a.price?.currency).toBe("USD");
    expect(a.sample_size).toBeNull();
    expect(a.period).toEqual({ from: "2020-01-01", to: "2024-12-31" });
    expect(a.summary).toContain("Seattle");
    expect(a.source.licence).toMatch(/free tier/);
  });
  it("answers the whole US", () => expect(answerFrom(day(), {}).price?.median).toBe(1413));
});

describe("us-census-acs-rent harvest rows", () => {
  it("needs a national figure and enough areas", () => {
    expect(() => harvestFrom(2024, parseGeos(GEOS), parseTable(TABLE, "b25064"), parseTable(POP, "b01003"))).toThrow(/only \d+ usable areas/);
  });
});
