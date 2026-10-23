// Portuguese public contract prices from Portal BASE (IMPIC, Instituto dos Mercados Publicos, do Imobiliario e da Construcao), published on dados.gov.pt
// dataset "Contratos publicos - Portal BASE - IMPIC - Contratos de 2012 a 2026" (id 66d72d488ca4b7cb2de28712), licence tag "other-pd" = Outra (Dominio Publico).
// Licence read 2026-10-23: the dados.gov.pt API answers license "other-pd", license_title "Outra (Dominio Publico)", access_type "open" (probe ptbase1).
// Format checked 2026-10-23 from GitHub's servers (probes ptbase1, ptbase2):
//   GET https://dados.gov.pt/api/1/datasets/<slug>/ -> {resources:[{title:"contratos2026.zip", latest:"https://dados.gov.pt/api/1/datasets/r/<id>", format:"zip"}, ...]} (zips exist for the newest years)
//   each zip (2026: 45.6 MB) holds ONE file, ContratosYYYY.json (348 MB), a compact JSON array [{idcontrato, tipoprocedimento, objectoContrato,
//   adjudicante:["NIF - name"], adjudicatarios:[...], dataPublicacao:"04/12/2025", dataCelebracaoContrato:"23/02/2026" (dd/mm/yyyy),
//   precoContratual: 9000.00 (EUR), cpv:["72210000-0 - Servicos de programacao..."], localExecucao:[...], numAcordoQuadro:"", Ano:2026, ...}, ...].
// Buyer and supplier names and tax numbers are never read into the library: idcontrato is used only to count a contract once.
// The files are far too big to download per request: harvest() streams the newest years once a day and keeps aggregates only.
import { Readable } from "node:stream";
import { createInflateRaw } from "node:zlib";
import { InputError, SourceError, fetchJson } from "../../lib/http";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { summarise } from "../../lib/stats";
import { readLatestDay } from "../../lib/library/store";
import { cleanCpv, cpvStem, matchPurchase, PURCHASES } from "../../categories/contracts/purchases";

export const INFO: SourceInfo = {
  id: "pt-base-contracts",
  country: "PT (state, municipalities, hospitals and other public buyers)",
  category: "government contracts (awarded contracts)",
  name: "Portal BASE: Portuguese public contracts (IMPIC open data)",
  publisher: "IMPIC (Instituto dos Mercados Publicos, do Imobiliario e da Construcao), Portal BASE, published on dados.gov.pt",
  what_is_recorded:
    "Public contracts that Portuguese public buyers registered on Portal BASE: what was bought (object and CPV product code), the date the contract was signed and the contract price in euros.",
  price_type: "contract_price",
  freshness: "Weekly: IMPIC refreshes the yearly files about weekly and our copy is collected once a day",
  licence: "Public domain (dados.gov.pt licence 'Outra (Dominio Publico)')",
  licence_url: "https://dados.gov.pt/datasets/contratos-publicos-portal-base-impic-contratos-de-2012-a-2026",
  attribution:
    "Source: IMPIC - Portal BASE (base.gov.pt), via dados.gov.pt, public domain. Figures are ProofPrice aggregates of the published contracts.",
  homepage: "https://dados.gov.pt/datasets/contratos-publicos-portal-base-impic-contratos-de-2012-a-2026",
  limits:
    "Contract prices as registered by the buyer on Portal BASE, in euros, over the whole contract (often several years); they are not unit prices and not amounts paid yet. " +
    "Buyers register with mistakes: prices under 500 euros (placeholders) and over 1 billion euros (entry errors) are left out, and a contract is counted once. " +
    "Purchases are recognised from the contract's first CPV product code, so a contract filed under another code is missed. Contracts made under a framework agreement are included at their own price. " +
    "Aggregates only; buyers, suppliers and their tax numbers in the open files are never read or kept.",
  method_version: "1",
};

export const DATASET_URL = "https://dados.gov.pt/api/1/datasets/contratos-publicos-portal-base-impic-contratos-de-2012-a-2026/";
export const WINDOW_MONTHS = 12;
export const MIN_VALUE = 500;
export const MAX_VALUE = 1_000_000_000;
export const UNIT = "per contract, total contract price";
/** Stop starting new yearly files after this long (the collector gives each source 10 minutes). */
export const TIME_BUDGET_MS = 7 * 60 * 1000;

/** One contract with only the fields we use. */
export interface PtContract {
  key: string;
  date: string;
  value: number;
  cpv: string; // 8 digits, no check digit
}

export function windowStart(today: string, months = WINDOW_MONTHS): string {
  const d = new Date(today + "T00:00:00Z");
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - months, d.getUTCDate())).toISOString().slice(0, 10);
}

/** "23/02/2026" to "2026-02-23", or "" when it is not a real date. */
export function isoDate(s: unknown): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s ?? "").trim());
  if (!m) return "";
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  return new Date(iso + "T00:00:00Z").toISOString().slice(0, 10) === iso ? iso : "";
}

