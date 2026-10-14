import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFrRecords, normalisePrice, buildFrUrl } from "./source";

test("FR fuel records parse and prices normalise", () => {
  assert.equal(normalisePrice(1.789), 1.789);
  assert.equal(normalisePrice(1789), 1.789);
  assert.ok(Number.isNaN(normalisePrice(null)));
  const st = parseFrRecords({ results: [
    { id: 1, adresse: "1 rue A", ville: "Paris", cp: "75015", gazole_prix: 1.759, gazole_maj: "2026-10-12T08:00:00+00:00" },
    { id: 2, adresse: "2 rue B", ville: "Paris", cp: "75015", gazole_prix: null },
  ] }, "gazole");
  assert.equal(st.length, 1);
  assert.match(decodeURIComponent(buildFrUrl('cp="75015"', 0)), /where=cp="75015"/);
});

test("FR: departments (Corsica, overseas) and daily library rows skip stale prices", async () => {
  const { frDepartment, frDailyRows, frHistoryKey } = await import("./source");
  assert.equal(frDepartment({ cp: "75015" }), "75");
  assert.equal(frDepartment({ cp: "20090" }), "2A");
  assert.equal(frDepartment({ cp: "20200" }), "2B");
  assert.equal(frDepartment({ cp: "97110" }), "971");
  assert.equal(frDepartment({ cp: "69003", code_departement: "69" }), "69");
  const day = frDailyRows([
    { id: 1, cp: "75015", gazole_prix: 1.75, gazole_maj: "2026-10-13T08:00:00+00:00", sp95_prix: 1.85, sp95_maj: "2026-10-13T08:00:00+00:00" },
    { id: 2, cp: "75016", gazole_prix: 1.79, gazole_maj: "2026-10-12T08:00:00+00:00" },
    { id: 3, cp: "75017", gazole_prix: 1.10, gazole_maj: "2026-01-01T08:00:00+00:00" },
  ], "2026-10-14");
  const keys = day.rows.map((r) => `${r.area}/${r.item}/${r.n}`);
  assert.deepEqual(keys, ["75/diesel/2", "75/petrol95/1", "ALL/diesel/2", "ALL/petrol95/1"]);
  assert.equal(frHistoryKey({ postcode: "69003", fuel: "diesel" })!.area, "69");
});

test("FR: an unreadable timestamp never stops the daily collection", async () => {
  const { frDailyRows } = await import("./source");
  const day = frDailyRows([{ id: 1, cp: "75015", gazole_prix: 1.75, gazole_maj: "13/10/2026 08:00" }, { id: 2, cp: "97110", gazole_prix: 1.9, gazole_maj: "2026-10-13T08:00:00+00:00" }], "2026-10-14");
  const keys = day.rows.map((r) => `${r.area}/${r.item}/${r.n}`);
  assert.deepEqual(keys, ["75/diesel/1", "971/diesel/1", "ALL/diesel/1"]); // overseas kept per department, left out of the national row
});

test("FR: placeholders (0, empty, 0.001, 9.999) are missing values, never prices", () => {
  assert.ok(Number.isNaN(normalisePrice(0)));
  assert.ok(Number.isNaN(normalisePrice("")));
  assert.ok(Number.isNaN(normalisePrice(" ")));
  assert.ok(Number.isNaN(normalisePrice(0.001)));
  assert.ok(Number.isNaN(normalisePrice(9.999)));
  assert.equal(normalisePrice("1.799"), 1.799);
});

test("FR: live answer says posted (not paid), states tax and range definition, and leaves out prices older than 8 days", async () => {
  const { frAnswer } = await import("./source");
  const rec = (id: number, prix: number, maj: string) => ({ id, adresse: `${id} rue A`, ville: "Paris", cp: "75015", gazole_prix: prix, gazole_maj: maj });
  const stations = parseFrRecords({ results: [
    rec(1, 2.25, "2026-10-14T00:01:00+00:00"),
    rec(2, 2.394, "2026-10-14T07:31:00+00:00"),
    rec(3, 2.449, "2026-10-07T16:14:43+00:00"),
    rec(4, 2.5, "2026-10-13T08:00:00+00:00"),
    rec(5, 2.569, "2026-10-12T08:00:00+00:00"),
    rec(6, 1.499, "2026-03-01T08:00:00+00:00"), // a closed station's frozen price
    rec(7, 0, "2026-10-14T08:00:00+00:00"), // placeholder
  ] }, "gazole");
  assert.equal(stations.length, 6);
  const a = frAnswer(stations, { fuel: "gazole", area: "postcode 75015", query: { postcode: "75015" }, today: "2026-10-14" });
  assert.equal(a.status, "ok");
  assert.equal(a.sample_size, 5);
  assert.equal(a.price!.min, 2.25); // the March price is not counted
  assert.deepEqual(a.period, { from: "2026-10-07", to: "2026-10-14" });
  assert.equal((a.extra as any).stale_prices_left_out, 1);
  assert.match(a.summary, /latest posted pump prices \(taxes included\) have a median of €2\.449 per litre/);
  assert.match(a.summary, /typical range \(10th–90th percentile\)/);
  assert.doesNotMatch(a.summary, /\b(costs?|paid|pays?|right now)\b/i);
  assert.doesNotMatch(a.source.attribution + " " + (await import("./source")).INFO.limits, /every customer pays/);
});
