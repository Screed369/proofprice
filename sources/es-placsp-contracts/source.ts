// Spanish public contract award prices from the Plataforma de Contratacion del Sector Publico (PLACSP), Ministerio de Hacienda.
// Format checked 2026-10-24 from GitHub's servers (probes esplacsp-a1, esplacsp-z1):
//   GET https://contrataciondelsectorpublico.gob.es/sindicacion/sindicacion_643/licitacionesPerfilesContratanteCompleto3.atom -> 200 application/atom+xml,
//   about 10 MB and 500 <entry> elements per file, newest first, a <link rel="next" href=".../licitacionesPerfilesContratanteCompleto3_20261023_202231.atom"/> chain going back in time.
//   An entry holds <id>, <updated>, <cac-place-ext:ContractFolderStatus> with <cbc:ContractFolderID>, <cbc-place-ext:ContractFolderStatusCode> (PUB, EV, ADJ, RES),
//   <cac:ProcurementProject> (<cbc:Name>, <cac:RequiredCommodityClassification><cbc:ItemClassificationCode>16700000</...> = CPV) and, once awarded,
//   one <cac:TenderResult> per lot: <cbc:ResultCode>8</...> (8 awarded, 9 formalised), <cbc:AwardDate>2026-10-23</...>,
//   <cac:AwardedTenderedProject><cac:LegalMonetaryTotal><cbc:TaxExclusiveAmount currencyID="EUR">38998</...><cbc:PayableAmount>47187.58</...>.
//   The monthly zips (147 MB) download at about 200 KB/s from GitHub, too slow for the collector, so the daily collector walks the Atom chain instead.
// Winner names, tax numbers, buyer names, addresses and contact details in the entries are never read into the library.
import { InputError, SourceError } from "../../lib/http";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { summarise } from "../../lib/stats";
import { readLatestDay } from "../../lib/library/store";
import { cleanCpv, cpvStem, matchPurchase, PURCHASES } from "../../categories/contracts/purchases";

export const INFO: SourceInfo = {
  id: "es-placsp-contracts",
  country: "ES (state, regions, municipalities, hospitals and other public buyers)",
  category: "government contracts (awarded contracts)",
  name: "PLACSP: Spanish public contract awards (Plataforma de Contratacion del Sector Publico)",
  publisher: "Ministerio de Hacienda, Plataforma de Contratacion del Sector Publico (PLACSP), open data on licitaciones de perfiles del contratante",
  what_is_recorded:
    "Public contracts that Spanish public buyers awarded and published on PLACSP: what was bought (CPV product code), the award date and the awarded price in euros without VAT.",
  price_type: "contract_price",
  freshness: "Daily: PLACSP adds awards through the day and our copy is collected once a day, covering the newest two weeks of awards",
  licence: "Spanish public-sector reuse conditions (Ley 37/2007, Real Decreto 1495/2011): commercial and non-commercial reuse allowed with the source cited",
  licence_url: "https://www.hacienda.gob.es/es-ES/Paginas/Avisolegal.aspx",
  attribution:
    "Origen de los datos: Ministerio de Hacienda (Plataforma de Contratacion del Sector Publico), actualizado cada dia. Figures are ProofPrice calculations from the published awards; the Ministry does not take part in or endorse them.",
  homepage: "https://www.hacienda.gob.es/es-ES/GobiernoAbierto/Datos%20Abiertos/Paginas/LicitacionesContratante.aspx",
  limits:
    "Awarded contract prices as registered by the buyer on PLACSP, in euros without VAT, for the whole contract (often several years); they are not unit prices and not amounts paid yet. " +
    "Only the newest two weeks of awards are summarised, from the buyers' profile feed (some regional platforms publish elsewhere), so rarer purchases may have too few awards for a figure. " +
    "Prices under 500 euros and over 1 billion euros are left out, and each award is counted once. A contract is recognised from its first CPV product code, so a contract filed under another code is missed. " +
    "Aggregates only; buyers, winners and their tax numbers in the open feed are never read or kept.",
  method_version: "1",
};

