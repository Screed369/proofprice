// Fixtures copied from LIVE WPRDC responses fetched on 2026-11-12 (datastore_search with fields MUNIDESC,PROPERTYZIP,SALEDATE,PRICE,SALEDESC and
// filters SALEDESC='VALID SALE' on the 2026 table 0bd13902-f2ee-4340-b7c8-c54ebd0f6bd0; 7,420 valid sales that year; package_show real-estate-sales).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  alleghenyHarvest, alleghenyHistoryKey, alleghenyHomeSales, alleghenyKey, dailyRows, INFO, isAlleghenyRequest, monthIndex, muniSlug,
  parseSales, resolveArea, yearlyResources, type Sale,
} from "./source";
import usHomeSales from "../us-home-sales";
import { findSource } from "../../lib/registry";

const LIVE = [
  { MUNIDESC: "O''Hara  ", PROPERTYZIP: "15215", SALEDATE: "2026-05-08", PRICE: 763000, SALEDESC: "VALID SALE" },
  { MUNIDESC: "Sharpsburg  ", PROPERTYZIP: "15215", SALEDATE: "2026-05-01", PRICE: 163000, SALEDESC: "VALID SALE" },
  { MUNIDESC: "Castle Shannon  ", PROPERTYZIP: "15234", SALEDATE: "2026-05-21", PRICE: 95000, SALEDESC: "VALID SALE" },
];

test("US-Allegheny: parse the live rows: municipality slug, ZIP, date and price only", () => {
  const s = parseSales(LIVE);
  assert.deepEqual(s.map((x) => [x.muni, x.zip, x.day, x.price]), [
    ["o-hara", "15215", "2026-05-08", 763000], ["sharpsburg", "15215", "2026-05-01", 163000], ["castle-shannon", "15234", "2026-05-21", 95000],
  ]);
  assert.ok(Object.keys(s[0]).every((k) => ["idx", "day", "muni", "zip", "price"].includes(k)), "no parcel id or address is kept");
});

test("US-Allegheny: Pittsburgh wards collapse to one city; odd prices and dates are dropped", () => {
  assert.equal(muniSlug("14th Ward - PITTSBURGH"), "pittsburgh");
  assert.equal(muniSlug("Mt.Lebanon  "), "mt-lebanon");
  const s = parseSales([...LIVE, { MUNIDESC: "Ross", PROPERTYZIP: "15237", SALEDATE: "2026-05-02", PRICE: 1 }, { MUNIDESC: "Ross", PROPERTYZIP: "15237", SALEDATE: null, PRICE: 300000 },
    { MUNIDESC: "Ross", PROPERTYZIP: "15237", SALEDATE: "2026-05-02", PRICE: 12000000 }, { MUNIDESC: "Ross", PROPERTYZIP: "", SALEDATE: "2026-05-02", PRICE: 250000 }]);
  assert.equal(s.length, 4);
  assert.equal(s[3].zip, "");
});

test("US-Allegheny: yearly tables come from package_show names, newest first", () => {
  const r = yearlyResources([
    { id: "a", name: "Property Sales Transactions", datastoreActive: true }, { id: "b", name: "2025 Property Sales Transactions", datastoreActive: true },
    { id: "c", name: "2026 Property Sales Transactions", datastoreActive: true }, { id: "d", name: "Parcels N'at", datastoreActive: false },
    { id: "e", name: "2024 Property Sales Transactions", datastoreActive: false },
  ]);
  assert.deepEqual(r, [{ year: 2026, id: "c" }, { year: 2025, id: "b" }]);
});

const mk = (muni: string, zip: string, n: number, price: number, day: string): Sale[] =>
  Array.from({ length: n }, (_, i) => ({ idx: monthIndex(Number(day.slice(0, 4)), Number(day.slice(5, 7))), day, muni, zip, price: price + i * 1000 }));

