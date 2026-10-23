import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import {
  aspMedicine, findZipUrl, isPartBAspRequest, matchRows, medicineQuery, parsePaymentLimits, quarterOf, resetCache, unzipPaymentLimitCsv,
} from "./source";

// Fixture 2026-10-23: the page excerpt is copied from the live CMS page (probe lc-cms-asp-page). The CSV is built to the layout CMS
// describes (title lines, then a header row named "HCPCS Code" ... "Payment Limit"); the header is read by NAME so column order does not matter.
// The probe could not display this CSV (it shows the first csv of the zip only), so the first preview run is the live check.
const PAGE = `<p><a href="/files/zip/october-2026-medicare-part-b-payment-limit-files-final.zip" data-entity-type="media">October 2026 Medicare Part B Payment Limit Files</a> – 09/17/2026 - Final file</p><p><a href="/files/zip/october-2026-ndc-hcpcs-crosswalk-final.zip">October 2026 NDC-HCPCS Crosswalk</a></p><p><a href="/files/zip/july-2026-medicare-part-b-payment-limit-files.zip">July 2026</a></p>`;
const head = `October 2026 ASP Payment Allowance Limits for Medicare Part B Drugs,,,,,,\n,,,,,,\n"HCPCS Code","Short Description","HCPCS Code Dosage","Payment Limit","Vaccine AWP%","Vaccine Limit","Notes"\n`;
const body = [
  `J9271,"Injection, pembrolizumab, 1 mg",1 MG,$51.402,,,`,
  `J9035,"Injection, bevacizumab, 10 mg",10 MG,"$64.170",,,`,
  `J0178,"Inj aflibercept 1 mg",1 MG,"$1,001.50",,,`,
  `J1745,"Infliximab not biosimilar 10mg",10 MG,$27.21,,,`,
  `Q5121,"Inj infliximab-axxq, biosim 10mg",10 MG,$21.94,,,`,
  `J9999,"Carrier priced drug",1 MG,,,,`,
  `J3490,"Unclassified drugs",,N/A,,,`,
].join("\n");
const filler = Array.from({ length: 120 }, (_, i) => `J${String(1000 + i)},"Filler drug ${i}",1 MG,$${(i + 1) / 10},,,`).join("\n");
const CSV = head + body + "\n" + filler + "\n";

function zipOf(files: Record<string, string>): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const raw = Buffer.from(content, "utf8");
    const comp = deflateRawSync(raw);
    const nm = Buffer.from(name);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nm.length, 26);
    parts.push(lh, nm, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(offset, 42);
    central.push(ch, nm);
    offset += 30 + nm.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const eo = Buffer.alloc(22);
  eo.writeUInt32LE(0x06054b50, 0); eo.writeUInt16LE(Object.keys(files).length, 8); eo.writeUInt16LE(Object.keys(files).length, 10); eo.writeUInt32LE(cd.length, 12); eo.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, eo]);
}
const ZIP = zipOf({
  "section 508 version of October 2026 Drugs Not Payable Under Part B 091426.csv": "Drugs Not Payable Under Part B\nHCPCS Code,Long Description,Manufacturer\nJ0209,x,y\n",
  "section 508 version of October 2026 Medicare Part B Payment Limit File 091626.csv": CSV,
});
const fetcher = async (url: string) => (url.endsWith(".zip") ? ZIP : Buffer.from(PAGE));

beforeEach(() => resetCache());

