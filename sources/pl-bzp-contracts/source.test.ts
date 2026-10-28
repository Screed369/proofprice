import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { aggregateAll, contractsOf, contractValues, daysBefore, firstCpv, htmlText, INFO, itemsOf, plAmount, plContracts, plContractsHarvest, readDay, windowMarker, windowOf } from "./source";
import { writeDaily, writeMeta } from "../../lib/library/store";
import { InputError, SourceError } from "../../lib/http";

// Layout copied from the live API (checked 2026-10-28, notices 2026/BZP 00504442/01 = six parts and 00504448/01 = one part): the value sits in the
// notice's htmlBody after the label "8.2.) Wartość umowy/umowy ramowej:", comma decimal, then the currency; amounts can be whole numbers ("168416 PLN").
const part = (n: number, v: string) =>
  `<h3 class="mb-0">Część ${n}</h3><h3 class="mb-0">6.4.) Cena lub koszt oferty wykonawcy, któremu udzielono zamówienia: </h3>    ${v} PLN    ` +
  `<h3 class="mb-0">8.2.) Wartość umowy/umowy ramowej: </h3>    ${v} PLN    `;
const body = (...vals: string[]) => `<html><head><style>body{}</style></head><body><main><h1>Ogłoszenie o wyniku postępowania</h1>${vals.map((v, i) => part(i + 1, v)).join("")}</main></body></html>`;
const notice = (id: string, date: string, cpv: string, vals: string[], over: Record<string, unknown> = {}) => ({
  noticeType: "TenderResultNotice",
  noticeNumber: `2026/BZP ${id}/01`,
  orderType: "Delivery",
  cpvCode: cpv,
  publicationDate: `${date}T04:05:22.0395877Z`,
  procedureResult: "zawarcieUmowy",
  organizationName: "A buyer that must never be kept",
  htmlBody: body(...vals),
  ...over,
});
const LAPTOP = "30213100-6 (Komputery przenośne)";
const ROAD = "45233120-6 (Roboty w zakresie budowy dróg),45100000-8 (Przygotowanie terenu pod budowę)";

test("plAmount reads comma decimals, spaces and non-breaking spaces, and refuses anything else", () => {
  assert.equal(plAmount("262740,24"), 262740.24);
  assert.equal(plAmount("168416"), 168416);
  assert.equal(plAmount("1 262 740,24"), 1262740.24);
  assert.equal(plAmount("1 262 740,24"), 1262740.24);
  assert.ok(Number.isNaN(plAmount("12,5 EUR")));
  assert.ok(Number.isNaN(plAmount("")));
});

test("contractValues finds one 8.2 value per part and ignores the offer prices (6.2 to 6.4) and other currencies", () => {
  const v = contractValues(body("262740,24", "15575,10", "33475,14"));
  assert.deepEqual(v, [262740.24, 15575.1, 33475.14]);
  assert.deepEqual(contractValues(body("168416")), [168416]);
  const eur = body("100,00").replace("100,00 PLN    <h3", "100,00 EUR    <h3").replace(/8\.2\.\) Wartość umowy\/umowy ramowej: <\/h3>\s*100,00 PLN/, "8.2.) Wartość umowy/umowy ramowej: </h3> 100,00 EUR");
  assert.deepEqual(contractValues(eur), []);
  assert.deepEqual(contractValues("<p>Unieważnienie: 6.2.) Cena lub koszt oferty z najniższą ceną lub kosztem: 2727000,69 PLN</p>"), []); // an annulled tender has offers but no contract
  assert.deepEqual(contractValues(""), []);
});

test("htmlText drops style blocks and tags, decodes spaces and keeps the words", () => {
  const t = htmlText("<style>.a{}</style><h3>8.2.) Wartość&nbsp;umowy</h3>  12,00   PLN");
  assert.ok(!t.includes("{}"));
  assert.ok(t.includes("Wartość umowy"));
});

test("firstCpv takes the first 8-digit code of the list", () => {
  assert.equal(firstCpv(ROAD), "45233120");
  assert.equal(firstCpv("24111500-0 (Gazy medyczne)"), "24111500");
  assert.equal(firstCpv(null), "");
  assert.equal(firstCpv("abc"), "");
});

