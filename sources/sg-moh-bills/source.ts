// Singapore hospital bills: Ministry of Health "Hospital bill sizes" benchmarks, medical conditions (DRG), calendar year 2023.
// Format checked live on 2026-10-20 (GitHub Actions probe, HTTP 200, 1.2 MB xlsx, no key):
//   https://go.gov.sg/hospitalbillsizes -> 302 -> https://file.go.gov.sg/hospitalbillsizes.xlsx (last modified 15 May 2026)
//   sheet "3. Med DRG Bill Data": header row |DRG|DRG Description|Setting|Ward Type|P25 Bill|P50 Bill|P75 Bill|P25 Room Fees|...
//   one row per DRG, setting (Public subsidised / Public unsubsidised / Private) and ward type; amounts in SGD incl. GST, Singapore Citizens, discharges
//   1 Jan - 31 Dec 2023, transacted bills before insurance and MediSave. 'n/a' = under 10 cases, '-' = not applicable. NO case counts are published.
// The figures are percentiles MOH computed, so the answer is an official statistic (median = P50; P25 and P75 go in extra.p25 / extra.p75, never in typical_low / typical_high), sample size unknown.
// The workbook is annual: fetched per request and cached in memory for 24 hours (only the DRG sheet is parsed).

import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import type { SourceInfo } from "../../lib/plugin";
import { decodeXml, readSharedStrings, readSheet, unzip } from "../gb-ons-price-levels/xlsx";
import type { Cell } from "../gb-ons-price-levels/xlsx";

export const XLSX_URL = "https://file.go.gov.sg/hospitalbillsizes.xlsx";
export const PAGE_URL = "https://www.moh.gov.sg/managing-expenses/bills-and-fee-benchmarks/cost-financing/drg-z61b-bill-information/";
export const YEAR = "2023";

export const INFO: SourceInfo = {
  id: "sg-moh-bills",
  country: "SG (Singapore)",
  category: "doctors and hospitals (hospital bills for medical conditions)",
  name: "Hospital bill sizes by medical condition (DRG) and ward type (Ministry of Health, Singapore)",
  publisher: "Ministry of Health (MOH), Singapore",
  what_is_recorded:
    "For each medical condition group (DRG), hospital setting (public subsidised, public unsubsidised, private) and ward type: the 25th, 50th (median) and 75th percentile of the total hospital bills actually transacted " +
    "for Singapore Citizens discharged in calendar year 2023, GST included, before insurance and MediSave. Combinations with fewer than 10 cases are hidden by MOH.",
  price_type: "official_statistic",
  freshness: "Annual benchmark file (data year 2023, file last updated 15 May 2026); every answer states its data year",
  licence: "Singapore Open Data Licence v1.0; MOH's terms of use put the datasets published on moh.gov.sg under it. Commercial use is allowed with attribution.",
  licence_url: "https://data.gov.sg/open-data-licence",
  attribution:
    "Source: Ministry of Health, Singapore, Hospital bill sizes (fee benchmarks, medical conditions by DRG), data for 1 Jan - 31 Dec 2023. " +
    "Contains information from MOH accessed on the date of the answer, made available under the Singapore Open Data Licence version 1.0 (https://data.gov.sg/open-data-licence).",
  homepage: PAGE_URL,
  limits:
    "Singapore Citizens only, calendar year 2023, selected medical conditions only (not surgery). Total bills before insurance and MediSave, so not what the patient finally paid out of pocket. " +
    "MOH publishes percentiles only: no number of cases is given (cells with under 10 cases are hidden), so the sample size is unknown. Not a quote: individual bills depend on length of stay and complications.",
};

export type Ward = "private" | "a" | "b1" | "b2" | "c";
export const WARD_HELP =
  "c = public hospital subsidised Ward C (default), b2 = public subsidised Ward B2, b1 = public unsubsidised Ward B1, a = public unsubsidised Ward A, private = private hospital inpatient";
const WARD_LABEL: Record<Ward, string> = {
  c: "public hospital, subsidised Ward C",
  b2: "public hospital, subsidised Ward B2",
  b1: "public hospital, unsubsidised Ward B1",
  a: "public hospital, unsubsidised Ward A",
  private: "private hospital, inpatient",
};
const WARD_ORDER: Ward[] = ["c", "b2", "private", "b1", "a"];