/** Pure: one Portal BASE record (parsed JSON) to a usable contract, or null (no price, placeholder, entry error, bad date or code, outside the window). */
export function contractOf(r: any, from: string, to: string): PtContract | null {
  if (!r || typeof r !== "object") return null;
  const raw = r.precoContratual;
  const value = typeof raw === "number" ? raw : Number(String(raw ?? "").replace(",", "."));
  if (!Number.isFinite(value) || value < MIN_VALUE || value > MAX_VALUE) return null;
  const date = isoDate(r.dataCelebracaoContrato);
  if (!date || date < from || date > to) return null;
  const first = Array.isArray(r.cpv) ? String(r.cpv[0] ?? "") : String(r.cpv ?? "");
  const cpv = first.split(" - ")[0].replace(/\D/g, "").slice(0, 8);
  if (cpv.length !== 8) return null;
  return { key: r.idcontrato ? String(r.idcontrato) : "", date, value, cpv };
}

/** Splits a big JSON array of objects into its records without holding the file in memory. Feed it text pieces in order. */
export class RecordSplitter {
  private started = false;
  private done = false;
  private inStr = false;
  private esc = false;
  private depth = 0;
  private parts: string[] = [];
  private seen = "";
  constructor(private onRecord: (record: any) => void) {}

  get finished(): boolean {
    return this.done;
  }

