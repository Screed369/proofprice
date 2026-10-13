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
