import { test } from "node:test";
import assert from "node:assert/strict";
import { drugUrl, groupRows, INFO, isMedicaidRequest, latestQuarterUrl, medicaidMedicine, medicinePrefix, parseRows, pickHeadline } from "./source";

// Real rows from data.medicaid.gov (probe mcd-4, 2026-10-23: 2025 dataset, state XX, quarter 4, product_name LIKE %ATORVAST%),
// cut to the fields we read. All values are strings. Two extra products are added by hand to test grouping and suppression.
const r = (ndc: string, product: string, units: string, rx: string, amount: string, sup = "false") => ({ ndc, product_name: product, units_reimbursed: units, number_of_prescriptions: rx, total_amount_reimbursed: amount, suppression_used: sup });
const ATORVASTAT = [
  r("00093505610", "ATORVASTAT", "148243.000", "3848", "43869.92"),
  r("00093505610", "ATORVASTAT", "456965.500", "8516", "77917.86"),
  r("00093505698", "ATORVASTAT", "967534.000", "15799", "185458.35"),
  r("00093505698", "ATORVASTAT", "1276237.000", "20853", "188286.89"),
  r("00093505705", "ATORVASTAT", "169920.000", "4586", "60013.62"),
  r("00093505705", "ATORVASTAT", "586334.000", "10209", "163424.96"),
  r("99999000001", "AMLODIPINE-ATORVASTAT", "1000", "20", "1500"),
  r("99999000002", "ATORVASTAT", "", "", "", "true"),
  r("00093505610", "Atorvastat", "1000", "10", "200"),
];
const latest = { results: [{ quarter: "4", year: "2025" }], count: 320609 };
const fake = (...bodies: unknown[]) => {
  const log: string[] = [];
  let i = 0;
  const f = async (url: string) => { log.push(url); return bodies[Math.min(i++, bodies.length - 1)]; };
  return { f, log };
};

test("routing: basis=medicaid only", async () => {
  assert.equal(isMedicaidRequest({ basis: "medicaid" }), true);
  assert.equal(isMedicaidRequest({ basis: "Medicaid" }), true);
  assert.equal(isMedicaidRequest({ medicine: "x" }), false);
  assert.equal(isMedicaidRequest({ basis: "medicare_spend" }), false);
  const { default: nadac } = await import("../us-nadac/index");
  const { default: partd } = await import("../us-cms-partd/index");
  const { default: mcd } = await import("./index");
  const plain = { country: "US", medicine: "atorvastatin" };
  const m = { ...plain, basis: "medicaid" };
  const s = { ...plain, basis: "medicare_spend" };
  assert.deepEqual([nadac.serves!(plain), partd.serves!(plain), mcd.serves!(plain)], [true, false, false]);
  assert.deepEqual([nadac.serves!(m), partd.serves!(m), mcd.serves!(m)], [false, false, true]);
  assert.deepEqual([nadac.serves!(s), partd.serves!(s), mcd.serves!(s)], [false, true, false]);
});

test("prefix: CMS keeps 10 characters", () => {
  assert.equal(medicinePrefix("Atorvastatin 20mg"), "ATORVASTAT");
  assert.equal(medicinePrefix("Lipitor"), "LIPITOR");
  assert.equal(medicinePrefix(""), "");
});

test("urls ask for national rows of one quarter with a LIKE on the product name", () => {
  const u = decodeURIComponent(drugUrl("ATORVASTAT", 4, 500));
  assert.match(u, /^https:\/\/data\.medicaid\.gov\/api\/1\/datastore\/query\/158a1baa-5506-400a-8ec3-97756f0b0536\/0\?/);
  assert.match(u, /conditions\[0\]\[value\]=XX/);
  assert.match(u, /conditions\[1\]\[property\]=quarter/);
  assert.match(u, /conditions\[2\]\[value\]=%ATORVASTAT%/);
  assert.match(u, /conditions\[2\]\[operator\]=LIKE/);
  assert.match(u, /offset=500/);
  assert.match(decodeURIComponent(latestQuarterUrl()), /sorts\[0\]\[order\]=desc/);
});

test("parse skips suppressed and empty rows; groups weight by units", () => {
  const rows = parseRows({ results: ATORVASTAT });
  assert.equal(rows.length, 8);
  const g = groupRows(rows);
  const head = pickHeadline(g, "ATORVASTAT")!;
  assert.equal(head.product, "ATORVASTAT");
  assert.equal(head.rx, 3848 + 8516 + 15799 + 20853 + 4586 + 10209 + 10); // the 'Atorvastat' spelling is merged
  assert.equal(head.ndcs, 3);
  assert.ok(Math.abs(head.perUnit - (43869.92 + 77917.86 + 185458.35 + 188286.89 + 60013.62 + 163424.96 + 200) / (148243 + 456965.5 + 967534 + 1276237 + 169920 + 586334 + 1000)) < 1e-12);
  assert.equal(parseRows("x").length, 0);
});

test("atorvastatin with basis=medicaid: reimbursement per tablet in the newest quarter, prescriptions as sample", async () => {
  const { f, log } = fake(latest, { count: 8, results: ATORVASTAT });
  const a = await medicaidMedicine({ medicine: "atorvastatin 20mg", baseUrl: "https://proofprice.com" }, f);
  assert.equal(a.status, "ok");
  assert.equal(a.price!.currency, "USD");
  assert.equal(a.price!.measure, "average");
  assert.ok(a.price!.value > 0.1 && a.price!.value < 0.2);
  assert.equal(a.price_type, "reimbursement_price");
  assert.equal(a.sample_size, 63821);
  assert.equal(a.statistic!.reference_period, "2025 Q4");
  assert.deepEqual(a.period, { from: "2025-10-01", to: "2025-12-31" });
  assert.equal(a.source.id, "us-medicaid-sdud");
  assert.match(a.summary, /before manufacturer rebates/);
  assert.equal(log.length, 2);
  const extra = a.extra as any;
  assert.equal(extra.headline_drug, "ATORVASTAT");
  assert.ok(extra.other_matches.some((m: any) => m.product === "AMLODIPINE-ATORVASTAT"));
  assert.equal(extra.rows_note, undefined);
});

test("fewer than 5 prescriptions, unknown drug, missing name", async () => {
  const tiny = fake(latest, { count: 1, results: [r("1", "TINYDRUG", "10", "4", "50")] });
  const a = await medicaidMedicine({ medicine: "tinydrug" }, tiny.f);
  assert.equal(a.status, "no_matches");
  assert.match(String((a.extra as any).hint), /fewer than 5/);
  const none = fake(latest, { count: 0, results: [] });
  assert.match(String(((await medicaidMedicine({ medicine: "zzzz" }, none.f)).extra as any).hint), /No Medicaid drug name/);
  await assert.rejects(medicaidMedicine({ medicine: "" }, none.f), /medicine is required/);
});

test("licence and attribution are filled", () => {
  assert.match(INFO.licence_url, /publicdomain/);
  assert.match(INFO.attribution, /not affiliated with or endorsed by CMS/);
});
