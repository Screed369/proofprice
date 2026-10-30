import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { RELEASES, JSONL } from "./fixtures";
import { aggregate, contractsOf, gregorianDate, INFO, purchaseOfTitle, streamJsonLines, thContracts, thContractsHarvest, ThContract, windowStart } from "./source";
import { writeDaily, writeMeta } from "../../lib/library/store";
import { InputError, SourceError } from "../../lib/http";

test("real BMA contracts become ThContracts with a Gregorian start date (file checked 2026-10-30)", () => {
  const all = RELEASES.flatMap((r) => contractsOf(r));
  assert.equal(all.length, RELEASES.length);
  assert.equal(all[0].value, 9432);
  assert.equal(all[0].date, "2025-02-24"); // 2568 Buddhist Era = 2025
  assert.equal(all[0].key, "ocds-bq4ldt-68500100007250940000060104001-026|21-31-68-50010700|1");
  assert.equal(all[1].title, "จ้างเหมาจัดทำอาหารเช้าและอาหารกลางวัน สำหรับนักเรียน โรงเรียนวัดสุทัศน์ ประจำเดือน พฤษภาคม 2568"); // spaces collapsed
});

test("Buddhist Era and Gregorian dates, and junk", () => {
  assert.equal(gregorianDate("2568-02-24T00:00:00Z"), "2025-02-24");
  assert.equal(gregorianDate("2025-02-24T00:00:00Z"), "2025-02-24");
  assert.equal(gregorianDate("2538-01-01T00:00:00Z"), ""); // 1995: before 2000, not a usable date
  assert.equal(gregorianDate(""), "");
  assert.equal(gregorianDate("not a date"), "");
  assert.equal(gregorianDate("2568-13-01"), "");
});

test("guards: status, currency, entry-error amounts, packages", () => {
  const base = RELEASES[0];
  const withContract = (patch: any) => ({ ...base, contracts: [{ ...base.contracts[0], ...patch }] });
  assert.equal(contractsOf(withContract({})).length, 1);
  assert.equal(contractsOf(withContract({ status: "terminated" })).length, 0);
  assert.equal(contractsOf(withContract({ value: { amount: 9432, currency: "USD" } })).length, 0);
  assert.equal(contractsOf(withContract({ value: { amount: 500, currency: "THB" } })).length, 0, "under 1,000 baht is a placeholder");
  assert.equal(contractsOf(withContract({ value: { amount: 5_000_000_000, currency: "THB" } })).length, 0);
  assert.equal(contractsOf(withContract({ period: {} })).length, 0);
  assert.equal(contractsOf(withContract({ title: "" })).length, 0);
  assert.equal(contractsOf({ releases: [base] }).length, 1);
  assert.equal(contractsOf({ compiledRelease: base }).length, 1);
  assert.deepEqual(contractsOf(null), []);
});

test("Thai titles: only real purchases are recognised, ink and cards and mixed lots are not", () => {
  const ids = RELEASES.flatMap((r) => contractsOf(r)).map((c) => purchaseOfTitle(c.title));
  assert.deepEqual(ids, [
    "school-meals", "school-meals", "school-meals",
    "building-cleaning", "building-cleaning", "school-cleaning",
    null, // ID cards for security, not a guard service
    "security-guards", "security-guards",
    "laptops",
    null, // desktops and notebooks in one lot
    null, // office supplies
    null, // copier ink
  ]);
  assert.equal(purchaseOfTitle("จ้างเหมาซ่อมเครื่องปรับอากาศ ทำความสะอาดอาคาร"), null, "repairs are not a purchase");
  assert.equal(purchaseOfTitle(""), null);
});

function many(title: string, values: number[], date = "2026-03-01"): ThContract[] {
  return values.map((v, i) => ({ key: `o${title}${i}|${i}|`, date, value: v, title }));
}

test("aggregate: needs 5 contracts, window by start date, each contract once", () => {
  const meals = "จ้างเหมาจัดทำอาหารกลางวันสำหรับนักเรียน";
  const cs = [
    ...many(meals, [10000, 12000, 9000, 15000, 11000]),
    ...many("จ้างเหมาทำความสะอาดอาคารสำนักงานเขต", [100000, 200000, 300000, 400000]),
    ...many(meals, [999999], "2023-01-01"), // outside the 24 months
  ];
  cs.push(cs[0]); // the same contract twice
  const rows = aggregate(cs, "2024-10-30", "2026-10-30");
  assert.deepEqual(rows.map((r) => [r.item, r.n, r.median, r.area]), [["school-meals", 5, 11000, "ALL"]]);
});

