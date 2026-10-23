import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFrRecords, normalisePrice, buildFrUrl } from "./source";

test("FR manifest: the fuel note says petrol95 is SP95 only and points to e10, which is an available item (pilot finding 5)", async () => {
  const m = (await import("./index")).default as any;
  assert.match(m.paramNotes.fuel, /petrol95 means SP95 only/);
  assert.match(m.paramNotes.fuel, /E10 instead, which is a separate item and already available: ask for fuel=e10/);
  const { FR_NAME } = await import("./source");
  assert.equal(FR_NAME.e10, "e10"); // e10 really is an item of this source
  assert.equal(FR_NAME.petrol95, "sp95");
  // notes only: no new tool, no change to the answer or to the source's own labels
  assert.equal(m.category, "fuel");
});

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

test("FR history: archive lines become monthly aggregates (last price per station and month, 5-record rule, no raw data kept)", async () => {
  const { FrArchiveReader, frMonthlyRows } = await import("./source");
  const r = new FrArchiveReader("2012-01", "2012-03");
  for (let i = 0; i < 6; i++) {
    r.line(`<pdv id="${1000 + i}" latitude="1" longitude="2" cp="69003" pop="R">`);
    r.line(`  <adresse>1 RUE A</adresse>`);
    r.line(`  <prix nom="Gazole" id="1" maj="2012-01-02 09:56:28.309051" valeur="1300"/>`);
    r.line(`  <prix nom="Gazole" id="1" maj="2012-01-20 09:56:28.309051" valeur="${1400 + i}"/>`); // the later one counts
    r.line(`  <prix nom="Gazole" id="1" maj="2012-02-02 09:56:28.309051" valeur="0"/>`); // placeholder: ignored
    r.line(`  <prix nom="SP95" id="2" maj="2012-02-03 09:56:28.309051" valeur="1500"/>`);
    r.line(`  <prix nom="Gazole" id="1" maj="2011-12-31 09:56:28.309051" valeur="1200"/>`); // outside the range
    r.line(`</pdv>`);
  }
  r.line(`<pdv id="9" latitude="1" longitude="2" cp="97110" pop="R">`); // a single overseas station: thin, dropped
  r.line(`  <prix nom="Gazole" id="1" maj="2012-01-05 09:56:28" valeur="1600"/>`);
  r.line(`</pdv>`);
  r.finish();
  const p = frMonthlyRows(r.months);
  assert.deepEqual(p.map((x) => x.period), ["2012-01", "2012-02"]);
  const jan = p[0].rows.map((x) => `${x.area}/${x.item}/${x.n}/${x.median}`);
  assert.deepEqual(jan, ["69/diesel/6/1.402", "ALL/diesel/6/1.402"]);
  assert.deepEqual(p[1].rows.map((x) => `${x.area}/${x.item}/${x.n}`), ["69/petrol95/6", "ALL/petrol95/6"]);
});

// ---------- inside count guard (outside-check pilot, 22 Oct 2026) ----------
// Real library values, library/fr-fuel at commit 905a043 of main: the national ("ALL") station counts on 19 and 20 Oct 2026.
const L = (date: string, item: string, n: number) => ({ date, area: "ALL", item, n, median: 2.3, low: 2.2, high: 2.4, min: 2.0, max: 2.6 });
const PREV_19_OCT = new Map([
  ["ALL\u0000diesel", L("2026-10-19", "diesel", 7127)],
  ["ALL\u0000e10", L("2026-10-19", "e10", 5616)],
  ["ALL\u0000petrol95", L("2026-10-19", "petrol95", 1692)],
  ["75\u0000diesel", { ...L("2026-10-19", "diesel", 90), area: "75" }], // departments are not judged: only the national row is
]);
const day = (date: string, counts: Record<string, number>) => ({
  date, currency: "EUR", unit: "per litre",
  rows: Object.entries(counts).map(([item, n]) => ({ area: "ALL", item, n, median: 2.3, low: 2.2, high: 2.4, min: 2.0, max: 2.6 })),
});

test("FR count guard: the half-empty 20 Oct feed (diesel 2,850 against 7,127) is refused with a clear message and no made-up count", async () => {
  const { frCountGuard } = await import("./source");
  const msg = frCountGuard(day("2026-10-20", { diesel: 2850, e10: 2314, petrol95: 703 }), PREV_19_OCT);
  assert.ok(msg);
  assert.match(msg!, /^Count guard, 2026-10-20 NOT written \(previous day kept\)/);
  assert.match(msg!, /diesel: 2850 stations against 7127 on 2026-10-19 \(40%\)/);
  assert.match(msg!, /petrol95: 703 stations against 1692/);
  assert.ok(msg!.length <= 420);
  assert.ok(msg!.slice(0, 300).includes("diesel: 2850")); // survives the 300-character cut in scripts/harvest.ts
});

test("FR count guard: a normal day, and a mild dip (above 70%), pass; just under 70% does not; a vanished fuel does not", async () => {
  const { frCountGuard } = await import("./source");
  assert.equal(frCountGuard(day("2026-10-20", { diesel: 7127, e10: 5616, petrol95: 1692 }), PREV_19_OCT), null);
  assert.equal(frCountGuard(day("2026-10-20", { diesel: 7587, e10: 6237, petrol95: 1792 }), PREV_19_OCT), null);
  assert.equal(frCountGuard(day("2026-10-20", { diesel: Math.ceil(0.7 * 7127), e10: 5616, petrol95: 1692 }), PREV_19_OCT), null);
  assert.match(frCountGuard(day("2026-10-20", { diesel: Math.ceil(0.7 * 7127) - 1, e10: 5616, petrol95: 1692 }), PREV_19_OCT)!, /diesel/);
  assert.match(frCountGuard(day("2026-10-20", { diesel: 7127, e10: 5616 }), PREV_19_OCT)!, /petrol95: 0 stations/);
});

