import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseSites, monthIndexOf, monthLabel, newestMonthly, resolveQldScope, buildSql, qldAnswer, qldFuelNow, findMonthly, MIN_TENTHS,
} from "./source";
import { parsePackageShow } from "../../lib/adapters";

// Checked live on 21 Oct 2026 (probes qldfuelpkg, qldfuel4122, qldfuelsql, qldfueltypes) against www.data.qld.gov.au.
// package_show of fuel-price-reporting-2026, trimmed to the fields we read.
const packageJson = {
  success: true,
  result: {
    id: "0dfad294-f852-45a5-b86f-986773745fe2",
    name: "fuel-price-reporting-2026",
    title: "Fuel price reporting 2026",
    license_id: "CC-BY-4.0",
    license_title: "Creative Commons Attribution 4.0",
    license_url: "https://creativecommons.org/licenses/by/4.0/",
    metadata_modified: "2026-09-02T02:24:21.546378",
    resources: [
      { id: "324be6a3-698a-408a-9c0e-022aa94b9543", name: "Fuel price publisher and data consumer API sign up website", format: "TXT", url: "https://www.fuelpricesqld.com.au/", datastore_active: false, last_modified: "2026-06-02T00:35:30.168019" },
      { id: "2fc7161e-cf1f-4228-a1c7-141f0df99b4c", name: "Dataset column explanation for Fuel Price Reporting", format: "TXT", url: "https://www.data.qld.gov.au/dataset/x/resource/2fc7161e/download/dataset-column-explanation-for-fuel-price-reporting.txt", datastore_active: false, last_modified: "2026-06-02T00:35:30.171004" },
      { id: "e5fe46df-32e3-4a5b-b380-0ed487153867", name: "Queensland Fuel Prices July 2026", format: "CSV", url: "https://www.data.qld.gov.au/dataset/x/resource/e5fe46df/download/queensland-fuel-prices-july-2026.csv", datastore_active: true, last_modified: "2026-08-04T05:09:42.802500" },
      { id: "420319e2-6518-4243-83a6-3c7769bd7e6c", name: "Queensland Fuel Prices August 2026", format: "CSV", url: "https://www.data.qld.gov.au/dataset/x/resource/420319e2/download/queensland-fuel-prices-august-2026.csv", datastore_active: true, last_modified: "2026-09-02T01:40:19.860633" },
    ],
  },
};

// Records of datastore_search_sql for Diesel in postcode 4122 (real: the four stations in the file), then four rows
// built for this test by changing SiteId and price only, so the sample reaches five stations.
const real = [
  { SiteId: 61401212, Site_Name: "Shell Reddy Express Logan Rd", Site_Brand: "Reddy Express", Sites_Address_Line_1: "1201 Logan Road", Site_Suburb: "Mount Gravatt", Site_Post_Code: 4122, Price: 2559, TransactionDateutc: "2026-08-31T01:05:00" },
  { SiteId: 61401398, Site_Name: "Shell Reddy Express Mount Gravatt", Site_Brand: "Reddy Express", Sites_Address_Line_1: "1582 Logan Rd", Site_Suburb: "Mount Gravatt", Site_Post_Code: 4122, Price: 2559, TransactionDateutc: "2026-08-23T22:05:00" },
  { SiteId: 61401448, Site_Name: "Shell Reddy Express Kessels Rd", Site_Brand: "Reddy Express", Sites_Address_Line_1: "651 Kessels Road", Site_Suburb: "Mount Gravatt", Site_Post_Code: 4122, Price: 2569, TransactionDateutc: "2026-08-22T23:15:00" },
  { SiteId: 61401545, Site_Name: "Freedom Fuels Mt Gravatt", Site_Brand: "Freedom Fuels", Sites_Address_Line_1: "154 Creek Road", Site_Suburb: "Mount Gravatt East", Site_Post_Code: 4122, Price: 2555, TransactionDateutc: "2026-08-24T21:51:00" },
];
const built = [
  { ...real[0], SiteId: 1, Price: 2499, TransactionDateutc: "2026-08-02T01:00:00" },
  { ...real[0], SiteId: 2, Price: 2599, TransactionDateutc: "2026-08-10T01:00:00" },
  { ...real[0], SiteId: 3, Price: 9999, TransactionDateutc: "2026-08-11T01:00:00" }, // the scheme's "not available" marker
  { ...real[0], SiteId: 4, Price: 25, TransactionDateutc: "2026-08-11T01:00:00" }, // slip seen in the data
];

