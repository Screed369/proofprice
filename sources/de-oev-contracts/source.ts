// German public contract prices from the Bekanntmachungsservice (Datenservice Oeffentlicher Einkauf, Beschaffungsamt des BMI), oeffentlichevergabe.de.
// Licence read 2026-10-24 (Licence Checker, GovData catalogue record): distribution "Schnittstellenbeschreibung OpenData-Schnittstelle" carries
// licence http://dcat-ap.de/def/licenses/cc-zero (CC0). No attribution required; we print a courtesy line.
// Format checked 2026-10-24 from GitHub's servers (probes deoev-csv, deoev-members, HTTP 200, no key):
//   GET https://oeffentlichevergabe.de/api/notice-exports?pubDay=2026-10-22&format=csv.zip  (pubMonth=YYYY-MM works too) -> a zip of 19 CSV files
//   (notice, lot, organisation, purpose, classification, ..., noticeResult, procedureLotResult, tender, contract ...), UTF-8, comma separated.
//   notice.csv:    noticeIdentifier,noticeVersion,procedureIdentifier,procedureLegalBasis,formType,noticeType,publicationDate
//                  e.g. ac2c1cf7-...,01,6f5c1009-...,32014L0024,result,can-standard,2026-10-22T02:06:04Z   (award notices: formType result, noticeType can-standard)
//   tender.csv:    noticeIdentifier,noticeVersion,tenderIdentifier,lotIdentifier,tenderValue,tenderValueCurrency,tenderPaymentValue,...,tenderRank,...
//                  e.g. ac2c1cf7-...,01,TEN-0001,LOT-0001,667584.00,EUR,,,,,,,,,,
//   contract.csv:  noticeIdentifier,noticeVersion,contractIdentifier,winnerDecisionDate,contractConclusionDate,contractFrameworkAgreement
//                  e.g. ac2c1cf7-...,01,CON-0001,,2026-10-20T00:00:00+02:00,
//   classification.csv: noticeIdentifier,noticeVersion,lotIdentifier,classificationType,mainClassificationCode,additionalClassificationCodes,options
//                  e.g. ac2c1cf7-...,01,,cpv,71300000,71541000,      (a row with an empty lotIdentifier is the notice-level code)
//   procedureLotResult.csv: noticeIdentifier,noticeVersion,lotIdentifier,procedureLotResultNumber,winnerChosen,notAwardedReason,frameworkMaximumValue,...
//                  e.g. ac2c1cf7-...,01,LOT-0001,0,selec-w,,,,,,667584.00,EUR,904355.00,EUR
// The other files (organisation, purpose, ...) hold buyer names, contact details and texts: they are never opened, and no name is ever kept.
// The monthly zips are big (about 25 MB), so harvest() reads the recent months once a day and keeps aggregates only.
import { inflateRawSync } from "node:zlib";
import { InputError, SourceError } from "../../lib/http";
import type { HarvestResult, SourceInfo } from "../../lib/plugin";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { readLatestDay } from "../../lib/library/store";
import { cleanCpv, matchPurchase, PURCHASES } from "../../categories/contracts/purchases";
import { aggregateAll, windowStart, zipDirectory, type PtContract } from "../pt-base-contracts/source";

export const INFO: SourceInfo = {
  id: "de-oev-contracts",
  country: "DE (federal, state and municipal public buyers using the German notice service)",
  category: "government contracts (awarded contracts)",
  name: "Bekanntmachungsservice: German public contract award notices (Datenservice Öffentlicher Einkauf)",
  publisher: "Beschaffungsamt des BMI, Bekanntmachungsservice / Datenservice Öffentlicher Einkauf (oeffentlichevergabe.de)",
  what_is_recorded:
    "Contract award notices published by German public buyers: what was bought (CPV product code), the date the contract was concluded and the value of the winning tender in euros.",
  price_type: "contract_price",
  freshness: "Daily: the notice service publishes each day's notices and our copy is collected once a day",
  licence: "CC0 1.0 (open-data interface of the Bekanntmachungsservice, GovData catalogue)",
  licence_url: "https://www.oeffentlichevergabe.de/documentation/swagger-ui/opendata/index.html",
  attribution:
    "Source: Bekanntmachungsservice, Datenservice Öffentlicher Einkauf (Beschaffungsamt des BMI), oeffentlichevergabe.de, CC0. Figures are ProofPrice aggregates of the published award notices.",
  homepage: "https://www.oeffentlichevergabe.de/",
  limits:
    "Winning-tender values as stated on award notices, in euros, over the whole contract (often several years); they are not unit prices and not amounts paid yet. " +
    "Only notices published on the German notice service are covered: contracts below the thresholds that are not published there are missing, and only the newest months are read. " +
    "Framework agreements (whose stated value is usually a ceiling) are left out, a notice is counted once at its newest version, equal tender values in one notice count once, " +
    "and values under 500 euros (placeholders) or over 1 billion euros (entry errors) are left out. Purchases are recognised from the lot's main CPV product code. " +
    "Aggregates only; buyers, suppliers and contact details in the open files are never read or kept.",
  method_version: "1",
};

