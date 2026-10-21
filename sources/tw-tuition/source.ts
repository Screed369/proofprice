// Taiwan college tuition and fees: Ministry of Education (MOE), "大專校院學雜費收費基準" (tuition and miscellaneous fee standards of colleges and
// universities), open data set 24726 on data.gov.tw. One row per institution and academic year, then the POSTED fee for each faculty group.
//
// Format checked live on 2026-10-21 (GitHub Actions probe, HTTP 200, text/csv, UTF-8, 68,921 bytes, 586 data rows, no key):
//   metadata: https://data.gov.tw/api/v2/rest/dataset/24726 -> result.distribution[0].resourceDownloadUrl (the CSV; the folder number is the ROC year)
//   header: 學年度,設立別,學校類別,學校統計處代碼,學校名稱, then 日間學制學士班學雜費收費基準-{醫學系,牙醫學系,醫學院,工學院,理農學院,商學院,文法學院,其他}
//           and 日間學制副學士學雜費收費基準(五專後2年、二專)-{護理類,...}
//   114,公立,一般大學,0001,國立政治大學,0,0,0,0,"28,430","24,890","24,510",0,...   (ROC year 114 = 2025/26; thousands comma inside quotes; 0 = not offered)
// The amounts are the fee standards per semester in NT$ (tuition + miscellaneous fees), as posted by the Ministry. Not what any student paid.
// The file is small and changes once a year (October): fetched per request and cached in memory for 24 hours; no harvest needed.

import { InputError, SourceError } from "../../lib/http";
import { buildAnswer, PriceAnswer } from "../../lib/answer";
import { summarise, MIN_PUBLISH } from "../../lib/stats";
import type { SourceInfo } from "../../lib/plugin";

export const METADATA_URL = "https://data.gov.tw/api/v2/rest/dataset/24726";
export const FALLBACK_CSV_URL =
  "https://udb.moe.edu.tw/download/udata/static_file/114/%E6%A0%A11-2.%E6%97%A5%E9%96%93%E5%AD%B8%E5%A3%AB%E7%8F%AD%E4%BB%A5%E4%B8%8B%E5%AD%B8%E8%B2%BB%E3%80%81%E9%9B%9C%E8%B2%BB%E6%94%B6%E8%B2%BB%E5%9F%BA%E6%BA%96.csv";
export const HOMEPAGE = "https://data.gov.tw/en/datasets/24726";
export const LICENCE_URL = "https://data.gov.tw/license";

export const INFO: SourceInfo = {
  id: "tw-tuition",
  country: "TW (Taiwan)",
  category: "tuition (posted fee standards of colleges and universities)",
  name: "Tuition and miscellaneous fee standards of Taiwan colleges and universities (data.gov.tw dataset 24726)",
  publisher: "Ministry of Education, Taiwan (via data.gov.tw)",
  what_is_recorded:
    "For each college and university and each academic year, the fee standard the institution is allowed to charge a full-time day-programme bachelor's student per semester " +
    "(tuition plus miscellaneous fees, in New Taiwan dollars), for each faculty group: medicine, dentistry, medical college, engineering, science and agriculture, business, humanities and law, other.",
  price_type: "posted_price",
  freshness: "Annual: one value per academic year (the Ministry updates the file every October for the new year); every answer names its academic year",
  licence: "Open Government Data License, version 1.0 (Taiwan): free reuse, including commercial, with attribution",
  licence_url: LICENCE_URL,
  attribution: "Source: Ministry of Education, Taiwan, via data.gov.tw (Open Government Data License v1.0).",
  homepage: HOMEPAGE,
  limits:
    "Posted fee standards per semester, not amounts students paid: scholarships, grants and waivers are not deducted, and some fees (accommodation, books, graduate programmes) are not included. " +
    "Day-programme bachelor's degrees only; master's, doctoral, evening and international-student rates are not in this file. The range runs across institutions (each counted once), not across students. " +
    "A faculty group an institution does not offer is left out (the file marks it 0).",
};

