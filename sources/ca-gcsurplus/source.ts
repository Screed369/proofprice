// Canada federal surplus sales (GCSurplus, Public Services and Procurement Canada): "Items sold" open dataset, half-yearly zips.
// Format read on 2026-10-22 (probe cagcs-b1): one CSV per half year, UTF-8 with BOM, quoted cells with line breaks, header
// SOLD_AMT,LOT_DESC,MIN_BID_AMT,CLOSING_DT,LOT_ITEMS,...,ASSET_LOC_PROV,...,SALE_CNTRCT_REG_ID,...,VEHICLE_FEATURES,CLAUSES.
// The file also holds contact names, phones and e-mails of custodians and sales staff: they are never read into a record or stored.
// The files are big (about 40 MB unzipped), so the daily collector (harvest) reads them and keeps aggregates; requests read the library.
import { inflateRawSync } from "node:zlib";
import { SourceError, InputError } from "../../lib/http";
import { summarise, MIN_PUBLISH } from "../../lib/stats";
import { buildAnswer, fmtMoney, PriceAnswer } from "../../lib/answer";
import { aggregateDaily, NATIONAL } from "../../lib/library/aggregate";
import { readDaily, readMeta } from "../../lib/library/store";
import type { DailyRow, HarvestResult, SourceInfo } from "../../lib/plugin";

export const INFO: SourceInfo = {
  id: "ca-gcsurplus",
  country: "CA (Canada)",
  category: "auctions (government surplus sale prices)",
  name: "GCSurplus: items sold",
  publisher: "Public Services and Procurement Canada (GCSurplus)",
  what_is_recorded: "One lot of Government of Canada surplus goods sold through GCSurplus, with the sold amount, closing date and province.",
  price_type: "transaction",
  freshness: "Half-yearly files; the newest sale in the latest file can be several months old",
  licence: "Open Government Licence - Canada: 'The Information Provider grants you a worldwide, royalty-free, perpetual, non-exclusive licence to use the Information, including for commercial purposes'",
  licence_url: "https://open.canada.ca/en/open-government-licence-canada",
  attribution: "Contains information licensed under the Open Government Licence – Canada. Source: Public Services and Procurement Canada, GCSurplus items sold. Aggregated by ProofPrice (changed: medians and percentiles only).",
  homepage: "https://open.canada.ca/data/en/dataset/1a09c5c1-3554-4b70-9e53-6322a72ec7d4",
  limits:
    "Sold amount per lot on federal surplus sales (used goods, one lot may hold several items), in Canadian dollars; whether tax is included is not stated. Service, removal and scrap-collection contracts are left out. Groups are assigned from the lot title by keywords, so they are approximate. Aggregates only, never a lot, a place below province level, or a person.",
};

export const CA_EVIDENCE = {
  label: "Government surplus sale prices (sold amount)",
  meaning:
    "The sold amount on Government of Canada surplus lots published by GCSurplus: used goods sold by the government, not retail prices. Whether tax is included is not stated.",
};

export const PROVINCES: Record<string, string> = {
  AB: "Alberta", BC: "British Columbia", MB: "Manitoba", NB: "New Brunswick", NL: "Newfoundland and Labrador", NS: "Nova Scotia",
  NT: "Northwest Territories", NU: "Nunavut", ON: "Ontario", PE: "Prince Edward Island", QC: "Quebec", SK: "Saskatchewan", YT: "Yukon",
};
const PROVINCE_ALIASES: Record<string, string> = { "BRITISH COLUMBIA": "BC", "NEW BRUNSWICK": "NB", "NEWFOUNDLAND": "NL", "NEWFOUNDLAND AND LABRADOR": "NL", "NOVA SCOTIA": "NS",
  "NORTHWEST TERRITORIES": "NT", "PRINCE EDWARD ISLAND": "PE", "PEI": "PE", "QUEBEC": "QC", "QUÉBEC": "QC", "PQ": "QC", "YUKON": "YT", "ALBERTA": "AB", "MANITOBA": "MB",
  "NUNAVUT": "NU", "ONTARIO": "ON", "SASKATCHEWAN": "SK" };

/** A province or territory name or code to its two-letter code, or null. */
export function normaliseProvince(s: string | undefined): string | null {
  if (!s) return null;
  const u = s.trim().toUpperCase().replace(/\./g, "");
  if (PROVINCES[u]) return u;
  return PROVINCE_ALIASES[u] ?? null;
}

export const GROUPS = ["vehicles", "heavy-equipment", "electronics", "office-furniture", "boats", "tools-machinery"] as const;
export type Group = (typeof GROUPS)[number];
export const WINDOWS = [6, 12, 24] as const;