test("FR count guard: no previous day (first harvest) and tiny fuels are never judged", async () => {
  const { frCountGuard } = await import("./source");
  assert.equal(frCountGuard(day("2026-10-20", { diesel: 10 }), new Map()), null);
  assert.equal(frCountGuard(day("2026-10-20", { lpg: 1 }), new Map([["ALL\u0000lpg", L("2026-10-19", "lpg", 40)]])), null);
});

test("FR count guard: the real 20 Oct day (frDailyRows of a thin feed) is caught end to end", async () => {
  const { frDailyRows, frCountGuard } = await import("./source");
  const thin = Array.from({ length: 300 }, (_, i) => ({ id: i, cp: "75015", gazole_prix: 2.3, gazole_maj: "2026-10-20T08:00:00+00:00" }));
  assert.match(frCountGuard(frDailyRows(thin, "2026-10-20"), PREV_19_OCT)!, /diesel: 300 stations against 7127/);
});

test("FR count guard: frHarvest itself refuses a thin feed against a stored library day, and accepts a full one", async () => {
  const { frHarvest } = await import("./source");
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fr-lib-"));
  fs.mkdirSync(path.join(dir, "fr-fuel", "daily"), { recursive: true });
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  fs.writeFileSync(
    path.join(dir, "fr-fuel", "daily", `${yesterday.slice(0, 7)}.csv`),
    `date,area,item,n,median,low,high,min,max\n${yesterday},ALL,diesel,400,2.369,2.2,2.5,2.0,2.7\n`,
  );
  const records = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i, cp: "75015", gazole_prix: 2.3, gazole_maj: new Date().toISOString() }));
  const realFetch = globalThis.fetch;
  const before = process.env.PROOFPRICE_LIBRARY_DIR;
  process.env.PROOFPRICE_LIBRARY_DIR = dir;
  try {
    globalThis.fetch = (async () => new Response(JSON.stringify(records(120)), { status: 200, headers: { "content-type": "application/json" } })) as any;
    await assert.rejects(frHarvest(), /Count guard.*diesel: 120 stations against 400/);
    globalThis.fetch = (async () => new Response(JSON.stringify(records(390)), { status: 200, headers: { "content-type": "application/json" } })) as any;
    const ok = await frHarvest();
    assert.equal(ok.rows.find((r) => r.area === "ALL" && r.item === "diesel")!.n, 390);
  } finally {
    globalThis.fetch = realFetch;
    if (before === undefined) delete process.env.PROOFPRICE_LIBRARY_DIR;
    else process.env.PROOFPRICE_LIBRARY_DIR = before;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("FR: a thin department (LPG in 08) gets the labelled national figure; common fuels are never widened", async () => {
  const { frWidenToNational } = await import("./source");
  const today = "2026-10-22"; // library holds ALL/lpg for this day (fr-fuel daily file)
  const a = frWidenToNational({ department: "08", fuel: "gplc", today }, "department 08");
  assert.ok(a, "national LPG row exists in the library");
  assert.equal(a!.status, "ok");
  assert.equal((a!.extra as any).widened, true);
  assert.equal((a!.extra as any).widened_from, "department 08");
  assert.match(a!.summary, /Fewer than 5 stations sell LPG \(GPLc\) in department 08, so no local range is published\. This is the figure for metropolitan France instead/);
  assert.match(a!.notice, /Fewer than 5 stations/);
  assert.ok(a!.sample_size! >= 5);
  assert.equal(a!.price!.currency, "EUR");
  assert.equal(frWidenToNational({ department: "08", fuel: "gazole", today }, "department 08"), null);
  assert.equal(frWidenToNational({ department: "08", fuel: "gplc", today: "2026-01-01" }, "department 08"), null); // no recent library day
});

test("FR: a thin postcode (LPG) is widened to its department when that has 5+ stations, labelled", async () => {
  const { frFuelNow } = await import("./source");
  const rec = (i: number, cp: string) => ({ id: String(i), adresse: "x", ville: "Charleville", cp, code_departement: "08", gplc_prix: 0.9 + i / 100, gplc_maj: "2026-10-21T10:00:00+00:00" });
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: any) => {
    const u = decodeURIComponent(String(url));
    const results = /cp="08000"/.test(u) ? [rec(1, "08000"), rec(2, "08000")] : [1, 2, 3, 4, 5, 6].map((i) => rec(i, "0810" + i));
    return new Response(JSON.stringify({ results }), { status: 200, headers: { "content-type": "application/json" } });
  }) as any;
  try {
    const a = await frFuelNow({ postcode: "08000", fuel: "gplc", today: "2026-10-22" });
    assert.equal(a.status, "ok");
    assert.equal((a.extra as any).widened, true);
    assert.equal((a.extra as any).widened_from, "postcode 08000");
    assert.equal((a.extra as any).widened_to, "department 08");
    assert.match(a.summary, /Fewer than 5 stations sell LPG \(GPLc\) in postcode 08000.*department 08 instead/);
    assert.ok(a.sample_size! >= 5);
    // diesel is never widened
    const d = await frFuelNow({ postcode: "08000", fuel: "gazole", today: "2026-10-22" });
    assert.notEqual((d.extra as any)?.widened, true);
  } finally {
    globalThis.fetch = realFetch;
  }
});
