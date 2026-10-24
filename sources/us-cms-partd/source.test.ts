import { test } from "node:test";
import assert from "node:assert/strict";
import { INFO, isMedicareSpendRequest, medicineName, parseRows, partdMedicine, partdUrl, pickHeadline, usable, yearsIn } from "./source";

// Real values from data.cms.gov (probe pdcon1, 2026-10-23: CONTAINS "atorvastatin", Mftr_Name = Overall), cut to the fields we read
// (2023 and 2024 only; the live rows also carry 2020-2022 and the Chg_/CAGR_ columns). All fields are strings, "" = not published.
const rec = (brand: string, generic: string, o: { mftr?: string; claims: string; per: string; spend?: string; units?: string; benes?: string; perClaim?: string; flag?: string; claims23?: string }) => ({
  Brnd_Name: brand, Gnrc_Name: generic, Tot_Mftr: o.mftr ?? "1", Mftr_Name: "Overall",
  Tot_Spndng_2023: "", Tot_Dsg_Unts_2023: "", Tot_Clms_2023: o.claims23 ?? "", Tot_Benes_2023: "", Avg_Spnd_Per_Dsg_Unt_Wghtd_2023: "", Avg_Spnd_Per_Clm_2023: "", Avg_Spnd_Per_Bene_2023: "", Outlier_Flag_2023: "",
  Tot_Spndng_2024: o.spend ?? "", Tot_Dsg_Unts_2024: o.units ?? "", Tot_Clms_2024: o.claims, Tot_Benes_2024: o.benes ?? "",
  Avg_Spnd_Per_Dsg_Unt_Wghtd_2024: o.per, Avg_Spnd_Per_Clm_2024: o.perClaim ?? "", Avg_Spnd_Per_Bene_2024: "", Outlier_Flag_2024: o.flag ?? "0",
});
const ATORVASTATIN = [
  rec("Amlodipine-Atorvastatin", "Amlodipine/Atorvastatin", { mftr: "5", claims: "104801", per: "2.3600487108", spend: "17900828.28", units: "7640637", benes: "26791", perClaim: "170.80780031" }),
  rec("Atorvaliq", "Atorvastatin Calcium", { claims: "2620", per: "1.2198464921", spend: "932042.01", units: "764065", benes: "783", perClaim: "355.74122519" }),
  rec("Atorvastatin Calcium", "Atorvastatin Calcium", { mftr: "30", claims: "73349032", per: "0.1451833479" }),
  rec("Caduet", "Amlodipine/Atorvastatin", { claims: "248", per: "21.921334929" }),
  rec("Lipitor", "Atorvastatin Calcium", { mftr: "2", claims: "23269", per: "15.709199891", spend: "26798187.1", units: "1702327.5", benes: "6920", perClaim: "1151.6690489" }),
];

const fake = (...bodies: unknown[]) => {
  const log: string[] = [];
  let i = 0;
  const f = async (url: string) => { log.push(url); return bodies[Math.min(i++, bodies.length - 1)]; };
  return { f, log };
};

test("routing: only basis=medicare_spend goes to Part D", () => {
  assert.equal(isMedicareSpendRequest({ country: "US", medicine: "atorvastatin", basis: "medicare_spend" }), true);
  assert.equal(isMedicareSpendRequest({ basis: "Medicare Part D" }), true);
  assert.equal(isMedicareSpendRequest({ country: "US", medicine: "atorvastatin" }), false);
  assert.equal(isMedicareSpendRequest({ basis: "pharmacy" }), false);
});

test("medicine names: first word, strength and salt words dropped", () => {
  assert.equal(medicineName("Atorvastatin 20mg"), "atorvastatin");
  assert.equal(medicineName("  Lipitor "), "lipitor");
  assert.equal(medicineName("20 mg atorvastatin"), "atorvastatin");
  assert.equal(medicineName(undefined), "");
});

test("the URL asks for Overall rows whose generic name contains the word", () => {
  const u = partdUrl("atorvastatin", "generic");
  assert.match(u, /^https:\/\/data\.cms\.gov\/data-api\/v1\/dataset\/7e0b4365-fd63-4a29-8f5e-e0ac9f66a81b\/data\?/);
  assert.match(u, /Gnrc_Name/);
  assert.match(u, /CONTAINS/);
  assert.match(u, /filter%5BMftr_Name%5D=Overall/);
  assert.match(partdUrl("lipitor", "brand"), /Brnd_Name/);
});

