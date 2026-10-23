// Canada childcare: Statistics Canada table 42-10-0071-01, "Centre-based child care providers by daily fees charged" (April 2024 survey).
// One published average daily fee per province or territory and age group of the child. Posted fees, no sample size, no range.
//
// Format checked live on 2026-10-23 (GitHub Actions probe, HTTP 200, application/zip, 8,424 bytes, no key):
//   https://www150.statcan.gc.ca/n1/tbl/csv/42100071-eng.zip -> 42100071.csv (76 KB, UTF-8 with BOM, 335 data rows, quoted fields), REF_DATE 2024 only
//   header: "REF_DATE","GEO","DGUID","Indicator","UOM","UOM_ID","SCALAR_FACTOR","SCALAR_ID","VECTOR","COORDINATE","VALUE","STATUS","SYMBOL","TERMINATED","DECIMALS"
//   "2024","Ontario, toddlers, children aged 18 months to less than 30 months","","Average daily fee of centre-based child care providers","Dollars","81",...,"36.24","A","","","2"
//   GEO = province or territory + the province's OWN age group, in one text field (every province cuts the ages differently).
//   Other indicators in the file are shares of centres at fee bands (UOM Percent): skipped. A missing figure has VALUE "" and STATUS "..".
// The file is tiny and a one-off survey: it is fetched per request (cached in memory six hours). A daily copy (harvest) lets a Statistics Canada
// outage be answered from our copy for seven days (stale-if-error).

import { InputError, SourceError } from "../../lib/http";
import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import type { HarvestResult, SourceInfo } from "../../lib/plugin";
import { NO_COUNT } from "../../lib/stats";
import { PROVINCES, provinceFor } from "../_ca-statcan/geo";
// The zip reader, CSV splitter and downloader are shared with the Statistics Canada tuition source (exported there; imported, not edited).
import { csvFields, downloadZip, unzipCsv } from "../ca-statcan-tuition/source";

export const TABLE_NAME = "table 42-10-0071-01, Centre-based child care providers by daily fees charged, April 2024";
export const ZIP_URL = "https://www150.statcan.gc.ca/n1/tbl/csv/42100071-eng.zip";
export const HOMEPAGE = "https://open.canada.ca/data/en/dataset/5e487047-ebd1-4146-92f7-3533ebbd1c01";
export const LICENCE_URL = "https://open.canada.ca/en/open-government-licence-canada";
const INDICATOR = "Average daily fee of centre-based child care providers";

export const INFO: SourceInfo = {
  id: "ca-statcan-childcare",
  country: "CA (Canada)",
  category: "childcare (official centre-based daily fee statistics)",
  name: "Centre-based child care providers by daily fees charged (Statistics Canada table 42-10-0071-01)",
  publisher: "Statistics Canada",
  what_is_recorded:
    "The average daily fee, in Canadian dollars, that centre-based child care providers charged in April 2024, by province or territory and by the age group of the child " +
    "(every province defines its own age groups, for example infants, toddlers, preschool, kindergarten and school age). One published average per province and age group, from the Survey of Early Learning and Child Care Providers.",
  price_type: "official_statistic",
  freshness: "April 2024 survey (published 2025, a single survey year)",
  licence: "Open Government Licence - Canada (commercial use allowed with acknowledgement of the source)",
  licence_url: LICENCE_URL,
  attribution: `Source: Statistics Canada, ${TABLE_NAME}. Contains information licensed under the Open Government Licence – Canada.`,
  homepage: HOMEPAGE,
  limits:
    "Posted daily fees charged by centres in April 2024, before subsidies and parent benefits, not what any one family paid; fees fell sharply in 2025 under the Canada-wide $10-a-day programme, so today's fees are probably lower. " +
    "One published average per province and age group: no range and no sample size. Provinces cut ages differently, so groups are not exactly comparable across provinces. " +
    "Centre-based care only (no home-based care). Some figures carry Statistics Canada quality grades D or E (use with caution); grade F and missing figures are not shown. No national average and no city figures.",
};

// ---------- parsing ----------