describe("us-cms-asp parsing", () => {
  it("finds the newest payment-limit zip on the page and its quarter", () => {
    const z = findZipUrl(PAGE)!;
    assert.equal(z, "https://www.cms.gov/files/zip/october-2026-medicare-part-b-payment-limit-files-final.zip");
    assert.deepEqual(quarterOf(z), { label: "October 2026", from: "2026-10-01", to: "2026-12-31", ref: "2026-Q4" });
  });
  it("reads the Payment Limit csv, not the Drugs Not Payable one", () => {
    assert.match(unzipPaymentLimitCsv(ZIP), /Payment Limit/);
  });
  it("parses by header name, drops carrier-priced and N/A rows", () => {
    const rows = parsePaymentLimits(CSV);
    assert.deepEqual(rows.find((r) => r.code === "J9271"), { code: "J9271", description: "Injection, pembrolizumab, 1 mg", dosage: "1 MG", limit: 51.402 });
    assert.equal(rows.find((r) => r.code === "J0178")?.limit, 1001.5);
    assert.equal(rows.find((r) => r.code === "J9999"), undefined);
    assert.equal(rows.find((r) => r.code === "J3490"), undefined);
  });
  it("fails loudly when the header is gone", () => {
    assert.throws(() => parsePaymentLimits("a,b\n1,2\n"), /format may have changed/);
  });
  it("matches by HCPCS code or by descriptor words", () => {
    const rows = parsePaymentLimits(CSV);
    assert.deepEqual(matchRows(rows, medicineQuery("J9271")).map((r) => r.code), ["J9271"]);
    assert.deepEqual(matchRows(rows, medicineQuery("Bevacizumab 10 mg")).map((r) => r.code), ["J9035"]);
    assert.deepEqual(matchRows(rows, medicineQuery("infliximab")).map((r) => r.code).sort(), ["J1745", "Q5121"]);
  });
  it("recognises basis=part_b_asp only", () => {
    assert.equal(isPartBAspRequest({ basis: "part_b_asp" }), true);
    assert.equal(isPartBAspRequest({ basis: "Part B ASP" }), true);
    assert.equal(isPartBAspRequest({ basis: "medicare_spend" }), false);
    assert.equal(isPartBAspRequest({}), false);
  });
});

describe("us-cms-asp answers", () => {
  it("answers pembrolizumab with a posted payment limit and no sample size", async () => {
    const a = await aspMedicine({ medicine: "pembrolizumab" }, fetcher);
    assert.equal(a.status, "ok");
    assert.equal(a.price!.value, 51.402);
    assert.equal(a.price!.currency, "USD");
    assert.equal(a.price_type, "reimbursement_price");
    assert.equal(a.sample_size ?? null, null);
    assert.deepEqual(a.period, { from: "2026-10-01", to: "2026-12-31" });
    assert.match(a.summary, /payment limit/);
    assert.match(a.summary, /not a price paid/);
  });
  it("lists the other codes of a drug and keeps the headline the lowest code", async () => {
    const a = await aspMedicine({ medicine: "infliximab" }, fetcher);
    assert.equal((a.extra as any).headline_code, "J1745");
    assert.equal((a.extra as any).other_matches[0].hcpcs, "Q5121");
  });
  it("says so when nothing matches, and rejects an empty medicine", async () => {
    const a = await aspMedicine({ medicine: "keytruda" }, fetcher);
    assert.equal(a.status, "no_matches");
    await assert.rejects(aspMedicine({ medicine: "" }, fetcher), /medicine is required/);
  });
});

describe("us-cms-asp routing (declared serves() change in us-nadac)", () => {
  it("sends basis=part_b_asp here, Part D spending to us-cms-partd and everything else to us-nadac", async () => {
    const { findSource } = await import("../../lib/registry");
    assert.equal(findSource("medicines", "US", { medicine: "pembrolizumab", basis: "part_b_asp" })?.info.id, "us-cms-asp");
    assert.equal(findSource("medicines", "US", { medicine: "atorvastatin", basis: "medicare_spend" })?.info.id, "us-cms-partd");
    assert.equal(findSource("medicines", "US", { medicine: "atorvastatin" })?.info.id, "us-nadac");
  });
});

describe("us-cms-asp routing next to us-medicaid-sdud", () => {
  it("keeps basis=medicaid with us-medicaid-sdud", async () => {
    const { findSource } = await import("../../lib/registry");
    assert.equal(findSource("medicines", "US", { medicine: "atorvastatin", basis: "medicaid" })?.info.id, "us-medicaid-sdud");
  });
});