// ---------- parsing ----------

export const FACULTY_COLUMNS: Record<string, { zh: string; label: string }> = {
  medicine: { zh: "醫學系", label: "medicine" },
  dentistry: { zh: "牙醫學系", label: "dentistry" },
  medical_college: { zh: "醫學院", label: "other medical-college programmes" },
  engineering: { zh: "工學院", label: "engineering" },
  science_agri: { zh: "理農學院", label: "science and agriculture" },
  business: { zh: "商學院", label: "business" },
  humanities_law: { zh: "文法學院", label: "humanities and law" },
  other: { zh: "其他", label: "other faculties" },
};
export const FACULTIES = Object.keys(FACULTY_COLUMNS);

const FACULTY_ALIASES: Record<string, string> = {
  medicine: "medicine", medical: "medicine", doctor: "medicine", dentistry: "dentistry", dental: "dentistry",
  "medical college": "medical_college", "medical-college": "medical_college", "medical_college": "medical_college", nursing: "medical_college", pharmacy: "medical_college",
  engineering: "engineering", engineer: "engineering", technology: "engineering", it: "engineering", computing: "engineering",
  science: "science_agri", sciences: "science_agri", agriculture: "science_agri", "science and agriculture": "science_agri", "science_agri": "science_agri", "science-agri": "science_agri",
  business: "business", management: "business", commerce: "business", economics: "business",
  humanities: "humanities_law", arts: "humanities_law", law: "humanities_law", "humanities and law": "humanities_law", "humanities_law": "humanities_law", "humanities-law": "humanities_law", social: "humanities_law",
  other: "other", others: "other",
};

/** Resolve a faculty word to one of FACULTIES (default humanities_law, the commonest general degree). */
export function resolveFaculty(raw: string | undefined): string {
  const k = (raw ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!k) return "humanities_law";
  const hit = FACULTY_ALIASES[k];
  if (!hit) throw new InputError(`faculty must be one of: ${FACULTIES.join(", ")}.`);
  return hit;
}

export interface FeeRow {
  rocYear: number; // 114 = 2025/26
  ownership: "public" | "private" | "other";
  schoolType: "university" | "technical" | "religious" | "other";
  code: string;
  fees: Record<string, number | null>; // per faculty key; null = not offered
}