export type AgeBucket = "infant" | "toddler" | "preschool" | "school-age";
export const BUCKETS: AgeBucket[] = ["infant", "toddler", "preschool", "school-age"];

export interface FeeRow {
  province: string; // "Ontario"
  group: string; // the province's own wording of the age group
  value: number | null;
  status: string; // quality grade A..F or ".."
}

const NEEDED = ["REF_DATE", "GEO", "Indicator", "UOM", "VALUE", "STATUS"];

export function parseFeeCsv(text: string): FeeRow[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) throw new SourceError("The Statistics Canada child care file is empty; this source needs updating.");
  const head = csvFields(lines[0]);
  const idx = Object.fromEntries(NEEDED.map((n) => [n, head.indexOf(n)]));
  const missing = NEEDED.filter((n) => idx[n] < 0);
  if (missing.length) throw new SourceError(`Statistics Canada changed the child care file (columns missing: ${missing.join(", ")}); this source needs updating.`);
  const rows: FeeRow[] = [];
  for (const l of lines.slice(1)) {
    const f = csvFields(l);
    if (f[idx["Indicator"]] !== INDICATOR || f[idx["UOM"]] !== "Dollars") continue;
    const geo = f[idx["GEO"]] ?? "";
    const province = PROVINCES.map((p) => p.name).find((n) => geo.startsWith(n + ", "));
    if (!province) continue;
    const raw = (f[idx["VALUE"]] ?? "").trim();
    const n = raw === "" ? null : Number(raw);
    const status = (f[idx["STATUS"]] ?? "").trim();
    rows.push({
      province,
      group: geo.slice(province.length + 2),
      value: n !== null && Number.isFinite(n) && n > 0 && status !== "F" ? n : null,
      status,
    });
  }
  if (rows.length < 40) throw new SourceError("The Statistics Canada child care file has too few fee rows; the format may have changed and this source needs updating.");
  return rows;
}

const UNIT_MONTHS: Record<string, number> = { week: 12 / 52, month: 1, year: 12 };
const toMonths = (n: string, unit: string) => Number(n) * UNIT_MONTHS[unit.replace(/s$/, "")];

/** Age in months at which the group starts, when the wording gives a simple age ("aged less than 22 months", "18 months to less than 4 years", "3 years or more"); otherwise null. */
export function startMonths(desc: string): number | null {
  const d = desc.toLowerCase();
  if (/\d+\s*years?\s+\d+\s*months?/.test(d)) return null; // "2 years 9 months": compound ages are not parsed
  if (/(^|[\s,])aged?\s+less than |(^|[\s,])less than \d/.test(d) && !/\bto\b\s+(less than\s+)?\d/.test(d)) return 0;
  const range = d.match(/(\d+)\s*(weeks?|months?|years?)?(?:\s+old)?\s+to\s+(?:less than\s+)?(\d+)\s*(weeks?|months?|years?)/);
  if (range) return toMonths(range[1], range[2] ?? range[4]);
  const open = d.match(/(\d+)\s*(weeks?|months?|years?)(?:\s+old)?\s+(?:or\s+(?:more|older)|and\s+older)/);
  if (open) return toMonths(open[1], open[2]);
  const single = d.match(/aged\s+(\d+)\s*(years?)(?:\s+old)?(?!\s*\d)/);
  if (single) return toMonths(single[1], single[2]);
  return null;
}

/** Put a province's own age group into one of ProofPrice's four age groups; null when it cannot be told (such a group is listed but never used for a headline). */
export function bucketFor(group: string): AgeBucket | null {
  const d = group.toLowerCase();
  if (/(?<!pre-?)school.?age|school-aged|primary or junior|kindergarten aged|kindergarten children|^children who attend school|^children 12 and under who attend school/.test(d)) return "school-age";
  if (/\binfants?\b/.test(d)) return "infant";
  if (/\btoddlers?\b/.test(d)) return "toddler";
  const m = startMonths(d);
  if (m !== null) return m < 18 ? "infant" : m < 30 ? "toddler" : "preschool";
  if (/pre-?school|pre-?kindergarten|pre-?primary/.test(d)) return "preschool";
  return null;
}

