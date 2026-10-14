import { test } from "node:test";
import assert from "node:assert/strict";
import { InputError } from "../../lib/http";
import { categoryById, exampleUrls, paramSchemas, SOURCE_PLUGINS, toolDescription } from "../../lib/registry";
import { clearYearCache, NATIONAL, parseGeo, STATE_NAMES } from "./cms";
import {
  INP_KNEE_TITLES, INP_NATIONAL_470, INP_PNEUMONIA_TITLES, INP_TX_470, PHYS_NATIONAL_99213, PHYS_TX_27447, PHYS_TX_99213, RESOURCES_INPATIENT, RESOURCES_PHYSICIAN,
} from "./fixtures";
import { INFO, medicalPrices, normaliseSetting, resolveRequest } from "./source";
import { INFO as PHYSICIAN_INFO } from "../us-cms-physician/source";
import { INFO as INPATIENT_INFO } from "../us-cms-inpatient/source";
import { CODE_LABELS, isCpt, matchEntry, resolveService, SERVICES, tokens } from "./services";

// Fixtures: real responses from the CMS data API captured 2026-10-14 (see fixtures.ts).

// Every code and DRG in the plain-words table was found in the live CMS files on 2026-10-14 (verify probes). A code CMS drops shows up when this list is re-checked;
// a new code added to the table without checking it against CMS fails the test below.
const VERIFIED_HCPCS = new Set(["11102", "20610", "27130", "27447", "29881", "36415", "43235", "43239", "45378", "45380", "45385", "62323", "64721", "66984", "70450", "70551", "71045", "71046", "71250", "72141", "72148", "73221", "73721", "74176", "74177", "76700", "76856", "77066", "77067", "77080", "78452", "80053", "80061", "81001", "82306", "83036", "84443", "85025", "90834", "90837", "92004", "92014", "92134", "92507", "92557", "93000", "93015", "93306", "93458", "95810", "97110", "97112", "97140", "97161", "97162", "97163", "97165", "97530", "98940", "98941", "98942", "99202", "99203", "99204", "99205", "99212", "99213", "99214", "99215", "99283", "99284", "99285", "G0008", "G0105", "G0121", "G0402", "G0438", "G0439"]);
const VERIFIED_DRG = new Set(["064", "065", "066", "189", "190", "191", "192", "193", "194", "195", "233", "234", "235", "236", "242", "243", "244", "266", "267", "280", "281", "282", "291", "292", "293", "308", "309", "310", "329", "330", "331", "377", "378", "379", "417", "418", "419", "459", "460", "466", "467", "468", "469", "470", "480", "481", "482", "602", "603", "637", "638", "639", "682", "683", "684", "689", "690", "871", "872"]);

const AMA_TEXT = ["Established patient office or other outpatient visit", "Replacement of knee joint, both sides of knee"];

/** A fake CMS: answers by dataset and filter, so each test can see which calls were made. */
function fakeCms(opts: { titles?: Record<string, string>[] } = {}) {
  const urls: string[] = [];
  const fetcher = async (url: string) => {
    urls.push(url);
    const u = decodeURIComponent(url);
    if (u.includes("dataset-resources/6fea9d79")) return RESOURCES_PHYSICIAN;
    if (u.includes("dataset-resources/2941ab09")) return RESOURCES_INPATIENT;
    if (u.includes("/dataset/6fea9d79")) {
      if (u.includes("=27447")) return PHYS_TX_27447;
      const natl = !u.includes("=Texas");
      return natl ? PHYS_NATIONAL_99213 : [...PHYS_TX_99213, ...PHYS_NATIONAL_99213];
    }
    if (u.includes("/dataset/2941ab09")) {
      if (u.includes("CONTAINS")) return opts.titles ?? [];
      if (u.includes("=Texas")) return [...INP_TX_470, ...INP_NATIONAL_470];
      return u.includes("=193") ? INP_PNEUMONIA_TITLES : INP_NATIONAL_470;
    }
    throw new Error(`unexpected URL ${url}`);
  };
  return { urls, fetcher };
}