const GROUP_WORDS: Record<Group, RegExp> = {
  "heavy-equipment": /\b(tractor|loader|excavator|backhoe|grader|bulldozer|dozer|forklift|fork lift|crane|skid steer|dump truck|roller|compactor|snow ?blower|plow|trencher|generator)\b/i,
  boats: /\b(boat|vessel|zodiac|outboard|inflatable|canoe|kayak|sailboat|barge)\b/i,
  vehicles: /\b(truck|pickup|sedan|suv|van|minivan|car|bus|trailer|ambulance|jeep|ford|chevrolet|dodge|gmc|toyota|honda|nissan|motorcycle|atv|quad|snowmobile|vehicle)\b/i,
  electronics: /\b(computers?|laptops?|notebooks?|monitors?|printers?|servers?|tablets?|phones?|radios?|projectors?|cameras?|scanners?|televisions?|tv|electronic|network|switch|router|hard drives?)\b/i,
  "office-furniture": /\b(desks?|chairs?|tables?|cabinets?|shelv(?:es|ing)|bookcases?|furniture|filing|workstations?|cubicles?|lockers?)\b/i,
  "tools-machinery": /\b(lathe|mill|drill|press|saw|welder|welding|compressor|pump|machine|machinery|tools?|grinder|hoist|jack)\b/i,
};
// Order matters: a 'dump truck' is heavy equipment, not a plain vehicle.
const GROUP_ORDER: Group[] = ["heavy-equipment", "boats", "vehicles", "electronics", "office-furniture", "tools-machinery"];

/** Not goods: removal, scrap-collection and service contracts (one lot repeated over several rows). */
const CONTRACT_RE = /\b(contracts?|removal|enlevement|services?|disposal|recycling|salvage|waste|demolition)\b/i;

/** The lot title is stored twice back to back in the file ("Title" + "Title"); keep one copy. */
export function cleanTitle(raw: string): string {
  const t = raw.replace(/\s+/g, " ").trim();
  const half = Math.floor(t.length / 2);
  if (t.length > 6 && t.length % 2 === 0 && t.slice(0, half) === t.slice(half)) return t.slice(0, half);
  const m = t.match(/^(.{6,}?)\1$/);
  return m ? m[1] : t;
}

export function classify(title: string, hasVehicleFeatures: boolean): Group | null {
  if (CONTRACT_RE.test(title)) return null;
  for (const g of GROUP_ORDER) if (GROUP_WORDS[g].test(title)) return g;
  return hasVehicleFeatures ? "vehicles" : null;
}

export interface Sale {
  group: Group;
  prov: string;
  date: string;
  price: number;
}

