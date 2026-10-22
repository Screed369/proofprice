// French public contract prices from DECP, "Donnees essentielles de la commande publique - fichiers consolides"
// (Ministeres economiques et financiers, data.gouv.fr dataset 5cd57bf68b4c4179299eb0e9), licence fr-lo = Licence Ouverte / Open Licence 2.0.
// Licence read 2026-10-22: the data.gouv.fr API answers "license": "fr-lo" for this dataset (probe frdecp1).
// Format checked 2026-10-22 from GitHub's servers (probes frdecp2, frdecp3):
//   GET https://www.data.gouv.fr/api/2/datasets/5cd57bf68b4c4179299eb0e9/resources/?page_size=60 -> {data:[{title:"decp-2026-10.json", latest:".../datasets/r/<id>", filesize}, ...]}
//   each monthly file (60-150 MB, pretty-printed JSON) is {"marches":{"marche":[ {id, acheteur:{id}, nature, objet, codeCPV:"71300000-1",
//   dateNotification:"2025-04-11", montant:69050.0, titulaires:[...], techniques:{technique:[...]} ...}, ... ]}}. Files are by publication month,
//   so dateNotification inside one file runs from years ago to today. montant is a number (EUR) or sometimes missing / text.
// Personal and company identifiers (titulaires, SIRET numbers) are never read into the library: acheteur.id + id is used only to count a contract once.
// The files are far too big to download per request: harvest() streams the newest months once a day and keeps aggregates only.
import { InputError, SourceError, fetchJson } from "../../lib/http";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { summarise } from "../../lib/stats";
import { readLatestDay } from "../../lib/library/store";
import { cleanCpv, cpvStem, matchPurchase, PURCHASES } from "../../categories/contracts/purchases";

export const INFO: SourceInfo = {
  id: "fr-decp-contracts",
  country: "FR (state, local authorities, hospitals and other public buyers)",
  category: "government contracts (awarded contracts)",
  name: "DECP: French public procurement essential data (consolidated files)",
  publisher: "Ministeres economiques et financiers (DAJ), published on data.gouv.fr",
  what_is_recorded:
    "Public contracts that French public buyers notified to the winner and published as essential data: what was bought (object and CPV product code), the notification date and the award amount in euros.",
  price_type: "contract_price",
  freshness: "Daily: the consolidated monthly files are refreshed about daily and our copy is collected once a day",
  licence: "Licence Ouverte / Open Licence 2.0 (Etalab)",
  licence_url: "https://www.etalab.gouv.fr/licence-ouverte-open-licence/",
  attribution:
    "Source: Ministeres economiques et financiers, Donnees essentielles de la commande publique (DECP), data.gouv.fr, Licence Ouverte 2.0. Figures are ProofPrice aggregates of the published contracts.",
  homepage: "https://www.data.gouv.fr/datasets/5cd57bf68b4c4179299eb0e9",
  limits:
    "Award amounts as published by the buyer, in euros, over the whole contract (often several years); they are not unit prices and not amounts paid yet. " +
    "Framework agreements can show their maximum ceiling, and buyers publish with mistakes: amounts under 500 euros (placeholders) and over 1 billion euros (entry errors) are left out, and a contract is counted once. " +
    "Purchases are recognised from the contract's CPV product code, so a contract filed under another code is missed. Framework agreements themselves (nature 'Accord-cadre') are left out. " +
    "Aggregates only; suppliers and their company numbers in the open files are never read or kept.",
  method_version: "1",
};

export const DATASET_ID = "5cd57bf68b4c4179299eb0e9";
export const RESOURCES_URL = `https://www.data.gouv.fr/api/2/datasets/${DATASET_ID}/resources/?page_size=60`;
export const WINDOW_MONTHS = 12;
export const MIN_VALUE = 500;
export const MAX_VALUE = 1_000_000_000;
export const UNIT = "per contract, total award amount";
/** Stop starting new monthly files after this long (the collector gives each source 10 minutes). */
export const TIME_BUDGET_MS = 7 * 60 * 1000;

/** One awarded contract with only the fields we use. */
export interface FrContract {
  key: string;
  date: string;
  value: number;
  cpv: string; // 8 digits, no check digit
}

export function windowStart(today: string, months = WINDOW_MONTHS): string {
  const d = new Date(today + "T00:00:00Z");
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - months, d.getUTCDate())).toISOString().slice(0, 10);
}

/** Pure: one DECP record (as parsed JSON) to a usable contract, or null (no amount, placeholder, entry error, framework ceiling, bad date or code). */
export function contractOf(r: any, from: string, to: string): FrContract | null {
  if (!r || typeof r !== "object") return null;
  if (String(r.nature ?? "").toLowerCase().startsWith("accord")) return null;
  const value = typeof r.montant === "number" ? r.montant : Number(String(r.montant ?? "").replace(",", "."));
  if (!Number.isFinite(value) || value < MIN_VALUE || value > MAX_VALUE) return null;
  const date = String(r.dateNotification ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < from || date > to) return null;
  const cpv = String(r.codeCPV ?? "").replace(/\D/g, "").slice(0, 8);
  if (cpv.length !== 8) return null;
  const id = String(r.id ?? "");
  const buyer = String(r?.acheteur?.id ?? "");
  return { key: id ? `${buyer}|${id}` : "", date, value, cpv };
}