export interface DrgRow {
  drg: string;
  description: string;
  ward: Ward;
  setting: string;
  wardType: string;
  p25: number | null;
  p50: number | null;
  p75: number | null;
}

function num(c: Cell | undefined): number | null {
  if (typeof c === "number") return Number.isFinite(c) ? c : null;
  if (typeof c === "string" && /^-?\d+(\.\d+)?$/.test(c.trim())) return Number(c);
  return null; // 'n/a' (under 10 cases) or '-'
}

function wardOf(setting: string, wardType: string): Ward | null {
  const s = setting.toLowerCase();
  const w = wardType.toLowerCase();
  if (s.startsWith("private")) return "private";
  if (/ward c\b/.test(w)) return "c";
  if (/ward b2\b/.test(w)) return "b2";
  if (/ward b1\b/.test(w)) return "b1";
  if (/ward a\b/.test(w)) return "a";
  return null;
}

/** Rows of the "Med DRG Bill Data" sheet -> one record per DRG, setting and ward. Finds the header row by its first cell "DRG". */
export function parseDrgRows(rows: Cell[][]): DrgRow[] {
  // The table may start in column A or further right: find the header cell "DRG" followed by "DRG Description", and read relative to it.
  let h = -1;
  let o = 0;
  for (let i = 0; i < rows.length && h < 0; i++) {
    const c = rows[i].findIndex((v, j) => String(v ?? "").trim() === "DRG" && String(rows[i][j + 1] ?? "").trim().startsWith("DRG Desc"));
    if (c >= 0) {
      h = i;
      o = c;
    }
  }
  if (h < 0) {
    const peek = rows.slice(0, 12).map((r) => r.slice(0, 4).map((v) => String(v ?? "").slice(0, 25)).join("|")).join(" // ");
    throw new SourceError("The MOH workbook layout has changed (no DRG header row found).", `${rows.length} rows; start: ${peek}`);
  }
  const out: DrgRow[] = [];
  for (const r of rows.slice(h + 1)) {
    const drg = String(r[o] ?? "").trim();
    if (!/^[A-Z]\d{2}[A-Z]$/.test(drg)) continue;
    const setting = String(r[o + 2] ?? "").trim();
    const wardType = String(r[o + 3] ?? "").trim();
    const ward = wardOf(setting, wardType);
    if (!ward) continue;
    out.push({ drg, description: String(r[o + 1] ?? "").trim(), ward, setting, wardType, p25: num(r[o + 4]), p50: num(r[o + 5]), p75: num(r[o + 6]) });
  }
  return out;
}

/** The DRG sheet of the workbook, without parsing the other (large) sheets. */
export function readDrgSheet(buf: Buffer): Cell[][] {
  const files = unzip(buf);
  const text = (n: string) => files.get(n)?.toString("utf8");
  const workbook = text("xl/workbook.xml");
  if (!workbook) throw new SourceError("MOH did not return an Excel workbook (it may be showing an error page); try again shortly.");
  const rels = text("xl/_rels/workbook.xml.rels") ?? "";
  const target = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[1])?.[1];
    const tg = /\bTarget="([^"]+)"/.exec(m[1])?.[1];
    if (id && tg) target.set(id, tg.startsWith("/") ? tg.slice(1) : `xl/${tg}`);
  }
  for (const m of workbook.matchAll(/<sheet\b([^>]*?)\/?>/g)) {
    const name = decodeXml(/\bname="([^"]*)"/.exec(m[1])?.[1] ?? "");
    if (!/^3\.\s*Med\s*DRG\s*Bill/i.test(name)) continue;
    const rid = /\br:id="([^"]+)"/.exec(m[1])?.[1];
    const xml = rid && target.get(rid) ? text(target.get(rid)!) : undefined;
    if (!xml) break;
    return readSheet(xml, readSharedStrings(text("xl/sharedStrings.xml") ?? ""));
  }
  throw new SourceError("The MOH workbook layout has changed (no 'Med DRG Bill Data' sheet found).");
}

// ---------- finding the condition ----------

const STOP = new Set(["and", "or", "of", "the", "with", "without", "w", "wo", "in", "for", "a", "an", "to", "other", "cost", "bill", "hospital", "stay", "price"]);
export function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t && !STOP.has(t))
    .map((t) => (t.length > 4 && t.endsWith("s") ? t.slice(0, -1) : t));
}

export interface Match {
  drg: string;
  description: string;
}

