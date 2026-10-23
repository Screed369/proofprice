// United States Medicare "maximum fair prices" (MFP): the prices CMS negotiated with drugmakers under the Medicare Drug Price Negotiation
// Program (IPAY 2026, 2027, 2028 lists). One fixed price per drug for a 30-day supply (Single MFP per 30 DES), effective from a stated date.
// A POSTED statutory price ceiling for Medicare, never a price paid by a patient or a pharmacy.
//
// Format proven 2026-10-23 with the GitHub probe (probe mfp-c1): plain GET, no key, 200 application/zip, 44,648 bytes, holding
// CMS_Negotiation_Program_Selected_Drug_List_and_Maximum_Fair_Price_Data_File_20260921.csv (+ the same as .xlsx). Header:
// IPAY,Selected Drug Name,Active Ingredient Name or Active Moiety Name,NDC-9,NDC-11,XREF NDC-11,HCPCS Code,MFP Effective Date,MFP End Date,
// Single MFP per 30 DES,NDC-9 MFP per Unit Price,HCPCS Code Dosage Price,As of Date,Type of Update,Remarks. ~560 rows, dates MM/DD/YYYY.
// Quirks seen in the real file: one drug has many NDC rows with the same price; "MFP End Date" is unreliable (a 2027 row with end 12/31/2026,
// a 2026 row with end 12/31/2025), so the price in force is taken from the LATEST EFFECTIVE DATE on or before today, never from end dates;
// IPAY 2028 drugs have an effective date but no price yet (blank) and are reported as "not yet published".

import { inflateRawSync } from "node:zlib";
import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import type { Params, SourceInfo } from "../../lib/plugin";

export const PAGE_URL = "https://www.cms.gov/initiatives/medicare-prescription-drug-affordability/overview/medicare-drug-price-negotiation-program/selected-drugs-negotiated-prices";
export const ZIP_URL = "https://www.cms.gov/files/zip/selected-drug-list-negotiated-prices-also-known-maximum-fair-prices-statutezip.zip";

export const INFO: SourceInfo = {
  id: "us-cms-mfp",
  country: "US (United States)",
  category: "medicines (Medicare negotiated maximum fair prices)",
  name: "Medicare Drug Price Negotiation Program: selected drugs and negotiated maximum fair prices (MFP)",
  publisher: "Centers for Medicare & Medicaid Services (CMS), U.S. Department of Health and Human Services",
  what_is_recorded:
    "For each drug selected for Medicare price negotiation (initial price applicability years 2026, 2027 and 2028): the negotiated maximum fair price (MFP) for a 30-day supply, " +
    "the date it takes effect, and the later inflation-adjusted prices.",
  price_type: "reimbursement_price",
  freshness: "Updated by CMS a few times a year (file dated 2026-09-21); the effective date of the price in force is stated in every answer",
  licence:
    "U.S. Government work, public domain. The CMS 'Link to Us' page (read 2026-10-23, https://www.cms.gov/about-cms/web-policies-important-links/about-website/link-to-us) says 'It is a public domain web site.'; " +
    "the Selected Drugs and Negotiated Prices page shows no licence, copyright or click-through; the same publisher's data is labelled https://www.usa.gov/publicdomain/label/1.0/ on data.gov.",
  licence_url: "https://www.cms.gov/about-cms/web-policies-important-links/about-website/link-to-us",
  attribution:
    "Source: CMS, Medicare Drug Price Negotiation Program, negotiated maximum fair prices. ProofPrice is not affiliated with or endorsed by CMS or HHS. " +
    "Figures are passed on as published; drug names are trademarks of their owners and are used only to name the drug.",
  homepage: PAGE_URL,
  limits:
    "A maximum fair price is the posted negotiated price Medicare's programme sets for a 30-day supply, not a price paid, not a pharmacy price and not what a patient pays (patients pay cost sharing under their plan). " +
    "Only the drugs CMS selected are listed (about 40 across 2026-2028). One price per drug, so there is no sample size, range or percentile. " +
    "Prices for the 2028 selection are not published yet.",
};

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

/** True when the request asks for Medicare's negotiated maximum fair price (basis=mfp). */
export function isMfpRequest(p: Params): boolean {
  const b = String(p.basis ?? "").toLowerCase().replace(/[^a-z]/g, "");
  return b === "mfp" || b === "maximumfairprice" || b === "negotiated" || b === "negotiatedprice" || b === "medicarenegotiated" || b === "medicarenegotiation";
}

/** First .csv inside the zip. */
export function unzipCsv(buf: Buffer): string {
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
    if (!/\.csv$/i.test(name)) continue;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + csize);
    return (method === 0 ? Buffer.from(raw) : inflateRawSync(raw)).toString("utf8").replace(/^﻿/, "");
  }
  throw new SourceError("The CMS zip holds no CSV; the format may have changed and this source needs updating.");
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

