import { test } from "node:test";
import assert from "node:assert/strict";
import { SourceError } from "../../lib/http";
import { clearYearCache, cmsDataUrl, INPATIENT_DATASET, NATIONAL, parseDataYear, parseGeo } from "../us-cms-medicare/cms";
import { INP_KNEE_TITLES, INP_NATIONAL_470, INP_PNEUMONIA_TITLES, INP_TX_470, RESOURCES_INPATIENT } from "../us-cms-medicare/fixtures";
import { fetchInpatient, INFO, inpatientAnswer, medicareInpatient, parseInpatientRows, plainTitle, searchDrgTitles } from "./source";

// Fixtures: real responses from the CMS data API captured 2026-10-14 (see ../us-cms-medicare/fixtures.ts).
const TEXAS = parseGeo("Texas", (m) => new Error(m));
const both = () => parseInpatientRows([...INP_TX_470, ...INP_NATIONAL_470]);

test("us-cms-inpatient: licence, attribution and type", () => {
  assert.equal(INFO.id, "us-cms-inpatient");
  assert.equal(INFO.price_type, "official_statistic");
  assert.equal(INFO.publisher, "Centers for Medicare & Medicaid Services (CMS)");
  assert.match(INFO.licence, /U\.S\. Government Works/);
  assert.equal(INFO.licence_url, "https://www.usa.gov/government-works");
  assert.match(INFO.licence, /no separate licence is stated on data\.cms\.gov/);
  assert.match(INFO.licence, /not AMA CPT codes/);
  assert.match(INFO.attribution, /Medicare Inpatient Hospitals - by Geography and Service/);
  assert.match(INFO.limits, /surgeon's and other doctors' fees are billed separately and are not included/);
  assert.match(INFO.limits, /Medicare Advantage is not included/);
  assert.match(INFO.limits, /never shown as a price paid/);
});

test("us-cms-inpatient: the data URL filters by DRG and geography", () => {
  assert.equal(
    cmsDataUrl(INPATIENT_DATASET, [{ field: "DRG_Cd", values: ["470"] }, { field: "Rndrng_Prvdr_Geo_Desc", values: ["Texas"] }], 10),
    "https://data.cms.gov/data-api/v1/dataset/2941ab09-8cee-49d8-9703-f3c5b854e388/data?filter%5BDRG_Cd%5D=470&filter%5BRndrng_Prvdr_Geo_Desc%5D=Texas&size=10",
  );
  // the title search is one CONTAINS condition plus an equality filter, the shape the live API accepted
  assert.equal(
    cmsDataUrl(INPATIENT_DATASET, [{ field: "DRG_Desc", values: ["pneumonia"], op: "CONTAINS" }, { field: "Rndrng_Prvdr_Geo_Lvl", values: ["National"] }], 100),
    "https://data.cms.gov/data-api/v1/dataset/2941ab09-8cee-49d8-9703-f3c5b854e388/data?" +
      "filter%5Bg0%5D%5Bcondition%5D%5Bpath%5D=DRG_Desc&filter%5Bg0%5D%5Bcondition%5D%5Boperator%5D=CONTAINS&filter%5Bg0%5D%5Bcondition%5D%5Bvalue%5D=pneumonia" +
      "&filter%5BRndrng_Prvdr_Geo_Lvl%5D=National&size=100",
  );
  assert.equal(parseDataYear(RESOURCES_INPATIENT), 2024);
});

test("us-cms-inpatient: rows are read with numbers from strings", () => {
  const [t, n] = both();
  assert.equal(t.drg, "470");
  assert.equal(t.geo, "Texas");
  assert.equal(t.discharges, 4151);
  assert.equal(t.total, 15157.440135);
  assert.equal(t.medicare, 11957.88822);
  assert.equal(t.billed, 116220.34546);
  assert.equal(n.geo, "National");
  assert.equal(n.discharges, 64419);
  assert.deepEqual(parseInpatientRows([{ ...INP_TX_470[0], Avg_Tot_Pymt_Amt: "" }, { ...INP_TX_470[0], Tot_Dschrgs: "0" }, {}]), []);
  assert.equal(parseInpatientRows([{ ...INP_TX_470[0], DRG_Cd: "65" }])[0].drg, "065");
});

