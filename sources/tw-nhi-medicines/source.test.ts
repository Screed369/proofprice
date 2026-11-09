import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv, parseDrugs, rocToIso, ingredientKey, unitOf, dailyRows, candidateKeys, fetchRows, twAnswerFromRow, twHistoryKey, INFO, Drug } from "./source";

// First rows and sample rows of the real file (info.nhi.gov.tw, rId A21030000I-E41001-001), checked 9 Nov 2026 from the cloud workspace.
const FIXTURE = "\ufeff" + `異動,藥品代號,藥品英文名稱,藥品中文名稱,成分,規格量,規格單位,單複方,支付價,有效起日,有效迄日,藥商,製造廠名稱,劑型,藥品分類,分類分組名稱,ATC代碼,給付規定章節,藥品代碼超連結,給付規定章節連結
,B004858100,FLUANXOL 3MG film coated tablets,"""隆柏"" 福祿安膜衣錠３毫克",FLUPENTIXOL (2HCL) 3 MG,,,單方,18.90,  960901,  980930,禾利行股份有限公司,H. LUNDBECK A/S,膜衣錠,研發廠,"FLUPENTIXOL , 一般錠劑膠囊劑 , 3.00 MG",N05AF01,,https://lmspiq.fda.gov.tw/web/DRPIQ/DRPIQ1000Result?licId=02004858,
,B004858100,FLUANXOL 3MG film coated tablets,"""隆柏"" 福祿安膜衣錠３毫克",FLUPENTIXOL (2HCL) 3 MG,,,單方,16.90,  981001,1001130,禾利行股份有限公司,H. LUNDBECK A/S,膜衣錠,研發廠,"FLUPENTIXOL , 一般錠劑膠囊劑 , 3.00 MG",N05AF01,,https://lmspiq.fda.gov.tw/web/DRPIQ/DRPIQ1000Result?licId=02004858,
,AB44475100,AMPIN TABLETS 5MG,安普錠5毫克,AMLODIPINE (BESYLATE) 5 MG,,,單方,2.87,1140401,9991231,永信藥品工業股份有限公司,永信藥品工業股份有限公司台中幼獅廠,錠劑,BA/BE學名藥,"AMLODIPINE , 一般錠劑膠囊劑 , 5.00 MG",C08CA01,,https://lmspiq.fda.gov.tw/web/DRPIQ/DRPIQ1000Result?licId=01044475,
,AA42704100,NOBAR TABLETS 5MG  (AMLODIPINE BESYLATE),諾怡錠５毫克（安脈狄平）,AMLODIPINE (BESYLATE) 5 MG,,,單方,2.87,1140401,9991231,健喬信元醫藥生技股份有限公司,健喬信元醫藥生技股份有限公司健喬廠,錠劑,BA/BE學名藥,"AMLODIPINE , 一般錠劑膠囊劑 , 5.00 MG",C08CA01,,https://lmspiq.fda.gov.tw/web/DRPIQ/DRPIQ1000Result?licId=01042704,
,AB44607100,"AMLOBIN TABLETS 5MG ""STANDARD""","""生達"" 鎮脈錠5毫克",AMLODIPINE (BESYLATE) 5 MG,,,單方,2.87,1140401,9991231,生達化學製藥股份有限公司二廠,盈盈生技製藥股份有限公司三峽廠,錠劑,BA/BE學名藥,"AMLODIPINE , 一般錠劑膠囊劑 , 5.00 MG",C08CA01,,https://lmspiq.fda.gov.tw/web/DRPIQ/DRPIQ1000Result?licId=01044607,
,AA45670100,NOVA TABLETS,脈可錠,AMLODIPINE (BESYLATE) 5 MG,,,單方,2.87,1140401,9991231,坤億生技有限公司,元宙化學製藥股份有限公司,錠劑,BA/BE學名藥,"AMLODIPINE , 一般錠劑膠囊劑 , 5.00 MG",C08CA01,,https://lmspiq.fda.gov.tw/web/DRPIQ/DRPIQ1000Result?licId=01045670,
,AB49969100,"Amlobin Tablets 10 mg""Standard""","""生達""鎮脈錠 10 毫克",AMLODIPINE (BESYLATE) 10 MG,,,單方,3.09,1130401,9991231,生達化學製藥股份有限公司,生達化學製藥股份有限公司二廠,錠劑,一般學名藥,"AMLODIPINE , 一般錠劑膠囊劑 , 10.00 MG",C08CA01,,https://lmspiq.fda.gov.tw/web/DRPIQ/DRPIQ1000Result?licId=01049969,
,BC24368100,Zoloft Film coated tablets 100mg,樂復得膜衣錠100毫克,SERTRALINE(AS HYDROCHLORIDE) 100 MG,,,單方,-,1080601,9991231,暉致醫藥股份有限公司,Pfizer Manufacturing Deutschland GmBH,膜衣錠,研發廠,"SERTRALINE , 一般錠劑膠囊劑 , 100.00 MG",N06AB06,1.2.1.,https://lmspiq.fda.gov.tw/web/DRPIQ/DRPIQ1000Result?licId=02024368,https://info.nhi.gov.tw/api/INAE3000/INAE3000S01/getPDF?DurgFileName=1.2.1._20180301_000.pdf
`;