/** Splits a big pretty-printed JSON file into its records without holding the file in memory. Feed it text pieces in order. */
export class RecordSplitter {
  private header = "";
  private inArray = false;
  private done = false;
  private inStr = false;
  private esc = false;
  private depth = 0;
  private parts: string[] = [];
  constructor(private onRecord: (record: any) => void) {}

  get finished(): boolean {
    return this.done;
  }

  push(text: string): void {
    if (this.done) return;
    let chunk = text;
    if (!this.inArray) {
      this.header += chunk;
      const m = /"marches?"\s*:\s*\[/.exec(this.header);
      if (!m) {
        if (this.header.length > 4000) throw new SourceError("The DECP file does not start with a list of contracts: the format may have changed");
        return;
      }
      chunk = this.header.slice(m.index + m[0].length);
      this.header = "";
      this.inArray = true;
    }
    let start = this.depth > 0 ? 0 : -1;
    for (let i = 0; i < chunk.length; i++) {
      const c = chunk.charCodeAt(i);
      if (this.inStr) {
        if (this.esc) this.esc = false;
        else if (c === 92) this.esc = true;
        else if (c === 34) this.inStr = false;
        continue;
      }
      if (c === 34) this.inStr = true;
      else if (c === 123) {
        if (this.depth === 0) start = i;
        this.depth++;
      } else if (c === 125) {
        this.depth--;
        if (this.depth === 0 && start >= 0) {
          this.parts.push(chunk.slice(start, i + 1));
          const raw = this.parts.join("");
          this.parts = [];
          start = -1;
          let rec: any;
          try {
            rec = JSON.parse(raw);
          } catch {
            continue; // one broken record never stops the file
          }
          this.onRecord(rec);
        }
      } else if (c === 93 && this.depth === 0) {
        this.done = true;
        return;
      }
    }
    if (this.depth > 0 && start >= 0) this.parts.push(chunk.slice(start));
    else if (this.depth > 0 && start < 0) this.parts.push(chunk);
  }
}

/** The monthly files, newest first: [{ month: "2026-10", url }]. */
export function monthlyFiles(listing: any): { month: string; url: string }[] {
  const out: { month: string; url: string }[] = [];
  for (const r of Array.isArray(listing?.data) ? listing.data : []) {
    const m = /^decp-(\d{4})-(\d{2})\.json$/.exec(String(r?.title ?? ""));
    const url = String(r?.latest ?? r?.url ?? "");
    if (m && url.startsWith("https://")) out.push({ month: `${m[1]}-${m[2]}`, url });
  }
  return out.sort((a, b) => b.month.localeCompare(a.month));
}

/** The library items a contract belongs to: shared purchases by CPV group, plus its 2-digit division and 4-digit group. */
const PURCHASE_STEMS = PURCHASES.map((p) => ({ id: p.id, stems: p.cpv.map(cpvStem) }));
export function itemsOf(cpv: string): string[] {
  const items: string[] = [];
  for (const p of PURCHASE_STEMS) if (p.stems.some((s) => cpv.startsWith(s))) items.push(p.id);
  items.push(`cpv-${cpv.slice(0, 2)}`, `cpv-${cpv.slice(0, 4)}`);
  return items;
}

/** Pure: library rows for every item that has at least 5 distinct contracts. */
export function aggregateAll(contracts: Iterable<FrContract>, from: string, to: string): DailyRow[] {
  const seen = new Set<string>();
  const groups = new Map<string, number[]>();
  for (const c of contracts) {
    if (c.date < from || c.date > to) continue;
    if (c.key) {
      if (seen.has(c.key)) continue;
      seen.add(c.key);
    }
    for (const item of itemsOf(c.cpv)) {
      const g = groups.get(item);
      if (g) g.push(c.value);
      else groups.set(item, [c.value]);
    }
  }
  const rows: DailyRow[] = [];
  for (const [item, values] of groups) {
    const s = summarise(values);
    if (!s || s.count < 5) continue;
    rows.push({ area: "ALL", item, n: s.count, median: s.median, low: s.low, high: s.high, min: s.min, max: s.max });
  }
  return rows.sort((a, b) => a.item.localeCompare(b.item));
}

export type Opener = (url: string) => Promise<AsyncIterable<Uint8Array | string>>;

async function openHttp(url: string): Promise<AsyncIterable<Uint8Array | string>> {
  const res = await fetch(url, {
    redirect: "follow",
    headers: { "user-agent": "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)" },
    signal: AbortSignal.timeout(5 * 60 * 1000),
  });
  if (!res.ok || !res.body) throw new SourceError(`DECP file answered HTTP ${res.status}`);
  return res.body as unknown as AsyncIterable<Uint8Array>;
}

export interface HarvestOptions {
  listing?: unknown; // for tests: the resource listing
  open?: Opener; // for tests: a way to open a file as text/bytes pieces
  budgetMs?: number;
  months?: number;
}

export async function frContractsHarvest(now: Date = new Date(), o: HarvestOptions = {}): Promise<HarvestResult> {
  const started = Date.now();
  const to = now.toISOString().slice(0, 10);
  const months = o.months ?? WINDOW_MONTHS;
  const from = windowStart(to, months);
  const listing = o.listing ?? (await fetchJson(RESOURCES_URL, { headers: { accept: "application/json" } }, 30000));
  // files are by publication month: take the months of the window plus the one before it (a contract can be published a few weeks late)
  const wanted = monthlyFiles(listing).filter((f) => f.month >= from.slice(0, 7)).slice(0, months + 1);
  if (!wanted.length) throw new SourceError("The DECP resource list holds no monthly files: the dataset may have changed");
  const open = o.open ?? openHttp;
  const budget = o.budgetMs ?? TIME_BUDGET_MS;
  const contracts: FrContract[] = [];
  const read: string[] = [];
  const failed: string[] = [];
  let records = 0;
  let lastError: unknown = null;
  for (const f of wanted) {
    if (Date.now() - started > budget) {
      failed.push(`${f.month} (time)`);
      continue;
    }
    try {
      const splitter = new RecordSplitter((rec) => {
        records++;
        const c = contractOf(rec, from, to);
        if (c) contracts.push(c);
      });
      const decoder = new TextDecoder("utf-8");
      for await (const piece of await open(f.url)) {
        splitter.push(typeof piece === "string" ? piece : decoder.decode(piece, { stream: true }));
        if (splitter.finished) break;
      }
      read.push(f.month);
    } catch (err) {
      failed.push(f.month);
      lastError = err;
    }
  }
  if (!read.length) throw new SourceError("Could not read the DECP files (data.gouv.fr)", String((lastError as any)?.message ?? lastError));
  if (!contracts.length) throw new SourceError("The DECP files held no usable contracts in the window: the file format may have changed");
  const rows = aggregateAll(contracts, from, to);
  return {
    date: to,
    currency: "EUR",
    unit: UNIT,
    rows,
    note:
      `Contracts notified ${from} to ${to}; ${records} records in ${read.length} monthly files (${read[read.length - 1]} to ${read[0]}), ${contracts.length} usable.` +
      (failed.length ? ` Not read this day: ${failed.join(", ")}.` : ""),
  };
}

// ---------- the answer ----------

export interface FrInput {
  what: string;
  cpv?: string;
  buyer_area?: string;
  baseUrl?: string;
}

export const SUPPORTED_EXAMPLES = ["laptops", "school meals", "road resurfacing", "office cleaning", "catering", "ambulances"];

export async function frContracts(input: FrInput): Promise<PriceAnswer> {
  if (input.buyer_area) throw new InputError("France: buyer_area is not used; the figures are for all French public buyers together.");
  let item: string;
  let label: string;
  let matched: Record<string, string>;
  if (input.cpv) {
    const code = cleanCpv(input.cpv);
    if (!code || code.length === 3) {
      throw new InputError("France: cpv must be a CPV product code of 2 digits (a division such as 30) or 4 to 8 digits (30213100); 4 digits or more are read as the 4-digit group (3021).");
    }
    const group = code.length === 2 ? code : code.slice(0, 4);
    item = `cpv-${group}`;
    label = `contracts under CPV group ${group}`;
    matched = { cpv_group: group, cpv_requested: code };
  } else {
    const p = matchPurchase(input.what);
    if (!p) {
      throw new InputError(
        `France: "${input.what}" is not one of the purchases we summarise from DECP. Try a common purchase such as ${SUPPORTED_EXAMPLES.join(", ")} (${PURCHASES.length} are recognised), or pass a CPV product code in cpv.`,
      );
    }
    item = p.id;
    label = `${p.label} contracts`;
    matched = { matched_purchase: p.id };
  }
  const day = readLatestDay(INFO.id);
  if (!day) throw new SourceError("French contract prices have not been collected yet; the daily collector fills them. Try again tomorrow.");
  const from = windowStart(day.date);
  const row = day.rows.find((r) => r.area === "ALL" && r.item === item);
  const summary = row ? { count: row.n, median: row.median, low: row.low, high: row.high, min: row.min, max: row.max } : null;
  return buildAnswer({
    source: INFO,
    query: { country: "FR", what: input.what, ...(input.cpv ? { cpv: input.cpv } : {}) },
    summary,
    currency: "EUR",
    unit: UNIT,
    period: { from, to: day.date },
    method:
      `DECP contracts notified ${from} to ${day.date}, recognised by their CPV product code (${label}). Median and 10th–90th percentile of the award amount in EUR. ` +
      "Totals per contract, not unit prices; suppliers are never named.",
    describe: (s) =>
      `French public buyers awarded ${label} with a median total amount of ${fmtMoney(s.median, "EUR")} per contract ` +
      `(typical range ${fmtMoney(s.low, "EUR")} to ${fmtMoney(s.high, "EUR")}, 10th to 90th percentile). These are totals per contract, not unit prices.`,
    baseUrl: input.baseUrl,
    extra: { value_basis: "total award amount (notified contract), not a unit price", ...matched, newest_collection: day.date },
  });
}