export const FEED_URL = "https://contrataciondelsectorpublico.gob.es/sindicacion/sindicacion_643/licitacionesPerfilesContratanteCompleto3.atom";
export const WINDOW_DAYS = 14;
export const MIN_VALUE = 500;
export const MAX_VALUE = 1_000_000_000;
export const UNIT = "per contract, total awarded price without VAT";
/** The collector gives each source 10 minutes: stop reading new files after this long. */
export const TIME_BUDGET_MS = 8 * 60 * 1000;
export const MAX_FILES = 80;
/** Result codes of a TenderResult that mean a winner was chosen (8 awarded, 9 formalised). */
const AWARDED_CODES = new Set(["8", "9"]);

export interface EsAward {
  key: string; // atom entry id + result index: one award counted once
  date: string; // award date YYYY-MM-DD
  value: number;
  cpv: string; // 8 digits
}

export interface EsEntry {
  id: string;
  updated: string; // YYYY-MM-DD (local date of the <updated> stamp)
  awards: EsAward[];
}

function tag(xml: string, name: string): string {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([^<]*)</${name}>`).exec(xml);
  return m ? m[1].trim() : "";
}

export function windowStart(today: string, days = WINDOW_DAYS): string {
  const d = new Date(today + "T00:00:00Z");
  return new Date(d.getTime() - days * 86400000).toISOString().slice(0, 10);
}

/** Pure: one <entry>...</entry> of the Atom feed to its awards (none for tenders that are not awarded yet). Returns null for a broken entry. */
export function parseEntry(xml: string, from: string, to: string): EsEntry | null {
  const id = tag(xml, "id");
  const updated = tag(xml, "updated").slice(0, 10);
  if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(updated)) return null;
  const awards: EsAward[] = [];
  if (!xml.includes("<cac:TenderResult>")) return { id, updated, awards };
  const project = /<cac:ProcurementProject>([\s\S]*?)<\/cac:ProcurementProject>/.exec(xml);
  const cpvRaw = project ? tag(project[1], "cbc:ItemClassificationCode") : "";
  const cpv = cpvRaw.replace(/\D/g, "").slice(0, 8);
  if (cpv.length !== 8) return { id, updated, awards };
  let i = 0;
  for (const m of xml.matchAll(/<cac:TenderResult>([\s\S]*?)<\/cac:TenderResult>/g)) {
    i++;
    const r = m[1];
    if (!AWARDED_CODES.has(tag(r, "cbc:ResultCode"))) continue;
    const date = tag(r, "cbc:AwardDate");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < from || date > to) continue;
    const awarded = /<cac:AwardedTenderedProject>([\s\S]*?)<\/cac:AwardedTenderedProject>/.exec(r);
    const value = awarded ? Number(tag(awarded[1], "cbc:TaxExclusiveAmount")) : NaN;
    if (!Number.isFinite(value) || value < MIN_VALUE || value > MAX_VALUE) continue;
    awards.push({ key: `${id}#${i}`, date, value, cpv });
  }
  return { id, updated, awards };
}

/** Pure: the href of the link rel="next" in the head of a feed file, or "". */
export function nextLink(head: string): string {
  const m = /<link\s+href="([^"]+)"\s+rel="next"\s*\/?>/.exec(head);
  return m ? m[1].replace(/&amp;/g, "&") : "";
}

/** The feed names its files on contrataciondelestado.es; the proven host is contrataciondelsectorpublico.gob.es (same path). */
export function feedUrl(href: string): string {
  try {
    const u = new URL(href);
    if (u.hostname === "contrataciondelestado.es") u.hostname = "contrataciondelsectorpublico.gob.es";
    return u.toString();
  } catch {
    return "";
  }
}

