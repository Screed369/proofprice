// Tests for Taiwan tuition fee standards (Ministry of Education, data.gov.tw 24726). Rows are real, captured 2026-10-21 (see fixtures.ts).
import test from "node:test";
import assert from "node:assert/strict";
import { InputError, SourceError } from "../../lib/http";
import { META_JSON, TUITION_CSV } from "./fixtures";
import { FALLBACK_CSV_URL, INFO, METADATA_URL, clearCache, csvFields, csvUrlFromMetadata, loadRows, parseFeeCsv, resolveFaculty, twTuition, tuitionAnswer } from "./source";
import manifest from "./index";

const rows = parseFeeCsv(TUITION_CSV);

test("the CSV parser reads quoted thousands, ROC years and 0 as 'not offered'", () => {
  assert.deepEqual(csvFields('114,公立,一般大學,0001,"國立,政治大學","28,430"'), ["114", "公立", "一般大學", "0001", "國立,政治大學", "28,430"]);
  const nccu = rows.find((r) => r.rocYear === 114 && r.code === "0001")!;
  assert.equal(nccu.ownership, "public");
  assert.equal(nccu.schoolType, "university");
  assert.equal(nccu.fees.humanities_law, 24510);
  assert.equal(nccu.fees.science_agri, 28430);
  assert.equal(nccu.fees.medicine, null);
  assert.ok(rows.some((r) => r.rocYear === 113));
});

test("a header with missing columns is refused with a plain message", () => {
  assert.throws(() => parseFeeCsv("學年度,設立別\n114,公立"), (e: any) => e instanceof SourceError && /columns missing/.test(e.message));
});

test("default question: newest year, humanities and law, all institutions in the fixture", () => {
  const a = tuitionAnswer(rows, {});
  assert.equal(a.status, "ok");
  assert.equal(a.price!.currency, "TWD");
  assert.match(a.price!.unit, /per semester/);
  assert.equal(a.price_type, "posted_price");
  assert.equal(a.sample_size, rows.filter((r) => r.rocYear === 114 && r.fees.humanities_law !== null).length);
  assert.ok(a.sample_size! >= 5);
  assert.ok(a.price!.median! > 15000 && a.price!.median! < 60000, String(a.price!.median));
  assert.deepEqual(a.period, { from: "2025-09-01", to: "2026-08-31" });
  assert.equal((a.extra as any).academic_year, "2025/26");
  assert.match(a.summary, /2025\/26/);
  assert.match(a.summary, /two semesters/);
  assert.match(a.source.attribution, /Ministry of Education, Taiwan/);
});

test("only the newest academic year is used (the 2024/25 rows of two institutions are ignored)", () => {
  const a = tuitionAnswer(rows, {});
  const n114 = rows.filter((r) => r.rocYear === 114 && r.fees.humanities_law !== null).length;
  assert.equal(a.sample_size, n114);
});

test("medicine at public universities: figures match the real rows; a faculty offered by fewer than 5 gives insufficient_data, never a number", () => {
  const med = tuitionAnswer(rows, { faculty: "medicine", ownership: "public" });
  const real = rows.filter((r) => r.rocYear === 114 && r.ownership === "public" && r.fees.medicine !== null).map((r) => r.fees.medicine!).sort((a, b) => a - b);
  if (real.length >= 5) {
    assert.equal(med.status, "ok");
    assert.equal(med.price!.min, real[0]);
    assert.equal(med.price!.max, real[real.length - 1]);
  } else {
    assert.equal(med.status, real.length ? "insufficient_data" : "no_matches");
    assert.equal(med.price, null);
  }
  const dent = tuitionAnswer(rows, { faculty: "dentistry", ownership: "public" });
  if (dent.status === "ok") assert.ok(dent.sample_size! >= 5);
  else assert.equal(dent.price, null);
});

test("private costs more than public for engineering (the real data)", () => {
  const a = tuitionAnswer(rows, { faculty: "engineering" });
  const pub = (a.extra as any).public_vs_private.public;
  const priv = (a.extra as any).public_vs_private.private;
  assert.ok(pub && priv);
  assert.ok(priv.median > pub.median, `${priv.median} vs ${pub.median}`);
});

test("faculty words are understood, unknown words are refused with the valid list", () => {
  assert.equal(resolveFaculty(undefined), "humanities_law");
  assert.equal(resolveFaculty("Law"), "humanities_law");
  assert.equal(resolveFaculty("Engineering"), "engineering");
  assert.equal(resolveFaculty("nursing"), "medical_college");
  assert.throws(() => resolveFaculty("astrology"), (e: any) => e instanceof InputError && /faculty must be one of/.test(e.message));
});

test("levels and groups the file does not hold are refused honestly", () => {
  assert.throws(() => tuitionAnswer(rows, { cycle: "second" }), InputError);
  assert.throws(() => tuitionAnswer(rows, { student_group: "international" }), InputError);
  assert.throws(() => tuitionAnswer(rows, { study_mode: "part-time" }), InputError);
  assert.throws(() => tuitionAnswer(rows, { ownership: "church" }), InputError);
  assert.throws(() => tuitionAnswer(rows, { school_type: "kindergarten" }), InputError);
});

test("the metadata JSON gives the current CSV address (percent-encoded); the fallback is the known address", () => {
  const url = csvUrlFromMetadata(JSON.parse(META_JSON))!;
  assert.equal(url, FALLBACK_CSV_URL);
  assert.equal(csvUrlFromMetadata({}), null);
});

test("loadRows reads the metadata first, then the CSV, and caches; a broken metadata call falls back", async () => {
  clearCache();
  const seen: string[] = [];
  const load = async (u: string) => {
    seen.push(u);
    return u === METADATA_URL ? META_JSON : TUITION_CSV;
  };
  const a = await twTuition({}, load);
  assert.equal(a.status, "ok");
  assert.deepEqual(seen, [METADATA_URL, FALLBACK_CSV_URL]);
  await twTuition({ faculty: "business" }, load);
  assert.equal(seen.length, 2, "second call is served from the cache");
  clearCache();
  const seen2: string[] = [];
  await loadRows(async (u) => {
    seen2.push(u);
    if (u === METADATA_URL) throw new SourceError("down");
    return TUITION_CSV;
  });
  assert.deepEqual(seen2, [METADATA_URL, FALLBACK_CSV_URL]);
  clearCache();
});

test("manifest: Taiwan in the tuition category, first example is the default question, posted price, attribution kept", () => {
  assert.equal(manifest.category, "tuition");
  assert.deepEqual(manifest.countries, ["TW"]);
  assert.deepEqual(manifest.examples[0].params, { country: "TW" });
  assert.equal(INFO.price_type, "posted_price");
  assert.equal(INFO.id, "tw-tuition");
});
