// Singapore childcare centre fees (ECDA "Listing of Centre Services", data.gov.sg dataset d_44cfe12f2858ae503a093dfc075a28be).
// One row per centre, level and citizenship group: the monthly fee in S$ that the centre lists with ECDA (the early childhood regulator).
// The dataset is about 45,000 rows (12.8 MB), so requests never read it: the daily collector (harvest) pages through it, keeps each centre's
// newest listed fee per level and citizenship, and stores one aggregate per level and citizenship in the price library. Aggregates only:
// centre names and codes are used in memory to count centres and are never stored.
// POSTED fees (before government subsidies), not what any parent paid.

import { InputError, SourceError } from "../../lib/http";
import { MIN_PUBLISH } from "../../lib/stats";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { aggregateDaily, NATIONAL } from "../../lib/library/aggregate";
import { readLatestDay, readMeta } from "../../lib/library/store";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";

export const INFO: SourceInfo = {
  id: "sg-ecda-childcare",
  country: "Singapore",
  category: "childcare (monthly centre fees listed with the regulator)",
  name: "Listing of Centre Services (ECDA)",
  publisher: "Early Childhood Development Agency (ECDA), via data.gov.sg",
  what_is_recorded:
    "The monthly fee in Singapore dollars that one licensed childcare centre lists with ECDA for one level (infant to Kindergarten 2), for full-day care and for one citizenship group (Singapore citizen, permanent resident, other).",
  price_type: "posted_price",
  freshness: "Rolling: each centre updates its own listing; the newest update is shown with the answer",
  licence: "Singapore Open Data Licence v1.0 (free to use, also commercially, with attribution)",
  licence_url: "https://data.gov.sg/open-data-licence",
  attribution:
    "Contains information from Listing of Centre Services accessed on the data.gov.sg portal from the Early Childhood Development Agency, which is made available under the terms of the Singapore Open Data Licence version 1.0 https://data.gov.sg/open-data-licence. Changed by ProofPrice: for each level and citizenship group we report the median and 10th to 90th percentile across centres. Not endorsed by ECDA.",
  homepage: "https://data.gov.sg/datasets/d_44cfe12f2858ae503a093dfc075a28be/view",
  limits:
    "Posted monthly fees that centres list with ECDA for full-day care, before any government subsidy or anchor-operator discount, not what a parent paid. " +
    "The figures are across centres, not across children, and are not weighted by places. Fees differ by citizenship (Singapore citizen, permanent resident, other), so the answer names the group. " +
    "Half-day kindergarten programmes and school-age (student care) are not in the dataset. Centre names and codes are not stored; a figure needs 5 or more centres.",
};

export const DATASET = "d_44cfe12f2858ae503a093dfc075a28be";
export const ROWS_URL = `https://api-production.data.gov.sg/v2/public/api/datasets/${DATASET}/list-rows`;
export const PAGE_SIZE = 10000;
export const MAX_PAGES = 15;
export const MAX_FEE = 10000; // S$ a month; a listed fee above this is an entry error
export const STALE_AFTER_DAYS = 180;
const UA = { "user-agent": "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)" };

/** The levels the dataset lists, in age order, with the age group each belongs to. */
export const LEVELS: { level: string; match: RegExp; age: "infant" | "toddler" | "preschool" | "school-age"; label: string }[] = [
  { level: "Infant", match: /^infant/i, age: "infant", label: "Infant (2 to 18 months)" },
  { level: "Playgroup", match: /^playgroup/i, age: "toddler", label: "Playgroup (18 months to 2 years)" },
  { level: "Pre-Nursery", match: /^pre-?\s*nursery/i, age: "preschool", label: "Pre-Nursery (3 years)" },
  { level: "Nursery", match: /^nursery/i, age: "preschool", label: "Nursery (4 years)" },
  { level: "Kindergarten 1", match: /^k(indergarten|\.)?\s*1/i, age: "preschool", label: "Kindergarten 1 (5 years)" },
  { level: "Kindergarten 2", match: /^k(indergarten|\.)?\s*2/i, age: "preschool", label: "Kindergarten 2 (6 years)" },
];
/** Pool of the two levels that make up the category's "preschool" (3 to 4 years). */
export const PRESCHOOL = "Preschool (3-4 years)";
const PRESCHOOL_PARTS = ["Pre-Nursery", "Nursery"];

