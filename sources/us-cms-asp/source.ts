// United States physician-administered drug prices as Medicare pays them: the CMS "Medicare Part B Drug Average Sales Price (ASP)
// Pricing Files" -> the quarterly Medicare Part B Payment Limit File (HCPCS J-codes and similar: injectables, infusions, biologics
// given in a doctor's office or hospital outpatient department). One payment limit per HCPCS code and billing dosage
// (for example "10 mg" or "1 mg"). The limit is ASP + 6% (a Medicare formula), a POSTED reimbursement rate, never a price paid.
//
// Formats checked on 2026-10-23 through the GitHub probe (probes cms-asp, lc-cms-asp-page; from the Verifier on 2026-10-20):
//  - Page https://www.cms.gov/medicare/payment/part-b-drugs/asp-pricing-files lists the quarterly zips newest first, as
//    href="/files/zip/october-2026-medicare-part-b-payment-limit-files-final.zip" (the file names vary a little each quarter);
//  - the zip (85 KB, no key) holds "October 2026 Medicare Part B Payment Limit File 091626.xls", "section 508 version of October 2026
//    Medicare Part B Payment Limit File 091626.csv" (64 KB), plus a "Drugs Not Payable" xls and csv (a different list);
//  - the CSV starts with title lines, then a header row with "HCPCS Code" and "Payment Limit" columns. The probe only displayed the
//    Drugs-Not-Payable csv, so the payment-limit header is read by NAME below (never by position), and the first preview run is the
//    live check of that header.
//
// Only HCPCS Level II codes and the short descriptor are used. Any column that looks like an AMA CPT (Level I) descriptor is ignored.

import { inflateRawSync } from "node:zlib";
import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import type { Params, SourceInfo } from "../../lib/plugin";

export const INFO: SourceInfo = {
  id: "us-cms-asp",
  country: "US (United States)",
  category: "medicines (Medicare Part B payment limits for physician-administered drugs)",
  name: "Medicare Part B Drug Payment Limit File (ASP pricing files, quarterly)",
  publisher: "Centers for Medicare & Medicaid Services (CMS), U.S. Department of Health and Human Services",
  what_is_recorded:
    "Each quarter, for each HCPCS code of a drug or biological given by a doctor or hospital outpatient department (injections, infusions, biologics): " +
    "the Medicare Part B payment limit per billing dosage (for example per 10 mg), which CMS sets at the manufacturers' average sales price (ASP) plus 6%.",
  price_type: "reimbursement_price",
  freshness: "Quarterly (January, April, July, October); the quarter is stated in every answer",
  licence:
    "U.S. Government work, public domain. The CMS ASP Pricing Files page (read 2026-10-23, https://www.cms.gov/medicare/payment/part-b-drugs/asp-pricing-files) shows no licence, copyright or CPT click-through agreement; " +
    "the same publisher's data is labelled https://www.usa.gov/publicdomain/label/1.0/ on data.gov. Only HCPCS Level II codes and short descriptors are used (CPT descriptors are AMA copyright and are not used).",
  licence_url: "https://www.cms.gov/medicare/payment/part-b-drugs/asp-pricing-files",
  attribution:
    "Source: CMS, Medicare Part B ASP Drug Pricing Files (payment limits). ProofPrice is not affiliated with or endorsed by CMS. " +
    "Figures are passed on as published; drug names are trademarks of their owners and are used only to name the drug.",
  homepage: "https://www.cms.gov/medicare/payment/part-b-drugs/asp-pricing-files",
  limits:
    "A payment limit is the posted amount Medicare allows for a billing dosage (ASP + 6%), not a price paid, not a pharmacy price and not what a patient pays (Medicare normally pays 80% of the allowed amount). " +
    "It covers drugs billed under Part B, not drugs bought at a pharmacy (see the default NADAC basis). " +
    "ASP is the manufacturers' average over a quarter two quarters earlier. The unit is the HCPCS billing dosage (10 mg, 1 mg, 1 vial...), so figures for different codes are not comparable. " +
    "Some codes have no limit (carrier priced) and are left out.",
};

export const PAGE_URL = "https://www.cms.gov/medicare/payment/part-b-drugs/asp-pricing-files";
export const ORIGIN = "https://www.cms.gov";

export type Fetcher = (url: string) => Promise<Buffer>;
const UA = "ProofPrice/1.0 (+https://proofprice.com; hello@proofprice.com)";

export async function defaultFetcher(url: string, timeoutMs = 25000): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "user-agent": UA } });
    if (!res.ok) throw new SourceError(`Source returned HTTP ${res.status}`, (await res.text().catch(() => "")).slice(0, 300), res.status);
    return Buffer.from(await res.arrayBuffer());
  } catch (err: any) {
    if (err?.name === "AbortError") throw new SourceError("Source timed out", url);
    if (err instanceof SourceError) throw err;
    throw new SourceError("Could not reach the official source", String(err?.cause?.code ?? err?.message ?? err));
  } finally {
    clearTimeout(timer);
  }
}

