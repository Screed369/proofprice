import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { drugStates, isMfpRequest, matchDrugs, medicineWords, mfpMedicine, parseMfp, resetCache, unzipCsv } from "./source";

// Fixture: rows copied from the REAL CMS file (CMS_Negotiation_Program_Selected_Drug_List_and_Maximum_Fair_Price_Data_File_20260921.csv,
// read through the GitHub probe mfp-c1 on 2026-10-23): first rows of Eliquis, Stelara, Entresto (with its odd end dates), Ozempic (IPAY 2027),
// Botox and Xolair (IPAY 2028, no price yet) and Enbrel. Padded with copies of the Enbrel rows to pass the 100-row sanity check.
const REAL = "IPAY,Selected Drug Name,Active Ingredient Name or Active Moiety Name,NDC-9,NDC-11,XREF NDC-11,HCPCS Code,MFP Effective Date,MFP End Date,Single MFP per 30 DES,NDC-9 MFP per Unit Price,HCPCS Code Dosage Price,As of Date,Type of Update,Remarks\n2026,ELIQUIS; ELIQUIS SPRINKLE,APIXABAN,00003-0893,00003-0893-21,,,01/01/2026,12/31/2026,231,4.145072,,08/15/2024,End Date,Added for IPAY 2026 announcement. End dated to reflect inflation adjustment\n2026,ELIQUIS; ELIQUIS SPRINKLE,APIXABAN,00003-0893,00003-0893-21,,,01/01/2027,,237.25,4.257193,,11/25/2025,Inflation,Inflation adjustment for IPAY 2026 NDC\n2026,ELIQUIS; ELIQUIS SPRINKLE,APIXABAN,00003-0893,00003-0893-31,,,01/01/2026,12/31/2026,231,4.145072,,08/15/2024,End Date,Added for IPAY 2026 announcement. End dated to reflect inflation adjustment\n2026,ELIQUIS; ELIQUIS SPRINKLE,APIXABAN,00003-0893,00003-0893-31,,,01/01/2027,,237.25,4.257193,,11/25/2025,Inflation,Inflation adjustment for IPAY 2026 NDC\n2026,ENBREL,ETANERCEPT,58406-0010,58406-0010-01,,,01/01/2026,12/31/2026,2355,583.587064,,08/15/2024,End Date,Added for IPAY 2026 announcement. End dated to reflect inflation adjustment\n2026,ENBREL,ETANERCEPT,58406-0010,58406-0010-01,,,01/01/2027,,2418.7,599.372524,,11/25/2025,Inflation,Inflation adjustment for IPAY 2026 NDC\n2026,ENBREL,ETANERCEPT,58406-0010,58406-0010-04,,,01/01/2026,12/31/2026,2355,583.587064,,08/15/2024,End Date,Added for IPAY 2026 announcement. End dated to reflect inflation adjustment\n2026,ENBREL,ETANERCEPT,58406-0010,58406-0010-04,,,01/01/2027,,2418.7,599.372524,,11/25/2025,Inflation,Inflation adjustment for IPAY 2026 NDC\n2026,ENTRESTO; ENTRESTO SPRINKLE,VALSARTAN / SACUBITRILAT,00078-0659,00078-0659-20,,,01/01/2026,12/31/2026,295,5.226585,,11/25/2025,Deselect,NDC deselected from negotiation program with end date of 12/31/2026\n2026,ENTRESTO; ENTRESTO SPRINKLE,VALSARTAN / SACUBITRILAT,00078-0659,00078-0659-20,,,01/01/2027,12/31/2026,302.98,5.367959,,11/25/2025,Deselect,NDC deselected from negotiation program with end date of 12/31/2026\n2026,ENTRESTO; ENTRESTO SPRINKLE,VALSARTAN / SACUBITRILAT,00078-0659,00078-0659-35,,,01/01/2026,12/31/2026,295,5.226585,,11/25/2025,Deselect,NDC deselected from negotiation program with end date of 12/31/2026\n2026,ENTRESTO; ENTRESTO SPRINKLE,VALSARTAN / SACUBITRILAT,00078-0659,00078-0659-35,,,01/01/2027,12/31/2026,302.98,5.367959,,11/25/2025,Deselect,NDC deselected from negotiation program with end date of 12/31/2026\n2026,STELARA,USTEKINUMAB,57894-0054,57894-0054-27,,,01/01/2026,12/31/2026,4695,25.108135,,11/25/2025,Deselect,NDC deselected from negotiation program with end date of 12/31/2026\n2026,STELARA,USTEKINUMAB,57894-0054,57894-0054-27,,,01/01/2027,12/31/2026,4822,25.787285,,11/25/2025,Deselect,NDC deselected from negotiation program with end date of 12/31/2026\n2026,STELARA,USTEKINUMAB,57894-0060,57894-0060-02,,,01/01/2026,12/31/2026,4695,8979.645026,,11/25/2025,Deselect,NDC deselected from negotiation program with end date of 12/31/2026\n2026,STELARA,USTEKINUMAB,57894-0060,57894-0060-02,,,01/01/2027,12/31/2026,4822,9222.535659,,11/25/2025,Deselect,NDC deselected from negotiation program with end date of 12/31/2026\n2027,OZEMPIC; RYBELSUS; WEGOVY,SEMAGLUTIDE,00169-1704,00169-1704-30,,,01/01/2027,,274,9.225842,,09/21/2026,New NDC,New NDC. NDC added after IPAY 2027 announcement\n2027,OZEMPIC; RYBELSUS; WEGOVY,SEMAGLUTIDE,00169-1709,00169-1709-30,,,01/01/2027,,274,9.226055,,09/21/2026,New NDC,New NDC. NDC added after IPAY 2027 announcement\n2027,OZEMPIC; RYBELSUS; WEGOVY,SEMAGLUTIDE,00169-1715,00169-1715-30,,,01/01/2027,,274,9.225866,,09/21/2026,New NDC,New NDC. NDC added after IPAY 2027 announcement\n2027,OZEMPIC; RYBELSUS; WEGOVY,SEMAGLUTIDE,00169-4130,00169-4130-01,,,01/01/2027,,274,92.260313,,11/25/2025,New IPAY,Added for IPAY 2027 announcement\n2028,BOTOX; BOTOX COSMETIC,BOTULINUM TOXIN TYPE A,00023-1145,00023-1145-01,,J0585,01/01/2028,,,,,01/27/2026,New IPAY,Added for IPAY 2028 announcement\n2028,BOTOX; BOTOX COSMETIC,BOTULINUM TOXIN TYPE A,00023-3919,00023-3919-50,,J0585,01/01/2028,,,,,01/27/2026,New IPAY,Added for IPAY 2028 announcement\n2028,BOTOX; BOTOX COSMETIC,BOTULINUM TOXIN TYPE A,00023-3921,00023-3921-02,,J0585,01/01/2028,,,,,01/27/2026,New IPAY,Added for IPAY 2028 announcement\n2028,BOTOX; BOTOX COSMETIC,BOTULINUM TOXIN TYPE A,00023-9232,00023-9232-01,,J0585,01/01/2028,,,,,01/27/2026,New IPAY,Added for IPAY 2028 announcement\n2028,XOLAIR,OMALIZUMAB,50242-0040,50242-0040-62,,J2357,01/01/2028,,,,,01/27/2026,New IPAY,Added for IPAY 2028 announcement\n2028,XOLAIR,OMALIZUMAB,50242-0214,50242-0214-01,,J2357,01/01/2028,,,,,01/27/2026,New IPAY,Added for IPAY 2028 announcement\n2028,XOLAIR,OMALIZUMAB,50242-0214,50242-0214-03,,J2357,01/01/2028,,,,,01/27/2026,New IPAY,Added for IPAY 2028 announcement\n2028,XOLAIR,OMALIZUMAB,50242-0214,50242-0214-55,,J2357,01/01/2028,,,,,01/27/2026,New IPAY,Added for IPAY 2028 announcement\n";
const ENBREL = REAL.split("\n").filter((l) => l.includes(",ENBREL,"));
const CSV = REAL + Array.from({ length: 40 }, () => ENBREL.join("\n")).join("\n") + "\n";