/** DRG code ("B70A", or "B70" for every variant) or plain words matched against the MOH condition names (every word must appear). */
export function findConditions(rows: DrgRow[], service: string): Match[] {
  const q = service.trim();
  if (q.length < 2) throw new InputError("service is required: a condition in plain words ('stroke', 'dementia', 'delirium') or a DRG code such as B70A.");
  const all = new Map<string, string>();
  for (const r of rows) if (!all.has(r.drg)) all.set(r.drg, r.description);
  const list = [...all].map(([drg, description]) => ({ drg, description }));
  if (/^[A-Za-z]\d{2}[A-Za-z]?$/.test(q)) {
    const code = q.toUpperCase();
    return list.filter((m) => m.drg.startsWith(code));
  }
  const want = tokens(q);
  if (!want.length) return [];
  const hits = list.filter((m) => {
    const have = new Set(tokens(m.description));
    return want.every((w) => have.has(w) || [...have].some((h) => h.startsWith(w) && w.length >= 4));
  });
  return hits.sort((a, b) => a.description.length - b.description.length || a.drg.localeCompare(b.drg));
}

function normaliseWard(raw: string | undefined): Ward | null {
  const s = (raw ?? "").trim().toLowerCase().replace(/^ward\s+/, "");
  if (!s) return null;
  if (s === "c" || s === "b2" || s === "b1" || s === "a" || s === "private") return s;
  throw new InputError(`state (the ward class) must be one of: ${WARD_HELP}. Not recognised: ${raw}.`);
}

const sgd = (v: number) => `${Math.round(v).toLocaleString("en-GB")} SGD`;

export interface BillInput {
  service?: string;
  ward?: string;
  setting?: string;
  baseUrl?: string;
}

const METHOD =
  "Singapore: the Ministry of Health publishes, for each medical condition group (DRG), setting and ward type, the 25th, 50th and 75th percentile of the total hospital bills actually transacted for Singapore Citizens in calendar year 2023 (GST included, before insurance and MediSave). " +
  "We pass the median (P50) on as the figure and P25 and P75 (the quartiles) in extra.p25 and extra.p75; typical_low and typical_high stay empty because they mean 10th to 90th. It is a published statistic, not a record-level calculation, and the number of cases is not published.";

