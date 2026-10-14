import { test } from "node:test";
import assert from "node:assert/strict";
import { SourceError } from "../../lib/http";
import { clearYearCache, cmsDataUrl, NATIONAL, parseDataYear, parseGeo, PHYSICIAN_DATASET } from "../us-cms-medicare/cms";
import { PHYS_NATIONAL_99213, PHYS_TX_27447, PHYS_TX_99213, RESOURCES_PHYSICIAN } from "../us-cms-medicare/fixtures";
import { chooseSetting, fetchPhysician, INFO, labelFor, medicarePhysician, parsePhysicianRows, physicianAnswer } from "./source";

// Fixtures: real responses from the CMS data API captured 2026-10-14 (see ../us-cms-medicare/fixtures.ts).
const TEXAS = parseGeo("TX", (m) => new Error(m));
const tx = () => parsePhysicianRows(PHYS_TX_99213);
const both = () => [...parsePhysicianRows(PHYS_TX_99213), ...parsePhysicianRows(PHYS_NATIONAL_99213)];

// What the AMA owns: CMS's descriptions of numeric (CPT) codes. They must never appear in an answer.
const AMA_TEXT = ["Established patient office or other outpatient visit", "Replacement of knee joint, both sides of knee"];

test("us-cms-physician: licence, attribution and type", () => {
  assert.equal(INFO.id, "us-cms-physician");
  assert.equal(INFO.price_type, "official_statistic");
  assert.equal(INFO.publisher, "Centers for Medicare & Medicaid Services (CMS)");
  assert.match(INFO.licence, /U\.S\. Government Works/);
  assert.equal(INFO.licence_url, "https://www.usa.gov/government-works");
  assert.ok(INFO.licence.includes("CPT codes, descriptions and other data only are copyright 1995 - 2025 American Medical Association."));
  assert.ok(INFO.licence.includes("CPT is a registered trademark of the American Medical Association (AMA)."));
  assert.match(INFO.licence, /no separate licence is stated on data\.cms\.gov/);
  assert.match(INFO.attribution, /Centers for Medicare & Medicaid Services/);
  assert.match(INFO.attribution, /registered trademark of the American Medical Association/);
  assert.match(INFO.limits, /Medicare Advantage is not included/);
  assert.match(INFO.limits, /doctor's professional fee only/);
  assert.match(INFO.limits, /never shown as a price paid/);
});

test("us-cms-physician: the data URL is a plain GET with encoded filters", () => {
  assert.equal(
    cmsDataUrl(PHYSICIAN_DATASET, [{ field: "HCPCS_Cd", values: ["99213"] }, { field: "Rndrng_Prvdr_Geo_Desc", values: ["Texas", "National"] }], 8),
    "https://data.cms.gov/data-api/v1/dataset/6fea9d79-0129-4e4c-b1b8-23cd86a4f435/data?filter%5BHCPCS_Cd%5D=99213" +
      "&filter%5Bg1%5D%5Bcondition%5D%5Bpath%5D=Rndrng_Prvdr_Geo_Desc&filter%5Bg1%5D%5Bcondition%5D%5Boperator%5D=IN" +
      "&filter%5Bg1%5D%5Bcondition%5D%5Bvalue%5D%5B%5D=Texas&filter%5Bg1%5D%5Bcondition%5D%5Bvalue%5D%5B%5D=National&size=8",
  );
});

test("us-cms-physician: rows are read with numbers from strings", () => {
  const rows = tx();
  assert.equal(rows.length, 2);
  const [f, o] = rows;
  assert.deepEqual([f.place, o.place], ["F", "O"]);
  assert.equal(f.services, 237389);
  assert.equal(f.allowed, 60.407738943);
  assert.equal(o.services, 4080342);
  assert.equal(o.allowed, 83.754834965);
  assert.equal(o.payment, 57.851644859);
  assert.equal(o.billed, 185.41948879);
  assert.equal(o.beneficiaries, 1284409);
  assert.equal(o.providers, 43385);
  assert.equal(o.geo, "Texas");
  assert.equal(o.code, "99213");
  // rows without an allowed amount, services or a known place are dropped
  const bad = [{ ...PHYS_TX_99213[1], Avg_Mdcr_Alowd_Amt: "" }, { ...PHYS_TX_99213[1], Tot_Srvcs: "0" }, { ...PHYS_TX_99213[1], Place_Of_Srvc: "X" }, {}];
  assert.deepEqual(parsePhysicianRows(bad), []);
});

test("us-cms-physician: the data year comes from the dataset resources", () => {
  assert.equal(parseDataYear(RESOURCES_PHYSICIAN), 2024);
  assert.equal(parseDataYear({ data: [{ name: "Data Dictionary" }] }), null);
  assert.equal(parseDataYear(null), null);
});

test("us-cms-physician: setting choice - asked, usual, or the one with more services", () => {
  const rows = tx();
  assert.deepEqual(chooseSetting(rows, TEXAS, null, false), { place: "O", reason: "most-services" });
  assert.deepEqual(chooseSetting(rows, TEXAS, "facility", true), { place: "F", reason: "requested" });
  assert.deepEqual(chooseSetting(rows, TEXAS, "facility", false), { place: "F", reason: "usual" });
  assert.deepEqual(chooseSetting(rows.slice(1), TEXAS, "facility", false), { place: "O", reason: "most-services" });
  assert.equal(chooseSetting(rows.slice(1), TEXAS, "facility", true), null);
  assert.equal(chooseSetting(rows, parseGeo("CA", (m) => new Error(m)), null, false), null);
});

test("us-cms-physician: 99213 in Texas - the Medicare-allowed average, with services, year and national comparison", () => {
  const a = physicianAnswer(both(), { codes: ["99213"], geo: TEXAS, setting: null, explicit: false, year: 2024 });
  assert.equal(a.status, "ok");
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.price!.value, 83.754834965);
  assert.equal(a.price!.measure, "average");
  assert.equal(a.price!.currency, "USD");
  assert.equal(a.price!.unit, "per service (Medicare-allowed amount)");
  assert.equal(a.price!.median, null);
  assert.equal(a.price!.typical_low, null);
  assert.equal(a.price!.typical_high, null);
  assert.equal(a.sample_size, 4080342);
  assert.deepEqual(a.period, { from: "2024-01-01", to: "2024-12-31" });
  assert.equal(a.statistic!.reference_period, "2024");
  assert.equal(a.confidence, "high");
  assert.match(a.summary, /\$83\.75/);
  assert.match(a.summary, /Texas/);
  assert.match(a.summary, /2024/);
  assert.match(a.summary, /4,080,342 services/);
  assert.match(a.summary, /Medicare allowed/);
  assert.match(a.summary, /not a private-insurance or cash price/);
  assert.match(a.summary, /national average is \$85\.37/);
  assert.match(a.summary, /Official average published by Centers for Medicare & Medicaid Services \(CMS\) for 2024/);
  const x = a.extra as any;
  assert.equal(x.code, "99213");
  assert.equal(x.setting, "office");
  assert.equal(x.average_medicare_allowed_amount, 83.75);
  assert.equal(x.average_medicare_payment, 57.85);
  assert.equal(x.average_billed_charge_not_a_price_paid, 185.42);
  assert.deepEqual(x.national, { average_medicare_allowed_amount: 85.37, services: 64778139 });
  assert.equal(x.other_setting.setting, "facility");
  assert.equal(x.other_setting.what_it_covers, "the doctor's professional fee only");
  assert.equal(x.data_year, 2024);
  assert.equal(x.geography.name, "Texas");
  assert.equal(a.source.id, "us-cms-physician");
  assert.equal(a.source.licence_url, "https://www.usa.gov/government-works");
  // the billed amount is never called a price paid
  assert.ok(!/billed[^.]*paid/i.test(a.summary.replace("not_a_price_paid", "")));
});

