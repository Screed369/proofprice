import { test } from "node:test";
import assert from "node:assert/strict";
import { SourceError } from "../../lib/http";
import {
  buildGbAnswer, candidateTables, dominantUnit, gbMedicine, gbp, matchesQuery, mergePresentations, nameStrengths, parseMedicine, parseSql, sqlFor, sqlUrl, tableMonth,
} from "./source";
import { ATORVASTATIN_JSON, LIPITOR_JSON, NOT_FOUND_JSON, OMEPRAZOLE_JSON, PARACETAMOL_JSON } from "./fixtures";

/** A fake portal that holds the tables named in `tables` and answers 404 (as the real one does) for any other month. */
function portal(tables: Record<string, Record<string, unknown>>, log: string[] = []) {
  return async (url: string): Promise<unknown> => {
    log.push(url);
    const id = /resource_id=(PCA_\d{6})/.exec(url)?.[1] ?? "";
    const t = tables[id];
    if (!t) throw new SourceError("Source returned HTTP 404", JSON.stringify(NOT_FOUND_JSON));
    for (const [name, body] of Object.entries(t)) if (url.includes(`LIKE%20'${name}%20%25'`)) return body;
    return { success: true, result: { help: "x", success: "true", result: { records: [], fields: [] } } };
  };
}

test("gb-nhs-pca understands what people type", () => {
  const a = parseMedicine("Atorvastatin 20mg");
  assert.equal(a.name, "atorvastatin");
  assert.deepEqual(a.strength, { value: 20, unit: "mg" });
  assert.equal(parseMedicine("acetaminophen").name, "paracetamol"); // BNF name
  assert.equal(parseMedicine("Lipitor").name, "lipitor");
  const o = parseMedicine("omeprazole capsules");
  assert.equal(o.form, "capsule");
  assert.deepEqual(parseMedicine("omeprazole gastro-resistant capsules").extraWords, ["gastro-resistant"]);
  assert.throws(() => parseMedicine("  "), /medicine is required/);
  assert.throws(() => parseMedicine("500mg"), /medicine is required/);
});

test("gb-nhs-pca matches strengths and forms in BNF presentation names", () => {
  assert.deepEqual(nameStrengths("Atorvastatin 20mg/5ml oral suspension sugar free"), [{ value: 20, unit: "mg" }, { value: 5, unit: "ml" }]);
  assert.equal(matchesQuery("Atorvastatin 20mg tablets", parseMedicine("atorvastatin 20 mg")), true);
  assert.equal(matchesQuery("Atorvastatin 120mg tablets", parseMedicine("atorvastatin 20 mg")), false);
  assert.equal(matchesQuery("Atorvastatin 20mg/5ml oral suspension", parseMedicine("atorvastatin tablets")), false);
  assert.equal(matchesQuery("Omeprazole 20mg dispersible gastro-resistant tablets", parseMedicine("omeprazole dispersible")), true);
  assert.equal(matchesQuery("Omeprazole 20mg gastro-resistant capsules", parseMedicine("omeprazole dispersible")), false);
});

test("gb-nhs-pca picks the newest month the portal holds", () => {
  assert.deepEqual(candidateTables("2026-10-14"), ["PCA_202607", "PCA_202608", "PCA_202606", "PCA_202605"]); // before the 15th: month-3 first (July)
  assert.deepEqual(candidateTables("2026-10-20"), ["PCA_202608", "PCA_202607", "PCA_202606", "PCA_202605"]); // after the 15th: month-2 first
  assert.deepEqual(candidateTables("2027-01-05"), ["PCA_202610", "PCA_202611", "PCA_202609", "PCA_202608"]); // wraps the year
  assert.deepEqual(tableMonth("PCA_202607"), { from: "2026-07-01", to: "2026-07-31", label: "July 2026" });
  assert.equal(tableMonth("PCA_202602").to, "2026-02-28");
});