test("us-cms-medicare: the registered source says plainly that these are Medicare amounts and carries both licences", () => {
  assert.equal(INFO.id, "us-cms-medicare");
  assert.equal(INFO.price_type, "official_statistic");
  assert.equal(INFO.publisher, "Centers for Medicare & Medicaid Services (CMS)");
  assert.match(INFO.licence, /U\.S\. Government Works/);
  assert.ok(INFO.licence.includes("CPT codes, descriptions and other data only are copyright 1995 - 2025 American Medical Association."));
  assert.ok(INFO.licence.includes("CPT is a registered trademark of the American Medical Association (AMA)."));
  assert.match(INFO.licence, /MS-DRG codes and titles/);
  assert.match(INFO.limits, /Medicare Advantage is not included/);
  assert.match(INFO.limits, /usually lower than private-insurance and cash prices/);
  assert.match(INFO.limits, /never shown as a price paid/);
  assert.equal(INFO.licence_url, PHYSICIAN_INFO.licence_url);
  assert.equal(PHYSICIAN_INFO.id, "us-cms-physician");
  assert.equal(INPATIENT_INFO.id, "us-cms-inpatient");
});

test("us-cms-medicare: registered for medical / US with the tool, path and examples the brief names", () => {
  const plugin = SOURCE_PLUGINS.find((s) => s.info.id === "us-cms-medicare")!;
  assert.equal(plugin.category, "medical");
  assert.deepEqual(plugin.countries, ["US"]);
  assert.equal(plugin.status, "live");
  assert.deepEqual(plugin.examples[0].params, { country: "US", service: "99213" });
  assert.deepEqual(plugin.examples[1].params, { country: "US", service: "knee replacement", state: "TX" });
  const cat = categoryById("medical")!;
  assert.equal(cat.tool, "pricepaid_medical_prices");
  assert.equal(cat.restPath, "medical");
  assert.equal(cat.cacheSeconds, 86400);
  assert.equal(cat.title, "Doctor and hospital prices paid");
  assert.deepEqual(Object.keys(paramSchemas(cat)).sort(), ["service", "setting", "state"]);
  assert.deepEqual(cat.required, ["service"]);
  const smoke = exampleUrls().filter((e) => e.source === "us-cms-medicare" && e.smoke);
  assert.deepEqual(smoke.map((e) => e.path), ["/api/v1/medical?country=US&service=99213", "/api/v1/medical?country=US&service=knee+replacement&state=TX"]);
  const d = toolDescription(cat);
  assert.match(d, /^Use this when/);
  assert.match(d, /Do not use/);
  assert.match(d, /NOT private-insurance negotiated prices or cash prices/);
  assert.match(d, /Medicare/);
});

test("us-cms-medicare: the plain-words table is consistent and every code was checked against CMS", () => {
  const ids = new Set<string>();
  for (const e of SERVICES) {
    assert.ok(!ids.has(e.id), `duplicate id ${e.id}`);
    ids.add(e.id);
    assert.ok(e.label.length > 3 && e.words.length > 0, e.id);
    assert.ok(e.codes?.length || e.drgs?.length, `${e.id} has neither codes nor DRGs`);
    if (e.setting === "inpatient") assert.ok(e.drgs?.length, `${e.id}: an inpatient service needs DRGs`);
    else assert.ok(e.codes?.length, `${e.id}: an office/facility service needs codes`);
    for (const c of e.codes ?? []) {
      assert.match(c, /^([0-9]{4}[0-9A-Z]|[A-Z][0-9]{4})$/, `${e.id}: ${c}`);
      assert.ok(VERIFIED_HCPCS.has(c), `${e.id}: code ${c} was not checked against the CMS physician file`);
      assert.ok(CODE_LABELS[c], `${e.id}: code ${c} has no plain label`);
    }
    for (const d of e.drgs ?? []) {
      assert.match(d, /^\d{3}$/, `${e.id}: ${d}`);
      assert.ok(VERIFIED_DRG.has(d), `${e.id}: DRG ${d} was not checked against the CMS inpatient file`);
    }
    for (const w of e.words) assert.ok(tokens(w).length > 0, `${e.id}: phrase "${w}" has no usable words`);
  }
  for (const [code, label] of Object.entries(CODE_LABELS)) {
    assert.ok(label.length > 5, code);
    assert.ok(VERIFIED_HCPCS.has(code), `label for unchecked code ${code}`);
  }
});