test("parseRows reads the newest year with a figure and the string fields", () => {
  assert.deepEqual(yearsIn(ATORVASTATIN[0]), [2024, 2023]);
  const rows = parseRows(ATORVASTATIN);
  assert.equal(rows.length, 5);
  const lip = rows.find((r) => r.brand === "Lipitor")!;
  assert.equal(lip.year, 2024);
  assert.equal(lip.perUnit, 15.709199891);
  assert.equal(lip.claims, 23269);
  assert.equal(lip.benes, 6920);
  assert.equal(parseRows("not an array").length, 0);
  // a row with no 2024 figure falls back to 2023
  const old = parseRows([{ ...rec("Old", "Old Drug", { claims: "", per: "" }), Tot_Clms_2023: "50", Avg_Spnd_Per_Dsg_Unt_Wghtd_2023: "2.5" }]);
  assert.equal(old[0].year, 2023);
});

test("headline: a brand name gives that brand; a generic name gives the generic sold under its own name", () => {
  const rows = parseRows(ATORVASTATIN);
  assert.equal(pickHeadline(rows, "lipitor")!.head.brand, "Lipitor");
  const g = pickHeadline(rows, "atorvastatin")!;
  assert.equal(g.why, "generic_match");
  assert.equal(g.head.brand, "Atorvastatin Calcium");
});

test("rows under 11 claims or flagged as outliers are not usable", () => {
  const rows = parseRows([rec("Tiny", "Tiny Drug", { claims: "10", per: "3" }), rec("Odd", "Odd Drug", { claims: "500", per: "3", flag: "1" }), rec("Fine", "Fine Drug", { claims: "11", per: "3" })]);
  assert.deepEqual(rows.filter(usable).map((r) => r.brand), ["Fine"]);
  assert.equal(pickHeadline(rows.slice(0, 2), "tiny"), null);
});

test("atorvastatin with basis=medicare_spend: the generic's 2024 average per tablet, with the claims behind it", async () => {
  const { f, log } = fake(ATORVASTATIN);
  const a = await partdMedicine({ medicine: "atorvastatin 20mg", baseUrl: "https://proofprice.com" }, f);
  assert.equal(a.status, "ok");
  assert.equal(a.price!.value, 0.145183);
  assert.equal(a.price!.measure, "average");
  assert.equal(a.price!.currency, "USD");
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.sample_size, 73349032);
  assert.equal(a.statistic!.reference_period, "calendar year 2024");
  assert.deepEqual(a.period, { from: "2024-01-01", to: "2024-12-31" });
  assert.equal(a.source.id, "us-cms-partd");
  assert.match(a.summary, /before manufacturer rebates/);
  assert.equal(log.length, 1);
  const extra = a.extra as any;
  assert.equal(extra.headline_drug.brand, "Atorvastatin Calcium");
  assert.ok(extra.other_matches.some((m: any) => m.brand === "Lipitor" && m.average_spending_per_dosage_unit_usd === 15.709));
});

test("a brand name falls back to the brand query when no generic name contains it", async () => {
  const { f, log } = fake([], ATORVASTATIN.filter((r) => r.Brnd_Name === "Lipitor"));
  const a = await partdMedicine({ medicine: "Lipitor" }, f);
  assert.equal(a.status, "ok");
  assert.equal(a.price!.value, 15.7092);
  assert.equal(a.sample_size, 23269);
  assert.equal(log.length, 2);
  assert.match(log[1], /Brnd_Name/);
});

test("unknown drug: no_matches with a hint; missing name: input error", async () => {
  const { f } = fake([], []);
  const a = await partdMedicine({ medicine: "zzzz" }, f);
  assert.equal(a.status, "no_matches");
  assert.equal(a.price, null);
  assert.match(String((a.extra as any).hint), /No Part D drug name/);
  await assert.rejects(partdMedicine({ medicine: "" }, f), /medicine is required/);
});

test("licence and attribution are filled", () => {
  assert.match(INFO.licence_url, /usa\.gov/);
  assert.match(INFO.attribution, /not affiliated with or endorsed by CMS/);
});

// Audit fix (Quality Auditor 24 Oct 2026): the shared `basis` parameter is declared here, so its text must name every basis that a US
// medicines source serves (medicaid and mfp were missing, so agents could not discover them from the tool schema).
test("basis parameter text lists every US medicines basis", async () => {
  const manifest = (await import("./index")).default as any;
  const text = String(manifest.extraParams.basis.description ?? "");
  for (const b of ["medicare_spend", "part_b_asp", "medicaid", "mfp"]) assert.ok(text.includes(`'${b}'`), `basis text misses '${b}'`);
});