test("US-Allegheny: daily rows: windows end at the newest sale, under 5 sales never published, county ALL row, ZIPs only 12/24", () => {
  const sales = [...mk("ross", "15237", 6, 290000, "2026-11-10"), ...mk("moon", "15108", 4, 330000, "2026-11-10"), ...mk("shaler", "15209", 5, 300000, "2026-01-05"), ...mk("shaler", "15209", 5, 310000, "2024-12-20")];
  const { date, rows } = dailyRows(sales, "2026-11-12");
  assert.equal(date, "2026-11-10");
  const get = (a: string, i: string) => rows.find((r) => r.area === a && r.item === i);
  assert.equal(get("ross", "3m")?.n, 6);
  assert.equal(get("moon", "12m"), undefined); // 4 sales
  assert.equal(get("shaler", "3m"), undefined);
  assert.equal(get("shaler", "12m")?.n, 5);
  assert.equal(get("shaler", "24m")?.n, 10);
  assert.equal(get("zip-15209", "12m")?.n, 5);
  assert.equal(get("zip-15209", "3m"), undefined);
  assert.equal(get("ALL", "12m")?.n, 15);
  assert.throws(() => dailyRows([], "2026-11-12"), /no usable/);
});

test("US-Allegheny: the collector reads the newest three yearly tables with a valid-sale filter and reduces to aggregates", async () => {
  const urls: string[] = [];
  const fetcher = async (url: string) => {
    urls.push(url);
    if (url.includes("package_show")) {
      return { success: true, result: { id: "x", name: "real-estate-sales", title: "t", license_id: "cc-zero", resources: [
        { id: "r26", name: "2026 Property Sales Transactions", format: "CSV", url: "u", datastore_active: true },
        { id: "r25", name: "2025 Property Sales Transactions", format: "CSV", url: "u", datastore_active: true },
        { id: "r21", name: "2021 Property Sales Transactions", format: "CSV", url: "u", datastore_active: true },
      ] } };
    }
    const rid = /resource_id=(r\d+)/.exec(url)![1];
    const rows = rid === "r26"
      ? [1, 2, 3, 4, 5, 6].map((i) => ({ MUNIDESC: "14th Ward - PITTSBURGH", PROPERTYZIP: "15217", SALEDATE: "2026-10-1" + i, PRICE: 400000 + i * 1000 }))
      : rid === "r25" ? [{ MUNIDESC: "Ross  ", PROPERTYZIP: "15237", SALEDATE: "2025-12-01", PRICE: 280000 }] : [];
    return { success: true, result: { records: rows, fields: [], total: rows.length } };
  };
  const h = await alleghenyHarvest({ fetcher, today: new Date("2026-11-12T03:00:00Z") });
  assert.equal(h.date, "2026-10-16");
  assert.equal(h.unit, "per sale");
  assert.ok(h.rows.find((r) => r.area === "pittsburgh" && r.item === "3m" && r.n === 6));
  assert.equal(h.rows.find((r) => r.area === "ross"), undefined); // one sale, never published
  const data = urls.filter((u) => !u.includes("package_show"));
  assert.equal(data.length, 2); // 2021 is older than three years: not read
  assert.ok(data.every((u) => decodeURIComponent(u).includes('"SALEDESC":"VALID SALE"') && u.includes("fields=MUNIDESC%2CPROPERTYZIP%2CSALEDATE%2CPRICE")));
  assert.ok(data.every((u) => !/PARID|ADDRESS/.test(u)));
});

