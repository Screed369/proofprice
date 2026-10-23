// Tests for the Singapore ECDA childcare source. Row layout copied from the live list-rows response (probe 2026-10-23):
// {"vault_id":"1","centre_code":"EB0001","centre_name":"...","class_of_licence":"Class B (Child Care)","type_of_service":"Full Day",
//  "levels_offered":"Kindergarten 1 (5 yrs old)","fees":"1125","type_of_citizenship":"Others","last_updated":"2026-07-17","remarks":"na"}
// Paging: data.links.next = "idCursor%5Bvalue%5D=400&limit=400". The extra centres below are generated in that layout.
import { test } from "node:test";
import assert from "node:assert/strict";
import { INFO, Fees, buildRows, citizenshipOf, ecdaAnswerFromRows, ecdaHistoryKey, levelOf, parsePage, resolveItem } from "./source";
import manifest from "./index";
import { categoryById, countriesFor } from "../../lib/registry";

const LEVEL_NAMES = ["Infant (2 to 18 mths)", "Playgroup (18 mths to 2 yrs old)", "Pre-Nursery (3 yrs old)", "Nursery (4 yrs old)", "Kindergarten 1 (5 yrs old)", "Kindergarten 2 (6 yrs old)"];
const FEES = { SC: 610, SPR: 835, Others: 1125 };

function rows(centres = 8) {
  const out: any[] = [];
  for (let c = 1; c <= centres; c++) {
    for (const lv of LEVEL_NAMES) {
      for (const [cit, fee] of Object.entries(FEES)) {
        out.push({ vault_id: String(out.length + 1), centre_code: `EB${String(c).padStart(4, "0")}`, centre_name: `CENTRE ${c}`, class_of_licence: "Class B (Child Care)",
          type_of_service: "Full Day", levels_offered: lv, fees: String(fee + c * 10), type_of_citizenship: cit, last_updated: `2026-10-${10 + c}`, remarks: "na" });
      }
    }
  }
  return out;
}

function fees(extra: any[] = [], centres = 8): Fees {
  const f = new Fees();
  for (const r of [...rows(centres), ...extra]) f.add(r);
  return f;
}

test("helpers: levels and citizenship groups are read from the live strings", () => {
  assert.equal(levelOf("Kindergarten 1 (5 yrs old)"), "Kindergarten 1");
  assert.equal(levelOf("Pre-Nursery (3 yrs old)"), "Pre-Nursery");
  assert.equal(levelOf("Nursery (4 yrs old)"), "Nursery");
  assert.equal(levelOf("Playgroup (18 mths to 2 yrs old)"), "Playgroup");
  assert.equal(levelOf("Infant (2 to 18 mths)"), "Infant");
  assert.equal(levelOf("Primary 1"), null);
  assert.equal(citizenshipOf("SC"), "SC");
  assert.equal(citizenshipOf("Permanent Resident"), "SPR");
  assert.equal(citizenshipOf("foreigner"), "Others");
  assert.equal(citizenshipOf("martian"), null);
});

test("parsePage: rows and next cursor; a new layout fails loudly", () => {
  const p = parsePage({ code: 0, data: { rows: rows(1).slice(0, 2), links: { next: "idCursor%5Bvalue%5D=400&limit=400" } } });
  assert.equal(p.rows.length, 2);
  assert.equal(p.next, "idCursor%5Bvalue%5D=400&limit=400");
  assert.equal(parsePage({ data: { rows: [], links: {} } }).next, null);
  assert.throws(() => parsePage({ data: { items: [] } }), /unexpected layout/);
});

test("Fees: newest listing per centre/level/citizenship; half-day, junk fees and unknown levels dropped", () => {
  const f = fees([
    { centre_code: "EB0001", type_of_service: "Full Day", levels_offered: "Infant (2 to 18 mths)", fees: "9999", type_of_citizenship: "SC", last_updated: "2020-01-01" }, // older: ignored
    { centre_code: "EB0002", type_of_service: "FEP AM", levels_offered: "Kindergarten 1 (5 yrs old)", fees: "150", type_of_citizenship: "SC", last_updated: "2026-10-01" },
    { centre_code: "EB0003", type_of_service: "Full Day", levels_offered: "Infant (2 to 18 mths)", fees: "n/a", type_of_citizenship: "SC", last_updated: "2026-10-01" },
    { centre_code: "EB0003", type_of_service: "Full Day", levels_offered: "Infant (2 to 18 mths)", fees: "99999", type_of_citizenship: "SC", last_updated: "2026-10-30" },
    { centre_code: "EB0004", type_of_service: "Full Day", levels_offered: "Primary 1", fees: "300", type_of_citizenship: "SC", last_updated: "2026-10-01" },
    { centre_code: "EB0004", type_of_service: "Full Day", levels_offered: "Nursery (4 yrs old)", fees: "300", type_of_citizenship: "Alien", last_updated: "2026-10-01" },
  ]);
  assert.deepEqual(f.dropped, { service: 1, level: 1, citizenship: 1, fee: 2 });
  assert.equal(f.entries().length, 8 * 6 * 3);
  assert.equal(f.entries().find((e) => e.centre === "EB0001" && e.level === "Infant" && e.cit === "SC")!.fee, 620); // 610 + 10, the 2020 row lost
});

