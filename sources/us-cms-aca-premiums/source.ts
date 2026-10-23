// US health insurance marketplace premiums (HealthCare.gov states), from the CMS Health Insurance Exchange Public Use Files, plan year 2026.
// Formats read on 2026-10-23 (GitHub Actions probe, HTTP 200, no key):
//   https://download.cms.gov/marketplace-puf/2026/plan-attributes-puf.zip -> plan-attributes-puf.csv (32 MB, UTF-8 with BOM, 151 columns, last-modified 2026-08-10). Header (first columns):
//     BusinessYear,StateCode,IssuerId,IssuerMarketPlaceMarketingName,SourceName,ImportDate,MarketCoverage,DentalOnlyPlan,StandardComponentId,PlanMarketingName,HIOSProductId,NetworkId,ServiceAreaId,FormularyId,IsNewPlan,PlanType,MetalLevel,...
//     2026,AK,21989,Delta Dental of Alaska,HIOS,10/15/2025,Individual,Yes,21989AK0030001,Delta Dental Premier Plan,...,Indemnity,Low,...,21989AK0030001-00,...
//   https://download.cms.gov/marketplace-puf/2026/rate-puf.zip -> rate-puf.csv (281 MB). Header: BusinessYear,StateCode,IssuerId,SourceName,ImportDate,RateEffectiveDate,RateExpirationDate,PlanId,RatingAreaId,Tobacco,Age,IndividualRate,IndividualTobaccoRate,Couple,...
//     2026,AK,21989,HIOS,2025-10-15,2026-01-01,2026-12-31,21989AK0030001,Rating Area 1,No Preference,0-14,65.0,,,,,,,,
// Rate.PlanId (14 characters) = PlanAttributes.StandardComponentId. One rate row = one plan in one rating area for one age: the monthly premium BEFORE any
// tax credit, a POSTED list price. The harvest joins the two files, keeps medical plans of the individual market, and writes aggregates only
// (state x metal level x age). The 281 MB file is streamed in the daily collector and never fetched per request.

import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import { NATIONAL } from "../../lib/library/aggregate";
import { readLatestDay } from "../../lib/library/store";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { summarise } from "../../lib/stats";
import { csvFields } from "../ca-statcan-tuition/source";
import { forEachZipLine } from "../no-fiskeridir-fish/source";

export const INFO: SourceInfo = {
  id: "us-cms-aca-premiums",
  country: "US",
  category: "health insurance (ACA marketplace plans, listed premiums before subsidies)",
  name: "Health Insurance Exchange Public Use Files: Rate PUF and Plan Attributes PUF",
  publisher: "Centers for Medicare & Medicaid Services (CMS), US Department of Health and Human Services",
  what_is_recorded:
    "One row per marketplace plan, rating area and age: the monthly premium in USD before tax credits, with the plan's metal level and market.",
  price_type: "posted_price",
  freshness: "Once a year: plan-year files are published in autumn (plan year 2026 files last modified 10 Aug 2026)",
  licence:
    'US federal government data, public domain: data.gov record "Rate PUF – PY2026" licence https://www.usa.gov/publicdomain/label/1.0/ (read 2026-10-23). ' +
    'The CMS Exchange PUF Data Disclaimer-User Agreement adds: "The user may not present or otherwise reference data that have been altered in any way as CMS data." No commercial-use restriction is stated.',
  licence_url: "https://catalog.data.gov/dataset/rate-puf-py2026",
  attribution:
    "Derived from Centers for Medicare & Medicaid Services, 2026 Health Insurance Exchange Public Use Files (Rate PUF, Plan Attributes PUF). ProofPrice aggregates; not CMS data and not endorsed by CMS.",
  homepage: "https://www.cms.gov/marketplace/resources/data/public-use-files",
  limits:
    "Listed monthly premiums before any premium tax credit, the same for everyone of that age in a rating area: posted prices, not amounts paid, and not a quote. " +
    "Only states that use HealthCare.gov are included (some state-run exchanges publish elsewhere). The figure pools every plan offered in the state's rating areas without weighting by enrolment; " +
    "expanded bronze plans are counted as bronze. Non-smoker rates; cost-sharing variants of a plan count once. Dental-only plans and the small-business (SHOP) market are excluded.",
};