test("contractsOf: one contract per part with a stable key; placeholders, entry errors and other dates are dropped", () => {
  const n = notice("00504442", "2026-10-26", "24111500-0 (Gazy medyczne)", ["262740,24", "15575,10", "999,00", "9999999999999,00"]);
  const cs = contractsOf(n, "2026-10-26", "2026-10-26");
  assert.deepEqual(cs.map((c) => [c.key, c.value, c.cpv, c.date]), [
    ["2026/BZP 00504442/01#1", 262740.24, "24111500", "2026-10-26"],
    ["2026/BZP 00504442/01#2", 15575.1, "24111500", "2026-10-26"],
  ]);
  assert.deepEqual(contractsOf(n, "2026-10-27", "2026-10-28"), []);
  assert.deepEqual(contractsOf({ ...n, cpvCode: "" }, "2026-10-26", "2026-10-26"), []);
  assert.deepEqual(contractsOf({ ...n, noticeNumber: "" }, "2026-10-26", "2026-10-26"), []);
  assert.deepEqual(contractsOf(null, "2026-10-26", "2026-10-26"), []);
  assert.ok(!JSON.stringify(cs).includes("buyer"), "no buyer name is kept");
});

test("itemsOf and aggregateAll: a purchase needs 5 distinct contracts and a contract counts once", () => {
  assert.ok(itemsOf("30213100").includes("cpv-30") && itemsOf("30213100").includes("cpv-3021"));
  const mk = (i: number, v: number) => ({ key: `k${i}`, date: "2026-10-20", value: v, cpv: "45233120" });
  const five = [1, 2, 3, 4, 5].map((i) => mk(i, i * 100000));
  const rows = aggregateAll([...five, mk(1, 100000)], "2026-10-08", "2026-10-28"); // k1 twice
  const cpv45 = rows.find((r) => r.item === "cpv-45");
  assert.equal(cpv45?.n, 5);
  assert.equal(cpv45?.median, 300000);
  assert.equal(aggregateAll(five.slice(0, 4), "2026-10-08", "2026-10-28").length, 0);
  assert.equal(aggregateAll(five, "2026-10-21", "2026-10-28").length, 0, "outside the window");
});

test("windowMarker carries the oldest day and no price", () => {
  const m = windowMarker("2026-10-08");
  assert.equal(windowOf([m]), "2026-10-08");
  assert.equal(m.median, 0);
  assert.equal(windowOf([]), null);
});

test("daysBefore", () => {
  assert.equal(daysBefore("2026-10-28", 0), "2026-10-28");
  assert.equal(daysBefore("2026-10-28", 20), "2026-10-08");
  assert.equal(daysBefore("2026-03-01", 1), "2026-02-28");
});

/** A fake API: serves the notices of a day, `size` at a time, oldest first, honouring PublicationDateFrom/To like the live one. */
function fakeApi(all: any[], size = 2, newestFirst = false) {
  const calls: string[] = [];
  const get = async (url: string) => {
    calls.push(url);
    const u = new URL(url);
    assert.equal(u.searchParams.get("NoticeType"), "TenderResultNotice");
    const from = Date.parse(u.searchParams.get("PublicationDateFrom")!);
    const to = Date.parse(u.searchParams.get("PublicationDateTo")!);
    const hits = all.filter((n) => Date.parse(n.publicationDate) >= from && Date.parse(n.publicationDate) <= to).sort((a, b) => Date.parse(a.publicationDate) - Date.parse(b.publicationDate));
    return newestFirst ? hits.reverse().slice(0, size) : hits.slice(0, size);
  };
  return { get, calls };
}
const at = (date: string, hhmm: string, id: string, vals: string[]) => notice(id, date, ROAD, vals, { publicationDate: `${date}T${hhmm}:00.1234567Z` });

