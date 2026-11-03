// Hong Kong Voluntary Health Insurance Scheme (VHIS): standard premiums of certified plans, from the Health Bureau via DATA.GOV.HK.
// Format read on 2026-11-03 (plain GET from the cloud workspace, HTTP 200, no key):
//   https://www.vhis.gov.hk/public/data/plan-premium.zip -> 397,662 bytes, one file plan-premium.json (4.46 MB), 579 certified plans.
//   {"certified-plans":[{"certification-no":"S00012-01-000-03","prem-date":"20190401","currency":"HKD","age-counting-method":"A",
//     "premium":{"SFN":{"0":2177,"1":2177,...,"80":...},"SFY":{...},"SMN":{...},"SMY":{...},"RFN":{...}|null,"RFY":...,"RMN":...,"RMY":...}}, ...]}
// Data dictionary (https://www.vhis.gov.hk/public/data/vhis-standard-premium-data-dictionary.pdf, read 2026-11-03): premium class = 3 letters,
//   first S = standalone policy / R = rider; second M = male / F = female; third Y = smoker / N = non-smoker; value = HKD (or USD) per YEAR for that age.
//   Certification number S99999-99-999-99 = Standard Plan, F99999-99-999-99 = Flexi Plan. age-counting-method A attained age, R nearest birthday, N next birthday.
// We publish the 33 STANDARD plans only (standardised benefits, so the premiums compare like with like), in HKD. Flexi plans (439 in HKD) differ widely
// in benefits and are left out. One premium = the insurer's regulated standard premium for that plan, sex, smoking status and age: a POSTED list premium,
// not an amount paid. The big file is read once a day by the collector (harvest) and answers come from the library.

import { inflateRawSync } from "node:zlib";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import { NATIONAL, aggregateDaily } from "../../lib/library/aggregate";
import { readLatestDay } from "../../lib/library/store";
import type { HarvestResult, SourceInfo } from "../../lib/plugin";
import { MIN_PUBLISH } from "../../lib/stats";

export const INFO: SourceInfo = {
  id: "hk-vhis-premiums",
  country: "HK",
  category: "health insurance (Voluntary Health Insurance Scheme standard plans, standard premiums)",
  name: "VHIS standard premiums of certified plans (plan-premium.json)",
  publisher: "Health Bureau, Hong Kong SAR Government (Voluntary Health Insurance Scheme)",
  what_is_recorded:
    "One row per certified plan: certification number, effective date, currency, age counting method and the standard premium per year for each age, sex, smoking status and policy type (standalone or rider).",
  price_type: "posted_price",
  freshness: "Updated as and when necessary by the Health Bureau (file last modified 27 Oct 2026); our copy is collected daily",
  licence:
    'DATA.GOV.HK Terms and Conditions of Use (read 2026-11-03): use of the data is allowed "for both commercial and non-commercial purposes on a free-of-charge basis"; ' +
    'users must "identify clearly the source of the Data" and "give proper attribution to the Government, the Relevant Organisations and DATA.GOV.HK".',
  licence_url: "https://data.gov.hk/en/terms-and-conditions",
  attribution: "Source: Health Bureau, Hong Kong SAR Government (VHIS), via DATA.GOV.HK. ProofPrice aggregates; not endorsed by the Government.",
  homepage: "https://data.gov.hk/en-data/dataset/hk-hhb-hhbvhis-vhis-standard-premium",
  limits:
    "Posted standard premiums per year of VHIS Standard Plans, set by each insurer for its certified plan and the same for everyone of that age, sex and smoking status: not amounts paid and not a personal quote. " +
    "Only the Standard Plans priced in HKD are included (Flexi Plans and USD plans are left out), plans with an effective date still in the future are ignored, and the figure pools the plans without weighting by customers. " +
    "Plans count their age in different ways (attained age, nearest birthday or next birthday), which is not adjusted for. Rider premiums exist for fewer plans.",
};

export const DATA_URL = "https://www.vhis.gov.hk/public/data/plan-premium.zip";
const UA = { "user-agent": "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)" };

export type Policy = "standalone" | "rider";
export type Sex = "male" | "female";
export type Smoker = "smoker" | "non_smoker";

export interface Plan {
  no: string;
  date: string; // YYYY-MM-DD
  currency: string;
  premium: Record<string, Record<string, number | null> | null>;
}

