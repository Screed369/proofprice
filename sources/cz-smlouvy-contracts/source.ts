// Czech public contract prices from the Registr smluv (register of contracts, smlouvy.gov.cz), monthly XML dumps.
// Facts checked 2026-11-05 from the cloud workspace (plain GET, key-free):
//   index  https://data.smlouvy.gov.cz/index.xml   (one <dump> per month: mesic, rok, velikostDumpu, dokoncenyMesic, odkaz)
//   dump   https://data.smlouvy.gov.cz/dump_2026_10.xml  (139 MB, Content-Length, regenerated daily, Accept-Ranges bytes)
//   <dump xmlns=".../ISRS/1.2/"><mesic/><rok/><casGenerovani/><dokoncenyMesic/><zaznam><identifikator><idSmlouvy/><idVerze/></identifikator>
//     <odkaz/><casZverejneni>2026-10-01T05:22:47+02:00</casZverejneni><smlouva><subjekt>..</subjekt><smluvniStrana>..</smluvniStrana>
//     <predmet>free text subject</predmet><datumUzavreni>2026-09-17</datumUzavreni><cisloSmlouvy/><hodnotaBezDph>68400</hodnotaBezDph>
//     <hodnotaVcetneDph>2359500</hodnotaVcetneDph></smlouva><prilohy>..</prilohy><platnyZaznam>1</platnyZaznam></zaznam>
//   The value fields are optional (some contracts state none). There is NO product code (CPV) in the register: purchases are recognised
//   from words in the free-text subject (predmet).
// Licence: the publisher's page https://smlouvy.gov.cz/stranka/otevrena-data (read 2026-11-05) says "Metadata zverejnena v Registru smluv jsou
// povazovana za tzv. otevrena data" but names no licence, and says the recipient of the data set becomes a personal-data controller. So the
// licence is UNCLEAR: free tier only (Simon 29 Oct). We keep no names, subjects or contract numbers: only value, date and a purchase label.
import { SourceError, InputError } from "../../lib/http";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { NO_COUNT, summarise } from "../../lib/stats";
import { readLatestDay } from "../../lib/library/store";
import { matchPurchase, normaliseText, PURCHASES } from "../../categories/contracts/purchases";

export const INFO: SourceInfo = {
  id: "cz-smlouvy-contracts",
  country: "CZ (state, regions, municipalities, hospitals and other public bodies)",
  category: "government contracts (published contract values)",
  name: "Registr smluv: Czech register of public contracts (published contract values)",
  publisher: "Registr smluv (register of contracts), smlouvy.gov.cz",
  what_is_recorded:
    "Contracts that Czech public bodies must publish in the register: the subject in words, the date the contract was concluded and the contract value in Czech koruna excluding VAT.",
  price_type: "contract_price",
  freshness: "Daily: the register is updated continuously and our copy is collected once a day",
  licence: "Not stated by the publisher: its page calls the metadata open data but names no licence (free tier only)",
  licence_url: "https://smlouvy.gov.cz/stranka/otevrena-data",
  attribution: "Source: Registr smluv (smlouvy.gov.cz), published contract values. Figures are ProofPrice aggregates of the published records.",
  homepage: "https://smlouvy.gov.cz/",
  limits:
    "Contract values as the parties state them in the register, in koruna excluding VAT, per contract; they are not unit prices and not amounts already paid. " +
    "The register has no product code, so a purchase is recognised from words in the contract subject and a match can be wrong or incomplete; contracts that state no value excluding VAT are left out. " +
    "Values under 1,000 and over 20 billion koruna are left out, and each contract is counted once (its newest version, and only if still valid). " +
    "The figure covers contracts published in the newest weeks only (the answer gives the dates). Aggregates only; parties and subjects are never kept.",
  method_version: "1",
};

export const DUMP_BASE = "https://data.smlouvy.gov.cz";
export const MIN_VALUE = 1000;
export const MAX_VALUE = 20_000_000_000;
export const UNIT = "per contract, total value excluding VAT";
export const WINDOW_PREFIX = "window:";
export const FETCH_TIMEOUT_MS = 8 * 60 * 1000; // under the collector's 10-minute limit (scripts/harvest.ts)