export const WINDOW_MONTHS = 6;
export const MIN_VALUE = 500;
export const MAX_VALUE = 1_000_000_000;
export const UNIT = "per contract, total value of the winning tender";
export const TIME_BUDGET_MS = 7 * 60 * 1000;
export const EXPORT_URL = "https://oeffentlichevergabe.de/api/notice-exports";

// ---------- CSV ----------

/** Pure: CSV text (comma, double quotes, "" escapes, quoted line breaks, optional BOM) to rows of objects keyed by the header. */
export function csvRows(text: string): Record<string, string>[] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const o: Record<string, string> = {};
    head.forEach((h, i) => (o[h] = r[i] ?? ""));
    return o;
  });
}

export const NEEDED_FILES = ["notice.csv", "tender.csv", "contract.csv", "classification.csv", "procedureLotResult.csv"] as const;
export type DeFiles = Record<(typeof NEEDED_FILES)[number], string>;

/** Inflate only the five tables we need out of a notice-export zip held in memory. */
export function filesFromZip(zip: Buffer): DeFiles {
  const dir = zipDirectory(zip);
  const out: Record<string, string> = {};
  for (const name of NEEDED_FILES) {
    const e = dir.get(name);
    if (!e) throw new SourceError(`The notice-export zip has no ${name}: the format may have changed and this source needs updating.`);
    const raw = zip.subarray(e.start, e.start + e.csize);
    if (e.method === 8) out[name] = inflateRawSync(raw).toString("utf8");
    else if (e.method === 0) out[name] = raw.toString("utf8");
    else throw new SourceError(`The notice-export zip uses an unsupported compression (${e.method}).`);
  }
  return out as DeFiles;
}

// ---------- the contracts ----------

const FRAMEWORK_NO = /^(none|no|false|0|n\/a)?$/i;

/** One notice's usable contracts and its version, so a corrected notice replaces the older one. */
export interface NoticeContracts {
  version: string;
  contracts: PtContract[];
}

