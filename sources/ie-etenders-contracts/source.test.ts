import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { aggregateAll, awardFromRow, CsvReader, headerIndex, ieContracts, ieContractsHarvest, ieDate, INFO, itemsOf, windowMarker, windowOf, windowStart } from "./source";
import { writeDaily, writeMeta } from "../../lib/library/store";
import { InputError, SourceError } from "../../lib/http";

// Layout copied from the live file (checked 2026-10-31, Public_Procurement_Opendata_Dataset.csv, 89,734 rows, cp1252): 31 columns, DD/MM/YYYY dates,
// "Sum of Awarded Value (€)" filled only on awarded rows. Buyer, name and supplier cells are made up here; the real ones are never read.
const HEADER =
  "Tender ID,Parent Agreement ID,Contracting Authority,Name of Client Contracting Authority,Agreement Owner,Tender/Contract Name,Notice Published Date / Contract Created Date,Directive,Competition Type,Main Cpv Code,Main Cpv Code Description,Additional CPV Codes on CFT,Spend Category,Contract Type,Threshold Level,Procedure,Tender Submission Deadline,Evaluation Type,Sum of Notice Estimated Value (€),Sum of Contract Duration (Months),Cancelled Date,Award Published,Sum of Awarded Value (€),Sum of No of Bids Received,Sum of No of SMEs Bids Received,Awarded Suppliers,Sum of No of Awarded SMEs,TED Notice Link,TED CAN Link,Platform,Source";
const line = (id: string, comp: string, cpv: string, award: string, value: string) =>
  `${id},,Mayo County Council,,,"Public Realm Works, Belmullet",29/09/2026,Classic,${comp},${cpv},Construction work.,${cpv},Minor Building Works,Works,OJEU,Open Procedure,30/10/2026,MEAT,,12,,${award},${value},4,2,Some Supplier Ltd|A Sole Trader,1,,,ED Platform,OpenData-Publications`;

const csv = (...lines: string[]) => [HEADER, ...lines].join("\r\n") + "\r\n";
function parse(text: string): string[][] {
  const rows: string[][] = [];
  const r = new CsvReader((x) => rows.push(x));
  r.push(text.slice(0, 7));
  r.push(text.slice(7));
  r.end();
  return rows;
}

test("CsvReader: quoted commas and line breaks, doubled quotes, split chunks", () => {
  const rows = parse('a,b,c\r\n1,"x, ""y""",3\r\n"multi\nline",5,6');
  assert.deepEqual(rows, [["a", "b", "c"], ["1", 'x, "y"', "3"], ["multi\nline", "5", "6"]]);
});

test("headerIndex finds the five columns and refuses a changed file", () => {
  const idx = headerIndex(parse(csv())[0]);
  assert.equal(idx.id, 0);
  assert.equal(idx.competition, 8);
  assert.equal(idx.cpv, 9);
  assert.equal(idx.awardDate, 21);
  assert.equal(idx.value, 22);
  assert.throws(() => headerIndex(["Tender ID", "Competition Type"]), SourceError);
});

test("ieDate reads DD/MM/YYYY and refuses anything else", () => {
  assert.equal(ieDate("04/09/2026"), "2026-09-04");
  assert.equal(ieDate("31/02/2026"), "");
  assert.equal(ieDate(""), "");
  assert.equal(ieDate("2026-09-04"), "");
});

test("awardFromRow keeps normal awards and drops frameworks, DPS, placeholders, ceilings, bad dates and codes", () => {
  const rows = parse(
    csv(
      line("1", "Bespoke", "45233100", "28/09/2026", "3295205.23"),
      line("2", "Framework", "45233100", "28/09/2026", "9000000"),
      line("3", "DPS Tender", "45233100", "28/09/2026", "9000000"),
      line("4", "DPS/UQS", "45233100", "28/09/2026", "9000000"),
      line("5", "Bespoke", "45233100", "28/09/2026", "1"),
      line("6", "Bespoke", "45233100", "28/09/2026", "9000000000"),
      line("7", "Bespoke", "45233100", "", "50000"),
      line("8", "Bespoke", "4523", "28/09/2026", "50000"),
      line("9", "FW - Mini-Comp", "72000000", "30/07/2026", "384220.32"),
      line("10", "Bespoke", "45233100", "28/09/2026", ""),
    ),
  );
  const idx = headerIndex(rows[0]);
  const got = rows.slice(1).map((r) => awardFromRow(r, idx));
  assert.deepEqual(got[0], { id: "1", date: "2026-09-28", value: 3295205.23, cpv: "45233100" });
  assert.deepEqual(got[8], { id: "9", date: "2026-07-30", value: 384220.32, cpv: "72000000" });
  for (const i of [1, 2, 3, 4, 5, 6, 7, 9]) assert.equal(got[i], null, `row ${i + 1}`);
});

