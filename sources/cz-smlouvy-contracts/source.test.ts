import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  aggregateAll, ContractBook, czContracts, czContractsHarvest, dumpMonths, dumpUrl, INFO, parseRecord, purchaseOfSubject, readDump, splitRecords, windowMarker, windowOf,
} from "./source";
import { writeDaily, writeMeta } from "../../lib/library/store";
import { InputError, SourceError } from "../../lib/http";

// Layout copied from the live dump https://data.smlouvy.gov.cz/dump_2026_10.xml (checked 2026-11-05). Records 1 and 3 are real (names shortened);
// the second shows a record whose value excl. VAT is absent.
const REC_HOSP = `<zaznam><identifikator><idSmlouvy>37366417</idSmlouvy><idVerze>39739413</idVerze></identifikator><odkaz>https://smlouvy.gov.cz/smlouva/39739413</odkaz><casZverejneni>2026-10-01T05:22:47+02:00</casZverejneni><smlouva><subjekt><datovaSchranka>v7zqi84</datovaSchranka><nazev>Fakultni nemocnice</nazev><ico>00179906</ico><adresa>Sokolska 581</adresa><platce>1</platce></subjekt><smluvniStrana><datovaSchranka>2t4pa54</datovaSchranka><nazev>CSF, s.r.o.</nazev><ico>25289462</ico><adresa>Strelecka 672/14</adresa><prijemce>1</prijemce><identifikace>PO</identifikace></smluvniStrana><predmet>VT2600409_CSF, monitor LCD 17.09.2026(a)- informatika</predmet><datumUzavreni>2026-09-17</datumUzavreni><cisloSmlouvy>FNHK/0061102/2026/PRAV</cisloSmlouvy><hodnotaBezDph>68400</hodnotaBezDph></smlouva><prilohy><priloha><nazevSouboru>VT.pdf</nazevSouboru><hash algoritmus="sha256">24f0</hash><odkaz>https://smlouvy.gov.cz/smlouva/soubor/1/VT.pdf</odkaz></priloha></prilohy><platnyZaznam>1</platnyZaznam></zaznam>`;
const REC_NOVALUE = `<zaznam><identifikator><idSmlouvy>8476807</idSmlouvy><idVerze>39739425</idVerze></identifikator><odkaz>x</odkaz><casZverejneni>2026-10-01T06:04:31+02:00</casZverejneni><smlouva><subjekt><nazev>Skola</nazev><ico>00226475</ico></subjekt><smluvniStrana><nazev>Skola</nazev><ico>00226475</ico></smluvniStrana><predmet>Výpověď z nájmu prostoru sloužícímu k podnikání</predmet><datumUzavreni>2026-09-17</datumUzavreni><cisloSmlouvy>1003/2026</cisloSmlouvy></smlouva><platnyZaznam>1</platnyZaznam></zaznam>`;
const rec = (id: number, ver: number, date: string, subject: string, value: string | null, valid = 1) =>
  `<zaznam><identifikator><idSmlouvy>${id}</idSmlouvy><idVerze>${ver}</idVerze></identifikator><casZverejneni>${date}T05:22:47+02:00</casZverejneni><smlouva><subjekt><nazev>A</nazev><ico>1</ico></subjekt><smluvniStrana><nazev>B</nazev><ico>2</ico></smluvniStrana><predmet>${subject}</predmet><datumUzavreni>${date}</datumUzavreni>${value === null ? "" : `<hodnotaBezDph>${value}</hodnotaBezDph>`}</smlouva><platnyZaznam>${valid}</platnyZaznam></zaznam>`;
const head = `<?xml version="1.0" encoding="UTF-8"?><dump xmlns="http://portal.gov.cz/rejstriky/ISRS/1.2/"><mesic>10</mesic><rok>2026</rok><casGenerovani>2026-11-05T03:49:38+01:00</casGenerovani><dokoncenyMesic>1</dokoncenyMesic>`;

