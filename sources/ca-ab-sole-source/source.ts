// Alberta sole-source service contracts (Government of Alberta, Open Government Licence - Alberta).
// Format checked 2026-10-24 from GitHub's servers (probes vb-ab-csv, abss2): key-free plain GET of
// https://sole-source.dataservices.alberta.ca/SoleSourceDataService.svc/file.exportcsv (5.8 MB, UTF-8 CSV, quoted, trailing comma on every row,
// all years from 2015, updated quarterly). Columns used: startDate (M/D/YYYY 12:00:00 AM), contractAmount (CAD), contractServices (free text).
// Vendor names and addresses are NEVER read or kept (some vendors are individuals). Only aggregates are stored.
import { InputError, SourceError } from "../../lib/http";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { summarise } from "../../lib/stats";
import { readLatestDay } from "../../lib/library/store";
import { matchPurchase, PURCHASES } from "../../categories/contracts/purchases";

export const INFO: SourceInfo = {
  id: "ca-ab-sole-source",
  country: "CA (Alberta provincial government)",
  category: "government contracts (sole-source awards)",
  name: "Alberta sole-source service contracts",
  publisher: "Government of Alberta (Open Alberta)",
  what_is_recorded:
    "Service contracts of CA$10,000 or more that Alberta government departments awarded without competition (sole source): department, start date, awarded amount in Canadian dollars and a short description of the service.",
  price_type: "contract_price",
  freshness: "Quarterly: the Government of Alberta adds new sole-source contracts each quarter; our copy is collected once a day",
  licence: "Open Government Licence - Alberta",
  licence_url: "https://open.alberta.ca/licence",
  attribution:
    "Contains information licensed under the Open Government Licence - Alberta. Source: Government of Alberta, Sole-source service contracts. Figures are ProofPrice aggregates (changes made: grouped, medians and ranges calculated).",
  homepage: "https://open.alberta.ca/opendata/sole-source-service-contracts",
  limits:
    "Alberta provincial departments only (not municipalities, agencies or federal contracts) and only contracts awarded WITHOUT competition, of CA$10,000 or more, so the low end of every range sits at that floor and many contracts are exactly CA$10,000 or CA$25,000. " +
    "The amount is the contract value, often over a whole contract period; it is not a unit price and not an amount paid yet. Services are recognised from the short free-text description; an unusual description is missed. " +
    "Aggregates only; suppliers are never named.",
  method_version: "1",
};

export const CSV_URL = "https://sole-source.dataservices.alberta.ca/SoleSourceDataService.svc/file.exportcsv";
export const WINDOW_MONTHS = 24;
export const MIN_VALUE = 10000 - 1; // the publisher lists contracts of CA$10,000 or more
export const UNIT = "per contract, total awarded value";
export const ALL_ITEM = "all";

/** True for a request that names Alberta (serves() here; ca-canadabuys-contracts has the mirror rule). */
export function isAlbertaArea(area: unknown): boolean {
  const t = String(area ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
  return ["alberta", "ab", "province of alberta", "government of alberta", "alberta government"].includes(t);
}

/** Pure: quoted CSV text to rows of cells (handles "" escapes, commas and newlines inside quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  const t = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"') {
        if (t[i + 1] === '"') { cell += '"'; i++; } else q = false;
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); if (row.some((x) => x !== "")) rows.push(row); }
  return rows;
}

export interface AbContract { date: string; value: number; services: string }

/** M/D/YYYY (with or without a time) to YYYY-MM-DD, or "" */
export function isoDate(s: string): string {
  const m = String(s).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return "";
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

/** Pure: the CSV to contracts. Only department-free fields we use are read: startDate, contractAmount, contractServices (vendor columns are skipped). */
export function contractsFromCsv(text: string): AbContract[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const head = rows[0].map((h) => h.trim());
  const iDate = head.indexOf("startDate"), iAmt = head.indexOf("contractAmount"), iSvc = head.indexOf("contractServices");
  if (iDate < 0 || iAmt < 0 || iSvc < 0) throw new SourceError("The Alberta sole-source file does not have the expected columns (startDate, contractAmount, contractServices)");
  const out: AbContract[] = [];
  for (const r of rows.slice(1)) {
    const value = Number(String(r[iAmt] ?? "").replace(/[$,\s]/g, ""));
    const date = isoDate(r[iDate] ?? "");
    if (!date || !Number.isFinite(value) || value <= MIN_VALUE) continue;
    out.push({ date, value, services: String(r[iSvc] ?? "").replace(/\s+/g, " ").trim() });
  }
  return out;
}

export function windowStart(today: string, months = WINDOW_MONTHS): string {
  const d = new Date(today + "T00:00:00Z");
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - months, d.getUTCDate())).toISOString().slice(0, 10);
}