test("us-cms-physician: the AMA's code descriptions are never passed on for CPT codes", () => {
  const a = physicianAnswer(both(), { codes: ["99213"], geo: TEXAS, setting: null, explicit: false, year: 2024 });
  const text = JSON.stringify(a);
  for (const t of AMA_TEXT) assert.ok(!text.includes(t), t);
  assert.ok(!("cms_description" in (a.extra as any)));
  assert.equal((a.extra as any).code_system, "CPT (copyright American Medical Association)");
  assert.equal((a.extra as any).service, "established-patient office visit, level 3 (low complexity)");
  const k = physicianAnswer(parsePhysicianRows(PHYS_TX_27447), { codes: ["27447"], geo: TEXAS, setting: "facility", explicit: true, year: 2024 });
  assert.ok(!JSON.stringify(k).includes("Replacement of knee joint"));
  // a HCPCS level II (letter) code keeps CMS's own description
  const g = parsePhysicianRows([{ ...PHYS_TX_99213[1], HCPCS_Cd: "G0121", HCPCS_Desc: "Colorectal cancer screening; colonoscopy on individual not meeting criteria for high risk" }]);
  const ga = physicianAnswer(g, { codes: ["G0121"], geo: TEXAS, setting: null, explicit: false, year: 2024 });
  assert.equal((ga.extra as any).code_system, "HCPCS level II");
  assert.match((ga.extra as any).cms_description, /Colorectal cancer screening/);
});

