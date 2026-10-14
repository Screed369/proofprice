// Tests for the universal portal adapters (lib/adapters). Parsers are run against real responses captured on 2026-10-14
// (tests/fixtures/portals.ts); paging logic runs against fake fetchers, so nothing here touches the network.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as A from "../lib/adapters";
import {
  arcgisAll, arcgisCountUrl, arcgisQueryUrl, buildQuery, ckanAll, ckanApiBase, clampMaxRows, collectPages, datastoreSearchSqlUrl,
  datastoreSearchUrl, eurostatUrl, fetchEurostat, fetchJsonStat, fromEurostatGeo, latestResource, odsAll, odsExport, odsExportUrl,
  odsRecordsUrl, packageShowUrl, parseArcgisCount, parseArcgisQuery, parseDatastoreSearch, parseDatastoreSql, parseJsonStat, parseOdsExport,
  parseOdsRecords, parsePackageShow, parseSoda, periodRange, previousPeriod, rowsWhere, socrataAll, socrataUrl, soqlString, sqlIdent,
  sqlLiteral, toEurostatGeo, wholeNumber,
} from "../lib/adapters";
import { SourceError } from "../lib/http";
import * as F from "./fixtures/portals";

/** Fake network: records every URL asked for and answers from a function. */
function fake(answer: (url: URL) => unknown) {
  const urls: string[] = [];
  const fetcher = async (url: string) => {
    urls.push(url);
    return answer(new URL(url));
  };
  return { urls, fetcher };
}
const rowsOf = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i + 1 }));

// ---------- the adapter index ----------

test("the adapter index re-exports every adapter", () => {
  for (const name of [
    "collectPages", "ckanAll", "datastoreSearchUrl", "parseDatastoreSearch", "socrataAll", "socrataUrl", "parseSoda", "odsAll",
    "odsRecordsUrl", "parseOdsRecords", "arcgisAll", "arcgisQueryUrl", "parseArcgisQuery", "parseJsonStat", "eurostatUrl", "fetchEurostat",
  ]) {
    assert.equal(typeof (A as Record<string, unknown>)[name], "function", name);
  }
});

// ---------- common: query strings, caps, paging ----------

test("buildQuery drops empty values, encodes the rest and keeps $ readable", () => {
  assert.equal(
    buildQuery([["$select", "a, count(*) as n"], ["$where", undefined], ["x", ""], ["y", 0], ["z", false], ["n", null], ["q", "a&b=c"]]),
    "$select=a%2C%20count(*)%20as%20n&y=0&z=false&q=a%26b%3Dc",
  );
});

test("clampMaxRows and wholeNumber keep requests small and honest", () => {
  assert.equal(clampMaxRows(), 5000);
  assert.equal(clampMaxRows(NaN), 5000);
  assert.equal(clampMaxRows(0), 1);
  assert.equal(clampMaxRows(7.9), 7);
  assert.equal(clampMaxRows(10_000_000), 50000);
  assert.equal(wholeNumber("limit", undefined), undefined);
  assert.equal(wholeNumber("limit", 0), 0);
  assert.throws(() => wholeNumber("limit", -1), RangeError);
  assert.throws(() => wholeNumber("limit", 1.5), RangeError);
  assert.throws(() => wholeNumber("limit", 101, { max: 100 }), /from 0 to 100/);
});

test("collectPages stops at a short page and asks for the rows already held as offset", async () => {
  const data = rowsOf(5);
  const calls: number[][] = [];
  const r = await collectPages({
    pageSize: 2,
    fetchPage: async (offset, limit) => {
      calls.push([offset, limit]);
      return { rows: data.slice(offset, offset + limit) };
    },
  });
  assert.deepEqual(calls, [[0, 2], [2, 2], [4, 2]]);
  assert.equal(r.rows.length, 5);
  assert.equal(r.truncated, false);
  assert.equal(r.total, null);
  assert.equal(r.pages, 3);
});

test("collectPages never asks for more than maxRows in total and says when it stopped early", async () => {
  const data = rowsOf(100);
  const calls: number[][] = [];
  const r = await collectPages({
    maxRows: 5,
    pageSize: 2,
    fetchPage: async (offset, limit) => {
      calls.push([offset, limit]);
      return { rows: data.slice(offset, offset + limit) };
    },
  });
  assert.deepEqual(calls, [[0, 2], [2, 2], [4, 1]]);
  assert.equal(r.rows.length, 5);
  assert.equal(r.truncated, true);
});

test("collectPages uses the total when the source gives one", async () => {
  const data = rowsOf(4);
  const exact = await collectPages({ pageSize: 4, fetchPage: async (o, l) => ({ rows: data.slice(o, o + l), total: 4 }) });
  assert.equal(exact.pages, 1);
  assert.equal(exact.truncated, false);
  assert.equal(exact.total, 4);
  const capped = await collectPages({ maxRows: 2, pageSize: 2, fetchPage: async (o, l) => ({ rows: data.slice(o, o + l), total: 4 }) });
  assert.equal(capped.rows.length, 2);
  assert.equal(capped.truncated, true);
});

