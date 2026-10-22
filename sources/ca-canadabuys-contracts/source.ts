// Canadian federal contract prices from CanadaBuys award notices (Public Services and Procurement Canada), Open Government Licence - Canada.
// Format checked 2026-10-22 from GitHub's servers (probe cabuys-1): GET https://canadabuys.canada.ca/opendata/pub/<YYYY>-<YYYY+1>-awardNotice-avisAttribution.csv
// is a key-free UTF-8 CSV with a BOM, one fiscal year (April to March) per file, 16.6 MB for 2026-2027 so far, quoted cells that can hold
// line breaks (procurementCategory "*SRV\n*GD"), HTML entities in the description columns. Columns used (English names, quoted header):
//   title-titre-eng, referenceNumber-numeroReference, amendmentNumber-numeroModification ("000" = the original award),
//   contractAwardDate-dateAttributionContrat (YYYY-MM-DD), contractAmount-montantContrat ("500000.00"), contractCurrency-contratMonnaie (CAD),
//   awardStatus-attributionStatut-eng ("Active"), unspsc.
// Supplier name, address and contact columns exist in the file and are never read or kept. The file is a bulk download (tens of MB), so it is
// read only by harvest() in the daily collector; answers come from the price library.
import { InputError, SourceError } from "../../lib/http";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { summarise } from "../../lib/stats";
import { readLatestDay } from "../../lib/library/store";
import { matchPurchase, PURCHASES } from "../../categories/contracts/purchases";

export const INFO: SourceInfo = {
  id: "ca-canadabuys-contracts",
  country: "CA (federal contracts)",
  category: "government contracts (award notices)",
  name: "CanadaBuys: Canadian federal contract award notices",
  publisher: "Public Services and Procurement Canada (CanadaBuys)",
  what_is_recorded:
    "Contract award notices that Canadian federal departments and Crown corporations publish on CanadaBuys: title, award date, contract period, UNSPSC or GSIN code and the awarded contract amount in Canadian dollars.",
  price_type: "contract_price",
  freshness: "Daily: CanadaBuys refreshes the award notice files every day and our copy is collected once a day",
  licence: "Open Government Licence - Canada",
  licence_url: "https://open.canada.ca/en/open-government-licence-canada",
  attribution: "Contains information licensed under the Open Government Licence - Canada. Source: Public Services and Procurement Canada, CanadaBuys award notices. Figures are ProofPrice aggregates of the published notices.",
  homepage: "https://open.canada.ca/data/en/dataset/a1acb126-9ce8-40a9-b889-5da2b1dd20cb",
  limits:
    "Federal organisations that publish on CanadaBuys only (not provinces, cities or most defence and security contracts). The amount is the awarded value over the whole contract period, often several years and may include options; it is not a unit price and not an amount paid yet. " +
    "Purchases are recognised from words in the English notice title, so a notice with an unusual title is missed and some matches are loosely related. Supply arrangements entered at 1 dollar and amounts under 100 dollars are left out. " +
    "Aggregates only; suppliers and officials are never named or read.",
  method_version: "1",
};

/** Months of awards kept in each daily aggregate. */
export const WINDOW_MONTHS = 24;
/** Amounts below this are placeholders (supply arrangements are entered at 1.00), not contract prices. */
export const MIN_VALUE = 100;
export const BASE = "https://canadabuys.canada.ca/opendata/pub";
export const UNIT = "per contract (award), total awarded value";

// ---------- CSV (streamed: the files are tens of megabytes) ----------

/** Incremental CSV reader for RFC 4180 text with quoted cells (line breaks and doubled quotes inside quotes). Feed text chunks, get rows. */
export class CsvReader {
  private field = "";
  private row: string[] = [];
  private inQuotes = false;
  private pendingQuote = false; // a quote seen inside a quoted cell: either an escaped quote or the end of the cell
  private skippedBom = false;
  constructor(private onRow: (row: string[]) => void) {}

  push(text: string): void {
    let i = 0;
    if (!this.skippedBom && text.length) {
      if (text.charCodeAt(0) === 0xfeff) i = 1;
      this.skippedBom = true;
    }
    for (; i < text.length; i++) {
      const c = text[i];
      if (this.pendingQuote) {
        this.pendingQuote = false;
        if (c === '"') {
          this.field += '"';
          continue;
        }
        this.inQuotes = false; // the quote closed the cell; handle c below as an ordinary character
      }
      if (this.inQuotes) {
        if (c === '"') this.pendingQuote = true;
        else this.field += c;
      } else if (c === '"') {
        this.inQuotes = true;
      } else if (c === ",") {
        this.row.push(this.field);
        this.field = "";
      } else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        this.endRow();
      } else {
        this.field += c;
      }
    }
  }

  /** Call after the last chunk: a file without a final line break still yields its last row. */
  end(): void {
    if (this.pendingQuote) {
      this.pendingQuote = false;
      this.inQuotes = false;
    }
    if (this.field.length || this.row.length) this.endRow();
  }

  private endRow(): void {
    this.row.push(this.field);
    this.field = "";
    const r = this.row;
    this.row = [];
    if (r.length === 1 && r[0] === "") return; // blank line
    this.onRow(r);
  }
}

