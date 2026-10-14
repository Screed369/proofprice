import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DATASET_IDS, datasetSearchUrl, descriptionStrengths, groupProducts, latestUrl, matchesQuery, nadacMedicine, nadacTitle, parseDatasetSearch,
  parseLatest, parseMedicine, parseRows, rowsUrl, usd, dominantUnit,
} from "./source";
import { ATORVASTATIN_JSON, METFORMIN_JSON, LIPITOR_JSON, ACETAMINOPHEN_JSON } from "./fixtures";

// Real responses (probed 2026-10-14): the newest-date query and the dataset search (cut to the fields we read).
const LATEST_JSON = {
  results: [{ as_of_date: "2026-10-14", effective_date: "2026-09-23" }, { as_of_date: "2026-10-14", effective_date: "2026-09-23" }],
  count: 1238214,
};
const SEARCH_JSON = {
  total: "16",
  results: {
    "dkan_dataset/fbb83258-11c7-47f5-8b18-5f8e79f7e704": { "@type": "dcat:Dataset", title: "NADAC (National Average Drug Acquisition Cost) 2026", identifier: "fbb83258-11c7-47f5-8b18-5f8e79f7e704" },
    "dkan_dataset/a217613c-12bc-5137-8b3a-ada0e4dad1ff": { "@type": "dcat:Dataset", title: "NADAC Comparison", identifier: "a217613c-12bc-5137-8b3a-ada0e4dad1ff" },
  },
};

/** A fake portal: answers the newest-date query, then the rows query with the fixture that matches the drug name in the URL. */
function portal(opts: { latest?: unknown; rows: Record<string, unknown>; log?: string[]; search?: unknown }) {
  return async (url: string): Promise<unknown> => {
    opts.log?.push(url);
    if (url.includes("/api/1/search")) return opts.search ?? SEARCH_JSON;
    if (url.includes("sorts%5B0%5D%5Bproperty%5D=as_of_date")) return opts.latest ?? LATEST_JSON;
    for (const [key, body] of Object.entries(opts.rows)) if (url.includes(`value%5D=${key}`)) return body;
    return { results: [], count: 0 };
  };
}

test("us-nadac understands what people type", () => {
  assert.deepEqual(parseMedicine("atorvastatin"), { input: "atorvastatin", name: "atorvastatin", extraWords: [], strength: null, form: null });
  const a = parseMedicine("Atorvastatin 20mg");
  assert.equal(a.name, "atorvastatin");
  assert.deepEqual(a.strength, { value: 20, unit: "mg" });
  const m = parseMedicine("metformin hydrochloride 1,000 mg tablets");
  assert.equal(m.name, "metformin");
  assert.deepEqual(m.extraWords, []); // salt words are ignored
  assert.deepEqual(m.strength, { value: 1000, unit: "mg" });
  assert.equal(m.form, "tablet");
  assert.equal(parseMedicine("paracetamol").name, "acetaminophen"); // NADAC uses the American name
  assert.equal(parseMedicine("Lipitor 10 mg").name, "lipitor");
  assert.deepEqual(parseMedicine("metformin ER 500").extraWords, ["ER"]);
  assert.deepEqual(parseMedicine("metformin ER 500").strength, { value: 500, unit: "" });
  assert.equal(parseMedicine("constructor").name, "constructor"); // plain object keys are not looked up as aliases
  assert.throws(() => parseMedicine(""), /medicine is required/);
  assert.throws(() => parseMedicine("20mg"), /medicine is required/);
  assert.throws(() => parseMedicine("x"), /medicine is required/);
});

