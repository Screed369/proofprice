// United States medical equipment and supplies as Medicare sets the fee: the CMS "DMEPOS Fee Schedule" (durable medical equipment,
// prosthetics, orthotics and supplies: wheelchairs, oxygen, CPAP, walkers, test strips, ostomy supplies ...). One fee per HCPCS code,
// modifier (NU new, RR rental, UE used, KL mail order) and state, split into non-rural (NR) and rural (R). These are POSTED Medicare
// fee-schedule amounts (regulated ceilings and floors), never prices paid, so every answer is labelled as such.
//
// Format checked on 2026-11-11 (plain curl from the cloud workspace, honest user agent, HTTP 200, 4,586,361 bytes):
//  - page https://www.cms.gov/medicare/payment/fee-schedules/dmepos/dmepos-fee-schedule links one sub-page per release
//    (.../dme26, dme26-b, dme26-c, dme26-d = January, April, July, October 2026; dme25 ...). The zip is /files/zip/<name>.zip;
//  - the zip holds DMEPOS_OCT.csv (7 title lines incl. "October 2026 Fee Schedule", header on line 8): HCPCS,Mod,Mod2,JURIS,CATG,
//    Ceiling,Floor, then "AL (NR)","AL (R)" ... for every state, and Description last. The header is read by NAME, never by position.

import { inflateRawSync } from "node:zlib";
import { buildStatisticAnswer, PriceAnswer } from "../../lib/answer";
import { InputError, SourceError } from "../../lib/http";
import type { Params, SourceInfo } from "../../lib/plugin";
import { csvFields, defaultFetcher, Fetcher } from "../us-cms-asp/source";

export const PAGE_URL = "https://www.cms.gov/medicare/payment/fee-schedules/dmepos/dmepos-fee-schedule";
export const ORIGIN = "https://www.cms.gov";

export const INFO: SourceInfo = {
  id: "us-cms-dmepos",
  country: "US (United States)",
  category: "medical equipment and supplies (Medicare DMEPOS fee schedule)",
  name: "Medicare DMEPOS Fee Schedule (durable medical equipment, prosthetics, orthotics and supplies, quarterly)",
  publisher: "Centers for Medicare & Medicaid Services (CMS), U.S. Department of Health and Human Services",
  what_is_recorded:
    "Each quarter, for each HCPCS code and modifier of medical equipment and supplies (wheelchairs, oxygen, CPAP, walkers, glucose test strips, ostomy supplies ...): " +
    "the fee Medicare allows in each state, for non-rural and rural areas (a monthly amount for rentals, a per-item or per-unit amount for purchases and supplies).",
  price_type: "reimbursement_price",
  freshness: "Quarterly (January, April, July, October); the release is stated in every answer",
  licence:
    'U.S. Government work. CMS states on its "Link to Us" page (read 2026-11-10, https://www.cms.gov/about-cms/web-policies-important-links/about-website/link-to-us): "It is a public domain web site." ' +
    "No click-through agreement applies to the DMEPOS zip. Only HCPCS Level II codes and their short descriptors are used (CPT descriptors are AMA copyright and are not used).",
  licence_url: "https://www.cms.gov/about-cms/web-policies-important-links/about-website/link-to-us",
  attribution:
    "Source: CMS DMEPOS Fee Schedule (quarterly release named in the answer). ProofPrice is not affiliated with or endorsed by CMS. " +
    "Fee amounts are passed on as published; inclusion in the fee schedule does not mean Medicare covers the item.",
  homepage: PAGE_URL,
  limits:
    "A Medicare fee-schedule amount is the posted rate Medicare allows (a regulated ceiling or floor), not a price paid, not a retail or private-insurance price and not what a patient pays (Medicare normally pays 80% of the allowed amount). " +
    "Many items are monthly RENTAL rates (modifier RR); the unit says which. Prices in a state follow CMS's state tables; some items are carrier priced and have no fee. " +
    "Without a state the answer is the median of the states' non-rural fees with the cheapest and dearest state, not a count of purchases.",
};