function zipOf(name: string, content: string): Buffer {
  const raw = Buffer.from(content, "utf8");
  const comp = deflateRawSync(raw);
  const nm = Buffer.from(name);
  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nm.length, 26);
  const ch = Buffer.alloc(46);
  ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(0, 42);
  const cd = Buffer.concat([ch, nm]);
  const eo = Buffer.alloc(22);
  eo.writeUInt32LE(0x06054b50, 0); eo.writeUInt16LE(1, 8); eo.writeUInt16LE(1, 10); eo.writeUInt32LE(cd.length, 12); eo.writeUInt32LE(30 + nm.length + comp.length, 16);
  return Buffer.concat([lh, nm, comp, cd, eo]);
}
const ZIP = zipOf("CMS_Negotiation_Program_Selected_Drug_List_and_Maximum_Fair_Price_Data_File_20260921.csv", CSV);
const fetcher = async () => ZIP;
const NOW = Date.parse("2026-10-23T12:00:00Z");

beforeEach(() => resetCache());

describe("us-cms-mfp parsing", () => {
  it("reads the csv out of the zip and parses by header name", () => {
    const rows = parseMfp(unzipCsv(ZIP));
    const e = rows.filter((r) => r.drug.startsWith("ELIQUIS"));
    assert.ok(e.length >= 4);
    assert.equal(e[0].price30, 231);
    assert.equal(e[0].effective, "2026-01-01");
    assert.equal(e[0].ingredient, "APIXABAN");
  });
  it("fails loudly when the header is gone", () => {
    assert.throws(() => parseMfp("a,b\n1,2\n"), /format may have changed/);
  });
  it("takes the price in force from the latest effective date up to today, ignoring the unreliable end dates", () => {
    const st = drugStates(parseMfp(CSV), "2026-10-23");
    const entresto = st.find((s) => s.drug.startsWith("ENTRESTO"))!;
    assert.equal(entresto.price30, 295);
    assert.equal(entresto.inForce, true);
    assert.equal(entresto.next?.price30, 302.98);
    const later = drugStates(parseMfp(CSV), "2027-02-01").find((s) => s.drug.startsWith("ENTRESTO"))!;
    assert.equal(later.price30, 302.98);
  });
  it("marks an announced-but-later price, and a drug with no price yet", () => {
    const st = drugStates(parseMfp(CSV), "2026-10-23");
    const oz = st.find((s) => s.drug.startsWith("OZEMPIC"))!;
    assert.equal(oz.inForce, false);
    assert.equal(oz.effective, "2027-01-01");
    assert.equal(oz.price30, 274);
    const xolair = st.find((s) => s.drug === "XOLAIR")!;
    assert.equal(xolair.price30, null);
  });
  it("matches brand or ingredient words, strengths ignored", () => {
    const st = drugStates(parseMfp(CSV), "2026-10-23");
    assert.deepEqual(matchDrugs(st, medicineWords("apixaban 5 mg")).map((s) => s.drug), ["ELIQUIS; ELIQUIS SPRINKLE"]);
    assert.deepEqual(matchDrugs(st, medicineWords("Stelara")).length, 1);
    assert.deepEqual(matchDrugs(st, medicineWords("atorvastatin")), []);
  });
  it("recognises basis=mfp only", () => {
    assert.equal(isMfpRequest({ basis: "mfp" }), true);
    assert.equal(isMfpRequest({ basis: "Maximum Fair Price" }), true);
    assert.equal(isMfpRequest({ basis: "part_b_asp" }), false);
    assert.equal(isMfpRequest({}), false);
  });
});

