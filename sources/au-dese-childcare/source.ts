// Australia childcare: average hourly fee charged, from the Department of Education's quarterly "Child Care Subsidy data report".
// One HTML page per quarter, two small tables under the heading "Fees": by care type (Centre Based Day Care, Family Day Care,
// Outside School Hours Care, Total) and by state or territory (+ Australia), column "Average hourly fee" in dollars.
// Format read 2026-10-31 through a page-text reader on the September quarter 2025 report (education.gov.au/node/19924):
//   "The average hourly fee was $13.65, up 4.7% from September quarter 2024."
//   Care type | Average hourly fee: Centre Based Day Care $14.30, Family Day Care $13.70, Outside School Hours Care $9.60, Total $13.60
//   State or territory | Average hourly fee: New South Wales $14.55 ... Australian Capital Territory $16.05, Australia $14.35
// The raw HTML could not be fetched from the build workspace, so the parser reads the page as text (tags and "|" become line breaks)
// and pairs each known label with the dollar figure after it. The report URL follows the pattern
//   https://www.education.gov.au/early-childhood/about/data-and-reports/quarterly-reports/child-care-subsidy-data-report-<month>-quarter-<year>
// and the newest quarter that answers is used. Posted fees charged by providers (official statistic), not payments by sampled families.

import { InputError, SourceError } from "../../lib/http";
import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import type { HarvestResult, SourceInfo } from "../../lib/plugin";
import { NO_COUNT } from "../../lib/stats";

export const BASE = "https://www.education.gov.au/early-childhood/about/data-and-reports/quarterly-reports/";
export const HOMEPAGE = "https://www.education.gov.au/early-childhood/early-childhood-data-and-reports/quarterly-reports-and-data";
export const LICENCE_URL = "https://www.education.gov.au/using-site/copyright";

export const INFO: SourceInfo = {
  id: "au-dese-childcare",
  country: "AU (Australia)",
  category: "childcare (official average hourly fee statistics)",
  name: "Child Care Subsidy data report: average hourly fee (Australian Government Department of Education)",
  publisher: "Australian Government Department of Education",
  what_is_recorded:
    "The average hourly fee, in Australian dollars, charged by child care services approved for the Child Care Subsidy, in the latest published quarter: " +
    "one figure per care type (centre based day care, family day care, outside school hours care) and one per state or territory.",
  price_type: "official_statistic",
  freshness: "quarterly report, published about three to four months after the quarter ends",
  licence: "Creative Commons Attribution 4.0 International (Department of Education copyright page; commercial use allowed with attribution)",
  licence_url: LICENCE_URL,
  attribution: "Source: Australian Government Department of Education, Child Care Subsidy data report. © Commonwealth of Australia, CC BY 4.0.",
  homepage: HOMEPAGE,
  limits:
    "The hourly fee services charge, averaged over approved services in the quarter (the report does not say whether it is before the subsidy; treat it as the fee charged, not what a family pays after subsidy). " +
    "One figure per care type and one per state or territory: no range, no sample size, no figure by child age, suburb or city, and no state figure by care type.",
};

export type CareKey = "centre" | "home-based" | "school-age" | "all";
const CARE_LABELS: Record<string, CareKey> = {
  "centre based day care": "centre",
  "family day care": "home-based",
  "outside school hours care": "school-age",
  total: "all",
};
export const STATES = [
  "New South Wales", "Victoria", "Queensland", "South Australia", "Western Australia", "Tasmania", "Northern Territory", "Australian Capital Territory", "Australia",
] as const;
const STATE_ALIASES: Record<string, (typeof STATES)[number]> = {
  nsw: "New South Wales", vic: "Victoria", qld: "Queensland", sa: "South Australia", wa: "Western Australia", tas: "Tasmania", nt: "Northern Territory", act: "Australian Capital Territory",
  australia: "Australia", national: "Australia", au: "Australia",
};

export interface Report {
  quarter: string; // "September quarter 2025"
  from: string; // 2025-07-01
  to: string; // 2025-09-30
  care: Partial<Record<CareKey, number>>;
  states: Partial<Record<(typeof STATES)[number], number>>;
  headline: number | null;
  url: string;
}

const QUARTERS: Record<string, [number, string, number, string]> = {
  march: [1, "01", 3, "31"], june: [4, "04", 6, "30"], september: [7, "07", 9, "30"], december: [10, "10", 12, "31"],
};

