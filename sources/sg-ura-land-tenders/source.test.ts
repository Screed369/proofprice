// Tests for the SG state-land tender awards. fixtures/tenders.json is the WHOLE real file (340 records, awards 1993-02-15 to 2016-07-01,
// tenderer names replaced by "(removed)") from https://data.gov.sg/api/action/datastore_search?resource_id=d_e225b635fbe3ecf5b378447e4b517939&limit=340
// checked on 2026-10-30. Expected figures below were computed independently in Python from the same file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { InputError, SourceError } from "../../lib/http";
import { parseDatastoreSearch } from "../../lib/adapters";
import { INFO, answerFromSites, parseNum, parseSites, sgLandTenders } from "./source";

const RECORDS = parseDatastoreSearch(JSON.parse(readFileSync(new URL("./fixtures/tenders.json", import.meta.url), "utf8"))).records;

test("licence and type", () => {
  assert.match(INFO.licence, /Singapore Open Data Licence/);
  assert.equal(INFO.price_type, "transaction");
});

test("numbers: digits, decimals, 'na' and empty", () => {
  assert.equal(parseNum("15936.1"), 15936.1);
  assert.equal(parseNum("1,200"), 1200);
  assert.equal(parseNum("na"), null);
  assert.equal(parseNum(""), null);
  assert.equal(parseNum(undefined), null);
});

test("parses the whole real file; a missing price per m² is rebuilt from price / floor area", () => {
  const p = parseSites(RECORDS);
  assert.equal(p.rows, 340);
  assert.equal(p.sites.length, 340);
  assert.equal(p.dropped, 0);
  assert.throws(() => parseSites(RECORDS.slice(0, 20)), SourceError);
});

test("all of Singapore: median S$ per m² of GFA matches the independent calculation", () => {
  const a = answerFromSites(parseSites(RECORDS), { property_type: "land" });
  assert.equal(a.status, "ok");
  assert.equal(a.sample_size, 340);
  assert.equal(a.price!.currency, "SGD");
  assert.ok(Math.abs(a.price!.median! - 3705.66) < 10, String(a.price!.median));
  assert.deepEqual(a.period, { from: "1993-02-15", to: "2016-07-01" });
  assert.equal(a.price_type, "transaction");
  assert.match(a.summary, /not homes/);
  assert.ok(!JSON.stringify(a).includes("Pte"), "no tenderer name is ever shown");
});

test("a planning area filters the sites (Bedok: 40 sites)", () => {
  const a = answerFromSites(parseSites(RECORDS), { town: "bedok" });
  assert.equal(a.sample_size, 40);
  assert.ok(Math.abs(a.price!.median! - 3020.4) < 10);
});

test("months looks back from the newest award in the file (120 months: 184 sites)", () => {
  const a = answerFromSites(parseSites(RECORDS), { months: 120 });
  assert.equal(a.sample_size, 184);
  assert.ok(Math.abs(a.price!.median! - 5188.74) < 10);
});

test("an area with fewer than 5 sites gives no range; an unknown area gives no_matches", () => {
  const p = parseSites(RECORDS);
  const thin = answerFromSites(p, { town: "River Valley" });
  assert.equal(thin.status, "insufficient_data");
  assert.equal(thin.price, null);
  assert.equal(answerFromSites(p, { town: "Atlantis" }).status, "no_matches");
});

test("unsupported inputs are clear 400s", () => {
  const p = parseSites(RECORDS);
  assert.throws(() => answerFromSites(p, { postcode: "049145" }), InputError);
  assert.throws(() => answerFromSites(p, { property_type: "commercial" }), InputError);
  assert.throws(() => answerFromSites(p, { months: 0 }), InputError);
  assert.throws(() => answerFromSites(p, { town: "x" }), InputError);
});

test("fetch path uses the injected fetcher", async () => {
  const a = await sgLandTenders({ town: "Bedok" }, async () => RECORDS);
  assert.equal(a.sample_size, 40);
});
