// South African public contract prices from the National Treasury eTenders OCDS data, published through the Open Contracting Partnership
// data registry under the Open Data Commons Public Domain Dedication and Licence (PDDL).
// Format checked 2026-10-22 from GitHub's servers (probes za-ocds-1..4): https://data.open-contracting.org/en/publication/143/download?name=full.jsonl.gz
// answers 302 -> fastly.data.open-contracting.org/downloads/south_africa_national_treasury_api/<n>/full.jsonl.gz (11.7 MB gzip, 76.7 MB of JSON lines,
// refreshed monthly). The same data as full.xlsx has the sheets main, awards, awards_suppliers, contracts, ... :
//   contracts: id, title, dateSigned (2026-07-20T12:27:28Z), description (what was bought), status (active / terminated / pending), awardID,
//              value_amount (ZAR, whole rand), value_currency (ZAR), period_*, main_ocid
//   awards: the TITLE column holds the SUPPLIER NAME and the amounts include absurd values (5,356,639,625 for a small supplier), so awards are not used.
//   main: tender_description, tender_title, buyer_name, tender_value_amount (always 0: tenders carry no estimate).
// Each JSON line is one OCDS release (live API shape, probe za-ocds-2: ocid, date, tender{title,description,...}, buyer, awards[], contracts[]); the contract
// fields are the sheet columns above in OCDS spelling (value.amount, value.currency, dateSigned, description, status).
// Only contracts that are active, in rand, signed within the window, with a plausible amount are read. Supplier names, contacts and buyers are never read or kept.
// The file is a bulk download, so it is read only by harvest() in the daily collector; answers come from the price library.
import { InputError, SourceError } from "../../lib/http";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { summarise } from "../../lib/stats";
import { readLatestDay } from "../../lib/library/store";
import { matchPurchase, PURCHASES } from "../../categories/contracts/purchases";

export const INFO: SourceInfo = {
  id: "za-etenders-contracts",
  country: "ZA (national and municipal tenders)",
  category: "government contracts (signed contracts)",
  name: "National Treasury eTenders: South African public contracts (OCDS)",
  publisher: "National Treasury of South Africa (eTenders portal), republished by the Open Contracting Partnership",
  what_is_recorded:
    "Signed public contracts that national, provincial and municipal buyers record on the National Treasury eTenders portal: what was bought, the signing date and the contract value in rand.",
  price_type: "contract_price",
  freshness: "Monthly: the Open Contracting Partnership refreshes the eTenders bulk file about once a month and our copy is collected once a day",
  licence: "Open Data Commons Public Domain Dedication and Licence (PDDL)",
  licence_url: "https://opendatacommons.org/licenses/pddl/",
  attribution: "Source: National Treasury of South Africa, eTenders OCDS data, via the Open Contracting Partnership data registry (PDDL). Figures are ProofPrice aggregates of the published contracts.",
  homepage: "https://data.open-contracting.org/en/publication/143",
  limits:
    "Only contracts that buyers have recorded as signed on eTenders; many awards are never followed by a contract record, so the number of contracts is a small part of all South African public buying. " +
    "The value is the contract value over the whole contract period (often 2 to 3 years); it is not a unit price and not an amount paid yet. " +
    "Purchases are recognised from words in the contract description, so a contract with unusual wording is missed. Values under 1,000 rand (placeholders) and over 1 billion rand (entry errors) are left out. " +
    "Aggregates only; suppliers and officials are never named or read.",
  method_version: "1",
};

/** Months of contracts kept in each daily aggregate. */
export const WINDOW_MONTHS = 24;
/** Contract values outside this range are placeholders (0, 10) or entry errors (billions for a small supplier), not prices. */
export const MIN_VALUE = 1000;
export const MAX_VALUE = 1_000_000_000;
export const FILE_URL = "https://data.open-contracting.org/en/publication/143/download?name=full.jsonl.gz";
export const UNIT = "per contract, total contract value";

/** One signed contract, with only the fields we use. */
export interface ZaContract {
  /** Release ocid plus contract id: used to count a contract once. */
  key: string;
  /** Signing date YYYY-MM-DD. */
  date: string;
  value: number;
  /** What was bought: the contract description, and the tender description as a second chance. */
  text: string;
  tenderText: string;
}