export const RATE_URL = "https://download.cms.gov/marketplace-puf/2026/rate-puf.zip";
export const ATTR_URL = "https://download.cms.gov/marketplace-puf/2026/plan-attributes-puf.zip";
export const PLAN_YEAR = 2026;
const UA = { "user-agent": "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)" };

export const METALS = ["bronze", "silver", "gold", "platinum", "catastrophic"] as const;
export type Metal = (typeof METALS)[number];

export function metalOf(raw: string): Metal | null {
  const t = raw.toLowerCase();
  return METALS.find((m) => t.includes(m)) ?? null;
}

/** Age cell of the Rate PUF -> library age key: "child" (0-14), "18".."63", "64" (64 and over); other ages are not kept. */
export function ageKey(raw: string): string | null {
  const t = raw.trim().toLowerCase();
  if (t === "0-14") return "child";
  if (t.startsWith("64")) return "64";
  if (!/^\d{1,2}$/.test(t)) return null;
  const n = Number(t);
  return n >= 18 && n <= 63 ? String(n) : null;
}

export const itemKey = (metal: string, age: string) => `${metal}/${age}`;

export interface Plan {
  state: string;
  metal: Metal;
}

/** Plan Attributes: the line handler keeps medical individual-market plans by StandardComponentId. Handles cells that contain line breaks inside quotes. */
export function planCollector() {
  const plans = new Map<string, Plan>();
  let idx: Record<string, number> | null = null;
  let pending = "";
  const onLine = (raw: string) => {
    const line = pending ? pending + "\n" + raw : raw;
    if ((line.match(/"/g)?.length ?? 0) % 2 === 1) {
      pending = line;
      return;
    }
    pending = "";
    if (!line.trim()) return;
    const c = csvFields(line);
    if (!idx) {
      idx = {};
      c.forEach((h, i) => (idx![h.replace(/^﻿/, "")] = i));
      for (const need of ["StateCode", "MarketCoverage", "DentalOnlyPlan", "StandardComponentId", "MetalLevel"]) {
        if (idx[need] === undefined) throw new SourceError(`The CMS Plan Attributes file has no column ${need}; this source needs updating.`);
      }
      return;
    }
    if (c[idx.MarketCoverage] !== "Individual" || c[idx.DentalOnlyPlan] !== "No") return;
    const metal = metalOf(c[idx.MetalLevel] ?? "");
    const id = (c[idx.StandardComponentId] ?? "").trim();
    const state = (c[idx.StateCode] ?? "").trim().toUpperCase();
    if (!metal || id.length !== 14 || !/^[A-Z]{2}$/.test(state)) return;
    plans.set(id, { state, metal });
  };
  return { plans, onLine };
}

/** Rate PUF: the line handler collects prices per state x metal x age (and for the whole country). */
export function rateCollector(plans: Map<string, Plan>, planYear: number) {
  const groups = new Map<string, number[]>();
  const add = (state: string, item: string, v: number) => {
    const k = `${state}\u0000${item}`;
    const g = groups.get(k);
    if (g) g.push(v);
    else groups.set(k, [v]);
  };
  let idx: Record<string, number> | null = null;
  let kept = 0;
  const effective = `${planYear}-01-01`;
  const onLine = (line: string) => {
    if (!line) return;
    if (!idx) {
      idx = {};
      line.replace(/^﻿/, "").split(",").forEach((h, i) => (idx![h] = i));
      for (const need of ["RateEffectiveDate", "PlanId", "Age", "IndividualRate"]) {
        if (idx[need] === undefined) throw new SourceError(`The CMS Rate PUF has no column ${need}; this source needs updating.`);
      }
      return;
    }
    const c = line.split(","); // the first 12 columns never hold quoted commas
    if (c[idx.RateEffectiveDate] !== effective) return;
    const plan = plans.get(c[idx.PlanId]);
    if (!plan) return;
    const age = ageKey(c[idx.Age] ?? "");
    const rate = Number(c[idx.IndividualRate]);
    if (!age || !Number.isFinite(rate) || rate <= 0) return;
    const item = itemKey(plan.metal, age);
    add(plan.state, item, rate);
    add(NATIONAL, item, rate);
    kept++;
  };
  return {
    onLine,
    get kept() {
      return kept;
    },
    rows(): DailyRow[] {
      const out: DailyRow[] = [];
      for (const [k, prices] of groups) {
        const [area, item] = k.split("\u0000");
        const s = summarise(prices);
        if (s) out.push({ area, item, n: s.count, median: s.median, low: s.low, high: s.high, min: s.min, max: s.max });
      }
      return out.sort((a, b) => a.area.localeCompare(b.area) || a.item.localeCompare(b.item));
    },
  };
}

async function zipBody(url: string): Promise<AsyncIterable<Uint8Array>> {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(280000) });
  if (!res.ok || !res.body) throw new SourceError(`CMS file ${url.split("/").pop()} answered HTTP ${res.status}`);
  return res.body as unknown as AsyncIterable<Uint8Array>;
}