export interface MfpRow {
  ipay: number;
  drug: string; // as CMS names it, e.g. "ELIQUIS; ELIQUIS SPRINKLE"
  ingredient: string;
  effective: string; // ISO date
  price30: number | null; // USD, Single MFP per 30 DES (null = not published yet)
  hcpcs: string;
  hcpcsDosagePrice: number | null;
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const isoDate = (s: string): string | null => {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(clean(s));
  return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : null;
};
const money = (s: string): number | null => {
  const t = s.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Parse the CSV by header NAME. Rows without a drug name or an effective date are dropped. */
export function parseMfp(text: string): MfpRow[] {
  const lines = text.split(/\r?\n/);
  const h = csvFields(lines[0] ?? "").map((x) => clean(x).toLowerCase());
  const col = (re: RegExp) => h.findIndex((x) => re.test(x));
  const c = {
    ipay: col(/^ipay$/),
    drug: col(/^selected drug name$/),
    ing: col(/^active ingredient/),
    eff: col(/^mfp effective date$/),
    p30: col(/^single mfp per 30/),
    hcpcs: col(/^hcpcs code$/),
    hdp: col(/^hcpcs code dosage price$/),
  };
  if (c.ipay < 0 || c.drug < 0 || c.eff < 0 || c.p30 < 0) {
    throw new SourceError("The CMS negotiated-price CSV has no 'IPAY' / 'Selected Drug Name' / 'MFP Effective Date' / 'Single MFP per 30 DES' header any more; the format may have changed and this source needs updating.");
  }
  const out: MfpRow[] = [];
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const f = csvFields(line);
    const drug = clean(f[c.drug] ?? "");
    const effective = isoDate(f[c.eff] ?? "");
    const ipay = Number(clean(f[c.ipay] ?? ""));
    if (!drug || !effective || !Number.isFinite(ipay)) continue;
    out.push({
      ipay,
      drug,
      ingredient: c.ing >= 0 ? clean(f[c.ing] ?? "") : "",
      effective,
      price30: money(f[c.p30] ?? ""),
      hcpcs: c.hcpcs >= 0 ? clean(f[c.hcpcs] ?? "").toUpperCase() : "",
      hcpcsDosagePrice: c.hdp >= 0 ? money(f[c.hdp] ?? "") : null,
    });
  }
  return out;
}

let cache: { at: number; rows: MfpRow[] } | null = null;
const TTL_MS = 6 * 3600 * 1000;

export async function loadMfp(fetcher: Fetcher = defaultFetcher, now = Date.now()): Promise<MfpRow[]> {
  if (cache && now - cache.at < TTL_MS) return cache.rows;
  const rows = parseMfp(unzipCsv(await fetcher(ZIP_URL)));
  if (rows.length < 100 || !rows.some((r) => r.price30 !== null)) throw new SourceError(`The CMS negotiated-price file gave only ${rows.length} usable rows; the format may have changed.`);
  cache = { at: now, rows };
  return rows;
}
export function resetCache(): void {
  cache = null;
}

export interface DrugState {
  drug: string;
  ingredient: string;
  ipay: number;
  effective: string; // ISO date of the price shown
  inForce: boolean; // true = effective on or before today; false = announced, starts later
  price30: number | null;
  prices: number[]; // distinct 30-day prices among the NDCs on that date, ascending
  hcpcs: string[];
  hcpcsDosagePrices: number[];
  next: { effective: string; price30: number } | null; // a later announced price, if any
}

/** Per drug: the prices at the latest effective date on or before `today`; else the earliest announced date. */
export function drugStates(rows: MfpRow[], today: string): DrugState[] {
  const byDrug = new Map<string, MfpRow[]>();
  for (const r of rows) {
    const k = `${r.ipay}|${r.drug}`;
    (byDrug.get(k) ?? byDrug.set(k, []).get(k)!).push(r);
  }
  const out: DrugState[] = [];
  for (const rs of byDrug.values()) {
    const dates = [...new Set(rs.map((r) => r.effective))].sort();
    const past = dates.filter((d) => d <= today && rs.some((r) => r.effective === d && r.price30 !== null));
    const inForce = past.length > 0;
    const shown = inForce ? past[past.length - 1] : dates[0];
    const at = rs.filter((r) => r.effective === shown);
    const prices = [...new Set(at.map((r) => r.price30).filter((x): x is number => x !== null))].sort((a, b) => a - b);
    const later = dates.filter((d) => d > shown && rs.some((r) => r.effective === d && r.price30 !== null));
    const nextRow = later.length ? rs.find((r) => r.effective === later[0] && r.price30 !== null)! : null;
    out.push({
      drug: rs[0].drug,
      ingredient: rs[0].ingredient,
      ipay: rs[0].ipay,
      effective: shown,
      inForce,
      price30: prices.length ? prices[Math.floor((prices.length - 1) / 2)] : null,
      prices,
      hcpcs: [...new Set(at.map((r) => r.hcpcs).filter(Boolean))],
      hcpcsDosagePrices: [...new Set(at.map((r) => r.hcpcsDosagePrice).filter((x): x is number => x !== null))].sort((a, b) => a - b),
      next: nextRow ? { effective: nextRow.effective, price30: nextRow.price30! } : null,
    });
  }
  return out;
}

/** Words the person typed (lower case, strengths and forms dropped). */
export function medicineWords(input: string | undefined): string[] {
  return String(input ?? "")
    .toLowerCase()
    .split(/[\s,;/]+/)
    .map((w) => w.replace(/[^a-z0-9-]/g, ""))
    .filter((w) => /[a-z]/.test(w) && !/^\d/.test(w) && !/^(mg|mcg|ml|iu|tablet|tablets|tab|capsule|injection|pen|xr|sprinkle)$/.test(w));
}

export function matchDrugs(states: DrugState[], words: string[]): DrugState[] {
  if (!words.length) return [];
  return states
    .filter((s) => {
      const hay = `${s.drug} ${s.ingredient}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    })
    .sort((a, b) => a.drug.localeCompare(b.drug));
}

export function methodText(): string {
  return (
    "United States (medicines, Medicare negotiation): the negotiated maximum fair price (MFP) CMS publishes for each drug selected under the Medicare Drug Price Negotiation Program, for a 30-day supply. " +
    "The price shown is the one in force on the day of the question (the latest effective date up to today); a later announced price is listed in extra. A posted Medicare price ceiling, not a price paid and not a pharmacy or patient price."
  );
}

const usd = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
const longDate = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

export interface MfpInput {
  medicine?: string;
  baseUrl?: string;
  now?: number;
}

export async function mfpMedicine(input: MfpInput, fetcher: Fetcher = defaultFetcher): Promise<PriceAnswer> {
  const words = medicineWords(input.medicine);
  if (!words.length) throw new InputError("medicine is required: a brand or generic name of a drug in the Medicare negotiation programme, such as 'Eliquis', 'apixaban', 'Ozempic' or 'Stelara'.");
  const now = input.now ?? Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  const states = drugStates(await loadMfp(fetcher, now), today);
  const hits = matchDrugs(states, words);
  const query = { country: "US", medicine: input.medicine ?? "", basis: "mfp" };
  if (!hits.length) {
    return buildStatisticAnswer({
      source: INFO, query, value: null, measure: "average", currency: "USD", unit: "per 30-day supply", period: { from: null, to: null },
      reference_period: "Medicare maximum fair price list", method: methodText(), describe: () => "", baseUrl: input.baseUrl,
      extra: { hint: "This drug is not on the Medicare negotiation lists (about 40 drugs selected for 2026-2028). Try the brand or the generic name, for example 'Eliquis' or 'apixaban'. The default basis for US medicines is the pharmacy acquisition cost (NADAC)." },
    });
  }
  const head = hits.find((h) => h.price30 !== null) ?? hits[0];
  const others = hits.filter((h) => h !== head);
  const common = {
    source: INFO, query, measure: "average" as const, currency: "USD", unit: "per 30-day supply", method: methodText(), baseUrl: input.baseUrl, sample_size: null,
  };
  const extra = {
    what_the_figure_is: "Medicare's negotiated maximum fair price (MFP) for a 30-day supply of the drug. A posted price ceiling, not a transaction price.",
    selected_drug: head.drug,
    active_ingredient: head.ingredient,
    ipay: head.ipay,
    effective_date: head.effective,
    in_force: head.inForce,
    ...(head.prices.length > 1 ? { prices_by_package: head.prices } : {}),
    ...(head.hcpcs.length ? { hcpcs: head.hcpcs, hcpcs_dosage_prices: head.hcpcsDosagePrices } : {}),
    ...(head.next ? { later_price: { effective_date: head.next.effective, price_30_day_usd: head.next.price30 } } : {}),
    file: ZIP_URL,
    ...(others.length ? { other_matches: others.slice(0, 10).map((o) => ({ drug: o.drug, ipay: o.ipay, effective_date: o.effective, price_30_day_usd: o.price30 })) } : {}),
  };
  if (head.price30 === null) {
    return buildStatisticAnswer({
      ...common, value: null, period: { from: head.effective, to: null }, reference_period: `IPAY ${head.ipay} (price not yet published)`,
      describe: () => "", extra: { ...extra, hint: `${head.drug} is on the Medicare negotiation list for ${head.ipay}, but CMS has not published its maximum fair price yet.` },
    });
  }
  const later = head.next ? ` CMS has announced ${usd(head.next.price30)} from ${longDate(head.next.effective)} (inflation adjustment).` : "";
  return buildStatisticAnswer({
    ...common,
    value: head.price30,
    period: { from: head.effective, to: null },
    reference_period: `MFP effective ${head.effective}`,
    note: "Medicare negotiated maximum fair price: a posted price ceiling, not a price paid.",
    describe: (v) =>
      head.inForce
        ? `Medicare's negotiated maximum fair price for ${head.drug} (${head.ingredient.toLowerCase()}) is ${usd(v)} for a 30-day supply, in force since ${longDate(head.effective)}.${later} ` +
          `That is a posted Medicare price ceiling, not a price paid and not a pharmacy or patient price.`
        : `Medicare's negotiated maximum fair price for ${head.drug} (${head.ingredient.toLowerCase()}) is ${usd(v)} for a 30-day supply, applying from ${longDate(head.effective)}. ` +
          `That is a posted Medicare price ceiling, not a price paid and not a pharmacy or patient price.`,
    extra,
  });
}