test("us-nadac matches strengths and forms in NADAC descriptions", () => {
  assert.deepEqual(descriptionStrengths("AMOXICILLIN 250 MG/5 ML SUSP"), [{ value: 250, unit: "mg" }, { value: 5, unit: "ml" }]);
  assert.deepEqual(descriptionStrengths("METFORMIN HCL 1,000 MG TABLET"), [{ value: 1000, unit: "mg" }]);
  assert.equal(matchesQuery("ATORVASTATIN 20 MG TABLET", parseMedicine("atorvastatin 20mg")), true);
  assert.equal(matchesQuery("ATORVASTATIN 80 MG TABLET", parseMedicine("atorvastatin 20mg")), false);
  assert.equal(matchesQuery("ATORVASTATIN 120 MG TABLET", parseMedicine("atorvastatin 20mg")), false); // 120 is not 20
  assert.equal(matchesQuery("METFORMIN ER 500 MG OSMOTIC TB", parseMedicine("metformin er 500mg")), true);
  assert.equal(matchesQuery("METFORMIN HCL 500 MG TABLET", parseMedicine("metformin er 500mg")), false);
  assert.equal(matchesQuery("METFORMIN HCL 500 MG/5 ML SOLN", parseMedicine("metformin tablet")), false);
  assert.equal(matchesQuery("METFORMIN ER 1,000 MG OSM-TAB", parseMedicine("metformin tablet")), true);
  assert.equal(matchesQuery("ACETAMINOPHEN 325 MG GELCAP", parseMedicine("acetaminophen capsule")), true);
});

