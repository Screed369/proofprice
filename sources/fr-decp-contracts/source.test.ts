import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { aggregateAll, contractOf, frContracts, frContractsHarvest, INFO, itemsOf, monthlyFiles, RecordSplitter, windowStart } from "./source";
import { writeDaily, writeMeta } from "../../lib/library/store";
import { InputError, SourceError } from "../../lib/http";

// Shape copied from the live monthly file decp-2026-10.json, checked 2026-10-22 (pretty-printed, {"marches":{"marche":[...]}}).
const rec = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  acheteur: { id: "21600056200019" },
  nature: "Marché",
  objet: "Fourniture d'ordinateurs portables",
  codeCPV: "30213100-6",
  procedure: "Appel d'offres ouvert",
  lieuExecution: { code: "60057", typeCode: "Code commune" },
  dateNotification: "2026-05-04",
  datePublicationDonnees: "2026-05-20",
  montant: 100000 + Number(id.replace(/\D/g, "")) * 1000,
  titulaires: [{ titulaire: { typeIdentifiant: "SIRET", id: "34346062200057" } }],
  techniques: { technique: ["Sans objet"] },
  ...over,
});
const fileText = (records: unknown[]) => JSON.stringify({ marches: { marche: records } }, null, 2);

const LISTING = {
  data: [
    { title: "decp-2026-10.json", latest: "https://www.data.gouv.fr/api/1/datasets/r/9cd07cc6-736a-423f-aeea-0f2c0726f65d" },
    { title: "decp-global.json", latest: "https://www.data.gouv.fr/api/1/datasets/r/bd33e98f-f8e3-49ba-9f26-51c95fe57234" },
    { title: "decp-2026-09.json", latest: "https://www.data.gouv.fr/api/1/datasets/r/f0839416-6fee-4a88-85d0-137361c39eec" },
    { title: "decp-2024-01.json", latest: "https://www.data.gouv.fr/api/1/datasets/r/ffffffff" },
    { title: "decp-2026.json", latest: "https://www.data.gouv.fr/api/1/datasets/r/2551ad40" },
  ],
};

test("the resource list gives monthly files only, newest first", () => {
  assert.deepEqual(monthlyFiles(LISTING).map((f) => f.month), ["2026-10", "2026-09", "2024-01"]);
  assert.deepEqual(monthlyFiles(null), []);
});

test("the splitter reads records across tiny pieces, strings with braces and escaped quotes, and stops at the end of the list", () => {
  const records = [rec("1", { objet: 'a } brace and a "quote" and \\ slash {' }), rec("2"), rec("3")];
  const text = fileText(records) + '\n// trailing text that must never be read {';
  for (const size of [1, 7, 64, 100000]) {
    const got: any[] = [];
    const s = new RecordSplitter((r) => got.push(r));
    for (let i = 0; i < text.length; i += size) s.push(text.slice(i, i + size));
    assert.equal(got.length, 3, `size ${size}`);
    assert.equal(got[0].objet, 'a } brace and a "quote" and \\ slash {');
    assert.equal(got[2].id, "3");
    assert.equal(s.finished, true);
  }
});

test("the splitter refuses a file that is not a contract list", () => {
  const s = new RecordSplitter(() => {});
  assert.throws(() => s.push("<html>".repeat(1000)), SourceError);
});

test("contractOf: keeps real awards; drops placeholders, entry errors, frameworks, undated and out-of-window contracts, text amounts become numbers", () => {
  const f = "2025-10-22";
  const t = "2026-10-22";
  assert.deepEqual(contractOf(rec("5"), f, t), { key: "21600056200019|5", date: "2026-05-04", value: 105000, cpv: "30213100" });
  assert.equal(contractOf(rec("5", { montant: 1 }), f, t), null);
  assert.equal(contractOf(rec("5", { montant: 5e9 }), f, t), null);
  assert.equal(contractOf(rec("5", { montant: "NC" }), f, t), null);
  assert.equal(contractOf(rec("5", { montant: "12345,5" }), f, t)?.value, 12345.5);
  assert.equal(contractOf(rec("5", { nature: "Accord-cadre" }), f, t), null);
  assert.equal(contractOf(rec("5", { dateNotification: "2021-10-11" }), f, t), null);
  assert.equal(contractOf(rec("5", { dateNotification: "2027-01-01" }), f, t), null);
  assert.equal(contractOf(rec("5", { dateNotification: "" }), f, t), null);
  assert.equal(contractOf(rec("5", { codeCPV: "NC" }), f, t), null);
  assert.equal(contractOf(null, f, t), null);
});

test("itemsOf: shared purchase by CPV group plus the 2- and 4-digit CPV groups", () => {
  assert.deepEqual(itemsOf("30213100"), ["laptops", "cpv-30", "cpv-3021"]);
  assert.ok(itemsOf("55524000").includes("school-meals"));
  assert.deepEqual(itemsOf("99999999"), ["cpv-99", "cpv-9999"]);
});

test("aggregateAll: 5 distinct contracts needed, a contract counts once, window by notification date", () => {
  const mk = (n: number, base: number) => Array.from({ length: n }, (_, i) => ({ key: `k${base}-${i}`, date: "2026-03-01", value: base + i, cpv: "30213100" }));
  const five = mk(5, 100000);
  const rows = aggregateAll([...five, five[0], { key: "old", date: "2020-01-01", value: 9e8, cpv: "30213100" }], "2025-10-22", "2026-10-22");
  const laptops = rows.find((r) => r.item === "laptops");
  assert.deepEqual(laptops && [laptops.area, laptops.n, laptops.median], ["ALL", 5, 100002]);
  assert.ok(rows.find((r) => r.item === "cpv-3021" && r.n === 5));
  assert.deepEqual(aggregateAll(mk(4, 100000), "2025-10-22", "2026-10-22"), []);
});

