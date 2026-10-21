// Fixtures in ./fixtures are the real data.gov.au datastore answer for Melbourne - Sydney (Verifier probe vr-bitreds, 2026-10-20).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { InputError } from "../../lib/http";
import { SOURCE_PLUGINS } from "../../lib/registry";
import { INFO, answerFromFares, auAirfares, parseFares, portName } from "./source";

const fx = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8"));
const ROUTE = fx("route-melbourne-sydney.json");
const EMPTY = fx("no-records.json");

test("au-bitre-airfares: port names accept codes, case and 'airport'", () => {
  assert.equal(portName("SYD"), "Sydney");
  assert.equal(portName("melbourne airport"), "Melbourne");
  assert.equal(portName("Gold Coast"), "Gold Coast");
  assert.equal(portName("ool"), "Gold Coast");
  assert.equal(portName("alice springs"), "Alice Springs");
  assert.equal(portName("some place"), "Some Place");
  assert.throws(() => portName("  "), InputError);
});

test("au-bitre-airfares: fares parse from the real text values, newest first", () => {
  const rows = parseFares(ROUTE.result.records);
  assert.equal(rows.length, 6);
  assert.equal(rows[0].yearMonth, "202609");
  assert.equal(rows[0].nominal, 198);
  assert.equal(rows[3].real, 220.7029191);
  assert.deepEqual(parseFares([{ YearMonth: "bad", "$Value": "1" }, { YearMonth: "202601", "$Value": "" }]), []);
});

test("au-bitre-airfares: Melbourne to Sydney answer is a posted-price range over months", async () => {
  let url = "";
  const a = await auAirfares({ from: "MEL", to: "syd", quarters: 2 }, { fetcher: async (u) => { url = u; return ROUTE; } });
  assert.match(decodeURIComponent(url), /"Route":\["Melbourne - Sydney","Sydney - Melbourne"\]/);
  assert.equal(a.status, "ok");
  assert.equal(a.price_type, "posted_price");
  assert.equal(a.price!.currency, "AUD");
  assert.equal(a.price!.unit, "per return trip");
  assert.equal(a.sample_size, 6);
  assert.equal(a.price!.median, 198); // 178,198,198,198,218,348
  assert.ok(a.price!.typical_low! <= a.price!.median! && a.price!.median! <= a.price!.typical_high!);
  assert.ok(a.price!.median! > 50 && a.price!.median! < 1500, "a Melbourne-Sydney discount return is tens to hundreds of AUD");
  assert.equal(a.period.from, "2026-04");
  assert.equal(a.period.to, "2026-09");
  assert.equal((a.extra as any).latest_month.aud_return, 198);
  assert.match(a.source.licence, /CC BY 2\.5 AU/);
  assert.match(a.summary, /not what travellers paid/);
});

test("au-bitre-airfares: fewer than 5 months gives no range", () => {
  const a = answerFromFares(parseFares(ROUTE.result.records).slice(0, 3), { from: "Melbourne", to: "Sydney", months: 3 });
  assert.equal(a.status, "insufficient_data");
  assert.equal(a.price, null);
});

test("au-bitre-airfares: an unknown route says no matches; missing or equal places are input errors", async () => {
  const none = await auAirfares({ from: "Sydney", to: "Atlantis" }, { fetcher: async () => EMPTY });
  assert.equal(none.status, "no_matches");
  assert.equal(none.price, null);
  await assert.rejects(() => auAirfares({ from: "Sydney" }), InputError);
  await assert.rejects(() => auAirfares({ from: "SYD", to: "Sydney" }), InputError);
});

test("au-bitre-airfares: registry routes AU flights to this source", () => {
  const p = SOURCE_PLUGINS.find((s) => s.info.id === INFO.id)!;
  assert.equal(p.category, "flights");
  assert.deepEqual(p.countries, ["AU"]);
});

// ---------- daily collector and stale-if-error ----------

import { auAirfaresHistoryKey, fareHarvestRows, HARVEST_ITEM, routeKey } from "./source";

test("au-bitre-airfares: harvest gives one row per route for the 12 months to the newest month, dated by its end", () => {
  const other = Array.from({ length: 14 }, (_, i) => ({ YearMonth: `2026${String(9 - Math.min(i, 8)).padStart(2, "0")}`, Route: "Perth - Brisbane", "$Value": String(400 + i), "$Real": "1" }))
    .map((r, i) => ({ ...r, YearMonth: i < 9 ? `20260${9 - i}` : `2025${String(21 - i).padStart(2, "0")}` }));
  const h = fareHarvestRows([...ROUTE.result.records, ...other, { YearMonth: "202609", Route: "Darwin - Alice Springs", "$Value": "300" }]);
  assert.equal(h.date, "2026-09-30");
  assert.equal(h.currency, "AUD");
  assert.equal(h.unit, "per return trip");
  const ms = h.rows.find((r) => r.area === "Melbourne - Sydney")!;
  const live = answerFromFares(parseFares(ROUTE.result.records), { from: "Melbourne", to: "Sydney", months: 12 });
  assert.equal(ms.n, 6);
  assert.equal(ms.median, live.price!.median, "the copy holds the same figure as the default live answer");
  const pb = h.rows.find((r) => r.area === "Brisbane - Perth")!;
  assert.equal(pb.n, 12, "only the 12 months up to the newest month");
  assert.ok(!h.rows.some((r) => r.area === "Alice Springs - Darwin"), "a route with fewer than 5 months is not stored");
  assert.ok(h.rows.every((r) => r.item === HARVEST_ITEM));
  assert.throws(() => fareHarvestRows([]), /no usable fares/);
});

test("au-bitre-airfares: history key is the route either way round, only for the default 4 quarters", () => {
  assert.equal(routeKey("Sydney", "Melbourne"), "Melbourne - Sydney");
  assert.deepEqual(auAirfaresHistoryKey({ from: "SYD", to: "melbourne" }), { area: "Melbourne - Sydney", item: HARVEST_ITEM, label: "Melbourne - Sydney" });
  assert.equal(auAirfaresHistoryKey({ from: "SYD", to: "MEL", quarters: 4 })!.area, "Melbourne - Sydney");
  assert.equal(auAirfaresHistoryKey({ from: "SYD", to: "MEL", quarters: 8 }), null);
  assert.equal(auAirfaresHistoryKey({ from: "SYD" }), null);
  const m = SOURCE_PLUGINS.find((s) => s.info.id === "au-bitre-airfares")!;
  assert.ok(m.harvest && m.historyKey && m.referenceDates);
});
