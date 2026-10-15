// Real format, checked live on 2026-10-15: https://www.revenue.ie/en/corporate/documents/statistics/tax-expenditures/breakdown-by-local-authority.csv
// (data.gov.ie "Home Renovation Incentive statistics", CC BY 4.0). The file starts with a byte-order mark and uses CRLF line ends. The lines below are the
// real header and the real 2018/19 rows; two 2017 rows are real too (the file lists the newest year first and also holds 2013/2014 to 2017).
import { test } from "node:test";
import assert from "node:assert/strict";
import { InputError, SourceError } from "../../lib/http";
import { priceAnswerSchema } from "../../lib/schemas";
import { INFO, authoritiesFor, hriAnswer, hriRows, latestYear, parseHri, periodOf, rowsFromLibrary, yearSpan } from "./source";

const LINES = [
  "year,local_authority,no_of_properties,no_of_works,estimated_value_of_works_euro_m",
  "2018/19,Carlow,184,229,2.85",
  "2018/19,Cavan,212,267,3.03",
  "2018/19,Clare,503,658,9.26",
  "2018/19,Cork City,1196,1748,31.42",
  "2018/19,Cork County,1830,2593,39.63",
  "2018/19,Donegal,176,246,3.86",
  "2018/19,Dublin City,3997,5313,127.13",
  "2018/19,DLR,2878,3980,106.47",
  "2018/19,Fingal,2602,3484,54.95",
  "2018/19,South Dublin,2261,3075,46.08",
  "2018/19,Galway City,419,682,9.46",
  "2018/19,Galway County,722,1014,15.5",
  "2018/19,Kerry,620,839,12.73",
  "2018/19,Kildare,1790,2489,34.51",
  "2018/19,Kilkenny,390,534,8.13",
  "2018/19,Laois,193,269,3.38",
  "2018/19,Leitrim,92,130,1.49",
  "2018/19,Limerick,824,1089,18.31",
  "2018/19,Longford,94,126,1.79",
  "2018/19,Louth,440,569,8.94",
  "2018/19,Mayo,365,502,7.06",
  "2018/19,Meath,1097,1549,23.85",
  "2018/19,Monaghan,94,114,1.78",
  "2018/19,Offaly,217,306,5.13",
  "2018/19,Roscommon,266,386,5.43",
  "2018/19,Sligo,280,416,5.94",
  "2018/19,Tipperary,554,847,14.3",
  "2018/19,Waterford,501,669,10.85",
  "2018/19,Westmeath,332,462,6.26",
  "2018/19,Wexford,516,709,9.92",
  "2018/19,Wicklow,994,1331,22.38",
  "2017,Carlow,152,195,2.6",
  "2017,Cavan,177,221,3.94",
];
const CSV = "\uFEFF" + LINES.join("\r\n") + "\r\n";

test("parseHri reads the real table, the byte-order mark and CRLF included", () => {
  const rows = parseHri(CSV);
  assert.equal(rows.length, 33);
  assert.deepEqual(rows[0], { year: "2018/19", authority: "Carlow", properties: 184, works: 229, valueM: 2.85 });
  assert.equal(latestYear(rows), "2018/19");
  assert.throws(() => parseHri("a,b,c\n1,2,3\n"), SourceError);
  assert.throws(() => parseHri(LINES.slice(0, 5).join("\n")), /too few rows/);
});

test("year labels are spans of calendar years", () => {
  assert.deepEqual(yearSpan("2018/19"), { from: 2018, to: 2019 });
  assert.deepEqual(yearSpan("2013/2014"), { from: 2013, to: 2014 });
  assert.deepEqual(yearSpan("2015"), { from: 2015, to: 2015 });
  assert.equal(yearSpan("latest"), null);
  assert.deepEqual(periodOf("2018/19"), { from: "2018-01-01", to: "2019-12-31" });
});

