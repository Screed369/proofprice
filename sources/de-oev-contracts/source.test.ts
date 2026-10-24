import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { deflateRawSync } from "node:zlib";
import { csvRows, deContracts, deContractsHarvest, filesFromZip, INFO, monthsInWindow, noticesFromFiles, type DeFiles } from "./source";
import { writeDaily, writeMeta } from "../../lib/library/store";
import { InputError, SourceError } from "../../lib/http";

// Lines copied from the live export https://oeffentlichevergabe.de/api/notice-exports?pubDay=2026-10-22&format=csv.zip (checked 2026-10-24, probe deoev-members),
// with a few extra rows built the same way to cover frameworks, other versions and lots without a winner.
const A = "ac2c1cf7-55fa-497b-90e8-d1c37a70354a"; // award, one lot, 667,584 EUR, CPV 71300000 (copied)
const B = "ad442d63-1baf-46ac-a606-594d101dd7ea"; // award, several lots (copied tender lines)
const C = "fb5df76d-b05f-4539-9fff-aed4910bfec7"; // modification notice (copied): must be ignored
const D = "225c588b-ddb1-44f5-aa8a-2078ae6200e0"; // award with a framework flag (built)
const NOTICE = `noticeIdentifier,noticeVersion,procedureIdentifier,procedureLegalBasis,formType,noticeType,publicationDate
e82b6f56-cbde-4786-b5f5-3ad1aa981492,01,3ad95062-5ed4-46a9-bc3e-a09cf1cba206,32014L0024,competition,cn-standard,2026-10-22T00:00:00+02:00
${A},01,6f5c1009-e69d-4177-b7c8-bcd1dc41be16,32014L0024,result,can-standard,2026-10-22T02:06:04Z
${B},01,f4678100-585d-4aef-9519-b5dc1a4a9952,32014L0024,result,can-standard,2026-10-22T02:06:04Z
${B},02,f4678100-585d-4aef-9519-b5dc1a4a9952,32014L0024,result,can-standard,2026-10-22T09:00:00Z
${C},01,275af851-7357-47a4-8d8c-d697579a9d8a,32014L0025,cont-modif,can-modif,2026-10-22T02:06:09Z
${D},01,72987891-2bdc-4f3c-86cd-ca80c68b9c4b,32014L0024,result,can-standard,2026-10-22T02:06:08Z
`;
const TENDER = (v: string) => `noticeIdentifier,noticeVersion,tenderIdentifier,lotIdentifier,tenderValue,tenderValueCurrency,tenderPaymentValue,tenderPaymentValueCurrency,tenderPenalties,tenderPenaltiesCurrency,tenderRank,concessionRevenueUser,concessionRevenueUserCurrency,concessionRevenueBuyer,concessionRevenueBuyerCurrency,countryOrigin
${A},01,TEN-0001,LOT-0001,667584.00,EUR,,,,,,,,,,
${B},01,TEN-0001,LOT-0001,48379.61,EUR,,,,,,,,,,
${B},02,TEN-0001,LOT-0001,${v},EUR,,,,,,,,,,
${B},02,TEN-0002,LOT-0001,${v},EUR,,,,,,,,,,
${B},02,TEN-0003,LOT-0006,528558.05,EUR,,,,,,,,,,
${B},02,TEN-0004,LOT-0005,528558.05,EUR,,,,,,,,,,
${B},02,TEN-0005,LOT-0007,1.00,EUR,,,,,,,,,,
${B},02,TEN-0006,LOT-0008,90000.00,USD,,,,,,,,,,
${B},02,TEN-0007,LOT-0009,70000.00,EUR,,,,,,,,,,
${C},01,TEN-0001,LOT-0000,,,,,,,,,,,,
${D},01,TEN-0001,LOT-0001,872584.54,EUR,,,,,,,,,,
`;
const CONTRACT = `noticeIdentifier,noticeVersion,contractIdentifier,winnerDecisionDate,contractConclusionDate,contractFrameworkAgreement
${A},01,CON-0001,,2026-10-20T00:00:00+02:00,
${B},02,CON-0001,,2026-10-20T00:00:00+02:00,
${B},02,CON-0002,,2026-10-18T00:00:00+02:00,
${C},01,CON-0001,2023-06-01T00:00:00+02:00,2023-06-12T00:00:00+02:00,
${D},01,CON-0001,2026-07-02T00:00:00+02:00,2026-08-05T00:00:00+02:00,fa-wo-rc
`;
const CLASS = `noticeIdentifier,noticeVersion,lotIdentifier,classificationType,mainClassificationCode,additionalClassificationCodes,options
${A},01,,cpv,71300000,71541000,
${B},02,,cpv,30213100,"30213000,30231300",
${B},02,LOT-0001,cpv,30213100,,
${B},02,LOT-0006,cpv,30213100,,
${B},02,LOT-0005,cpv,45000000,,
${B},02,LOT-0007,cpv,30213100,,
${B},02,LOT-0009,cpv,30213100,,
${D},01,LOT-0001,cpv,30213100,,
`;
const LOTRES = `noticeIdentifier,noticeVersion,lotIdentifier,procedureLotResultNumber,winnerChosen,notAwardedReason,frameworkMaximumValue,frameworkMaximumValueCurrency,frameworkEstimatedValue,frameworkEstimatedValueCurrency,tenderValueLowest,tenderValueLowestCurrency,tenderValueHighest,tenderValueHighestCurrency
${A},01,LOT-0001,0,selec-w,,,,,,667584.00,EUR,904355.00,EUR
${B},02,LOT-0001,0,selec-w,,,,,,34464.27,EUR,40881.04,EUR
${B},02,LOT-0009,1,selec-n,no-tenders,,,,,,,,
`;
const FILES = (v = "48379.61"): DeFiles => ({
  "notice.csv": NOTICE,
  "tender.csv": TENDER(v),
  "contract.csv": CONTRACT,
  "classification.csv": CLASS,
  "procedureLotResult.csv": LOTRES,
});