test("us-cms-physician: a facility figure says it is the doctor's fee only", () => {
  const a = physicianAnswer(both(), { codes: ["99213"], geo: TEXAS, setting: "facility", explicit: true, year: 2024 });
  assert.equal(a.status, "ok");
  assert.equal(a.price!.value, 60.407738943);
  assert.equal(a.sample_size, 237389);
  assert.match(a.summary, /facility setting/);
  assert.match(a.summary, /the doctor's fee only/);
  assert.match(a.statistic!.note!, /professional fee only/);
  assert.equal((a.extra as any).setting, "facility");
});

test("us-cms-physician: a national request has no national comparison and no state in the query", () => {
  const a = physicianAnswer(parsePhysicianRows(PHYS_NATIONAL_99213), { codes: ["99213"], geo: NATIONAL, setting: null, explicit: false, year: 2024 });
  assert.equal(a.price!.value, 85.366781205);
  assert.match(a.summary, /in the United States/);
  assert.equal((a.extra as any).national, null);
  assert.equal((a.query as any).state, null);
});

test("us-cms-physician: related codes of a group are listed, and the next code is used when the first has no data", () => {
  const rows = parsePhysicianRows([PHYS_TX_99213[1], { ...PHYS_TX_99213[1], HCPCS_Cd: "99214", Avg_Mdcr_Alowd_Amt: "123.4", Tot_Srvcs: "1000" }]);
  const a = physicianAnswer(rows, { codes: ["99213", "99214"], geo: TEXAS, setting: "office", explicit: false, year: 2024 });
  assert.equal(a.price!.value, 83.754834965);
  assert.deepEqual((a.extra as any).related_codes, [{ code: "99214", service: labelFor("99214"), average_medicare_allowed_amount: 123.4, services: 1000 }]);
  const second = physicianAnswer(rows.slice(1), { codes: ["99213", "99214"], geo: TEXAS, setting: "office", explicit: false, year: 2024 });
  assert.equal(second.price!.value, 123.4);
  assert.match(second.statistic!.note!, /no average for code 99213 in Texas, so the next code in the group \(99214\) is shown/);
});

test("us-cms-physician: nothing for the state, too few services, unknown year and old data are all said plainly", () => {
  const none = physicianAnswer(parsePhysicianRows(PHYS_NATIONAL_99213), { codes: ["99213"], geo: TEXAS, setting: null, explicit: false, year: 2024 });
  assert.equal(none.status, "no_matches");
  assert.equal(none.price, null);
  assert.match(none.summary, /has no average for .* \(code 99213\) in Texas for 2024/);
  assert.match(none.summary, /10 or fewer beneficiaries/);
  assert.match(none.summary, /national figure exists/);
  const absent = physicianAnswer([], { codes: ["12345"], geo: NATIONAL, setting: "office", explicit: true, year: 2024 });
  assert.equal(absent.status, "no_matches");
  assert.match(absent.summary, /service with CPT code 12345 \(code 12345\) in an office setting in the United States/);
  const thin = physicianAnswer(parsePhysicianRows([{ ...PHYS_TX_99213[1], Tot_Srvcs: "3" }]), { codes: ["99213"], geo: TEXAS, setting: null, explicit: false, year: 2024 });
  assert.equal(thin.status, "insufficient_data");
  assert.equal(thin.price, null);
  assert.match(thin.summary, /at least 5 are needed/);
  const noYear = physicianAnswer(tx(), { codes: ["99213"], geo: TEXAS, setting: null, explicit: false, year: null });
  assert.equal(noYear.status, "ok");
  assert.equal(noYear.statistic!.reference_period, "latest data year (not stated by CMS)");
  assert.deepEqual(noYear.period, { from: null, to: null });
  const old = physicianAnswer(tx(), { codes: ["99213"], geo: TEXAS, setting: null, explicit: false, year: 2000 });
  assert.match(old.statistic!.note!, /newest data year CMS serves is 2000, so these amounts may be out of date/);
  assert.ok(!/out of date/.test(physicianAnswer(tx(), { codes: ["99213"], geo: TEXAS, setting: null, explicit: false, year: new Date().getUTCFullYear() - 1 }).statistic!.note!));
});

test("us-cms-physician: fetching asks CMS once for the rows and once for the data year", async () => {
  clearYearCache();
  const urls: string[] = [];
  const fetcher = async (url: string) => {
    urls.push(url);
    return url.includes("dataset-resources") ? RESOURCES_PHYSICIAN : [...PHYS_TX_99213, ...PHYS_NATIONAL_99213];
  };
  const a = await medicarePhysician({ codes: ["99213"], geo: TEXAS, setting: null, explicit: false }, { fetcher });
  assert.equal(urls.length, 2);
  const data = urls.find((u) => u.includes("/data?"))!;
  assert.ok(data.startsWith("https://data.cms.gov/data-api/v1/dataset/6fea9d79-0129-4e4c-b1b8-23cd86a4f435/data?"));
  assert.ok(data.includes("filter%5BHCPCS_Cd%5D=99213"));
  assert.ok(data.includes("=Texas") && data.includes("=National"));
  assert.ok(urls.some((u) => u === "https://data.cms.gov/data-api/v1/dataset-resources/6fea9d79-0129-4e4c-b1b8-23cd86a4f435"));
  assert.equal(a.status, "ok");
  assert.equal((a.extra as any).data_year, 2024);
});

test("us-cms-physician: a failing year lookup does not fail the answer; a failing data call does", async () => {
  clearYearCache();
  const okRows = async (url: string) => {
    if (url.includes("dataset-resources")) throw new SourceError("down");
    return PHYS_TX_99213;
  };
  const a = await medicarePhysician({ codes: ["99213"], geo: TEXAS, setting: null, explicit: false }, { fetcher: okRows });
  assert.equal(a.status, "ok");
  assert.equal(a.statistic!.reference_period, "latest data year (not stated by CMS)");
  await assert.rejects(fetchPhysician(["99213"], TEXAS, { fetcher: async () => ({ message: "Server error" }) }), (e: any) => e instanceof SourceError && /Unexpected response from the CMS data API/.test(e.message));
});