/** HTML or page text -> one trimmed line per cell. */
export function toLines(html: string): string[] {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#36;/g, "$")
    .replace(/\|/g, "\n")
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

const MONEY = /^\$\s?(\d{1,3}(?:\.\d{1,2})?)$|^(\d{1,3}\.\d{1,2})$/;
const num = (s: string | undefined): number | null => {
  const m = s ? MONEY.exec(s) : null;
  return m ? Number(m[1] ?? m[2]) : null;
};

export function parseReport(html: string, url = ""): Report {
  const lines = toLines(html);
  const text = lines.join(" ");
  const q = /\b(March|June|September|December) quarter (20\d\d)\b/i.exec(text);
  if (!q) throw new SourceError("The Child Care Subsidy report does not name its quarter; this source needs updating.");
  const [m1, , m2, dd2] = QUARTERS[q[1].toLowerCase()];
  const year = Number(q[2]);
  const care: Report["care"] = {};
  const states: Report["states"] = {};
  for (let i = 0; i < lines.length - 1; i++) {
    const key = lines[i].toLowerCase();
    const v = num(lines[i + 1]);
    if (v === null) continue;
    if (key in CARE_LABELS && care[CARE_LABELS[key]] === undefined) care[CARE_LABELS[key]] = v;
    const st = STATES.find((s) => s.toLowerCase() === key);
    if (st && states[st] === undefined) states[st] = v;
  }
  const h = /average hourly fee was \$(\d{1,3}(?:\.\d{1,2})?)/i.exec(text);
  if (Object.keys(states).length < 8 || care.centre === undefined) {
    throw new SourceError("The Child Care Subsidy report layout changed (fee tables not found); this source needs updating.");
  }
  const to = `${year}-${String(m2).padStart(2, "0")}-${dd2}`;
    return { quarter: `${q[1][0].toUpperCase()}${q[1].slice(1).toLowerCase()} quarter ${year}`, from: `${year}-${String(m1).padStart(2, "0")}-01`, to, care, states, headline: h ? Number(h[1]) : null, url };
}

/** Candidate report URLs, newest quarter first, starting from the last quarter that has ended. */
export function candidateUrls(now: Date = new Date(), count = 6): { url: string; label: string }[] {
  const names = ["march", "june", "september", "december"];
  let y = now.getUTCFullYear();
  let qi = Math.floor(now.getUTCMonth() / 3) - 1; // last completed quarter
  if (qi < 0) { qi = 3; y -= 1; }
  const out: { url: string; label: string }[] = [];
  for (let i = 0; i < count; i++) {
    out.push({ url: `${BASE}child-care-subsidy-data-report-${names[qi]}-quarter-${y}`, label: `${names[qi]} quarter ${y}` });
    qi -= 1;
    if (qi < 0) { qi = 3; y -= 1; }
  }
  return out;
}

async function getPage(url: string): Promise<string | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12000);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { "user-agent": "pricepaid-plug/0.1 (+price-paid data for AI agents)", accept: "text/html" } });
    if (res.status === 404 || res.status === 410) return null;
    if (!res.ok) throw new SourceError(`Source returned HTTP ${res.status}`, url, res.status);
    return await res.text();
  } catch (err: any) {
    if (err instanceof SourceError) throw err;
    if (err?.name === "AbortError") throw new SourceError("Source timed out", url);
    throw new SourceError("Could not reach the official source", String(err?.cause?.code ?? err?.message ?? err));
  } finally {
    clearTimeout(timer);
  }
}

let cache: { at: number; report: Report } | null = null;
const TTL_MS = 12 * 3600_000;

export async function loadReport(fetchPage: (u: string) => Promise<string | null> = getPage, now: Date = new Date()): Promise<Report> {
  if (cache && now.getTime() - cache.at < TTL_MS) return cache.report;
  for (const c of candidateUrls(now)) {
    const html = await fetchPage(c.url);
    if (html === null) continue;
    const report = parseReport(html, c.url);
    cache = { at: now.getTime(), report };
    return report;
  }
  throw new SourceError("No Child Care Subsidy data report found at the expected addresses; this source needs updating.");
}
export function clearCache(): void {
  cache = null;
}

// ---------- the answer ----------

export interface AuInput { area?: string; care_type?: string; age_group?: string; baseUrl?: string }

export function stateOf(input: string | undefined): (typeof STATES)[number] | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;
  const k = raw.toLowerCase().replace(/\./g, "");
  const hit = STATES.find((s) => s.toLowerCase() === k) ?? STATE_ALIASES[k];
  if (!hit) {
    throw new InputError(`'${raw}' is not an Australian state or territory. The Department of Education publishes the hourly fee by state or territory only (${STATES.join(", ")}); no city or suburb figures.`);
  }
  return hit;
}

const CARE_NAME: Record<CareKey, string> = {
  centre: "centre based day care",
  "home-based": "family day care",
  "school-age": "outside school hours care",
  all: "all care types",
};