export const CITIZENSHIPS: { code: string; label: string; aliases: string[] }[] = [
  { code: "SC", label: "Singapore citizen", aliases: ["sc", "citizen", "singapore citizen", "singaporean", "local"] },
  { code: "SPR", label: "Singapore permanent resident", aliases: ["spr", "pr", "permanent resident", "permanent", "singapore permanent resident"] },
  { code: "Others", label: "other (foreign) families", aliases: ["others", "other", "foreigner", "foreign", "non-resident", "expat", "international", "non citizen", "non-citizen"] },
];

export function levelOf(raw: string): string | null {
  const t = String(raw ?? "").trim();
  for (const l of LEVELS) if (l.match.test(t)) return l.level;
  return null;
}

export function citizenshipOf(raw: string): string | null {
  const t = String(raw ?? "").trim().toLowerCase();
  if (!t) return null;
  for (const c of CITIZENSHIPS) if (c.code.toLowerCase() === t || c.aliases.includes(t)) return c.code;
  return null;
}

export interface RawRow {
  centre_code?: string;
  class_of_licence?: string;
  type_of_service?: string;
  levels_offered?: string;
  fees?: string | number;
  type_of_citizenship?: string;
  last_updated?: string;
}

/** Rows and the cursor for the next page from one list-rows response; fails loudly if the layout changed. */
export function parsePage(json: any): { rows: RawRow[]; next: string | null } {
  const rows = json?.data?.rows;
  if (!Array.isArray(rows)) throw new SourceError("data.gov.sg list-rows answered in an unexpected layout (no data.rows)");
  const next = json?.data?.links?.next;
  return { rows, next: typeof next === "string" && next ? next : null };
}

/** One centre's newest fee for a level and citizenship. */
export interface Fee { centre: string; level: string; cit: string; fee: number; updated: string }

export class Fees {
  private map = new Map<string, Fee>();
  read = 0;
  dropped = { service: 0, level: 0, citizenship: 0, fee: 0 };
  add(r: RawRow): void {
    this.read++;
    if (!/^full\s*day$/i.test(String(r.type_of_service ?? "").trim())) { this.dropped.service++; return; }
    const level = levelOf(String(r.levels_offered ?? ""));
    if (!level) { this.dropped.level++; return; }
    const cit = citizenshipOf(String(r.type_of_citizenship ?? ""));
    if (!cit) { this.dropped.citizenship++; return; }
    const fee = Number(String(r.fees ?? "").replace(/[^0-9.]/g, ""));
    const centre = String(r.centre_code ?? "").trim();
    if (!centre || !(fee > 0) || fee > MAX_FEE) { this.dropped.fee++; return; }
    const updated = /^\d{4}-\d{2}-\d{2}/.test(String(r.last_updated ?? "")) ? String(r.last_updated).slice(0, 10) : "";
    const k = `${centre}\u0000${level}\u0000${cit}`;
    const cur = this.map.get(k);
    if (!cur || updated > cur.updated) this.map.set(k, { centre, level, cit, fee, updated });
  }
  entries(): Fee[] { return [...this.map.values()]; }
}

export const itemKey = (level: string, cit: string) => `${level}|${cit}`;
const round2 = (v: number) => Math.round(v * 100) / 100;

export interface Built { rows: DailyRow[]; date: string | null; centres: number; oldest: string | null }