const COLS = {
  title: "title-titre-eng",
  ref: "referenceNumber-numeroReference",
  amendment: "amendmentNumber-numeroModification",
  awarded: "contractAwardDate-dateAttributionContrat",
  amount: "contractAmount-montantContrat",
  currency: "contractCurrency-contratMonnaie",
  status: "awardStatus-attributionStatut-eng",
  unspsc: "unspsc",
} as const;

/** One award notice, with only the fields we use. */
export interface CaAward {
  ref: string;
  title: string;
  /** Award date YYYY-MM-DD. */
  date: string;
  value: number;
  unspsc: string;
}

/** Column positions by header name; throws a SourceError when the file no longer has the columns we rely on. */
export function headerIndex(header: string[]): Record<keyof typeof COLS, number> {
  const idx = {} as Record<keyof typeof COLS, number>;
  for (const k of Object.keys(COLS) as (keyof typeof COLS)[]) {
    const at = header.findIndex((h) => h.trim() === COLS[k]);
    if (at < 0) throw new SourceError(`CanadaBuys award file changed: column ${COLS[k]} not found`);
    idx[k] = at;
  }
  return idx;
}

/** Pure: one data row to an award, or null when it is not a usable original award in Canadian dollars. Amendments, other currencies,
 *  cancelled notices, placeholder amounts and rows without a date are dropped. Supplier and contact cells are never touched. */
export function awardFromRow(row: string[], idx: Record<keyof typeof COLS, number>): CaAward | null {
  const amendment = (row[idx.amendment] ?? "").trim();
  if (amendment && !/^0+$/.test(amendment)) return null;
  if ((row[idx.currency] ?? "").trim().toUpperCase() !== "CAD") return null;
  const status = (row[idx.status] ?? "").trim().toLowerCase();
  if (status && status !== "active") return null;
  const value = Number((row[idx.amount] ?? "").trim());
  if (!Number.isFinite(value) || value < MIN_VALUE) return null;
  const date = (row[idx.awarded] ?? "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const title = decodeEntities(row[idx.title] ?? "");
  if (!title) return null;
  return { ref: (row[idx.ref] ?? "").trim(), title, date, value, unspsc: (row[idx.unspsc] ?? "").trim() };
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&rsquo;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** UNSPSC prefixes that identify a purchase better than the title words do (checked as the start of the code). */
export const UNSPSC_BY_PURCHASE: Record<string, string[]> = {
  laptops: ["43211503"],
  "desktop-computers": ["43211507"],
  tablets: ["43211508"],
};

/** Which common purchase an award is, or null. UNSPSC code first, then the words of the English title. */
export function purchaseOf(a: CaAward): string | null {
  if (a.unspsc) {
    for (const [id, prefixes] of Object.entries(UNSPSC_BY_PURCHASE)) if (prefixes.some((p) => a.unspsc.startsWith(p))) return id;
  }
  return matchPurchase(a.title)?.id ?? null;
}

// ---------- the daily collector ----------

/** Fiscal-year file names (April to March) that can hold awards from `from` to `to`. */
export function fileNames(from: string, to: string): string[] {
  const fy = (d: string) => {
    const y = Number(d.slice(0, 4));
    return Number(d.slice(5, 7)) >= 4 ? y : y - 1;
  };
  const out: string[] = [];
  for (let y = fy(from); y <= fy(to); y++) out.push(`${y}-${y + 1}-awardNotice-avisAttribution.csv`);
  return out;
}

export function windowStart(today: string, months = WINDOW_MONTHS): string {
  const d = new Date(today + "T00:00:00Z");
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - months, d.getUTCDate())).toISOString().slice(0, 10);
}