function clean(s: unknown): string {
  return typeof s === "string" ? s.replace(/_x000D_/g, " ").replace(/\s+/g, " ").trim() : "";
}

/** Pure: the usable contracts of one OCDS release (or of a release package / record with the release inside). */
export function contractsOf(doc: any): ZaContract[] {
  if (!doc || typeof doc !== "object") return [];
  if (Array.isArray(doc.releases)) return doc.releases.flatMap((r: any) => contractsOf(r));
  if (doc.compiledRelease) return contractsOf(doc.compiledRelease);
  const out: ZaContract[] = [];
  const contracts = Array.isArray(doc.contracts) ? doc.contracts : [];
  const tenderText = clean(doc.tender?.description) || clean(doc.tender?.title);
  for (const c of contracts) {
    if (!c || typeof c !== "object") continue;
    const status = clean(c.status).toLowerCase();
    if (status !== "active") continue; // terminated, cancelled and pending contracts are not prices
    const cur = clean(c.value?.currency).toUpperCase();
    if (cur !== "ZAR") continue;
    const value = Number(c.value?.amount);
    if (!Number.isFinite(value) || value < MIN_VALUE || value > MAX_VALUE) continue;
    const date = clean(c.dateSigned).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < "2000-01-01") continue;
    const text = clean(c.description);
    if (!text && !tenderText) continue;
    out.push({ key: `${clean(doc.ocid)}|${clean(c.id)}|${clean(c.awardID)}`, date, value, text, tenderText });
  }
  return out;
}

/** The common purchase a contract is, or null: its own description first, then the tender description. */
export function purchaseOf(c: ZaContract): string | null {
  return (c.text && matchPurchase(c.text)?.id) || (c.tenderText && matchPurchase(c.tenderText)?.id) || null;
}

export function windowStart(today: string, months = WINDOW_MONTHS): string {
  const d = new Date(today + "T00:00:00Z");
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - months, d.getUTCDate())).toISOString().slice(0, 10);
}

/** Pure: contracts to library rows, one per purchase (area ALL), with the 5-contract rule. A contract is counted once. */
export function aggregate(contracts: ZaContract[], from: string, to: string): DailyRow[] {
  const seen = new Set<string>();
  const byPurchase = new Map<string, number[]>();
  for (const c of contracts) {
    if (c.date < from || c.date > to) continue;
    if (c.key !== "||") {
      if (seen.has(c.key)) continue;
      seen.add(c.key);
    }
    const id = purchaseOf(c);
    if (!id) continue;
    const list = byPurchase.get(id) ?? [];
    list.push(c.value);
    byPurchase.set(id, list);
  }
  const rows: DailyRow[] = [];
  for (const [item, values] of byPurchase) {
    const s = summarise(values);
    if (!s || s.count < 5) continue;
    rows.push({ area: "ALL", item, n: s.count, median: s.median, low: s.low, high: s.high, min: s.min, max: s.max });
  }
  return rows.sort((a, b) => a.item.localeCompare(b.item));
}

/** Stream a gzip JSON-lines file: every non-empty line is parsed and handed to `onDoc`. Returns the number of lines read.
 *  A line that is not JSON is skipped (counted in `bad`), because one damaged line must not lose a month of data. */
export async function streamJsonLines(url: string, onDoc: (doc: any) => void, timeoutMs = 300000): Promise<{ lines: number; bad: number }> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { "user-agent": "ProofPrice/1.0 (+https://proofprice.com; hello@proofprice.com)" }, signal: AbortSignal.timeout(timeoutMs), redirect: "follow" });
  } catch (err: any) {
    throw new SourceError("Could not reach the Open Contracting Partnership data registry", String(err?.cause?.code ?? err?.message ?? err));
  }
  if (!res.ok || !res.body) throw new SourceError(`Open Contracting Partnership registry returned HTTP ${res.status}`, url, res.status);
  const text = res.body.pipeThrough(new DecompressionStream("gzip")).pipeThrough(new TextDecoderStream());
  const reader = text.getReader();
  let lines = 0;
  let bad = 0;
  let tail = "";
  const handle = (line: string) => {
    if (!line.trim()) return;
    lines++;
    let doc: any;
    try {
      doc = JSON.parse(line);
    } catch {
      bad++;
      return;
    }
    onDoc(doc);
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    tail += value;
    let at: number;
    let start = 0;
    while ((at = tail.indexOf("\n", start)) >= 0) {
      handle(tail.slice(start, at));
      start = at + 1;
    }
    tail = tail.slice(start);
  }
  handle(tail);
  return { lines, bad };
}