test("resource names give the month; other files are ignored", () => {
  assert.equal(monthIndexOf("Queensland Fuel Prices August 2026"), 2026 * 12 + 7);
  assert.equal(monthIndexOf("Dataset column explanation for Fuel Price Reporting"), null);
  assert.equal(monthIndexOf("Queensland Fuel Prices Smarch 2026"), null);
  assert.equal(monthLabel(2026 * 12 + 7), "August 2026");
});

test("the newest searchable monthly file is chosen from package_show", () => {
  const pkg = parsePackageShow(packageJson);
  const n = newestMonthly(pkg.resources);
  assert.equal(n?.resource.id, "420319e2-6518-4243-83a6-3c7769bd7e6c");
  assert.equal(monthLabel(n!.month), "August 2026");
  assert.equal(pkg.licenceId, "CC-BY-4.0");
});

test("unusable prices (999.9 marker, slips) are dropped; tenths of a cent are kept", () => {
  const sites = parseSites([...real, ...built]);
  assert.equal(sites.length, 6);
  assert.ok(sites.every((s) => s.tenths >= MIN_TENTHS));
  assert.equal(sites[0].date, "2026-08-31");
  assert.equal(sites[0].suburb, "Mount Gravatt");
});

test("scopes: postcode, suburb, Brisbane and state; a bad postcode is a 400", () => {
  assert.deepEqual(resolveQldScope({ area: "QLD" }).kind, "state");
  assert.equal(resolveQldScope({ area: "Brisbane" }).kind, "brisbane");
  assert.equal(resolveQldScope({ town: "brisbane" }).kind, "brisbane");
  const sub = resolveQldScope({ town: "Mount Gravatt" });
  assert.deepEqual([sub.kind, (sub as any).name], ["suburb", "MOUNT GRAVATT"]);
  assert.equal((resolveQldScope({ postcode: "4122" }) as any).postcode, 4122);
  assert.throws(() => resolveQldScope({ postcode: "2000" }), /Queensland postcode/);
  assert.throws(() => resolveQldScope({}), /Give a Queensland suburb/);
});

test("the SQL asks for each station's latest price, quoted, for the right scope", () => {
  const sql = buildSql("420319e2-6518-4243-83a6-3c7769bd7e6c", "Diesel", resolveQldScope({ postcode: "4122" }));
  assert.match(sql, /^SELECT DISTINCT ON \("SiteId"\)/);
  assert.match(sql, /FROM "420319e2-6518-4243-83a6-3c7769bd7e6c"/);
  assert.match(sql, /"Fuel_Type" = 'Diesel'/);
  assert.match(sql, /"Site_Post_Code" = 4122/);
  assert.match(sql, /ORDER BY "SiteId","TransactionDateutc" DESC$/);
  const bris = buildSql("r", "Diesel", resolveQldScope({ area: "Brisbane" }));
  assert.match(bris, /BETWEEN 4000 AND 4179/);
  const quoted = buildSql("r", "Diesel", resolveQldScope({ town: "O'Connell" }));
  assert.match(quoted, /upper\("Site_Suburb"\) = 'O''CONNELL'/);
});