test("collectPages follows the server's own 'more' flag, even when a page is short", async () => {
  const data = rowsOf(5);
  const r = await collectPages({
    pageSize: 10,
    fetchPage: async (offset) => {
      const rows = data.slice(offset, offset + 2); // the server never returns more than 2
      return { rows, more: offset + rows.length < data.length };
    },
  });
  assert.equal(r.rows.length, 5);
  assert.equal(r.pages, 3);
  assert.equal(r.truncated, false);
});

test("collectPages gives up on a server that ignores offsets (maxPages)", async () => {
  let calls = 0;
  const r = await collectPages({
    maxRows: 1000,
    pageSize: 2,
    maxPages: 3,
    fetchPage: async () => {
      calls++;
      return { rows: rowsOf(2), more: true };
    },
  });
  assert.equal(calls, 3);
  assert.equal(r.rows.length, 6);
  assert.equal(r.truncated, true);
});

// ---------- CKAN ----------

const QLD = "https://www.data.qld.gov.au";
const QLD_RESOURCE = "420319e2-6518-4243-83a6-3c7769bd7e6c";

test("ckan: the API base is found from a site, /api/3 or /api/3/action URL", () => {
  for (const s of [QLD, `${QLD}/`, `${QLD}/api/3`, `${QLD}/api/3/action`, `${QLD}/api/3/action/`]) assert.equal(ckanApiBase(s), `${QLD}/api/3/action`, s);
  assert.equal(ckanApiBase("https://data.gov.sg/api/action"), "https://data.gov.sg/api/action"); // data.gov.sg has no "3" in the path
  assert.throws(() => ckanApiBase("http://example.org"), /https/);
});

test("ckan: datastore_search URL (same shape as the live request that was probed)", () => {
  assert.equal(
    datastoreSearchUrl(QLD, { resourceId: QLD_RESOURCE, limit: 3 }),
    `${QLD}/api/3/action/datastore_search?resource_id=${QLD_RESOURCE}&limit=3`,
  );
  const u = new URL(
    datastoreSearchUrl(QLD, {
      resourceId: QLD_RESOURCE,
      filters: { Fuel_Type: "Diesel", Site_State: ["QLD", "NSW"] },
      q: "Liberty",
      fields: ["SiteId", "Price"],
      sort: ["Price asc", "_id desc"],
      limit: 50,
      offset: 100,
      includeTotal: false,
    }),
  );
  assert.equal(u.pathname, "/api/3/action/datastore_search");
  assert.deepEqual(JSON.parse(u.searchParams.get("filters")!), { Fuel_Type: "Diesel", Site_State: ["QLD", "NSW"] });
  assert.equal(u.searchParams.get("q"), "Liberty");
  assert.equal(u.searchParams.get("fields"), "SiteId,Price");
  assert.equal(u.searchParams.get("sort"), "Price asc,_id desc");
  assert.equal(u.searchParams.get("limit"), "50");
  assert.equal(u.searchParams.get("offset"), "100");
  assert.equal(u.searchParams.get("include_total"), "false");
  const col = new URL(datastoreSearchUrl(QLD, { resourceId: QLD_RESOURCE, q: { Site_Name: "Liberty" }, filters: {} }));
  assert.deepEqual(JSON.parse(col.searchParams.get("q")!), { Site_Name: "Liberty" });
  assert.equal(col.searchParams.has("filters"), false);
  assert.throws(() => datastoreSearchUrl(QLD, { resourceId: " " }), /resourceId/);
  assert.throws(() => datastoreSearchUrl(QLD, { resourceId: QLD_RESOURCE, limit: -1 }), RangeError);
});

test("ckan: SQL URL takes a SELECT only, with helpers to quote identifiers and text", () => {
  const sql = `SELECT COUNT(*) AS n FROM ${sqlIdent(QLD_RESOURCE)} WHERE ${sqlIdent("Fuel_Type")} = ${sqlLiteral("Diesel")}`;
  const u = new URL(datastoreSearchSqlUrl(QLD, sql));
  assert.equal(u.pathname, "/api/3/action/datastore_search_sql");
  assert.equal(u.searchParams.get("sql"), sql);
  assert.throws(() => datastoreSearchSqlUrl(QLD, "DROP TABLE x"), /SELECT/);
  assert.equal(sqlIdent('a"b'), '"a""b"');
  assert.equal(sqlLiteral("O'Brien"), "'O''Brien'");
  assert.equal(sqlLiteral(5), "5");
  assert.throws(() => sqlLiteral(Infinity));
  assert.equal(packageShowUrl(QLD, " fuel-price-reporting-2026 "), `${QLD}/api/3/action/package_show?id=fuel-price-reporting-2026`);
});

test("ckan: parses a real datastore_search answer", () => {
  const r = parseDatastoreSearch(F.CKAN_DATASTORE_SEARCH);
  assert.equal(r.records.length, 3);
  assert.equal(r.total, 92244);
  assert.equal(r.records[0].Site_Name, "Liberty Surat");
  assert.equal(r.records[0].Price, 2499);
  assert.equal(r.fields.length, 13);
  assert.deepEqual(r.fields[0], { id: "_id", type: "int" });
  assert.match(r.next!, /offset=3$/);
});

