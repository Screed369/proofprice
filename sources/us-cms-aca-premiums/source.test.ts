import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { INFO, ageKey, metalOf, planCollector, premiumAnswer, premiumsHarvest, rateCollector, resolveAge, resolveMetal, resolveState } from "./source";

// Headers and the first dental row are REAL (CMS Exchange PUF plan year 2026, GitHub probe 2026-10-23); the medical plan rows are
// SYNTHETIC lines in the same format (ids and prices invented) so a cell can reach 5 plan offers.
const ATTR_HEAD = "﻿BusinessYear,StateCode,IssuerId,IssuerMarketPlaceMarketingName,SourceName,ImportDate,MarketCoverage,DentalOnlyPlan,StandardComponentId,PlanMarketingName,HIOSProductId,NetworkId,ServiceAreaId,FormularyId,IsNewPlan,PlanType,MetalLevel";
const ATTR_DENTAL = "2026,AK,21989,Delta Dental of Alaska,HIOS,10/15/2025,Individual,Yes,21989AK0030001,Delta Dental Premier Plan,21989AK003,AKN003,AKS003,,Existing,Indemnity,Low";
const medical = (n: number, state: string, metal: string, market = "Individual") =>
  `2026,${state},1000${n},"Issuer ${n}, Inc.",HIOS,10/15/2025,${market},No,1000${n}${state}0010001,"Plan ${n}, gold-ish",1000${n}${state}001,N1,S1,,New,PPO,${metal}`;
const RATE_HEAD = "BusinessYear,StateCode,IssuerId,SourceName,ImportDate,RateEffectiveDate,RateExpirationDate,PlanId,RatingAreaId,Tobacco,Age,IndividualRate,IndividualTobaccoRate,Couple,PrimarySubscriberAndOneDependent";
const RATE_DENTAL = "2026,AK,21989,HIOS,2025-10-15,2026-01-01,2026-12-31,21989AK0030001,Rating Area 1,No Preference,0-14,65.0,,,,,,,,";
const rate = (n: number, state: string, age: string, price: number, eff = "2026-01-01") =>
  `2026,${state},1000${n},HIOS,2025-10-15,${eff},2026-12-31,1000${n}${state}0010001,Rating Area 1,No Preference,${age},${price},,,,`;

function planLines() {
  const pc = planCollector();
  const lines = [ATTR_HEAD, ATTR_DENTAL, ...[1, 2, 3, 4, 5, 6].map((i) => medical(i, "TX", i === 6 ? "Expanded Bronze" : "Silver")), medical(7, "TX", "Silver", "SHOP")];
  lines.forEach(pc.onLine);
  return pc;
}

test("metal and age keys", () => {
  assert.equal(metalOf("Expanded Bronze"), "bronze");
  assert.equal(metalOf("Low"), null);
  assert.equal(ageKey("0-14"), "child");
  assert.equal(ageKey("64 and over"), "64");
  assert.equal(ageKey("40"), "40");
  assert.equal(ageKey("17"), null);
  assert.equal(ageKey("Family Tier Rates"), null);
});

test("plan collector keeps medical individual plans, quoted commas and all", () => {
  const pc = planLines();
  assert.equal(pc.plans.size, 6); // the dental row and the SHOP row are dropped
  assert.deepEqual(pc.plans.get("10001TX0010001"), { state: "TX", metal: "silver" });
  assert.equal(pc.plans.get("10006TX0010001")!.metal, "bronze");
});

test("a quoted cell with a line break is read as one row", () => {
  const pc = planCollector();
  pc.onLine(ATTR_HEAD);
  pc.onLine('2026,TX,10001,"Issuer, one",HIOS,10/15/2025,Individual,No,10001TX0010001,"Plan with');
  pc.onLine('a break",10001TX001,N1,S1,,New,PPO,Gold');
  assert.deepEqual(pc.plans.get("10001TX0010001"), { state: "TX", metal: "gold" });
});