/** Czech wording per purchase id: regular expressions over the subject as `normaliseText` writes it (no accents, lower case, single spaces). */
export const CZ_WORDS: Record<string, string> = {
  laptops: "\\b(notebook\\w*|laptop\\w*|prenosn\\w* pocitac\\w*)",
  "desktop-computers": "\\bstolni\\w* pocitac\\w*",
  "school-meals": "\\b(skolni stravovani|stravovani zaku|stravovani ve skol\\w*|skolni jidelna)",
  catering: "\\bcatering\\w*",
  "road-resurfacing": "\\b(opravy? (komunikac\\w*|silnic\\w*|vozovk\\w*)|asfaltov\\w* (povrch\\w*|koberc\\w*)|obnova povrchu komunikac\\w*)",
  "office-cleaning": "\\buklid\\w* (kancelar\\w*|administrativn\\w*)",
  "school-cleaning": "\\buklid\\w* skol\\w*",
  "building-cleaning": "\\b(uklid\\w* (budov\\w*|objekt\\w*|prostor\\w*)|uklidov\\w* sluzb\\w*)",
  electricity: "\\b(dodavk\\w* (elektrin\\w*|elektricke energi\\w*)|prodej elektrin\\w*)",
  "natural-gas": "\\bdodavk\\w* (zemn\\w* plyn\\w*|plynu)",
  "waste-collection": "\\b(svoz\\w* (odpad\\w*|komunaln\\w*)|odvoz\\w* odpad\\w*)",
  "street-cleaning": "\\b(uklid\\w* komunikac\\w*|cisteni komunikac\\w*|zametani)",
  "winter-maintenance": "\\bzimn\\w* udrzb\\w*",
  buses: "\\b(nakup|dodavk\\w*|koupe) autobus\\w*",
  cars: "\\bosobn\\w* (automobil\\w*|vozidl\\w*)",
  photocopiers: "\\bkopirovac\\w* (stroj\\w*|zarizeni)",
  "office-furniture": "\\bkancelarsk\\w* nabyt\\w*",
  uniforms: "\\b(uniform\\w*|pracovn\\w* odev\\w*|ochrann\\w* odev\\w*)",
  textbooks: "\\bucebnic\\w*",
  software: "\\bsoftware\\w*",
  "legal-services": "\\b(pravn\\w* (sluzb\\w*|poradenstv\\w*|pomoc\\w*))",
  consultancy: "\\b(poradensk\\w* sluzb\\w*|konzultacn\\w* sluzb\\w*)",
  "security-guards": "\\b(ostrah\\w*|strazn\\w* sluzb\\w*)",
  "grounds-maintenance": "\\budrzb\\w* zelen\\w*",
  pharmaceuticals: "\\bleciv\\w* pripravk\\w*",
  vaccines: "\\bvakc\\w*",
  "surgical-gloves": "\\brukavic\\w*",
  "solar-panels": "\\bfotovoltaick\\w* (panel\\w*|modul\\w*)",
  translation: "\\b(preklad\\w* sluzb\\w*|tlumocn\\w*)",
  insurance: "\\bpojisten\\w*",
};
const KNOWN = new Set(PURCHASES.map((p) => p.id));
const MATCHERS: { id: string; re: RegExp }[] = Object.entries(CZ_WORDS).map(([id, re]) => {
  if (!KNOWN.has(id)) throw new Error(`cz-smlouvy-contracts: unknown purchase id ${id}`);
  return { id, re: new RegExp(re) };
});
export const SUPPORTED_IDS = MATCHERS.map((m) => m.id);

/** Pure: the first purchase whose Czech words appear in the contract subject, or null. */
export function purchaseOfSubject(subject: string): string | null {
  const t = normaliseText(subject);
  if (!t) return null;
  for (const m of MATCHERS) if (m.re.test(t)) return m.id;
  return null;
}

/** One contract with only the fields we keep. */
export interface CzContract {
  id: string;
  version: number;
  date: string; // publication date YYYY-MM-DD
  value: number | null; // koruna excluding VAT
  purchase: string | null;
  valid: boolean;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}
function tag(s: string, name: string): string | null {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(s);
  return m ? m[1] : null;
}