test("ckan: parses a real datastore_search_sql answer", () => {
  const r = parseDatastoreSql(F.CKAN_DATASTORE_SQL);
  assert.deepEqual(r.records, [{ n: 92244 }]);
  assert.deepEqual(r.fields, [{ id: "n", type: "int8" }]);
});

test("ckan: a refused request becomes a SourceError carrying the portal's message", () => {
  assert.throws(() => parseDatastoreSearch(F.CKAN_NOT_FOUND), (e: any) => e instanceof SourceError && /was not found/.test(e.message) && e.detail === "Not Found Error");
  assert.throws(() => parseDatastoreSearch("<html>"), SourceError);
  assert.throws(() => parseDatastoreSearch({ success: true, result: {} }), /no records/);
  assert.throws(() => parseDatastoreSql({ success: false, error: "boom" }), /boom/);
});

test("ckan: package_show gives the licence and the files, and finds the newest file of a format", () => {
  const p = parsePackageShow(F.CKAN_PACKAGE_SHOW);
  assert.equal(p.name, "fuel-price-reporting-2026");
  assert.equal(p.licenceId, "CC-BY-4.0");
  assert.equal(p.licenceTitle, "Creative Commons Attribution 4.0");
  assert.equal(p.resources.length, 3);
  assert.deepEqual(p.resources[2], {
    id: QLD_RESOURCE,
    name: "Queensland Fuel Prices August 2026",
    format: "CSV",
    url: "https://www.data.qld.gov.au/dataset/0dfad294-f852-45a5-b86f-986773745fe2/resource/420319e2-6518-4243-83a6-3c7769bd7e6c/download/queensland-fuel-prices-august-2026.csv",
    datastoreActive: true,
    modified: "2026-09-02T01:40:19.860633",
    mimetype: "text/csv",
  });
  assert.equal(latestResource(p.resources, { format: "csv" })!.id, QLD_RESOURCE);
  assert.equal(latestResource(p.resources, { format: ["CSV", "JSON"], datastoreOnly: true })!.id, QLD_RESOURCE);
  assert.match(latestResource(p.resources, { nameMatches: /July/ })!.name, /July 2026/);
  assert.equal(latestResource(p.resources, { format: "TXT" })!.id, "324be6a3-698a-408a-9c0e-022aa94b9543");
  assert.equal(latestResource(p.resources, { format: "XML" }), null);
  assert.equal(latestResource([], {}), null);
});

test("ckan: ckanAll pages with limit/offset, never past maxRows", async () => {
  const records = rowsOf(5).map((r) => ({ _id: r.id }));
  const { urls, fetcher } = fake((u) => {
    const limit = Number(u.searchParams.get("limit"));
    const offset = Number(u.searchParams.get("offset") ?? 0);
    return { success: true, result: { records: records.slice(offset, offset + limit), fields: [], total: records.length, _links: {} } };
  });
  const all = await ckanAll(QLD, { resourceId: QLD_RESOURCE, sort: "_id asc" }, { fetcher, pageSize: 2 });
  assert.equal(all.rows.length, 5);
  assert.equal(all.total, 5);
  assert.equal(all.truncated, false);
  assert.deepEqual(urls.map((u) => [new URL(u).searchParams.get("offset"), new URL(u).searchParams.get("limit")]), [["0", "2"], ["2", "2"], ["4", "2"]]);

  const capped = await ckanAll(QLD, { resourceId: QLD_RESOURCE }, { fetcher, pageSize: 2, maxRows: 3 });
  assert.equal(capped.rows.length, 3);
  assert.equal(capped.truncated, true);
  assert.equal(urls.map((u) => Number(new URL(u).searchParams.get("limit"))).slice(3).join(","), "2,1");

  const limited = await ckanAll(QLD, { resourceId: QLD_RESOURCE, limit: 4, offset: 1 }, { fetcher, pageSize: 3 });
  assert.deepEqual(limited.rows.map((r) => r._id), [2, 3, 4, 5]); // starts at offset 1, a ceiling of 4 rows
  assert.equal(limited.truncated, false);
});

// ---------- Socrata ----------

test("socrata: SoQL URL with every value percent-encoded", () => {
  assert.equal(
    socrataUrl("data.cityofchicago.org", "4ijn-s7e5", { select: ["inspection_id", "dba_name", "results"], order: "inspection_id DESC", limit: 3 }),
    "https://data.cityofchicago.org/resource/4ijn-s7e5.json?$select=inspection_id%2Cdba_name%2Cresults&$order=inspection_id%20DESC&$limit=3",
  );
  const u = new URL(
    socrataUrl("https://data.cityofchicago.org/", "4IJN-S7E5", {
      select: ["results", "count(*) as n"],
      where: "results = 'Fail' AND inspection_date > '2026-01-01T00:00:00'",
      group: "results",
      having: "count(*) > 10",
      order: ["n DESC"],
      q: "pizza & pasta",
      limit: 10,
      offset: 20,
    }),
  );
  assert.equal(u.origin + u.pathname, "https://data.cityofchicago.org/resource/4ijn-s7e5.json");
  assert.equal(u.searchParams.get("$select"), "results,count(*) as n");
  assert.equal(u.searchParams.get("$where"), "results = 'Fail' AND inspection_date > '2026-01-01T00:00:00'");
  assert.equal(u.searchParams.get("$group"), "results");
  assert.equal(u.searchParams.get("$having"), "count(*) > 10");
  assert.equal(u.searchParams.get("$order"), "n DESC");
  assert.equal(u.searchParams.get("$q"), "pizza & pasta");
  assert.equal(u.searchParams.get("$limit"), "10");
  assert.equal(u.searchParams.get("$offset"), "20");
  assert.equal(socrataUrl("data.sfgov.org", "wg3w-h783"), "https://data.sfgov.org/resource/wg3w-h783.json");
  assert.throws(() => socrataUrl("data.cityofchicago.org", "not-an-id-x"), /abcd-1234/);
  assert.throws(() => socrataUrl("localhost", "4ijn-s7e5"), /domain/);
  assert.throws(() => socrataUrl("data.example.org/evil?x=", "4ijn-s7e5"), /domain/);
  assert.equal(soqlString("O'Brien"), "'O''Brien'");
});