test("us-nadac builds the portal queries exactly", () => {
  const id = DATASET_IDS[2026];
  assert.equal(
    latestUrl(id),
    `https://data.medicaid.gov/api/1/datastore/query/${id}/0?sorts%5B0%5D%5Bproperty%5D=as_of_date&sorts%5B0%5D%5Border%5D=desc&properties%5B0%5D=as_of_date&limit=1&schema=false&count=false`,
  );
  const u = rowsUrl(id, "2026-10-14", "atorvastatin");
  assert.match(u, /conditions%5B0%5D%5Bproperty%5D=ndc_description&conditions%5B0%5D%5Boperator%5D=like&conditions%5B0%5D%5Bvalue%5D=ATORVASTATIN%20%25&/);
  assert.match(u, /conditions%5B1%5D%5Bproperty%5D=as_of_date&conditions%5B1%5D%5Boperator%5D=%3D&conditions%5B1%5D%5Bvalue%5D=2026-10-14&/);
  assert.match(rowsUrl(id, "2026-10-14", "lipitor", "contains"), /value%5D=%25LIPITOR%25&/);
  assert.match(rowsUrl(id, "2026-10-14", "a'; DROP"), /value%5D=ADROP%20%25&/); // only letters, digits and hyphens survive
  assert.equal(nadacTitle(2027), "NADAC (National Average Drug Acquisition Cost) 2027");
  assert.match(datasetSearchUrl(nadacTitle(2027)), /^https:\/\/data\.medicaid\.gov\/api\/1\/search\?fulltext=NADAC%20\(National/);
});

test("us-nadac parses real portal responses", () => {
  assert.equal(parseLatest(LATEST_JSON), "2026-10-14");
  assert.equal(parseLatest({ results: [] }), null);
  assert.throws(() => parseLatest({ nope: 1 }), /Unexpected response/);
  assert.equal(parseDatasetSearch(SEARCH_JSON, nadacTitle(2026)), "fbb83258-11c7-47f5-8b18-5f8e79f7e704");
  assert.equal(parseDatasetSearch(SEARCH_JSON, nadacTitle(2030)), null);
  const { rows, total } = parseRows(LIPITOR_JSON);
  assert.equal(rows.length, 4);
  assert.equal(total, 4);
  assert.deepEqual(rows[0], {
    description: "LIPITOR 10 MG TABLET", ndc: "58151015577", rate: 13.40831, effective: "2026-09-23", unit: "EA", cls: "brand", otc: false, asOf: "2026-10-14",
  });
  const apap = parseRows(ACETAMINOPHEN_JSON).rows;
  assert.equal(apap.find((r) => r.description === "ACETAMINOPHEN 160 MG/5 ML LIQ" && r.rate === 0.02406)?.unit, "ML");
  assert.equal(apap.every((r) => r.cls === "generic" && r.otc === true), true);
  // the same product can carry different rates on different NDCs, so products keep a range
  const liq = groupProducts(apap).find((p) => p.description === "ACETAMINOPHEN 160 MG/5 ML LIQ")!;
  assert.deepEqual([liq.ndcs, liq.low, liq.high], [2, 0.01067, 0.02406]);
});

test("us-nadac dominant pricing unit ignores the odd one out", () => {
  const rows = parseRows(METFORMIN_JSON).rows;
  const d = dominantUnit(rows);
  assert.equal(d.unit, "EA");
  assert.deepEqual([...new Set(d.other.map((r) => r.description))], ["METFORMIN HCL 500 MG/5 ML SOLN"]);
});

test("us-nadac answers a strength-specific question from one product", async () => {
  const log: string[] = [];
  const a = await nadacMedicine({ medicine: "Atorvastatin 20mg" }, { fetcher: portal({ rows: { "ATORVASTATIN%20%25": ATORVASTATIN_JSON }, log }), today: "2026-10-14" });
  assert.equal(a.status, "ok");
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.price?.measure, "average");
  assert.equal(a.price?.value, 0.02792);
  assert.equal(a.price?.currency, "USD");
  assert.equal(a.price?.unit, "per tablet");
  assert.equal(a.price?.median, null); // the publisher's average, no distribution
  assert.equal(a.sample_size, 3);
  assert.equal(a.period.to, "2026-10-14");
  assert.equal(a.period.from, "2026-09-23");
  assert.equal(a.confidence, "high");
  assert.equal(a.statistic?.measure, "average");
  assert.match(a.statistic?.reference_period ?? "", /as of 2026-10-14 \(rates effective 2026-09-23\)/);
  assert.match(a.summary, /about \$0\.02792 per tablet to acquire ATORVASTATIN 20 MG TABLET/);
  assert.match(a.summary, /not the price a patient pays at the counter/);
  assert.match(a.summary, /roughly \$0\.84 for 30 tablets/);
  const extra = a.extra as any;
  assert.equal(extra.typical_pack.cost_for_30_units_usd, 0.8376);
  assert.equal(extra.products.length, 1);
  assert.equal(extra.stale, undefined);
  assert.match(a.source.licence, /usa\.gov\/publicdomain\/label\/1\.0/);
  assert.equal(log.length, 2); // newest date, then the rows
  assert.match(log[0], /datastore\/query\/fbb83258-11c7-47f5-8b18-5f8e79f7e704\/0\?/);
});

test("us-nadac says which strengths a name query spans", async () => {
  const a = await nadacMedicine({ medicine: "atorvastatin" }, { fetcher: portal({ rows: { "ATORVASTATIN%20%25": ATORVASTATIN_JSON } }), today: "2026-10-14" });
  assert.equal(a.status, "ok");
  assert.ok(Math.abs((a.price?.value ?? 0) - 0.032675) < 0.00002); // median of 12 NDC rates (3 per strength)
  assert.equal(a.sample_size, 12);
  const extra = a.extra as any;
  assert.deepEqual(extra.products.map((p: any) => p.description), ["ATORVASTATIN 10 MG TABLET", "ATORVASTATIN 20 MG TABLET", "ATORVASTATIN 40 MG TABLET", "ATORVASTATIN 80 MG TABLET"]);
  assert.deepEqual(extra.products.map((p: any) => p.nadac_per_unit_usd), [0.02283, 0.02792, 0.03743, 0.06926]);
  assert.match(extra.headline_basis, /median of the per-unit rates of all matching NDCs/);
  assert.match(a.summary, /4 strengths and forms; median across 12 NDC rates/);
  assert.match(a.summary, /range from \$0\.02283 to \$0\.06926/);
});