  push(text: string): void {
    if (this.done) return;
    let chunk = text;
    if (!this.started) {
      this.seen += chunk;
      const m = /^\s*\[/.exec(this.seen);
      if (!m) {
        if (this.seen.trim().length > 0) throw new SourceError("The Portal BASE file does not start with a list of contracts: the format may have changed");
        return;
      }
      chunk = this.seen.slice(m[0].length);
      this.seen = "";
      this.started = true;
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


/** The library items a contract belongs to: shared purchases by CPV group, plus its 2-digit division and 4-digit group. */
const PURCHASE_STEMS = PURCHASES.map((p) => ({ id: p.id, stems: p.cpv.map(cpvStem) }));
export function itemsOf(cpv: string): string[] {
  const items: string[] = [];
  for (const p of PURCHASE_STEMS) if (p.stems.some((s) => cpv.startsWith(s))) items.push(p.id);
  items.push(`cpv-${cpv.slice(0, 2)}`, `cpv-${cpv.slice(0, 4)}`);
  return items;
}

/** Pure: library rows for every item that has at least 5 distinct contracts. */
export function aggregateAll(contracts: Iterable<PtContract>, from: string, to: string): DailyRow[] {
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

/** Pure: the yearly zip files in the dataset listing, newest year first: [{ year: 2026, url }]. */
export function yearlyFiles(dataset: any): { year: number; url: string }[] {
  const out: { year: number; url: string }[] = [];
  for (const r of Array.isArray(dataset?.resources) ? dataset.resources : []) {
    const m = /^contratos(\d{4})\.zip$/i.exec(String(r?.title ?? ""));
    const url = String(r?.latest ?? r?.url ?? "");
    if (m && url.startsWith("https://")) out.push({ year: Number(m[1]), url });
  }
  return out.sort((a, b) => b.year - a.year);
}

export interface ZipEntry {
  name: string;
  method: number;
  csize: number;
  start: number; // offset of the compressed data
}

/** The zip central directory: where each part starts. Nothing is inflated. No zip64, no encryption. */
export function zipDirectory(buf: Buffer): Map<string, ZipEntry> {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new SourceError("Not a zip file");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, ZipEntry>();
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new SourceError("Bad zip directory");
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/")) continue;
    if (csize === 0xffffffff || lho === 0xffffffff) throw new SourceError("Zip64 files are not supported");
    if (buf.readUInt32LE(lho) !== 0x04034b50) throw new SourceError("Bad zip entry");
    out.set(name, { name, method, csize, start: lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28) });
  }
  return out;
}

/** The JSON file inside a zip held in memory, as a stream of bytes (inflated piece by piece, never whole). */
export function jsonStreamFromZip(zip: Buffer): AsyncIterable<Uint8Array> {
  const entry = [...zipDirectory(zip).values()].find((e) => /\.json$/i.test(e.name));
  if (!entry) throw new SourceError("The Portal BASE zip holds no JSON file: the format may have changed");
  const raw = zip.subarray(entry.start, entry.start + entry.csize);
  if (entry.method === 0) return Readable.from([raw]);
  if (entry.method !== 8) throw new SourceError(`Unsupported zip compression ${entry.method}`);
  return Readable.from([raw]).pipe(createInflateRaw()) as unknown as AsyncIterable<Uint8Array>;
}

async function openHttp(url: string): Promise<AsyncIterable<Uint8Array | string>> {
  const res = await fetch(url, {
    redirect: "follow",
    headers: { "user-agent": "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)" },
    signal: AbortSignal.timeout(5 * 60 * 1000),
  });
  if (!res.ok) throw new SourceError(`Portal BASE file answered HTTP ${res.status}`);
  return jsonStreamFromZip(Buffer.from(await res.arrayBuffer())); // about 45 MB zipped
}

export interface HarvestOptions {
  dataset?: unknown; // for tests: the dataset listing
  open?: Opener; // for tests: a way to open a yearly file as text/bytes pieces
  budgetMs?: number;
  months?: number;
}

export async function ptContractsHarvest(now: Date = new Date(), o: HarvestOptions = {}): Promise<HarvestResult> {
  const started = Date.now();
  const to = now.toISOString().slice(0, 10);
  const months = o.months ?? WINDOW_MONTHS;
  const from = windowStart(to, months);
  const dataset = o.dataset ?? (await fetchJson(DATASET_URL, { headers: { accept: "application/json" } }, 30000));
  // files are by signing year: take the years the window touches
  const wanted = yearlyFiles(dataset).filter((f) => f.year >= Number(from.slice(0, 4)));
  if (!wanted.length) throw new SourceError("The Portal BASE resource list holds no yearly zip files for the window: the dataset may have changed");
  const open = o.open ?? openHttp;
  const budget = o.budgetMs ?? TIME_BUDGET_MS;
  const contracts: PtContract[] = [];
  const read: number[] = [];
  const failed: string[] = [];
  let records = 0;
  let lastError: unknown = null;
  for (const f of wanted) {
    if (Date.now() - started > budget) {
      failed.push(`${f.year} (time)`);
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
      read.push(f.year);
    } catch (err) {
      failed.push(String(f.year));
      lastError = err;
    }
  }
  if (!read.length) throw new SourceError("Could not read the Portal BASE files (dados.gov.pt)", String((lastError as any)?.message ?? lastError));
  if (!contracts.length) throw new SourceError("The Portal BASE files held no usable contracts in the window: the file format may have changed");
  const rows = aggregateAll(contracts, from, to);
  return {
    date: to,
    currency: "EUR",
    unit: UNIT,
    rows,
    note:
      `Contracts signed ${from} to ${to}; ${records} records in ${read.length} yearly files (${read.slice().sort().join(", ")}), ${contracts.length} usable.` +
      (failed.length ? ` Not read this day: ${failed.join(", ")}.` : ""),
  };
}

// ---------- the answer ----------

export interface PtInput {
  what: string;
  cpv?: string;
  buyer_area?: string;
  baseUrl?: string;
}

export const SUPPORTED_EXAMPLES = ["laptops", "school meals", "road resurfacing", "office cleaning", "catering", "ambulances"];

export async function ptContracts(input: PtInput): Promise<PriceAnswer> {
  if (input.buyer_area) throw new InputError("Portugal: buyer_area is not used; the figures are for all Portuguese public buyers together.");
  let item: string;
  let label: string;
  let matched: Record<string, string>;
  if (input.cpv) {
    const code = cleanCpv(input.cpv);
    if (!code || code.length === 3) {
      throw new InputError("Portugal: cpv must be a CPV product code of 2 digits (a division such as 30) or 4 to 8 digits (30213100); 4 digits or more are read as the 4-digit group (3021).");
    }
    const group = code.length === 2 ? code : code.slice(0, 4);
    item = `cpv-${group}`;
    label = `contracts under CPV group ${group}`;
    matched = { cpv_group: group, cpv_requested: code };
  } else {
    const p = matchPurchase(input.what);
    if (!p) {
      throw new InputError(
        `Portugal: "${input.what}" is not one of the purchases we summarise from Portal BASE. Try a common purchase such as ${SUPPORTED_EXAMPLES.join(", ")} (${PURCHASES.length} are recognised), or pass a CPV product code in cpv.`,
      );
    }
    item = p.id;
    label = `${p.label} contracts`;
    matched = { matched_purchase: p.id };
  }
  const day = readLatestDay(INFO.id);
  if (!day) throw new SourceError("Portuguese contract prices have not been collected yet; the daily collector fills them. Try again tomorrow.");
  const from = windowStart(day.date);
  const row = day.rows.find((r) => r.area === "ALL" && r.item === item);
  const summary = row ? { count: row.n, median: row.median, low: row.low, high: row.high, min: row.min, max: row.max } : null;
  return buildAnswer({
    source: INFO,
    query: { country: "PT", what: input.what, ...(input.cpv ? { cpv: input.cpv } : {}) },
    summary,
    currency: "EUR",
    unit: UNIT,
    period: { from, to: day.date },
    method:
      `Portal BASE contracts signed ${from} to ${day.date}, recognised by their CPV product code (${label}). Median and 10th–90th percentile of the contract price in EUR. ` +
      "Totals per contract, not unit prices; buyers and suppliers are never named.",
    describe: (s) =>
      `Portuguese public buyers signed ${label} with a median total price of ${fmtMoney(s.median, "EUR")} per contract ` +
      `(typical range ${fmtMoney(s.low, "EUR")} to ${fmtMoney(s.high, "EUR")}, 10th to 90th percentile). These are totals per contract, not unit prices.`,
    baseUrl: input.baseUrl,
    extra: { value_basis: "total contract price (registered on Portal BASE), not a unit price", ...matched, newest_collection: day.date },
  });
}