export async function premiumsHarvest(): Promise<HarvestResult> {
  const pc = planCollector();
  await forEachZipLine(await zipBody(ATTR_URL), pc.onLine);
  if (pc.plans.size < 500) throw new SourceError(`Only ${pc.plans.size} marketplace plans could be read from the CMS Plan Attributes file; this source needs updating.`);
  const rc = rateCollector(pc.plans, PLAN_YEAR);
  await forEachZipLine(await zipBody(RATE_URL), rc.onLine);
  if (rc.kept < 10000) throw new SourceError(`Only ${rc.kept} usable rate rows could be read from the CMS Rate PUF; this source needs updating.`);
  return {
    // Yearly files: one library date per plan year (the same on every daily run).
    date: `${PLAN_YEAR}-01-01`,
    currency: "USD",
    unit: "per month",
    rows: rc.rows(),
    note: `CMS Exchange PUF plan year ${PLAN_YEAR}, HealthCare.gov states, individual market, medical plans. n = plan offers (a plan in a rating area counts once), not people. Listed premiums before tax credits.`,
  };
}

// ---------- answering ----------

export interface UsPremiumInput {
  area?: string;
  age?: number;
  age_group?: string;
  metal_level?: string;
  baseUrl?: string;
}

const AGE_FROM_GROUP: Record<string, string> = { adult: "40", young_adult: "21", child: "child" };

export function resolveAge(input: { age?: number; age_group?: string }): { key: string; label: string } {
  if (input.age !== undefined && input.age !== null) {
    const n = Number(input.age);
    if (!Number.isInteger(n) || n < 0 || n > 120) throw new InputError("age must be a whole number of years, for example 40.");
    if (n <= 14) return { key: "child", label: "a child (0-14)" };
    if (n < 18) throw new InputError("Marketplace rates in this data start at age 18 (children 0-14 share one rate); ages 15-17 are not published separately.");
    return n >= 64 ? { key: "64", label: "age 64 and over" } : { key: String(n), label: `age ${n}` };
  }
  const g = (input.age_group ?? "adult").toLowerCase().replace(/[ -]/g, "_");
  const key = AGE_FROM_GROUP[g];
  if (!key) throw new InputError("For the US give age (for example 40) or age_group adult (age 40), young_adult (age 21) or child (0-14).");
  return { key, label: key === "child" ? "a child (0-14)" : `age ${key}` };
}