/** Pure: the award notices of one export, as a map noticeIdentifier -> newest version with its contract values. */
export function noticesFromFiles(f: DeFiles, from: string, to: string): Map<string, NoticeContracts> {
  const latest = new Map<string, { version: string; published: string }>();
  for (const r of csvRows(f["notice.csv"])) {
    if (r.noticeType !== "can-standard" || r.formType !== "result" || !r.noticeIdentifier) continue;
    const have = latest.get(r.noticeIdentifier);
    if (!have || r.noticeVersion >= have.version) latest.set(r.noticeIdentifier, { version: r.noticeVersion, published: String(r.publicationDate ?? "").slice(0, 10) });
  }
  const current = (r: Record<string, string>) => latest.get(r.noticeIdentifier)?.version === r.noticeVersion;

  const signed = new Map<string, string>(); // notice -> earliest conclusion date
  const framework = new Set<string>();
  for (const r of csvRows(f["contract.csv"])) {
    if (!current(r)) continue;
    if (!FRAMEWORK_NO.test((r.contractFrameworkAgreement ?? "").trim())) framework.add(r.noticeIdentifier);
    const d = String(r.contractConclusionDate ?? "").slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      const have = signed.get(r.noticeIdentifier);
      if (!have || d < have) signed.set(r.noticeIdentifier, d);
    }
  }

  const lotCpv = new Map<string, string>(); // notice\0lot ("" = notice level) -> 8-digit CPV
  for (const r of csvRows(f["classification.csv"])) {
    if (!current(r) || (r.classificationType ?? "").toLowerCase() !== "cpv") continue;
    const code = String(r.mainClassificationCode ?? "").replace(/\D/g, "").slice(0, 8);
    if (code.length !== 8) continue;
    const k = `${r.noticeIdentifier}\u0000${r.lotIdentifier ?? ""}`;
    if (!lotCpv.has(k)) lotCpv.set(k, code);
  }

  const lotOut = new Set<string>(); // lots without a chosen winner, or under a framework value
  for (const r of csvRows(f["procedureLotResult.csv"])) {
    if (!current(r)) continue;
    const k = `${r.noticeIdentifier}\u0000${r.lotIdentifier ?? ""}`;
    const won = (r.winnerChosen ?? "") === "selec-w";
    const fw = (r.frameworkMaximumValue ?? "") !== "" || (r.frameworkEstimatedValue ?? "") !== "";
    if (!won || fw) lotOut.add(k);
  }

  const out = new Map<string, NoticeContracts>();
  const seen = new Set<string>();
  for (const r of csvRows(f["tender.csv"])) {
    if (!current(r) || framework.has(r.noticeIdentifier)) continue;
    const lotKey = `${r.noticeIdentifier}\u0000${r.lotIdentifier ?? ""}`;
    if (lotOut.has(lotKey)) continue;
    if ((r.tenderValueCurrency ?? "").toUpperCase() !== "EUR") continue;
    const value = Number(r.tenderValue);
    if (!Number.isFinite(value) || value < MIN_VALUE || value > MAX_VALUE) continue;
    const cpv = lotCpv.get(lotKey) ?? lotCpv.get(`${r.noticeIdentifier}\u0000`) ?? "";
    if (cpv.length !== 8) continue;
    const date = signed.get(r.noticeIdentifier) ?? latest.get(r.noticeIdentifier)?.published ?? "";
    if (!date || date < from || date > to) continue;
    const dupe = `${r.noticeIdentifier}\u0000${value}`;
    if (seen.has(dupe)) continue; // the same value repeated for several tenders or lots of one notice counts once
    seen.add(dupe);
    const entry = out.get(r.noticeIdentifier) ?? { version: r.noticeVersion, contracts: [] };
    entry.contracts.push({ key: dupe, date, value, cpv });
    out.set(r.noticeIdentifier, entry);
  }
  return out;
}