test("the supplier and buyer columns are never kept in an award", () => {
  const rows = parse(csv(line("1", "Bespoke", "45233100", "28/09/2026", "100000")));
  const a = awardFromRow(rows[1], headerIndex(rows[0]));
  assert.doesNotMatch(JSON.stringify(a), /Sole Trader|Mayo|Belmullet/);
});

test("itemsOf gives the shared purchase, the 2-digit division and the 4-digit group", () => {
  const items = itemsOf("30213100");
  assert.ok(items.includes("laptops"));
  assert.ok(items.includes("cpv-30"));
  assert.ok(items.includes("cpv-3021"));
});

test("aggregateAll counts a tender once, needs 5 tenders, and respects the window", () => {
  const mk = (i: number, v: number, date = "2026-09-01") => ({ id: String(i), date, value: v, cpv: "45233120" });
  const five = [1, 2, 3, 4, 5].map((i) => mk(i, i * 100000));
  const rows = aggregateAll([...five, mk(1, 999999999)], "2024-10-31", "2026-10-31");
  const r = rows.find((x) => x.item === "cpv-45");
  assert.equal(r?.n, 5);
  assert.equal(r?.median, 300000);
  assert.equal(aggregateAll(five.slice(0, 4), "2024-10-31", "2026-10-31").length, 0, "four tenders show nothing");
  assert.equal(aggregateAll(five.map((a) => ({ ...a, date: "2023-01-01" })), "2024-10-31", "2026-10-31").length, 0, "old awards are outside the window");
});

test("harvest: aggregates the streamed awards, writes the window marker and refuses a cut-off or changed file", async () => {
  const now = new Date("2026-10-31T03:17:00Z");
  const stream = (n: number, rowsRead = 5000) => async (sink: (a: any) => void) => {
    for (let i = 0; i < n; i++) sink({ id: `t${i}`, date: "2026-09-01", value: (i + 1) * 10000, cpv: "45233120" });
    sink({ id: "old", date: "2020-01-01", value: 5000, cpv: "45233120" });
    return rowsRead;
  };
  const h = await ieContractsHarvest(now, { stream: stream(9) });
  assert.equal(h.currency, "EUR");
  assert.equal(h.date, "2026-10-31");
  assert.deepEqual(windowOf(h.rows), { from: "2024-10-31", to: "2026-09-01" });
  const r = h.rows.find((x) => x.item === "cpv-45");
  assert.equal(r?.n, 9);
  assert.equal(r?.median, 50000);
  await assert.rejects(ieContractsHarvest(now, { stream: stream(9, 12) }), SourceError);
  await assert.rejects(ieContractsHarvest(now, { stream: stream(0) }), SourceError);
  assert.equal(windowStart("2026-10-31"), "2024-10-31");
});

test("answer: median and range from the library, period from the window marker, and clear refusals", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ieet-"));
  process.env.PROOFPRICE_LIBRARY_DIR = dir;
  try {
    const h = {
      date: "2026-10-31",
      currency: "EUR",
      unit: "per contract, total awarded value (ex VAT)",
      rows: [{ area: "ALL", item: "cpv-45", n: 1271, median: 200000, low: 40000, high: 2000000, min: 1000, max: 400000000 }, windowMarker("2024-10-31", "2026-09-29")],
    };
    writeDaily(INFO.id, h);
    writeMeta(INFO.id, { source: INFO.id, currency: "EUR", unit: h.unit, first_date: h.date, last_date: h.date, days: 1, last_harvest_at: "x", last_rows: h.rows.length, last_ok_at: "x", last_error: null });
    const a = await ieContracts({ what: "road works", cpv: "45" });
    assert.equal(a.status, "ok");
    assert.equal(a.price_type, "contract_price");
    assert.equal(a.price?.currency, "EUR");
    assert.equal(a.sample_size, 1271);
    assert.equal(a.price?.median, 200000);
    assert.deepEqual(a.period, { from: "2024-10-31", to: "2026-09-29" });
    assert.match(a.summary, /not unit prices/);
    assert.doesNotMatch(JSON.stringify(a), /window:/);
    await assert.rejects(ieContracts({ what: "x", cpv: "123" }), InputError);
    await assert.rejects(ieContracts({ what: "laptops", buyer_area: "Cork" }), InputError);
    await assert.rejects(ieContracts({ what: "quantum widgets" }), InputError);
  } finally {
    delete process.env.PROOFPRICE_LIBRARY_DIR;
  }
});