/** Pure: contracts to library rows: one for all sole-source contracts and one per recognised purchase, each with at least 5 contracts. */
export function aggregate(contracts: AbContract[], from: string, to: string): DailyRow[] {
  const groups = new Map<string, number[]>();
  const add = (item: string, v: number) => { const g = groups.get(item); if (g) g.push(v); else groups.set(item, [v]); };
  for (const c of contracts) {
    if (c.date < from || c.date > to) continue;
    add(ALL_ITEM, c.value);
    const p = matchPurchase(c.services);
    if (p) add(p.id, c.value);
  }
  const rows: DailyRow[] = [];
  for (const [item, values] of groups) {
    const s = summarise(values);
    if (!s || s.count < 5) continue;
    rows.push({ area: "ALL", item, n: s.count, median: s.median, low: s.low, high: s.high, min: s.min, max: s.max });
  }
  return rows.sort((a, b) => a.item.localeCompare(b.item));
}

export async function abSoleSourceHarvest(now: Date = new Date()): Promise<HarvestResult> {
  const to = now.toISOString().slice(0, 10);
  const from = windowStart(to);
  let res: Response;
  try {
    res = await fetch(CSV_URL, { headers: { "user-agent": "ProofPrice/1.0 (+https://proofprice.com; hello@proofprice.com)" }, signal: AbortSignal.timeout(120000) });
  } catch (err: any) {
    throw new SourceError("Could not reach the Alberta sole-source data service", String(err?.cause?.code ?? err?.message ?? err));
  }
  if (!res.ok) throw new SourceError(`The Alberta sole-source data service returned HTTP ${res.status}`, CSV_URL, res.status);
  const contracts = contractsFromCsv(await res.text());
  const inWindow = contracts.filter((c) => c.date >= from && c.date <= to);
  if (!contracts.length) throw new SourceError("The Alberta sole-source file held no usable contracts");
  const rows = aggregate(contracts, from, to);
  return { date: to, currency: "CAD", unit: UNIT, rows, note: `Contracts starting ${from} to ${to}; ${inWindow.length} usable contracts read.` };
}

export interface AbInput { what: string; cpv?: string; buyer_area?: string; baseUrl?: string; whatDefaulted?: boolean }

export const SUPPORTED_EXAMPLES = ["all", "consultancy", "legal services", "IT services", "software", "translation services", "security guards"];

export async function abSoleSource(input: AbInput): Promise<PriceAnswer> {
  if (input.cpv) throw new InputError("Alberta: cpv is not used. Leave it out and say what was bought in words.");
  const w = input.what.trim().toLowerCase();
  const isAll = ["all", "any", "everything", "sole source", "sole-source", "sole source contracts", "sole-source contracts"].includes(w);
  const p = isAll ? null : matchPurchase(input.what);
  if (!isAll && !p) {
    throw new InputError(
      `Alberta: "${input.what}" is not one of the services we summarise from the sole-source list. Try what=all or a common service such as ${SUPPORTED_EXAMPLES.join(", ")} (${PURCHASES.length} purchases are recognised).`,
    );
  }
  const item = isAll ? ALL_ITEM : p!.id;
  const label = isAll ? "all sole-source service" : `sole-source ${p!.label}`;
  const day = readLatestDay(INFO.id);
  if (!day) throw new SourceError("Alberta sole-source contract figures have not been collected yet; the daily collector fills them. Try again tomorrow.");
  const from = windowStart(day.date);
  const row = day.rows.find((r) => r.area === "ALL" && r.item === item);
  const summary = row ? { count: row.n, median: row.median, low: row.low, high: row.high, min: row.min, max: row.max } : null;
  const answer = buildAnswer({
    source: INFO,
    query: { country: "CA", buyer_area: "Alberta", what: input.what },
    summary,
    currency: "CAD",
    unit: UNIT,
    period: { from, to: day.date },
    method:
      `Alberta government sole-source service contracts (CA$10,000 or more, awarded without competition) starting ${from} to ${day.date}${isAll ? "" : `, recognised by words in the service description (${p!.label})`}. ` +
      "Median and 10th–90th percentile of the contract value in CAD. Totals per contract, not unit prices; suppliers are never named.",
    describe: (s) =>
      `Alberta departments awarded ${label} contracts with a median total value of ${fmtMoney(s.median, "CAD")} per contract ` +
      `(typical range ${fmtMoney(s.low, "CAD")} to ${fmtMoney(s.high, "CAD")}, 10th to 90th percentile). These are contract values awarded without competition, not market prices or unit prices.`,
    baseUrl: input.baseUrl,
    extra: { value_basis: "total contract value (sole-source, no competition), not a unit price", matched_purchase: item, newest_collection: day.date },
  });
  if (input.whatDefaulted) answer.summary = `${answer.summary} No purchase was named (what), so this covers all Alberta sole-source service contracts; add what=consultancy, legal services or another common service to narrow it.`;
  return answer;
}