export function billAnswer(rows: DrgRow[], input: BillInput): PriceAnswer {
  const setting = (input.setting ?? "").trim().toLowerCase();
  if (setting && setting !== "inpatient") {
    throw new InputError("Singapore: only hospital stays are published (setting inpatient, or leave setting out). Office and outpatient fees are not in this source.");
  }
  const ward = normaliseWard(input.ward);
  const service = (input.service ?? "").trim();
  const matches = findConditions(rows, service);
  const query = { country: "SG", service, ...(ward ? { ward } : {}) };
  if (!matches.length) {
    return buildStatisticAnswer({
      source: INFO,
      query,
      value: null,
      measure: "median",
      currency: "SGD",
      unit: "per hospital stay",
      period: { from: `${YEAR}-01-01`, to: `${YEAR}-12-31` },
      reference_period: YEAR,
      method: METHOD,
      describe: () => "",
      note: "No medical condition in MOH's benchmark list matches that word. MOH covers selected medical (non-surgical) conditions only, for example stroke, dementia, delirium or spinal cord conditions. Try another word or a DRG code.",
      baseUrl: input.baseUrl,
    });
  }
  // Prefer the closest condition that has a published figure for the ward asked for (or any ward when none was asked for).
  const has = (drg: string) => rows.some((r) => r.drg === drg && r.p50 !== null && r.p50 > 0 && (!ward || r.ward === ward));
  const best = matches.find((m) => has(m.drg)) ?? matches[0];
  matches.splice(0, matches.length, best, ...matches.filter((m) => m !== best));
  const group = rows.filter((r) => r.drg === best.drg);
  const byWard = new Map<Ward, DrgRow>();
  for (const r of group) if (r.p50 !== null && r.p50 > 0) byWard.set(r.ward, r);
  const order = ward ? [ward] : WARD_ORDER;
  const row = order.map((w) => byWard.get(w)).find(Boolean);
  const allWards = WARD_ORDER.filter((w) => byWard.has(w)).map((w) => {
    const r = byWard.get(w)!;
    return { ward: w, label: WARD_LABEL[w], p25: r.p25, median: r.p50, p75: r.p75 };
  });
  if (!row) {
    return buildStatisticAnswer({
      source: INFO,
      query: { ...query, drg: best.drg },
      value: null,
      measure: "median",
      currency: "SGD",
      unit: "per hospital stay",
      period: { from: `${YEAR}-01-01`, to: `${YEAR}-12-31` },
      reference_period: YEAR,
      method: METHOD,
      describe: () => "",
      note: ward
        ? `MOH publishes no figure for ${best.description} (${best.drg}) in ${WARD_LABEL[ward]} (fewer than 10 cases). Available: ${allWards.map((w) => w.label).join("; ") || "none"}.`
        : `MOH publishes no figure for ${best.description} (${best.drg}).`,
      baseUrl: input.baseUrl,
      extra: { drg: best.drg, available_wards: allWards },
    });
  }
  const others = matches.slice(1, 8).map((m) => ({ drg: m.drg, description: m.description }));
  const caveats = [
    "Total bill before insurance and MediSave for Singapore Citizens, data year 2023, GST included; MOH publishes percentiles only and no case count (cells under 10 cases are hidden).",
  ];
  if (!ward && row.ward !== "c") caveats.push(`Ward C has no published figure for this condition, so ${WARD_LABEL[row.ward]} is shown.`);
  if (matches.length > 1) caveats.push(`${matches.length} MOH condition groups match your words; the closest (${best.drg}) is shown. Others are listed in extra.other_matches; use a DRG code to pick one.`);
  return buildStatisticAnswer({
    source: INFO,
    query: { ...query, drg: best.drg, ward: row.ward },
    value: row.p50,
    measure: "median",
    currency: "SGD",
    unit: "per hospital stay (total bill, GST included)",
    period: { from: `${YEAR}-01-01`, to: `${YEAR}-12-31` },
    reference_period: YEAR,
    // MOH publishes quartiles (P25..P75), not 10th-90th percentiles: keep typical_low/high null and name them in extra.
    method: METHOD,
    describe: (v) =>
      `For ${best.description} (${best.drg}), the median total hospital bill in Singapore in ${YEAR} was ${sgd(v)} in a ${WARD_LABEL[row.ward]}` +
      `${row.p25 !== null && row.p75 !== null ? ` (middle half of bills ${sgd(row.p25)} to ${sgd(row.p75)})` : ""}.`,
    note: caveats.join(" "),
    baseUrl: input.baseUrl,
    extra: { place: "Singapore", p25: row.p25 === null ? null : Math.round(row.p25 * 100) / 100, p75: row.p75 === null ? null : Math.round(row.p75 * 100) / 100, range_basis: "lower and upper quartile (25th-75th percentile), as published; typical_low and typical_high are null because they mean 10th-90th", drg: best.drg, condition: best.description, setting: row.setting, ward: row.ward, ward_type: row.wardType, all_wards: allWards, other_matches: others },
  });
}

// ---------- fetching ----------

let cache: { at: number; rows: DrgRow[] } | null = null;
export function clearCache(): void {
  cache = null;
}

export async function loadRows(fetcher: (url: string) => Promise<Buffer> = fetchBuffer): Promise<DrgRow[]> {
  if (cache && Date.now() - cache.at < 24 * 3600 * 1000) return cache.rows;
  const rows = parseDrgRows(readDrgSheet(await fetcher(XLSX_URL)));
  if (!rows.length) throw new SourceError("The MOH workbook held no DRG rows; the layout may have changed.");
  cache = { at: Date.now(), rows };
  return rows;
}

async function fetchBuffer(url: string): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: "follow", headers: { "user-agent": "ProofPrice/1.0 (+https://proofprice.com; hello@proofprice.com)" } });
    if (!res.ok) throw new SourceError(`Source returned HTTP ${res.status}`, url, res.status);
    return Buffer.from(await res.arrayBuffer());
  } catch (err: any) {
    if (err?.name === "AbortError") throw new SourceError("Source timed out", url);
    if (err instanceof SourceError) throw err;
    throw new SourceError("Could not reach the official source", String(err?.cause?.code ?? err?.message ?? err));
  } finally {
    clearTimeout(timer);
  }
}

export async function sgBills(input: BillInput, fetcher?: (url: string) => Promise<Buffer>): Promise<PriceAnswer> {
  return billAnswer(await loadRows(fetcher), input);
}