/** True when the request asks for the Medicare Part B payment limit (basis=part_b_asp). */
export function isPartBAspRequest(p: Params): boolean {
  const b = String(p.basis ?? "").toLowerCase().replace(/[^a-z]/g, "");
  return b === "partbasp" || b === "asp" || b === "partb" || b === "medicarepartb" || b === "medicarepartbasp" || b === "paymentlimit";
}

/** The newest payment-limit zip linked on the CMS page (the page lists them newest first). */
export function findZipUrl(html: string): string | null {
  const re = /href="(\/files\/zip\/[a-z0-9-]*payment-limit-files[a-z0-9-]*\.zip)"/gi;
  const m = re.exec(html);
  return m ? ORIGIN + m[1] : null;
}

/** The quarter from the zip file name: october-2026-... -> "2026-Q4" with the month ("October 2026"). */
export function quarterOf(zipUrl: string): { label: string; from: string; to: string; ref: string } | null {
  const m = /\/(january|april|july|october)-(\d{4})-/i.exec(zipUrl);
  if (!m) return null;
  const month = m[1].toLowerCase();
  const year = m[2];
  const q = { january: ["01-01", "03-31", "Q1"], april: ["04-01", "06-30", "Q2"], july: ["07-01", "09-30", "Q3"], october: ["10-01", "12-31", "Q4"] }[month]!;
  return { label: `${month[0].toUpperCase()}${month.slice(1)} ${year}`, from: `${year}-${q[0]}`, to: `${year}-${q[1]}`, ref: `${year}-${q[2]}` };
}

/** Read the payment-limit CSV out of the zip (the zip also holds a "Drugs Not Payable" csv, which is not this file). */
export function unzipPaymentLimitCsv(buf: Buffer): string {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new SourceError("CMS did not return a zip file; try again shortly.");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (!/\.csv$/i.test(name) || !/payment limit/i.test(name) || /not payable/i.test(name)) continue;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + csize);
    return (method === 0 ? Buffer.from(raw) : inflateRawSync(raw)).toString("utf8").replace(/^﻿/, "");
  }
  throw new SourceError("The CMS zip holds no Payment Limit CSV; the format may have changed and this source needs updating.");
}

/** One CSV line into fields (double-quoted, "" is a quote). */
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

export interface AspRow {
  code: string; // HCPCS Level II code, e.g. J9271
  description: string; // short descriptor
  dosage: string; // billing dosage, e.g. "1 mg"
  limit: number; // USD per billing dosage
}