export async function zaContractsHarvest(now: Date = new Date(), url: string = FILE_URL): Promise<HarvestResult> {
  const to = now.toISOString().slice(0, 10);
  const from = windowStart(to);
  const contracts: ZaContract[] = [];
  let seenContracts = 0;
  const { lines, bad } = await streamJsonLines(url, (doc) => {
    for (const c of contractsOf(doc)) {
      seenContracts++;
      if (c.date >= from && c.date <= to) contracts.push(c);
    }
  });
  if (lines === 0) throw new SourceError("The eTenders bulk file held no records");
  if (bad > lines / 10) throw new SourceError(`The eTenders bulk file changed: ${bad} of ${lines} lines are not JSON`);
  if (seenContracts === 0) throw new SourceError("The eTenders bulk file changed: no active contracts in rand were found in its records");
  const rows = aggregate(contracts, from, to);
  return {
    date: to,
    currency: "ZAR",
    unit: UNIT,
    rows,
    note: `Contracts signed ${from} to ${to}; ${contracts.length} usable active contracts from ${lines} records (${seenContracts} contracts in all).`,
  };
}

// ---------- the answer ----------

export interface ZaInput {
  what: string;
  cpv?: string;
  buyer_area?: string;
  baseUrl?: string;
}

export const SUPPORTED_EXAMPLES = ["catering", "office cleaning", "consultancy", "IT services", "legal services", "software", "photocopiers", "printers", "uniforms", "security guard services"];

export async function zaContracts(input: ZaInput): Promise<PriceAnswer> {
  if (input.cpv) throw new InputError("South Africa: cpv is not used (eTenders does not carry CPV codes). Leave it out and say what was bought in words.");
  if (input.buyer_area) throw new InputError("South Africa: buyer_area is not used; the figures are for all South African public buyers together.");
  const p = matchPurchase(input.what);
  if (!p) {
    throw new InputError(
      `South Africa: "${input.what}" is not one of the purchases we summarise from eTenders. Try a common purchase such as ${SUPPORTED_EXAMPLES.join(", ")} (${PURCHASES.length} purchases are recognised; see the tool description for the wording).`,
    );
  }
  const day = readLatestDay(INFO.id);
  if (!day) throw new SourceError("South African contract prices have not been collected yet; the daily collector fills them. Try again tomorrow.");
  const from = windowStart(day.date);
  const row = day.rows.find((r) => r.area === "ALL" && r.item === p.id);
  const summary = row ? { count: row.n, median: row.median, low: row.low, high: row.high, min: row.min, max: row.max } : null;
  return buildAnswer({
    source: INFO,
    query: { country: "ZA", what: input.what },
    summary,
    currency: "ZAR",
    unit: UNIT,
    period: { from, to: day.date },
    method:
      `National Treasury eTenders signed contracts dated ${from} to ${day.date}, recognised by words in the contract description (${p.label}). Median and 10th–90th percentile of the contract value in ZAR, ` +
      "from contracts recorded as active. Totals per contract, not unit prices; suppliers are never named.",
    describe: (s) =>
      `South African public buyers signed ${p.label} contracts with a median total value of ${fmtMoney(s.median, "ZAR")} per contract ` +
      `(typical range ${fmtMoney(s.low, "ZAR")} to ${fmtMoney(s.high, "ZAR")}, 10th to 90th percentile). These are totals per contract over the whole contract period, not unit prices.`,
    baseUrl: input.baseUrl,
    extra: { value_basis: "total contract value (signed contract), not a unit price", matched_purchase: p.id, newest_collection: day.date },
  });
}