test("socrata: parses real rows, real aggregates (strings) and real errors", () => {
  const rows = parseSoda(F.SODA_ROWS);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], { inspection_id: "2644103", dba_name: "JJ FISH", results: "Fail" });
  const agg = parseSoda(F.SODA_AGGREGATE);
  assert.deepEqual(agg[0], { results: "Pass", n: "164093" });
  assert.equal(Number(agg[0].n), 164093);
  assert.throws(() => parseSoda(F.SODA_ERROR), (e: any) => e instanceof SourceError && /No such column: nosuchfield/.test(e.message) && e.detail === "query.soql.no-such-column");
  assert.throws(() => parseSoda("nope"), SourceError);
});

test("socrata: socrataAll pages with $limit/$offset and respects maxRows", async () => {
  const data = rowsOf(5);
  const { urls, fetcher } = fake((u) => {
    const limit = Number(u.searchParams.get("$limit"));
    const offset = Number(u.searchParams.get("$offset") ?? 0);
    return data.slice(offset, offset + limit);
  });
  const all = await socrataAll("data.cityofchicago.org", "4ijn-s7e5", { order: "id" }, { fetcher, pageSize: 2 });
  assert.equal(all.rows.length, 5);
  assert.equal(all.truncated, false);
  assert.deepEqual(urls.map((u) => [new URL(u).searchParams.get("$offset"), new URL(u).searchParams.get("$limit")]), [["0", "2"], ["2", "2"], ["4", "2"]]);
  const capped = await socrataAll("data.cityofchicago.org", "4ijn-s7e5", { limit: 3 }, { fetcher, pageSize: 2 });
  assert.equal(capped.rows.length, 3);
  assert.equal(capped.truncated, true); // Socrata gives no total, so a full last page may hide more
});

// ---------- OpenDataSoft ----------

const ODS_DOMAIN = "data.economie.gouv.fr";
const ODS_DATASET = "prix-des-carburants-en-france-flux-instantane-v2";
const ODS_BASE = `https://${ODS_DOMAIN}/api/explore/v2.1/catalog/datasets/${ODS_DATASET}`;

test("opendatasoft: records URL (same shape as the live request that was probed)", () => {
  assert.equal(odsRecordsUrl(ODS_DOMAIN, ODS_DATASET, { select: ["id", "ville", "gazole_prix"], limit: 3 }), `${ODS_BASE}/records?select=id%2Cville%2Cgazole_prix&limit=3`);
  const u = new URL(
    odsRecordsUrl(ODS_DOMAIN, ODS_DATASET, {
      select: ["dep_name", "avg(gazole_prix) as prix"],
      where: "gazole_prix > 0",
      groupBy: "dep_name",
      orderBy: ["prix desc"],
      refine: { ville: ["Bordeaux", "Lyon"], region: "Occitanie" },
      exclude: { brand: "X" },
      lang: "fr",
      timezone: "Europe/Paris",
      limit: 100,
      offset: 200,
    }),
  );
  assert.equal(u.searchParams.get("select"), "dep_name,avg(gazole_prix) as prix");
  assert.equal(u.searchParams.get("where"), "gazole_prix > 0");
  assert.equal(u.searchParams.get("group_by"), "dep_name");
  assert.equal(u.searchParams.get("order_by"), "prix desc");
  assert.deepEqual(u.searchParams.getAll("refine"), ["ville:Bordeaux", "ville:Lyon", "region:Occitanie"]);
  assert.deepEqual(u.searchParams.getAll("exclude"), ["brand:X"]);
  assert.equal(u.searchParams.get("lang"), "fr");
  assert.equal(u.searchParams.get("limit"), "100");
  assert.equal(u.searchParams.get("offset"), "200");
});

test("opendatasoft: limit is capped at 100 and offset + limit at 10 000", () => {
  assert.throws(() => odsRecordsUrl(ODS_DOMAIN, ODS_DATASET, { limit: 101 }), RangeError);
  assert.throws(() => odsRecordsUrl(ODS_DOMAIN, ODS_DATASET, { limit: 100, offset: 9950 }), /10000/);
  assert.doesNotThrow(() => odsRecordsUrl(ODS_DOMAIN, ODS_DATASET, { limit: 100, offset: 9900 }));
  assert.throws(() => odsRecordsUrl(ODS_DOMAIN, "bad dataset!", {}), /dataset id/);
  assert.throws(() => odsRecordsUrl("nodot", ODS_DATASET, {}), /domain/);
});