/** RFC 4180 CSV, row by row; the callback sees every row and nothing is kept (the file holds personal contact columns). */
export function forEachCsvRow(text: string, cb: (row: string[], index: number) => void): void {
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let n = 0;
  const t = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const end = () => {
    row.push(cell);
    cell = "";
    if (row.length > 1 || row[0] !== "") cb(row, n++);
    row = [];
  };
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (quoted) {
      if (c === '"') {
        if (t[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      end();
    } else cell += c;
  }
  if (cell !== "" || row.length) end();
}

/** Sold goods lots: positive sold amount, a closing date, a known province, not a contract. Only five columns are read. */
export function parseSales(text: string): Sale[] {
  const sales: Sale[] = [];
  const seen = new Set<string>();
  let ix: Record<string, number> | null = null;
  forEachCsvRow(text, (r, index) => {
    if (index === 0) {
      const names = ["SOLD_AMT", "LOT_DESC", "CLOSING_DT", "ASSET_LOC_PROV", "VEHICLE_FEATURES", "SALE_CNTRCT_REG_ID"];
      ix = Object.fromEntries(names.map((n) => [n, r.map((h) => h.trim()).indexOf(n)]));
      if (names.slice(0, 5).some((n) => ix![n] < 0)) throw new SourceError("Unexpected file format from GCSurplus");
      return;
    }
    const x = ix!;
    const price = Number(String(r[x.SOLD_AMT] ?? "").replace(/[$\s,]/g, ""));
    const date = r[x.CLOSING_DT] ?? "";
    const prov = normaliseProvince(r[x.ASSET_LOC_PROV]);
    if (!(price > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !prov) return;
    const title = cleanTitle(r[x.LOT_DESC] ?? "");
    const group = classify(title, (r[x.VEHICLE_FEATURES] ?? "").trim() !== "");
    if (!group) return;
    // A lot can be repeated over several rows: the same sale id with the same amount counts once.
    const id = x.SALE_CNTRCT_REG_ID >= 0 ? (r[x.SALE_CNTRCT_REG_ID] ?? "").trim() : "";
    const key = id ? `${id}|${price}` : `${title}|${date}|${price}|${prov}`;
    if (seen.has(key)) return;
    seen.add(key);
    sales.push({ group, prov, date, price });
  });
  return sales;
}

export function monthsBack(date: string, months: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

/** Rows of the library for every window: area = province code or ALL, item = "<group>:<months>m". */
export function dailyRows(sales: Sale[]): { date: string; rows: DailyRow[] } {
  const last = sales.reduce((m, s) => (s.date > m ? s.date : m), "0000-00-00");
  const recs: { area: string; item: string; price: number }[] = [];
  for (const w of WINDOWS) {
    const from = monthsBack(last, w);
    for (const s of sales) {
      if (s.date <= from) continue;
      recs.push({ area: s.prov, item: `${s.group}:${w}m`, price: s.price });
      recs.push({ area: NATIONAL, item: `${s.group}:${w}m`, price: s.price });
    }
  }
  return { date: last, rows: aggregateDaily(recs, false).filter((r) => r.n >= MIN_PUBLISH) };
}

export function unzipFirstFile(buf: Buffer): Buffer {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new SourceError("Not a zip file");
  const cd = buf.readUInt32LE(eocd + 16);
  if (buf.readUInt32LE(cd) !== 0x02014b50) throw new SourceError("Bad zip directory");
  const method = buf.readUInt16LE(cd + 10);
  const csize = buf.readUInt32LE(cd + 20);
  const lho = buf.readUInt32LE(cd + 42);
  if (buf.readUInt32LE(lho) !== 0x04034b50) throw new SourceError("Bad zip entry");
  const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
  const data = buf.subarray(start, start + csize);
  if (method === 0) return Buffer.from(data);
  if (method === 8) return inflateRawSync(data);
  throw new SourceError(`Unsupported zip method ${method}`);
}

export const PACKAGE_URL = "https://open.canada.ca/data/api/action/package_show?id=1a09c5c1-3554-4b70-9e53-6322a72ec7d4";
const UA = { "user-agent": "ProofPrice-collector/1.0 (+https://proofprice.com; hello@proofprice.com)" };

/** English half-year zips from the CKAN package, newest first. Pure. */
export function englishZipUrls(pkg: any): string[] {
  const urls: { url: string; end: string }[] = [];
  for (const r of pkg?.result?.resources ?? []) {
    const m = String(r?.url ?? "").match(/gcsurplus-(\d{4}-\d{2}-\d{2})--(\d{4}-\d{2}-\d{2})-eng\.zip$/);
    if (m && String(r.url).startsWith("https://")) urls.push({ url: r.url, end: m[2] });
  }
  return urls.sort((a, b) => b.end.localeCompare(a.end)).map((u) => u.url);
}

/** The daily collector: read the newest four half-year files (24 months), keep aggregates only. */
export async function caHarvest(): Promise<HarvestResult> {
  const pres = await fetch(PACKAGE_URL, { headers: UA });
  if (!pres.ok) throw new SourceError(`open.canada.ca returned HTTP ${pres.status}`);
  const urls = englishZipUrls(await pres.json()).slice(0, 4);
  if (!urls.length) throw new SourceError("No GCSurplus 'items sold' files found in the dataset listing");
  const sales: Sale[] = [];
  for (const u of urls) {
    const res = await fetch(u, { headers: UA });
    if (!res.ok) throw new SourceError(`GCSurplus file returned HTTP ${res.status}`, u, res.status);
    sales.push(...parseSales(unzipFirstFile(Buffer.from(await res.arrayBuffer())).toString("utf8")));
  }
  if (!sales.length) throw new SourceError("GCSurplus files held no usable goods sales");
  const { date, rows } = dailyRows(sales);
  return { date, currency: "CAD", unit: "per lot", rows, note: `Windows of 6/12/24 months ending ${date}; sold goods lots, contracts left out; ${urls.length} half-year files.` };
}

export const snapWindow = (m: number | undefined): number => {
  const v = m ?? 12;
  return WINDOWS.reduce((best, w) => (Math.abs(w - v) < Math.abs(best - v) ? w : best), WINDOWS[0]);
};

/** Map a request to a group: an exact group name (spaces, dashes, case) or a keyword that classifies to one. */
export function groupFor(what: string): Group | null {
  const slug = what.toLowerCase().trim().replace(/[\s_&]+/g, "-");
  if ((GROUPS as readonly string[]).includes(slug)) return slug as Group;
  const alias: Record<string, Group> = { vehicle: "vehicles", cars: "vehicles", car: "vehicles", trucks: "vehicles", truck: "vehicles", "heavy-equipment": "heavy-equipment",
    computers: "electronics", computer: "electronics", laptops: "electronics", furniture: "office-furniture", "office-furnishings": "office-furniture", boat: "boats", tools: "tools-machinery", machinery: "tools-machinery" };
  if (alias[slug]) return alias[slug];
  return classify(what, false);
}

export function caKey(p: { what?: string; state?: string; months?: number }) {
  const group = groupFor(p.what ?? "");
  if (!group) return null;
  const prov = p.state?.trim() ? normaliseProvince(p.state) : NATIONAL;
  if (!prov) return null;
  const months = snapWindow(p.months);
  return { area: prov, item: `${group}:${months}m`, group, months, label: prov === NATIONAL ? "Canada" : PROVINCES[prov] };
}

export function caHistoryKey(p: { what?: string; state?: string; months?: number }) {
  const k = caKey(p);
  return k ? { area: k.area, item: k.item, label: `${k.label}, Canada, ${k.group}` } : null;
}

export function caAnswerFromRow(row: DailyRow & { date: string }, q: { label: string; group: Group; months: number; baseUrl?: string }): PriceAnswer {
  return buildAnswer({
    source: INFO,
    query: { country: "CA", what: q.group, ...(q.label !== "Canada" ? { state: q.label } : {}), months: q.months },
    summary: { count: row.n, median: row.median, low: row.low, high: row.high, min: row.min, max: row.max },
    currency: "CAD",
    unit: "per lot",
    period: { from: monthsBack(row.date, q.months), to: row.date },
    method:
      "Median and 10th–90th percentile of the sold amount on Government of Canada surplus lots (GCSurplus items sold) in the group, over the last 6, 12 or 24 months (your request is rounded to the nearest) ending at the newest sale in the latest file. " +
      "Groups come from keywords in the lot title; service, removal and scrap contracts are left out. A lot may hold several items. No range under 5 lots.",
    describe: (x) =>
      `Government of Canada surplus lots in the ${q.group.replace("-", " ")} group (${q.label}) sold for a median of ${fmtMoney(x.median, "CAD")} per lot (10th–90th percentile ${fmtMoney(x.low, "CAD")} to ${fmtMoney(x.high, "CAD")}); ` +
      "used goods sold by the government, not retail prices; whether tax is included is not stated.",
    baseUrl: q.baseUrl,
    evidence: CA_EVIDENCE,
  });
}

export async function caAuctionPrices(input: { what: string; state?: string; months?: number; baseUrl?: string }): Promise<PriceAnswer> {
  if (input.state?.trim() && !normaliseProvince(input.state)) {
    throw new InputError(`Unknown Canadian province '${input.state}'. Use a province or territory name or code: ${Object.keys(PROVINCES).join(", ")}.`);
  }
  const k = caKey(input);
  if (!k) throw new InputError(`Canada's surplus sales are grouped as: ${GROUPS.join(", ")}. Ask for one of these (or a word such as 'truck', 'laptop', 'forklift').`);
  const meta = readMeta(INFO.id);
  if (!meta?.last_date) throw new SourceError("ProofPrice collects the GCSurplus files daily; data appears after the next collection.");
  const to = meta.last_date;
  const from = new Date(Date.parse(to + "T00:00:00Z") - 60 * 86400000).toISOString().slice(0, 10);
  const rows = readDaily(INFO.id, { area: k.area, item: k.item, from, to });
  const row = rows[rows.length - 1];
  if (!row || row.n < MIN_PUBLISH) {
    const a = buildAnswer({
      source: INFO,
      query: { country: "CA", what: k.group, ...(k.area !== NATIONAL ? { state: k.label } : {}), months: k.months },
      summary: null, currency: "CAD", unit: "per lot", period: { from: null, to: null },
      method: "Rolling windows of GCSurplus items sold.", describe: () => "", baseUrl: input.baseUrl,
      extra: { reason: `Fewer than ${MIN_PUBLISH} sold ${k.group} lots in ${k.label} in the last ${k.months} months` },
    });
    a.summary = `Fewer than ${MIN_PUBLISH} sold ${k.group.replace("-", " ")} lots are recorded in ${k.label} in the last ${k.months} months, so no price range is published. Try a longer window (months up to 24) or leave out the province.`;
    return a;
  }
  return caAnswerFromRow(row, { label: k.label, group: k.group, months: k.months, baseUrl: input.baseUrl });
}