test("buildRows: one row per level and citizenship with n = centres, plus the preschool pool; under 5 centres is not stored", () => {
  const b = buildRows(fees().entries());
  assert.equal(b.date, "2026-10-18");
  assert.equal(b.centres, 8);
  const inf = b.rows.find((r) => r.item === "Infant|SC")!;
  assert.equal(inf.n, 8);
  assert.equal(inf.median, 610 + 45); // fees 620..690, median of 8 = 655
  assert.equal(inf.area, "ALL");
  const pre = b.rows.find((r) => r.item === "Preschool (3-4 years)|Others")!;
  assert.equal(pre.n, 8); // one value per centre, not two
  assert.equal(pre.median, 1125 + 45);
  assert.equal(b.rows.length, 7 * 3);
  const few = buildRows(fees([], 4).entries());
  assert.equal(few.rows.length, 0);
});

test("answer: preschool is the default, SC is the default group, posted and before subsidy are said", () => {
  const day = { date: "2026-10-18", rows: buildRows(fees().entries()).rows };
  const a = ecdaAnswerFromRows(day, { today: "2026-10-23" });
  assert.equal(a.status, "ok");
  assert.equal(a.price!.currency, "SGD");
  assert.equal(a.price!.median, 655);
  assert.equal(a.sample_size, 8);
  assert.equal(a.price_type, "posted_price");
  assert.equal(a.extra!.citizenship_defaulted_to, "SC");
  assert.match(a.summary, /before government subsidies/);
  assert.equal((a.extra!.other_citizenship_groups as any[]).length, 2);
  const k2 = ecdaAnswerFromRows(day, { level: "Kindergarten 2", citizenship: "SPR", today: "2026-10-23" });
  assert.equal(k2.price!.median, 835 + 45);
  assert.equal(k2.extra!.citizenship_defaulted_to, undefined);
  const inf = ecdaAnswerFromRows(day, { age_group: "infant", today: "2026-10-23" });
  assert.equal(inf.price!.median, 655);
});

test("answer: an old copy is flagged; a thin cell says so instead of inventing", () => {
  const day = { date: "2026-10-18", rows: buildRows(fees().entries()).rows };
  assert.equal(ecdaAnswerFromRows(day, { today: "2027-06-01" }).extra!.stale, true);
  const thin = ecdaAnswerFromRows({ date: day.date, rows: day.rows.filter((r) => !r.item.startsWith("Infant")) }, { age_group: "infant" });
  assert.equal(thin.status, "no_matches");
  assert.match(String(thin.extra!.hint), /Fewer than 5 centres/);
});

test("options the listing cannot honour answer 400 with what to ask instead", () => {
  assert.throws(() => resolveItem({ age_group: "school-age" }), /not in the ECDA centre listing/);
  assert.throws(() => resolveItem({ care_type: "home-based" }), /centre only|must be 'centre'/);
  assert.throws(() => resolveItem({ hours: "part-time" }), /full-day/);
  assert.throws(() => resolveItem({ area: "Tampines" }), /no location field/);
  assert.throws(() => resolveItem({ citizenship: "martian" }), /citizenship must be one of/);
  assert.throws(() => resolveItem({ level: "Primary 3" }), /level must be one of/);
  assert.doesNotThrow(() => resolveItem({ area: "Singapore", care_type: "centre", hours: "full-time" }));
});

test("history key and manifest", () => {
  assert.deepEqual(ecdaHistoryKey({ level: "Nursery", citizenship: "Others" }), { area: "ALL", item: "Nursery|Others", label: "Nursery (4 years), Others, Singapore" });
  assert.equal(ecdaHistoryKey({ age_group: "school-age" }), null);
  assert.equal(manifest.info.id, INFO.id);
  assert.deepEqual(manifest.countries, ["SG"]);
  assert.equal(manifest.category, "childcare");
  assert.ok(manifest.harvest && manifest.historyKey);
  assert.ok(categoryById("childcare"));
  assert.ok(countriesFor("childcare").includes("SG"));
});