const clean = (s: string) => s.replace(/[\t ]+/g, " ").replace(/\s+/g, " ").trim();
const money = (s: string): number | null => {
  const t = s.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Parse the Payment Limit CSV. The header row is found by name; rows without a code or a positive limit are dropped. */
export function parsePaymentLimits(text: string): AspRow[] {
  const lines = text.split(/\r?\n/);
  let hdr = -1;
  let cols = { code: -1, desc: -1, dosage: -1, limit: -1 };
  for (let i = 0; i < lines.length && i < 60; i++) {
    const f = csvFields(lines[i]).map((x) => clean(x).toLowerCase());
    const code = f.findIndex((x) => x === "hcpcs code");
    const limit = f.findIndex((x) => /^payment limit/.test(x));
    if (code >= 0 && limit >= 0) {
      hdr = i;
      cols = {
        code,
        limit,
        desc: f.findIndex((x) => /short description|description/.test(x) && !/cpt/.test(x)),
        dosage: f.findIndex((x) => /dosage/.test(x)),
      };
      break;
    }
  }
  if (hdr < 0) throw new SourceError("The CMS Payment Limit CSV has no 'HCPCS Code' / 'Payment Limit' header any more; the format may have changed and this source needs updating.");
  const out: AspRow[] = [];
  for (const line of lines.slice(hdr + 1)) {
    if (!line.trim()) continue;
    const f = csvFields(line);
    const code = clean(f[cols.code] ?? "").toUpperCase();
    if (!/^[A-Z]\d{4}$/.test(code)) continue;
    const limit = money(f[cols.limit] ?? "");
    if (limit === null) continue;
    out.push({
      code,
      description: cols.desc >= 0 ? clean(f[cols.desc] ?? "") : "",
      dosage: cols.dosage >= 0 ? clean(f[cols.dosage] ?? "") : "",
      limit,
    });
  }
  return out;
}

export interface AspFile {
  rows: AspRow[];
  zipUrl: string;
  quarter: { label: string; from: string; to: string; ref: string } | null;
}

let cache: { at: number; file: AspFile } | null = null;
const TTL_MS = 6 * 3600 * 1000;

export async function loadAsp(fetcher: Fetcher = defaultFetcher, now = Date.now()): Promise<AspFile> {
  if (cache && now - cache.at < TTL_MS) return cache.file;
  const html = (await fetcher(PAGE_URL)).toString("utf8");
  const zipUrl = findZipUrl(html);
  if (!zipUrl) throw new SourceError("The CMS ASP pricing page lists no Payment Limit zip any more; the page may have changed and this source needs updating.");
  const rows = parsePaymentLimits(unzipPaymentLimitCsv(await fetcher(zipUrl)));
  if (rows.length < 100) throw new SourceError(`The CMS Payment Limit file gave only ${rows.length} usable rows; the format may have changed.`);
  const file = { rows, zipUrl, quarter: quarterOf(zipUrl) };
  cache = { at: now, file };
  return file;
}

export function resetCache(): void {
  cache = null;
}

/** First word(s) of what the user typed, lower case; an HCPCS code (J9271) is kept as it is. */
export function medicineQuery(input: string | undefined): { code: string | null; words: string[] } {
  const raw = String(input ?? "").trim();
  const code = /^[A-Za-z]\d{4}$/.test(raw) ? raw.toUpperCase() : null;
  const words = raw
    .toLowerCase()
    .split(/[\s,;/]+/)
    .map((w) => w.replace(/[^a-z0-9-]/g, ""))
    .filter((w) => /[a-z]/.test(w) && !/^\d/.test(w) && !/^(mg|mcg|ml|iu|unit|units|injection|inj|vial)$/.test(w));
  return { code, words };
}

/** Rows whose code is the query, or whose short descriptor contains every word. */
export function matchRows(rows: AspRow[], q: { code: string | null; words: string[] }): AspRow[] {
  if (q.code) return rows.filter((r) => r.code === q.code);
  if (!q.words.length) return [];
  return rows.filter((r) => q.words.every((w) => r.description.toLowerCase().includes(w)));
}

const usd = (v: number) => (v >= 100 ? `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : v >= 1 ? `$${v.toFixed(2)}` : `$${v.toFixed(3)}`);

export function methodText(): string {
  return (
    "United States (medicines given by a doctor, Medicare Part B): the quarterly Medicare Part B Drug Payment Limit File from CMS. For a drug name or HCPCS code we pass on the published payment limit " +
    "(the manufacturers' average sales price plus 6%) per billing dosage. A posted Medicare reimbursement rate, not a price paid and not a pharmacy price; the default basis for US medicines is the pharmacy acquisition cost (NADAC)."
  );
}

export interface AspInput {
  medicine?: string;
  baseUrl?: string;
}

export async function aspMedicine(input: AspInput, fetcher: Fetcher = defaultFetcher): Promise<PriceAnswer> {
  const q = medicineQuery(input.medicine);
  if (!q.code && !q.words.length) {
    throw new InputError("medicine is required: a generic drug name such as 'pembrolizumab' or 'ranibizumab', or an HCPCS code such as J9271.");
  }
  const file = await loadAsp(fetcher);
  const hits = matchRows(file.rows, q);
  const query = { country: "US", medicine: input.medicine ?? "", basis: "part_b_asp" };
  const quarter = file.quarter;
  const period = { from: quarter?.from ?? null, to: quarter?.to ?? null };
  const refPeriod = quarter ? `${quarter.label} quarterly payment limit file` : "Medicare Part B Payment Limit File";
  if (!hits.length) {
    return buildStatisticAnswer({
      source: INFO, query, value: null, measure: "average", currency: "USD", unit: "per billing dosage", period, reference_period: refPeriod,
      method: methodText(), describe: () => "", baseUrl: input.baseUrl,
      extra: { hint: "No Part B payment limit has a descriptor with this name. CMS lists the generic name (for example 'pembrolizumab', not Keytruda) or you can give the HCPCS code (J9271)." },
    });
  }
  // Headline: the exact HCPCS code, else the first code in code order (the others are listed so the person can choose).
  const sorted = [...hits].sort((a, b) => a.code.localeCompare(b.code));
  const head = sorted[0];
  const others = sorted.slice(1);
  const dosage = head.dosage || "billing dosage";
  return buildStatisticAnswer({
    source: INFO,
    query,
    value: head.limit,
    measure: "average",
    currency: "USD",
    unit: `per ${dosage}`.replace(/^per per /, "per "),
    period,
    reference_period: refPeriod,
    sample_size: null,
    method: methodText(),
    note: "Medicare Part B payment limit (average sales price + 6%): a posted reimbursement rate, not a price paid.",
    baseUrl: input.baseUrl,
    describe: (v) =>
      `For ${quarter?.label ?? "the latest quarter"}, Medicare Part B's payment limit for ${head.description || head.code} (HCPCS ${head.code}) is ${usd(v)} per ${dosage}. ` +
      `That is the posted Medicare reimbursement rate (manufacturers' average sales price plus 6%) for drugs given by a doctor, not a price paid and not a pharmacy price.`,
    extra: {
      what_the_figure_is: "CMS Medicare Part B payment limit per HCPCS billing dosage: average sales price (ASP) + 6%. A reimbursement rate, not a transaction price.",
      headline_code: head.code,
      headline_description: head.description,
      billing_dosage: head.dosage,
      file: file.zipUrl,
      other_matches: others.slice(0, 20).map((r) => ({ hcpcs: r.code, description: r.description, billing_dosage: r.dosage, payment_limit_usd: r.limit })),
      ...(others.length > 20 ? { other_matches_shown: 20, other_matches_total: others.length } : {}),
    },
  });
}