test("gb-nhs-pca builds the SQL safely and exactly", () => {
  const sql = sqlFor("PCA_202607", "atorvastatin");
  assert.equal(
    sql,
    "SELECT BNF_PRESENTATION_NAME, UNIT_OF_MEASURE, PREP_CLASS, SUM(ITEMS) AS items, SUM(TOTAL_QUANTITY) AS quantity, SUM(NIC) AS nic FROM `PCA_202607` WHERE UPPER(BNF_PRESENTATION_NAME) LIKE 'ATORVASTATIN %' GROUP BY 1, 2, 3 ORDER BY items DESC LIMIT 400",
  );
  assert.match(sqlFor("PCA_202607", "x'; DROP TABLE a; --"), /LIKE 'XDROPTABLEA- %'/); // quotes and semicolons never reach the SQL
  assert.throws(() => sqlFor("PCA_202607; DROP", "a"), /Unexpected table name/);
  assert.match(sqlUrl("PCA_202607", sql), /^https:\/\/opendata\.nhsbsa\.net\/api\/3\/action\/datastore_search_sql\?resource_id=PCA_202607&sql=SELECT%20BNF_PRESENTATION_NAME%2C/);
});

test("gb-nhs-pca parses the portal's nested SQL answer", () => {
  const rows = parseSql(ATORVASTATIN_JSON);
  assert.equal(rows.length, 19);
  assert.deepEqual(rows[0], { presentation: "Atorvastatin 20mg tablets", unit: "tablet", prepClass: "01", items: 3625620, quantity: 122664746, nic: 3154242.52 });
  assert.throws(() => parseSql(NOT_FOUND_JSON), /refused the request: Not found/);
  assert.throws(() => parseSql({ success: true, result: { result: {} } }), /no records/);
  const merged = mergePresentations(rows);
  assert.equal(merged.find((p) => p.presentation === "Atorvastatin 20mg tablets")!.items, 3625620 + 3790); // preparation classes 01 and 05 merged
  assert.equal(dominantUnit(merged), "tablet");
});

test("gb-nhs-pca answers a strength-specific question with the NHS ingredient cost per tablet", async () => {
  const log: string[] = [];
  const a = await gbMedicine({ medicine: "atorvastatin 20mg" }, { fetcher: portal({ PCA_202607: { ATORVASTATIN: ATORVASTATIN_JSON } }, log), today: "2026-10-14" });
  assert.equal(a.status, "ok");
  assert.equal(a.price_type, "reimbursement_price");
  assert.equal(a.price?.measure, "average");
  assert.equal(a.price?.currency, "GBP");
  assert.equal(a.price?.unit, "per tablet");
  assert.ok(Math.abs((a.price?.value ?? 0) - 0.02604) < 0.00001); // £3,197,207.74 / 122,773,731 tablets
  assert.equal(a.sample_size, 3629410);
  assert.deepEqual(a.period, { from: "2026-07-01", to: "2026-07-31" });
  assert.equal(a.statistic?.reference_period, "July 2026 (PCA monthly data, England)");
  assert.match(a.summary, /about £0\.02604 per tablet in ingredient cost/);
  assert.match(a.summary, /Atorvastatin 20mg tablets/);
  assert.match(a.summary, /3,629,410 prescription items/);
  assert.match(a.summary, /not a shop price or what a patient pays/);
  const extra = a.extra as any;
  assert.equal(extra.typical_pack.cost_for_28_units_gbp, 0.72916);
  assert.match(a.summary, /roughly £0\.73 for a 28-tablet supply/);
  assert.equal(extra.average_cost_per_item_gbp, 0.88);
  assert.equal(extra.presentations.length, 1);
  assert.equal(log.length, 1);
  assert.match(a.source.licence, /Open Government Licence 3\.0/);
  assert.equal(a.source.licence_url, "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/");
});

test("gb-nhs-pca averages every strength for a name query and keeps liquids out of a tablet answer", async () => {
  const a = await gbMedicine({ medicine: "atorvastatin" }, { fetcher: portal({ PCA_202607: { ATORVASTATIN: ATORVASTATIN_JSON } }), today: "2026-10-14" });
  assert.ok(Math.abs((a.price?.value ?? 0) - 0.02995) < 0.00001);
  assert.equal(a.sample_size, 7070451);
  const extra = a.extra as any;
  assert.equal(extra.unit_of_measure, "tablet");
  assert.deepEqual(extra.other_units_of_measure, ["ml"]);
  assert.equal(extra.presentations[0].presentation, "Atorvastatin 20mg tablets");
  assert.match(a.summary, /Atorvastatin \(6 presentations, all strengths and forms, measured per tablet\)/);
});

