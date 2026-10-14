// Fixture t09895.json: real SSB JSON-stat2 response for table 09895 (latest year 2025), captured 2026-10-14 via the GitHub-hosted probe.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { INFO, matchZone, noRent, parseTable, pickLatest, URL_LATEST, URL_RECENT } from "./source";

const FIX = JSON.parse(readFileSync(new URL("./fixtures/t09895.json", import.meta.url), "utf8"));

test("parses 45 cells of which 37 have values", () => {
  const t = parseTable(FIX);
  assert.equal(t.rows.length, 37);
  assert.equal(t.codes.Soner2.length, 9);
});

test("zone matching", () => {
  const t = parseTable(FIX);
  assert.equal(matchZone(t, "Oslo").code, "01");
  assert.equal(matchZone(t, "Norway").code, "00");
  assert.equal(matchZone(t, "Bærum").code, "01");
  assert.equal(matchZone(t, "Trondheim").code, "04");
  assert.equal(matchZone(t, "small towns").code, "22");
  assert.throws(() => matchZone(t, "Atlantis"), /not a price zone/);
});

test("pickLatest and blanks", () => {
  const t = parseTable(FIX);
  assert.equal(pickLatest(t, "01", "2")?.value, 15260);
  assert.equal(pickLatest(t, "02", "1"), null);
});

test("answer for Oslo, 2 rooms", async () => {
  const calls: string[] = [];
  const a = await noRent({ town: "Oslo", rooms: 2 }, async (u) => (calls.push(u), FIX));
  assert.equal(a.status, "ok");
  assert.equal(a.price?.value, 15260);
  assert.equal(a.price?.currency, "NOK");
  assert.equal(a.price_type, "official_statistic");
  assert.equal(calls[0], URL_RECENT);
});

test("falls back when the multi-year query is refused", async () => {
  let n = 0;
  const a = await noRent({ town: "Norway", rooms: 3 }, async (u) => {
    n++;
    if (u === URL_RECENT) throw new Error("400");
    assert.equal(u, URL_LATEST);
    return FIX;
  });
  assert.equal(a.price?.value, 13910);
  assert.equal(n, 2);
});

test("blank cell gives no_matches; missing rooms is an input error", async () => {
  const a = await noRent({ town: "Akershus", rooms: 1 }, async () => FIX);
  assert.equal(a.status, "no_matches");
  await assert.rejects(noRent({ town: "Oslo" }, async () => FIX), /rooms/);
});

test("licence info", () => {
  assert.match(INFO.licence, /CC BY 4.0/);
});

// A copy of the real fixture with a second measure added ("per sqm", values about 300 NOK), as the table title suggests SSB could publish.
function withPerSqm(): unknown {
  const f = JSON.parse(JSON.stringify(FIX));
  const zones = f.size[0];
  const rooms = f.size[3];
  const value: (number | null)[] = [];
  const status: Record<string, string> = {};
  for (let z = 0; z < zones; z++) {
    for (let k = 0; k < rooms; k++) {
      const pos = z * rooms + k;
      value.push(f.value[pos]);
      if (f.status?.[String(pos)]) status[String(value.length - 1)] = f.status[String(pos)];
    }
    for (let k = 0; k < rooms; k++) value.push(300 + k);
  }
  f.value = value;
  f.status = status;
  f.size[1] = 2;
  f.dimension.ContentsCode.category.index = { Husleie: 0, KvmLeie: 1 };
  f.dimension.ContentsCode.category.label = { Husleie: "Average monthly rents", KvmLeie: "Average rent per sqm" };
  return f;
}

test("only the monthly-rent measure is read, never a per-sqm figure; unit is per month", async () => {
  const t = parseTable(withPerSqm());
  assert.equal(pickLatest(t, "01", "2")?.value, 15260);
  assert.equal(pickLatest(t, "02", "1"), null); // ".." stays missing, not replaced by the per-sqm cell
  const a = await noRent({ town: "Oslo", rooms: 2 }, async () => withPerSqm());
  assert.equal(a.price?.value, 15260);
  assert.equal(a.price?.unit, "per month");
  assert.match(a.summary, /average monthly rent/);
  assert.equal(a.sample_size, null);
  assert.equal(a.price?.typical_low, null);
  assert.ok(Object.values((a.extra as any).by_rooms).every((v) => (v as number) > 1000));
});

test("a table without the monthly-rent measure is refused, not misread", () => {
  const f = JSON.parse(JSON.stringify(FIX));
  f.dimension.ContentsCode.category.index = { KvmLeie: 0 };
  f.dimension.ContentsCode.category.label = { KvmLeie: "Average rent per sqm" };
  assert.throws(() => parseTable(f), /Husleie/);
});

test("suppressed '..' cells are missing, never a rent of 0", () => {
  const t = parseTable(FIX);
  assert.ok(t.rows.every((r) => r.value !== null && (r.value as number) > 0));
  assert.doesNotMatch(INFO.what_is_recorded, /year end/);
});