test("rate collector joins on PlanId, keeps the plan year and aggregates by state and country", () => {
  const pc = planLines();
  const rc = rateCollector(pc.plans, 2026);
  [RATE_HEAD, RATE_DENTAL, ...[1, 2, 3, 4, 5].map((i) => rate(i, "TX", "40", 400 + i * 10)), rate(1, "TX", "40", 999, "2025-01-01"), rate(1, "TX", "17", 300), rate(1, "TX", "64 and over", 1200)].forEach(rc.onLine);
  const rows = rc.rows();
  const tx40 = rows.find((r) => r.area === "TX" && r.item === "silver/40")!;
  assert.equal(tx40.n, 5);
  assert.equal(tx40.median, 430);
  assert.ok(rows.find((r) => r.area === "ALL" && r.item === "silver/40"));
  assert.equal(rows.find((r) => r.item === "silver/64")!.n, 1);
  assert.equal(rows.find((r) => r.item === "silver/17"), undefined);
});

test("parameters are resolved", () => {
  assert.equal(resolveState(undefined), "ALL");
  assert.equal(resolveState("tx"), "TX");
  assert.throws(() => resolveState("Texas"), /two-letter/);
  assert.equal(resolveMetal(undefined), "silver");
  assert.throws(() => resolveMetal("copper"), /metal_level/);
  assert.equal(resolveAge({}).key, "40");
  assert.equal(resolveAge({ age_group: "young_adult" }).key, "21");
  assert.equal(resolveAge({ age: 70 }).key, "64");
  assert.equal(resolveAge({ age: 6 }).key, "child");
  assert.throws(() => resolveAge({ age: 16 }), /18/);
});

const lib = {
  date: "2026-01-01",
  rows: [
    { area: "TX", item: "silver/40", n: 5, median: 430, low: 410, high: 450, min: 410, max: 450 },
    { area: "TX", item: "gold/40", n: 3, median: 600, low: 590, high: 610, min: 590, max: 610 },
    { area: "ALL", item: "silver/40", n: 12, median: 440, low: 400, high: 500, min: 390, max: 520 },
  ],
};

test("answer: posted list premium, never paid, plan offers counted", () => {
  const a = premiumAnswer(lib, { area: "TX", metal_level: "silver", age: 40 });
  assert.equal(a.status, "ok");
  assert.equal(a.sample_size, 5);
  assert.equal(a.price_type, "posted_price");
  assert.match(a.summary, /before tax credits/);
  assert.match(a.summary, /plan offers/);
  assert.match(INFO.attribution, /not CMS data/);
});

test("answer: under 5 offers is not published; unknown state lists the states", () => {
  const thin = premiumAnswer(lib, { area: "TX", metal_level: "gold" });
  assert.equal(thin.status, "insufficient_data");
  assert.throws(() => premiumAnswer(lib, { area: "CA" }), /TX/);
  assert.equal(premiumAnswer(lib, {}).status, "ok");
});

function zipOf(csv: string): Uint8Array {
  const data = deflateRawSync(Buffer.from(csv));
  const name = Buffer.from("x.csv");
  const h = Buffer.alloc(30);
  h.writeUInt32LE(0x04034b50, 0);
  h.writeUInt16LE(8, 8);
  h.writeUInt16LE(name.length, 26);
  return Buffer.concat([h, name, data]);
}

test("harvest streams both zips, joins and aggregates", async () => {
  const attr = [ATTR_HEAD, ATTR_DENTAL];
  const rates = [RATE_HEAD, RATE_DENTAL];
  for (let p = 1; p <= 9; p++) {
    for (let k = 0; k < 600; k++) {
      const id = `${String(p).padStart(5, "0")}TX${String(k).padStart(7, "0")}`.slice(0, 14);
      attr.push(`2026,TX,${p},"Issuer ${p}",HIOS,10/15/2025,Individual,No,${id},"Plan ${k}",x,N1,S1,,New,PPO,Silver`);
      for (const age of ["40", "41", "42"]) rates.push(`2026,TX,${p},HIOS,2025-10-15,2026-01-01,2026-12-31,${id},Rating Area 1,No Preference,${age},${300 + p + k % 7},,,,`);
    }
  }
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request) => {
    const u = String(url);
    return new Response(zipOf((u.includes("plan-attributes") ? attr : rates).join("\r\n") + "\r\n"), { status: 200 });
  }) as typeof fetch;
  try {
    const h = await premiumsHarvest();
    assert.equal(h.date, "2026-01-01");
    assert.equal(h.currency, "USD");
    const tx = h.rows.find((r) => r.area === "TX" && r.item === "silver/40")!;
    assert.equal(tx.n, 5400);
    assert.ok(tx.median >= 301 && tx.median <= 316);
  } finally {
    globalThis.fetch = real;
  }
});