function gzBody(text: string): Response {
  return new Response(gzipSync(Buffer.from(text)), { status: 200, headers: { "content-type": "application/gzip" } });
}

test("jsonl reader: gunzips Thai text, splits lines, skips a damaged line", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = (async () => gzBody(JSONL + "{not json\n")) as typeof fetch;
  try {
    const docs: any[] = [];
    const r = await streamJsonLines("https://example.test/x.jsonl.gz", (d) => docs.push(d));
    assert.deepEqual(r, { lines: RELEASES.length + 1, bad: 1 });
    assert.equal(docs.length, RELEASES.length);
    assert.match(docs[0].contracts[0].title, /อาหารกลางวัน/);
  } finally {
    globalThis.fetch = real;
  }
});

test("harvest reads the file, answers come from the library, guards say what is wrong", async () => {
  const lines = many("จ้างเหมาจัดทำอาหารกลางวันสำหรับนักเรียน", [10000, 12000, 9000, 15000, 11000], "2026-05-01").map((c, i) =>
    JSON.stringify({ ocid: `ocds-x-${i}`, contracts: [{ id: String(i), awardID: 1, title: c.title, period: { startDate: "2569-05-01T00:00:00Z" }, status: "active", value: { amount: c.value, currency: "THB" } }] }),
  );
  const real = globalThis.fetch;
  let called = "";
  globalThis.fetch = (async (u: any) => { called = String(u); return gzBody(JSONL + lines.join("\n")); }) as typeof fetch;
  const dir = mkdtempSync(path.join(tmpdir(), "thbma-"));
  process.env.PROOFPRICE_LIBRARY_DIR = dir;
  try {
    const h = await thContractsHarvest(new Date("2026-10-30T03:17:00Z"));
    assert.match(called, /open-contracting\.org.*publication\/158.*2026\.jsonl\.gz/);
    assert.equal(h.currency, "THB");
    assert.ok(h.rows.some((r) => r.item === "school-meals"));
    const row = h.rows.find((r) => r.item === "school-meals")!;
    assert.ok(row.n >= 5);
    writeDaily(INFO.id, h);
    writeMeta(INFO.id, { source: INFO.id, currency: "THB", unit: h.unit, first_date: h.date, last_date: h.date, days: 1, last_harvest_at: "x", last_rows: 1, last_ok_at: "x", last_error: null });
    const a = await thContracts({ what: "school meals" });
    assert.equal(a.status, "ok");
    assert.equal(a.price_type, "contract_price");
    assert.equal(a.price?.currency, "THB");
    assert.equal(a.sample_size, row.n);
    assert.deepEqual(a.period, { from: "2024-10-30", to: "2026-10-30" });
    assert.match(a.summary, /not unit prices/);
    assert.equal((await thContracts({ what: "security guard services" })).status, "no_matches");
    await assert.rejects(thContracts({ what: "quantum widgets" }), InputError);
    await assert.rejects(thContracts({ what: "catering" }), InputError, "recognised purchase this source does not carry");
    await assert.rejects(thContracts({ what: "school meals", cpv: "1234" }), InputError);
    await assert.rejects(thContracts({ what: "school meals", buyer_area: "Bangkok" }), InputError);
    globalThis.fetch = (async () => gzBody('{"ocid":"a","awards":[]}\n')) as typeof fetch;
    await assert.rejects(thContractsHarvest(new Date("2026-10-30T03:17:00Z")), /no active contracts in baht/);
    globalThis.fetch = (async () => new Response("down", { status: 503 })) as typeof fetch;
    await assert.rejects(thContractsHarvest(new Date("2026-10-30T03:17:00Z")), SourceError);
  } finally {
    globalThis.fetch = real;
    delete process.env.PROOFPRICE_LIBRARY_DIR;
  }
});

test("no library yet gives a readable error; window is 24 months", async () => {
  process.env.PROOFPRICE_LIBRARY_DIR = mkdtempSync(path.join(tmpdir(), "thbma-empty-"));
  try {
    await assert.rejects(thContracts({ what: "school meals" }), /not been collected yet/);
  } finally {
    delete process.env.PROOFPRICE_LIBRARY_DIR;
  }
  assert.equal(windowStart("2026-10-30"), "2024-10-30");
});

test("INFO: CC BY 4.0, contract prices, no suppliers", () => {
  assert.match(INFO.licence, /CC BY 4\.0/);
  assert.equal(INFO.price_type, "contract_price");
  assert.match(INFO.limits, /suppliers and officials are never named/);
  assert.match(INFO.attribution, /Open Contracting Partnership/);
});