test("gb-nhs-pca answers omeprazole per capsule and a brand per tablet", async () => {
  const o = await gbMedicine({ medicine: "omeprazole" }, { fetcher: portal({ PCA_202607: { OMEPRAZOLE: OMEPRAZOLE_JSON } }), today: "2026-10-14" });
  assert.equal(o.status, "ok");
  assert.equal(o.price?.unit, "per capsule");
  assert.ok(Math.abs((o.price?.value ?? 0) - 0.03307) < 0.00001);
  const l = await gbMedicine({ medicine: "Lipitor" }, { fetcher: portal({ PCA_202607: { LIPITOR: LIPITOR_JSON } }), today: "2026-10-14" });
  assert.ok(Math.abs((l.price?.value ?? 0) - 0.81754) < 0.00001);
  assert.equal(l.sample_size, 19753);
  const p = await gbMedicine({ medicine: "acetaminophen" }, { fetcher: portal({ PCA_202607: { PARACETAMOL: PARACETAMOL_JSON } }), today: "2026-10-14" });
  assert.equal(p.status, "ok");
  assert.equal(p.price?.unit, "per tablet");
  assert.deepEqual((p.query as any).matched_name, "paracetamol");
});

test("gb-nhs-pca steps back to an older month when the newest is not published", async () => {
  const log: string[] = [];
  const a = await gbMedicine({ medicine: "omeprazole" }, { fetcher: portal({ PCA_202607: { OMEPRAZOLE: OMEPRAZOLE_JSON } }, log), today: "2026-10-20" });
  assert.equal(a.status, "ok");
  assert.equal(log.length, 2); // August is not there yet (HTTP 404), July is
  assert.match(log[0], /resource_id=PCA_202608/);
  assert.equal(a.period.to, "2026-07-31");
  await assert.rejects(gbMedicine({ medicine: "omeprazole" }, { fetcher: portal({}), today: "2026-10-20" }), /Could not find a recent monthly/);
});

test("gb-nhs-pca does not hide other portal errors as missing months", async () => {
  const boom = async () => {
    throw new SourceError("Source returned HTTP 500");
  };
  await assert.rejects(gbMedicine({ medicine: "omeprazole" }, { fetcher: boom, today: "2026-10-14" }), /HTTP 500/);
});

test("gb-nhs-pca refuses to guess when nothing matches, and flags old data", async () => {
  const none = await gbMedicine({ medicine: "zzzzmedicine" }, { fetcher: portal({ PCA_202607: {} }), today: "2026-10-14" });
  assert.equal(none.status, "no_matches");
  assert.equal(none.price, null);
  assert.match((none.extra as any).hint, /No NHS presentation name starts with this word/);
  const wrong = await gbMedicine({ medicine: "atorvastatin 5mg" }, { fetcher: portal({ PCA_202607: { ATORVASTATIN: ATORVASTATIN_JSON } }), today: "2026-10-14" });
  assert.equal(wrong.status, "no_matches");
  assert.match((wrong.extra as any).hint, /none has the strength, form or words you gave/);
  const old = buildGbAnswer({
    q: parseMedicine("atorvastatin 20mg"), rows: parseSql(ATORVASTATIN_JSON).filter((r) => r.presentation.startsWith("Atorvastatin 20mg")), table: "PCA_202607", today: "2027-01-10",
  });
  assert.equal((old.extra as any).stale, true);
  assert.match(old.summary, /The newest month on the portal is 163 days old/);
});

test("gb-nhs-pca prints pounds with the precision it needs", () => {
  assert.equal(gbp(0.02604), "£0.02604");
  assert.equal(gbp(0.5), "£0.50");
  assert.equal(gbp(0.88), "£0.88");
  assert.equal(gbp(2.684), "£2.68");
  assert.equal(gbp(1234.5), "£1,235");
});
