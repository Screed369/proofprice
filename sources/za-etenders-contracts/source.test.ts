import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { RELEASES, JSONL } from "./fixtures";
import { aggregate, contractsOf, INFO, purchaseOf, streamJsonLines, windowStart, zaContracts, zaContractsHarvest, ZaContract } from "./source";
import { writeDaily, writeMeta } from "../../lib/library/store";
import { InputError, SourceError } from "../../lib/http";

test("real contracts become ZaContracts; terminated, pending and zero-value ones are not prices", () => {
  const all = RELEASES.flatMap((r) => contractsOf(r));
  assert.deepEqual(all.map((c) => c.value), [1530003, 48947841, 606875, 411947]);
  assert.equal(all[0].date, "2026-07-20");
  assert.equal(all[0].key, "ocds-9t57fa-100266|6241|38976");
  assert.equal(all[3].text, "SUPPLY; DELIVERY; COMMISSIONING & MAINTENANCE OF OFFICE AUTOMATION SOLUTION MINISTRY DURBAN"); // _x000D_ line break marker removed
});

test("guards: other currency, entry-error amounts, bad dates, packages and records", () => {
  const base = RELEASES[0];
  const withContract = (patch: any) => ({ ...base, contracts: [{ ...base.contracts[0], ...patch }] });
  assert.equal(contractsOf(withContract({})).length, 1);
  assert.equal(contractsOf(withContract({ value: { amount: 1530003, currency: "USD" } })).length, 0);
  assert.equal(contractsOf(withContract({ value: { amount: 5356639625, currency: "ZAR" } })).length, 0, "5.3 billion rand for a small supplier is an entry error");
  assert.equal(contractsOf(withContract({ value: { amount: 10, currency: "ZAR" } })).length, 0);
  assert.equal(contractsOf(withContract({ dateSigned: "0001-01-01T00:00:00Z" })).length, 0);
  assert.equal(contractsOf(withContract({ dateSigned: "" })).length, 0);
  assert.equal(contractsOf({ releases: [base] }).length, 1);
  assert.equal(contractsOf({ compiledRelease: base }).length, 1);
  assert.deepEqual(contractsOf(null), []);
  assert.deepEqual(contractsOf({ ocid: "x", awards: [{ title: "SUPPLIER NAME", value: { amount: 5356639625, currency: "ZAR" } }] }), [], "awards are never read");
});

function many(desc: string, values: number[], date = "2026-03-01"): ZaContract[] {
  return values.map((v, i) => ({ key: `o${desc}${i}|${i}|`, date, value: v, text: desc, tenderText: "" }));
}

test("aggregate: needs 5 contracts, window by signing date, each contract once, tender text as a second chance", () => {
  const cs = [
    ...many("Provision of catering services", [100000, 120000, 90000, 150000, 110000]),
    ...many("Supply of printers", [1000, 2000, 3000, 4000]),
    ...many("Provision of catering services", [999999], "2023-01-01"), // outside the 24 months
  ];
  cs.push(cs[0]); // the same contract twice
  const rows = aggregate(cs, "2024-10-22", "2026-10-22");
  assert.deepEqual(rows.map((r) => [r.item, r.n, r.median, r.area]), [["catering", 5, 110000, "ALL"]]);
  const viaTender: ZaContract = { key: "t|1|", date: "2026-01-01", value: 5000, text: "", tenderText: "Appointment of a panel for legal services" };
  assert.equal(purchaseOf(viaTender), "legal-services");
  assert.equal(purchaseOf({ ...viaTender, text: "Provision of mechanization services", tenderText: "" }), null);
});

function gzBody(text: string): Response {
  return new Response(gzipSync(Buffer.from(text)), { status: 200, headers: { "content-type": "application/gzip" } });
}