/** True when the request is about medical equipment: basis=dmepos (or equipment) or an HCPCS Level II code A/E/K/L. */
export function isDmeposRequest(p: Params): boolean {
  const b = String(p.basis ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (b === "dmepos" || b === "dme" || b === "equipment" || b === "medicalequipment" || b === "durablemedicalequipment") return true;
  return /^\s*[AEKL]\d{4}(\b|[-\s])/i.test(String(p.service ?? ""));
}

export interface Release {
  name: string; // dme26-d
  url: string;
  year: number;
  month: "January" | "April" | "July" | "October";
  label: string; // October 2026
  from: string;
  to: string;
  ref: string; // 2026-Q4
}

const MONTHS = { "": ["January", "01-01", "03-31", "Q1"], b: ["April", "04-01", "06-30", "Q2"], c: ["July", "07-01", "09-30", "Q3"], d: ["October", "10-01", "12-31", "Q4"] } as const;

/** The newest release linked on the CMS page (names run dme26, dme26-b, dme26-c, dme26-d; the page lists them in any order, so compare them). */
export function findRelease(html: string): Release | null {
  const re = /href="\/medicare\/payment\/fee-schedules\/dmepos\/dmepos-fee-schedule\/(dme(\d{2})(?:-([b-d]))?)"/gi;
  let best: Release | null = null;
  let bestKey = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const suffix = (m[3] ?? "").toLowerCase() as "" | "b" | "c" | "d";
    const year = 2000 + Number(m[2]);
    const key = year * 10 + "bcd".indexOf(suffix) + 1;
    if (key <= bestKey) continue;
    const [month, from, to, q] = MONTHS[suffix];
    bestKey = key;
    best = {
      name: m[1].toLowerCase(), url: `${ORIGIN}/files/zip/${m[1].toLowerCase()}.zip`, year, month: month as Release["month"],
      label: `${month} ${year}`, from: `${year}-${from}`, to: `${year}-${to}`, ref: `${year}-${q}`,
    };
  }
  return best;
}

/** Read the fee-schedule CSV (DMEPOS_*.csv) out of the zip. */
export function unzipDmeposCsv(buf: Buffer): string {
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
    if (!/^DMEPOS_[A-Z]+\.csv$/i.test(name.split("/").pop() ?? "")) continue;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + csize);
    return (method === 0 ? Buffer.from(raw) : inflateRawSync(raw)).toString("latin1").replace(/^﻿/, "");
  }
  throw new SourceError("The CMS zip holds no DMEPOS_*.csv; the format may have changed and this source needs updating.");
}