test("US-Allegheny: request routing: Allegheny requests come here; Connecticut, Chicago, New York, DC and Arizona do not", () => {
  for (const p of [{ town: "Pittsburgh" }, { town: "Pittsburgh, PA" }, { state: "PA" }, { postcode: "15213" }, { town: "Penn Hills" }, { town: "Allegheny County" }, { town: "Mt. Lebanon" }]) {
    assert.equal(isAlleghenyRequest(p), true, JSON.stringify(p));
    assert.equal(findSource("home-sales", "US", p)?.info.id, "us-allegheny-home-sales", JSON.stringify(p));
  }
  for (const p of [{ town: "Hartford" }, { town: "Chicago" }, { town: "Brooklyn" }, { state: "AZ" }, { postcode: "20001" }, { postcode: "85016" }, { postcode: "11201" }, { town: "Washington, DC" }, {}]) {
    assert.equal(isAlleghenyRequest(p), false, JSON.stringify(p));
    assert.notEqual(findSource("home-sales", "US", p)?.info.id, "us-allegheny-home-sales", JSON.stringify(p));
  }
  assert.equal(usHomeSales.serves?.({ town: "Pittsburgh" }), true); // the later folder would say yes: ours sorts first on purpose
});

test("US-Allegheny: place names: municipality, ZIP, county, unknown; window rounding", () => {
  const known = ["pittsburgh", "ross", "zip-15213"];
  assert.deepEqual(resolveArea({ town: "Pittsburgh, PA" }, known), { area: "pittsburgh", label: "Pittsburgh, PA" });
  assert.deepEqual(resolveArea({ postcode: "15213" }, known), { area: "zip-15213", label: "ZIP 15213" });
  assert.equal(resolveArea({ postcode: "15999" }, known), null);
  assert.equal(resolveArea({}, known)?.area, "ALL");
  assert.equal(resolveArea({ town: "Narnia" }, known), null);
  assert.equal(alleghenyKey({ town: "Ross", months: 5 }, known)?.item, "6m");
  assert.equal(alleghenyKey({ postcode: "15213", months: 3 }, known)?.item, "12m");
});

test("US-Allegheny: answer from the library: CC0 labelled, widened window, thin area, ZIP, unknown place", async () => {
  const id = INFO.id;
  const dir = mkdtempSync(path.join(tmpdir(), "allegheny-lib-"));
  mkdirSync(path.join(dir, id, "daily"), { recursive: true });
  writeFileSync(path.join(dir, id, "meta.json"), JSON.stringify({ last_date: "2026-11-10" }));
  writeFileSync(path.join(dir, id, "daily", "2026-11.csv"), [
    "date,area,item,n,median,low,high,min,max",
    "2026-11-10,pittsburgh,12m,2900,255000,90000,520000,10000,3000000",
    "2026-11-10,ross,3m,3,290000,250000,330000,250000,330000",
    "2026-11-10,ross,12m,268,290000,190000,420000,60000,900000",
    "2026-11-10,zip-15213,12m,150,310000,120000,600000,30000,1500000",
    "2026-11-10,ALL,12m,15000,250000,100000,480000,10000,4000000",
  ].join("\n") + "\n");
  const prev = process.env.PROOFPRICE_LIBRARY_DIR;
  process.env.PROOFPRICE_LIBRARY_DIR = dir;
  try {
    const a = await alleghenyHomeSales({ town: "Pittsburgh, PA" });
    assert.equal(a.status, "ok");
    assert.equal(a.sample_size, 2900);
    assert.match(a.summary, /median price of US\$255,000/);
    assert.match(JSON.stringify(a), /CC0/);
    const w = await alleghenyHomeSales({ town: "Ross", months: 3 });
    assert.equal((w.extra as any).window_widened, true);
    assert.equal(w.sample_size, 268);
    assert.equal((await alleghenyHomeSales({ postcode: "15213" })).sample_size, 150);
    assert.equal((await alleghenyHomeSales({})).sample_size, 15000);
    await assert.rejects(alleghenyHomeSales({ town: "Narnia" }), /No figure for/);
    assert.deepEqual(alleghenyHistoryKey({ town: "Pittsburgh" }), { area: "pittsburgh", item: "12m", label: "Pittsburgh, PA, Allegheny County" });
  } finally {
    if (prev === undefined) delete process.env.PROOFPRICE_LIBRARY_DIR; else process.env.PROOFPRICE_LIBRARY_DIR = prev;
  }
});