/** Library rows: area ALL, item "<level>|<citizenship>", n = centres. The preschool pool takes each centre's mean fee over Pre-Nursery and Nursery. */
export function buildRows(fees: Fee[]): Built {
  const recs: { area: string; item: string; price: number }[] = [];
  for (const f of fees) recs.push({ area: NATIONAL, item: itemKey(f.level, f.cit), price: f.fee });
  // preschool pool: one value per centre and citizenship group
  const per = new Map<string, number[]>();
  for (const f of fees) {
    if (!PRESCHOOL_PARTS.includes(f.level)) continue;
    const k = `${f.centre}\u0000${f.cit}`;
    const a = per.get(k);
    if (a) a.push(f.fee); else per.set(k, [f.fee]);
  }
  for (const [k, v] of per) {
    const cit = k.split("\u0000")[1];
    recs.push({ area: NATIONAL, item: itemKey(PRESCHOOL, cit), price: round2(v.reduce((a, b) => a + b, 0) / v.length) });
  }
  const rows = aggregateDaily(recs, false).filter((r) => r.n >= MIN_PUBLISH);
  const dates = fees.map((f) => f.updated).filter(Boolean).sort();
  return { rows, date: dates.length ? dates[dates.length - 1] : null, centres: new Set(fees.map((f) => f.centre)).size, oldest: dates[0] ?? null };
}

async function getPage(url: string): Promise<any> {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(90000) });
  if (!res.ok) throw new SourceError(`data.gov.sg returned HTTP ${res.status} for the ECDA centre listing`);
  return res.json();
}

export async function ecdaHarvest(): Promise<HarvestResult> {
  const fees = new Fees();
  let url = `${ROWS_URL}?limit=${PAGE_SIZE}`;
  let pages = 0;
  for (; pages < MAX_PAGES; ) {
    const { rows, next } = parsePage(await getPage(url));
    pages++;
    for (const r of rows) fees.add(r);
    if (!next || !rows.length) break;
    url = `${ROWS_URL}?${next}`;
  }
  if (pages >= MAX_PAGES) throw new SourceError(`ECDA centre listing did not end after ${MAX_PAGES} pages (layout changed?)`);
  const built = buildRows(fees.entries());
  if (!built.rows.length || !built.date) throw new SourceError(`ECDA centre listing held no usable fees (${fees.read} rows read)`);
  const d = fees.dropped;
  return {
    date: built.date,
    currency: "SGD",
    unit: "per month, full-day care",
    rows: built.rows,
    note: `${pages} pages, ${fees.read} rows read, ${built.centres} centres; newest centre update ${built.date}, oldest ${built.oldest}; dropped: ${d.service} non full-day, ${d.level} unknown level, ${d.citizenship} unknown citizenship, ${d.fee} bad fee.`,
  };
}

// ---------- answering ----------
export interface LibraryDay { date: string; rows: DailyRow[] }

const AGE_TO_ITEM: Record<string, string> = { infant: "Infant", toddler: "Playgroup", preschool: PRESCHOOL };

function methodText(): string {
  return (
    "Median and 10th–90th percentile, across licensed childcare centres, of the monthly full-day fee that each centre lists with ECDA for the level and citizenship group, in Singapore dollars, from the Listing of Centre Services on data.gov.sg (collected daily into our price library). " +
    "Posted fees before government subsidies, not what a parent paid; n is the number of centres (5 or more needed); each centre's newest listing counts once."
  );
}

const dayNumber = (d: string) => Math.round(Date.parse(d + "T00:00:00Z") / 86400000);

export interface Input { age_group?: string; level?: string; citizenship?: string; care_type?: string; hours?: string; area?: string; baseUrl?: string; today?: string }

/** The library item for a request, or an InputError that says what to ask instead. */
export function resolveItem(i: Input): { item: string; levelLabel: string; cit: string } {
  if (i.care_type && i.care_type !== "centre") throw new InputError("care_type must be 'centre' for Singapore: the ECDA listing covers licensed childcare centres only (no home-based care).");
  if (i.hours && i.hours !== "full-time") throw new InputError("hours must be 'full-time' for Singapore: the ECDA listing gives full-day fees only. Leave hours out.");
  if (i.area && !/^(singapore|sg|all|nationwide|whole country)$/i.test(i.area.trim())) {
    throw new InputError("area is not available for Singapore: the ECDA listing has no location field. Leave area out for the national figure across all centres.");
  }
  let cit = "SC";
  if (i.citizenship) {
    const c = citizenshipOf(i.citizenship);
    if (!c) throw new InputError(`citizenship must be one of: ${CITIZENSHIPS.map((x) => `'${x.code}' (${x.label})`).join(", ")}.`);
    cit = c;
  }
  let item = PRESCHOOL;
  if (i.level) {
    const t = i.level.trim();
    const lv = levelOf(t) ?? (/^preschool/i.test(t) ? PRESCHOOL : null);
    if (!lv) throw new InputError(`level must be one of: ${[...LEVELS.map((l) => l.level), PRESCHOOL].join(", ")}.`);
    item = lv;
  } else if (i.age_group) {
    if (i.age_group === "school-age") throw new InputError("age_group school-age is not in the ECDA centre listing (it covers infant to Kindergarten 2). Use infant, toddler or preschool, or a level such as 'Kindergarten 2'.");
    item = AGE_TO_ITEM[i.age_group] ?? PRESCHOOL;
  }
  const levelLabel = item === PRESCHOOL ? PRESCHOOL : LEVELS.find((l) => l.level === item)!.label;
  return { item, levelLabel, cit };
}