/** Read the first (only) file of a zip held in memory: central directory -> local header -> raw deflate. */
export function unzipFirst(buf: Buffer): Buffer {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new SourceError("The VHIS download is not a zip file we can read (no end-of-archive record).");
  const cd = buf.readUInt32LE(eocd + 16);
  if (buf.readUInt32LE(cd) !== 0x02014b50) throw new SourceError("The VHIS zip has an unexpected layout (central directory).");
  const method = buf.readUInt16LE(cd + 10);
  const compSize = buf.readUInt32LE(cd + 20);
  const local = buf.readUInt32LE(cd + 42);
  if (buf.readUInt32LE(local) !== 0x04034b50) throw new SourceError("The VHIS zip has an unexpected layout (local header).");
  const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
  const body = buf.subarray(start, start + compSize);
  if (method === 0) return Buffer.from(body);
  if (method !== 8) throw new SourceError(`The VHIS zip uses compression method ${method}, which we cannot read.`);
  return inflateRawSync(body);
}

const isoDate = (d: string) => (/^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : "");

/** Parse plan-premium.json text into standard (S) plans priced in HKD whose effective date is not after `today` (YYYY-MM-DD). */
export function parsePlans(json: string, today: string): Plan[] {
  let doc: { "certified-plans"?: unknown };
  try { doc = JSON.parse(json); } catch { throw new SourceError("The VHIS file is not valid JSON."); }
  const list = doc["certified-plans"];
  if (!Array.isArray(list)) throw new SourceError("The VHIS file has no certified-plans list; this source needs updating.");
  const out: Plan[] = [];
  for (const p of list as Record<string, unknown>[]) {
    const no = String(p["certification-no"] ?? "");
    const date = isoDate(String(p["prem-date"] ?? ""));
    if (!no.startsWith("S") || p.currency !== "HKD" || !date || date > today) continue;
    if (!p.premium || typeof p.premium !== "object") continue;
    out.push({ no, date, currency: "HKD", premium: p.premium as Plan["premium"] });
  }
  return out;
}

export const itemKey = (policy: Policy, sex: Sex, smoker: Smoker, age: number) => `${policy}/${sex}/${smoker}/${age}`;

const POLICY: Record<string, Policy> = { S: "standalone", R: "rider" };
const SEX: Record<string, Sex> = { M: "male", F: "female" };
const SMOKE: Record<string, Smoker> = { Y: "smoker", N: "non_smoker" };

/** Aggregate the plans into library rows (policy x sex x smoking x age); cells with fewer than 5 plans are dropped. */
export function premiumRows(plans: Plan[]) {
  const recs: { area: string; item: string; price: number }[] = [];
  for (const p of plans) {
    for (const [cls, byAge] of Object.entries(p.premium)) {
      const m = /^([SR])([MF])([YN])$/.exec(cls);
      if (!m || !byAge || typeof byAge !== "object") continue;
      for (const [a, v] of Object.entries(byAge)) {
        const age = Number(a);
        if (!Number.isInteger(age) || age < 0 || age > 120 || typeof v !== "number" || !(v > 0)) continue;
        recs.push({ area: NATIONAL, item: itemKey(POLICY[m[1]], SEX[m[2]], SMOKE[m[3]], age), price: v });
      }
    }
  }
  return aggregateDaily(recs, false).filter((r) => r.n >= MIN_PUBLISH);
}