export function provinceOf(input: string | undefined): string {
  const raw = (input ?? "").trim();
  if (!raw) {
    throw new InputError(
      `Canada: Statistics Canada publishes child care fees by province or territory only. Give area as a province (${PROVINCES.map((p) => p.name).join(", ")}).`,
    );
  }
  const last = raw.includes(",") ? raw.split(",").pop()! : raw;
  const prov = provinceFor(last) ?? provinceFor(raw);
  if (!prov) {
    throw new InputError(`'${raw}' is not a Canadian province or territory. Statistics Canada publishes child care fees by province only (${PROVINCES.map((p) => p.name).join(", ")}); no city figures.`);
  }
  return prov.name;
}

// ---------- the answer ----------

export interface ChildcareInput {
  area?: string;
  age_group?: string;
  care_type?: string;
  hours?: string;
  baseUrl?: string;
}

export const DEFAULT_AGE: AgeBucket = "preschool";
const round2 = (v: number) => Math.round(v * 100) / 100;

export interface Picked {
  province: string;
  bucket: AgeBucket;
  value: number | null;
  groups: { group: string; fee: number | null; grade: string }[];
  used: { group: string; fee: number; grade: string }[];
}

export function pick(rows: FeeRow[], province: string, bucket: AgeBucket): Picked {
  const inProv = rows.filter((r) => r.province === province);
  if (!inProv.length) throw new SourceError(`Statistics Canada has no child care fees for ${province}; the table layout may have changed.`);
  const inBucket = inProv.filter((r) => bucketFor(r.group) === bucket);
  const used = inBucket.filter((r) => r.value !== null).map((r) => ({ group: r.group, fee: r.value as number, grade: r.status }));
  const value = used.length ? round2(used.reduce((s, r) => s + r.fee, 0) / used.length) : null;
  return { province, bucket, value, groups: inBucket.map((r) => ({ group: r.group, fee: r.value, grade: r.status })), used };
}

function methodText(): string {
  return (
    "Canada childcare: Statistics Canada's average daily fee charged by centre-based child care providers in April 2024 (table 42-10-0071-01), by province or territory and the age group of the child. " +
    "Each province cuts ages differently, so we match its groups to infant, toddler, preschool and school-age by their stated ages; where a province publishes several groups for one of ours we show their simple average " +
    "(not weighted by children) and list every group. Posted fees before subsidies, not payments by sampled families; no range or sample size is published."
  );
}

export function childcareAnswer(rows: FeeRow[], input: ChildcareInput): PriceAnswer {
  const care = (input.care_type ?? "centre").toLowerCase();
  if (care !== "centre" && care !== "center") throw new InputError("Canada: Statistics Canada publishes centre-based fees only; leave care_type out or use centre.");
  if (input.hours) throw new InputError("Canada: the table gives one daily fee per child age group; leave hours out.");
  const bucket = (input.age_group ?? DEFAULT_AGE) as AgeBucket;
  if (!BUCKETS.includes(bucket)) throw new InputError('age_group must be "infant", "toddler", "preschool" or "school-age".');
  const province = provinceOf(input.area);
  const p = pick(rows, province, bucket);
  const query = { country: "CA", area: province, age_group: bucket };
  const defaulted = input.age_group === undefined;

  if (p.value === null) {
    return buildStatisticAnswer({
      source: INFO,
      query,
      value: null,
      measure: "average",
      currency: "CAD",
      unit: "per day",
      period: { from: null, to: null },
      reference_period: "n/a",
      method: methodText(),
      describe: () => "",
      note: `Statistics Canada publishes no usable fee for ${bucket} children in ${province}; try another age_group.`,
      baseUrl: input.baseUrl,
      extra: { groups: p.groups },
    });
  }
  const caveats = [
    "Posted average daily fee of centre-based providers in April 2024, before subsidies; fees have fallen since under the Canada-wide $10-a-day programme.",
  ];
  if (p.used.length > 1) caveats.push(`${province} publishes ${p.used.length} age groups that fit '${bucket}'; the figure is their simple average, not weighted by children (all groups are in extra.groups).`);
  if (p.used.some((u) => u.grade === "D" || u.grade === "E")) caveats.push("Statistics Canada rates at least one of these figures D or E (use with caution).");
  if (defaulted) caveats.push("No age_group was given, so this is the preschool figure; ask with age_group for infant, toddler or school-age.");
  const place = province;
  return buildStatisticAnswer({
    source: INFO,
    query,
    value: p.value,
    measure: "average",
    currency: "CAD",
    unit: "per day",
    period: { from: "2024-04-01", to: "2024-04-30" },
    reference_period: "2024-04",
    method: methodText(),
    describe: (v) => `In April 2024, centre-based child care providers in ${place} charged on average ${v.toFixed(2)} CAD per day for ${bucket} children.`,
    note: caveats.join(" "),
    baseUrl: input.baseUrl,
    extra: {
      province: place,
      age_group: bucket,
      groups_used: p.used,
      groups: p.groups,
      fee_basis: "average daily fee charged by centre-based providers, April 2024, before subsidies",
      attribution_notice: `Source: Statistics Canada, ${TABLE_NAME}. Contains information licensed under the Open Government Licence – Canada.`,
    },
  });
}