function opener(files: Record<string, string>, calls: string[] = [], chunk = 5000) {
  return async (url: string) => {
    calls.push(url);
    const text = files[url];
    if (text === undefined) throw new SourceError("HTTP 500");
    const bytes = new TextEncoder().encode(text);
    return (async function* () {
      for (let i = 0; i < bytes.length; i += chunk) yield bytes.slice(i, i + chunk); // splits multi-byte letters too
    })();
  };
}
const OCT = LISTING.data[0].latest;
const SEP = LISTING.data[2].latest;
const octRecords = [...[1, 2, 3, 4].map((i) => rec(String(i), { objet: "Fourniture d'équipements électrochirurgie é" })), rec("20", { montant: 5e9 })];
const sepRecords = [rec("5"), rec("6"), rec("1") /* same contract published again: counted once */, rec("7", { dateNotification: "2020-01-01" })];

test("harvest: streams the monthly files, counts a contract once, keeps aggregates only, then answers come from the library", async () => {
  const calls: string[] = [];
  const dir = mkdtempSync(path.join(tmpdir(), "frdecp-"));
  process.env.PROOFPRICE_LIBRARY_DIR = dir;
  try {
    const h = await frContractsHarvest(new Date("2026-10-22T03:17:00Z"), {
      listing: LISTING,
      open: opener({ [OCT]: fileText(octRecords), [SEP]: fileText(sepRecords) }, calls),
    });
    assert.equal(h.currency, "EUR");
    assert.equal(h.date, "2026-10-22");
    assert.equal(calls[0], OCT); // newest month first
    const laptops = h.rows.find((r) => r.item === "laptops")!;
    assert.deepEqual([laptops.n, laptops.median], [6, 103500]); // 1..6 -> 101000..106000
    assert.match(h.note ?? "", /2 monthly files/);
    assert.doesNotMatch(JSON.stringify(h), /34346062200057|21600056200019|SIRET/);
    writeDaily(INFO.id, h);
    writeMeta(INFO.id, { source: INFO.id, currency: "EUR", unit: h.unit, first_date: h.date, last_date: h.date, days: 1, last_harvest_at: "x", last_rows: h.rows.length, last_ok_at: "x", last_error: null });

    const a = await frContracts({ what: "ordinateurs portables" });
    assert.equal(a.status, "ok");
    assert.equal(a.price_type, "contract_price");
    assert.equal(a.price?.currency, "EUR");
    assert.equal(a.price?.median, 103500);
    assert.equal(a.sample_size, 6);
    assert.deepEqual(a.period, { from: "2025-10-22", to: "2026-10-22" });
    assert.match(a.summary, /not unit prices/);

    const g = await frContracts({ what: "anything", cpv: "30213100-6" });
    assert.equal(g.status, "ok");
    assert.equal(g.extra?.cpv_group, "3021");
    assert.equal((await frContracts({ what: "x", cpv: "30" })).sample_size, 6);
    assert.equal((await frContracts({ what: "ambulances" })).status, "no_matches");
    await assert.rejects(frContracts({ what: "quantum widgets" }), InputError);
    await assert.rejects(frContracts({ what: "laptops", cpv: "302" }), InputError);
    await assert.rejects(frContracts({ what: "laptops", cpv: "abc" }), InputError);
    await assert.rejects(frContracts({ what: "laptops", buyer_area: "Paris" }), InputError);
  } finally {
    delete process.env.PROOFPRICE_LIBRARY_DIR;
  }
});

test("harvest: one unreadable month is noted, all unreadable is an error, empty data is an error, the time budget stops new files", async () => {
  const now = new Date("2026-10-22T03:17:00Z");
  const some = await frContractsHarvest(now, { listing: LISTING, open: opener({ [OCT]: fileText([...[1, 2, 3, 4, 5].map((i) => rec(String(i)))]) }) });
  assert.match(some.note ?? "", /Not read this day: 2026-09/);
  await assert.rejects(frContractsHarvest(now, { listing: LISTING, open: opener({}) }), /Could not read the DECP files/);
  await assert.rejects(frContractsHarvest(now, { listing: LISTING, open: opener({ [OCT]: fileText([]), [SEP]: fileText([]) }) }), /no usable contracts/);
  await assert.rejects(frContractsHarvest(now, { listing: { data: [] } }), /no monthly files/);
  const timed = await frContractsHarvest(now, { listing: LISTING, budgetMs: -1, open: opener({ [OCT]: fileText([]) }) }).catch((e) => e);
  assert.ok(timed instanceof SourceError); // nothing read inside the budget
});

test("no library yet gives a readable error; window is 12 months", async () => {
  process.env.PROOFPRICE_LIBRARY_DIR = mkdtempSync(path.join(tmpdir(), "frdecp-empty-"));
  try {
    await assert.rejects(frContracts({ what: "laptops" }), /not been collected yet/);
  } finally {
    delete process.env.PROOFPRICE_LIBRARY_DIR;
  }
  assert.equal(windowStart("2026-10-22"), "2025-10-22");
});

test("INFO: Licence Ouverte, contract prices, no suppliers", () => {
  assert.match(INFO.licence, /Licence Ouverte/);
  assert.equal(INFO.price_type, "contract_price");
  assert.match(INFO.limits, /company numbers in the open files are never read/);
  assert.match(INFO.attribution, /Ministeres economiques et financiers/);
});