test("opendatasoft: export URL, format and limit", () => {
  assert.equal(odsExportUrl(ODS_DOMAIN, ODS_DATASET, { select: ["id", "ville", "gazole_prix"], limit: 3 }), `${ODS_BASE}/exports/json?select=id%2Cville%2Cgazole_prix&limit=3`);
  assert.equal(odsExportUrl(ODS_DOMAIN, ODS_DATASET, { format: "csv", limit: -1 }), `${ODS_BASE}/exports/csv?limit=-1`);
  assert.equal(odsExportUrl(ODS_DOMAIN, ODS_DATASET), `${ODS_BASE}/exports/json`);
  assert.throws(() => odsExportUrl(ODS_DOMAIN, ODS_DATASET, { limit: 0 }), RangeError);
  assert.throws(() => odsExportUrl(ODS_DOMAIN, ODS_DATASET, { format: "xml" as any }), /format/);
});

test("opendatasoft: parses real records, aggregates, exports and errors", () => {
  const r = parseOdsRecords(F.ODS_RECORDS);
  assert.equal(r.total, 9818);
  assert.equal(r.results.length, 3);
  assert.deepEqual(r.results[2], { id: 56580001, ville: "Bréhan", gazole_prix: 2.399 });
  const agg = parseOdsRecords(F.ODS_AGGREGATE);
  assert.equal(agg.results[0].n, 9207);
  assert.ok(Math.abs(agg.results[0].avg_diesel - 2.3588) < 0.001);
  assert.equal(parseOdsExport(F.ODS_EXPORT).length, 3);
  assert.throws(() => parseOdsRecords(F.ODS_ERROR), (e: any) => e instanceof SourceError && /Unknown field: nosuchfield/.test(e.message) && e.detail === "ODSQLError");
  assert.throws(() => parseOdsExport(F.ODS_ERROR), /Unknown field/);
  assert.throws(() => parseOdsExport({ nope: 1 }), SourceError);
  assert.throws(() => parseOdsRecords([]), SourceError);
});

test("opendatasoft: odsAll pages 100 at a time, from the total_count", async () => {
  const data = rowsOf(250);
  const { urls, fetcher } = fake((u) => {
    const limit = Number(u.searchParams.get("limit"));
    const offset = Number(u.searchParams.get("offset") ?? 0);
    return { total_count: data.length, results: data.slice(offset, offset + limit) };
  });
  const all = await odsAll(ODS_DOMAIN, ODS_DATASET, {}, { fetcher });
  assert.equal(all.rows.length, 250);
  assert.equal(all.total, 250);
  assert.equal(all.truncated, false);
  assert.deepEqual(urls.map((u) => [new URL(u).searchParams.get("offset"), new URL(u).searchParams.get("limit")]), [["0", "100"], ["100", "100"], ["200", "100"]]);

  const capped = await odsAll(ODS_DOMAIN, ODS_DATASET, {}, { fetcher, maxRows: 120 });
  assert.equal(capped.rows.length, 120);
  assert.equal(capped.truncated, true);
});

test("opendatasoft: odsAll never reaches past the 10 000 window, and odsExport asks for a limit", async () => {
  const big = fake((u) => ({ total_count: 50000, results: rowsOf(Number(u.searchParams.get("limit"))) }));
  const near = await odsAll(ODS_DOMAIN, ODS_DATASET, { offset: 9950 }, { fetcher: big.fetcher, maxRows: 500 });
  assert.equal(near.rows.length, 50);
  assert.equal(big.urls.length, 1);
  assert.equal(new URL(big.urls[0]).searchParams.get("limit"), "50");
  assert.equal(near.truncated, true);
  const beyond = await odsAll(ODS_DOMAIN, ODS_DATASET, { offset: 10000 }, { fetcher: big.fetcher });
  assert.deepEqual(beyond, { rows: [], total: null, truncated: false, pages: 0 });
  assert.equal(big.urls.length, 1);

  const exp = fake(() => rowsOf(5));
  const e = await odsExport(ODS_DOMAIN, ODS_DATASET, { select: "id" }, { fetcher: exp.fetcher, maxRows: 5 });
  assert.equal(new URL(exp.urls[0]).pathname.endsWith("/exports/json"), true);
  assert.equal(new URL(exp.urls[0]).searchParams.get("limit"), "5");
  assert.equal(e.rows.length, 5);
  assert.equal(e.truncated, true);
});

// ---------- ArcGIS ----------

const LAYER = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/12";