export async function premiumsHarvest(fetcher: typeof fetch = fetch, now: Date = new Date()): Promise<HarvestResult> {
  const res = await fetcher(DATA_URL, { headers: UA, signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new SourceError(`The VHIS premium file answered HTTP ${res.status}`);
  const plans = parsePlans(unzipFirst(Buffer.from(await res.arrayBuffer())).toString("utf-8"), now.toISOString().slice(0, 10));
  if (plans.length < MIN_PUBLISH) throw new SourceError(`Only ${plans.length} standard HKD plans could be read from the VHIS file; this source needs updating.`);
  const rows = premiumRows(plans);
  if (!rows.length) throw new SourceError("The VHIS file holds no premium cell with enough plans to publish.");
  // The newest effective date among the plans keeps one stored copy per change of premiums instead of one per day.
  const date = plans.reduce((a, p) => (p.date > a ? p.date : a), "0000-00-00");
  return {
    date,
    currency: "HKD",
    unit: "per year",
    rows,
    note: `VHIS Standard Plans in HKD effective on or before ${now.toISOString().slice(0, 10)}; n = number of certified plans (5 or more needed); posted standard premiums per year, not amounts paid.`,
  };
}

// ---------- answering ----------

export interface HkInput {
  insured_age?: number;
  age_group?: string;
  sex?: string;
  smoker?: string;
  policy_type?: string;
  baseUrl?: string;
}

const AGE_FROM_GROUP: Record<string, number> = { adult: 40, young_adult: 21, child: 10 };

export function resolveAge(input: Pick<HkInput, "insured_age" | "age_group">): { age: number; label: string } {
  if (input.insured_age !== undefined && input.insured_age !== null) {
    const n = Number(input.insured_age);
    if (!Number.isInteger(n) || n < 0 || n > 99) throw new InputError("insured_age must be a whole number of years from 0 to 99, for example 40.");
    return { age: n, label: `age ${n}` };
  }
  const g = (input.age_group ?? "adult").toLowerCase().replace(/[ -]/g, "_");
  const age = AGE_FROM_GROUP[g];
  if (age === undefined) throw new InputError("For Hong Kong give insured_age (for example 40) or age_group adult (age 40), young_adult (age 21) or child (age 10).");
  return { age, label: `age ${age}` };
}

export function resolveSex(raw: string | undefined): Sex {
  const t = (raw ?? "male").trim().toLowerCase();
  if (["m", "male", "man"].includes(t)) return "male";
  if (["f", "female", "woman"].includes(t)) return "female";
  throw new InputError("sex must be 'male' or 'female' (default male).");
}

export function resolveSmoker(raw: string | undefined): Smoker {
  const t = (raw ?? "no").trim().toLowerCase().replace(/[ -]/g, "_");
  if (["yes", "y", "true", "smoker"].includes(t)) return "smoker";
  if (["no", "n", "false", "non_smoker", "nonsmoker"].includes(t)) return "non_smoker";
  throw new InputError("smoker must be 'yes' or 'no' (default no).");
}

export function resolvePolicy(raw: string | undefined): Policy {
  const t = (raw ?? "standalone").trim().toLowerCase();
  if (["standalone", "stand_alone", "stand-alone", "s"].includes(t)) return "standalone";
  if (["rider", "r"].includes(t)) return "rider";
  throw new InputError("policy_type must be 'standalone' or 'rider' (default standalone).");
}

type LibRow = { area: string; item: string; n: number; median: number; low: number; high: number; min: number; max: number };

export function premiumAnswer(lib: { date: string; rows: LibRow[] }, input: HkInput): PriceAnswer {
  const age = resolveAge(input);
  const sex = resolveSex(input.sex);
  const smoker = resolveSmoker(input.smoker);
  const policy = resolvePolicy(input.policy_type);
  const row = lib.rows.find((r) => r.area === NATIONAL && r.item === itemKey(policy, sex, smoker, age.age));
  const answer = buildAnswer({
    source: INFO,
    query: { country: "HK", age: age.age, sex, smoker: smoker === "smoker" ? "yes" : "no", policy_type: policy },
    summary: row ? { count: row.n, median: row.median, low: row.low, high: row.high, min: row.min, max: row.max } : null,
    currency: "HKD",
    unit: "per year",
    period: { from: lib.date, to: lib.date },
    method:
      "Standard premiums per year of the VHIS Standard Plans (HKD) certified by the Health Bureau, in force on the data date. Median and 10th to 90th percentile across the certified plans for the chosen age, sex, smoking status and policy type; " +
      "not weighted by customers and with no adjustment for how each plan counts age. Posted list premiums, not amounts paid; at least 5 plans are needed.",
    describe: (s) =>
      `Standard premium of a VHIS Standard Plan in Hong Kong for a ${sex} ${smoker === "smoker" ? "smoker" : "non-smoker"} at ${age.label}, ${policy} policy: median ${fmtMoney(s.median, "HKD")} per year; ` +
      `10th to 90th percentile ${fmtMoney(s.low, "HKD")} to ${fmtMoney(s.high, "HKD")}. These are posted standard premiums, not amounts paid.`,
    baseUrl: input.baseUrl,
    published: lib.date,
    extra: {
      price_basis: "posted standard premium per year of a certified VHIS Standard Plan; not an amount paid",
      data_date: lib.date,
      age_resolved: age.age,
      sample_size_note: "sample_size is the number of certified plans behind the figure, not a number of people.",
    },
  });
  if (!row) {
    answer.summary = `No premium figure for a ${sex} ${smoker === "smoker" ? "smoker" : "non-smoker"} at ${age.label}, ${policy} policy: fewer than 5 certified Standard Plans publish a premium for it (rider premiums exist for only a few plans).`;
  } else {
    answer.summary = answer.summary.replace(/ Based on (\d+) records from [^.]*(?:\([^)]*\))?\./, ` Based on ${row.n} certified VHIS Standard Plans (${INFO.publisher}, data date ${lib.date}).`);
  }
  return answer;
}

export async function hkPremiums(input: HkInput): Promise<PriceAnswer> {
  resolveAge(input); resolveSex(input.sex); resolveSmoker(input.smoker); resolvePolicy(input.policy_type);
  const lib = readLatestDay(INFO.id);
  if (!lib) throw new SourceError("Our copy of the VHIS premium file has not been collected yet (it is read by the daily collector, never per request). Try again after the next collection.");
  return premiumAnswer(lib, input);
}