/** Pure: awards to library rows, one per purchase (area ALL), with the 5-award rule. */
export function aggregate(awards: CaAward[], from: string, to: string): DailyRow[] {
  const seen = new Set<string>();
  const byPurchase = new Map<string, number[]>();
  for (const a of awards) {
    if (a.date < from || a.date > to) continue;
    const key = a.ref ? `${a.ref}|${a.value}` : "";
    if (key) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    const id = purchaseOf(a);
    if (!id) continue;
    const list = byPurchase.get(id) ?? [];
    list.push(a.value);
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

/** Stream one award file through the CSV reader and hand each usable award to `sink`. Returns the number of data rows read. */
export async function streamAwards(url: string, sink: (a: CaAward) => void, timeoutMs = 240000): Promise<number> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { "user-agent": "ProofPrice/1.0 (+https://proofprice.com; hello@proofprice.com)" }, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err: any) {
    throw new SourceError("Could not reach CanadaBuys", String(err?.cause?.code ?? err?.message ?? err));
  }
  if (res.status === 404) return 0; // a fiscal-year file that does not exist (yet) is empty, not an error
  if (!res.ok || !res.body) throw new SourceError(`CanadaBuys returned HTTP ${res.status}`, url, res.status);
  let idx: Record<keyof typeof COLS, number> | null = null;
  let rows = 0;
  const reader = new CsvReader((row) => {
    if (!idx) {
      idx = headerIndex(row);
      return;
    }
    rows++;
    const a = awardFromRow(row, idx);
    if (a) sink(a);
  });
  const decoder = new TextDecoder("utf-8");
  const body = res.body.getReader();
  for (;;) {
    const { done, value } = await body.read();
    if (done) break;
    reader.push(decoder.decode(value, { stream: true }));
  }
  reader.push(decoder.decode());
  reader.end();
  if (!idx) throw new SourceError("CanadaBuys award file was empty");
  return rows;
}

export async function caContractsHarvest(now: Date = new Date()): Promise<HarvestResult> {
  const to = now.toISOString().slice(0, 10);
  const from = windowStart(to);
  const awards: CaAward[] = [];
  let read = 0;
  for (const name of fileNames(from, to)) read += await streamAwards(`${BASE}/${name}`, (a) => { if (a.date >= from && a.date <= to) awards.push(a); });
  if (read === 0) throw new SourceError("CanadaBuys award files held no rows");
  const rows = aggregate(awards, from, to);
  return { date: to, currency: "CAD", unit: UNIT, rows, note: `Awards dated ${from} to ${to}; ${awards.length} usable notices read from ${read} rows.` };
}

// ---------- the answer ----------

export interface CaInput {
  what: string;
  cpv?: string;
  buyer_area?: string;
  baseUrl?: string;
}

export const SUPPORTED_EXAMPLES = ["laptops", "software licences", "legal services", "translation services", "catering", "consultancy", "IT services", "security guard services", "photocopiers", "printers"];

export async function caContracts(input: CaInput): Promise<PriceAnswer> {
  if (input.cpv) throw new InputError("Canada: cpv is not used (federal notices carry UNSPSC or GSIN codes that we do not search by). Leave it out and say what was bought in words.");
  if (input.buyer_area) throw new InputError("Canada: buyer_area is not used; the figures are for all federal buyers together.");
  const p = matchPurchase(input.what);
  if (!p) {
    throw new InputError(
      `Canada: "${input.what}" is not one of the purchases we summarise from CanadaBuys. Try a common purchase such as ${SUPPORTED_EXAMPLES.join(", ")} (${PURCHASES.length} purchases are recognised; see the tool description for the wording).`,
    );
  }
  const day = readLatestDay(INFO.id);
  if (!day) throw new SourceError("Canadian federal contract prices have not been collected yet; the daily collector fills them. Try again tomorrow.");
  const from = windowStart(day.date);
  const row = day.rows.find((r) => r.area === "ALL" && r.item === p.id);
  const summary = row ? { count: row.n, median: row.median, low: row.low, high: row.high, min: row.min, max: row.max } : null;
  return buildAnswer({
    source: INFO,
    query: { country: "CA", what: input.what },
    summary,
    currency: "CAD",
    unit: UNIT,
    period: { from, to: day.date },
    method:
      `CanadaBuys federal award notices dated ${from} to ${day.date}, recognised by words in the English notice title (${p.label}). Median and 10th–90th percentile of the awarded contract amount in CAD, ` +
      "from the original award notices (amendments are not added again). Totals per contract, not unit prices; suppliers are never named.",
    describe: (s) =>
      `Canadian federal buyers awarded ${p.label} contracts with a median total value of ${fmtMoney(s.median, "CAD")} per contract ` +
      `(typical range ${fmtMoney(s.low, "CAD")} to ${fmtMoney(s.high, "CAD")}, 10th to 90th percentile). These are totals per contract over the whole contract period, not unit prices.`,
    baseUrl: input.baseUrl,
    extra: { value_basis: "total awarded value per contract (award notice), not a unit price", matched_purchase: p.id, newest_collection: day.date },
  });
}