test("us-cms-inpatient: CMS's upper-case DRG titles become plain words, keeping MCC and CC", () => {
  assert.equal(plainTitle("MAJOR HIP AND KNEE JOINT REPLACEMENT OR REATTACHMENT OF LOWER EXTREMITY WITHOUT MCC"), "major hip and knee joint replacement or reattachment of lower extremity without MCC");
  assert.equal(plainTitle("SIMPLE PNEUMONIA AND PLEURISY WITHOUT CC/MCC"), "simple pneumonia and pleurisy without CC/MCC");
});

test("us-cms-inpatient: DRG 470 in Texas - the average total payment per stay, with discharges, year and national comparison", () => {
  const a = inpatientAnswer(both(), { drgs: ["470", "469"], geo: TEXAS, year: 2024, label: "knee replacement" });
  assert.equal(a.status, "ok");
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.price!.value, 15157.440135);
  assert.equal(a.price!.measure, "average");
  assert.equal(a.price!.currency, "USD");
  assert.match(a.price!.unit, /per hospital stay/);
  assert.equal(a.price!.median, null);
  assert.equal(a.price!.typical_low, null);
  assert.equal(a.sample_size, 4151);
  assert.deepEqual(a.period, { from: "2024-01-01", to: "2024-12-31" });
  assert.equal(a.statistic!.reference_period, "2024");
  assert.match(a.summary, /knee replacement \(MS-DRG 470: major hip and knee joint replacement/);
  assert.match(a.summary, /Texas/);
  assert.match(a.summary, /\$15,157 per Medicare stay in 2024/);
  assert.match(a.summary, /4,151 discharges/);
  assert.match(a.summary, /national average is \$17,364/);
  assert.match(a.summary, /Medicare itself paid \$11,958/);
  assert.match(a.summary, /not a private-insurance or cash price/);
  assert.match(a.summary, /excludes the surgeon's fee/);
  const x = a.extra as any;
  assert.equal(x.drg, "470");
  assert.equal(x.drg_title, "MAJOR HIP AND KNEE JOINT REPLACEMENT OR REATTACHMENT OF LOWER EXTREMITY WITHOUT MCC");
  assert.equal(x.average_total_payment, 15157.44);
  assert.equal(x.average_medicare_payment, 11957.89);
  assert.equal(x.discharges, 4151);
  assert.equal(x.average_billed_charge_not_a_price_paid, 116220.35);
  assert.deepEqual(x.national, { average_total_payment: 17364.02, discharges: 64419 });
  assert.equal(x.setting, "inpatient");
  assert.equal(x.data_year, 2024);
  assert.equal(x.other_severity_levels, undefined); // the fixture holds no Texas row for DRG 469
  assert.match((a.statistic!.note as string), /hip and knee replacements together/);
  assert.equal(a.source.id, "us-cms-inpatient");
});

test("us-cms-inpatient: the other severity levels are listed with their own payments", () => {
  const l469 = INP_KNEE_TITLES.find((r) => r.DRG_Cd === "469")!;
  const rows = parseInpatientRows([...INP_TX_470, ...INP_NATIONAL_470, { ...l469, Rndrng_Prvdr_Geo_Lvl: "State", Rndrng_Prvdr_Geo_Cd: "48", Rndrng_Prvdr_Geo_Desc: "Texas" }]);
  const a = inpatientAnswer(rows, { drgs: ["470", "469"], geo: TEXAS, year: 2024, label: "knee replacement" });
  const levels = (a.extra as any).other_severity_levels;
  assert.equal(levels.length, 1);
  assert.equal(levels[0].drg, "469");
  assert.equal(levels[0].average_total_payment, 29663.08);
  assert.match(levels[0].title, /with MCC or tota/);
  // when the headline DRG has no row, the next one is used and the note says so
  const second = inpatientAnswer(rows.filter((r) => r.drg !== "470"), { drgs: ["470", "469"], geo: TEXAS, year: 2024, label: null });
  assert.equal(second.price!.value, 29663.081193);
  assert.match(second.statistic!.note!, /no average for MS-DRG 470 in Texas, so the next group \(469\) is shown/);
  assert.match(second.summary, /^For MS-DRG 469 \(/);
});

test("us-cms-inpatient: a national request, a missing state, too few discharges, unknown year and old data", () => {
  const nat = inpatientAnswer(both(), { drgs: ["470"], geo: NATIONAL, year: 2024 });
  assert.equal(nat.price!.value, 17364.016424);
  assert.equal((nat.extra as any).national, null);
  assert.equal((nat.query as any).state, null);
  const none = inpatientAnswer(parseInpatientRows(INP_NATIONAL_470), { drgs: ["470"], geo: TEXAS, year: 2024 });
  assert.equal(none.status, "no_matches");
  assert.equal(none.price, null);
  assert.match(none.summary, /no average for MS-DRG 470 in Texas for 2024/);
  assert.match(none.summary, /national figure exists/);
  const thin = inpatientAnswer(parseInpatientRows([{ ...INP_TX_470[0], Tot_Dschrgs: "3" }]), { drgs: ["470"], geo: TEXAS, year: 2024 });
  assert.equal(thin.status, "insufficient_data");
  assert.match(thin.summary, /at least 5 are needed/);
  const noYear = inpatientAnswer(both(), { drgs: ["470"], geo: TEXAS, year: null });
  assert.equal(noYear.statistic!.reference_period, "latest data year (not stated by CMS)");
  const old = inpatientAnswer(both(), { drgs: ["470"], geo: TEXAS, year: 2000 });
  assert.match(old.statistic!.note!, /may be out of date/);
});

test("us-cms-inpatient: searching DRG titles keeps rows that hold every word, most discharges first", async () => {
  const urls: string[] = [];
  const fetcher = async (url: string) => (urls.push(url), INP_KNEE_TITLES);
  const hits = await searchDrgTitles(["knee", "replacement"], { fetcher });
  assert.equal(urls.length, 1);
  assert.ok(decodeURIComponent(urls[0]).includes("[operator]=CONTAINS&filter[g0][condition][value]=replacement")); // the longest word is searched
  assert.deepEqual(hits.map((h) => h.drg), ["470", "467", "468", "469", "466"]);
  const pneu = await searchDrgTitles(["pneumonia"], { fetcher: async () => INP_PNEUMONIA_TITLES });
  assert.deepEqual(pneu.map((h) => h.drg), ["193", "194", "195"]);
  assert.deepEqual(await searchDrgTitles(["zzzzzz"], { fetcher: async () => INP_PNEUMONIA_TITLES }), []);
  assert.deepEqual(await searchDrgTitles(["12", "a"], { fetcher: async () => { throw new Error("must not be called"); } }), []);
});

test("us-cms-inpatient: fetching asks CMS once for the rows and once for the data year", async () => {
  clearYearCache();
  const urls: string[] = [];
  const fetcher = async (url: string) => {
    urls.push(url);
    return url.includes("dataset-resources") ? RESOURCES_INPATIENT : [...INP_TX_470, ...INP_NATIONAL_470];
  };
  const a = await medicareInpatient({ drgs: ["470", "469"], geo: TEXAS, label: "knee replacement" }, { fetcher });
  assert.equal(urls.length, 2);
  const data = urls.find((u) => u.includes("/data?"))!;
  assert.ok(data.startsWith("https://data.cms.gov/data-api/v1/dataset/2941ab09-8cee-49d8-9703-f3c5b854e388/data?"));
  assert.ok(data.includes("=470") && data.includes("=469") && data.includes("=Texas") && data.includes("=National"));
  assert.equal(a.status, "ok");
  assert.equal((a.extra as any).data_year, 2024);
  await assert.rejects(fetchInpatient(["470"], TEXAS, { fetcher: async () => ({ message: "Server error" }) }), (e: any) => e instanceof SourceError);
});