export interface DmeRow {
  code: string;
  mod: string;
  mod2: string;
  category: string; // CATG: OS ostomy, IN inexpensive, CR capped rental, OX oxygen ...
  ceiling: number | null;
  floor: number | null;
  fees: Record<string, { nr: number | null; r: number | null }>;
  description: string;
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const num = (s: string | undefined): number | null => {
  const n = Number(String(s ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null; // 0.00 means "no fee in this column"
};

export function parseDmepos(text: string): { rows: DmeRow[]; states: string[]; released: string | null } {
  const lines = text.split(/\r?\n/);
  let hdr = -1;
  for (let i = 0; i < lines.length && i < 40; i++) {
    const f = csvFields(lines[i]).map((x) => clean(x).toLowerCase());
    if (f[0] === "hcpcs" && f.includes("mod") && f.includes("description")) {
      hdr = i;
      break;
    }
  }
  if (hdr < 0) throw new SourceError("The CMS DMEPOS CSV has no HCPCS / Mod / Description header any more; the format may have changed and this source needs updating.");
  const names = csvFields(lines[hdr]).map(clean);
  const col = (n: string) => names.findIndex((x) => x.toLowerCase() === n);
  const c = { code: col("hcpcs"), mod: col("mod"), mod2: col("mod2"), catg: col("catg"), ceil: col("ceiling"), floor: col("floor"), desc: col("description") };
  const stateCols: { st: string; nr: number; r: number }[] = [];
  const byState: Record<string, { nr: number; r: number }> = {};
  names.forEach((n, i) => {
    const m = /^([A-Z]{2}) \((NR|R)\)$/.exec(n);
    if (!m) return;
    const e = (byState[m[1]] ??= { nr: -1, r: -1 });
    if (m[2] === "NR") e.nr = i;
    else e.r = i;
  });
  for (const [st, e] of Object.entries(byState)) stateCols.push({ st, ...e });
  if (c.code < 0 || c.desc < 0 || stateCols.length < 40) throw new SourceError("The CMS DMEPOS CSV columns changed (state fee columns not found); this source needs updating.");
  let released: string | null = null;
  for (const l of lines.slice(0, hdr)) {
    const m = /(January|April|July|October) (\d{4}) Fee Schedule/i.exec(l);
    if (m) released = `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} ${m[2]}`;
  }
  const rows: DmeRow[] = [];
  for (const line of lines.slice(hdr + 1)) {
    if (!line.trim()) continue;
    const f = csvFields(line);
    const code = clean(f[c.code] ?? "").toUpperCase();
    if (!/^[A-Z]\d{4}$/.test(code)) continue;
    const fees: DmeRow["fees"] = {};
    for (const s of stateCols) fees[s.st] = { nr: num(f[s.nr]), r: s.r >= 0 ? num(f[s.r]) : null };
    rows.push({
      code, mod: clean(f[c.mod] ?? "").toUpperCase(), mod2: clean(f[c.mod2] ?? "").toUpperCase(), category: clean(f[c.catg] ?? ""),
      ceiling: num(f[c.ceil]), floor: num(f[c.floor]), fees, description: clean(f[c.desc] ?? ""),
    });
  }
  return { rows, states: stateCols.map((s) => s.st), released };
}

export interface DmeFile {
  rows: DmeRow[];
  states: string[];
  release: Release;
  released: string | null;
}

let cache: { at: number; file: DmeFile } | null = null;
const TTL_MS = 6 * 3600 * 1000;

export async function loadDmepos(fetcher: Fetcher = (u) => defaultFetcher(u, 28000), now = Date.now()): Promise<DmeFile> {
  if (cache && now - cache.at < TTL_MS) return cache.file;
  const html = (await fetcher(PAGE_URL)).toString("utf8");
  const release = findRelease(html);
  if (!release) throw new SourceError("The CMS DMEPOS page lists no fee-schedule release any more; the page may have changed and this source needs updating.");
  const parsed = parseDmepos(unzipDmeposCsv(await fetcher(release.url)));
  if (parsed.rows.length < 500) throw new SourceError(`The CMS DMEPOS file gave only ${parsed.rows.length} usable rows; the format may have changed.`);
  const file = { ...parsed, release };
  cache = { at: now, file };
  return file;
}

export function resetCache(): void {
  cache = null;
}

const STATE_NAMES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE", "district of columbia": "DC", florida: "FL",
  georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH",
  "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA",
  "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA",
  "west virginia": "WV", wisconsin: "WI", wyoming: "WY", "puerto rico": "PR", "virgin islands": "VI",
};

export function parseState(raw: string | undefined, states: string[]): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const code = s.length === 2 ? s.toUpperCase() : STATE_NAMES[s.toLowerCase()];
  if (!code || !states.includes(code)) throw new InputError(`state must be a US state as a two-letter code or name (TX, Texas), or left out for the median across states. Not recognised: ${raw}.`);
  return code;
}

// Plain words to the way the HCPCS descriptors are abbreviated.
const SYNONYMS: Record<string, string[]> = {
  cpap: ["airway", "pressure"], bipap: ["bi-level"], bilevel: ["bi-level"], strips: ["strips"], "test strips": ["strips"], "glucose strips": ["strips"],
  crutches: ["crutch"], walker: ["walker"], walkers: ["walker"], wheelchair: ["wheelchair"], wheelchairs: ["wheelchair"], "hospital bed": ["hospital", "bed"],
  "oxygen concentrator": ["oxygen", "concentrator"], oxygen: ["oxygen"], nebulizer: ["nebulizer"], commode: ["commode"],
};

export function serviceQuery(input: string | undefined): { code: string | null; mod: string | null; words: string[] } {
  const raw = String(input ?? "").trim();
  const m = /^([A-Za-z]\d{4})(?:[-\s]+([A-Za-z]{2}))?$/.exec(raw);
  if (m) return { code: m[1].toUpperCase(), mod: m[2] ? m[2].toUpperCase() : null, words: [] };
  const low = raw.toLowerCase().replace(/\s+/g, " ");
  const words = SYNONYMS[low] ?? low.split(/[\s,;/]+/).map((w) => w.replace(/[^a-z0-9-]/g, "")).filter((w) => w.length > 1);
  return { code: null, mod: null, words };
}

const MOD_ORDER = ["", "NU", "RR", "UE", "KL"];
const modRank = (m: string) => {
  const i = MOD_ORDER.indexOf(m);
  return i < 0 ? 99 : i;
};

export function matchDmepos(rows: DmeRow[], q: { code: string | null; mod: string | null; words: string[] }): DmeRow[] {
  let hits: DmeRow[];
  if (q.code) hits = rows.filter((r) => r.code === q.code && (!q.mod || r.mod === q.mod || r.mod2 === q.mod));
  else if (q.words.length) hits = rows.filter((r) => q.words.every((w) => r.description.toLowerCase().includes(w)));
  else hits = [];
  return hits.sort((a, b) => a.code.localeCompare(b.code) || modRank(a.mod) - modRank(b.mod));
}

const MOD_TEXT: Record<string, string> = { NU: "new purchase", RR: "monthly rental", UE: "used purchase", KL: "mail order", "": "" };
export function unitFor(r: DmeRow): string {
  if (r.mod === "RR") return "per month (rental)";
  if (r.mod === "UE") return "per item (used)";
  if (r.mod === "KL") return "per item (mail order)";
  return "per item or billing unit";
}

const median = (v: number[]): number => {
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** The fee for one row: the chosen state (non-rural; rural when only that exists) or the median of the states' non-rural fees. */
export function feeFor(r: DmeRow, state: string | null): { value: number | null; min: number | null; max: number | null; rural: number | null; n_states: number } {
  if (state) {
    const f = r.fees[state];
    const value = f?.nr ?? f?.r ?? null;
    return { value, min: null, max: null, rural: f?.r ?? null, n_states: value ? 1 : 0 };
  }
  const v = Object.values(r.fees).map((f) => f.nr ?? f.r).filter((x): x is number => x !== null);
  if (!v.length) return { value: null, min: null, max: null, rural: null, n_states: 0 };
  return { value: median(v), min: Math.min(...v), max: Math.max(...v), rural: null, n_states: v.length };
}

export function methodText(): string {
  return (
    "United States (medical equipment and supplies): the quarterly Medicare DMEPOS Fee Schedule from CMS. For an HCPCS code (or plain words matched to the code descriptors) we pass on the Medicare fee for a state " +
    "(non-rural; rural when that is the only one), or the median of the states' fees with the cheapest and dearest state. A posted Medicare fee-schedule amount, not a price paid; rentals are monthly amounts."
  );
}

const usd = (v: number) => (v >= 100 ? `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : `$${v.toFixed(2)}`);

export interface DmeInput {
  service?: string;
  state?: string;
  baseUrl?: string;
}

export async function dmeposPrices(input: DmeInput, fetcher?: Fetcher): Promise<PriceAnswer> {
  const q = serviceQuery(input.service);
  if (!q.code && !q.words.length) {
    throw new InputError("service is required: an HCPCS equipment code such as E0601 (CPAP) or E1390 (oxygen concentrator), or plain words such as 'wheelchair' or 'walker', with basis=dmepos.");
  }
  const file = await loadDmepos(fetcher);
  const state = parseState(input.state, file.states);
  const hits = matchDmepos(file.rows, q);
  const rel = file.release;
  const label = file.released ?? rel.label;
  const query = { country: "US", service: input.service ?? "", ...(state ? { state } : {}), basis: "dmepos" };
  const period = { from: rel.from, to: rel.to };
  const refPeriod = `${label} DMEPOS fee schedule`;
  const priced = hits.filter((r) => feeFor(r, state).value !== null);
  if (!priced.length) {
    return buildStatisticAnswer({
      source: INFO, query, value: null, measure: "median", currency: "USD", unit: "per item", period, reference_period: refPeriod, method: methodText(), describe: () => "", baseUrl: input.baseUrl,
      extra: { hint: hits.length ? "The item is in the fee schedule but has no fee for this state (carrier priced)." : "No DMEPOS code has a descriptor with these words. Give the HCPCS code (E0601 CPAP, E1390 oxygen concentrator, K0001 standard wheelchair, E0143 walker) or other words from the CMS descriptor." },
    });
  }
  const head = priced[0];
  const fee = feeFor(head, state);
  const unit = unitFor(head);
  const where = state ? `in ${state}` : `across the ${fee.n_states} states and territories (median)`;
  return buildStatisticAnswer({
    source: INFO,
    query,
    value: fee.value,
    measure: state ? "average" : "median",
    currency: "USD",
    unit,
    period,
    reference_period: refPeriod,
    sample_size: null,
    min: fee.min,
    max: fee.max,
    method: methodText(),
    note: "Medicare DMEPOS fee-schedule amount: a posted reimbursement rate, not a price paid.",
    baseUrl: input.baseUrl,
    describe: (v) =>
      `For ${label}, Medicare's fee schedule for ${head.description || head.code} (HCPCS ${head.code}${head.mod ? ` ${head.mod}, ${MOD_TEXT[head.mod] ?? head.mod}` : ""}) is ${usd(v)} ${unit} ${where}. ` +
      `That is a posted Medicare fee-schedule amount for medical equipment and supplies, not a price paid and not a retail price.`,
    extra: {
      what_the_figure_is: "CMS DMEPOS fee-schedule amount (Medicare's allowed fee) per HCPCS code and modifier: a regulated reimbursement rate, not a transaction price.",
      headline_code: head.code,
      headline_modifier: head.mod || null,
      headline_description: head.description,
      payment_category: head.category,
      ...(fee.rural ? { rural_fee_usd: fee.rural } : {}),
      ...(state ? {} : { states_counted: fee.n_states }),
      release: rel.name,
      file: rel.url,
      variants: priced.slice(0, 12).map((r) => ({ hcpcs: r.code, modifier: r.mod || null, kind: MOD_TEXT[r.mod] ?? r.mod, description: r.description, unit: unitFor(r), fee_usd: roundCents(feeFor(r, state).value) })),
      ...(priced.length > 12 ? { variants_shown: 12, variants_total: priced.length } : {}),
    },
  });
}

const roundCents = (v: number | null) => (v === null ? null : Math.round(v * 100) / 100);