test("us-cms-medicare: every phrase finds a service, and each service's first phrase finds that service", () => {
  for (const e of SERVICES) {
    assert.equal(matchEntry(e.words[0])?.id, e.id, `"${e.words[0]}" should find ${e.id}`);
    for (const w of e.words) assert.ok(matchEntry(w), `"${w}" finds nothing`);
  }
});

test("us-cms-medicare: plain words, billing codes and DRGs are read the way a person would write them", () => {
  const knee = resolveService("Knee Replacement!");
  assert.deepEqual([knee.how, knee.setting, knee.drgs, knee.codes, knee.label], ["words", "inpatient", ["470", "469"], ["27447"], "knee replacement"]);
  assert.equal(resolveService("total knee replacement").entry?.id, "knee-replacement");
  assert.equal(resolveService("hip replacement").entry?.id, "hip-replacement");
  assert.equal(resolveService("office visit").codes[0], "99213");
  assert.equal(resolveService("new patient visit").codes[0], "99203");
  assert.equal(resolveService("MRI of the lower back").entry?.id, "mri-lower-back");
  assert.equal(resolveService("mri lower back").codes[0], "72148");
  assert.equal(resolveService("chest x-ray").entry?.id, "xray-chest");
  assert.equal(resolveService("chest xrays").entry?.id, "xray-chest");
  assert.equal(resolveService("CT scan of the abdomen").entry?.id, "ct-abdomen");
  assert.equal(resolveService("colonoscopy").entry?.id, "colonoscopy");
  assert.equal(resolveService("screening colonoscopy").entry?.id, "screening-colonoscopy");
  assert.equal(resolveService("physical therapy").entry?.id, "physical-therapy");
  assert.equal(resolveService("physical therapy evaluation").entry?.id, "pt-evaluation");
  assert.equal(resolveService("How much does a flu shot cost?").entry?.id, "flu-shot");
  const pneu = resolveService("pneumonia");
  assert.deepEqual([pneu.setting, pneu.drgs, pneu.codes], ["inpatient", ["193", "194", "195"], []]);

  const code = resolveService("99213");
  assert.deepEqual([code.how, code.codes, code.setting, code.label], ["code", ["99213"], "office", "established-patient office visit, level 3 (low complexity)"]);
  assert.equal(resolveService("CPT 99213").codes[0], "99213");
  assert.equal(resolveService("hcpcs g0121").codes[0], "G0121");
  assert.equal(resolveService("G0121").setting, "facility");
  assert.equal(resolveService("99214").setting, null); // not the entry's headline code: decided from the data
  assert.equal(resolveService("12345").label, "service with CPT code 12345");
  assert.equal(resolveService("12345").entry, null);
  assert.equal(resolveService("A4206").label, "service with HCPCS code A4206");
  assert.equal(isCpt("99213"), true);
  assert.equal(isCpt("G0121"), false);

  const drg = resolveService("DRG 470");
  assert.deepEqual([drg.how, drg.drgs, drg.setting, drg.entry, drg.label], ["drg", ["470"], "inpatient", null, "MS-DRG 470"]);
  assert.equal(resolveService("ms-drg 065").drgs[0], "065");
  assert.equal(resolveService("DRG 65").drgs[0], "065");
  assert.equal(resolveService("193").drgs[0], "193");
  assert.equal(resolveService("DRG 193").entry?.id, "pneumonia");
  assert.match(resolveService("DRG 193").label, /^pneumonia hospital stay \(MS-DRG 193\)$/);
});

test("us-cms-medicare: a request we cannot read gets the help text, not a guess", () => {
  for (const bad of ["", "   ", "something nobody sells", "ab"]) {
    assert.throws(() => resolveService(bad), (e: any) => e instanceof InputError && /plain words/.test(e.message) && /MS-DRG/.test(e.message), bad);
  }
  assert.throws(() => resolveService(undefined), (e: any) => e instanceof InputError && /service is required/.test(e.message));
});

test("us-cms-medicare: settings accept plain aliases and refuse the rest", () => {
  assert.equal(normaliseSetting(undefined), null);
  assert.equal(normaliseSetting("  "), null);
  for (const s of ["office", "Office", "non-facility", "nonfacility", "doctor's office", "clinic"]) assert.equal(normaliseSetting(s), "office", s);
  for (const s of ["facility", "outpatient", "surgery center", "Surgery Centre", "ASC", "hospital outpatient"]) assert.equal(normaliseSetting(s), "facility", s);
  for (const s of ["inpatient", "in-patient", "hospital stay", "admission"]) assert.equal(normaliseSetting(s), "inpatient", s);
  assert.throws(() => normaliseSetting("home"), (e: any) => e instanceof InputError && /office .* facility .* inpatient/.test(e.message));
});