/** Splits streamed Atom text into the head (before the first entry) and complete entries without holding the file in memory. */
export class EntrySplitter {
  head = "";
  private buf = "";
  private inEntries = false;
  constructor(private onEntry: (xml: string) => void) {}
  private headDone = false;
  push(text: string): void {
    this.buf += text;
    for (;;) {
      if (!this.inEntries) {
        const i = this.buf.indexOf("<entry>");
        if (i < 0) {
          // keep a short tail in case "<entry>" is cut across pieces
          const keep = Math.min(this.buf.length, 7);
          if (!this.headDone) this.head += this.buf.slice(0, this.buf.length - keep);
          this.buf = this.buf.slice(this.buf.length - keep);
          return;
        }
        if (!this.headDone) this.head += this.buf.slice(0, i);
        this.headDone = true;
        this.buf = this.buf.slice(i);
        this.inEntries = true;
      }
      const end = this.buf.indexOf("</entry>");
      if (end < 0) return;
      this.onEntry(this.buf.slice(0, end + 8));
      this.buf = this.buf.slice(end + 8);
      this.inEntries = false;
    }
  }
}

/** The library items an award belongs to: shared purchases by CPV group, plus its 2-digit division and 4-digit group. */
const PURCHASE_STEMS = PURCHASES.map((p) => ({ id: p.id, stems: p.cpv.map(cpvStem) }));
export function itemsOf(cpv: string): string[] {
  const items: string[] = [];
  for (const p of PURCHASE_STEMS) if (p.stems.some((s) => cpv.startsWith(s))) items.push(p.id);
  items.push(`cpv-${cpv.slice(0, 2)}`, `cpv-${cpv.slice(0, 4)}`);
  return items;
}

/** Pure: library rows for every item that has at least 5 distinct awards. */
export function aggregateAll(awards: Iterable<EsAward>, from: string, to: string): DailyRow[] {
  const seen = new Set<string>();
  const groups = new Map<string, number[]>();
  for (const c of awards) {
    if (c.date < from || c.date > to || seen.has(c.key)) continue;
    seen.add(c.key);
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
    headers: { "user-agent": "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)", accept: "application/atom+xml" },
    signal: AbortSignal.timeout(3 * 60 * 1000),
  });
  if (!res.ok || !res.body) throw new SourceError(`PLACSP feed answered HTTP ${res.status}`);
  return res.body as unknown as AsyncIterable<Uint8Array>;
}

export interface HarvestOptions {
  open?: Opener; // for tests: a way to open a feed file as text/bytes pieces
  budgetMs?: number;
  days?: number;
  maxFiles?: number;
}

export async function esContractsHarvest(now: Date = new Date(), o: HarvestOptions = {}): Promise<HarvestResult> {
  const started = Date.now();
  const to = now.toISOString().slice(0, 10);
  const days = o.days ?? WINDOW_DAYS;
  const from = windowStart(to, days);
  const open = o.open ?? openHttp;
  const budget = o.budgetMs ?? TIME_BUDGET_MS;
  const maxFiles = o.maxFiles ?? MAX_FILES;
  const seenEntries = new Set<string>();
  const awards: EsAward[] = [];
  let url = FEED_URL;
  let files = 0;
  let entries = 0;
  let reached = false;
  let oldest = to;
  while (url && files < maxFiles) {
    if (Date.now() - started > budget) break;
    let fileOldest = "9999-99-99";
    const splitter = new EntrySplitter((xml) => {
      const e = parseEntry(xml, from, to);
      if (!e) return;
      entries++;
      if (e.updated < fileOldest) fileOldest = e.updated;
      if (seenEntries.has(e.id)) return; // newest version of an entry is read first
      seenEntries.add(e.id);
      for (const a of e.awards) awards.push(a);
    });
    const decoder = new TextDecoder("utf-8");
    try {
      for await (const piece of await open(url)) splitter.push(typeof piece === "string" ? piece : decoder.decode(piece, { stream: true }));
    } catch (err) {
      if (!files) throw new SourceError("Could not read the PLACSP feed (contrataciondelsectorpublico.gob.es)", String((err as any)?.message ?? err));
      break; // keep what the earlier files gave; the window check below decides if it is enough
    }
    files++;
    if (fileOldest < oldest) oldest = fileOldest;
    if (fileOldest <= from) {
      reached = true;
      break;
    }
    url = feedUrl(nextLink(splitter.head));
    if (!url) {
      reached = true; // end of the chain
      break;
    }
  }
  if (!files) throw new SourceError("The PLACSP feed could not be opened");
  if (!reached) {
    throw new SourceError(
      `The PLACSP feed was read back only to ${oldest} (${files} files) in the time allowed, short of the ${days} days wanted (${from}): not storing a partial window`,
    );
  }
  if (!awards.length) throw new SourceError("The PLACSP feed held no usable awards in the window: the feed format may have changed");
  const rows = aggregateAll(awards, from, to);
  return {
    date: to,
    currency: "EUR",
    unit: UNIT,
    rows,
    note: `Awards dated ${from} to ${to}; ${files} feed files, ${entries} entries, ${awards.length} usable awards.`,
  };
}

