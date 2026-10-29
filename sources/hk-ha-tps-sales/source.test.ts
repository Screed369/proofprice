import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseTps, parseDate, parseSqm, dailyRows, resolveArea, tpsKey, monthsBack, tpsAnswerFromRow, INFO, type Sale } from "./source";

// Fixture: the JSON shape of tps_sale_transactions_en.json as probed 2026-10-21 (all values are strings). The SHAN KING row is the real
// newest sample from that probe; the CHEUNG HONG row and the blank-price row are built from the same documented shape for the tests.
const fixture = JSON.parse(readFileSync(path.join(__dirname, "fixtures", "tps-head.json"), "utf8"));

test("HK-TPS: dates are dd-mm-yyyy, areas are 'sq m / sq ft'", () => {
  assert.equal(parseDate("22-09-2026"), "2026-09-22");
  assert.equal(parseDate("2026-09-22"), null);
  assert.equal(parseSqm("26/284"), 26);
  assert.equal(parseSqm("45"), 45);
  assert.equal(parseSqm("/284"), null);
});

test("HK-TPS: parse the sample: blank price dropped, coordinates and floor never kept", () => {
  const s = parseTps(fixture);
  assert.equal(s.length, 2);
  assert.deepEqual(s.map((x) => [x.date, x.estate, x.district, x.price]), [
    ["2026-09-08", "cheung-hong-estate", "tsing-yi", 1032000],
    ["2026-09-22", "shan-king-estate", "sha-tin", 284800],
  ]);
  assert.equal(s[1].m2, 284800 / 26);
  assert.ok(!("floor_level" in s[0]) && !JSON.stringify(s).includes("22.3453"));
});

test("HK-TPS: a changed shape fails loudly; implausible prices are dropped", () => {
  assert.throws(() => parseTps({ rows: [] }), /unexpected format/);
  assert.throws(() => parseTps({ records: [{ foo: 1 }] }), /columns changed/);
  const r = { location: "X", estate_name: "A", saleable_floor_area: "30/300", assignment_date: "01-01-2026" };
  assert.equal(parseTps({ records: [{ ...r, transaction_price: "5000" }, { ...r, transaction_price: "25000000" }, { ...r, transaction_price: "null" }] }).length, 0);
});

const mk = (estate: string, district: string, n: number, price: number, date = "2026-09-01"): Sale[] =>
  Array.from({ length: n }, (_, i) => ({ date, estate, district, price: price + i * 1000, m2: (price + i * 1000) / 30 }));

test("HK-TPS: daily rows: windows end at the newest sale, under 5 sales never published, ALL and district rows", () => {
  const sales = [...mk("shan-king-estate", "sha-tin", 6, 280000), ...mk("tai-hing-estate", "sha-tin", 4, 400000), ...mk("old-estate", "tsing-yi", 5, 200000, "2025-01-10")];
  const { date, rows } = dailyRows(sales, "2026-10-29");
  assert.equal(date, "2026-09-01");
  const get = (a: string, i: string) => rows.find((r) => r.area === a && r.item === i);
  assert.equal(get("shan-king-estate", "any:12m")?.n, 6);
  assert.equal(get("tai-hing-estate", "any:12m"), undefined);
  assert.equal(get("ALL", "any:12m")?.n, 10); // old-estate falls out of the 12-month window
  assert.equal(get("ALL", "any:24m")?.n, 15);
  assert.equal(get("d-sha-tin", "any:12m")?.n, 10);
  assert.equal(get("d-tsing-yi", "any:12m"), undefined);
  assert.ok(get("shan-king-estate", "any-m2:12m"));
  assert.equal(monthsBack("2026-09-01", 12), "2025-09-01");
});

const known = ["shan-king-estate", "cheung-hong-estate", "d-sha-tin", "d-tsing-yi"];
test("HK-TPS: places resolve to estates, districts or all estates", () => {
  assert.equal(resolveArea("", known)?.area, "ALL");
  assert.equal(resolveArea("Hong Kong", known)?.area, "ALL");
  assert.equal(resolveArea("Shan King", known)?.area, "shan-king-estate");
  assert.equal(resolveArea("Shan King Estate", known)?.area, "shan-king-estate");
  assert.equal(resolveArea("Sha Tin", known)?.area, "d-sha-tin");
  assert.equal(resolveArea("Atlantis", known), null);
  assert.equal(tpsKey({ town: "Shan King", months: 20 }, known)?.item, "any:24m");
  assert.equal(tpsKey({}, known)?.item, "any:12m");
});

test("HK-TPS: the answer says these are discounted public-flat sales, not market prices", () => {
  const row = { date: "2026-09-22", area: "shan-king-estate", item: "any:12m", n: 7, median: 290000, low: 260000, high: 320000, min: 250000, max: 330000 };
  const a = tpsAnswerFromRow(row, undefined, { label: "Shan King Estate", months: 12 });
  assert.equal(a.status, "ok");
  assert.equal(a.sample_size, 7);
  assert.match(a.summary, /NOT market prices/);
  assert.match(a.summary, /government discount/);
  assert.equal(a.period.to, "2026-09-22");
  assert.equal(INFO.price_type, "transaction");
  assert.match(INFO.attribution, /DATA\.GOV\.HK/);
});