/** A real multi-file zip (deflate) built in memory. */
function zipOf(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const dirs: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text, "utf8");
    const comp = deflateRawSync(data);
    const nm = Buffer.from(name);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nm.length, 26);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt32LE(comp.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nm.length, 28);
    cd.writeUInt32LE(offset, 42);
    const local = Buffer.concat([lh, nm, comp]);
    locals.push(local);
    dirs.push(Buffer.concat([cd, nm]));
    offset += local.length;
  }
  const dir = Buffer.concat(dirs);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(dirs.length, 8);
  end.writeUInt16LE(dirs.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

test("csvRows: header keys, quotes, doubled quotes, line breaks inside quotes, BOM, CRLF", () => {
  const rows = csvRows('﻿a,b,c\r\n1,"x, y",3\r\n"he said ""hi""","two\nlines",\r\n');
  assert.deepEqual(rows, [
    { a: "1", b: "x, y", c: "3" },
    { a: 'he said "hi"', b: "two\nlines", c: "" },
  ]);
  assert.deepEqual(csvRows(""), []);
});

test("filesFromZip picks the five tables out of a multi-file zip and complains when one is missing", () => {
  const zip = zipOf({ ...FILES(), "organisation.csv": "never,read\nBuyer GmbH,x\n" });
  assert.equal(filesFromZip(zip)["tender.csv"].startsWith("noticeIdentifier,noticeVersion,tenderIdentifier"), true);
  const { "tender.csv": _t, ...rest } = FILES();
  assert.throws(() => filesFromZip(zipOf(rest)), /no tender\.csv/);
});

test("noticesFromFiles: award notices only, newest version, winners, EUR, one value once, lot CPV, signing date, no frameworks", () => {
  const got = noticesFromFiles(FILES(), "2026-04-24", "2026-10-24");
  assert.deepEqual([...got.keys()].sort(), [A, B].sort(), "modification notice and framework notice are left out");
  assert.deepEqual(got.get(A)?.contracts, [{ key: `${A}\u0000667584`, date: "2026-10-20", value: 667584, cpv: "71300000" }]);
  const b = got.get(B)!;
  assert.equal(b.version, "02");
  // version 02 only: LOT-0001 once (two tenders, same value), LOT-0006 + LOT-0005 equal value once (first lot's CPV),
  // 1 EUR placeholder, USD value and the lot with no winner (LOT-0009) are dropped; date = earliest conclusion date of the notice.
  assert.deepEqual(b.contracts.map((c) => [c.value, c.cpv, c.date]), [
    [48379.61, "30213100", "2026-10-18"],
    [528558.05, "30213100", "2026-10-18"],
  ]);
});

test("noticesFromFiles: a value changed in version 02 replaces version 01 (no double count)", () => {
  const got = noticesFromFiles(FILES("52000.00"), "2026-04-24", "2026-10-24");
  assert.deepEqual(got.get(B)!.contracts.map((c) => c.value), [52000, 528558.05]);
});

test("noticesFromFiles: contracts outside the window are dropped", () => {
  const got = noticesFromFiles(FILES(), "2026-10-19", "2026-10-24");
  assert.deepEqual([...got.keys()], [A]);
});

test("monthsInWindow: newest first, one more month than the window length", () => {
  assert.deepEqual(monthsInWindow("2026-10-24", 2), ["2026-10", "2026-09", "2026-08"]);
  assert.deepEqual(monthsInWindow("2026-01-05", 1), ["2026-01", "2025-12"]);
});

function varied(n: number): DeFiles {
  // n award notices, each with one laptop lot of a different value
  const ids = Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
  const head = (h: string, rows: string[]) => h + "\n" + rows.join("\n") + "\n";
  return {
    "notice.csv": head("noticeIdentifier,noticeVersion,procedureIdentifier,procedureLegalBasis,formType,noticeType,publicationDate", ids.map((id) => `${id},01,p,32014L0024,result,can-standard,2026-10-20T02:06:04Z`)),
    "tender.csv": head("noticeIdentifier,noticeVersion,tenderIdentifier,lotIdentifier,tenderValue,tenderValueCurrency", ids.map((id, i) => `${id},01,TEN-0001,LOT-0001,${100000 + i * 1000}.00,EUR`)),
    "contract.csv": head("noticeIdentifier,noticeVersion,contractIdentifier,winnerDecisionDate,contractConclusionDate,contractFrameworkAgreement", ids.map((id) => `${id},01,CON-0001,,2026-10-15T00:00:00+02:00,`)),
    "classification.csv": head("noticeIdentifier,noticeVersion,lotIdentifier,classificationType,mainClassificationCode,additionalClassificationCodes,options", ids.map((id) => `${id},01,LOT-0001,cpv,30213100,,`)),
    "procedureLotResult.csv": head("noticeIdentifier,noticeVersion,lotIdentifier,procedureLotResultNumber,winnerChosen", ids.map((id) => `${id},01,LOT-0001,0,selec-w`)),
  };
}

test("harvest: reads the monthly exports once, merges them, keeps aggregates with at least 5 contracts; a failing month is reported", async () => {
  const seen: string[] = [];
  const load = async (month: string) => {
    seen.push(month);
    if (month === "2026-08") throw new Error("boom");
    return zipOf(month === "2026-10" ? varied(6) : FILES());
  };
  const res = await deContractsHarvest(new Date("2026-10-24T03:17:00Z"), { load, months: 3 });
  assert.deepEqual(seen, ["2026-10", "2026-09", "2026-08", "2026-07"]);
  assert.equal(res.date, "2026-10-24");
  assert.equal(res.currency, "EUR");
  const laptops = res.rows.find((r) => r.item === "laptops" && r.area === "ALL");
  assert.ok(laptops && laptops.n >= 5, "laptops have at least 5 contracts");
  assert.match(res.note ?? "", /Not read this day: 2026-08/);
  assert.ok(res.rows.every((r) => r.n >= 5), "never a row from fewer than 5 contracts");
});

test("harvest: nothing readable is an error, not an empty copy", async () => {
  await assert.rejects(deContractsHarvest(new Date("2026-10-24T03:17:00Z"), { load: async () => { throw new Error("down"); }, months: 1 }), SourceError);
  await assert.rejects(deContractsHarvest(new Date("2026-10-24T03:17:00Z"), { load: async () => zipOf(FILES()), months: 0 }), /usable|No/i);
});

test("answer: from the stored copy, with period, 5-contract rule and unit-price warning", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "de-oev-"));
  process.env.PROOFPRICE_LIBRARY_DIR = dir;
  const res = await deContractsHarvest(new Date("2026-10-24T03:17:00Z"), { load: async () => zipOf(varied(8)), months: 1 });
  try {
  writeDaily(INFO.id, res);
  writeMeta(INFO.id, { source: INFO.id, currency: "EUR", unit: res.unit, first_date: res.date, last_date: res.date, days: 1, last_harvest_at: "x", last_rows: res.rows.length, last_ok_at: "x", last_error: null });
  const a = await deContracts({ what: "laptops" });
  assert.equal(a.status, "ok");
  assert.equal(a.sample_size, 8);
  assert.equal(a.price?.currency, "EUR");
  assert.deepEqual(a.period, { from: "2026-04-24", to: "2026-10-24" });
  assert.match(a.summary, /not unit prices/);
  const byCpv = await deContracts({ what: "x", cpv: "3021" });
  assert.equal(byCpv.sample_size, 8);
  await assert.rejects(deContracts({ what: "laptops", buyer_area: "Berlin" }), InputError);
  await assert.rejects(deContracts({ what: "zzzz unknown thing" }), InputError);
  await assert.rejects(deContracts({ what: "x", cpv: "302" }), InputError);
  const none = await deContracts({ what: "school meals" });
  assert.notEqual(none.status, "ok");
  } finally {
    delete process.env.PROOFPRICE_LIBRARY_DIR;
  }
});