export function resolveMetal(raw: string | undefined): Metal {
  const t = (raw ?? "silver").trim().toLowerCase();
  const m = metalOf(t);
  if (!m) throw new InputError(`metal_level must be one of: ${METALS.join(", ")} (default silver).`);
  return m;
}

export function resolveState(raw: string | undefined): string {
  const t = (raw ?? "").trim().toUpperCase();
  if (!t || t === "US" || t === "ALL") return NATIONAL;
  if (!/^[A-Z]{2}$/.test(t)) throw new InputError(`'${raw}' is not a US state code. Give a two-letter code such as TX or FL, or leave area out for all HealthCare.gov states together.`);
  return t;
}

type LibRow = { area: string; item: string; n: number; median: number; low: number; high: number; min: number; max: number };

export function premiumAnswer(lib: { date: string; rows: LibRow[] }, input: UsPremiumInput): PriceAnswer {
  const area = resolveState(input.area);
  const metal = resolveMetal(input.metal_level);
  const age = resolveAge(input);
  const states = [...new Set(lib.rows.map((r) => r.area))].filter((a) => a !== NATIONAL).sort();
  if (area !== NATIONAL && !states.includes(area)) {
    throw new InputError(`No marketplace premium figures for state '${area}'. The data covers the states on HealthCare.gov: ${states.join(", ")}. State-run exchanges are not included.`);
  }
  const row = lib.rows.find((r) => r.area === area && r.item === itemKey(metal, age.key));
  const year = Number(lib.date.slice(0, 4));
  const where = area === NATIONAL ? "the HealthCare.gov states" : `state ${area}`;
  const answer = buildAnswer({
    source: INFO,
    query: { country: "US", area: area === NATIONAL ? null : area, metal_level: metal, age: age.key },
    summary: row ? { count: row.n, median: row.median, low: row.low, high: row.high, min: row.min, max: row.max } : null,
    currency: "USD",
    unit: "per month",
    period: { from: `${year}-01-01`, to: `${year}-12-31` },
    method:
      "Listed monthly premiums (before tax credits) of individual-market medical plans on HealthCare.gov for the plan year, from the CMS Exchange public use files. Median and 10th to 90th percentile across plan offers " +
      "(each plan counted once per rating area) in the state for the chosen metal level and age, non-smoker rate; not weighted by enrolment. Posted list prices, not amounts paid; at least 5 plan offers are needed.",
    describe: (s) =>
      `Listed monthly premium of a ${metal} marketplace plan for ${age.label} in ${where}, plan year ${year}, before tax credits: median ${fmtMoney(s.median, "USD")}; ` +
      `10th to 90th percentile ${fmtMoney(s.low, "USD")} to ${fmtMoney(s.high, "USD")}. These are posted list premiums, not amounts paid.`,
    baseUrl: input.baseUrl,
    published: lib.date,
    extra: {
      price_basis: "posted list premium per month before subsidies; not an amount paid",
      plan_year: year,
      area_resolved: where,
      metal_level: metal,
      age_resolved: age.key,
      states_available: states,
      sample_size_note: "sample_size is the number of plan offers (a plan in a rating area), not a number of people.",
    },
  });
  if (!row) {
    answer.summary = `No premium figure for a ${metal} plan, ${age.label}, in ${where}: fewer than 5 plan offers match (catastrophic plans exist only for some states and young adults).`;
  } else {
    answer.summary = answer.summary.replace(/ Based on (\d+) records from [^.]*(?:\([^)]*\))?\./, ` Based on ${row.n} marketplace plan offers (${INFO.publisher}, plan year ${year}).`);
  }
  return answer;
}

export async function usPremiums(input: UsPremiumInput): Promise<PriceAnswer> {
  resolveState(input.area);
  resolveMetal(input.metal_level);
  resolveAge(input);
  const lib = readLatestDay(INFO.id);
  if (!lib) throw new SourceError("Our copy of the CMS marketplace premium files has not been collected yet (it is read by the daily collector, never per request). Try again after the next collection.");
  return premiumAnswer(lib, input);
}