test("arcgis: layer query URL", () => {
  assert.equal(arcgisQueryUrl(LAYER), `${LAYER}/query?where=1%3D1&outFields=*&returnGeometry=false&f=json`);
  assert.equal(arcgisQueryUrl(`${LAYER}/query/`), arcgisQueryUrl(LAYER));
  const u = new URL(
    arcgisQueryUrl(LAYER, { where: "STUSAB = 'IL'", outFields: ["NAME", "STUSAB"], orderByFields: "OBJECTID", resultOffset: 54, resultRecordCount: 5 }),
  );
  assert.equal(u.searchParams.get("where"), "STUSAB = 'IL'");
  assert.equal(u.searchParams.get("outFields"), "NAME,STUSAB");
  assert.equal(u.searchParams.get("orderByFields"), "OBJECTID");
  assert.equal(u.searchParams.get("returnGeometry"), "false");
  assert.equal(u.searchParams.get("resultOffset"), "54");
  assert.equal(u.searchParams.get("resultRecordCount"), "5");
  assert.equal(u.searchParams.get("f"), "json");
  const stats = new URL(
    arcgisQueryUrl("https://services.arcgis.com/abc/arcgis/rest/services/Prices/FeatureServer/0", {
      groupByFieldsForStatistics: "suburb",
      outStatistics: [{ statisticType: "avg", onStatisticField: "price", outStatisticFieldName: "avg_price" }],
    }),
  );
  assert.equal(stats.searchParams.has("outFields"), false);
  assert.deepEqual(JSON.parse(stats.searchParams.get("outStatistics")!), [{ statisticType: "avg", onStatisticField: "price", outStatisticFieldName: "avg_price" }]);
  assert.equal(stats.searchParams.get("groupByFieldsForStatistics"), "suburb");
  assert.equal(new URL(arcgisCountUrl(LAYER, "STATE='17'")).searchParams.get("returnCountOnly"), "true");
  assert.throws(() => arcgisQueryUrl("https://example.org/arcgis/rest/services/X/MapServer"), /layer URL/);
  assert.throws(() => arcgisQueryUrl("http://example.org/FeatureServer/0"), /layer URL/);
  assert.throws(() => arcgisQueryUrl(LAYER, { resultRecordCount: 0 }), RangeError);
});

test("arcgis: parses real pages, the transfer-limit flag, counts and errors", () => {
  const first = parseArcgisQuery(F.ARCGIS_FIRST_PAGE);
  assert.deepEqual(first.rows, [{ NAME: "United States Virgin Islands", STUSAB: "VI" }, { NAME: "Maryland", STUSAB: "MD" }]);
  assert.equal(first.exceededTransferLimit, true);
  assert.deepEqual(first.fields.map((f) => f.name), ["NAME", "STUSAB"]);
  assert.equal(first.fields[0].type, "esriFieldTypeString");
  const last = parseArcgisQuery(F.ARCGIS_LAST_PAGE);
  assert.deepEqual(last.rows.map((r) => r.STUSAB), ["IL", "MN"]);
  assert.equal(last.exceededTransferLimit, false);
  const all = parseArcgisQuery(F.ARCGIS_ALL_FIELDS);
  assert.equal(all.fields.length, 19);
  assert.equal(all.rows[1].NAME, "Maryland");
  assert.equal(all.rows[1].AREALAND, 25151392945);
  assert.equal(parseArcgisCount(F.ARCGIS_COUNT), 56);
  assert.throws(() => parseArcgisQuery(F.ARCGIS_ERROR), (e: any) => e instanceof SourceError && /Invalid or missing input parameters/.test(e.message) && e.detail === "400");
  assert.throws(() => parseArcgisCount(F.ARCGIS_ERROR), SourceError);
  assert.throws(() => parseArcgisQuery({ nope: 1 }), SourceError);
  assert.throws(() => parseArcgisCount({}), /no count/);
});

test("arcgis: arcgisAll follows exceededTransferLimit even when the server returns fewer rows than asked", async () => {
  const data = rowsOf(5);
  const SERVER_MAX = 2;
  const { urls, fetcher } = fake((u) => {
    const offset = Number(u.searchParams.get("resultOffset") ?? 0);
    const asked = Number(u.searchParams.get("resultRecordCount") ?? SERVER_MAX);
    const rows = data.slice(offset, offset + Math.min(asked, SERVER_MAX));
    const body: Record<string, unknown> = { features: rows.map((r) => ({ attributes: r })) };
    if (offset + rows.length < data.length) body.exceededTransferLimit = true;
    return body;
  });
  const all = await arcgisAll(LAYER, { orderByFields: "OBJECTID" }, { fetcher, pageSize: 5 });
  assert.equal(all.rows.length, 5);
  assert.equal(all.truncated, false);
  assert.deepEqual(urls.map((u) => new URL(u).searchParams.get("resultOffset")), ["0", "2", "4"]);

  const capped = await arcgisAll(LAYER, {}, { fetcher, pageSize: 5, maxRows: 3 });
  assert.equal(capped.rows.length, 3);
  assert.equal(capped.truncated, true);
  assert.deepEqual(urls.slice(3).map((u) => new URL(u).searchParams.get("resultRecordCount")), ["3", "1"]);
});

// ---------- JSON-stat and Eurostat ----------