/** Pure: months the window touches, newest first, as YYYY-MM. */
export function monthsInWindow(today: string, months = WINDOW_MONTHS): string[] {
  const d = new Date(today + "T00:00:00Z");
  const out: string[] = [];
  for (let i = 0; i <= months; i++) out.push(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
  return out;
}

export type Loader = (month: string) => Promise<Buffer>;

async function downloadMonth(month: string): Promise<Buffer> {
  const res = await fetch(`${EXPORT_URL}?pubMonth=${month}&format=csv.zip`, {
    redirect: "follow",
    headers: { "user-agent": "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)" },
    signal: AbortSignal.timeout(3 * 60 * 1000),
  });
  if (!res.ok) throw new SourceError(`The notice service answered HTTP ${res.status} for ${month}`);
  return Buffer.from(await res.arrayBuffer());
}

export interface HarvestOptions {
  load?: Loader;
  budgetMs?: number;
  months?: number;
}

export async function deContractsHarvest(now: Date = new Date(), o: HarvestOptions = {}): Promise<HarvestResult> {
  const started = Date.now();
  const to = now.toISOString().slice(0, 10);
  const months = o.months ?? WINDOW_MONTHS;
  const from = windowStart(to, months);
  const load = o.load ?? downloadMonth;
  const budget = o.budgetMs ?? TIME_BUDGET_MS;
  const all = new Map<string, NoticeContracts>();
  const read: string[] = [];
  const failed: string[] = [];
  let lastError: unknown = null;
  for (const month of monthsInWindow(to, months)) {
    if (Date.now() - started > budget) {
      failed.push(`${month} (time)`);
      continue;
    }
    try {
      const notices = noticesFromFiles(filesFromZip(await load(month)), from, to);
      for (const [id, n] of notices) {
        const have = all.get(id);
        if (!have || n.version >= have.version) all.set(id, n);
      }
      read.push(month);
    } catch (err) {
      failed.push(month);
      lastError = err;
    }
  }
  if (!read.length) throw new SourceError("Could not read the German notice-export files (oeffentlichevergabe.de)", String((lastError as any)?.message ?? lastError));
  const contracts: PtContract[] = [];
  for (const n of all.values()) contracts.push(...n.contracts);
  if (!contracts.length) throw new SourceError("The German notice exports held no usable award values in the window: the file format may have changed");
  return {
    date: to,
    currency: "EUR",
    unit: UNIT,
    rows: aggregateAll(contracts, from, to),
    note:
      `Award notices with contracts concluded ${from} to ${to}; ${all.size} notices in ${read.length} monthly exports (${read.slice().sort().join(", ")}), ${contracts.length} usable values.` +
      (failed.length ? ` Not read this day: ${failed.join(", ")}.` : ""),
  };
}

// ---------- the answer ----------

export interface DeInput {
  what: string;
  cpv?: string;
  buyer_area?: string;
  baseUrl?: string;
}

export const SUPPORTED_EXAMPLES = ["laptops", "school meals", "road resurfacing", "office cleaning", "catering", "ambulances"];

export async function deContracts(input: DeInput): Promise<PriceAnswer> {
  if (input.buyer_area) throw new InputError("Germany: buyer_area is not used; the figures are for all German public buyers together.");
  let item: string;
  let label: string;
  let matched: Record<string, string>;
  if (input.cpv) {
    const code = cleanCpv(input.cpv);
    if (!code || code.length === 3) {
      throw new InputError("Germany: cpv must be a CPV product code of 2 digits (a division such as 30) or 4 to 8 digits (30213100); 4 digits or more are read as the 4-digit group (3021).");
    }
    const group = code.length === 2 ? code : code.slice(0, 4);
    item = `cpv-${group}`;
    label = `contracts under CPV group ${group}`;
    matched = { cpv_group: group, cpv_requested: code };
  } else {
    const p = matchPurchase(input.what);
    if (!p) {
      throw new InputError(
        `Germany: "${input.what}" is not one of the purchases we summarise from the German notice service. Try a common purchase such as ${SUPPORTED_EXAMPLES.join(", ")} (${PURCHASES.length} are recognised), or pass a CPV product code in cpv.`,
      );
    }
    item = p.id;
    label = `${p.label} contracts`;
    matched = { matched_purchase: p.id };
  }
  const day = readLatestDay(INFO.id);
  if (!day) throw new SourceError("German contract prices have not been collected yet; the daily collector fills them. Try again tomorrow.");
  const from = windowStart(day.date, WINDOW_MONTHS);
  const row = day.rows.find((r) => r.area === "ALL" && r.item === item);
  const summary = row ? { count: row.n, median: row.median, low: row.low, high: row.high, min: row.min, max: row.max } : null;
  return buildAnswer({
    source: INFO,
    query: { country: "DE", what: input.what, ...(input.cpv ? { cpv: input.cpv } : {}) },
    summary,
    currency: "EUR",
    unit: UNIT,
    period: { from, to: day.date },
    method:
      `German award notices with contracts concluded ${from} to ${day.date}, recognised by the lot's CPV product code (${label}). Median and 10th–90th percentile of the winning tender value in EUR. ` +
      "Totals per contract, not unit prices; frameworks are left out; buyers and suppliers are never named.",
    describe: (s) =>
      `German public buyers awarded ${label} with a median winning-tender value of ${fmtMoney(s.median, "EUR")} per contract ` +
      `(typical range ${fmtMoney(s.low, "EUR")} to ${fmtMoney(s.high, "EUR")}, 10th to 90th percentile). These are totals per contract, not unit prices.`,
    baseUrl: input.baseUrl,
    extra: { value_basis: "winning tender value on the award notice (whole contract), not a unit price", ...matched, newest_collection: day.date },
  });
}