test("purchaseOfSubject recognises Czech wording, with accents and inflection, and ignores other contracts", () => {
  assert.equal(purchaseOfSubject("Svoz komunálního odpadu na území města"), "waste-collection");
  assert.equal(purchaseOfSubject("Dodávka elektrické energie pro rok 2027"), "electricity");
  assert.equal(purchaseOfSubject("Nákup notebooků pro školu"), "laptops");
  assert.equal(purchaseOfSubject("Úklid kanceláří"), "office-cleaning");
  assert.equal(purchaseOfSubject("Smlouva o právní pomoci"), "legal-services");
  assert.equal(purchaseOfSubject("VT2600409_CSF, monitor LCD 17.09.2026(a)- informatika"), null);
  assert.equal(purchaseOfSubject("Výpověď z nájmu prostoru sloužícímu k podnikání"), null);
  assert.equal(purchaseOfSubject(""), null);
});

test("parseRecord reads the live layout, keeps the value excluding VAT only and never the parties or the subject", () => {
  const a = parseRecord(REC_HOSP)!;
  assert.deepEqual(a, { id: "37366417", version: 39739413, date: "2026-10-01", value: 68400, purchase: null, valid: true });
  assert.doesNotMatch(JSON.stringify(a), /nemocnice|CSF|monitor/i);
  const b = parseRecord(REC_NOVALUE)!;
  assert.equal(b.value, null);
  assert.equal(parseRecord("<zaznam></zaznam>"), null);
  const c = parseRecord(rec(5, 9, "2026-10-02", "Svoz odpadu &amp; ostatní", "1 500", 0))!;
  assert.equal(c.value, null); // "1 500" is not a plain number: refused, not guessed
  assert.equal(c.valid, false);
  assert.equal(c.purchase, "waste-collection");
});

test("splitRecords copes with records cut in half by a network chunk", () => {
  const all = head + REC_HOSP + REC_NOVALUE + "</dump>";
  const cut = all.indexOf("<odkaz>x</odkaz>");
  const first = splitRecords(all.slice(0, cut));
  assert.equal(first.records.length, 1);
  const second = splitRecords(first.rest + all.slice(cut));
  assert.equal(second.records.length, 1);
  assert.match(second.records[0], /8476807/);
});

test("ContractBook keeps the newest version of a contract and drops withdrawn ones, out-of-window ones and absurd values", () => {
  const book = new ContractBook();
  const add = (x: string) => book.add(parseRecord(x)!);
  add(rec(1, 10, "2026-10-05", "Svoz odpadu", "100000"));
  add(rec(1, 11, "2026-10-05", "Svoz odpadu", "120000")); // newer version wins
  add(rec(2, 10, "2026-10-05", "Svoz odpadu", "90000"));
  add(rec(2, 12, "2026-10-06", "Svoz odpadu", "90000", 0)); // withdrawn
  add(rec(3, 10, "2026-09-05", "Svoz odpadu", "90000")); // before the window
  add(rec(4, 10, "2026-10-05", "Svoz odpadu", "5")); // placeholder
  add(rec(5, 10, "2026-10-05", "Svoz odpadu", "99999999999")); // entry error
  add(rec(6, 10, "2026-10-05", "Svoz odpadu", null)); // no value
  const u = book.usable("2026-10-01", "2026-11-05");
  assert.deepEqual(u.map((c) => [c.id, c.value]), [["1", 120000]]);
});

test("aggregateAll gives a row only for purchases with at least 5 contracts", () => {
  const mk = (n: number, subject: string, base: number) =>
    Array.from({ length: n }, (_, i) => parseRecord(rec(1000 * n + i, 1, "2026-10-05", subject, String(base + i * 1000)))!);
  const rows = aggregateAll([...mk(6, "Svoz odpadu", 100000), ...mk(4, "Úklid kanceláří", 50000)]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].item, "waste-collection");
  assert.equal(rows[0].n, 6);
  assert.equal(rows[0].area, "ALL");
  assert.ok(rows[0].median >= 100000 && rows[0].median <= 105000);
});

test("dumpMonths and dumpUrl follow the register's file names, across a year end", () => {
  assert.deepEqual(dumpMonths(new Date("2026-11-05T03:00:00Z")), [{ year: 2026, month: 10 }, { year: 2026, month: 11 }]);
  assert.deepEqual(dumpMonths(new Date("2027-01-02T03:00:00Z")), [{ year: 2026, month: 12 }, { year: 2027, month: 1 }]);
  assert.equal(dumpUrl({ year: 2026, month: 10 }), "https://data.smlouvy.gov.cz/dump_2026_10.xml");
});