// ---------- the answer ----------

export interface EsInput {
  what: string;
  cpv?: string;
  buyer_area?: string;
  baseUrl?: string;
}

export const SUPPORTED_EXAMPLES = ["laptops", "school meals", "road resurfacing", "office cleaning", "catering", "ambulances"];

export async function esContracts(input: EsInput): Promise<PriceAnswer> {
  if (input.buyer_area) throw new InputError("Spain: buyer_area is not used; the figures are for all Spanish public buyers together.");
  let item: string;
  let label: string;
  let matched: Record<string, string>;
  if (input.cpv) {
    const code = cleanCpv(input.cpv);
    if (!code || code.length === 3) {
      throw new InputError("Spain: cpv must be a CPV product code of 2 digits (a division such as 30) or 4 to 8 digits (30213100); 4 digits or more are read as the 4-digit group (3021).");
    }
    const group = code.length === 2 ? code : code.slice(0, 4);
    item = `cpv-${group}`;
    label = `contracts under CPV group ${group}`;
    matched = { cpv_group: group, cpv_requested: code };
  } else {
    const p = matchPurchase(input.what);
    if (!p) {
      throw new InputError(
        `Spain: "${input.what}" is not one of the purchases we summarise from PLACSP. Try a common purchase such as ${SUPPORTED_EXAMPLES.join(", ")} (${PURCHASES.length} are recognised), or pass a CPV product code in cpv (a 2-digit division such as 45 for construction has the most awards).`,
      );
    }
    item = p.id;
    label = `${p.label} contracts`;
    matched = { matched_purchase: p.id };
  }
  const day = readLatestDay(INFO.id);
  if (!day) throw new SourceError("Spanish contract prices have not been collected yet; the daily collector fills them. Try again tomorrow.");
  const from = windowStart(day.date);
  const row = day.rows.find((r) => r.area === "ALL" && r.item === item);
  const summary = row ? { count: row.n, median: row.median, low: row.low, high: row.high, min: row.min, max: row.max } : null;
  return buildAnswer({
    source: INFO,
    query: { country: "ES", what: input.what, ...(input.cpv ? { cpv: input.cpv } : {}) },
    summary,
    currency: "EUR",
    unit: UNIT,
    period: { from, to: day.date },
    method:
      `PLACSP awards dated ${from} to ${day.date}, recognised by their CPV product code (${label}). Median and 10th–90th percentile of the awarded price in EUR without VAT. ` +
      "Totals per contract, not unit prices; buyers and winners are never named. Only two weeks of awards are summarised, so a rarer purchase may show no figure.",
    describe: (s) =>
      `Spanish public buyers awarded ${label} with a median total price of ${fmtMoney(s.median, "EUR")} per contract without VAT ` +
      `(typical range ${fmtMoney(s.low, "EUR")} to ${fmtMoney(s.high, "EUR")}, 10th to 90th percentile). These are totals per contract, not unit prices.`,
    baseUrl: input.baseUrl,
    extra: { value_basis: "total awarded price without VAT (registered on PLACSP), not a unit price", ...matched, newest_collection: day.date },
  });
}