test("us-cms-medicare: states and territories are read by code or name", () => {
  const fail = (m: string) => new InputError(m);
  assert.equal(parseGeo(undefined, fail), NATIONAL);
  assert.equal(parseGeo("", fail), NATIONAL);
  assert.equal(parseGeo("USA", fail), NATIONAL);
  assert.deepEqual(parseGeo("tx", fail), { level: "State", desc: "Texas", code: "TX", label: "Texas" });
  assert.equal(parseGeo("New York", fail).desc, "New York");
  assert.equal(parseGeo("d.c.", fail).code, "DC");
  assert.equal(parseGeo("district of columbia", fail).desc, "District of Columbia");
  assert.equal(parseGeo("PR", fail).desc, "Puerto Rico");
  assert.equal(Object.keys(STATE_NAMES).length, 55);
  assert.throws(() => parseGeo("Atlantis", fail), (e: any) => e instanceof InputError && /two-letter code or name/.test(e.message) && /Atlantis/.test(e.message));
});

test("us-cms-medicare: service=99213 nationally - the office average from the physician file", async () => {
  clearYearCache();
  const f = fakeCms();
  const a = await medicalPrices({ service: "99213" }, { fetcher: f.fetcher });
  assert.equal(a.status, "ok");
  assert.equal(a.price!.value, 85.366781205);
  assert.equal(a.sample_size, 64778139);
  assert.equal(a.source.id, "us-cms-physician");
  assert.match(a.summary, /established-patient office visit, level 3 \(low complexity\) \(code 99213\) in the United States/);
  assert.match(a.summary, /2024/);
  assert.ok(f.urls.some((u) => u.includes("/dataset/6fea9d79")));
  assert.ok(!f.urls.some((u) => u.includes("2941ab09/data")));
  for (const t of AMA_TEXT) assert.ok(!JSON.stringify(a).includes(t), t);
});