test("areas: a county adds its local authorities, a name must exist", () => {
  const known = parseHri(CSV).map((r) => r.authority);
  assert.deepEqual(authoritiesFor("Dublin", known), ["Dublin City", "DLR", "Fingal", "South Dublin"]);
  assert.deepEqual(authoritiesFor("County Cork", known), ["Cork City", "Cork County"]);
  assert.deepEqual(authoritiesFor("Dún Laoghaire-Rathdown", known), ["DLR"]);
  assert.deepEqual(authoritiesFor("kerry", known), ["Kerry"]);
  assert.deepEqual(authoritiesFor("Ireland", known), []);
  assert.deepEqual(authoritiesFor(undefined, known), []);
  assert.throws(() => authoritiesFor("Atlantis", known), InputError);
});

test("the national answer is the declared value per property, with the published number of properties", () => {
  const rows = parseHri(CSV).filter((r) => r.year === "2018/19");
  const a = hriAnswer("2018/19", rows, "renovation", {});
  const props = rows.reduce((s, r) => s + r.properties, 0);
  const value = rows.reduce((s, r) => s + r.valueM, 0) * 1e6;
  assert.equal(a.status, "ok");
  assert.equal(a.price!.value, Math.round(value / props));
  assert.equal(a.price!.currency, "EUR");
  assert.equal(a.price!.measure, "average");
  assert.equal(a.sample_size, props);
  assert.equal(a.reliability, "official_with_count");
  assert.equal(a.price_type, "official_statistic");
  assert.deepEqual(a.period, { from: "2018-01-01", to: "2019-12-31" });
  assert.equal(a.data_as_of, "2019-12-31");
  assert.ok(a.data_age_days! > 365); // honest about how old the table is
  assert.match(a.summary, /declared/);
  assert.match(a.summary, /not one type/);
  assert.doesNotMatch(a.summary, /\bpaid\b/i);
  assert.ok(priceAnswerSchema.safeParse(a).success);
  assert.equal(a.source.licence_url, "https://creativecommons.org/licenses/by/4.0/");
  assert.match(a.source.attribution, /CC BY 4\.0/);
});

test("a county answer adds its authorities and says which", () => {
  const rows = parseHri(CSV).filter((r) => r.year === "2018/19");
  const a = hriAnswer("2018/19", rows, "renovation", { area: "Dublin" });
  const dub = rows.filter((r) => ["Dublin City", "DLR", "Fingal", "South Dublin"].includes(r.authority));
  assert.equal(a.sample_size, dub.reduce((s, r) => s + r.properties, 0));
  assert.deepEqual((a.extra as any).authorities, ["Dublin City", "DLR", "Fingal", "South Dublin"]);
  const k = hriAnswer("2018/19", rows, "renovation", { area: "Kerry" });
  assert.equal(k.price!.value, Math.round((12.73 * 1e6) / 620));
  assert.equal(k.sample_size, 620);
});

test("a measure the table cannot split gives no_matches, never a made-up figure", () => {
  const rows = parseHri(CSV).filter((r) => r.year === "2018/19");
  const a = hriAnswer("2018/19", rows, "heat_pump", {});
  assert.equal(a.status, "no_matches");
  assert.equal(a.price, null);
  assert.equal(a.reliability, "insufficient_data");
  assert.match(a.summary, /not split by type of work/);
  assert.ok(priceAnswerSchema.safeParse(a).success);
});

test("library rows keep the year label and round-trip", () => {
  const all = parseHri(CSV);
  const rows = hriRows(all, "2018/19");
  assert.ok(rows.every((r) => r.n >= 5 && r.item.endsWith("/2018/19")));
  const back = rowsFromLibrary({ date: "2019-12-31", rows });
  assert.equal(back.year, "2018/19");
  assert.deepEqual(back.rows.find((r) => r.authority === "Kerry"), { authority: "Kerry", properties: 620, works: 839, valueM: 12.73, year: "2018/19" });
  assert.equal(INFO.id, "ie-revenue-hri");
});