// ---------- fetch (cached in memory for six hours) ----------

let cache: { at: number; rows: FeeRow[] } | null = null;
const TTL_MS = 6 * 3600_000;

/** Download and parse; Statistics Canada sometimes answers a 'site unavailable' HTML page with status 200, so a non-zip reply is retried once. */
export async function loadRows(load: () => Promise<Buffer> = () => downloadZip(ZIP_URL), now = Date.now()): Promise<FeeRow[]> {
  if (cache && now - cache.at < TTL_MS) return cache.rows;
  let text: string;
  try {
    text = unzipCsv(await load());
  } catch (err) {
    if (err instanceof SourceError && /not return a zip/.test(err.message)) {
      await new Promise((r) => setTimeout(r, 700));
      text = unzipCsv(await load());
    } else throw err;
  }
  const rows = parseFeeCsv(text);
  cache = { at: now, rows };
  return rows;
}

export function clearCache(): void {
  cache = null;
}

export async function caChildcare(input: ChildcareInput, load?: () => Promise<Buffer>): Promise<PriceAnswer> {
  return childcareAnswer(await loadRows(load), input);
}

// ---------- daily copy (stale-if-error) ----------

/** Pure: one library row per province and age group (our four), the simple average where a province has several groups.
 *  Each row is one published figure: n is NO_COUNT and the range fields repeat it. Dated 1 April 2024, the survey month. */
export function childcareHarvestRows(rows: FeeRow[]): HarvestResult {
  const out: HarvestResult["rows"] = [];
  for (const province of [...new Set(rows.map((r) => r.province))]) {
    for (const bucket of BUCKETS) {
      const v = pick(rows, province, bucket).value;
      if (v === null) continue;
      out.push({ area: province, item: bucket, n: NO_COUNT, median: v, low: v, high: v, min: v, max: v });
    }
  }
  if (!out.length) throw new SourceError("Statistics Canada table 42-10-0071-01 holds no usable child care fee");
  out.sort((a, b) => a.area.localeCompare(b.area) || a.item.localeCompare(b.item));
  return {
    date: "2024-04-01",
    currency: "CAD",
    unit: "per day",
    rows: out,
    note: "Statistics Canada table 42-10-0071-01: average daily fee of centre-based child care providers, April 2024, by province and age group. Published averages, not counts of records.",
  };
}

export async function caChildcareHarvest(load: () => Promise<Buffer> = () => downloadZip(ZIP_URL)): Promise<HarvestResult> {
  return childcareHarvestRows(parseFeeCsv(unzipCsv(await load())));
}

/** Where a request lives in the library, without asking Statistics Canada. */
export function childcareHistoryKey(p: { area?: string; age_group?: string }): { area: string; item: string; label: string } | null {
  const bucket = p.age_group ?? DEFAULT_AGE;
  if (!BUCKETS.includes(bucket as AgeBucket)) return null;
  try {
    const province = provinceOf(p.area);
    return { area: province, item: bucket, label: `${province}, ${bucket} children` };
  } catch {
    return null;
  }
}