test("tw-nhi parses quoted fields and the BOM", () => {
  const rows = parseCsv(FIXTURE);
  assert.equal(rows.length, 9);
  assert.equal(rows[0][1], "藥品代號");
  assert.equal(rows[1][3], '"隆柏" 福祿安膜衣錠３毫克'); // doubled quotes
  assert.equal(rows[5][2], 'AMLOBIN TABLETS 5MG "STANDARD"');
  assert.equal(rows[1].length, 20);
});
test("tw-nhi keeps only current priced items, one per code", () => {
  const d = parseDrugs(parseCsv(FIXTURE), "2026-11-09");
  assert.equal(d.length, 5); // two old FLUANXOL price rows (ended) and the price "-" row are dropped
  assert.ok(d.every((x) => x.ingredient === "amlodipine" && x.unit === "tab" && x.atc === "C08CA01"));
  assert.deepEqual(d.map((x) => x.price).sort(), [2.87, 2.87, 2.87, 2.87, 3.09]);
  // a row that starts in the future is not current yet
  assert.equal(parseDrugs(parseCsv(FIXTURE), "2024-06-01").length, 1); // only the item that started 2024-04-01 is current by then
});
test("tw-nhi fails loudly when the header changes", () => {
  assert.throws(() => parseDrugs([["a", "b"], ["1", "2"]]), /format changed/);
});
test("tw-nhi dates, ingredients and forms", () => {
  assert.equal(rocToIso("1130401"), "2024-04-01");
  assert.equal(rocToIso("  960901"), "2007-09-01");
  assert.equal(rocToIso("9991231"), "2910-12-31");
  assert.equal(rocToIso("-"), null);
  assert.equal(ingredientKey("PAROXETINE HYDROCHLORIDE 20 MG"), "paroxetine");
  assert.equal(ingredientKey("FLUPENTIXOL (2HCL) .5 MG+MELITRACEN (HCL) 10 MG"), "flupentixol");
  assert.equal(ingredientKey("(AS BASE) 5 MG"), null); // no ingredient word first: skipped, never guessed
  assert.equal(ingredientKey("5 MG"), null);
  assert.equal(unitOf("膜衣錠"), "tab");
  assert.equal(unitOf("軟膠囊劑"), "cap");
  assert.equal(unitOf("注射劑"), "other");
});
test("tw-nhi daily rows need 5 items per group", () => {
  const d = parseDrugs(parseCsv(FIXTURE), "2026-11-09");
  const r = dailyRows(d);
  assert.deepEqual(r.map((x) => x.item).sort(), ["atc:C08CA01|tab", "name:amlodipine|tab"]);
  assert.equal(r[0].n, 5);
  assert.equal(r[0].median, 2.87);
  assert.equal(dailyRows(d.slice(0, 4)).length, 0);
});
test("tw-nhi candidate keys: names, aliases, ATC codes, and a demand for a name", () => {
  assert.deepEqual(candidateKeys("Amlodipine 5mg"), ["name:amlodipine"]);
  assert.deepEqual(candidateKeys("paracetamol"), ["name:acetaminophen", "name:paracetamol"]);
  assert.deepEqual(candidateKeys("c08ca01"), ["atc:C08CA01"]);
  assert.throws(() => candidateKeys(""), /medicine is required/);
  assert.deepEqual(twHistoryKey({ medicine: "metformin" }), { area: "ALL", item: "name:metformin|tab", label: "metformin, Taiwan (per tablet)" });
  assert.equal(twHistoryKey({}), null);
});
test("tw-nhi answer is a labelled posted price and flags an old copy", () => {
  const row = { date: "2026-11-09", area: "ALL", item: "name:amlodipine|tab", n: 38, median: 2.87, low: 2.87, high: 3.09, min: 2.87, max: 9.8 } as never;
  const a = twAnswerFromRow(row, { key: "name:amlodipine", unit: "tab", today: "2026-11-09" });
  assert.equal(a.price_type, "posted_price");
  assert.equal(a.price?.currency, "TWD");
  assert.equal(a.sample_size, 38);
  assert.match(a.summary, /not market transactions/);
  assert.match(INFO.licence, /Open Government Data License/);
  const old = twAnswerFromRow(row, { key: "name:amlodipine", unit: "tab", today: "2026-11-20" });
  assert.equal(old.extra?.stale, true);
});
test("tw-nhi retries a cut-off download and keeps a complete one", async () => {
  const big = "h1,h2\n" + "a,b\n".repeat(160_000);
  let calls = 0;
  const get = async () => (++calls < 3 ? "h1,h2\na,b\n" : big);
  const rows = await fetchRows("x", 3, get);
  assert.equal(calls, 3);
  assert.ok(rows.length > 150_000);
  calls = 0;
  await assert.rejects(fetchRows("x", 3, async () => (calls++, "h1,h2\na,b\n")), /incomplete after 3 tries/);
  assert.equal(calls, 3);
});