test("us-nadac maps paracetamol to acetaminophen and keeps liquids out of a tablet answer", async () => {
  const log: string[] = [];
  const a = await nadacMedicine({ medicine: "paracetamol" }, { fetcher: portal({ rows: { "ACETAMINOPHEN%20%25": ACETAMINOPHEN_JSON }, log }), today: "2026-10-14" });
  assert.match(log[1], /value%5D=ACETAMINOPHEN%20%25&/);
  assert.equal(a.status, "ok");
  assert.equal(a.price?.unit, "per unit (each)"); // GELCAP, TABLET and CAPLET mixed: no single word for them
  assert.equal((a.extra as any).pricing_unit, "EA");
  assert.equal((a.extra as any).other_pricing_units.length, 3); // the liquids are priced per mL and listed separately
});

test("us-nadac flags brand rates and tells apart generic and brand", async () => {
  const a = await nadacMedicine({ medicine: "Lipitor 20mg" }, { fetcher: portal({ rows: { "LIPITOR%20%25": LIPITOR_JSON } }), today: "2026-10-14" });
  assert.equal(a.price?.value, 19.07256);
  assert.equal((a.extra as any).products[0].rate, "brand");
});

test("us-nadac refuses to guess when nothing matches, and explains", async () => {
  const none = await nadacMedicine({ medicine: "zzzzmedicine" }, { fetcher: portal({ rows: {} }), today: "2026-10-14" });
  assert.equal(none.status, "no_matches");
  assert.equal(none.price, null);
  assert.match((none.extra as any).hint, /No NADAC product description starts with this name/);
  const wrong = await nadacMedicine({ medicine: "atorvastatin 5 mg" }, { fetcher: portal({ rows: { "ATORVASTATIN%20%25": ATORVASTATIN_JSON } }), today: "2026-10-14" });
  assert.equal(wrong.status, "no_matches");
  assert.match((wrong.extra as any).hint, /none has the strength or form you gave.*ATORVASTATIN 10 MG TABLET/);
});

test("us-nadac flags old data plainly", async () => {
  const a = await nadacMedicine({ medicine: "atorvastatin 40 mg" }, { fetcher: portal({ rows: { "ATORVASTATIN%20%25": ATORVASTATIN_JSON } }), today: "2026-12-01" });
  assert.equal(a.status, "ok");
  assert.equal((a.extra as any).stale, true);
  assert.match(a.summary, /The newest NADAC file is 48 days old/);
  assert.match(a.statistic?.note ?? "", /out of date/);
});

test("us-nadac falls back to last year's dataset in early January", async () => {
  const log: string[] = [];
  const fetcher = async (url: string): Promise<unknown> => {
    log.push(url);
    if (url.includes("/api/1/search")) return { results: {} }; // no 2027 dataset exists yet
    if (url.includes(DATASET_IDS[2026]) && url.includes("sorts%5B0%5D%5Bproperty%5D=as_of_date")) return LATEST_JSON;
    if (url.includes(DATASET_IDS[2026])) return ATORVASTATIN_JSON;
    return { results: [] };
  };
  const a = await nadacMedicine({ medicine: "atorvastatin 80mg" }, { fetcher, today: "2027-01-05" });
  assert.equal(a.status, "ok");
  assert.equal(a.price?.value, 0.06926);
  assert.match(log[0], /api\/1\/search\?fulltext=NADAC%20\(National%20Average%20Drug%20Acquisition%20Cost\)%202027/);
});

test("us-nadac prints dollars with the precision NADAC publishes", () => {
  assert.equal(usd(0.02792), "$0.02792");
  assert.equal(usd(0.0374), "$0.0374");
  assert.equal(usd(0.5), "$0.500");
  assert.equal(usd(19.07256), "$19.07");
  assert.equal(usd(1234.5), "$1,235");
});