test("answer: median in dollars per litre, 5+ stations, labelled posted and a month old", () => {
  const sites = parseSites([...real, ...built]);
  const a = qldAnswer(sites, { fuel: "diesel", scope: resolveQldScope({ area: "Brisbane" }), month: 2026 * 12 + 7, query: { area: "Brisbane" } });
  assert.equal(a.status, "ok");
  assert.equal(a.sample_size, 6);
  assert.equal(a.price?.currency, "AUD");
  assert.equal(a.price?.unit, "per litre");
  assert.equal(a.price?.median, 2.559); // sorted: 2.499 2.555 2.559 2.559 2.569 2.599
  assert.match(a.summary, /August 2026/);
  assert.match(a.summary, /not today's price/);
  assert.equal((a.extra as any).cheapest_stations[0].price, 2.499);
  assert.equal(a.period.from, "2026-08-02");
  assert.equal(a.period.to, "2026-08-31");
});

test("answer: fewer than 5 stations gives no range (the four real stations of postcode 4122)", () => {
  const a = qldAnswer(parseSites(real), { fuel: "diesel", scope: resolveQldScope({ postcode: "4122" }), month: 2026 * 12 + 7, query: { postcode: "4122" } });
  assert.equal(a.status, "insufficient_data");
  assert.equal(a.price, null);
});

test("end to end with a fake portal: package_show, then the SQL, then the answer", async () => {
  const urls: string[] = [];
  const fetcher = async (url: string) => {
    urls.push(url);
    if (url.includes("package_show")) return packageJson;
    if (url.includes("datastore_search_sql")) return { success: true, result: { records: [...real, ...built], fields: [] } };
    throw new Error("unexpected " + url);
  };
  const a = await qldFuelNow({ area: "Brisbane", fuel: "diesel" }, { fetcher, now: new Date("2026-10-21T00:00:00Z") });
  assert.equal(a.status, "ok");
  assert.ok(urls[0].includes("id=fuel-price-reporting-2026"));
  assert.ok(decodeURIComponent(urls[1]).includes('"420319e2-6518-4243-83a6-3c7769bd7e6c"'));
  await assert.rejects(() => qldFuelNow({ area: "QLD", fuel: "methane" }, { fetcher }), /not published for Queensland/);
});

test("in January the new year's dataset may be missing: last year's newest month answers", async () => {
  const fetcher = async (url: string) => {
    if (url.includes("fuel-price-reporting-2027")) throw new Error("404");
    return packageJson;
  };
  const n = await findMonthly(new Date("2027-01-05T00:00:00Z"), { fetcher });
  assert.equal(monthLabel(n.month), "August 2026");
});

import { qldDailyRows, qldHistoryKey, monthEndDate } from "./source";

const mk = (id: number, tenths: number, postcode: number, suburb: string) => ({
  siteId: id, name: "", brand: "", address: "", suburb, postcode, tenths, date: "2026-08-10",
});

test("daily rows: state, Greater Brisbane, postcode and suburb; areas with fewer than 5 stations are not stored", () => {
  const sites = [
    ...[2500, 2510, 2520, 2530, 2540].map((t, i) => mk(i, t, 4122, "Mount Gravatt")),
    ...[2600, 2610].map((t, i) => mk(10 + i, t, 4870, "Cairns")),
  ];
  const rows = qldDailyRows({ diesel: parseSites(sites.map((x) => ({ SiteId: x.siteId, Site_Suburb: x.suburb, Site_Post_Code: x.postcode, Price: x.tenths, TransactionDateutc: "2026-08-10T00:00:00" }))) });
  const areas = rows.map((r) => r.area);
  assert.deepEqual(areas, ["4122", "BRISBANE", "MOUNT GRAVATT", "QLD"]);
  assert.equal(rows.find((r) => r.area === "QLD")!.n, 7);
  assert.equal(rows.find((r) => r.area === "4122")!.median, 2.52);
});

test("history keys follow the live place rules; month end date", () => {
  assert.deepEqual(qldHistoryKey({ fuel: "diesel", area: "QLD" }), { area: "QLD", item: "diesel", label: "Queensland" });
  assert.equal(qldHistoryKey({ fuel: "diesel", area: "Brisbane" })?.area, "BRISBANE");
  assert.equal(qldHistoryKey({ fuel: "petrol95", postcode: "4122" })?.area, "4122");
  assert.equal(qldHistoryKey({ fuel: "lpg", town: "Mount  Gravatt" })?.area, "MOUNT GRAVATT");
  assert.equal(qldHistoryKey({ fuel: "petrol95", postcode: "2000" }), null);
  assert.equal(qldHistoryKey({ fuel: "hydrogen", area: "QLD" }), null);
  assert.equal(monthEndDate(2026 * 12 + 7), "2026-08-31");
});

import { QLD_FUEL_TYPE, INFO as QLD_INFO } from "./source";

test("petrol95 answers with standard Unleaded (91 RON) and the text no longer says 95/96 does not exist (Fuel_Type values read from the August 2026 file)", () => {
  assert.equal(QLD_FUEL_TYPE.petrol95, "Unleaded");
  assert.equal(QLD_FUEL_TYPE.petrol98, "PULP 98 RON");
  assert.match(QLD_INFO.limits, /PULP 95\/96 RON/);
  assert.doesNotMatch(QLD_INFO.limits, /not offered/);
});
