// Tests for the ElCom Switzerland electricity tariff source.
// Fixture rows are copied from the live LINDAS answer (SPARQL GET, CSV), checked 2026-10-22 via the GitHub probe:
// national cube (electricityprice-swiss) for 2025/2026 and canton Zürich (electricityprice-canton, canton 1).
import { test } from "node:test";
import assert from "node:assert/strict";
import { InputError } from "../../lib/http";
import { INFO, buildQuery, chElectricityAnswer, findCanton, normaliseProfile, parseCsv, parseObservations, queryUrl } from "./source";

const C = "https://energy.ld.admin.ch/elcom/electricityprice/category/";
const P = "https://energy.ld.admin.ch/elcom/electricityprice/product/";
const TODAY = new Date("2026-10-22T12:00:00Z");
const HEAD = "period,category,product,total,energy,gridusage,charge,aidfee";
const SWISS_CSV = [
  HEAD,
  `2025,${C}H4,${P}standard,29.0,13.7,12.175,1.0,2.3`,
  `2025,${C}H4,${P}cheapest,27.6,11.58,12.207,1.1,2.3`,
  `2025,${C}H1,${P}standard,34.066,14.1035,16.107,1.1,2.3`,
  `2026,${C}H4,${P}standard,27.696,12.112,10.735,1.0,2.3`,
  `2026,${C}H4,${P}cheapest,26.696,10.712,11.162,1.5,2.3`,
  `2026,${C}H7,${P}standard,24.869,12.095,9.54,0.85,2.3`,
  `2026,${C}C1,${P}standard,28.611,13.71,12.17,0.93,2.3`, // commercial profile: ignored
  "",
].join("\r\n");
const ZH_CSV = [
  HEAD,
  `2025,${C}H4,${P}standard,27.506,15.732,10.855,0.16,2.3`,
  `2026,${C}H6,${P}standard,23.215,12.285,8.23,0.16,2.3`,
  `2026,${C}H4,${P}standard,25.5,12.0,11.0,0.2,2.3`, // SYNTHETIC 2026 H4 value for Zürich (the probe showed H6/C3/H7 for 2026)
  `2026,${C}H4,${P}cheapest,24.558,7.684,10.735,2.0,2.3`,
].join("\n");

test("licence and type", () => {
  assert.match(INFO.licence, /Open use/);
  assert.equal(INFO.price_type, "posted_price");
});

test("CSV reader handles CRLF and quotes", () => {
  assert.deepEqual(parseCsv('a,b\r\n"x,1","y""z"\r\n'), [["a", "b"], ["x,1", 'y"z']]);
});

test("parse real national rows, drop commercial profiles", () => {
  const obs = parseObservations(SWISS_CSV);
  assert.equal(obs.length, 6);
  assert.deepEqual(obs[0], { period: 2025, category: "H4", product: "standard", total: 29, energy: 13.7, gridusage: 12.175, charge: 1, aidfee: 2.3 });
  assert.ok(!obs.some((o) => o.category === "C1"));
});

test("a changed layout is reported, not guessed", () => {
  assert.throws(() => parseObservations("a,b\n1,2\n"), /unexpected layout/);
});

test("national answer: newest year, H4 default, CHF per kWh", () => {
  const a = chElectricityAnswer(parseObservations(SWISS_CSV), { energy: "electricity", today: TODAY });
  assert.equal(a.status, "ok");
  assert.equal(a.price?.median, 0.277);
  assert.equal(a.price?.currency, "CHF");
  assert.equal(a.price?.unit, "per kWh");
  assert.equal(a.sample_size, null);
  const x = a.extra as any;
  assert.equal(x.profile, "H4");
  assert.equal(x.tariff_year, 2026);
  assert.equal(x.previous_year_chf_per_kwh, 0.29);
  assert.equal(x.cheapest_product_chf_per_kwh, 0.267);
  assert.equal(x.components_chf_per_kwh.grid_use, 0.1074);
  assert.deepEqual(Object.keys(x.other_profiles_standard_chf_per_kwh).sort(), ["H4", "H7"]);
  assert.equal(a.price_type, "posted_price");
});

test("a tariff year that has not started is announced, not the headline", () => {
  const csv = SWISS_CSV + `\r\n2027,${C}H4,${P}standard,26.56,11.4,10.95,1.0,2.3\r\n`; // 2027 value as seen on the live preview
  const a = chElectricityAnswer(parseObservations(csv), { energy: "electricity", today: TODAY });
  assert.equal(a.price?.median, 0.277);
  assert.equal((a.extra as any).tariff_year, 2026);
  assert.equal((a.extra as any).announced_next_year, 2027);
  assert.equal((a.extra as any).announced_next_year_chf_per_kwh, 0.2656);
  const jan = chElectricityAnswer(parseObservations(csv), { energy: "electricity", today: new Date("2027-01-02T00:00:00Z") });
  assert.equal(jan.price?.median, 0.2656);
});

test("other profile and the same wording of the profile", () => {
  const obs = parseObservations(SWISS_CSV);
  assert.equal(chElectricityAnswer(obs, { energy: "electricity", consumption_band: "h7", today: TODAY }).price?.median, 0.2487);
  assert.equal(normaliseProfile("4"), "H4");
  assert.equal(normaliseProfile(" h 8 "), "H8");
  assert.throws(() => normaliseProfile("H9"), InputError);
});

test("canton answer", () => {
  const a = chElectricityAnswer(parseObservations(ZH_CSV), { energy: "electricity", canton: "Zürich", today: TODAY });
  assert.equal(a.status, "ok");
  assert.equal((a.extra as any).place, "Zürich");
  assert.equal(a.price?.value, 0.255);
  assert.equal((a.query as any).canton, "ZH");
});

test("canton names and codes", () => {
  assert.equal(findCanton("GE")?.id, 25);
  assert.equal(findCanton("geneva")?.code, "GE");
  assert.equal(findCanton("Zurich")?.id, 1);
  assert.equal(findCanton("Ticino")?.code, "TI");
  assert.equal(findCanton("Atlantis"), null);
});

test("bad input is explained", () => {
  const obs = parseObservations(SWISS_CSV);
  assert.throws(() => chElectricityAnswer(obs, { energy: "gas" }), InputError);
  assert.throws(() => chElectricityAnswer(obs, { energy: "electricity", canton: "Atlantis" }), /canton "Atlantis" not found/);
  assert.throws(() => chElectricityAnswer(obs, { energy: "electricity", taxes: "none" }), InputError);
});

test("empty answer is no_matches, never a made-up figure", () => {
  const a = chElectricityAnswer([], { energy: "electricity" });
  assert.equal(a.status, "no_matches");
});

test("query targets the right cube and year", () => {
  assert.match(buildQuery(null, 2024), /electricityprice-swiss\/observation\//);
  assert.match(buildQuery({ id: 25 }, 2024), /electricityprice-canton\/observation\/25-/);
  assert.match(buildQuery(null, 2024), />= 2024/);
  assert.match(queryUrl(null, 2024), /^https:\/\/lindas\.admin\.ch\/query\?query=/);
});