export function ecdaAnswerFromRows(day: LibraryDay, input: Input): PriceAnswer {
  const { item, levelLabel, cit } = resolveItem(input);
  const citLabel = CITIZENSHIPS.find((c) => c.code === cit)!.label;
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  const ageDays = dayNumber(today) - dayNumber(day.date);
  const stale = ageDays > STALE_AFTER_DAYS;
  const row = day.rows.find((r) => r.area === NATIONAL && r.item === itemKey(item, cit) && r.n >= MIN_PUBLISH);
  const query = { country: "SG", level: levelLabel, citizenship: cit };
  if (!row) {
    return buildAnswer({
      source: INFO, query, summary: null, currency: "SGD", unit: "per month, full-day care",
      period: { from: null, to: day.date }, method: methodText(), describe: () => "", baseUrl: input.baseUrl,
      extra: { hint: `Fewer than 5 centres list a full-day fee for ${levelLabel} for ${citLabel}. Try another level or citizenship group.` },
    });
  }
  const others = CITIZENSHIPS.filter((c) => c.code !== cit)
    .map((c) => ({ c, r: day.rows.find((x) => x.area === NATIONAL && x.item === itemKey(item, c.code) && x.n >= MIN_PUBLISH) }))
    .filter((x) => x.r)
    .map((x) => ({ citizenship: x.c.code, median_sgd: x.r!.median, centres: x.r!.n }));
  return buildAnswer({
    source: INFO,
    query,
    summary: { count: row.n, median: row.median, low: row.low, high: row.high, min: row.min, max: row.max },
    currency: "SGD",
    unit: "per month, full-day care",
    period: { from: null, to: day.date },
    method: methodText(),
    describe: (x) =>
      `Singapore childcare centres list a full-day fee for ${levelLabel} for ${citLabel} at a median of ${fmtMoney(x.median, "SGD")} a month; ` +
      `10th–90th percentile ${fmtMoney(x.low, "SGD")}–${fmtMoney(x.high, "SGD")} across centres. ` +
      `These are posted fees listed with ECDA before government subsidies, not what parents paid; the newest centre update is ${day.date}.` +
      (stale ? ` The newest listing in our copy is ${ageDays} days old.` : ""),
    baseUrl: input.baseUrl,
    extra: {
      centres: row.n,
      citizenship: cit,
      level: levelLabel,
      fees_before_subsidy: true,
      ...(others.length ? { other_citizenship_groups: others } : {}),
      ...(!input.citizenship ? { citizenship_defaulted_to: "SC" } : {}),
      ...(stale ? { stale: true, days_since_newest: ageDays } : {}),
    },
  });
}

export async function ecdaChildcare(input: Input): Promise<PriceAnswer> {
  resolveItem(input); // refuse bad options before touching the library
  const meta = readMeta(INFO.id);
  const day = readLatestDay(INFO.id);
  if (!meta?.last_date || !day) throw new SourceError("ProofPrice collects the ECDA centre listing daily; data appears after the next collection.");
  return ecdaAnswerFromRows(day, input);
}

export function ecdaHistoryKey(p: Input): { area: string; item: string; label: string } | null {
  try {
    const { item, levelLabel, cit } = resolveItem(p);
    return { area: NATIONAL, item: itemKey(item, cit), label: `${levelLabel}, ${cit}, Singapore` };
  } catch {
    return null;
  }
}

