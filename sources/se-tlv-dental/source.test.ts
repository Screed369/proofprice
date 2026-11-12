import { test } from "node:test";
import assert from "node:assert/strict";
import { parseListing, fileInForce, nextChange, parseTreatments, searchWords, findTreatment, treatmentAnswer } from "./source";

// Real start of the TLV tariff file "Referenspriser med dentalt material från 1 jan 2026.xlsx" (rows as readXlsx returns them), read 12 Nov 2026.
const HEAD = ["Åtgärdsnummer", "Åtgärdsnamn", "Referenspris allmäntandvård   fr o m 1 jan 2026", "Referenspris specialisttandvård fr o m 1 jan 2026", "Tandteknisk kostnad", "Dentalt material i beräkningen av referenspris"];
const REAL: unknown[][] = [
  HEAD,
  [101, "Basundersökning, utförd av tandläkare", "1100", "1100"],
  [103, "Kompletterande eller akut undersökning, utförd av tandläkare", "445", "585"],
  [111, "Basundersökning, utförd av tandhygienist", "985", "-"],
  [340, "Behandling av parodontal sjukdom eller periimplantit", 525, 575],
  [420, "Implantat, per styck", "3585", "3585", null, "Titan"],
  [501, "Rensning och rotfyllning, en rotkanal", "4105", "5135", null, "Guttaperka och sealer"],
  [502, "Rensning och rotfyllning, två rotkanaler", "4955", "6225", null, "Guttaperka och sealer"],
  [707, "Krona i plastiskt material, klinikframställd", "2075", "2075", null, "Komposit"],
  [800, "Permanent tandstödd krona, en per käke", "6825", "8250", 2033.664, "Zirkonia/Glaskeram/Metallkeramik"],
  [801, "Permanent tandstödd krona, flera i samma käke", 5275, "6395", 2033.664, "Zirkonia / Metallkeramik"],
];
// 50+ rows are required by parseTreatments (a guard against a changed file): pad with the codes above renumbered.
const ROWS: unknown[][] = [HEAD];
for (let i = 0; i < 6; i++) for (const r of REAL.slice(1)) ROWS.push([Number(r[0]) + i * 1000, r[1], r[2], r[3]]);
ROWS.push(...REAL.slice(1));

const PAGE = `<a href="/download/18.529dc9ea19afcca05a41160c/1765803851920/Referenspriser%20med%20dentalt%20material%20fr%C3%A5n%201%20jan%202026.xlsx">2026</a>
<a href="/download/18.6037db3519f17c61ec02e057/1783319810480/referenspriser_med_dentalt_material_fran15jan2027.xlsx">2027</a>`;

test("se-tlv-dental reads the two files and their start dates from the page", () => {
  const files = parseListing(PAGE);
  assert.deepEqual(files.map((f) => f.from), ["2026-01-01", "2027-01-15"]);
  assert.ok(files[0].url.startsWith("https://www.tlv.se/download/18.529dc9ea"));
  assert.equal(fileInForce(files, "2026-11-12")?.from, "2026-01-01");
  assert.equal(fileInForce(files, "2027-01-15")?.from, "2027-01-15");
  assert.equal(nextChange(files, files[0]), "2027-01-15");
  assert.equal(fileInForce([], "2026-11-12"), null);
});
test("se-tlv-dental parses treatments and turns '-' into no specialist price", () => {
  const list = parseTreatments(ROWS);
  const t = list.find((x) => x.code === 111)!;
  assert.deepEqual(t, { code: 111, name: "Basundersökning, utförd av tandhygienist", general: 985, specialist: null });
  assert.equal(list.find((x) => x.code === 801)!.general, 5275);
  assert.throws(() => parseTreatments([["a", "b", "c"], ...ROWS.slice(1)]), /format changed/);
  assert.throws(() => parseTreatments(ROWS.slice(0, 5)), /format changed/);
});
test("se-tlv-dental finds treatments by code and by English or Swedish words", () => {
  const list = parseTreatments(ROWS);
  assert.equal(findTreatment(list, "800")!.treatment.code, 800);
  assert.equal(findTreatment(list, "999"), null);
  assert.equal(findTreatment(list, "root canal")!.treatment.code, 501); // one canal: lowest code
  assert.equal(findTreatment(list, "rotfyllning")!.treatment.code, 501);
  assert.equal(findTreatment(list, "permanent crown")!.treatment.code, 800);
  assert.equal(findTreatment(list, "implant")!.treatment.code, 420);
  assert.equal(findTreatment(list, "crown")!.treatment.code, 800); // permanent crown, not the plastic one
  assert.equal(findTreatment(list, "check-up")!.treatment.code, 101);
  assert.equal(findTreatment(list, "quantum physics"), null);
  assert.deepEqual(searchWords("Root canal"), ["rotfyllning", "rot", "rotkanal"]);
  assert.throws(() => searchWords(" "), /Give a dental treatment/);
});
test("se-tlv-dental answers with a labelled reference price, never a paid price", () => {
  const list = parseTreatments(ROWS);
  const a = treatmentAnswer({ match: findTreatment(list, "800"), service: "800", file: { url: "u", from: "2026-01-01" }, next: "2027-01-15", today: "2026-11-12" });
  assert.equal(a.status, "ok");
  assert.equal(a.price?.currency, "SEK");
  assert.equal(a.price?.value, 6825);
  assert.equal(a.price?.max, 8250);
  assert.equal(a.price_type, "reimbursement_price");
  assert.equal(a.period.to, "2027-01-14");
  assert.match(a.summary, /not what patients paid/);
  assert.equal((a.extra as any).specialist_dental_care_sek, 8250);
  const none = treatmentAnswer({ match: null, service: "x", file: { url: "u", from: "2026-01-01" }, next: null, today: "2026-11-12" });
  assert.equal(none.status, "no_matches");
});