function methodText(r: Report): string {
  return (
    `Australia childcare: the average hourly fee reported by the Australian Government Department of Education in its Child Care Subsidy data report for the ${r.quarter}, ` +
    "by care type (centre based day care, family day care, outside school hours care) or by state or territory. A published average, not a calculation by ProofPrice; no range and no sample size."
  );
}

export function auAnswer(r: Report, input: AuInput): PriceAnswer {
  const state = stateOf(input.area);
  let care = null as CareKey | null;
  const ct = (input.care_type ?? "").toLowerCase();
  if (ct) {
    if (["centre", "center"].includes(ct)) care = "centre";
    else if (ct === "home-based") care = "home-based";
    else throw new InputError('care_type must be "centre" (centre based day care) or "home-based" (family day care).');
  }
  if (input.age_group === "school-age") {
    if (care && care !== "school-age") throw new InputError("Australia: age_group school-age is answered with outside school hours care; leave care_type out.");
    care = "school-age";
  }
  if (state && care) {
    throw new InputError("Australia: the state and territory figures cover all care types together. Give area for a state figure, or care_type / age_group school-age for a national figure by care type, not both.");
  }
  let value: number | undefined;
  let what: string;
  let place: string;
  if (care) {
    value = r.care[care];
    what = CARE_NAME[care];
    place = "Australia";
  } else if (state) {
    value = r.states[state];
    what = CARE_NAME.all;
    place = state;
  } else {
    value = r.care.all ?? r.states.Australia;
    what = CARE_NAME.all;
    place = "Australia";
  }
  const query: Record<string, unknown> = { country: "AU", area: place, ...(care ? { care_type: care } : {}) };
  const caveats = [`Average hourly fee for the ${r.quarter}, as published by the Department of Education; it does not say whether this is before the Child Care Subsidy, so read it as the fee charged.`];
  if (input.age_group && input.age_group !== "school-age") caveats.push(`No figure by child age is published, so age_group '${input.age_group}' was ignored.`);
  return buildStatisticAnswer({
    source: INFO,
    query,
    value: value ?? null,
    measure: "average",
    currency: "AUD",
    unit: "per hour",
    period: { from: r.from, to: r.to },
    reference_period: r.to.slice(0, 4) + "-Q" + Math.ceil(Number(r.to.slice(5, 7)) / 3),
    method: methodText(r),
    describe: (v) => `In the ${r.quarter}, the average hourly fee for ${what} in ${place} was ${v.toFixed(2)} AUD.`,
    note: caveats.join(" "),
    baseUrl: input.baseUrl,
    extra: { quarter: r.quarter, care_type_figures: r.care, state_figures: r.states, report_url: r.url, headline_average: r.headline },
  });
}

export async function auChildcare(input: AuInput, fetchPage?: (u: string) => Promise<string | null>): Promise<PriceAnswer> {
  return auAnswer(await loadReport(fetchPage), input);
}

// ---------- daily copy (stale-if-error) ----------

export function auHarvestRows(r: Report): HarvestResult {
  const rows: HarvestResult["rows"] = [];
  const add = (area: string, item: string, v: number | undefined) => {
    if (v !== undefined) rows.push({ area, item, n: NO_COUNT, median: v, low: v, high: v, min: v, max: v });
  };
  for (const s of STATES) add(s, "all", r.states[s]);
  add("Australia", "centre", r.care.centre);
  add("Australia", "home-based", r.care["home-based"]);
  add("Australia", "school-age", r.care["school-age"]);
  return { date: r.to, currency: "AUD", unit: "per hour", rows, note: `Department of Education Child Care Subsidy data report, ${r.quarter}: published average hourly fees, not counts of records.` };
}

export async function auHarvest(fetchPage?: (u: string) => Promise<string | null>): Promise<HarvestResult> {
  clearCache();
  return auHarvestRows(await loadReport(fetchPage));
}

export function auHistoryKey(p: { area?: string; care_type?: string; age_group?: string }): { area: string; item: string; label: string } | null {
  try {
    const state = stateOf(p.area);
    let care: string | null = null;
    const ct = (p.care_type ?? "").toLowerCase();
    if (["centre", "center"].includes(ct)) care = "centre";
    else if (ct === "home-based") care = "home-based";
    if (p.age_group === "school-age") care = "school-age";
    if (state && care) return null;
    if (care) return { area: "Australia", item: care, label: `Australia, ${CARE_NAME[care as CareKey]}` };
    const place = state ?? "Australia";
    return { area: place, item: "all", label: `${place}, all care types` };
  } catch {
    return null;
  }
}