const fakeChunks = (files: Record<string, string>, size = 4000) =>
  async function* (url: string) {
    const body = files[url];
    if (body === undefined) throw new SourceError("HTTP 404", url);
    for (let i = 0; i < body.length; i += size) yield body.slice(i, i + size);
  };

test("harvest reads both months in small chunks, aggregates, and records the window", async () => {
  const oct = head + [1, 2, 3, 4, 5, 6].map((i) => rec(100 + i, 1, "2026-10-0" + i, "Svoz komunálního odpadu", String(200000 + i * 10000))).join("") + REC_HOSP + REC_NOVALUE + "</dump>";
  const nov = head + [1, 2, 3].map((i) => rec(200 + i, 1, "2026-11-0" + i, "Svoz komunálního odpadu", String(300000 + i * 10000))).join("") + "</dump>";
  const now = new Date("2026-11-05T03:17:00Z");
  const h = await czContractsHarvest(now, { chunks: fakeChunks({ [dumpUrl({ year: 2026, month: 10 })]: oct, [dumpUrl({ year: 2026, month: 11 })]: nov }, 777) });
  assert.equal(h.date, "2026-11-05");
  assert.equal(h.currency, "CZK");
  const waste = h.rows.find((r) => r.item === "waste-collection")!;
  assert.equal(waste.n, 9);
  assert.equal(windowOf(h.rows), "2026-10-01");
  assert.equal(h.rows.filter((r) => r.item !== waste.item && !r.item.startsWith("window:")).length, 0);
  // one month missing only shortens the data; both missing is a failure
  const half = await czContractsHarvest(now, { chunks: fakeChunks({ [dumpUrl({ year: 2026, month: 10 })]: oct }) });
  assert.equal(half.rows.find((r) => r.item === "waste-collection")!.n, 6);
  await assert.rejects(czContractsHarvest(now, { chunks: fakeChunks({}) }), SourceError);
  await assert.rejects(czContractsHarvest(now, { chunks: fakeChunks({ [dumpUrl({ year: 2026, month: 10 })]: head + "</dump>" }) }), SourceError);
  const book = new ContractBook();
  assert.equal(await readDump("u", fakeChunks({ u: head + REC_HOSP + "</dump>" }), book), 1);
});

test("answer: median and range from the library, period from the window marker, and clear refusals", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "czsml-"));
  process.env.PROOFPRICE_LIBRARY_DIR = dir;
  try {
    const h = {
      date: "2026-11-05",
      currency: "CZK",
      unit: "per contract, total value excluding VAT",
      rows: [{ area: "ALL", item: "waste-collection", n: 41, median: 250000, low: 90000, high: 900000, min: 60000, max: 2000000 }, windowMarker("2026-10-01")],
    };
    writeDaily(INFO.id, h);
    writeMeta(INFO.id, { source: INFO.id, currency: "CZK", unit: h.unit, first_date: h.date, last_date: h.date, days: 1, last_harvest_at: "x", last_rows: h.rows.length, last_ok_at: "x", last_error: null });
    const a = await czContracts({ what: "waste collection" });
    assert.equal(a.status, "ok");
    assert.equal(a.price_type, "contract_price");
    assert.equal(a.price?.currency, "CZK");
    assert.equal(a.sample_size, 41);
    assert.equal(a.price?.median, 250000);
    assert.deepEqual(a.period, { from: "2026-10-01", to: "2026-11-05" });
    assert.match(a.summary, /not unit prices/);
    assert.doesNotMatch(JSON.stringify(a), /window:/);
    await assert.rejects(czContracts({ what: "waste collection", cpv: "90" }), InputError);
    await assert.rejects(czContracts({ what: "waste collection", buyer_area: "Praha" }), InputError);
    await assert.rejects(czContracts({ what: "quantum widgets" }), InputError);
  } finally {
    delete process.env.PROOFPRICE_LIBRARY_DIR;
  }
});