/** Pure: one `<zaznam>...</zaznam>` to a contract, or null when it has no id or publication date. The subject is used for matching and then dropped. */
export function parseRecord(xml: string): CzContract | null {
  const id = tag(xml, "idSmlouvy")?.trim();
  const ver = Number(tag(xml, "idVerze")?.trim());
  const date = (tag(xml, "casZverejneni") ?? "").slice(0, 10);
  if (!id || !Number.isFinite(ver) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const smlouva = tag(xml, "smlouva") ?? "";
  // the value elements sit directly in <smlouva>; take them from the text after the last party block so a nested tag can never be mistaken for them
  const tail = smlouva.slice(smlouva.lastIndexOf("</smluvniStrana>") + 1);
  const raw = tag(tail, "hodnotaBezDph");
  const value = raw !== null && /^\s*-?\d+(\.\d+)?\s*$/.test(raw) ? Number(raw) : null;
  const subject = decode(tag(smlouva, "predmet") ?? "");
  const valid = (tag(xml, "platnyZaznam") ?? "1").trim() !== "0";
  return { id, version: ver, date, value, purchase: purchaseOfSubject(subject), valid };
}

/** Pure: split a growing text buffer into complete records; returns the records and the unread rest. */
export function splitRecords(buffer: string): { records: string[]; rest: string } {
  const records: string[] = [];
  let pos = 0;
  for (;;) {
    const end = buffer.indexOf("</zaznam>", pos);
    if (end < 0) break;
    const start = buffer.lastIndexOf("<zaznam>", end);
    if (start >= pos) records.push(buffer.slice(start, end + 9));
    pos = end + 9;
  }
  return { records, rest: buffer.slice(pos) };
}

/** Collects the newest version of each contract. Streamed: a month is about 140 MB, so nothing but the small contract objects is kept. */
export class ContractBook {
  private byId = new Map<string, CzContract>();
  add(c: CzContract): void {
    const old = this.byId.get(c.id);
    if (!old || c.version > old.version) this.byId.set(c.id, c);
  }
  get size(): number {
    return this.byId.size;
  }
  usable(from: string, to: string): CzContract[] {
    const out: CzContract[] = [];
    for (const c of this.byId.values()) {
      if (!c.valid || !c.purchase || c.value === null) continue;
      if (c.date < from || c.date > to) continue;
      if (c.value < MIN_VALUE || c.value > MAX_VALUE) continue;
      out.push(c);
    }
    return out;
  }
}

/** Pure: library rows for every purchase with at least 5 contracts. */
export function aggregateAll(contracts: CzContract[]): DailyRow[] {
  const groups = new Map<string, number[]>();
  for (const c of contracts) {
    if (!c.purchase || c.value === null) continue;
    const g = groups.get(c.purchase);
    if (g) g.push(c.value);
    else groups.set(c.purchase, [c.value]);
  }
  const rows: DailyRow[] = [];
  for (const [item, values] of groups) {
    const s = summarise(values);
    if (!s || s.count < 5) continue;
    rows.push({ area: "ALL", item, n: s.count, median: s.median, low: s.low, high: s.high, min: s.min, max: s.max });
  }
  return rows.sort((a, b) => a.item.localeCompare(b.item));
}

/** Marker row: the first day of the window, e.g. "window:2026-10-01". No price (NO_COUNT, zeros), so no answer can show it as a figure. */
export function windowMarker(from: string): DailyRow {
  return { area: "ALL", item: WINDOW_PREFIX + from, n: NO_COUNT, median: 0, low: 0, high: 0, min: 0, max: 0 };
}
export function windowOf(rows: { area: string; item: string }[]): string | null {
  const m = rows.find((r) => r.area === "ALL" && r.item.startsWith(WINDOW_PREFIX));
  return m ? m.item.slice(WINDOW_PREFIX.length) : null;
}

/** Pure: "2026_10" style names of the previous month and the month of `now`. */
export function dumpMonths(now: Date): { year: number; month: number }[] {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1;
  const prev = m === 1 ? { year: y - 1, month: 12 } : { year: y, month: m - 1 };
  return [prev, { year: y, month: m }];
}
export const dumpUrl = (d: { year: number; month: number }) => `${DUMP_BASE}/dump_${d.year}_${String(d.month).padStart(2, "0")}.xml`;

export type ChunkSource = (url: string) => AsyncIterable<string>;
/** Streams a dump over HTTP as text chunks (UTF-8). */
export const httpChunks: ChunkSource = async function* (url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { accept: "text/xml", "user-agent": "ProofPrice/1.0 (+https://proofprice.com; hello@proofprice.com)" } });
    if (!res.ok || !res.body) throw new SourceError(`Registr smluv dump answered HTTP ${res.status}`, url);
    const dec = new TextDecoder("utf-8");
    const reader = (res.body as any).getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      yield dec.decode(value, { stream: true });
    }
    yield dec.decode();
  } finally {
    clearTimeout(timer);
  }
};

