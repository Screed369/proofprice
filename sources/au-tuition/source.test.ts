// Tests for Australia tuition (Commonwealth supported places, Department of Education indexed rates). Amounts read from the official PDFs on 2026-10-30.
import test from "node:test";
import assert from "node:assert/strict";
import { InputError } from "../../lib/http";
import { DEFAULT_FIELD, FIELDS, INFO, RATES, auTuition, defaultYear, resolveField } from "./source";
import manifest from "./index";

const mid2026 = new Date("2026-10-30T12:00:00Z");

test("default: 2026 law/commerce amount for students who started after 2020", () => {
  const a = auTuition({}, mid2026);
  assert.equal(a.status, "ok");
  assert.equal(a.price?.value, 17399);
  assert.equal(a.price?.currency, "AUD");
  assert.equal(a.price?.measure, "average");
  assert.equal(a.price_type, "official_statistic");
  assert.equal(a.sample_size, null);
  assert.deepEqual(a.period, { from: "2026-01-01", to: "2026-12-31" });
  assert.equal(a.statistic?.reference_period, "2026");
  assert.match(a.summary ?? "", /17,399 AUD per full-time year/);
  assert.match(a.summary ?? "", /up 3\.6% on 2025|2026/);
  assert.equal((a.extra as any).all_fields.length, FIELDS.length);
  assert.match(a.statistic?.note ?? "", /No field was given/);
});

test("2026 table matches the Department's printed rows", () => {
  const r = RATES.find((x) => x.year === 2026)!;
  assert.equal(r.current.education_english_maths, 4738);
  assert.equal(r.current.engineering_science, 9537);
  assert.equal(r.current.medicine_dentistry_veterinary, 13558);
  assert.equal(r.grandfathered.law_commerce, 13624);
  assert.equal(r.grandfathered.society_culture, 8164);
  assert.equal(r.grandfathered.arts_psychology_social_work, 8164);
});

test("2027 table and the change on 2026", () => {
  const a = auTuition({ field: "medicine", year: "2027" }, mid2026);
  assert.equal(a.price?.value, 14046);
  assert.match(a.summary ?? "", /up 3\.6% on 2026/);
  const g = auTuition({ field: "law", commenced: "before_2021", year: "2027" }, mid2026);
  assert.equal(g.price?.value, 14114);
});

test("the rates in force follow the calendar", () => {
  assert.equal(defaultYear(new Date("2026-12-31T23:00:00Z")), 2026);
  assert.equal(defaultYear(new Date("2027-01-01T00:00:00Z")), 2027);
  assert.equal(defaultYear(new Date("2030-05-01T00:00:00Z")), 2027);
  const late = auTuition({ field: "nursing" }, new Date("2029-05-01T00:00:00Z"));
  assert.equal(late.price?.value, 4908);
  assert.match(late.statistic?.note ?? "", /newer rates are in force/);
});

test("plain words resolve to the right group", () => {
  assert.equal(resolveField("nursing").id, "nursing_languages");
  assert.equal(resolveField("Computer Science").id, "health_built_computing");
  assert.equal(resolveField("civil engineering").id, "engineering_science");
  assert.equal(resolveField("clinical psychology").id, "education_english_maths");
  assert.equal(resolveField("visual arts").id, "arts_psychology_social_work");
  assert.equal(resolveField("veterinary").id, "medicine_dentistry_veterinary");
  assert.equal(resolveField("medicine_dentistry_veterinary").id, "medicine_dentistry_veterinary");
  assert.equal(resolveField(undefined).id, DEFAULT_FIELD);
  assert.throws(() => resolveField("underwater basket weaving"), InputError);
});

test("bad inputs give plain errors", () => {
  assert.throws(() => auTuition({ student_group: "international" }, mid2026), /Commonwealth supported/);
  assert.throws(() => auTuition({ study_mode: "part-time" }, mid2026), /full-time/);
  assert.throws(() => auTuition({ year: "2019" }, mid2026), /year must be one of 2026, 2027/);
  assert.throws(() => auTuition({ commenced: "maybe" }, mid2026), /commenced must be/);
  assert.throws(() => auTuition({ cycle: "third" }, mid2026), /cycle/);
});

test("manifest: AU only, licence and attribution present, examples work", async () => {
  assert.deepEqual(manifest.countries, ["AU"]);
  assert.equal(manifest.category, "tuition");
  assert.match(INFO.licence, /CC BY 4\.0|Creative Commons Attribution 4\.0/);
  assert.match(INFO.attribution, /Commonwealth of Australia/);
  const ex = await manifest.handle({ country: "AU", field: "nursing" }, {});
  assert.equal(ex.price?.value, 4738);
  assert.equal(ex.status, "ok");
});