test("jsonl reader: gunzips, splits lines across chunks, skips a damaged line", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = (async () => gzBody(JSONL + "{not json\n")) as typeof fetch;
  try {
    const docs: any[] = [];
    const r = await streamJsonLines("https://example.test/x.jsonl.gz", (d) => docs.push(d));
    assert.deepEqual(r, { lines: 7, bad: 1 });
    assert.equal(docs.length, 6);
  } finally {
    globalThis.fetch = real;
  }
});

test("harvest reads the file, answers come from the library, guards say what is wrong", async () => {
  const lines = many("Provision of catering services", [100000, 120000, 90000, 150000, 110000], "2026-05-01").map((c, i) =>
    JSON.stringify({ ocid: `ocds-x-${i}`, contracts: [{ id: String(i), awardID: String(i), dateSigned: c.date + "T10:00:00Z", description: c.text, status: "active", value: { amount: c.value, currency: "ZAR" } }] }),
  );
  const real = globalThis.fetch;
  let called = "";
  globalThis.fetch = (async (u: any) => { called = String(u); return gzBody(JSONL + lines.join("\n")); }) as typeof fetch;
  const dir = mkdtempSync(path.join(tmpdir(), "zaet-"));
  process.env.PROOFPRICE_LIBRARY_DIR = dir;
  try {
    const h = await zaContractsHarvest(new Date("2026-10-22T03:17:00Z"));
    assert.match(called, /open-contracting\.org.*full\.jsonl\.gz/);
    assert.equal(h.currency, "ZAR");
    assert.deepEqual(h.rows.map((r) => [r.item, r.n, r.median]), [["catering", 5, 110000]]);
    writeDaily(INFO.id, h);
    writeMeta(INFO.id, { source: INFO.id, currency: "ZAR", unit: h.unit, first_date: h.date, last_date: h.date, days: 1, last_harvest_at: "x", last_rows: 1, last_ok_at: "x", last_error: null });
    const a = await zaContracts({ what: "catering" });
    assert.equal(a.status, "ok");
    assert.equal(a.price_type, "contract_price");
    assert.equal(a.price?.currency, "ZAR");
    assert.equal(a.price?.median, 110000);
    assert.equal(a.sample_size, 5);
    assert.deepEqual(a.period, { from: "2024-10-22", to: "2026-10-22" });
    assert.match(a.summary, /not unit prices/);
    assert.equal((await zaContracts({ what: "legal services" })).status, "no_matches");
    await assert.rejects(zaContracts({ what: "quantum widgets" }), InputError);
    await assert.rejects(zaContracts({ what: "catering", cpv: "1234" }), InputError);
    await assert.rejects(zaContracts({ what: "catering", buyer_area: "Gauteng" }), InputError);
    globalThis.fetch = (async () => gzBody('{"ocid":"a","awards":[]}\n')) as typeof fetch;
    await assert.rejects(zaContractsHarvest(new Date("2026-10-22T03:17:00Z")), /no active contracts in rand/);
    globalThis.fetch = (async () => new Response("down", { status: 503 })) as typeof fetch;
    await assert.rejects(zaContractsHarvest(new Date("2026-10-22T03:17:00Z")), SourceError);
  } finally {
    globalThis.fetch = real;
    delete process.env.PROOFPRICE_LIBRARY_DIR;
  }
});

test("no library yet gives a readable error; window is 24 months", async () => {
  process.env.PROOFPRICE_LIBRARY_DIR = mkdtempSync(path.join(tmpdir(), "zaet-empty-"));
  try {
    await assert.rejects(zaContracts({ what: "catering" }), /not been collected yet/);
  } finally {
    delete process.env.PROOFPRICE_LIBRARY_DIR;
  }
  assert.equal(windowStart("2026-10-22"), "2024-10-22");
});

test("INFO: PDDL licence, contract prices, no suppliers", () => {
  assert.match(INFO.licence, /Public Domain Dedication and Licence/);
  assert.equal(INFO.price_type, "contract_price");
  assert.match(INFO.limits, /suppliers and officials are never named/);
  assert.match(INFO.attribution, /Open Contracting Partnership/);
});