test("jsonstat: flattens a real Eurostat cube (sparse values) in cube order", () => {
  const t = parseJsonStat(F.EUROSTAT_NAC);
  assert.equal(t.label, "Electricity prices for household consumers - bi-annual data");
  assert.equal(t.source, "ESTAT");
  assert.equal(t.updated, "2026-10-13T23:00:00+0200");
  assert.deepEqual(t.ids, ["freq", "siec", "nrg_cons", "unit", "tax", "currency", "geo", "time"]);
  assert.deepEqual(t.sizes, [1, 1, 1, 1, 1, 1, 2, 2]);
  assert.deepEqual(t.codes.geo, ["EL", "SE"]);
  assert.deepEqual(t.codes.time, ["2025-S2", "2026-S1"]);
  assert.equal(t.labels.geo.SE, "Sweden");
  assert.equal(t.labels.currency.NAC, "National currency");
  assert.equal(t.dimensionLabels.geo, "Geopolitical entity (reporting)");
  assert.equal(t.rows.length, 4);
  assert.deepEqual(t.rows[0], {
    freq: "S", siec: "E7000", nrg_cons: "KWH2500-4999", unit: "KWH", tax: "I_TAX", currency: "NAC", geo: "EL", time: "2025-S2", value: 0.2381,
  });
  assert.deepEqual(t.rows.map((r) => [r.geo, r.time, r.value]), [["EL", "2025-S2", 0.2381], ["EL", "2026-S1", 0.2401], ["SE", "2025-S2", 2.992], ["SE", "2026-S1", 3.3038]]);
});

test("jsonstat: an empty cube (Eurostat answers 200 with no countries) gives no rows", () => {
  const t = parseJsonStat(F.EUROSTAT_NO_SUCH_COUNTRY);
  assert.deepEqual(t.rows, []);
  assert.deepEqual(t.codes.geo, []);
  assert.equal(t.sizes[6], 0);
});

test("jsonstat: dense values with gaps, array indexes, one-category dimensions and status", () => {
  // Hand-made cubes in the JSON-stat 2.0 shapes (array value, array index, label-only dimension, status as list / object / text).
  const dense = {
    version: "2.0", class: "dataset", id: ["geo", "time"], size: [2, 3],
    dimension: {
      geo: { label: "Country", category: { index: ["IE", "FR"], label: { IE: "Ireland", FR: "France" } } },
      time: { category: { index: { "2025-S1": 0, "2025-S2": 1, "2026-S1": 2 } } },
    },
    value: [1.5, null, 1.7, 2.1, 2.2, null],
    status: [null, null, "p", null, "e", null],
  };
  const t = parseJsonStat(dense);
  assert.deepEqual(t.rows, [
    { geo: "IE", time: "2025-S1", value: 1.5 },
    { geo: "IE", time: "2026-S1", value: 1.7, status: "p" },
    { geo: "FR", time: "2025-S1", value: 2.1 },
    { geo: "FR", time: "2025-S2", value: 2.2, status: "e" },
  ]);
  assert.equal(t.labels.time["2025-S2"], "2025-S2"); // no label: falls back to the code
  assert.equal(t.dimensionLabels.time, "time");

  const sparse = { ...dense, value: { "0": 1.5, "2": 1.7, "4": 2.2 }, status: { "2": "p" } };
  const s = parseJsonStat(sparse);
  assert.deepEqual(s.rows.map((r) => [r.geo, r.time, r.value, r.status ?? null]), [["IE", "2025-S1", 1.5, null], ["IE", "2026-S1", 1.7, "p"], ["FR", "2025-S2", 2.2, null]]);

  const single = { version: "2.0", class: "dataset", id: ["unit", "time"], size: [1, 2], dimension: { unit: { category: { label: { KWH: "Kilowatt-hour" } } }, time: { category: { index: ["a", "b"] } } }, value: [3, 4], status: "f" };
  const one = parseJsonStat(single);
  assert.deepEqual(one.rows, [{ unit: "KWH", time: "a", value: 3, status: "f" }, { unit: "KWH", time: "b", value: 4, status: "f" }]);
  assert.equal(one.labels.unit.KWH, "Kilowatt-hour");
});

test("jsonstat: errors and malformed input become SourceErrors", () => {
  assert.throws(() => parseJsonStat({ error: [{ status: 400, label: "Dataset does not exist" }] }), (e: any) => e instanceof SourceError && /Dataset does not exist/.test(e.message));
  assert.throws(() => parseJsonStat({ error: { message: "bad" } }), SourceError);
  assert.throws(() => parseJsonStat("<html>"), /not a JSON-stat dataset/);
  assert.throws(() => parseJsonStat({ class: "collection", id: [], size: [], dimension: {} }), /not a JSON-stat dataset/);
  assert.throws(() => parseJsonStat({ version: "2.0", class: "dataset", id: ["a"], size: [2], dimension: { a: { category: { index: ["x"] } } }, value: [] }), /dimension a has 1 categories/);
  assert.throws(() => parseJsonStat({ version: "2.0", class: "dataset", id: ["a"], size: [1, 1], dimension: { a: { category: { index: ["x"] } } }, value: [] }), /id and size/);
  assert.throws(() => parseJsonStat({ version: "2.0", class: "dataset", id: ["a"], size: [1], dimension: { a: { category: { index: ["x"] } } }, value: "oops" }), /neither a list nor an object/);
});

test("jsonstat: rowsWhere filters on dimension codes", () => {
  const t = parseJsonStat(F.EUROSTAT_NAC);
  assert.equal(rowsWhere(t, { geo: "SE" }).length, 2);
  assert.equal(rowsWhere(t, { geo: ["SE", "EL"], time: "2026-S1" }).length, 2);
  assert.equal(rowsWhere(t, { geo: "FR" }).length, 0);
});

