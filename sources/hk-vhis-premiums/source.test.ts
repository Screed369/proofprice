import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { INFO, itemKey, parsePlans, premiumAnswer, premiumRows, premiumsHarvest, resolveAge, resolvePolicy, resolveSex, resolveSmoker, unzipFirst } from "./source";

// Shape copied from the LIVE file (plan-premium.json inside plan-premium.zip, checked 2026-11-03): certified-plans[] with certification-no,
// prem-date (YYYYMMDD), currency, age-counting-method and premium{class}{age}; rider classes are null for plans without a rider. Premium values
// below are SYNTHETIC (invented) so a cell can reach 5 plans; the first plan keeps the real certification number and ages 0-3 of the real SFN row.
const ages = (base: number) => Object.fromEntries(Array.from({ length: 100 }, (_, a) => [String(a), base + a * 10]));
const plan = (n: number, over: Record<string, unknown> = {}) => ({
  "certification-no": `S0001${n}-01-000-03`, "prem-date": "20190401", currency: "HKD", "age-counting-method": "A",
  premium: { SFN: ages(1000 + n * 100), SFY: ages(1100 + n * 100), SMN: ages(900 + n * 100), SMY: ages(950 + n * 100), RFN: null, RFY: null, RMN: null, RMY: null },
  ...over,
});
const doc = (plans: unknown[]) => JSON.stringify({ "certified-plans": plans });

test("parsePlans keeps standard HKD plans effective by today and drops flexi, USD and future plans", () => {
  const plans = parsePlans(doc([plan(1), plan(2, { "certification-no": "F00002-01-000-03" }), plan(3, { currency: "USD" }), plan(4, { "prem-date": "20261201" }), plan(5)]), "2026-11-03");
  assert.deepEqual(plans.map((p) => p.no), ["S00011-01-000-03", "S00015-01-000-03"]);
  assert.equal(plans[0].date, "2019-04-01");
  assert.equal(parsePlans(doc([plan(4, { "prem-date": "20261101" })]), "2026-11-01").length, 1);
  assert.equal(parsePlans(doc([plan(4, { "prem-date": "20261101" })]), "2026-10-31").length, 0);
});

test("a file without certified-plans is an error", () => {
  assert.throws(() => parsePlans("{}", "2026-11-03"), /certified-plans/);
  assert.throws(() => parsePlans("nope", "2026-11-03"), /JSON/);
});

test("premiumRows aggregates per policy, sex, smoking and age and drops cells under 5 plans", () => {
  const plans = parsePlans(doc([1, 2, 3, 4, 5].map((n) => plan(n))), "2026-11-03");
  const rows = premiumRows(plans);
  const r = rows.find((x) => x.item === itemKey("standalone", "female", "non_smoker", 40))!;
  assert.equal(r.n, 5);
  assert.equal(r.median, 1000 + 300 + 400); // median plan 3: 1000+3*100 + age 40*10
  assert.equal(r.area, "ALL");
  assert.equal(rows.find((x) => x.item.startsWith("rider/")), undefined); // null rider classes
  assert.equal(premiumRows(parsePlans(doc([1, 2, 3, 4].map((n) => plan(n))), "2026-11-03")).length, 0);
});

test("unzipFirst reads a single-file deflate zip", () => {
  const data = Buffer.from(doc([plan(1)]));
  const comp = deflateRawSync(data);
  const name = Buffer.from("plan-premium.json");
  const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26);
  const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(8, 10); cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(data.length, 24); cd.writeUInt16LE(name.length, 28); cd.writeUInt32LE(0, 42);
  const cdOffset = lh.length + name.length + comp.length;
  const eo = Buffer.alloc(22); eo.writeUInt32LE(0x06054b50, 0); eo.writeUInt16LE(1, 8); eo.writeUInt16LE(1, 10); eo.writeUInt32LE(cd.length + name.length, 12); eo.writeUInt32LE(cdOffset, 16);
  const zip = Buffer.concat([lh, name, comp, cd, name, eo]);
  assert.equal(unzipFirst(zip).toString("utf-8"), data.toString("utf-8"));
  assert.throws(() => unzipFirst(Buffer.from("not a zip")), /zip/);
});

test("harvest downloads, unzips and aggregates; date is the newest effective date", async () => {
  const data = Buffer.from(doc([1, 2, 3, 4, 5, 6].map((n) => plan(n, n === 6 ? { "prem-date": "20260701" } : {}))));
  const comp = deflateRawSync(data);
  const name = Buffer.from("plan-premium.json");
  const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26);
  const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(8, 10); cd.writeUInt32LE(comp.length, 20); cd.writeUInt16LE(name.length, 28);
  const eo = Buffer.alloc(22); eo.writeUInt32LE(0x06054b50, 0); eo.writeUInt32LE(lh.length + name.length + comp.length, 16);
  const zip = Buffer.concat([lh, name, comp, cd, name, eo]);
  const fetcher = (async () => new Response(zip, { status: 200 })) as unknown as typeof fetch;
  const h = await premiumsHarvest(fetcher, new Date("2026-11-03T00:00:00Z"));
  assert.equal(h.date, "2026-07-01");
  assert.equal(h.currency, "HKD");
  assert.equal(h.unit, "per year");
  assert.equal(h.rows.find((r) => r.item === "standalone/male/non_smoker/0")!.n, 6);
  const bad = (async () => new Response("x", { status: 500 })) as unknown as typeof fetch;
  await assert.rejects(() => premiumsHarvest(bad), /HTTP 500/);
});

test("answer: ok with a range, plan count and posted label", () => {
  const rows = premiumRows(parsePlans(doc([1, 2, 3, 4, 5, 6, 7].map((n) => plan(n))), "2026-11-03"));
  const a = premiumAnswer({ date: "2026-07-01", rows }, { insured_age: 40, sex: "female" });
  assert.equal(a.status, "ok");
  assert.equal(a.price!.currency, "HKD");
  assert.equal(a.price!.unit, "per year");
  assert.equal(a.sample_size, 7);
  assert.ok(a.price!.typical_low! < a.price!.median! && a.price!.median! < a.price!.typical_high!);
  assert.match(a.summary, /7 certified VHIS Standard Plans/);
  assert.match(a.summary, /not amounts paid/);
  assert.equal(a.source.licence_url, INFO.licence_url);
});

test("answer: rider premiums with too few plans give an honest no-figure message", () => {
  const rows = premiumRows(parsePlans(doc([1, 2, 3, 4, 5].map((n) => plan(n))), "2026-11-03"));
  const a = premiumAnswer({ date: "2026-07-01", rows }, { insured_age: 40, policy_type: "rider" });
  assert.notEqual(a.status, "ok");
  assert.match(a.summary, /fewer than 5/);
});

test("parameter helpers", () => {
  assert.equal(resolveAge({ age_group: "adult" }).age, 40);
  assert.equal(resolveAge({ insured_age: 0 }).age, 0);
  assert.throws(() => resolveAge({ insured_age: 150 }), /0 to 99/);
  assert.throws(() => resolveAge({ age_group: "senior" }), /insured_age/);
  assert.equal(resolveSex(undefined), "male");
  assert.equal(resolveSex("F"), "female");
  assert.throws(() => resolveSex("x"), /sex/);
  assert.equal(resolveSmoker("yes"), "smoker");
  assert.equal(resolveSmoker(undefined), "non_smoker");
  assert.equal(resolvePolicy("Rider"), "rider");
  assert.throws(() => resolvePolicy("x"), /policy_type/);
});