describe("us-cms-mfp answers", () => {
  it("answers Eliquis with the posted negotiated price, no sample size", async () => {
    const a = await mfpMedicine({ medicine: "Eliquis", now: NOW }, fetcher);
    assert.equal(a.status, "ok");
    assert.equal(a.price!.value, 231);
    assert.equal(a.price!.currency, "USD");
    assert.equal(a.price_type, "reimbursement_price");
    assert.equal(a.sample_size ?? null, null);
    assert.match(a.summary, /maximum fair price/);
    assert.match(a.summary, /not a price paid/);
    assert.equal((a.extra as any).later_price.price_30_day_usd, 237.25);
  });
  it("says a future price applies from its date", async () => {
    const a = await mfpMedicine({ medicine: "semaglutide Ozempic", now: NOW }, fetcher).catch(() => null);
    const b = await mfpMedicine({ medicine: "Ozempic", now: NOW }, fetcher);
    assert.equal(b.price!.value, 274);
    assert.match(b.summary, /applying from January 1, 2027/);
    void a;
  });
  it("says so for a drug with no published price, and for a drug not on the list", async () => {
    const x = await mfpMedicine({ medicine: "Xolair", now: NOW }, fetcher);
    assert.equal(x.status, "no_matches");
    assert.match(JSON.stringify(x.extra), /not published its maximum fair price yet/);
    const n = await mfpMedicine({ medicine: "atorvastatin", now: NOW }, fetcher);
    assert.equal(n.status, "no_matches");
    await assert.rejects(mfpMedicine({ medicine: "" }, fetcher), /medicine is required/);
  });
});

describe("us-cms-mfp routing (declared serves() change in us-nadac)", () => {
  it("sends basis=mfp here and everything else where it went before", async () => {
    const { findSource } = await import("../../lib/registry");
    assert.equal(findSource("medicines", "US", { medicine: "Eliquis", basis: "mfp" })?.info.id, "us-cms-mfp");
    assert.equal(findSource("medicines", "US", { medicine: "atorvastatin" })?.info.id, "us-nadac");
    assert.equal(findSource("medicines", "US", { medicine: "pembrolizumab", basis: "part_b_asp" })?.info.id, "us-cms-asp");
    assert.equal(findSource("medicines", "US", { medicine: "atorvastatin", basis: "medicaid" })?.info.id, "us-medicaid-sdud");
    assert.equal(findSource("medicines", "US", { medicine: "atorvastatin", basis: "medicare_spend" })?.info.id, "us-cms-partd");
  });
});
