// Fixture: real SCB JSON-stat2 response for TAB6421 (rents in newly constructed rented flats), captured 2026-10-22 via the GitHub-hosted probe.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { INFO, matchRegion, parseTable, pickLatest, roomCode, seNewBuildRent, URL_ALL } from "./source";
import manifest from "./index";

const FIX = JSON.parse(readFileSync(new URL("./fixtures/tab6421.json", import.meta.url), "utf8"));

test("parses the table and keeps CC0 licence", () => {
  const t = parseTable(FIX);
  assert.ok(t.rows.length > 90);
  assert.ok(INFO.licence.includes("CC0"));
});

test("pickLatest: Sweden 3 rooms and Greater Stockholm 3 rooms (2025)", () => {
  const t = parseTable(FIX);
  const se = pickLatest(t, "00", "3")!;
  assert.deepEqual(se, { year: "2025", monthly: 13571, perM2: 2353, dwellings: 2511 });
  const sth = pickLatest(t, "0010", "3")!;
  assert.equal(sth.monthly, 15537);
  assert.equal(sth.dwellings, 810);
});

test("cells that SCB suppresses (..) give no figure", () => {
  const t = parseTable(FIX);
  assert.equal(pickLatest(t, "0010", "99"), null);
});

test("region and rooms matching", () => {
  const t = parseTable(FIX);
  assert.equal(matchRegion(t, "Göteborg").code, "0020");
  assert.equal(matchRegion(t, "Greater Gothenburg").label, "Greater Gothenburg");
  assert.equal(matchRegion(t, undefined).label, "Sweden");
  assert.throws(() => matchRegion(t, "Atlantis"), /not a region group/);
  assert.equal(roomCode(undefined), "00");
  assert.equal(roomCode(7), "4");
  assert.throws(() => roomCode(0), /ROOMS/);
});

test("answer for Greater Stockholm, 2 rooms", async () => {
  const calls: string[] = [];
  const a = await seNewBuildRent({ town: "Greater Stockholm", rooms: 2 }, async (u) => (calls.push(u), FIX));
  assert.deepEqual(calls, [URL_ALL]);
  assert.equal(a.status, "ok");
  assert.equal(a.price?.currency, "SEK");
  assert.equal(a.price_type, "official_statistic");
  assert.ok((a.price?.value ?? 0) > 5000);
  assert.ok((a.sample_size ?? 0) >= 5);
});

test("all flats together when rooms is left out", async () => {
  const a = await seNewBuildRent({}, async () => FIX);
  assert.equal(a.status, "ok");
  assert.equal(a.price?.value, 11363);
  assert.equal(a.sample_size, 11441);
});

test("a suppressed cell answers no_matches with a reason, never a number", async () => {
  // Greater Stockholm has no published figure for one- or two-dwelling buildings; roomCode never asks for 99, so test via pickLatest above
  // and check the sparse fixture with every cell of one region blanked.
  const blank = JSON.parse(JSON.stringify(FIX));
  blank.value = blank.value.map((v: number | null, i: number) => (i >= 18 && i < 36 ? null : v));
  const a = await seNewBuildRent({ town: "Greater Stockholm", rooms: 2 }, async () => blank);
  assert.equal(a.status, "no_matches");
  assert.equal(a.price, null);
});

test("serves() takes only new_build requests", () => {
  assert.equal(manifest.serves!({ country: "SE", new_build: true }), true);
  assert.equal(manifest.serves!({ country: "SE", new_build: "true" }), true);
  assert.equal(manifest.serves!({ country: "SE" }), false);
});