test("eurostat: URL builder (same request as the probed one), repeated keys and time options", () => {
  assert.equal(
    eurostatUrl("nrg_pc_204", { geo: "IE", nrg_cons: "KWH2500-4999", currency: "EUR", tax: "I_TAX", unit: "KWH" }),
    "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/nrg_pc_204?format=JSON&lang=EN&geo=IE&nrg_cons=KWH2500-4999&currency=EUR&tax=I_TAX&unit=KWH",
  );
  assert.equal(
    eurostatUrl("NRG_PC_204", { geo: "EL", currency: ["EUR", "NAC"] }, { lastTimePeriod: 4, lang: "FR" }),
    "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/nrg_pc_204?format=JSON&lang=FR&geo=EL&currency=EUR&currency=NAC&lastTimePeriod=4",
  );
  assert.match(eurostatUrl("nrg_pc_204", {}, { sinceTimePeriod: "2025-S1", untilTimePeriod: "2026-S1" }), /&sinceTimePeriod=2025-S1&untilTimePeriod=2026-S1$/);
  assert.match(eurostatUrl("nrg_pc_204", { time: "2025-S2" }), /&time=2025-S2$/);
  assert.match(eurostatUrl("x_y_z", {}, { baseUrl: "https://example.test/data" }), /^https:\/\/example\.test\/data\/x_y_z\?/);
});

test("eurostat: invalid codes, filters and time combinations are refused before any request", () => {
  assert.throws(() => eurostatUrl("../etc", {}), /dataset code/);
  assert.throws(() => eurostatUrl("nrg_pc_204", { "geo&x": "IE" }), /dimension name/);
  assert.throws(() => eurostatUrl("nrg_pc_204", { lang: "FR" }), /option, not a dimension/);
  assert.throws(() => eurostatUrl("nrg_pc_204", { geo: [] }), /no value/);
  assert.throws(() => eurostatUrl("nrg_pc_204", {}, { lastTimePeriod: 2, sinceTimePeriod: "2025-S1" }), /only one time parameter/);
  assert.throws(() => eurostatUrl("nrg_pc_204", { time: "2025-S1" }, { lastTimePeriod: 2 }), /only one time parameter/);
  assert.throws(() => eurostatUrl("nrg_pc_204", {}, { lastTimePeriod: 0 }), RangeError);
});

test("eurostat: country codes map between ISO and Eurostat (GR/EL, GB/UK)", () => {
  assert.equal(toEurostatGeo("gr"), "EL");
  assert.equal(toEurostatGeo("GB"), "UK");
  assert.equal(toEurostatGeo(" ie "), "IE");
  assert.equal(fromEurostatGeo("EL"), "GR");
  assert.equal(fromEurostatGeo("uk"), "GB");
  assert.equal(fromEurostatGeo("DE"), "DE");
});

test("eurostat: time periods give date ranges and the period before", () => {
  assert.deepEqual(periodRange("2026-S1"), { from: "2026-01-01", to: "2026-06-30" });
  assert.deepEqual(periodRange("2025-S2"), { from: "2025-07-01", to: "2025-12-31" });
  assert.deepEqual(periodRange("2024"), { from: "2024-01-01", to: "2024-12-31" });
  assert.deepEqual(periodRange("2024-Q1"), { from: "2024-01-01", to: "2024-03-31" });
  assert.deepEqual(periodRange("2024-Q4"), { from: "2024-10-01", to: "2024-12-31" });
  assert.deepEqual(periodRange("2024-02"), { from: "2024-02-01", to: "2024-02-29" }); // leap year
  assert.equal(periodRange("2024-W05"), null);
  assert.equal(previousPeriod("2026-S1"), "2025-S2");
  assert.equal(previousPeriod("2026-S2"), "2026-S1");
  assert.equal(previousPeriod("2026-Q1"), "2025-Q4");
  assert.equal(previousPeriod("2026-Q3"), "2026-Q2");
  assert.equal(previousPeriod("2026-01"), "2025-12");
  assert.equal(previousPeriod("2026-03"), "2026-02");
  assert.equal(previousPeriod("2026"), "2025");
  assert.equal(previousPeriod("latest"), null);
});

test("eurostat: fetchEurostat and fetchJsonStat fetch once and parse", async () => {
  const { urls, fetcher } = fake(() => F.EUROSTAT_NAC);
  const t = await fetchEurostat("nrg_pc_204", { geo: ["EL", "SE"] }, { lastTimePeriod: 2 }, { fetcher });
  assert.equal(urls.length, 1);
  assert.match(urls[0], /nrg_pc_204\?format=JSON&lang=EN&geo=EL&geo=SE&lastTimePeriod=2$/);
  assert.equal(t.rows.length, 4);
  const again = await fetchJsonStat("https://example.test/cube.json", { fetcher });
  assert.equal(again.rows.length, 4);
  assert.equal(urls[1], "https://example.test/cube.json");
  await assert.rejects(fetchJsonStat("https://example.test/x", { fetcher: async () => ({ not: "json-stat" }) }), SourceError);
});