test("us-cms-medicare: knee replacement in Texas - the hospital stay, with the surgeon's fee shown separately", async () => {
  clearYearCache();
  const f = fakeCms();
  const a = await medicalPrices({ service: "knee replacement", state: "TX" }, { fetcher: f.fetcher });
  assert.equal(a.status, "ok");
  assert.equal(a.source.id, "us-cms-inpatient");
  assert.equal(a.price!.value, 15157.440135);
  assert.equal(a.sample_size, 4151);
  assert.match(a.summary, /knee replacement \(MS-DRG 470/);
  assert.match(a.summary, /\$15,157 per Medicare stay in 2024/);
  const x = a.extra as any;
  assert.equal(x.setting, "inpatient");
  assert.deepEqual(x.surgeons_fee_billed_separately, { code: "27447", setting: "facility", average_medicare_allowed_amount: x.surgeons_fee_billed_separately.average_medicare_allowed_amount, services: 35139 });
  assert.ok(x.surgeons_fee_billed_separately.average_medicare_allowed_amount > 100);
  assert.match(a.statistic!.note!, /The surgeon's fee is billed separately: for code 27447 Medicare allowed an average of \$/);
  assert.ok(f.urls.some((u) => u.includes("/dataset/6fea9d79") && u.includes("27447")));
  assert.ok(!JSON.stringify(a).includes("Replacement of knee joint"));
});

test("us-cms-medicare: the surgeon's fee is best effort - if that call fails the stay still answers", async () => {
  clearYearCache();
  const f = fakeCms();
  const fetcher = async (url: string) => {
    if (decodeURIComponent(url).includes("/dataset/6fea9d79")) throw new Error("down");
    return f.fetcher(url);
  };
  const a = await medicalPrices({ service: "knee replacement", state: "Texas" }, { fetcher });
  assert.equal(a.status, "ok");
  assert.equal((a.extra as any).surgeons_fee_billed_separately, undefined);
});

test("us-cms-medicare: setting=facility on a joint replacement gives the doctor's fee instead", async () => {
  clearYearCache();
  const f = fakeCms();
  const a = await medicalPrices({ service: "knee replacement", state: "TX", setting: "facility" }, { fetcher: f.fetcher });
  assert.equal(a.status, "ok");
  assert.equal(a.source.id, "us-cms-physician");
  assert.equal((a.extra as any).code, "27447");
  assert.equal((a.extra as any).setting, "facility");
  assert.match(a.statistic!.note!, /hospital's own payment for the stay is available with setting=inpatient/);
});

test("us-cms-medicare: setting and service must make sense together", async () => {
  const f = fakeCms();
  await assert.rejects(medicalPrices({ service: "99213", setting: "inpatient" }, { fetcher: f.fetcher }), (e: any) => e instanceof InputError && /setting=inpatient needs a hospital stay/.test(e.message));
  await assert.rejects(medicalPrices({ service: "pneumonia", setting: "office" }, { fetcher: f.fetcher }), (e: any) => e instanceof InputError && /setting=office needs a doctor's service/.test(e.message));
  await assert.rejects(medicalPrices({ service: "99213", setting: "home" }, { fetcher: f.fetcher }), (e: any) => e instanceof InputError && /setting must be/.test(e.message));
  await assert.rejects(medicalPrices({ service: "99213", state: "Atlantis" }, { fetcher: f.fetcher }), (e: any) => e instanceof InputError && /state must be/.test(e.message));
  await assert.rejects(medicalPrices({}, { fetcher: f.fetcher }), (e: any) => e instanceof InputError && /service is required/.test(e.message));
  assert.equal(f.urls.length, 0);
});

test("us-cms-medicare: a hospital-stay code is answered from the inpatient file", async () => {
  clearYearCache();
  const f = fakeCms();
  const a = await medicalPrices({ service: "DRG 470" }, { fetcher: f.fetcher });
  assert.equal(a.status, "ok");
  assert.equal(a.price!.value, 17364.016424);
  assert.match(a.summary, /^For MS-DRG 470 \(major hip and knee joint replacement/);
  assert.equal((a.extra as any).surgeons_fee_billed_separately, undefined);
});

test("us-cms-medicare: words the table does not know are looked up in the DRG titles, with a note to check the match", async () => {
  clearYearCache();
  const f = fakeCms({ titles: INP_PNEUMONIA_TITLES });
  const r = await resolveRequest("pleurisy", { fetcher: f.fetcher });
  assert.deepEqual([r.resolved.drgs, r.resolved.setting, r.searched], [["193", "194", "195"], "inpatient", "pleurisy"]);
  clearYearCache();
  const a = await medicalPrices({ service: "pleurisy" }, { fetcher: fakeCms({ titles: INP_PNEUMONIA_TITLES }).fetcher });
  assert.equal(a.status, "ok");
  assert.equal(a.price!.value, 12049.620107);
  assert.equal((a.extra as any).other_severity_levels.length, 2);
  assert.match(a.statistic!.note!, /Matched by searching the MS-DRG hospital-stay titles for 'pleurisy'/);
  // nothing found: the original help text, not a guess
  await assert.rejects(medicalPrices({ service: "zzzz qqqq" }, { fetcher: fakeCms({ titles: [] }).fetcher }), (e: any) => e instanceof InputError && /not a service we can match yet/.test(e.message));
  // a mistyped code is not searched for
  const g = fakeCms({ titles: INP_KNEE_TITLES });
  await assert.rejects(medicalPrices({ service: "99213x" }, { fetcher: g.fetcher }), InputError);
  assert.equal(g.urls.length, 0);
});

test("us-cms-medicare: every answer says these are Medicare amounts, not private or cash prices, and no billed amount is a price paid", async () => {
  clearYearCache();
  for (const req of [{ service: "99213", state: "TX" }, { service: "knee replacement", state: "TX" }]) {
    const a = await medicalPrices(req, { fetcher: fakeCms().fetcher });
    assert.match(a.summary, /Medicare/);
    assert.match(a.summary, /not a private-insurance or cash price/);
    assert.match(a.statistic!.note!, /not what private insurance pays or the cash price/);
    assert.ok(Object.keys(a.extra as any).includes("average_billed_charge_not_a_price_paid"));
    assert.equal(a.price_type, "official_statistic");
    assert.equal(a.price!.measure, "average");
    assert.ok(a.sample_size! >= 5);
  }
});