/** Reads one dump into the book; returns the number of records read. */
export async function readDump(url: string, chunks: ChunkSource, book: ContractBook): Promise<number> {
  let buf = "";
  let n = 0;
  for await (const chunk of chunks(url)) {
    buf += chunk;
    const { records, rest } = splitRecords(buf);
    buf = rest;
    for (const r of records) {
      const c = parseRecord(r);
      if (c) {
        book.add(c);
        n++;
      }
    }
  }
  return n;
}

export interface HarvestOptions {
  chunks?: ChunkSource; // for tests
}

export async function czContractsHarvest(now: Date = new Date(), o: HarvestOptions = {}): Promise<HarvestResult> {
  const chunks = o.chunks ?? httpChunks;
  const months = dumpMonths(now);
  const to = now.toISOString().slice(0, 10);
  const from = `${months[0].year}-${String(months[0].month).padStart(2, "0")}-01`;
  const book = new ContractBook();
  let read = 0;
  const errors: string[] = [];
  for (const m of months) {
    try {
      read += await readDump(dumpUrl(m), chunks, book);
    } catch (err) {
      errors.push(`${m.year}-${m.month}: ${String((err as any)?.message ?? err)}`);
    }
  }
  // the current month alone is enough when it is well into the month; both months failing is a failed harvest
  if (errors.length === months.length || !read) throw new SourceError("Could not read the Registr smluv dumps (data.smlouvy.gov.cz)", errors.join("; ").slice(0, 300));
  const used = book.usable(from, to);
  if (!used.length) throw new SourceError("The Registr smluv dumps held no usable contract values: the layout may have changed");
  const rows = aggregateAll(used);
  if (!rows.length) throw new SourceError("No purchase reached 5 contracts in the Registr smluv window: the subject wording or layout may have changed");
  rows.push(windowMarker(from));
  return {
    date: to,
    currency: "CZK",
    unit: UNIT,
    rows,
    note: `Contracts published ${from} to ${to}; ${read} records read, ${book.size} contracts, ${used.length} with a recognised purchase and a usable value.` + (errors.length ? ` Not read: ${errors.join("; ")}.` : ""),
  };
}

// ---------- the answer ----------

export interface CzInput {
  what: string;
  cpv?: string;
  buyer_area?: string;
  baseUrl?: string;
}

export const SUPPORTED_EXAMPLES = ["laptops", "waste collection", "office cleaning", "electricity", "legal services", "security guards"];

export async function czContracts(input: CzInput): Promise<PriceAnswer> {
  if (input.cpv) throw new InputError("Czech Republic: the register has no product codes, so cpv is not used; say what was bought in what, for example 'waste collection'.");
  if (input.buyer_area) throw new InputError("Czech Republic: buyer_area is not used; the figures are for all Czech public bodies together.");
  const p = matchPurchase(input.what);
  if (!p || !SUPPORTED_IDS.includes(p.id)) {
    throw new InputError(
      `Czech Republic: "${input.what}" is not one of the purchases we summarise from the register of contracts. Try one of: ${SUPPORTED_EXAMPLES.join(", ")} (${SUPPORTED_IDS.length} purchases are recognised from the contract subject).`,
    );
  }
  const day = readLatestDay(INFO.id);
  if (!day) throw new SourceError("Czech contract values have not been collected yet; the daily collector fills them. Try again tomorrow.");
  const from = windowOf(day.rows) ?? day.date.slice(0, 7) + "-01";
  const row = day.rows.find((r) => r.area === "ALL" && r.item === p.id);
  const summary = row ? { count: row.n, median: row.median, low: row.low, high: row.high, min: row.min, max: row.max } : null;
  return buildAnswer({
    source: INFO,
    query: { country: "CZ", what: input.what },
    summary,
    currency: "CZK",
    unit: UNIT,
    period: { from, to: day.date },
    method:
      `Contracts published in the Czech register of contracts ${from} to ${day.date}, recognised by Czech words in the contract subject (${p.label}). ` +
      "Median and 10th–90th percentile of the contract value in koruna excluding VAT. Totals per contract, not unit prices; parties and subjects are never kept.",
    describe: (s) =>
      `Czech public bodies published ${p.label} contracts with a median total value of ${fmtMoney(s.median, "CZK")} excluding VAT per contract ` +
      `(typical range ${fmtMoney(s.low, "CZK")} to ${fmtMoney(s.high, "CZK")}, 10th to 90th percentile). These are totals per contract, not unit prices, and the match is made from words in the contract subject.`,
    baseUrl: input.baseUrl,
    extra: { value_basis: "total contract value excluding VAT as published in the Registr smluv, not a unit price and not a payment", matched_purchase: p.id, newest_collection: day.date },
  });
}