export function csvFields(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

const BACHELOR_PREFIX = "日間學制學士班學雜費收費基準-";

function amount(raw: string | undefined): number | null {
  const n = Number((raw ?? "").replace(/[,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function parseFeeCsv(text: string): FeeRow[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) throw new SourceError("The Ministry of Education fee file is empty; this source needs updating.");
  const head = csvFields(lines[0]).map((h) => h.trim());
  const idxYear = head.indexOf("學年度");
  const idxOwn = head.indexOf("設立別");
  const idxType = head.indexOf("學校類別");
  const idxCode = head.indexOf("學校統計處代碼");
  const cols: Record<string, number> = {};
  for (const [key, def] of Object.entries(FACULTY_COLUMNS)) cols[key] = head.indexOf(BACHELOR_PREFIX + def.zh);
  const missing = [["學年度", idxYear], ["設立別", idxOwn], ["學校類別", idxType], ["學校統計處代碼", idxCode], ...Object.entries(cols).map(([k, i]) => [BACHELOR_PREFIX + FACULTY_COLUMNS[k].zh, i])]
    .filter(([, i]) => (i as number) < 0)
    .map(([n]) => n);
  if (missing.length) throw new SourceError(`The Ministry of Education changed the fee file (columns missing: ${missing.join(", ")}); this source needs updating.`);
  const rows: FeeRow[] = [];
  for (const l of lines.slice(1)) {
    const f = csvFields(l);
    const roc = Number(f[idxYear]);
    if (!Number.isInteger(roc) || roc < 100 || roc > 200) continue;
    const own = f[idxOwn]?.trim();
    const typ = f[idxType]?.trim();
    const fees: Record<string, number | null> = {};
    for (const key of FACULTIES) fees[key] = amount(f[cols[key]]);
    rows.push({
      rocYear: roc,
      ownership: own === "公立" ? "public" : own === "私立" ? "private" : "other",
      schoolType: typ === "一般大學" ? "university" : typ === "技專校院" ? "technical" : typ === "宗教研修學院" ? "religious" : "other",
      code: (f[idxCode] ?? "").trim(),
      fees,
    });
  }
  if (rows.length < 30) throw new SourceError("The Ministry of Education fee file has too few rows; the format may have changed and this source needs updating.");
  return rows;
}

/** The download URL named in the dataset's metadata JSON; the folder number in it moves each year. */
export function csvUrlFromMetadata(json: any): string | null {
  const dist = json?.result?.distribution;
  const url = Array.isArray(dist) ? dist.map((d: any) => d?.resourceDownloadUrl).find((u: unknown) => typeof u === "string" && /\.csv$/i.test(u as string)) : null;
  return url ? encodeURI(url as string) : null;
}

// ---------- the answer ----------

export interface TuitionInput {
  cycle?: string;
  student_group?: string;
  study_mode?: string;
  faculty?: string;
  ownership?: string;
  school_type?: string;
  baseUrl?: string;
}

const OWNERSHIP: Record<string, "public" | "private"> = { public: "public", national: "public", state: "public", private: "private" };
const SCHOOL_TYPE: Record<string, "university" | "technical"> = {
  university: "university", universities: "university", general: "university",
  technical: "technical", "technical college": "technical", technology: "technical", vocational: "technical", polytechnic: "technical",
};

const nt = (v: number) => `NT$${Math.round(v).toLocaleString("en-US")}`;

export function tuitionAnswer(rows: FeeRow[], input: TuitionInput): PriceAnswer {
  const cycle = input.cycle ?? "first";
  const group = input.student_group ?? "home";
  const mode = input.study_mode ?? "full-time";
  if (cycle !== "first") throw new InputError("Taiwan: this source covers day-programme bachelor's degrees only (cycle first); master's fees are not in the Ministry's file.");
  if (group !== "home") throw new InputError('Taiwan: the Ministry publishes one fee standard per institution, not separate international rates; leave student_group out or use "home".');
  if (mode !== "full-time") throw new InputError("Taiwan: only full-time day programmes are covered; leave study_mode out or use full-time.");
  const faculty = resolveFaculty(input.faculty);
  const own = input.ownership ? OWNERSHIP[input.ownership.trim().toLowerCase()] : undefined;
  if (input.ownership && !own) throw new InputError('ownership must be "public" or "private" (or leave it out for both).');
  const typ = input.school_type ? SCHOOL_TYPE[input.school_type.trim().toLowerCase()] : undefined;
  if (input.school_type && !typ) throw new InputError('school_type must be "university" (general universities) or "technical" (technical and vocational colleges), or leave it out for both.');

  const newest = Math.max(...rows.map((r) => r.rocYear));
  const inYear = rows.filter((r) => r.rocYear === newest);
  const picked = inYear.filter((r) => (!own || r.ownership === own) && (!typ || r.schoolType === typ));
  const values = picked.map((r) => r.fees[faculty]).filter((v): v is number => v !== null);
  const s = summarise(values);
  const startYear = newest + 1911;
  const year = `${startYear}/${String(startYear + 1).slice(2)}`;
  const label = FACULTY_COLUMNS[faculty].label;
  const scope = [own === "public" ? "public" : own === "private" ? "private" : null, typ === "technical" ? "technical and vocational" : typ === "university" ? "general-university" : null]
    .filter(Boolean)
    .join(" ");

  const byFaculty: Record<string, { institutions: number; median: number } | null> = {};
  for (const key of FACULTIES) {
    const sm = summarise(picked.map((r) => r.fees[key]).filter((v): v is number => v !== null));
    byFaculty[key] = sm && sm.count >= MIN_PUBLISH ? { institutions: sm.count, median: sm.median } : null;
  }
  const bySplit = (o: "public" | "private") => {
    const sm = summarise(inYear.filter((r) => r.ownership === o && (!typ || r.schoolType === typ)).map((r) => r.fees[faculty]).filter((v): v is number => v !== null));
    return sm && sm.count >= MIN_PUBLISH ? { institutions: sm.count, median: sm.median } : null;
  };

  return buildAnswer({
    source: INFO,
    query: { country: "TW", cycle, student_group: group, study_mode: mode, faculty, ...(own ? { ownership: own } : {}), ...(typ ? { school_type: typ } : {}) },
    summary: s,
    currency: "TWD",
    unit: "per semester (posted fee standard)",
    period: { from: `${startYear}-09-01`, to: `${startYear + 1}-08-31` },
    method: methodText(),
    describe: (x) =>
      `For the ${year} academic year, the posted tuition and miscellaneous fee standard for ${label} bachelor's degrees at ${scope ? scope + " " : ""}Taiwan institutions has a median of ${nt(x.median)} per semester ` +
      `(typical range ${nt(x.low)} to ${nt(x.high)}, cheapest ${nt(x.min)}, dearest ${nt(x.max)}; an academic year has two semesters).`,
    baseUrl: input.baseUrl,
    extra: {
      academic_year: year,
      roc_academic_year: newest,
      faculty,
      faculty_label: label,
      counted: "institutions (each once), not students",
      fee_basis: "posted fee standard per semester (tuition plus miscellaneous fees), full-time day-programme bachelor's degrees, NT$",
      approx_per_academic_year_median: s && s.count >= MIN_PUBLISH ? s.median * 2 : null,
      public_vs_private: { public: bySplit("public"), private: bySplit("private") },
      median_by_faculty: byFaculty,
      attribution_notice: INFO.attribution,
    },
  });
}

function methodText(): string {
  return (
    "Taiwan tuition: the Ministry of Education's fee standards for day-programme bachelor's degrees (data.gov.tw dataset 24726), newest academic year in the file. " +
    "For the chosen faculty group we take the posted per-semester fee (tuition plus miscellaneous fees) of every institution that offers it and report the median and the 10th to 90th percentile across institutions, each counted once. " +
    "These are fees institutions may charge, not payments by students; no figure is given from fewer than 5 institutions."
  );
}

// ---------- fetch (cached in memory for 24 hours) ----------

let cache: { at: number; rows: FeeRow[] } | null = null;
const TTL_MS = 24 * 3600_000;

async function getText(url: string, timeoutMs = 20000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "user-agent": "ProofPrice/1.0 (+https://proofprice.com; hello@proofprice.com)" } });
    if (!res.ok) throw new SourceError(`Source returned HTTP ${res.status}`, (await res.text().catch(() => "")).slice(0, 300), res.status);
    return await res.text();
  } catch (err: any) {
    if (err?.name === "AbortError") throw new SourceError("Source timed out", url);
    if (err instanceof SourceError) throw err;
    throw new SourceError("Could not reach the official source", String(err?.cause?.code ?? err?.message ?? err));
  } finally {
    clearTimeout(timer);
  }
}

export type TextLoader = (url: string) => Promise<string>;

/** Read the metadata for the current CSV address (falling back to the known one), then the CSV. */
export async function loadRows(load: TextLoader = getText, now = Date.now()): Promise<FeeRow[]> {
  if (cache && now - cache.at < TTL_MS) return cache.rows;
  let url = FALLBACK_CSV_URL;
  try {
    url = csvUrlFromMetadata(JSON.parse(await load(METADATA_URL))) ?? FALLBACK_CSV_URL;
  } catch {
    /* the metadata service is optional: use the last known address */
  }
  const rows = parseFeeCsv(await load(url));
  cache = { at: now, rows };
  return rows;
}

export function clearCache(): void {
  cache = null;
}

export async function twTuition(input: TuitionInput, load?: TextLoader): Promise<PriceAnswer> {
  return tuitionAnswer(await loadRows(load), input);
}