test("readDay pages through a busy day by moving the window, oldest first or newest first, and never twice for the same notice", async () => {
  const day = "2026-10-26";
  const all = [at(day, "01:00", "1", ["200000,00"]), at(day, "02:00", "2", ["200000,00"]), at(day, "03:00", "3", ["200000,00"]), at(day, "04:00", "4", ["200000,00"]), at(day, "05:00", "5", ["200000,00"]), at("2026-10-27", "01:00", "9", ["1,00"])];
  for (const newestFirst of [false, true]) {
    const api = fakeApi(all, 2, newestFirst);
    const got: string[] = [];
    const n = await readDay(day, api.get, (x) => got.push(x.noticeNumber));
    assert.equal(n, 5, `newestFirst=${newestFirst}`);
    assert.equal(new Set(got).size, 5);
    assert.ok(!got.some((g) => g.includes(" 9/")), "the next day is not read");
  }
});

test("harvest: reads each day newest first, builds the window marker and aggregates; a broken day inside the window is refused", async () => {
  const now = new Date("2026-10-28T03:17:00Z");
  const all: any[] = [];
  for (let d = 0; d < 21; d++) {
    const day = daysBefore("2026-10-28", d);
    for (let k = 0; k < 3; k++) all.push(at(day, `0${k + 1}:00`, `${d}${k}`, [`${(k + 1) * 100000},00`]));
  }
  const api = fakeApi(all, 2);
  const r = await plContractsHarvest(now, { get: api.get });
  assert.equal(r.currency, "PLN");
  assert.equal(r.date, "2026-10-28");
  assert.equal(windowOf(r.rows), "2026-10-08");
  const cpv45 = r.rows.find((x) => x.item === "cpv-45");
  assert.equal(cpv45?.n, 63);
  assert.equal(cpv45?.median, 200000);
  assert.ok(r.note?.includes("2026-10-08 to 2026-10-28"));
  // a day that fails right after today leaves too few unbroken days
  const failing = async (url: string) => {
    if (url.includes("2026-10-27")) throw new SourceError("down");
    return api.get(url);
  };
  await assert.rejects(plContractsHarvest(now, { get: failing }), SourceError);
  // a day that fails deep in the window only shortens the window
  const failOld = async (url: string) => {
    if (url.includes("2026-10-10")) throw new SourceError("down");
    return api.get(url);
  };
  const short = await plContractsHarvest(now, { get: failOld });
  assert.equal(windowOf(short.rows), "2026-10-11");
  await assert.rejects(plContractsHarvest(now, { get: async () => { throw new SourceError("down"); } }), SourceError);
  await assert.rejects(plContractsHarvest(now, { get: async () => [] }), SourceError);
});

test("answer: median and range from the library, period from the window marker, and clear refusals", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "plbzp-"));
  process.env.PROOFPRICE_LIBRARY_DIR = dir;
  try {
    const h = {
      date: "2026-10-28",
      currency: "PLN",
      unit: "per contract (or part), total contract value",
      rows: [{ area: "ALL", item: "cpv-45", n: 63, median: 200000, low: 100000, high: 300000, min: 100000, max: 300000 }, windowMarker("2026-10-08")],
    };
    writeDaily(INFO.id, h);
    writeMeta(INFO.id, { source: INFO.id, currency: "PLN", unit: h.unit, first_date: h.date, last_date: h.date, days: 1, last_harvest_at: "x", last_rows: h.rows.length, last_ok_at: "x", last_error: null });
    const a = await plContracts({ what: "road works", cpv: "45" });
    assert.equal(a.status, "ok");
    assert.equal(a.price_type, "contract_price");
    assert.equal(a.price?.currency, "PLN");
    assert.equal(a.sample_size, 63);
    assert.equal(a.price?.median, 200000);
    assert.deepEqual(a.period, { from: "2026-10-08", to: "2026-10-28" });
    assert.match(a.summary, /not unit prices/);
    assert.doesNotMatch(JSON.stringify(a), /window:/);
    await assert.rejects(plContracts({ what: "x", cpv: "123" }), InputError);
    await assert.rejects(plContracts({ what: "laptops", buyer_area: "Warszawa" }), InputError);
    await assert.rejects(plContracts({ what: "quantum widgets" }), InputError);
  } finally {
    delete process.env.PROOFPRICE_LIBRARY_DIR;
  }
});
